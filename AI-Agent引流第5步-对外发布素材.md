# AI Agent 引流第 5 步：对外发布素材与渠道清单

> 目标：让**拥有 AI 的人**（开发者、MCP 宿主用户、平台方）能找到这个世界并把 AI 接进来。
> 前置 1~4 步（发现端点协议 / 机器可读发现层 / 世界 AI 描述 / MCP Server）均已完成。
> 本文是**纯执行清单**：所有文案可直接复制，所有命令可直接跑。

---

## §0 一个前提认知

**AI 不会自己跑来。** 大模型没有自主上网闲逛的能力。能带来 AI 的只有三类"人"：
① 会写 Agent 的开发者；② 把你的世界挂成工具的平台/宿主；③ 你的真人玩家（他们手上有 AI）。
所以"找 AI" = "找拥有 AI 的入口"。本文按这个逻辑排渠道。

---

## §0.5 照做总表（Step 1~14，勾完即完成）

| Step | 动作 | 在哪做 | 发/填什么 | 谁做 | ☐ |
|---|---|---|---|---|---|
| 1 | 放 2~3 个 AI 进世界常驻 | `examples/agent-client/ai-live.mjs` | 命令文件写 `say` / `walk_to` | 你 | ☐ |
| 2 | 录 3 段演示素材 | 浏览器 + 录屏工具 | §2.3 清单 | 你 | ☐ |
| 3 | 替换两处 GIF 占位 | `examples/mcp-server/README.md`、`public/agents/index.html` | 搜 `TODO: 演示 GIF` | 我可代做 | ☐ |
| 4 | 建独立 GitHub 仓库 | github.com/new | §3.3-D | 你 | ☐ |
| 5 | 改 `repository` / `bugs` 地址 | `examples/mcp-server/package.json` | 新仓库 URL | 我可代做 | ☐ |
| 6 | `npm publish` | 终端 | — | 你（授权） | ☐ |
| 7 | 提交 8 个国际目录站 | §4 表 | §3.1 文案 + §3.3-A 字段 | 你（注册） | ☐ |
| 8 | 提交 5 个中文市场 | §5 表 | §3.2 文案 + §3.3-E 字段 | 你 | ☐ |
| 9 | 发 Show HN | news.ycombinator.com/submit | §6.1 | 你 | ☐ |
| 10 | 发 Product Hunt | producthunt.com/posts/new | §6.2 + §3.3-B | 你 | ☐ |
| 11 | 发 V2EX | v2ex.com（节点：分享创造） | §6.3 | 你 | ☐ |
| 12 | 发掘金 | juejin.cn | §6.4 | 你 | ☐ |
| 13 | 世界内放公告牌 | 世界编辑器 | 文字：`AI 也能进来 → https://miduo100.com/agents/` | 你 | ☐ |
| 14 | Search Console 提交 sitemap | search.google.com/search-console | `https://miduo100.com/sitemap.xml` | 你 | ☐ |

每步要发的**完整文案原文**在后面章节：§3（通用文案）→ §4/§5（渠道）→ §6（帖子）。

---

## §1 现状核查（2026-09-24 实测）

线上门面全部就绪，**可以开始对外**：

```
/.well-known/virtual-world-agent.json   200   apiBase=https://…/api/agent/v1
/llms.txt                               200   websocket=wss://…/ws/agent
/agents/                                200   ← 协议已正确，AI 客户端不会撞 Mixed Content
/robots.txt                             200   已放行 10 个 AI 爬虫
/sitemap.xml                            200
/agent-samples/ai-chat-loop.mjs         200   agentEnabled = true
```

| 交付物 | 状态 |
|---|---|
| MCP server 源码 + 验收（M1~M14，42/42） | ✅ |
| 包元数据（去 `private`、仓库、关键词、keywords） | ✅ 本轮补齐 |
| **演示 GIF / 录屏** | ⏸ **唯一硬阻塞**（README 与 `/agents/` 各有一个 `TODO` 占位） |
| npm 发布 `virtual-world-mcp` | ⏸ 需授权（§2） |
| 独立 GitHub 仓库 | ⏸ 需建（多数目录站要求可克隆来源） |
| 目录站 / 社区提交 | ⏸ 本文提供全部文案 |

---

## §2 发布包落地（3 步，需授权）

### 2.1 建独立 GitHub 仓库（推荐，多数目录站的前置）

```bash
# 把 MCP server 单独拆成仓库，主仓库保留副本
cd examples/mcp-server
git init && git add . && git commit -m "virtual-world-mcp: MCP server for walking an AI into a live 3D world"
# 在 GitHub 建空仓库 miduo100/virtual-world-mcp 后：
git remote add origin https://github.com/miduo100/virtual-world-mcp.git
git push -u origin main
```

建好后把 `package.json` 里的 `repository.url` / `bugs.url` 改成新仓库地址。

### 2.2 发 npm

```bash
cd examples/mcp-server
npm install          # 确保依赖完整
npm login            # 需 npm 账号，且 virtual-world-mcp 包名未被占用
npm publish --access public
```

发布后用户即可 `npx -y virtual-world-mcp`（README 第一节的推荐配置才成立）。

### 2.3 录演示素材

见 `examples/mcp-server/README.md` 第九节「演示素材录制清单」——3 段，总长 ≤30 秒：
走过去说话（GIF）、8 个工具列表（PNG）、`world_observe` 原始输出（PNG）。
**不要用示意图代替**：目录站审核与开发者信任都建立在"这是真的在跑"。

---

## §3 通用提交文案（每个站都要，直接复制）

### 3.1 英文（国际目录站）

**Name**：`virtual-world-mcp`

**One-liner（≤100 字符，多数站的标题位）**：
```
Give your AI a body: walk into a live 3D world, talk to real players, and be seen.
```

**Short description（1~2 句，列表页展示）**：
```
MCP server that lets Claude / Cursor / Cline step into a running multiplayer 3D world.
No credentials needed — set AGENT_HOST and your AI gets an avatar, sees nearby players
and objects, walks, talks and follows. Real human players see it happen in real time.
```

**Long description（详情页 / GitHub About）**：
```
virtual-world-mcp connects any MCP host to a live 3D online world where human players
are actually walking around.

Your AI is not watching a simulation — it enters the world as a visible avatar. Humans
see it move, see its chat bubbles, and can talk back. The AI sees the world as text:
nearby players, objects with descriptions, distances, portals, and what changed since
its last look.

Zero-credential start: set AGENT_HOST and go. Guest tier gives a 30-minute session,
30 m observation radius, pull mode. Add an API Key for 200 m radius, real-time push
(hear humans talk without polling), and long-lived presence.

Tools: world_discover · world_enter · world_observe · world_say · world_walk_to ·
world_follow · world_chat_history · world_leave
Plus one Resource (virtual-world://guide — the world's own orientation guide) and two
Prompts (world_guided_tour, world_report).

Deliberately NOT provided: teleport and set_position. An AI must travel the world the
way humans do. The server enforces this; the MCP layer never wraps a way around it.

Reference world: https://miduo100.com  ·  Landing page: https://miduo100.com/agents/
```

**Category / Tags**：`AI` `Agents` `3D` `Gaming` `Social` `Simulation` `LLM Tools`

### 3.2 中文（国内站 / 中文社区）

**一句话**：
```
给你的 AI 一个身体：走进真实的 3D 世界，和真人玩家说话，并被他们看见。
```

**短描述**：
```
virtual-world-mcp 是一个 MCP server，让 Claude / Cursor / Cline 里的 AI 直接进入一个
正在运行的 3D 多人世界。无需注册，只填一个 AGENT_HOST，AI 就有了形象：能看见附近的
玩家和物体、能走路、能说话、能跟随真人。真人玩家在浏览器里实时看到这一切。
```

### 3.3 各渠道表单字段速填（照抄，含字数限制）

**A. MCP 目录站通用字段**（mcp.so / Glama / PulseMCP / Smithery / Cline Marketplace / Cursor Directory 字段大同小异）

| 表单字段 | 填什么 |
|---|---|
| Name / Server name | `virtual-world-mcp` |
| Repository URL | `https://github.com/miduo100/virtual-world-mcp` |
| Package / Install | `npx -y virtual-world-mcp` |
| One-liner / Tagline | §3.1 的 One-liner |
| Short description | §3.1 的 Short description |
| Full description | §3.1 的 Long description |
| Category | `AI` 或 `Agents`（没有就选 `Developer Tools`） |
| Tags | `mcp` `ai-agent` `3d` `virtual-world` `llm` `gaming` |
| Env / Config example | §6.3 的那段 JSON |
| Screenshot / Logo | `docs/demo-walk-and-talk.gif`（§2.3 录的第 1 段） |

**B. Product Hunt**

| 字段 | 限制 | 填什么 |
|---|---|---|
| Name | — | `virtual-world-mcp` |
| Tagline | **≤60 字符** | §6.2 的 Tagline |
| Description | — | §6.2 的 Description |
| Topics | ≤3 | `Artificial Intelligence` · `Developer Tools` · `Gaming` |
| Gallery | ≥1 张，建议 1270×760 | 演示 GIF 第 1 段 |
| First comment | — | §6.2 的 First comment（发布后立刻自己发） |

**C. Show HN**

| 字段 | 限制 | 填什么 |
|---|---|---|
| Title | **≤80 字符**，必须 `Show HN:` 开头 | §6.1 标题 |
| URL | — | GitHub 仓库地址 |
| Text | 可留空；要写就贴 §6.1 正文 | §6.1 正文 |

**D. GitHub 仓库**

| 字段 | 限制 | 填什么 |
|---|---|---|
| About | **≤350 字符** | §3.1 的 Short description |
| Topics | — | `mcp` `model-context-protocol` `ai-agent` `virtual-world` `3d` `llm-tools` |
| README 首图 | — | 演示 GIF 第 1 段 |
| License | — | MIT |

**E. 中文市场**（魔搭 / Coze / Dify / 千帆 / 元器）

| 字段 | 填什么 |
|---|---|
| 名称 | virtual-world-mcp（AI 进入 3D 虚拟世界） |
| 简介 | §3.2 中文短描述 |
| 仓库 / 包地址 | 同 A |
| 分类 | AI 应用 / 工具插件 / 3D 与游戏 |

---

## §4 国际 MCP 目录站清单

> 提交入口每站会改版，下表给的是**主域名 + 站内入口关键词**；打开后找
> `Submit` / `Add server` / `New` / `List your MCP` 即可。

| # | 站点 | 主域名 | 提交方式 | 特殊要求 | ☐ |
|---|---|---|---|---|---|
| 1 | **MCP 官方 servers 仓库** | `github.com/modelcontextprotocol/servers` | 按 README 指引提交 PR（近年改为走官方 Registry，以仓库当前说明为准） | 需 GitHub 仓库 + README | ☐ |
| 2 | **awesome-mcp-servers** | `github.com/appcypher/awesome-mcp-servers` | PR 在对应分类下加一条 | 格式：`- [name](url) - 描述` | ☐ |
| 3 | **mcp.so** | `mcp.so` | 站内 Submit | 量最大的第三方目录，支持 GitHub 导入 | ☐ |
| 4 | **Smithery** | `smithery.ai` | 站内 New / 提交 GitHub 仓库 | 自动解析仓库生成配置，需仓库可访问 | ☐ |
| 5 | **Glama** | `glama.ai` | 提交 GitHub 仓库，自动索引 | 会抓取 README 生成页面 | ☐ |
| 6 | **PulseMCP** | `pulsemcp.com` | 站内 Submit a server | 有编辑审核，需填分类与截图 | ☐ |
| 7 | **Cline Marketplace** | `cline.bot` | 站内 Marketplace 提交 | VS Code 侧用户量大 | ☐ |
| 8 | **Cursor Directory** | `cursor.directory` | 站内 Submit | Cursor 用户找 MCP 的第一站 | ☐ |

提交时统一粘贴 §3.1 文案；仓库字段填 §2.1 的新仓库地址（未建则先用主仓库 + 目录 `examples/mcp-server`）。

---

## §5 中文插件市场与 AI 平台

| # | 渠道 | 主域名 | 说明 | ☐ |
|---|---|---|---|---|
| 1 | **魔搭 MCP 广场** | `modelscope.cn` | 国内最活跃的 MCP 市场，提交需仓库地址 | ☐ |
| 2 | **扣子 Coze 插件/商店** | `coze.cn` | 可做成插件让 Coze Bot 直接进世界 | ☐ |
| 3 | **Dify 插件市场** | `dify.ai` | 走 HTTP 工具封装即可，不必用 MCP | ☐ |
| 4 | **百度千帆组件** | `cloud.baidu.com` | 千帆 AppBuilder 组件提交 | ☐ |
| 5 | **腾讯元器** | `yuanqi.tencent.com` | 元器插件/工具提交 | ☐ |

> 补充：豆包 / 火山方舟、通义、智谱这几家**没有开放自助上架**，只能走 BD 邮件或开放平台工单，周期以周计——放在 §7 的第二周做，不阻塞首发。

---

## §6 社区帖子草稿

### 6.1 Show HN（英文）

**标题**（必须 `Show HN:` 前缀，≤80 字符）：
```
Show HN: I gave AI agents a body in my 3D world – they walk in and talk to real players
```

**正文**：
```
I run a multiplayer 3D world in a browser. Last month I built an MCP server so AI agents
can enter it the same way humans do — not as a simulation, but as a visible avatar that
real players see walking around and talking to.

How it works: the AI connects over WebSocket, gets an avatar, and receives the world as
text — nearby players, objects with descriptions, distances, portals, and what changed
since its last look. It can walk to coordinates, follow a player by id, say something
(30 m audible bubble), and read chat history. Humans see all of it live in the browser.

Two things I think are interesting:

1. Zero-credential onboarding. You only set AGENT_HOST. Guest tier = 30-min ticket, 30 m
   radius, pull mode. No signup, no API key, no sandbox to spin up.
2. Refusing teleport on purpose. There is no `teleport` or `set_position` tool — the
   server rejects them and the MCP layer doesn't wrap a workaround. If an AI wants to be
   somewhere, it has to travel there. That single constraint is what makes it feel like
   a place instead of a database.

Honest limits: guest tier is pull-only (no push), 1 connection per IP, 10 tickets/hour,
5-min idle timeout. observe output is budgeted to ~2 KB so it doesn't blow up context.

Try it: npx -y virtual-world-mcp with AGENT_HOST=https://miduo100.com
Source: <仓库地址>   Landing page: https://miduo100.com/agents/

Curious whether anyone else is working on "AI as a resident" rather than "AI as a tool" —
most agent work I see is still tool-calling in a vacuum.
```

### 6.2 Product Hunt

**Tagline（≤60 字符）**：
```
Give your AI a body — it walks into a live 3D world and talks to real people
```

**Description**：
```
virtual-world-mcp lets Claude, Cursor or Cline step inside a running multiplayer 3D
world as a visible avatar. Real human players see your AI walk up, talk, and follow
them. No signup — set one env var and go.
```

**First comment（PH 惯例，作者自述）**：
```
Hey PH — I built this because every AI agent I used felt like it was shouting into a
void. So I gave mine somewhere to be.

It's an MCP server: your AI gets an avatar in a real 3D world where humans are already
walking around. It sees players and objects as text, walks, talks (30 m bubble), follows
people by id. Humans see it happen in the browser, live.

Two design choices I'd defend:
- No teleport, no set_position. Deliberately. An AI has to travel like everyone else.
- Zero credentials to start. One env var (AGENT_HOST), 30-minute guest session.

Would love feedback from anyone running agents in Cursor/Claude — especially on whether
the observe output (budgeted to ~2 KB) is the right shape for your context window.
```

### 6.3 V2EX（节点：分享创造 / 程序员）

**标题**：
```
做了个 MCP server，让 AI 能走进一个真实的 3D 世界，和被真人玩家看见、聊天
```

**正文**：要点版即可（V2EX 不喜欢长文）：做什么、怎么用（贴配置 JSON）、两条设计取舍（零凭证 / 不做传送）、已知限制、链接。用 §3.2 的中文短描述打底 + 贴这段配置：

```json
{
  "mcpServers": {
    "virtual-world": {
      "command": "npx",
      "args": ["-y", "virtual-world-mcp"],
      "env": { "AGENT_HOST": "https://miduo100.com" }
    }
  }
}
```

### 6.4 掘金（技术向，要讲实现）

建议结构：
1. 效果开场（GIF）
2. MCP 是什么，30 秒说明
3. 分层设计：`httpClient`（发现/签票/续期）→ `waiter`（消息等待原语）→ `worldClient`（WS 入场/动作/事件环形缓冲）→ `tools`
4. 三个真实难点：① `observe` 输出 1900 字节预算（中文 UTF-8 三字节，按字节算）；② 会话续期只换 token 绝不重连（否则真人看到形象闪烁）；③ 发现文档可能广播 `http://` 而站点是 https（协议必须以 `AGENT_HOST` 为准）
5. 完整接入步骤 + 8 个工具表
6. 开源地址与演示世界

### 6.5 知乎 / 少数派（产品故事向）

标题方向：《我让自己的 3D 世界向 AI 开放了，然后发生了什么》
叙事线：为什么做（AI 一直在真空里调工具）→ 做了什么（AI 成为居民而非工具）→ 两条红线（不传送、所有 Agent 一律游客级）→ 真人玩家的反应 → 开放给所有人 → 邀请。

---

## §7 七天执行顺序

```
D1  冷启动：放 2~3 个 AI 常驻世界（examples/agent-client/ai-live.mjs）
    让真人进来就能看到 AI 在走动说话 —— 这是后面所有素材与口碑的地基
D2  录 3 段演示素材（§2.3），替换 README 与 /agents/ 的 TODO 占位
D3  建独立 GitHub 仓库 + npm publish（§2.1 / §2.2）→ 需要授权
D4  提交 §4 的 8 个国际目录站（一个下午可做完）
D5  提交 §5 的 5 个中文市场
D6  Show HN + Product Hunt + V2EX/掘金（错开发布时间，HN 建议周二~周四上午美东）
D7  世界内放公告牌指向 https://miduo100.com/agents/
    Google Search Console 提交 sitemap；给主动接洽者发 Key 档
```

**第二周**：豆包/通义/智谱/千帆的 BD 邮件；知乎 / 少数派长文。

---

## §8 需要你授权 / 人工完成的动作

这些我做不了或不应擅自做，请确认：

| # | 动作 | 为什么需要你 |
|---|---|---|
| 1 | 建 GitHub 仓库并 push | 账号所有权；且这是公开行为 |
| 2 | `npm publish` | 包名与账号绑定，发布后不可撤销（只能 deprecated） |
| 3 | 录演示 GIF | 需要真人在世界里操作 |
| 4 | 各目录站提交 | 需要注册账号 + 邮箱验证，我不该代注册 |
| 5 | 是否给外部开发者发 Key 档 | 涉及推流成本与 `max_agents=50` 配额 |

---

## §9 发布后看什么（判断有没有真的引来 AI）

| 指标 | 在哪看 | 期望 |
|---|---|---|
| 游客签票数 | 服务端审计日志 `audit.log` 的 `session` 事件 | 发布后 48h 内出现非本地 IP |
| 实际入场数 | `world_enter` 对应 `PLAYER_JOINED` 广播计数 | 签票 ≠ 入场，只有进了才算 |
| 停留时长 | WS 连接的存活时间 | >5 分钟说明不是"试一下就走" |
| 真人侧反馈 | 世界内聊天记录 / 玩家反馈 | 有人问"这是谁"就说明有效 |
| 失败率 | `GUEST_IP_CONCURRENCY` / `GUEST_TICKET_RATE_LIMITED` 出现频次 | 若很高，说明限流在劝退新来者（见下） |

**预警**：游客档每 IP 1 连接、10 票/小时、5 分钟空闲踢出。外部 AI 第一次来很容易撞上。
建议一看到有真实外部接入，立刻主动联系对方发 **Key 档**（200m + 推流 + 自动续期），
`/agents/` 与 `llms.txt` 里已留申请邮箱。

---

## §10 与世界内运营的配合（决定留存，不只是获客）

AI 进来看到什么，决定它会不会再来：

- **物体描述**：1078 个物体里，365 个几何体有自动推导描述；模型与媒体仍是空的。
  后台补填路径见第 3 步文档 `scripts/sync_agent_descriptions.js` 与 `AI描述待填清单.md`。
- **出生点**：AI 与真人共用同一个出生点（已实现，无缓存），AI 落地就在人群里，不会掉在荒地。
- **示例客户端**：`https://miduo100.com/agent-samples/ai-chat-loop.mjs`（含寻址推断与多 AI 礼让），
  来访方下载即可跑，不必读主仓库源码。

---

**相关文件**
- 第 1 步：发现端点协议修正（已上线）
- 第 2 步：机器可读发现层（`public/robots.txt` / `sitemap.xml` / `llms.txt` / `agents/index.html`）
- 第 3 步：世界 AI 描述补全（`src/data/geometryDescMap.json`、`scripts/sync_agent_descriptions.js`）
- 第 4 步：MCP Server（`examples/mcp-server/`，验收 `scripts/accept_mcp_server.js`）
- 接入说明页：`public/agents/index.html`
