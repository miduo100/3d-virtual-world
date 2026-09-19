# AI Agent 接入虚拟世界 — 开发规范与进度

> 创建：2026-09-17 ｜ 状态：**P0-P6 + P8 全部完成并验收**（2026-09-18 P8 拉/推双模式完成，52/52 PASS；P7 占位不做）
> 本文档是 **AI Agent 接入功能的唯一权威进度记录**，参照《Three.js-r185-升级规划与规范.md》的接力模式运作。

---

## 第〇节：接力协议（新会话必读）

### 开场
用户说 **"继续 Agent 接入开发"** 即恢复上下文。新会话必须：
1. 先读本文档第 7 节进度表，**复述当前状态**（已完成什么、正在做什么、下一步做什么）；
2. 按"下一步"继续开发，**不要重做已完成阶段，不要重新代码审计**（P0 结论已固化在第 2、8 节）；
3. 每阶段开工前先读第 3 节红线清单。
4. **注意当前阶段（2026-09-19 起）**：代码已解冻，进入 **第一轮联测缺陷修复** 阶段——按第七节「多轮联测与缺陷待办」逐条修复。第一批 A/B（P0）、第二批 C/E（P1）、第三批 D（P1）、第四批 F/G/H（P2）均已修复并验收；联测中另**新发现 I（walk_to 推进起点用会话快照 → 位置每 4 秒循环）与 J（新会话出生点 (0,0,0) → 重连瞬移）两项 P0 级缺陷**，已一并修复。
   **2026-09-19 v2 轮（登录/鉴权边界 + 多端同时在线）按用户指令"只测不改代码"完成**，见第七节「v2 登录与多端联测」：3 个可重跑矩阵脚本（游客 72/75、Key 38/38、多端 25/25）+ 6 条新缺陷待办（**v2-1 为 P1：WS 瞬时断开致每 IP 名额/幽灵实体/在线名额三项永久泄漏，实测 3/3**）。
5. **注意当前阶段（2026-09-19 v3 轮，代码已解冻）**：v2-1（P1）与 v2-3（P2）**已修复并验收**（见第七节「v2 登录与多端联测」的**修复结果**与新增的「v3 缺陷修复轮」小节）：监听器前置注册 + readyState 兜底解决瞬时断开泄漏；`move`/`jump` 注入 `{ requestId, reply }` 补发 `ACTION_COMPLETED{superseded}`。矩阵复跑 **游客 75/75、Key 38/38、多端 25/25**，专项脚本 `accept_agent_v2_defects_fix.js` **7/7**，既有回归全绿。
6. **下一步待用户决策**：v2-2（`SESSION_NOT_FOUND` 口径统一 401/403）、v2-4（是否新增 `stop` 动作）、v2-5（多 Agent 跟随同一目标的错位偏移）、v2-6（`guest.js` 的 `clientIp()` 与中间件合并）——**四条均为观察项，改前须用户拍板（红线 11）**；或继续深化联测（Agent 间语音、>30 分钟长会话、100 Agent 压测等，见 `AI-Agent联测提示词-v3-缺陷修复与深化联测.md` §3）。

### 收尾三件事（每会话结束前必做）
1. **更新第 7 节进度表**（checkbox 状态 + 日期 + 会话摘要）；
2. **写记忆**（阶段里程碑）；
3. **git 提交**（commit message 用 write_to_file 写 UTF-8 文件 + `git commit -F 文件`，PowerShell 直接 -m 中文会 GBK 乱码）。

**工作区不留半成品。**

---

## 第一节：目标与一句话架构

**目标**：让外部 AI Agent（GPT/Claude/Qwen/自研）成为这个世界的一等公民——拥有身份、Avatar、感知与行动能力，被真人玩家实时看见，未来可跨世界移动。

**一句话架构**：

> Agent 通过 **HTTP API + 专用 WebSocket（/ws/agent）** 直接进入世界（不用浏览器）；
> 其存在被写入服务端内存 `playerPositions`，复用现有 `PLAYER_JOINED / POSITION_UPDATE / CHAT` 广播管线；
> **真人浏览器零大改**即可看到 AI 的 3D Avatar（GLB 由浏览器自行下载渲染）。

两扇门的分工：
- **AI 的门**：HTTP（observe/session）+ WS（事件流/行动）→ 纯 JSON，无画面；
- **AI 被看见的门**：真人的浏览器 → 3D 渲染（服务器只发"坐标 + URL 字符串"）；
- **唯一焊接点**：`src/websocket/wsServer.js:13` 的 `playerPositions` Map（经 `agentPresenceBridge` 模块写入）。

---

## 第二节：P0 代码审计结论（已完成 2026-09-17，勿重做）

### 2.1 核对过的关键事实（含代码坐标）

| # | 事实 | 坐标 |
|---|---|---|
| 1 | WS 与 HTTP 共用 3002 端口，`new WebSocket.Server({ server })` 不带 path，**接受任意路径 upgrade** | `src/server.js:515-521`、`src/websocket/wsServer.js:22` |
| 2 | **人类 WS 无任何认证**；PLAYER_JOIN 直接接受客户端提交的 characterId/位置/GLB，零校验 | `wsServer.js:24, 225-241` |
| 3 | `POSITION_UPDATE` 客户端权威，且 `broadcastToAll` **全量广播**（非 nearby） | `wsServer.js:295-316` |
| 4 | `playerPositions`（Map）+ `activeConnections`（Map）在内存，已导出 getter | `wsServer.js:13-14, 493-498` |
| 5 | **`CONFIG.WS_URL` 没有路径**——浏览器连的是根路径 `ws://host/`（不是 /ws！） | `public/js/config.js:60` |
| 6 | `worldSpatial.js` `/around` 空间查询可复用（方框范围+广告位+geometry_data 批量回填+file_size） | `src/routes/worldSpatial.js:127-202` |
| 7 | Avatar 六件套字段齐全：glbUrl/animUrls/weaponConfig/boneMapConfig/weaponSocketConfig/calibrationConfig（+isSelfContainedBundle） | `wsServer.js:226, 244-259` |
| 8 | 前端 `addPlayer()` 已接全部字段；isGuest=true → 星星粒子 + "(游客)加入了" | `public/js/world.js:1773`、`public/js/websocket.js:224-259` |
| 9 | **坐标传送功能已存在**（`teleportToCoord`），游客限制是**纯前端 if 拦截** | `public/js/portalManager.js:476-482`（传送门拦截 :272-277） |
| 10 | Federation RS256 + trustedWorlds + iss/aud 齐备；teleport token 偏 Human（userId/email） | `src/federationSystem.js:380-441, 465-469` |
| 11 | **nonce 防重放被明确跳过**（生成但不存不校验） | `federationSystem.js:471-473` 注释 |
| 12 | 目标世界按 email 找/建本地 user（'FEDERATED_USER'） | `src/routes/federation.js:755-772` |
| 13 | 语音 = base64 opus 中继 30m（原样转发，服务器零加工）；同时说话人数制 | `src/websocket/voiceRelay.js:224-269`，协议注释 :8-22 |
| 14 | voiceRelay 注入 activeConnections/playerPositions —— Agent 进表即自动获得语音/聊天收听 | `wsServer.js:90-95` |
| 15 | 聊天 CHAT 走 30m nearby 投递（服务端权威 characterId） | `wsServer.js:158-178` |
| 16 | 端口：`process.env.PORT || 3000`，实际 .env PORT=3002；world_url 存 system_config | `server.js:485`、`server.js:376-471` |
| 17 | README 的 Nginx 配置 `location /` 无 Upgrade 头 → 严格照抄部署域名后真人 WS 连不上；`location /ws` 有头但没人连 | `README.md:255-278` |
| 18 | 用户 JWT 校验中间件（JWT_SECRET）+ 滑动续期可参考但**不与 Agent JWT 混用** | `src/middleware/auth.js` |
| 19 | **玩家间实时聊天/语音完全无持久化**（纯内存广播，无 chat 表）；唯一例外 = NPC 对话有 `npc_chat_history`（`npc.js:416-421`、`init.sql:391`） | P4 聊天记录功能的立项依据 |

### 2.2 七处关键修正（相对最初方案）

1. **Upgrade 路由不能只认 /ws**：必须 `/ws/agent` → Agent，**其余一切路径（含 `/`）→ 人类**（兜底），否则全量破坏现有浏览器客户端。
2. Agent 主键用合成 ID `agent:<uuid>`，防与真人 UUID 撞键（前端以 characterId 为唯一 key）。
3. `federation.js`(33KB)/`federationSystem.js`(33KB)/`routes/world.js`(26KB) 是黑名单大文件，**零追加**——Agent Federation 全部新建文件，只读复用 federationSystem 的 trustedWorlds/密钥。
4. 单文件 ≤500 行硬规则 → routes/agent 拆成 index/session/observe/action/federation/meta 六个小文件。
5. Agent 移动必须服务端节流（10Hz 上限 + 距离阈值），且复用现有 `POSITION_UPDATE` 消息类型（前端不认新类型）。
6. Agent 进 playerPositions 后会被算进语音名额/CHAT 投递 → 条目必须带 `entityType:'agent'`，用于①不占语音名额 ②前端 AI 标识。
7. 服务端**没有**地面/碰撞数据（全在前端 capsuleCollision BVH）→ 第一版移动只做：最大速度+世界边界(±1000m)+平面地面 y+距离校验。不做地形贴合。

---

## 第三节：定稿决策红线（用户逐条拍板，任何阶段不得违背）

1. **Agent 不用浏览器**：不模拟 W/A/S/D、不截图点击；走 HTTP API + /ws/agent。
2. **Agent 与人共用一套准则（游客级权限）**：
   - 允许：observe / move / rotate / jump / say / interact
   - 禁止：**传送门传送、坐标传送（teleportToCoord）、背包/资料/商城**
   - 实现层面：人类游客靠前端 if 拦截（现状不动）；**Agent 靠服务端 scope 校验**（权限集里根本没有 teleport，收到即拒）。不开发任何 teleport action。
3. **agents 表预留 `can_teleport BOOLEAN DEFAULT false`** 字段（今天不用，未来开放不改表）。
4. **服务器对语音零加工**：不做 ASR/TTS、不接任何转换服务；VOICE_MESSAGE base64 原样中继；转写由 AI 客户端自己接（Whisper/豆包 ASR 等）。
5. **`agent_voice_relay` 默认关闭**（AI 默认不收语音；需 AI 主动 SUBSCRIBE voice 且后台开关打开）。
6. **推送三档后台可配置**（eco/standard/realtime，单选即选即生效，60s 内热跟进，不重启）；`max_agents` 全局上限；默认档 = eco。
7. **位置流聚合**：standard 档 1 秒聚合 1 条（ENTITY_MOVEMENT_BATCH），realtime 才 10Hz。
8. **AI 标识**：`entityType:'agent'` → 系统消息显示 "(AI)加入了"、头顶名字加 🤖（约 5 行前端改动）。
9. **不动现有体系**：/ws 人类协议行为零变化；/api/auth/* 零变化；游客模式零变化。
10. **服务器不做 ASR/TTS、Agent 不允许 set_position 裸接口**（移动只能 walk_to/rotate/jump，服务端定速度）。
11. **工程保命三件套**：max_agents 拒绝超载；每 Agent 推送令牌桶限频（低优先级先丢：位置>实体>聊天，聊天永不丢）；背压断开（ws bufferedAmount >1MB 警告、>4MB 断开）+ 30s 心跳沿用人类侧机制。
12. **P7 Vision 后置**（第一版 AI 无画面，纯结构化雷达；未来 Vision 走服务器侧无头渲染 worker）。
13. **聊天记录双保存**（2026-09-17 定稿）：本地实时写入（`world_chat_log`）+ 每日定时归档远端（S3 兼容对象存储；百度网盘仅预留接口）；保留期后台可设（默认 7 天），到期自动清除本地行与远端旧归档；**未成功归档的本地数据永不删除**；语音只存元数据不存音频。
14. **游客 Agent 永不获得推流**（P8）：`SUBSCRIBE` 一律拒绝（`GUEST_PUSH_FORBIDDEN`），即使后台默认档被调成 realtime，游客连接也强制 eco + 关闭位置流 + 关闭语音中继。
15. **游客 Agent 永不获得 30m 以上观察半径**（P8）：`observe` 半径硬钳 30m，请求更大值静默收敛不报错。

---

## 第四节：总体架构

### 4.1 三扇门

| 门 | 谁走 | 地址 | 现状 |
|---|---|---|---|
| 网页 | 真人 | `https://host/index.html` | 已有 |
| 人类实时 | 真人浏览器 | `ws://host/`（根路径） | 已有（无认证，本轮不动） |
| Agent API | AI | `https://host/api/agent/v1/*` | **待建 P1-P2** |
| Agent 实时 | AI | `wss://host/ws/agent` | **待建 P3** |

Agent 只需被告知一个 base URL（域名）+ API Key（门禁卡），其余靠 `GET /.well-known/virtual-world-agent.json` 自动发现（P6）。跨世界时新世界地址来自 `/api/federation/info` 或传送门列表。
访问三前提：①后台总开关 `agent_enabled` 打开（默认关）②持有 API Key ③对方是能执行代码的 Agent Runtime（网页版对话 AI 粘网址进不来；P6 提供现成示例客户端）。
> **P8 修订（2026-09-18 已实现）**：访问三前提收窄为 **①后台总开关 `agent_enabled` 打开 ②能执行代码的 Agent Runtime**。
> API Key 从"进门凭证"重新定义为"**推流特权**"凭证——无 Key 可用公开临时票（`POST /guest/session`）以拉模式进场。
> 详见第 7 节 P8 与红线 14/15。

### 4.2 数据流（P3 完成后）

```
AI 进程                          World Server :3002                    真人浏览器
  │ POST /api/agent/v1/session          │                                │
  │──────────────────────────────────▶ │ 签发短期 Agent JWT               │
  │◀─────────── agentJwt ───────────────│                                │
  │ wss://host/ws/agent (Bearer)        │                                │
  │──────────────────────────────────▶ │ agentPresenceBridge             │
  │                                     │  写 playerPositions(entityType) │
  │◀── READY + WORLD_SNAPSHOT ──────────│  广播 PLAYER_JOINED ──────────▶ │ addPlayer()
  │                                     │                                │  下载 GLB → 3D Avatar
  │ GET /api/agent/v1/observe           │                                │
  │──────────────────────────────────▶ │ 复用 worldSpatial+presence      │
  │◀────────── JSON 雷达 ───────────────│                                │
  │ ACTION say/walk_to/...              │                                │
  │──────────────────────────────────▶ │ scope 校验+节流                  │
  │◀── ACTION_ACCEPTED/COMPLETED ───────│  广播 CHAT/POSITION_UPDATE ───▶ │ 气泡/走路动画
```

### 4.3 AI 的感知模型（呈现三层）

| 呈现给谁 | 形式 | 谁负责 |
|---|---|---|
| AI 看世界 | JSON 雷达（名字/类型/坐标/距离）+ 实时事件流 | 无需渲染 |
| 真人看世界 | WebGL 3D 画面 | 真人浏览器 |
| AI 的 Avatar | 3D 模型+动画 | **别人的浏览器**替 AI 渲染 |

AI 对 GLB 的关系：**从不下载、从不解析**——glbUrl 只是随 observe/PLAYER_JOINED 流转的字符串。AI 认识物体靠 `name`/`type`/`description`（语义标注）。

---

## 第五节：协议设计（实现时照此执行）

### 5.1 HTTP API（全部挂 `/api/agent/v1`，独立于用户 JWT）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/session` | API Key（Authorization: Bearer agk_...）→ 短期 Agent JWT（15min，jti 唯一）。限流。 |
| GET | `/me` | 当前 Agent 信息 + avatar + scope |
| POST | `/session/revoke` | 吊销会话 |
| GET | `/observe?radius=&include=&limit=` | 空间雷达（P2） |
| GET | `/chat/history?limit=20` | 最近聊天记录（AI 重连恢复上下文，P4） |
| GET | `/capabilities` | 机器可读能力（P6） |
| GET | `/openapi.json` | schema（P6） |
| GET | `/.well-known/virtual-world-agent.json` | 发现入口（P6，express 静态路由级） |

Agent JWT payload：`{ sub: agentId, principalType: 'agent', worldId, scopes: [...], iat, exp, jti }`。**独立密钥** `AGENT_JWT_SECRET`（.env 新增；未配置时启动告警并拒绝 Agent 功能）。

### 5.2 WebSocket（/ws/agent）消息

连接即鉴权（HTTP upgrade 时读 Authorization header，拒绝无 token/过期 token）。

```
C→S:  SUBSCRIBE { topics: ["chat","presence","movement","voice"], radius }
      UNSUBSCRIBE { topics }
      ACTION { requestId, action, ...参数 }
      PING
S→C:  READY { agentId, avatar, spawn }
      WORLD_SNAPSHOT { self, entities }
      ENTITY_ADDED / ENTITY_UPDATED / ENTITY_REMOVED   (standard+)
      ENTITY_MOVEMENT_BATCH { moves:[...] }            (standard 档 1s 聚合)
      CHAT { sender, characterId, message, timestamp }  (所有档，30m)
      VOICE_MESSAGE { characterId, characterName, audio(base64), durationMs }  (默认关)
      ACTION_ACCEPTED / ACTION_COMPLETED / ACTION_REJECTED { requestId, reason }
      SPEECH ── 即 CHAT 的别名口径，不单独实现
      ERROR / PONG
```

ACTION 七动作（P4 + 2026-09-19 新增 `follow`）：`move(target)` 连续位移、`walk_to(target)` 走到点（服务端限速逐帧推进 + animMode:walk）、**`follow(targetId, stopDistance=2, maxDurationMs=60000)` 持续跟随**（服务端每 100ms 追目标、进入 stopDistance 停住、目标消失/超时/被新指令打断即结束）、`rotate(yaw)`、`jump()`、`say(text)`（≤200 字，走 CHAT 管线）、`interact(targetId)`（距离校验）。全部要求：scope 校验→参数 schema→距离/边界校验→限频→服务端权威→requestId 回执。

**移动类回执契约（2026-09-19 缺陷 E 修复；v2-3 补齐 move/jump）**：`ACTION_COMPLETED { requestId, reason }` 由**服务端在移动结束时补发**，`reason ∈ arrived | superseded | target_lost | timeout | disconnected`（walk_to 到达 / 被打断；follow 结束）。**移动类动作（move/walk_to/jump/follow）互斥**：同一连接同一时刻只有一个移动任务，新指令打断旧任务并向旧 requestId 发 `reason=superseded`。**速度上限 `agent_max_speed`（默认 9 m/s = 真人速度，后台可配 1~20）。**
> **v2-3 补记（2026-09-19）**：`move` / `jump` 原先未注入 `{requestId, reply}`（被打断静默无回执），已与 `walk_to` / `follow` 对齐。两条细节：① 一条移动任务只挂**一个**待回执指令，`jump` 复用正在跑的任务（如 `walk_to` 途中起跳）时**不覆盖**旧 `requestId` → 此时只有主指令收到 `superseded`；② `reason='disconnected'` 的回执发送时 socket 已关闭（客户端观测不到），清理证据看审计日志 `ws_disconnected`。

### 5.3 推送三档（system_config，后台单选热切换）

| 配置键 | 类型/默认 | 说明 |
|---|---|---|
| `agent_enabled` | bool / false | 总开关（**默认关，上线时手动开**） |
| `agent_push_default` | eco \| standard \| realtime / eco | 新 Agent 默认档（**位置流一并由此决定，无独立开关**） |
| `agent_voice_relay` | bool / **false** | 语音是否中继给 Agent |
| `max_agents` | int / 50 | 全局并发上限 |
| `agent_max_connections_per_agent` | int / **1** | 单 Agent 并发 WS 连接上限（1~10）；超出时新连接顶掉最旧连接（close 4004 `REPLACED_BY_NEW_CONNECTION`），被顶掉的连接**静默清理**（不广播 PLAYER_LEFT，避免真人端 avatar 闪断）——缺陷 B |
| `agent_max_speed` | number / **9** | Agent 移动速度上限 m/s（1~20）。默认 9 = 真人速度（`player.js` 0.15/帧 @60fps ≈ 9 m/s）；原固定 5 m/s 会被正常走路/奔跑的真人越拉越远（用户实测中位 6.0、峰值 11+ m/s）——缺陷 C 配套 |
| `agent_observe_rate_key` | int / **1** | Key Agent observe 采样率（次/秒，1~10）。默认 1 = **与修复前完全一致**（向后兼容）；游客档固定 1 次/2 秒，不受此键影响——缺陷 D |

- **热路径读配置（2026-09-19 实测坑）**：移动速度与 observe 采样率在 10Hz 热路径读取，用 `agentConfigService.peekConfig()` 同步读 60s 缓存；`setConfigValue` 必须**就地更新缓存**（只把 cache 置 null 会让热路径回落默认值，表现为"后台改了要等几十秒才生效"）。

- eco：observe 限 1Hz + CHAT 实时推；无实体/位置推送。
- standard：+ ENTITY_ADDED/REMOVED + 1s 聚合位置流。
- realtime：位置流 10Hz 原始频率（复用现有 POSITION_UPDATE 广播，仅发给订阅了的 Agent）。
- ~~`agent_movement_push`（位置流策略 off/batched/realtime）~~：**已移除**（2026-09-18）。三档本身已完整定义位置流行为，该键从未被推送逻辑读取，留着会误导管理员（以为可以叠加组合）。位置流完全由 `agent_push_default` 决定。
- 后台卡片：admin.html 新卡片"Agent 接入"，参考 adminModelLod 卡片先例（system_config 读写 + 60s 缓存热生效 + 客户端校验）。
- **Agent 独立档位（2026-09-18 追加）**：`agents.push_tier`（inherit \| eco \| standard \| realtime，默认 inherit = 跟随全局默认档）。WS 连接时游客仍强制 eco（红线不动）；Key Agent 优先用自身档位，inherit 才回落全局。后台「AI 注册用户列表」：创建表单可选档（跟随/第2/第3），列表档位内联下拉改档（`POST /admin/agents/:id/tier`，在线连接经 `agentWsServer.applyAgentTier` 即时生效无需重连）。第 1 档（公开游客）无需创建，任何人通过域名 `POST /guest/session` 自动获得（需 agent_enabled=true）。
- **Agent 删除（2026-09-18 追加）**：`DELETE /admin/agents/:id` 永久删除——先吊销 Key 防删除瞬间旧 Key 仍可用，`agent_api_keys`/`agent_sessions` 靠 `ON DELETE CASCADE` 级联清理，在线连接由 `agentWsServer.kickAgent` 踢出（close 4003），审计事件 `delete`。聊天记录保留（只删身份）。

### 5.4 observe 返回结构

```json
{
  "world": { "id": "...", "name": "..." },
  "self": { "id": "agent:...", "position": {x,y,z}, "rotation": {"yaw":0} },
  "entities": [ { "id","type":"human|agent","name","position","distance","animMode" } ],
  "objects":  [ { "id","type","name","position","distance" } ],
  "portals":  [ { "id","name","position","distance" } ],
  "timestamp", "sequence"
}
```
复用：`worldSpatial /around`（objects+portals）+ `playerPositions`（entities）。radius 硬上限 200m；不含管理员私有字段；Key 档限频 = `agent_observe_rate_key`（默认 1Hz），游客档 1 次/2 秒。

> **`self.position` 与 `distance` 的原点（2026-09-19 缺陷 A 修复）**：优先取该 Agent 在 `playerPositions` 里的**实时位置**（WS 权威），`session.current_position` 仅作无在线连接时的兜底，最后才回落 `(0,0,0)`。修复前只取 session 快照，纯 HTTP 会话调 observe 时 `self` 恒为 `(0,0,0)`，所有 `distance` 也跟着错（第一轮"原地徘徊"的直接原因）。

**实体标识契约（2026-09-18 固化，2026-09-19 机器可读化）**：

- `entities[].id` = `characterId`，**这是唯一标识**；`name` 只用于显示——**同名是正常现象**（游客可能大量同名、不同角色也可能同名），任何"按 `name` 定位实体"的实现都不可靠。
- `chat/history` 的 `senderId` 与 `entities[].id` 是**同一命名空间**（实测逐字一致：`a8eaecfd-9e45-4dc8-8739-b81b313ae581`）；推流 `CHAT` 的 `characterId` 同为该口径（`sender` 是显示名）。**标准用法**：收到 `CHAT` → 取 `characterId`/`senderId` → 按 `id` 在 `entities` 里定位发言者。
- **同角色多连接（2026-09-19 已修复，缺陷 B）**：`entities` 按 `characterId` 去重（同 id 只返回一条，优先带 `animMode`/位置最新）；服务端同时保证单 Agent 并发连接数不超过 `agent_max_connections_per_agent`（默认 1，新连接顶掉旧连接并 close 4004）。
- **机器可读发布（2026-09-19，缺陷 F/H）**：本契约以 `entityIdentity` 段同时出现在 `GET /api/agent/v1/capabilities`、`/.well-known/virtual-world-agent.json` 与 `openapi.json` 的 `x-entity-identity`（**三处同源同形**，由 `buildSharedSections` 统一产出）。
- **实测教训**：世界里同时存在两条同名"米多"（`2adb4c4c…` / `a8eaecfd…`，不同 id）与一个 id 不带 `agent:` 前缀的旧 Agent 条目——客户端按"最近的 human"盲选目标会跟错人（本轮临时跟随脚本踩过），**任何按 name 或"看起来像人"的启发式定位都不可靠**。

### 5.5 聊天记录与归档（2026-09-17 定稿）

**新表 `world_chat_log`**：`id, sender_type(human|agent), sender_id, sender_name, message, position JSONB, created_at`，索引 `created_at DESC`。写入点 = wsServer CHAT 分支一次**异步 INSERT**（不阻塞广播，失败仅打日志）。语音只写元数据 `[语音 N秒]`，**不存 base64 音频**。

**配置（system_config + admin 卡片，密钥走 configService 加密存储）**：

| 键 | 默认 | 说明 |
|---|---|---|
| `chat_log_enabled` | true | 聊天记录总开关 |
| `chat_log_retention_days` | 7 | 本地保留天数（1~365），到期自动清除 |
| `chat_log_remote_enabled` | false | 远端归档开关 |
| `chat_log_remote_provider` | none | none \| s3 \| baidu（baidu 仅预留） |
| `chat_log_s3_endpoint` / `bucket` / `prefix` / `access_key` / `secret_key` | — | S3 兼容协议（覆盖阿里云 OSS / 腾讯 COS / MinIO 等） |
| `chat_log_upload_hour` | 3 | 每日归档时刻（0~23） |

**每日定时归档流程（非实时）**：导出昨日 00:00-24:00 记录 → JSONL → gzip → 上传 `chat-archive/YYYY/MM/DD.jsonl.gz` → 本地行保留到期满删除 → 远端旧归档同步清理。**铁律：某天的记录未成功上传之前，本地永不删除**（失败次日自动重试，上限 7 次）。

**AI 历史接口**：`GET /api/agent/v1/chat/history?limit=20` → Agent 断线重连后拉最近消息恢复上下文。

**依赖**：`@aws-sdk/client-s3`（一套代码覆盖全部 S3 兼容存储；记入 package.json，注意本项目 npm install 清包坑）。**百度网盘无 S3 兼容 API**（需 OAuth + 企业审核），一期仅留 provider 接口位，二期按需接。

**存储成本**：文字记录约 500 字节/条（含索引），典型负载 ≈1MB/天、30 天保留 ≈30MB——可忽略；语音音频才贵（一条 60 秒 ≈240KB = 500 条文字），故只存元数据。

---

## 第六节：文件结构与数据库

### 6.1 新增文件（全部 ≤500 行；黑名单文件零追加）

```
src/agent/
  agentSchema.js            # 参数/消息校验 + 协议常量
  agentAuth.js              # API Key hash(bcrypt/scrypt)、Agent JWT 签发与校验（独立 SECRET）
  agentManager.js           # agents / agent_api_keys 表 CRUD
  agentSessionManager.js    # 短期 session、jti 防重放、位置/状态
  agentPermissionService.js # scope 校验（游客级白名单）
  agentPresenceBridge.js    # ★核心：写/删 playerPositions(entityType:'agent')，共享 activeConnections
  agentObservationService.js# observe 组装（复用 worldSpatial 查询逻辑）
  agentActionService.js     # 六动作入口 + 限频
  agentMovementService.js   # 服务端权威移动（速度/边界/平面地面/10Hz 推进）
  agentConfigService.js     # system_config 配置键读写 + 60s 缓存（含 5.3/5.5 全部键）
  agentTierService.js       # （P8）tier 判定 + 游客限频 + 每 IP 并发 + 观察半径钳制
src/services/
  chatArchiveService.js     # （P4）每日导出昨日聊天→gzip→S3 兼容归档→保留期到期清理
  logger.js                 # （P8）日志三分流 access/ops/audit + 按天轮转 + 过期清理
src/routes/agent/
  index.js  session.js  observe.js  action.js  meta.js   # meta=capabilities/openapi/well-known
  guest.js                  # （P8）POST /guest/session 公开签票（游客拉模式）
src/websocket/
  agentWsServer.js          # Agent WS：连接鉴权、消息分发、订阅管理、令牌桶、背压监控
  upgradeRouter.js          # ★路径分流：/ws/agent→agent，其余(含 /)→human
src/routes/agentFederation.js  # (P5) POST teleport/prepare + federation/accept
src/agent/agentTeleportService.js # (P5) 复用 federationSystem 密钥/trustedWorlds（只读）
examples/agent-client/
  node-agent.mjs  README.md
```

### 6.2 现有文件的最小改动清单

| 文件 | 改动 | 阶段 |
|---|---|---|
| `src/websocket/wsServer.js`（437 行，贴线） | `new WebSocket.Server({server})` → `{ noServer:true }` + 导出 `handleUpgrade`；CHAT 分支加一次异步写库调用（1 行 Promise.resolve().then）+ 携带 position 字段；其余逻辑不动 | P3/P4 |
| `src/server.js` | `app.use('/api/agent/v1', requireAgentRoutes)`（1 处）+ upgradeRouter 挂载（1 处） | P1/P3 |
| `public/js/websocket.js` | PLAYER_JOINED 系统消息支持 "(AI)加入了"；名字 Sprite 加 🤖（约 5-10 行） | P3 |
| `public/index.html` | websocket.js 版本号 ?v=N+1 | P3 |
| `admin.html` + 新 `public/js/adminAgentSettings.js` | "Agent 接入"配置卡（含 5.3 档位 + 5.5 聊天归档两组配置）；卡片位置在「用户与角色」页（users）的「🤖 AI Agent」+「📦 聊天归档」两个 sub-tab | P4 |
| `README.md` Nginx 示例 | `location /` 补 Upgrade 头（文档修正） | P3 |

### 6.3 数据库迁移（database/migrations/，幂等 IF NOT EXISTS）

```
add_agents.sql            # agents(id UUID PK, name, description, status, home_world_url,
                          #       avatar_config JSONB, can_teleport BOOLEAN DEFAULT false,
                          #       created_at, updated_at)
                          # agent_api_keys(id, agent_id FK, key_hash, key_prefix, status,
                          #       expires_at, created_at, revoked_at)
add_agent_sessions.sql    # agent_sessions(id, agent_id FK, world_id, jti UNIQUE, issued_at,
                          #       expires_at, last_seen, current_position JSONB, status)
add_world_chat_log.sql    # world_chat_log(id, sender_type, sender_id, sender_name, message,
                          #       position JSONB, created_at) + idx(created_at DESC)  （P4）
add_federation_nonce.sql  # token_usage(nonce VARCHAR PK, used_at)  # 顺带补 P0 发现的防重放缺口（P5 用）
```
API Key 只存 hash，`key_prefix`（前 8 位）供后台识别。`.env` 新增 `AGENT_JWT_SECRET`。

---

## 第七节：分阶段任务与进度表 ★核心★

> 状态图例：⬜ 未开始 ｜ 🔶 进行中 ｜ ✅ 完成（附日期）

### P0 代码审计 ✅ 2026-09-17
- [x] 19 项事实核对（第 2 节）+ 7 处方案修正 + 13 条红线定稿（第 3 节）
- [x] 决策确认：游客级权限、无传送、语音零加工、三档推送、AI 标识、聊天记录双保存+定时归档

### P1 Agent 身份与会话 ✅ 2026-09-17
- [x] `add_agents.sql` + `add_agent_sessions.sql` 迁移并执行（幂等验证：跑两遍不报错）
- [x] `agentAuth.js`：API Key 生成（`agk_live_` + 32B 随机）、bcrypt hash、Agent JWT 签发（15min/jti）
- [x] `agentManager.js` / `agentSessionManager.js` / `agentPermissionService.js` / `agentConfigService.js`
- [x] `routes/agent/index.js + session.js`：POST /session、GET /me、POST /session/revoke
- [x] 限流：POST /session 每 IP 10次/分钟（内存滑动窗口，session.js 内实现）
- [x] .env 增加 AGENT_JWT_SECRET；server.js 挂载路由（2 行）
- [x] 审计日志：session 签发/吊销/拒绝 console 结构化日志（scope: agent-auth）
- [x] **验收**：`scripts/accept_agent_p1.js` 14/14 PASS（①换 token→/me 成功含游客级 scope 无 teleport；②错误/伪造/畸形 Key 401；③过期 token 403 TOKEN_EXPIRED；④/api/auth/login 冒烟 401 不变；⑤迁移幂等；附加：吊销后 403 SESSION_REVOKED、限流 429、总开关关 503 AGENT_DISABLED_GLOBALLY）

### P2 观察 API ✅ 2026-09-17
- [x] `agentObservationService.js`（复用 worldSpatial 查询口径 + getPlayerPositions）
- [x] GET /observe：radius(≤200)/include/limit 参数校验；self/entities/objects/portals
- [x] entities 含在线人类（playerPositions）与本 Agent；objects/portals 走 /around 同口径（方框 position_x/z BETWEEN，按距离升序）
- [x] 1Hz 限频（eco，per agentId）；无管理员私有字段（objects 仅 id/type/name/position/distance）
- [x] **验收**：`scripts/accept_agent_p2.js` 14/14 PASS（①observe 返回附近已知对象+真实坐标核对+self/entities/world 字段；②radius 截断+硬上限 200；③/around 回归结构不变+完整字段分离；④1Hz 超频 429+窗口恢复；附加：无管理员私有字段泄漏、无/伪造 token 401）

### P3 Agent WebSocket + 推送分档 ✅ 2026-09-17（最关键最险阶段）
- [x] `upgradeRouter.js`：`/ws/agent`→agent，**其余全部→human（兜底）**（铁律：CONFIG.WS_URL 无路径，浏览器连根路径 /）
- [x] `wsServer.js` 最小改动（noServer + `getWss` 导出，500 行贴线不超）
- [x] `agentPresenceBridge.js`：onConnect→写 playerPositions(entityType:'agent', isGuest:true)→广播 PLAYER_JOINED（含 avatar 六件套+entityType）；onDisconnect→PLAYER_LEFT；updatePosition→POSITION_UPDATE
- [x] `agentWsServer.js`：handleUpgrade 鉴权(JWT+jti DB+active)→READY+WORLD_SNAPSHOT；SUBSCRIBE/UNSUBSCRIBE/PING/ACTION(P4占位)；令牌桶(聊天永不丢)+背压(1MB警4MB断)+30s心跳；三档推送(eco无位置流/standard 1s聚合/realtime逐条)+ENTITY_ADDED/REMOVED；CHAT旁路 monkey-patch broadcastToAll；max_agents 检查
- [x] 三档推送 + `max_agents` + `agentConfigService` 60s 缓存（BACKPRESSURE_KILL 读 env var 可配）
- [x] `ENTITY_MOVEMENT_BATCH` 1s 聚合器（standard 档）
- [x] 前端 5 行：websocket.js `(AI)加入了` + 🤖 前缀；index.html websocket.js?v=5（红线 c：只碰 6.2 清单内文件）
- [x] README Nginx `location /` 补 Upgrade 头（文档修正）
- [x] **验收**：`scripts/accept_agent_p3.js` 12/12（②无/过期token拒 ③服务器指定characterId ⑤档位切换60s生效 ⑥max_agents超限拒 ⑦4MB背压逻辑）+ `scripts/accept_agent_p3_playwright.js` 6/6（①浏览器根路径WS回归 ④真人看到AI Avatar+系统消息含AI 0 console error）+ 红线a node WS 根路径回归通过 → **7/7 全过**

### P4 行动系统 + 聊天记录 ✅ 2026-09-18（2-3 会话，本会话一轮完成）
- [x] **卡片位置迁移**：admin.html 用户与角色页加「🤖 AI Agent」+「📦 聊天归档」两个 sub-tab；逻辑在 `public/js/adminAgentSettings.js`（独立文件 ≤500 行）；后端管理员端点 `routes/agent/admin.js`（list/create/disable/enable/regenerate-key + config 读写 + archive/run-now）
- [x] `agentMovementService.js`：5m/s 限速、边界 ±1000、平面地面 y、10Hz 推进、animMode 派生（idle/walk/jump）
- [x] `agentActionService.js` 六动作 + scope/距离/参数校验 + requestId 回执（ACCEPTED/COMPLETED/REJECTED）；walk_to 视为 move 的子动作（共享 move scope）
- [x] 移动复用现有 POSITION_UPDATE 广播（经 presenceBridge.updatePosition → broadcastToAll）
- [x] say 走 CHAT 管线（30m，broadcastToNearby）；语音零加工中继（agent_voice_relay 开关，P3 已接 CHAT 旁路）
- [x] `add_world_chat_log.sql` + CHAT 异步写入（wsServer.js CHAT 分支 1 行 Promise.resolve().then）+ GET /chat/history
- [x] `chatArchiveService.js`：每日导出→gzip→S3 兼容归档→保留期清理（后台可配；**未上传成功不删本地**，失败重试上限 7 次，指数退避 1/2/4/8/16/32/64s）
- [x] admin 卡片：记录开关 / 保留天数 / 归档目的地（none|s3|baidu预留）/ S3 连接参数（密钥经 configService 加密）/ 上传时刻
- [x] `@aws-sdk/client-s3` 登记进 package.json（防 npm install 清包）；agentWsServer.js CHAT patch 同时拦截 broadcastToAll + broadcastToNearby + 携带 position 字段
- [x] **验收**：`scripts/accept_agent_p4.js` 25/25 PASS（②③⑤⑧⑨⑩ + 管理员端点 + 红线 a）+ `scripts/accept_agent_p4_playwright.js` 11/11 PASS（①④⑥⑦）= **36/36 全过**；P3 回归 12/12 PASS 无回归

### P5 Agent 跨世界联邦传送 ✅ 2026-09-18
- [x] `add_federation_nonce.sql`（token_usage 表 nonce 一次性 + agent_transient_sessions 表 transient session）
- [x] `agentTeleportService.js` + `routes/agentFederation.js`（principalType:'agent'，transient session，**不创建本地 user**）
- [x] 复用 RS256/iss/aud/trustedWorlds（只读 federationSystem）；handoff token 含 agentId/avatarConfig/homeWorld/nonce，TTL 300s
- [x] **验收**：`scripts/accept_agent_p5.js` 36/36 PASS（①身份/Avatar 跨世界不变 ②nonce 重放被拒 409 ③无 email 建号 users/characters 表无新增 ④A 端 prepare 成功+B 端 accept 日志可见到达 + transient session 创建；附加：can_teleport=false 被拒、未信任目标世界被拒、handoff payload 无 email/userId/role、TTL≤300s、iss/aud 校验）

### P6 自动发现 + SDK ✅ 2026-09-18
- [x] `routes/agent/meta.js`：GET `/capabilities`（scopes/actions/push tiers/ws 消息目录）+ GET `/openapi.json`（OpenAPI 3.0，仅含实际已实现端点，未实现不写）+ `buildWellKnown` 工具（worldId/worldName/worldUrl 来源优先级：federationSystem → system_config('world_url') → req 推导）
- [x] server.js 加 `app.get('/.well-known/virtual-world-agent.json', ...)` 静态路由级挂载（公开无鉴权，1min 缓存）
- [x] `routes/agent/index.js` 挂载 meta 子路由（**必须在 admin 之前**——admin.js 内部 `router.use(authenticateAdminToken)` 是子路由级全局中间件，会拦截所有未匹配路径；与 P5 federation 路由顺序 bug 同源）
- [x] `examples/agent-client/node-agent.mjs`：零依赖 Node 18+ 示例客户端（domain→well-known→session→WS?token=→READY/WORLD_SNAPSHOT→SUBSCRIBE→observe→say→walk_to→teleport 拒）；附 `examples/agent-client/README.md` 三步跑通说明
- [x] 主 README 增加 "AI Agents" 章节（Discovery / Identity / 六动作 / 推送三档 / 联邦传送 / Quick Start / 13 条架构红线）
- [x] **WS 鉴权降级**：`agentWsServer.authenticateUpgrade` 同时支持 `Authorization: Bearer` 头（主路径）与 `?token=<jwt>` 查询参数（降级路径）——WHATWG WebSocket（Node 内置）与浏览器无法设自定义请求头，查询参数是 WebSocket 鉴权标准降级模式（JWT 15min TTL，access log 含 token 已知风险，需保护 log）
- [x] **验收**：`scripts/accept_agent_p6.js` 83/83 PASS（well-known 字段齐全 / capabilities 公开可读 / openapi paths 与实际实现逐项核对，未实现端点不写 / dryrun 仅凭域名发现→capabilities / well-known 与 capabilities WS 端点一致 / agent_enabled=false 时公开端点仍 200 / HTTP 端点可达性与鉴权门）+ `scripts/accept_agent_p6_playwright.js` 10/10 PASS（**轮询浏览器模式**：Agent 入场 players.size +1 t=856ms / 聊天 DOM 含 (AI)/Hello t=856ms / Agent walk_to 位置变化 (0,0,0)→(3.5,0,0) t=1713ms / Agent 离场 players.size 回到 1 t=7273ms / demo 子进程 exit 0 / demo stdout 含全链路证据 / teleport→ACTION_REJECTED scope_denied 红线 2 / 0 console error）= **93/93 全过**；P5 回归不依赖，P6 是新增能力
- [x] agent_enabled 收尾恢复 false（红线 6 默认关）

### P8 Agent 开放生态——拉/推双模式 ✅ 2026-09-18

> **核心洞察（用户提出）**：上线初期真正的风险是"没人来"而非"滥用"。把门禁逻辑倒过来——稀缺的不是进门资格，而是**服务器主动推流的成本**。拉模式（请求-响应）天然自限流：不请求服务器零开销，请求频率被限流钳死，滥用最坏情况有上界。Key 的价值重新定义为"**实时推流特权**"而非进门凭证。

- [x] **前置基建：日志三分流**（`src/services/logger.js`，188 行）：
  - access.log（JSONL：HTTP method/path/status/耗时/IP、WS 连断、签票；保留 7 天）
  - ops.log（人读：启停/迁移/Agent 生命周期/归档/错误；保留 30 天）
  - audit.log（JSONL：登录/创建停用 Agent/发 Key/改配置/签票；长期保留 365 天）
  - 按天轮转（写入时用当天日期算文件名，跨天自动新建，无需定时器）；每通道 Promise 队列串行 append；写盘失败只 console.error 不拖垮业务
  - Express 中间件过滤 `/health` 与 `/favicon.ico`；Agent 模块 `audit()` 已改分流（session.js / agentWsServer.js）；旧大文件 console.log 不迁移（黑名单原则）
  - `LOG_DIR` / `AUDIT_LOG_RETENTION_DAYS` 可覆盖
- [x] **游客 Agent（拉模式，无 Key）**：
  - `POST /api/agent/v1/guest/session` 公开端点签临时票（JWT 30min，`tier:'guest-pull'`，复用 AGENT_JWT_SECRET）
  - 会话落 `agent_transient_sessions`（无 agents 外键），`source_world_id='guest-pull'` 标记；**不建 agents 行、不建 user/character**，刷新即换身份零残留
  - 能力（纯请求-响应）：`observe`（30m、1 次/2s）、`chat/history`、`say`（1 条/5s）、`move/walk_to/rotate/jump/interact`（1 次/2s）
  - **禁止推流**：SUBSCRIBE 直接拒绝（`GUEST_PUSH_FORBIDDEN`）；连接级强制 eco（即无位置流）+ 语音中继 off（即使后台默认档 realtime）
  - 限制矩阵：每 IP 并发 1 连接（WS 侧 acquire/release）、每 IP 签票 10 次/时、共享 max_agents 总闸、复用空闲踢出（5min）
  - 身份与审计：无 Key，按 tier 区分，审计日志记 IP（`guest_ticket_issued`）
- [x] **Key Agent（推模式，现有体系不动）**：
  - Key 特权 = SUBSCRIBE + 三档推送 + observe 200m + 动作不限频 + 可跨世界联邦（验收实测：默认档 realtime 时 Key Agent 继承 realtime，游客仍被强制 eco）
- [x] **升级漏斗**：游客 Agent 玩出粘性 → 管理员发 Key"转正" → 解锁推流/大范围/联邦（`describeTier().upgradeHint` 已写入能力清单与 READY）
- [x] **防滥用底线**：IP 并发 1 + 签票限流 + 动作限频 + 空闲踢出（全为低成本件，已全部落地）；Proof-of-Work/验证码**未做**（按"先上便宜的，观察后加码"留待二期）
- [x] **红线修订**：红线 3"三前提"中的 Key 前提移除（第 4.1 节已改）；新增红线 14（游客永不推流）与 15（游客永不超 30m）
- [x] **发现端点同步**：`/.well-known` 与 `/capabilities` 增加 `tiers` 段与 `guestSessionEndpoint`；`/openapi.json` 新增 `/guest/session` path（只写已实现端点，红线不变）
- [x] **验收**：`scripts/accept_agent_p8.js` **52/52 PASS**（无 Key 签票 / 有票进场 / 半径被钳 / SUBSCRIBE 被拒 / 动作限频 / 每 IP 并发 2 被拒 + 名额归还后重连成功 / 空闲踢出（独立实例 3003 + `AGENT_IDLE_TIMEOUT_MINUTES=0.05` 实测断开）/ Key Agent 推流回归 / 日志三文件落盘且 JSONL 合法 / 按天轮转 unit 测 / `/health` 已过滤）
  - 回归：P1 14/14、P2 14/14、P3 12/12 无回归
- [ ] **二期可选**：管理后台日志查看页（类别/时间/关键字过滤）；Proof-of-Work 或验证码；按 IP 拉黑管理端；`ai-view.mjs` / `ai-live.mjs` 重建（见进度日志"文件丢失事故"）

### 真人双端联测 ✅ 2026-09-18（用户真人 + AI 助手扮 Agent 实测）

> 测试方式：AI 助手通过 Agent 接口长连接进场（`examples/agent-client/ai-live.mjs` 驻场），用户以真人浏览器进场，双端实时对话+指挥移动。**暴露 5 个自动化验收测不出的真 bug，全部修复**。

- [x] **①人→Agent 聊天永远不通**（P4 遗留）：`wsServer.js` CHAT 分支裸调用内部 `broadcastToNearby/broadcastToAll`，绕过 agentWsServer 给 `module.exports` 打的转发 patch → 改为经 `module.exports.xxx` 调用。教训：monkey-patch 导出属性时，模块内部同名字函数的裸调用不受影响；此前验收只测过 Agent→人方向
- [x] **②管理后台创建 Agent 500**：`agentManager.createAgent` 返回的 apiKey 是 `{key,keyPrefix}` 对象，admin.js 直接 `.slice()` → TypeError。修复：整形为字符串
- [x] **③Agent 半身埋地/高度错误**：服务器端 Agent 贴 y=0 平面移动（无地形数据）+ 几何棍人原点在脚底上方 1.5。修复：前端 `websocket.js` 对 isAgent 实体做 `snapAgentPosition`（本地 `getGroundHeight` 贴地 + 按模型类型动态偏移：棍人 +1.5 / GLB(fitModel 原点即脚底) +0），初始入场（PLAYER_JOINED/WORLD_STATE 两路径）与移动更新统一处理
- [x] **④一移动就整只隐身**：agentPresenceBridge 广播的 rotation 是对象 `{yaw}`，前端 `group.rotation.y = {yaw}` → three.js 矩阵 NaN → 模型消失。修复：bridge 归一化为数字（协议：人类侧 POSITION_UPDATE 的 rotation 本就是数字）
- [x] **⑤走路一段一段卡**：Agent 移动服务器 10Hz 推位置 + 前端直接瞬移。修复：新增 `public/js/agentPositionSmoother.js`（客户端平滑器：拦截 isAgent 位置更新存目标点，rAF 以 5.4m/s 速度上限逼近 + 朝向角度插值；原始函数照常执行保留摆臂动画；仅作用于 Agent，不改人类玩家行为）
- [x] **⑥新增：Agent 空闲超时踢出**（用户需求）：N 分钟无任何操作（ACTION/SUBSCRIBE/UNSUBSCRIBE）服务器主动断开 → PLAYER_LEFT 广播 → playerPositions 清场（心跳 PONG 不算操作防挂机占位）。默认 5 分钟，`.env` `AGENT_IDLE_TIMEOUT_MINUTES` 可调（0=禁用），审计事件 `ws_idle_timeout`。已实测：挂机 5min+22s 被踢，世界同步清角色
- [x] **新增工具**：`examples/agent-client/ai-view.mjs`（分步体验：discover/session/me/observe/enter/act/history）、`ai-live.mjs`（长连接驻场：命令文件 ai-live-cmd.jsonl 追加式驱动动作 + 进度持久化防重启重放 + observe 3s 轮询追踪人类坐标）
- [x] **验收**：用户真人目测全链路——双向聊天实时互通、19 米行走全程可见贴地、移动中发消息两不误、平滑行走"已经非常棒了"（用户原话）、空闲 5 分钟自动消失
- [x] 收尾：`agent_enabled` 恢复 false（红线 6）；运行时产物（日志/命令/票据）已清理；`p6_pw_log.txt`、`scripts/agent_create_test.js` 已删



> **项目收官**（2026-09-18）：P0-P6 全部完成并验收，P7 三项均为可选项不做。临时文件已清理，部署清单与存量库注意事项已交付用户，git 待用户明确指令后提交。
- [ ] Vision（服务器侧无头渲染截图，AGENT_VISION_ENABLED 开关，关闭返回 501）
- [ ] 服务器侧 STT（用户已明确否决——转写永远归 AI 客户端）
- [ ] 百度网盘归档 provider（一期仅接口位预留，二期按需接）

---

### 多轮联测与缺陷待办 ✅ 首轮缺陷全部修复（2026-09-18 联测 → 2026-09-19 修复）

> **用户决策（2026-09-18）**：本轮及后续若干轮只做联测、只记录问题，不改代码；等多轮（含多 Agent × 多真人同时在线）跑完，把问题集中整理后再统一开发。
> **2026-09-19 用户解冻代码并授权修复**：第一批 A/B（P0）→ 第二批 C/E（P1）→ 第三批 D（P1）→ 第四批 F/G/H（P2）已全部修复并验收，联测期间另新发现 **I / J 两项 P0 级缺陷**（见表），也已一并修复。修复结果与验收证据见下方「修复结果」表。

**测试方式**：用户真人浏览器进场 + AI 助手经 Agent 接口长连接驻场（`examples/agent-client/ai-live.mjs`，Key Agent `workbuddy`，key-push/realtime 档），世界里实时对话 + 指挥移动。

**本轮结论**：跟随最终成功（234 次采样、末值 0.16m、实测移动速度 4.9~5.8 m/s，与 `MAX_SPEED=5` 一致），但客户端需先绕开 A 项才能工作；用户体感"总在找我"由 C/D/E 三项共同造成。

> **定位修正（用户实测补充，2026-09-18）**：真人端**并没有看到两个 workbuddy**，观感是"**移动的时候原地徘徊**"。B 项是**接口层**的重复实体（前端按 characterId 只画一个 avatar），不是两个 avatar；而"原地徘徊"另有已证实成因——本轮跟随脚本一开始在两个同名人类之间来回切换目标（已修）。复现时需把两者区分开，故 B 项在文档中保留为"待复现确认"。

| # | 优先级 | 缺陷 | 现象与证据（2026-09-18 实测） | 建议方案 |
|---|---|---|---|---|
| A | P0 | **`self` 与实体表双源不一致（位置视图自相矛盾）** | 用第二条只读会话（纯 HTTP、无 WS）调 `GET /observe`：`self` 恒为 `(0,0,0)`，同一 agent 在 `entities` 里另有真实位置条目 `(-6.36,-3.97) animMode=idle`，且所有实体的 `distance` 都以 `(0,0,0)` 为原点（`distance=7.5=√(6.36²+3.97²)`）。客户端按 `self` 算距离 → 跟随逻辑直接跑偏（第一轮"原地徘徊"根因）。代码：`src/agent/agentObservationService.js:36-49`（观察点解析 `query x/z → session.current_position → (0,0,0)`）、`:188-240`（`collectEntities`/`shapeSelf`） | `self` 与 `distance` 原点优先取 `playerPositions` 中该 agent 的**实时位置**（WS 连接权威）；`session.current_position` 仅在该 agent 无在线连接时兜底。本轮客户端已临时规避（自行用实体表里的自身条目算距离） |
| B | P0（**待复现确认**） | **同一角色的多条连接 → `observe` 出现同 id 的重复实体（接口层未去重）** | 另一进程用同一 API Key 连接后，`GET /observe` 的 `entities` 出现**两条同 id** 记录：一条 `animMode=idle`（真实位置，如 `(-6.36,-3.97)`）、一条 `animMode=null` 且位置 `(0,0,0)` 停在出生点。audit 日志同一 agentId 反复 `ws_connected`/`ws_idle_timeout`（`6162bf35` 10:23:39→10:29:04 被空闲踢出、`ad4f87fb` 10:29:09→10:34:34、`b0253d82` 10:34:39 重连）。代码依据：`agentObservationService.collectEntities():201-221` 遍历 `playerPositions`（**按 connectionId 存**）后以 `p.characterId` 作为 `id` 输出，**未按 characterId 去重**。**用户实测补充**：真人端**看不到两个 workbuddy**（前端按 characterId 只画一个 avatar），只见"移动时原地徘徊"——怀疑两条连接各自广播 `POSITION_UPDATE`，同一个 avatar 被两个位置源来回拉扯（`agentPositionSmoother` 以 5.4m/s 逼近目标点）；**但"原地徘徊"同时还有另一个已证实成因**（本轮跟随脚本在两个同名人类间来回切目标，已修），需复现区分。属真实场景（AI 客户端崩溃重连 / 多开 / 用户同时开两个客户端） | ①`entities` 按 `characterId` 去重（同 id 只保留一条，优先带 `animMode`/最新位置）；②同一 agent 新连接顶掉旧连接（或加 `max_connections_per_agent` 配置）；③复现脚本：同一 Key 开两条连接，一条走动、一条停出生点，观察真人端 avatar 是否被拉扯 + `observe` 是否仍返回同 id 两条 |
| C | P1 | **缺少"跟随/持续目标"动作** | 只有一次性 `walk_to`，持续跟随必须客户端高频重发；每次重发都会 `cancelMovement` + 重建 10Hz interval（`src/agent/agentMovementService.js:65, 68-83`）→ 走走停停、位置与 DB 写放大。实测 6 分钟下发 **220+ 条 walk_to**（`ACTION_ACCEPTED=221`） | 新增服务端 `follow{targetId, stopDistance}`（10Hz 追目标、进入 stopDistance 即停），或 `walk_to` 支持 `continuous:true` |
| D | P1 | **闭环采样率过低（observe 1Hz + 推流约 1Hz）** | `src/routes/agent/observe.js:33-67` 对非游客 tier 硬限 1Hz，实测频繁 429；推流 `ENTITY_UPDATED` 实测间隔约 1s（10:42:55/56…10:43:01，偶有 5s 间隔）。跟随误差 1~3m，AI 端"总在找"的体感来源 | Key 档 `observe` 提频（5~10Hz）；或 realtime 档位置流按固定帧率聚合批量下发（standard 档已有 `ENTITY_MOVEMENT_BATCH` 可复用），供客户端闭环 |
| E | P1 | **`walk_to` 无到达回执** | 实测 `ACTION_ACCEPTED=221` 而 `ACTION_COMPLETED=16`（16 条全是 `say` 的 `delivered` 回执）→ 到达只能靠客户端轮询位置推断，1Hz 下延迟 1~3s | 到达 / 超时 / 被新指令打断时补发 `ACTION_COMPLETED`（带 `reason`） |
| F | P2（**契约项，非缺陷**） | **实体标识契约需固化：同名是常态，必须按 `id` 定位** | 用户实测指正：**同名非常正常**（游客可能大量同名、不同角色也可能同名），按 `name` 定位不可靠；实测两条同名"米多"实体 `id` 不同（`a8eaecfd…` / `2adb4c4c…`）= 两个不同角色。已核实事实：`entities[].id = p.characterId`（`agentObservationService.js:208`）；`chat` / `chat/history` 的 `senderId` 与 `entities[].id` **是同一命名空间**（实测真人发言 `senderId=a8eaecfd-9e45-4dc8-8739-b81b313ae581` 与实体 `id` 逐字一致）→ "谁在跟我说话"可精确关联。**本轮反面教材**：跟随脚本一开始用 `name` 兜底匹配目标，在两个同名实体间来回切换，直接导致"原地徘徊" | 不是缺陷而是**要写进协议**：①第 5.1/5.4 节明确"实体唯一标识 = `id`(=characterId)，`name` 仅供显示，任何按名字定位都不可靠"；②明确 `chat.senderId ≡ entities[].id`，给出标准用法"先收 `chat` 拿 `senderId` → 再按 `id` 找实体"；③同角色多连接的重复实体先按 B 项去重后再按 `id` 定位（否则 `id` 也不唯一） |
| G | P2 | **示例客户端聊天双通道重复**（客户端问题，非服务端） | `ai-live.mjs` 同时用 WS `CHAT` 推送 + `/chat/history` 轮询，同一条真人消息在 `events.jsonl` 记两遍（实测 10:42:38 / 10:42:39 同一句） | 示例客户端按 `(senderId, createdAt, message)` 去重，或两条通道二选一 |
| H | P2 | **capabilities 缺 tier/limits 明细** | `/.well-known/virtual-world-agent.json` 有 `limits` 与 `tiers` 明细（含 `actionRates`），`/api/agent/v1/capabilities` 只有 `actions`/`scopes`/`tiers` 名字 | 两处输出对齐（同一 buildWellKnown 数据源） |

**修复结果（2026-09-19，逐条验收脚本可重跑）**：

| # | 状态 | 修复内容（文件） | 验收证据 |
|---|---|---|---|
| A | ✅ 修复 | `agentObservationService.resolvePosition` 优先级改为 query x/z → **playerPositions 实时位置**（`pickLiveEntry()` 取"带 animMode/最新"的一条）→ `session.current_position` → `(0,0,0)`；`shapeSelf` 的 yaw 也取实时朝向 | `accept_agent_fix_a.js` **24/24**：WS 会话与**纯 HTTP 第二会话** self 均 = 实时位置 `(29.95,19.97)`；自身条目 `distance=0`；106 个 object/portal 的 distance 与实时原点最大误差 **0.0048m**（与 (0,0,0) 口径差 **36.00m**） |
| B | ✅ 修复 | 新增 `src/agent/agentConnectionRegistry.js`（并发上限 + 新连接顶掉旧连接 close 4004 + 被顶掉的连接**静默清理**不广播 PLAYER_LEFT）；`collectEntities` 按 characterId 去重；`agent_max_connections_per_agent` 配置 | `accept_agent_fix_b.js` **24/24**：旧连接收 `4004 REPLACED_BY_NEW_CONNECTION`；audit `ws_replaced`；observe 该 id **恰好 1 条**；真人侧观察者收 `PLAYER_JOINED` 2 次、**`PLAYER_LEFT` 0 次**（avatar 不闪断）；上限=2 时两连接共存且仍去重。**真人复测**：同一 Key 开第二条连接双向 4004，换连接后位置未变（仍在真人 1.3m 旁） |
| C | ✅ 新增 | 新增 `src/agent/agentFollowService.js`：`follow{targetId, stopDistance=2, maxDurationMs=60000}`，服务端 10Hz 追目标（不依赖客户端重发）；与 move/walk_to/jump 互斥 | `accept_agent_fix_c.js` **15/15**：目标直线移动 30s、27 次采样**全部 ≤2.80m**（stopDistance+1 内）、末值 2.00m；`walk→idle` 切换正确；`target_lost`/`timeout(2067ms)`/`superseded` 回执齐全。**真人复测**：一条 follow 指令后 78.6m→13.1m 用 8s |
| D | ✅ 修复 | 新增 `agent_observe_rate_key`（次/秒，1~10，**默认 1 = 行为不变**）；`observe.js` 读热路径缓存；游客档固定 1 次/2 秒不受影响 | `accept_agent_fix_d.js` **10/10**：默认 `200,429,429`（1Hz 不变）；调 5Hz 后 `200,200,200,200,200,429,429`；retryAfter=1；非法值被忽略；调回 1 恢复 |
| E | ✅ 修复 | `agentMovementService` 在移动任务上注入 `reply` 发送器，**到达 / 被新指令打断 / 断线**时补发 `ACTION_COMPLETED{requestId, reason}`（`arrived`/`superseded`/…） | `accept_agent_fix_e.js` **12/12**：`estimatedMs=4800` vs 实测 `4946ms`（+3%）；到达位置误差 0.5m；`superseded`、`arrived` 均正确；非法请求只发 REJECTED 不发 COMPLETED |
| F | ✅ 契约固化 | `entityIdentity` 段（`uniqueIdField`/`aliases`/`nameIsDisplayOnly`/`chatSenderIdEqualsEntityId`/`duplicateConnectionsDeduped`+去重规则）写进 capabilities、well-known 与 openapi `x-entity-identity` | `accept_agent_fix_f.js` **14/14**（F1/F2/F2b/F6/F6b/F7） |
| G | ✅ 修复 | `examples/agent-client/ai-live.mjs`：**两层去重**——① history 通道用**持久 seen 表**（按行 id/createdAt），② 跨通道用「同发送者 + 同文本 + 10s 窗口」。**第二轮真人实测补修**：只做 ② 时窗口一过期就把同一批历史行**再报一遍**（实测每 10s 重复上报 11 条），必须加 ① | 重启后同一批历史消息只上报一次（20s 观察窗口内无重复） |
| H | ✅ 修复 | `meta.js` 抽出 `buildSharedSections(config)`，两处发现端点**同源同形**（含 tiers/scopes/actions/pushTiers/limits/entityIdentity）；`pushTiers` 由"一处数组一处对象"统一为对象 | `accept_agent_fix_f.js` **14/14**（F3 六段深比较全等、F4 capabilities 有 limits、F5 pushTiers 同形、F8 反映实时配置） |
| **I**（联测新发现） | ✅ 修复 | **P0**：`walk_to` 推进起点用 `session.current_position`——那是 WS 连接时读入内存的快照，此后只在 DB 更新、内存永不刷新 → **每发一条新移动指令都从出生点重新走**。实测位置序列每 4 秒原样循环 `(2.4,3.8)→(5.1,8.0)→(7.7,12.3)→(10.4,16.5)→跳回`，`estimatedMs` 恒按 (0,0,0) 算（目标 23.5m→4704ms、永远走不完）。**这正是用户第一轮"你在原地徘徊 / 跟随中间做了无用的走动"的根因**。修复：`getCurrentPosition(session, connectionId)` 优先取 `presenceBridge.getEntry(connectionId)` 实时位置 | 修复后 `estimatedMs` 与真实相对距离一致（1921/742/458ms）；跟随时序单调收敛（26.8→0.3m，无循环）；真人复测"**现在做得很好，嗯也能跟上**"（用户原话） |
| **J**（联测新发现） | ✅ 修复 | **P0**：Agent 重连必须重新 `POST /session`（新 jti），新会话 `current_position` 为空 → `presenceBridge` 退回 `(0,0,0)` 当出生点 → **任何 AI 客户端一重连就瞬移回原点**。修复：`agentSessionManager.getLatestPosition(agentId, excludeJti)` 让新连接继承该 Agent 上次落库位置（重连续位） | 实测：换连接后 READY `spawn=(-62.7,18.0)`（= 上一会话位置，非原点）；B 测试双向换连接期间真人视野内位置不变 |
| **速度**（用户现场决策） | ✅ 修复 | Agent 速度上限原为固定 5 m/s，而真人实测中位 **6.03 m/s**、峰值 11+（`player.js` 0.15/帧 @60fps ≈ 9 m/s）→ 只要真人正常走路，Agent 永远追不上。改为 `agent_max_speed` 后台可配，**默认 9 m/s 与真人一致** | 真人复测：78.6→13.1m 用 8s（≈8.2 m/s 有效速度）；`fix_c` C4 在 9 m/s 下仍全样本 ≤2.80m |

**本轮已确认无问题（作为下一轮复测基线）**：

- 服务端限速推进准确（速度上限现已可配、默认 9 m/s；限速与到达判定 0.5m 有效）
- 推流位置字段正确（`ENTITY_UPDATED` 带 `position`/`animMode`/`name`/`type`）；`follow` 服务端闭环稳定
- realtime 推流字段正确（`ENTITY_UPDATED` 带 `position`/`animMode`/`name`/`type`）
- `say` 投递 0.2~0.4s；scope 拦截与 `ACTION_REJECTED` 正常；空闲踢出、日志三分流正常

**下一轮多端联测检查清单（计划 3 Agent + 5 真人同时在线）**：

- [ ] 多 Agent 同时 `observe` 的 429 率与限频公平性（Key 档采样率现已可配 `agent_observe_rate_key`，需实测多 Agent 同调时的公平性）
- [ ] 9.5 节坑 5：`POSITION_UPDATE` 全量广播在 3 Agent + 5 真人下的带宽/CPU（Server 2核4G 基线）——**注意 `follow` 是服务端 10Hz 推进，多 Agent 同时跟随的推送量与 CPU 需重点观察**
- [ ] B 项放大复测：多 Agent 重连/多开时的实体重复与"幽灵"清理（去重 + 顶替 + 静默清理已实现，需在 3 Agent 场景复测 `entities` 唯一性与真人端观感）
- [ ] F 项验证：按 `id` 定位的契约（同名实体、游客同名、同角色多连接去重后 `id` 是否唯一）+ `chat.senderId` / 推流 `CHAT.characterId` ≡ `entities[].id` 的稳定性（契约已机器可读发布，可直接对着 `entityIdentity` 断言）
- [ ] `follow` 与 `interact`/`say` 的组合：一边跟随一边说话/互动是否互相干扰（现在移动类动作会互相打断）
- [ ] Agent 之间互相可见 / 互相聊天 / 语音 / 碰撞（当前 Agent 之间只走 broadcastToNearby）
- [ ] 多个 Key Agent 的 `push_tier` 混合档（eco/standard/realtime）同场推流表现
- [ ] `world_chat_log` 写入量与归档任务在多端高频聊天下的表现
- [ ] 真人端 0 console error + FPS 基线（对照几何/合批基线）
- [ ] **realtime 档位置流帧率**（缺陷 D 只做了 ①；②「按固定帧率聚合批量下发，复用 standard 的 `ENTITY_MOVEMENT_BATCH`」未做——实测推流仍是 push loop 的 1s tick，即"第三档≈1Hz"，本轮改用**服务端 follow + 到达回执**绕开了对高帧率推流的依赖，是否需要真正 10Hz 留待下一轮按需要评估）

**联测期使用说明**：临时工具 `scripts/_tmp_follow.js`（**v4 = 服务端 follow + keeper**，只在启动/停摆/到期时下发 follow，不再每秒重发 walk_to）、`scripts/_tmp_wait_chat.js`（增量读取真人聊天，UTF-8 安全）、`scripts/_tmp_where.js`（会话/位置诊断）、`scripts/_tmp_who.js`（推流实体 id 汇总）、`scripts/_tmp_fixb_live.js`（B 项真人侧顶替测试）；运行时产物在 `examples/agent-client/live/`（`events.jsonl` / `state.json` / `follow.log` / `inbox` / `done`）。上述临时脚本与产物保留到多轮联测全部结束再清理（用户已授权临时脚本可直接删除）。**本轮新增可重跑验收脚本**：`accept_agent_fix_a/b/c/d/e/f.js`。

> ⚠️ **运维注意（本轮实测踩到）**：`inbox/` 是"一命令一文件、执行即移走"，**目录里只要出现 `{"action":"__stop"}` 或任何旧命令文件就会被立即执行**——本轮驻场进程 10:43:30 就是被一个旧 `000009_stop.json` 意外结束的（`live/done/` 里的历史文件疑似被外部进程/客户端复原回 `inbox/`，同一现象也造成过 10:30:42 一条 say 被重复下发）。**重启驻场进程前先清空 `inbox/*.json`**；`events.jsonl` 是证据文件不要删。

### 游客模式联测（无 API Key，仅凭域名接入）✅ 2026-09-19

**测试方式**：不设 `AGENT_API_KEY`，只凭 `http://localhost:3002` 一个域名签公开临时票（`guest-pull` 拉模式）进场，与真人「米多」在世界内实时对话 / `follow` / 动作联测；同时用探针脚本逐条核对六步链路与两条新红线。

**六步链路实测：36/37 PASS**（脚本 `scripts/_tmp_guest_flow.js`，报告 `examples/agent-client/live/guest-flow-report.json`；唯一 FAIL 是断言写错——新游客会话 `spawn` 本就是 `(0,0,0)`，同一次运行里 `move` 后 `self` 立刻变 `27.60m` 已证明 `self` 是实时位置）：

| 步骤 | 实测 |
|---|---|
| ① 发现 | `/.well-known/virtual-world-agent.json` 与 `/api/agent/v1/capabilities` 均公开 200；`tiers.default=guest-pull`、`limits.observeRadiusMaxGuest=30`、`entityIdentity.uniqueIdField=id` |
| ② 签票 | 无任何鉴权头 → 200，`tier=guest-pull / mode=pull / expiresIn=1800`，`agent.id=agent:guest:<uuid>`，`tierInfo.pushAllowed=false`（不建 agents 行） |
| ③ 进场 | `ws://…/ws/agent?token=` → `READY{tier:guest-pull, pushTier:eco}` + `WORLD_SNAPSHOT`；`SUBSCRIBE → GUEST_PUSH_FORBIDDEN`；`PING→PONG` |
| ④ 感知 | 请求 `radius=200` **静默硬钳为 30**；连发两次 → `429 GUEST_OBSERVE_RATE_LIMITED` |
| ⑤ 聊天 | `chat/history?limit=30` 200；从 `senderId` 直接取到真人实体 id（去重/契约与 Key 档一致） |
| ⑥ 动作 | say→COMPLETED、第 2 条 say→`rate_limited`、rotate→COMPLETED、move→ACCEPTED 且 observe 实测位移 **27.60m**、`teleport→scope_denied`、`follow→ACCEPTED`、`walk_to` 打断 follow（`reason:superseded`）、第 2 条连接 `GUEST_IP_CONCURRENCY`+close 1013 |

**红线 14 独立复验**（探针 `scripts/_tmp_guest_push_probe.js`）：游客（eco）连上后 8 秒内**只收到 `READY` + `WORLD_SNAPSHOT`**，无任何 `CHAT`/`ENTITY_*` 推送。

**本轮新发现并修复（用户授权"按建议改"）**：

| # | 级别 | 问题 | 根因 | 修复与验证 |
|---|---|---|---|---|
| **B2** | P1 | **非游客档每秒给自己重复发一条 `ENTITY_ADDED`，永久重复** | `agentWsServer.js` 推送循环里，构造 `currentIds` 用了**全部** `playerPositions`（含自己），而扫描阶段已把 self 跳过、从不写进 `snap` → 自己永远被判定为"snap 里没见过的新实体" | `currentIds` 构造时排除 `pConnId === connId`。实测 `scripts/_tmp_fix_bcd_verify.js`：8 秒内 `self_added=0`（修复前 8 条）；**顺带暴露 `accept_agent_p3.js` 的 D1 原来绿是靠这条缺陷蒙过的**，已改为"先挂监听再让人类连续移动 3 次"（否则 1s 聚合窗口会把唯一一条 BATCH 吃掉）→ P3 恢复 12/12 |
| **C2** | P1 | **5 分钟空闲超时把"纯拉模式"客户端踢下线** | 活跃口径原为 WS `ACTION/SUBSCRIBE/UNSUBSCRIBE`；HTTP `observe` 与 `PING` 都不算 → 实测 Key 档 `workbuddy` 上线 15 分钟全程在拉，因只发过一条 SUBSCRIBE 就在 `ws_idle_timeout` 被断开 | 活跃信号扩容：**Key 档 `PING` 计入** + **HTTP `observe` 计入**（`observe.js` 调 `agentWsServer.touchActivityByAgent()`）；**游客 `PING` 不计**（防过期票靠空转 PING 长期占住"每 IP 1 连接"名额）。长时验证脚本 `scripts/_tmp_fix_c_idle_verify.js` **2/2 PASS**：阶段1 Key 档"只 observe 不动作"存活 **360s**（修复前 300s 必被踢）、18 次 observe 全成功，且**停止轮询后 5 分钟仍被正常回收**（回收器未失效）；阶段2 游客档"只 PING"在 **311s** 被踢（防滥用阀门保留） |
| **D2** | **部署阻断** | **反向代理后 per-IP 限流把全世界算成一个 IP** | `guest.js` 用 `req.ip`、`agentWsServer` 用 `socket.remoteAddress`，而 `server.js` 没设 `trust proxy` → 上线经 Nginx 后全部访客都是 `127.0.0.1` → **全球上限 = 10 张票/小时 + 同时只允许 1 个游客在线** | 新增 `src/middleware/clientIp.js`（`X-Real-IP` 优先 → `X-Forwarded-For` **最后一段** → socket；`TRUST_PROXY=false` 可关）+ `server.js` 调 `applyTrustProxy(app)` + WS upgrade 改用它。实测：带 XFF 的游客与默认 IP 游客**可同时在线**，同 IP 第二条**仍被拒** `GUEST_IP_CONCURRENCY` |
| **E2** | 工具 | 两个 `ai-live` 进程共用 `live/` 目录 | `inbox`/`events.jsonl`/`state.json` 是硬编码共享路径 → 命令被"谁先轮询谁执行"抢走、证据混流（本轮实际发生） | 未改代码：建议每 Agent 独立目录，或同一时刻只跑一个（列入下一轮待办） |

**游客档实测经验（写进下一轮操作手册）**：

- **找活人要用 `follow`，不要用 `walk_to`**：游客 2 秒才采样一次且只有 30m 视野，`walk_to` 打的是**上一帧的坐标**（实测真人跑开后仍走向旧点、偏差 6.43m）；`follow` 是服务端读 `playerPositions`，不受 30m 与采样率限制（实测 6.43m→1.63m 并持续跟随）。
- **签票 10 张/小时极易打满**：每次重连、每个探针都算一张，本轮一小时内就被打满（`retryAfter≈29 分钟`）；服务端重启会清空内存窗口。
- **本地表现为"换回环地址即换窗口"**：`localhost(::1)` 与 `127.0.0.1` 是两个独立 IP 窗口——这正是 D2 项问题在单机上的缩影。
- **游客票 30 分钟到期后的自然收尾**：HTTP `observe` 开始 401（客户端应重新签票），WS 仍连着但不再刷新活跃 → 5 分钟后被空闲超时踢出（等于一道天然的收尾阀门）。
- **客户端示例已加保活**：`ai-live.mjs` 每 60 秒发一次 `PING`（Key 档续命；游客靠周期 `observe` 续命）。

### v2 登录与多端联测 ✅ 2026-09-19（登录/鉴权边界矩阵 + 多端同时在线）

> 触发文档：`AI-Agent联测提示词-v2-登录与多端.md`。**本轮按用户指令"只测不改代码"**，产物 = 3 个可重跑脚本 + 缺陷清单（未修）。
> 方式：自动化矩阵（HTTP/WS 全链路）+ 驻场游客 Agent 与真人「米多」在世界内实时对话/跟随 + playwright 真浏览器观测真人端。

**矩阵结果（可重跑）**：

| 脚本 | 覆盖 | 结果 |
|---|---|---|
| `scripts/accept_agent_v2_auth_guest.js` | A 发现端点 / B 签票 / C WS 鉴权边界（401/403/4004/1013）/ D observe 半径与限频 / E 动作与红线 / F 签票限流 / G 聊天历史 / H 总开关 / X 瞬时断开泄漏回归 | **72/75**（修复前，3 个 FAIL = 已知缺陷 v2-1 ×2、v2-3 ×1）→ **75/75**（2026-09-19 v3 修复后，用例改名 X1/X2/E6） |
| `scripts/accept_agent_v2_auth_key.js` | K1 建 Agent / K2 换票与错误 Key / K3 Key 档特权（自身档位、SUBSCRIBE、200m、1Hz）/ K4 同角色多连接 4004 顶替 / K5 无动作限频 / K6 revoke / K7 C2 空闲续命压缩回归（独立实例 3003 + 阈值 3s）/ K8 删除清理 | **38/38** |
| `scripts/accept_agent_v2_multiend.js` | M1 多端在场与 entities 唯一性 / M2 多 Agent observe 公平性 / M3 带宽与 CPU + 红线 14 反证 / M4 Agent 互聊与契约 / M5 多 Agent 同时 follow / M6 聊天落库 / M7 真人端真浏览器 | **25/25** |

公共工具：`scripts/agentV2TestKit.js`（HTTP / 游客签票 / WS 连接（含 upgrade 被拒状态码）/ 真人 WS 观察者）。

**本轮新发现缺陷（均未修，按"只测不改"记录）**：

| # | 级别 | 现象与证据 | 根因（代码级） | 建议修复 |
|---|---|---|---|---|
| **v2-1** | **P1** | **WS 升级后"瞬时断开"→ 每 IP 名额 + 幽灵实体 + activeAgents 三项永久泄漏**。实测 **3/3 复现**（X 组）：客户端 `open` 后立刻 close（探活脚本/客户端崩溃/立刻 cancel），服务端 `handleClose` 永不执行 → ①该 IP 后续游客连接恒被 `GUEST_IP_CONCURRENCY` 拒绝（实测同 IP 换新票仍被拒）②`playerPositions` 留下停在原点的**不动 avatar**（真人可见、observe 也返回）③`activeAgents` 条目常驻占 `max_agents` 名额，心跳/空闲超时对它无效（socket 已关，`close()` 无效果）→ **只能重启进程清理**。**对照**：正常关闭（已收到 READY）后名额立即释放（C17b PASS）；另观测到一次"连接 800ms 后关闭"也泄漏 → 竞态窗口比"瞬时"更宽 | `src/websocket/agentWsServer.js` 的 `wss.on('connection', async (ws, ...))` 把 `ws.on('close')` / `ws.on('message')` **注册在函数末尾**，中间隔着 `await agentConfigService.getConfig()` 与 `await agentSessionManager.getLatestPosition()` 两次异步等待；若 close 帧先到，Node 已 emit 过 `'close'`，监听器永远挂不上 | 把 `ws.on('close')` / `ws.on('error')` / `ws.on('message')` 注册**提到第一个 await 之前**；函数开头再加 `ws.readyState !== OPEN → 立即清理` 兜底 |
| **v2-2** | P2（观察项） | 同一"会话不存在"（`SESSION_NOT_FOUND`）在 **WS 升级返回 401、HTTP 返回 403**（C5 实测 ws=401 / http=403） | `handleUpgrade` 只把 `TOKEN_EXPIRED` 映射 403，其余一律 401；`session.js` 的 `authenticateAgentToken` 对 `verifySession` 失败一律 403 | 统一口径或明确文档化差异 |
| **v2-3** | P2 | **`move` 被打断不补发 `ACTION_COMPLETED{superseded}`**，与 §5.2"移动类（move/walk_to/jump/follow）互斥且回执"契约不符（E6 实测：旧 move 的 requestId 无任何回执）；`walk_to`/`follow` 已实现 | `agentMovementService.startMove()` 未把 `requestId`/`reply` 写入任务对象（只有 `startWalkTo` 传），`cancelMovement` 里的 `notifyCompleted` 直接 return；`jump` 同样未注入 | `handleMove`/`handleJump` 与 `handleWalkTo` 一样注入 `{requestId, reply}` |
| **v2-4** | P3（观察项） | **连续 `move` 无显式停止入口**：七动作无 `stop`，`movementService.stopMove()` 导出但**零调用方**；只能靠 `walk_to` 到自身坐标或断线停下 | 动作集未定义停止语义 | 新增 `stop` 动作，或在协议文档明确"move 只能被其它移动指令打断" |
| **v2-5** | P3（观察项） | 多 Agent 同时 follow 同一目标时**位置完全重合**（实测最小间距 **0.00m**）——无 Agent 间避让/碰撞，真人观感"叠在一起" | 设计如此（Agent 之间只走 broadcastToNearby，无碰撞） | 若在意观感，可在推进里按序号给目标点加偏移 |
| **v2-6** | P3（代码卫生） | `src/routes/agent/guest.js` 自带 `clientIp()` 兜底取 `X-Forwarded-For` **第一段**（客户端可伪造段），与 `middleware/clientIp.js` 的"最后一段"口径相反 | 主路径 `req.ip`（Express trust proxy）恒有值 → 该兜底实际不可达（死代码） | 与 `middleware/clientIp.js` 合并为同一函数 |

**修复结果（2026-09-19 v3 轮，逐条验收脚本可重跑）**：

| # | 状态 | 修复内容（文件） | 验收证据 |
|---|---|---|---|
| **v2-1** | ✅ 修复 | `agentWsServer.js` 的 `wss.on('connection')`：① 把 `ws.on('message'/'close'/'error'/'pong')` **全部提到第一个 `await` 之前**（用 `earlyClosed` 记录"早到的 close"）；② 两处 `await` 之后加 `readyState !== OPEN` 兜底——state 尚未建立时直接 `releaseIpSlot` + 记 `ws_disconnected{phase:'closed_before_ready'}` 后退出（同时避免为死连接广播 `PLAYER_JOINED`），state 建好后再兜底一次走 `handleClose`（幂等，可重复触发） | 游客矩阵 **75/75**（X1/X2 由 FAIL→PASS：3 次瞬时断开 = **0 次名额泄漏 + 0 个幽灵实体**）；专项 `accept_agent_v2_defects_fix.js` **7/7**（V1 6/6 次同 IP 换新票**立刻重连成功**；V2 幽灵 0；V3 审计日志每次瞬时断开都有 `ws_disconnected`——6 次断开产生 11~12 条 `phase=closed_before_ready`，**修复前同期 0 条**且泄漏） |
| **v2-3** | ✅ 修复 | `agentActionService.js` 的 `handleMove`/`handleJump` 注入 `{ requestId, reply }`；`agentMovementService.js` 的 `startMove(…, opts)` 与 `jump(…, opts)` 把两者写入任务对象（jump **复用**既有任务时不覆盖旧 `requestId`），被打断/断线复用既有 `notifyCompleted` 补发 | 游客矩阵 E6 由 FAIL→PASS（`reason=superseded`）；专项 V4（move 被打断）/V5（jump 被打断）/V6（walk_to 到达未回归）全 PASS |

> **v2-1 根因复盘（同时写进坑 22）**：`wss.on('connection', async …)` 里**任何 `await`** 都会推迟生命周期监听器的注册；close 帧先到则 Node 已 emit 过 `'close'`，监听器永远挂不上 → `handleClose` 不执行 → 三项永久泄漏（每 IP 名额 / 幽灵实体 / `activeAgents` 占 `max_agents` 名额），且**心跳与空闲超时对它无效**（socket 早已关闭），只能重启进程清理。
>
> **v2-3 契约细节**：一条移动任务只挂**一个**待回执指令（`task.requestId`）——`jump` 复用在跑的任务（如 `walk_to` 途中起跳）时**不覆盖**已有 `requestId`，此时只有主指令收到 `superseded`（既定契约，非缺陷）；`reason='disconnected'` 的回执发给的是**已断开的连接**，客户端无法观测，其清理侧证据 = 审计日志的 `ws_disconnected`。

**多端实测数据（3 Agent × 5 模拟真人 + 真人端观测，本机口径）**：

- **observe 公平性**：Key 档 13~14 次/15s（≈1Hz）、游客档 7 次/15s（0.5Hz）；三方并发全部被服务、互不饥饿；未超频时 0 误报 429。
- **推流量（关键结论）**：realtime 档 Agent 实测 **105 条 `ENTITY_UPDATED` / 20s ≈ 5.2 条/秒 = ≈1Hz/实体**（5 个移动实体），**并非 10Hz** —— 量化证实第七节遗留项"第三档≈1Hz（推送循环为 1s tick）"；对应 **≈1KB/s / Agent**（推算 100 Agent ≈ 100KB/s ≈ 0.8Mbps，2 核 4G 可承载）。
- **红线 14 反证**：游客连接在同一 20s 窗口内收到 **0 条消息 / 0 字节**。
- **服务器 CPU**：多端在线期间 **0.19 核秒 / 20s ≈ 1% 单核**。
- **契约**：`CHAT.characterId ≡ entities[].id` 实测逐字一致；Agent 之间互聊、真人侧同收（30m 投递口径一致）。
- **多 Agent follow**：3 个 Agent 同时跟随同一真人全部收敛（2.2~2.5m）、各自任务互不干扰。
- **真人端（playwright headless chrome，真实 GPU）**：0 console/page error（唯一 404 = `favicon.ico`，按 `m.location().url` 判定）、`players.size=11`、**FPS 60**。
- **聊天落库**：`world_chat_log` 行数随多端发言增长（本轮 177→180）。

**检查单完成情况**：提示词 §1（登录/鉴权边界）全部用例已覆盖并脚本化；§2（多端）已覆盖 entities 唯一性 / 限频公平 / 带宽 CPU / 互见互聊 / 多 Agent follow / 真人端 0 error + FPS。
**本轮未覆盖**（留给下一轮）：Agent 之间的语音中继、多 Agent 抢占同一 follow 目标的"谁先到"、>30 分钟长会话的推流稳定性、`agent_observe_rate_key` 调高后多 Agent 的公平性。

### v3 缺陷修复轮（v2-1 瞬时断开泄漏 / v2-3 移动类回执）✅ 2026-09-19

> 触发文档：`AI-Agent联测提示词-v3-缺陷修复与深化联测.md`。**用户授权范围**：v2-1（P1 必修）+ v2-3（P2 建议同批）；**v2-2 / v2-4 / v2-5 / v2-6 四条观察项本轮未动**，等用户拍板（红线 11）。

**改动文件（3 个，产品代码仅 ~45 行）**：

| 文件 | 改动 |
|---|---|
| `src/websocket/agentWsServer.js` | 连接处理函数：4 个 `ws.on(...)` 前置到第一个 `await` 之前（`earlyClosed` 标记）+ 两处 `readyState !== OPEN` 兜底（早退时 `releaseIpSlot` + 审计 `ws_disconnected{phase:'closed_before_ready'}`；state 就绪后走 `handleClose`）。537 → 571 行（≤1000 上限内） |
| `src/agent/agentMovementService.js` | `startMove(…, opts)` / `jump(…, opts)` 接收并写入 `{ requestId, reply }`；`startMove` 打断旧任务时显式传 `reason='superseded'`；`jump` 复用既有任务时**不覆盖**旧 `requestId` |
| `src/agent/agentActionService.js` | `handleMove` / `handleJump` 与 `handleWalkTo` 一样注入 `{ requestId, reply }` |

**新增验收脚本**：`scripts/accept_agent_v2_defects_fix.js`（7 条判据）+ 报告 `examples/agent-client/live/v2-defects-fix.json`；`accept_agent_v2_auth_guest.js` 的 X 组两条与 E6 已由 `[已知缺陷 v2-x]` 改为正式用例名（X1/X2/E6）。

**验收结果（全部可重跑）**：

| 项 | 结果 |
|---|---|
| `accept_agent_v2_auth_guest.js`（修复前 72/75 → 修复后） | **75/75 PASS** |
| `accept_agent_v2_auth_key.js` | **38/38 PASS** |
| `accept_agent_v2_multiend.js` | **25/25 PASS** |
| `accept_agent_v2_defects_fix.js`（本轮新增） | **7/7 PASS**（V1 名额即时归还 / V2 无幽灵 / V3 审计日志 / V4 move 回执 / V5 jump 回执 / V6 walk_to 到达 / V7 说明） |
| 既有回归 | fix_a 24/24、fix_b 24/24、fix_c 15/15、fix_d 10/10、fix_e 12/12、fix_f 14/14、P1 14/14、P2 14/14、P3 12/12、P8 52/52、WS 重连保活 9/9 ACCEPTED、主世界冒烟 9/9 |

**本轮踩到并已沉淀的两个"测试自身缺陷"（写进坑 25/26）**：

1. **游客 tier 动作限频按 `action` 分桶**（1 次/2 秒）：同一动作 2 秒内第二次会被 `rate_limited` 直接拒掉，**根本走不到"打断"逻辑** → 专项 V5 首轮假失败（以为 jump 回执没实现）。写验收脚本时同类动作之间必须显式 `sleep(2100)`（不同动作互不影响）。
2. **管理员登录限流把成功登录也计数**（IP 5 次/分钟、**15 次/小时**）：连续跑多个 `accept_agent_*.js`（每个都要 admin token）必然 `RATE_LIMITED_IP_HOUR`（`retryAfter=3600`）→ fix_d/e/f 首轮三个全部 FATAL。计数器 `ipTracker` 在**内存**，重启服务器即清空（`login_attempts` 表只影响账号锁定，不影响 IP 小时窗口）。

---

## 第八节：已核对的代码坐标速查（写代码时直接引用）

| 用途 | 位置 |
|---|---|
| playerPositions / activeConnections 定义 | `src/websocket/wsServer.js:13-14` |
| PLAYER_JOIN 处理（广播字段清单） | `wsServer.js:225-259` |
| POSITION_UPDATE 处理 | `wsServer.js:295-316` |
| CHAT 30m 投递（P4 聊天记录写入点） | `wsServer.js:158-178` |
| broadcastToAll / broadcastToNearby / calculateDistance | `wsServer.js:365-401` |
| voiceRelay.init 注入点 | `wsServer.js:90-95`；心跳 `wsServer.js:102-110` |
| 语音协议（VOICE_MESSAGE 字段） | `src/websocket/voiceRelay.js:8-22, 224-269` |
| 前端 addPlayer 签名 | `public/js/world.js:1773`；GLB 加载 `world.js:2069-2071, 2094+` |
| 前端 PLAYER_JOINED/WORLD_STATE/MODEL_UPDATE | `public/js/websocket.js:224-259, 330+` |
| WS 连接地址（无 path！） | `public/js/config.js:60`；连接调用 `public/js/main.js:251, 684` |
| 游客标记与发送 | `public/js/main.js:222-268` |
| 游客传送拦截（前端） | `public/js/portalManager.js:272-277, 476-482` |
| 空间查询复用点 | `src/routes/worldSpatial.js:127-202` |
| Federation token 签发/验证 | `src/federationSystem.js:380-441, 448-498`；nonce 缺口 :471-473 |
| 联邦接收建号（email 模式，Agent 不走） | `src/routes/federation.js:729-840` |
| 服务器启动/WS 挂载 | `src/server.js:473-521` |
| 现有配置卡先例（后台三输入框模式） | `src/routes/config.js`（world-settings）、`public/js/adminModelLod.js` |
| 日志三分流（P8） | `src/services/logger.js`；接线 `src/server.js`（logger.start + httpMiddleware + 启动 ops） |
| tier 判定/限频/并发/半径（P8） | `src/agent/agentTierService.js`；常量 `src/agent/agentSchema.js`（AGENT_TIER_* / TIER_ACTION_RATES） |
| 游客公开签票（P8） | `src/routes/agent/guest.js`；签发 `src/agent/agentAuth.js`（issueGuestAgentJwt / buildGuestIdentity） |
| 游客/transient 会话表 | `src/agent/agentTransientSessionManager.js`（createGuestSession / buildAgentProfile 返回 _tier） |
| 连接注册表（缺陷 B） | `src/agent/agentConnectionRegistry.js`（register/unregister + 4004 顶替 + 被顶掉的连接静默清理）；接线 `agentWsServer` 连接处与 `handleClose` |
| 移动推进起点（缺陷 I） | `src/agent/agentMovementService.js` 的 `getCurrentPosition(session, connectionId)` + `agentPresenceBridge.getEntry(connectionId)` |
| 重连续位（缺陷 J） | `src/agent/agentSessionManager.js` 的 `getLatestPosition(agentId, excludeJti)`；`agentWsServer` 连接处作为第 5 参传入 `presenceBridge.onConnect` |
| 跟随服务（缺陷 C） | `src/agent/agentFollowService.js`（startFollow/cancelFollow）+ `agentActionService.handleFollow` + 移动类互斥 |
| 移动回执（缺陷 E） | `agentMovementService.notifyCompleted` / `cancelMovement(reason)`；WS 层注入 `ctx.reply`（`agentWsServer.handleAction`） |
| 发现端点同源（F/H） | `src/routes/agent/meta.js` 的 `ENTITY_IDENTITY` / `buildSharedSections(config)` |
| observe 采样率（缺陷 D） | `src/routes/agent/observe.js`（`keyRatePerSec()` 读 `agentConfigService.peekConfig()`） |
| 聊天持久化现状（无表，唯一例外 NPC） | `src/routes/npc.js:416-421`、`database/init.sql:391` |

---

## 第九节：已知坑与注意事项

1. **`WS_URL` 无路径**：任何"只允许 /ws 路径"的 upgrade 路由都会杀死全部现有浏览器客户端。兜底分流是铁律。
2. **黑名单文件零追加**：`federation.js`(33KB)、`federationSystem.js`(33KB)、`routes/world.js`(26KB)、`geometryBuilder.js` 等；wsServer.js 499 行贴线，只做 noServer 最小改动。
3. **单文件 ≤500 行**（理想），≤1000（绝对）；新功能一律新文件。
4. **前端拦截 ≠ 服务端权威**：游客传送限制在前端，Agent 必须服务端 scope 拦截（独立客户端不跑我们的前端）。
5. **POSITION_UPDATE 是 broadcastToAll 全量广播**：Agent 移动必须节流，否则带宽/CPU 线性上涨。
6. **语音 base64 一条 50~240KB**：是文字的 1000 倍，`agent_voice_relay` 默认关是承载能力的第一杠杆；聊天记录同样**永不存语音音频本体**。
7. **慢消费者背压**：AI 进程卡死不读 socket → bufferedAmount 膨胀拖死服务器内存，必须监控断开。
8. **服务器无地面/碰撞数据**：移动服务只做平面地面+边界，别承诺地形贴合。
9. **Nginx**：README 示例 `location /` 缺 Upgrade 头；`/ws/agent` 恰好命中 `location /ws` 有头分支，可直接工作。
10. **PowerShell 中文坑**：git commit 用 `-F` UTF-8 文件；node 脚本输出用英文；内联 SQL 的 `$1` 会被 PS 插值吃掉。
11. **服务器重启才生效后端改动**；前端改动需 Ctrl+F5 或 index.html 版本号递增。
12. **project 文件大小规则**：迁移放 `database/migrations/add_*.sql`（无序号前缀，幂等）。
13. **npm install 清包坑**：新增 `@aws-sdk/client-s3` 依赖必须登记进 package.json（否则下次 npm install 被清）；sharp 安装需 --ignore-scripts 先例可参考。
14. **归档防丢铁律**：未成功上传远端的本地聊天数据永不删除；重试 7 次仍失败则保留本地并告警，由人工介入。
15. **热路径配置必须"就地更新缓存"**（2026-09-19 缺陷 D 验收踩到）：移动速度 / observe 采样率在 10Hz 热路径上用 `agentConfigService.peekConfig()` 同步读 60s 缓存；`setConfigValue` 若只把 `cache` 置 null，热路径会**回落默认值**直到下一次 `getConfig()`，表现为"后台改了要等几十秒才生效"。正确做法：写完 DB 后把新值写进缓存对象的 `values`（敏感键除外）。
16. **`state.session` 是快照，不是实时状态**（缺陷 I/J 根因）：它是 WS 连接时从 DB 读入的那一行，之后只在 DB 更新、内存对象永不刷新。任何"当前位置"都不能读它（`walk_to` 用它当推进起点 → 每条新指令都从出生点重走、位置每 4 秒循环）；新会话（重连必换 jti）没有位置 → 要用 `getLatestPosition` 继承上次位置，否则 Agent 一重连就瞬移回原点。
17. **客户端定位实体必须按 `id`**：世界里存在同名角色（实测两条"米多"= 两个不同 id）与 id 不带 `agent:` 前缀的旧 Agent 条目；按"最近的 human"等启发式盲选会跟错目标（本轮临时跟随脚本踩过）。
18. **Agent 速度必须与真人同量级**：真人 ≈9 m/s（`player.js` 0.15/帧 @60fps），Agent 原固定 5 m/s 在真人正常走路时就永远追不上（用户现场决策：改为 `agent_max_speed` 可配、默认 9）。
19. **反代后必须信任代理头取真实客户端 IP**（游客联测 D2，**部署阻断级**）：`req.ip` 与 `socket.remoteAddress` 在 Nginx 之后恒为 `127.0.0.1`，而 per-IP 限流（游客 10 张票/小时、每 IP 1 连接）全按它计数 → 全世界被算成一个 IP。已加 `src/middleware/clientIp.js` + `server.js` 的 `applyTrustProxy(app)`（默认信任 1 层、取 `X-Real-IP` 或 XFF 最后一段）；**若服务直接暴露公网必须设 `TRUST_PROXY=false`**，否则客户端可伪造这两个头绕开限流。
20. **活跃度口径 = "客户端还活着"的信号**（游客联测 C2）：`ACTION`/`SUBSCRIBE`/`UNSUBSCRIBE` + **Key 档 `PING`** + **HTTP `observe`**（路由侧调 `agentWsServer.touchActivityByAgent`）；**游客 `PING` 故意不计**（临时票不可续期，防过期连接靠空转 PING 长期占住每 IP 名额）。以后新增消息类型或新增拉取端点，别忘了同步这里——否则纯拉模式客户端会被空闲超时误杀。
21. **推送循环里"自己"必须在两处都排除**（游客联测 B2）：位置扫描阶段跳过 self（不进 `snap`），"新增实体集合"也必须同样跳过，否则 self 会被当成"没见过的新实体"每秒重复发 `ENTITY_ADDED`。**副作用提示**：修好后 `ENTITY_ADDED` 实际只在"实体没有 position"时才可能触发（有 position 的新实体一律由位置流以 `ENTITY_UPDATED` / `ENTITY_MOVEMENT_BATCH` 首次下发）——客户端应按"未知 id 即新建"处理，协议语义统一列入下一轮。
22. **WS 事件监听器必须"先注册后 await"**（v2 联测 v2-1，P1；**2026-09-19 已修复**，作为通用教训保留）：`wss.on('connection', async ...)` 里任何 `await`（DB 查询等）都会把 `ws.on('close')` 的注册推迟；若客户端在注册前断开，Node 已经 emit 过 `'close'`，**监听器永远收不到** → `handleClose` 不执行 → 每 IP 名额 / `playerPositions` 幽灵实体 / `activeAgents` 名额三项永久泄漏，且只能靠重启清理（心跳与空闲超时对它无效，因为 socket 早已关闭）。**修复**：① 所有生命周期监听器前置到第一个 `await` 之前（早到 close 用 `earlyClosed` 标记）；② `await` 之后加 `ws.readyState !== OPEN` 兜底（state 未建 → 归还每 IP 名额 + 审计后退出；state 已建 → `handleClose`，必须幂等）。**通用教训**：任何"连接生命周期清理"的注册都必须放在 `await` 之前，并配一个同步兜底。
23. **移动类回执的完整语义**（v2-3 **已修复 2026-09-19**；v2-4 仍待决策）：§5.2 的"移动类（move/walk_to/jump/follow）互斥 + `ACTION_COMPLETED{reason}`"契约里，原只有 `walk_to` / `follow` 注入了 `requestId`/`reply`，`move` / `jump` 被打断时 `notifyCompleted` 直接 return（已修：四个动作现在都注入）。**注意两条已定契约**：① 一条移动任务只挂**一个**待回执指令（`task.requestId`），`jump` 复用正在跑的任务（如 `walk_to` 途中起跳）时**不覆盖**旧 `requestId`，此时只有主指令收到 `superseded`；② `reason='disconnected'` 的回执发给的是**已断开的连接**，客户端观测不到，清理侧证据看审计日志 `ws_disconnected`。**仍未做**：动作集里**没有 `stop`**，`movementService.stopMove()` 是零调用死代码 → 连续 `move` 只能靠 `walk_to` 到自身坐标或被其它移动指令打断（v2-4 待用户决策）。
24. **写 Agent 联测脚本的三个坑**（v2 联测沉淀）：① **签票窗口会被烧掉**——同一 IP 每小时只有 10 张，且每张都算，脚本必须把"签票 IP"与"WS 连接 IP"解耦（票不绑 IP，只有"每 IP 并发 1 连接"看连接来源），并让每次运行的 IP 随运行号偏移，否则重跑必然 429；② **判定幽灵实体必须用"之后不再连接的票"**——同一张票重连会复用同一 `agentId`，用它去 observe 分不清幽灵与在线者；③ **`observe` 的 `distance` 是"相对请求方"的距离**，多 Agent 横向对比时必须自己按坐标算（否则会得出"三个 Agent 距离完全相同"的假结论）。
25. **游客动作限频是"按 action 分桶"的 1 次/2 秒**（v3 轮踩到，脚本假失败）：`agentSchema.TIER_ACTION_RATES[guest]` 里 `move`/`walk_to`/`jump`/`follow`/`rotate`/`interact`/`say`/`observe` 各自独立计数。同一动作 2 秒内第二次会被 `rate_limited` **直接拒掉，根本走不到被测逻辑**——专项脚本 V5 首轮因此假失败（误判"jump 回执没实现"）。写用例时：同一动作之间必须显式 `sleep(2100)`，或换用另一个动作类型做打断源。
26. **管理员登录限流的 IP 小时窗口把"成功登录"也计数**（v3 轮踩到，回归前置失败）：`loginRateLimiter` 的 admin 策略 = IP **5 次/分钟 + 15 次/小时**（`RATE_LIMITED_IP_HOUR`，`retryAfter=3600`），而每个 `accept_agent_*.js` 都要先登录一次拿 admin token → 连续跑多个脚本必被打满（本轮 fix_d/e/f 三个全 FATAL）。计数器 `ipTracker` 在**内存**：**重启服务器即清空**；`login_attempts` 表只影响"账号锁定"，不影响 IP 小时窗口。**多条脚本连跑时，把它们分组、组间重启一次服务器**。

---

## 第十节：总验收（全链路"AI 可进入的世界"达成判据）

一条链跑通即宣告成功：

```
外部 AI 进程
→ GET /.well-known/virtual-world-agent.json（仅凭域名）
→ POST /session（API Key）→ 短期 JWT
→ 连 /ws/agent → READY + WORLD_SNAPSHOT
→ 同一时刻，真人浏览器出现其 3D Avatar（GLB+动画）+ "(AI)加入了"
→ observe 返回雷达 JSON
→ say → 真人头顶气泡；真人回话 → AI 毫秒级收到
→ walk_to → 服务端限速推进 → 真人看到走路动画
→ 尝试 teleport/坐标传送 → 服务端 REJECTED（与游客准则一致）
→ 断线 → PLAYER_LEFT，位置落库
→ 次日归档任务自动把聊天打包上传远端，保留期满自动清理
```

附加判据：全程真人端 0 console error；现有 /ws 与 /api/auth/* 行为零变化；100 Agent @ eco 档压测下 2核4G 本地服务器稳定。

---

## 进度日志（每会话追加一行）

| 日期 | 会话内容 | 阶段状态 |
|---|---|---|
| 2026-09-17 | 架构审计+方案定稿+本文档创建 | P0 ✅，P1 待开工 |
| 2026-09-17 | 增补定稿：聊天记录双保存（本地+定时远端归档，S3 兼容/百度网盘预留）、保留期后台可设、到期清除；文档 7 处同步（红线13条/5.5节/6.1/6.3/P4 任务/验收⑧⑨⑩/工期 P4=2-3 会话，总 8-10 会话）；审计结论补第 19 项（聊天无持久化现状） | P0 ✅，P1 待开工（用户指示暂不开工） |
| 2026-09-17 | P1 完成：迁移 2 个（agents/agent_api_keys/agent_sessions 三表，db.js 已注册）；src/agent/ 六模块（schema/auth/manager/sessionManager/permission/config）；routes/agent/（index+session，POST /session・GET /me・POST /session/revoke + IP 限流 10/min + 双门认证 JWT 验签+jti DB 权威）；.env AGENT_JWT_SECRET；server.js 挂载 /api/agent/v1。验收 accept_agent_p1.js 14/14 PASS。测试 Agent p1_test_agent 留库（Key 可用 scripts/agent_create_test.js 换发）；agent_enabled 已恢复 false（红线默认关）。git 未提交（用户要求等确认） | P1 ✅，P2 待开工 |
| 2026-09-17 | P2 完成：agentObservationService.js（复用 worldSpatial /around 同口径方框查询，按距离升序，objects 精简 5 字段无私有字段，entities 从 getPlayerPositions + self 永远包含）；observe.js（GET /observe + 1Hz 限频 + scope 校验）；session.js 加 1 行导出 authenticateAgentToken；index.js 挂载。验收 accept_agent_p2.js 14/14 PASS（①observe 真实坐标核对+self/entities/world 字段+无私有字段 ②radius 截断+硬上限 200 ③/around 回归结构不变+完整字段分离 ④1Hz 超频 429+窗口恢复 附加：无/伪造 token 401）。git 未提交（用户要求） | P2 ✅，P3 待开工（用户指示停下等确认） |
| 2026-09-17 | P3 完成（最关键最险阶段）：upgradeRouter.js（/ws/agent→agent，其余→human 兜底，铁律：CONFIG.WS_URL 无路径）；wsServer.js noServer 最小改动+getWss 导出（500 行贴线不超）；agentPresenceBridge.js（写 playerPositions entityType:agent isGuest:true + 广播 PLAYER_JOINED 含 avatar 六件套+entityType）；agentWsServer.js（鉴权→max_agents检查→presenceBridge→READY+WORLD_SNAPSHOT；SUBSCRIBE/PING/ACTION占位；令牌桶聊天永不丢+背压1MB警4MB断+30s心跳；三档推送 eco/standard 1s聚合/realtime 逐条+ENTITY_ADDED/REMOVED；CHAT旁路 monkey-patch broadcastToAll）；前端 websocket.js 5 行（(AI)加入了+🤖前缀，红线c只碰6.2清单）+index.html?v=5；README Nginx location/补Upgrade头。验收 accept_agent_p3.js 12/12（②③⑤⑥⑦）+ accept_agent_p3_playwright.js 6/6（①④）+ 红线a node WS 根路径回归 → 7/7 全过。git 未提交（用户要求） | P3 ✅，P4 待开工（用户指示停下等确认） |
| 2026-09-18 | P4 完成（行动系统+聊天记录，一轮会话）：①卡片位置迁移——admin.html「用户与角色」页加「🤖 AI Agent」+「📦 聊天归档」两 sub-tab（逻辑在 js/adminAgentSettings.js 独立文件，红线不碰 admin.html 既有代码）；②agentMovementService.js（5m/s 限速/边界±1000/平面 y/10Hz setInterval 推进/animMode 派生 idle/walk/jump，经 presenceBridge.updatePosition 复用 POSITION_UPDATE 广播）；③agentActionService.js 六动作（move/walk_to/rotate/jump/say/interact）+ scope 校验（walk_to 共享 move scope）+ requestId 回执 + 距离校验 + 红线 teleport/set_position 永远 REJECTED；④routes/agent/action.js（HTTP 备用入口，引导走 WS）+ chatHistory.js（GET /chat/history）+ admin.js（管理员端点 list/create/disable/enable/regenerate-key + config 读写 + archive/run-now）；⑤add_world_chat_log.sql（world_chat_log 表）+ wsServer.js CHAT 分支 1 行异步 INSERT（不阻塞广播）+ chatLogService.js；⑥chatArchiveService.js（每日定时 runArchiveCheck→archiveDay→JSONL→gzip→S3 上传重试 7 次指数退避→markArchived→cleanupExpired 仅清已归档行，红线13 防丢铁律）；⑦agentWsServer.js ACTION 占位换真处理 + CHAT patch 同时拦截 broadcastToAll+broadcastToNearby + 携带 position 字段（人类 CHAT 也带 position 供 Agent 距离过滤）；⑧@aws-sdk/client-s3 登记进 package.json（防 npm install 清包）；⑨agentConfigService.js 扩展 9 个 chat_log_* 配置键 + SENSITIVE_KEYS 加密存储（access_key/secret_key 走 configService.encrypt+is_sensitive=true）；⑩agentSessionManager.js 加 updatePosition（移动服务每帧同步位置到 session，断线重连从该位置恢复）。验收：accept_agent_p4.js 25/25 PASS（②③⑤⑧⑨⑩+管理员端点+红线a）+ accept_agent_p4_playwright.js 11/11 PASS（①④⑥⑦）= 36/36 全过；P3 回归 12/12 PASS 无回归。修了 2 个真 bug：(a) walk_to 不在 AGENT_SCOPES 中被 scope_denied 误拒（改为 walk_to 检查 move scope）；(b) chatArchiveService.runArchiveNow 不尊重 remote_enabled=false（force=true 绕过检查 → 改为先检查 remote_enabled）。git 未提交（用户要求）；ubuntu-deploy-package 未同步。环境：agent_enabled=false（红线恢复默认关）/max_agents=50/pushDefault=eco；测试 Agent p4_test_agent + p4_pw_agent_1~5 留库 | P4 ✅，P5 待开工（用户指示停下等确认） |
| 2026-09-18 | P5 完成（Agent 跨世界联邦传送，一轮会话）：①add_federation_nonce.sql（token_usage 表 nonce 一次性消费 + agent_transient_sessions 表跨世界 transient session，独立于 agent_sessions 避外键约束）；②agentTeleportService.js（核心：prepareTeleport 签发 RS256 handoff token principalType:'agent'+agentId+avatarConfig+homeWorld+nonce TTL 300s，iss=源worldId aud=targetWorldId，只读 federationSystem.privateKey/trustedWorlds/worldId 不调 generateTeleportToken 人类口径；acceptTeleport 解码 iss→trustedWorlds 拿源 publicKey→RS256 验签+iss/aud 校验→principalType 校验→nonce INSERT ON CONFLICT DO NOTHING 原子消费→createTransientSession+issueTransientAgentJwt）；③agentTransientSessionManager.js（transient session CRUD + buildAgentProfile 从 session 行重建 agent 对象供 agentWsServer 鉴权用）；④agentAuth.js 加 issueTransientAgentJwt（payload isTransient:true，agentWsServer 识别走 transient 路径）；⑤agentSessionManager.verifySession 兼容 transient session（先查 agent_sessions，回落 agent_transient_sessions，返回 session.isTransient 标记）；⑥agentWsServer.authenticateUpgrade 识别 transient session（isTransient=true 时跳过 agentManager.getAgentById 用 buildAgentProfile）；⑦routes/agent/federation.js（POST /teleport/prepare Agent JWT 鉴权 + GET /worlds + /status，挂 /api/agent/v1/federation）；⑧routes/agentFederation.js（POST /teleport/accept 公开端点 handoffToken 自身 RS256 鉴权 + GET /info，挂 /api/agent/federation 独立于 /v1）；⑨agent/index.js 路由顺序修复（federation 必须在 admin 之前，避免被 authenticateAdminToken 全局中间件拦截）；⑩db.js 注册迁移 + server.js 挂载 /api/agent/federation 路由。红线全部遵守：a federation.js/federationSystem.js 零追加只读 trustedWorlds/privateKey；b 人类传送链路一行不动；c principalType:'agent'+transient session 不建 user/character（A 端 users/characters 表行数前后不变实锤）；d nonce 一次性（重放 409 NONCE_REPLAY 实锤）；e handoff TTL 300s+iss/aud 校验+agentId/avatarConfig/homeWorld 完整传递。测试方案：本机单实例限制，scripts/agent_federation_mock_world.js 模拟 World B（3003，启动时与 A 双向建立联邦信任，实现 /handshake+/info+/teleport/accept 桩，nonce 内存 Set 模拟 token_usage）。验收 accept_agent_p5.js 36/36 PASS（判据①身份/Avatar 跨世界不变 8 项 + 判据②nonce 重放被拒 2 项 + 判据③无 email 建号 6 项 + 判据④两端可见进出 4 项 + 红线 can_teleport=false 被拒/未信任目标世界被拒 3 项）。修了 2 个真 bug：(a) agent/index.js 路由顺序——admin 子路由 router.use(authenticateAdminToken) 是全局中间件，会拦截所有未被前面子路由匹配的路径（含 /federation/*），federation 必须在 admin 之前挂载；(b) 模拟桩缺 /api/federation/handshake 端点（establishTrust 调的是 /handshake 不是 /info）。git 未提交（用户要求）；agent_enabled=false（红线恢复默认关）；ubuntu-deploy-package 未同步。测试 Agent p5_test_agent 已清理 | P5 ✅，P6 待开工（用户指示停下等确认，不开 P6） |
| 2026-09-18 | P6 完成（自动发现 + SDK，一轮会话）：①routes/agent/meta.js 新建（GET /capabilities 返回 scopes/actions/push tiers/ws 消息目录/limits；GET /openapi.json 返回 OpenAPI 3.0 schema 仅含实际已实现端点未实现不写——11 个 path 逐项核对：session/me/session/revoke/observe/chat-history/action/capabilities/openapi.json/federation-worlds/federation-status/federation-teleport-prepare；buildWellKnown 工具函数 worldId/worldName/worldUrl 来源优先级 federationSystem→system_config('world_url')→req 推导）；②server.js 加 `app.get('/.well-known/virtual-world-agent.json',...)` 静态路由级挂载（公开无鉴权 1min 缓存）；③agent/index.js 挂载 meta 子路由（**必须在 admin 之前**——admin.js 内部 `router.use(authenticateAdminToken)` 是子路由级全局中间件，会拦截所有未匹配路径，与 P5 federation 路由顺序 bug 同源——meta 路径需先声明才能不被拦截）；④examples/agent-client/node-agent.mjs 新建——零依赖 Node 18+ 示例客户端，链路 domain→well-known→session→WS?token=→READY/WORLD_SNAPSHOT→SUBSCRIBE→observe→say→walk_to→teleport 拒（演示红线 2）；附 README.md 三步跑通说明；⑤README.md 加 "AI Agents" 章节（Discovery / Identity & Permission / 六动作 / 推送三档 / 联邦传送 / Quick Start / 13 条架构红线）；⑥**WS 鉴权降级**：agentWsServer.authenticateUpgrade 加 `?token=<jwt>` 查询参数降级路径（与 Authorization 头并存）——WHATWG WebSocket（Node 内置）与浏览器无法设自定义请求头，查询参数是 WebSocket 鉴权标准降级模式（JWT 15min TTL，access log 含 token 已知风险需保护 log）。**修了 3 个真 bug**：(a) `agent_create_test.js` 的 `apiKey = await agentManager.createApiKey(agent.id)` 误把返回对象 `{key, keyPrefix}` 当字符串打印（API_KEY=[object Object]）——P6 验收用临时脚本绕过；(b) demo 首版用 `ws.on('message', ...)` EventEmitter 风格但 Node 18+ 全局 WebSocket 是 WHATWG 标准（用 addEventListener）——已改写为 addEventListener + e.data 是 string；(c) demo 用 `process.exit(0)` 同步退出导致 stdout 块缓冲未刷新，子进程输出在 exit 时丢失——改为 `process.exitCode=0` 让 Node 自然 drain。验收：accept_agent_p6.js 83/83 PASS（well-known 字段齐全 / capabilities 公开可读 / openapi paths 与实际实现逐项核对未实现端点不写 / dryrun 仅凭域名发现→capabilities / well-known 与 capabilities WS 端点一致 / agent_enabled=false 时公开端点仍 200 / HTTP 端点可达性与鉴权门）+ accept_agent_p6_playwright.js 10/10 PASS（**轮询浏览器模式**，不依赖子进程 stdout 标记触发检查——块缓冲会让 stdout 标记延迟到达导致检查时机错位：Agent 入场 players.size +1 t=856ms / 聊天 DOM 含 (AI)/Hello t=856ms / Agent walk_to 位置变化 (0,0,0)→(3.5,0,0) t=1713ms / Agent 离场 players.size 回到 1 t=7273ms / demo 子进程 exit 0 / demo stdout 含全链路证据 / teleport→ACTION_REJECTED scope_denied 红线 2 / 0 console error）= **93/93 全过**。环境：agent_enabled=false（红线恢复默认关）/max_agents=50；测试 Agent p1_test_agent 留库（P1 起）；git 未提交（用户要求）；ubuntu-deploy-package 未同步（meta.js/index.js/server.js/agentWsServer.js/examples/README.md/accept 脚本） | P6 ✅，P7 占位（可选，本轮不做） |
| 2026-09-18 | **项目收官**：临时文件清理（删 p6_pw_log.txt、scripts/agent_create_test.js；保留全部 accept_agent_*.js 与 agent_federation_mock_world.js——P5 验收依赖桩）；输出 ubuntu-deploy-package 部署包同步清单与存量库部署注意事项（4 个迁移 SQL 由 db.js 启动自动执行；.env 新增 AGENT_JWT_SECRET 必填，AGENT_BACKPRESSURE_WARN/KILL 可选）；agent_enabled=false（红线默认关）。git 待用户明确指令后提交 | **项目收官**（P0-P6 全部完成，P7 占位不做） |
| 2026-09-18 | **真人双端联测完成（收官加验）**：AI 助手经 Agent 接口长连接进场 + 用户真人浏览器，双端实时对话/指挥移动全链路实测。暴露并修复 5 个自动化验收测不出的真 bug：①人→Agent 聊天转发被绕过（wsServer CHAT 裸调用内部函数，改经 module.exports）②admin 创建 Agent 500（apiKey 对象当字符串 slice）③Agent 半身埋地（客户端贴地+棍人 1.5/GLB 0 动态偏移）④移动即隐身（bridge rotation 对象→矩阵 NaN，归一化为数字）⑤走路卡顿（新增 agentPositionSmoother.js 客户端平滑）。新增功能：Agent 空闲超时踢出（默认 5min，env 可调，已实测）；新增工具 ai-view.mjs 分步体验 + ai-live.mjs 长连接驻场。用户真人验收：双向聊天/19 米全程可见/移动中说话/平滑行走（"已经非常棒了"）/空闲自动消失 全部通过。agent_enabled 已恢复 false；运行时产物已清理 | 联测 ✅ 项目收官确认 |
| 2026-09-18 | **P8 规划定稿（拉/推双模式开放生态，用户提出）**：核心洞察=上线初期风险是"没人来"而非滥用；把门禁倒过来——稀缺的是服务器推流成本而非进门资格。游客 Agent（无 Key）=拉模式：公开临时票 30min、纯请求-响应（observe 30m/2s、say 1条/5s、动作 1次/2s）、禁 SUBSCRIBE 推流、每 IP 并发 1、复用空闲踢出；Key Agent=推模式（现有三档推送成为 Key 特权）；升级漏斗=游客玩出粘性→管理员发 Key 转正。红线 3 修订（Key 从进门凭证降级为推流特权）。工作量 1~1.5 会话，未开工。详见第 7 节 P8 规划 | P8 ⬜ 规划定稿待开发 |
| 2026-09-18 | **【事故】工作区文件丢失 + 内存恢复**（13:16 发生，永久性删除未进回收站）：src/agent 下 5 个、src/routes/agent 下 5 个、agentFederation.js、chatArchiveService.js 被删；observe.js 与 upgradeRouter.js 被截断为 0 字节；session.js 回退到 P2 旧版（丢 P5 transient 分支）。服务器一旦重启即崩溃。恢复方式=服务器进程启动于删除之前，用 `process._debugProcess(PID)` 附加 V8 inspector，经 CDP `Debugger.enable` + `Debugger.getScriptSource` 取回全部脚本源码（sha256 校验逐字节一致）；重建 2 个迁移 SQL（按 information_schema 核对）+ adminAgentSettings.js + agentPositionSmoother.js（内存无副本）。**未能恢复**：examples/agent-client/{node-agent.mjs,ai-view.mjs,ai-live.mjs,README.md}、accept_agent_p4/p5/p6 系列、agent_federation_mock_world.js。教训：未提交改动随时可能消失，新会话引用记忆结论前必须核对文件存在性（与 2026-09-14 卡顿治理代码丢失同源） | 事故已处理，P0-P6 全部恢复（commit a2e0f688） |
| 2026-09-18 | **P8 完成（拉/推双模式，一轮会话）**：①`src/services/logger.js` 日志三分流（access 7天/ops 30天/audit 365天，按天轮转 + 过期清理 + Express 中间件过滤 /health），server.js 3 处接线，session.js 与 agentWsServer.js 的 `audit()` 改分流，新增 WS 连断与签票 access 条目；②`src/agent/agentTierService.js`（tier 判定 / 限频 / 每 IP 并发 / 半径钳制）；③`src/routes/agent/guest.js` 公开签票端点（30min，`agent:guest:<uuid>` 合成身份落 agent_transient_sessions 无外键表）；④agentAuth.issueGuestAgentJwt + buildGuestIdentity；⑤agentWsServer 游客处理（IP 并发闸门、强制 eco/off/off、SUBSCRIBE 拒绝 GUEST_PUSH_FORBIDDEN、READY 带 tierInfo、close 归还名额）；⑥observe.js 按 tier 钳半径与限频（游客 1/2s，Key 1Hz 不变）；⑦agentActionService 按 tier 动作限频；⑧**修复真 bug：`authenticateAgentToken` 用 `getAgentById(payload.sub)` 查游客/transient 身份会因 `agent:guest:<uuid>` 不是合法 UUID 抛类型错误 → 改从 session 行重建 profile**（与 agentWsServer 同口径）；⑨发现端点同步（well-known / capabilities 加 tiers 段，openapi 加 /guest/session）；⑩重建 examples/agent-client（node-agent.mjs + README，含拉模式路径）；⑪README 加双模式表 + 红线 14/15 + 日志运维章节。验收 **accept_agent_p8.js 52/52 PASS**；回归 P1 14/14、P2 14/14、P3 12/12。环境：agent_enabled 恢复 false；服务器 3002 已重启跑 P8 代码 | **P8 ✅**（P0-P6+P8 全部完成） |
| 2026-09-18 | **第一轮多端联测（代码冻结，只记录不修）**：用户真人浏览器 + AI 助手经 Agent 接口驻场（Key Agent `workbuddy`，key-push/realtime 档）实时对话 + 跟随实测。过程：先在客户端侧绕开两处（a 自身位置改用实体表条目自行算距离、b 目标选择改为"正在移动的人"）后跟随成功——234 次采样、距离末值 0.16m、实测移动速度 4.9~5.8 m/s（与 MAX_SPEED=5 一致）；用户体感"总在找我"归因于 C/D/E 三项。新发现 **8 条待办**：A `self` 双源不一致（P0）/ B 同角色多连接 → observe 重复实体（P0，**接口层重复；用户实测真人端看不到两个 avatar，仅表现为"移动时原地徘徊"，含另一个已证实成因，待复现区分**）/ C 无跟随语义（P1）/ D observe 1Hz 限制闭环（P1）/ E walk_to 无到达回执（P1）/ F 实体标识契约（同名是常态、必须按 `id` 定位，P2 契约项）/ G 示例客户端聊天双通道重复（P2）/ H capabilities 缺 tier 明细（P2），详见第七节新增「多轮联测与缺陷待办」。**用户决策：先不改代码，后续再做多轮（计划 3 Agent + 5 真人同时在线）集中整理后统一开发**。临时工具 `scripts/_tmp_follow.js`、`scripts/_tmp_wait_chat.js` 与 `examples/agent-client/live/` 产物保留到联测结束 | **代码冻结，多轮联测中（第一轮 ✅）** |
| 2026-09-19 | **游客模式联测（无 API Key，仅凭域名接入）+ 4 项修复**：用游客临时票进场与真人联测六步链路（**36/37 PASS**；唯一 FAIL 为测试断言写错），红线 14 独立复验（探针 8 秒只收到 READY+WORLD_SNAPSHOT）。**新发现并修复 4 项**：**B2（P1）**非游客档每秒给自己重复发 `ENTITY_ADDED`（`currentIds` 未排除自身）→ 1 行修复 + 实测 8 秒 0 条；**顺带发现 `accept_agent_p3.js` 的 D1 原来"绿"是靠该缺陷蒙过**（先移动后挂监听 + 1s 聚合窗口竞态），已改为先挂监听再连续移动 → P3 恢复 12/12；**C2（P1）**5 分钟空闲超时踢掉纯拉模式客户端（实测 Key 档 workbuddy 全程在拉、只发过一条 SUBSCRIBE 就被踢）→ 活跃口径扩容为 Key 档 PING + HTTP observe（游客 PING 不计，保防滥用阀门）；**D2（部署阻断）**反代后 per-IP 限流把全世界算成一个 IP（`req.ip`/`socket.remoteAddress` 在 Nginx 后恒为 127.0.0.1 → 全球 10 张票/小时 + 同时只允许 1 个游客）→ 新增 `src/middleware/clientIp.js`（X-Real-IP → XFF 最后一段 → socket，`TRUST_PROXY=false` 可关）+ `server.js` 接线 + WS 侧改用它，实测不同真实 IP 可同时在线、同 IP 仍被拒；**E2（工具）**两个 `ai-live` 进程共用 `live/` 目录抢命令与证据混流（记入下一轮待办）。示例客户端 `ai-live.mjs` 加 60 秒 PING 保活。回归全绿：P1 14/14、P2 14/14、P3 12/12、P8 52/52、WS 重连 9/9、主世界冒烟 9/9；`_tmp_fix_bcd_verify.js` 11/11。服务器已重启跑新代码；联测期间 `agent_enabled=true`（收尾恢复 false） | **游客档（拉模式）可用 ✅** |
| 2026-09-19 | **第一轮联测缺陷全部修复（代码解冻后一轮会话，含两轮真人现场联测）**：①**A（P0）**`agentObservationService.resolvePosition` 观察点优先取 playerPositions 实时位置（`pickLiveEntry` 取带 animMode/最新的一条），`self` 与所有 `distance` 同源修正 → `accept_agent_fix_a.js` 24/24（纯 HTTP 第二会话 self 不再恒为 (0,0,0)，106 项 distance 误差 0.0048m）。②**B（P0）**新增 `src/agent/agentConnectionRegistry.js`：`entities` 按 characterId 去重 + 单 Agent 并发上限 `agent_max_connections_per_agent`（默认 1，新连接顶掉旧连接 close 4004，被顶掉的连接**静默清理不广播 PLAYER_LEFT** 防 avatar 闪断）→ `accept_agent_fix_b.js` 24/24；真人复测双向 4004、换连接后位置不变。③**C（P1）**新增 `agentFollowService.js`：`follow{targetId,stopDistance,maxDurationMs}` 服务端 10Hz 持续跟随（不再客户端每秒重发 walk_to）→ `accept_agent_fix_c.js` 15/15（目标直线移动 30s、27 次采样全 ≤2.80m）。④**E（P1）**移动任务注入 `reply`，到达/被打断/断线补发 `ACTION_COMPLETED{reason: arrived\|superseded\|target_lost\|timeout}` → `accept_agent_fix_e.js` 12/12（estimatedMs 4800 vs 实测 4946ms）。⑤**D（P1）**`agent_observe_rate_key`（默认 1 = 行为不变，可调 1~10）→ `accept_agent_fix_d.js` 10/10（5Hz 时 `200×5,429,429`）。⑥**F/H（P2）**`meta.js` 抽出 `ENTITY_IDENTITY` + `buildSharedSections`，capabilities / well-known / openapi 三处同源同形（含 entityIdentity 契约与 limits）→ `accept_agent_fix_f.js` 14/14。⑦**G（P2）**`ai-live.mjs` 双通道聊天去重。**联测现场另发现并修复两项 P0**：**I** `walk_to` 推进起点用会话快照（内存永不更新）→ 位置每 4 秒原样循环、`estimatedMs` 恒按 (0,0,0) 算（**用户第一轮"你在原地徘徊/跟随中做了无用的走动"的真正根因**），改取实时位置后跟随时序单调收敛；**J** 新会话无位置 → 出生点回落 (0,0,0) → 任何 AI 客户端重连即瞬移回原点，新增 `getLatestPosition` 重连续位。**用户现场决策**：Agent 速度上限由固定 5 m/s 改为可配 `agent_max_speed`、默认 9 m/s 与真人一致（真人实测中位 6.03、峰值 11+ m/s）。回归全绿：fix_a 24/24、fix_b 24/24、fix_c 15/15、fix_d 10/10、fix_e 12/12、fix_f 14/14、P1 14/14、P2 14/14、P3 12/12、P8 52/52、WS 重连 9/9、主世界冒烟 9/9。服务器 3002 已重启跑新代码；联测用 Key Agent `workbuddy`（realtime 档）；临时工具 `_tmp_follow.js` 升级为 v4（服务端 follow + keeper） | **首轮缺陷全部修复并验收 ✅**（下一轮：多 Agent × 多真人压测） |
| 2026-09-19 | **v2 轮联测（登录与多端，用户指令"只测不改代码"）**：按 `AI-Agent联测提示词-v2-登录与多端.md` 执行 §1 登录/鉴权边界 + §2 多端同时在线，产出 3 个可重跑矩阵脚本与公共工具 `scripts/agentV2TestKit.js`。**结果**：游客档矩阵 **72/75**（3 FAIL = 已知缺陷 v2-1×2 + v2-3×1）、Key 档 **38/38**、多端 **25/25**。**新发现 6 条缺陷/观察项（均未修）**：**v2-1（P1）**WS 升级后瞬时断开 → `agentWsServer` 的 `ws.on('close')` 注册在两次 `await` 之后收不到 close 事件 → `handleClose` 永不执行 → ①该 IP 游客名额永久占用（同 IP 换新票仍 `GUEST_IP_CONCURRENCY`）②`playerPositions` 幽灵 avatar（真人可见、observe 返回）③`activeAgents` 常驻占 `max_agents` 名额，心跳/空闲超时对其无效（socket 已关）→ 只能重启清理；实测 **3/3 复现**，对照"正常关闭（已收 READY）后名额立即释放"PASS（C17b），另观测到一次"连接 800ms 后关闭"也泄漏；**v2-2** `SESSION_NOT_FOUND` 在 WS=401 / HTTP=403 口径不一致；**v2-3（P2）**`move` 被打断不发 `ACTION_COMPLETED{superseded}`（`startMove` 未注入 requestId/reply，只有 `walkTo` 注入），与 §5.2 契约不符；**v2-4** 无 `stop` 动作、`movementService.stopMove()` 零调用（连续 move 无法显式停止）；**v2-5** 多 Agent 同时 follow 同一目标位置完全重合（实测最小间距 0.00m，无 Agent 间避让）；**v2-6** `guest.js` 自带 `clientIp()` 兜底取 XFF 第一段（与 `middleware/clientIp.js` 口径相反，实际不可达）。**多端实测数据**：realtime 档 **105 条 ENTITY_UPDATED/20s ≈ 1Hz/实体（非 10Hz）**、≈1KB/s per Agent（量化证实"第三档≈1Hz"遗留项）；游客同窗口 **0 消息 0 字节**（红线 14 反证）；服务器 **0.19 核秒/20s ≈ 1% 单核**；`CHAT.characterId ≡ entities[].id` 逐字一致、Agent 互聊 + 真人侧同收；3 Agent 同时 follow 全部收敛 2.2~2.5m；真人端（playwright headless chrome 真 GPU）**0 console error（唯一 404=favicon，按 `m.location().url` 判定）、players.size=11、FPS 60**；`world_chat_log` 177→180。联测期间另有驻场游客 Agent 与真人「米多」实时对话/跟随（jump/follow/say 全通）。文档同步：§0 阶段说明、§7 v2 小节（含 6 条缺陷表与实测数据）、§9 新增坑 22/23/24。**agent_enabled 收尾恢复 false（红线 6）** | **v2 轮联测完成 ✅（待用户决策：先修 v2-1 还是继续下一轮）** |
| 2026-09-19 | **v3 轮：v2-1（P1）+ v2-3（P2）修复与专项验收（用户授权"按 v3 提示词开工"）**。开工核对：文件存在性全绿（`examples/agent-client/ai-view.mjs` 仍缺失，属已知丢失项，非本会话依赖）+ 环境自检 + **修复前基线复现**（游客矩阵 72/75，X 组 v2-1 两 FAIL 实测 3/3：名额泄漏 3 + 幽灵实体 3）。**① v2-1**：`agentWsServer.js` 连接处理函数把 `ws.on('message'/'close'/'error'/'pong')` **全部前置到第一个 `await` 之前**（`earlyClosed` 记录早到的 close），并在两处 `await` 之后加 `readyState !== WebSocket.OPEN` 兜底——state 未建时 `releaseIpSlot` + 审计 `ws_disconnected{phase:'closed_before_ready'}` 后退出（避免为死连接广播 PLAYER_JOINED），state 就绪后再兜底一次走幂等的 `handleClose`；**② v2-3**：`handleMove`/`handleJump` 注入 `{requestId, reply}`，`startMove/jump` 写入任务对象（`jump` 复用既有任务时不覆盖旧 requestId），`startMove` 打断旧任务显式传 `reason='superseded'`。**验收**：游客矩阵 **72/75 → 75/75**（X1/X2、E6 三条由 FAIL 转 PASS 并改名去掉 `[已知缺陷]` 标签）、Key 38/38、多端 25/25、**新增专项 `accept_agent_v2_defects_fix.js` 7/7**（V1 6/6 同 IP 换新票立刻重连、V2 幽灵 0、V3 审计 6 次断开产生 11~12 条 `closed_before_ready`（修复前 0 条）、V4 move 回执、V5 jump 回执、V6 walk_to 到达）；既有回归全绿：fix_a 24/24、fix_b 24/24、fix_c 15/15、fix_d 10/10、fix_e 12/12、fix_f 14/14、P1 14/14、P2 14/14、P3 12/12、P8 52/52、WS 重连 9/9 ACCEPTED、主世界冒烟 9/9。**本轮沉淀两个"测试自身缺陷"**（§9-25/26）：游客动作限频**按 action 分桶** 1 次/2s → 同类动作需 sleep 2.1s 否则测到的是限频（V5 首轮假失败）；管理员登录 IP 小时窗口把**成功登录也计数**（15 次/小时）→ 多脚本连跑必 `RATE_LIMITED_IP_HOUR`，需重启服务器清内存计数器（fix_d/e/f 首轮三 FATAL，重启后全绿）。**v2-2/4/5/6 四条观察项本轮未动**，待用户决策（红线 11）。服务器已重启跑新代码（pid 17876） | **v2-1/v2-3 修复并验收 ✅**（待用户决策：v2-2/4/5/6 观察项 or 深化联测） |
