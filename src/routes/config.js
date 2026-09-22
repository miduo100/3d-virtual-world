/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { resolveSky } = require('./sky');
const { authenticateAdminToken } = require('../middleware/adminAuth');
// 鉴权口径（2026-09-22 v7 收口）：
//   写接口需管理员 token：POST /character-editor、PUT /world-settings、PUT /weather、PUT /language、PUT /seo
//   读接口保持公开（游戏前端无 token 调用）：GET /world-settings、/lod-enabled、/weather、/language、/seo、/character-editor
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

// 保存配置（需要管理员 token）
router.post('/character-editor', authenticateAdminToken, async (req, res) => {
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
       WHERE config_key IN ('world_name','world_url','world_description','lod_enabled','lod_near_dist','lod_mid_far_dist','lod_far_dist','lod_mid_cap_mode','lod_mid_max_faces','lod_mid_percent','lod_low_target_faces')
       ORDER BY config_key`
    );
    const data = {};
    result.rows.forEach(r => { data[r.config_key] = r.config_value; });
    // 兜底：如果数据库还没有，返回环境变量里的值
    res.json({
      world_name:        data.world_name        || process.env.WORLD_NAME        || '',
      world_url:         data.world_url         || process.env.WORLD_URL         || '',
      world_description: data.world_description || '',
      // 模型 LOD 分级渲染开关：缺省视为开启（只有显式存的 'false' 才关闭）
      lod_enabled:       data.lod_enabled !== 'false',
      // LOD 分带距离（二期 C，2026-09-12 用户要求后台可调）：缺省 30/60/400
      lod_near_dist:     _lodDist(data.lod_near_dist, 30),
      lod_mid_far_dist:  _lodDist(data.lod_mid_far_dist, 60),
      lod_far_dist:      _lodDist(data.lod_far_dist, 400),
      // 变体压缩标准（2026-09-14 用户决策，后台可调）：生成中/低模时按此执行
      lod_mid_cap_mode:     (data.lod_mid_cap_mode === 'percent') ? 'percent' : 'faces',
      lod_mid_max_faces:    _lodDist(data.lod_mid_max_faces, 50000),
      lod_mid_percent:      _lodDist(data.lod_mid_percent, 25),
      lod_low_target_faces: _lodDist(data.lod_low_target_faces, 100)
    });
  } catch (error) {
    console.error('获取世界设置失败:', error);
    res.status(500).json({ error: '获取世界设置失败', details: error.message });
  }
});

/** LOD 分带距离解析：非法/缺失返回默认值 */
function _lodDist(raw, def) {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

// 保存世界设置（需要管理员 token；匿名可写会导致联邦 URL 连锁污染）
router.put('/world-settings', authenticateAdminToken, async (req, res) => {
  try {
    const { world_name, world_url, world_description } = req.body;

    if (!world_name || !world_url) {
      return res.status(400).json({ error: '世界名称和世界URL为必填项' });
    }

    // 简单校验URL格式
    try { new URL(world_url); } catch {
      return res.status(400).json({ error: '世界URL格式不正确，请输入完整URL，如 https://example.com' });
    }

    // 模型 LOD 分级渲染开关（可选字段：未传 = 不改动现有值，避免其他调用方误清空）
    let lodEnabled = null;
    if (req.body.lod_enabled !== undefined && req.body.lod_enabled !== null) {
      const raw = String(req.body.lod_enabled).toLowerCase();
      if (raw !== 'true' && raw !== 'false') {
        return res.status(400).json({ error: 'lod_enabled 必须是 true 或 false' });
      }
      lodEnabled = raw;
    }

    // LOD 分带距离（二期 C，可选字段：未传 = 不改动现有值）
    // 约束：均为正整数，且 高模带 < 中模带 < 低模带；合法范围防止填出离谱值
    const LOD_DIST_RULES = [
      { key: 'lod_near_dist',    min: 5,   max: 150 },
      { key: 'lod_mid_far_dist', min: 10,  max: 300 },
      { key: 'lod_far_dist',     min: 50,  max: 2000 },
    ];
    const lodDists = {};
    for (const rule of LOD_DIST_RULES) {
      const v = req.body[rule.key];
      if (v === undefined || v === null || v === '') continue;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < rule.min || n > rule.max) {
        return res.status(400).json({ error: `${rule.key} 必须是 ${rule.min}~${rule.max} 之间的整数` });
      }
      lodDists[rule.key] = String(n);
    }

    // 变体压缩标准（可选字段：未传 = 不改动现有值）
    let midCapMode = null;
    if (req.body.lod_mid_cap_mode !== undefined && req.body.lod_mid_cap_mode !== null && req.body.lod_mid_cap_mode !== '') {
      const m = String(req.body.lod_mid_cap_mode).toLowerCase();
      if (m !== 'faces' && m !== 'percent') {
        return res.status(400).json({ error: 'lod_mid_cap_mode 必须是 faces 或 percent' });
      }
      midCapMode = m;
    }
    const LOD_FACE_RULES = [
      { key: 'lod_mid_max_faces',    min: 1000, max: 5000000 },
      { key: 'lod_mid_percent',      min: 1,    max: 99 },
      { key: 'lod_low_target_faces', min: 16,   max: 2000 },
    ];
    const lodFaces = {};
    for (const rule of LOD_FACE_RULES) {
      const v = req.body[rule.key];
      if (v === undefined || v === null || v === '') continue;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n) || n < rule.min || n > rule.max) {
        return res.status(400).json({ error: `${rule.key} 必须是 ${rule.min}~${rule.max} 之间的整数` });
      }
      lodFaces[rule.key] = String(n);
    }
    if (lodDists.lod_near_dist && lodDists.lod_mid_far_dist
      && parseInt(lodDists.lod_near_dist, 10) >= parseInt(lodDists.lod_mid_far_dist, 10)) {
      return res.status(400).json({ error: '高模带距离必须小于中模带距离' });
    }
    if (lodDists.lod_mid_far_dist && lodDists.lod_far_dist
      && parseInt(lodDists.lod_mid_far_dist, 10) >= parseInt(lodDists.lod_far_dist, 10)) {
      return res.status(400).json({ error: '中模带距离必须小于低模带距离' });
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
    if (lodEnabled !== null) {
      await upsert('lod_enabled', lodEnabled, '模型LOD分级渲染开关（true/false）');
    }
    const LOD_DIST_DESC = {
      lod_near_dist: 'LOD高模带距离(米)，玩家到模型表面 ≤ 该值用高模',
      lod_mid_far_dist: 'LOD中模带距离(米)，高模带外 ≤ 该值用中模',
      lod_far_dist: 'LOD低模带距离(米)，中模带外 ≤ 该值用低模，超出显示蓝方块',
    };
    for (const [key, value] of Object.entries(lodDists)) {
      await upsert(key, value, LOD_DIST_DESC[key]);
    }
    if (midCapMode !== null) {
      await upsert('lod_mid_cap_mode', midCapMode, 'LOD中模压缩方式：faces=按面数上限 / percent=按压缩百分比');
    }
    const LOD_FACE_DESC = {
      lod_mid_max_faces: 'LOD中模面数上限（faces 模式：不管源多大，中模压到该面数以内）',
      lod_mid_percent: 'LOD中模压缩百分比（percent 模式：中模=源×该%）',
      lod_low_target_faces: 'LOD低模目标面数（低模样式标准）',
    };
    for (const [key, value] of Object.entries(lodFaces)) {
      await upsert(key, value, LOD_FACE_DESC[key]);
    }

    // 同步更新联邦系统的 world_config 表（保持两者一致）
    try {
      const FederationSystem = require('../federationSystem');
      const existing = await query(
        'SELECT value FROM world_config WHERE key = $1',
        ['federation_config']
      );
      if (existing.rows.length > 0) {
        const fedConfig = JSON.parse(existing.rows[0].value);
        fedConfig.worldName  = world_name;
        fedConfig.worldUrl   = world_url;
        fedConfig.url_source = 'manual';  // 标记：管理员手工设置，重启时 autoFixWorldUrl 跳过覆盖
        await query(
          'UPDATE world_config SET value = $1, updated_at = NOW() WHERE key = $2',
          [JSON.stringify(fedConfig), 'federation_config']
        );
      } else {
        // federation_config 不存在（新部署/精简导入场景）：创建完整配置并打上 manual 标记，
        // 否则重启后 autoFixWorldUrl 会把公网地址覆盖为本机内网IP
        const worldId = `world_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const { publicKey, privateKey } = FederationSystem.generateKeyPair();
        const newFedConfig = {
          worldId,
          worldName: world_name,
          worldUrl: world_url,
          privateKey,
          publicKey,
          url_source: 'manual'
        };
        await query(
          `INSERT INTO world_config (key, value, created_at, updated_at)
           VALUES ($1, $2, NOW(), NOW())`,
          ['federation_config', JSON.stringify(newFedConfig)]
        );
        console.log('✅ [world-settings] 已创建 federation_config（含 manual 标记）');
      }
      // 同步更新内存中的联邦系统实例（统一处理）
      const fs = getFederationSystem();
      if (fs) {
        fs.worldName = world_name;
        fs.worldUrl  = world_url;
      }
    } catch (syncErr) {
      console.error('同步联邦配置失败（不影响保存结果）:', syncErr.message);
    }

    // URL变更后：1) 广播通知所有已连接世界  2) 重新注册到中心世界
    const fs = getFederationSystem();
    let federationWarning = null;
    if (fs) {
      // 1. 通知所有已连接的子世界（trusted_worlds）
      fs.broadcastWorldUrlChange().catch(err =>
        console.warn('[config] 广播URL变更通知失败:', err.message)
      );

      // 2. 重新注册到中心世界
      //    本机 URL 为内网时 registerToCentral 会立即返回 private_url（不发请求），
      //    可同步等待并把警告附带进保存响应；公网地址仍保持异步 fire-and-forget
      const { classifyUrlHost } = require('../services/worldReachabilityChecker');
      const connector = getCentralConnector();
      if (connector) {
        if (classifyUrlHost(fs.worldUrl).type !== 'public' && process.env.FEDERATION_ALLOW_PRIVATE !== '1') {
          const regRes = await connector.registerToCentral();
          if (regRes && regRes.reason === 'private_url') {
            console.warn('[config] 中心世界注册跳过：本世界 URL 为内网地址');
            federationWarning = '当前世界地址为内网/本机地址，其他用户无法访问，未注册到联邦。' +
              '如需加入联邦，请配置公网域名或端口映射后重新保存。';
          }
        } else {
          connector.registerToCentral().catch(err =>
            console.warn('[config] 通知中心世界URL变更失败:', err.message)
          );
        }
      }
    }

    res.json({ success: true, message: '世界设置已保存', federationWarning });
  } catch (error) {
    console.error('保存世界设置失败:', error);
    res.status(500).json({ error: '保存世界设置失败', details: error.message });
  }
});

// ===== 模型 LOD 分级渲染开关（公开只读，游戏前端使用） =====

// 游戏前端启动时读取；缺省视为开启，查询失败也不阻断（返回默认 true）
router.get('/lod-enabled', async (req, res) => {
  try {
    const result = await query(
      `SELECT config_key, config_value FROM system_config
       WHERE config_key IN ('lod_enabled','lod_near_dist','lod_mid_far_dist','lod_far_dist')`
    );
    const data = {};
    result.rows.forEach(r => { data[r.config_key] = r.config_value; });
    res.json({
      enabled: data.lod_enabled !== 'false',
      // 分带距离（二期 C）：后台可调，缺省 30/60/400；前端按此动态分带
      near: _lodDist(data.lod_near_dist, 30),
      mid: _lodDist(data.lod_mid_far_dist, 60),
      far: _lodDist(data.lod_far_dist, 400),
    });
  } catch (error) {
    console.error('获取LOD分级开关失败:', error);
    res.json({ enabled: true, near: 30, mid: 60, far: 400 });
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
      const cfg = JSON.parse(result.rows[0].config_value);
      cfg.sky = await resolveSky(cfg); // 内联当前选中的天空（null = 默认天空）
      res.json(cfg);
    } else {
      res.json({
        type: 'clear',
        intensity: 50,
        wind: 20,
        auto_cycle: false,
        cycle_interval: 30,
        sky_id: 'default',
        sky: null
      });
    }
  } catch (error) {
    console.error('获取天气配置失败:', error);
    res.status(500).json({ error: '获取天气配置失败', details: error.message });
  }
});

// 保存并广播天气配置（需要管理员 token，已接 authenticateAdminToken）
router.put('/weather', authenticateAdminToken, async (req, res) => {
  try {
    const { type, intensity, wind, auto_cycle, cycle_interval, sky_id } = req.body;
    const validTypes = ['clear', 'rain', 'snow', 'fog', 'storm'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: '无效的天气类型' });
    }

    // 天空库选中项：'default'（默认天空）或 world_sky_presets.id
    let skyId = 'default';
    if (sky_id !== undefined && sky_id !== null && sky_id !== '' && sky_id !== 'default') {
      const skyIdNum = parseInt(sky_id, 10);
      if (!Number.isInteger(skyIdNum)) {
        return res.status(400).json({ error: '无效的天空ID' });
      }
      const skyExists = await query('SELECT id FROM world_sky_presets WHERE id = $1', [skyIdNum]);
      if (!skyExists.rows.length) {
        return res.status(404).json({ error: '选中的天空不存在' });
      }
      skyId = skyIdNum;
    }

    const weatherConfig = {
      type,
      intensity:      Math.min(100, Math.max(0, parseInt(intensity) || 50)),
      wind:           Math.min(100, Math.max(0, parseInt(wind) || 20)),
      auto_cycle:     !!auto_cycle,
      cycle_interval: Math.min(120, Math.max(5, parseInt(cycle_interval) || 30)),
      sky_id:         skyId,
      sky:            await resolveSky({ sky_id: skyId }),
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

// 保存系统语言设置（需要管理员 token，已接 authenticateAdminToken）
router.put('/language', authenticateAdminToken, async (req, res) => {
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

// 保存 SEO 配置（需要管理员 token，已接 authenticateAdminToken）
router.put('/seo', authenticateAdminToken, async (req, res) => {
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
