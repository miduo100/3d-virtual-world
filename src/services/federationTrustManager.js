/**
 * 济宁米多信息科技有限公司 版权所有
 * 联邦信任审批管理器
 * 处理 "是否需要对方管理员手动同意" 的开关与待审批请求
 */

const { query } = require('../database/db');

const CONFIG_KEY = 'federation_config';
const DEFAULT_SETTINGS = { trustRequiresApproval: false };

/**
 * 获取当前世界的信任审批设置
 */
async function getTrustSettings() {
  try {
    const result = await query(
      'SELECT value FROM world_config WHERE key = $1',
      [CONFIG_KEY]
    );
    if (result.rows.length === 0) {
      return { ...DEFAULT_SETTINGS };
    }
    const config = JSON.parse(result.rows[0].value);
    return {
      trustRequiresApproval: config.trustRequiresApproval === true
    };
  } catch (error) {
    console.error('❌ 获取信任审批设置失败:', error);
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * 更新信任审批开关
 * @param {boolean} trustRequiresApproval
 */
async function setTrustSettings(trustRequiresApproval) {
  try {
    const existing = await query(
      'SELECT value FROM world_config WHERE key = $1',
      [CONFIG_KEY]
    );

    let config;
    if (existing.rows.length > 0) {
      config = JSON.parse(existing.rows[0].value);
    } else {
      config = {};
    }

    config.trustRequiresApproval = trustRequiresApproval === true;

    await query(
      `INSERT INTO world_config (key, value, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW()`,
      [CONFIG_KEY, JSON.stringify(config)]
    );

    return { success: true, trustRequiresApproval: config.trustRequiresApproval };
  } catch (error) {
    console.error('❌ 保存信任审批设置失败:', error);
    throw new Error('保存设置失败');
  }
}

/**
 * 处理其他世界发来的握手请求
 * @param {object} requestData - { worldId, worldName, worldUrl, publicKey }
 * @param {string} sourceIp - 请求方IP
 * @param {object} federationSystem - 联邦系统实例
 */
async function handleIncomingHandshake(requestData, sourceIp, federationSystem) {
  const { worldId, worldName, worldUrl, publicKey } = requestData;

  if (!worldId || !worldName || !worldUrl || !publicKey) {
    return { success: false, error: '握手数据不完整' };
  }

  const settings = await getTrustSettings();

  // 开关关闭：保持旧行为，自动同意
  if (!settings.trustRequiresApproval) {
    const result = federationSystem.handleHandshake(requestData);
    if (result.success) {
      await saveTrustedWorld(requestData);
    }
    return result;
  }

  // 开关开启：保存为待审批请求
  try {
    await query(
      `INSERT INTO pending_trust_requests
       (world_id, world_name, world_url, public_key, source_ip, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), NOW())
       ON CONFLICT (world_id) DO UPDATE
       SET world_name = $2, world_url = $3, public_key = $4, source_ip = $5,
           status = 'pending', updated_at = NOW()`,
      [worldId, worldName, worldUrl, publicKey, sourceIp || null]
    );

    return {
      success: true,
      requiresApproval: true,
      worldId: federationSystem.worldId,
      worldName: federationSystem.worldName,
      worldUrl: federationSystem.worldUrl,
      publicKey: federationSystem.publicKey,
      message: '信任请求已提交，等待本世界管理员审批'
    };
  } catch (error) {
    console.error('❌ 保存待审批信任请求失败:', error);
    return { success: false, error: '保存待审批请求失败' };
  }
}

/**
 * 列出待审批请求
 */
async function listPendingRequests() {
  try {
    const result = await query(
      `SELECT id, world_id, world_name, world_url, public_key, source_ip, status, created_at
       FROM pending_trust_requests
       WHERE status = 'pending'
       ORDER BY created_at DESC`
    );
    return { success: true, requests: result.rows };
  } catch (error) {
    console.error('❌ 加载待审批请求失败:', error);
    throw new Error('加载待审批请求失败');
  }
}

/**
 * 同意待审批请求
 * @param {string} requestId
 * @param {object} federationSystem
 */
async function approveRequest(requestId, federationSystem) {
  try {
    const result = await query(
      `SELECT * FROM pending_trust_requests
       WHERE id = $1 AND status = 'pending'`,
      [requestId]
    );

    if (result.rows.length === 0) {
      return { success: false, error: '请求不存在或已处理' };
    }

    const req = result.rows[0];

    // 加入信任列表
    federationSystem.trustWorld(
      req.world_id,
      req.world_name,
      req.world_url,
      req.public_key
    );

    // 持久化到 trusted_worlds
    await saveTrustedWorld({
      worldId: req.world_id,
      worldName: req.world_name,
      worldUrl: req.world_url,
      publicKey: req.public_key
    });

    // 更新待审批状态
    await query(
      `UPDATE pending_trust_requests
       SET status = 'approved', updated_at = NOW()
       WHERE id = $1`,
      [requestId]
    );

    return {
      success: true,
      worldId: req.world_id,
      worldName: req.world_name,
      message: `已同意 ${req.world_name} 的信任请求`
    };
  } catch (error) {
    console.error('❌ 同意信任请求失败:', error);
    throw new Error('同意请求失败');
  }
}

/**
 * 拒绝待审批请求
 * @param {string} requestId
 */
async function rejectRequest(requestId) {
  try {
    const result = await query(
      `UPDATE pending_trust_requests
       SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [requestId]
    );

    if (result.rows.length === 0) {
      return { success: false, error: '请求不存在或已处理' };
    }

    return {
      success: true,
      worldId: result.rows[0].world_id,
      worldName: result.rows[0].world_name,
      message: `已拒绝 ${result.rows[0].world_name} 的信任请求`
    };
  } catch (error) {
    console.error('❌ 拒绝信任请求失败:', error);
    throw new Error('拒绝请求失败');
  }
}

/**
 * 把世界信息保存到 trusted_worlds
 */
async function saveTrustedWorld({ worldId, worldName, worldUrl, publicKey }) {
  try {
    await query(
      `INSERT INTO trusted_worlds
       (world_id, world_name, world_url, public_key, created_at, enabled)
       VALUES ($1, $2, $3, $4, NOW(), true)
       ON CONFLICT (world_id) DO UPDATE
       SET world_name = $2, world_url = $3, public_key = $4, updated_at = NOW()`,
      [worldId, worldName, worldUrl, publicKey]
    );
  } catch (error) {
    console.error('❌ 保存信任世界失败:', error);
    // 数据库错误不抛异常，避免影响握手结果
  }
}

module.exports = {
  getTrustSettings,
  setTrustSettings,
  handleIncomingHandshake,
  listPendingRequests,
  approveRequest,
  rejectRequest
};
