# AI-Agent 修复提示词 · v6（长驻客户端续期 + 测试覆盖补全 + 可选重构）

> **用法**：**新建一个对话框**，把下面 `====` 之间的全部内容粘进去作为第一条消息。
> 生成时间：2026-09-20（v5 轮「剩余观察项收口 + 100 Agent 容量与长会话实测」之后，commit `de2d2355`）
> 与 v5 的差别：
> ① v5 的三条观察项（v2-4/v2-2/v2-6）已**全部收口**，本轮不再有"遗留观察项"，改做**v5 实测暴露出的新缺口**；
> ② 本轮首次出现 **P1 级重构候选（人类侧扇出）**——**需你拍板**，方案提纲见 §2/D2；
> ③ 本轮**不改任何协议语义**（除 README 文档口径同步）；产品代码预期改动仅 **1 个示例客户端**；
> ④ 主体工作量在 **脚本/文档**：把 2026-09-18 事故丢失的测试覆盖补回来。

====

你是本项目的 AI 开发助手，工作区 `l:\shegnjir185`。本会话任务 = **补完 v5 实测暴露的三个缺口**：
**① 长驻客户端会话续期（真缺陷）② README 文档口径过期 ③ 测试脚本覆盖补全**；外加**测试侧口径收口**；
并按你的决策决定是否启动 **P1 人类侧扇出重构**。

**流程要求**：先做 §0 开工前必做 → 复述 §1 现状 → **向用户提 §2 的 5 个决策点并拿到答复** → 复述修复范围与逐条验收判据 → 再动手改代码。
**未获用户明确授权前不要改产品代码**（只读排查、跑脚本、复述方案是允许的）。

## 0. 开工前必做（做完先复述状态，再进入 §2 决策）

1. 读唯一权威文档 `l:\shegnjir185\AI-Agent接入系统-开发规范与进度.md`，重点：
   - §0 接力协议 + 收尾三件事；**§3 红线清单**（红线 4/5 语音不做、红线 11 重构需拍板、红线 14/15 游客禁推流+半径硬钳 30m）
   - **§5.2**：八动作（含 `stop` 语义）、移动类回执 `reason ∈ arrived|superseded|stopped|target_lost|timeout|disconnected`、
     **鉴权状态码口径（401/403）**、**⚠️ 会话有效期与续期（v5 新发现）**
   - **§5.3** 推送三档；§7 末尾 **「剩余观察项收口与容量实测」**（v5 结果 + 承载表 + 承载结论）；§8 代码坐标；**§9 坑 1~38**
2. **先核对文件存在性再引用任何结论**（本项目多次发生未提交改动丢失）。本轮涉及的文件：
   - `examples/agent-client/ai-live.mjs`（+0. 见 §1.6 坐标）、`examples/agent-client/node-agent.mjs`、`README.md`
   - `scripts/accept_agent_p3.js`（收尾硬编码关闭总闸）、`scripts/_tmp_tier_setup.js`、`scripts/_tmp_agent_switch.js`（v5 新增）
   - 缺失确认（2026-09-18 事故未恢复，**属重建而不是重写产品**）：`scripts/accept_agent_p4.js`、`accept_agent_p5.js`、
     `accept_agent_p6.js`、`accept_agent_p6_playwright.js`、`scripts/agent_federation_mock_world.js`、`examples/agent-client/ai-view.mjs`
   - `git log --oneline -3` 应为（新→旧）：`de2d2355`（v5 轮）→ `a54aa4d7` → `e40a0d7c`
3. 环境自检（服务器 3002 应在跑）：
   ```powershell
   curl.exe -s http://localhost:3002/api/health
   curl.exe -s http://localhost:3002/.well-known/virtual-world-agent.json      # 看 auth.sessionTtlSeconds / actions / tiers
   curl.exe -s http://localhost:3002/api/agent/v1/capabilities                 # outboundMessages 不应含 VOICE_MESSAGE
   ```
   **v5 收尾快照**：`agentEnabled=false`（红线 6）、`pushDefault=eco`、`maxAgents=50`、`maxConnectionsPerAgent=1`、`maxSpeed=12`、`observeRateKey=1`
4. **联测环境前置（v5 新增，必读）**：
   - `_tmp_tier_agents.json` 有 3 个 Key Agent 与可复用的 `adminToken` → **优先复用它，别反复登录**（管理员登录 IP 限流 5 次/分 + **15 次/小时，成功也计数**，§9 坑 26）
   - **每个要开总闸的脚本组前面跑一次** `node scripts/_tmp_agent_switch.js true`；全部跑完再 `false`（红线 6）
     —— 原因：`accept_agent_p3.js` 收尾**硬编码** `agent_enabled=false`，且多个历史脚本有一条
     `V0/P0 agent_enabled=true（联测期前置）` 判据在**干净态必然假失败**（§9 坑 35）
   - 游客签票 10 张/小时/IP：脚本用 `X-Real-IP` 造假 IP 且运行号要偏移（§9 坑 24）
5. 复述：本轮 A/B/C/D 各自的问题与现状（§1.2~§1.5）、§2 的 5 个决策点、本会话要改哪几条、每条修完的验收判据。

## 1. 现状交接

### 1.1 v5 轮已完成，**不要重做**（commit `de2d2355`）

- **v2-4 新增 `stop` 动作**：被打断指令收 `reason='stopped'`、stop 自身回 `{result:{wasMoving}}`、幂等、停下补一次 `idle` 广播、游客限频 `[1,2000]`；`accept_agent_stop.js` **24/24**
- **v2-2 会话失效统一 403**（`agentWsServer.FORBIDDEN_UPGRADE_CODES`，与 HTTP 一致）→ `v2_auth_guest` **76/76**（C5b 转正式断言）
- **v2-6 IP 口径合并**到 `middleware/clientIp` → `p8` **52/52**
- **回归 13 脚本全绿**：fix_a 24/24、fix_b 24/24、fix_c 15/15、fix_d 10/10、fix_e 12/12、fix_f 14/14、p1 14/14、p2 14/14、p3 12/12、v2_defects_fix 7/7、v2_multiend 25/25、ws_reconnect 9/9、smoke 9/9
- **容量实测**（`accept_agent_capacity.js` **12/12**，100 游客 eco + 3 Key + 2 人类观察者）：CPU **0.079 核**均值（峰值 30.9% 单核）、RSS 90→92MB、observe 276 ok/**0 个 429**、**人类侧扇出 116.7 msg/s（每移动 Agent ≈11.7 msg/s/人类连接）**、真 GPU 页 **60FPS/players=105/0 console error**、两道闸均 `ERROR + close 1013`
- **长会话核心结论（本轮 A 的由来）**：**Agent JWT TTL 900s 只在 WS 建连时校验，HTTP 端点每次调用都校验** → t≈15min 起 `observe` 全 403 `TOKEN_EXPIRED`；机制实证 `accept_agent_jwt_expiry.js` **6/6**；修正后长会话脚本 **9/9**

### 1.1b 为什么要修：**世界内可感知的表现**（写验收脚本时按这个对齐）

| 项 | 谁受影响 | 世界里看到什么 | 触发条件 |
|---|---|---|---|
| **A · Key 档** | 长驻 AI + 看见它的真人 | 连接**不断**，但 AI **"瞎"了**：① **还会回话**（WS CHAT 推送与 `say` 不受影响，头顶气泡照常）② **但不再对世界有反应**（`observe` 403 → 看不到新玩家/物体/坐标，距离判断全失效）③ **行动退化**：答"好的"然后**原地不动**（拿不到目标坐标）；若失明前最后一条是 `move`，服务端会**继续推进该任务直到 ±1000 世界边界**，观感 = "AI 头也不回地走远、最后贴在世界边界卡住" | 上线 **15 分钟**后 |
| **A · 游客档** | 同上 | 更"干净"：**AI 整个消失**（票 30 分钟到期 → `observe` 403，且**游客 PING 不计活跃** → 约 5 分钟后空闲超时踢出 → 真人端 `PLAYER_LEFT` + 系统消息"xxx 离开了"） | 上线 **30~35 分钟**后 |
| **B · README** | SDK 作者写出的所有 AI | 间接表现：文档只写 6 个动作（漏 `follow`/`stop`）→ AI **不会跟着人走、停不下来**（一直走/原地绕圈，即第一轮联调"原地徘徊/做了无用的走动"）；文档无续期说明 → 必然踩 A | 持续 |
| **C · 覆盖缺失** | 未来的外部 AI | 当前**无表现**；未来某次改坏发现端点时 → AI "**反复收到动作不存在/权限不足而卡住**"或"**一直等一个永不到来的消息而沉默**" | 未来 |
| **D · 测试口径** | 只影响联测流程 | 总闸被关时"所有 AI 都进不来/全部消失"（自伤）；真正代价是把**测试配置问题误判成产品故障**去改代码 | 联测时 |
| **P1 · 人类侧扇出** | 真人玩家 | 当前**无表现**（100 Agent 仍 0.08 核、真 GPU 页 60FPS）；规模上来后 = **帧率下降、转视角/走位发涩，AI 密集区最明显**（公式：移动中 Agent 数 × 11.7 msg/s × 人类连接数） | 未来规模 |

**一句话**：**A 是"现在就会发生、玩家能看见"**；B 把 A 与"AI 走位笨拙"复制给每个 SDK 作者；C/D 防未来事故与误判；P1 属规模问题。
**不受影响**：短会话 demo、真人玩家（7 天 JWT + 滑动续期）、服务端与世界本身、v5 已验收的 13 个回归脚本。

### 1.2 本轮要做的事 A：**长驻客户端不会续期（真缺陷，P0）**

**问题**：`examples/agent-client/ai-live.mjs`（长驻驻场客户端）只在启动时换一次票，之后只有 `PING` 保活。
按 v5 的机制结论 → **用 Key 档长驻超过 15 分钟后，它的周期 `observe`（HTTP）与 `chat/history` 轮询开始全部 403**，
而 WS 还活着 → 客户端表面"在线"（还能 say/移动），实际**"看得见世界 + 拉聊天"的能力静默失效**。
> 这也解释了 2026-09-19 那次「驻场 Key Agent 上线 15 分钟」的现象（当时只归因于空闲超时）。

**影响面**：所有写长驻 Agent 的人（示例客户端是 SDK 作者的第一参照）；真人联测的驻场 AI 会在 15 分钟后"变哑"。

### 1.3 本轮要做的事 B：**README 文档口径过期（P1 文档）**

**问题**（已核对）：
- `README.md` 的 AI Agents 章节标题仍是 **`### The Six Actions`** —— 实际已是 **八动作**（`follow` 于 2026-09-19 加、`stop` 于 v5 加）
- **完全没有会话有效期/续期说明**（grep `900`/换票/续期 命中 0）→ SDK 作者必踩 §1.2 的坑
- 游客档"30 分钟票 + 换票会换身份"没有说明

### 1.4 本轮要做的事 C：**测试覆盖补全（2026-09-18 事故丢失，P2）**

**问题**：以下脚本/工具在 2026-09-18 文件事故中丢失且**未恢复**，导致对应能力**没有自动化守护**：

| 缺失 | 现在没人守护什么 | 风险 |
|---|---|---|
| `scripts/accept_agent_p6.js` | **发现端点**（well-known / capabilities / openapi 三处同源、动作清单、outbound 列表、limits 与后台配置一致、`agent_enabled=false` 时仍 200） | **最高**：发现端点已被连着改两轮（移除 `VOICE_MESSAGE`、actions + `stop`），下次改错没人拦 |
| `scripts/accept_agent_p4.js` | 行动系统 + 聊天记录（say→CHAT+落库、`chat/history`、admin Agent 端点） | 中 |
| `scripts/accept_agent_p5.js` + `scripts/agent_federation_mock_world.js` | 跨世界联邦传送（nonce 重放、不建 user/character、TTL≤300、iss/aud、can_teleport=false） | 中（改动少但最复杂） |
| `examples/agent-client/ai-view.mjs` | 分步体验客户端（discover/session/me/observe/enter/act/history） | 低（示例） |

> 注：v5 在 `accept_agent_stop.js` 里临时断言了"三处动作清单 + `actionRates.stop`"，**无长期覆盖**。

### 1.5 本轮要做的事 D：**测试侧口径收口（P3，低成本）**

1. `scripts/accept_agent_p3.js` 收尾**硬编码** `agent_enabled=false` / `push_default=eco` / `max_agents=50`（约 306~308 行）
   → 改为**恢复运行前读到的值**（与 `fix_a~f`、`v2_*` 等脚本一致），消除"连跑回归必须手动重开闸"的坑（§9 坑 35）
2. `scripts/_tmp_tier_setup.js` 每次运行**新建 3 个 Agent**（DB 累积：`tier_eco_*` / `tier_std_*` / `tier_rt_*` 多批）
   → 改为"已存在同名/同 pushTier 的测试 Agent 就复用（含重新签发 Key）"，保持幂等
3. 可选：加一个**测试数据清理脚本**（`scripts/_tmp_cleanup_test_agents.js`），删除历史 `p1_test_agent`、`p4_pw_agent_*`、`fix*_agent_*`、多批 `tier_*`（仅预览→确认两段式，参照 `adminMaintenanceCharAssets.js` 的危险脚本先例）

### 1.6 代码坐标（已核对，直接引用）

| 用途 | 位置 |
|---|---|
| `ai-live.mjs` 会话变量（`let token`） | `examples/agent-client/ai-live.mjs:110`（Key 分支）/ `:121`（游客分支） |
| `ai-live.mjs` 周期 observe（用 token） | `:164-176`（`fetch(HOST+'/api/agent/v1/observe?radius=100')`） |
| `ai-live.mjs` 聊天历史轮询（用 token） | `:180-200`（`/chat/history?limit=30`） |
| `ai-live.mjs` 保活 PING | `:158-160`（每 60s） |
| `ai-live.mjs` 状态/事件落盘 | `writeState()` `:83`、`emit()` `:79` |
| 续期所需的服务端字段 | well-known `auth.sessionTtlSeconds=900` / `auth.guestSessionTtlSeconds=1800`；`POST /api/agent/v1/session`（Key）/ `POST /api/agent/v1/guest/session`（游客） |
| 游客换票**会换身份** | `src/routes/agent/guest.js` → `agentAuth.buildGuestIdentity()` 每次生成新的 `agent:guest:<uuid>` |
| README 待改位置 | `## AI Agents`（约 329 行）、`### Identity & Permission Model`（372）、**`### The Six Actions`（381）**、`### Push Tiers`（394）、`### Quick Start — Run the Reference Client`（412） |
| `accept_agent_p3.js` 收尾 | `:306-309`（`setConfigValue('agent_enabled','false')` 等三行） |
| `_tmp_tier_setup.js` 创建 Agent | `:67-85`（`specs` 三个 + POST `/admin/agents`） |
| 环境前置（v5 新增） | `scripts/_tmp_agent_switch.js`（`node ... true|false` 复用 adminToken 开/关总闸） |
| 发现端点实现 | `src/routes/agent/meta.js`（`buildSharedSections` / `ENTITY_IDENTITY` / `x-websocket` / paths） |
| 长会话/容量脚本（可复用参考） | `scripts/accept_agent_longsession.js`、`accept_agent_capacity.js`、`accept_agent_jwt_expiry.js` |

## 2. 决策清单（**开工第一问，拿到答复再动手**）★

| # | 决策点 | 选项 | 建议默认 |
|---|---|---|---|
| D1 | **`ai-live.mjs` 续期策略** | **A**：只给 **Key 档**做自动续期（读 well-known `sessionTtlSeconds`，按 `ttl×2/3` 续期，续期只更新 `token` 变量，WS 不动）；**游客档不续期**（游客换票会生成**新身份** `agent:guest:<uuid>`，与已建 WS 连接的 presence 身份不一致 → 应在票到期后**整进程重启换票重连**，代码里写清注释 + 状态落盘）。B：两档都续期（游客会出现"HTTP 用新身份 / WS 用旧身份"的错位）。C：不做，只在文档写清 | **A** |
| D2 | **是否本轮启动「人类侧扇出重构」**（P1，v5 承载表的唯一结构性瓶颈） | **A**：本轮**只出方案，不动代码**（推荐：先评审）；**B**：本轮实施；C：暂不讨论。 方案提纲（现状 → 改后 → 影响面）：<br>现状 = `wsServer.handlePositionUpdate` 用 `broadcastToAll` 全量广播 `POSITION_UPDATE`，成本 = 移动 Agent 数 × ~11.7 msg/s × 人类连接数（100 Agent 全动 + 10 真人 ≈ 11,700 msg/s）。<br>改后 = 按**半径**（如 60~100m，与前端视距同量级）或**订阅**投递，只发给"看得见这个实体"的连接；可先做**采样降频**（真人 60Hz → 10Hz）。<br>影响面 = **动黑名单贴线文件 `src/websocket/wsServer.js`（约 500 行）的既有广播语义**，人类协议字段不变但**投递范围变窄**（相邻玩家仍在半径内，观感无变化；远处玩家本来看不见）；需回归 `ws_reconnect_presence` 9/9 + `smoke_r185_world` 9/9 + 双真人互见用例；**必须你拍板**（红线 11 + §9 坑 5 属预置设计） | **A**（先方案） |
| D3 | **是否补测 standard / realtime 档的大批量容量** | A：本轮补测（在 v5 容量脚本上加 `--tier` 参数，Key 档需建 N 个 Agent 且每个都要明文 Key）；B：不补（已知 realtime ≈1.5KB/s/Agent，100 个 ≈33Mbps，用户此前表示接受） | **B** |
| D4 | **聊天归档链路是否本轮实测** | A：做（需你提供 S3 兼容存储：OSS/COS/MinIO 的 endpoint/bucket/AK/SK；否则只能验"未成功上传的本地数据永不删"这条红线）；B：不做，仅在文档标记未实测 | **B** |
| D5 | **测试覆盖补全的范围** | A：**只补 p6（发现端点守护）**；**B**：p6 + p4（行动/聊天）；**C**：全补（p6 + p4 + p5 + mock world + ai-view） | **B**（p6 优先，p4 次之；p5 需 mock 桩较大，可延后） |

## 3. 修复任务（分批，含根因 / 改法 / 硬约束 / 验收）

> **通用红线**：不改 `src/websocket/wsServer.js`（黑名单贴线）、`src/routes/federation.js`、`src/federationSystem.js`；
> 单文件 ≤500 行（理想）/≤1000（绝对），新功能优先新文件；示例客户端改动不需要前端版本号。
> 本轮**不改协议语义**；`ai-live.mjs` 属示例（非产品运行时），但它是 SDK 第一参照，改动要**保持向后兼容**。

### 3.1 批次 A（P0）：`ai-live.mjs` 自动续期

**目标行为**（按 D1-A）：Key 档长驻时，HTTP 凭据永不过期；游客档明确"不续期、到期重连"。

**步骤 0（先复现症状，约 2 分钟，强烈推荐做——形成 before 证据）**：
不必真等 15 分钟：用 `AGENT_JWT_SECRET` **自签一个"短命但 jti 指向有效会话"的 token** 把窗口压缩到 2 分钟
（手法与 `scripts/accept_agent_jwt_expiry.js` 完全一致）：
1. `POST /api/agent/v1/session`（API Key）→ 记下 token 里的 `jti`（base64 解 payload）
2. 自签 `{ sub, principalType:'agent', worldId, scopes }` + `jwtid: <该 jti>` + `expiresIn: 120`
3. 用这个 token 连 `/ws/agent`（**应成功**，因为此刻仍未过期）→ 等 ~130s
4. 断言（这就是"变木头人"的根因现场）：
   - `observe` / `/me` → **403 `TOKEN_EXPIRED`**（HTTP 侧已死）
   - **WS 仍 `readyState === 1`**、`say` 仍回 `ACTION_COMPLETED`、`move` 仍回 `ACTION_ACCEPTED`（WS 侧活着）
   - `observe` 失败时若客户端只靠 observe 保活 → 再等 5 分钟会被 `ws_idle_timeout` 踢出（可选，验证"游客式消失"路径）
   > 这 4 条即 `accept_agent_live_renew.js` 的 **before 组**；批次 A 实现后的"续期组"（4 分钟跑、0 次 403）为 **after 组**。

**改法（逐项）**：
1. 启动时读 `GET /.well-known/virtual-world-agent.json`，取 `auth.sessionTtlSeconds`（缺省 900）与 `auth.guestSessionTtlSeconds`（缺省 1800）；失败则用缺省值并记一条 warn（**不能让 well-known 失败拖垮客户端启动**）
2. 抽出 `refreshSession()`：Key 档 → `POST /api/agent/v1/session`（Bearer API Key）；成功后 `token = r.body.token`（**`token` 已是闭包内 `let`，两个周期任务会自动读到新值，不需要改 observe/history 的代码**）→ `writeState({ tokenRefreshedAt, tokenExpiresAt })` + `emit({ dir:'session', event:'refreshed', expiresIn })`
3. 定时器：`setInterval(refreshSession, ttl * 1000 * 2/3)`（900s → 10 分钟）；**首轮不立即续期**；失败时**指数退避重试**（最多 3 次，间隔 5/15/45s），仍失败则 `log` + `emit` 告警但**不退出**（WS 还在，客户端还能动）
4. **游客档不续期**：在 `:158` 保活段旁边写清注释（换票会换身份 → HTTP 身份与 WS presence 身份错位），并把票到期时间写入 `state.json`（`guestTicketExpiresAt`），到期后 `log` 明确提示"请重启进程重新签票"
5. 顺带在文件头"用法"段补一句：**Key 档可长期驻场（自动续期）；游客档票 30 分钟，到期需重启**

**硬约束**：不改 WS 连接、不改 `?token=` 建连方式（WS 用旧 jti 是设计使然，§5.2）；不改既有的聊天去重逻辑（缺陷 G）；`node-agent.mjs`（短命 demo）**不需要**续期，但可在末尾加一行注释指向 ai-live 的续期实现。

**验收（新写 `scripts/accept_agent_live_renew.js`，可重跑；含 before/after 对照）**：
1. **before 组**（复现，2 分钟）：用"步骤 0"的自签短命 JWT，断言 `observe`/`/me` 403 `TOKEN_EXPIRED` 而 **WS 仍 `readyState=1`** 且 `say`/`move` 仍可用 → 证明"变木头人"是真实现象
2. **after 组**：用 Key 档启动 `ai-live.mjs` 子进程（环境变量 `AI_LIVE_REFRESH_MS` 把续期间隔压到 **60s** 以便短跑），运行 ≥4 分钟，断言：
   - `events.jsonl` 里 `dir:'observe'` 计数持续增长且 **0 次 403**（HTTP 能力全程在线）
   - `state.json` 出现 **≥3 次** `tokenRefreshedAt` 变化（确实在续期）
   - `events.jsonl` 中 `ws closed` 计数为 **0**（WS 未重连，符合 §5.2 设计）
3. **对照组**（可选，直接复用 v5 结论）：`AI_LIVE_REFRESH_MS=0`（关闭续期）→ observe 出现 403；若跑满 15 分钟成本高，可只引用 `accept_agent_jwt_expiry.js` 的 6/6 作为机制证据
4. 无回归：`accept_agent_longsession.js --minutes=6 --allow-short --refresh-min=2` 仍 **9/9**
5. 报告要求：把 **before 组与 after 组的原始断言并列**贴进用户交付（这正是"修前/修后世界内表现"的证据）

### 3.2 批次 B（P1 文档）：README 同步

**改法（逐项）**：
1. `### The Six Actions` → **`### The Eight Actions`**：补齐 `follow`（服务端持续跟随）与 `stop`（停止一切移动类任务）的说明与回执 `reason` 取值集合（`arrived|superseded|stopped|target_lost|timeout|disconnected`）
2. 新增小节 **`### Session Lifetime & Renewal`**（放在 `### Identity & Permission Model` 之后）：JWT TTL 900s / 游客票 1800s；**WS 只在建连时校验、HTTP 每次校验**；**Key 档每 <15 分钟（推荐 10 分钟）调 `POST /session` 换票，WS 无需重连**；游客换票会换身份 → 到期重连；参考实现指向 `examples/agent-client/ai-live.mjs`
3. `### Push Tiers` / `### Quick Start`：核对与 `.well-known` 实际字段一致（`auth.sessionTtlSeconds` / `tiers` / `limits`），不一致处以**端点返回值**为准
4. 顺带核对 §"Architecture Invariants (Engineering Red Lines)" 内动作清单/语音条目与文档 §3 红线一致

**硬约束**：**只改文档，不改代码**。双语现状**已核对**：`README.md` 有 AI Agents 章节（上面 4 处要改）；**`README_CN.md` 没有 AI Agents 章节**（grep `Agent`/`sessionTtl` 命中 0）。
→ **B-5（可选，需用户确认口径）**：中文版是否同步？**建议本轮只改英文版**（工作量可控、避免大段新写）；若要同步，则在 `README_CN.md` 新增一节中文「AI Agent 接入」并在 `README.md` 的对应小节互相引用（属文档新增，不含代码改动）。

**验收**：断言 README 中不出现 "Six Actions"；出现 "Eight Actions" 与 "Session Lifetime & Renewal"（可用 `findstr`/`Select-String` 断言）；人工复核列出的 4 处内容与 `/.well-known` + `/capabilities` 实测一致（把实测 JSON 关键字段贴进报告）。

### 3.3 批次 C（P2）：补回测试脚本（按 D5 答复）

**C-1 `scripts/accept_agent_p6.js`（发现端点守护，最高优先）** 判据建议：
1. `GET /.well-known/virtual-world-agent.json` → 200，且含 `protocolVersion/world/endpoints/auth/tiers/scopes/actions/pushTiers/limits/entityIdentity/session`
2. `GET /api/agent/v1/capabilities` → 200；其**共享段**（`tiers/scopes/actions/pushTiers/limits/entityIdentity`）与 well-known **deep-equal 逐字一致**（缺陷 F/H 的守护）
3. `actions` 为 **8 个**且集合 === `openapi['x-websocket'].actions` === `openapi.paths['/action'].post.requestBody...enum`（**三处一致**，§9 坑 33）
4. `websocket.outboundMessages` 与 `openapi['x-websocket'].outbound` 一致，且**不含 `VOICE_MESSAGE`**（红线 5 决策的守护）
5. `tiers['guest-pull'].actionRates` 含全部 8 个动作键，且 `stop === [1,2000]`
6. `openapi.paths` 的 key 集合 === 白名单 11 项（不得出现未实现端点）
7. **`agent_enabled=false` 时三个发现端点仍 200**（临时关闸再开，注意用 `_tmp_agent_switch.js`）
8. `limits.movementSpeed` / `limits.maxAgents` 与 admin config 的 `agent_max_speed` / `max_agents` 一致（防文档漂移）

**C-2 `scripts/accept_agent_p4.js`（行动系统 + 聊天记录）** 判据建议：
`say` → 真人侧收 CHAT 且 `world_chat_log` 增 1 行（DB 计数）→ `GET /chat/history` 可读回；`teleport` → `ACTION_REJECTED scope_denied`（红线 2）；admin 端点 list/create/disable/enable/regenerate-key/delete 各 1 条；observe 的 `objects[].description`（AI 描述）字段存在

**C-3 `scripts/accept_agent_p5.js` + `scripts/agent_federation_mock_world.js`（联邦传送）**（若 D5=C）：mock World B（3003）实现 `/api/federation/handshake` + `/info` + `/api/agent/federation/teleport/accept`；判据沿用文档 §7「P5」小节的 5 组（身份/Avatar 跨世界不变、nonce 重放 409、无 email 建号（users/characters 表行数前后不变）、两端可见进出、`can_teleport=false` 与未信任目标被拒）

**C-4 `examples/agent-client/ai-view.mjs`**（若 D5=C）：分步体验（discover/session/me/observe/enter/act/history），零依赖，输出可读

**硬约束**：新脚本一律放 `scripts/`，单文件 ≤500 行；脚本不得 `require('../src/...')` 里的**运行时状态**（除 P5 mock 桩需要起独立进程）；报告落 `examples/agent-client/live/*.json`（该目录已 gitignore → 提交需 `git add -f`）；**不要在脚本里硬编码"总闸必须已是 true"的判据**（§9 坑 35）

**验收**：每个新脚本自身全绿；并在报告中给出"此前无覆盖 → 现在 N/N"的 before/after。

### 3.4 批次 D（P3）：测试侧口径收口

1. `accept_agent_p3.js:306-309` → 改为恢复运行前读到的 `agentEnabled / pushDefault / maxAgents`（保留 `[cleanup]` 日志但打印"恢复了什么"）
2. `_tmp_tier_setup.js` → 幂等：先 `GET /admin/agents` 找同名或同 `pushTier` 的测试 Agent，存在则复用（若原 Key 不可用则 `regenerate-key`），不存在才创建；**不要**再重复堆积
3. 可选清理脚本（两段式：`--preview` 默认 / `--confirm` 真删）

**验收**：`p3` 12/12；连跑 `p3 → v2_auth_guest → p8 → v2_auth_key` **不需要**中途手动开闸（这是本批的核心价值）；`_tmp_tier_setup.js` 连跑两次，`agents` 表行数不变

## 4. 验收与证据要求

### 4.1 本轮必须全绿的既有回归（分组执行，注意登录限流 §9 坑 26）

```
# 每组前： node scripts/_tmp_agent_switch.js true
node scripts/accept_agent_stop.js               # 24/24（v5 新增，作回归）
node scripts/accept_agent_v2_auth_guest.js      # 76/76
node scripts/accept_agent_v2_auth_key.js        # 38/38
node scripts/accept_agent_v2_defects_fix.js     # 7/7
node scripts/accept_agent_fix_a/b/c/d/e/f.js    # 24/24、24/24、15/15、10/10、12/12、14/14
node scripts/accept_agent_p1.js ; node scripts/accept_agent_p2.js ; node scripts/accept_agent_p3.js ; node scripts/accept_agent_p8.js
node scripts/accept_agent_v2_multiend.js        # 25/25
node scripts/accept_agent_jwt_expiry.js         # 6/6
node scripts/accept_agent_longsession.js --minutes=6 --allow-short --refresh-min=2   # 9/9
node scripts/accept_ws_reconnect_presence.js    # 9/9 ACCEPTED
node scripts/smoke_r185_world.js                # 9/9
# tier 六轮（先 node scripts/_tmp_tier_reset.js）
node scripts/accept_agent_tier_r1.js / r2a.js / r3_playwright.js / r4a.js / r4b.js / r5_client.js
# 容量（可选，2~3 分钟；会临时抬高 max_agents，收尾自动复位）
node scripts/accept_agent_capacity.js 50 --duration=30 --movers=5 --no-browser
```

### 4.2 证据要求

- 每项：脚本分数（before → after）+ 报告 JSON 路径 + 关键实测数字
- 批次 A：给出 `events.jsonl` 中"续期前后 observe 状态"片段 + `state.json` 的 `tokenRefreshedAt` 序列 + **WS 未重连**证据
- 批次 B：把 well-known / capabilities 实测片段与 README 改后文字并列贴出（人工可核对）
- 批次 C：每个新脚本的判据表 + before（无覆盖）→ after（N/N）
- 收尾给用户一份「改动文件清单 + 每条判据 before/after 表格」

## 5. 环境操作速查（本机）

```powershell
# 服务器（后端改动后重启；⚠️ 若审批提示不可用，请让用户手动执行下面这行）
netstat -ano | findstr :3002
taskkill /PID <pid> /F ; Start-Sleep -Seconds 2
Start-Process -FilePath node -ArgumentList 'src/server.js' -WorkingDirectory 'l:\shegnjir185' -WindowStyle Hidden -RedirectStandardOutput 'l:\shegnjir185\logs\server_out.log' -RedirectStandardError 'l:\shegnjir185\logs\server_err.log'

# 环境准备 / 前置
node scripts/_tmp_agent_switch.js true            # 开总闸（每跑一组回归前）
node scripts/_tmp_agent_switch.js                 # 只看当前配置
node scripts/_tmp_tier_setup.js                   # 复用 adminToken + 三个测试 Agent（批次 D 后应幂等）
node scripts/_tmp_tier_reset.js                   # 清三个 Agent 落库位置（跑 tier 前必做）

# 长跑脚本要用**后台启动 + 日志轮询**（前台会超时）
Start-Process -FilePath node -ArgumentList 'scripts/accept_agent_longsession.js','--minutes=6','--allow-short','--refresh-min=2' -WorkingDirectory 'l:\shegnjir185' -WindowStyle Hidden -RedirectStandardOutput 'l:\shegnjir185\logs\longsession_out.log' -RedirectStandardError 'l:\shegnjir185\logs\longsession_err.log'
```

- ⚠️ **管理员登录 IP 限流**：5 次/分钟、15 次/小时（**成功也计数**）；优先复用 `_tmp_tier_agents.json` 的 `adminToken`（批次 D 可把更多脚本改为复用）
- ⚠️ **PowerShell 内联 `node -e` 的引号/`$1`/`|` 会被破坏** → 一律写脚本文件执行（§9 坑 10）
- ⚠️ **长跑脚本别 `process.exit()`**（Windows 块缓冲丢输出）→ 用 `process.exitCode`
- ⚠️ 收尾：`agent_enabled` 回 **false**、`max_agents` 回 **50**（红线 6 + 配置复位）

## 6. 坑清单（承接 §9 的 1~38 + 本轮预告）

1. **`ai-live.mjs` 的 `token` 是闭包内 `let`**，两个周期任务（observe `:168`、history `:182`）每次调用时才读它 → **续期只需给它重新赋值**，不必改这两个 `fetch`。别把 token 拷到局部常量里。
2. **游客换票会换身份**：`buildGuestIdentity()` 每次新 uuid → 续期会出现"HTTP 新身份 / WS 旧身份"错位（observe 的 `self` 变 (0,0,0)）。**游客档不做续期**，到期重启进程重连。
3. **well-known 是发现入口，不能在 `agent_enabled=false` 时 200 才依赖它**：客户端读 ttl 要用"拿不到就用缺省值"的写法（发现端点虽然公开，但网络/版本差异都可能失败）。
4. **发现端点的动作清单是三处**（§9 坑 33）：补 p6 脚本时必须三处一起断言，否则下次仍会漏。
5. **`accept_agent_p3.js` 收尾会关总闸**（§9 坑 35）：本批 D 修完前，连跑回归**务必每组前 `_tmp_agent_switch.js true`**。
6. **服务端闸门顺序**（§9 坑 34）：`max_agents` 先于每 IP 名额 → 测每 IP 并发必须先让总闸有余量。
7. **测试脚本自身的三类口径错误**（v5 踩过，§9 坑 38）：距离函数缺数据返回 `null` 不要 `Infinity`；续期/重连探活用 `/me` 而非有限频的 `observe`；跨 Agent 比较基准必须是**同一个 Agent**。
8. **P1 扇出重构是语义/投递范围变更**（红线 11）：即使投递范围收窄在观感上无差异，也必须先出方案让用户拍板，**不要擅自改 `wsServer.js`**。

## 7. 收尾三件事（§0 协议）

1. 更新 `AI-Agent接入系统-开发规范与进度.md`：§0 阶段说明（本轮结论 + 下一会话入口）、§5.2（若涉及）、§7 新增「长驻客户端续期与覆盖补全」小节（含 before/after 表 + 决策记录）、§9 补新坑、进度日志追加一行
2. 写记忆（里程碑 + 关键坑：ai-live 续期只改 `token` 引用、游客换票换身份、发现端点三处清单、p3 收尾关闸）
3. git 提交（**UTF-8 消息文件 + `git commit -F`**；`examples/agent-client/live/` 被 gitignore → 报告用 `git add -f`）；**推送远端前先问用户**（本仓库有 3 个远端）
   - 收尾把 `agent_enabled` 恢复 **false**、`max_agents` 恢复 **50**
   - 注：`ubuntu-deploy-package` **不在本工作区** → 只输出"待同步文件清单"，不要把"同步部署包"写成本会话任务

## 8. 沟通规则

- 用户会用中文实时给决策；**§2 的 5 个决策点必须先问再动手**（红线 11）
- **每完成一个批次就回报一次**（改了什么、哪条 FAIL→PASS、还有什么阻塞）
- 批次 C 是"补测试"不是"改产品"：新脚本先给用户看判据清单再写
- 改不动的（例如"人类侧扇出重构"未获授权）要如实说明，而不是悄悄改实现

====
