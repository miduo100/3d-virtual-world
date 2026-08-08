/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * characterTemplates 主入口模块
 * 整合所有功能模块，提供与原文件完全相同的 API 接口
 */

const express = require('express');
const router = express.Router();
const { authenticateAdminToken } = require('../../middleware/adminAuth');

// 导入各模块
const templatesRouter = require('./templates');
const weaponsRouter = require('./weapons');
const extrasRouter = require('./extras');
const animationPlatformsRouter = require('./animationPlatforms');
const { ensureTables } = require('./database');

// 启动时初始化数据库
ensureTables().catch(e => console.error('[character-templates] 建表失败:', e));

// GET /api/character-templates/player-config 获取玩家配置
router.get('/player-config', async (req, res) => {
  try {
    res.json({ config: {} }); // 返回空配置，避免客户端错误
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: '获取玩家配置失败' });
  }
});

// 【重要】角色模板 API - 必须放在认证之前，这样 GET / 才能公开访问
router.use('/', templatesRouter);

// 武器库 API 需要验证（放在模板路由之后）
router.use('/weapons', authenticateAdminToken, weaponsRouter);

// 挂载其他功能 API（需要Token）
router.use('/', authenticateAdminToken, extrasRouter);

// 挂载多平台动作库 API（需要Token）
router.use('/', authenticateAdminToken, animationPlatformsRouter);

module.exports = router;
