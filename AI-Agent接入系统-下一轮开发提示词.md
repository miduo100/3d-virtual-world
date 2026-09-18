# 下一轮开发提示词（复制到新会话即可）

> 用法：新建一个对话框，把下面 `====` 之间的全部内容粘进去作为第一条消息。
> 生成时间：2026-09-18（第一轮真人×Agent 联测结束后）

====

你是本项目的 AI 开发助手，工作区 `l:\shegnjir185`。本会话任务：**按文档修复第一轮真人联测发现的问题**（代码已解冻，进入开发）。

## 0. 开工前必做（按顺序，做完先复述状态再动手）

1. 读 `l:\shegnjir185\AI-Agent接入系统-开发规范与进度.md`，重点：
   - §0 接力协议、§3 红线清单（13 条 + P8 补的 2 条）
   - §5.4「实体标识契约」（2026-09-18 新增）
   - §7「多轮联测与缺陷待办」（本轮全部工作项，含实测证据与代码坐标）
   - §8 代码坐标速查、§9 已知坑
2. **先核对文件存在性再引用任何结论**（本项目已发生两次"未提交代码被删"事故，见进度日志 2026-09-14 / 2026-09-18）：确认 `src/agent/*`、`src/routes/agent/*`、`src/websocket/agentWsServer.js`、`src/services/logger.js`、`public/js/agentPositionSmoother.js`、`examples/agent-client/*` 都在且非 0 字节。
3. 工作区有大量**未提交改动**（P8 + Agent 管理增强 + 上传 AI 描述 + WS 重连守卫 + 本轮文档改动），**禁止回滚/覆盖**；本会话结束按 §0 收尾三件事提交（含这些既有改动，提交前用 `git status` 逐项确认）。
4. 复述：当前状态 / 本会话要做的条目 / 预计分几批。

## 1. 本次范围（**按批次做，每批做完停下来让用户真人实测一轮，不要一次全做完**）

### 第一批（P0，先做这两个，做完请用户实测）
- **A. `self` 与 `distance` 基准修正**
  - 目标：`GET /observe` 返回的 `self.position` 与所有实体的 `distance` 原点，必须是该 Agent 的**真实位置**。
  - 现状：只有 `session.current_position` 一条来源（`src/agent/agentObservationService.js` 约 36-49 行「观察点解析」），纯 HTTP 会话（无 WS）恒为 `(0,0,0)` → 客户端距离全错（本轮"原地徘徊"直接原因）。
  - 建议：解析顺序改为 `query x/z → playerPositions 中该 agent 的实时位置（多条取带 animMode/最新的一条）→ session.current_position → (0,0,0)`。**注意：self 与 distance 共用同一个 pos 变量，改一处即可同时修正，但要确认两者都吃到新值。**
  - 验收：①纯 HTTP 会话（无 WS）与 ②有在线 WS 连接的会话，两种身份调 observe，`self` 都等于真实位置；`distance` 与自行计算一致（误差 <0.1m）；写进 `scripts/accept_agent_fix_a.js`。
- **B. 同一角色的多条连接：实体去重 + 新连接顶掉旧连接**
  - 现状：`collectEntities()`（`agentObservationService.js:201-221`）遍历 `playerPositions`（**按 connectionId 存**）时以 `p.characterId` 作为 `id` 输出，**未去重** → 同角色多连接会出现**同 id 两条**（一条真实位置、一条 `animMode:null` 停在出生点）；audit 日志里同一 agentId 会反复 `ws_connected`/`ws_idle_timeout`。
  - **重要事实（用户实测指正）**：真人端**看不到两个 avatar**（前端按 characterId 只画一个），因此这不是"两个角色"问题；怀疑两条连接各自广播 `POSITION_UPDATE`，同一个 avatar 被两个位置源来回拉扯 → 表现为"移动时原地徘徊"。**请不要改人类侧 `public/js/websocket.js` 的玩家管理逻辑**，在服务端 Agent 侧解决。
  - 做法：①`entities` 按 `characterId` 去重（同 id 只保留一条，优先带 `animMode`/最新位置）；②同一 agentId 新连接顶掉旧连接——在 `agentWsServer` 的 connection 建立处维护 agentId→ws 映射并 `close(4004, 'REPLACED_BY_NEW_CONNECTION')` 旧连接，**新逻辑放新模块（如 `src/agent/agentConnectionRegistry.js`），`agentWsServer.js` 只做最小接线（该文件已贴 500 行线）**；③可选 `max_connections_per_agent` 配置（system_config，默认 1）。
  - 验收：同一 API Key 开两条连接 → `observe` 只返回该 id **一条**；旧连接收到 4004 并触发既有 `PLAYER_LEFT` 清理；audit 有 `ws_replaced` 事件；真人端移动不再被拉扯（请用户实测确认）。写进 `scripts/accept_agent_fix_b.js`。

### 第二批（P1，第一批实测通过后做）
- **C. 新增 `follow` 动作（跟随/持续目标）**
  - 现状：只有一次性 `walk_to`，客户端必须高频重发，且每次重发都会 `cancelMovement` + 重建 10Hz interval（`src/agent/agentMovementService.js:65, 68-83`）→ 走走停停；本轮 6 分钟下发 220+ 条 walk_to。
  - 做法：新模块 `src/agent/agentFollowService.js`（≤500 行）实现 `follow{targetId, stopDistance=2, maxDurationMs=60000}`：每 tick 从 `playerPositions` 按 **id** 读目标位置（**不要用 name 匹配，见 §5.4 契约**）→ 5m/s 限速推进 → 进入 `stopDistance` 内停住（animMode=idle）→ 目标消失/超时/被新指令打断 → 发 `ACTION_COMPLETED/REJECTED` 带 `reason`。scope 用 `move`（与 walk_to 同口径，注意 `walk_to` 曾因不在 scopes 名单被误拒的坑）。同 agentId 只允许一个移动任务（互斥：follow 与 walk_to 互相打断）。
  - 验收：目标直线移动 30s，跟随距离稳定在 `stopDistance+1m` 内；目标消失 → 正确结束；写进 `scripts/accept_agent_fix_c.js`。
- **E. `walk_to` 到达回执**
  - 现状：实测 `ACTION_ACCEPTED=221` 而 `ACTION_COMPLETED=16`（全是 say 的 `delivered`）→ 到达只能靠客户端轮询位置推断，1Hz 下延迟 1~3s。
  - 做法：在 `tickWalkTo` 的到达分支补发 `ACTION_COMPLETED {requestId, reason:'arrived'}`，被打断/超时补发带 `reason`；需要把"回执发送器"（send 回调）在 `startWalkTo` 时注入，**不要为此重构 movement service**。旧客户端收到未知回执只会忽略，向后兼容。
  - 验收：walk_to 一条指令 → 收到 1 条 ACCEPTED + 1 条 COMPLETED，时间差 ≈ 距离/5s；被打断时收到带 reason 的 COMPLETED。写进 `scripts/accept_agent_fix_e.js`。

### 第三批（P1）
- **D. Key 档闭环采样率**
  - 现状：`src/routes/agent/observe.js:33-67` 对非游客 tier 硬限 1Hz（实测频繁 429），推流 `ENTITY_UPDATED` 实测也只有约 1Hz；跟随误差 1~3m。
  - 做法（二选一或都做，默认必须**向后兼容**）：①新增 system_config `agent_observe_rate_key`（默认 1，可调 5~10Hz），`observe.js` 读取；②realtime 档位置流按固定帧率聚合批量下发（可复用 standard 档 `ENTITY_MOVEMENT_BATCH` 的实现）。
  - 验收：默认值行为与现在完全一致（不改变既有验收结论）；调高后限频按新值生效、超频仍 429、`retryAfter` 正确。写进 `scripts/accept_agent_fix_d.js`。

### 第四批（P2）
- **F + H. 实体标识契约与发现端点对齐**
  - §5.4 已固化契约：`entities[].id`(=characterId) 是唯一标识、`name` 仅供显示（游客同名是常态）、`chat/history.senderId` 与 `entities[].id` 同一命名空间（实测逐字一致）、同角色多连接需先去重再定位。
  - 做法：把该契约以机器可读形式补进 `GET /api/agent/v1/capabilities`（如 `entityIdentity` 段：`uniqueIdField:'id'`、`aliases:['characterId']`、`chatSenderIdEqualsEntityId:true`、`nameIsDisplayOnly:true`），并让 `/.well-known/virtual-world-agent.json` 与 `/capabilities` **共用同一数据源**（当前 well-known 有 `limits`/`tiers` 明细而 capabilities 没有，属不一致）；`openapi.json` 的 observe 描述同步。
  - 验收：两处端点字段一致、契约字段可机器读取；写进 `scripts/accept_agent_fix_f.js`。
- **G. 示例客户端聊天去重**（客户端侧，非服务端缺陷）
  - `examples/agent-client/ai-live.mjs` 同时用 WS `CHAT` 推送 + `/chat/history` 轮询，同一条真人消息记两遍 → 按 `(senderId, createdAt, message)` 去重，或二选一。

### 明确不在本次范围
Vision / 服务器侧 STT / 百度网盘归档 provider（§7 P7 三项，用户已定不做）；跨世界联邦增强；任何涉及 `federation.js` / `federationSystem.js` 的改动。

## 2. 约束（违反即返工）

- 遵守 §3 红线全部 13 条 + P8 追加 2 条（游客禁推流、游客 observe 半径硬钳 30m）。
- **单文件 ≤500 行**（理想），绝对 ≤1000；**新功能一律新建文件**；黑名单文件零追加：`federation.js`、`federationSystem.js`、`src/routes/world.js`、`geometryBuilder.js`、`admin.js`、`templates.js` 等。
- **`src/websocket/wsServer.js` 与 `src/websocket/agentWsServer.js` 都贴 500 行线**：新逻辑放新模块，这两个文件只做最小接线（改完 `wc -l` 确认不超 500）。
- 人类侧链路一行都不能坏：`/ws` 根路径兜底分流（铁律）、`/api/auth/*`、传送、语音、附近聊天、`POSITION_UPDATE` 广播格式。
- 前端改动必须递增 `public/index.html` 的 `?v=` 版本号；后端改动要重启服务器（3002）才生效。
- 不改 `public/admin.html` 既有代码，只插标记，新逻辑放新 js 文件。
- 迁移 SQL 放 `database/migrations/add_*.sql`（幂等 `IF NOT EXISTS`）并登记 `src/database/db.js` 迁移数组。
- 新增 npm 依赖必须登记 `package.json`（否则下次 `npm install` 会被清掉）。

## 3. 验收要求（每一条都要有可重跑的证据，禁止"应该没问题"结案）

1. 每个条目一个 `scripts/accept_agent_fix_*.js`，输出 `N/N PASS`，并给出实测数据（距离/耗时/回执条数等）。
2. 回归必跑：既有 `scripts/accept_agent_p1/p2/p3/p8.js`、`scripts/accept_ws_reconnect_presence.js`、`scripts/smoke_r185_world.js`。
3. 真人联测（A/B/C/E 建议做）：服务器 3002 ➜ 用户真人浏览器进场 ➜ 你用 `examples/agent-client/ai-live.mjs` 驻场（`AGENT_HOST=http://localhost:3002 AGENT_API_KEY=<用户提供的 Key>`，Key 名 `workbuddy`）+ `scripts/_tmp_follow.js` 跟随。注意：**重启驻场进程前先清空 `examples/agent-client/live/inbox/*.json`**（历史命令文件会被立即执行，本轮就被一个旧 `__stop` 意外结束过），`live/events.jsonl` 是证据文件不要删。
4. 环境：`agent_enabled` 联测期间为 true，**联测结束按红线恢复 false** 并写进文档；`agent_push_default` 与各 Agent 的 `push_tier` 以用户后台设置为准。

## 4. 收尾三件事（§0）

1. 更新文档：§7「多轮联测与缺陷待办」逐条勾选并**回填实测结论**（做了什么、实测数据、仍未解决的部分）；§0 的阶段说明从"代码冻结·多轮联测"更新为新的阶段状态；进度日志追加一行。
2. 写记忆（本轮里程碑 + 关键坑）。
3. git 提交：`write_to_file` 写 UTF-8 提交信息文件 + `git commit -F 文件`（PowerShell 直接 `-m` 中文会 GBK 乱码）。

## 5. 沟通规则

- 遇到"重构 vs 打补丁"的取舍**必须问用户**（红线 11），并说清重构前后的结构与影响面。
- 每批做完先让用户实测，再进下一批；用户随时可能在 3D 世界里跟你对话（你是 `workbuddy`），要实时响应。
- 不确定的以实测为准；发现文档与代码不一致时，**先改文档记录事实，再改代码**。
- 发现问题比预期大，先回报再决定是否缩范围，不要静默降级实现。

====
