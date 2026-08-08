/**
 * 济宁米多信息科技有限公司 版权所有
 * 联邦信任审批路由
 * 提供信任审批开关与待审批请求管理接口
 */

const express = require('express');
const router = express.Router();
const { authenticateAdminToken } = require('../middleware/adminAuth');
const trustManager = require('../services/federationTrustManager');

// 获取信任审批开关
router.get('/trust-settings', authenticateAdminToken, async (req, res) => {
  try {
    const settings = await trustManager.getTrustSettings();
    res.json({ success: true, ...settings });
  } catch (error) {
    console.error('❌ 获取信任审批设置失败:', error);
    res.status(500).json({ success: false, error: '获取设置失败' });
  }
});

// 更新信任审批开关
router.put('/trust-settings', authenticateAdminToken, async (req, res) => {
  try {
    const { trustRequiresApproval } = req.body;
    const result = await trustManager.setTrustSettings(trustRequiresApproval);
    res.json(result);
  } catch (error) {
    console.error('❌ 保存信任审批设置失败:', error);
    res.status(500).json({ success: false, error: error.message || '保存设置失败' });
  }
});

// 列出待审批请求
router.get('/trust-requests', authenticateAdminToken, async (req, res) => {
  try {
    const result = await trustManager.listPendingRequests();
    res.json(result);
  } catch (error) {
    console.error('❌ 加载待审批请求失败:', error);
    res.status(500).json({ success: false, error: error.message || '加载失败' });
  }
});

// 同意待审批请求
router.post('/trust-requests/:id/approve', authenticateAdminToken, async (req, res) => {
  try {
    const federationSystem = require('./federation').getFederationSystem();
    if (!federationSystem) {
      return res.status(503).json({ success: false, error: '联邦系统未初始化' });
    }
    const result = await trustManager.approveRequest(req.params.id, federationSystem);
    res.json(result);
  } catch (error) {
    console.error('❌ 同意信任请求失败:', error);
    res.status(500).json({ success: false, error: error.message || '同意请求失败' });
  }
});

// 拒绝待审批请求
router.post('/trust-requests/:id/reject', authenticateAdminToken, async (req, res) => {
  try {
    const result = await trustManager.rejectRequest(req.params.id);
    res.json(result);
  } catch (error) {
    console.error('❌ 拒绝信任请求失败:', error);
    res.status(500).json({ success: false, error: error.message || '拒绝请求失败' });
  }
});

module.exports = router;
