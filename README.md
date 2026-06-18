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

- `search.trackTotalHits` 默认 `false`，ES 不做精确总数统计。响应仍保留 `summary.total` 和 `summary.totalRelation`，并新增 `summary.totalKnown`；当 `totalKnown=false` 时，不应把 `total` 当作精确总数展示。
- 服务端会向 ES 请求 `limit + 1` 条日志，用多出来的一条判断 `summary.hasMore`。返回给调用方的 `rows` 仍最多为 `limit` 条；只有存在下一页时才返回 `summary.nextCursor`。
- `search.sourceFiltering` 默认 `true`，搜索只拉取映射所需字段：时间、应用、环境、级别、traceId、主机、logger、method、thread 和日志正文，用于生成 `contentPreview`。
- 新 cursor 使用 HMAC-SHA256 签名，篡改后会返回 `CURSOR_INVALID`。`cursor.signingSecret` 可显式配置；未配置时会从第一个 API key token 派生签名密钥，密钥不会输出到日志。

可选配置示例：

```yaml
search:
  trackTotalHits: false
  sourceFiltering: true
  tieBreakerField: null
cursor:
  signingSecret: ${PLUMELOG_CURSOR_SECRET}
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

旧配置只需要 `name/token`，默认拥有全部只读 scope。生产环境可按 API key 收紧 scope、app/env、时间范围和 limit。

默认启用日志脱敏，搜索 `contentPreview`、context `content`、boundary `contentPreview` 会遮盖 Authorization/Bearer、Cookie、password/passwd/pwd、secret、token/access_token/refresh_token、JWT、邮箱、手机号、身份证号和银行卡号。审计日志只记录计数与范围，不记录 token 或完整正文。

最小配置：

```yaml
auth:
  apiKeys:
    - name: codex
      token: ${PLUMELOG_GATEWAY_TOKEN}
redaction:
  enabled: true
```

严格配置示例：

```yaml
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
redaction:
  enabled: true
  replacement: "[REDACTED]"
  maxInputChars: 200000
```

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
