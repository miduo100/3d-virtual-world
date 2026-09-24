/**
 * tools.js — 8 个 MCP 工具的定义与实现
 *
 * 工具设计原则（提示词 §3 任务 3）：
 *   1) 返回**结构化人话**，不返回原始 API JSON（几百行会撑爆 AI 上下文）；
 *   2) 每个返回都带"下一步能做什么"，让 AI 自己接着往下走；
 *   3) 返回带身份与档位（agentId / tier / 票时），游客档带 upgradeHint；
 *   4) 错误一律翻译成可读文案（见 errors.js），绝不把裸 403 抛给 AI。
 *
 * 明确不提供：teleport / set_position —— 服务端红线禁止的 scope，MCP 侧绝不包装绕过。
 */

import { z } from 'zod';
import { WorldError } from './errors.js';
import { interpretReceipt } from './worldClient.js';
import { formatObserve, formatChatHistory, statusLine } from './format.js';

const ok = (text) => ({ content: [{ type: 'text', text }] });

function fail(err, log) {
  const text = err instanceof WorldError
    ? '❌ ' + err.toText()
    : '❌ 未预期的错误：' + String((err && err.message) || err);
  if (log) log('tool error:', (err && err.code) || '', (err && err.message) || err);
  return { content: [{ type: 'text', text }], isError: true };
}

/** 统一包一层：把异常翻译成可读文本（M10：不给 AI 裸错误码） */
function wrap(handler, log) {
  return async (args) => {
    try {
      return await handler(args || {});
    } catch (e) {
      return fail(e, log);
    }
  };
}

export function registerTools(mcp, client, deps = {}) {
  const log = deps.log || ((...a) => console.error('[virtual-world-mcp]', ...a));

  // ==================== 1. world_discover ====================
  mcp.registerTool('world_discover', {
    title: '发现世界（第一步，无需任何凭证）',
    description:
      '读取这个虚拟世界的公开发现文档：世界名/ID、是否开放 AI 接入、可用能力（观察半径、限流、可做哪些动作）、'
      + '以及本客户端的接入方式。**第一次使用建议先调这个**，能立刻知道"这个世界能不能进、进去能做什么"。'
      + '不需要 API Key。若返回 agentEnabled=false，说明世界管理员关闭了 AI 接入，后续动作都会失败。',
    inputSchema: {
      refresh: z.boolean().optional().describe('忽略 5 分钟本地缓存，强制重新拉取')
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, wrap(async ({ refresh }) => {
    const doc = await client.discover(Boolean(refresh));
    const ep = client.endpoints;
    const limits = doc.limits || {};
    const lines = [];
    lines.push(`世界「${(doc.world && doc.world.name) || '?'}」`);
    lines.push(`- worldId：${(doc.world && doc.world.id) || '?'}`);
    lines.push(`- 开放 AI 接入：${doc.agentEnabled ? '是' : '否（agent_enabled=false，后续动作会被拒）'}`);
    lines.push(`- 本客户端接入方式：${client.apiKey ? 'Key 档（已配置 AGENT_API_KEY，可推流）' : '游客档（只填了 AGENT_HOST，拉模式）'}`);
    lines.push(`- 实际使用端点（由 AGENT_HOST 推导）：${ep.apiBase} ｜ ${ep.wsUrl}`);
    lines.push(`- 鉴权：${client.apiKey ? 'POST /session（API Key → 15 分钟会话，到期自动换票）' : 'POST /guest/session（公开临时票，30 分钟，不可续期）'}`);
    lines.push('');
    lines.push('能力与限制：');
    lines.push(`- 观察半径：游客 30m ／ Key 200m（当前档位实际可用：${client.apiKey ? '200m' : '30m'}）`);
    lines.push(`- 观察限频：游客 1 次/2 秒 ／ Key ${limits.observeRateLimitPerSecond || 1} 次/秒（客户端会自动等够间隔）`);
    lines.push(`- 动作：${(doc.actions || []).join(' / ')}`);
    lines.push(`- Agent 移动速度上限：${limits.movementSpeed || '?'} m/s`);
    lines.push(`- 玩家边界：±${limits.worldBoundary || 1000}m；说话气泡范围：30m`);
    lines.push(`- 明确禁止（服务端红线，MCP 也不提供）：${((doc.scopes && doc.scopes.forbidden) || []).join(' / ')}`);
    const hint = client.upgradeHint();
    if (hint) lines.push(`- 升级提示：${hint}`);
    if (client.protocolMismatch) {
      lines.push('');
      lines.push('⚠️ 发现文档广播的端点协议与 AGENT_HOST 不一致，本客户端按 AGENT_HOST 的协议访问（否则 https 站点会踩 Mixed Content）。'
        + '这通常意味着世界侧反向代理没有透传 X-Forwarded-Proto。');
    }
    lines.push('');
    lines.push('下一步：调用 world_enter 进入世界（游客档无需任何凭证）。');
    return ok(lines.join('\n'));
  }, log));

  // ==================== 2. world_enter ====================
  mcp.registerTool('world_enter', {
    title: '进入世界（建立身份 + 进入现场）',
    description:
      '进入虚拟世界：领取会话凭证并建立 WebSocket 连接，此后真人玩家能在世界里**看到你**（一个 AI 形象）。'
      + '没有 API Key 也能进（公开游客票，30 分钟，拉模式）；配置了 AGENT_API_KEY 则是 Key 档（可推流、观察半径 200m、自动续期）。'
      + '已有连接时本调用是幂等的（不会重复入场）。被服务端空闲超时踢出后，下一次工具调用会自动重新进入。',
    inputSchema: {},
    annotations: { readOnlyHint: false, openWorldHint: true }
  }, wrap(async () => {
    const r = await client.ensureWs();
    const st = client.status();
    const lines = [];
    lines.push(r.reconnected ? '已重新进入世界（连接曾断开，已自动重连并重新登记 presence）。' : '已进入世界。');
    lines.push(`- 身份：${st.agentName}（agentId=${st.agentId}）`);
    lines.push(`- 档位：${st.mode}${st.pushTier ? `｜推送档 ${st.pushTier}` : ''}`);
    lines.push(`- 订阅：${st.subscribedTopics.length ? st.subscribedTopics.join('/') + `（半径 ${client.subscribedRadius || 30}m）` : '无（拉模式）'}`);
    if (st.spawn) lines.push(`- 出生位置：(${st.spawn.x}, ${st.spawn.y}, ${st.spawn.z})`);
    if (st.tier === 'guest-pull') {
      lines.push(`- 游客票剩余：约 ${Math.round((st.guestSecondsLeft || 0) / 60)} 分钟。票到期后 HTTP 调用会开始报错，'
        + '且**不能自动续期**（换票会变成新身份）——需要重启 MCP server 或配置 AGENT_API_KEY。`);
    } else {
      lines.push(`- 会话剩余：${st.tokenSecondsLeft}s（到期前自动换票，**不会重连**，真人也看不到形象闪烁）`);
    }
    const hint = client.upgradeHint();
    if (hint) lines.push(`- 升级提示：${hint}`);
    client.notes.filter(Boolean).forEach((n) => lines.push(`- 注意：${n}`));
    lines.push('');
    lines.push('下一步：world_observe 看清周围有什么（人 / 物体 / 传送门），再用 world_walk_to 走动、world_say 打招呼。');
    return ok(lines.join('\n'));
  }, log));

  // ==================== 3. world_observe（灵魂工具）====================
  mcp.registerTool('world_observe', {
    title: '观察周围（AI 的眼睛）',
    description:
      '空间雷达：返回你附近真人玩家、世界物体、传送门的**文字描述**（AI 看不到 3D 画面，全靠这个认识世界）。'
      + '物体的 description 是人工填写的语义描述，**完整返回**；没有描述时如实标注「（无 AI 描述）」。'
      + '同时返回「自上次观察以来的事件」（有人跟你说话会出现在这里）。'
      + '游客半径上限 30m、限频 1 次/2 秒；Key 档上限 200m。半径越大返回越多，建议先用 30m，需要看远处再用大半径或分次观察。'
      + '输出默认约 2KB（够看清最近的人与物体，避免撑爆上下文）：物体太多时，远处的会降级成"仅名称"，'
      + '近处的描述**始终完整**。想看更多就缩小 radius 分次观察，或把 maxBytes 调大。'
      + '距离口径：**你自己的 y 是服务端平面估算（0）、不是你被真人看到的高度**（服务端没有地形数据，'
      + '客户端会把你贴到地面上）——所以别用"我和他的 y 差多少"判断楼层；看条目里的距离：'
      + '`distance` 是水平距离（服务端投递聊天/互动也按水平距离判定），`distance3D` 含高度差、对你只是上界。',
    inputSchema: {
      radius: z.number().optional().describe('观察半径（米）。游客上限 30、Key 上限 200；不传则用当前档位上限'),
      include: z.string().optional().describe('按世界对象类型过滤，如 "uploaded_model,geometry_building"；不传返回全部类型'),
      limit: z.number().optional().describe('每类最多返回多少条（服务端上限 500）'),
      maxBytes: z.number().optional().describe('返回文本的字节预算（默认 1900，约 2KB）。调大能看到更多物体的完整描述')
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, wrap(async ({ radius, include, limit, maxBytes }) => {
    const { body, waitedMs } = await client.observe({ radius, include, limit });
    const events = client.takeEvents();
    return ok(formatObserve({ body, client, waitedMs, events, maxBytes }));
  }, log));

  // ==================== 4. world_say ====================
  mcp.registerTool('world_say', {
    title: '在世界里说话（真人可见气泡）',
    description:
      '用当前形象说一句话，**30 米内的真人玩家和 AI Agent 会看到你头顶的聊天气泡**。'
      + '限频：游客 1 条/5 秒（Key 档更宽松），上限 200 字。说话要克制、有礼貌，不要刷屏。'
      + '回执里会告诉你 30m 内**实际有几个连接收到**这句话（recipients）——0 就是没有人听见，'
      + '别以为"说过了就行"；先用 world_observe 看看附近有谁，再决定说不说。'
      + '注意：游客档收不到别人的回复推送，想知道对方有没有回话请用 world_chat_history 拉取。',
    inputSchema: {
      text: z.string().min(1).max(200).describe('说话内容（≤200 字）')
    },
    annotations: { readOnlyHint: false, openWorldHint: true }
  }, wrap(async ({ text }) => {
    const res = await client.action('say', { text });
    const { receiptType, result } = interpretReceipt(res);
    const lines = [];
    const recipients = Number(result.recipients);
    if (Number.isFinite(recipients)) {
      lines.push(`已说出：「${text}」（回执 ${receiptType}；30m 内收到这句话的连接：${recipients} 个）`);
      lines.push(recipients > 0
        ? '有真人/AI 收到了，他们那里会看到你形象头顶的气泡。'
        : '⚠️ 此刻 30m 内**没有任何人听到**（recipients=0）。先用 world_observe 看附近有谁，'
          + '再用 world_walk_to / world_follow 走近了再说，否则这句话只留在了日志里。');
    } else {
      // 旧服务端没有 recipients 字段：退回 delivered 布尔，不假装知道具体人数
      lines.push(`已说出：「${text}」（回执 ${receiptType}，服务端 delivered=${result.delivered !== false}）`);
      lines.push('这句话已广播给 30m 内的玩家与 Agent；真人会看到你形象头顶的气泡。');
    }
    lines.push('');
    lines.push('下一步：想确认有没有人回应，用 world_chat_history 拉最近聊天；想走近某个人用 world_walk_to。');
    return ok(lines.join('\n'));
  }, log));

  // ==================== 5. world_walk_to ====================
  mcp.registerTool('world_walk_to', {
    title: '走到某个坐标（有真实走路动画，真人能看到）',
    description:
      '让形象走到世界坐标 (x, z)。服务端按限速推进（默认 9~12 m/s），到达后会返回 reason=arrived。'
      + '这是**唯一**的位移方式：没有传送、不能直接设定坐标（服务端红线）。'
      + '想走到某个玩家/物体旁边，先用 world_observe 拿到它的 position，再把 x/z 传进来。'
      + '限频：游客 1 次/2 秒。开始新移动会打断上一条移动/跟随指令（被中断的指令会收到 reason=superseded）。',
    inputSchema: {
      x: z.number().describe('目标 X 坐标（米）'),
      z: z.number().describe('目标 Z 坐标（米）'),
      timeoutSeconds: z.number().optional().describe('最多等待多少秒（默认按距离自动估算 + 8 秒余量）')
    },
    annotations: { readOnlyHint: false, openWorldHint: true }
  }, wrap(async ({ x, z, timeoutSeconds }) => {
    const res = await client.action('walk_to', { target: { x, z } });
    const { result } = interpretReceipt(res);
    if (result && result.arrived) return ok(`已在目标点附近（(x=${x}, z=${z})）。可直接 world_observe 看周围。`);

    const estimatedMs = Number(result && result.estimatedMs) || 0;
    const waitMs = Math.min(
      timeoutSeconds ? timeoutSeconds * 1000 : estimatedMs + 8000,
      120000
    );
    const done = await res.waitFor(['ACTION_COMPLETED'], Math.max(3000, waitMs));
    const lines = [];
    if (!done) {
      lines.push(`正在走向 (x=${x}, z=${z})，预计还需 ${Math.round(waitMs / 1000)}s 左右（本次等待超时，未收到到达回执）。`);
      lines.push('可以再等一会儿用 world_observe 看 self.position 确认；要中止就发一个新动作（如世界内移动）或 world_leave。');
      return ok(lines.join('\n'));
    }
    const p = done.payload || {};
    if (p.reason === 'arrived') {
      lines.push(`已到达 (x=${x}, z=${z})（estimatedMs=${estimatedMs}）。`);
      lines.push('下一步：world_observe 看看身边有谁/有什么，再决定是打招呼还是继续走。');
    } else {
      lines.push(`移动结束，但没能到达目标：reason=${p.reason || '未知'}（可能是被新指令打断 superseded、被 stop 停住 stopped、目标丢失 target_lost、超时 timeout）。`);
      lines.push('用 world_observe 看一下当前 self.position，再决定下一步。');
    }
    return ok(lines.join('\n'));
  }, log));

  // ==================== 6. world_follow ====================
  mcp.registerTool('world_follow', {
    title: '跟随某个玩家/Agent（按 id）',
    description:
      '让形象持续跟随某个实体（服务端每 0.1 秒追一次，进入 stopDistance 内会停住等对方）。'
      + '**必须传目标 id**（世界对象 id 不行；世界里同名是常态，必须用 id 而不是名字，id 从 world_observe 的"附近的人"里取）。'
      + '这是长时任务：本工具立刻返回，之后用 world_observe 看位置变化。结束方式：发送新的移动指令（world_walk_to，跟随会被打断）或 world_leave。'
      + '限频：游客 1 次/2 秒。',
    inputSchema: {
      targetId: z.string().describe('目标实体 id（world_observe 里 entities[].id）'),
      stopDistance: z.number().optional().describe('跟随到多近就停下（米，默认 2）'),
      maxDurationMs: z.number().optional().describe('最长跟随时长（毫秒，默认 60000）')
    },
    annotations: { readOnlyHint: false, openWorldHint: true }
  }, wrap(async ({ targetId, stopDistance, maxDurationMs }) => {
    const params = { targetId };
    if (stopDistance != null) params.stopDistance = stopDistance;
    if (maxDurationMs != null) params.maxDurationMs = maxDurationMs;
    const res = await client.action('follow', params);
    const { result } = interpretReceipt(res);
    const lines = [];
    lines.push(`已开始跟随 ${result.targetName ? result.targetName + ' ' : ''}(id=${result.targetId || targetId})，`
      + `停止距离 ${result.stopDistance || 2}m，最长 ${Math.round((result.maxDurationMs || 60000) / 1000)}s。`);
    lines.push('跟随是后台任务，本工具已经返回。稍后用 world_observe 看 self.position 变化，就知道有没有跟上。');
    lines.push('结束跟随：world_walk_to 去别处（会打断跟随），或 world_leave 离场。');
    return ok(lines.join('\n'));
  }, log));

  // ==================== 7. world_chat_history ====================
  mcp.registerTool('world_chat_history', {
    title: '读最近聊天记录（理解上下文）',
    description:
      '拉取世界聊天日志里最近的若干条消息（不限于你附近，含真人和 AI Agent 说过的话）。'
      + '用途：①游客档收不到实时推送，用这个知道有没有人回你话；②断线重连后恢复上下文。'
      + '注意这些是历史数据，不是实时推送。',
    inputSchema: {
      limit: z.number().optional().describe('返回条数（默认 20，服务端最多 200）')
    },
    annotations: { readOnlyHint: true, openWorldHint: true }
  }, wrap(async ({ limit }) => {
    const body = await client.chatHistory(limit || 20);
    return ok(formatChatHistory(body, client));
  }, log));

  // ==================== 8. world_leave ====================
  mcp.registerTool('world_leave', {
    title: '离场（形象从世界里消失）',
    description:
      '关闭与世界 WebSocket 连接：你在世界里的形象会消失（其他玩家会看到你离开）。'
      + '离开后如果再次调用其他工具（如 world_observe），会自动重新进入世界（重新登记 presence，位置从上次落库位置恢复）。'
      + '做完一轮参观后建议调用一次，别把形象晾在世界里。',
    inputSchema: {},
    annotations: { readOnlyHint: false, openWorldHint: true }
  }, wrap(async () => {
    const r = await client.leave();
    return ok(r.wasConnected
      ? '已离场：连接已关闭，世界里的形象已消失（其他玩家收到了你离开的通知）。下次调用工具会自动重新进入。'
      : '当前本来就没有入场（连接是断开状态），无需离场。');
  }, log));

  return { count: 8, statusLine };
}
