# syntax=docker/dockerfile:1

# ====== 阶段 1: 构建前端 ======
FROM node:20-alpine AS builder

WORKDIR /app

# 先拷贝依赖清单，利用 Docker 层缓存
COPY package.json package-lock.json* ./
RUN npm ci

# 拷贝源码并构建（tsc -b && vite build，产物输出到 dist/）
COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
RUN npm run build

# ====== 阶段 2: 运行后端 + 托管静态资源 ======
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787

# 仅安装生产依赖
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# 拷贝后端代码与前端构建产物
COPY server ./server
COPY --from=builder /app/dist ./dist

# .env 在构建时由 docker-compose 注入，不写入镜像
EXPOSE 8787

CMD ["node", "server/index.js"]
