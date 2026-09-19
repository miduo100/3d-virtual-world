# 下一轮提示词 · v4（三档推送层 + 真人端观感修复）

> **用法**：**新建一个对话框**，把下面 `====` 之间的全部内容粘进去作为第一条消息。
> 生成时间：2026-09-19（三档 AI 联测完成：6 个可重跑脚本 + 10 条问题在案 + 1 条已决策不修 + 1 个驻场演示工具；**本轮产物未 git 提交**）
> 与 v3 的差别：①上游从"v2/v3 缺陷修复"换成"**三档推送层 + 真人端客户端观感修复**"（首次把**真人端渲染**纳入修复范围）；②新增 §1.5「三档问题总表」与 §2「决策清单（开工第一问）」；③**本轮已有现成的"修复后应自动转 PASS"的验收脚本**（§4.1），不必从零写；④新增 6 条坑（§6）。

====

你是本项目的 AI 开发助手，工作区 `l:\shegnjir185`。本会话任务 = **修复三档 AI（eco / standard / realtime）联测发现的缺陷**。

**流程要求**：先做 §0 开工前必做 → 复述 §1 现状 → **向用户提 §2 的 4 个决策点并拿到答复** → 复述修复范围与逐条验收判据 → 再动手改代码。
**未获用户明确授权前不要改产品代码**（只读排查、跑脚本、复述方案是允许的）。

## 0. 开工前必做（做完先复述状态，再进入 §2 决策）

1. 读唯一权威文档 `l:\shegnjir185\AI-Agent接入系统-开发规范与进度.md`，重点：
   - §0 接力协议 + 收尾三件事；§3 红线清单（**红线 6**：`agent_enabled` 默认 false，联测期开、收尾关；**红线 11**：重构 vs 打补丁必须问用户；**红线 14/15**：游客禁推流、游客 observe 半径硬钳 30m；**红线 4**：语音服务器零加工）
   - **§5.2** WebSocket 消息目录 + 移动类回执契约；**§5.3 推送三档**（本轮的修复对象）；**§5.4** observe 结构与实体标识契约
   - §8 代码坐标速查、§9 已知坑（本轮新增坑见 §6）
   - §7 若已有「三档联测」小节则以它为准；**若还没回填**，则以 `examples/agent-client/live/tier-suite-summary.json` 为权威（本轮检测汇总）
2. **先核对文件存在性再引用任何结论**（本项目多次发生"未提交改动丢失"）：
   - 产品代码：`src/websocket/agentWsServer.js`（571 行）、`src/agent/agentMovementService.js`、`src/agent/agentPresenceBridge.js`、`src/routes/agent/observe.js`、`public/js/agentPositionSmoother.js`、`public/js/websocket.js`
   - 本轮检测资产（**全部 untracked，见 §1.1**）
   - 当前 git HEAD 应为 **`bb3bbaf1`**（v3 修复轮；本轮检测产物尚未提交）
3. 环境自检（服务器 3002 应已在跑）：
   - `curl.exe -s http://localhost:3002/api/health`
   - `curl.exe -s http://localhost:3002/.well-known/virtual-world-agent.json`（看 `agentEnabled` / `limits.movementSpeed` / `pushTiers.default`）
   - **当前实测快照（2026-09-19 本轮结束时）**：`agentEnabled=**true**`、`pushDefault=eco`、`voiceRelay=false`、`maxAgents=50`、`maxConnectionsPerAgent=1`、**`maxSpeed=12`**、`observeRateKey=1`、`movementSpeed=12`（= maxSpeed）
   - **三个测试 Agent 已在库**：`tier_eco_87393` / `tier_std_87393` / `tier_rt_87393`（对应档位 eco / standard / realtime），**明文 API Key 存在 `scripts/_tmp_tier_agents.json`**（同文件还存着 `adminToken`，可直接复用，避免烧管理员登录限流）
   - ⚠️ `accept_agent_p3.js` / `accept_agent_p8.js` 收尾会把 `agent_enabled` 置 **false** → 连跑回归后要记得开回来
4. 复述：本轮 10 条问题各自状态（**8 条待修**：T1/T2/T3/T4/T5/T6/T8/T9；**1 条只改文档**：T10；**1 条已决策不修**：T7 见 §1.4）、§2 的 4 个决策点、本会话要修哪几条、每条修完的验收判据。

## 1. 现状交接（三档联测，2026-09-19，**只测未改代码**）

### 1.1 本轮检测资产（**全部未提交**，修复后直接复用为验收）

| 脚本 | 轮次分数 | 覆盖 |
|---|---|---|
| `scripts/_tmp_tier_setup.js` | — | 环境准备：管理员登录（token 落盘）+ 开 `agent_enabled` + 建三档 Agent（明文 Key 落盘 `scripts/_tmp_tier_agents.json`） |
| `scripts/accept_agent_tier_r1.js` | **46/48** | 三档隔离基线：未订阅是否推送 / SUBSCRIBE 回执 / 150m 半径门控 / CHAT 近远距 / walk_to 回执 / 真人侧广播频率 / observe |
| `scripts/accept_agent_tier_r2a.js` | **10/11** | 三档同场 + 6 真人：档位频率带宽、150m 覆盖、晚入场实体、Agent 互见互聊、感知盲区、**25 实体令牌桶饥饿** |
| `scripts/accept_agent_tier_r3_playwright.js` | **15/17** | 真人端（真 Chrome + GTX960 60fps）：可见性 / 🤖 / (AI)消息 / 气泡 / **移动滞后与瞬移** / 贴地 / FPS / console error |
| `scripts/accept_agent_tier_r4a.js` | **12/13** | 三档同时 follow 同一真人：收敛曲线 / **三档彼此重合（0.00m）** |
| `scripts/accept_agent_tier_r4b.js` | **19/20** | 断线重连续位 / 90s 长会话 / observe 公平性 / **第 1 档游客对照（红线全守）** |
| `scripts/accept_agent_tier_r5_client.js` | 见 §1.5 | observe 限频安全间隔 / 真人端行走动画 / **跳跃可见性（服务器 y vs 客户端 y）** |
| `scripts/agent_tier_demo.js` | — | **驻场演示**（三档 Agent 每 8s 跟随最近真人、每 20s 轮流说话）→ 用户可 `node scripts/agent_tier_demo.js` 后进世界肉眼验收 |
| `examples/agent-client/live/tier-suite-summary.json` | — | **本轮权威汇总**（10 条问题 + 证据 + 代码坐标 + 用户决策） |
| `examples/agent-client/live/tier-r1.json` … `tier-r5.json` | — | 各轮原始报告 |
| `Screenshot/_tmp_tier_r3_agents_idle.png` / `_moving.png` | — | 真人端截图存证 |

### 1.2 三档语义（当前实现事实，修复前请先确认理解一致）

- `eco`：无位置流（`startPushLoop` 整段 `continue`），CHAT 仍实时（需 `SUBSCRIBE topics:['chat']`）。
- `standard`：每 1s 一条 `ENTITY_MOVEMENT_BATCH`（含 changeSet 数组）+ `ENTITY_ADDED/REMOVED`。
- `realtime`：同一批**逐条** `ENTITY_UPDATED` —— **实测仍是 1s tick（≈1Hz/实体），不是 10Hz**。
- 位置流是否推送**当前完全不看订阅与半径**（只由 `pushTier` 决定）；CHAT 才看 `subscription.topics.has('chat')`。
- 真人端看到的 Agent 位置来自**人类侧 `POSITION_UPDATE` 广播**（`presenceBridge.updatePosition → wsServer.broadcastToAll`），**与档位无关** → 三档在真人眼里表现完全相同。**档位只决定"AI 客户端能收到什么"。**

### 1.3 本轮实测关键数据（修复时要达到的量化基线）

- 三档 15s 推送：eco 0 条；standard 14 条 batch（621 B/s）；realtime 65 条（722 B/s）—— 字节量相当。
- 令牌桶：25 实体同时移动 10s → realtime **只覆盖 20/25 实体**（5 个实体 0 条），单实体 2~9 条；standard 覆盖 25/25。
- 真人端滞后（12 m/s 走 60m）：max **21.01m** / avg **10.16m**，1 次 **20.70m** 瞬移；静止 4s 后追上（0.00m）。
- 跳跃：服务器权威 y `1.42→2.04`（观察者收到 6 条带 y 广播），真人端显示 y 恒 `1.5`（Δ0）。
- 三档 follow 同一真人：各自收敛末段 1.58~2.4m，但彼此最小距离 **0.00m**。
- observe 限频：固定 1000ms 间隔 → 1/10 次 429；1100ms 起 0 次。
- 真人端基线：3 个 Agent 可见（players 4）、🤖 前缀、(AI)加入系统消息、say 进 `#chatBox` + `.nb-bubble` 气泡、行走摆臂正常（静止旋转变化 0 vs 移动 1.82）、FPS 60、console error 0。

### 1.4 已决策：**不修**（勿当缺陷）

**T7（AI 感知不到真人的跳跃与转向）** —— 用户 2026-09-19 明确：**当前不需要**。位置流继续只比较 `pos.x / pos.z`，`y / animMode / rotation` 变化不推送。**不要修它，也不要"顺手"改。**

### 1.5 三档问题总表（10 条）

| # | 级别 | 一句话 | 根因坐标（已核对） |
|---|---|---|---|
| **T1** | **P1** | 真人端看到的 Agent 移动**严重滞后 + 周期性瞬移**（滞后 max 21m、瞬移 20.7m） | `public/js/agentPositionSmoother.js:20` `MAX_SPEED=5.4` **硬编码**、`:21` `SNAP_DISTANCE=20`；服务端 `agent_max_speed=12` |
| **T2** | P2 | 真人端**看不到 Agent 跳跃**（客户端贴地逻辑覆盖服务器 y） | `public/js/websocket.js` `snapAgentPosition()`：`y = getGroundHeight(probe) + yOffset`，仅在"地形查询失败"时才用服务器 y |
| **T3** | P2 | 位置流**不受 SUBSCRIBE 门控**（未订阅也推） | `src/websocket/agentWsServer.js` `startPushLoop()` 只判断 `state.pushTier`，未看 `state.subscription.topics` |
| **T4** | P2 | **订阅半径不生效**（radius=30 仍推 150m 外实体） | 同上，`startPushLoop()` 从未读取 `state.subscription.radius` |
| **T5** | P2 | **realtime 实为 1Hz**，与 standard 信息量等价（只多消息条数） | 同上，`startPushLoop()` 为 `setInterval(STANDARD_BATCH_INTERVAL_MS=1000)`，realtime 只是 `batch.forEach` 逐条发 |
| **T6** | P2 | **令牌桶造成实体饥饿**（25 实体时 5 个实体一条更新都收不到） | 同上，`acquireToken()`：position 桶容量 20 / 补充 10 每秒；丢弃后 `snap` 已被更新 → 永久丢失，按遍历顺序饥饿 |
| T8 | P3 | `ENTITY_ADDED` 实际不触发（新实体首次只以位置流到达） | 同上，新实体总是先进入 batch 并写入 snap，ADDED 分支永不命中 |
| T9 | P3 | 多 Agent follow 同一目标**完全重合**（0.00m） | `src/agent/agentFollowService.js` / `agentMovementService` 推进无避让；stopDistance 内停在同一点 |
| T10 | 提示 | observe 限频无抖动余量（1000ms 固定轮询 1/10 429；1100ms 起 0） | `src/routes/agent/observe.js` `rateLimitObserve()`：滑动窗口 `now-ts<1000` 且 `limit=1`，无容差 |
| ~~T7~~ | — | ~~AI 感知不到真人跳跃/转向~~ | **已决策不修**（§1.4） |

**重要结构性认知**：T3/T4/T5/T6/T8 **同源**，全在 `agentWsServer.js startPushLoop()` 这一处 1s tick 实现里 —— 建议**成批修复**，但要注意它们是**协议行为变更**（红线 11：涉及语义改变要先跟用户确认口径）。

## 2. 决策清单（**开工第一问，拿到答复再动手**）★

| # | 决策点 | 选项 | 建议默认 |
|---|---|---|---|
| D1 | **T2 是否修**（真人看不到 AI 跳） | A：也免掉（jump 只对 AI 自己有意义）；B：修（保留 jump 的观感） | **B（修）** —— 否则 `jump` 动作在真人眼里等于无效 |
| D2 | **T5 是否要真 10Hz** | A：真 10Hz（事件驱动转发）；B：不改实现，只把文档口径写清（realtime = 1Hz 逐条） | **A**，但需先给用户算清带宽（见 §3.3） |
| D3 | **T6 修法** | A：position 改"每实体合并最新 + 每 tick 每实体最多 1 条"（消除饥饿）；B：position 不受令牌桶限制（只靠背压）；C：不动 | **A** |
| D4 | **T9 是否要避让** | A：follow 目标点按 agentId 稳定偏移（环形分布 1.5~2m）；B：不动 | **A**（改动小、观感提升明显） |
| — | T3/T4/T8 的**协议语义**（默认按下面执行，若用户有异议以用户为准） | T3：位置流需订阅 `movement`；`presence` 只管 ADDED/REMOVED。T4：半径过滤对位置流与 ADDED 都生效（默认 30，SUBSCRIBE 可设 1~200）。T8：新实体先发 ADDED 再进 batch | 见 §3.2 |

## 3. 修复任务（分批，含根因 / 改法 / 硬约束 / 验收）

> **通用红线**：不改 `src/websocket/wsServer.js`（黑名单贴线，500 行）、`src/routes/federation.js`、`src/federationSystem.js`；`agentWsServer.js` 现 571 行（≤1000 可接受，但尽量克制）；前端文件改动需在 `public/index.html` **递增版本号**（`agentPositionSmoother.js?v=1` → `?v=2`、`websocket.js?v=N` → `?v=N+1`），用户需 Ctrl+F5。

### 3.1 批次 A（P1）：T1 真人端滞后 / 瞬移

**目标行为**：Agent 以 `agent_max_speed`（当前 12，可配 1~20）直线移动时，真人端显示位置与权威位置的滞后 < 3m，且**无瞬移跳变**。

**根因**：`public/js/agentPositionSmoother.js` 的追赶上限 `MAX_SPEED = 5.4` 是为"服务端 5 m/s"时代写死的常量；服务端速度已改为后台可配（用户联测时提到 12）。追赶速度 < 实际速度 → 滞后线性累积，到 `SNAP_DISTANCE=20` 时直接吸附（视觉上"突然跳 20m"）。

**建议改法**（择一，或组合；**改动前按红线 11 向用户说明"改常量"vs"改自适应"的差别**）：
- **方案 1（推荐，最小改动）**：让上限**跟随服务端配置**。服务端已在公开端点暴露该值：`GET /.well-known/virtual-world-agent.json` 与 `GET /api/agent/v1/capabilities` 的 `limits.movementSpeed`（实测 12，无需鉴权）。模块安装时 fetch 一次（失败保留 5.4 兜底），按 `max(5.4, movementSpeed × 1.2)` 设定，并每 60s 刷新（后台可热改）。
- **方案 2（自适应兜底）**：按实际观测到的目标位移速率动态抬高上限（EMA + 1.3 倍余量），clamp 到 [5.4, 30]；服务端配置端点不可用时也能追上。
- 建议同时保留 `SNAP_DISTANCE`（重连/传送大跳变仍需吸附），但可把阈值语义改为"距离 > 20m 且持续 > N 帧才吸附"，避免把"快速移动"误判为跳变。

**硬约束**：仅作用于 `group.userData.isAgent === true`（红线 9：人类玩家行为零变化）；`install()` 的"等待 gameWorld"轮询逻辑不要破坏；`getStats()` 需暴露当前生效上限（便于验收断言）。

**验收判据**：
1. `node scripts/accept_agent_tier_r3_playwright.js` → **R 由 FAIL 转 PASS**（`maxLag < 3m`）、**S 由 FAIL 转 PASS**（`jumps === 0`）；S2（静止 4s 追上 <1m）保持 PASS；T 贴地（棍人显示 y ≈1.5，判据 0~3）不得回归。
2. 脚本里的 `gl` 必须是真 GPU（`channel:'chrome'`；swiftshader 下 FPS 1.8 会把结论带偏）。

### 3.2 批次 B：T3 + T4 + T8（`startPushLoop()` 门控与语义）

**目标行为**（= 需与用户确认的协议语义，建议写入文档 §5.2/§5.3）：
- **未订阅 `movement`（也没有 `presence`）→ 完全不推位置流**（当前是"只要档位不是 eco 就推"）。
- **半径过滤对位置流与 `ENTITY_ADDED` 都生效**：`calcDist(myPos.position, p.position) > state.subscription.radius` 的实体不推（`radius` 默认 30，`SUBSCRIBE` 可设 1~200）。Key 档要看远处需显式 `SUBSCRIBE {radius: 200}`。
- **新实体先发 `ENTITY_ADDED`（在半径内且订阅 presence/movement）再进入位置流**，其后位置变化走 batch/UPDATED —— 让客户端可以用 ADDED 作为"实体出现"的可靠信号。
- 明确 `topics` 语义：`movement` = 位置流；`presence` = 实体上下线；`chat` = 聊天（已实现）。

**改点**：`src/websocket/agentWsServer.js` 的 `startPushLoop()`（第 360~408 行）：
- 循环开头加"订阅门控"（`topics.has('movement') || topics.has('presence')`）。
- 构造 batch / ADDED 前加半径判断（`state.subscription.radius`）。
- ADDED 分支调整：在"snap 里没有且半径内"时先发 `ENTITY_ADDED`，再把该实体写入 `snap` 并放进本 tick 的 batch（或首 tick 只发 ADDED，下一 tick 起走 batch —— 二选一，写进文档）。

**硬约束 / 风险（改前必须逐条核对）**：
- `state.subscription.radius` 初值 30（`agentWsServer.js:176`），`SUBSCRIBE` 时 `Math.min(200, Math.max(1, r))` —— 保持既有夹取语义。
- 门控会让"不订阅的客户端"彻底收不到位置流，**必须同步**：
  - `examples/agent-client/ai-live.mjs:149` 与 `examples/agent-client/node-agent.mjs:107` 目前只订阅 `['chat']` → 改为 `['chat','movement','presence']` 并更新 `examples/agent-client/README.md`。
  - 复核 `scripts/accept_agent_v2_multiend.js` 的 **M3 带宽/CPU 断言阈值**（半径过滤后推流量会下降，上限型断言通常仍通过，但要在报告里说明变化）。
- 已核查**无需改**的脚本（它们本来就订阅了 movement）：`accept_agent_p3.js`（D1 用例）、`accept_agent_v2_auth_key.js`、`accept_agent_v2_multiend.js`、`scripts/_tmp_d1_probe.js`。
- **不得影响**：CHAT 投递（`forwardChatToAgents` 已有自己的 `topics.has('chat')` + 30m 口径）、游客红线 14（游客订阅集合恒为空 → 永远无推送）、`follow`（服务端读 `playerPositions`，不依赖推送）。

**验收判据**：
1. `node scripts/accept_agent_tier_r1.js` → **A 阶段（未订阅无推送）与 C 阶段（150m 不推）由记录 issue 转为 PASS**（脚本断言写的就是正确行为）。
2. `node scripts/accept_agent_tier_r2a.js` → **H（150m 覆盖）转 PASS**；I（晚入场实体被感知）保持 PASS，并新增/确认 `ENTITY_ADDED` 命中（T8）。
3. 关键功能不得回归：`accept_agent_p3.js`（D1 + 档位切换）、`accept_agent_p8.js`（游客红线 12 项 + Key 订阅）、`accept_agent_v2_auth_guest.js` 75/75、`accept_agent_v2_auth_key.js` 38/38。

### 3.3 批次 C：T5 + T6（realtime 帧率与令牌桶）

> **先拿 D2 / D3 的答复再动手**（涉及推流成本与带宽，属行为变更）。

**T5 目标（若用户选"真 10Hz"）**：`realtime` 档位置流跟随服务端 10Hz 推进（`agentMovementService` 每 100ms 调 `presenceBridge.updatePosition`）。
**建议实现（事件驱动，不新增定时器）**：在 `presenceBridge.updatePosition()` 里，向"`pushTier === 'realtime'` 且订阅了 movement 且在半径内"的连接直接转发一条 `ENTITY_UPDATED`；`startPushLoop()` 的 1s tick 只保留 standard 的 batch 与 ADDED/REMOVED（realtime 分支从 tick 中移除或仅作兜底）。
**成本（必须先算给用户）**：10Hz × 实体数 × Agent 数。以 25 实体 + 1 Agent 计 ≈250 msg/s × ~150B ≈ **37 KB/s ≈ 0.3 Mbps / Agent**；100 Agent 同场 ≈ 30 Mbps —— 需要用户确认是否接受（也可加"realtime 档可被后台降级/限速"的开关）。

**T6 目标**：任何实体都不会"完全收不到更新"。**建议实现（方案 A）**：position 推送按**实体合并**——每 tick 每个实体最多 1 条"最新位置"；令牌桶改为"总量 + 背压双保护"，容量/补充率与可实现速率匹配（如容量 60 / 补充 60 每秒），**不再因桶空丢弃整批实体**；背压（`>4MB` close 1011）保持为硬保护。
**验收判据**：
1. `node scripts/accept_agent_tier_r2a.js` → **N（25 实体全部被至少推送一次）转 PASS**，且单实体条数分布不应出现 0（同时记录 `perEntityMin/Max` 供用户看均衡度）。
2. 若实现真 10Hz：新增/扩展脚本量化 realtime 档实际频率（目标 ≥8Hz/实体）与带宽（记录 B/s），并在报告里给出与 standard 的对比。
3. `accept_agent_p3.js` 的**慢消费者背压用例**（暂停读取 → 服务器 `close 1011`）不得回归。

### 3.4 批次 D：T2（真人端看不到 AI 跳跃）—— 需 D1 答复

**目标行为**：Agent `jump` 时，真人端能看到起跳（显示 y 抬升），同时**不破坏**既有的"贴地"修复（服务器无地形数据时用客户端地形高度）。

**建议改法（保留相对垂直偏移）**：
1. 服务端位置里带"地面基准"：`agentMovementService` 的 task 已有 `groundY`（`startWalkTo`/`startMove` 里的 `groundY`）→ 在 `publishPosition` 把它作为 `baseY` 一起传出；`presenceBridge.updatePosition` 把 `baseY` 放进 `POSITION_UPDATE` payload（**该广播由 presenceBridge 自建，不经过 `wsServer.handlePositionUpdate`，因此不碰黑名单文件**）。
2. 前端 `websocket.js` 的 `snapAgentPosition(position, yOffset, baseY)` 改为：
   `y = max(getGroundHeight(probe), baseY) + yOffset + (serverY - baseY)` —— 即"地形高度修正 + 保留服务器给的垂直偏移"，`baseY` 缺失时退化为现有行为（向后兼容）。
3. 人类玩家不受影响（只有 `isAgent` 走这条路径）。

**验收判据**：
1. `node scripts/accept_agent_tier_r5_client.js` → **CC「跳跃在真人端可见（显示 y 上升 >0.2m）」转 PASS**（脚本同时打印"服务器权威 y 峰值"与"客户端 y 峰值"，可直接对照）。
2. `node scripts/accept_agent_tier_r3_playwright.js` → T 贴地判据（`0 < y < 4`）保持 PASS（棍人 1.5 左右，不得浮空/埋地）。
3. 走动/跟随时的 y 不得抖动（采样显示 y 曲线，标准差接近 0）。

### 3.5 批次 E：T9（避让）+ T10（文档口径）

**T9（需 D4 答复）**：`agentFollowService` 计算目标点时，按"同一目标上的跟随者序号"给稳定偏移（例如 index × 环形角度 + 1.5m 半径，或按 `agentId` 稳定哈希），使多 Agent 不重叠。**验收**：`node scripts/accept_agent_tier_r4a.js` → **X「多 Agent 保持间距 >0.5m」转 PASS**（建议做到 >1m）；单 Agent follow 的收敛曲线（W/Z）不得回归。

**T10（只改文档，可选加容差）**：文档写明"AI 客户端 observe 轮询间隔应 ≥1.1s（推荐 1.25s）"；若要做服务端容差，把 `observe.js` 的窗口判断从 `< 1000` 放宽到 `< 950` 并保持 429 的 `retryAfter` 语义。**验收**：`accept_agent_tier_r5_client.js` 的 AA 组数据（1000/1100/1250/1500ms 四档 429 比例）作为证据；`accept_agent_fix_d.js` 10/10 不得回归。

## 4. 验收与证据要求

### 4.1 已有"修复后应自动转 PASS"的判据（**优先用这些，别从零写脚本**）

| 脚本 | 修复前 FAIL 的用例（应转 PASS 的目标） |
|---|---|
| `accept_agent_tier_r1.js` | A 组（未订阅不应收到推送）、C 组（订阅半径 30m 不应收到 150m 外） |
| `accept_agent_tier_r2a.js` | H（150m 覆盖）、N（25 实体全覆盖） |
| `accept_agent_tier_r3_playwright.js` | R（滞后 <3m）、S（无瞬移） |
| `accept_agent_tier_r4a.js` | X（多 Agent 间距） |
| `accept_agent_tier_r5_client.js` | CC（跳跃在真人端可见） |

建议在修复后用这些脚本作为**主证据**，并顺手把断言里的"疑似问题"措辞改成正式用例名（像 v3 轮把 `[已知缺陷 v2-x]` 改正式名那样）。

### 4.2 必须跑的全量回归（全绿才算完成）

```
node scripts/accept_agent_tier_r1.js
node scripts/accept_agent_tier_r2a.js
node scripts/accept_agent_tier_r3_playwright.js
node scripts/accept_agent_tier_r4a.js
node scripts/accept_agent_tier_r4b.js
node scripts/accept_agent_tier_r5_client.js
node scripts/accept_agent_v2_auth_guest.js      # 75/75
node scripts/accept_agent_v2_auth_key.js        # 38/38（SKIP_K7=1 可跳过慢用例）
node scripts/accept_agent_v2_multiend.js        # 25/25
node scripts/accept_agent_v2_defects_fix.js     # 7/7
node scripts/accept_agent_fix_a/b/c/d/e/f.js    # 24/24、24/24、15/15、10/10、12/12、14/14
node scripts/accept_agent_p1.js ; node scripts/accept_agent_p2.js ; node scripts/accept_agent_p3.js ; node scripts/accept_agent_p8.js
node scripts/accept_ws_reconnect_presence.js    # 9/9
node scripts/smoke_r185_world.js                # 9/9
```

### 4.3 证据与数据要求

- 每个修复项：脚本分数（before → after）+ 报告 JSON 路径（`examples/agent-client/live/*.json`）+ 关键实测数字（滞后 m / 频率 Hz / 带宽 B/s / 覆盖实体数）。
- **T1、T2 必须有真人端数据**（playwright 读 `gameWorld.players.get(id).group.position`），不接受只有服务端数据的结论。
- **T5 若做成真 10Hz，必须给出带宽实测**（per Agent B/s + 推算 100 Agent 用量）供用户做成本决策。
- 修完给用户一份"改动文件清单 + 每条判据 before/after 表格"。

## 5. 环境操作速查（本机）

```powershell
# 服务器（后端改动后重启）
netstat -ano | findstr :3002
taskkill /PID <pid> /F ; Start-Sleep -Seconds 2
Start-Process -FilePath node -ArgumentList 'src/server.js' -WorkingDirectory 'l:\shegnjir185' -WindowStyle Hidden -RedirectStandardOutput 'l:\shegnjir185\logs\server_out.log' -RedirectStandardError 'l:\shegnjir185\logs\server_err.log'

# 环境准备（幂等：会复用已有 adminToken 与三个测试 Agent）
node scripts/_tmp_tier_setup.js

# 驻场演示（用户肉眼验收：三个 Agent 跟随真人 + 定时说话）
node scripts/agent_tier_demo.js        # Ctrl+C 停止

# 单个验收
node scripts/accept_agent_tier_r3_playwright.js
```

- ⚠️ **管理员登录 IP 限流**：5 次/分钟、**15 次/小时**（成功登录也计数）→ 不要每个脚本都重新登录；优先复用 `scripts/_tmp_tier_agents.json` 里的 `adminToken`；计数器在内存，**重启服务器即清空**。
- ⚠️ **测试 Agent 的明文 Key 只在创建时返回一次** —— 已存 `scripts/_tmp_tier_agents.json`；若要重建 Agent，跑 `_tmp_tier_setup.js`（它会创建**新名字**的 Agent，旧的可从后台删除）。
- ⚠️ **游客签票 10 张/小时/IP**：脚本用 `X-Real-IP` 造多 IP（`K.testIp(n)`），别用真实 IP 硬跑。
- ⚠️ **前端改动必须 Ctrl+F5**（或 `index.html` 版本号递增）否则用户看到的还是旧逻辑。

## 6. 坑清单（承接既有 + 本轮新增 7 条）

1. **三档推送层高度集中**（新增）：T3/T4/T5/T6/T8 同源于 `agentWsServer.js startPushLoop()` 一处 —— 改动前先把"新语义"写成表（哪个 topic 管哪类消息、半径怎么算、ADDED 什么时候发），否则容易改出"客户端收不到任何位置流"的静默故障。
2. **前端 `snapAgentPosition` 会丢弃服务器 y**（新增，T2 根因）：任何"服务器算出的垂直位移"都会被贴地逻辑抹平；改法是"地形高度修正 + 保留相对偏移"，不要直接删贴地逻辑（会退回半身埋地）。
3. **平滑器常量硬编码 vs 服务端可配**（新增，T1 根因）：本项目"服务端可配、客户端写死"的组合已两次踩坑（`agent_max_speed`、`agent_push_default`），改配置类功能时**同时检查客户端是否写死**。
4. **真 GPU 才可信**（新增）：playwright 默认 chromium 是 swiftshader（FPS 1.8），会把"平滑追赶"结论放大失真；必须 `chromium.launch({channel:'chrome'})`，并在报告里记录 `UNMASKED_RENDERER_WEBGL`（本机=GTX 960）。
5. **console error 的 favicon 404**（复述）：错误文案**不含 URL**，必须用 `m.location().url` 判定（本轮再次踩到，导致假 FAIL）。
6. **observe 1Hz 滑动窗口无余量**（新增，T10）：脚本轮询间隔写 1.2s 左右；本轮曾用 0.94s 导致 7/16 次 429 被误判成"公平性问题"。
7. **`agent_enabled` 当前是 true**（本轮结束状态），收尾务必恢复 false（红线 6）；`accept_agent_p3.js`/`p8.js` 跑完会把它置 false，连跑回归要开回来。
8. **PowerShell 坑**（沿用）：内联 `node -e` 里的 `|` `"` `$1` 会被破坏 → 写脚本文件；`git commit -m "中文"` 乱码 → `write_to_file` 写 UTF-8 消息文件 + `git commit -F 文件`。
9. **长跑脚本别 `process.exit()`**（Windows 块缓冲会丢输出）→ 用 `process.exitCode` 或落盘 JSON。
10. **推送类行为变更牵一发动全身**：改 `startPushLoop` 后必须回归 `accept_agent_p3.js`（档位切换 + 慢消费者背压）、`accept_agent_p8.js`（游客红线）、`accept_agent_v2_multiend.js`（带宽/CPU）。

## 7. 收尾三件事（§0 协议）

1. 更新 `AI-Agent接入系统-开发规范与进度.md`：§5.2/§5.3 写入**新的推送语义**（订阅门控 / 半径过滤 / ADDED 时机 / realtime 真实频率），§7 新增「三档联测与修复」小节（10 条问题 + 每条 before→after 判据 + 用户决策记录），§9 补新坑，§0 阶段说明与进度日志各更新一处。
2. 写记忆（里程碑 + 关键坑：推送层同源、客户端写死常量、真 GPU 才可信）。
3. git 提交（UTF-8 消息文件 + `-F`）；**本轮检测产物（6 个脚本 + 汇总 JSON + 演示脚本 + 截图）一起提交**；**收尾把 `agent_enabled` 恢复 `false`**；推送远端前先问用户（本仓库有 3 个远端）。

## 8. 沟通规则

- 用户会用中文实时给决策；**§2 的 4 个决策点必须先问再动手**（红线 11：重构/语义变更不打补丁式擅自决定）。
- 每完成一个批次就回报一次（改了什么、哪个用例 FAIL→PASS、还有什么阻塞），不要一次性闷头改完。
- 改不动的（例如"真 10Hz 的带宽成本")要如实算给用户，而不是悄悄降级实现。
- 遗留：`ubuntu-deploy-package` **未同步**（历轮清单见文档）；工作区仍有历史临时脚本 `scripts/_tmp_*.js`（多轮联测结束后统一清理，用户已授权删临时文件）。

====
