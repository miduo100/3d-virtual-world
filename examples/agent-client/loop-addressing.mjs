/**
 * loop-addressing.mjs —— 寻址推断 + 礼让仲裁（给 ai-chat-loop.mjs 用，2026-09-24）
 *
 * 为什么单独一个文件：真人**不会**在聊天里打 @名字（用户实测反馈），所以"这句话是不是对我说的"
 * 只能靠空间与上下文推断；而附近有多个 AI 时，"谁来回"还需要一个礼让规则。两块逻辑都是纯函数，
 * 单独放便于复用/单测，也让 ai-chat-loop.mjs 保持短小（项目规范：单文件 ≤500 行）。
 *
 * 四个导出：
 *   scoreAddressing(...)   打分：被点名/面朝我/接话/一对一独处/很近/泛问候 → 加分；他在跟别人聊/人多 → 减分
 *   yieldIfOtherAiAnswered(...)  礼让：想开口前先随机错峰，再回头看"这句是不是已被别的 AI 回掉了"
 *   synthEntityFromPosition(...) 观察失败（如 429）时的坐标兜底：用聊天行自带坐标算距离，别把消息静默丢掉
 *   replyTemplate(...)     模板回复（BRAIN_URL 缺省时的"嘴巴"，零成本）
 *
 * 朝向口径与游戏一致（见 public/js/player.js `_faceTarget`）：
 *   yaw = atan2(dx, dz)（dx/dz = 目标 − 自己），即 yaw=0 时模型朝 +Z。
 *   不同 GLB 的角色基准朝向可能差 180°，用 FACING_OFFSET_DEG 校准（默认 0）。
 */

/** 各信号权重（可用 opts.weights 覆盖；负=抑制） */
export const DEFAULT_WEIGHTS = {
  mention: 100,            // 被点名：最硬的信号
  facing: 40,              // 说话人面朝我（且 ≤ faceMaxDist）
  followUp: 40,            // 我 30s 内刚回过他 → 他在接我的话
  alone: 30,               // 附近只有他一个真人、且没有别的 AI（一对一独处：任何话都算对我说）
  close: 20,               // 距离 ≤ closeDist
  greeting: 15,            // 泛问候/疑问（在吗/你好/你是/有人吗…）
  facingOtherHuman: -40,   // 他正对着另一个真人说话 → 别插嘴
  crowded: -20             // 附近人多/AI 多 → 更克制
};

const GREETING_RE = /(在吗|你好|您好|哈喽|有人吗|你是谁|你是|这是什么|请问|帮个忙|hello|hi\b|hey)/i;

function angleDiff(a, b) {
  const d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
}

function dist2D(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot((a.x || 0) - (b.x || 0), (a.z || 0) - (b.z || 0));
}

/** 说话人是否面朝某点（含 FACING_OFFSET_DEG 校准、±tol 容差） */
function faces(speaker, target, tolRad, offsetRad) {
  if (!speaker || !speaker.position || speaker.yaw == null || !target) return false;
  const yaw = Number(speaker.yaw) + offsetRad;
  const bearing = Math.atan2(target.x - speaker.position.x, target.z - speaker.position.z);
  return angleDiff(yaw, bearing) <= tolRad;
}

/**
 * 这句话是不是对我说的？返回 { score, signals, solicited, humans, agents }
 *
 * @param o.text        消息文本
 * @param o.speaker     { id, type, distance, yaw, position }（来自 observe 的实体缓存）
 * @param o.entities    Map<id, { type, distance, yaw, position }>（**不含自己**更好，含了自己会被排除）
 * @param o.selfId      自己的 characterId
 * @param o.selfPos     自己的位置 { x, y, z }（方向判定用）
 * @param o.followUp    布尔：我最近刚回过这个人
 * @param o.opts        { triggerNames, facingToleranceDeg, facingOffsetDeg, faceMaxDist, closeDist, crowdedFrom, weights }
 */
export function scoreAddressing(o) {
  const opts = o.opts || {};
  const w = { ...DEFAULT_WEIGHTS, ...(opts.weights || {}) };
  const tolRad = (Number(opts.facingToleranceDeg) || 60) * Math.PI / 180;
  const offsetRad = (Number(opts.facingOffsetDeg) || 0) * Math.PI / 180;
  const faceMaxDist = Number(opts.faceMaxDist) || 8;
  const closeDist = Number(opts.closeDist) || 3;
  const crowdedFrom = Number(opts.crowdedFrom) || 3;
  const text = String(o.text || '');

  const others = [...(o.entities || new Map()).entries()].filter(([id]) => String(id) !== String(o.selfId));
  const humans = others.filter(([, e]) => e && e.type !== 'agent');
  const agents = others.filter(([, e]) => e && e.type === 'agent');

  const speaker = o.speaker || {};
  const spk = { position: speaker.position, yaw: speaker.yaw };
  const spkDist = Number(speaker.distance);

  const yawRef = spk.yaw == null ? null : Number(spk.yaw) + offsetRad;
  const angTo = (target) => (yawRef == null || !spk.position || !target)
    ? Infinity : angleDiff(yawRef, Math.atan2(target.x - spk.position.x, target.z - spk.position.z));
  const myAng = angTo(o.selfPos);

  const signals = {
    mention: (opts.triggerNames || []).some(n => n && text.includes(n)),
    facing: spkDist <= faceMaxDist && faces(spk, o.selfPos, tolRad, offsetRad),
    followUp: Boolean(o.followUp),
    alone: humans.length === 1 && agents.length === 0,
    close: spkDist <= closeDist,
    greeting: GREETING_RE.test(text),
    // 他正对着**另一个真人**（且在朝向上比我更正）→ 他们在聊，别插嘴。
    // 修正①（2026-09-24）：原来只看"是否落在 ±tol 扇区内"，被误杀——两个 AI 挨着聊、旁边正巧站着
    //   真人米多，也会被判成"他在跟真人说话"（白扣 40 分）。现在比角度：只有"朝他的偏差 < 朝我的
    //   偏差"时才抑制。
    // 修正②（2026-09-24 **生产实测**）：`humans` 里**含说话人自己**，而"真人到自己"的距离恒为 0、
    //   角度恒为 `atan2(0,0)=0` → 只要朝我的偏差 > 0 就恒判 true，白扣 40 分。后果是默认档
    //   （address、阈值 40）下"真人走近但不点名打招呼"只得 25 分 → **AI 装聋**（线上实测 FAIL）。
    //   故必须排除说话人自己。
    facingOtherHuman: humans.some(([id, h]) => String(id) !== String(speaker.id)
      && dist2D(spk.position, h.position) <= faceMaxDist && angTo(h.position) < myAng),
    crowded: (humans.length + agents.length) >= crowdedFrom
  };

  let score = 0;
  for (const [k, on] of Object.entries(signals)) if (on) score += w[k] || 0;
  // "被点名"或"一对一独处"意味着明确对我：这两条之外的推断都算"主动搭话"，受 per-peer 轮次上限约束
  const solicited = signals.mention || signals.facing || signals.followUp || signals.alone;
  return { score, signals, solicited, humans: humans.length, agents: agents.length };
}

/**
 * 礼让仲裁：多 AI 在场时，同一句话只让一个 AI 回（先到先得，纯客户端自律，无需服务器仲裁）。
 *
 * 做法：先随机错峰（避免同时开口）→ 再回头看"这句是否已被别的 AI 回掉" → 回了就让位。
 * 为什么能成立：AI 之间能互相听见（用户要求"AI 也能和 AI 对话"），所以我方开口后其他 AI 也会让位。
 *
 * @param o.minMs / o.maxMs   随机错峰区间
 * @param o.recheckMs         二次确认窗口（>0 时再等一会儿再看一眼，压掉并发误判；没有别的 AI 时传 0）
 * @param o.hasOtherAiAnswered () => Promise<boolean>：这句是否已被别的 AI 回掉（由调用方实现：推送档看
 *        收到的其他 AI 消息，拉取档查 chat/history?since=<本条 id>）
 * @param o.sleep / o.rand    注入便于测试
 * @returns { yielded, waitedMs, reason }
 */
export async function yieldIfOtherAiAnswered(o) {
  const sleep = o.sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
  const rand = o.rand || Math.random;
  const minMs = Number(o.minMs) || 0;
  const maxMs = Math.max(minMs, Number(o.maxMs) || 0);
  const jitter = minMs + Math.floor(rand() * Math.max(1, maxMs - minMs));
  await sleep(jitter);
  if (await o.hasOtherAiAnswered()) return { yielded: true, waitedMs: jitter, reason: 'answered_during_jitter' };
  const recheckMs = Number(o.recheckMs) || 0;
  if (recheckMs > 0) {
    await sleep(recheckMs);
    if (await o.hasOtherAiAnswered()) return { yielded: true, waitedMs: jitter + recheckMs, reason: 'answered_during_recheck' };
  }
  return { yielded: false, waitedMs: jitter + recheckMs, reason: 'win' };
}

/**
 * 观察数据不可用时的坐标兜底（2026-09-24 实跑踩到）。
 *
 * 坑：游客档 observe 限 **1 次/2s**，偶发 429；而"这句是不是在我附近"原本只认 observe 的实体表，
 * 于是 429 一到，消息被判成 `speaker_not_in_view` **静默丢掉** —— 日志还误导人（以为对方走远了）。
 * 而 chat/history 每行自带 `position`，足以算水平距离（与 say 的 30m 投递口径同源）。
 *
 * 兜底数据只用于**距离闸**：yaw 为 null（无法判"是否面朝我"），故寻址打分可能偏低——
 * 保守但不会答非所问；下一次 observe 成功后自动回到正常判定。
 *
 * @returns 实体形状 {name,type,distance,distance3D,yaw,position,at,synthesized} 或 null（真缺坐标）
 */
export function synthEntityFromPosition(msg, selfPos) {
  const p = msg && msg.position;
  if (!p || !selfPos) return null;
  const dx = Number(p.x) - Number(selfPos.x);
  const dz = Number(p.z) - Number(selfPos.z);
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return null;
  return {
    name: msg.senderName,
    type: msg.senderType === 'agent' ? 'agent' : 'human',
    distance: Math.round(Math.sqrt(dx * dx + dz * dz) * 10) / 10,
    distance3D: null,
    yaw: null,
    position: p,
    at: Date.now(),
    synthesized: true
  };
}

/** 模板回复（零成本"嘴巴"；BRAIN_URL 缺省时用）—— 按触发信号给不同口吻，避免所有场合一句"你好" */
export function replyTemplate(msg, verdict) {
  const who = String((msg && msg.senderName) || '').replace(/^🤖/, '') || '朋友';
  if (verdict.trigger === 'mention' || verdict.trigger === 'facing') return `${who}，我在，你说。`;
  if (verdict.trigger === 'followup') return `${who}，我听着呢。`;
  if (verdict.trigger === 'alone') return `${who}，这儿就我们俩，想聊什么都行。`;
  const pool = [`${who}，你好呀。`, `${who}，我在边上。`, `${who}，有什么想聊的？`];
  return pool[Math.floor(Math.random() * pool.length)];
}
