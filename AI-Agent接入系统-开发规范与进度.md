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

ACTION 六动作（P4）：`move(target)` 连续位移、`walk_to(target)` 走到点（服务端 5m/s 限速逐帧推进+animMode:walk）、`rotate(yaw)`、`jump()`、`say(text)`（≤200 字，走 CHAT 管线）、`interact(targetId)`（距离校验）。全部要求：scope 校验→参数 schema→距离/边界校验→限频→服务端权威→requestId 回执。

### 5.3 推送三档（system_config，后台单选热切换）

| 配置键 | 类型/默认 | 说明 |
|---|---|---|
| `agent_enabled` | bool / false | 总开关（**默认关，上线时手动开**） |
| `agent_push_default` | eco \| standard \| realtime / eco | 新 Agent 默认档 |
| `agent_movement_push` | off \| batched \| realtime / batched | 位置流策略（batched=1s 聚合） |
| `agent_voice_relay` | bool / **false** | 语音是否中继给 Agent |
| `max_agents` | int / 50 | 全局并发上限 |

- eco：observe 限 1Hz + CHAT 实时推；无实体/位置推送。
- standard：+ ENTITY_ADDED/REMOVED + 1s 聚合位置流。
- realtime：位置流 10Hz 原始频率（复用现有 POSITION_UPDATE 广播，仅发给订阅了的 Agent）。
- 后台卡片：admin.html 新卡片"Agent 接入"，参考 adminModelLod 卡片先例（system_config 读写 + 60s 缓存热生效 + 客户端校验）。

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
复用：`worldSpatial /around`（objects+portals）+ `playerPositions`（entities）。radius 硬上限 200m；不含管理员私有字段；每 Agent 1Hz 限频（eco 档）。

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
  - **禁止推流**：SUBSCRIBE 直接拒绝（`GUEST_PUSH_FORBIDDEN`）；连接级强制 eco + 位置流 off + 语音中继 off（即使后台默认档 realtime）
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
