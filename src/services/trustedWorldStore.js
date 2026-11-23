/**
 * 济宁米多信息科技有限公司 版权所有
 * 受信任世界存储层（唯一写入口）
 *
 * 背景：trusted_worlds 原本以 world_id 为主键、world_url 无唯一性约束，
 *       对方世界「重置身份」（重装 / 换库 / reset-identity）后，
 *       同一地址会再插一条新记录，旧记录永不消失 → 列表出现「同 URL 不同世界 ID」。
 *
 * 本模块把「端点」提升为唯一维度：
 *   endpoint_key = host[:port][/path]   （忽略 http/https 协议；80/443 视为默认端口）
 * 写入一律走 upsertTrustedWorld：同一端点已有旧身份时**原地改绑**（world_id 换成新的），
 * 因此不会再产生第二条；同一 world_id 换了地址时清掉它原来的端点行。
 *
 * 注意：同端点「旧身份」不做归档（按产品决策：世界少、人工可随时删）。
 */

const { pool } = require('../database/db');

const DEFAULT_PORTS = new Set(['80', '443']);

/**
 * 计算端点键：忽略协议、忽略默认端口、去尾斜杠、主机小写
 * http://118.69.165.15:3002 与 https://118.69.165.15:3002/  → 118.69.165.15:3002
 */
function endpointKey(url) {
  if (!url) return null;
  let s = String(url).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;

  try {
    const u = new URL(s);
    const host = String(u.hostname || '').toLowerCase();
    if (!host) return null;
    let port = u.port;
    if (DEFAULT_PORTS.has(port)) port = '';
    let path = String(u.pathname || '').replace(/\/+$/, '');
    if (path === '/' || path === '') path = '';
    return `${host}${port ? ':' + port : ''}${path}`;
  } catch (e) {
    // URL 解析失败时退化为字符串级归一，避免因个别脏数据整批失败
    const fallback = s.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
    return fallback || null;
  }
}

/**
 * 去掉 URL 末尾斜杠（与 federationSystem.establishTrust 的历史口径一致）
 */
function stripTrailingSlash(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

/**
 * 同端点两种协议二选一：https 优先（避免把已升级的安全协议降级成 http）
 */
function pickSecureUrl(a, b) {
  const ua = stripTrailingSlash(a);
  const ub = stripTrailingSlash(b);
  if (!ua) return ub;
  if (!ub) return ua;
  if (/^https:/i.test(ua)) return ua;
  if (/^https:/i.test(ub)) return ub;
  return ua;
}

/**
 * 写入一条受信任世界（幂等）。同一端点原地改绑。
 *
 * @param {object} data { worldId, worldName, worldUrl, publicKey, isCentral }
 * @param {object} [federationSystem] 传入则同步内存表（trustedWorlds）
 * @returns {Promise<{success:boolean, worldId?:string, endpointKey?:string, reboundFrom?:string|null, error?:string}>}
 */
async function upsertTrustedWorld(data, federationSystem) {
  const worldId = String((data && data.worldId) || '').trim();
  const worldUrl = stripTrailingSlash(data && data.worldUrl);
  const publicKey = data && data.publicKey;
  const worldName = String((data && data.worldName) || '').trim() || worldId;
  const isCentral = data && data.isCentral === true;

  if (!worldId || !worldUrl || !publicKey) {
    return { success: false, error: '世界信息不完整（worldId / worldUrl / publicKey 必填）' };
  }

  const key = endpointKey(worldUrl);
  if (!key) {
    return { success: false, error: `无法解析世界URL: ${worldUrl}` };
  }

  const client = await pool.connect();
  let reboundFrom = null;
  try {
    await client.query('BEGIN');

    // A. 同一 world_id 换了地址：先清掉它挂在旧端点上的行
    //    （否则下面 B 改写 world_id 时会撞 world_id 唯一约束）
    await client.query(
      `DELETE FROM trusted_worlds
        WHERE world_id = $1
          AND (endpoint_key IS DISTINCT FROM $2)`,
      [worldId, key]
    );

    // B. 同一端点已有旧身份：原地改绑（只取最近一条，防止历史重复行被批量 UPDATE 撞唯一键）
    const existing = await client.query(
      `SELECT world_id, world_url FROM trusted_worlds
        WHERE endpoint_key = $1
        ORDER BY created_at DESC NULLS LAST
        LIMIT 1`,
      [key]
    );

    if (existing.rows.length > 0) {
      const boundId = existing.rows[0].world_id;
      const boundUrl = existing.rows[0].world_url;
      const finalUrl = pickSecureUrl(worldUrl, boundUrl);

      await client.query(
        `UPDATE trusted_worlds
            SET world_id = $1,
                world_name = $2,
                world_url = $3,
                public_key = $4,
                endpoint_key = $5,
                is_central = $6,
                enabled = true,
                updated_at = NOW()
          WHERE world_id = $7`,
        [worldId, worldName, finalUrl, publicKey, key, isCentral, boundId]
      );

      if (boundId !== worldId) reboundFrom = boundId;
    } else {
      // C. 新端点：直接插入（并发下若撞 endpoint_key 唯一索引则回退到 B 的语义）
      try {
        await client.query(
          `INSERT INTO trusted_worlds
             (world_id, world_name, world_url, public_key, endpoint_key, is_central, created_at, enabled)
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), true)
           ON CONFLICT (world_id) DO UPDATE
             SET world_name = $2,
                 world_url = $3,
                 public_key = $4,
                 endpoint_key = $5,
                 is_central = $6,
                 enabled = true,
                 updated_at = NOW()`,
          [worldId, worldName, worldUrl, publicKey, key, isCentral]
        );
      } catch (insertErr) {
        if (insertErr && insertErr.code === '23505') {
          // 并发写入同一端点：改为按端点改绑
          const again = await client.query(
            `SELECT world_id, world_url FROM trusted_worlds
              WHERE endpoint_key = $1 ORDER BY created_at DESC NULLS LAST LIMIT 1`,
            [key]
          );
          if (again.rows.length > 0) {
            const boundId = again.rows[0].world_id;
            await client.query(
              `UPDATE trusted_worlds
                  SET world_id = $1, world_name = $2, world_url = $3, public_key = $4,
                      endpoint_key = $5, is_central = $6, enabled = true, updated_at = NOW()
                WHERE world_id = $7`,
              [worldId, worldName, pickSecureUrl(worldUrl, again.rows[0].world_url), publicKey, key, isCentral, boundId]
            );
            if (boundId !== worldId) reboundFrom = boundId;
          }
        } else {
          throw insertErr;
        }
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
    console.error('❌ [trustedWorldStore] 写入受信任世界失败:', error.message);
    return { success: false, error: error.message };
  } finally {
    client.release();
  }

  // 同步内存（不重启即可生效；旧身份从内存摘掉）
  if (federationSystem && federationSystem.trustedWorlds) {
    if (reboundFrom && reboundFrom !== worldId) {
      federationSystem.trustedWorlds.delete(reboundFrom);
    }
    federationSystem.trustWorld(worldId, worldName, worldUrl, publicKey);
  }

  if (reboundFrom) {
    console.log(`🔄 [联邦] 端点 ${key} 身份改绑: ${reboundFrom} → ${worldId}`);
  }

  return { success: true, worldId, endpointKey: key, reboundFrom };
}

/**
 * 把库里缺失 endpoint_key 的行补齐（启动时调用，幂等，失败不阻断）
 */
async function backfillEndpointKeys() {
  try {
    const { rows } = await pool.query(
      `SELECT world_id, world_url FROM trusted_worlds WHERE endpoint_key IS NULL`
    );
    let updated = 0;
    for (const row of rows) {
      const key = endpointKey(row.world_url);
      if (!key) continue;
      try {
        await pool.query(
          `UPDATE trusted_worlds SET endpoint_key = $1 WHERE world_id = $2`,
          [key, row.world_id]
        );
        updated += 1;
      } catch (e) {
        // 唯一索引已存在且撞车 → 说明该端点是重复记录，留待人工处理
        console.warn(`⚠️ [联邦] 端点键回填跳过 ${row.world_id}（${key}）: ${e.message}`);
      }
    }
    if (updated > 0) console.log(`✅ [联邦] 已回填 ${updated} 行 endpoint_key`);
    return { success: true, updated };
  } catch (error) {
    console.warn('⚠️ [联邦] endpoint_key 回填失败（不影响启动）:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  endpointKey,
  stripTrailingSlash,
  pickSecureUrl,
  upsertTrustedWorld,
  backfillEndpointKeys
};
