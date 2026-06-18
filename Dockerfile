FROM node:24-bookworm-slim AS builder

WORKDIR /app

COPY .npmrc package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json config.yaml ./
COPY src ./src
COPY plumelog-log-query-skill ./plumelog-log-query-skill
COPY README.md ./README.md

RUN npm run build

FROM node:24-bookworm-slim AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config.yaml ./config.yaml

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "const http=require('node:http');const req=http.get('http://127.0.0.1:8787/health',res=>{process.exit(res.statusCode===200?0:1)});req.on('error',()=>process.exit(1));req.setTimeout(2500,()=>{req.destroy();process.exit(1)})"

CMD ["node", "dist/src/index.js"]
