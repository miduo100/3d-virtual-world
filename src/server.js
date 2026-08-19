/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const dotenv = require('dotenv');
const path = require('path');

// 加载环境变量 - 明确指定.env路径
dotenv.config({ path: path.join(__dirname, '..', '.env') });

// ==================== JWT密钥自动修复（弱密钥/占位符自动替换为随机密钥） ====================
// 部署到宝塔面板等新环境时，即使忘记手动修改 .env 中的密钥，
// 首次启动也会自动生成安全随机密钥并写回 .env，杜绝默认密钥泄露风险
require('./services/secretAutoFix').autoFixSecrets();

// ==================== 启动前关键环境变量校验 ====================
if (!process.env.JWT_SECRET) {
  console.error('[FATAL] 缺少环境变量 JWT_SECRET，请在 .env 文件中配置');
  process.exit(1);
}
if (!process.env.ADMIN_JWT_SECRET) {
  console.error('[FATAL] 缺少环境变量 ADMIN_JWT_SECRET，请在 .env 文件中配置');
  process.exit(1);
}

const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
// 启用Gzip压缩 - 关键优化！5.8MB PNG可压缩到几百KB
app.use(compression({
  level: 6,  // 压缩级别 1-9，越高压缩率越好但CPU消耗越大
  threshold: 1024,  // 大于1KB才压缩
  filter: (req, res) => {
    // 静态资源都启用压缩
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));
// 静态资源缓存配置
const oneDay = 1000 * 60 * 60 * 24;
const staticCacheOptions = {
  maxAge: oneDay * 7,    // 默认缓存7天
  etag: true,            // 启用ETag（用于更新时失效）
  lastModified: true,    // 启用Last-Modified
  setHeaders: (res, filePath) => {
    // 图片、模型等不可执行资源 - 强缓存30天
    if (filePath.match(/\.(png|jpg|jpeg|gif|glb|gltf|e8j|mp4|webm|svg|ico|webp)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
    // HTML/JS/CSS 使用较短缓存（方便更新部署）
    else if (filePath.match(/\.(html|js|css)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
    // 字体文件缓存30天
    else if (filePath.match(/\.(woff2?|ttf|otf|eot)$/i)) {
      res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
    }
  }
};

app.use(express.static(path.join(__dirname, '../public'), staticCacheOptions));
app.use('/i18n', express.static(path.join(__dirname, '../public/i18n'), staticCacheOptions));
app.use('/node_modules', express.static(path.join(__dirname, '../node_modules'), staticCacheOptions));

// Database initialization
const { initializeDatabase, query } = require('./database/db');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const worldRoutes = require('./routes/world');
const shopRoutes = require('./routes/shop');
const plotRoutes = require('./routes/plot');
const skillRoutes = require('./routes/skills');
const monsterRoutes = require('./routes/monster');
const portalRoutes = require('./routes/portal');
const adminRoutes = require('./routes/admin');
const adminAuthRoutes = require('./routes/adminAuth');
const adminMaintenanceRoutes = require('./routes/adminMaintenance');
const tripoRoutes = require('./routes/tripo');
const aiAssistantRoutes = require('./routes/aiAssistant');
const geometryBuildingRoutes = require('./routes/geometryBuilding');
const { router: federationRouter, initFederation } = require('./routes/federation');
const federationTrustRoutes = require('./routes/federationTrust');
const aiSceneGeneratorRoutes = require('./routes/aiSceneGenerator');
const uploadedModelsRoutes = require('./routes/uploadedModels');
const aiProvidersRoutes = require('./routes/aiProviders');
const tagsRoutes = require('./routes/tags');
const configRoutes = require('./routes/config');
const characterTemplatesRoutes = require('./routes/characterTemplates');
const inventoryRoutes = require('./routes/inventory');
const npcRoutes = require('./routes/npc');
const customNpcRoutes = require('./routes/customNpc');
const { router: uiControlsRouter, ensureDefaultControls } = require('./routes/uiControls');
const mediaRoutes = require('./routes/media');
const threeDgsRoutes = require('./routes/threeDgs');
const aiFactoryRoutes = require('./routes/aiFactory');
const galleryRoutes = require('./routes/gallery');
const modelGuardRoutes = require('./routes/modelGuard');
const threejsCodeBlocksRoutes = require('./routes/threejsCodeBlocks');
const threejsImportRoutes = require('./routes/threejsImport');
const securityQuestionsRoutes = require('./routes/securityQuestions');
const subscriptionRoutes = require('./routes/subscription');
const worldSpatialRoutes = require('./routes/worldSpatial');

app.use('/api/auth', authRoutes);
app.use('/api/admin', securityQuestionsRoutes);  // 安全问题管理（需管理员认证）
app.use('/api/users', userRoutes);
app.use('/api/world/spatial', worldSpatialRoutes);
app.use('/api/world', worldRoutes);
app.use('/api/shop', shopRoutes);
app.use('/api/plot', plotRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/monster', monsterRoutes);
app.use('/api/portal', portalRoutes);
app.use('/api/admin-auth', adminAuthRoutes);  // 管理员认证路由
app.use('/api/admin', adminRoutes);  // 管理后台路由（需要管理员认证）
app.use('/api/admin/maintenance', adminMaintenanceRoutes);  // 维护工具路由
app.use('/api/tripo', tripoRoutes);  // Tripo AI 3D生成路由
app.use('/api/ai', aiAssistantRoutes);  // AI助手路由
app.use('/api/ai-providers', aiProvidersRoutes);  // AI提供商配置路由
app.use('/api/geometry-building', geometryBuildingRoutes);  // 几何体建筑路由
app.use('/api/federation', federationRouter);  // 联邦系统路由
app.use('/api/federation', federationTrustRoutes);  // 联邦信任审批路由（开关/待审批请求）
app.use('/api/ai-scene', aiSceneGeneratorRoutes);  // AI场景生成路由
app.use('/api/ui-controls', uiControlsRouter);  // UI控件路由（包含公开接口和管理员接口）
app.use('/api', uploadedModelsRoutes);  // 上传模型路由
app.use('/api/tags', tagsRoutes);  // 标签管理路由
app.use('/api/config', configRoutes);  // 配置管理路由
app.use('/api/character-templates', characterTemplatesRoutes);  // 角色模板路由（管理员）
app.use('/api/inventory', inventoryRoutes);  // 背包/奖励池/掉落物路由
app.use('/api/npc', npcRoutes);  // NPC管理路由
app.use('/api/custom-npc', customNpcRoutes);  // 定制NPC路由
app.use('/api/media', mediaRoutes);  // 媒体图片上传路由
app.use('/api/three-dgs', threeDgsRoutes);  // 3D高斯泼溅场景公开只读列表路由
app.use('/api/ai-factory', aiFactoryRoutes);  // AI动作工厂路由
app.use('/api/gallery', galleryRoutes);  // 画廊系统路由
app.use('/api/model-guard', modelGuardRoutes);  // 远程模型守卫路由（公开读）
app.use('/api/admin/model-guard', modelGuardRoutes);  // 远程模型守卫管理接口（PUT 需管理员鉴权）
app.use('/api/threejs-blocks', threejsCodeBlocksRoutes);  // Three.js 代码库路由（公开读，写需管理员）
app.use('/api/threejs-blocks', threejsImportRoutes);    // Three.js URL导入路由（管理员）
app.use('/api/subscription', subscriptionRoutes);  // 订阅管理路由

// 公开模板接口：普通用户 Token 可访问（access_level=public 的激活模板）
app.get('/api/public/character-templates', async (req, res) => {
  const { query } = require('./database/db');
  try {
    const result = await query(`
      SELECT ct.id, ct.name, ct.description, ct.glb_url, ct.thumbnail_url,
             ct.anim_idle_url,
             ct.anim_walk_url, ct.anim_run_url, ct.anim_jump_url,
             ct.anim_attack1_url, ct.anim_attack2_url, ct.anim_attack3_url,
             ct.anim_hit_url, ct.anim_death_url,
             ct.anim_turn_left_url, ct.anim_turn_right_url,
             ct.anim_attack_stab_url, ct.anim_attack_slash_url,
             ct.anim_attack_swing_url, ct.anim_attack_uppercut_url,
             ct.anim_draw_sword_url, ct.anim_sheath_url,
             ct.anim_set, ct.anim_sounds, ct.weapon_sounds,
             ct.weapon_config,
             ct.weapon_id,
             ct.calibration_config,
             ct.weapon_socket_config,
             ct.bone_mapping_config,
             ct.fit_config,
             ct.is_calibrated,
             ct.calibrated_at,
             ct.calibration_version,
             ct.access_level, ct.character_role, ct.sort_order,
             w.name AS weapon_name, w.weapon_type AS weapon_type_from_lib,
             w.glb_url AS weapon_glb_url, w.config AS weapon_lib_config
      FROM character_templates ct
      LEFT JOIN weapons w ON ct.weapon_id = w.id AND w.is_active = TRUE
      WHERE ct.is_active = TRUE
      ORDER BY ct.sort_order, ct.created_at DESC
    `);

    // ── 收集所有模板的 anim_set 中的动画 ID ──
    const allAnimIds = new Set();
    const parsedResult = result.rows.map(tmpl => {
      let animSet = {};
      try {
        animSet = tmpl.anim_set ? (typeof tmpl.anim_set === 'string' ? JSON.parse(tmpl.anim_set) : tmpl.anim_set) : {};
      } catch(e) { /* ignore */ }
      Object.values(animSet).filter(v => v).forEach(id => allAnimIds.add(id));
      return { ...tmpl, _animSet: animSet };
    });

    // ── 批量查询 animation_library，解析 anim_set → glb_url ──
    const animUrlMap = {};
    if (allAnimIds.size > 0) {
      const animLib = await query(
        'SELECT id, anim_key, glb_url FROM animation_library WHERE id = ANY($1) AND is_active = TRUE',
        [Array.from(allAnimIds)]
      );
      animLib.rows.forEach(a => { animUrlMap[a.id] = a.glb_url; });
      console.log(`[public-templates] anim_set 解析: ${allAnimIds.size} 个ID → ${animLib.rows.length} 个有效动画`);
    }
    
    // 解析 JSON 字段
    const templates = parsedResult.map(tmpl => {
      const parsed = { ...tmpl };
      try {
        parsed.anim_sounds = tmpl.anim_sounds ? (typeof tmpl.anim_sounds === 'object' ? tmpl.anim_sounds : JSON.parse(tmpl.anim_sounds)) : null;
        parsed.weapon_sounds = tmpl.weapon_sounds ? (typeof tmpl.weapon_sounds === 'object' ? tmpl.weapon_sounds : JSON.parse(tmpl.weapon_sounds)) : null;
        // 优先用 weapons 表的 config 合并覆盖旧 weapon_config 字段
        const _parseJsonField = (v) => {
          if (!v) return {};
          if (typeof v === 'object') return v;
          try { return JSON.parse(v); } catch(e) { return {}; }
        };
        const baseWeaponConfig = _parseJsonField(tmpl.weapon_config);
        if (tmpl.weapon_id) console.log(`[public-templates] 原始 weapon_id=${tmpl.weapon_id} weapon_lib_config 类型=${typeof tmpl.weapon_lib_config} 值=`, tmpl.weapon_lib_config);
        if (tmpl.weapon_id && tmpl.weapon_lib_config) {
          const libConfig = _parseJsonField(tmpl.weapon_lib_config);
          parsed.weapon_config = Object.assign({}, baseWeaponConfig, libConfig, {
            weapon_id: tmpl.weapon_id,
            weapon_name: tmpl.weapon_name || null,
            weapon_type: tmpl.weapon_type_from_lib || null,
            glb_url: tmpl.weapon_glb_url || null,
          });
          console.log(`[public-templates] 模板 ${tmpl.name} weapon_config 合并结果:`, JSON.stringify(parsed.weapon_config));
        } else {
          parsed.weapon_config = Object.keys(baseWeaponConfig).length ? baseWeaponConfig : null;
        }
        // 清理联表附加字段，不暴露给前端
        delete parsed.weapon_lib_config;
        delete parsed.weapon_name;
        delete parsed.weapon_type_from_lib;
        delete parsed.weapon_glb_url;
        parsed.calibration_config = tmpl.calibration_config ? (typeof tmpl.calibration_config === 'object' ? tmpl.calibration_config : JSON.parse(tmpl.calibration_config)) : null;
        parsed.weapon_socket_config = tmpl.weapon_socket_config ? (typeof tmpl.weapon_socket_config === 'object' ? tmpl.weapon_socket_config : JSON.parse(tmpl.weapon_socket_config)) : null;
        parsed.bone_mapping_config = tmpl.bone_mapping_config ? (typeof tmpl.bone_mapping_config === 'object' ? tmpl.bone_mapping_config : JSON.parse(tmpl.bone_mapping_config)) : null;
        parsed.fit_config = tmpl.fit_config ? (typeof tmpl.fit_config === 'object' ? tmpl.fit_config : JSON.parse(tmpl.fit_config)) : null;
        parsed.is_calibrated = Boolean(tmpl.is_calibrated);
        parsed.calibrated_at = tmpl.calibrated_at ? new Date(tmpl.calibrated_at) : null;
        parsed.calibration_version = tmpl.calibration_version || 1;

        // ── 🆕 从 anim_set 解析动画 URL（新动作库架构）──
        // 若旧字段为空，且 anim_set 中有对应动画，则用 animUrlMap 填充
        const animSet = tmpl._animSet || {};
        const ALL_ANIM_KEYS = ['idle','walk','run','jump','attack1','attack2','attack3','hit','death',
          'turn_left','turn_right','attack_stab','attack_slash','attack_swing','attack_uppercut','draw_sword','sheath'];
        let animSetResolvedCount = 0;
        ALL_ANIM_KEYS.forEach(k => {
          const oldField = `anim_${k}_url`;
          const existingVal = parsed[oldField];
          // 只有旧字段为空时，才用 anim_set + animUrlMap 填充
          if (!existingVal || existingVal === 'null' || existingVal === '') {
            const animLibId = animSet[k];
            if (animLibId && animUrlMap[animLibId]) {
              parsed[oldField] = animUrlMap[animLibId];
              animSetResolvedCount++;
            }
          }
        });
        // 清理内部字段
        delete parsed._animSet;
        if (animSetResolvedCount > 0) {
          console.log(`[public-templates] 模板 ${tmpl.name}: anim_set 解析了 ${animSetResolvedCount} 个动画`);
        }

        console.log(`[public-templates] 解析模板 ${tmpl.name} 成功:`, parsed.calibration_config);
      } catch (error) {
        console.error(`[public-templates] 解析模板 ${tmpl.name} 失败:`, error);
      }
      return parsed;
    });
    
    res.json({ templates });
  } catch (e) {
    console.error('[public-templates]', e);
    res.status(500).json({ error: '获取模板列表失败' });
  }
});

// 调试接口：查看武器库和模板武器绑定情况（临时，含JOIN合并结果）
app.get('/api/debug/weapons', async (req, res) => {
  const { query } = require('./database/db');
  try {
    const weapons = await query('SELECT id, name, weapon_type, config FROM weapons WHERE is_active=TRUE ORDER BY created_at DESC');
    const tmplResult = await query(`
      SELECT ct.id, ct.name, ct.weapon_id, ct.weapon_config,
             w.name AS weapon_name, w.config AS weapon_lib_config
      FROM character_templates ct
      LEFT JOIN weapons w ON ct.weapon_id = w.id AND w.is_active = TRUE
      WHERE ct.is_active = TRUE ORDER BY ct.sort_order
    `);
    const _p = (v) => { if (!v) return {}; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch(e) { return {}; } };
    const templates = tmplResult.rows.map(t => ({
      id: t.id, name: t.name, weapon_id: t.weapon_id,
      weapon_config_raw: _p(t.weapon_config),
      weapon_lib_config: _p(t.weapon_lib_config),
      weapon_config_merged: t.weapon_id && t.weapon_lib_config
        ? Object.assign({}, _p(t.weapon_config), _p(t.weapon_lib_config))
        : _p(t.weapon_config),
    }));
    res.json({ weapons: weapons.rows, templates });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// 公开技能接口：无需 Token，读取指定模板的技能列表
app.get('/api/public/character-templates/:id/skills', async (req, res) => {
  const { query } = require('./database/db');
  try {
    const result = await query(
      'SELECT * FROM template_skills WHERE template_id = $1 ORDER BY sort_order, created_at',
      [req.params.id]
    );
    res.json({ skills: result.rows });
  } catch (e) {
    console.error('[public-skills]', e);
    res.status(500).json({ error: '获取技能列表失败' });
  }
});

// 公开武器库接口
app.get('/api/public/character-templates/weapons', async (req, res) => {
  const { query } = require('./database/db');
  try {
    const result = await query(
      'SELECT id, name, weapon_type, glb_url, config, icon_emoji FROM weapons WHERE is_active=TRUE ORDER BY sort_order, created_at DESC'
    );
    res.json({ weapons: result.rows });
  } catch (e) {
    console.error('[public-weapons]', e);
    res.status(500).json({ error: '获取武器库失败' });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize and start server

/**
 * 自检并自动修正 world_url
 * 场景：导入他人数据库后 world_url 指向别人的域名（如 miduo100.com）
 * 自动修正为 http://本机IP:PORT
 */
async function autoFixWorldUrl() {
  const os = require('os');

  try {
    const result = await query(
      `SELECT config_value FROM system_config WHERE config_key = 'world_url'`
    );

    if (result.rows.length === 0 || !result.rows[0].config_value) {
      // 没有记录，稍后 initFederation 会生成默认值
      return;
    }

    const currentUrl = result.rows[0].config_value.trim();

    // 解析 hostname
    let hostname;
    try {
      hostname = new URL(currentUrl).hostname;
    } catch {
      // URL格式异常，跳过
      return;
    }

    // 收集本机所有IP
    const localIps = new Set(['localhost', '127.0.0.1', '::1']);
    const interfaces = os.networkInterfaces();
    for (const [, addrs] of Object.entries(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === 'IPv4' && !addr.internal) {
          localIps.add(addr.address);
        }
      }
    }

    // 是否属于本机？
    if (localIps.has(hostname) || hostname.endsWith('.local') || hostname === os.hostname()) {
      // 是本机地址，无需修正
      return;
    }

    // 检查 url_source 标记：管理员手动设置过的，跳过自动修正
    const urlCheck = await query(
      `SELECT value FROM world_config WHERE key = 'federation_config'`
    );
    if (urlCheck.rows.length > 0) {
      const fedCfg = JSON.parse(urlCheck.rows[0].value);
      if (fedCfg.url_source === 'manual') {
        console.log(`\n🔧 [自检] world_url 由管理员手动设置为 "${currentUrl}"，跳过自动修正\n`);
        return;
      }
    }

    // 修正：指向外部域名 → 自动改为本机IP
    const port = process.env.PORT || 3002;
    let serverIp = '127.0.0.1';
    for (const ip of localIps) {
      if (ip !== 'localhost' && ip !== '127.0.0.1' && ip !== '::1') {
        serverIp = ip;
        break;
      }
    }

    const correctedUrl = `http://${serverIp}:${port}`;
    console.log(`\n🔧 [自检] world_url 指向外部域名 "${hostname}"`);
    console.log(`🔧 [自检] 自动修正为 "${correctedUrl}"\n`);

    // 修正 system_config
    await query(
      `INSERT INTO system_config (config_key, config_value, description, updated_at)
       VALUES ('world_url', $1, '世界访问URL（部署自检自动修正）', NOW())
       ON CONFLICT (config_key) DO UPDATE SET config_value = $1, updated_at = NOW()`,
      [correctedUrl]
    );

    // 修正 world_config 中的 federation_config JSON（否则 initFederation 读到旧URL）
    const fedResult = await query(
      `SELECT value FROM world_config WHERE key = 'federation_config'`
    );
    if (fedResult.rows.length > 0) {
      const fedConfig = JSON.parse(fedResult.rows[0].value);
      if (fedConfig.worldUrl && fedConfig.worldUrl !== correctedUrl) {
        fedConfig.worldUrl = correctedUrl;
        await query(
          `UPDATE world_config SET value = $1, updated_at = NOW() WHERE key = 'federation_config'`,
          [JSON.stringify(fedConfig)]
        );
        console.log(`🔧 [自检] federation_config 中的 worldUrl 也已修正`);
      }
    }

  } catch (err) {
    console.warn('[自检] world_url 自检失败（不影响启动）:', err.message);
  }
}

async function start() {
  try {
    // 尝试初始化数据库，但失败时不阻止服务器启动
    try {
      await initializeDatabase();
      console.log('Database initialized');
      await ensureDefaultControls();
      await autoFixWorldUrl();  // 自检修正 world_url（导入他人数据库后自动修正）
    } catch (dbError) {
      console.warn('Database initialization failed, continuing without database:', dbError.message);
    }

    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, async () => {
      console.log(`Server running on http://localhost:${PORT}`);
      // 上传/保存请求可能较慢，避免服务端提前断开导致前端 "Failed to fetch"
      server.setTimeout(5 * 60 * 1000); // 5 分钟
      server.keepAliveTimeout = 65000;    // 略大于常见负载均衡 60s
      server.headersTimeout = 66000;
      
      // 初始化联邦系统
      try {
        await initFederation();
        console.log('✅ 联邦系统已启动');
      } catch (error) {
        console.error('❌ 联邦系统启动失败:', error);
      }
    });

    // 处理端口占用错误
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`\n❌ 端口 ${PORT} 已被占用!`);
        console.error('\n请运行以下命令清理端口:');
        console.error(`  netstat -ano | findstr :${PORT}`);
        console.error('  taskkill /F /PID <进程ID>\n');
        process.exit(1);
      } else {
        throw error;
      }
    });

    // WebSocket server — 附加到现有 HTTP server，共享同一端口
    try {
      const { setupWebSocketServer } = require('./websocket/wsServer');
      setupWebSocketServer(server);
    } catch (wsError) {
      console.warn('WebSocket server setup failed, continuing without WebSocket:', wsError.message);
    }
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();
