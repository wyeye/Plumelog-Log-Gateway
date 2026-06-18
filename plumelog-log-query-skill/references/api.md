# API Reference

## Authentication

发送以下任一鉴权头：

- `Authorization: Bearer <token>`
- `X-API-Key: <token>`

API key 可配置 scope、allowedApps、allowedEnvs、maxTimeRangeHours 和 maxLimit。旧 `name/token` 配置默认拥有全部只读 scope。

## Endpoints

- `GET /health`
- `GET /api/v1/meta/apps`
- `POST /api/v1/logs/search`
- `POST /api/v1/logs/context`
- `POST /api/v1/logs/boundary`

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
- 无 token/错误 token 返回 `401 UNAUTHORIZED`；scope 或 API key policy 不允许返回 `403 FORBIDDEN`。
- 默认启用脱敏；搜索 preview、context content、boundary preview 中的 token、Cookie、密码、JWT、邮箱、手机号、身份证号、银行卡号会被替换为 `[REDACTED:<type>]`。
