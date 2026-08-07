#!/usr/bin/env python3
"""快速验证训练 Worker 是否正常工作"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

# 生成测试数据
test_data = os.path.join(os.path.dirname(__file__), "..", "..", "test_data.csv")
os.makedirs(os.path.dirname(test_data), exist_ok=True)
with open(test_data, "w", encoding="utf-8") as f:
    f.write("text,label\n")
    f.write("这家店服务很好，菜品美味,正面\n")
    f.write("环境不错，价格合理，推荐,正面\n")
    f.write("味道一般，服务也慢,负面\n")
    f.write("非常满意，下次还来,正面\n")
    f.write("太差了，等了很久,负面\n")
    f.write("性价比很高，很喜欢,正面\n")
    f.write("不太行，味道不好,负面\n")
    f.write("还可以吧，就那样,中性\n")
    f.write("很失望，不会再来了,负面\n")
    f.write("东西很好吃，服务员态度也好,正面\n")
    # 多生成一些数据
    for i in range(50):
        label = ["正面", "负面", "中性"][i % 3]
        f.write(f"这是第{i}条测试数据,{label}\n")

# 运行训练
import subprocess
import json

PYTHON = sys.executable
script = os.path.join(os.path.dirname(__file__), "train_worker.py")

args = [
    PYTHON, script,
    "--job-id", "test-001",
    "--model-type", "fasttext",
    "--data-path", test_data,
    "--text-col", "text",
    "--label-col", "label",
    "--epochs", "2",
    "--batch-size", "4",
    "--max-samples", "30",
]

print("=" * 60)
print("运行训练 Worker 测试...")
print(" ".join(args))
print("=" * 60)

result = subprocess.run(args, cwd=os.path.join(os.path.dirname(__file__), "..", ".."))
print(f"\n退出码: {result.returncode}")

# 检查结果
state_file = "logs/train_test-001.state.json"
if os.path.exists(state_file):
    with open(state_file) as f:
        state = json.load(f)
    print(f"\n训练状态: {json.dumps(state, indent=2, ensure_ascii=False)}")
    if state.get("status") == "COMPLETED":
        print("\n✅ 训练 Worker 测试通过！")
    else:
        print(f"\n❌ 训练异常: {state.get('error')}")
else:
    print("\n❌ 未找到状态文件，训练可能失败")
