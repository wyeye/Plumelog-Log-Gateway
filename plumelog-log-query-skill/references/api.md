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
- API key 的 `logs:search` scope、app/env、timeRange、limit 限制会在请求解析后执行。
- 同字段数组内部按 OR，不同字段之间按 AND。
- `content.all` 表示全部命中，`content.any` 表示任一命中，`content.not` 表示排除命中。
- 服务端用 `limit + 1` 条 ES 结果判断是否有下一页；响应 `rows` 仍最多返回 `limit` 条。
- 默认 `search.trackTotalHits=false`，响应 `summary.totalKnown=false` 时，`summary.total` 不是精确总数。
- 搜索默认启用 `_source.includes`，只拉取生成响应所需字段。
- `summary.nextCursor` 使用签名 cursor；篡改或跨查询复用会返回 `CURSOR_INVALID`。
- cursor 绑定 timeRange、filters、limit 和排序配置；不要跨查询复用或手工修改。

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
- 搜索摘要包含 `total`、`totalRelation`、`totalKnown`、`hasMore`、`nextCursor`。
- `hasMore=true` 表示可用 `nextCursor` 继续翻页；最后一页 `hasMore=false` 且 `nextCursor=null`。
- 上下文结果返回 `center`、`traceLogs`、`nearbyLogs`、`resolution`。
- 边界结果返回 `record` 对象或 `null`。
- 错误统一返回 `error.code`、`error.message`、`error.details`。
- HTTP 错误响应还包含顶层 `requestId` 和 `error.requestId`。
- 无 token/错误 token 返回 `401 UNAUTHORIZED`；scope 或 API key policy 不允许返回 `403 FORBIDDEN`。
- 默认启用脱敏；搜索 preview、context content、boundary preview 中的 token、Cookie、密码、JWT、邮箱、手机号、身份证号、银行卡号会被替换为 `[REDACTED:<type>]`。
- `allowRawContent=false` 是默认值；只有 API key 显式设置 `allowRawContent=true` 时，完整正文映射才允许绕过脱敏。

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
- MCP 客户端默认超时 `10000` ms，可通过 `PLUMELOG_GATEWAY_TIMEOUT_MS` 设置；网络错误和 HTTP `502/503/504` 最多尝试 3 次。
