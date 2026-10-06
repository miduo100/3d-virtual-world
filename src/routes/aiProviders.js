/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const aiProviderService = require('../services/aiProviderService');
const { authenticateAdminToken } = require('../middleware/adminAuth');

/**
 * 公开/鉴权清单（防止再加漏）：
 *   公开读：GET /providers                —— 列表里敏感值恒为 '********'（SQL 内 CASE）
 *   管理读：GET /providers/:id            —— ★Phase 0 修复：原来匿名可读 include_sensitive=true
 *                                       → 直接拿到所有 API Key 明文
 *   管理读：GET /providers/:id/audit-logs、GET /audit-logs
 *   写：    其余 POST（写权限另由 apiWriteGuard 的策略表按 'admin' 兜住）
 */

/**
 * 获取所有AI提供商
 */
router.get('/providers', async (req, res) => {
  try {
    const includeDisabled = req.query.include_disabled !== 'false';
    const providers = await aiProviderService.getAllProviders(includeDisabled);
    
    res.json({
      success: true,
      providers: providers
    });
  } catch (error) {
    console.error('Get providers error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取单个提供商详情（★需管理员：include_sensitive=true 会返回 API Key 明文）
 */
router.get('/providers/:id', authenticateAdminToken, async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    const includeSensitive = req.query.include_sensitive === 'true';
    
    const provider = await aiProviderService.getProvider(providerId, includeSensitive);
    
    if (!provider) {
      return res.status(404).json({
        success: false,
        error: '提供商不存在'
      });
    }
    
    res.json({
      success: true,
      provider: provider
    });
  } catch (error) {
    console.error('Get provider error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 保存提供商配置
 */
router.post('/providers/:id/config', async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    const configs = req.body.configs || {};
    const userId = req.user?.id;
    const ipAddress = req.ip;
    
    const results = await aiProviderService.setProviderConfigs(providerId, configs, userId, ipAddress);
    
    const hasError = results.some(r => !r.success);
    
    res.json({
      success: !hasError,
      results: results,
      message: hasError ? '部分配置保存失败' : '配置保存成功'
    });
  } catch (error) {
    console.error('Save provider config error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 启用/禁用提供商
 */
router.post('/providers/:id/toggle', async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    const enabled = req.body.enabled;
    const userId = req.user?.id;
    const ipAddress = req.ip;
    
    const result = await aiProviderService.toggleProvider(providerId, enabled, userId, ipAddress);
    
    res.json(result);
  } catch (error) {
    console.error('Toggle provider error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 设置默认提供商
 */
router.post('/providers/:id/set-default', async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    const userId = req.user?.id;
    const ipAddress = req.ip;
    
    const result = await aiProviderService.setDefaultProvider(providerId, userId, ipAddress);
    
    res.json(result);
  } catch (error) {
    console.error('Set default provider error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 添加自定义提供商
 */
router.post('/providers', async (req, res) => {
  try {
    const providerData = req.body;
    const userId = req.user?.id;
    const ipAddress = req.ip;
    
    const result = await aiProviderService.addCustomProvider(providerData, userId, ipAddress);
    
    res.json(result);
  } catch (error) {
    console.error('Add provider error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 测试提供商连接
 */
router.post('/providers/:id/test', async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    
    const result = await aiProviderService.testConnection(providerId);
    
    res.json(result);
  } catch (error) {
    console.error('Test provider error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取审计日志（Phase 0：需管理员 —— 会暴露"谁改了哪个 provider 的哪个键"）
 */
router.get('/providers/:id/audit-logs', authenticateAdminToken, async (req, res) => {
  try {
    const providerId = parseInt(req.params.id);
    const limit = parseInt(req.query.limit) || 50;
    
    const logs = await aiProviderService.getAuditLogs(providerId, limit);
    
    res.json({
      success: true,
      logs: logs
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 获取所有审计日志（Phase 0：需管理员）
 */
router.get('/audit-logs', authenticateAdminToken, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    
    const logs = await aiProviderService.getAuditLogs(null, limit);
    
    res.json({
      success: true,
      logs: logs
    });
  } catch (error) {
    console.error('Get audit logs error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
