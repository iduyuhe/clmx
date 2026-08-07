# ====================================
# CLMX Server — 多阶段构建
# ====================================

# ── 阶段 1: 安装依赖 + 构建 ──
FROM node:22-alpine AS builder
WORKDIR /app

# Prisma 需要这些编译原生模块
RUN apk add --no-cache openssl

COPY package.json package-lock.json* ./
RUN npm ci

COPY prisma/ ./prisma/
RUN npx prisma generate

COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── 阶段 2: 生产运行 ──
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache openssl

# 创建非 root 用户
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json* ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

RUN mkdir -p uploads checkpoints logs && \
    chown -R nodejs:nodejs uploads checkpoints logs

USER nodejs
EXPOSE 3002

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3002/api/health',r=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "dist/server.js"]
