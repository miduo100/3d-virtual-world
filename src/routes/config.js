/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
let _getFederationSystem = null;
let _getCentralConnector = null;
// 延迟引入，避免循环依赖
function getFederationSystem() {
  if (!_getFederationSystem) {
    _getFederationSystem = require('./federation').getFederationSystem;
  }
  return _getFederationSystem();
}
function getCentralConnector() {
  if (!_getCentralConnector) {
    _getCentralConnector = require('./federation').getCentralConnector;
  }
  return _getCentralConnector();
}

// 保存配置
router.post('/character-editor', async (req, res) => {
    try {
        const { config_key, config_value } = req.body;
        
        if (!config_key || !config_value) {
            return res.status(400).json({ error: '缺少配置键或值' });
        }

        // 使用 UPSERT 操作（INSERT ... ON CONFLICT UPDATE）
        const queryText = `
            INSERT INTO game_config (config_key, config_value, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (config_key)
            DO UPDATE SET 
                config_value = EXCLUDED.config_value,
                updated_at = NOW()
        `;

        await query(queryText, [config_key, config_value]);

        res.json({ 
            success: true, 
            message: '配置已保存' 
        });
    } catch (error) {
        console.error('保存配置失败:', error);
        res.status(500).json({ 
            error: '保存配置失败', 
            details: error.message 
        });
    }
});

// 加载配置
router.get('/character-editor', async (req, res) => {
    try {
        const { key } = req.query;
        
        if (!key) {
            return res.status(400).json({ error: '缺少配置键' });
        }

        const queryText = 'SELECT config_value FROM game_config WHERE config_key = $1';
        const result = await query(queryText, [key]);

        if (result.rows.length > 0) {
            res.json({
                config_value: result.rows[0].config_value
            });
        } else {
            res.json({
                config_value: null
            });
        }
    } catch (error) {
        console.error('加载配置失败:', error);
        res.status(500).json({ 
            error: '加载配置失败', 
            details: error.message 
        });
    }
});

// ===== 世界基础设置 =====

// 获取世界设置
router.get('/world-settings', async (req, res) => {
  try {
    const result = await query(
      `SELECT config_key, config_value FROM system_config
       WHERE config_key IN ('world_name','world_url','world_description')
       ORDER BY config_key`
    );
    const data = {};
    result.rows.forEach(r => { data[r.config_key] = r.config_value; });
    // 兜底：如果数据库还没有，返回环境变量里的值
    res.json({
      world_name:        data.world_name        || process.env.WORLD_NAME        || '',
      world_url:         data.world_url         || process.env.WORLD_URL         || '',
      world_description: data.world_description || ''
    });
  } catch (error) {
    console.error('获取世界设置失败:', error);
    res.status(500).json({ error: '获取世界设置失败', details: error.message });
  }
});

// 保存世界设置
router.put('/world-settings', async (req, res) => {
  try {
    const { world_name, world_url, world_description } = req.body;

    if (!world_name || !world_url) {
      return res.status(400).json({ error: '世界名称和世界URL为必填项' });
    }

    // 简单校验URL格式
    try { new URL(world_url); } catch {
      return res.status(400).json({ error: '世界URL格式不正确，请输入完整URL，如 https://example.com' });
    }

    const upsert = async (key, value, desc) => {
      await query(
        `INSERT INTO system_config (config_key, config_value, description, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (config_key)
         DO UPDATE SET config_value = $2, updated_at = NOW()`,
        [key, value, desc]
      );
    };

    await upsert('world_name',        world_name,        '世界名称');
    await upsert('world_url',         world_url,         '世界访问URL（对外域名）');
    await upsert('world_description', world_description || '', '世界描述');

    // 同步更新联邦系统的 world_config 表（保持两者一致）
    try {
      const existing = await query(
        'SELECT value FROM world_config WHERE key = $1',
        ['federation_config']
      );
      if (existing.rows.length > 0) {
        const fedConfig = JSON.parse(existing.rows[0].value);
        fedConfig.worldName = world_name;
        fedConfig.worldUrl  = world_url;
        await query(
          'UPDATE world_config SET value = $1, updated_at = NOW() WHERE key = $2',
          [JSON.stringify(fedConfig), 'federation_config']
        );
        // 同步更新内存中的联邦系统实例
        const fs = getFederationSystem();
        if (fs) {
          fs.worldName = world_name;
          fs.worldUrl  = world_url;
        }
      }
    } catch (syncErr) {
      console.error('同步联邦配置失败（不影响保存结果）:', syncErr.message);
    }

    // URL变更后：1) 广播通知所有已连接世界  2) 重新注册到中心世界
    const fs = getFederationSystem();
    if (fs) {
      // 1. 通知所有已连接的子世界（trusted_worlds）
      fs.broadcastWorldUrlChange().catch(err =>
        console.warn('[config] 广播URL变更通知失败:', err.message)
      );

      // 2. 重新注册到中心世界
      const connector = getCentralConnector();
      if (connector) {
        connector.registerToCentral().catch(err =>
          console.warn('[config] 通知中心世界URL变更失败:', err.message)
        );
      }
    }

    res.json({ success: true, message: '世界设置已保存' });
  } catch (error) {
    console.error('保存世界设置失败:', error);
    res.status(500).json({ error: '保存世界设置失败', details: error.message });
  }
});

// ===== 天气系统 =====

// 获取当前天气配置
router.get('/weather', async (req, res) => {
  try {
    const result = await query(
      'SELECT config_value FROM game_config WHERE config_key = \'world_weather\''
    );
    if (result.rows.length > 0) {
      res.json(JSON.parse(result.rows[0].config_value));
    } else {
      res.json({
        type: 'clear',
        intensity: 50,
        wind: 20,
        auto_cycle: false,
        cycle_interval: 30
      });
    }
  } catch (error) {
    console.error('获取天气配置失败:', error);
    res.status(500).json({ error: '获取天气配置失败', details: error.message });
  }
});

// 保存并广播天气配置（需要管理员token）
router.put('/weather', async (req, res) => {
  try {
    const { type, intensity, wind, auto_cycle, cycle_interval } = req.body;
    const validTypes = ['clear', 'rain', 'snow', 'fog', 'storm'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: '无效的天气类型' });
    }

    const weatherConfig = {
      type,
      intensity:      Math.min(100, Math.max(0, parseInt(intensity) || 50)),
      wind:           Math.min(100, Math.max(0, parseInt(wind) || 20)),
      auto_cycle:     !!auto_cycle,
      cycle_interval: Math.min(120, Math.max(5, parseInt(cycle_interval) || 30)),
      updated_at:     new Date().toISOString()
    };

    await query(
      `INSERT INTO game_config (config_key, config_value, updated_at)
       VALUES ('world_weather', $1, NOW())
       ON CONFLICT (config_key)
       DO UPDATE SET config_value = $1, updated_at = NOW()`,
      [JSON.stringify(weatherConfig)]
    );

    // 通过 WebSocket 广播给所有玩家
    try {
      const { broadcastToAll } = require('../websocket/wsServer');
      broadcastToAll({
        type: 'WEATHER_CHANGE',
        payload: weatherConfig
      });
    } catch (wsErr) {
      console.warn('WebSocket广播天气失败（可能WS尚未初始化）:', wsErr.message);
    }

    res.json({ success: true, message: '天气已更新并广播', weather: weatherConfig });
  } catch (error) {
    console.error('保存天气配置失败:', error);
    res.status(500).json({ error: '保存天气配置失败', details: error.message });
  }
});

// ===== 系统语言设置 =====

// 获取系统语言设置（公开接口，前端可调用）
router.get('/language', async (req, res) => {
  try {
    const result = await query(
      'SELECT config_value FROM system_config WHERE config_key = $1',
      ['default_language']
    );
    
    if (result.rows.length > 0) {
      res.json({ language: result.rows[0].config_value });
    } else {
      res.json({ language: 'zh-CN' }); // 默认中文
    }
  } catch (error) {
    console.error('获取语言设置失败:', error);
    res.status(500).json({ error: 'Failed to get language setting', details: error.message });
  }
});

// 保存系统语言设置（需要管理员权限）
router.put('/language', async (req, res) => {
  try {
    const { language } = req.body;
    
    if (!language || !['zh-CN', 'en-US'].includes(language)) {
      return res.status(400).json({ error: 'Invalid language. Use zh-CN or en-US' });
    }

    await query(
      `INSERT INTO system_config (config_key, config_value, description, updated_at)
       VALUES ('default_language', $1, '系统默认语言', NOW())
       ON CONFLICT (config_key)
       DO UPDATE SET config_value = $1, updated_at = NOW()`,
      [language]
    );

    // 通过 WebSocket 广播语言切换消息（所有在线用户实时切换）
    try {
      const { broadcastToAll } = require('../websocket/wsServer');
      broadcastToAll({
        type: 'LANGUAGE_CHANGE',
        payload: { language }
      });
      console.log(`[Language] 已广播语言切换: ${language}`);
    } catch (wsErr) {
      console.warn('[Language] WebSocket广播失败:', wsErr.message);
    }

    res.json({ success: true, message: 'Language updated', language });
  } catch (error) {
    console.error('保存语言设置失败:', error);
    res.status(500).json({ error: 'Failed to save language setting', details: error.message });
  }
});

// ===== SEO 配置 =====

// 获取 SEO 配置（公开接口，前端可调用）
router.get('/seo', async (req, res) => {
  try {
    const keys = ['seo_title', 'seo_description', 'seo_keywords'];
    const result = await query(
      `SELECT config_key, config_value FROM system_config
       WHERE config_key = ANY($1)`,
      [keys]
    );
    const data = {};
    result.rows.forEach(r => { data[r.config_key] = r.config_value || ''; });

    res.json({
      seo_title:       data.seo_title       || '创世虚拟世界CRM系统',
      seo_description: data.seo_description || '',
      seo_keywords:    data.seo_keywords    || ''
    });
  } catch (error) {
    console.error('获取SEO配置失败:', error);
    res.status(500).json({ error: '获取SEO配置失败' });
  }
});

// 保存 SEO 配置（需要管理员权限）
router.put('/seo', async (req, res) => {
  try {
    const { seo_title, seo_description, seo_keywords } = req.body;

    const upsert = async (key, value, desc) => {
      await query(
        `INSERT INTO system_config (config_key, config_value, description, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (config_key)
         DO UPDATE SET config_value = $2, description = $3, updated_at = NOW()`,
        [key, value || '', desc]
      );
    };

    await upsert('seo_title',       seo_title,       'SEO标题（Title）');
    await upsert('seo_description', seo_description, 'SEO描述（Description）');
    await upsert('seo_keywords',    seo_keywords,    'SEO关键词（Keywords）');

    res.json({ success: true, message: 'SEO配置已保存' });
  } catch (error) {
    console.error('保存SEO配置失败:', error);
    res.status(500).json({ error: '保存SEO配置失败' });
  }
});

module.exports = router;
