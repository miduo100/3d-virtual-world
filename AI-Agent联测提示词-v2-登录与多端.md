# 下一轮联测提示词 · v2（Agent 登录链路 + 多端同时在线）

> 用法：**新建一个对话框**，把下面 `====` 之间的全部内容粘进去作为第一条消息。
> 生成时间：2026-09-19（游客档 4 项修复 ✅、回归全绿、git 已提交 `74f34fba`、**尚未推送远端**）
> 与 v1 的差别：①新增「登录/鉴权边界用例」矩阵；②新增「多端同时在线」章节（含多驻场进程的目录冲突变通方案）；③把 B2/C2/D2/E2 四项修复写进"已修复，勿重复上报"；④坑清单更新到 21 条。

====

你是本项目的 AI 开发助手，工作区 `l:\shegnjir185`。本会话任务：**接续「AI Agent 接入」联测**——重点是 ①**登录/鉴权链路**（游客临时票 + Key 档对接）与 ②**多端同时在线**（多 Agent × 多真人）。你要作为"游客 AI"进入 3D 世界，与真人在世界里实时对话、跟随、互相引导测试，把问题记录下来（**默认只测不改代码；改代码需用户在当轮明确授权**）。

## 0. 开工前必做（按顺序，做完先复述状态再动手）

1. 读唯一权威文档 `l:\shegnjir185\AI-Agent接入系统-开发规范与进度.md`，重点：
   - §0 接力协议（含收尾三件事）/ §3 红线清单（含 P8 追加两条：**游客禁推流**、**游客 observe 半径硬钳 30m**）
   - §5.2 七个 ACTION（含 `follow`）与移动类回执契约 / §5.3 全部 `system_config` 配置键 / §5.4 observe 结构 + **实体标识契约**（`entities[].id` 是唯一标识，`name` 仅供显示）
   - **§7「多轮联测与缺陷待办」+ 其后的「游客模式联测（无 API Key）」小节**（本轮 4 项修复 B2/C2/D2/E2 的根因、修法与验证数据）
   - §8 代码坐标速查 / §9 已知坑（**已扩到 21 条，19/20/21 是本轮新增**）
2. **先核对文件存在性再引用任何结论**（本项目发生过多次"未提交改动丢失"事故）：确认 `src/agent/*`、`src/routes/agent/*`、`src/websocket/agentWsServer.js`、`src/middleware/clientIp.js`、`src/services/logger.js`、`examples/agent-client/ai-live.mjs` 都在且非 0 字节。当前 git HEAD 应为 **`74f34fba`**。
3. 环境自检（服务器应已在跑，端口 3002）：
   - `node -e "fetch('http://localhost:3002/api/health').then(r=>r.text()).then(console.log)"`
   - `node -e "fetch('http://localhost:3002/.well-known/virtual-world-agent.json').then(r=>r.json()).then(j=>console.log(j.agentEnabled,j.tiers.default))"` → 期望 `true guest-pull`（**联测期保持 true；联测收尾按红线 6 恢复 false 并写进文档**）
   - ⚠️ **`accept_agent_p3.js` / `accept_agent_p8.js` 收尾都会把 `agent_enabled` 置 false**。跑完回归要打开：
     `PUT /api/agent/v1/admin/config {"agent_enabled":true}`（管理账号 `baseline_shot` / `Baseline#185`，先 `POST /api/admin-auth/login`）
4. 复述：当前状态 / 本会话要做什么 / 与上一轮的差别（**哪些缺陷已修，别重复当新缺陷上报**）。

## 1. 登录 / 鉴权链路（本会话核心）

只有一个入口域名：**`http://localhost:3002`**（真人用浏览器在同一域名进世界）。

| 步骤 | 游客档（无 API Key） | Key 档（对照） |
|---|---|---|
| ① 发现 | `GET /.well-known/virtual-world-agent.json`、`GET /api/agent/v1/capabilities`（公开无鉴权，含 `tiers`/`limits`/`entityIdentity`） | 同左 |
| ② 换票 | `POST /api/agent/v1/guest/session`（body `{}`，**不带任何鉴权头**）→ `{token, tier:'guest-pull', mode:'pull', expiresIn:1800, agent:{id:'agent:guest:<uuid>'}}` | `POST /api/agent/v1/session`，头 `Authorization: Bearer <API Key>` → JWT（**15 分钟 TTL，过期重新换**） |
| ③ 进场 | `ws://localhost:3002/ws/agent?token=<jwt>`（**必须查询参数**：浏览器/WHATWG WebSocket 不能设 Authorization 头）→ `READY` + `WORLD_SNAPSHOT` | 同左（Authorization 头与 `?token=` 都支持） |
| ④ 感知 | `GET /api/agent/v1/observe?radius=30`（头 `Authorization: Bearer <token>`）：半径硬钳 30m、1 次/2s | 同端点：半径上限 200m、采样率 `agent_observe_rate_key`（默认 1Hz） |
| ⑤ 聊天 | `GET /api/agent/v1/chat/history?limit=30`（**游客收不到 CHAT 推送**，只能轮询） | 同端点；`SUBSCRIBE{topic:'chat'}` 后收 `CHAT` 推送 |
| ⑥ 动作 | WS `{type:'ACTION', payload:{requestId, action, ...}}`：`move/walk_to/follow/rotate/jump/say/interact` | 同左，但**无动作限频**（游客每类 1 次/2s） |

### 1.1 登录/鉴权边界用例（逐条实测，建议做成可重跑脚本）

| 用例 | 期望结果 |
|---|---|
| 无 token 连 `/ws/agent` | HTTP 401（upgrade 被拒） |
| 过期 / 伪造 token | 403（过期）/ 401（伪造） |
| 游客同 IP 第 2 条连接 | `ERROR{code:GUEST_IP_CONCURRENCY}` + `close 1013`（**没有**"新连接顶掉旧连接"逻辑，那是 Key 档的） |
| 游客票 30 分钟到期后 | HTTP `observe`/`chat history` 变 401（重新签票即恢复）；WS 当时仍连着，但**约 5 分钟后被空闲超时回收**（实测：票到 00:24:48、WS 于 00:31:39 断开） |
| 签票限流 | 同一真实 IP 第 11 张 → `429 GUEST_TICKET_RATE_LIMITED` + `retryAfter`；**服务端重启即清空内存窗口** |
| 反代 IP 口径（本轮已修 D2） | `X-Real-IP` 优先、否则取 `X-Forwarded-For` **最后一段**；`TRUST_PROXY=false` 时忽略这两个头。可实测：带 `X-Forwarded-For: 203.0.113.9` 的游客与默认 IP 游客**同时在线**，而同 IP 第二条**仍被拒** |
| 游客 `SUBSCRIBE` | `ERROR{code:GUEST_PUSH_FORBIDDEN}`；`READY.pushTier` 恒为 `eco`（即使后台默认档是 realtime） |
| 游客 `observe?radius=200` | 静默钳到 **30**（不报错） |
| 超频 | 游客 `observe` → `429 GUEST_OBSERVE_RATE_LIMITED`；`say` → `ACTION_REJECTED{code:rate_limited}` |
| `agent_enabled=false` | `/session` 与 `/guest/session` → 503 `AGENT_DISABLED_GLOBALLY`；**well-known / capabilities / openapi 仍 200**（发现端点永远公开） |
| 空闲超时（`AGENT_IDLE_TIMEOUT_MINUTES`，默认 5） | **本轮已修 C2**：Key 档 `PING` 或 HTTP `observe` 都能续命；**游客 `PING` 故意不算**，只有动作/订阅/`observe` 续命（防过期票靠空转 PING 长期占住每 IP 名额） |
| 同角色多连接（Key 档） | 新连接顶掉旧连接 `4004 REPLACED_BY_NEW_CONNECTION`，旧连接**静默清理不广播 PLAYER_LEFT**（真人端 avatar 不闪断）；`observe` 中该 id 只出现 1 条 |
| 空闲/动作回执 | `ACTION_ACCEPTED`（移动类启动）、`ACTION_COMPLETED{reason: arrived\|superseded\|target_lost\|timeout\|disconnected}`、`ACTION_REJECTED{code}` |

## 2. 多端同时在线（本轮新增重点）

- 目标：**3 Agent × 5 真人**同时在线（人手不足时用脚本开模拟真人 WS 连接补足）。
- ⚠️ **多驻场进程的目录冲突（E2，未修）**：`ai-live.mjs` 的 `live/` 目录是按**脚本所在目录**固定的（`inbox/`、`events.jsonl`、`state.json` 全部共享）→ 两个进程会**互相抢命令、互相覆盖 state.json、证据混流**（本轮实际踩到）。
  **变通（不改代码，推荐）**：给每个 Agent 一份独立副本
  ```powershell
  New-Item -ItemType Directory -Force l:\shegnjir185\examples\agent-client\agents\A | Out-Null
  Copy-Item l:\shegnjir185\examples\agent-client\ai-live.mjs l:\shegnjir185\examples\agent-client\agents\A\ai-live.mjs
  # 之后给 A 下命令 = 写进 examples\agent-client\agents\A\live\inbox\*.json
  ```
  **正解（需用户授权）**：给它加一个 `AGENT_LIVE_DIR` 环境变量。
- 观察点：`POSITION_UPDATE` 全量广播 + `follow` 服务端 10Hz 推进下的**带宽/CPU**（Server 2核4G 基线）；多 Agent 同时 `observe` 的 429 率与公平性；`entities` 唯一性（同名/多连接去重）；`entityIdentity` 契约稳定性（一律按 `id` 定位）；多 Agent 同时 `follow` 同一真人；Agent 之间互见/互聊；混合档位（eco/standard/realtime）同场表现。

## 3. 已修复项 —— **不要当新缺陷重复上报**

**第一轮 A~J（10 条）**：A `self`/距离基准双源不一致、B 同角色多连接重复实体与 4004 顶替、C 新增服务端 `follow`、D observe 采样率可配、E 移动类到达回执、F `entityIdentity` 契约、G 聊天双通道去重、H 发现端点同源、**I** `walk_to` 推进起点用旧快照（"原地徘徊"真凶）、**J** 重连瞬移回原点 —— 修法与证据见 §7「修复结果」表。

**第二轮游客档 4 项（本轮）**：

| # | 状态 | 内容（一句话） |
|---|---|---|
| B2 | ✅ 已修 | 非游客档**每秒给自己重复发一条 `ENTITY_ADDED`**（`currentIds` 未排除自身）→ 现 8 秒 0 条。顺带修了 `accept_agent_p3.js` D1 的竞态（过去是靠这条缺陷蒙过的） |
| C2 | ✅ 已修 | 5 分钟空闲超时**误杀纯拉模式客户端**→ 活跃信号扩容（Key 档 `PING` + HTTP `observe` 计入；游客 `PING` 不计）。实测：Key 只 observe 存活 360s，游客只 PING 311s 被踢 |
| D2 | ✅ 已修 | 反代后 per-IP 限流**把全世界算成一个 IP**（Nginx 后 `req.ip` 恒 127.0.0.1 → 全球 10 张票/小时 + 只允许 1 个游客在线）→ 新增 `src/middleware/clientIp.js` + `server.js` `applyTrustProxy` |
| E2 | ⚠️ **未修** | 多 `ai-live` 进程共享 `live/` 目录抢命令 → 用 §2 的副本变通方案（或授权后加 `AGENT_LIVE_DIR`） |

## 4. 坑清单（实测踩过，别重复踩）

1. **定位实体一律按 `id`**：世界里存在同名"米多"两条 + 一个 id 不带 `agent:` 前缀的旧 Agent；按"最近的 human"之类启发式盲选会跟错人。
2. **找活人用 `follow`，不要用 `walk_to`**：游客 2 秒才采样一次且只有 30m 视野，`walk_to` 打的是**上一帧的旧坐标**（实测真人跑开后偏差 6.43m）；`follow` 由服务端读实时位置，不受 30m 与采样率限制。
3. **签票 10 张/小时极易打满**：每次重连、每个探针都算一张；本机 `localhost(::1)` 与 `127.0.0.1` 是**两个独立窗口**（这正是 D2 在单机上的缩影）；重启服务器可清空。
4. **重启驻场进程前先清空 `live/inbox/*.json`**（目录里的旧命令文件会被立即执行）；`live/events.jsonl` 是证据文件不要删。
5. **PowerShell 坑**：内联 `node -e` 里的 `|`、`"`、`$1` 会被破坏（写脚本文件执行）；读文件用 node 不用 `Get-Content`（会被安全规则拦）；`git commit -m "中文"` 会乱码 → 用 `write_to_file` 写 UTF-8 消息文件 + `git commit -F 文件`。
6. **长跑脚本别用 `process.exit()`**：Windows 下重定向日志的 stdout 是块缓冲，会丢掉未刷新的输出 → 用 `process.exitCode` 让 Node 自然退出（或把结果写 JSON 报告文件）。
7. 后端改动需**重启服务器**（约 10~20 秒，真人端浏览器会自动重连）；前端改动需 **Ctrl+F5** 或 index.html 版本号递增。
8. **本仓库有 3 个远端**（`gitee` / `github` / `origin`，其中 origin 指向 `miduo100` 仓库而非 `miduo`）→ **推送前必须先问用户推哪个**。

## 5. 证据与验收要求

- 纯联测留证据：`examples/agent-client/live/events.jsonl`、各类报告 JSON、审计日志（`logs/audit-<date>.log` 里的 `guest_ticket_issued` / `ws_connected` / `ws_rejected` / `ws_idle_timeout` / `ws_replaced`）、以及**真人对话原文**。
- 若用户授权改代码：必须配 `scripts/accept_agent_*.js` 输出 `N/N PASS` 并给实测数据；回归必跑 `accept_agent_p1/p2/p3/p8.js`、`accept_ws_reconnect_presence.js`、`smoke_r185_world.js`。
- 已知"测试自身缺陷"教训：**断言先挂监听再触发事件**（推送按 1s 聚合，先移动后挂监听会把唯一一条 `ENTITY_MOVEMENT_BATCH` 吃掉）。

## 6. 收尾三件事（§0 协议，每会话必做）

1. 更新文档 `AI-Agent接入系统-开发规范与进度.md`：结论回填 §7（联测小节 / 检查清单勾选）+ 进度日志追加一行。
2. 写记忆（本会话里程碑 + 关键坑）。
3. git 提交（UTF-8 消息文件 + `-F`）；**收尾把 `agent_enabled` 恢复 `false`（红线 6）**；推送远端前先问用户。

## 7. 沟通规则

- 用户会在 3D 世界里用中文与你实时对话并引导操作（**你就是那个"游客 AI"**），要实时响应，并把关键结论用 `say` 回给用户（≤200 字）。
- "重构 vs 打补丁"的取舍**必须问用户**（红线 11）并说清影响面；不确定的以实测为准；发现问题比预期大先回报再决定是否缩范围。
- 上一会话遗留：本会话的游客连接已在 `00:31:39` 被空闲回收（**当前无 ai-live 驻场进程**）；服务器 3002 跑 `74f34fba` 代码；`ubuntu-deploy-package` **未同步**（清单见文档）；工作区还有未跟踪的临时脚本 `scripts/_tmp_*.js`（联测结束后清理）。
- 联测期环境（2026-09-19 08:40 实测）：`agentEnabled=true`、`pushDefault=eco`、`voiceRelay=true`、`maxAgents=50`、`maxConnectionsPerAgent=1`、`maxSpeed=12`、`observeRateKey=1`、`AGENT_IDLE_TIMEOUT_MINUTES=5`（默认）、`TRUST_PROXY` 未设（默认信任 1 层代理）。

====
