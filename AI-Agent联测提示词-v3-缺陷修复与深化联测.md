# 下一轮提示词 · v3（v2 轮缺陷修复 + 深化联测）

> **用法**：**新建一个对话框**，把下面 `====` 之间的全部内容粘进去作为第一条消息。
> 生成时间：2026-09-19（v2 轮联测完成：3 个矩阵脚本全产出、6 条缺陷记录在案、git 已提交 `4a70c377`、**尚未推送远端**）
> 与 v2 的差别：①上游从"联测"变成"**缺陷修复**（v2-1 P1 必修）+ 可选深化联测"；②新增「现状交接」章节（3 个矩阵脚本的当前分数、3 条当前 FAIL 的确切用例名）；③坑清单新增 3 条（§9-22/23/24，直接决定本会话怎么改）。

====

你是本项目的 AI 开发助手，工作区 `l:\shegnjir185`。本会话任务二选一（或先后做，**先复述方案再动手**）：

- **任务 A（默认推荐，需用户在当轮明确授权"改代码"）**：修复 v2 轮联测发现的缺陷。**`v2-1`（P1）必修**，`v2-3`（P2）建议同批；`v2-2 / v2-4 / v2-5 / v2-6` 由用户决策（见 §2.3）。
- **任务 B（可选）**：继续深化联测（Agent 间语音、>30 分钟长会话、observe 采样率、realtime 帧率、100 Agent 压测等，见 §3）。

**未获授权前不要改产品代码**（只读排查、跑脚本、复述方案是允许的）。

## 0. 开工前必做（按顺序，做完先复述状态再动手）

1. 读唯一权威文档 `l:\shegnjir185\AI-Agent接入系统-开发规范与进度.md`，重点：
   - §0 接力协议 + 收尾三件事；§3 红线清单（15 条。注意 **红线 6**：`agent_enabled` 默认 false，联测期开、收尾关；**红线 11**：重构 vs 打补丁必须问用户；**红线 14/15**：游客禁推流、游客 observe 半径硬钳 30m）
   - **§7 的「v2 登录与多端联测」小节** —— 本会话的直接上游：6 条缺陷表 + 多端实测数据 + 未覆盖清单
   - §5.2 七动作与**移动类回执契约**、§5.4 实体标识契约（`entities[].id` 唯一、`name` 仅供显示）、§8 代码坐标速查
   - **§9 已知坑 22/23/24（v2 轮新增，直接决定本会话怎么改）**
2. **先核对文件存在性再引用任何结论**（本项目多次发生"未提交改动丢失"）：确认 `src/agent/*`、`src/routes/agent/*`、`src/websocket/agentWsServer.js`、`src/websocket/upgradeRouter.js`、`src/middleware/clientIp.js`、`examples/agent-client/ai-live.mjs`、以及 4 个 v2 轮新脚本（见 §1.1）都在且非 0 字节。当前 git HEAD 应为 **`4a70c377`**。
3. 环境自检（服务器应已在跑，端口 3002）：
   - `node -e "fetch('http://localhost:3002/api/health').then(r=>r.text()).then(console.log)"`
   - `node -e "fetch('http://localhost:3002/.well-known/virtual-world-agent.json').then(r=>r.json()).then(j=>console.log(j.agentEnabled,j.tiers.default))"`
   - ⚠️ **v2 轮收尾已按红线 6 把 `agent_enabled` 置 false** → 要跑任何矩阵/联测前先开回 true：
     `POST /api/admin-auth/login {username:'baseline_shot',password:'Baseline#185'}` 拿 token → `PUT /api/agent/v1/admin/config {"agent_enabled":true}`
   - ⚠️ `accept_agent_p3.js` / `accept_agent_p8.js` 收尾同样会把 `agent_enabled` 置 false，跑完回归记得再开回来。
4. 复述：v2 轮结果（游客档 72/75、Key 档 38/38、多端 25/25）、6 条缺陷各自状态、本会话要修哪几条、每条修完的验收判据。

## 1. 现状交接（v2 轮成果，全部可重跑）

### 1.1 资产清单（**修完代码的验收基线**）

| 脚本 | v2 轮分数 | 作用 |
|---|---|---|
| `scripts/agentV2TestKit.js` | — | 公共工具：HTTP / 游客签票 / WS 连接（含 upgrade 被拒状态码捕获）/ 真人 WS 观察者 |
| `scripts/accept_agent_v2_auth_guest.js` | **72/75** | 游客档矩阵 A 发现端点 / B 签票 / C WS 鉴权边界（401/403/4004/1013）/ D observe 半径与限频 / E 动作与红线 / F 签票限流 / G 聊天历史 / H 总开关 / **X 缺陷复现** |
| `scripts/accept_agent_v2_auth_key.js` | **38/38** | Key 档 K1 建 Agent / K2 换票与错误 Key / K3 Key 特权 / K4 同角色多连接 4004 顶替 / K5 无动作限频 / K6 revoke / K7 C2 空闲续命压缩回归（独立实例 3003 + 阈值 3s，约 2 分钟）/ K8 删除清理。`SKIP_K7=1` 可跳过慢用例 |
| `scripts/accept_agent_v2_multiend.js` | **25/25** | 多端 3 Agent × 5 模拟真人 + playwright 真浏览器（含带宽/CPU 实测、契约校验、多 Agent follow） |

- 报告产物：`examples/agent-client/live/v2-auth-guest.json` / `v2-auth-key.json` / `v2-multiend.json`
- **当前 3 条 FAIL 的确切用例名**（它们断言的就是"正确行为"，**修好代码后会自动转 PASS**，届时可把名字里的 `[已知缺陷 v2-x]` 标签去掉改成正式用例）：
  1. `[已知缺陷 v2-1] 瞬时断开不应永久占用"每 IP 1 连接"名额`
  2. `[已知缺陷 v2-1] 瞬时断开不应在世界留下幽灵 AI 实体（真人会看到不动的 avatar）`
  3. `[已知缺陷 v2-3] move 被打断应补发 ACTION_COMPLETED{superseded}（契约 §5.2）`

### 1.2 六条缺陷（**v2 轮已记录，不要当新缺陷重复上报**）

| # | 级别 | 一句话 | 建议修法（文档 §7 有完整版） |
|---|---|---|---|
| **v2-1** | **P1** | WS 升级后"瞬时断开"（`open` 后立刻 close / 800ms 内 close）→ 服务端 `handleClose` 永不执行 → ①该 IP 游客名额**永久**占用（同 IP 换新票仍 `GUEST_IP_CONCURRENCY`）②`playerPositions` 留下不动幽灵 avatar（真人可见、observe 返回）③`activeAgents` 常驻占 `max_agents` 名额，心跳/空闲超时对它无效 → **只能重启清理**。实测 **3/3 复现** | 见 §2.1 |
| v2-2 | P2 | 同一"会话不存在"（`SESSION_NOT_FOUND`）**WS=401 / HTTP=403** 口径不一致 | 统一，或明确文档化差异 |
| v2-3 | P2 | `move` 被打断**不补发** `ACTION_COMPLETED{superseded}`，与 §5.2"移动类（move/walk_to/jump/follow）互斥并回执"契约不符 | 见 §2.2 |
| v2-4 | P3 | **无 `stop` 动作**，`movementService.stopMove()` 导出但**零调用** → 连续 `move` 只能靠 `walk_to` 到自身坐标/断线停下 | 新增 `stop` 动作（建议与 walk_to/follow 一样**共享 move scope**，别动 `AGENT_SCOPES` 契约） |
| v2-5 | P3 | 多 Agent 同时 follow 同一目标时位置**完全重合**（实测最小间距 0.00m），无 Agent 间避让 | 产品决策：是否在推进里按序号给目标点加偏移 |
| v2-6 | P3 | `src/routes/agent/guest.js` 自带 `clientIp()` 兜底取 `X-Forwarded-For` **第一段**（与 `middleware/clientIp.js` 的"最后一段"口径相反） | 改用 `middleware/clientIp.resolveClientIp(req)`（注意 `TRUST_PROXY=false` 语义） |

## 2. 任务 A：修缺陷（用户授权后开工）

### 2.1 v2-1（P1，必修）

**目标行为**：WS 升级成功后，客户端**任何时机**断开都必须完成清理（每 IP 名额 / `playerPositions` 实体 / `activeAgents` 条目），**不得残留**。

**根因**：`src/websocket/agentWsServer.js` 的 `wss.on('connection', async (ws, request, authResult) => {...})` 把 `ws.on('close')` / `ws.on('message')` **注册在函数末尾**，中间隔着两次异步等待——`await agentConfigService.getConfig()` 与 `await agentSessionManager.getLatestPosition(...)`。若 close 帧先到，Node 已经 emit 过 `'close'`，监听器永远挂不上 → `handleClose` 不执行。

**修法（建议两条都做，互为保险）**：
1. **注册前置**：把 `ws.on('close')` / `ws.on('error')` / `ws.on('message')` 提到 `connectionId` 生成之后、**第一个 `await` 之前**。注意 `handleClose(connectionId)` 依赖 `activeAgents` 里的 state → 可在函数顶部注册一个"早到 close"标记（如 `let earlyClosed = false; ws.on('close', () => { earlyClosed = true; handleClose(connectionId); })`），并在 state 建好后检查该标记。
2. **同步兜底**：在 `activeAgents.set(...)` + `presenceBridge.onConnect(...)` + `connectionRegistry.register(...)` **之后**加：
   `if (ws.readyState !== WebSocket.OPEN) { handleClose(connectionId); return; }`
   （此时 state/实体/注册表都已就绪，`handleClose` 能一次性完整清理。）

**硬约束**：
- 不得破坏"被 **新连接顶掉**的旧连接**静默清理**、不广播 `PLAYER_LEFT`"（缺陷 B 的既有修复，`state.replacedBy` 分支）。
- `handleClose` 必须**幂等**（二次调用安全：`activeAgents.get` 为空即 return；`playerPositions.delete` 与 `tierService.releaseIpSlot` 各自幂等）——因为"注册前置 + 兜底"可能两次触发。
- `src/websocket/wsServer.js` 是**黑名单贴线文件**（零追加）；`agentWsServer.js` 现 **537 行**（≤1000 可接受，但别再明显膨胀）。

**验收判据（缺一不可）**：
1. `node scripts/accept_agent_v2_auth_guest.js`：**X 组两条从 FAIL → PASS**（3 次瞬时断开后 = **0 次名额泄漏 + 0 个幽灵实体**）；矩阵总分应达 **75/75**。
2. 追加手动复现：连上立刻 `close()` → 审计日志立即出现 `ws_disconnected`（`logs/audit-<date>.log`）→ 同 IP 用**新票**能立刻重连成功 → 用另一个 IP 的游客 `observe` **看不到**该 agentId。
3. 反复 5~10 次瞬时断开后：`agentWsServer.getActiveCount()` 不累积（该函数当前**只导出、未挂 HTTP**，可写临时脚本 `require` 服务器进程外读不到——改用审计日志计数或 X 组断言）。
4. 回归不破：`accept_agent_v2_auth_key.js` 38/38（K4 的 4004 顶替 + 静默清理必须仍然正确）。

### 2.2 v2-3（P2，建议同批修）

**目标**：`move` / `jump` 与 `walk_to` / `follow` 一样，任务对象里带 `{requestId, reply}`，被新移动指令打断时补发 `ACTION_COMPLETED{reason:'superseded'}`，断线时 `reason:'disconnected'`。

**改点**：
- `src/agent/agentActionService.js`：`handleMove` → `movement.startMove(connectionId, agent, session, direction, { requestId: payload.requestId, reply: ctx.reply })`；`handleJump` 同理。
- `src/agent/agentMovementService.js`：`startMove` 接收第 5 参 opts 并写入任务对象（`requestId` / `reply`）；`jump` 复用既有 task 时注意**不要把已有 requestId 覆盖掉**。

**验收**：E6 由 FAIL → PASS；E1~E10（含 `superseded`、`arrived`、`scope_denied`、`rate_limited`、`missing_action`）不得回归；建议补一条"`jump` 被打断也补发"。

### 2.3 观察项（**改前先问用户**）

- **v2-2**：`SESSION_NOT_FOUND` 统一成 401 还是 403？（`handleUpgrade` 只把 `TOKEN_EXPIRED` 映射 403，其余 401；HTTP 侧 `authenticateAgentToken` 对 `verifySession` 失败一律 403）
- **v2-4**：是否新增 `stop` 动作（连续 `move` 目前无法显式停止）
- **v2-5**：多 Agent 跟随同一目标是否要"到场错位偏移"（避免完全重叠遮挡）
- **v2-6**：`guest.js` 的 `clientIp()` 是否与 `middleware/clientIp.js` 合并

## 3. 任务 B：深化联测（若用户选择继续测）

| 项 | 要点 / 现有依据 |
|---|---|
| **Agent 间语音** | `agent_voice_relay=true` 已开；Agent `SUBSCRIBE{topics:['voice']}` 后，真人 PTT 的 `VOICE_MESSAGE`（base64 opus）是否按 30m 中继给 Agent；红线 4：**服务器零加工**（无 ASR/TTS）；注意一条语音 50~240KB，是文字的 1000 倍 |
| **>30 分钟长会话** | 游客票 30min 到期后 HTTP `observe`/`chat/history` 变 401（**WS 仍连着**，约 5 分钟后被空闲回收）→ 客户端重签策略；Key 档 15min JWT 续期路径 |
| **observe 采样率** | `agent_observe_rate_key` 调 5~10 后多 Agent 并发公平性与 429 分布；**热路径缓存必须就地更新**（§9-15），改完 60s 内生效 |
| **realtime 帧率** | v2 轮已量化：realtime 档 **105 条 ENTITY_UPDATED/20s ≈ 1Hz/实体（非 10Hz）**、≈1KB/s per Agent。是否要真 10Hz？需动推送循环的 1s tick（`STANDARD_BATCH_INTERVAL_MS`），**属于行为变更，先问用户** |
| **100 Agent @ eco 压测** | §10 附加判据；`max_agents` 默认 50 需先调高；游客"每 IP 并发 1 连接"要用 `X-Forwarded-For` 造多 IP |
| **多真人真浏览器** | ≥2 个 playwright/真浏览器同场 + FPS / 0 console error 基线（v2 轮单页基线：players.size=11、FPS 60） |
| **多 Agent 抢同一目标** | "谁先到"、互相遮挡（v2-5 的延伸） |

## 4. 验收与证据要求

- **改代码必须**：3 个矩阵重跑 + 原回归全绿 —— `scripts/accept_agent_p1.js`、`accept_agent_p2.js`、`accept_agent_p3.js`、`accept_agent_p8.js`、`accept_ws_reconnect_presence.js`、`smoke_r185_world.js`；并给出实测数据与报告 JSON 路径。
- **纯联测**：证据 = `examples/agent-client/live/events.jsonl`、各类报告 JSON、`logs/audit-<date>.log`（`ws_connected` / `ws_disconnected` / `ws_rejected` / `ws_replaced` / `ws_idle_timeout` / `guest_ticket_issued`）、以及真人对话原文。
- **测试自身缺陷教训**（v2 轮踩到）：① 断言必须**先挂监听再触发事件**；② 矩阵脚本要把"**签票 IP**"与"**WS 连接 IP**"解耦（票不绑 IP，只有"每 IP 并发 1 连接"看连接来源），并让每次运行的 IP 随运行号偏移，否则重跑必 429；③ 判定幽灵实体必须用"之后不再连接的票"；④ `observe` 的 `distance` 是"相对请求方"的距离，多 Agent 对比要自己按坐标算。

## 5. 环境操作速查（本机）

```powershell
# 服务器（后端改动后重启，约 10~20 秒）
netstat -ano | findstr :3002          # 找 pid
taskkill /PID <pid> /F ; Start-Sleep -Seconds 2
Start-Process -FilePath node -ArgumentList 'src/server.js' -WorkingDirectory 'l:\shegnjir185' -WindowStyle Hidden -RedirectStandardOutput 'l:\shegnjir185\logs\server_out.log' -RedirectStandardError 'l:\shegnjir185\logs\server_err.log'

# 开总开关（联测期）
# POST /api/admin-auth/login {baseline_shot / Baseline#185} → PUT /api/agent/v1/admin/config {"agent_enabled":true}

# 驻场 AI（guest 模式；下命令 = 写 examples/agent-client/live/inbox/*.json；读证据 = events.jsonl / state.json）
node examples/agent-client/ai-live.mjs
```

- ⚠️ **同 IP 只能 1 条游客连接**：换票/重启驻场必须**先杀掉旧 `ai-live` 进程**（`wmic process where "name='node.exe'" get processid,commandline` 找到含 `ai-live.mjs` 的 pid → `taskkill /PID <pid> /F`），否则新连接被 `GUEST_IP_CONCURRENCY` 拒。
- ⚠️ **重启驻场前先清空 `live/inbox/*.json`**（旧命令会被立刻执行）；`live/events.jsonl` 是证据文件不要删（可改名归档）。
- 环境快照（2026-09-19 02:2x 实测）：git `4a70c377`；服务器 pid 14420；`agentEnabled=false`（**待开回 true**）、`pushDefault=eco`、`voiceRelay=true`、`maxAgents=50`、`maxConnectionsPerAgent=1`、`maxSpeed=12`、`observeRateKey=1`、chatLog 三项默认（`remoteEnabled=false`，S3 是本轮遗留的假配置指向 `127.0.0.1:9999`，无影响）、`TRUST_PROXY` 未设（默认信任 1 层代理）、`AGENT_IDLE_TIMEOUT_MINUTES=5`。
- **当前无驻场 AI**：v2 轮收尾启动的 `ai-live`（`游客AI-bee0e692`）已自然退出——游客票 30 分钟到期后 HTTP `observe` 变 401，失去活跃信号 → 5 分钟后被空闲超时回收（`close 1001`）→ 客户端 `close` 分支 `process.exit(0)`。**世界内现应只有真人「米多」一个人**；`examples/agent-client/live/state.json` 里的 `connected:false` 与 entities 是退出前的最后一份快照，**不要当实时数据**。要再驻场：先 `agent_enabled=true` 再 `node examples/agent-client/ai-live.mjs`。

## 6. 坑清单（承接 v2 的 8 条 + 本轮新增 4 条）

1. **定位实体一律按 `id`**（同名是常态；世界里曾有两条"米多"、还有一个 id 不带 `agent:` 前缀的旧条目）。
2. **找活人用 `follow`，不要用 `walk_to`**：游客 2 秒采样 + 30m 视野，`walk_to` 打的是上一帧旧坐标。
3. **签票 10 张/小时极易打满**；`localhost(::1)` 与 `127.0.0.1` 是两个窗口；重启服务器清空。
4. **重启驻场进程前先清空 `live/inbox/`**；`events.jsonl` 不要删。
5. **PowerShell 坑**：内联 `node -e` 里的 `|` `"` `$1` 会被破坏（写脚本文件执行）；`Get-Content` 会被安全规则拦（用 node 读）；`git commit -m "中文"` 会乱码 → `write_to_file` 写 UTF-8 消息文件 + `git commit -F 文件`。
6. **长跑脚本别用 `process.exit()`**（Windows 重定向 stdout 是块缓冲，会丢输出）→ 用 `process.exitCode` 或落盘 JSON 报告。
7. 后端改动需**重启服务器**；前端改动需 **Ctrl+F5** 或 index.html 版本号递增。
8. **本仓库有 3 个远端**（`gitee` / `github` / `origin`，origin 指向 `miduo100`）→ **推送前先问用户推哪个**。
9. **WS 事件监听器必须"先注册后 await"**（§9-22，v2-1 根因）：任何 `await` 之后的 `ws.on('close')` 都可能永远收不到事件 → 连接清理泄漏且只能靠重启恢复。
10. **移动类回执只实现了一半**（§9-23）：只有 `walk_to`/`follow` 注入了 `requestId`/`reply`；`move`/`jump` 没有，且**没有 `stop` 动作**。
11. **写矩阵脚本三坑**（§9-24）：签票窗口/IP 解耦、幽灵判定用"不再连接的票"、`observe.distance` 相对请求方。
12. **console error 里的 favicon 噪音**：文案里**不含 URL**，判定必须用 `m.location().url`（v2 轮实测）。

## 7. 收尾三件事（§0 协议，每会话必做）

1. 更新 `AI-Agent接入系统-开发规范与进度.md`：结论回填 §7（缺陷表状态改 ✅ + 修复证据）、§9 补新坑、§0 阶段说明、进度日志追加一行。
2. 写记忆（里程碑 + 关键坑）。
3. git 提交（UTF-8 消息文件 + `-F`）；**收尾把 `agent_enabled` 恢复 `false`（红线 6）**；推送远端前先问用户。

## 8. 沟通规则

- 用户会在 3D 世界里用中文与你实时对话并引导操作（**你就是那个"游客 AI"**），要实时响应，并把关键结论用 `say` 回给用户（≤200 字，注意游客 `say` 限 1 条/5s）。
- "重构 vs 打补丁"的取舍**必须问用户**（红线 11）并说清影响面；不确定的以实测为准；发现问题比预期大先回报再决定是否缩范围。
- 遗留：`ubuntu-deploy-package` **未同步**（清单见文档）；工作区仍有未跟踪的上一轮临时脚本 `scripts/_tmp_*.js`（多轮联测结束后清理）。

====
