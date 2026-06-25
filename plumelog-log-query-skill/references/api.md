# API Reference

## Authentication

发送以下任一鉴权头：

- `Authorization: Bearer <token>`
- `X-API-Key: <token>`

API key 可配置 scope、allowedApps、allowedEnvs、maxTimeRangeHours 和 maxLimit。旧 `name/token` 配置默认拥有全部只读 scope。

## Endpoints

- `GET /health`
- `GET /live`
- `GET /ready`
- `GET /api/v1/meta/apps`
- `POST /api/v1/logs/search`
- `POST /api/v1/logs/context`
- `POST /api/v1/logs/boundary`

## Health and Request IDs

- `/health` 保持兼容，返回 `{ "status": "ok" }`。
- `/live` 只检查进程存活。
- `/ready` 检查 Elasticsearch 可访问性；不可达时返回 `503`，响应包含 `status`、`checks`、`durationMs`、`requestId`。
- 调用方可传 `x-request-id`；响应 header、错误响应和审计日志会使用该 ID。未传时网关生成短随机 ID。

## Search Constraints

- `timeRange.from`、`timeRange.to`、`limit` 必填。
- `limit` 范围为 `1-500`，并受服务端配置上限控制。
- `contentMode` 可选：`preview | full`。默认 `preview` 返回 `contentPreview + contentTruncated`；显式 `full` 返回 `content` 列。
- API key 的 `logs:search` scope、app/env、timeRange、limit 限制会在请求解析后执行。
- 同字段数组内部按 OR，不同字段之间按 AND。
- `content.all` 表示全部命中，`content.any` 表示任一命中，`content.not` 表示排除命中。
- 服务端用 `limit + 1` 条 ES 结果判断是否有下一页；响应 `rows` 仍最多返回 `limit` 条。
- 默认 `search.trackTotalHits=false`，响应 `summary.totalKnown=false` 时，`summary.total=null`，不要展示成精确总数。
- `summary.returnedCount` 是本页实际返回行数；分页状态以 `hasMore` 和 `nextCursor` 为准。
- 搜索默认启用 `_source.includes`，只拉取生成响应所需字段。
- `summary.nextCursor` 使用带 TTL 的签名 cursor；篡改、过期或跨查询复用会返回 `CURSOR_INVALID`。
- cursor 绑定 timeRange、filters、limit、contentMode、sortMode、tieBreakerField 和 tieBreakerType；不要跨查询复用或手工修改。
- 未签名 V1 cursor 默认禁用；只有服务端显式 `cursor.allowUnsignedV1=true` 时才会临时接受。
- 生产环境要求显式 `cursor.signingSecret` 和唯一稳定的 `search.tieBreakerField`；`search.tieBreakerType` 取值为 `keyword | long | date`。

## MCP Tools

- `list_apps`
- `search_logs`
- `search_logs_all_pages`
- `search_logs_auto`
- `export_logs_csv`
- `get_log_context`
- `find_log_boundary`

聚合工具约束：

- `search_logs_all_pages`：自动持续追 `nextCursor`，直到取完所有分页，或命中 `maxPages` / `maxRows`。
- `search_logs_auto`：遇到 `GATEWAY_TIMEOUT`、`ES_TIMEOUT`、`INDEX_RESOLVE_TIMEOUT` 时，会优先自动二分时间窗，再在每个切片内自动翻页。
- `export_logs_csv`：复用 `search_logs_auto` 的自动切片和自动翻页能力，并把聚合结果写到 `outputPath` 或系统临时目录。
- `search_logs` 和以上聚合工具都支持 `contentMode`。
- `search_logs_auto` 和 `export_logs_csv` 不接受 `cursor`；它们始终从第一页开始，并自行处理分页。

## Boundary Constraints

- `timeRange.from`、`timeRange.to`、`direction` 必填。
- API key 需要 `logs:boundary` scope。
- `direction` 取值：`earliest | latest`。
- boundary 独立支持最长 31 天。
- boundary 对候选索引执行一次 `size=1` 搜索，并按方向排序返回命中。
- 无命中返回 `200` 与 `record: null`。

## Meta Apps Constraints

- API key 需要 `meta:read` scope。
- `meta.appAggSize` 控制 app 聚合 size，默认 `200`。
- `meta.envAggSize` 控制每个 app 下 env 聚合 size，默认 `50`。
- 聚合可能被截断时，响应 `warnings` 会包含 `APP_AGG_TRUNCATED` 或 `ENV_AGG_TRUNCATED`。

## Response Shapes

- 搜索结果返回 `columns` + `rows`。
- 搜索摘要包含 `total`、`totalRelation`、`totalKnown`、`returnedCount`、`hasMore`、`nextCursor`。
- `hasMore=true` 表示可用 `nextCursor` 继续翻页；最后一页 `hasMore=false` 且 `nextCursor=null`。
- 聚合 MCP 工具返回 `plumelog.search.aggregated.v1`，包含 `partialResult`、`warnings`、`failures`、`diagnostics`。
- CSV 导出 MCP 工具返回 `plumelog.export.csv.v1`，包含 `filePath`、`rowCount`、`partialResult`、`warnings`、`failures`、`diagnostics`。
- 上下文结果返回 `center`、`traceLogs`、`nearbyLogs`、`resolution`。
- 边界结果返回 `record` 对象或 `null`。
- 错误统一返回 `error.code`、`error.message`、`error.details`。
- HTTP 错误响应还包含顶层 `requestId` 和 `error.requestId`。
- 无 token/错误 token 返回 HTTP `401` 且 `error.code=UNAUTHORIZED`；scope 或 API key policy 不允许返回 HTTP `403` 且 `error.code=POLICY_REJECTED`。
- 日志正文返回原始内容，不做脱敏处理。

## MCP Error Shape

MCP tool 调用失败时返回 `isError=true`，文本内容是结构化 JSON：

```json
{
  "code": "GATEWAY_TIMEOUT",
  "message": "gateway request timed out",
  "status": 0,
  "requestId": "abc123def4567890",
  "details": {}
}
```

- `status=0` 表示客户端侧网络错误或超时，没有 HTTP 状态码。
- 非 JSON 网关响应会返回 `GATEWAY_NON_JSON_RESPONSE`，`details.bodyPreview` 最多包含前 500 字符。
- MCP 客户端默认超时 `30000` ms，可通过 `PLUMELOG_GATEWAY_TIMEOUT_MS` 设置；网络错误和 HTTP `502/503/504` 最多尝试 3 次。

## Common Error Codes

- `GATEWAY_TIMEOUT`：MCP 到网关的 HTTP 请求超时。
- `ES_TIMEOUT`：网关到 Elasticsearch 的主查询超时。
- `INDEX_RESOLVE_TIMEOUT`：索引解析阶段超时。
- `CURSOR_INVALID`：cursor 无效、过期、被篡改或与当前查询不匹配。
- `POLICY_REJECTED`：API key 的 scope、timeRange、limit、allowedApps、allowedEnvs 等策略限制命中。
- `ES_REJECTED`：Elasticsearch 明确拒绝查询。

常见诊断字段：

- `details.phase`：失败阶段，例如 `index_resolve`、`search_logs`、`search_boundary`、`search_context_trace`。
- `details.queryDigest`：当前查询摘要，可用于排查同一查询链路。
- `details.indicesCount` / `details.indexPatternsCount`：实际命中的索引数与 pattern 数。
- `details.pagingPosition`：失败发生在第一页还是续页。
- `details.cursorSortMode`：分页排序模式。
- `details.direction` / `details.centerIndex` / `details.contextMode`：边界查询和上下文查询的辅助诊断。
- `details.phaseMetrics`：阶段耗时，例如索引解析和主查询耗时。
