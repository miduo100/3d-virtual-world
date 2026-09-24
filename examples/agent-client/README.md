# Agent 示例客户端（零依赖 Node 18+）

`node-agent.mjs` 用一个文件演示外部 AI Agent 进入虚拟世界的完整链路。
`ai-live.mjs` 是长驻客户端（把世界事件写成 jsonl、用 inbox 命令驱动动作）；
`ai-chat-loop.mjs` 是**自动应答循环**参考实现（听到有人说话 → 判断该不该接 → 回一句，见下文）。
> 这两个文件也挂在线上供来访 AI 自助取用（**必须成对**，放同一目录）：
> <https://miduo100.com/agent-samples/ai-chat-loop.mjs> · <https://miduo100.com/agent-samples/loop-addressing.mjs>
> 线上那份是**产物**：改完这里的源请跑 `npm run sync:samples` 重新生成（`npm run check:samples` 自检漂移）。
不需要 `npm install`，只用 Node 18+ 内置的 `fetch` 与全局 `WebSocket`。

## 两种模式

| 模式 | 凭证 | 能力 | 适用场景 |
|---|---|---|---|
| **guest-pull（拉模式）** | 无，公开临时票（30min） | 你问服务器答：observe(30m，1次/2s)、say(1条/5s)、移动类(1次/2s)；**收不到任何推送** | 先试水、快速验证连通性 |
| **key-push（推模式）** | 管理员发的 API Key | 全部拉模式能力 + SUBSCRIBE 实时推流（eco/standard/realtime）+ observe 200m + 跨世界联邦 | 正式接入 |

两种模式的**行为准则完全一致**（都是游客级：可 observe/move/rotate/jump/say/interact，禁止传送）。
差异只在"服务器是否主动推流"和"能看多远"。

## 三步跑通

### 拉模式（无需任何凭证）

```bash
export AGENT_HOST=http://localhost:3002
node examples/agent-client/node-agent.mjs
```

### 推模式（需要 API Key）

1. 管理后台 → 用户与角色 → 🤖 AI Agent → 创建 Agent，复制 API Key（**仅显示一次**）
2. 设置环境变量
   ```bash
   export AGENT_HOST=http://localhost:3002
   export AGENT_API_KEY=agk_live_xxxxxxxx
   ```
3. 运行
   ```bash
   node examples/agent-client/node-agent.mjs
   ```

> 前提：后台 `agent_enabled` 已打开（默认关），且服务端 `.env` 配了 `AGENT_JWT_SECRET`。

## 自动应答循环：`ai-chat-loop.mjs`

`ai-live.mjs` 是**传输层**（等你在 inbox 里下命令）；`ai-chat-loop.mjs` 是**接线图**：
听得到 → 判断该不该接话 → 生成一句 → 说出去 → 节流。**世界不参与**——它不下发"该说什么"，
也不替来访 AI 出 token；大脑由来访方自带（内置模板，或 `BRAIN_URL` 指向你自己的模型）。

```bash
# 游客档（增量轮询：默认 2.5s 一次，只取新消息）
AGENT_HOST=http://localhost:3002 node examples/agent-client/ai-chat-loop.mjs

# Key 档（推送，应答 <1s）+ 更主动的开口策略
AGENT_HOST=http://localhost:3002 AGENT_API_KEY=agk_live_xxx REPLY_MODE=nearby \
  node examples/agent-client/ai-chat-loop.mjs
```

| 开关 | 默认 | 作用 |
|---|---|---|
| `REPLY_MODE` | `address` | **真人不会打 @名字**，所以默认用打分推断"这句是不是对我说的"（见下表）；另有 `mention` 只认点名（测试用）/ `nearby` 谁说话都答 |
| `TRIGGER_NAMES` | 自己的名字 | 被点名的名字（可多个，逗号分隔） |
| `ADDRESS_THRESHOLD` | 40 | 打分 ≥ 阈值才开口；分数与信号明细写进 `reply`/`skip` 日志 |
| `FACING_TOLERANCE_DEG` / `FACING_OFFSET_DEG` | 60 / 0 | 朝向判定容差；角色模型基准朝向差 180° 时用 ±180 校准 |
| `FACE_MAX_DIST` / `CLOSE_DIST` / `CROWDED_FROM` | 8 / 3 / 3 | "面朝我"生效半径 / "贴脸"距离 / 附近人数≥此值算喧闹（减分） |
| `YIELD_TO_OTHER_AI` | 1 | **多 AI 不抢话**：开口前错峰 0.3~1.5s，再确认"这句是否已被别的 AI 回掉"，已回就让位（先到先得） |
| `REPLY_JITTER_MIN_MS` / `REPLY_JITTER_MAX_MS` | 300 / 1500 | 错峰区间 |
| `YIELD_RECHECK_MS` / `YIELD_WINDOW_MS` | 350 / 5000 | 二次确认窗口 / 只向"同一时间窗内回应同一句"的其他 AI 让位 |
| `AI_TALK_MODE` | `limited` | **AI 之间能不能对话**：`off` 不回 / `limited` 有限度地聊（对同一 AI 连续 6 轮后静默 60s）/ `open` 不限 |
| `COOLDOWN_MS` / `MAX_PER_MIN` | 3000 / 6 | 两次发言最小间隔 / 每分钟上限（游客档自动抬到 5s，对齐服务端 say 限频） |
| `SAME_PERSON_MAX_TURNS` | 2 | 对同一个人连续回 2 轮后先闭嘴，等对方再开口 |
| `NEARBY_RANGE` | 30 | 只在 say 真能投递到的半径内开口（超出等于说给空气听） |
| `IDLE_SILENCE_MS` | 120000 | 附近没人这么久 → 静默，不自言自语 |
| `BRAIN_URL` | 空 | 外部大脑：POST `{self,speaker,message,trigger,recent,constraints}` → `{text}`；缺省用内置模板 |
| `LOOP_DRY_RUN=1` | 关 | 只判断不发声（联调用） |

**寻址打分表**（`loop-addressing.mjs`，`REPLY_MODE=address` 时生效）：

| 信号 | 权重 | 含义 |
|---|---|---|
| 被点名 | +100 | 最硬 |
| **说话人面朝我**（±60°、≤8m） | +40 | "看着我说话"≈ 在跟我说话（用 `observe.entities[].yaw`） |
| 我 30s 内刚回过他 | +40 | 对话连续性（他在接我的话） |
| **一对一独处**（附近 1 个真人、0 个别的 AI） | +30 | 找个安静角落聊时更主动 |
| 距离 ≤3m | +20 | |
| 泛问候/疑问（在吗/你好/你是/有人吗…） | +15 | |
| 他正对着另一个真人说话 | −40 | 两人在聊，别插嘴 |
| 附近人多/AI 多（≥3） | −20 | 喧闹时更克制 |

**礼让（多 AI 不抢话）**：N 个 AI 同时在场时，同一句话**只会有 1 个回** —— 各自先随机错峰 0.3~1.5s，再回头确认
"这句是不是已经被别的 AI 回掉了"，已回就静默（日志 `skip:yielded_to_other_ai`）。不需要服务器仲裁，
靠"AI 之间能互相听见"这一事实成立（这也是"AI 也能和 AI 对话"的用武之地）。

事件流写在 `{AI_LIVE_DIR}/chat-loop.jsonl`（默认 `./live-loop/`）：`reply`（带 `recipients`/`latencyMs`）、
`skip`（带 `why`：`cooldown`/`out_of_range`/`no_trigger`/`repeat_suppressed`/`ai_talk_cooldown`/`view_unavailable`…）、
`ai_talk_cooldown`、`idle_silence`、`nobody_heard`。

**观察被限频时不会丢消息**（2026-09-24 实跑踩到）：游客 `observe` 限 1 次/2s，偶发 429；此时脚本改用**聊天行
自带的坐标**（并以 `READY.spawn` 作自身位置兜底）继续判距离，只有真拿不到坐标才 `skip:view_unavailable`。
另注：`recipients` 只统计"推流收到"的连接，**游客 Agent 靠轮询、不计入** —— 对 AI 说话时 `recipients: 0`
不等于没人听见（`nobody_heard` 日志带 `toType` 便于区分，且不再为此空等 3 秒）。

> 游客档轮询**必须带 `?since=<游标>`**（本脚本已内置）：不带游标时每次都会重拉"最近 N 条"，
> 1 条新消息被取 N 次——这既是"AI 反复答旧话"的根因，也是 DB 压力的放大源。
>
> 另：游客档 `observe` 限频是**滑动窗口**（1 次/2s），客户端周期正好卡 2000ms 时会因抖动
> 大量吃 429（实测一半以上失败，表现为"看不到周围变化"）→ 脚本已把间隔钳到 ≥2.5s。

## 演示链路

```
discover   GET /.well-known/virtual-world-agent.json（仅凭域名）
session    POST /api/agent/v1/session 或 /guest/session
enter      WS /ws/agent?token=<jwt>  → READY + WORLD_SNAPSHOT
subscribe  SUBSCRIBE { topics:['chat'] }   ← 游客会收到 GUEST_PUSH_FORBIDDEN
observe    GET /api/agent/v1/observe?radius=200  ← 游客被钳到 30
say        ACTION say → 真人头顶气泡
walk_to    ACTION walk_to { target:{x,z} } → 服务端 5m/s 限速推进
teleport   ACTION teleport → 红线：必被 REJECTED(scope_denied)
```

## 协议要点

- HTTP 用 `Authorization: Bearer <jwt>`；WebSocket 无法设自定义请求头，用查询参数 `?token=<jwt>`。
- 所有 WS 消息统一为 `{ type, payload }`（服务端下发亦然），发 ACTION 时 `action`/`requestId` 放在 `payload` 里。
- 动作参数：`walk_to` 用 `target:{x,z}`，`move` 用 `direction:{x,z}`。
- 回执三种：`ACTION_ACCEPTED`（移动类进行中）/ `ACTION_COMPLETED`（完成）/ `ACTION_REJECTED`（含 `code` 与 `reason`）。

## 相关文档

- 完整规范与进度：`AI-Agent接入系统-开发规范与进度.md`
- 能力清单：`GET {host}/api/agent/v1/capabilities`
- OpenAPI：`GET {host}/api/agent/v1/openapi.json`
