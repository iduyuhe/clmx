# CLMX 真实客户部署标准作业程序（SOP）

> **版本**: 1.0 | **适用对象**: 实施工程师 / 系统集成商
> **前置**: 客户已提供服务器（物理机/虚拟机/云主机）及网络环境

---

## 一、部署前 Checklist

| # | 项目 | 要求 | 确认 |
|---|------|------|------|
| 1 | 服务器 | 4 核 CPU / 8 GB 内存 / 50 GB 磁盘（最低 2 核 / 2G / 10G） | ☐ |
| 2 | 操作系统 | CentOS 7+ / Ubuntu 20.04+ / OpenCloudOS | ☐ |
| 3 | Node.js | 18+ LTS | ☐ |
| 4 | Python | 3.10+（仅训练节点需要） | ☐ |
| 5 | PostgreSQL | 14+（生产必选；POC 阶段可用 SQLite） | ☐ |
| 6 | Nginx | 1.20+（反代后端 + 静态文件） | ☐ |
| 7 | 网络 | 开放 3003（Web）/ 1883（MQTT）/ 502（Modbus）/ 4840（OPC-UA 可选） | ☐ |
| 8 | 域名（可选） | 客户提供域名并指向服务器 IP | ☐ |

---

## 二、部署步骤

### 2.1 基础环境

```bash
# Node.js 18+
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs  # 或 apt install

# Python 3.10+
yum install -y python3 python3-pip

# PostgreSQL 14+
yum install -y postgresql14-server
systemctl enable postgresql-14
systemctl start postgresql-14

# Nginx
yum install -y nginx
systemctl enable nginx
```

### 2.2 数据库初始化

```bash
# 创建数据库和用户
sudo -u postgres psql -c "CREATE USER clmx WITH PASSWORD 'your_strong_password';"
sudo -u postgres psql -c "CREATE DATABASE clmx OWNER clmx;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE clmx TO clmx;"

# 测试连接
PGPASSWORD='your_strong_password' psql -h 127.0.0.1 -U clmx -d clmx -c '\l'
```

### 2.3 应用部署

```bash
# 获取代码
git clone https://gitee.com/i4hub/clmx.git /opt/clmx
cd /opt/clmx

# 配置环境变量
cp server/.env.example server/.env
# 编辑 .env，填入 DATABASE_URL=postgresql://clmx:password@127.0.0.1:5432/clmx
# 设置 JWT_SECRET（随机 64 位字符串）

# 安装依赖
cd server && npm install
cd ../client && npm install

# 初始化数据库
cd ../server
npx prisma generate
npx prisma db push

# 构建
cd ../client && npm run build
cd ../server && npm run build
```

### 2.4 PM2 启动

```bash
# 安装 PM2
npm install -g pm2

# 启动主服务
pm2 start /opt/clmx/server/ecosystem.config.cjs --only clmx

# 启动 MQTT Broker（如需设备接入）
MODBUS_ENDPOINT=modbus://localhost:502 \
MODBUS_MAP_FILE=/opt/clmx/server/modbus_map.json \
pm2 start /opt/clmx/server/scripts/modbus_ingest.cjs --name clmx-modbus

# 验证
pm2 status
curl http://127.0.0.1:3100/health
```

### 2.5 Nginx 配置

```nginx
server {
    listen 3003;
    server_name _;
    client_max_body_size 50M;

    # 前端静态文件
    root /opt/clmx/client/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # API 反代
    location /api/ {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }
}
```

```bash
nginx -t && systemctl restart nginx
```

---

## 三、验证清单

部署完成后逐项验收：

| # | 验证项 | 命令 | 预期 |
|---|--------|------|------|
| 1 | Web 可访问 | `curl http://<ip>:3003` | HTML（登录页） |
| 2 | API 可用 | `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/api/auth/login -X POST -H 'Content-Type: application/json' -d '{"email":"test@test.com","password":"123456"}'` | 200 |
| 3 | 注册可用 | `curl ... /api/auth/register ...` | 200 + token |
| 4 | 演示数据 | 登录后 → 设置 → 演示数据 → 生成 | 成功 |
| 5 | NLP 训练 | 模型 → 发起训练 → 完成 | accuracy > 0.8 |
| 6 | Modbus 适配器 | `node scripts/modbus_ingest.cjs --selftest` | PASS |
| 7 | MQTT 适配器 | `node scripts/mqtt_ingest.cjs --selftest` | PASS |
| 8 | 静态资源 | `curl -I http://<ip>:3003/assets/index-*.js` | 200 |

---

## 四、客户初始配置

部署完成后需为客户做的配置：

### 4.1 创建管理员账号
```bash
# 注册第一个账号（自动成为 ADMIN）
curl -X POST http://127.0.0.1:3100/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@customer.com","password":"initial123","name":"管理员","companyName":"客户公司","planType":"PRO"}'
```

### 4.2 品牌定制
- 登录后 → 系统设置 → 品牌定制
- 设置公司 Logo、主色调、Favicon
- 若有自定义域名，配置 DNS 并填写

### 4.3 创建子账号
- 系统设置 → 成员管理 → 添加成员
- 按角色分配（管理者/标注员/观察者）

### 4.4 设备接入
参考 `docs/设备接入对接文档.md`，按现场设备支持的协议选择接入方式：

| 协议 | 适用场景 | 接入方式 |
|------|---------|---------|
| Modbus TCP/RTU | PLC、传感器、仪表 | `modbus_ingest.cjs` + 映射文件 |
| MQTT | 物联网网关、边缘采集 | `clmx-mqtt` 自托管 broker |
| HTTP 推送 | 第三方系统、边缘盒子 | `POST /api/ingest/telemetry` |
| OPC-UA | 工厂 SCADA、MES | `clmx-opcua` 适配器 |

---

## 五、运维指南

### 5.1 日常运维

```bash
# 查看状态
pm2 status
pm2 logs clmx --lines 50

# 更新代码
cd /opt/clmx && git pull
cd server && npm install && npm run build
cd ../client && npm install && npm run build
pm2 restart clmx

# 数据库备份
pg_dump -U clmx -h 127.0.0.1 clmx > /backup/clmx-$(date +%Y%m%d).sql

# 日志轮转（PM2 已配置）
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 100M
pm2 set pm2-logrotate:retain 7
```

### 5.2 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| 登录 500 | JWT_SECRET 未配置或 Prisma client 过期 | 检查 .env → `npx prisma generate` |
| 训练一直 QUEUED | Python worker 未就绪 | `python3 --version` 检查，尝试运行 `node scripts/verify_worker.js` |
| 推理 500 / 文本分类失败 | checkpoint 路径不存在 | 检查 `ModelVersion.checkpointPath` 对应的目录是否有 `model_meta.json` |
| Modbus 连不上 | 防火墙 / 设备地址不对 | `telnet <ip> 502` 测试连通性 |
| MQTT 设备不发数据 | topic 格式不对 | 确认设备发布到 `clmx/<tenantId>/<deviceCode>/telemetry` |
| 存储配额耗尽 | 数据点超过套餐上限 | 设置 → 用量与配额 → 变更套餐 升级 |

### 5.3 备份策略

| 内容 | 频率 | 命令 |
|------|------|------|
| PostgreSQL | 每日 | `pg_dump -U clmx clmx > /backup/clmx-daily.sql` |
| 配置文件 | 每次变更 | 备份 `/opt/clmx/server/.env`、`nginx.conf` |
| checkpoints（模型文件） | 每周 | `tar czf /backup/checkpoints-$(date +%Y%m%d).tar.gz /opt/clmx/server/checkpoints/` |

---

## 六、交接物清单

部署完成后交付给客户：

| # | 交接物 | 说明 |
|---|--------|------|
| 1 | 管理后台地址 | `http://<域名或IP>:3003` |
| 2 | 管理员账号 | 邮箱 / 初始密码（首次登录后修改） |
| 3 | 设备接入文档 | `docs/设备接入对接文档.md` |
| 4 | API 访问方式 | REST API `https://<域名>/api/`（通过 API Key 鉴权） |
| 5 | 运维手册 | 本文档第五章 |
| 6 | 技术支持联系方式 | 工业 4.0 产业生态联盟 |

---

> **版本历史**: v1.0 2026-07-15 首次发布
