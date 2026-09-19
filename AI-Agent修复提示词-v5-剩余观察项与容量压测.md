# 下一轮提示词 · v5（剩余观察项收口 + 容量压测）

> **用法**：**新建一个对话框**，把下面 `====` 之间的全部内容粘进去作为第一条消息。
> 生成时间：2026-09-19（v4 轮「三档推送层 + 真人端观感」T1~T10 全部修复并验收后）
> 与 v4 的差别：①本轮范围从"缺陷修复"改为**三类收口**——**新动作 `stop`**、**两条一致性/安全卫生观察项（v2-2 / v2-6）**、**容量与稳定性实测（100 Agent 压测 + 30 分钟以上长会话）**；②**Agent 语音已决策不做**（不要再去实现或联测它）；③上游多了一条"发现端点清理"提交（`VOICE_MESSAGE` 已从 capabilities/openapi 移除）；④新增 §1.6「已知事实与代码坐标」，把每个改动的落点先钉死，避免重复考古。

====

你是本项目的 AI 开发助手，工作区 `l:\shegnjir185`。本会话任务 = **收口剩余观察项（新动作 `stop`、鉴权口径统一、clientIp 合并）+ 做一次容量与稳定性实测（100 Agent 压测 / 30 分钟以上长会话）**。

**流程要求**：先做 §0 开工前必做 → 复述 §1 现状 → **向用户提 §2 的 4 个决策点并拿到答复** → 复述修复范围与逐条验收判据 → 再动手改代码。
**未获用户明确授权前不要改产品代码**（只读排查、跑脚本、复述方案是允许的）。

## 0. 开工前必做（做完先复述状态，再进入 §2 决策）

1. 读唯一权威文档 `l:\shegnjir185\AI-Agent接入系统-开发规范与进度.md`，重点：
   - §0 接力协议 + 收尾三件事；**§3 红线清单**（红线 4 语音零加工、**红线 5 + 第 8 条：Agent 语音已决策不做**、红线 11 重构/语义变更必须问用户、红线 14/15 游客禁推流/半径硬钳 30m）
   - **§5.2** 消息目录（含 2026-09-19 新增的**订阅门控与半径语义**）+ 移动类回执契约（`reason ∈ arrived|superseded|target_lost|timeout|disconnected`）
   - **§5.3** 推送三档（realtime 已是真 10Hz；位置流不消耗令牌桶）
   - §7 末尾「**后续决策记录与待办**」（这就是本轮的来源）+「三档推送层与真人端观感修复」小节（T1~T10 的结果与证据）
   - §8 代码坐标速查；§9 已知坑 1~32（**坑 25/26 尤其重要**：游客动作限频按 action 分桶 1 次/2 秒；管理员登录 IP 5 次/分 + 15 次/时且成功也计数、重启服务器清空）
2. **先核对文件存在性再引用任何结论**（本项目多次发生未提交改动丢失）：
   - 产品代码：`src/agent/agentActionService.js`、`src/agent/agentMovementService.js`（`stopMove()` 目前**零调用死代码**）、`src/agent/agentSchema.js`（`AGENT_SCOPES` / `TIER_ACTION_RATES`）、`src/routes/agent/meta.js`（capabilities/openapi 两处 actions 数组）、`src/routes/agent/session.js`（`authenticateAgentToken`）、`src/routes/agent/guest.js`（自带 `clientIp()`）、`src/middleware/clientIp.js`、`src/websocket/agentWsServer.js`（upgrade 状态码映射）
   - **已知缺失（2026-09-18 文件事故未恢复，不要以为是自己删的）**：`examples/agent-client/ai-view.mjs`、`scripts/accept_agent_p4/p5/p6*.js`、`scripts/agent_federation_mock_world.js`。**发现端点（capabilities/openapi）目前没有脚本覆盖**（p6 系列缺失）→ 若本轮改动触及 `meta.js`，需自己写/扩展断言。
   - 当前 HEAD 用 `git log --oneline -3` 核对，应看到（新→旧）：`chore(agent): 发现端点移除未实现的 VOICE_MESSAGE…` → `docs(agent): 决策记录 —— Agent 语音中继不做…` → `fix(agent): 三档推送层与真人端观感修复（T1~T10 全部转绿）`。
3. 环境自检（服务器 3002 应在跑）：
   - `curl.exe -s http://localhost:3002/api/health`
   - `curl.exe -s http://localhost:3002/.well-known/virtual-world-agent.json`（看 `agentEnabled` / `limits.movementSpeed` / `pushTiers.default` / `actions`）
   - `curl.exe -s http://localhost:3002/api/agent/v1/capabilities`（看 `websocket.outboundMessages` **不应再含 `VOICE_MESSAGE`**）
   - **当前实测快照（2026-09-19 v4 轮结束时）**：`agentEnabled=false`（红线 6，联测期再开）、`pushDefault=eco`、`maxAgents=50`、`maxConnectionsPerAgent=1`、`maxSpeed=12`、`observeRateKey=1`、位置流令牌桶 60/60
   - **三个测试 Agent 已在库**（`tier_eco_87393` / `tier_std_87393` / `tier_rt_87393`），明文 API Key 与 `adminToken` 在 `scripts/_tmp_tier_agents.json`（**已 gitignore**，复用它避免烧管理员登录限流）
   - ⚠️ **tier 各轮脚本会改动/清空 Agent 落库位置**：跑 tier 验收前先 `node scripts/_tmp_tier_reset.js`（把三个 Agent 的 `agent_sessions.current_position` 清空 → 下次连接从 (0,0,0) 出生），否则 D/E 组会假失败（v4 轮 r1 首跑 41/46 就是这原因）
   - ⚠️ `accept_agent_p3.js` / `accept_agent_p8.js` 收尾会把 `agent_enabled` 置回它读到的值（多半是 false）→ 连跑回归后要开回来
4. 复述：本轮 4 件事各自的问题/现状/影响（§1.2~§1.5）、§2 的 4 个决策点、本会话要改哪几条、每条修完的验收判据。

## 1. 现状交接

### 1.1 上一轮（v4）已完成，**不要重做**

- T1~T10 全部修复并验收：tier 六轮 **48/48、12/12、17/17、13/13、20/20、7/7**；回归 14 个脚本全绿（v2_auth_guest 75/75、v2_auth_key 38/38、v2_multiend 25/25、v2_defects_fix 7/7、fix_a~f、p1 14/14、p2 14/14、p3 12/12、p8 52/52、ws_reconnect 9/9、smoke 9/9）。
- 推送语义已定稿（§5.2/§5.3）：`movement`=位置流 / `presence`=上下线 / `chat`=聊天；两者都未订阅→不推；`radius` 对位置流与 ADDED 都生效；实体首见先 `ENTITY_ADDED` 再走位置流；**realtime = 真 10Hz**（`startRealtimeLoop` 100ms 采样，实测 9.0 Hz/实体）；位置流不消耗令牌桶。
- 真人端观感：平滑器上限跟随 `limits.movementSpeed × 1.2`（+ 实测速率 EMA 兜底）；`jump` 可被真人看到（服务端 `baseY` + 客户端保留垂直偏移）。
- **Agent 语音中继 = 不做**（用户 2026-09-19）→ 本轮**不要**碰语音；`VOICE_MESSAGE` 已从 capabilities/openapi 的 outbound 列表移除，仅 `agent_voice_relay` 配置键保留占位（无实现路径）。

### 1.2 本轮要做的事 A：**新增 `stop` 动作（v2-4，P2，推荐优先做）**

**问题**：动作集 8 个（move / walk_to / follow / rotate / jump / say / interact）；`move` 是"持续位移"，但**没有任何干净的停止方式**——客户端只能 (a) 先 `observe` 拿自己坐标再 `walk_to` 到自己（会触发一次 `arrived` 回执、还有 0.5m 到达阈值），或 (b) 发另一条移动指令打断（那等于继续走）。`agentMovementService.stopMove()` 已实现但**零调用**（死代码）。LLM Agent 想"停下看看"会写出绕远路的指令——这是第一轮联调"你在原地徘徊/做了无用的走动"的**残留成因之一**（主因缺陷 I 已修）。

**影响面**：所有写 AI 客户端的开发者 + 真人端观感（AI 走位显得笨拙）。属 **API 完整性**问题，不影响既有功能。

### 1.3 本轮要做的事 B：**鉴权口径统一（v2-2，P3，成本极低）**

**问题**：同一个语义"凭据有效但**会话不存在/已被吊销**"在两处返回不同状态码：
- HTTP：**403**（`src/routes/agent/session.js:88`，`code=SESSION_NOT_FOUND` / `SESSION_REVOKED`）
- WS upgrade：**401**（`src/websocket/agentWsServer.js` 的 `handleUpgrade` 只把 `TOKEN_EXPIRED` 映射 403，其余一律 401）

**已核对的断言影响面（v4 轮实测，决定改哪一侧的关键）**：
- 固定"HTTP 会话失效 = 403"的断言：`accept_agent_p1.js`（E1 过期 JWT→403、F2 吊销后→403）、`accept_agent_v2_auth_key.js`（K6b 吊销后 `/me`→403 `SESSION_REVOKED`、K6c 吊销后 observe→403）
- WS 侧：`accept_agent_v2_auth_guest.js` 的 **C5 同时接受 401/403**，且 C5b 是一条 `R.info` 明确记录"口径不一致"（v2-2 观察项本体）
- **结论**：不一致的**只有"jti 无会话/已吊销"这一种**（过期 token 两侧都已经是 403）→ **改 WS 侧最省**：把 `SESSION_NOT_FOUND`/`SESSION_REVOKED` 也映射 403，与 HTTP 完全一致，**现有断言一条都不用改**，只把 C5b 从 `R.info` 提升为 `R.check(=== 403)`。

### 1.4 本轮要做的事 C：**`guest.js` 自带 `clientIp()` 合并（v2-6，P3，5 分钟）**

**问题**：`src/routes/agent/guest.js` 顶部自带一份 `clientIp()`：`req.ip` → **X-Forwarded-For 第一段** → socket；而 `src/middleware/clientIp.js` 的口径是 `X-Real-IP` → **XFF 最后一段** → socket（D2 联测修复的成果）。两份**相反**口径并存，好在 Express 的 `req.ip` 恒有值 → 本地函数里那个 XFF 分支**当前不可达**（死代码）。
**风险**：未来有人复制这段代码（或换端点）就会引入"**客户端伪造 XFF 第一段绕过每 IP 限流**"（游客 10 张票/小时、每 IP 1 连接）——与 D2 修复方向相反；同时让"到底按哪个 IP 计数"的排查成本变高。

### 1.5 本轮要做的事 D：**容量与稳定性实测（100 Agent 压测 + 30 分钟以上长会话）**

**目的**：把"AI 可进入的世界"从"功能可用"推进到"**承载可承诺**"，产出可直接写进运营口径的数字与配置建议。

**已核对的约束与瓶颈（先看清再设计场景）**：
- `max_agents` 当前 **50** → 压测 100 需先临时调大（后台 `Agent 接入` 卡片 / `PUT /api/agent/v1/admin/config`）。
- **游客档**：每 IP **并发 1 连接** + 每 IP **10 张票/小时** → 100 个游客 Agent 需要 **100 个不同 IP**。测试工具 `scripts/agentV2TestKit.js` 支持用 `X-Real-IP`/`XFF` 造 IP（服务端 `applyTrustProxy` 默认信任 1 层代理，本地生效）——**签票 IP 与连接 IP 必须解耦**（票不绑 IP，只有"每 IP 并发 1"看连接来源），并让每次运行的 IP 段随运行号偏移，否则重跑必 429（§9 坑 24）。
- **eco 档零推流**（这是拉模式档），主要成本 = `observe` 轮询（游客 1 次/2s → 100 Agent ≈ **50 req/s** 空间查询）+ 100 条 WS。
- **真正的结构性瓶颈在人类侧扇出**：每个移动中的 Agent 每 100ms 经 `presenceBridge.updatePosition → wsServer.broadcastToAll` 向**所有人类连接**广播一次 `POSITION_UPDATE` → `100 Agent × 10Hz × H 人类 = 1000×H msg/s`（H=10 就是 1 万 msg/s）。这是**预置设计**（§9 坑 5 已记载，与 Agent 功能无关）。
- Key 档 realtime 的成本已知：**每个移动实体 ≈1.5 KB/s/Agent**（v4 实测）；100 个 realtime Agent ≈33 Mbps + 25000 msg/s（用户已表示接受该量级，但**建议本轮给出"是否要配额/后台降级"的数据支撑**）。
- **长会话已知**：Agent JWT TTL **900s**，但 WS **只在建连时校验一次**（之后不逐消息校验）→ 连接可长期存活；空闲超时 **5 分钟**（活跃信号 = ACTION/SUBSCRIBE/UNSUBSCRIBE + **Key 档 PING** + **HTTP observe**；**游客 PING 故意不计**）→ 长会话必须周期性发信号（`examples/agent-client/ai-live.mjs` 已每 60s PING）。

### 1.6 代码坐标（写代码时直接用，已核对）

| 用途 | 位置 |
|---|---|
| 动作分发 + scope 映射 + 移动类互斥 | `src/agent/agentActionService.js`：`dispatch()` 里 `scopeForAction`（walk_to/follow→move）、`action === 'move' \|\| 'walk_to' \|\| 'jump'` 时 `followService.cancelFollow`、`switch (action)` 7 个 case + `default: unknown_action` |
| 游客动作限频表 | `src/agent/agentSchema.js` 的 `TIER_ACTION_RATES`（**未知 action 直接放行**——`checkActionRate` 无规则即 `{ok:true}`，所以新增动作必须显式加表项，否则游客可无限刷） |
| scope 白名单 | `agentSchema.AGENT_SCOPES`（`stop` 建议走 `move` scope，**不必**加白名单） |
| 停止移动 | `agentMovementService.cancelMovement(connectionId, reason)`（清 interval + 发旧任务回执）、`stopMove()`（现为死代码：`clearInterval`+`mode='idle'`+publishPosition） |
| 发现端点两处 actions 数组 | `src/routes/agent/meta.js`（capabilities 的 `actions` 来自 `buildSharedSections`，openapi 的 `x-websocket.actions` 单独一份 → **两处都要加**） |
| HTTP 鉴权状态码 | `src/routes/agent/session.js:88`（会话无效 403）、`:74`（缺 token 401）、`:101`（agent 停用 403） |
| WS 状态码映射 | `src/websocket/agentWsServer.js` 的 `handleUpgrade`：`const status = result.code === 'TOKEN_EXPIRED' ? 403 : 401;` |
| IP 口径 | `src/middleware/clientIp.js`（`resolveClientIp`）；`src/routes/agent/guest.js` 顶部自带 `clientIp()`（待删） |
| 移动回执 | `agentMovementService.notifyCompleted` / `cancelMovement(reason)`；WS 层 `ctx.reply`（`agentWsServer.handleAction`）；契约 reason 取值见 §5.2 |
| 测试工具 | `scripts/agentV2TestKit.js`（HTTP/WS/游客签票/`testIp(n)`）、`scripts/_tmp_tier_reset.js`（清出生点）、`scripts/_tmp_tier_setup.js`（建三档 Agent + 落盘 Key） |

## 2. 决策清单（**开工第一问，拿到答复再动手**）★

| # | 决策点 | 选项 | 建议默认 |
|---|---|---|---|
| D1 | **`stop` 的动作语义** | A：stop 自身回 `ACTION_COMPLETED{reason:'stopped', result:{wasMoving}}`，被打断的那条移动任务其 requestId 也收 `reason='stopped'`；**幂等**（无移动任务时也算成功 `wasMoving:false`）；同时取消 `follow`；游客限频加 `stop:[1,2000]`。B：被打断的任务复用 `reason='superseded'`。C：不做 `stop` | **A**（新增 `stopped`，语义准确；旧客户端对未知 reason 会忽略，向后兼容） |
| D2 | **v2-2 统一到哪一侧** | A（**改 WS 侧**）：`SESSION_NOT_FOUND`/`SESSION_REVOKED` 也映射 **403**，与 HTTP 一致，现有断言零改动，只把 C5b 的 `R.info` 升级为断言。B（改 HTTP 侧）：会话失效改 401，需改 `p1` E1/F2 + `v2_auth_key` K6b/K6c 四条断言。C：不改，只写文档口径 | **A**（成本 5~10 分钟，兼容全部既有断言） |
| D3 | **v2-6 是否顺手改** | A：删 `guest.js` 本地函数，改 `require('../../middleware/clientIp').resolveClientIp(req)`。B：不改 | **A**（风险≈0；验收 = `accept_agent_p8.js` 52/52 + `accept_agent_v2_auth_guest.js` 75/75） |
| D4 | **容量压测的规模与时段** | 需你指定：① Agent 数量（50 / 100 / 200）；② 档位（**eco 为主**、是否需要 realtime 对照）；③ 用游客档（省 Agent 配额，但需 100 个假 IP）还是 Key 档（需建 100 个 Agent 并保存明文 Key）；④ 可占用时段（**100 个 avatar 会让真人客户端明显变卡**）；⑤ 是否同场跑 >30 分钟长会话 | **游客档 100 个 + eco + `max_agents` 临时调 150 + 1 个真人 playwright 页面观察 FPS，同场挂 3 个 Key Agent 跑 35 分钟长会话**；压测后**务必把 `max_agents` 调回 50** |

## 3. 修复任务（分批，含根因 / 改法 / 硬约束 / 验收）

> **通用红线**：不改 `src/websocket/wsServer.js`（黑名单贴线 500 行）、`src/routes/federation.js`、`src/federationSystem.js`；单文件 ≤500 行（理想）/ ≤1000（绝对），新功能优先新文件；前端改动要在 `public/index.html` 递增版本号（本轮若不动前端则无需）。
> **语义变更（新增动作/改状态码）必须先在文档 §5.2 写清口径再落地**（红线 11）。

### 3.1 批次 A（P2）：新增 `stop` 动作

**目标行为**（建议采纳 D1-A）：`stop` 立即终止该连接上的一切移动类任务（move / walk_to / follow），Agent 原地停住并切 `idle`；**被打断的那条指令**收到 `ACTION_COMPLETED{reason:'stopped'}`，**stop 自身**收到 `ACTION_COMPLETED{requestId, result:{wasMoving}}`；无移动任务时幂等成功。

**改点（逐项核对，缺一不可）**：
1. `agentActionService.dispatch()`：`scopeForAction` 增加 `stop → move`；移动类互斥分支（`cancelFollow`）加 `stop`；`switch` 加 `case 'stop': return handleStop(ctx, payload);`
2. `handleStop`：调 `movement.cancelMovement(connectionId, 'stopped')`（它会为旧任务发回执）→ 再确保发一次 `idle` 位置（`stopMove()` 内部会 `publishPosition`，注意它只处理 `mode==='move'` 的任务；walk_to/follow 的任务要先 `cancelMovement` 再补一次 idle 广播，或扩展 `stopMove` 语义）→ 返回 `{ completed: true, requestId, result: { wasMoving } }`
3. `agentSchema.TIER_ACTION_RATES[guest]` 加 `stop: [1, 2000]`（**不加表项等于游客无限刷**）
4. `meta.js` **两处** actions 数组加 `'stop'`（capabilities 的 shared `actions` + openapi 的 `x-websocket.actions`）
5. 文档 §5.2「ACTION 七动作」→ 八动作 + 回执 reason 取值集合加 `stopped`；§7 记录本轮
6. 示例客户端 `examples/agent-client/node-agent.mjs`（可选：演示 `move` → `stop`）

**硬约束**：移动类互斥语义不变（一条移动任务只挂**一个**待回执 instruction，见 §9 坑 23）；`stop` 不得让 `walk_to` 的 `arrived` 回执丢失（若 stop 到达前 walk_to 已完成，则那条 requestId 已经收到过 `arrived`，不要重复发）；不影响人类协议。

**验收（新写 `scripts/accept_agent_stop.js`，并纳入回归清单）**：
1. `move` 后 `stop` → 位置在 1s 内停止变化（±0.3m）且 `observe.self.animMode=idle`
2. `move` 的 requestId 收到 `ACTION_COMPLETED{reason:'stopped'}`
3. `stop` 自身收到 `ACTION_COMPLETED{requestId, result.wasMoving===true}`
4. `walk_to` 途中 `stop` → 不再到达，且该 requestId 收到 `reason='stopped'`（不是 `arrived`）
5. `follow` 途中 `stop` → follow 结束（该 requestId 收 `reason='stopped'`），后续目标移动不再被跟随
6. 幂等：无任务时 `stop` → `wasMoving=false` 且不抛错
7. 游客档 `stop` 可用且 2s 内第二次 `rate_limited`（对标 §9 坑 25）
8. `capabilities.actions` 与 `openapi.x-websocket.actions` 都含 `stop`（**p6 脚本缺失 → 自己做断言**）
9. 无回归：`accept_agent_fix_c.js` 15/15、`accept_agent_fix_e.js` 12/12、`accept_agent_p3.js` 12/12、`accept_agent_v2_defects_fix.js` 7/7

### 3.2 批次 B（P3）：两条一致性 / 卫生项

**B1 v2-2 口径统一（按 D2 答复）**：改 `agentWsServer.handleUpgrade` 的状态码映射（会话不存在/已吊销 → 403），并在 `session.js` 的注释里写明"WS 与 HTTP 口径一致：401=凭据缺失/无效、403=凭据有效但会话无效或权限不足"。修完把 `accept_agent_v2_auth_guest.js` 的 C5b 从 `R.info` 改成 `R.check(status === 403)`（把观察项转正式用例）。
**验收**：`accept_agent_v2_auth_guest.js` 仍 75/75、`accept_agent_v2_auth_key.js` 38/38、`accept_agent_p1.js` 14/14、`accept_agent_p2.js` 14/14。

**B2 v2-6 clientIp 合并**：删 `guest.js` 自带 `clientIp()`，改 `require('../../middleware/clientIp')`。
**验收**：`accept_agent_p8.js` 52/52（含每 IP 签票限流与并发用例）、`accept_agent_v2_auth_guest.js` 75/75；另可用 `X-Real-IP` 造两个 IP 验证"不同 IP 可同时在线、同 IP 第二条被拒"。

### 3.3 批次 C：容量与稳定性实测（按 D4 答复的规模）

**产出物（比测试分数更重要）**：一张"承载表" + 一段可量化的瓶颈结论。
1. 新脚本 `scripts/accept_agent_capacity.js`（参数化 `N` Agent 数、档位、时长，可重跑）：
   - 用游客档或 Key 档批量上线 N 个 Agent（IP 解耦 + 运行号偏移，见 §9 坑 24）
   - 采样：进程 CPU（`process.cpuUsage` 或 OS 计数器）、内存 RSS、WS 连接数、`observe` 成功率与延迟分布（P50/P95）、`playerPositions` 条数、被拒/被踢计数
   - 记录 `max_agents` 处的拒绝行为、游客每 IP 并发拒绝行为
2. 人类侧同场观察：1 个 playwright（`channel:'chrome'` 真 GPU）读 FPS / draw calls / console error（**swiftshader 会失真，必须真 GPU**）
3. **长会话**：3 个 Key Agent（eco/standard/realtime 各一）挂 **≥35 分钟**（每 60s PING + 每 3s observe），断言：连接未断、档位不变、位置续位正常、无幽灵实体（`PLAYER_LEFT` 后不再出现在 `observe`）、内存无单调增长
4. 输出建议值：`max_agents` 推荐上限、realtime 档是否需要配额或后台降级开关、人类侧扇出的临界限（`1000×H msg/s` 何时开始显著影响真人 FPS）

**必须记录的对照数据**：Agent 数 × CPU% / RSS / observe P95 / 真人 FPS。**如果发现瓶颈在人类侧广播扇出，不要在未获授权时重构它**（那属于 §9 坑 5 的预置设计，重构要用户拍板）。

## 4. 验收与证据要求

### 4.1 本轮必须全绿的既有回归（顺序与分组见 §5，注意登录限流）

```
node scripts/accept_agent_v2_auth_guest.js      # 75/75
node scripts/accept_agent_v2_auth_key.js        # 38/38
node scripts/accept_agent_v2_multiend.js        # 25/25
node scripts/accept_agent_v2_defects_fix.js     # 7/7
node scripts/accept_agent_fix_a/b/c/d/e/f.js    # 24/24、24/24、15/15、10/10、12/12、14/14
node scripts/accept_agent_p1.js ; node scripts/accept_agent_p2.js ; node scripts/accept_agent_p3.js ; node scripts/accept_agent_p8.js
node scripts/accept_ws_reconnect_presence.js    # 9/9
node scripts/smoke_r185_world.js                # 9/9
# tier 六轮（先 node scripts/_tmp_tier_reset.js 再跑）
node scripts/accept_agent_tier_r1.js ; node scripts/accept_agent_tier_r2a.js ; node scripts/accept_agent_tier_r3_playwright.js
node scripts/accept_agent_tier_r4a.js ; node scripts/accept_agent_tier_r4b.js ; node scripts/accept_agent_tier_r5_client.js
```

### 4.2 证据要求

- 每个修复项：脚本分数（before → after）+ 报告 JSON 路径 + 关键实测数字。
- 批次 A：给出 `stop` 的完整消息序列（`ACTION_ACCEPTED`/`ACTION_COMPLETED` 与 reason）与打断前/后的位置采样。
- 批次 C：给出承载表 + CPU/内存曲线 + 真人端 FPS，并明确"哪个环节先崩"。
- 修完给用户一份「改动文件清单 + 每条判据 before/after 表格」。

## 5. 环境操作速查（本机）

```powershell
# 服务器（后端改动后重启）
netstat -ano | findstr :3002
taskkill /PID <pid> /F ; Start-Sleep -Seconds 2
Start-Process -FilePath node -ArgumentList 'src/server.js' -WorkingDirectory 'l:\shegnjir185' -WindowStyle Hidden -RedirectStandardOutput 'l:\shegnjir185\logs\server_out.log' -RedirectStandardError 'l:\shegnjir185\logs\server_err.log'

# 环境准备 / 重置（幂等）
node scripts/_tmp_tier_setup.js     # 复用已有 adminToken 与三个测试 Agent，并开 agent_enabled
node scripts/_tmp_tier_reset.js     # 清空三个 Agent 的落库位置（跑 tier 前必做）

# 单个验收
node scripts/accept_agent_tier_r3_playwright.js
```

- ⚠️ **管理员登录 IP 限流**：5 次/分钟、**15 次/小时**（成功登录也计数）→ 优先复用 `scripts/_tmp_tier_agents.json` 里的 `adminToken`；**分组跑回归、组间重启服务器清内存计数器**（v4 轮按 3 组执行全绿）。
- ⚠️ **游客签票 10 张/小时/IP**：脚本用 `X-Real-IP` 造多 IP；每次运行的 IP 段要随运行号偏移，否则重跑必 429。
- ⚠️ **前端改动必须 Ctrl+F5**（或用 `index.html` 版本号递增）。
- ⚠️ 压测/联测结束后：`agent_enabled` 回 **false**、`max_agents` 回 **50**（红线 6 + 配置复位）。

## 6. 坑清单（承接 §9 的 1~32 + 本轮新增）

1. **未知 action 在游客限频里是放行的**（`checkActionRate` 无规则即 ok）→ 新增动作**必须**同步 `TIER_ACTION_RATES`，否则游客能无限刷。
2. **发现端点有两处 actions 数组**（capabilities 的 shared `actions` 与 openapi 的 `x-websocket.actions`）→ 只改一处会造成"文档自相矛盾"。**p6 系列脚本已丢失，没有自动覆盖**。
3. **`reason` 是契约**：新增 `stopped` 后要同步文档 §5.2 的取值集合；旧客户端忽略未知 reason 属预期。
4. **一条移动任务只挂一个待回执指令**（§9 坑 23）：`stop` 打断时，回执发的是**旧任务**的 requestId；stop 自己的回执要单独回。
5. **`stopMove()` 只处理 `mode==='move'`**：对 walk_to/follow 任务要先用 `cancelMovement` 再补 idle 广播，否则停下后可能残留 `walk` 姿态。
6. **v2-2 改哪一侧决定改动量**：既有断言把"HTTP 会话失效 = 403"钉死了（p1 E1/F2、v2_auth_key K6b/K6c）→ 改 WS 侧最省。
7. **IP 口径只能有一处**（v2-6）：`middleware/clientIp.js` 是唯一权威（X-Real-IP → XFF 最后一段）；`TRUST_PROXY=false` 仅在服务直连公网时使用。
8. **压测前先想清扇出**：`100 Agent × 10Hz POSITION_UPDATE × H 人类连接`——瓶颈极可能在人类侧而非 Agent 侧；要重构广播策略必须问用户（红线 11）。
9. **真 GPU 才可信**：playwright 默认 chromium 是 swiftshader（FPS 1.8）→ 用 `chromium.launch({channel:'chrome'})` 并记录 `UNMASKED_RENDERER_WEBGL`。
10. **PowerShell 坑**：内联 `node -e` 里的 `|` `"` `$1` 会被破坏 → 写脚本文件；`git commit -m "中文"` 乱码 → `write_to_file` 写 UTF-8 消息文件 + `git commit -F 文件`。
11. **长跑脚本别 `process.exit()`**（Windows 块缓冲会丢输出）→ 用 `process.exitCode` 或落盘 JSON。

## 7. 收尾三件事（§0 协议）

1. 更新 `AI-Agent接入系统-开发规范与进度.md`：§5.2（动作集 + `reason` 取值 + 鉴权状态码口径）、§5.3（若涉及配置）、§7 新增「剩余观察项收口与容量实测」小节（含 before/after、承载表、用户决策记录）、§9 补新坑、§0 阶段说明与进度日志各更新一处。
2. 写记忆（里程碑 + 关键坑：动作集扩展的 4 个落点、两处 actions 数组、容量瓶颈在人类侧扇出）。
3. git 提交（UTF-8 消息文件 + `-F`）；**联测产物一起提交**（新脚本 + 报告 JSON + 截图）；**收尾把 `agent_enabled` 恢复 false、`max_agents` 恢复 50**；**推送远端前先问用户**（本仓库有 3 个远端）。
   - 注：`ubuntu-deploy-package` **不在本工作区**（`Test-Path` 实测 False）→ 只能输出"待同步文件清单"给用户在部署机上执行，不要把"同步部署包"写成本会话任务。

## 8. 沟通规则

- 用户会用中文实时给决策；**§2 的 4 个决策点必须先问再动手**（红线 11：语义变更/重构不打补丁式擅自决定）。
- **每完成一个批次就回报一次**（改了什么、哪个用例 FAIL→PASS、还有什么阻塞），不要一次性闷头改完。
- **批次 C 是"测"不是"改"**：先把承载表拿出来给用户看，再讨论要不要因容量结论改默认配置或做优化（优化属重构，需用户授权）。
- 改不动的（例如"人类侧广播扇出重构"）要如实说明，而不是悄悄改实现。
- 遗留：工作区仍有历史 `scripts/_tmp_*.js`（仅 `_tmp_tier_setup.js` / `_tmp_tier_reset.js` 是**有意保留**的环境前置，其余历史临时脚本已在 v4 轮清理，用户已授权删临时文件）。

====
