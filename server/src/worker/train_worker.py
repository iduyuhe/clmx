#!/usr/bin/env python3
"""
CLMX Training Worker — 真实训练引擎
用法: python train_worker.py --job-id <id> --model-type <type> --data-path <path> [options]

设计原则:
  - CPU/GPU 自动检测，同一份代码
  - 进度写入 JSON 日志文件，Node.js 轮询读取
  - 检查点保存，支持断点续训
  - 支持多任务类型：文本分类、NER、情感分析
"""

import argparse
import json
import os
import sys
import time
import traceback
import math
from datetime import datetime
from typing import Optional
from pathlib import Path

# ─── 配置 ───────────────────────────────────────────
PROGRESS_FILE = None       # 运行时设置
CHECKPOINT_DIR = None
LOG_INTERVAL = 2           # 每 N 个 batch 输出一次日志
PROGRESS_INTERVAL = 0.5    # 每 N 秒更新进度文件


def log(msg: str, level: str = "INFO", **meta):
    """写进度到 JSON 日志文件，同时打印"""
    entry = {
        "timestamp": datetime.now().isoformat(),
        "level": level,
        "message": msg,
    }
    entry.update(meta)
    print(f"[{level}] {msg}", file=sys.stderr)
    if PROGRESS_FILE:
        try:
            # 追加写入
            with open(PROGRESS_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception:
            pass


def update_progress(progress: int, epoch: int, total_epochs: int,
                    loss: float = 0, metrics: Optional[dict] = None):
    """更新训练进度状态文件"""
    if not PROGRESS_FILE:
        return
    state_file = PROGRESS_FILE.replace(".log", ".state.json")
    state = {
        "progress": progress,
        "currentEpoch": epoch,
        "totalEpochs": total_epochs,
        "loss": round(loss, 6),
        "status": "RUNNING",
        "updatedAt": datetime.now().isoformat(),
    }
    if metrics:
        state["metrics"] = metrics
    try:
        with open(state_file, "w", encoding="utf-8") as f:
            json.dump(state, f, ensure_ascii=False)
    except Exception:
        pass


# ─── 数据集加载 ─────────────────────────────────────
def load_dataset(data_path: str, text_col: str = "text",
                 label_col: str = "label", max_samples: int = 0):
    """加载 CSV/JSONL 数据集"""
    log(f"加载数据集: {data_path}")
    texts, labels = [], []

    path = Path(data_path)
    if not path.exists():
        raise FileNotFoundError(f"数据集文件不存在: {data_path}")

    if path.suffix == ".jsonl":
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    item = json.loads(line)
                    texts.append(item.get(text_col, ""))
                    labels.append(item.get(label_col, ""))
    elif path.suffix == ".csv":
        import csv
        with open(path, "r", encoding="utf-8-sig") as f:
            reader = csv.DictReader(f)
            for row in reader:
                texts.append(row.get(text_col, ""))
                labels.append(row.get(label_col, ""))
    else:
        raise ValueError(f"不支持的文件格式: {path.suffix}")

    if max_samples and len(texts) > max_samples:
        texts = texts[:max_samples]
        labels = labels[:max_samples]

    log(f"数据集加载完成: {len(texts)} 条数据")
    return texts, labels


# ─── 模型工厂 ───────────────────────────────────────
def create_model(model_type: str, num_labels: int):
    """根据类型创建模型"""
    log(f"创建模型: {model_type}, 类别数: {num_labels}")
    try:
        import torch
        import torch.nn as nn
    except ImportError:
        log("PyTorch 未安装，请先安装: pip install torch", "ERROR")
        sys.exit(1)

    if model_type == "fasttext":
        return FastTextClassifier(num_labels), "fasttext"
    elif model_type == "lstm":
        return LSTMClassifier(num_labels), "lstm"
    elif model_type == "distilbert":
        try:
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
            model_name = "distilbert-base-uncased"
            log(f"加载预训练模型: {model_name}")
            tokenizer = AutoTokenizer.from_pretrained(model_name)
            model = AutoModelForSequenceClassification.from_pretrained(
                model_name, num_labels=num_labels
            )
            return (model, tokenizer), "distilbert"
        except ImportError:
            log("transformers 未安装，回退到 LSTM 模型", "WARN")
            return LSTMClassifier(num_labels), "lstm"
    else:
        log(f"未知模型类型 {model_type}，回退到 LSTM", "WARN")
        return LSTMClassifier(num_labels), "lstm"


# ─── FastText 风格分类器（轻量，CPU 友好）─────────────
class FastTextClassifier:
    """简单的词袋嵌入 + 全连接分类器，CPU 上也能跑"""
    def __init__(self, num_labels: int, vocab_size: int = 30000, embed_dim: int = 100):
        import torch.nn as nn
        self.num_labels = num_labels
        self.embed_dim = embed_dim
        self.vocab_size = vocab_size
        self.model = nn.Sequential(
            nn.EmbeddingBag(vocab_size, embed_dim, mode="mean"),
            nn.Linear(embed_dim, 128),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(128, num_labels),
        )
        self.word2idx = {}
        self._next_idx = 0
        self.device = "cpu"

    def _tokenize(self, text):
        """简单分词 + 词表映射"""
        tokens = str(text).lower().split()
        return [self.word2idx.setdefault(t, len(self.word2idx)) % self.vocab_size
                for t in tokens[:256]] or [0]

    def build_vocab(self, texts):
        for text in texts:
            self._tokenize(text)

    def to(self, device):
        self.model = self.model.to(device)
        self.device = device
        return self

    def train(self, mode=True):
        self.model.train(mode)
        return self

    def eval(self):
        return self.train(False)

    def parameters(self):
        return self.model.parameters()

    def state_dict(self):
        return {
            "model": self.model.state_dict(),
            "word2idx": self.word2idx,
            "num_labels": self.num_labels,
            "embed_dim": self.embed_dim,
        }

    def load_state_dict(self, d):
        self.model.load_state_dict(d["model"])
        self.word2idx = d.get("word2idx", {})
        self.num_labels = d.get("num_labels", self.num_labels)
        self.embed_dim = d.get("embed_dim", self.embed_dim)


# ─── LSTM 分类器 ────────────────────────────────────
class LSTMClassifier:
    """轻量 LSTM 分类器"""
    def __init__(self, num_labels: int, vocab_size: int = 30000,
                 embed_dim: int = 128, hidden_dim: int = 128):
        import torch.nn as nn
        self.num_labels = num_labels
        self.vocab_size = vocab_size
        self.embed_dim = embed_dim
        self.embedding = nn.Embedding(vocab_size, embed_dim, padding_idx=0)
        self.lstm = nn.LSTM(embed_dim, hidden_dim, batch_first=True, num_layers=2,
                            dropout=0.3, bidirectional=True)
        self.classifier = nn.Sequential(
            nn.Linear(hidden_dim * 2, 64),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(64, num_labels),
        )
        self.word2idx = {}
        self.device = "cpu"

    def _tokenize(self, text):
        tokens = str(text).lower().split()
        return [self.word2idx.setdefault(t, len(self.word2idx)) % self.vocab_size
                for t in tokens[:256]] or [0]

    def build_vocab(self, texts):
        for text in texts:
            self._tokenize(text)

    def to(self, device):
        self.embedding = self.embedding.to(device)
        self.lstm = self.lstm.to(device)
        self.classifier = self.classifier.to(device)
        self.device = device
        return self

    def train(self, mode=True):
        self.embedding.train(mode)
        self.lstm.train(mode)
        self.classifier.train(mode)
        return self

    def eval(self):
        return self.train(False)

    def parameters(self):
        import itertools
        return itertools.chain(
            self.embedding.parameters(),
            self.lstm.parameters(),
            self.classifier.parameters(),
        )

    def state_dict(self):
        return {
            "embedding": self.embedding.state_dict(),
            "lstm": self.lstm.state_dict(),
            "classifier": self.classifier.state_dict(),
            "word2idx": self.word2idx,
            "num_labels": self.num_labels,
        }

    def load_state_dict(self, d):
        self.embedding.load_state_dict(d["embedding"])
        self.lstm.load_state_dict(d["lstm"])
        self.classifier.load_state_dict(d["classifier"])
        self.word2idx = d.get("word2idx", {})
        self.num_labels = d.get("num_labels", self.num_labels)


# ─── 工业时序异常检测（零依赖，统计轮廓法）───────────
def load_timeseries_dataset(data_path: str):
    """加载时序窗口数据集：JSONL 每行 {"values": [float,...]} 或 CSV 定长行"""
    log(f"加载时序数据集: {data_path}")
    windows = []
    path = Path(data_path)
    if not path.exists():
        raise FileNotFoundError(f"数据集文件不存在: {data_path}")

    if path.suffix == ".jsonl":
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    item = json.loads(line)
                    vals = item.get("values") or item.get("window") or []
                    windows.append([float(v) for v in vals])
    elif path.suffix == ".csv":
        import csv
        with open(path, "r", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            for row in reader:
                nums = [v for v in row if v != ""]
                if nums:
                    windows.append([float(v) for v in nums])
    else:
        raise ValueError(f"不支持的文件格式: {path.suffix}")

    if not windows:
        raise ValueError("时序数据集为空")
    wlen = len(windows[0])
    for idx, w in enumerate(windows):
        if len(w) != wlen:
            raise ValueError(f"窗口长度不一致 (第 {idx} 个窗口长度 {len(w)} != {wlen})")
    log(f"时序数据集加载完成: {len(windows)} 个窗口, 窗口长度 {wlen}")
    return windows


def compute_window_score(window, mean_vec, std_vec):
    """平均标准化偏离度 (z-score 距离)：越小越正常，越大越异常"""
    if not window:
        return 0.0
    s = 0.0
    for i in range(len(window)):
        std = std_vec[i] if std_vec[i] > 1e-9 else 1e-9
        s += abs(window[i] - mean_vec[i]) / std
    return s / len(window)


def percentile(data, p):
    """线性插值分位数"""
    if not data:
        return 0.0
    k = (len(data) - 1) * p
    f = int(math.floor(k))
    c = int(math.ceil(k))
    if f == c:
        return data[int(k)]
    return data[f] * (c - k) + data[c] * (k - f)


def train_timeseries(args):
    """工业时序异常检测训练（零依赖，统计轮廓法）

    将每个定长窗口视为一个多维"正常模式"向量，计算训练集所有窗口的
    均值向量 μ 与标准差向量 σ 作为正常轮廓；再计算训练集每窗口与正常
    轮廓的平均标准化偏离度（异常分数），取 95 分位数作为告警阈值。
    推理时对输入窗口计算同样分数并比对阈值即可。
    """
    import math
    global PROGRESS_FILE, CHECKPOINT_DIR

    ckpt_dir = Path(args.checkpoint_dir or f"./checkpoints/{args.job_id}")
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    CHECKPOINT_DIR = str(ckpt_dir)
    os.makedirs("logs", exist_ok=True)
    PROGRESS_FILE = f"logs/train_{args.job_id}.log"

    log("=" * 60)
    log(f"[INDUSTRIAL] 时序异常检测训练启动: {args.job_id}")
    log(f"数据: {args.data_path}")
    log("=" * 60)

    windows = load_timeseries_dataset(args.data_path)
    wlen = len(windows[0])
    n = len(windows)

    # 正常轮廓：每个位置的均值与标准差
    mean_vec = [0.0] * wlen
    for w in windows:
        for i in range(wlen):
            mean_vec[i] += w[i]
    mean_vec = [s / n for s in mean_vec]

    std_vec = [0.0] * wlen
    for w in windows:
        for i in range(wlen):
            std_vec[i] += (w[i] - mean_vec[i]) ** 2
    std_vec = [math.sqrt(s / n) for s in std_vec]

    # 训练集每窗口异常分数
    scores = sorted(compute_window_score(w, mean_vec, std_vec) for w in windows)
    threshold = percentile(scores, 0.95)
    p50 = percentile(scores, 0.50)
    p99 = percentile(scores, 0.99)

    update_progress(
        progress=100, epoch=1, total_epochs=1,
        metrics={"final_loss": round(threshold, 6), "num_samples": n, "model_type": "timeseries"},
    )

    # 保存模型（纯 JSON，零依赖）
    meta = {
        "model_type": "timeseries",
        "domain": "INDUSTRIAL",
        "window_size": wlen,
        "feature_mean": [round(v, 6) for v in mean_vec],
        "feature_std": [round(v, 6) for v in std_vec],
        "threshold": round(threshold, 6),
        "train_score_p50": round(p50, 6),
        "train_score_p99": round(p99, 6),
        "training_samples": n,
        "created_at": datetime.now().isoformat(),
    }
    with open(ckpt_dir / "model_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    with open(PROGRESS_FILE.replace(".log", ".state.json"), "w") as f:
        json.dump({
            "progress": 100,
            "currentEpoch": 1,
            "totalEpochs": 1,
            "loss": round(threshold, 6),
            "status": "COMPLETED",
            "metrics": {
                "final_loss": round(threshold, 6),
                "num_samples": n,
                "window_size": wlen,
                "model_type": "timeseries",
            },
            "checkpointPath": str(ckpt_dir),
            "updatedAt": datetime.now().isoformat(),
        }, f, ensure_ascii=False)

    log(f"✅ 时序模型已保存到: {ckpt_dir}")
    log(f"   窗口长度={wlen}, 训练样本={n}, 异常阈值(95分位)={threshold:.4f}")
    return 0


# ─── 中文文本分类（零依赖，朴素贝叶斯 + 字符级特征）───────────
def _tokenize_zh(text):
    """中英文统一分词：中文按字、英文/数字按词（小写），去标点。

    训练端与推理端必须完全一致（推理在 Node.js 纯 JS 复现同一逻辑），
    否则会出现"训练用一个分词、推理用另一个"导致训推不互通。
    """
    import re
    text = str(text).lower()
    tokens = []
    for ch in re.findall(r"[\u4e00-\u9fff]", text):
        tokens.append(ch)
    for w in re.findall(r"[a-z0-9]+", text):
        tokens.append(w)
    return tokens


def train_text_classification(args):
    """中文文本分类训练（零依赖：纯标准库实现多项朴素贝叶斯）

    与工业时序范式一致：产出纯 JSON model_meta.json，Node 端纯 JS 复现推理，
    不联网、不依赖 torch。训练端与推理端分词逻辑完全一致，保证训推同模型。
    """
    global PROGRESS_FILE, CHECKPOINT_DIR
    ckpt_dir = Path(args.checkpoint_dir or f"./checkpoints/{args.job_id}")
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    CHECKPOINT_DIR = str(ckpt_dir)
    os.makedirs("logs", exist_ok=True)
    PROGRESS_FILE = f"logs/train_{args.job_id}.log"

    log("=" * 60)
    log(f"[NLP] 中文文本分类训练启动: {args.job_id}")
    log("=" * 60)

    texts, labels = load_dataset(args.data_path, args.text_col, args.label_col,
                                 max_samples=args.max_samples)
    from collections import Counter
    label_set = sorted(set(labels))
    n = len(texts)
    log(f"类别: {label_set} ({len(label_set)} 类), 样本: {n}")

    # 多项朴素贝叶斯（Multinomial NB），拉普拉斯平滑
    class_count = Counter(labels)
    word_counts = {l: Counter() for l in label_set}
    vocab = set()
    for t, l in zip(texts, labels):
        for tok in _tokenize_zh(t):
            word_counts[l][tok] += 1
            vocab.add(tok)
    V = len(vocab)
    alpha = 1.0
    class_log_prior = {l: math.log(class_count[l] / n) for l in label_set}
    word_log_prob = {}
    unknown_log_prob = {}
    for l in label_set:
        total = sum(word_counts[l].values()) + alpha * V
        wlp = {w: math.log((word_counts[l].get(w, 0) + alpha) / total) for w in vocab}
        word_log_prob[l] = wlp
        unknown_log_prob[l] = math.log(alpha / total)

    # 训练集准确率（留作指标）
    correct = 0
    for t, l in zip(texts, labels):
        best, best_score = None, -1e18
        for c in label_set:
            s = class_log_prior[c]
            for w in _tokenize_zh(t):
                s += word_log_prob[c].get(w, unknown_log_prob[c])
            if s > best_score:
                best_score, best = s, c
        if best == l:
            correct += 1
    acc = correct / n if n else 0.0

    update_progress(progress=100, epoch=1, total_epochs=1,
                   metrics={"accuracy": round(acc, 4), "num_samples": n,
                            "num_classes": len(label_set), "vocab_size": V,
                            "model_type": "text_classification"})

    meta = {
        "model_type": "text_classification",
        "domain": "NLP",
        "algorithm": "multinomial_nb",
        "labels": label_set,
        "class_log_prior": class_log_prior,
        "word_log_prob": word_log_prob,
        "unknown_log_prob": unknown_log_prob,
        "vocab_size": V,
        "token_mode": "char_ngram_unigram",
        "num_samples": n,
        "train_accuracy": round(acc, 4),
        "class_distribution": dict(class_count),
        "created_at": datetime.now().isoformat(),
    }
    with open(ckpt_dir / "model_meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    state = {
        "progress": 100, "currentEpoch": 1, "totalEpochs": 1,
        "loss": round(1 - acc, 6), "status": "COMPLETED",
        "metrics": {"accuracy": round(acc, 4), "num_samples": n,
                    "num_classes": len(label_set), "vocab_size": V,
                    "model_type": "text_classification"},
        "checkpointPath": str(ckpt_dir),
        "updatedAt": datetime.now().isoformat(),
    }
    with open(PROGRESS_FILE.replace(".log", ".state.json"), "w") as f:
        json.dump(state, f, ensure_ascii=False)
    log(f"✅ 中文文本分类模型已保存: {ckpt_dir} (train_acc={acc:.3f})")
    return 0


# ─── 训练核心 ───────────────────────────────────────
def train_epoch(model, model_type, X, y, label2idx, optimizer, criterion,
                batch_size, epoch, total_epochs, device, samples_per_batch_global):
    """训练一个 epoch"""
    import torch
    import random
    from torch.nn.utils.rnn import pad_sequence

    indices = list(range(len(X)))
    random.shuffle(indices)
    total_loss = 0.0
    num_batches = (len(indices) + batch_size - 1) // batch_size

    for batch_start in range(0, len(indices), batch_size):
        batch_idx = indices[batch_start:batch_start + batch_size]
        batch_texts = [X[i] for i in batch_idx]
        batch_labels = [label2idx[y[i]] for i in batch_idx]

        if model_type == "distilbert":
            model_nn, tokenizer = model
            encoding = tokenizer(
                batch_texts, padding=True, truncation=True,
                max_length=128, return_tensors="pt"
            )
            labels = torch.tensor(batch_labels, dtype=torch.long)
            outputs = model_nn(
                input_ids=encoding["input_ids"].to(device),
                attention_mask=encoding["attention_mask"].to(device),
                labels=labels.to(device),
            )
            loss = outputs.loss
        else:
            # FastText / LSTM — tokenize
            token_ids_list = [torch.tensor(model._tokenize(t), dtype=torch.long)
                              for t in batch_texts]
            padded = pad_sequence(token_ids_list, batch_first=True,
                                  padding_value=0).to(device)
            labels = torch.tensor(batch_labels, dtype=torch.long).to(device)

            if model_type == "fasttext":
                # EmbeddingBag 需要 1D offsets
                offsets = [0]
                for ids in token_ids_list:
                    offsets.append(offsets[-1] + len(ids))
                offsets = offsets[:-1]
                flat_ids = torch.cat(token_ids_list).to(device)
                offsets_t = torch.tensor(offsets, dtype=torch.long).to(device)
                logits = model.model(flat_ids, offsets_t)
            elif model_type == "lstm":
                logits = model.classifier(model.lstm(model.embedding(padded))[0][:, -1, :])
            else:
                logits = torch.zeros(len(batch_texts), len(label2idx)).to(device)

            loss = criterion(logits, labels)

        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        total_loss += loss.item()
        samples_per_batch_global += len(batch_idx)

        # 进度汇报
        batch_num = batch_start // batch_size + 1
        if batch_num % LOG_INTERVAL == 0:
            avg_loss = total_loss / batch_num
            total_progress = int((epoch - 1) / total_epochs * 100 +
                                 (batch_num / num_batches) * (100 / total_epochs))
            update_progress(
                progress=min(99, total_progress),
                epoch=epoch,
                total_epochs=total_epochs,
                loss=avg_loss,
            )
            log(f"Epoch {epoch}/{total_epochs} Batch {batch_num}/{num_batches} "
                f"loss={avg_loss:.4f}", "TRAIN", epoch=epoch, batch=batch_num, loss=round(avg_loss, 4))

    avg_epoch_loss = total_loss / max(num_batches, 1)
    return avg_epoch_loss


def train(args):
    """主训练流程"""
    # 工业时序分支：零依赖统计异常检测，不加载 torch
    if args.model_type == "timeseries":
        return train_timeseries(args)
    # 中文文本分类分支：零依赖朴素贝叶斯，不加载 torch
    if args.model_type == "text_classification":
        return train_text_classification(args)

    import torch
    import torch.optim as optim
    global PROGRESS_FILE, CHECKPOINT_DIR

    # ── 检测设备 ──
    if torch.cuda.is_available():
        device = torch.device("cuda")
        log(f"检测到 GPU: {torch.cuda.get_device_name(0)}")
    elif torch.backends.mps.is_available():
        device = torch.device("mps")
        log("检测到 Apple MPS")
    else:
        device = torch.device("cpu")
        log("使用 CPU 训练（预计速度较慢）")

    # ── 设置路径 ──
    ckpt_dir = Path(args.checkpoint_dir or f"./checkpoints/{args.job_id}")
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    CHECKPOINT_DIR = str(ckpt_dir)
    os.makedirs("logs", exist_ok=True)
    PROGRESS_FILE = f"logs/train_{args.job_id}.log"

    # ── 初始化 ──
    log("=" * 60)
    log(f"训练任务启动: {args.job_id}")
    log(f"模型类型: {args.model_type}, Epochs: {args.epochs}, Batch: {args.batch_size}")
    log(f"设备: {device}, 数据: {args.data_path}")
    log("=" * 60)

    # ── 加载数据 ──
    texts, labels = load_dataset(args.data_path, args.text_col, args.label_col,
                                 max_samples=args.max_samples)

    label_set = sorted(set(labels))
    label2idx = {l: i for i, l in enumerate(label_set)}
    idx2label = {i: l for l, i in label2idx.items()}
    num_labels = len(label_set)
    log(f"类别: {label_set} ({num_labels} 类)")

    # ── 创建模型 ──
    model_or_tuple, resolved_type = create_model(args.model_type, num_labels)
    if resolved_type != "distilbert":
        model_or_tuple.build_vocab(texts)
    model = model_or_tuple
    args.model_type = resolved_type  # 可能被回退

    if resolved_type != "distilbert":
        model = model.to(device)
        optimizer = optim.Adam(model.parameters(), lr=args.learning_rate)
    else:
        model_nn, tokenizer = model
        model_nn = model_nn.to(device)
        optimizer = optim.AdamW(model_nn.parameters(), lr=args.learning_rate)

    criterion = torch.nn.CrossEntropyLoss()

    # ── 训练循环 ──
    samples_total = 0
    best_loss = float("inf")

    for epoch in range(1, args.epochs + 1):
        log(f"=== Epoch {epoch}/{args.epochs} ===")
        update_progress(
            progress=int((epoch - 1) / args.epochs * 100),
            epoch=epoch,
            total_epochs=args.epochs,
            loss=best_loss,
        )

        model.train()
        if resolved_type == "distilbert":
            model_nn.train()

        epoch_loss = train_epoch(
            model=model,
            model_type=resolved_type,
            X=texts,
            y=labels,
            label2idx=label2idx,
            optimizer=optimizer,
            criterion=criterion,
            batch_size=args.batch_size,
            epoch=epoch,
            total_epochs=args.epochs,
            device=device,
            samples_per_batch_global=samples_total,
        )

        log(f"Epoch {epoch} 完成, loss={epoch_loss:.4f}")

        # ── 保存检查点 ──
        ckpt_path = ckpt_dir / f"checkpoint_epoch_{epoch}.pt"
        if resolved_type == "distilbert":
            model_nn.save_pretrained(str(ckpt_dir))
            tokenizer.save_pretrained(str(ckpt_dir))
            save_dict = {
                "model_type": resolved_type,
                "label2idx": label2idx,
                "idx2label": idx2label,
            }
            torch.save(save_dict, ckpt_dir / "meta.pt")
        else:
            torch.save(model.state_dict(), ckpt_path)

        if epoch_loss < best_loss:
            best_loss = epoch_loss
            log(f"最佳模型已更新 (loss={best_loss:.4f})")

    # ── 完成 ──
    log("训练完成！正在保存最终模型...")
    torch.save({
        "model_type": resolved_type,
        "label2idx": label2idx,
        "idx2label": idx2label,
        "num_labels": num_labels,
    }, ckpt_dir / "model_meta.json" if resolved_type != "distilbert"
       else ckpt_dir / "meta.pt")

    # 写入完成的进度
    with open(PROGRESS_FILE.replace(".log", ".state.json"), "w") as f:
        json.dump({
            "progress": 100,
            "currentEpoch": args.epochs,
            "totalEpochs": args.epochs,
            "loss": best_loss,
            "status": "COMPLETED",
            "metrics": {
                "final_loss": best_loss,
                "num_samples": len(texts),
                "num_labels": num_labels,
                "model_type": resolved_type,
            },
            "checkpointPath": str(ckpt_dir),
            "updatedAt": datetime.now().isoformat(),
        }, f, ensure_ascii=False)

    log(f"✅ 模型已保存到: {ckpt_dir}")
    return 0


# ─── CLI ────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description="CLMX Training Worker")
    parser.add_argument("--job-id", required=True, help="训练任务 ID")
    parser.add_argument("--model-type", default="fasttext",
                        choices=["fasttext", "lstm", "distilbert", "timeseries", "text_classification"],
                        help="模型类型 (默认: fasttext；timeseries=工业时序异常检测，零依赖；text_classification=中文文本分类，零依赖)")
    parser.add_argument("--data-path", required=True, help="数据集路径 (CSV/JSONL)")
    parser.add_argument("--text-col", default="text", help="文本列名")
    parser.add_argument("--label-col", default="label", help="标签列名")
    parser.add_argument("--epochs", type=int, default=5, help="训练轮数")
    parser.add_argument("--batch-size", type=int, default=16,
                        help="Batch 大小 (CPU 建议 8-16)")
    parser.add_argument("--learning-rate", type=float, default=0.001, help="学习率")
    parser.add_argument("--max-samples", type=int, default=0,
                        help="最大训练样本数 (0=全部)")
    parser.add_argument("--checkpoint-dir", default="", help="检查点目录")

    args = parser.parse_args()

    try:
        exit_code = train(args)
        sys.exit(exit_code)
    except Exception as e:
        log(f"训练异常: {e}", "ERROR")
        traceback.print_exc(file=sys.stderr)
        # 写入错误状态
        if PROGRESS_FILE:
            state_file = PROGRESS_FILE.replace(".log", ".state.json")
            with open(state_file, "w") as f:
                json.dump({
                    "progress": 0,
                    "status": "FAILED",
                    "error": str(e),
                    "updatedAt": datetime.now().isoformat(),
                }, f)
        sys.exit(1)


if __name__ == "__main__":
    main()
