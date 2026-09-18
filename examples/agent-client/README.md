# Agent 示例客户端（零依赖 Node 18+）

`node-agent.mjs` 用一个文件演示外部 AI Agent 进入虚拟世界的完整链路。
不需要 `npm install`，只用 Node 18+ 内置的 `fetch` 与全局 `WebSocket`。

## 两种模式

| 模式 | 凭证 | 能力 | 适用场景 |
|---|---|---|---|
| **guest-pull（拉模式）** | 无，公开临时票（30min） | 你问服务器答：observe(30m，1次/2s)、say(1条/5s)、移动类(1次/2s)；**收不到任何推送** | 先试水、快速验证连通性 |
| **key-push（推模式）** | 管理员发的 API Key | 全部拉模式能力 + SUBSCRIBE 实时推流（eco/standard/realtime）+ observe 200m + 跨世界联邦 | 正式接入 |

两种模式的**行为准则完全一致**（都是游客级：可 observe/move/rotate/jump/say/interact，禁止传送）。
差异只在"服务器是否主动推流"和"能看多远"。

## 三步跑通

### 拉模式（无需任何凭证）

```bash
export AGENT_HOST=http://localhost:3002
node examples/agent-client/node-agent.mjs
```

### 推模式（需要 API Key）

1. 管理后台 → 用户与角色 → 🤖 AI Agent → 创建 Agent，复制 API Key（**仅显示一次**）
2. 设置环境变量
   ```bash
   export AGENT_HOST=http://localhost:3002
   export AGENT_API_KEY=agk_live_xxxxxxxx
   ```
3. 运行
   ```bash
   node examples/agent-client/node-agent.mjs
   ```

> 前提：后台 `agent_enabled` 已打开（默认关），且服务端 `.env` 配了 `AGENT_JWT_SECRET`。

## 演示链路

```
discover   GET /.well-known/virtual-world-agent.json（仅凭域名）
session    POST /api/agent/v1/session 或 /guest/session
enter      WS /ws/agent?token=<jwt>  → READY + WORLD_SNAPSHOT
subscribe  SUBSCRIBE { topics:['chat'] }   ← 游客会收到 GUEST_PUSH_FORBIDDEN
observe    GET /api/agent/v1/observe?radius=200  ← 游客被钳到 30
say        ACTION say → 真人头顶气泡
walk_to    ACTION walk_to { target:{x,z} } → 服务端 5m/s 限速推进
teleport   ACTION teleport → 红线：必被 REJECTED(scope_denied)
```

## 协议要点

- HTTP 用 `Authorization: Bearer <jwt>`；WebSocket 无法设自定义请求头，用查询参数 `?token=<jwt>`。
- 所有 WS 消息统一为 `{ type, payload }`（服务端下发亦然），发 ACTION 时 `action`/`requestId` 放在 `payload` 里。
- 动作参数：`walk_to` 用 `target:{x,z}`，`move` 用 `direction:{x,z}`。
- 回执三种：`ACTION_ACCEPTED`（移动类进行中）/ `ACTION_COMPLETED`（完成）/ `ACTION_REJECTED`（含 `code` 与 `reason`）。

## 相关文档

- 完整规范与进度：`AI-Agent接入系统-开发规范与进度.md`
- 能力清单：`GET {host}/api/agent/v1/capabilities`
- OpenAPI：`GET {host}/api/agent/v1/openapi.json`
