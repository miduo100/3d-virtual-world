# AI Agent 接入虚拟世界 — 开发规范与进度

> 创建：2026-09-17 ｜ 状态：规划定稿（含聊天记录归档增补），P0 审计完成，P1 待开工
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
src/services/
  chatArchiveService.js     # （P4）每日导出昨日聊天→gzip→S3 兼容归档→保留期到期清理
src/routes/agent/
  index.js  session.js  observe.js  action.js  meta.js   # meta=capabilities/openapi/well-known
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
| `src/websocket/wsServer.js`（499 行，贴线） | `new WebSocket.Server({server})` → `{ noServer:true }` + 导出 `handleUpgrade`；CHAT 分支加一次异步写库调用（1 行）；其余逻辑不动 | P3/P4 |
| `src/server.js` | `app.use('/api/agent/v1', requireAgentRoutes)`（1 处）+ upgradeRouter 挂载（1 处） | P1/P3 |
| `public/js/websocket.js` | PLAYER_JOINED 系统消息支持 "(AI)加入了"；名字 Sprite 加 🤖（约 5-10 行） | P3 |
| `public/index.html` | websocket.js 版本号 ?v=N+1 | P3 |
| `admin.html` + 新 `public/js/adminAgentSettings.js` | "Agent 接入"配置卡（含 5.3 档位 + 5.5 聊天归档两组配置） | P3/P4 |
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

### P1 Agent 身份与会话 ⬜
- [ ] `add_agents.sql` + `add_agent_sessions.sql` 迁移并执行（幂等验证：跑两遍不报错）
- [ ] `agentAuth.js`：API Key 生成（`agk_live_` + 32B 随机）、scrypt/bcrypt hash、Agent JWT 签发（15min/jti）
- [ ] `agentManager.js` / `agentSessionManager.js` / `agentPermissionService.js` / `agentConfigService.js`
- [ ] `routes/agent/index.js + session.js`：POST /session、GET /me、POST /session/revoke
- [ ] 限流：POST /session 每 IP 10次/分钟（参考 loginRateLimiter 模式）
- [ ] .env 增加 AGENT_JWT_SECRET；server.js 挂载路由（1 行）
- [ ] 审计日志：session 签发/吊销 console 结构化日志
- [ ] **验收**：①建测试 Agent→换 token→GET /me 成功；②错误 Key 401；③过期 token 403；④现有 /api/auth/login 冒烟不变；⑤迁移幂等

### P2 观察 API ⬜
- [ ] `agentObservationService.js`（复用 worldSpatial 查询 + getPlayerPositions）
- [ ] GET /observe：radius(≤200)/include/limit 参数校验；self/entities/objects/portals
- [ ] entities 含在线人类（playerPositions）与本 Agent；objects/portals 走 /around 同口径
- [ ] 1Hz 限频（eco）；无管理员私有字段
- [ ] **验收**：①observe 返回附近已知对象（用真实坐标核对）；②radius 截断；③/around 返回结构不变（回归）；④1Hz 超频 429

### P3 Agent WebSocket + 推送分档 ⬜（最关键阶段）
- [ ] `upgradeRouter.js`：`/ws/agent`→agent，**其余全部→human（兜底）**
- [ ] `wsServer.js` 最小改动（noServer + handleUpgrade 导出）
- [ ] `agentPresenceBridge.js`：AUTH→恢复 session→avatar 绑定→写 playerPositions(entityType:'agent', isGuest:true)→广播 PLAYER_JOINED；断开→保存位置→PLAYER_LEFT
- [ ] `agentWsServer.js`：READY/WORLD_SNAPSHOT/SUBSCRIBE/令牌桶/背压(bufferedAmount 1MB警/4MB断)/30s 心跳
- [ ] 三档推送 + `max_agents` + `agentConfigService` 60s 缓存
- [ ] `ENTITY_MOVEMENT_BATCH` 1s 聚合器（standard 档）
- [ ] admin.html "Agent 接入"卡片（adminAgentSettings.js，参考 adminModelLod 先例）
- [ ] 前端 5-10 行："(AI)加入了" + 🤖；index.html 版本号
- [ ] README Nginx 文档修正（location / 补 Upgrade 头）
- [ ] **验收**：①**浏览器连根路径 WS 回归不受影响（必测，登录真人进世界看到在线玩家）**；②无 token 拒/过期拒；③Agent 无法声明他人 characterId（服务器指定）；④真人浏览器看到 AI Avatar（GLB 加载）；⑤档位切换 60s 内生效；⑥max_agents 超限拒绝；⑦慢消费者 4MB 断开

### P4 行动系统 + 聊天记录 ⬜（2-3 会话）
- [ ] `agentMovementService.js`：5m/s 限速、边界 ±1000、平面地面 y、10Hz 推进、animMode 派生（idle/walk）
- [ ] `agentActionService.js` 六动作 + scope/距离/参数校验 + requestId 回执（ACCEPTED/COMPLETED/REJECTED）
- [ ] 移动复用现有 POSITION_UPDATE 广播（仅发给订阅 movement 的连接）
- [ ] say 走 CHAT 管线（30m）；语音零加工中继（agent_voice_relay 开关）
- [ ] `add_world_chat_log.sql` + CHAT 异步写入 + GET /chat/history（AI 重连恢复上下文）
- [ ] `chatArchiveService.js`：每日导出→gzip→S3 兼容归档→保留期清理（后台可配；**未上传成功不删本地**，失败重试上限 7 次）
- [ ] admin 卡片：记录开关 / 保留天数 / 归档目的地（none|s3|baidu预留）/ S3 连接参数（密钥加密）/ 上传时刻
- [ ] **验收**：①walk_to 全程动画可见、无瞬移；②超速/越界被拒；③scope 无 teleport→请求被 REJECTED；④say 气泡在真人端出现；⑤say 200 字截断；⑥多 Agent 并发 5 个不互扰；⑦真人端无 console error；⑧聊天落库可查、超保留期自动清除；⑨关闭 chat_log_enabled 后停止写入；⑩手动触发归档→远端出现当日 .jsonl.gz→重跑不重复

### P5 Agent 跨世界联邦传送 ⬜
- [ ] `add_federation_nonce.sql`（token_usage 表，nonce 一次性）
- [ ] `agentTeleportService.js` + `routes/agentFederation.js`（principalType:'agent'，transient session，**不创建本地 user**）
- [ ] 复用 RS256/iss/aud/trustedWorlds（只读 federationSystem）；handoff token 含 agentId/avatarConfig/homeWorld/nonce
- [ ] **验收**：①World A→B 身份/Avatar 不变；②nonce 重放被拒；③无 email 建号；④A/B 两端真人分别看到离开/到达

### P6 自动发现 + SDK ⬜
- [ ] `/.well-known/virtual-world-agent.json` + `/capabilities` + `/openapi.json`（meta.js）
- [ ] `examples/agent-client/node-agent.mjs`：session→connect→observe→say→walk_to 全链路
- [ ] README 增加 "How AI Agents Enter This World"
- [ ] **验收**：新起 Node 进程仅凭域名跑通全链路；浏览器全程可见 AI 行为

### P7 可选项（本轮不做，仅占位）
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
