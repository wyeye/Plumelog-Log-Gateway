# API Reference

## Authentication

发送以下任一鉴权头：

- `Authorization: Bearer <token>`
- `X-API-Key: <token>`

## Endpoints

- `GET /health`
- `GET /api/v1/meta/apps`
- `POST /api/v1/logs/search`
- `POST /api/v1/logs/context`

## Search Constraints

- `timeRange.from`、`timeRange.to`、`limit` 必填。
- `limit` 范围为 `1-500`，并受服务端配置上限控制。
- 同字段数组内部按 OR，不同字段之间按 AND。
- `content.all` 表示全部命中，`content.any` 表示任一命中，`content.not` 表示排除命中。

## Response Shapes

- 搜索结果返回 `columns` + `rows`。
- 上下文结果返回 `center`、`traceLogs`、`nearbyLogs`、`resolution`。
- 错误统一返回 `error.code`、`error.message`、`error.details`。
