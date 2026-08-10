# 变更日志 · Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/) 约定，版本号采用 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

_当前开发中的变更将记录在此处。_

## [0.1.0] - 2026-08-10 — ✅ 已发布

> 首次公开开源版本。Release 见 [GitHub](https://github.com/iduyuhe/clmx/releases/tag/v0.1.0) / [Gitee](https://gitee.com/i4hub/clmx/releases/v0.1.0)。

### 新增

- 垂类 AI 模型工厂：数据 → 训练 → 评估 → 推理部署完整生命周期
- 半智能体闭环：自然语言交互入口、自动基线/告警阈值、异常自动处置工单、训练结果自动解读
- AI 原生接入生成器：文档/描述/样本 → 提取测点 → 生成物模型 + 零依赖 JS 采集驱动，并支持复用他人已验证接入资产
- 北向 MCP 能力开放：内置零依赖 MCP stdio Server（10 个工具），平台可被外部 AI 智能体安全编排
- 多租户 SaaS：行级隔离 + 配额/计费/白标
- CI 流水线（`.github/workflows/ci.yml`）
- 社区健康文件：CONTRIBUTING / CODE_OF_CONDUCT / SECURITY / SUPPORT / ISSUE & PR 模板 / dependabot

### 说明

- 默认演示账号 `test@test.com / 123456` 仅供本地开发，生产请立即修改
- 仓库默认分支：GitHub `main`、Gitee `master`

[Unreleased]: https://github.com/iduyuhe/clmx/compare/v0.1.0...main
[0.1.0]: https://github.com/iduyuhe/clmx/releases/tag/v0.1.0
