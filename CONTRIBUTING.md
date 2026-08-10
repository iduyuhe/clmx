# 贡献指南 · Contributing to CLMX

感谢你关注并为 **CLMX** 做出贡献！CLMX 是一个面向工业互联网的垂类 AI 模型训练、推理与能力开放平台。我们欢迎各类贡献：缺陷修复、功能建议、文档完善、示例与测试用例。

> 参与之前，请先阅读 [行为准则](./CODE_OF_CONDUCT.md) 与 [安全政策](./SECURITY.md)。

## 一、贡献流程概览

1. **先沟通**：重大改动请先开 Issue 讨论，避免重复劳动。
2. **Fork & 分支**：从 `main`（GitHub）/ `master`（Gitee）切出 `feat/xxx`、`fix/xxx` 分支。
3. **本地开发**：按 [README](./README.md) 的「快速开始」搭好环境。
4. **提交**：遵循 Conventional Commits（见下）。
5. **PR / MR**：填写模板，关联对应 Issue。
6. **CI 通过**：`tsc --noEmit` 与自动化检查须全绿。

## 二、开发规范

- **语言**：TypeScript `strict` 模式；前端 React 19 + Vite，后端 Express 4。
- **后端模块**：新增业务能力放入 `server/src/modules/<name>/`，路由与业务逻辑同文件，统一经 `asyncHandler` 包裹，响应格式 `{ success, data, message }`。
- **前端页面**：放入 `client/src/pages/<name>/`，API 调用统一走 `client/src/api`。
- **多租户（硬性约束）**：所有涉及数据的 CRUD，`where` 条件必须包含 `tenantId: req.tenantId`；子资源须先查父资源校验归属。
- **安全**：密钥只走环境变量（`.env.example` 仅占位），禁止硬编码；涉及鉴权的改动须通过 `authMiddleware` 注入 `req.tenantId / req.userRole`。
- **测试**：核心路径补端到端验证；提交前本地跑通 `tsc --noEmit`。

## 三、提交信息（Conventional Commits）

| 前缀 | 含义 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | Bug 修复 |
| `docs:` | 文档 |
| `refactor:` | 重构（无行为变化） |
| `test:` | 测试 |
| `chore:` | 构建/工程化 |

示例：`feat(ingest): 支持 CSV 样本推断测点类型`

## 四、PR 检查清单

- [ ] 关联了对应 Issue
- [ ] 本地 `tsc --noEmit` 通过
- [ ] 多租户 `tenantId` 过滤已就位
- [ ] 新增接口已补 API 文档/示例
- [ ] 无密钥/敏感信息提交

## 五、许可

贡献即表示你同意以 **MIT 协议** 发布你的贡献（详见 [LICENSE](./LICENSE)）。
