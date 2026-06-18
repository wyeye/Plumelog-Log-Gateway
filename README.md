# Plumelog Log Gateway

面向 Plumelog `3.5.3` 的只读日志查询网关，用于让 Agent / Coding Agent 通过 HTTP API 或 MCP tool 查询 Elasticsearch 中的 Plumelog 日志。

## 目标

提供稳定、便于 Agent 解析的日志查询层，让 Coding Agent 能够搜索日志、获取上下文、引用排查证据，而不需要直接编写 Elasticsearch DSL 或手写 HTTP 请求。

## 架构

```txt
Agent / Codex Skill
        |
        | MCP / JSON over HTTP
        v
log-gateway HTTP API
        |
        v
Elasticsearch / Plumelog indices
```

## 第一版范围

包含：

- 使用必填 `timeRange` 和必填 `limit` 查询日志。
- 支持按应用、环境、级别、traceId、host、logger、method、内容过滤。
- 按 traceId 或临近时间窗口获取日志上下文。
- 查询应用列表。
- 查询最早 / 最晚命中日志边界。
- Bearer Token / API Key 鉴权。
- stdio MCP server。

不包含：

- Elasticsearch DSL 透传。
- 日志删除或索引管理。
- 保留期管理。

## 接口

- `GET /health`
- `GET /live`
- `GET /ready`
- `GET /api/v1/meta/apps`
- `POST /api/v1/logs/search`
- `POST /api/v1/logs/context`
- `POST /api/v1/logs/boundary`

## 配置示例

最小可启动配置需要包含服务端口、API key、Elasticsearch 地址、Plumelog 索引/字段映射、查询限制和 meta 默认时间范围。未列出的 `search`、`cursor`、`redaction`、`observability`、`meta.appAggSize`、`meta.envAggSize`、`elasticsearch.indexResolveConcurrency` 都有默认值。

```yaml
server:
  port: 8787
auth:
  apiKeys:
    - name: codex
      token: ${PLUMELOG_GATEWAY_TOKEN}
elasticsearch:
  node: http://127.0.0.1:9200
  username: ${ES_USERNAME}
  password: ${ES_PASSWORD}
  tls:
    rejectUnauthorized: true
plumelog:
  indexMode: day
  timezone: Asia/Shanghai
  runIndexPrefix: plume_log_run_
  traceIndexPrefix: plume_log_trace_
  fields:
    time: dtTime
    app: appName
    env: env
    level: logLevel
    message: content
    host: serverName
    traceId: traceId
    logger: className
    method: method
    thread: threadName
    seq: seq
limits:
  maxTimeRangeHours: 24
  maxLimit: 500
  contentPreviewChars: 500
  maxContentTermLength: 200
  maxContentTerms: 20
  contextDefaultWindowSeconds: 300
  contextMaxWindowSeconds: 3600
meta:
  defaultTimeRangeHours: 24
```

生产建议配置显式开启严格只读权限、游标签名、稳定分页 tie-breaker、脱敏、source filtering、ready 超时和慢查询阈值；`allowRawContent` 默认 `false`，只有确需返回未脱敏完整正文的专用 key 才建议单独设为 `true`。`NODE_ENV=production` 或 `runtime.production=true` 时，必须显式配置 `cursor.signingSecret` 和 `search.tieBreakerField`。

```yaml
runtime:
  production: true
auth:
  apiKeys:
    - name: prod-reader
      token: ${PLUMELOG_GATEWAY_TOKEN}
      scopes: ["meta:read", "logs:search", "logs:context", "logs:boundary"]
      allowedApps: ["order-service"]
      allowedEnvs: ["prod"]
      maxTimeRangeHours: 6
      maxLimit: 100
      allowRawContent: false
elasticsearch:
  indexResolveConcurrency: 8
search:
  trackTotalHits: false
  sourceFiltering: true
  tieBreakerField: seq
  tieBreakerType: long
cursor:
  signingSecret: ${PLUMELOG_CURSOR_SECRET}
  ttlSeconds: 3600
  allowUnsignedV1: false
redaction:
  enabled: true
  replacement: "[REDACTED]"
  maxInputChars: 200000
meta:
  appAggSize: 200
  envAggSize: 50
observability:
  slowQueryMs: 1000
  readyTimeoutMs: 1000
```

## 健康检查与可观测性

- `GET /health` 保持兼容，返回 `{ "status": "ok" }`。
- `GET /live` 只检查进程存活，不访问 Elasticsearch。
- `GET /ready` 使用短超时检查 Elasticsearch 可访问性；不可达时返回 `503`，响应包含 `status`、`checks`、`durationMs` 和 `requestId`。
- 请求会优先使用调用方传入的 `x-request-id`，否则生成短随机 ID。错误响应会在顶层和 `error.requestId` 中返回该 ID，响应 header 也会带 `x-request-id`。
- ES 查询会记录 duration；超过 `observability.slowQueryMs` 时输出慢查询日志。日志只包含 requestId、操作名、索引数量、limit 等摘要信息，不包含 token 或完整日志正文。

可选配置示例：

```yaml
observability:
  slowQueryMs: 1000
  readyTimeoutMs: 1000
```

## 搜索性能与分页

搜索接口默认面向大日志量场景优化：

- `search.trackTotalHits` 默认 `false`，ES 不做精确总数统计。响应保留 `summary.total`、`summary.totalRelation` 和 `summary.totalKnown`；当 `totalKnown=false` 时，`total` 为 `null`。
- `search.trackTotalHits=false` 时，`summary.total=null`、`summary.totalKnown=false`，调用方应使用 `summary.returnedCount`、`summary.hasMore` 和 `summary.nextCursor` 展示分页状态。开启精确统计或阈值统计时，`total` 才表示 ES 返回的统计值。
- 服务端会向 ES 请求 `limit + 1` 条日志，用多出来的一条判断 `summary.hasMore`。返回给调用方的 `rows` 仍最多为 `limit` 条，`summary.returnedCount` 等于本页返回行数；`hasMore=true` 表示可继续请求下一页且 `summary.nextCursor` 非空，最后一页 `hasMore=false` 且 `nextCursor=null`。
- `search.sourceFiltering` 默认 `true`，搜索只拉取映射所需字段：时间、应用、环境、级别、traceId、主机、logger、method、thread 和日志正文，用于生成 `contentPreview`。
- 默认排序保留 `time desc` 和 `seq desc`。生产环境必须配置 `search.tieBreakerField`，指向一个唯一、稳定、可排序且有 doc_values 的字段，并用 `search.tieBreakerType` 指明类型：`keyword`、`long` 或 `date`。不要把 `_id` 当作 tie-breaker，除非确认目标 ES 版本和 mapping 支持可靠排序。
- 新 cursor 使用 HMAC-SHA256 签名并包含 `expiresAt`，默认 TTL 为 `cursor.ttlSeconds=3600` 秒；过期、篡改或跨查询复用都会返回 `CURSOR_INVALID`。`cursor.signingSecret` 可显式配置；非生产环境未配置时会从第一个 API key token 派生签名密钥，密钥不会输出到日志。
- 未签名 V1 cursor 默认禁用。仅迁移期可显式设置 `cursor.allowUnsignedV1=true` 临时接受旧 cursor；生产建议保持 `false`。

可选配置示例：

```yaml
search:
  trackTotalHits: false
  sourceFiltering: true
  tieBreakerField: null
  tieBreakerType: keyword
cursor:
  signingSecret: ${PLUMELOG_CURSOR_SECRET}
  ttlSeconds: 3600
  allowUnsignedV1: false
```

## 索引解析与聚合

- `plumelog.indexMode=day` 时按天生成索引 pattern，`hour` 时按小时生成，避免 day 模式跨多天时小时级循环。
- 索引存在性检查保留 `INDEX_NOT_FOUND` warning，但按 `elasticsearch.indexResolveConcurrency` 并发执行，默认 `8`。
- boundary 查询会对候选索引执行一次 `size=1` 搜索，由 ES 排序返回最早或最晚命中。
- `meta.appAggSize` 默认 `200`，`meta.envAggSize` 默认 `50`。聚合被 ES 截断时会返回 `APP_AGG_TRUNCATED` 或 `ENV_AGG_TRUNCATED` warning。

可选配置示例：

```yaml
elasticsearch:
  indexResolveConcurrency: 8
meta:
  appAggSize: 200
  envAggSize: 50
```

## 权限、脱敏与审计

旧配置只需要 `name/token`，默认拥有全部只读 scope：`meta:read`、`logs:search`、`logs:context`、`logs:boundary`。生产环境可按 API key 收紧 scope、app/env、时间范围和 limit。

默认启用日志脱敏，搜索 `contentPreview`、context `content`、boundary `contentPreview` 会遮盖 Authorization/Bearer、Cookie、password/passwd/pwd、secret、token/access_token/refresh_token、JWT、邮箱、手机号、身份证号和银行卡号。审计日志只记录计数与范围，不记录 token 或完整正文。
若 API key 的 `allowRawContent=true`，context 等完整正文映射允许绕过脱敏；该选项应只给受控排障 key 使用，默认不要开启。

`/api/v1/logs/boundary` 示例：

```json
{
  "timeRange": {
    "from": "2026-06-01T00:00:00+08:00",
    "to": "2026-06-30T23:59:59+08:00"
  },
  "filters": {
    "apps": ["order-service"],
    "content": {
      "any": ["timeout"]
    }
  },
  "direction": "earliest"
}
```

## MCP

本项目提供一个很薄的 stdio MCP server，内部调用当前 HTTP 网关。

可用 tools：

- `list_apps`
- `search_logs`
- `get_log_context`
- `find_log_boundary`

本地启动网关：

```bash
rtk npm install
rtk env PLUMELOG_GATEWAY_TOKEN=test ES_USERNAME=elastic ES_PASSWORD=secret npm run dev
```

本地启动 MCP：

```bash
rtk env PLUMELOG_GATEWAY_BASE_URL=http://127.0.0.1:8787 \
  PLUMELOG_GATEWAY_TOKEN=test \
  PLUMELOG_GATEWAY_TIMEOUT_MS=10000 \
  npm run mcp
```

MCP 客户端默认超时为 `10000` ms，可通过 `PLUMELOG_GATEWAY_TIMEOUT_MS` 调整。网络错误以及 HTTP `502/503/504` 会有限重试，最多 3 次请求；超时、非 JSON 响应和网关错误会以结构化 JSON tool error 返回，至少包含 `code`、`message`、`status` 和 `requestId`。

## Docker 构建与运行

推送到 `master` 分支或推送 `v*.*.*` tag 后，GitHub Actions 会自动构建镜像并发布到 GitHub Container Registry：

```txt
ghcr.io/wyeye/plumelog-log-gateway
```

`pull_request` 只执行构建校验，不发布镜像。

构建生产镜像：

```bash
rtk docker build -t plumelog-log-gateway:local .
```

镜像内置 Docker `HEALTHCHECK`，使用 Node.js 请求 `GET /health`，不依赖 curl/wget。运行时仍保持 `USER node`，final image 不包含项目 `.npmrc`。

使用镜像内默认 `config.yaml` 运行：

```bash
rtk docker run --rm -p 8787:8787 \
  -e PLUMELOG_GATEWAY_TOKEN=test \
  -e ES_USERNAME=elastic \
  -e ES_PASSWORD=secret \
  plumelog-log-gateway:local
```

使用外部挂载 `config.yaml` 运行：

```bash
rtk docker run --rm -p 8787:8787 \
  -e PLUMELOG_GATEWAY_TOKEN=test \
  -e ES_USERNAME=elastic \
  -e ES_PASSWORD=secret \
  -e PLUMELOG_CONFIG_PATH=/run/config/plumelog-config.yaml \
  -v /absolute/path/to/config.yaml:/run/config/plumelog-config.yaml:ro \
  plumelog-log-gateway:local
```

健康检查示例：

```bash
rtk python3 - <<'PY'
import json
from urllib.request import urlopen
print(json.load(urlopen('http://127.0.0.1:8787/health')))
PY
```

## 验证

- 使用临时 `python3` 脚本验证 HTTP API 和 MCP。
- 不新增 Node 测试文件。
- 临时验证脚本不得提交。

## 目录

```txt
src/
  auth/
  config/
  es/
  http/
  mcp/
  schema/
  utils/
plumelog-log-query-skill/
  SKILL.md
  references/api.md
```

详细设计与计划文档位于 `docs/superpowers/`，该目录不参与实现提交流程。
