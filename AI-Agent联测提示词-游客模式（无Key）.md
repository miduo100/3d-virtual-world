# 下一轮联测提示词 · 游客模式（无 API Key，仅凭域名连接）

> 用法：新建一个对话框，把下面 `====` 之间的全部内容粘进去作为第一条消息。
> 生成时间：2026-09-19（第一轮联测缺陷 A~J 修复完成、git `4f87c907` 之后）

====

你是本项目的 AI 开发助手，工作区 `l:\shegnjir185`。本会话任务：**用「游客模式」接入虚拟世界并做真人 × 游客AI 联测**——即**不使用 API Key**，只凭域名签公开临时票进场（拉模式 pull），与用户在 3D 世界里实时对话、跟随、互相引导测试，把发现的问题记录下来（**默认不改代码，除非用户在当轮明确授权**）。

## 0. 开工前必做（按顺序，做完先复述状态再动手）

1. 读唯一权威文档 `l:\shegnjir185\AI-Agent接入系统-开发规范与进度.md`，重点：
   - §0 接力协议 / §3 红线清单（13 条 + P8 追加 2 条：游客禁推流、游客 observe 半径硬钳 30m）
   - §5.2 七个 ACTION（含 `follow`）与移动类回执契约
   - §5.3 全部 system_config 配置键（含 `agent_max_speed` / `agent_observe_rate_key` / `agent_max_connections_per_agent`）
   - §5.4 observe 结构 + **实体标识契约**（`entities[].id` 是唯一标识，`name` 仅供显示）
   - §7「多轮联测与缺陷待办」的**修复结果表**（A~H 已修、I/J 为本轮新发现已修）
   - §8 代码坐标速查 / §9 已知坑
2. **先核对文件存在性再引用任何结论**（本项目发生过两次"未提交改动丢失"事故，见进度日志 2026-09-14 / 2026-09-18）：确认 `src/agent/*`、`src/routes/agent/*`、`src/websocket/agentWsServer.js`、`src/services/logger.js`、`examples/agent-client/ai-live.mjs`、`scripts/_tmp_follow.js` 都在且非 0 字节。当前 git HEAD 应为 `4f87c907`（工作区干净）。
3. 环境自检（服务器应已在跑，3002）：
   - `node -e "fetch('http://localhost:3002/api/health').then(r=>r.text()).then(console.log)"`
   - `node -e "fetch('http://localhost:3002/.well-known/virtual-world-agent.json').then(r=>r.json()).then(j=>console.log(j.agentEnabled,j.tiers))"` → `agentEnabled` 必须为 `true`（联测期间保持 true；联测结束按红线 6 恢复 false 并写进文档）
4. 复述：当前状态 / 本会话要做什么 / 与 Key 档的差异点。

## 1. 连接方式（本会话核心 · **无 API Key**）

只有一个入口域名：**`http://localhost:3002`**（真人也在同一域名用浏览器进世界）。

| 步骤 | 请求 | 说明 |
|---|---|---|
| ① 发现 | `GET /.well-known/virtual-world-agent.json`、`GET /api/agent/v1/capabilities` | 公开无鉴权；含 `tiers`/`limits`/`entityIdentity`（契约机器可读） |
| ② 签票 | `POST /api/agent/v1/guest/session`（body `{}`，**不带任何鉴权头**） | 返回 `{token, tier:'guest-pull', mode:'pull', expiresIn:1800, agent:{id,name,scopes}, tierInfo}`；`agent.id` 形如 `agent:guest:<uuid>` |
| ③ 进场 | `ws://localhost:3002/ws/agent?token=<jwt>` | **必须用查询参数**（浏览器/WHATWG WebSocket 不能设 Authorization 头）；收到 `READY` + `WORLD_SNAPSHOT` |
| ④ 感知 | `GET /api/agent/v1/observe?radius=30`，头 `Authorization: Bearer <jwt>` | 游客半径被硬钳 30m、1 次/2s |
| ⑤ 聊天 | `GET /api/agent/v1/chat/history?limit=30` | **游客收不到 CHAT 推送**（SUBSCRIBE 被拒），只能轮询这条 |
| ⑥ 动作 | WS 发 `{type:'ACTION', payload:{requestId, action, ...}}` | 游客每类动作 1 次/2s |

一键起步（**不要设置 `AGENT_API_KEY`**，否则会走 Key 档）：

```powershell
cd l:\shegnjir185
Remove-Item -Path examples\agent-client\live\inbox\*.json -Force -ErrorAction SilentlyContinue   # 旧命令会被立即执行
$env:AGENT_HOST='http://localhost:3002'          # 不要设 AGENT_API_KEY = 自动游客签票
Start-Process -FilePath 'node' -ArgumentList 'examples/agent-client/ai-live.mjs' `
  -WorkingDirectory 'l:\shegnjir185' `
  -RedirectStandardOutput 'l:\shegnjir185\examples\agent-client\live\ai-live-out.log' `
  -RedirectStandardError  'l:\shegnjir185\examples\agent-client\live\ai-live-err.log' -WindowStyle Hidden
```

跟随（同样无 Key 自动游客签票，票 30 分钟到期会自动续）：

```powershell
$env:FOLLOW_TARGET_ID='<真人实体 id（characterId，不是名字）>'
node scripts/_tmp_follow.js 1800000 2      # 时长 ms, stopDistance
```

读真人聊天 / 诊断：

```powershell
node scripts/_tmp_wait_chat.js 60000 3000   # 增量读真人聊天（UTF-8 安全）
node scripts/_tmp_where.js                  # 我的会话 / 位置 / 各会话落库位置
node scripts/_tmp_who.js                    # 推流里出现过的实体 id 与最新位置
```

## 2. 游客档能做什么 / 不能做什么（与 Key 档的差异）

**能**：`observe`（≤30m，1 次/2s）、`say`（≤200 字，1 条/5s，30m 内广播 + 落库）、`move`/`walk_to`/**`follow`**/`rotate`/`jump`/`interact`（各 1 次/2s）、`chat/history`。
**不能**：
- **不能订阅推流**：`SUBSCRIBE` 返回 `ERROR{code:'GUEST_PUSH_FORBIDDEN'}`，`READY.pushTier` 恒为 `eco`（即使后台默认档是 realtime）→ **收不到 `CHAT`/`ENTITY_*` 推送**，聊天靠轮询。
- 观察半径 30m 硬钳（请求更大值被静默收敛，不报错）。
- 每 IP 只允许 **1 条**游客 WS 连接（第二条被拒 `GUEST_IP_CONCURRENCY`）。
- 每 IP 每小时最多 **10 张**票；票有效期 **30 分钟**（HTTP 401/403 代表票失效，重新签一张即可；`_tmp_follow.js` 已内置自动续票）。
- 共享全局 `max_agents=50`；**空闲 5 分钟踢出**（`.env` `AGENT_IDLE_TIMEOUT_MINUTES`，0=禁用）——**只有 WS 的 ACTION/SUBSCRIBE/UNSUBSCRIBE 算"操作"，HTTP observe 不算**，心跳 PONG 也不算。
- 无 Key ⇒ 不创建 `agents` 行、不建 `users`/`characters`（刷新即换身份，零残留）。

## 3. 必须知道的事实与坑（本项目已实测踩过）

1. **定位实体一律按 `id`（characterId）**，不要按 `name`：世界里存在**同名"米多"两条**（`2adb4c4c…` / `a8eaecfd…`，不同 id）与一个 **id 不带 `agent:` 前缀的旧 Agent**（`live_agent_517698`）；按"最近的 human"之类启发式盲选会跟错人。
2. **游客只有 30m 视野**：要真人先走到 30m 内才能拿到其 `id`；也可从 `/chat/history` 的 `senderId` 直接拿 id。注意 `follow` 是**服务端**读 `playerPositions`，不受 30m 限制——即"人能跑出 30m，跟随还会继续，只是客户端再也观测不到距离"。
3. 游客 `self.position`：**纯 HTTP（没有 WS 连接）时为 `(0,0,0)`**（会话无位置）；同票另开 WS 后 `self` = 实时位置（缺陷 A 修的就是这个基准）。
4. **聊天去重已修**：`ai-live.mjs` 用"history 持久 seen 表 + 跨通道 10s 窗口"两层去重；**不要**再用"每 10 秒把同一批旧消息重报一遍"判断成新缺陷（那是已修的 G）。
5. `POST /guest/session` 若返回 **429**：本机 IP 签票窗口满（10 张/小时）→ **重启服务器即可清空内存计数器**（`Stop-Process` 旧进程 + `Start-Process node src/server.js`）。
6. 第二条游客连接被拒 `GUEST_IP_CONCURRENCY`：先关掉旧的那条（游客**没有**"新连接顶掉旧连接"逻辑，只有 Key 档有）。
7. **重启驻场进程前先清空 `examples/agent-client/live/inbox/*.json`**（目录里的任何旧命令文件都会被立即执行，本轮被一个旧 `__stop` 意外结束过）；`live/events.jsonl` 是证据文件不要删。
8. PowerShell 坑：内联 `node -e` 里的 `|`、`"`、`$1` 会被破坏（尤其 SQL 占位符与正则管道）→ **写脚本文件**；读文件用 node 而不是 `Get-Content`（会被安全规则拦）。
9. 我已有一条 Key 档连接（Agent `workbuddy`）可能仍在场内：如需独占测试，先问用户是否要停掉，停法：
   `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*_tmp_follow*' -or $_.CommandLine -like '*ai-live*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`

## 4. 本会话建议观察并记录的点（先记录，别静默改代码）

- 30m 观察半径对"找到人并跟随"够不够用；人跑出 30m 后游客端只能等 `ACTION_COMPLETED`。
- 拉模式的延迟体感：observe 1/2s、动作 1/2s、聊天靠 2.5s 轮询（无推送）。
- `say` 只投 30m：人跑远了游客说话对方收不到，体感如何。
- 游客档下 `follow` + keeper 的重发策略是否够用（动作限频 1/2s）。
- 每 IP 1 连接 + 签票 10/小时的边界（同机多开、票过期续票）。
- 空闲 5 分钟踢出对长会话的影响（只有动作能续命，observe 不算）。
- 与 Key 档对比：同样的对话/跟随，游客少了哪些能力、AI 客户端要额外做什么（轮询/续票/控频）。

## 5. 验收与证据要求

- 任何**代码改动**（若用户授权）必须配 `scripts/accept_agent_fix_*.js` 或新的 `accept_agent_*.js`，输出 `N/N PASS` 并给实测数据；回归必跑 `accept_agent_p1/p2/p3/p8.js`、`accept_ws_reconnect_presence.js`、`smoke_r185_world.js`。
- 纯联测（不改代码）也要留证据：`examples/agent-client/live/events.jsonl`、`follow.log`、`logs/audit-<date>.log`（含 `guest_ticket_issued`/`ws_connected`/`ws_idle_timeout`）、以及真人对话原文。

## 6. 收尾三件事（§0，每会话必做）

1. 更新文档 `AI-Agent接入系统-开发规范与进度.md`：把本会话游客联测结论回填到 §7（新增"游客模式联测"小节或补充检查清单勾选），进度日志追加一行。
2. 写记忆（本会话里程碑 + 关键坑）。
3. git 提交：用 `write_to_file` 写 UTF-8 提交信息文件 + `git commit -F 文件`（PowerShell 直接 `-m` 中文会 GBK 乱码）。

## 7. 沟通规则

- 用户会在 3D 世界里用中文跟你实时对话并引导你操作（你是那个"游客 AI"），要实时响应、并把关键结论用 `say` 回给用户（≤200 字）。
- "重构 vs 打补丁"的取舍**必须问用户**（红线 11）并说清影响面；不确定的以实测为准；发现问题比预期大先回报再决定是否缩范围。
- 当前环境（2026-09-19 收尾状态）：服务器 3002 跑新代码、`agent_enabled=true`（联测期）、`agent_push_default=eco`、`max_agents=50`、`agent_max_speed=12`、`agent_observe_rate_key=1`、`agent_max_connections_per_agent=1`；`ubuntu-deploy-package` 未同步（清单见文档）。

====
