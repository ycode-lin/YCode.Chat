# Chat Agent

一个面向本地使用和二次开发的 AI 会话应用，前端使用 `React + Vite`，后端使用 `Express + LangChain`。当前实现重点放在 3 个能力上：

- 会话聊天：支持多轮对话、流式输出、会话列表与删除。
- 提示词编辑：直接在界面里编辑当前系统提示词。
- MCP 工具接入：可在界面中维护 MCP 配置、查看服务状态、启停服务、切换审批模式。

这份 README 按当前仓库代码行为编写，不是通用模板。

## 当前实现

### 前端能力

- 会话列表保存在浏览器 `localStorage`。
- 当前激活会话 ID 保存在浏览器 `localStorage`。
- 当前系统提示词保存在浏览器 `localStorage`。
- 明暗主题保存在浏览器 `localStorage`。
- 主界面分为 `Session`、`Prompts`、`MCP` 三个区域。

### 后端能力

- 提供模型列表、提示词列表、聊天、MCP 配置和 MCP 工具概览接口。
- 聊天支持普通响应和 SSE 流式响应。
- 支持 MCP 工具绑定，并区分 `solo` 自动执行与 `manual` 手动审批。
- `manual` 审批依赖流式模式，非流式 `/api/chat` 不支持手动审批工具调用。

### 当前内置内容

- 内置模型：`DeepSeek Chat`、`DeepSeek Reasoner`、`GPT-4o Mini`、`GPT-4o`
- 内置提示词：`默认助手`、`开发助手`、`翻译助手`、`创意写作`

## 技术栈

- 前端：`React 19`、`TypeScript`、`Vite`、`Ant Design`、`@ant-design/x`
- 后端：`Express`、`LangChain`、`@langchain/openai`、`@langchain/mcp-adapters`
- 协议：`SSE`、`MCP`

## 目录结构

```text
chatAgent/
├── client/             # React + Vite 前端
├── server/             # Express + LangChain 后端
├── package.json        # 根目录脚本
└── README.md
```

## 环境要求

- `Node.js 18+`
- `npm`

## 安装依赖

这个项目不是 workspace 结构，需要分别安装根目录、后端和前端依赖：

```bash
npm install
cd server && npm install --legacy-peer-deps
cd ../client && npm install
cd ..
```

> `server` 目录目前需要 `--legacy-peer-deps`，因为 `@langchain/mcp-adapters` 与当前依赖组合存在 peer 依赖兼容要求。

## LLM 配置说明

当前后端的 `LLM` 配置只从环境变量读取，不再支持在 `server/src/config/llm.ts` 里写本地常量配置。

先复制示例文件：

```bash
cp server/.env.example server/.env
```

然后按需填写这些变量：

| 变量名 | 说明 |
| --- | --- |
| `PORT` | 服务端端口，默认 `3001` |
| `DEFAULT_MODEL_ID` | 默认模型 ID |
| `OPENAI_API_KEY` | OpenAI 兼容接口 Key |
| `OPENAI_BASE_URL` | OpenAI 兼容接口地址 |
| `MCP_SERVERS` | 默认 MCP 配置，要求是合法 JSON 字符串 |

如果未提供某个变量，服务端会使用代码中的安全默认值，例如默认模型会回退到 `openai:gpt-4o-mini`。

## 启动开发环境

在项目根目录运行：

```bash
npm run dev
```

默认地址：

- 前端：<http://localhost:5173>
- 后端：<http://localhost:3001>

前端通过 Vite 代理访问后端 `/api`。

## 构建与运行

```bash
npm run build
npm start
```

说明：

- `npm run build` 会分别构建前后端。
- `npm start` 只启动后端。
- 前端静态产物位于 `client/dist`，需要单独部署。

## 根目录脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动前后端 |
| `npm run dev:server` | 启动后端开发服务 |
| `npm run dev:client` | 启动前端开发服务 |
| `npm run build` | 构建前后端 |
| `npm run start` | 启动后端 |

## MCP 配置行为

这部分是当前项目里最容易写错的地方，这里按代码实际行为说明。

### 配置来源

- 后端优先读取“内存中的 MCP JSON 配置”。
- 如果内存里没有配置，则回退到 `process.env.MCP_SERVERS`。
- 界面里改动的 MCP 配置会通过 `/api/mcp/config` 发给服务端，并只保存在当前 Node 进程内存里。
- 服务端重启后，界面提交过的 MCP 配置不会自动保留；如果需要默认值，要写到 `.env` 的 `MCP_SERVERS`。

所以当前项目并没有把 MCP 配置做持久化存储到数据库或文件。

### 支持的配置形式

项目支持两种主要接入方式：

- `stdio`
- 远程 `sse` / `streamableHttp`

界面里既支持直接编辑 JSON，也支持通过表单添加远程服务。

### JSON 示例

`stdio` 示例：

```json
{
  "math": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-math"]
  }
}
```

远程服务示例：

```json
{
  "my-server": {
    "enabled": true,
    "type": "streamableHttp",
    "url": "https://your-mcp-server-url/mcp",
    "approvalMode": "solo"
  }
}
```

如果你希望提供默认 MCP 配置，可以在 `server/.env` 中设置：

```env
MCP_SERVERS={"math":{"transport":"stdio","command":"npx","args":["-y","@modelcontextprotocol/server-math"]}}
```

## 聊天与审批

- `/api/chat` 支持普通模式和流式模式。
- 当某个 MCP 服务配置为 `manual` 审批时，必须使用流式模式。
- 后端提供待审批运行查询、审批提交和恢复执行接口。

相关接口包括：

| 接口 | 说明 |
| --- | --- |
| `GET /api/chat/pending` | 查询待审批运行 |
| `POST /api/chat/runs/:runId/tool-calls/:toolCallId/decision` | 提交工具审批结果 |
| `POST /api/chat/runs/:runId/resume` | 审批后恢复执行 |

## API 概览

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/models` | 获取可用模型列表 |
| `GET /api/prompts` | 获取内置提示词列表 |
| `GET /api/mcp/config` | 获取当前 MCP 配置 |
| `POST /api/mcp/config` | 设置当前 MCP 配置 |
| `GET /api/mcp/tools` | 获取已加载 MCP 工具 |
| `GET /api/mcp/overview` | 获取 MCP 服务概览、工具和错误状态 |
| `POST /api/mcp/reload` | 清缓存并重新加载 MCP |
| `POST /api/chat` | 发起聊天请求 |

## 目前更准确的后续方向

如果按当前项目状态继续做，比较贴合的下一步是：

- 把 MCP 配置从“进程内存”改成文件或数据库持久化。
- 增加测试和异常场景覆盖，尤其是 MCP 连接失败、审批中断、恢复执行。
- 增加部署方式，例如 Docker 或 CI/CD。
