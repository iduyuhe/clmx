# CLMX × HubPort 思想融合规划

> 评估日期：2026-08-07
> 输入：用户询问「HubPort（AI 原生物联网平台）的思想是否应融入 CLMX」
> 范围：**只取思想，不搬产品**。CLMX 仍保持「面向工业互联网的垂类 AI 模型训练与推理平台」边界。

---

## 0. 结论先行（是否需要融入）

**需要融入，但融的是「思想」不是「产品」。**

理由有三：
1. **哲学同构**：HubPort 的内核「创建时 AI 生成、运行时零 AI 依赖」与 CLMX 护城河「零依赖边缘 JS 推理」是同一句话的两面——CLMX 已把它用在「模型」侧，HubPort 把它用在「接入」侧，二者互为印证、可统一为平台级原则。
2. **补两大短板**：CLMX 当前①设备接入仍靠人工配 MQTT 点位/写协议适配；②平台是「封闭工具」，只能被人用、不能被外部 AI 智能体编排调用。HubPort 的「AI 原生接入」和「北向开放为能力底座」恰好补这两块。
3. **不冲突、不超载**：HubPort 的产品广度（680+ 功能、八大模块、全栈 IoT 平台定位）CLMX 不学；CLMX 坚持零依赖边缘 JS 推理，不引入多语言运行时。思想可裁剪吸收。

> 一句话：**CLMX 是 HubPort 想成为的「底层可调用能力」的一部分。** 把 HubPort 的思想融进来，等于让 CLMX 从「被使用的工具」升级为「被编排的能力底座」，生态位上一档。

---

## 1. HubPort 的思想内核（剥离产品后的骨架）

| # | 思想 | 原话提炼 | 本质 |
|---|------|----------|------|
| T1 | **AI 原生接入** | 「接入这件事本身，就是 AI 干的。丢接口文档 + 一句话需求 → 读懂协议→生成物模型→生成驱动→创建连接→自动测试，全程无需懂 Modbus 寄存器/点位表。」核心引擎从「驱动库」变为「驱动生成器」。 | 用**生成**替代**积累**，吃掉长尾协议 |
| T2 | **创建时 AI、运行时零 AI** | 「创建时充分用 AI 智能生成，运行时零 AI 依赖——生成的是确定性脚本，规则引擎纯条件求值，完全离线运行。」 | 既要 AI 效率，又要工业级可靠 |
| T3 | **能力资产化** | 「接入成果自动沉淀为可上线、可治理、可复用、可分发的能力资产。」 | 接入越多，资产越厚，可复用可分发 |
| T4 | **北向开放为能力底座** | 「把异构设备/子系统/平台统一抽象成可调用、可对话、可协同的能力对象；通过原生 MCP/CLI 让 AI 智能体安全调用，内置 Skill 规范确保调用有边界。」 | 让 AI 能「动手」操控物理世界 |

> 方法论红线（HubPort 反复强调）：**「AI 原生 ≠ 平台 + AI 助手」**——不是挂个问答机器人，而是架构层面让 AI 参与链路（接入、生成、处置）。

---

## 2. 对 CLMX 的评估（思想 vs 现状）

| HubPort 思想 | CLMX 现状 | 契合 / 缺口 | 判断 |
|--------------|-----------|-------------|------|
| T1 AI 原生接入 | MQTT/aedes 1883 已常驻、真实设备已接入，但**物模型/点位映射/协议适配仍人工配置** | ❌ 缺口（最大短板） | **融**：新增「接入生成器」 |
| T2 创建时生成 / 运行时零依赖 | 已用于「模型推理」侧（零依赖 JS 推理）；未用于「接入/驱动」侧 | ✅ 高度契合（原则统一） | **融**：把原则推广到接入层 |
| T3 能力资产化 | 已有 `ModelVersion`/`DataVersion` 版本化；但「接入配置」未资产化 | 🟡 部分契合（扩展） | **融**：接入资产纳入资产生命周期 |
| T4 北向开放 MCP | 当前仅「进」（企微接入 GEo adapter），**无「出」北向**；模型/健康分/告警不可被外部 Agent 调用 | ❌ 缺口（生态位升级） | **融**：新增 MCP 北向能力底座 |
| 红线：AI 原生 ≠ 壳 | 半智能体规划已立「参与链路，不挂问答壳」红线 | ✅ 契合 | 沿用，写入本规划 |

**评估结论**：T1、T4 是 CLMX 当前明确缺失的能力维度；T2、T3 是已有能力的「原则统一 + 边界扩展」。四项思想全部可融，且与护城河不冲突。

---

## 3. 融什么 / 不融什么

### ✅ 融入（思想层面）
- **AI 原生接入思想**：文档/描述进 → 自动生成物模型 + 采集驱动 + 自测。
- **创建-运行分离原则**：全平台统一为「创建时可用 AI 生成，运行时确定性、零 LLM 依赖」。
- **北向开放 + 能力资产化思想**：把 CLMX 的模型/推理/健康分/告警封装为可被外部 AI 智能体安全调用的能力资产。

### ❌ 不融入（产品层面）
- **不学产品广度**：HubPort 的 680+ 功能点、八大模块、全栈 IoT 平台定位——CLMX 是「模型工厂」，不是全栈 IoT 平台。
- **不引入多语言运行时**：保持零依赖边缘 JS 推理，不为接入生成引入 Go/Python 常驻运行时（生成的驱动仍是确定性 JS 脚本）。
- **不照搬「受控 CLI 直接给 AI 跑 shell」**：企业场景有安全隐患，CLMX 选更安全的 **MCP 协议** 做北向暴露（思想同源，实现更稳）。

---

## 4. 融合后的战略升级表述

> CLMX 定位升级为：
> **「面向工业互联网的垂类 AI 模型训练、推理与能力开放平台」**
> ——在「模型工厂」内核之上，叠加两条思想线：
> ① **AI 原生接入生成器**（T1+T2，补设备接入短板）
> ② **北向 MCP 能力底座**（T3+T4，补被编排短板）

对外话术补充：「CLMX 既是训练垂类模型的工厂，也是可被 AI 智能体直接调用的工业智能能力底座。」

---

## 5. 分阶段落地规划（接续半智能体规划的阶段 5+）

> 半智能体规划（阶段 0-4）= 平台「内向」智能（感知-决策-处置闭环，已落地）
> 本规划（阶段 5-7）= 平台「外向」能力（接入生成-资产化-北向开放）
> 两者共用「创建时 AI / 运行时零依赖」底座，互补不冲突。

### 阶段 5  AI 原生接入生成器（AI-Native Ingestion）　【增量最大 · 核心 · ✅ 已落地 2026-08-07】
- **新增文件** `server/src/modules/ingest/`：
  - `generator.ts` — 测点提取（优先级：结构化 JSON → 样本数据推断 → 描述启发式词典 → **可选 LLM**）→ 生成物模型 + 零依赖 JS 采集驱动 `collect(ctx)`。
  - `selfTest.ts` — 用 `new Function` 沙箱内执行驱动，验证产出有限数值（运行时零 AI 的闭环验证）。
  - `ingest.generator.routes.ts` — `POST /api/ingest/specs`(建需求)、`/specs/:id/generate`(同步生成+自测)、`/specs/:id/generate/stream`(**SSE 流式**，?token= 鉴权)、`/assets/:id/selftest`、`/assets/:id/run`(运行时零 AI 执行驱动，可选写 SensorData)。
  - 与既有遥测端点 `ingest.routes.ts`(/telemetry) 共存于 `/api/ingest`，互不冲突。
- **零 LLM 运行验证**：默认关闭 LLM（缺省走规则/启发式/样本），CLMX 100% 零依赖运行；LLM 仅「生成时」可选参与（env 门控 `CLMX_LLM_*`），不进运行时。
- **e2e 验证**：提交描述「空压机含温度/压力/振动」→ 启发式提取 3 测点 → 自测通过 → 生成驱动 → 运行写入 SensorData，全绿。
- **与既有融合**：生成驱动纯 JS，可直接喂给已上线的 MQTT/HTTP 摄入链路与 SensorData，不另起炉灶。

### 阶段 6  北向开放：MCP 能力底座（MCP Outbound）　【风险最低 · 先启动 · ✅ 已落地 2026-08-07】
- **落地文件** `server/src/modules/mcp/`：
  - `client.ts` — 封装对主服务的 HTTP 调用；支持 `CLMX_API_TOKEN` 直传，或 `CLMX_API_EMAIL/PASSWORD` 启动时自动登录兜底；统一把 `{success,data,message}` 归一成文本。
  - `tools.ts` — 定义 **10 个 MCP 工具**（纯封装既有 REST API，不引入新业务逻辑）。
  - `mcp.server.ts` — stdio 入口。**不引入官方 MCP SDK**，自实现 JSON-RPC 2.0 over NDJSON（仅 4 个方法：initialize / tools/list / tools/call / ping），契合「零依赖」护城河；日志走 stderr 不污染协议流。
- **零依赖决策**：MCP SDK 会带来额外依赖与版本约束；MCP 协议本质是 JSON-RPC，自实现更轻、可控、与边缘零依赖底座一致。
- **10 个工具清单**（名称 / 映射 API / 权限）：
  1. `clmx_nl_command` — POST /api/nl-command（自然语言总入口）
  2. `clmx_list_devices` — GET /api/devices（只读）
  3. `clmx_device_detail` — GET /api/devices/:id（只读）
  4. `clmx_health_dashboard` — GET /api/health/dashboard（只读）
  5. `clmx_calculate_health` — POST /api/health/device/:id/calculate（需 MANAGER，可能自动建工单）
  6. `clmx_list_training` — GET /api/training（只读）
  7. `clmx_trigger_training` — POST /api/training（需 MANAGER）
  8. `clmx_run_inference` — POST /api/inference/predict（需 MANAGER）
  9. `clmx_keywords` — POST /api/inference/keywords（只读，纯 JS）
  10. `clmx_list_alert_rules` — GET /api/health/rules（只读）
- **认证与边界（呼应 HubPort「调用有边界」）**：每个工具 description 标注 `[只读]` / `[需MANAGER权限]`；真实权限 = 传入 JWT 的角色，由主服务 `authMiddleware` 强制，越权返回 403。MCP 层只是「传递令牌」，不绕权。
- **启动方式**：`npm run mcp`（即 `tsx src/modules/mcp/mcp.server.ts`）。MCP 客户端（Claude Desktop / 任意 MCP 客户端）配置示例：
  ```json
  {
    "mcpServers": {
      "clmx": {
        "command": "npx",
        "args": ["tsx", "/绝对路径/clmx/server/src/modules/mcp/mcp.server.ts"],
        "env": { "CLMX_API_URL": "http://localhost:3100", "CLMX_API_TOKEN": "<登录后JWT>" }
      }
    }
  }
  ```
  或不传 token，改用 `CLMX_API_EMAIL` / `CLMX_API_PASSWORD` 自动登录。
- **验证结论**：`tsc --noEmit` 0 错误；stdio 协议层冒烟通过（initialize 握手 + tools/list 返回 10 工具结构正确）；tools/call 在主服务离线/令牌无效时返回 `isError:true` 友好文本，不崩溃。
- **价值**：CLMX 从「被使用」→「被编排」；可对接企微机器人、HubPort 类平台、任意 MCP 客户端。

### 阶段 7  能力资产化治理（Asset Lifecycle）　【收口 · ✅ 已落地 2026-08-07】
- **数据模型** `IngestSpec`(接入需求) + `IngestAsset`(版本化接入资产：物模型/驱动代码/自测结果/发布复用计数)，复用既有 `ModelVersion` 版本链思想（`@@unique([specId, version])`）。
- **资产市场 + 复用闭环**：`POST /api/ingest/assets/:id/publish` 进入市场（跨租户可见）；`GET /api/ingest/assets?marketplace=1` 列市场资产；`POST /api/ingest/assets/:id/apply` **一键复用他人已验证资产**——自动在目标设备创建传感器（`reuseCount` 计数度量资产厚度，呼应 T3「接入越多资产越厚」）。
- **权限边界**：写操作（发布/下线/复用）需 `MANAGER`；查询走租户隔离 `tenantId` + 公共资产 `OR tenantId:null`。
- **e2e 验证**：发布 → 市场可见(1 条) → 应用到设备自动建 3 传感器 → 运行驱动写 3 条 SensorData，全绿。
- 前端 `pages/ingest/IngestLibraryPage.tsx`：「我的接入」/「资产市场」双 Tab，覆盖创建→生成→自测→发布→复用→运行全流程；侧边栏新增「接入生成器」。

### 🚫 红线（方法论约束，写入所有新增 AI 能力评审）
1. 所有新增 AI 能力必须「参与链路」，不许「只挂问答壳」。
2. LLM **永不下沉到运行时推理/执行**——创建时可用，运行时必须确定性、零依赖。

---

## 6. 建议启动顺序与风险

| 顺序 | 阶段 | 理由 | 主要风险 | 缓释 |
|------|------|------|----------|------|
| 1 | **阶段 6 MCP 北向** | 纯封装既有能力，风险最低，立刻有生态位价值 | 认证边界设计不当导致越权 | 租户令牌 + tool 级权限声明，先只读后写 |
| 2 | **阶段 5 接入生成器** | 最大增量，需引入可选 LLM 接入层 | LLM 隐私/成本/偶发生成错误 | 仅生成时调用、可关闭、可自托管；生成产物必须过冒烟测试才上线 |
| 3 | **阶段 7 资产化治理** | 依赖前两项沉淀的资产 | 资产版本混乱 | 复用既有版本化模式 |

> 阶段 5 的 LLM 接入层**是可选模块**：默认关闭时，CLMX 仍 100% 零依赖运行（人工配接入）；开启后仅增强「创建时」体验，不影响运行时护城河。

---

## 7. 与半智能体规划的关系图

```
CLMX 内核（模型工厂 / 零依赖边缘 JS 推理）
        │
        ├── 内向智能（半智能体规划 阶段0-4，已落地）
        │     自动基线 → 自动处置闭环 → NL入口 → 训练解读
        │
        └── 外向能力（本规划 阶段5-7，待启动）
              阶段5 AI原生接入生成器  →  阶段7 能力资产化
                                   ↘  阶段6 北向 MCP 能力底座
        │
        └── 统一底座原则：创建时 AI 生成 / 运行时零依赖（T2，贯穿内外）
```

> 一句话收口：**HubPort 教会我们两件事——让接入也「生成化」、让平台也「可被调用」。CLMX 不学它的体量，但把这两点变成自己的下一程。**
