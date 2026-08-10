# CLMX — 面向工业互联网的垂类 AI 模型训练、推理与能力开放平台

一个全栈 AI 模型生命周期管理平台，覆盖从数据准备、模型训练、评估到推理部署的完整工作流。融合**半智能体闭环**、**AI 原生接入生成器**与**北向 MCP 能力开放**，支持本地 CPU 开发调试、远端 GPU 生产部署的统一架构。

## 架构

```
┌──────────────────────────────────────────────────────┐
│                    CLMX Platform                     │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐                  │
│  │   Client     │  │   Server     │                  │
│  │  (React 19)  │──│ (Express 4)  │                  │
│  │  Vite + TS   │  │  Prisma ORM  │                  │
│  │  Nginx 部署   │  │  JWT + RBAC  │                  │
│  └──────────────┘  └──────┬───────┘                  │
│                           │                           │
│              ┌────────────┼────────────┐              │
│              ▼            ▼            ▼              │
│        ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│        │PostgreSQL│ │ Python   │ │Transform- │        │
│        │  数据库   │ │ Worker   │ │ ers.js   │        │
│        │          │ │(PyTorch) │ │ 推理引擎  │        │
│        └──────────┘ └──────────┘ └──────────┘        │
│                                                      │
│              (可选) 远端 GPU 服务器                    │
│              ┌──────────────────┐                     │
│              │ GPU Training     │                     │
│              │ GPU Inference    │                     │
│              └──────────────────┘                     │
└──────────────────────────────────────────────────────┘
```

## 技术栈

| 层 | 技术 | 说明 |
|---|------|------|
| **前端** | React 19 + TypeScript + Vite | SPA，shadcn/ui + Tailwind CSS |
| **后端** | Express 4 + TypeScript | REST API，58 个端点 |
| **ORM** | Prisma 5 | 16 个数据模型，PostgreSQL/SQLite |
| **认证** | JWT + bcrypt + RBAC | admin / member 角色 |
| **AI 训练** | Python + PyTorch | 独立 Worker 进程，CPU/GPU 自适应 |
| **AI 推理** | Transformers.js (HuggingFace) | CPU 推理 + 远端 GPU 转发 |
| **安全** | Helmet + Rate Limit + 审计日志 | 全链路防护 |
| **日志** | Winston + Morgan | 结构化日志 + 文件持久化 |
| **部署** | Docker + Docker Compose | 多阶段构建，Nginx 静态服务 |

## 核心特性

- **垂类 AI 模型工厂**：从数据、训练、评估到推理部署的完整生命周期；零依赖边缘 JS 推理（无需深度学习框架）。
- **半智能体闭环**：自然语言交互入口、自动基线/告警阈值、异常自动处置工单、训练结果自动解读——感知 → 决策 → 处置。
- **AI 原生接入生成器**：文档/描述/样本 → 自动提取测点 → 生成物模型 + 零依赖 JS 采集驱动；运行时零 AI，并可直接复用他人已验证的接入资产。
- **北向 MCP 能力开放**：内置零依赖 MCP stdio Server（10 个工具），平台可被任意外部 AI 智能体安全编排。
- **多租户 SaaS**：行级数据隔离 + 配额/计费/白标，企业可自托管或托管。

## 快速开始

### 前置要求

- Node.js >= 22
- Python >= 3.12（训练 Worker 需要）
- Docker & Docker Compose（数据库 + 部署）

### 本地开发

```bash
# 1. 克隆项目
git clone <repo-url> clmx && cd clmx

# 2. 启动数据库（PostgreSQL）
docker-compose up -d postgres

# 3. 配置环境变量
cp server/.env.example server/.env
# 编辑 server/.env，填入实际值

# 4. 安装依赖 + 初始化数据库
cd server
npm install
npx prisma db push
cd ..

# 5. 启动后端（需保持运行）
cd server
npm run dev
# → http://localhost:3002

# 6. 新终端，启动前端
cd client
npm install
npm run dev
# → http://localhost:5173
```

### Docker 部署

```bash
# 配置环境变量
cp .env.docker .env.docker.local
# 编辑 .env.docker.local，填入实际密码

# 构建 + 启动全部服务
docker-compose --profile full up --build -d

# 访问
# 前端: http://localhost
# API: http://localhost:3002/api/health
```

## 目录结构

```
clmx/
├── client/                     # React 前端
│   ├── src/
│   │   ├── api/                # API 客户端（axios）
│   │   ├── components/         # 共享组件（SearchFilterBar, ErrorBoundary 等）
│   │   │   └── ui/             # shadcn/ui 组件（47 个）
│   │   ├── pages/              # 页面组件
│   │   │   ├── auth/           # 登录/注册
│   │   │   ├── dashboard/      # 仪表盘
│   │   │   ├── datasets/       # 数据集管理 + 标注
│   │   │   ├── deployments/    # 部署管理
│   │   │   ├── industries/     # 行业场景
│   │   │   ├── models/         # 模型管理 + 训练 + 版本
│   │   │   ├── settings/       # 设置（品牌/成员/审计）
│   │   │   └── training/       # 训练任务
│   │   ├── router/             # 路由配置
│   │   ├── stores/             # Zustand 状态管理
│   │   └── types/              # TypeScript 类型
│   ├── Dockerfile
│   └── .dockerignore
├── server/                     # Express 后端
│   ├── src/
│   │   ├── modules/
│   │   │   ├── annotation/     # 数据标注
│   │   │   ├── audit/          # 审计日志（中间件 + 服务）
│   │   │   ├── auth/           # 认证（JWT + bcrypt）
│   │   │   ├── dashboard/      # 仪表盘聚合
│   │   │   ├── dataset/        # 数据集管理
│   │   │   ├── deployment/     # 部署 + API Key
│   │   │   ├── industry/       # 行业场景
│   │   │   ├── inference/      # 推理引擎（Transformers.js）
│   │   │   ├── model/          # 模型管理
│   │   │   ├── settings/       # 租户配置
│   │   │   ├── training/       # 训练管理（Python Worker）
│   │   │   └── users/          # 用户 CRUD
│   │   ├── middleware/         # auth / rateLimiter
│   │   ├── worker/             # Python 训练脚本
│   │   └── utils/              # config / fileParser / logger / json
│   ├── prisma/
│   │   └── schema.prisma       # 16 个数据模型
│   ├── Dockerfile
│   └── .dockerignore
├── docker-compose.yml          # 容器编排
├── .env.docker                 # Docker 环境变量模板
├── .gitignore
└── README.md
```

## API 概览

| 模块 | 路径 | 端点数 | 说明 |
|------|------|--------|------|
| Auth | `/api/auth` | 4 | 注册/登录/JWT/修改密码 |
| Users | `/api/users` | 5 | 用户 CRUD（admin） |
| Dashboard | `/api/dashboard` | 1 | 聚合统计 + 趋势 |
| Industries | `/api/industries` | 8 | 行业 CRUD + 场景嵌套 |
| Datasets | `/api/datasets` | 6 | 数据集管理 + 上传 + 预览 |
| Annotation | `/api/datasets/:id/annotations` | 4 | 标注 CRUD + 进度 |
| Models | `/api/models` | 5 | 模型 CRUD + 版本 |
| Training | `/api/training` | 6 | 训练全生命周期 + SSE 进度 |
| Deployments | `/api/deployments` | 8 | 部署 + API Key + 测试 |
| Inference | `/api/inference` | 5 | 推理 + 批量预测 |
| Settings | `/api/settings` | 6 | 租户/品牌/成员/审计 |
| **合计** | | **58** | |

| Ingest | `/api/ingest` | 10+ | AI 原生接入生成器（规格/生成/自测/资产/复用） |
| MCP | stdio | 10 | 北向能力开放（外部 AI 可调用，非 HTTP） |

## 部署到远端 GPU

本平台设计为「本地 CPU 开发 → 远端 GPU 部署」统一架构：

```bash
# 1. 将训练代码复制到 GPU 服务器
scp server/src/worker/train_worker.py gpu-server:/app/

# 2. GPU 服务器上安装 PyTorch CUDA 版
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# 3. 启动 Worker HTTP 服务（或用 CLI 模式）
python train_worker.py  # 通过 stdin/stdout 通信

# 4. 本地 Server 配置远端 Worker
# server/.env:
REMOTE_TRAINING_URL=http://gpu-server:3003
REMOTE_INFERENCE_URL=http://gpu-server:3004
```

## 安全清单

- [x] JWT 认证 + 角色权限（admin/member）
- [x] bcrypt 密码哈希
- [x] Helmet 安全头（CSP, X-Frame-Options...）
- [x] Rate Limiting（auth 15min/20, api 1min/200）
- [x] 全链路审计日志（自动写入 IP/UA）
- [x] Zod 输入校验（前后端统一）
- [ ] HTTPS/TLS（生产环境需配置反向代理）
- [ ] JWT_SECRET 环境变量注入（非 .env 文件）

## License

本项目基于 **MIT 协议**开源，详见 [LICENSE](./LICENSE) 文件。

> ⚠️ 默认演示管理员账号 `test@test.com / 123456` 仅供本地开发使用，生产部署请立即修改密码并配置强 `JWT_SECRET`。
