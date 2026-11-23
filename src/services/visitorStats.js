/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 访客访问统计服务（2026-11-13）
 *
 * 只做一件事：把「进世界 → 离开」这段有头有尾的时间记下来。
 *   - 入口在 websocket/wsServer.js 的 PLAYER_JOIN
 *   - 出口在同一个文件的 ws.on('close')，由 wsServer 主动调用 endSession
 *
 * 设计取舍（都是踩过或预判的坑）：
 *   1) 停留时长在服务端算，不信任前端上报。关页面、拔网线、杀进程都会
 *      触发 close（心跳 30s×2 判死后 terminate 也会触发），覆盖率高得多。
 *   2) 同一 connectionId 重复 PLAYER_JOIN 必须幂等 —— 前端 wsPresenceGuard
 *      会自动重发 JOIN，不做去重会一个访客记成好几条，平均值直接失真。
 *   3) 刷新页面会断线重连。同 session_key 在 MERGE_WINDOW_MIN 分钟内重连时
 *      续用原会话，否则一次 5 分钟的浏览被切成 3 段各 100 秒，平均值严重偏低。
 *   4) 单会话封顶 MAX_SESSION_SEC。挂机党会把平均值拉到几小时，
 *      sweepStaleSessions 同时负责清理服务重启留下的僵尸 open 会话。
 */
const { query } = require('../database/db');

const MERGE_WINDOW_MIN = 2;        // 同 key 重连合并窗口（分钟），覆盖刷新/断线重连
const MERGE_MAX_AGE_MIN = 30;      // 只续 30 分钟内开始的会话，避免陈旧会话被续成超长
const MAX_SESSION_SEC = 4 * 3600;  // 单会话上限（秒）
const UA_MAX_LEN = 400;
const IP_MAX_LEN = 64;

// connectionId → { id, enteredAt }
// 只存内存：进程重启后未结束的会话由 sweepStaleSessions 兜底清掉
const LIVE = new Map();

function clampStr(v, max) {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * 记录一次「进入世界」
 * @param {object} opt
 * @param {string} opt.connectionId  WS 连接 id（必填，用于幂等）
 * @param {boolean} opt.isGuest
 * @param {string} [opt.characterId] 游客是 guestId；登录用户是角色 UUID
 * @param {string} [opt.ip]
 * @param {string} [opt.ua]
 * @param {string} [opt.worldId]
 */
async function startSession({ connectionId, isGuest, characterId, ip, ua, worldId }) {
  if (!connectionId || !characterId) return null;

  // 幂等：同一连接重复 JOIN（wsPresenceGuard 会重发）只更新心跳
  const live = LIVE.get(connectionId);
  if (live) {
    live.lastSeen = Date.now();
    query('UPDATE visitor_sessions SET last_seen_at = NOW() WHERE id = $1', [live.id])
      .catch(() => {});
    return live.id;
  }

  const visitorType = isGuest ? 'guest' : 'user';

  // 登录用户反查 user_id；角色 id 非法（非 UUID）或查不到时降级为无 user_id，
  // 不能让统计把主流程带崩
  let userId = null;
  if (!isGuest) {
    try {
      const r = await query('SELECT user_id FROM characters WHERE id = $1', [characterId]);
      if (r.rows.length) userId = r.rows[0].user_id;
    } catch (e) {
      // 非法 UUID / 查询失败：忽略
    }
  }

  // 会话 key：游客用 guestId（sessionStorage 内稳定，刷新不变）；
  // 登录用户用 user:<uuid>，换角色不会算成两个访客
  const sessionKey = isGuest
    ? String(characterId)
    : (userId ? `user:${userId}` : `char:${characterId}`);

  try {
    // 刷新/重连合并：同 key、2 分钟内有活动、且会话未太陈旧。
    // 注意不能只找 left_at IS NULL —— 刷新的顺序是「旧连接 close 回填 left_at」
    // 然后「新连接 join」，只合并未结束会话等于永远合不上，一次浏览被切成多段。
    const merged = await query(
      `SELECT id, left_at FROM visitor_sessions
        WHERE session_key = $1
          AND last_seen_at >= NOW() - make_interval(mins => $2::int)
          AND entered_at  >= NOW() - make_interval(mins => $3::int)
        ORDER BY last_seen_at DESC
        LIMIT 1`,
      [clampStr(sessionKey, 128), MERGE_WINDOW_MIN, MERGE_MAX_AGE_MIN]
    );

    if (merged.rows.length) {
      const id = merged.rows[0].id;
      // 已结束的会话被续上：重新打开，时长在下次 close 时按 entered_at 整体重算
      // （duration_sec 置空，避免旧值参与聚合）
      await query(
        `UPDATE visitor_sessions
            SET last_seen_at = NOW(),
                left_at      = NULL,
                duration_sec = NULL,
                end_reason   = 'open'
          WHERE id = $1`,
        [id]
      );
      LIVE.set(connectionId, { id, enteredAt: Date.now(), lastSeen: Date.now() });
      return id;
    }

    const ins = await query(
      `INSERT INTO visitor_sessions
         (visitor_type, session_key, user_id, ip, ua, world_id, end_reason)
       VALUES ($1, $2, $3, $4, $5, $6, 'open')
       RETURNING id, entered_at`,
      [
        visitorType,
        clampStr(sessionKey, 128),
        userId,
        clampStr(ip, IP_MAX_LEN),
        clampStr(ua, UA_MAX_LEN),
        worldId ? clampStr(worldId, 64) : null,
      ]
    );

    const row = ins.rows[0];
    LIVE.set(connectionId, { id: row.id, enteredAt: Date.now(), lastSeen: Date.now() });
    return row.id;
  } catch (e) {
    console.error('[visitorStats] startSession 失败:', e.message);
    return null;
  }
}

/**
 * 记录一次「离开世界」，回填停留时长
 * @param {string} connectionId
 * @param {'close'|'timeout'} reason
 */
async function endSession(connectionId, reason = 'close') {
  const live = LIVE.get(connectionId);
  if (!live) return;
  LIVE.delete(connectionId);

  try {
    await query(
      `UPDATE visitor_sessions
          SET left_at      = NOW(),
              last_seen_at = NOW(),
              duration_sec = LEAST(
                GREATEST(ROUND(EXTRACT(EPOCH FROM (NOW() - entered_at)))::int, 0),
                $2::int
              ),
              end_reason   = $3
        WHERE id = $1 AND left_at IS NULL`,
      [live.id, MAX_SESSION_SEC, reason]
    );
  } catch (e) {
    console.error('[visitorStats] endSession 失败:', e.message);
  }
}

/**
 * 清理僵尸会话：超过上限还挂在 open 的（服务重启 / 连接池卡住）
 * 每次查统计前顺手跑一次，成本一条 UPDATE，不另开定时器。
 */
async function sweepStaleSessions() {
  try {
    const r = await query(
      `UPDATE visitor_sessions
          SET left_at      = entered_at + make_interval(secs => $1::int),
              last_seen_at = entered_at + make_interval(secs => $1::int),
              duration_sec = $1::int,
              end_reason   = 'cap'
        WHERE left_at IS NULL
          AND entered_at < NOW() - make_interval(secs => $1::int)`,
      [MAX_SESSION_SEC]
    );
    if (r.rowCount) console.log(`[visitorStats] 清理僵尸会话 ${r.rowCount} 条`);
  } catch (e) {
    console.error('[visitorStats] sweepStaleSessions 失败:', e.message);
  }
}

/**
 * 后台统计聚合
 * @param {number} days 趋势天数（1-90）
 */
async function getStats(days = 7) {
  const d = Math.min(Math.max(parseInt(days, 10) || 7, 1), 90);
  await sweepStaleSessions();

  // 今日（按北京时间切日，不是数据库时区）
  // FILTER 子句后直接跟 ::int 有解析歧义，统一用括号包住聚合结果
  const today = await query(
    `SELECT
       COUNT(*)::int AS sessions,
       COUNT(DISTINCT session_key)::int AS uv,
       (COUNT(DISTINCT session_key) FILTER (WHERE visitor_type = 'guest'))::int AS guest_uv,
       (COUNT(DISTINCT session_key) FILTER (WHERE visitor_type = 'user'))::int  AS user_uv
     FROM visitor_sessions
     WHERE (entered_at AT TIME ZONE 'Asia/Shanghai')::date
         = (NOW() AT TIME ZONE 'Asia/Shanghai')::date`
  );

  // 平均/中位停留：只算已结束且 >= 10 秒的会话
  // （< 10 秒基本是误触或秒退，混进来会把均值拉垮；中位数同给，防均值被挂机党带偏）
  const avg = await query(
    `SELECT visitor_type,
            COUNT(*)::int AS closed_sessions,
            ROUND(AVG(duration_sec))::int AS avg_sec,
            ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_sec))::int AS median_sec
       FROM visitor_sessions
      WHERE left_at IS NOT NULL
        AND duration_sec >= 10
        AND entered_at >= NOW() - make_interval(days => $1::int)
      GROUP BY visitor_type`,
    [d]
  );

  const daily = await query(
    // day 必须转成字符串再返回：pg 会把 date 解析成本地零点的 Date 对象，
    // 经 JSON 序列化会变成 UTC 时间串，前端直接显示会退回前一天
    `SELECT to_char((entered_at AT TIME ZONE 'Asia/Shanghai')::date, 'YYYY-MM-DD') AS day,
            COUNT(*)::int AS sessions,
            COUNT(DISTINCT session_key)::int AS uv,
            (COUNT(*) FILTER (WHERE visitor_type = 'guest'))::int AS guest_sessions,
            ROUND(AVG(duration_sec) FILTER (
              WHERE left_at IS NOT NULL AND duration_sec >= 10
            ))::int AS avg_sec
       FROM visitor_sessions
      WHERE entered_at >= NOW() - make_interval(days => $1::int)
      GROUP BY 1
      ORDER BY 1`,
    [d]
  );

  const avgByType = { guest: { avgSec: 0, medianSec: 0, closed: 0 }, user: { avgSec: 0, medianSec: 0, closed: 0 } };
  for (const row of avg.rows) {
    const t = row.visitor_type === 'guest' ? 'guest' : 'user';
    avgByType[t] = {
      avgSec: row.avg_sec || 0,
      medianSec: row.median_sec || 0,
      closed: row.closed_sessions || 0,
    };
  }

  return {
    today: today.rows[0] || { sessions: 0, uv: 0, guest_uv: 0, user_uv: 0 },
    avg: avgByType,
    daily: daily.rows,
    windowDays: d,
  };
}

module.exports = {
  startSession,
  endSession,
  sweepStaleSessions,
  getStats,
  MAX_SESSION_SEC,
  MERGE_WINDOW_MIN,
};
