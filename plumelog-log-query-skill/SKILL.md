---
name: plumelog-log-query
description: Use when searching, inspecting, or troubleshooting Plumelog logs through the Plumelog log gateway HTTP API or MCP tools, including listing apps/envs, searching logs, fetching context, finding earliest/latest matching logs, and interpreting gateway/MCP error payloads.
---

# plumelog-log-query

## Purpose

Use the Plumelog log gateway HTTP API or MCP tools to search logs without writing Elasticsearch DSL.

## Workflow

1. 缺少 `timeRange.from`、`timeRange.to` 或普通搜索所需 `limit` 时，先补齐参数，不调用网关。
2. 用户问“有哪些应用 / 环境”或需要先缩小范围时，优先调用 `list_apps` 或 `GET /api/v1/meta/apps`。
3. 用户问“最早 / 首次 / 第一次 / 最晚”时，优先调用 `find_log_boundary` 或 `POST /api/v1/logs/boundary`。
4. 用户明确要“拉全量 / 拉完所有分页 / 不想手工翻页”时，优先调用 `search_logs_all_pages`。
5. 用户明确要“导出 csv / 落地文件 / 一把拉下来”时，优先调用 `export_logs_csv`。
6. 时间窗较大、已知容易超时，或用户希望自动切片时，优先调用 `search_logs_auto`；不要先手工按 2 分钟、5 分钟之类去拆。
7. 其余普通排查先调用 `search_logs` / `/api/v1/logs/search`，再按需调用 `get_log_context` / `/api/v1/logs/context`。
8. 已知 `traceId` 时，优先把它放进搜索条件；需要上下文时，优先使用搜索结果里的 `index + id`。
9. 只需要快速浏览命中时，保持默认 `contentMode=preview`；需要完整日志正文、导出完整内容或判断 preview 不够时，显式使用 `contentMode=full`。
10. 只有 `search_logs` 需要手动看 `summary.hasMore` 和 `summary.nextCursor`；`search_logs_all_pages`、`search_logs_auto`、`export_logs_csv` 已经会自动翻页。不要自行构造、修改或跨查询复用 cursor。cursor 可能过期，过期后重新发起第一页查询。
11. 聚合工具返回 `partialResult=true` 时，不要当作完整结果；先看 `warnings`、`failures`、`diagnostics`，说明缺失范围、失败切片、失败分页和 requestId。
12. MCP tool 返回 `isError=true` 时，正文是结构化 JSON，优先读取 `code`、`message`、`status`、`requestId`，并进一步查看 `details.phase`、`details.queryDigest`、`details.pagingPosition`、`details.phaseMetrics` 等诊断字段。
13. 输出只保留查询条件、关键证据、初步判断和下一次查询建议；如果结果不完整，要明确说出“不完整”的原因。

## Do Not

- 不直接访问 Elasticsearch。
- 不构造 Elasticsearch DSL。
- 有自动工具可用时，不手工拆时间片或手工拼分页。
- 不自动扩大普通搜索时间范围。
- 不默认展开大段异常堆栈。
- 不把 `partialResult=true` 当作完整结论。
- 不忽略 `POLICY_REJECTED`、`ES_TIMEOUT`、`INDEX_RESOLVE_TIMEOUT`、`CURSOR_INVALID` 这类错误码背后的具体诊断信息。
- 返回的日志正文为原始内容，不做脱敏处理。
