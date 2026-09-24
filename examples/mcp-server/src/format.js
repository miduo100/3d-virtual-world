/**
 * format.js — 把服务端返回整理成"AI 能直接用"的紧凑文本
 *
 * 为什么必须重排而不是直接返回 API JSON：
 *   ① API JSON 会有几百行（objects+entities+portals+world），直接塞进上下文会撑爆 token；
 *   ② AI 需要的是**世界语义**（谁在附近、这是什么东西、下一步能做什么），不是字段名。
 *
 * 硬性约束（提示词 §2.2 / 验收 M5、M13）：
 *   - `description` 必须**完整**透出（这是 AI 理解世界的唯一依据，不得省略、不得摘要）；
 *   - description 为 null 时如实写「（无 AI 描述）」，**绝不用 name 猜测补全**；
 *   - 整段输出有 **2KB 字节预算**（中文 UTF-8 每字 3 字节，所以按字节算而不是按字符算）：
 *     预算不够时**降级远处物体为"仅名称"**并明确说明，绝不静默截断描述
 *     （M13 要求被测物体的描述必须完整出现 → 近处的优先拿到预算）。
 *     需要更丰富的输出时，工具参数 `maxBytes` 可以调大（默认 1900）。
 */

const DEFAULT_MAX_BYTES = 1900;   // 留 148 字节余量给协议/换行，确保整体 < 2KB（M5）
// 传送门小节的固定开销（小标题 + "红线提示" + "另有 N 个未列出" 计数行），预算必须预扣
const PORTALS_SECTION_BYTES = 320;

const byteLen = (s) => Buffer.byteLength(s, 'utf8');

function fmt(n, digits = 1) {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(digits) : '?';
}

function shortId(id) {
  const s = String(id == null ? '' : id);
  return s.length > 8 ? s.slice(0, 8) + '…' : s;
}

/** 人类可读的时间（只用 HH:MM:SS，避免长 ISO 串浪费预算） */
function clock(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return String(iso || '');
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function animText(animMode) {
  if (!animMode) return '';
  const map = { walk: '正在行走', run: '正在跑', jump: '跳跃中', idle: '站立' };
  return map[animMode] || String(animMode);
}

/**
 * 人的距离显示：始终给水平距离；当空间距离明显更大（≥2m）时补一句"实际空间距离"。
 * 为什么必须补（2026-09-23 AI 访客实访暴露）：服务端没有地形数据，`distance` 是**水平**距离，
 * 于是 AI 看到"4.44m"以为对方就在旁边，实际对方在 9.6m 高的出生台上、两人互相看不见。
 * 只对 entities 补注（≤10 条，预算影响可忽略）；物体/传送门保持纯水平距离，不吃 2KB 预算。
 */
function entDist(e) {
  const d2 = Number(e.distance);
  const d3 = Number(e.distance3D);
  const base = `${fmt(d2)}m`;
  if (!Number.isFinite(d3) || Math.abs(d3 - d2) < 2) return base;
  return `${base}（水平；实际空间距离 ${fmt(d3)}m，注意高度差）`;
}

/**
 * 组织 world_observe 的返回文本
 * @param {object} opts { body, client, waitedMs, events, maxBytes, maxObjects, maxEntities, maxPortals }
 */
export function formatObserve(opts) {
  const { body, client, waitedMs = 0, events = [] } = opts;
  const maxBytes = Math.max(700, Number(opts.maxBytes) || DEFAULT_MAX_BYTES);
  const maxObjects = opts.maxObjects || 15;
  const maxEntities = opts.maxEntities || 10;
  const maxPortals = opts.maxPortals || 5;

  const st = client.status();
  const world = body.world || {};
  const self = body.self || {};
  const pos = self.position || {};
  const yaw = self.rotation && Number.isFinite(self.rotation.yaw) ? self.rotation.yaw : null;

  // 先把两段"必然要写"的内容（事件 / 注意事项+下一步）算出来：它们与正文无关，
  // 于是物体段能拿到**精确**的剩余预算（早期版本用固定 reserve 估算，实测会超出 2KB）。
  const mid = [];
  mid.push('');
  if (events.length === 0) {
    mid.push('【自上次观察以来的事件】无');
    if (client.isGuest()) mid.push('  （游客档收不到推送；真人聊天请用 world_chat_history 拉取）');
  } else {
    mid.push(`【自上次观察以来的事件】${events.length} 条`);
    events.slice(-12).forEach((e) => {
      if (e.type === 'CHAT') {
        mid.push(`- [${clock(e.at)}] 💬 ${e.data.from} (id=${e.data.senderId || '?'})：「${e.data.text}」`);
      } else if (e.type === 'ENTITY_ADDED') {
        mid.push(`- [${clock(e.at)}] ${e.data.name || e.data.id} 进入你的视野`);
      } else if (e.type === 'ENTITY_REMOVED') {
        mid.push(`- [${clock(e.at)}] ${e.data.id} 离开视野`);
      } else {
        mid.push(`- [${clock(e.at)}] 服务端提示 ${e.data.code || ''} ${e.data.message || ''}`.trim());
      }
    });
  }

  const trail = [];
  const notes = client.notes.filter(Boolean);
  if (notes.length) {
    trail.push('');
    trail.push('【注意】');
    notes.forEach((n) => trail.push('- ' + n));
  }
  trail.push('');
  trail.push('【下一步】world_walk_to 走近 / world_say 打招呼（30m 内可见气泡）/ '
    + 'world_follow 按 id 跟随玩家 / world_chat_history 看聊天 / world_leave 离场');

  const out = [];
  const push = (line) => out.push(line);
  // 预算 = 上限 − 尾部两段（事件/注意/下一步）− 传送门小节固定开销 − **最近的那个传送门** − 已写正文。
  // （传送门小节排在物体之后；不预扣它就会在物体吃满预算时只剩一个空标题，观感像是"漏了"）
  const portals = body.portals || [];
  const firstPortalBytes = portals.length ? (() => {
    const p0 = portals[0];
    return byteLen(`- [${fmt(p0.distance)}m] ${p0.name} (id=${shortId(p0.id)})`)
      + byteLen(`  描述：${p0.description || '（无描述）'}`) + 2;
  })() : 0;
  const reserved = byteLen(mid.join('\n')) + byteLen(trail.join('\n'))
    + PORTALS_SECTION_BYTES + firstPortalBytes + 4;
  const budget = () => maxBytes - reserved - byteLen(out.join('\n'));

  // ---------------- 头部（第 3 行刻意保持 `你在 (x, y, z)` 这一可解析锚点）----------------
  push(`世界「${world.name || '未知'}」（id=${world.id || '?'}）`);
  push(`你是 ${st.agentName || '?'}（id=${st.agentId || '?'}）`);
  push(`你在 (${fmt(pos.x)}, ${fmt(pos.y)}, ${fmt(pos.z)})，观察半径 ${body.radius}m`
    + (yaw == null ? '' : `，朝向 yaw=${fmt(yaw, 2)}`)
    + `；档位=${st.mode}；推流订阅=${st.subscribedTopics.length ? st.subscribedTopics.join('/') : '无'}`
    + (waitedMs > 0 ? `；限频等待 ${fmt(waitedMs / 1000)}s` : '')
    // 2026-09-23：服务端没有地形数据，**你的 y 是平面估算（0）**，而真人的 y 是客户端按地形
    // 算出来的真实高度 —— 两者不能直接相减去判断"隔了几层"。判断同层请看"附近的人"里的距离。
    + '；你的 y 为服务端平面估算（非渲染高度）');

  // ---------------- 附近的人 ----------------
  const entities = (body.entities || []).filter((e) => !e.isSelf);
  push('');
  push(`【附近的人】${entities.length} 个（${entities.length > maxEntities ? `仅列最近 ${maxEntities} 个` : '按距离升序'}）`);
  if (entities.length === 0) {
    push('- （你附近没有其他玩家/Agent；可以用 world_walk_to 去别处看看）');
  }
  entities.slice(0, maxEntities).forEach((e) => {
    const info = [];
    info.push(entDist(e));
    if (e.animMode) info.push(animText(e.animMode));
    if (e.type) info.push(e.type === 'agent' ? 'AI Agent' : '真人玩家');
    push(`- ${e.name} (id=${e.id}) ${info.join('，')}`);
  });
  if (entities.length > maxEntities) push(`- （另有 ${entities.length - maxEntities} 个未列出）`);

  // ---------------- 附近的物体 ----------------
  const objects = body.objects || [];
  push('');
  push(`【附近的物体】${objects.length} 个（按距离升序）`);
  let shownObjects = 0;
  let skippedObjects = 0;
  let descOmitted = 0;
  for (const o of objects) {
    if (shownObjects >= maxObjects) { skippedObjects += 1; continue; }
    const head = `- [${fmt(o.distance)}m] ${o.name} (id=${shortId(o.id)}, ${o.type})`;
    const desc = o.description
      ? `  描述：${o.description}`
      : '  描述：（无 AI 描述）';
    if (byteLen(head) + byteLen(desc) + 2 <= budget()) {
      push(head);
      push(desc);
    } else if (byteLen(head) + 1 <= budget()) {
      push(head);
      push('  描述：（因输出预算省略，缩小 radius 单独观察即可看到）');
      descOmitted += 1;
    } else {
      skippedObjects += 1;      // 预算耗尽：连名称都放不下，剩下的全部计入"未列出"
      continue;
    }
    shownObjects += 1;
  }
  if (objects.length === 0) push('- （附近没有世界对象）');
  if (skippedObjects > 0) push(`- （另有 ${skippedObjects} 个因输出预算/数量上限未列出，可缩小 radius 或调小 limit 分段观察）`);
  if (descOmitted > 0) push(`- （有 ${descOmitted} 个物体的描述因 2KB 输出预算被省略）`);

  // ---------------- 传送门（portals 已在上面取过一次，预算也已预扣）----------------
  push('');
  push(`【传送门】${portals.length} 个`);
  portals.slice(0, maxPortals).forEach((p) => {
    // 传送门描述同样不得截断（与物体同规矩）：预算不够时整条不放，而不是切一半
    const d = p.description ? p.description : '（无描述）';
    const head = `- [${fmt(p.distance)}m] ${p.name} (id=${shortId(p.id)})`;
    const desc = `  描述：${d}`;
    if (byteLen(head) + byteLen(desc) + 2 <= budget()) {
      push(head);
      push(desc);
    }
  });
  if (portals.length === 0) push('- （附近没有传送门）');
  if (portals.length > maxPortals) push(`- （另有 ${portals.length - maxPortals} 个未列出）`);
  push('  提示：传送（teleport）是世界服务端的红线，Agent 无法使用传送门。');

  // ---------------- 事件缓冲 + 注意事项/下一步（预算已在开头预留）----------------
  mid.forEach(push);
  trail.forEach(push);
  return out.join('\n');
}

/** 组织 world_chat_history 的返回文本 */
export function formatChatHistory(body, client) {
  const list = Array.isArray(body.history) ? body.history.slice().reverse() : [];
  const out = [];
  out.push(`最近聊天记录 ${list.length} 条（时间升序；来自世界聊天日志，不限于你附近）`);
  if (list.length === 0) {
    out.push('（暂无记录：可能这个世界刚重启，或聊天记录功能被管理员关闭）');
  }
  for (const h of list) {
    const who = h.senderName || '?';
    const kind = h.senderType === 'agent' ? 'AI' : '真人';
    out.push(`- [${clock(h.createdAt)}] ${who}(id=${shortId(h.senderId)}, ${kind})：${h.message}`);
  }
  out.push('');
  out.push('说明：senderId 与世界里实体 id 同源（同名是常态，按 id 认人）；'
    + (client.isGuest()
      ? '游客档只能这样主动拉取，收不到实时推送。'
      : '你已订阅 chat，之后真人说话会以事件形式出现在 world_observe 的「自上次观察以来的事件」里。'));
  return out.join('\n');
}

/** 一行状态摘要（各工具返回开头都带上，让 AI 知道"我是谁、还能用多久"） */
export function statusLine(client) {
  const st = client.status();
  const bits = [`档位=${st.mode}`, `连接=${st.connected ? '已入场' : '未入场（下次调用自动进入）'}`];
  if (st.tier === 'guest-pull') {
    if (st.guestSecondsLeft != null) bits.push(`游客票剩余 ${Math.round(st.guestSecondsLeft / 60)} 分钟（不可续期）`);
  } else if (st.tokenSecondsLeft != null) {
    bits.push(`会话剩余 ${st.tokenSecondsLeft}s（到期自动换票，不会重连）`);
  }
  return bits.join('｜');
}

export { DEFAULT_MAX_BYTES, shortId, fmt, byteLen };
