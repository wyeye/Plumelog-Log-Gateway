# AGENTS.md

## 技术栈

- 语言：Node.js + TypeScript
- HTTP 框架：Fastify
- 参数校验：Zod
- Elasticsearch 客户端：`@elastic/elasticsearch`
- 配置文件：YAML
- 鉴权方式：Bearer Token / API Key
- 包管理器：优先使用项目已存在的 lockfile；新项目默认使用 npm

## 技术规范

### API 协议

- 所有 HTTP API 请求和响应都使用 JSON。
- 响应结构必须稳定，避免直接暴露 Elasticsearch 原始响应。
- 错误响应统一使用：

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "request is invalid",
    "details": {}
  }
}
```

### 查询约束

- 日志搜索必须显式传入 `timeRange.from`、`timeRange.to` 和 `limit`。
- `timeRange` 必须是带时区的 ISO 8601 字符串。
- `limit` 范围为 `1-500`。
- 不允许向调用方暴露 Elasticsearch DSL 透传能力。
- 同一字段数组内部按 OR 查询。
- 不同字段之间按 AND 查询。
- 空数组按未提供处理。

### 返回结构

- 搜索结果使用表格型 JSON：`columns` + `rows`。
- 上下文和详情结果使用对象型 JSON。
- 搜索结果中的日志正文使用 `contentPreview`，避免默认返回大段内容。
- 完整日志正文只在详情或上下文接口返回。

### 字段映射

统一使用 API 语义字段，不在接口中依赖 Plumelog 原字段名。

| API 字段 | 含义 |
|---|---|
| `timestamp` | ISO 8601 日志时间 |
| `epochMillis` | 毫秒时间戳 |
| `content` | 完整日志正文 |
| `contentPreview` | 截断后的日志正文 |
| `level` | 日志级别 |
| `app` | 应用名 |
| `env` | 环境 |
| `host` | 实例或主机 |
| `traceId` | 追踪码 |
| `logger` | 类名或 logger 名称 |
| `method` | 方法名 |
| `thread` | 线程名 |
| `sort` | 翻页排序值 |

## 开发规范

- 保持服务只读，不实现删除、索引管理、保留期管理等写操作。
- 配置、schema、ES 查询、HTTP 路由、鉴权逻辑分模块实现。
- 所有外部输入必须经过 Zod 校验。
- 所有 ES 查询必须经过内部 adapter 构造，不在路由层拼查询。
- 不在业务代码中硬编码密钥、ES 地址、索引前缀。
- 日志输出不得打印鉴权 token。
- 错误信息应包含稳定错误码，避免泄露内部堆栈。
- 新增或修改代码后执行必要验证。
- Java 或 Node 项目中不要新增额外测试类；需要验证时使用临时 `python3` 脚本。
- 临时验证脚本不得提交。
- 提交 commit 时不要包含 `docs/superpowers`。

## 项目模块介绍

建议目录结构：

```txt
src/
  auth/       # Bearer Token / API Key 鉴权
  config/     # YAML 配置加载与配置 schema
  es/         # Elasticsearch client、索引选择、查询构造、结果映射
  http/       # Fastify app、路由注册、错误处理
  schema/     # Zod 请求/响应 schema
  utils/      # 通用工具函数
```

模块职责：

- `auth`：解析和校验请求鉴权信息。
- `config`：加载 YAML 配置，校验配置完整性，向其他模块提供只读配置。
- `es`：封装 Elasticsearch 访问；路由层不得直接调用 ES DSL。
- `http`：注册 API 路由、健康检查和统一错误处理。
- `schema`：集中维护请求和响应 schema。
- `utils`：只放无业务状态的通用函数。

## CodeGraph 使用规范

- 代码结构检索、符号检索、调用关系和影响范围分析优先使用 CodeGraph。
- 使用 CodeGraph 前先确认：

```bash
rtk pwd
rtk git rev-parse --show-toplevel
rtk codegraph status .
```

- 一组连续文件修改完成后执行：

```bash
rtk codegraph sync
```

- 如果索引异常，执行：

```bash
rtk codegraph index --force
```

## Shell 命令规范

执行 shell 命令时使用 `rtk` 前缀。

示例：

```bash
rtk npm run build
rtk python3 /tmp/check_api.py
rtk git status
```
