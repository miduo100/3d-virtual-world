/**
 * 济宁米多信息科技有限公司 版权所有
 * 联邦受信任世界「重新绑定」接口
 *
 * 用途：对方世界重置过身份（重装 / 换库 / reset-identity）后，受信任列表里的
 *       world_id 已经失效。此时不需要「删掉再加」，点一次重新绑定即可：
 *       1. 用记录里的地址探测对方当前身份（GET /api/federation/info）；
 *       2. 按端点（host[:port][/path]，忽略 http/https）原地改绑到新 world_id + 新公钥。
 *
 * 挂载方式（routes/federation.js 末尾一行，避免在 1000+ 行文件里堆逻辑）：
 *   router.use(createFederationWorldRebindRouter({ getFederationSystem: () => federationSystem }));
 */

const express = require('express');
const { authenticateAdminToken } = require('../middleware/adminAuth');
const { rebindTrustedWorld } = require('../services/federationHandshakeClient');
const { endpointKey } = require('../services/trustedWorldStore');

function createFederationWorldRebindRouter({ getFederationSystem }) {
  if (typeof getFederationSystem !== 'function') {
    throw new Error('createFederationWorldRebindRouter 需要 getFederationSystem 函数');
  }
  const router = express.Router();

  // 重新绑定：以对方当前自报身份覆盖本地该端点的记录
  router.post('/worlds/:worldId/rebind', authenticateAdminToken, async (req, res) => {
    const federationSystem = getFederationSystem();
    if (!federationSystem) {
      return res.status(503).json({ success: false, error: '联邦系统未初始化' });
    }
    try {
      const result = await rebindTrustedWorld(federationSystem, req.params.worldId);
      if (!result.success) {
        return res.status(400).json(result);
      }
      console.log(`🔄 [联邦] 重新绑定 ${result.oldWorldId} → ${result.newWorldId}（${result.worldUrl}）`);
      res.json(result);
    } catch (error) {
      console.error('❌ [联邦] 重新绑定失败:', error);
      res.status(500).json({ success: false, error: error.message || '重新绑定失败' });
    }
  });

  // 端点重复检测（只读，供后台高亮「同地址多条记录」）
  router.get('/worlds-endpoints', authenticateAdminToken, (req, res) => {
    const federationSystem = getFederationSystem();
    if (!federationSystem) {
      return res.status(503).json({ success: false, error: '联邦系统未初始化' });
    }
    const groups = new Map();
    for (const world of federationSystem.trustedWorlds.values()) {
      const key = endpointKey(world.worldUrl) || String(world.worldUrl || '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({
        worldId: world.worldId,
        worldName: world.worldName,
        worldUrl: world.worldUrl
      });
    }
    const duplicates = [];
    for (const [key, worlds] of groups.entries()) {
      if (worlds.length > 1) duplicates.push({ endpointKey: key, worlds });
    }
    res.json({ success: true, total: federationSystem.trustedWorlds.size, duplicates });
  });

  return router;
}

module.exports = { createFederationWorldRebindRouter };
