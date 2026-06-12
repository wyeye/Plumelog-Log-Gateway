# Plumelog Log Gateway

面向 Plumelog `3.5.3` 的只读日志查询网关设计，用于让 Agent / Coding Agent 通过 HTTP API 查询 Elasticsearch 中的 Plumelog 日志。

## 目标

提供稳定、便于 Agent 解析的日志查询层，让 Coding Agent 能够搜索日志、获取上下文、引用排查证据，而不需要直接编写 Elasticsearch DSL。

## 架构

```txt
Agent / Codex Skill
        |
        | JSON over HTTP
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
- 健康检查。
- Bearer Token / API Key 鉴权。

不包含：

- MCP server。
- Elasticsearch DSL 透传。
- 日志删除或索引管理。
- 保留期管理。
- 脱敏。

## 查询规则

- `timeRange.from`、`timeRange.to`、`limit` 必填。
- `timeRange` 必须是带时区的 ISO 8601 字符串。
- `limit` 范围为 `1-500`。
- 同一字段数组内部按 OR 查询。
- 不同字段之间按 AND 查询。
- `filters.content.all` 表示内容必须全部命中。
- `filters.content.any` 表示内容命中任意一个即可。
- `filters.content.not` 表示排除命中的内容。
- 内容条件单项长度默认最大 `200` 字符，总数默认最大 `20`。
- 空数组按未提供处理。
- 不支持传入 Elasticsearch DSL。

## 搜索请求示例

```json
{
  "timeRange": {
    "from": "2026-06-12T10:00:00+08:00",
    "to": "2026-06-12T10:15:00+08:00"
  },
  "limit": 500,
  "filters": {
    "apps": ["order-service"],
    "envs": ["prod"],
    "levels": ["ERROR", "WARN"],
    "traceIds": ["abc"],
    "hosts": ["10.0.1.2"],
    "loggers": ["com.demo.OrderService"],
    "methods": ["createOrder"],
    "content": {
      "all": ["订单创建失败", "timeout"],
      "any": ["NullPointerException", "SocketTimeoutException"],
      "not": ["healthcheck"]
    }
  },
  "cursor": null
}
```

## 搜索响应结构

搜索结果使用表格型 JSON，以减少 token：

```json
{
  "schema": "plumelog.search.v1",
  "summary": {
    "total": 120,
    "totalRelation": "gte",
    "hasMore": true,
    "nextCursor": "base64-json"
  },
  "columns": ["index", "id", "timestamp", "app", "env", "level", "traceId", "host", "logger", "method", "contentPreview", "contentTruncated"],
  "rows": [],
  "warnings": []
}
```

## 上下文响应结构

上下文查询策略：

1. 先定位中心日志。
2. 若中心日志有 `traceId`，优先按同一 `traceId` 获取链路日志。
3. 若没有 `traceId`，按 `app + host + timeWindow` 获取前后文。

上下文请求至少提供 `center` 或 `traceId`；推荐使用搜索结果中的 `index + id` 定位中心日志。`limit` 控制返回日志总数，不包含 `center`。

```json
{
  "timeRange": {
    "from": "2026-06-12T10:00:00+08:00",
    "to": "2026-06-12T10:15:00+08:00"
  },
  "limit": 200,
  "center": {
    "index": "plume_log_run_20260612",
    "id": "es-id"
  },
  "traceId": null,
  "context": {
    "timeWindowSeconds": 300
  }
}
```

上下文结果使用对象型 JSON：

```json
{
  "schema": "plumelog.context.v1",
  "center": {},
  "traceLogs": [],
  "nearbyLogs": [],
  "resolution": {
    "mode": "traceId",
    "reason": "center log has traceId"
  },
  "warnings": []
}
```

## 规划接口

- `GET /health`
- `GET /api/v1/meta/apps`
- `POST /api/v1/logs/search`
- `POST /api/v1/logs/context`

## ES 查询策略

- 时间范围使用 `dtTime` range。
- 索引按 `timeRange` 推导。
- 查询前使用 `HEAD /{index}` 或 `_cat/indices` 过滤不存在的索引。
- 默认兼容 Plumelog `day` 与 `hour` 索引模式。
- 运行日志索引默认前缀：`plume_log_run_`。
- 链路日志索引默认前缀：`plume_log_trace_`。
- 分页使用 `search_after`，不使用深分页。
- 排序：`dtTime desc`、`seq desc`。
- 旧索引没有 `seq` 时自动重试 `dtTime desc`，并返回 warning。
- 不默认按 `_id` 排序，避免 ES 7.x 兼容和内存风险。
- 上下文按时间升序返回。

## 错误处理

统一错误结构：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "request is invalid",
    "details": {}
  }
}
```

常见错误码：

- `UNAUTHORIZED`
- `INVALID_REQUEST`
- `INVALID_TIME_RANGE`
- `LIMIT_OUT_OF_RANGE`
- `TIME_RANGE_TOO_LARGE`
- `ES_QUERY_FAILED`
- `CONTENT_TERM_TOO_LONG`
- `CURSOR_INVALID`
- `CENTER_LOG_NOT_FOUND`
- `INDEX_NOT_FOUND`

## 限制

- 最大时间跨度默认 `24h`。
- `limit` 最大 `500`。
- 内容条件长度需要限制，防止超大查询。
- API 返回 `warnings` 表示截断、部分索引缺失、部分分片失败。

## 规划技术栈

- Node.js + TypeScript
- Fastify
- Zod
- `@elastic/elasticsearch@7`
- YAML 配置
- Bearer Token / API Key 鉴权

## 说明

详细设计文档目前存放在 `docs/superpowers/specs/`。该目录属于规划材料，提交时不要包含。
