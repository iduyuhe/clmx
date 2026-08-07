#!/bin/bash
# CLMX 一键部署脚本 — 在腾讯云 CVM 上运行
# 用法: bash /tmp/clmx-deploy/run.sh

set -e

APP_DIR="/opt/clmx"
SRC_DIR="/tmp/clmx-deploy"

echo "========================================"
echo "  CLMX 系统部署"
echo "========================================"

# 1. 停止旧服务
if pm2 list 2>/dev/null | grep -q clmx; then
  echo "[1/5] 停止旧服务..."
  pm2 delete clmx
fi

# 2. 复制代码
echo "[2/5] 部署代码到 ${APP_DIR}..."
mkdir -p ${APP_DIR}
# 复制后端
cp -r ${SRC_DIR}/server/dist ${APP_DIR}/server/ 2>/dev/null || true
cp -r ${SRC_DIR}/server/prisma ${APP_DIR}/server/ 2>/dev/null || true
cp ${SRC_DIR}/server/package.json ${APP_DIR}/server/ 2>/dev/null || true
cp ${SRC_DIR}/server/package-lock.json ${APP_DIR}/server/ 2>/dev/null || true
# 复制前端
rm -rf ${APP_DIR}/client/dist 2>/dev/null || true
mkdir -p ${APP_DIR}/client
cp -r ${SRC_DIR}/client/dist ${APP_DIR}/client/ 2>/dev/null || true

echo "  文件结构:"
ls -la ${APP_DIR}/server/dist/server.js && echo "  ✅ 后端" || echo "  ❌ 缺少后端"
ls -d ${APP_DIR}/client/dist/index.html && echo "  ✅ 前端" || echo "  ❌ 缺少前端"

# 3. 安装依赖（包含开发依赖以支持 prisma/tsx 种子数据）
echo "[3/6] 安装依赖..."
cd ${APP_DIR}/server
npm install 2>&1 | tail -3

# 4. 初始化数据库
echo "[4/6] 初始化数据库..."
npx prisma generate 2>&1 | tail -3
npx prisma db push --skip-generate 2>&1 | tail -5

# 5. 种子数据
echo "[5/6] 种子数据（行业 & 场景）..."
npx tsx prisma/seed-industry.ts 2>&1 || echo "  种子数据已存在，跳过"

# 6. 启动服务
echo "[6/6] 启动服务..."
cat > ${APP_DIR}/server/.env <<EOF
PORT=3002
NODE_ENV=production
DATABASE_URL=file:${APP_DIR}/server/prisma/dev.db
JWT_SECRET=clmx-prod-$(date +%s)-$(head -c 16 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9')
JWT_EXPIRES_IN=7d
UPLOAD_DIR=./uploads
EOF

# 开放防火墙端口
iptables -C INPUT -p tcp --dport 3002 -j ACCEPT 2>/dev/null || iptables -I INPUT -p tcp --dport 3002 -j ACCEPT
iptables-save > /etc/sysconfig/iptables 2>/dev/null || true

pm2 start dist/server.js \
  --name clmx \
  --cwd ${APP_DIR}/server \
  --time \
  --max-memory-restart 500M \
  --env production

pm2 save

# 7. 配置 nginx 反向代理 (443 -> 3002)
echo ""
echo "[7/7] 配置 nginx 反向代理..."
cat > /etc/nginx/conf.d/clmx.conf <<NGINX_EOF
server {
    listen 443;
    server_name _;

    add_header Cache-Control "no-store, no-cache, must-revalidate" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;

    location / {
        root ${APP_DIR}/client/dist;
        index index.html;
        try_files \$uri \$uri/ /index.html;
    }

    location /assets/ {
        root ${APP_DIR}/client/dist;
        expires 1y;
        add_header Cache-Control "public, immutable" always;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_cache_bypass \$http_upgrade;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
NGINX_EOF

# Reload nginx or start if not running
nginx -t && (systemctl reload nginx 2>/dev/null || systemctl start nginx) && systemctl enable nginx
echo "  nginx 配置完成"

echo ""
echo "========================================"
echo "  部署完成!"
echo "  访问地址: http://43.153.172.52:443"
echo ""
echo "  管理命令:"
echo "    pm2 status       — 查看状态"
echo "    pm2 logs clmx    — 查看日志"
echo "    pm2 restart clmx — 重启"
echo "========================================"
