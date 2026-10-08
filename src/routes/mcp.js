/**
 * mcp.js — Remote MCP 端点（Streamable HTTP），挂在 `/mcp`
 *
 * ## 它解决什么问题
 *
 * 官方 MCP Registry 上登记的 `agent-virtual-world` 是 stdio 包，必须由宿主本地 `npx` 拉起。
 * 但一批目录站**只收 Remote (HTTP)** 的 MCP：Smithery 的 Publish 表单必填 `MCP Server URL`，
 * Coze / Dify / 千帆 / 元器 的"插件/组件"也都是 HTTP 形态。
 * 这个端点让"零安装、只填 URL"成为可能：`https://miduo100.com/mcp`。
 *
 * ## 为什么**不用**官方 SDK（决策记录，别改回去）
 *
 * `@modelcontextprotocol/sdk` 会拖进 30+ 个包（hono、@hono/node-server、jose、eventsource、
 * pkce-challenge、zod、ajv、express-rate-limit…）。本项目的部署方式是**直接上传依赖目录**
 * （服务器跑不了 npm install），"传哪些包"因此变成一件容易漏、难排查的事，
 * 而它带来的能力我们**一条都不用**（OAuth / 采样 / 多框架适配）。
 *
 * MCP Streamable HTTP 剥掉包装就是 **JSON-RPC over HTTP + 一个会话头**。本文件只用
 * 项目已有的 `express` 与 Node 自带的 `crypto`/`JSON` 实现，**零新增依赖**。
 *
 * ## 实现要点
 *
 * - `POST /mcp`：收 JSON-RPC（单个或批量），按 `Accept` 回 JSON 或 SSE 帧；
 *   `initialize` 的响应带 `Mcp-Session-Id`，后续请求凭它找到世界会话。
 * - `GET /mcp`：SSE 长连接（只维持，不主动推 —— 我们是拉模式）。
 * - `DELETE /mcp`：客户端主动结束会话。
 * - 业务动作**直调本地服务层**，不自我 HTTP（原因见 `agent/mcp/remoteBridge.js` 头注释）。
 * - 限流维度是**经 nginx 透传的真实访客 IP**，与 stdio 版共用同一套游客准则。
 *
 * ## 红线（与 stdio 版一致）
 *
 * 游客档永不获得推流与 30m 以上观察半径；不提供 teleport / set_position。
 */

const crypto = require('crypto');
const express = require('express');

const bridge = require('../agent/mcp/remoteBridge');
const clientIp = require('../middleware/clientIp');
const logger = require('../services/logger');

const SERVER_NAME = 'agent-virtual-world';
const SERVER_VERSION = '0.1.2';            // 与 npm 包 / 官方 Registry 登记版本一致
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_CAPABILITIES = {
  tools: { listChanged: false },
  resources: { listChanged: false, subscribe: false },
  prompts: { listChanged: false }
};

const router = express.Router();

/**
 * /mcp 专属的宽容 body 解析（只影响本路由，不动全局配置）。
 *
 * 全局 `express.json()` 只解析 `Content-Type: application/json`，但实测发现：
 *   - 部分 MCP 客户端 / 目录站探测器（Smithery 等）发 POST 时**不带 Content-Type**，
 *     于是 body 不被解析 → req.body 为空 → 我们会误判成 parse error 返回 400。
 * 这里用 `type: () => true` 接受任意 Content-Type，仍然只按 JSON 解析内容。
 */
router.use(express.json({ type: () => true, limit: '1mb' }));

/** Mcp-Session-Id -> { ctxId } */
const transports = new Map();

bridge.startSweeper();

// ==================== 小工具 ====================

const okText = (text) => ({ content: [{ type: 'text', text }] });
const pos = (p) => (p && Number.isFinite(p.x) ? `(${Number(p.x).toFixed(1)}, ${Number(p.z).toFixed(1)})` : '(未知)');

/** 业务异常 → 给 AI 看的人话（绝不把裸堆栈抛出去） */
function errorContent(e) {
  if (e instanceof bridge.BridgeError) {
    return { content: [{ type: 'text', text: '❌ ' + e.message }], isError: true };
  }
  logger.opsError('mcp 工具执行失败', { error: e && e.message });
  return { content: [{ type: 'text', text: '❌ 未预期的错误：' + String((e && e.message) || e) }], isError: true };
}

// ==================== 工具定义（标准 JSON Schema）====================

const objs = (props, required) => ({ type: 'object', properties: props || {}, required: required || [] });

const TOOLS = [
  {
    name: 'world_discover',
    description: '读取这个虚拟世界的公开发现文档：世界名/ID、是否开放 AI 接入、观察半径与限频、可做哪些动作。第一次使用建议先调这个。',
    inputSchema: objs(),
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: 'world_enter',
    description: '确认你在世界里的身份与位置。Remote 档的身份在 initialize 时已建立，本工具是幂等的；被空闲清理后需重新 initialize。',
    inputSchema: objs(),
    annotations: { readOnlyHint: false, openWorldHint: true }
  },
  {
    name: 'world_observe',
    description:
      '空间雷达：返回你附近真人玩家、世界物体、传送门的文字描述（AI 看不到 3D 画面，全靠这个认识世界）。'
      + '物体的 description 是人工填写的语义描述，没有描述时如实标注「（无 AI 描述）」。'
      + '游客半径上限 30m、限频 1 次/2 秒；半径越大返回越多，建议先用 30m。',
    inputSchema: objs({
      radius: { type: 'number', description: '观察半径（米）。游客上限 30；不传用档位上限' },
      include: { type: 'string', description: '按世界对象类型过滤，如 "uploaded_model,geometry_building"' },
      limit: { type: 'number', description: '每类最多返回多少条（服务端上限 500）' }
    }),
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: 'world_say',
    description:
      '用当前形象说一句话，30 米内的真人玩家和 AI Agent 会看到你头顶的聊天气泡。限频：游客 1 条/5 秒，上限 200 字。'
      + '回执会告诉你 30m 内实际有几个连接收到（recipients）——0 就是没人听见，先 world_observe 看看附近有谁再决定说不说。',
    inputSchema: objs({ text: { type: 'string', minLength: 1, maxLength: 200, description: '说话内容（≤200 字）' } }, ['text']),
    annotations: { readOnlyHint: false, openWorldHint: true }
  },
  {
    name: 'world_walk_to',
    description:
      '让形象走到世界坐标 (x, z)。服务端按限速推进（默认 9~12 m/s），到达后返回 arrived。'
      + '这是唯一的位移方式：没有传送、不能直接设定坐标（服务端红线）。'
      + '想走到某个玩家/物体旁边，先用 world_observe 拿它的 position。限频：游客 1 次/2 秒。',
    inputSchema: objs({
      x: { type: 'number', description: '目标 X 坐标（米）' },
      z: { type: 'number', description: '目标 Z 坐标（米）' },
      timeoutSeconds: { type: 'number', description: '最多等待多少秒（默认按距离估算 + 8 秒余量，上限 120 秒）' }
    }, ['x', 'z']),
    annotations: { readOnlyHint: false, openWorldHint: true }
  },
  {
    name: 'world_follow',
    description:
      '让形象持续跟随某个实体（服务端每 0.1 秒追一次）。必须传目标 id（世界对象 id 不行；世界里同名是常态，'
      + 'id 从 world_observe 的「附近的人」里取）。本工具立刻返回，之后用 world_observe 看位置变化。限频：游客 1 次/2 秒。',
    inputSchema: objs({
      targetId: { type: 'string', description: '目标实体 id（world_observe 的 entities[].id）' },
      stopDistance: { type: 'number', description: '跟随到多近就停下（米，默认 2）' },
      maxDurationMs: { type: 'number', description: '最长跟随时长（毫秒，默认 60000）' }
    }, ['targetId']),
    annotations: { readOnlyHint: false, openWorldHint: true }
  },
  {
    name: 'world_chat_history',
    description: '拉取世界聊天日志里最近的若干条消息（含真人和 AI Agent 说过的话）。Remote 档收不到实时推送，用这个知道有没有人回你话。',
    inputSchema: objs({ limit: { type: 'number', description: '返回条数（默认 20，服务端最多 200）' } }),
    annotations: { readOnlyHint: true, openWorldHint: true }
  },
  {
    name: 'world_leave',
    description: '结束本次会话：你在世界里的形象会消失（其他玩家会看到你离开），并释放本 IP 的并发名额。离场后需重新 initialize 才能再进。',
    inputSchema: objs(),
    annotations: { readOnlyHint: false, openWorldHint: true }
  }
];

// ==================== 资源与提示 ====================

const GUIDE_URI = 'virtual-world://guide';
const GUIDE_TEXT = [
  '这是一个真实的多人 3D 世界，不是模拟环境。',
  '你在里面的身份是一个**可见的**形象：30 米内的真人玩家能看见你、也能跟你说话。',
  '你说的每句话都会以聊天气泡出现在真人头顶，请礼貌、克制、别刷屏。',
  '',
  '推荐节奏：',
  '  1) world_observe        —— 先看清附近有谁、有什么（这是你唯一的"眼睛"）',
  '  2) world_walk_to(x, z)  —— 走近他们（没有传送，只能走）',
  '  3) world_say("...")     —— 打招呼；回执里 recipients=0 表示没人听见',
  '  4) world_chat_history   —— 拉最近聊天，看有没有人回你',
  '  5) world_leave          —— 参观完记得离场，别把形象晾在世界里',
  '',
  '红线（服务端强制，不要尝试绕过）：',
  '  - 没有 teleport / set_position：唯一位移方式是 world_walk_to',
  '  - 游客档观察半径上限 30m、限频 1 次/2 秒；说话 1 条/5 秒',
  '  - 游客永无推流订阅（收不到实时推送，只能主动拉）',
  '  - 会话 30 分钟且不可续期，到期需重新 initialize',
  '',
  'rejected 的 code 含义：rate_limited（太快）、no_position（还没入场）、',
  'target_not_found（id 不对，世界里同名是常态，必须用 id）、too_far（目标超出范围）。'
].join('\n');

const PROMPTS = [
  {
    name: 'world_guided_tour',
    title: '引导参观这个世界',
    description: '按"发现 → 观察 → 走近 → 打招呼 → 汇报"的节奏完成一次参观。',
    text: [
      '请带我做一次完整的参观，按这个顺序：',
      '1. world_discover —— 先告诉我这个世界开放哪些能力；',
      '2. world_observe —— 看清附近有哪些人和物体，逐个念给我听（含描述）；',
      '3. 选一个最近的人，用 world_walk_to 走过去；',
      '4. world_say 打一句招呼（注意回执里的 recipients，0 就是没人听见）；',
      '5. world_chat_history —— 看有没有人回应；',
      '6. 最后用 3 句话总结这次见闻，然后 world_leave 离场。',
      '',
      '注意：走动之间有 2 秒限频，说话 5 秒限频；被限频就等一会儿再试。'
    ].join('\n')
  },
  {
    name: 'world_report',
    title: '生成参观报告',
    description: '把这次参观写成一段给真人看的简短见闻。',
    text: [
      '请根据本会话中 world_observe / world_chat_history 的实际结果，写一段不超过 150 字的见闻，包含：',
      '- 你看到了什么（世界样貌、有代表性的物体）',
      '- 你遇到了谁（真人的名字，如果没有就如实说"没遇到人"）',
      '- 你说过什么、有没有人回应',
      '不要编造没发生过的事。'
    ].join('\n')
  }
];

// ==================== 工具实现 ====================

/** observe 的结构化结果 → 给 AI 看的文本（约 2KB 预算，与 stdio 版同口径） */
function renderObserve(res, ctx) {
  const lines = [];
  lines.push(`世界「${(res.world && res.world.name) || '?'}」（id=${(res.world && res.world.id) || '?'}）`);
  lines.push(`你是 ${ctx.agent.name}（id=${ctx.agent.id}）`);
  lines.push(`你在 ${pos((res.self && res.self.position) || bridge.selfPosition(ctx))}，观察半径 ${res.radius}m；档位=${ctx.tier}`);

  const ents = res.entities || [];
  lines.push('');
  lines.push(`【附近的人】${ents.length} 个（按距离升序）`);
  if (!ents.length) {
    lines.push('- （你附近没有其他玩家/Agent；可以用 world_walk_to 去别处看看）');
  } else {
    ents.slice(0, 20).forEach((e) => {
      const d = Number.isFinite(e.distance) ? `${Number(e.distance).toFixed(1)}m` : '?';
      const kind = e.id === ctx.agent.id ? '你自己' : (e.entityType === 'agent' ? 'AI' : '真人');
      lines.push(`- ${e.name || '?'}（id=${e.id}）距离 ${d}｜${kind}`);
    });
  }

  const objects = res.objects || [];
  lines.push('');
  lines.push(`【附近物体】${objects.length} 个`);
  objects.slice(0, 15).forEach((o) => {
    const d = Number.isFinite(o.distance) ? `${Number(o.distance).toFixed(1)}m` : '?';
    lines.push(`- ${o.name || '?'}（${o.type || '?'}）距离 ${d}：${o.description || '（无 AI 描述）'}`);
  });
  if (objects.length > 15) lines.push(`… 还有 ${objects.length - 15} 个物体，可缩小 radius 分次观察`);

  const portals = res.portals || [];
  if (portals.length) {
    lines.push('');
    lines.push(`【传送门】${portals.length} 个`);
    portals.slice(0, 5).forEach((p) => lines.push(`- ${p.name || '?'} 距离 ${Number(p.distance || 0).toFixed(1)}m`));
  }

  lines.push('');
  lines.push('下一步：world_say 打招呼、world_walk_to 走动、world_follow 跟随某个人。');
  return lines.join('\n');
}

const HANDLERS = {
  async world_discover(args, ctx) {
    const doc = await bridge.discover(ctx);
    return okText([
      `世界「${doc.world.name || '?'}」`,
      `- worldId：${doc.world.id}`,
      `- 开放 AI 接入：${doc.agentEnabled ? '是' : '否'}`,
      '- 本客户端接入方式：Remote 档（HTTP Streamable，无需安装，拉模式）',
      `- 端点：${doc.endpoints.mcp}（本端点）｜${doc.endpoints.api}（REST）`,
      '',
      '能力与限制：',
      `- 观察半径：${doc.limits.observeRadiusMeters}m（游客档上限，红线：不提供 30m 以上）`,
      `- 观察限频：${doc.limits.observeRateLimit}`,
      `- 说话限频：${doc.limits.sayRateLimit}`,
      `- 移动限频：${doc.limits.moveRateLimit}`,
      `- 可做动作：${doc.actions.join(' / ')}`,
      '- 明确禁止（服务端红线，本端点也不提供）：teleport / set_position',
      `- 会话：${doc.session.ttlSeconds / 60} 分钟（不可续期）`,
      '',
      '下一步：world_enter 确认身份，或直接用 world_observe 看周围。'
    ].join('\n'));
  },

  async world_enter(args, ctx) {
    const left = Math.max(0, Math.round((Date.parse(ctx.expiresAt) - Date.now()) / 60000));
    return okText([
      '已进入世界。',
      `- 身份：${ctx.agent.name}（agentId=${ctx.agent.id}）`,
      `- 档位：${ctx.tier}（Remote 档，拉模式，无推流）`,
      `- 出生位置：${pos(ctx.spawn)}`,
      `- 当前实际位置：${pos(bridge.selfPosition(ctx))}`,
      `- 票到期：${ctx.expiresAt}（剩余约 ${left} 分钟，不可续期）`,
      '',
      '下一步：world_observe 看清周围有什么。'
    ].join('\n'));
  },

  async world_observe(args, ctx) {
    const res = await bridge.observe(ctx, { radius: args.radius, include: args.include, limit: args.limit });
    return okText(renderObserve(res, ctx));
  },

  async world_say(args, ctx) {
    const text = String(args.text || '').slice(0, 200);
    const out = await bridge.action(ctx, { action: 'say', text });
    const r = (out && out.result) || {};
    const recipients = Number(r.recipients);
    const lines = [];
    if (Number.isFinite(recipients)) {
      lines.push(`已说出：「${text}」（30m 内收到这句话的连接：${recipients} 个）`);
      lines.push(recipients > 0
        ? '有真人/AI 收到了，他们那里会看到你形象头顶的气泡。'
        : '⚠️ 此刻 30m 内没有任何人听到。先用 world_observe 看附近有谁，走近了再说。');
    } else {
      lines.push(`已说出：「${text}」（服务端回执 delivered=${r.delivered !== false}）`);
    }
    lines.push('');
    lines.push('下一步：用 world_chat_history 拉最近聊天确认有没有人回你。');
    return okText(lines.join('\n'));
  },

  async world_walk_to(args, ctx) {
    const target = { x: Number(args.x), z: Number(args.z) };
    const out = await bridge.action(ctx, { action: 'walk_to', target });
    const r = (out && out.result) || {};
    if (r.arrived) return okText(`已在目标点附近（(x=${target.x}, z=${target.z})）。可直接 world_observe 看周围。`);

    const estMs = Number(r.estimatedMs) || 0;
    const budget = args.timeoutSeconds ? Math.min(Number(args.timeoutSeconds) * 1000, 120000) : estMs + 8000;
    const done = await bridge.waitArrival(ctx, target, budget);
    const lines = [];
    if (done.arrived) {
      lines.push(`已到达 (x=${target.x}, z=${target.z})（estimatedMs=${estMs}）。`);
      lines.push('下一步：world_observe 看看身边有谁/有什么。');
    } else if (done.timedOut) {
      lines.push(`正在走向 (x=${target.x}, z=${target.z})，本次等待超时，当前位置 ${pos(done.position)}。`);
      lines.push('可稍后再调 world_observe 看 self.position 确认；要中止就发新动作或 world_leave。');
    } else {
      const reason = (done.receipt && done.receipt.reason) || '未知';
      lines.push(`移动已结束但未确认到达（reason=${reason}），当前位置 ${pos(done.position)}。`);
    }
    return okText(lines.join('\n'));
  },

  async world_follow(args, ctx) {
    const payload = { action: 'follow', targetId: args.targetId };
    if (args.stopDistance != null) payload.stopDistance = args.stopDistance;
    if (args.maxDurationMs != null) payload.maxDurationMs = args.maxDurationMs;
    const out = await bridge.action(ctx, payload);
    const r = (out && out.result) || {};
    return okText([
      `已开始跟随 ${r.targetName ? r.targetName + ' ' : ''}(id=${r.targetId || args.targetId})，`
        + `停止距离 ${r.stopDistance || 2}m，最长 ${Math.round((r.maxDurationMs || 60000) / 1000)}s。`,
      '跟随是后台任务，本工具已经返回。稍后用 world_observe 看 self.position 变化就知道有没有跟上。',
      '结束跟随：world_walk_to 去别处（会打断跟随），或 world_leave 离场。'
    ].join('\n'));
  },

  async world_chat_history(args, ctx) {
    const rows = await bridge.chatHistory(args.limit);
    const list = Array.isArray(rows) ? rows : (rows && rows.messages) || [];
    if (!list.length) return okText('最近没有任何聊天记录。');
    const lines = list.slice(-40).map((m) => {
      const who = m.senderName || m.agent_name || m.username || m.characterName || '?';
      const txt = m.message || m.text || m.content || '';
      return `- ${who}：${txt}`;
    });
    return okText(`最近 ${list.length} 条聊天：\n` + lines.join('\n'));
  },

  async world_leave(args, ctx) {
    const r = bridge.leave(ctx);
    return okText(r.wasConnected
      ? '已离场：世界里的形象已消失（其他玩家收到了你离开的通知）。如需再次进入请重新 initialize。'
      : '当前本来就没有入场，无需离场。');
  }
};

// ==================== JSON-RPC 分派 ====================

/** 会话上下文（找不到就抛，由上层翻译成 JSON-RPC 错误） */
function sessionCtx(ctxId) {
  const ctx = bridge.getSession(ctxId);
  if (!ctx) {
    throw new bridge.BridgeError('SESSION_EXPIRED',
      '本次会话已结束（游客票 30 分钟且不可续期）。请重新发起 initialize 建立新会话。');
  }
  return ctx;
}

async function handleToolCall(params, ctxId) {
  const name = params && params.name;
  const handler = HANDLERS[name];
  if (!handler) {
    return { content: [{ type: 'text', text: `❌ 未知工具：${name}` }], isError: true };
  }
  try {
    return await handler(params.arguments || {}, sessionCtx(ctxId));
  } catch (e) {
    return errorContent(e);
  }
}

/** 处理单条 JSON-RPC 消息；返回 null 表示"通知，无需响应" */
async function dispatchOne(msg, ctxId) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  const reply = (result) => (isNotification ? null : { jsonrpc: '2.0', id, result });
  const refuse = (code, message) =>
    (isNotification ? null : { jsonrpc: '2.0', id, error: { code, message } });

  switch (method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL_VERSION,
        capabilities: SERVER_CAPABILITIES,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: '这是一个真实的多人 3D 世界。先调 world_discover 了解能力，再用 world_observe 看周围。'
      });

    case 'notifications/initialized':
    case 'notifications/cancelled':
    case 'notifications/roots/list_changed':
      return null;                       // 通知：不响应

    case 'ping':
      return reply({});

    case 'tools/list':
      return reply({ tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations })) });

    case 'tools/call':
      return reply(await handleToolCall(params || {}, ctxId));

    case 'resources/list':
      return reply({
        resources: [{
          uri: GUIDE_URI,
          name: 'world-guide',
          title: '虚拟世界接入指南',
          description: '这个世界是什么、AI 能做什么、红线在哪。进入世界前读一遍。',
          mimeType: 'text/plain'
        }]
      });

    case 'resources/read': {
      const uri = params && params.uri;
      if (uri !== GUIDE_URI) return refuse(-32602, '未知资源：' + uri);
      return reply({ contents: [{ uri: GUIDE_URI, mimeType: 'text/plain', text: GUIDE_TEXT }] });
    }

    case 'prompts/list':
      return reply({
        prompts: PROMPTS.map((p) => ({ name: p.name, title: p.title, description: p.description, arguments: [] }))
      });

    case 'prompts/get': {
      const name = params && params.name;
      const hit = PROMPTS.find((p) => p.name === name);
      if (!hit) return refuse(-32602, '未知提示：' + name);
      return reply({
        description: hit.description,
        messages: [{ role: 'user', content: { type: 'text', text: hit.text } }]
      });
    }

    default:
      return refuse(-32601, '未实现的方法：' + method);
  }
}

// ==================== HTTP 处理 ====================

const isInitRequest = (body) => {
  if (!body || typeof body !== 'object') return false;
  if (Array.isArray(body)) return body.some((b) => b && b.method === 'initialize');
  return body.method === 'initialize';
};

/** 客户端想要 SSE 流吗？ */
function wantsSse(req) {
  const accept = String(req.headers.accept || '');
  return accept.includes('text/event-stream') && !accept.includes('application/json');
}

function sendJsonRpc(req, res, payload, sid) {
  if (sid) res.setHeader('Mcp-Session-Id', sid);
  if (payload === null || payload === undefined) {
    res.status(202).end();               // 纯通知
    return;
  }
  if (wantsSse(req)) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.status(200).write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
    res.end();
    return;
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json(payload);
}

function sendRpcError(res, id, code, message, httpStatus) {
  res.status(httpStatus || 200).json({
    jsonrpc: '2.0',
    id: id === undefined ? null : id,
    error: { code, message }
  });
}

/** POST /mcp —— 主通道 */
router.post('/mcp', async (req, res) => {
  const ip = clientIp.resolveClientIp(req);
  let sid = req.headers['mcp-session-id'];
  const body = req.body;

  if (!body || (typeof body !== 'object')) {
    sendRpcError(res, null, -32700, 'Parse error: 请求体不是合法 JSON');
    return;
  }

  // 已有会话：复用
  if (sid && transports.has(sid)) {
    bridge.touch(transports.get(sid).ctxId);
    const ctxId = transports.get(sid).ctxId;
    try {
      const out = Array.isArray(body)
        ? (await Promise.all(body.map((m) => dispatchOne(m, ctxId)))).filter((x) => x !== null)
        : await dispatchOne(body, ctxId);
      if (Array.isArray(out) && out.length === 0) { sendJsonRpc(req, res, null); return; }
      sendJsonRpc(req, res, out);
    } catch (e) {
      logger.opsError('mcp 请求处理失败', { ip, error: e && e.message });
      sendRpcError(res, null, -32603, 'Internal error: ' + String((e && e.message) || e));
    }
    return;
  }

  if (sid && !transports.has(sid)) {
    sendRpcError(res, null, -32001, 'Session not found（会话已过期或被清理，请重新 initialize）', 404);
    return;
  }

  // 无会话且不是 initialize：拒绝
  if (!isInitRequest(body)) {
    sendRpcError(res, null, -32600, 'Bad Request: 没有 Mcp-Session-Id 时必须先发 initialize', 400);
    return;
  }

  // 新建：先建世界会话（走签票限流 + IP 并发名额），失败直接拒绝
  try {
    const ctx = await bridge.createSession(ip);
    sid = ctx.id;
    transports.set(sid, { ctxId: ctx.id });
    bridge.touch(sid);
    logger.access({ kind: 'mcp', event: 'transport_open', sid, ip });

    const out = await dispatchOne(body, ctx.id);
    sendJsonRpc(req, res, out, sid);
  } catch (e) {
    if (e instanceof bridge.BridgeError) {
      const status = (e.code === 'GUEST_TICKET_RATE_LIMITED' || e.code === 'GUEST_IP_CONCURRENCY'
        || e.code === 'TOO_MANY_SESSIONS') ? 429
        : (e.code === 'AGENT_DISABLED_GLOBALLY' || e.code === 'AGENT_SECRET_MISSING') ? 503 : 400;
      sendRpcError(res, null, -32002, e.message + '（' + e.code + '）', status);
      return;
    }
    logger.opsError('mcp initialize 失败', { ip, error: e && e.message });
    sendRpcError(res, null, -32603, 'Internal error: ' + String((e && e.message) || e), 500);
  }
});

/**
 * GET /mcp
 *
 * 分两种情况：
 *   - **带有效 Mcp-Session-Id**：开 SSE 长连接（只维持，不主动推 —— 我们是拉模式）。
 *   - **没有会话**：返回一份**端点自述**。
 *     浏览器直接访问、以及目录站（Smithery / Glama 等）做可达性探测时会走这里；
 *     若回 JSON-RPC 错误会被误判成"端点无效"，所以这里给 200 + 可读说明。
 */
router.get('/mcp', (req, res) => {
  const sid = req.headers['mcp-session-id'];
  const rec = sid && transports.get(sid);
  if (!rec) {
    res.status(200).json({
      ok: true,
      server: SERVER_NAME,
      version: SERVER_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      transport: 'streamable-http',
      tools: TOOLS.length,
      resources: 1,
      prompts: PROMPTS.length,
      hint: '这是 MCP Streamable HTTP 端点（拉模式 / 游客档）。'
        + '请用 MCP 客户端发起 POST + JSON-RPC 的 initialize；'
        + '会话建立后，后续请求需带 Mcp-Session-Id 头。'
        + '人可读的接入说明：https://miduo100.com/agents/',
      health: '/mcp/health'
    });
    return;
  }
  bridge.touch(rec.ctxId);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Mcp-Session-Id', sid);
  res.status(200).write(': connected\n\n');

  // 心跳，防中间层掐断空闲连接
  const beat = setInterval(() => {
    try { res.write(': ping\n\n'); } catch (e) { /* 连接已断 */ }
  }, 25000);
  if (beat.unref) beat.unref();

  req.on('close', () => { clearInterval(beat); });
});

/** DELETE /mcp —— 客户端主动结束会话 */
router.delete('/mcp', (req, res) => {
  const sid = req.headers['mcp-session-id'];
  const rec = sid && transports.get(sid);
  if (!rec) {
    sendRpcError(res, null, -32001, 'Session not found', 404);
    return;
  }
  bridge.destroySession(rec.ctxId, 'client_delete');
  transports.delete(sid);
  res.status(200).json({ ok: true });
});

/** 只读健康检查：给运维与目录站的可达性探测用 */
router.get('/mcp/health', (req, res) => {
  res.json({
    ok: true,
    server: SERVER_NAME,
    version: SERVER_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    transport: 'streamable-http',
    sessions: bridge.stats(),
    tools: TOOLS.length
  });
});

module.exports = router;
module.exports.transports = transports;
