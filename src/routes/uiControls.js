/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateAdminToken, logAdminAction } = require('../middleware/adminAuth');

// ==================== 公开API (无需管理员权限) ====================

/**
 * 获取前端UI配置 (公开接口，供游戏页面调用)
 * GET /api/ui-controls/public/config
 */
router.get('/config', async (req, res) => {
  try {
    const { platform } = req.query; // platform: 'mobile' | 'desktop' | 'mobile-portrait' | 'mobile-landscape' | 'vr'

    // 返回所有控件（包括不可见的），让前端根据 is_visible 决定显示/隐藏
    const result = await query(
      'SELECT * FROM ui_controls WHERE is_enabled = true ORDER BY category, z_index',
    );

    // 根据平台返回相应配置
    const controls = result.rows.map(control => {
      const config = {
        control_id: control.control_id,
        control_name: control.control_name,
        control_type: control.control_type,
        category: control.category,
        position_type: control.position_type,
        h_align: control.h_align || 'left',
        v_align: control.v_align || 'top',
        z_index: control.z_index,
        style_config: control.style_config,
        related_module: control.related_module,
        is_visible: control.is_visible,
        is_enabled: control.is_enabled
      };

      // 根据平台选择位置配置
      if (platform === 'mobile-landscape') {
        // 横屏：优先用横屏字段，回退到竖屏字段，再回退到桌面端
        config.position_x = control.landscape_position_x || control.mobile_position_x || control.position_x;
        config.position_y = control.landscape_position_y || control.mobile_position_y || control.position_y;
        config.width = control.landscape_width || control.mobile_width || control.width;
        config.height = control.landscape_height || control.mobile_height || control.height;
      } else if (platform === 'mobile' || platform === 'mobile-portrait') {
        // 竖屏（或通用mobile）：优先用竖屏字段，回退到桌面端
        config.position_x = control.mobile_position_x || control.position_x;
        config.position_y = control.mobile_position_y || control.position_y;
        config.width = control.mobile_width || control.width;
        config.height = control.mobile_height || control.height;
      } else {
        config.position_x = control.position_x;
        config.position_y = control.position_y;
        config.width = control.width;
        config.height = control.height;
      }

      return config;
    });

    res.json({ success: true, controls });
  } catch (error) {
    console.error('获取UI配置失败:', error);
    res.status(500).json({ success: false, error: '获取UI配置失败' });
  }
});

// ==================== 管理员API (需要管理员权限) ====================

/**
 * 获取所有UI控件配置
 * GET /api/admin/ui-controls
 */
router.get('/admin/list', authenticateAdminToken, async (req, res) => {
  try {
    const { category, control_type, is_visible } = req.query;

    let sql = 'SELECT * FROM ui_controls WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (category) {
      sql += ` AND category = $${paramIndex++}`;
      params.push(category);
    }

    if (control_type) {
      sql += ` AND control_type = $${paramIndex++}`;
      params.push(control_type);
    }

    if (is_visible !== undefined) {
      sql += ` AND is_visible = $${paramIndex++}`;
      params.push(is_visible === 'true');
    }

    sql += ' ORDER BY category, control_name';

    const result = await query(sql, params);
    res.json({ success: true, controls: result.rows });
  } catch (error) {
    console.error('获取UI控件列表失败:', error);
    res.status(500).json({ success: false, error: '获取UI控件列表失败' });
  }
});

/**
 * 获取单个UI控件配置
 * GET /api/admin/ui-controls/:controlId
 */
router.get('/admin/detail/:controlId', authenticateAdminToken, async (req, res) => {
  try {
    const { controlId } = req.params;

    const result = await query(
      'SELECT * FROM ui_controls WHERE control_id = $1',
      [controlId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '控件不存在' });
    }

    res.json({ success: true, control: result.rows[0] });
  } catch (error) {
    console.error('获取UI控件失败:', error);
    res.status(500).json({ success: false, error: '获取UI控件失败' });
  }
});

/**
 * 创建新的UI控件
 * POST /api/admin/ui-controls
 */
router.post('/admin/create', authenticateAdminToken, async (req, res) => {
  try {
    const {
      control_id,
      control_name,
      control_type,
      category = 'general',
      position_x,
      position_y,
      width,
      height,
      position_type = 'fixed',
      mobile_position_x,
      mobile_position_y,
      mobile_width,
      mobile_height,
      style_config = {},
      is_visible = true,
      is_enabled = true,
      z_index = 1000,
      related_module,
      description
    } = req.body;

    // 验证必填字段
    if (!control_id || !control_name || !control_type) {
      return res.status(400).json({
        success: false,
        error: '缺少必填字段: control_id, control_name, control_type'
      });
    }

    // 检查control_id是否已存在
    const existing = await query(
      'SELECT id FROM ui_controls WHERE control_id = $1',
      [control_id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: '控件ID已存在'
      });
    }

    const result = await query(
      `INSERT INTO ui_controls (
        control_id, control_name, control_type, category,
        position_x, position_y, width, height, position_type,
        mobile_position_x, mobile_position_y, mobile_width, mobile_height,
        style_config, is_visible, is_enabled, z_index,
        related_module, description, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      RETURNING *`,
      [
        control_id, control_name, control_type, category,
        position_x, position_y, width, height, position_type,
        mobile_position_x, mobile_position_y, mobile_width, mobile_height,
        JSON.stringify(style_config), is_visible, is_enabled, z_index,
        related_module, description, req.adminUser ? req.adminUser.id : null
      ]
    );

    // 记录管理员操作
    await logAdminAction(req.adminUser?.id, 'CREATE_UI_CONTROL', 'ui_controls', result.rows[0].id, `创建UI控件: ${control_name} (${control_id})`, req.ip);

    res.json({ success: true, control: result.rows[0], message: '控件创建成功' });
  } catch (error) {
    console.error('创建UI控件失败:', error);
    res.status(500).json({ success: false, error: '创建UI控件失败' });
  }
});

/**
 * 更新UI控件配置
 * PUT /api/admin/ui-controls/:controlId
 */
router.put('/admin/update/:controlId', authenticateAdminToken, async (req, res) => {
  try {
    const { controlId } = req.params;
    const updates = req.body;

    // 不允许修改的字段（这些字段由后端自动管理）
    delete updates.id;
    delete updates.control_id;
    delete updates.created_at;
    delete updates.created_by;
    delete updates.updated_at;
    delete updates.updated_by;

    // 构建更新SQL
    const fields = [];
    const values = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      // 过滤 undefined 和 null，防止意外清空数据库字段
      if (value !== undefined && value !== null) {
        fields.push(`${key} = $${paramIndex++}`);
        // 对于 JSONB 字段，确保正确处理对象或字符串
        if (key === 'style_config') {
          // 如果已经是字符串，直接使用；如果是对象，转换为JSON字符串
          values.push(typeof value === 'string' ? value : JSON.stringify(value));
        } else {
          values.push(value);
        }
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, error: '没有要更新的字段' });
    }

    // 添加updated_by
    fields.push(`updated_by = $${paramIndex++}`);
    values.push(req.adminUser ? req.adminUser.id : null);

    // 添加controlId
    values.push(controlId);

    const result = await query(
      `UPDATE ui_controls SET ${fields.join(', ')} WHERE control_id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '控件不存在' });
    }

    // 记录管理员操作
    await logAdminAction(req.adminUser?.id, 'UPDATE_UI_CONTROL', 'ui_controls', result.rows[0].id, `更新UI控件: ${controlId}`, req.ip);

    res.json({ success: true, control: result.rows[0], message: '控件更新成功' });
  } catch (error) {
    console.error('更新UI控件失败:', error);
    res.status(500).json({ success: false, error: '更新UI控件失败' });
  }
});

/**
 * 删除UI控件
 * DELETE /api/admin/ui-controls/:controlId
 */
router.delete('/admin/delete/:controlId', authenticateAdminToken, async (req, res) => {
  try {
    const { controlId } = req.params;

    const result = await query(
      'DELETE FROM ui_controls WHERE control_id = $1 RETURNING *',
      [controlId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '控件不存在' });
    }

    // 记录管理员操作
    await logAdminAction(req.adminUser?.id, 'DELETE_UI_CONTROL', 'ui_controls', controlId, `删除UI控件: ${controlId}`, req.ip);

    res.json({ success: true, message: '控件删除成功' });
  } catch (error) {
    console.error('删除UI控件失败:', error);
    res.status(500).json({ success: false, error: '删除UI控件失败' });
  }
});

/**
 * 批量更新UI控件配置
 * POST /api/admin/ui-controls/batch-update
 */
router.post('/admin/batch-update', authenticateAdminToken, async (req, res) => {
  try {
    const { controls } = req.body;

    if (!Array.isArray(controls) || controls.length === 0) {
      return res.status(400).json({ success: false, error: '无效的控件列表' });
    }

    // 调试：打印第一个控件的字段
    if (controls.length > 0) {
      console.log('第一个控件的字段:', Object.keys(controls[0]));
      console.log('是否有created_by:', 'created_by' in controls[0]);
      console.log('is_visible值:', controls[0].is_visible, '类型:', typeof controls[0].is_visible);
      console.log('is_enabled值:', controls[0].is_enabled, '类型:', typeof controls[0].is_enabled);
      console.log('z_index值:', controls[0].z_index, '类型:', typeof controls[0].z_index);
      console.log('style_config:', JSON.stringify(controls[0].style_config));
    }

    const results = [];

    for (const control of controls) {
      const { control_id, ...updates } = control;

      if (!control_id) continue;

      const fields = [];
      const values = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(updates)) {
        // 排除系统字段和updated_by（后面单独添加）
        // 同时过滤 null 值，防止意外清空数据库字段
        if (value !== undefined && value !== null && !['id', 'control_id', 'created_at', 'created_by', 'updated_at', 'updated_by'].includes(key)) {
          fields.push(`${key} = $${paramIndex++}`);
          // 对于 JSONB 字段，确保正确处理对象或字符串
          if (key === 'style_config') {
            // 如果已经是字符串，直接使用；如果是对象，转换为JSON字符串
            values.push(typeof value === 'string' ? value : JSON.stringify(value));
          } else if (key === 'is_visible' || key === 'is_enabled') {
            // 布尔值处理：确保是布尔类型
            values.push(value === true || value === 'true' || value === 1);
          } else if (key === 'z_index') {
            // 整数处理
            values.push(parseInt(value) || 1000);
          } else {
            values.push(value);
          }
        }
      }

      if (fields.length > 0) {
        fields.push(`updated_by = $${paramIndex++}`);
        values.push(req.adminUser ? req.adminUser.id : null);
        values.push(control_id);

        // 调试：打印SQL和参数
        const sql = `UPDATE ui_controls SET ${fields.join(', ')} WHERE control_id = $${paramIndex} RETURNING *`;
        console.log('SQL:', sql);
        console.log('参数数量:', values.length);
        console.log('参数值:', values.map((v, i) => `$${i+1}=${JSON.stringify(v)}`).join(', '));

        const result = await query(sql, values);

        if (result.rows.length > 0) {
          results.push(result.rows[0]);
        }
      }
    }

    // 记录管理员操作
    await logAdminAction(req.adminUser?.id, 'BATCH_UPDATE_UI_CONTROLS', 'ui_controls', null, `批量更新UI控件: ${results.length}个`, req.ip);

    res.json({ success: true, controls: results, message: `成功更新${results.length}个控件` });
  } catch (error) {
    console.error('批量更新UI控件失败:', error);
    // 返回具体错误信息，方便前端排查
    const errMsg = error.message || error.detail || '未知数据库错误';
    res.status(500).json({ success: false, error: '批量更新UI控件失败: ' + errMsg });
  }
});

/**
 * 重置控件为默认配置
 * POST /api/admin/ui-controls/:controlId/reset
 */
router.post('/admin/reset/:controlId', authenticateAdminToken, async (req, res) => {
  try {
    const { controlId } = req.params;

    // 默认配置映射
    const defaultConfigs = {
      'mobile_joystick': { position_x: '24px', position_y: 'auto', width: '150px', height: '150px', mobile_position_x: '24px', mobile_position_y: '100px', mobile_width: '150px', mobile_height: '150px', landscape_position_x: '24px', landscape_position_y: '100px', landscape_width: '150px', landscape_height: '150px', h_align: 'left', v_align: 'bottom' },
      'mobile_jump_btn': { position_x: 'auto', position_y: '24px', width: '70px', height: '70px', mobile_position_x: 'auto', mobile_position_y: '24px', mobile_width: '70px', mobile_height: '70px', landscape_position_x: 'auto', landscape_position_y: '24px', landscape_width: '70px', landscape_height: '70px', h_align: 'right', v_align: 'bottom' },
      'mobile_sprint_btn': { position_x: 'auto', position_y: '24px', width: '60px', height: '60px', mobile_position_x: 'auto', mobile_position_y: '24px', mobile_width: '60px', mobile_height: '60px', landscape_position_x: 'auto', landscape_position_y: '24px', landscape_width: '60px', landscape_height: '60px', h_align: 'right', v_align: 'bottom' },
      'mobile_camera_toggle_btn': { position_x: 'auto', position_y: '24px', width: '60px', height: '60px', mobile_position_x: 'auto', mobile_position_y: '24px', mobile_width: '60px', mobile_height: '60px', landscape_position_x: 'auto', landscape_position_y: '24px', landscape_width: '60px', landscape_height: '60px', h_align: 'right', v_align: 'bottom' },
      'mobile_turn_left_btn': { position_x: 'auto', position_y: '180px', width: '50px', height: '50px', mobile_position_x: 'auto', mobile_position_y: '180px', mobile_width: '50px', mobile_height: '50px', landscape_position_x: 'auto', landscape_position_y: '180px', landscape_width: '50px', landscape_height: '50px', h_align: 'right', v_align: 'bottom' },
      'mobile_turn_right_btn': { position_x: 'auto', position_y: '180px', width: '50px', height: '50px', mobile_position_x: 'auto', mobile_position_y: '180px', mobile_width: '50px', mobile_height: '50px', landscape_position_x: 'auto', landscape_position_y: '180px', landscape_width: '50px', landscape_height: '50px', h_align: 'right', v_align: 'bottom' },
      'btn_profile': { position_x: '95%', position_y: '2%', width: '48px', height: '48px', mobile_position_x: '95%', mobile_position_y: '2%', mobile_width: '48px', mobile_height: '48px', landscape_position_x: '95%', landscape_position_y: '2%', landscape_width: '48px', landscape_height: '48px', h_align: 'right', v_align: 'top' },
      'btn_inventory': { position_x: '95%', position_y: '8%', width: '48px', height: '48px', mobile_position_x: '95%', mobile_position_y: '8%', mobile_width: '48px', mobile_height: '48px', landscape_position_x: '95%', landscape_position_y: '8%', landscape_width: '48px', landscape_height: '48px', h_align: 'right', v_align: 'top' },
      'skill_hud': { position_x: 'auto', position_y: '90%', width: 'auto', height: '58px', mobile_position_x: 'auto', mobile_position_y: '85%', mobile_width: 'auto', mobile_height: '58px', landscape_position_x: 'auto', landscape_position_y: '85%', landscape_width: 'auto', landscape_height: '58px', h_align: 'left', v_align: 'bottom' },
      'skill_voice_btn': { position_x: 'auto', position_y: '90%', width: '58px', height: '58px', mobile_position_x: 'auto', mobile_position_y: '85%', mobile_width: '58px', mobile_height: '58px', landscape_position_x: 'auto', landscape_position_y: '85%', landscape_width: '58px', landscape_height: '58px', h_align: 'left', v_align: 'bottom' },
      'health_bar': { position_x: '20px', position_y: '20px', width: '300px', height: '30px', mobile_position_x: '10px', mobile_position_y: '10px', mobile_width: '200px', mobile_height: '25px', landscape_position_x: '10px', landscape_position_y: '10px', landscape_width: '200px', landscape_height: '25px', h_align: 'left', v_align: 'top' },
      'minimap': { position_x: 'auto', position_y: '20px', width: '200px', height: '200px', mobile_position_x: 'auto', mobile_position_y: '10px', mobile_width: '120px', mobile_height: '120px', landscape_position_x: 'auto', landscape_position_y: '10px', landscape_width: '120px', landscape_height: '120px', h_align: 'right', v_align: 'top' },
      'portal_btn': { position_x: '20px', position_y: '60px', width: 'auto', height: 'auto', mobile_position_x: '10px', mobile_position_y: '50px', mobile_width: 'auto', mobile_height: 'auto', landscape_position_x: '10px', landscape_position_y: '50px', landscape_width: 'auto', landscape_height: 'auto', h_align: 'left', v_align: 'top' },
      'federation_portal_btn': { position_x: '20px', position_y: '200px', width: 'auto', height: 'auto', mobile_position_x: '10px', mobile_position_y: '100px', mobile_width: 'auto', mobile_height: 'auto', landscape_position_x: '10px', landscape_position_y: '100px', landscape_width: 'auto', landscape_height: 'auto', h_align: 'left', v_align: 'top' },
      'performance_monitor': { position_x: 'auto', position_y: 'auto', width: '200px', height: '120px', mobile_position_x: 'auto', mobile_position_y: 'auto', mobile_width: '150px', mobile_height: '100px', landscape_position_x: 'auto', landscape_position_y: 'auto', landscape_width: '150px', landscape_height: '100px', h_align: 'right', v_align: 'bottom' },
      'debug_panel': { position_x: 'auto', position_y: '10px', width: 'auto', height: 'auto', mobile_position_x: 'auto', mobile_position_y: '10px', mobile_width: 'auto', mobile_height: 'auto', landscape_position_x: 'auto', landscape_position_y: '10px', landscape_width: 'auto', landscape_height: 'auto', h_align: 'right', v_align: 'top' }
    };

    const defaultConfig = defaultConfigs[controlId];

    if (!defaultConfig) {
      return res.status(400).json({ success: false, error: '该控件没有默认配置' });
    }

    const fields = Object.keys(defaultConfig).map((key, index) => `${key} = $${index + 1}`).join(', ');
    const values = [...Object.values(defaultConfig), req.adminUser ? req.adminUser.id : null, controlId];

    const result = await query(
      `UPDATE ui_controls SET ${fields}, updated_by = $${values.length - 1} WHERE control_id = $${values.length} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '控件不存在' });
    }

    // 记录管理员操作
    await logAdminAction(req.adminUser?.id, 'RESET_UI_CONTROL', 'ui_controls', result.rows[0].id, `重置UI控件: ${controlId}`, req.ip);

    res.json({ success: true, control: result.rows[0], message: '控件已重置为默认配置' });
  } catch (error) {
    console.error('重置UI控件失败:', error);
    res.status(500).json({ success: false, error: '重置UI控件失败' });
  }
});

/**
 * 确保默认UI控件存在于数据库（服务器启动时自动调用）
 * 使用 ON CONFLICT DO NOTHING，只插入不存在的控件
 */
async function ensureDefaultControls() {
  const defaults = [
    // mobile
    ['mobile_joystick', '移动摇杆', 'joystick', 'mobile', '24px', 'auto', '150px', '150px', '24px', '100px', '150px', '150px', 'left', 'bottom', 'mobileControls.js', '左下角虚拟摇杆'],
    ['mobile_jump_btn', '跳跃按钮', 'button', 'mobile', 'auto', '24px', '70px', '70px', 'auto', '24px', '70px', '70px', 'right', 'bottom', 'mobileControls.js', '右下角跳跃按钮'],
    ['mobile_sprint_btn', '冲刺按钮', 'button', 'mobile', 'auto', '24px', '60px', '60px', 'auto', '24px', '60px', '60px', 'right', 'bottom', 'mobileControls.js', '冲刺/加速按钮'],
    ['mobile_camera_toggle_btn', '视角切换按钮', 'button', 'mobile', 'auto', '24px', '60px', '60px', 'auto', '24px', '60px', '60px', 'right', 'bottom', 'mobileControls.js', '第一/第三人称视角切换'],
    ['mobile_turn_left_btn', '左转按钮', 'button', 'mobile', 'auto', '180px', '50px', '50px', 'auto', '180px', '50px', '50px', 'right', 'bottom', 'mobileControls.js', '按住向左转向（等效桌面端Q键）'],
    ['mobile_turn_right_btn', '右转按钮', 'button', 'mobile', 'auto', '180px', '50px', '50px', 'auto', '180px', '50px', '50px', 'right', 'bottom', 'mobileControls.js', '按住向右转向（等效桌面端E键）'],
    // desktop
    ['btn_profile', '个人资料', 'button', 'desktop', '95%', '2%', '48px', '48px', '95%', '2%', '48px', '48px', 'right', 'top', 'ui.js', '右上角个人资料按钮'],
    ['btn_inventory', '物品管理', 'button', 'desktop', '95%', '8%', '48px', '48px', '95%', '8%', '48px', '48px', 'right', 'top', 'ui.js', '右上角物品管理按钮'],
    // general
    ['skill_hud', '技能栏', 'panel', 'general', 'auto', '90%', 'auto', '58px', 'auto', '85%', 'auto', '58px', 'left', 'bottom', 'skillHUD.js', '屏幕底部技能栏'],
    ['skill_voice_btn', '语音按钮', 'button', 'general', 'auto', '90%', '58px', '58px', 'auto', '85%', '58px', '58px', 'left', 'bottom', 'skillHUD.js', '语音输入按钮'],
    ['health_bar', '血条', 'healthbar', 'general', '20px', '20px', '300px', '30px', '10px', '10px', '200px', '25px', 'left', 'top', 'ui.js', '左上角生命值显示'],
    ['minimap', '小地图', 'minimap', 'general', 'auto', '20px', '200px', '200px', 'auto', '10px', '120px', '120px', 'right', 'top', 'ui.js', '右上角小地图'],
    ['portal_btn', '世界传送门按钮', 'button', 'general', '20px', '60px', 'auto', 'auto', '10px', '50px', 'auto', 'auto', 'left', 'top', 'portalManager.js', '打开传送门界面'],
    ['federation_portal_btn', '联邦传送门按钮', 'button', 'general', '20px', '200px', 'auto', 'auto', '10px', '100px', 'auto', 'auto', 'left', 'top', 'federationUI.js', '打开联邦世界传送界面'],
    // copy_coords_btn 是 debug_panel 的子元素，跟随面板，不独立控制
    ['performance_monitor', '性能监控面板', 'panel', 'general', 'auto', 'auto', '200px', '120px', 'auto', 'auto', '150px', '100px', 'right', 'bottom', 'performance-optimization.js', '显示FPS和性能指标'],
    ['debug_panel', '坐标调试面板', 'panel', 'general', 'auto', '10px', 'auto', 'auto', 'auto', '10px', 'auto', 'auto', 'right', 'top', 'main.js', '显示当前坐标、FPS、相机模式等调试信息']
  ];

  try {
    let inserted = 0;
    for (const ctrl of defaults) {
      // 补齐横屏字段（默认与竖屏相同）
      const landscapeX = ctrl[8];   // mobile_position_x
      const landscapeY = ctrl[9];   // mobile_position_y
      const landscapeW = ctrl[10];  // mobile_width
      const landscapeH = ctrl[11];  // mobile_height
      const fullCtrl = [...ctrl.slice(0, 12), landscapeX, landscapeY, landscapeW, landscapeH, ...ctrl.slice(12)];
      const result = await query(
        `INSERT INTO ui_controls (control_id, control_name, control_type, category, position_x, position_y, width, height, mobile_position_x, mobile_position_y, mobile_width, mobile_height, landscape_position_x, landscape_position_y, landscape_width, landscape_height, h_align, v_align, related_module, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT (control_id) DO NOTHING
         RETURNING id`,
        fullCtrl
      );
      if (result.rows.length > 0) inserted++;
    }

    // 修复：对于数据库中不存在的默认控件（如后续新增的转向按钮），强制补齐插入
    for (const ctrl of defaults) {
      const exists = await query('SELECT id FROM ui_controls WHERE control_id = $1', [ctrl[0]]);
      if (exists.rows.length === 0) {
        const landscapeX = ctrl[8];
        const landscapeY = ctrl[9];
        const landscapeW = ctrl[10];
        const landscapeH = ctrl[11];
        const fullCtrl = [...ctrl.slice(0, 12), landscapeX, landscapeY, landscapeW, landscapeH, ...ctrl.slice(12)];
        const result = await query(
          `INSERT INTO ui_controls (control_id, control_name, control_type, category, position_x, position_y, width, height, mobile_position_x, mobile_position_y, mobile_width, mobile_height, landscape_position_x, landscape_position_y, landscape_width, landscape_height, h_align, v_align, related_module, description)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
           RETURNING id`,
          fullCtrl
        );
        if (result.rows.length > 0) inserted++;
      }
    }

    if (inserted > 0) {
      console.log(`[UIControls] 初始化完成，新增 ${inserted} 个默认控件`);
    } else {
      console.log('[UIControls] 所有默认控件已存在，无需初始化');
    }

    // 为已存在的记录填充横屏默认值（只填充NULL字段，不覆盖用户配置）
    const updated = await query(
      `UPDATE ui_controls SET
        landscape_position_x = COALESCE(landscape_position_x, mobile_position_x, position_x),
        landscape_position_y = COALESCE(landscape_position_y, mobile_position_y, position_y),
        landscape_width = COALESCE(landscape_width, mobile_width, width),
        landscape_height = COALESCE(landscape_height, mobile_height, height)
       WHERE landscape_position_x IS NULL
          OR landscape_position_y IS NULL
          OR landscape_width IS NULL
          OR landscape_height IS NULL`
    );
    if (updated.rowCount > 0) {
      console.log(`[UIControls] 已为 ${updated.rowCount} 个现有控件填充横屏默认值`);
    }
  } catch (error) {
    console.error('[UIControls] 初始化默认控件失败:', error.message);
  }
}

module.exports = { router, ensureDefaultControls };
