#!/usr/bin/env python3
"""
阶段1 · 数据积累驱动 + 异常检测验证（公开 API 43.153.172.52:3003）

流程：
  1. admin 登录拿 JWT
  2. 给线上设备补齐传感器（D1: 振动/温度；D2: 温度），并取已有振动传感器
  3. 拟真传感器时序模拟器：正弦基线 + 趋势 + 高斯噪声 + 可控异常注入（尖峰/漂移/静默）
  4. 批量摄入（每批<=1000）累积到线上
  5. 创建工业模型 → 触发时序训练（hyperparams.sensorId）
  6. 轮询 COMPLETED → 取 timeseries/TRAINED 模型版本
  7. 推理：正常窗(NORMAL) + 注入异常窗(CRITICAL) → 断言异常检测生效
  8. 不删除数据（阶段1 = 积累）

用法：
  python feed_stage1.py                 # 一次性累积+训练+验证
  python feed_stage1.py --loop          # 持续喂食（每 60s 追加一批新点）
  python feed_stage1.py --points 3000   # 每台传感器积点数
"""
import argparse
import json
import math
import random
import sys
import time
import urllib.request
import urllib.error

BASE = "http://43.153.172.52:3003"
ADMIN_EMAIL = "test@test.com"
ADMIN_PWD = "123456"

# 线上已有设备
DEVICE1 = "cmrkgzaks0003howumm2k9sqr"  # API泵机（0 传感器）
DEVICE2 = "cmr1b8t6d0001mh972bo47m23"  # PUMP-001（已有 1 振动传感器）

# 传感器规格：(名称, channel, unit, 基线, 振幅, 噪声, 阈值min, max)
SENSOR_SPECS = {
    "vibration":  ("振动", "vibration", "mm/s", 3.0, 0.8, 0.30, 0, 10),
    "temperature":("温度", "temperature", "°C", 65.0, 5.0, 1.50, 0, 120),
    "pressure":   ("压力", "pressure", "bar", 8.0, 1.2, 0.40, 0, 16),
}


def req(method, path, body=None, token=None, timeout=30):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {"raw": e.read().decode()[:200]}
    except Exception as e:
        return -1, {"error": str(e)}


# ─── 拟真时序模拟器 ───────────────────────────────────
def simulate(spec, n, interval_sec, anomaly_seed=None):
    """返回 (values:float[], anomaly_ranges:[(start,end),...])"""
    rng = random.Random(anomaly_seed)
    name, channel, unit, base, amp, noise, lo, hi = spec
    now = time.time()
    start_ts = now - n * interval_sec
    values = []
    for i in range(n):
        t = i * interval_sec
        # 正弦基线 + 缓慢趋势 + 高斯噪声
        seasonal = amp * math.sin(2 * math.pi * t / (interval_sec * 120))  # ~2小时周期
        trend = 0.15 * math.sin(2 * math.pi * t / (interval_sec * 60 * 24))  # 日周期小趋势
        v = base + seasonal + trend + rng.gauss(0, noise)
        values.append(round(v, 3))

    # 注入 4 段异常（每段长 30 点，类型轮换）
    anomaly_ranges = []
    seg_len = 30
    positions = sorted(rng.sample(range(50, n - seg_len - 10), 4))
    kinds = ["spike", "drift", "stuck", "spike"]
    for pos, kind in zip(positions, kinds):
        for k in range(seg_len):
            idx = pos + k
            if idx >= n:
                break
            if kind == "spike":
                values[idx] = round(base * 3.0 + rng.gauss(0, noise), 3)   # 3x 尖峰
            elif kind == "drift":
                values[idx] = round(values[idx] + (k / seg_len) * (amp * 3), 3)  # 渐进漂移
            elif kind == "stuck":
                values[idx] = round(base + 0.05 * rng.gauss(0, 1), 3)      # 近乎静默/卡死
        anomaly_ranges.append((pos, min(pos + seg_len, n)))
    return values, anomaly_ranges


def build_batch(values, interval_sec, start_idx=0, count=None):
    """把 values 转成摄入 body（ISO 时间戳，升序到 now）"""
    n = len(values) if count is None else count
    now = time.time()
    pts = []
    for i in range(n):
        gi = start_idx + i
        ts = now - (len(values) - 1 - gi) * interval_sec
        pts.append({"value": values[gi], "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts))})
    return pts


def ingest_batch(sensor_id, points, token):
    s, b = req("POST", "/api/sensor-data/ingest/batch",
               {"sensorId": sensor_id, "data": points}, token=token)
    if s != 200:
        raise RuntimeError(f"摄入失败 {s}: {b}")
    return b["data"]["inserted"]


# ─── 主流程 ───────────────────────────────────────────
def ensure_sensors(token):
    """返回 [(device_id, sensor_id, spec_key)] 待喂食清单"""
    targets = []
    # D1 补 振动 + 温度
    for spec_key in ["vibration", "temperature"]:
        s, b = req("GET", f"/api/devices/{DEVICE1}/sensors", token=token)
        existing = {x["channel"]: x["id"] for x in (b.get("data") or [])}
        if spec_key in existing:
            targets.append((DEVICE1, existing[spec_key], spec_key))
            continue
        spec = SENSOR_SPECS[spec_key]
        s2, b2 = req("POST", f"/api/devices/{DEVICE1}/sensors",
                      {"name": spec[0], "channel": spec[1], "unit": spec[2],
                       "minThreshold": spec[6], "maxThreshold": spec[7]}, token=token)
        if s2 != 200:
            print(f"  [warn] D1 创建传感器 {spec_key} 失败 {s2}: {b2}")
            continue
        targets.append((DEVICE1, b2["data"]["id"], spec_key))
        print(f"  + D1 新建传感器 {spec[0]}({spec_key}) {b2['data']['id'][:8]}")
    # D2 用已有振动 + 补温度
    s, b = req("GET", f"/api/devices/{DEVICE2}/sensors", token=token)
    existing = {x["channel"]: x["id"] for x in (b.get("data") or [])}
    if "vibration" in existing:
        targets.append((DEVICE2, existing["vibration"], "vibration"))
    if "temperature" in existing:
        targets.append((DEVICE2, existing["temperature"], "temperature"))
    else:
        spec = SENSOR_SPECS["temperature"]
        s2, b2 = req("POST", f"/api/devices/{DEVICE2}/sensors",
                      {"name": spec[0], "channel": spec[1], "unit": spec[2],
                       "minThreshold": spec[6], "maxThreshold": spec[7]}, token=token)
        if s2 == 200:
            targets.append((DEVICE2, b2["data"]["id"], "temperature"))
            print(f"  + D2 新建传感器 {spec[0]}(temperature) {b2['data']['id'][:8]}")
    return targets


def accumulate(targets, token, points, interval_sec):
    total = 0
    info = {}
    for device_id, sensor_id, spec_key in targets:
        values, anomalies = simulate(SENSOR_SPECS[spec_key], points, interval_sec,
                                     anomaly_seed=hash(sensor_id) & 0xffff)
        info[sensor_id] = (values, anomalies, spec_key)
        # 分块摄入
        for off in range(0, len(values), 1000):
            chunk = build_batch(values, interval_sec, start_idx=off,
                                count=min(1000, len(values) - off))
            total += ingest_batch(sensor_id, chunk, token)
        print(f"  累积 {SPEC_NAME(spec_key)} ({sensor_id[:8]}): {len(values)} 点, 注入异常段 {len(anomalies)}")
    print(f"  累计摄入 {total} 点")
    return info


def SPEC_NAME(k):
    return SENSOR_SPECS[k][0]


def train_and_verify(train_sensor_id, train_spec_key, token, info):
    # 创建工业模型
    s, b = req("POST", "/api/models",
               {"name": "阶段1-振动基线模型", "industry": "工业",
                "scenario": "设备预防性维修", "baseModel": "timeseries"}, token=token)
    if s != 200:
        raise RuntimeError(f"创建模型失败 {s}: {b}")
    model_id = b["data"]["id"]
    print(f"  创建工业模型 {model_id[:8]}")

    # 触发时序训练
    s, b = req("POST", "/api/training",
               {"modelId": model_id,
                "hyperparams": {"dataType": "timeseries", "sensorId": train_sensor_id,
                                "windowSize": 24, "step": 12}}, token=token)
    if s != 200:
        raise RuntimeError(f"创建训练任务失败 {s}: {b}")
    job_id = b["data"]["id"]
    print(f"  训练任务 {job_id[:8]} 已创建")

    # 轮询
    status = "RUNNING"
    for i in range(40):
        time.sleep(2)
        s, b = req("GET", f"/api/training/{job_id}", token=token)
        if s == 200:
            status = b["data"]["status"]
        if i % 4 == 0:
            print(f"    轮询 {i}: {status}")
        if status in ("COMPLETED", "FAILED"):
            break
    if status != "COMPLETED":
        raise RuntimeError(f"训练未完成: {status}")

    # 取模型版本
    s, b = req("GET", f"/api/models/{model_id}/versions", token=token)
    mv = None
    for v in (b.get("data") or []):
        if v.get("dataType") == "timeseries" and v.get("status") == "TRAINED":
            mv = v
            break
    if not mv:
        raise RuntimeError("未找到 timeseries/TRAINED 模型版本")
    print(f"  模型版本 {mv['id'][:8]} dataType={mv['dataType']} 阈值来源=95分位")

    # 构造推理窗口：正常窗（基线区）+ 异常窗（注入异常区）
    values, anomalies, _ = info[train_sensor_id]
    normal_win = values[100:124]                      # 干净基线
    a0, a1 = anomalies[0]
    anomaly_win = values[a0 + 3:a0 + 3 + 24]          # 异常段内 24 点
    if len(normal_win) != 24 or len(anomaly_win) != 24:
        raise RuntimeError("窗口长度不足 24")
    s, b = req("POST", "/api/inference/timeseries",
               {"modelVersionId": mv["id"], "windows": [normal_win, anomaly_win]}, token=token)
    if s != 200:
        raise RuntimeError(f"推理失败 {s}: {b}")
    res = b["data"]["results"]
    sev = [r["severity"] for r in res]
    scores = [round(r["score"], 3) for r in res]
    print(f"  推理: 正常窗 severity={sev[0]} score={scores[0]} | 异常窗 severity={sev[1]} score={scores[1]}")
    assert sev[0] == "NORMAL", f"正常窗应判 NORMAL, 实际 {sev[0]}"
    assert sev[1] in ("WARNING", "CRITICAL"), f"异常窗应判异常, 实际 {sev[1]}"
    print("  RESULT: PASS — 数据积累后异常检测生效（正常窗 NORMAL / 注入异常窗被标记）")
    return model_id


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--points", type=int, default=2500)
    ap.add_argument("--interval", type=int, default=600, help="采样间隔(秒)")
    ap.add_argument("--loop", action="store_true", help="持续喂食模式")
    args = ap.parse_args()

    print("== 阶段1 数据积累 ==")
    s, b = req("POST", "/api/auth/login", {"email": ADMIN_EMAIL, "password": ADMIN_PWD})
    if s != 200:
        print("登录失败", s, b); sys.exit(1)
    token = b["data"]["token"]
    print("admin 登录 OK")

    targets = ensure_sensors(token)
    print(f"待喂食传感器 {len(targets)} 个")

    if args.loop:
        print(f"--loop 模式：每 60s 追加 {args.points} 点/传感器（Ctrl+C 退出）")
        while True:
            accumulate(targets, token, args.points, args.interval)
            time.sleep(60)
    else:
        info = accumulate(targets, token, args.points, args.interval)
        # 训练 + 验证（用 D1 振动传感器，即 targets 中第一个 vibration）
        train_target = next((t for t in targets if t[2] == "vibration" and t[0] == DEVICE1), targets[0])
        train_and_verify(train_target[1], train_target[2], token, info)
        print("== 阶段1 完成 ==")


if __name__ == "__main__":
    main()
