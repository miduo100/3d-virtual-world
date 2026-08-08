FROM node:18-alpine

WORKDIR /app

# 安装运行时依赖
RUN apk add --no-cache tini curl

# 复制依赖文件并安装
COPY package*.json ./
RUN npm install --omit=dev

# 复制全部应用代码和静态资源（包括 uploads）
COPY src/ ./src/
COPY public/ ./public/
COPY database/ ./database/
COPY scripts/ ./scripts/
COPY package.json ./

# 创建上传相关目录并设置权限
RUN mkdir -p uploads && chown -R node:node /app

# 非 root 用户运行
USER node

ENV NODE_ENV=production
ENV PORT=3002
ENV WS_PORT=3001

EXPOSE 3002 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3002/api/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["node", "src/server.js"]
