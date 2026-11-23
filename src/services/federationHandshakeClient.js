/**
 * 济宁米多信息科技有限公司 版权所有
 * 联邦握手客户端（协议自适应）
 *
 * 解决两件事：
 *  1) http / https 都要能建立信任 —— 先 GET /api/federation/info 探测哪套协议可达
 *     （https 优先），再用探测成功的协议 POST /api/federation/handshake；
 *  2) 目标世界自报的 worldUrl 可能与其实际监听协议不一致 —— 入库时用「实际可连」
 *     的地址，避免后续状态检查 / 传送 / 跨世界资源拉取踩坑。
 *
 * 端点等式复用 trustedWorldStore.endpointKey（忽略协议；80/443 视为默认端口）：
 * http://x:3002 与 https://x:3002 是同一个世界。
 *
 * 自签证书：设置环境变量 FEDERATION_ALLOW_SELF_SIGNED=1 后才会放行（默认严格校验）。
 */

const axios = require('axios');
const https = require('https');
const { endpointKey, stripTrailingSlash, pickSecureUrl } = require('./trustedWorldStore');

const PROBE_TIMEOUT_MS = 5000;
const HANDSHAKE_TIMEOUT_MS = 10000;

const selfSignedAgent = process.env.FEDERATION_ALLOW_SELF_SIGNED === '1'
  ? new https.Agent({ rejectUnauthorized: false })
  : undefined;

function agentFor(base) {
  return /^https:/i.test(base) ? selfSignedAgent : undefined;
}

/**
 * 生成候选 base 列表：**https 永远优先**，不通自动回落 http
 *
 * 无论管理员填 http 还是 https，都先试 https（只有真的探测通过才会用），
 * 因此「填 http 但对方已上 https」会自动升级，「填 https 但对方只有 http」会自动回落。
 * 探测判据要求对方 /api/federation/info 返回 success + world.worldId，
 * 因此 443 上若挂着别的站点不会被误认成世界。
 */
function candidateBases(input) {
  const raw = stripTrailingSlash(input);
  if (!raw) return [];
  const bare = raw.replace(/^https?:\/\//i, '');
  return [`https://${bare}`, `http://${bare}`];
}

/**
 * 探测某个 base 是否是可用的本世界联邦端点
 * @returns {Promise<{ok:boolean, base:string, world?:object, error?:string}>}
 */
async function probeInfo(base) {
  try {
    const r = await axios.get(`${base}/api/federation/info`, {
      timeout: PROBE_TIMEOUT_MS,
      maxRedirects: 3,
      httpsAgent: agentFor(base),
      validateStatus: (s) => s >= 200 && s < 400
    });
    const world = r.data && r.data.world;
    if (r.data && r.data.success && world && world.worldId) {
      return { ok: true, base, world };
    }
    return { ok: false, base, error: '对方未返回有效的世界身份（/api/federation/info）' };
  } catch (error) {
    const msg = String(error.message || error);
    const hint = /certificate|self.signed|SSL|TLS/i.test(msg)
      ? '（证书校验失败，自签证书需设置 FEDERATION_ALLOW_SELF_SIGNED=1）'
      : '';
    return { ok: false, base, error: `${msg}${hint}` };
  }
}

/**
 * 依序探测候选地址，返回第一个可用的（候选列表本身 https 优先）
 */
async function probeFirstAvailable(input) {
  const candidates = candidateBases(input);
  const attempts = [];
  for (const base of candidates) {
    const p = await probeInfo(base);
    attempts.push(p);
    if (p.ok) return { ok: true, chosen: p, candidates, attempts };
  }
  return { ok: false, candidates, attempts };
}

/**
 * 决定最终入库的 worldUrl：
 *  - 与探测地址同一端点 → https 优先
 *  - 不同端点（对方自报域名而我们用 IP 访问成功）→ 用可连的那个
 */
function pickWorldUrl(probedBase, reportedUrl) {
  const base = stripTrailingSlash(probedBase);
  const reported = stripTrailingSlash(reportedUrl);
  if (!reported) return base;
  const kb = endpointKey(base);
  const kr = endpointKey(reported);
  if (!kb || !kr || kb !== kr) return base;
  return pickSecureUrl(base, reported);
}

/**
 * 建立信任（替代 federationSystem.establishTrust 的直连 POST）
 *
 * @param {object} federationSystem 联邦系统实例
 * @param {string} targetWorldUrl   管理员填写的目标地址（可带可不带协议）
 */
async function establishTrustByProbe(federationSystem, targetWorldUrl) {
  if (!federationSystem) {
    return { success: false, error: '联邦系统未初始化' };
  }

  const probed = await probeFirstAvailable(targetWorldUrl);
  if (!probed.ok) {
    const detail = probed.attempts
      .map((a) => `${a.base} → ${a.error}`)
      .join('；');
    return {
      success: false,
      error: `无法连接目标世界，已尝试 ${probed.candidates.length} 个地址：${detail}`,
      attempts: probed.attempts
    };
  }

  const chosen = probed.chosen;
  const tryOrder = [chosen.base, ...probed.candidates.filter((b) => b !== chosen.base)];
  let lastError = null;

  for (const base of tryOrder) {
    try {
      const response = await axios.post(
        `${base}/api/federation/handshake`,
        {
          worldId: federationSystem.worldId,
          worldName: federationSystem.worldName,
          worldUrl: federationSystem.worldUrl,
          publicKey: federationSystem.publicKey
        },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: HANDSHAKE_TIMEOUT_MS,
          // 不让重定向把 POST 改写成 GET（会丢 body → 对方报缺少参数）
          maxRedirects: 0,
          httpsAgent: agentFor(base),
          validateStatus: (s) => s >= 200 && s < 300
        }
      );

      const data = response.data || {};
      if (!data.success) {
        lastError = data.error || '对方拒绝握手';
        continue;
      }

      const peerId = data.worldId || (chosen.world && chosen.world.worldId);
      const peerName = data.worldName || (chosen.world && chosen.world.worldName) || peerId;
      const peerKey = data.publicKey || (chosen.world && chosen.world.publicKey);

      if (!peerId || !peerKey) {
        lastError = '对方握手响应缺少世界ID或公钥';
        continue;
      }

      const peerUrl = pickWorldUrl(base, data.worldUrl || (chosen.world && chosen.world.worldUrl));

      federationSystem.trustWorld(peerId, peerName, peerUrl, peerKey);

      const result = {
        success: true,
        worldId: peerId,
        worldName: peerName,
        worldUrl: peerUrl,
        publicKey: peerKey,
        viaProtocol: /^https:/i.test(base) ? 'https' : 'http',
        probedUrl: base
      };

      if (data.requiresApproval) {
        result.requiresApproval = true;
        result.message = `信任请求已发送给 ${peerName}，等待对方管理员审批`;
      } else {
        result.message = `已与 ${peerName} 建立信任关系`;
      }

      return result;
    } catch (error) {
      lastError = error.message;
    }
  }

  return {
    success: false,
    error: `握手失败：${lastError || '未知错误'}`,
    attempts: probed.attempts
  };
}

/**
 * 状态检查 + 协议纠正（替代 federationSystem.checkWorldStatus 内部实现）
 * 探测失败时自动换另一种协议重试；成功但与记录协议不同则回写数据库。
 */
async function recheckWorldStatus(federationSystem, worldId) {
  const world = federationSystem.trustedWorlds.get(worldId);
  if (!world) {
    return { success: false, error: '世界不存在' };
  }

  const probed = await probeFirstAvailable(world.worldUrl);
  if (!probed.ok) {
    const lastError = (probed.attempts[probed.attempts.length - 1] || {}).error || 'unreachable';
    const status = { status: 'offline', lastChecked: new Date(), error: lastError };
    federationSystem.worldStatus.set(worldId, status);
    return { success: false, status };
  }

  const chosen = probed.chosen;
  const newUrl = pickWorldUrl(chosen.base, world.worldUrl);
  const peerWorldId = chosen.world.worldId;

  if (stripTrailingSlash(newUrl) !== stripTrailingSlash(world.worldUrl)) {
    world.worldUrl = newUrl;
    try {
      const { query } = require('../database/db');
      await query(
        'UPDATE trusted_worlds SET world_url = $1, updated_at = NOW() WHERE world_id = $2',
        [newUrl, worldId]
      );
      console.log(`↩️ [联邦] ${worldId} 地址协议已纠正: ${world.worldUrl} → ${newUrl}`);
    } catch (e) {
      console.warn('⚠️ [联邦] 地址纠正回写失败（不影响状态）:', e.message);
    }
  }

  const status = {
    status: 'online',
    lastChecked: new Date(),
    url: newUrl,
    // 对方当前自报的 worldId 与本地记录不一致 → 身份已变更，后台提示「重新绑定」
    identityChanged: peerWorldId !== worldId,
    peerWorldId
  };
  federationSystem.worldStatus.set(worldId, status);
  return { success: true, status };
}

/**
 * 重新绑定：向该地址取对方「当前」身份，再原地改绑（旧 world_id 由 store 处理）
 */
async function rebindTrustedWorld(federationSystem, worldId) {
  const world = federationSystem.trustedWorlds.get(worldId);
  if (!world) {
    return { success: false, error: '世界不存在或未信任' };
  }

  const probed = await probeFirstAvailable(world.worldUrl);
  if (!probed.ok) {
    return {
      success: false,
      error: `无法连接 ${world.worldUrl}：${(probed.attempts[probed.attempts.length - 1] || {}).error || '未知错误'}`
    };
  }

  const chosen = probed.chosen;
  const newWorldId = chosen.world.worldId;
  const newWorldName = chosen.world.worldName || world.worldName;
  const newPublicKey = chosen.world.publicKey;
  const newWorldUrl = pickWorldUrl(chosen.base, chosen.world.worldUrl || world.worldUrl);

  if (!newPublicKey) {
    return { success: false, error: '对方 /api/federation/info 未返回公钥' };
  }

  const saved = await require('./trustedWorldStore').upsertTrustedWorld(
    {
      worldId: newWorldId,
      worldName: newWorldName,
      worldUrl: newWorldUrl,
      publicKey: newPublicKey
    },
    federationSystem
  );

  if (!saved.success) {
    return { success: false, error: saved.error };
  }

  return {
    success: true,
    oldWorldId: worldId,
    newWorldId,
    renamed: newWorldId !== worldId,
    worldName: newWorldName,
    worldUrl: newWorldUrl,
    viaProtocol: /^https:/i.test(chosen.base) ? 'https' : 'http'
  };
}

module.exports = {
  candidateBases,
  probeInfo,
  probeFirstAvailable,
  pickWorldUrl,
  establishTrustByProbe,
  recheckWorldStatus,
  rebindTrustedWorld
};
