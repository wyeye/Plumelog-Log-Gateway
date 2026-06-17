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
- 脱敏。

## 接口

- `GET /health`
- `GET /api/v1/meta/apps`
- `POST /api/v1/logs/search`
- `POST /api/v1/logs/context`
- `POST /api/v1/logs/boundary`

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
  npm run mcp
```

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
