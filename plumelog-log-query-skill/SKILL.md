# plumelog-log-query

## Purpose

Use the Plumelog log gateway HTTP API or MCP tools to search logs without writing Elasticsearch DSL.

## Workflow

1. 缺少 `timeRange.from`、`timeRange.to` 或普通搜索所需 `limit` 时，先补齐参数，不调用网关。
2. 用户问“有哪些应用 / 环境”或需要先缩小范围时，优先调用 `list_apps` 或 `GET /api/v1/meta/apps`。
3. 用户问“最早 / 首次 / 第一次 / 最晚”时，优先调用 `find_log_boundary` 或 `POST /api/v1/logs/boundary`。
4. 已知 `traceId` 时，优先把它放进搜索条件。
5. 其它场景按 `app`、`level`、`content`、`timeRange` 做首次检索。
6. 普通排查先调用 `search_logs` / `/api/v1/logs/search`，再按需调用 `get_log_context` / `/api/v1/logs/context`。
7. 需要上下文时，优先使用搜索结果里的 `index + id`。
8. `summary.hasMore=true` 时使用 `summary.nextCursor` 继续翻页；不要自行构造、修改或复用到其它查询。cursor 可能过期，过期后重新发起第一页查询。
9. MCP tool 返回 `isError=true` 时，正文是结构化 JSON，优先读取 `code`、`message`、`status`、`requestId` 并把 `requestId` 带给用户或后续排查。
10. 输出只保留查询条件、关键证据、初步判断和下一次查询建议。

## Do Not

- 不直接访问 Elasticsearch。
- 不构造 Elasticsearch DSL。
- 不自动扩大普通搜索时间范围。
- 不默认展开大段异常堆栈。
- 不尝试绕过脱敏；只有网关 API key 显式允许 raw content 时才可能返回未脱敏正文。
