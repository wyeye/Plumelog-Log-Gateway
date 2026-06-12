# plumelog-log-query

## Purpose

Use the Plumelog log gateway HTTP API to search logs without writing Elasticsearch DSL.

## Workflow

1. 缺少 `timeRange.from`、`timeRange.to` 或 `limit` 时，先补齐参数，不调用网关。
2. 已知 `traceId` 时，优先把它放进搜索条件。
3. 否则按 `app`、`level`、`content`、`timeRange` 做首次检索。
4. 先调用 `/api/v1/logs/search`，再按需调用 `/api/v1/logs/context`。
5. 需要上下文时，优先使用搜索结果里的 `index + id`。
6. 输出只保留查询条件、关键证据、初步判断和下一次查询建议。

## Do Not

- 不直接访问 Elasticsearch。
- 不构造 Elasticsearch DSL。
- 不自动扩大查询时间范围。
- 不默认展开大段异常堆栈。
