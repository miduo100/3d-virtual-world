# AI 访客视角体检报告（miduo100.com）

> 体检时间：2026-09-22
> 体检身份：**AI 访客**（AI 爬虫 / LLM 索引器 / Agent 客户端 / MCP 客户端 / 联网搜索的对话 AI）
> 体检方式：**纯只读实测**。全部结论都来自对线上 `https://miduo100.com` 的真实请求；
> 没有修改任何代码、配置或线上内容，没有发布任何东西。
> 唯一落盘产物 = 本报告。

---

## 0. 结论速览（先看这一段）

| 项 | 结果 |
|---|---|
| 🔴 阻断级问题 | **0 个**（没有任何 AI 爬虫被拦、没有关键端点 404、没有 HTML 错误页） |
| 🟠 严重 | **6 个**（无需 JS 的首页是空壳；`observe` 世界身份返回 null；llms.txt 动作清单漂移；默认输出看不到任何传送门；AI 出生点距真人 31m 超出 30m 半径；`/api/world/objects` 免鉴权无限流 784KB） |
| 🟡 建议 | **13 个**（含 3 条**首版误定为 🟠、经用户澄清属设计使然后降级**的条目：[7-2] 物体名是内部代号、[7-3] 媒体对象无描述、[7-6] 游客档无推流） |
| 🟢 良好（值得保持） | **11 个** |
| 综合分 | **35 / 40**（发现层与接入链路接近满分，短板集中在"无 JS 可读性"与"进来之后能看到什么"） |

> **修订记录（2026-09-22，用户复核后）**：首版把「模型/图片/视频没有 AI 描述」「游客档收不到推流」写成 🟠 严重，**定级错误**——
> 前者是"后台尚未人工填写"的**正常待办**，后者是**红线 14 的明确设计**（游客档刻意不给推流，防止游客长期占用服务器推流成本）。
> 这两条不是缺陷，已降级为建议并在 §2.0 单列「设计使然（非缺陷）」清单。「物体名是内部代号」同理（几何体 100% 有描述兜底，属数据待填）。
> 综上，本报告的 🟠 严重从 8 条修正为 6 条，综合分 34 → 35。**其余结论未变。**

> **修复记录（2026-09-22，用户决策"只修必改的 2 条"）**：
> - [6-2] `observe.world` 恒 null —— ✅ **已修复**（`src/agent/agentObservationService.js` 的 `getWorldInfo()`：键名改命名键、优先级对齐 well-known/`/me` 的 federation 源、federation 未就绪时 5s 短缓存）
> - [6-1] `llms.txt` 把 `observe` 列成 WS 动作 —— ✅ **已修复**（`public/llms.txt` 拆成「WS actions 8 项」+「HTTP observe」两行；并把验收判据 D6a 从"包含"收紧为"逐项相等"防复发）
> - 数据：[6-2] 本地实测 `observe.world` = `{id:"world_1770800924268_ptbh0p39m", name:"米多100的3002", url:"http://localhost:3002"}`，与 well-known 及 `/me` 的 worldId **逐字一致**；[6-1] 本地 `llms.txt` 与 capabilities 的 WS 动作集合**逐项相等（8=8）**。
> - 验收：新增 `scripts/accept_agent_observe_world.js` **10/10 PASS**（补上了"此前从未存在"的世界身份断言）；`accept_agent_discovery_layer.js` **19/19 PASS**（含收紧后的 D6a）；回归 `accept_agent_p2.js` **14/14**、`accept_agent_p6.js` **23/23**。
> - 未改动：其余全部结论（包括 [5-5] 出生点、[7-4] 传送门预算、[8-3] objects 限流等）**保持原状**。
>
> **线上验证（2026-09-22，部署 + 重启后实测）**：
> - `public/llms.txt`：线上第 18~21 行已为新写法（`Content-Length: 4163`、`Last-Modified: Tue, 22 Sep 2026 12:00:20 GMT`），线上 `capabilities.actions` 与 llms.txt 的 WS actions 行**逐项一致（8=8，顺序相同）**。
> - `src/agent/agentObservationService.js`：重启后实测线上 `observe.world` = `{"id":"world_1770800924268_ptbh0p39m","name":"创世虚拟世界","url":"https://miduo100.com/"}`，
>   **不再是 null**；与线上 `/.well-known/virtual-world-agent.json` 的 `world.id/name`、`/api/agent/v1/me` 的 `worldId`、`/api/config/world-settings` 的 `world_name` **四处逐字一致**。
> - 验收：`accept_agent_observe_world.js` 打线上 **10/10 PASS**（`AGENT_TEST_BASE=https://miduo100.com AUDIT_NO_ADMIN=1` 只读模式，不触碰管理员接口）。
>
> ---
>
> **修复记录 · 第二批（同日 P1+P2，本地已验证，待部署）**：
> | 编号 | 内容 | 状态 |
> |---|---|---|
> | [1-2] | `public/robots.txt`：给 AI 组/搜索引擎组补上与 `*` 组一致的 `Disallow`（RFC 9309 组不合并）；并把验收判据 **D1b2** 从"全文件存在 Disallow"收紧为"**每个 AI 组的组内**都写全" | ✅ 已修复（`D1b2` 20/20 PASS；反向验证：旧写法会被判 FAIL） |
> | [5-5] | AI 出生点改为 `system_config('world_spawn_point')` **+ ≤3m 随机偏移**（`agentSessionManager.getInitialSpawn` + `agentWsServer` 兜底链）。**读配置不做缓存、默认值与真人同为 `{x:0,y:0.05,z:0}`**——用户明确要求"出生点改到哪里 AI 就跟到哪里"，真人前端也是每次进世界都请求 `GET /api/world/spawn-point` | ✅ 已修复：`accept_agent_spawn_follow.js` **5/5**（改到 (120.5,2,-80.25) 后**不等待任何缓存**，新连接 spawn 立刻落在新点 2.04m 内；恢复后回到原点；配置被脚本改回原值）；`READY.spawn` 距出生点 1.2~2.9m，两次连接点位不同 |
> | [5-3] | 未知动作口径：不在八动作白名单且非红线动作 → `unknown_action` + 可用动作清单 | ✅ 已修复（`walkTo` → `unknown_action`；`teleport` 仍 `scope_denied`） |
> | [5-4] | `BAD_JSON` 补可读 `message` | ✅ 已修复 |
> | [7-3] | 12 条乱码显示名 → `scripts/fix_agent_visible_data.sql`（幂等） | ✅ 本地库已执行（12 行，复跑 0 行）；⏳ **线上待执行该 SQL** |
> | [7-5] | 传送门 `测试`/`测试 (返回)` 与 3 个空描述 | ⏳ **待你填内容**（SQL 模板已给，未预设文案——编造内容比留空更糟） |
> | [7-4] `[8-3]` `[8-4]` `[8-5]` `[4-2]` `[3-1]` `[6-3]` `[6-4]` | MCP 预算 / objects 限流 / 安全头 / SEO 细节 / 首页可读性 / 405 / MCP 节流 | ⬜ 按约定**保持原状**（P3/P4 批次） |
>
> 验收总览：`accept_agent_visitor_fixes.js`（新增，12 条）**12/12**、`accept_agent_observe_world.js` **10/10**、`accept_agent_discovery_layer.js` **20/20**、`accept_agent_p2.js` **14/14**、`accept_agent_p6.js` **23/23**、`accept_agent_p4.js` **26/26**、`smoke_r185_world.js` **9/9**。
> 修复过程中被自家判据抓到 1 个回归：首版 `#7` 白名单把红线动作 `teleport` 也吃成 `unknown_action`（`#7c` 判据 FAIL）→ 已改为排除 `FORBIDDEN_SCOPES`。
| 最该先做的 3 件事 | 见 §4 |

**一句话总结**：这条路已经通了，而且通得比大多数"AI 友好"的站更彻底——零凭证就能真的走进一个 3D 世界、被真人看见、被真人听见气泡。
真正值得改的只有两处**实现级**问题：① `observe` 的"世界身份"字段因查错键名而恒为空（AI 主视角显示"世界未知"）；
② `llms.txt` 把 `observe` 列成了 WS 动作（AI 照着发会被拒）。其余多数是"补一句文档 / 调一个参数"级别。
（"媒体/模型没有描述""游客档收不到推流"经用户澄清属**设计使然**，见 §2.0，不是缺陷。）

---

## 1. 「AI 视角」打分表

| 维度 | 分数(1-5) | 一句话理由 |
|---|---|---|
| 1. 发现层（找得到吗） | **5** | robots / sitemap / llms.txt / well-known 四件套齐全、全部可达，首页有且仅有 1 个 AI 入口链接 |
| 2. UA 可见性（爬虫被拦吗） | **5** | 9 个 UA × 5 条路径 = 45 次请求全部 200，宝塔没有 UA 黑名单/WAF 拦截 |
| 3. 无 JS 可读性（AI 看得懂吗） | **2** | 首页 62KB 原始 HTML 里只有 1609 字节可见文本，且大半是 WASD 操作说明；AI 摘要只能靠 title/description |
| 4. SEO 对爬虫生效性 | **4** | 服务端注入**确认生效**（指纹 + 逐字一致 + og/twitter 8 个标签）；扣分在 description 过长、无 canonical、`summary_large_image` 却没有图 |
| 5. 零凭证接入（进得来吗） | **5** | 票 → WS → observe → say → move 全链路实测通过；错误全是 JSON + 稳定 code；并发/限频闸门可读 |
| 6. 文档一致性（会说谎吗） | **3** | llms.txt 把 `observe` 列进 actions 而 WS 不认它；`observe` 协议字段 `world` 恒为空；未知动作被误报为权限问题 |
| 7. 内容可用性（进来有得玩吗） | **4** | 几何体描述 99/100 且质量好；扣分在"传送门看不到名字"与"媒体对象名乱码"（后者是 1 条数据）；物体名是内部代号、媒体无描述、游客无推流均属**设计/待填**，不计扣分 |
| 8. 合规与安全 | **3** | 敏感文件全部 404、门面文件短缓存（好）；但 HSTS/CSP/X-Frame-Options 全缺，`/api/world/objects` 免鉴权无限流 |

---

## 2. 分级发现（四段式）

> 编号规则：`维度号-序号`。每条都附**可直接复制的命令**与**真实输出**。
>
> **修复状态索引（2026-09-22 最终）**：
> - ✅ **已修复并上线验证**：[6-1] [6-2]（第一批）、[1-2]（robots，线上已核对为新版）
> - ✅ **已修复、已上传、待线上验证**：[5-3] [5-4] [5-5]（后端三处，需重启生效）、[7-3] 的乱码名部分（线上需执行 `scripts/fix_agent_visible_data.sql`）
> - ⏳ **待你给内容**：[7-5] 传送门的名字/描述（SQL 模板已给，不预设文案）
> - ❌ **已确认不做（设计使然，用户拍板）**：[7-2] 物体名是内部代号、[7-6] 游客档无推流（详见 §2.0 与两条的正文说明）
> - ⬜ **按约定保持原状（未改）**：[3-1] [4-2] [6-3] [6-4] [7-4] [8-3] [8-4] [8-5] [1-3]
>
> 下文各条正文保持**体检当时的原始描述与证据**（便于复核），状态以本索引与 §0 的两份「修复记录」为准。

### 2.0 设计使然（非缺陷）——先说清楚这些不是问题

> ⚠️ 本节是首版定级错误的修正说明，建议优先阅读。

站在"AI 访客"视角很容易把这些记成缺点，但**在本次审计的结论里它们不算缺陷**，后续复核时不要再当成待办：

| 现象 | 为什么不是缺陷 | 归因 |
|---|---|---|
| 模型级物体（`uploaded_model`）`description` 为 0/706 | 描述是**人工在后台填写**的数据，不是代码漏了；几何体 365/365 由"名称类型词"自动推导，已经覆盖了世界里的绝大多数物体。这是既定的**待填待办**，不是缺陷 | 用户决策 + 既定待办 |
| 图片/视频（媒体对象）没有 `description` | 同上：后台未填写。且 MCP 输出对缺描述的对象会明确打印「（无 AI 描述）」，guide 里也写了"描述是空的就如实说，不要用名字猜"，AI 侧有护栏 | 用户决策 + 既定待办 |
| 游客档（`guest-pull`）**收不到任何实时推送**（真人说话/走动都不推给 AI） | 这是**红线 14 的明确设计**：游客是零凭证的公开入口，若允许推流，游客可长期占住服务器推流成本与 `max_agents` 名额。拉模式（主动 observe / 主动拉 chat history）是刻意的成本控制 | 用户决策（红线） |
| 物体名多为内部代号（`乡村村落_1778144396568_flower_26`） | 名字只是显示用（协议明确写了 `name` 仅显示、`id` 才是唯一标识），且几何体 100% 有可读描述兜底；改名属"数据美化"而非缺陷 | 用户决策（优先级） |

> 下面从「维度 1」起只列**真正值得看**的发现。原首版把上表前三条写成 🟠 严重的条目，已按此表降级为 🟡 并在正文标注「设计使然」。



---

### 维度 1：发现层

#### [1-1] 🟢 四件套齐全且逐一可达，AI 不需要猜 URL

- **级别**：🟢 良好（值得保持）
- **证据**：

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}B\n" https://miduo100.com/robots.txt
curl -s -o /dev/null -w "%{http_code} %{size_download}B\n" https://miduo100.com/sitemap.xml
curl -s -o /dev/null -w "%{http_code} %{size_download}B\n" https://miduo100.com/llms.txt
curl -s -o /dev/null -w "%{http_code} %{size_download}B\n" https://miduo100.com/.well-known/virtual-world-agent.json
curl -s https://miduo100.com/ | grep -o 'href="[^"]*"' | sort -u
```

真实输出：四条全部 `200`；首页 `href` 去重后**只有** `href="/agents/"`（不散乱、且确实存在）。
`sitemap.xml` 三条 `<loc>`（`/`、`/agents/`、`/llms.txt`）实测全部 200，`lastmod=2026-09-22` 与当天一致。
`robots.txt` 显式放行 10 个 AI User-agent（GPTBot / ChatGPT-User / OAI-SearchBot / ClaudeBot / Claude-Web / anthropic-ai / PerplexityBot / Bytespider / Google-Extended / Applebot-Extended）+ 3 个搜索引擎。
- **为什么对 AI 是问题**：不是问题——这正是"AI 能自己找到入口"的标准做法。
- **建议改法**：保持。唯一可优化项见 [1-2]。

---

#### [1-2] 🟡 robots 的 AI User-agent 组没有继承 `*` 组的 Disallow，语义上 AI 爬虫被允许抓 API 与全部 3D 资产

- **级别**：🟡 建议（但对爬虫预算是真金白银）
- **证据**：

```bash
curl -s https://miduo100.com/robots.txt
```

真实结构（节选）：

```
User-agent: GPTBot
Allow: /            ← 该组内只有这一条

User-agent: *
Allow: /
...
Disallow: /api/     ← 这些 Disallow 只属于 `*` 组
Disallow: /uploads/
Disallow: /models/
Disallow: /*.glb$
```

- **为什么对 AI 是问题**：按 robots.txt 规范（RFC 9309），爬虫**只使用"最匹配自己的那一组"，各组之间不合并**。
  因此 GPTBot / ClaudeBot / PerplexityBot 读到的规则是"允许全部"，**并不会**继承 `*` 组里的 `/api/`、`/uploads/`、`*.glb` 禁令。
  意味着：合规的 AI 爬虫可以合法地去抓 `/api/world/objects`（784KB/次，见 [8-3]）与 GB 级的 `.glb` 模型。
  这不是"AI 能不能进来"的问题，而是"AI 会不会把你的带宽当成正文抓走"的问题——而且被抓的对象**对 AI 索引毫无价值**（二进制模型）。
- **建议改法**：把 `*` 组里的 Disallow 逐条复制到每个 AI User-agent 组（或改为先写 `User-agent: *` 的通用 Disallow，再对 AI 组只补 `Allow: /agents/`、`/llms.txt`、`/.well-known/`、`/api/agent/v1/capabilities`、`/api/agent/v1/openapi.json`、`/api/agent/v1/guest/session`）。**只改 robots.txt，无需改代码。**

---

#### [1-3] 🟡 第二台世界（仅 http）没有 AI 门面：robots / llms.txt / agents 页全部 404

- **级别**：🟡 建议（多世界部署的一致性）
- **证据**（IP 已在提示词 §1.1 给出，此处按红线遮蔽）：

```bash
# 另一台世界（仅 http、无证书）
curl -s -o /dev/null -w "%{http_code}\n" http://<另一台世界>:3002/robots.txt
curl -s -o /dev/null -w "%{http_code}\n" http://<另一台世界>:3002/llms.txt
curl -s -o /dev/null -w "%{http_code}\n" http://<另一台世界>:3002/agents/
curl -s -o /dev/null -w "%{http_code}\n" http://<另一台世界>:3002/.well-known/virtual-world-agent.json
```

真实输出：`404 / 404 / 404 / 200`。
该世界的 well-known 是能读的、且自洽（`world.url` = `http://…:3002`，`apiBase` 同为 http，`websocket` 为 `ws://`），
但 `agentEnabled: true` 且**没有任何门面页**。
- **为什么对 AI 是问题**：AI 从这台世界的 well-known 能发现它，但①没有任何人类可读的介绍页可引用；②门面文件缺失意味着"发现层"这套资产没跟着世界一起复制。
  另外它是纯 http：从 https 页面出发的 AI/浏览器客户端加载它的资产会被 Mixed Content 硬拦（这是已知设计级死角，不是本次新发现，仅记录一致性缺口）。
- **建议改法**：把这 4 个静态门面文件（robots/sitemap/llms.txt/agents 页）纳入世界部署清单；该世界若要对外承接 AI 引流，建议先上证书。

---

### 维度 2：不同 AI 爬虫 UA 的可见性

---

#### [2-1] 🟢 9 个 UA × 5 条路径全部 200，没有被 WAF / UA 黑名单拦

- **级别**：🟢 良好（**这是第 5 步宣传是否白做的判定项，结论是"没白做"**）
- **证据**：

```bash
# 实测脚本（node，UA 逐个指定）
node - <<'EOF'
const UAS = {
  GPTBot:'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  'OAI-SearchBot':'Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)',
  'ChatGPT-User':'Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)',
  ClaudeBot:'Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  PerplexityBot:'Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  Bytespider:'Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)',
  Googlebot:'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  bingbot:'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  curl:'curl/8.4.0'
};
const paths = ['/', '/agents/', '/llms.txt', '/robots.txt', '/.well-known/virtual-world-agent.json'];
(async () => {
  for (const [n, ua] of Object.entries(UAS)) {
    const r = [];
    for (const p of paths) r.push(`https://miduo100.com${p}=${(await fetch('https://miduo100.com'+p,{headers:{'User-Agent':ua}})).status}`);
    console.log(n.padEnd(16), r.join('  '));
  }
})();
EOF
```

真实输出（完整）：

```
GPTBot           /=200  /agents/=200  /llms.txt=200  /robots.txt=200  /.well-known/virtual-world-agent.json=200
OAI-SearchBot    /=200  /agents/=200  /llms.txt=200  /robots.txt=200  /.well-known/virtual-world-agent.json=200
ChatGPT-User     /=200  /agents/=200  /llms.txt=200  /robots.txt=200  /.well-known/virtual-world-agent.json=200
ClaudeBot        /=200  /agents/=200  /llms.txt=200  /robots.txt=200  /.well-known/virtual-world-agent.json=200
PerplexityBot    /=200  /agents/=200  /llms.txt=200  /robots.txt=200  /.well-known/virtual-world-agent.json=200
Bytespider       /=200  /agents/=200  /llms.txt=200  /robots.txt=200  /.well-known/virtual-world-agent.json=200
Googlebot        /=200  /agents/=200  /llms.txt=200  /robots.txt=200  /.well-known/virtual-world-agent.json=200
bingbot          /=200  /agents/=200  /llms.txt=200  /robots.txt=200  /.well-known/virtual-world-agent.json=200
curl             /=200  /agents/=200  /llms.txt=200  /robots.txt=200  /.well-known/virtual-world-agent.json=200
```

- **为什么对 AI 是问题**：无问题。门面页对 AI UA 可见，是"能被引用"的前提。
- **建议改法**：保持。**不要**给门面页加 UA 白名单/防爬（一旦被拦，前面的引流工作全部作废）。

---

### 维度 3：不执行 JS 的视角（本站最大短板）

---

#### [3-1] 🟠 首页对"不执行 JS 的 AI"基本是空壳：62KB HTML → 1609 字节可见文本，其中大半是操作说明

- **级别**：🟠 严重
- **证据**：

```bash
curl -s https://miduo100.com/ | wc -c                                  # 62233
curl -s https://miduo100.com/ | grep -c "<script"                      # 84
# 剥离 script/style/注释/标签后的可见文本（node 实现见下）
node -e "fetch('https://miduo100.com/').then(r=>r.text()).then(h=>{const v=h.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();console.log(Buffer.byteLength(v))})"
```

真实输出：原始 HTML `62233` 字节、`<script>` **84 个**、可见文本仅 **1609 字节**。
可见文本全文的前 200 字（真实抓取）：

```
AI Agent可以走进的 3D 世界-创世虚拟世界CRM系统 HP: 100/100 怪物 👤 🎒 🌐 🌀 世界传送门 🎮 操作指南 📷 第一视角
WASD - 移动 鼠标 - 转向 👤 第三视角 W/S - 前/后 A/D - 左/右 鼠标 - 360°旋转 ⚔️ 战斗 触摸点击 - 攻击怪物
🔧 其他 Space - 跳跃 Shift - 冲刺 C - 切换视角 F - 交互 视角自动回到水平位置 开始游戏
For AI Agents · 让你的 AI 走进这个世界 当前坐标 X:0 Y:0 Z:0 📋 复制 …
```

之后全部是"退出提示 / 个人资料设置 / 背包 / 传送门管理"等**未渲染的弹窗模板文案**。
- **为什么对 AI 是问题**：GPTBot / ClaudeBot / PerplexityBot 不执行 JS。
  它抓到的正文里，**只有两处**能说明"这是什么"：
  ① `<title>`（"AI Agent可以走进的 3D 世界-创世虚拟世界CRM系统"）② 一行锚文本 `For AI Agents · 让你的 AI 走进这个世界`。
  其余 1600 字节是"HUD 操作说明 + 未渲染弹窗"，对 LLM 是纯噪音（甚至可能被当成"这是个键位说明页"）。
  AI 无法从首页得到"里面有什么世界、AI 进去能干什么、别人怎么评价"这些**可引用依据**。
- **建议改法**（只写建议）：
  ① 在首页 `<body>` 顶部（或 `#canvas` 之后）放一段**静态**（不依赖 JS 渲染）的 AI 可读摘要，例如：
  一个 `<section id="ai-summary">`，3~5 句纯文本 + 指向 `/agents/`、`/llms.txt`、`/.well-known/virtual-world-agent.json` 的链接；
  ② 或更彻底：把首页 HUD 文案从 HTML 里拆出去（由 JS 注入），让"+ 无 JS 的正文"只剩下真的想让爬虫读的内容。
  **不需要动 3D 逻辑**，只动首页 HTML 的静态骨架。

- **✅ 本轮已修复**（按"后台 SEO 配置即唯一文案源"落地，**不新增后台字段**）：
  1. `src/services/seoHtmlInjector.js` 新增 `injectBody()`：把 `seo_title / seo_description / seo_keywords`
     渲染成 `<section id="world-intro">`，作为 **`<body>` 的第一个子元素**注入
     （AI 爬虫不执行 JS、按 DOM 顺序读正文，越靠前越容易被当作正文主体）。
  2. `public/index.html` 预置**同构的兜底区块**，与 head 的兜底策略保持一致：
     模板里存在则整段替换、不存在才追加 —— 两条路（注入成功 / 回退静态文件）都不会出现两份。
  3. 位置：**首屏「🎮 操作指南」弹窗内的最后一个分组**，点「开始游戏」后随弹窗一起消失
     （样式集中在 `public/index.html` 的 `<head>`，注入片段不带内联样式 → 注入版与兜底版天然同构；
     该区块**不得加 `data-i18n`**，否则会被多语言替换覆盖）。
     为什么选这里：这个弹窗本来就首屏可见 —— 对真人只是顺带一眼的介绍，对爬虫却是货真价实的静态正文，
     而且**不是隐藏文本**（初始可见，用户点「开始游戏」才收起，等同于常见的欢迎遮罩）。
     为什么不做成"完全不可见"：`display:none`、或挪到滚不到的页面底部（`body{overflow:hidden}` 是全屏游戏）
     都会让内容对真人不可见 → 被判为隐藏文本（SEO 作弊）。公开可见 + 用户主动关闭，才是两者的交叉点。
     `.well-known` / `llms.txt` / `/agents/` 三个入口链接均已实测 200，且 robots.txt 显式放行 AI 爬虫读取它们
     （这一条对 AI 才是关键：爬虫不"点击"，它读 HTML 里的 `href`，或直接从 robots.txt / 域名约定发现入口）。
     顺带修掉一个**既有的真人可用性 bug**：弹窗位于 `#ui-overlay`（`pointer-events:none`）内部且未覆盖回 `auto`，
     而 `pointer-events` 是**会被继承**的属性 → 弹窗里的按钮与链接全都点不动
     （`close-controls-hint` 的 click 回调其实是死代码）。现只给 `#controls-hint button / a` 开启 `auto`，
     面板空白处保持穿透 —— 点空白仍然等于「开始游戏」，保留原有手感。
  4. 本地起 handler 实测（`node` 直调 `seoHtml.handler` 后自检）：
     正文里的描述**与 head 的 `meta description` 同值**（证明数据源唯一）、关键词自动去重
     （`Three.js` 重复项收敛为 1）、`<title>` 与 `description`/`og:`/`twitter:description` 各恰好 1 个未被破坏、
     注入版与静态兜底版**结构骨架完全一致**、`Cache-Control: no-cache` 未变；无 JS 可见正文 809 → 1026 字符。
  5. ⚠️ **仍需人工补一步（也是本条真正的关键）**：后台「🔍 SEO TDK 配置」里的 `seo_description`
     目前只讲"AI 怎么进来"，**没有一句在讲"世界里有什么"** ——
     这段文案必须由人写（AI 不该替站点编造世界设定）。换成含世界内容的描述即可，
     head 与正文区块会同时更新（10 秒 TTL 内生效，无需改代码）。

---

#### [3-2] 🟢 `/agents/` 才是真正的门面：2450 字节可见文本 + 6 个标题 + JSON-LD + 可直接抄的代码

- **级别**：🟢 良好（值得保持）
- **证据**：

```bash
curl -s https://miduo100.com/agents/ | grep -oE '<h1>[^<]*</h1>|<h2>[^<]*</h2>|<title>[^<]*</title>'
```

真实输出（6 个标题）：`让你的 AI 走进一个真实的 3D 世界`（h1） / `15 秒演示` / `三步接入` / `能力与边界` / `两档接入` / `面向机器`。
页面 7583 字节，可见文本 **2450 字节**，含 `<script type="application/ld+json">`（JSON-LD）、`<link rel="canonical">`、以及可被 AI 直接复制的 `<code>` 片段：

```
$ GET /.well-known/virtual-world-agent.json
$ POST /api/agent/v1/guest/session # 无需任何凭证，返回 30 分钟临时票
$ const HOST = 'https://miduo100.com'; … const ws = new WebSocket(HOST.replace(/^http/, 'ws') + '/ws/agent?token=' + s.token);
```

- **为什么对 AI 是问题**：无问题。这是全站**最适合被引用/被摘要**的一页（无 JS 也能完整读懂）。
- **建议改法**：保持；并让首页的静态摘要直接把这页的价值"导流"过去（见 [3-1] 建议）。

---

### 维度 4：SEO 对爬虫的生效性

---

#### [4-1] 🟢 服务端注入**确认生效**（指纹 + 双数据源逐字一致 + og/twitter 已补齐）

- **级别**：🟢 良好（这是上一轮遗留的高风险项，本轮用三重交叉验证确认已生效）
- **证据**：

```bash
curl -sI "https://miduo100.com/?t=$RANDOM" | grep -i content-type
curl -s "https://miduo100.com/api/config/seo"
curl -s "https://miduo100.com/?t=$RANDOM" | grep -o "<title>[^<]*</title>"
curl -s "https://miduo100.com/?t=$RANDOM" | grep -iE 'og:title|og:description|og:url|og:site_name|twitter:card'
```

真实输出：

| 判据 | 实测 |
|---|---|
| 指纹（Content-Type 大小写） | `text/html; charset=utf-8`（**小写** = 注入生效；走 express.static 是大写 UTF-8） |
| 后台配置 | `seo_title` = `AI Agent可以走进的 3D 世界-创世虚拟世界CRM系统 `（注意末尾有一个空格） |
| 爬虫看到的 title | `AI Agent可以走进的 3D 世界-创世虚拟世界CRM系统`（trim 后逐字一致） |
| description | 与后台配置逐字一致 |
| og/twitter | `og:type` / `og:site_name` / `og:title` / `og:description` / `og:url` + `twitter:card` / `twitter:title` / `twitter:description` **共 8 个**，值与 title/description 同步 |

- **为什么对 AI 是问题**：无问题。AI 摘要质量直接由这几个字段决定，现在三处（HTML title / meta / og）同源同值，不会出现"爬虫看到旧文案"的经典坑。
- **建议改法**：保持。注意后台 `seo_title` 末尾有空格——已被服务端 trim，但建议后台保存时也 trim，避免"人看到的和爬虫拿到的不同"引发误判。

---

#### [4-2] 🟡 description 偏长、keywords 里 `Three.js` 重复、`twitter:card=summary_large_image` 却没有图片、首页缺 canonical

- **级别**：🟡 建议
- **证据**：

```bash
curl -s https://miduo100.com/api/config/seo
curl -s "https://miduo100.com/?t=1" | grep -o '<meta name="keywords"[^>]*>'
curl -s "https://miduo100.com/?t=1" | grep -c 'og:image\|twitter:image'
curl -s "https://miduo100.com/?t=1" | grep -c 'rel="canonical"'
```

真实输出：
- `seo_description` 长度 **140 字**（中文）——搜索引擎与社交卡片通常截断到 78~100 字，后半段"基于Three.js的3D虚拟世界CRM系统，支持虚拟角色、3D建筑、联邦传送等功能"大概看不到；
- `seo_keywords` = `AI Agent,虚拟世界,3D游戏,Three.js,CRM系统,在线游戏,3D世界,MCP,WebSocket,Three.js` —— **`Three.js` 出现两次**；
- `og:image` / `twitter:image` **0 个**，而 `twitter:card` 声明为 `summary_large_image`；
- 首页**没有** `canonical`（`/agents/` 有）。
- **为什么对 AI 是问题**：description 被截断时，AI 摘要会断在句子中间（语义不完整）；重复关键词对 LLM 是噪声信号；
  `summary_large_image` 无图会让分享卡片退化成纯文本（影响"别人转发时的观感"，间接影响被引用的概率）；
  缺 canonical 在多域名/多协议（http 与 https 都能打开本站）时有内容重复风险。
- **建议改法**：description 收敛到 80~100 字并把 AI 接入放在前半句；keywords 去重（保留 1 个 `Three.js`）；
  补 `og:image` / `twitter:image`（一张 1200×630 的 /agents/ 截图即可）；首页补 `rel="canonical"`。

---

### 维度 5：零凭证 AI 接入链路（端到端实测）

---

#### [5-1] 🟢 零凭证全链路跑通：签票 → WS → observe → say → move → chat history，一次都不用注册

- **级别**：🟢 良好（值得保持）
- **证据**（真实执行，脚本见 `scripts/_tmp_audit6_agent_link*.js`，配额消耗已记录在 §5）：

```bash
curl -s -X POST https://miduo100.com/api/agent/v1/guest/session -H "Content-Type: application/json" -d '{}'
```

真实输出（节选）：

```json
{"success":true,"tokenType":"Bearer","tier":"guest-pull","mode":"pull","expiresIn":1800,
 "expiresAt":"2026-09-22T10:20:09.954Z",
 "agent":{"id":"agent:guest:6c1f1075-…","name":"游客AI-00c11b26",
          "scopes":["observe","move","rotate","jump","say","interact"]},
 "tierInfo":{"pushAllowed":false,"observeMaxRadius":30,"maxConnectionsPerIp":1,
             "actionRates":{"observe":[1,2000],"say":[1,5000],"move":[1,2000], …},
             "upgradeHint":"需要实时推流 / 更大观察半径 / 跨世界联邦，请联系管理员申请 API Key 转正"},
 "ticketRemaining":8}
```

随后：`wss://…/ws/agent?token=<jwt>` 连上（`ok:true`）→ 收到 `READY` + `WORLD_SNAPSHOT`；
`PING` → `PONG`（带服务器时间戳 `{t:1790070688854}`）；
`say` → `ACTION_COMPLETED {delivered:true}` 且 `chat/history` 立刻可读回；
`move` → 位置真的变了（observe 的 `self.position` 从 `(0,0,0)` 变成 `(267.6,0,0)`）。
- **为什么对 AI 是问题**：无问题。这是"零凭证进来"最硬的证据：**没有账号、没有 Key、20 行代码**。
- **建议改法**：保持。建议在所有对外素材里直接引用上面这段 JSON 的字段名（AI 会照着读）。

---

#### [5-2] 🟢 错误信息机器可读：全部 JSON + 稳定 code + 可操作的 reason

- **级别**：🟢 良好（值得保持）
- **证据**（逐项实测，原始回执）：

| 场景 | 实测响应 |
|---|---|
| 无凭证 HTTP | `401 {"error":"未授权：缺少 Agent token","code":"AGENT_TOKEN_MISSING"}` |
| 伪造 JWT | `401 {"error":"无效的 Agent token: invalid_token","code":"INVALID_TOKEN"}` |
| 伪造 API Key | `401 {"error":"未授权：API Key 无效","code":"AGENT_KEY_INVALID"}` |
| 游客订阅推流 | `ERROR {code:"GUEST_PUSH_FORBIDDEN","message":"游客 Agent（拉模式）不支持订阅推流；请用 observe/action 主动拉取，或申请 API Key 转正解锁推流"}` |
| 动作限频 | `ACTION_REJECTED {requestId, "reason":"动作过于频繁（say 限 1次/5000ms）", "code":"rate_limited"}` |
| 红线动作 | `ACTION_REJECTED {"reason":"动作 teleport 不在 Agent 权限集中","code":"scope_denied"}` |
| 目标不在附近 | `ACTION_REJECTED {"reason":"目标 449 不在附近","code":"target_not_found"}` |
| observe 限频 | `429 {"error":"观察请求过于频繁（游客拉模式限 1次/2000ms）","retryAfter":1,"code":"GUEST_OBSERVE_RATE_LIMITED"}` |
| 同 IP 第二条连接 | `ERROR {code:"GUEST_IP_CONCURRENCY","message":"游客每 IP 并发上限 1，请先断开已有连接或申请 API Key 转正"}` + `close 1013 "guest ip concurrency limit"` |

- **为什么对 AI 是问题**：无问题。**这是"AI 能不能自己 debug"的核心**——`code` 稳定可分支处理，`reason` 是人类/LLM 都能读的中文，`retryAfter` 明确告诉 AI 该等多久。
- **建议改法**：保持，并把 `retryAfter` 补到 **WS 侧的 `ACTION_REJECTED`** 里（现在 HTTP 429 有、WS 限频回执只在文案里写"限 5000ms"，机器可读字段缺失）。

---

#### [5-3] 🟡 未知动作被报成"权限问题"（`scope_denied`），会误导 AI 去读权限表而不是改拼写

- **级别**：🟡 建议
- **证据**（同一次会话内两条对比）：

```
发送 {action:'fly_to_moon'} → ACTION_REJECTED {"reason":"动作 fly_to_moon 不在 Agent 权限集中","code":"scope_denied"}
发送 {action:'observe'}     → ACTION_REJECTED {"reason":"未知动作: observe","code":"unknown_action"}
```

- **为什么对 AI 是问题**：AI 打错一个动作名（例如把 `walk_to` 写成 `walkTo`）会拿到 `scope_denied`，
  于是一个"拼写错误"被解释成"我没有这个权限"，AI 会自动降级成"那我做别的吧"，而不是修正拼写。
  同一协议里 `observe` 又走了 `unknown_action`，两条路径口径不一致。
- **建议改法**：把"未在 `actions[]` 白名单里的未知动作"统一返回 `unknown_action`，并在 `reason` 里附上可用动作清单（如 `未知动作: walkTo；可用：move/walk_to/follow/rotate/jump/say/interact/stop`）。`scope_denied` 只留给"真实存在但被红线禁止"的动作（teleport/set_position/inventory/profile/shop）。

---

#### [5-4] 🟡 畸形消息只回 `BAD_JSON`，没有人类可读的 message

- **级别**：🟡 建议
- **证据**：

```
ws.send('not-a-json')                → {"type":"ERROR","payload":{"code":"BAD_JSON"}}
发送 {type:'ACTION'}（缺 payload）    → ACTION_REJECTED {"reason":"缺少 action 字段","code":"missing_action"}
```

- **为什么对 AI 是问题**：`missing_action` 有文案、`BAD_JSON` 只有 code。AI 只看到 `BAD_JSON` 时无法知道"是我整体格式坏了还是某一个字段坏了"，排错成本高于同类错误。
- **建议改法**：`BAD_JSON` 补 `message`（如"消息不是合法 JSON，请发送形如 {\"type\":\"ACTION\",\"payload\":{...}} 的文本"）。

---

#### [5-5] 🟠 **AI 的默认出生点距真人出生点 31.2m，恰好超出 30m 的观察半径与气泡半径**

- **级别**：🟠 严重（直接影响"AI 进世界后的第一印象"）
- **证据**（用真人浏览器实测同一时刻的双方坐标）：

```
AI READY.spawn            = {x:0, y:0, z:0}
真人浏览器 window.player   = {x:-26.32, y:11.14, z:12.56}
两者距离                  = 31.22 m   （> 30m 投递半径）

# 此时 AI 的 observe：附近的人 = 0 个；AI 的 say：真人浏览器 .nb-bubble 数量 = 0
# AI 用 walk_to 走到 (-23.32, 15.56) 后（与真人水平距离 4.35m）再 say：
#   真人浏览器 #nearby-bubble-layer 出现 .nb-bubble，文本 = "🤖游客AI-…:[AI-visitor-audit-6] hi human, I walked over to you"
```

- **为什么对 AI 是问题**：AI 进来第一步一定是 `observe` + `say`（这也是它自己的导览建议的顺序）。
  结果是：**它看到"附近没有人"，它说的话"没有任何人听到"，而服务端还回了 `delivered:true`**。
  AI 会据此得出"这个世界是空的、是死的"的结论——对一个"AI 引流"产品，这是最坏的第一印象。
  而且它不报错、不提示，AI 无法自查（`delivered:true` 让 AI 以为成功了）。
- **建议改法**（择一或组合，均属产品决策）：
  ① AI 出生点改到真人出生点附近（或复用真人出生坐标）；
  ② 游客档观察半径从 30m 放宽到 60m（气泡半径同步）；
  ③ 不改逻辑，改文档：在 `/capabilities`、`llms.txt`、MCP 工具说明里明确写
     "**默认出生点与真人相距约 30m 以上，进入后先 `walk_to` 靠近再打招呼**"；
  ④ `say` 的 `ACTION_COMPLETED` 回执里区分 `delivered:true` 与 `heardBy: 0`，让 AI 知道自己没被听到。

---

### 维度 6：Agent 接口与文档的一致性（协议漂移）

---

#### [6-1] 🟠 → ✅ 已修复（2026-09-22）：「动作清单」三处不一致，`llms.txt` 把 `observe` 当成动作，而 WS 上它根本不是动作

- **级别**：🟠 严重（AI 会照着文档发一个必然失败的消息）
- **证据**：

```bash
curl -s https://miduo100.com/llms.txt | sed -n '17p'
curl -s https://miduo100.com/api/agent/v1/capabilities | python -c "import sys,json;print(json.load(sys.stdin)['actions'])"
```

真实输出：

```
llms.txt 第 17 行：
- AI 可做 / Available actions: `observe` `move` `walk_to` `follow` `rotate` `jump` `say` `interact` `stop`   ← 9 项

capabilities.actions（与 openapi 的 x-websocket.actions 一致）：
["move","walk_to","follow","rotate","jump","say","interact","stop"]                                       ← 8 项
```

而实测把 `observe` 当动作发出去：

```
{type:'ACTION', payload:{action:'observe', requestId:'audit2-7'}}
→ ACTION_REJECTED {"reason":"未知动作: observe","code":"unknown_action"}
```

- **为什么对 AI 是问题**：`llms.txt` 是 LLM 索引器的主要输入。它读到"可做动作含 observe"，
  最自然的实现就是复用同一条 ACTION 通道发 `action:'observe'`，然后拿到失败。
  AI 通常不会怀疑文档错，而是认为自己用法不对 → 反复重试或放弃（真实失败成本很高）。
  注：`/agents/` 落地页把 `observe` 列在"AI 可以做"的能力表里是**正确**的（那是能力，不是 WS 动作）；
  问题只在 `llms.txt` 那一行把它混进了 `actions` 列表。
- **建议改法**：把 `llms.txt` 第 17 行改为两行：
  `- AI 可做（WS 动作）/ WS actions: move / walk_to / follow / rotate / jump / say / interact / stop`
  `- AI 可做（HTTP 观察）/ HTTP: GET /api/agent/v1/observe`；
  并在 `scripts/accept_agent_discovery_layer.js` 的"防文档漂移"D6 判据里把"三处动作清单同源"从"包含关系"改成"**逐项相等**"（现在的判据只要求 llms 包含 capabilities 的动作，所以 superset 也能过）。

---

#### [6-2] 🟠 → ✅ 已修复（2026-09-22）：`observe` 响应的协议字段 `world` 恒为 `{id:null, name:null}` —— AI 的主视角里"世界是未知的"

- **级别**：🟠 严重（这是 AI 理解"我在哪"的唯一结构化来源）
- **证据**（3 次 HTTP 调用 + 2 次 MCP 会话，全部一致）：

```bash
# 需要一张游客票（消耗配额），此处给出 MCP 侧的真实渲染结果（同一字段）
```

MCP 客户端 `world_observe` 的真实输出（AI 实际看到的世界第一行）：

```
世界「未知」（id=?）
你是 游客AI-cd8cd1dc（id=agent:guest:…）
你在 (0.0, 0.0, 0.0)，观察半径 30m，朝向 yaw=0.00；档位=guest-pull（拉模式）；推流订阅=无
```

同一会话里，前一步 `world_discover` 明确输出：

```
世界「创世虚拟世界」
- worldId：world_1770800924268_ptbh0p39m
```

HTTP `GET /api/agent/v1/observe` 的响应体（节选，每次都一样）：

```json
{"success":true,"tier":"guest-pull",
 "world":{"id":null,"name":null},          ← 问题在这里
 "self":{"id":"agent:guest:…","position":{"x":0,"y":0,"z":0}},
 "entities":[…],"objects":[…],"portals":[…],"radius":30,"limit":100,"sequence":8}
```

（对照：`GET /api/agent/v1/me` 能返回 `worldId`，`/.well-known/…` 能返回 `world.name`——说明数据源是有的，只是没填进 `observe`。）
- **为什么对 AI 是问题**：`observe` 是 AI 的"眼睛"，它每个循环都会调用一次。
  当 AI 跨世界移动（联邦传送/多世界）或长驻时，它**唯一的结构化世界身份来源就是这里**，而它是空的。
  更糟的是**同一次会话内自相矛盾**：discover 说"创世虚拟世界"，observe 说"未知"——AI 会怀疑自己换了世界，或怀疑接口坏了。
  派生影响：`world` 为空时，AI 无法把观察到的东西归属到某个世界，也就无法在回答用户时说出"我在哪个世界看到了什么"。
- **建议改法**：在 `src/routes/agent/observe.js` 的响应里填上真实 `world{id,name}`（与 well-known 同源，`federationSystem.worldId/worldName` 或 `system_config('world_name')` 已在用）。**改动极小、收益极大。**

---

#### [6-3] 🟡 12 个 openapi path 全部可达（好），但 well-known 广播的两条联邦端点在 openapi 里缺席，且它们对 GET 回 404 而不是 405

- **级别**：🟡 建议
- **证据**：

```bash
curl -s https://miduo100.com/api/agent/v1/openapi.json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('declared paths =',Object.keys(j.paths).length)})"
# 逐 path 探测（含错误动词），真实结果：
#   POST  /guest/session        declared->200 | GET ->401
#   POST  /session              declared->401 | GET ->401
#   GET   /me                   declared->401 | POST->401
#   POST  /session/revoke       declared->401 | GET ->401
#   GET   /observe              declared->401 | POST->401
#   GET   /chat/history         declared->401 | POST->401
#   POST  /action               declared->401 | GET ->401
#   GET   /capabilities         declared->200 | POST->401
#   GET   /openapi.json         declared->200 | POST->401
#   GET   /federation/worlds    declared->401 | POST->401
#   GET   /federation/status    declared->401 | POST->401
#   POST  /federation/teleport/prepare declared->401 | GET ->401
```

```
GET  /api/agent/federation/info            -> 200
POST /api/agent/federation/info            -> 404 {"error":"Not found"}
GET  /api/agent/federation/teleport/accept -> 404 {"error":"Not found"}     ← 应 405
POST /api/agent/federation/teleport/accept -> 400 {"success":false,"error":"缺少 handoffToken","code":"MISSING_HANDOFF_TOKEN"}
```

- **为什么对 AI 是问题**：`/.well-known/…` 与 `/capabilities` 都**明确广播**了
  `federationInfo` 与 `federationTeleportAccept` 两个端点，但 openapi.json 里没有它们。
  AI 探活时用 GET 探 `teleport/accept` 得到 `404`，会判定"端点不存在"——而它其实存在（POST 返回 400 且给出正确 code）。
  另外错误动词普遍返回 `401` 而不是 `405`，AI 容易误判成"我需要鉴权"而不是"我用错方法了"（至少返回体是 JSON，损失有限）。
- **建议改法**：把两条联邦端点补进 openapi（标注 `POST` / `GET`）；对"路径存在但方法不对"返回 `405`（JSON 体，附 `Allow` 头）。

---

#### [6-4] 🟡 MCP 宣称"客户端会自动等够间隔"，实测连续两次 `world_observe` 仍撞 429

- **级别**：🟡 建议
- **证据**（两次独立 MCP 会话，同一现象）：

```
world_observe (default)        → isError=false bytes=1694
world_observe (maxBytes=4000)  → isError=true  bytes=213
TEXT = ❌ 【GUEST_OBSERVE_RATE_LIMITED】观察请求过于频繁（游客拉模式限 1次/2000ms）（接口：/observe） 建议约 1 秒后重试。
stderr: [virtual-world-mcp] tool error: GUEST_OBSERVE_RATE_LIMITED …
```

而 `world_discover` 的输出里写着：

```
- 观察限频：游客 1 次/2 秒 ／ Key 1 次/秒（客户端会自动等够间隔）
```

- **为什么对 AI 是问题**：客户端节流（`httpClient.observe`）按"距上次 observe 恰好 2000ms"等待，
  与服务端硬闸（`checkActionRate`：`list.length >= maxCount`，窗口 2000ms）几乎零余量，
  网络往返/时钟抖动就能踩线。AI 因此会随机拿到一次失败——而 `world_observe` 恰恰是它最常用的工具。
  AI 无法区分"世界不让我看"和"我太快了"（文案虽然说明了，但 AI 已经浪费了一轮）。
- **建议改法**：客户端节流加余量（`interval + 200~300ms`）；服务端可读性不变。**一行改动。**

---

### 维度 7：AI 进来之后能干什么（内容可用性）

---

#### [7-1] 🟢 物体 `description` 覆盖率 99/100，且描述是"AI 直接能用"的话术

- **级别**：🟢 良好（这是"世界描述补全"工程的实际效果验证）
- **证据**（游客在出生点的一次 `observe`，30m 内 100 个物体）：

```
类型分布 = {"geometry_nature":51,"geometry_decoration":23,"geometry_building":16,"geometry_animal":9,"media_image":1}
带 description 的物体 = 99/100
```

真实描述样例：

| name | description |
|---|---|
| `湖泊` | 一片湖泊水面（地形装饰，不可交互） |
| `乡村村落_1778144396568_fence_19` | 一段栅栏（静态装饰，通常有碰撞，不能穿过） |
| `乡村村落_1778144396568_tree_50` | 一棵树（静态植被装饰，可以穿过或绕行，不可交互） |
| `乡村村落_1778144396568_hen_59` | 一只母鸡（静态动物装饰，不会移动，不可交互） |
| `未来塔楼` | 一座未来风格塔楼（建筑，可走近查看外观） |

- **为什么对 AI 是问题**：无问题。描述里同时给了"是什么 + 能不能交互 + 能不能穿过"，正好回答 LLM 需要的信息。
- **建议改法**：保持。这套"类型词 → 描述"的推导明显解决了 90% 的物体（见 [7-2] 的对照）。

---

#### [7-2] 🟡 90/100 物体名是内部代号（`乡村村落_1778144396568_flower_26`）——**设计使然，不属缺陷**

- **级别**：🟡 建议（数据美化；**首版误定为 🟠，已降级**）
- **证据**：

```
名称形如内部代号（含 10 位以上时间戳）的条数 = 90 / 100
样例：乡村村落_1778144396568_flower_26 / village_场景_1770866283752_tree_14 / 长方体 (副本) (副本) (副本)
```

- **为什么对 AI 是问题**：AI 引用/说话时会复述名字（MCP 输出把 name 放在最显眼位置）。
  如果描述缺失（模型级物体目前 **0/706 全部无描述**），AI 就只能读出 `village_1771048315380_fence_20` 这种字符串，
  无法向用户交代"这是什么"。也就是说：**描述覆盖率一旦掉下来，整条体验立刻失效**——这是一条脆弱链路。
  另外"长方体 (副本) (副本) (副本)"这类名字暴露了复制粘贴痕迹，真人/AI 看到都会觉得"这是个测试场"。
- **建议改法**：① 后台批量给几何体/模型起"人类名"（比如显示名与内部名分离，把内部 ID 藏到 `id` 里）；
  ② MCP 输出里把 name 与 description 的呈现顺序改成"描述在前、名字在后（或折叠）"，让 AI 优先复述描述；
  ③ 给"（副本）"类后缀做批量清洗。

---

#### [7-3] 🟡 媒体对象：描述为 `null`（**设计使然**）+ 文件名是**乱码**（这条是真数据问题）

- **级别**：🟡 建议（**首版误定为 🟠，已降级**）
- **拆分说明**：
  - "描述为 `null`" → **设计使然**（后台未人工填写，同 §2.0）；MCP 侧会打印「（无 AI 描述）」，AI 不会被误导；
  - "文件名为乱码 `æ¬¢è¿æ¥å°ä½ çä¸ç_å¼ å¾·å¿.jpg`" → 这是**独立的数据编码问题**（UTF-8 被按 Latin-1/GBK 解读后入库），与"有没有描述"无关，属数据修复。
- **全库实测（2026-09-22 补测，范围比出生点半径大得多）**：`world_objects.name` 疑似乱码共 **12 条**，不止观察到的 1 条 ——
  - `id=493` `media_image`：`æ¬¢è¿æ¥å°ä½ çä¸ç_å¼ å¾·å¿.jpg`（图片）
  - `id=514~523` `uploaded_model`：`æ¡å­.glb` 及其 `(副本)` 系列共 10 条（应为「桌子.glb」）
  - `id=8392` `uploaded_model`：`åå¸æ¨¡å.glb`（应为「城市模型.glb」）
  - 注：这些对象的 `model_path` 都是 ASCII 正常的，**只有显示名乱码** → 只需修 `name` 字段
- **证据**（同一份 observe 原始响应）：

```json
{"id":"…","type":"media_image",
 "name":"æ¬¢è¿æ¥å°ä½ çä¸ç_å¼ å¾·å¿.jpg",
 "description":null,
 "position":{…},"distance":…}
```

- **为什么对 AI 是问题**：这是 AI 在这个世界里遇到的**第一个、也是唯一一个"图片"对象**。
  它无法判断这是图片、海报、还是乱码目录，只能如实告诉用户"这里有一串奇怪的字符"。
  乱码（UTF-8 被按 GBK 解读后再存库）会被 LLM 当成非自然语言，通常直接丢弃 → 该对象对 AI 完全不可用。
  附带结构性问题：**媒体对象的 AI 描述存在浏览器 localStorage，不落库**，所以线上任何 AI 都读不到媒体描述。
- **建议改法**：① 修正该媒体对象名的编码（重新上传或以正确编码回写）；
  ② 把媒体描述从 localStorage 迁到数据库（`world_objects.agent_description` 已有列，媒体对象也可以用）；
  ③ 媒体卡片给一句类型兜底描述（如"一张图片（无 AI 描述）"），避免乱码名被当成正文。

---

#### [7-4] 🟠 默认 `world_observe` 里**一个传送门的名字都看不到**（只有数字 4），预算预留未生效

- **级别**：🟠 严重（传送门是 AI 最有价值的"导览锚点"，却在最常用的默认调用里被静默丢弃）
- **证据①（线上真实输出，MCP 默认 `maxBytes=1900`）**：

```
【附近的物体】100 个（按距离升序）
- [0.3m] 湖泊 (id=449, geometry_building)
  描述：一片湖泊水面（地形装饰，不可交互）
- [1.6m] 长方体 (副本) (副本) (副本) (副本) (id=469, geometry_building)
  描述：一个长方体积木块（程序生成的几何体，静态装饰，不可交互）
- [2.6m] 乡村村落_1778144396568_fence_19 (id=352, geometry_decoration)
  描述：一段栅栏（静态装饰，通常有碰撞，不能穿过）
- [3.8m] 乡村村落_1778144396568_flower_26 (id=359, geometry_nature)
  描述：一簇花（静态植被装饰，不可交互）
- （另有 96 个因输出预算/数量上限未列出，可缩小 radius 或调小 limit 分段观察）

【传送门】4 个
  提示：传送（teleport）是世界服务端的红线，Agent 无法使用传送门。     ← 4 个传送门，0 个名字/距离
```

同一时刻 HTTP `observe` 里这 4 个传送门是 `多模型(13.9m) / 大学开学(26.8m) / 测试(26.9m) / 城市(37.9m)`。

- **证据②（离线复现，用线上实测的真实数据形状喂 `examples/mcp-server/src/format.js`）**：

```
---- maxBytes=1900 bytes=1694 透出的传送门名=[]
【传送门】4 个
  提示：传送（teleport）是世界服务端的红线，Agent 无法使用传送门。

---- maxBytes=2600 bytes=2404 透出的传送门名=[]      ← 加大预算仍然 0 个
---- maxBytes=4000 bytes=3512 透出的传送门名=["多模型","大学开学","测试","城市"]
```

- **为什么对 AI 是问题**：`format.js` 的注释明确写着"预算必须预扣 `firstPortalBytes`，否则会只剩一个空标题"，
  但实现上物体段允许把预算花到"刚好等于预留线"，于是留给传送门的余量可以小于一个传送门行（约 75 字节）。
  实测后果：**在物体最密集的地方（出生点，也就是每个 AI 第一次 observe 的地方），传送门必然 0 条**。
  AI 得到的是一句"【传送门】4 个"——它知道有 4 个，但没有任何名字、距离、描述，
  而这些正是它形成"这个世界怎么逛"认知的唯一素材。相对地，它却看得见 4 棵树和 1 只母鸡。
- **建议改法**：① 预算预扣改为硬预留（物体段最多花到 `maxBytes - reserved - firstPortalBytes`）；
  ② 传送门小节**前置**到物体之前（它只有 4~7 条，价值密度远高于花草）；
  ③ 或按类型聚合物体（"树木×51、栅栏×23、建筑×16…"，见 [7-2] 建议②）把预算释放给传送门。

---

#### [7-5] 🟡 线上残留一个名为「测试」、描述为「测试」的传送门，AI 会把它当真实地标

- **级别**：🟡 建议
- **证据**（HTTP observe 原始响应里的 `portals[]`）：

```json
[{"id":"cbbdbfc5-…","name":"多模型","description":null,"distance":13.9},
 {"id":"82f3459c-…","name":"大学开学","description":null,"distance":26.84},
 {"id":"6291eb02-…","name":"测试","description":"测试","distance":26.88},
 {"id":"125bc2ee-…","name":"城市","description":"这是个大型城市场景","distance":37.89}]
```

- **为什么对 AI 是问题**：AI 读到 `测试 / 测试` 会无法判断这是地标还是垃圾；
  若它转述给用户（"这个世界有一个叫『测试』的传送门"），会直接损害世界的可信度。
  另外 4 个里 **2 个 description 为 null**（`多模型`、`大学开学`）——描述补全任务的前一轮只填了 4/7 个传送门，剩下 3 个仍是空的。
- **建议改法**：删掉/改名「测试」传送门；把剩余 3 个传送门的描述补齐（`多模型`、`大学开学`、`返回中心`）。
  传送门虽然 AI 不能使用，但它是**最好的"世界导览"素材**，值得优先补。

---

#### [7-6] 🟡 真人→AI 方向没有实时感知 —— **设计使然（红线 14）**，仅建议补一句文档

- **级别**：🟡 建议（**首版误定为 🟠，已降级**；"不给游客推流"是刻意设计，不属缺陷）
- **性质澄清**：游客档无推流是**成本控制设计**（防止游客长期占用推流与 `max_agents` 名额），`llms.txt` 也明确写了"纯拉模式（不可订阅推流）"。
  唯一值得改进的是**文档完备性**：协议层（`capabilities` / `llms.txt`）没有明说"要感知真人说话请轮询 `/chat/history`"，
  这句话目前只写在 MCP 工具说明与 MCP guide 资源里。**这是 🟡 的"文档补一句"级别，不是体验缺陷。**
- **证据**（同一会话：真人 WS 观察者与 Agent 各自收消息）：

```
① AI say  → 真人侧收到 CHAT 1 条（sender/characterId/position 齐全）          ✅
② 真人 CHAT（距离 0m）→ Agent 侧收到消息 = []                                ← 一条都没收到，连 ERROR 都没有
②b Agent 用 GET /api/agent/v1/chat/history?limit=3 轮询 → 读到了真人那条话    ✅（延迟发现）
```

- **为什么对 AI 是问题**：AI 说了一句话，真人回了它，而 **AI 完全收不到任何事件**（连"有人在附近说话"都没有信号）。
  一个"能聊天"的 AI 会陷入"我说话了 → 世界没反应 → 我再说一次"的死循环，或者干脆判定世界是死的。
  正确用法（游客档必须轮询 `chat/history`）**只写在 MCP 工具说明和 MCP guide 资源里**，
  `/capabilities`、`/.well-known/…`、`llms.txt` 这三份"协议层"文档**都没有说**——而这三份才是 AI 客户端真正按图施工的依据。
- **建议改法**：① 在 `capabilities.tiers['guest-pull']` 与 `llms.txt` 里加一句
  "拉模式收不到 CHAT 推送；要感知真人说话请轮询 `GET /chat/history`（建议 5~10s 一次）"；
  ② （更彻底、需产品决策）让拉模式也能"捎带"返回自上次 observe 以来的聊天——例如 `observe` 响应里加一个
  `recentChat[]`（近 10 秒的 30m 内聊天），这样 AI 每个 observe 循环就天然能感知对话，无需额外接口。

---

#### [7-7] 🟢 真人侧可见性**全链路实测通过**（AI 真的被真人"看见"和"听见"）

- **级别**：🟢 良好（这是整个 AI 引流产品最核心的一句话，本轮首次以真实浏览器端到端验证）
- **证据**（agent 用游客票连接，真人用无登录浏览器进同一世界）：

| 判据 | 真实输出 |
|---|---|
| 真人浏览器看到 AI 进入 | `gameWorld.players` = 2，含 `{key:"agent:guest:…", name:"🤖游客AI-651ef99f", pos:{x:0,y:1.5,z:0}}` |
| AI 走动时真人实时收到位置 | 4 秒内收到 `POSITION_UPDATE` **39 条**（≈10Hz），带 `animMode:"walk"`、`rotation`、`baseY` |
| AI 走近后说话，真人看到气泡 | `#nearby-bubble-layer` 内 `.nb-bubble` 文本 = `🤖游客AI-d35fb08e:[AI-visitor-audit-6] hi human, I walked over to you` |
| AI 离开时真人收到 | `PLAYER_LEFT {characterId:"agent:guest:…", lastPosition:{x:78,y:0,z:0}}` |
| 真人浏览器 console | 仅 1 条 404（`favicon.ico`），**0 个应用错误** |

- **为什么对 AI 是问题**：无问题。这条链路成立，"AI 走进来被真人看见"就不是宣传语而是事实。
- **建议改法**：保持；建议把这段验证固化成可重跑的验收脚本（`scripts/accept_agent_*` 里目前没有"真人浏览器视角看到 AI 气泡"这一条）。

---

#### [7-8] 🟢 MCP guide 资源（3386 字节）是 AI 目前能拿到的最强导览

- **级别**：🟢 良好（值得保持，并应作为"协议层文档"的样板）
- **证据**（`resources/read virtual-world://guide` 真实返回，节选）：

```
## 当前这个世界
- 世界名：创世虚拟世界
- worldId：world_1770800924268_ptbh0p39m
- 是否开放 AI 接入：是
- 说话气泡范围：30m（只有 30m 内的人能看到你说的话）
…
## 已知场景（参考；以 world_observe 实际返回为准）
- 教室区：教学楼里的教室、课桌、讲台、人物模型（学生/鲁迅等）；
- 红军阵列：20 种红军模型、约 600 个实例，是世界最密集的区域；
- 四类几何场景：乡村村落 / 森林 / 城市 / 太空（树、灌木、花、栅栏、车、路灯、小屋、摩天楼、岩石、水晶、山、母鸡、鸟、塔、飞船、猫）；
- 若干传送门（大学开学、记忆空间、城市、返回中心等）。**AI 不能使用传送门**（服务端红线）。
不同世界内容不同，不要凭这条导览断言某个物体一定存在。
```

- **为什么对 AI 是问题**：无问题。它恰好补上了 `observe` 缺的"宏观导览"（区域、地标、玩法、规矩、档位对比），
  并且明确写了"不要凭名字猜内容"这种**给 LLM 的护栏**。
- **建议改法**：保持；建议把这套"已知场景 + 规矩"的写法同步进 `llms.txt`（LLM 索引器读不到 MCP 资源），
  并补上"AI 可从区域/地标角度描述世界"的示范句，便于搜索引擎 AI 摘要引用。

---

### 维度 8：AI 友好的合规与安全

---

#### [8-1] 🟢 敏感路径全部 404（AI 爬虫撞不到，外部也读不到）

- **级别**：🟢 良好
- **证据**：

```bash
for p in /.env /.git/config /.git/HEAD /backup.zip /db_export.sql /package.json /README.md /logs/ /.well-known/ /docs/; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' https://miduo100.com$p)  $p"
done
```

真实输出：全部 `404`（含 `/.well-known/` 目录列举本身）。
- **为什么对 AI 是问题**：无问题；同时顺带确认没有可直接读取的配置/备份文件。
- **建议改法**：保持。

---

#### [8-2] 🟢 AI 门面文件的缓存策略正确（改了能很快生效，也不会每次回源）

- **级别**：🟢 良好
- **证据**：

```bash
for p in /llms.txt /robots.txt /sitemap.xml /agents/ /.well-known/virtual-world-agent.json; do
  curl -sI https://miduo100.com$p | grep -i "^cache-control\|^content-type"
done
```

真实输出：

```
/llms.txt       → public, max-age=300, no-cache
/robots.txt     → public, max-age=300, no-cache
/sitemap.xml    → public, max-age=300, no-cache
/agents/        → no-cache
/.well-known/virtual-world-agent.json → public, max-age=60, no-cache
```

（对照：`/` 为 `no-cache`，SEO 注入因此立刻对爬虫生效。）
- **为什么对 AI 是问题**：无问题。门面文件"最多 5 分钟"就能改后生效，不会出现"改了 llms.txt 但 AI 还在读旧版"。
- **建议改法**：保持。（`max-age=300` 与 `no-cache` 并存属保守写法，语义上以 revalidate 为准，无副作用。）

---

#### [8-3] 🟠 `/api/world/objects` 免鉴权、784KB/次、无任何限流；配合 robots 的 AI 组语义，成为最容易被抓满的路径

- **级别**：🟠 严重
- **证据**：

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}B %{time_total}s\n" https://miduo100.com/api/world/objects
# 连打 5 次看是否限流
node -e "(async()=>{let c=[];const t=Date.now();for(let i=0;i<5;i++){c.push((await fetch('https://miduo100.com/api/world/objects')).status)}console.log(c,Date.now()-t+'ms')})()"
```

真实输出：

```
200 784558B
对象数 = 1078
连打 5 次状态码 = [200,200,200,200,200]，耗时 502ms
cache-control: no-cache        ← 每次都是完整回源、无缓存
```

- **为什么对 AI 是问题**：这个端点对"AI 引流"毫无价值（1115 行坐标 + 内部 model_path），
  却是全站最贵的一个 GET：**784KB / no-cache / 免鉴权 / 无限流**。
  叠加 [1-2]（AI 爬虫组在 robots 语义下被允许抓 `/api/`），一次全站爬取就能对同一 URL 反复请求。
  同时它也在无意中对外公开了全部世界结构（坐标、模型路径），对真人玩家而言相当于一张"世界全图"。
- **建议改法**：① robots.txt 给 AI 组补 `Disallow: /api/`（同 [1-2]）；
  ② 该端点加限流（如每 IP 每分钟 10 次）或要求登录；
  ③ 至少给它一个短 `Cache-Control`（例如 `public, max-age=30`）并考虑支持分页/单对象查询，避免每次整表序列化。

---

#### [8-4] 🟡 缺 HSTS / CSP / X-Frame-Options / Referrer-Policy，且暴露 `X-Powered-By: Express`

- **级别**：🟡 建议（对 AI 不是功能问题，但影响"这个站靠不靠谱"的技术信号）
- **证据**：

```bash
curl -sI https://miduo100.com/ | grep -iE 'strict-transport-security|content-security-policy|x-frame-options|x-content-type-options|referrer-policy|x-powered-by|server|access-control-allow-origin'
```

真实输出：

```
strict-transport-security = (none)
content-security-policy   = (none)
x-frame-options           = (none)
x-content-type-options    = (none)
referrer-policy           = (none)
server = nginx
x-powered-by = Express
access-control-allow-origin = *
```

- **为什么对 AI 是问题**：AI 本身不受影响。但"站点可信度"往往由这些头构成：
  无 HSTS 意味着 http/https 可混用（本站两者都能打开），这会让 AI/浏览器对"权威 URL"产生歧义（`world.url` 是 https，但从 http 进来也能用）；
  `X-Powered-By: Express` 属不必要的指纹暴露。
- **建议改法**：Nginx 加 `Strict-Transport-Security: max-age=31536000`（并考虑 301 把 http 跳到 https）、
  `X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy: strict-origin-when-cross-origin`；
  Express 关掉 `x-powered-by`。
  ⚠️ CORS `*` **不要动**（联邦系统架构必需，见项目既有结论）。

---

#### [8-5] 🟡 后台与编辑器页公网可直接访问（robots 已 Disallow，但 robots 只是"建议"）

- **级别**：🟡 建议
- **证据**：

```bash
for p in /admin.html /admin_login.html /world_editor.html /unified_editor.html; do
  echo "$(curl -s -o /dev/null -w '%{http_code} %{size_download}B' https://miduo100.com$p)  $p"
done
```

真实输出：

```
200 634660B  /admin.html
200  19575B  /admin_login.html
200 396071B  /world_editor.html
200 395506B  /unified_editor.html
```

- **为什么对 AI 是问题**：AI 爬虫（尤其不遵守 robots 的 Bytespider）会把 1.4MB 的编辑器 HTML 当成正文吃进去，
  LLM 索引里可能出现"这个网站有 3D 编辑器"这类与产品定位不符的摘要，稀释"AI 可接入的 3D 世界"这个主题。
- **建议改法**：给这几个路径加服务端 IP 白名单/登录态校验（返回 302 或 403），而不是只靠 robots。

---

## 3. 三个「AI 自问」（第一人称）

### 3.1 「我是 GPTBot，第一次抓这个站，我能在索引里怎么描述它？」

**我实际能提取到的全部素材**（4 条，逐字来自真实响应）：

1. `<title>`：`AI Agent可以走进的 3D 世界-创世虚拟世界CRM系统`
2. `<meta name="description">`：`一个 AI Agent 是一等公民的 3D 在线世界。任何 AI 仅凭域名即可零凭证进入，拥有身份与 Avatar，在世界里行走说话，并被真人玩家实时看见。Node.js 18+ 二十行代码跑通。基于Three.js的3D虚拟世界CRM系统，支持虚拟角色、3D建筑、联邦传送等功能`（140 字，会被截断）
3. 首页正文里唯一一句像"内容"的话：`For AI Agents · 让你的 AI 走进这个世界`
4. `/agents/` 页（我如果跟着那两个链接走）：`不需要浏览器，不需要前端，不需要 3D 引擎。连上 WebSocket，你的 AI 就开始在这里行走、说话—— 并被真实玩家看见，就像多了一个人。`

**我会写出的索引摘要**：

> 创世虚拟世界（miduo100.com）是一个 3D 在线虚拟世界/CRM 系统，其特点是允许 AI Agent 以一等公民身份接入：任何 AI 只需知道域名即可零凭证领取 30 分钟游客票，通过 WebSocket 获得身份、Avatar、观察与行动能力，并会被真实人类玩家实时看到。基于 Three.js、Express、PostgreSQL、WebSocket 实现。

**我的困惑（会写进摘要或让我不敢下结论的部分）**：
- 首页正文 1609 字节里我没读到任何世界内容（只有键位说明），所以**我无法描述"这个世界里有什么"**（教室？红军？城市？都是我从 `/agents/` 和 llms.txt 推的，首页没证据）；
- `CRM系统` 与 `3D 在线世界/游戏` 并列出现，我不确定它是"游戏"还是"企业管理软件的门面"；
- 我**没有**可引用的第三方评价、用户量、截图（`og:image` 为空），所以我倾向于把它归入"实验性/新上线的项目"而不是"值得推荐的成熟产品"。

### 3.2 「我是 Claude，用户问『有没有能让 AI 进去的虚拟世界』，我在你的 llms.txt 里看到的依据够不够我推荐你？」

**够。** `llms.txt` 是我最理想的输入形态，它给了我可验证的一切：

- **是什么**：`一个可被 AI Agent 直接进入的 3D 在线世界。AI 无需浏览器、无需 3D 引擎，仅凭域名即可获得身份、Avatar、感知与行动能力，并被真实人类玩家实时看见。`
- **怎么进**（可执行三步，含真实端点与 20 行示例代码）；
- **能做什么 / 不能做什么**（动作清单 + 明确红线，且有"为什么"）；
- **门槛与礼貌**（两档对比、限频、每 IP 并发、空闲超时、`say` 要克制，甚至写了"世界里生活着真实玩家"）；
- **联系人**（`888@miduo100.com`）。

这比我见过的绝大多数 MCP/Agent 接入文档更完整——它**直接回答"值不值得推荐"**：门槛为零、有真人、有边界。

**但我必须打两个折扣，它们会影响我推荐的语气**：
1. 动作清单里 `observe` 被列为 actions（[6-1]）。我按它写代码会失败——一旦我在试用时踩到，我会降低对你的可信度评分；
2. `llms.txt` 完全没提"AI 进来后其实是**看不到世界名、也听不见真人说话**的"（[6-2]/[7-6]）。我推荐给用户后，用户试了一句"里面有什么"却发现 AI 答"世界未知"，我会被用户回头质疑。

**推荐措辞**（我会这么说）："有一个叫创世虚拟世界的站，明确为 AI Agent 开放了接入协议，零凭证 20 行代码就能让你的 AI 进去走动说话，真人能看到它——文档写得很规范。属于**可以立刻试用**的那类，但生态还很早期。"

### 3.3 「我是 Perplexity，我会引用你页面上的哪一句原文？」

**我会引用这一句（来自 `/agents/`，也是全站唯一像"主张"的句子）**：

> 「不需要浏览器，不需要前端，不需要 3D 引擎。连上 WebSocket，你的 AI 就开始在这里行走、说话——并被真实玩家看见，就像多了一个人。」

**备选（来自 `/agents/` 的能力表）**：

> 「这个世界的 AI 权限是刻意受限的——因为我们希望 AI 在这里"存在"，而不是"无所不能"。」

**我不会引用首页**：首页在我不执行 JS 的前提下，可引用的只有标题 `AI Agent可以走进的 3D 世界-创世虚拟世界CRM系统`，
以及一行锚文本 `For AI Agents · 让你的 AI 走进这个世界`——太短，不构成"可引用的依据"。
（这也是为什么 [3-1] 值得优先修：**首页是 AI 摘要的主入口，但它现在只提供一句标题**。）

---

## 4. 与基线的差异（v2 新增）

逐项对照提示词 §1.3 的结论：

| # | 基线结论 | 本轮实测 | 判定 |
|---|---|---|---|
| 1 | 9 个 UA 打首页全部 200 | 9 个 UA × **5 条路径**（含门面页）全部 200 | ✅ 仍成立（且验证面更宽） |
| 2 | 门面页对 AI UA 可见 | `/agents/`、`/llms.txt` 对全部 9 个 UA 均 200 | ✅ 仍成立 |
| 3 | 敏感路径全部 404 | `/.env` `/.git/config` `/backup.zip` `/db_export.sql` `/package.json` `/README.md` `/logs/` 仍全部 404 | ✅ 仍成立 |
| 4 | 发现文档协议一致性（world.url vs apiBase 同为 https） | `world.url=https://miduo100.com/`、`apiBase=https://…/api/agent/v1`、`websocket=wss://…/ws/agent`，六个端点全 https | ✅ 仍成立（**第 1 步线上已生效**，已核实） |
| 5 | `actions` 三处一致性（8 个全一致） | capabilities=8 项、openapi `x-websocket.actions`=8 项（二者逐字一致）；**`llms.txt`=9 项（多一个 `observe`）**，且 WS 上 `ACTION observe` → `unknown_action` | ⚠️ **与基线口径不同**：基线"三处一致"未把 `llms.txt` 的 superset 计为不一致。**这是本轮新增发现（[6-1]）**，需要确认以哪份为准（建议以 capabilities 为准） |
| 6 | llms.txt 合规（首行 H1 + blockquote + 72 行） | 复核仍合规（首行 `# 创世虚拟世界 / Genesis Virtual World`，第 3 行起为 blockquote） | ✅ 仍成立 |
| 7 | `/agents/` 落地页：6 个 h1/h2 + JSON-LD + 1582 字节可见文本 | 复核 **6 个标题 + JSON-LD + canonical**；可见文本 **2450 字节** | ✅ 仍成立；🟡 数字变化（1582→2450），推测为测量口径或页面内容增加，**不构成问题** |
| 8 | 首页无 JS 可见文本仅 801 字节 / 85 个 script | 本轮 1609 字节 / 84 个 `<script>` | ⚠️ **未确认已改善**：两轮测量方法不同（基线用 `sed` 剥离，本轮剥离 script+style+注释），字节数翻倍更可能是口径差异；**结论按"仍严重不足"计（[3-1]）** |
| 9 | 首页 title 原为"…3D虚拟世界CRM系统…"，现已改为后台 AI 友好文案，要求复核 | 现 `<title>` = `AI Agent可以走进的 3D 世界-创世虚拟世界CRM系统`（31 字），与后台 `seo_title` 逐字一致 | ✅ 已改善且**确认对爬虫生效**（[4-1]）；🟡 后台值末尾有空格（已 trim） |
| 10 | `og:`/`twitter:` 原为 0 个，现已补齐 7 个 | 实测 **8 个**（og:type/site_name/title/description/url + twitter:card/title/description），值同步 | ✅ 已改善；🟡 但**缺 og:image / twitter:image**（[4-2]） |
| 11 | `teleport/accept` 用 GET 探测返回 404（应 405） | 仍返回 `404 {"error":"Not found"}`（POST 为 400 + `MISSING_HANDOFF_TOKEN`） | 🟠 **问题仍在**（[6-3]）；顺带发现该端点**未进 openapi** |
| 12 | admin/编辑器页均 200（robots 已 Disallow） | 仍 200（admin.html 634KB / world_editor 396KB / unified_editor 395KB） | 🟡 **问题仍在**（[8-5]） |
| 13 | `/api/world/objects` 免鉴权返回全量 1079 个对象 | 仍免鉴权，**1078 个对象 / 784558 字节 / no-cache**，且**连打 5 次无限流** | 🟠 **问题仍在且已量化**（[8-3]） |
| 14 | 物体 description 覆盖率：几何体 100%、模型级 0% | 出生点 30m 内 **99/100 带描述**（几何体 100%）；**唯一的媒体对象 description=null**；30m 内 0 个 uploaded_model（未能验证模型级） | ✅ 几何体结论成立；🟡 **补充发现：媒体对象的描述机制不落库（[7-3]）** |

**新增发现（基线里没有的）**：`observe.world` 恒为空（[6-2]）、默认输出看不到传送门（[7-4]）、AI 出生点距真人 31.2m（[5-5]）、真人→AI 无实时感知且未写入协议文档（[7-6]）、未知动作被误报为权限问题（[5-3]）、MCP 节流踩线撞 429（[6-4]）、robots 的 AI 组缺 Disallow（[1-2]）、媒体名乱码（[7-3]）、残留「测试」传送门（[7-5]）、第二台世界无门面（[1-3]）。

**未能验证的部分（如实说明）**：
- 模型级（`uploaded_model`）物体的 `description` 覆盖率：出生点 30m 内没有已加载的 uploaded_model，本轮**未消耗配额去远处验证**，按基线结论（0/706）记录；
- `chat/history` 的 `since` 参数语义：用 `since=2026-09-01` 与不传参数得到相同条数（所有消息都晚于该时间），**未能证伪也未能证实**；
- 传送门在 `radius` 边界上的归属：实测 `radius=30` 时出现 `distance=30.77`/`32.28` 的物体、`radius=30` 时出现 `37.89m` 的传送门 → 半径按"包围盒相交"或"表面距"判定而非中心距，**属口径差异，未判为缺陷**；
- 3D 场景本身的渲染质量：本轮不做渲染像素审计（不在 AI 访客视角范围内）。

---

## 5. 配额与副作用披露（红线要求）

### 5.0 测试目标环境声明（**本报告全部结论来自线上**）

> 补记（2026-09-22，用户核对"跑的是本地还是线上"后新增）。

| 测试段 | 打的目标 | 说明 |
|---|---|---|
| 发现层 / UA 可见性 / 无 JS 可读性 / SEO 指纹 / 敏感路径 / 缓存头 / 安全头 / openapi 逐 path | **`https://miduo100.com`** | 全部 HTTP 探测，纯线上 |
| 零凭证 Agent 端到端链路（签票 → WS → observe → say → move → 限频/并发闸门） | **`https://miduo100.com`** | `AGENT_TEST_BASE=https://miduo100.com`，共 4 轮 |
| MCP 客户端路径（`world_discover/enter/observe/say/chat_history/leave`） | **`https://miduo100.com`** | `McpStdioClient` 的 env：`AGENT_HOST=https://miduo100.com`、`AGENT_API_KEY=''`，共 2 轮 |
| 真人浏览器可见性（看到 AI、位置更新、气泡、PLAYER_LEFT） | **`https://miduo100.com`** | playwright `channel:'chrome'` headless，`page.goto('https://miduo100.com/')`，共 2 次 |
| 第二台世界（门面页 404） | **`http://<另一台世界>:3002`** | 线上另一台世界，仅 http |
| **本地服务器 `http://localhost:3002`** | **完全未使用** | 全程没有启动过 `node src/server.js`，也没有访问过本地 3002 |
| **本地 PostgreSQL** | **用过 1 次（只读 SELECT，辅助验证）** | 唯一一次本地操作：`SELECT config_key FROM system_config` 查世界身份键名。目的=确认 `getWorldInfo()` 查的 `'147'/'20'/'21'/'22'/'148'` 这套键在真实库里不存在；**它只用于解释线上现象的机制，不构成任何结论来源** |

**为什么这次"本地也测不出来"值得记一笔**：本地库的世界身份键名同样是命名键（`world_id` / `world_name` / `world_url`），
所以 `getWorldInfo()` 在**本地部署下也返回 null** —— 该缺陷不是线上特有，而是本地验收同样覆盖不到（从未有断言检查 `world` 字段）。
线上与本地唯一的区别只是取值不同：

| | 线上（`miduo100.com`） | 本地（`localhost:3002` 库） |
|---|---|---|
| `world_id` | `world_1770800924268_ptbh0p39m` | `550e8400-e29b-41d4-a716-446655440000`（占位 UUID） |
| `world_name` | `创世虚拟世界` | `米多100的3002` |
| `world_url` | `https://miduo100.com/` | `http://localhost:3002` |

> 零配额自证命令（对比一下就知道探测打的是哪台）：
> ```bash
> curl -s https://miduo100.com/api/config/world-settings   # → world_name":"创世虚拟世界" / world_url":"https://miduo100.com/"
> curl -s http://localhost:3002/api/config/world-settings  # → world_name":"米多100的3002" / world_url":"http://localhost:3002"
> ```

**线上 Agent 测试配额消耗**（每 IP 10 张/小时）：

| 用途 | 消耗 |
|---|---|
| openapi 逐 path 探测（含 1 次 POST /guest/session 的等价探测） | 1 张 |
| 第 1 轮：链路 + observe 内容质量 | 1 张 |
| 第 2 轮：回执可读性 + PING + 并发口径 | 1 张 |
| 第 3 轮：observe 参数语义 + 真人 WS 可见性 | 1 张 |
| 第 4 轮：include 过滤 + 双向可感知性 | 1 张 |
| MCP 第 1 轮 + 第 2 轮 | 2 张 |
| 真人浏览器验证 ×2（看见 AI / 走近后气泡） | 2 张 |
| **合计** | **9 张（剩 1 张）** |

- 管理员登录：**0 次**（全程未登录后台，所有数据均来自公开端点）。
- `say` 总次数：**4 条**，文案均带 `[AI-visitor-audit]` 前缀，未刷屏。
- **残留数据（诚实披露）**：这 4 条测试消息已写入线上 `world_chat_log`，会出现在后续 AI 的 `chat/history` 结果里
  （实测 MCP 的 `world_chat_history` 确实读到了它们）。另有 1 条测试用的"真人观察者"记录（`AuditHuman2`）。
  按红线"只读、不改线上内容"**未做删除**；若需清理，可按 `message LIKE '[AI-visitor-audit%'` 与 `senderName='AuditHuman2'` 定向删除。
- 本报告未写入：线上 IP（另一台世界的 IP 已遮蔽）、真实玩家昵称、`.env` 内容。扫描到的敏感路径全部 404，**没有需要单独告知用户的泄漏项**。

---

## 6. Top 3（按投入产出比排序）

> **用户复核后的重排**：经确认，「媒体/模型无描述」「游客无推流」「物体名是内部代号」属设计/待填（§2.0），不再列入。
> 剩下的**真正实现级缺陷只有 2 条**（第 1、2 件），第 3 件是 MCP 通道的展示优化。**不做也不会坏，做了 AI 体验更完整。**

### 🥇 第 1 件：给 `observe` 填上真实的 `world{id,name}`（顺带消除 MCP 的"世界未知"自相矛盾）

- **改什么**：`src/routes/agent/observe.js` 响应里的 `world` 字段（数据源现成：`federationSystem.worldId/worldName` 或 `system_config('world_name')`）。
- **大概多大工作量**：**1 行赋值 + 1 次回归**（后端改动，无前端影响）。建议顺手在 `capabilities`/`llms.txt` 的响应示例里固定这个字段。
- **改完后**：AI 的主视角第一行从 `世界「未知」（id=?）` 变成 `世界「创世虚拟世界」（id=world_1770800924268_ptbh0p39m）`；
  维度 6 文档一致性 **3 → 4**，维度 7 内容可用性 **3 → 4**（合计 34 → **36**）。

### 🥈 第 2 件：robots.txt 给 AI 组补 Disallow（顺便给 `/api/world/objects` 加限流/缓存）

- **改什么**：
  ① `public/robots.txt`：把 `*` 组的 `Disallow:` 逐条复制到每个 AI User-agent 组（GPTBot/ClaudeBot/PerplexityBot/Bytespider/OAI-SearchBot…），或改成通用 Disallow + AI 组只 Allow 门面路径；
  ② `/api/world/objects` 加限流（每 IP 每分钟 10 次）或要求登录，并给一个短 `Cache-Control`。
- **大概多大工作量**：robots.txt **改文本，0 代码**；限流**新增一个中间件挂到单个路由**（半天内）。**不需要重启即可生效**（robots.txt 走静态，5 分钟缓存）。
- **改完后**：AI 爬虫不会再把 784KB 的 API 与 GB 级 `.glb` 当正文抓；维度 8 **3 → 4**（合计 **37**）。
  附带收益：不再对外公开"世界全图"（1115 行坐标 + 模型路径）。

### 🥉 第 3 件：修 MCP `world_observe` 的"第一屏信息保真"（传送门预算 + 首屏空世界指引）

- **改什么**（三小步，都很局部）：
  ① `examples/mcp-server/src/format.js`：把"传送门预算预扣"改成**硬预留**（物体段最多花到 `maxBytes - reserved - firstPortalBytes`），或把传送门小节**前置到物体之前**；
  ② 物体段在物体数过多时**按类型聚合**（`树木×51 / 栅栏×23 / 建筑×16 …`），把预算让给少数高价值对象（传送门、uploaded_model）；
  ③ 文档层：在 `/capabilities`、`llms.txt`、MCP guide 里补一句
     "**默认出生点与真人相距约 30m 以上，进入后先 `world_walk_to` 靠近，再 `world_say`**"（这是 [5-5] 的低成本兜底）。
- **大概多大工作量**：①② 是 MCP 侧纯文本格式化改动（**一个文件、可离线验证**——本轮已给出离线复现脚本）；
  ③ 文档 3 处各 1 行。合计 **1 天内可完成并自验**。
- **改完后**：AI 第一次 `world_observe` 就能看到 `多模型(13.9m) / 大学开学(26.8m) / 测试(26.9m) / 城市(37.9m)` 这些**唯一能构成"世界导览"的锚点**，
  并且知道"我刚进来是看不见人的，要走近"；维度 7 **4 → 4.5**（合计 **38**）。

> 说明：本报告只给建议，**未实施任何改动**。三件事都不触及红线、不需要改 3D 逻辑，且都可以独立回滚。

---

## 附录 A：本轮实测方法（脚本已按临时文件策略清理）

本次体检使用的全部是一次性临时脚本，**已按项目惯例清理**（`scripts/_tmp_audit6_*.js` 与其输出、两张临时截图）。
每条发现的复现命令已内联在 §2 的「证据」里，可直接复制粘贴；这里只给出方法地图，便于将来重做同一份体检：

| 用途 | 方法 |
|---|---|
| openapi 逐 path + 错误动词探测 | `fetch` 解析 `openapi.json` → 对每个 `paths` 用声明动词与"错误动词"各打一次，记录状态码 + `content-type` |
| UA 可见性 / 无 JS 可读性 / SEO 指纹 / 敏感路径 / 缓存头 / 安全头 | `fetch` + 自定义 `User-Agent`；可读性用 `html.replace(/<script[\s\S]*?<\/script>/gi,' ')` 等剥离后取 `Buffer.byteLength` |
| 零凭证 Agent 链路 | 复用 `scripts/agentV2TestKit.js`（`guestTicket` / `openAgentWs` / `openHumanWs` / `msgsOfType`），把 `AGENT_TEST_BASE` 指向线上 |
| MCP 客户端（线上游客档） | 复用 `scripts/mcpTestKit.js` 的 `McpStdioClient`，`env: { AGENT_HOST: 'https://miduo100.com', AGENT_API_KEY: '' }` |
| 真人浏览器可见性 | `playwright`（`channel:'chrome'`）打开线上首页 → 读 `window.gameWorld.players` / `#nearby-bubble-layer .nb-bubble` |
| 传送门预算离线复现 | 直接 `import { formatObserve } from '../examples/mcp-server/src/format.js'`，喂入线上实测形状的 `body`，对比不同 `maxBytes` |

> ⚠️ 复现时请注意配额（每 IP 10 张游客票/小时，见 §1.5）；纯 HTTP 部分不消耗配额，可放心多打。
