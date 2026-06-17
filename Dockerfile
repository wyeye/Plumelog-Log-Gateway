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

COPY .npmrc package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/config.yaml ./config.yaml

USER node

EXPOSE 8787

CMD ["node", "dist/src/index.js"]
