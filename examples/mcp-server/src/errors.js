/**
 * errors.js — 错误码 → "AI 能读懂、能转告用户"的可读说明
 *
 * 设计原则（验收 M10）：**绝不把裸 403 / SCOPE_DENIED / rate_limited 抛给 AI**。
 * 每条错误都必须回答两件事：①发生了什么 ②下一步该怎么办。
 * AI 会把这些文字直接念给用户听，所以文案要面向"人"，而不是面向开发者。
 */

/** 世界接入统一异常（带 code / hint / retryAfterSec，tools 层直接转成文本） */
export class WorldError extends Error {
  constructor(message, { code = 'WORLD_ERROR', hint = null, retryAfterSec = null, status = null } = {}) {
    super(message);
    this.name = 'WorldError';
    this.code = code;
    this.hint = hint;
    this.retryAfterSec = retryAfterSec;
    this.status = status;
  }

  /** 转成给 AI 的纯文本（保持单行可读，避免污染上下文） */
  toText() {
    const parts = [`【${this.code}】${this.message}`];
    if (this.retryAfterSec) parts.push(`建议约 ${this.retryAfterSec} 秒后重试。`);
    if (this.hint) parts.push(this.hint);
    return parts.join(' ');
  }
}

/** HTTP 错误码 → 人话提示（服务端 code 优先，缺失时按错误文本兜底） */
const HTTP_HINTS = {
  AGENT_DISABLED_GLOBALLY:
    '这个世界当前没有开放 AI Agent 接入（管理员关闭了 agent_enabled）。请联系世界管理员开启，或换一个已开放的世界。',
  AGENT_SECRET_MISSING:
    '世界服务器缺少 AGENT_JWT_SECRET 配置，Agent 接入整体不可用。请联系世界管理员。',
  GUEST_TICKET_RATE_LIMITED:
    '同一个 IP 每小时最多领 10 张游客票（含之前失败/断线重连的尝试）。可以等一会儿再试，或配置 AGENT_API_KEY 走 Key 档（不受签票限流）。',
  GUEST_IP_CONCURRENCY:
    '同一个 IP 同时只允许 1 个游客连接。请先关掉其他游客客户端（或配置 AGENT_API_KEY）。',
  GUEST_OBSERVE_RATE_LIMITED: '游客档观察限频为 1 次 / 2 秒，稍等一下再观察。',
  AGENT_OBSERVE_RATE_LIMITED: '观察限频（默认 1 次 / 秒），稍等一下再观察。',
  TOKEN_EXPIRED:
    'Agent 会话已过期。Key 档会自动换票重试；游客档票不可续期，请重启 MCP server 重新签票。',
  TOKEN_INVALID: '凭据无效（签名或格式不对）。请检查 AGENT_API_KEY 是否复制完整。',
  SESSION_NOT_FOUND: '服务端已找不到这个会话（可能被顶替或已清理）。重新进入世界即可。',
  SESSION_REVOKED: '会话已被吊销。请重新进入世界；若反复出现请联系世界管理员。',
  SESSION_EXPIRED: '会话已过期，请重新进入世界。',
  AGENT_DISABLED: '这个 Agent 已被管理员停用。请联系世界管理员。',
  SCOPE_DENIED:
    '该动作不在 Agent 权限集内。teleport（跨点传送）与 set_position（直接设定坐标）是世界服务端的红线，永远不会开放给 Agent。',
  MAX_AGENTS_REACHED: '世界当前的 Agent 名额已满（max_agents）。稍后重试，或联系世界管理员调整。',
  CHAT_HISTORY_FAILED: '聊天历史查询失败，稍后重试。',
  OBSERVE_FAILED: '观察查询失败，稍后重试。',
  GUEST_PUSH_FORBIDDEN:
    '游客档（拉模式）不支持实时推流：不会收到真人聊天与位置推送，只能用 world_observe / world_chat_history 主动拉取。想实时收到消息请配置 AGENT_API_KEY 转正。'
};

/** 动作被拒（ACTION_REJECTED.payload）→ 人话 */
const ACTION_HINTS = {
  rate_limited: (extra) => `${extra || ''}游客档对每个动作都有独立限频（比如 say 1 条 / 5 秒、移动类 1 次 / 2 秒）。等一两秒再试。`,
  scope_denied: () => HTTP_HINTS.SCOPE_DENIED,
  unknown_action: () => '这个动作服务端不认识。可用的动作见 world_discover 返回的能力清单。',
  missing_targetId: () => 'follow / interact 需要目标实体的 id（不是名字；世界里同名是常态，name 仅供显示）。',
  target_not_found: () => '目标不在附近或已经离开世界。先 world_observe 看一下当前在场的实体 id。',
  too_far: () => '距离太远。先用 world_walk_to 走近，再执行该动作。',
  no_position: () => '服务端暂时取不到你的位置（刚连上时会出现）。稍等一秒重试。',
  empty_message: () => '消息内容为空。',
  invalid_yaw: () => 'yaw 必须是数字（弧度）。',
  internal_error: () => '服务端处理异常，稍后重试；持续失败请把这条错误反馈给世界管理员。',
  missing_action: () => '缺少 action 字段。'
};

/**
 * 构造 HTTP 错误（含 hint）
 * @param {number} status HTTP 状态码
 * @param {object} body   响应体
 * @param {object} ctx    { what, host, tier }
 */
export function httpError(status, body, ctx = {}) {
  const code = (body && (body.code || body.error)) || `HTTP_${status}`;
  const message = (body && (body.error || body.message)) || `HTTP ${status}`;
  const hint = HTTP_HINTS[code] || null;
  const extra = ctx.what ? `（接口：${ctx.what}）` : '';
  return new WorldError(`${message}${extra}`, {
    code: String(code),
    status,
    retryAfterSec: body && body.retryAfter ? Number(body.retryAfter) : null,
    hint
  });
}

/** 构造动作被拒错误（ACTION_REJECTED → 可读文本） */
export function actionError(payload = {}) {
  const code = payload.code || 'REJECTED';
  const reason = payload.reason || '';
  const hintFn = ACTION_HINTS[code];
  const hint = typeof hintFn === 'function' ? hintFn(reason) : null;
  return new WorldError(reason || `动作被拒绝（${code}）`, { code: String(code), hint });
}

/**
 * WS 连接失败 → 可读错误。
 * WHATWG WebSocket 拿不到 upgrade 的 HTTP 状态码，所以客户端会在失败后补一次
 * `GET /me` 探测（probe），用它的结果反推"到底是凭据问题还是网络问题"。
 * @param {string} reason  失败原因（超时 / close code 等）
 * @param {object} probe   { ok, status, code, message } 或 null（探测请求本身失败）
 */
export function upgradeError(reason, probe, ctx = {}) {
  const host = ctx.host || 'AGENT_HOST';
  // 服务端主动 close 携带的业务码（1013 + reason）：直接用人话
  if (reason && /MAX_AGENTS_REACHED|GUEST_IP_CONCURRENCY/.test(reason)) {
    const code = /MAX_AGENTS/.test(reason) ? 'MAX_AGENTS_REACHED' : 'GUEST_IP_CONCURRENCY';
    return new WorldError('无法进入世界：' + reason, { code, hint: HTTP_HINTS[code] });
  }
  if (probe && probe.status === 401) {
    return new WorldError('进入世界的 WebSocket 被拒绝（401 凭据无效）', {
      code: probe.code || 'TOKEN_INVALID',
      hint: '检查 AGENT_API_KEY 是否完整、是否已被重新生成（重发 Key 后旧 Key 立即失效）。'
    });
  }
  if (probe && probe.status === 403) {
    return new WorldError('进入世界的 WebSocket 被拒绝（403 会话无权）', {
      code: probe.code || 'SESSION_FORBIDDEN',
      hint: HTTP_HINTS[probe.code] || '会话已过期/被吊销，重新进入世界即可；游客档请重启 MCP server。'
    });
  }
  if (probe && probe.status === 200) {
    return new WorldError(`连接世界 WebSocket 失败：${reason}`, {
      code: 'WS_UNREACHABLE',
      hint: `凭据是有效的，所以更像是网络/反向代理问题：确认 ${host} 的 /ws/agent 路径已配置 WebSocket upgrade（Nginx 需要 Upgrade/Connection 头）。`
    });
  }
  return new WorldError(`连接世界 WebSocket 失败：${reason}`, {
    code: 'WS_UNREACHABLE',
    hint: `请确认 ${host} 可访问、/ws/agent 路径存在，并且反向代理已透传 WebSocket upgrade。`
  });
}
