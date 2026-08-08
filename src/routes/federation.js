/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 联邦系统API路由
 * 处理跨世界传送、世界互联等功能
 */

const express = require('express');
const router = express.Router();
const FederationSystem = require('../federationSystem');
const CentralWorldConnector = require('../centralWorldConnector');
const { query } = require('../database/db');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const { authenticateAdminToken } = require('../middleware/adminAuth');
const trustManager = require('../services/federationTrustManager');

// 初始化联邦系统
let federationSystem = null;
let centralConnector = null;

// 检查必要的环境变量
function checkEnvVariables() {
  if (!process.env.JWT_SECRET) {
    console.error('❌ 缺少必要的环境变量: JWT_SECRET');
    throw new Error('缺少必要的环境变量: JWT_SECRET');
  }
}

// 初始化函数（在服务器启动时调用）
async function initFederation() {
  try {
    // 检查环境变量
    checkEnvVariables();
    
    // 从数据库获取或创建世界配置
    const configResult = await query(
      'SELECT * FROM world_config WHERE key = $1',
      ['federation_config']
    );

    let config;
    
    if (configResult.rows.length === 0) {
      // 首次初始化：生成密钥对
      const { publicKey, privateKey } = FederationSystem.generateKeyPair();
      const worldId = generateWorldId();
      
      config = {
        worldId,
        worldName: process.env.WORLD_NAME || '虚拟世界',
        worldUrl: process.env.WORLD_URL || 'http://localhost:3002',
        privateKey,
        publicKey
      };

      // 保存到数据库
      try {
        await query(
          `INSERT INTO world_config (key, value, created_at) 
           VALUES ($1, $2, NOW())`,
          ['federation_config', JSON.stringify(config)]
        );
        console.log('✅ 联邦系统初始化完成，世界ID:', worldId);

        // 【首次部署赠送1个月订阅】
        try {
          const adminResult = await query(
            `SELECT id FROM admin_users ORDER BY id ASC LIMIT 1`
          );
          if (adminResult.rows.length > 0) {
            const userId = adminResult.rows[0].id;
            // 检查 user_subscriptions 表是否存在
            const tableCheck = await query(
              `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_subscriptions')`
            );
            if (tableCheck.rows[0].exists) {
              const expiresAt = new Date();
              expiresAt.setMonth(expiresAt.getMonth() + 1);
              await query(
                `INSERT INTO user_subscriptions (user_id, months, amount_cents, payment_method, started_at, expires_at, note)
                 VALUES ($1, 1, 0, 'free_trial', NOW(), $2, '首次部署赠送一个月')`,
                [userId, expiresAt]
              );
              console.log(`🎁 首次部署赠送1个月订阅: 用户ID=${userId}, 到期=${expiresAt.toISOString().split('T')[0]}`);
            }
          } else {
            console.log('⚠️ 首次部署但无管理员用户，跳过赠送订阅');
          }
        } catch (subError) {
          console.warn('⚠️ 赠送订阅失败（可能表未创建）:', subError.message);
        }
      } catch (dbError) {
        console.error('❌ 保存联邦系统配置失败:', dbError);
        throw dbError;
      }
    } else {
      config = JSON.parse(configResult.rows[0].value);
      console.log('✅ 联邦系统加载完成，世界ID:', config.worldId);
    }

    // 创建联邦系统实例
    federationSystem = new FederationSystem(config);

    // 加载已信任的世界列表
    await loadTrustedWorlds();

    // 创建中心世界连接器
    centralConnector = new CentralWorldConnector(federationSystem);

    // 自动连接到中心世界（如果配置了）
    await centralConnector.autoConnectToCentral();

    // 向中心世界注册（如果连接成功）
    await centralConnector.registerToCentral();

    return federationSystem;

  } catch (error) {
    console.error('❌ 联邦系统初始化失败:', error);
    throw error;
  }
}

// 生成唯一的世界ID
function generateWorldId() {
  return `world_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 加载已信任的世界列表
async function loadTrustedWorlds() {
  try {
    const result = await query(
      'SELECT * FROM trusted_worlds WHERE enabled = true'
    );

    for (const world of result.rows) {
      federationSystem.trustWorld(
        world.world_id,
        world.world_name,
        world.world_url,
        world.public_key
      );
    }

    console.log(`✅ 已加载 ${result.rows.length} 个信任的世界`);
  } catch (error) {
    console.error('加载信任世界列表失败:', error);
  }
}

// 通用错误处理函数
function handleError(res, error, message) {
  console.error(`${message}:`, error);
  res.status(500).json({
    success: false,
    error: error.message || '内部服务器错误'
  });
}

// 获取当前世界信息
router.get('/info', (req, res) => {
  if (!federationSystem) {
    return res.status(503).json({
      success: false,
      error: '联邦系统未初始化'
    });
  }

  res.json({
    success: true,
    world: {
      worldId: federationSystem.worldId,
      worldName: federationSystem.worldName,
      worldUrl: federationSystem.worldUrl,
      publicKey: federationSystem.publicKey
    }
  });
});

// 重新生成本世界ID和密钥对（管理员专用，用于解决世界ID冲突）
router.post('/reset-identity', authenticateAdminToken, async (req, res) => {
  if (!federationSystem) {
    return res.status(503).json({ success: false, error: '联邦系统未初始化' });
  }
  try {
    const { publicKey, privateKey } = FederationSystem.generateKeyPair();
    const newWorldId = `world_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const newConfig = {
      worldId: newWorldId,
      worldName: federationSystem.worldName,
      worldUrl: federationSystem.worldUrl,
      privateKey,
      publicKey
    };

    // 更新数据库
    await query(
      `UPDATE world_config SET value = $1, updated_at = NOW() WHERE key = $2`,
      [JSON.stringify(newConfig), 'federation_config']
    );

    // 更新内存
    federationSystem.worldId   = newWorldId;
    federationSystem.publicKey = publicKey;
    federationSystem.privateKey = privateKey;

    res.json({ success: true, message: '世界身份已重置', worldId: newWorldId });
  } catch (error) {
    handleError(res, error, '重置世界身份失败');
  }
});

// 获取已连接的世界列表
router.get('/worlds', (req, res) => {
  if (!federationSystem) {
    return res.status(503).json({
      success: false,
      error: '联邦系统未初始化'
    });
  }

  res.json({
    success: true,
    worlds: federationSystem.getConnectedWorlds()
  });
});

// 获取单个世界详情
router.get('/worlds/:worldId', (req, res) => {
  if (!federationSystem) {
    return res.status(503).json({
      success: false,
      error: '联邦系统未初始化'
    });
  }

  const { worldId } = req.params;
  const world = federationSystem.trustedWorlds.get(worldId);

  if (!world) {
    return res.status(404).json({
      success: false,
      error: '世界不存在或未信任'
    });
  }

  // 模拟世界状态数据
  const worldInfo = {
    worldId: world.worldId,
    worldName: world.worldName,
    worldUrl: world.worldUrl,
    worldDescription: `这是${world.worldName}世界的描述`,
    onlineUsers: Math.floor(Math.random() * 100),
    portalCount: Math.floor(Math.random() * 20),
    status: 'online',
    trustedAt: world.trustedAt
  };

  res.json({
    success: true,
    world: worldInfo
  });
});

// 移除信任世界（管理员专用）
router.delete('/worlds/:worldId', authenticateAdminToken, async (req, res) => {
  if (!federationSystem) {
    return res.status(503).json({ success: false, error: '联邦系统未初始化' });
  }
  const { worldId } = req.params;
  if (!federationSystem.trustedWorlds.has(worldId)) {
    return res.status(404).json({ success: false, error: '世界不存在或未信任' });
  }
  try {
    // 从内存移除
    federationSystem.trustedWorlds.delete(worldId);
    // 从数据库移除
    await query('DELETE FROM trusted_worlds WHERE world_id = $1', [worldId]);
    res.json({ success: true, message: '已移除信任世界' });
  } catch (error) {
    handleError(res, error, '移除信任世界失败');
  }
});

// 获取角色模板资源引用
router.get('/character-templates/references/:templateId', securityCheck, async (req, res) => {
  try {
    const { templateId } = req.params;
    
    const result = await federationSystem.getCharacterTemplateReferences(templateId);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(404).json(result);
    }
  } catch (error) {
    handleError(res, error, '获取角色模板资源引用失败');
  }
});

// 接收角色模板资源引用
router.post('/character-templates/import-references', securityCheck, async (req, res) => {
  try {
    const importData = req.body;
    
    // 验证请求数据
    if (!importData.sourceWorldId || !importData.sourceTemplateId || !importData.templateData || !importData.resources) {
      return res.status(400).json({
        success: false,
        error: '缺少必要的角色模板信息'
      });
    }

    const result = await federationSystem.importCharacterTemplateReferences(importData);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error) {
    handleError(res, error, '导入角色模板资源引用失败');
  }
});

// 获取用户联邦模板列表
router.get('/character-templates/user/:userId', securityCheck, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // 查询用户联邦模板
    // 避免 JOIN 操作，因为字段类型不匹配
    let result;
    if (!isValidUUID(userId)) {
      result = await query(`
        SELECT 
          ft.*
        FROM federation_templates ft
        WHERE ft.user_id IS NULL
      `);
    } else {
      result = await query(`
        SELECT 
          ft.*
        FROM federation_templates ft
        WHERE ft.user_id = $1 OR ft.user_id IS NULL
      `, [userId]);
    }

    // 为了获取模板名称，我们需要单独查询 character_templates 表
    // 但需要处理类型转换
    const templatesWithNames = [];
    for (const template of result.rows) {
      let templateName = '未知模板';
      if (template.local_template_id) {
        try {
          const nameResult = await query(`
            SELECT name 
            FROM character_templates 
            WHERE id::text = $1
          `, [template.local_template_id]);
          
          if (nameResult.rows.length > 0) {
            templateName = nameResult.rows[0].name;
          }
        } catch (error) {
          console.error('获取模板名称失败:', error);
        }
      }
      
      templatesWithNames.push({
        ...template,
        template_name: templateName
      });
    }

    res.json({
      success: true,
      templates: templatesWithNames.map(row => ({
        id: row.id,
        user_id: row.user_id,
        source_world_id: row.source_world_id,
        source_template_id: row.source_template_id,
        local_template_id: row.local_template_id,
        template_name: row.template_name,
        is_federated: false, // 需要从character_templates获取，但为了避免JOIN，我们默认设置为false
        is_active: row.is_active,
        bone_map: row.bone_map,
        anim_adapt: row.anim_adapt,
        created_at: row.created_at,
        updated_at: row.updated_at
      }))
    });
  } catch (error) {
    handleError(res, error, '获取用户联邦模板列表失败');
  }
});

// 验证UUID格式的函数
function isValidUUID(str) {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(str);
}

// 切换用户当前使用的模板
router.post('/character-templates/switch', securityCheck, async (req, res) => {
  try {
    const { userId, templateId, templateSource } = req.body;

    if (!userId || !templateId || !templateSource) {
      return res.status(400).json({
        success: false,
        error: '缺少必要的参数'
      });
    }

    if (templateSource === 'local') {
      // 切换到本地模板
      await query(`
        UPDATE federation_templates 
        SET is_active = FALSE 
        WHERE user_id = $1
      `, [userId]);
      
      res.json({
        success: true,
        message: '已切换到本地模板',
        activeTemplate: null
      });
    } else if (templateSource === 'federated') {
      // 切换到联邦模板
      await query(`
        UPDATE federation_templates 
        SET is_active = FALSE 
        WHERE user_id = $1
      `, [userId]);
      
      await query(`
        UPDATE federation_templates 
        SET is_active = TRUE 
        WHERE user_id = $1 AND local_template_id = $2
      `, [userId, templateId]);

      // 获取激活的模板信息
      const activeTemplateResult = await query(`
        SELECT 
          ft.*
        FROM federation_templates ft
        WHERE ft.user_id = $1 AND ft.is_active = TRUE
      `, [userId]);

      // 为了获取模板名称，我们需要单独查询 character_templates 表
      let activeTemplate = null;
      if (activeTemplateResult.rows.length > 0) {
        const template = activeTemplateResult.rows[0];
        let templateName = '未知模板';
        
        if (template.local_template_id) {
          try {
            const nameResult = await query(`
              SELECT name 
              FROM character_templates 
              WHERE id::text = $1
            `, [template.local_template_id]);
            
            if (nameResult.rows.length > 0) {
              templateName = nameResult.rows[0].name;
            }
          } catch (error) {
            console.error('获取模板名称失败:', error);
          }
        }
        
        activeTemplate = {
          ...template,
          template_name: templateName
        };
      }

      res.json({
        success: true,
        message: '已切换到联邦模板',
        activeTemplate: activeTemplate
      });
    } else {
      return res.status(400).json({
        success: false,
        error: '无效的模板来源'
      });
    }
  } catch (error) {
    handleError(res, error, '切换角色模板失败');
  }
});

// 获取联邦模板详细信息
router.get('/character-templates/federated/:templateId', securityCheck, async (req, res) => {
  try {
    const { templateId } = req.params;
    
    const result = await query(`
      SELECT 
        ft.*,
        ct.name AS template_name,
        ct.is_federated,
        ct.source_world_id,
        ct.source_template_id,
        ct.bone_map,
        ct.anim_adapt,
        ct.resource_urls
      FROM federation_templates ft
      LEFT JOIN character_templates ct ON ft.local_template_id = ct.id
      WHERE ft.id = $1
    `, [templateId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '联邦模板不存在'
      });
    }

    res.json({
      success: true,
      template: result.rows[0]
    });
  } catch (error) {
    handleError(res, error, '获取联邦模板详细信息失败');
  }
});

// 删除联邦模板引用
router.delete('/character-templates/federated/:templateId', securityCheck, async (req, res) => {
  try {
    const { templateId } = req.params;
    
    const result = await query(`
      SELECT * FROM federation_templates WHERE id = $1
    `, [templateId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '联邦模板不存在'
      });
    }

    const template = result.rows[0];
    
    // 删除联邦模板记录
    await query(`DELETE FROM federation_templates WHERE id = $1`, [templateId]);
    
    // 删除角色模板（如果是联邦创建的）
    await query(`DELETE FROM character_templates WHERE id = $1 AND is_federated = TRUE`, [template.local_template_id]);

    res.json({
      success: true,
      message: '联邦模板引用已删除'
    });
  } catch (error) {
    handleError(res, error, '删除联邦模板引用失败');
  }
});

// 安全检查中间件
function securityCheck(req, res, next) {
  if (!federationSystem) {
    return res.status(503).json({
      success: false,
      error: '联邦系统未初始化'
    });
  }

  // 获取客户端IP
  const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
  
  // 检查IP是否允许访问
  if (!federationSystem.isIpAllowed(clientIp)) {
    return res.status(429).json({
      success: false,
      error: '请求过于频繁，请稍后再试'
    });
  }

  next();
}

// 处理握手请求（其他世界建立信任）
router.post('/handshake', securityCheck, async (req, res) => {
  try {
    // 验证请求参数
    if (!req.body.worldId || !req.body.worldName || !req.body.worldUrl || !req.body.publicKey) {
      return res.status(400).json({
        success: false,
        error: '缺少必要的世界信息参数'
      });
    }

    const clientIp = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || req.connection.socket.remoteAddress;
    const result = await trustManager.handleIncomingHandshake(req.body, clientIp, federationSystem);

    res.json(result);

  } catch (error) {
    handleError(res, error, '握手请求处理失败');
  }
});

// 向其他世界发起信任请求（需要管理员认证）
router.post('/trust', authenticateAdminToken, securityCheck, async (req, res) => {
  try {
    const { targetWorldUrl } = req.body;

    if (!targetWorldUrl) {
      return res.status(400).json({
        success: false,
        error: '请提供目标世界URL'
      });
    }

    const result = await federationSystem.establishTrust(targetWorldUrl);

    if (result.success) {
      // 保存到数据库
      const targetWorld = federationSystem.trustedWorlds.get(result.worldId);
      if (targetWorld) {
        try {
          await query(
            `INSERT INTO trusted_worlds 
             (world_id, world_name, world_url, public_key, created_at, enabled)
             VALUES ($1, $2, $3, $4, NOW(), true)
             ON CONFLICT (world_id) DO UPDATE 
             SET world_name = $2, world_url = $3, public_key = $4, updated_at = NOW()`,
            [targetWorld.worldId, targetWorld.worldName, targetWorld.worldUrl, targetWorld.publicKey]
          );
        } catch (dbError) {
          console.error('❌ 保存信任世界失败:', dbError);
          // 数据库错误不影响信任建立，继续返回成功
        }
      }
    }

    res.json(result);

  } catch (error) {
    handleError(res, error, '建立信任失败');
  }
});

// 生成跨世界传送Token
router.post('/teleport/generate', authenticateToken, securityCheck, async (req, res) => {
  try {
    const { targetWorldId, context } = req.body;

    if (!targetWorldId) {
      return res.status(400).json({
        success: false,
        error: '请指定目标世界ID'
      });
    }

    // 获取用户信息
    const userResult = await query(
      'SELECT id, username, email, role FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '用户不存在'
      });
    }

    const user = userResult.rows[0];

    // 获取角色昵称（用户可能在个人资料中修改过）
    const charResult = await query(
      'SELECT name FROM characters WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
      [user.id]
    );
    if (charResult.rows.length > 0) {
      user.characterName = charResult.rows[0].name;
    }

    // 生成传送Token
    const teleportToken = await federationSystem.generateTeleportToken(
      user,
      targetWorldId,
      context
    );

    // 获取目标世界URL
    const targetWorld = federationSystem.trustedWorlds.get(targetWorldId);
    if (!targetWorld) {
      return res.status(404).json({
        success: false,
        error: '目标世界不存在或未信任'
      });
    }

    res.json({
      success: true,
      teleportToken,
      targetUrl: targetWorld.worldUrl,
      targetWorldName: targetWorld.worldName
    });

  } catch (error) {
    handleError(res, error, '生成传送Token失败');
  }
});

// 验证并接收来自其他世界的用户
router.post('/teleport/receive', securityCheck, async (req, res) => {
  try {
    const { teleportToken } = req.body;

    if (!teleportToken) {
      return res.status(400).json({
        success: false,
        error: '请提供传送Token'
      });
    }

    // 验证Token
    const verifyResult = await federationSystem.verifyTeleportToken(teleportToken);

    if (!verifyResult.success) {
      return res.status(401).json(verifyResult);
    }

    const { user, context } = verifyResult;
    if (!user || !context) {
      return res.status(400).json({
        success: false,
        error: '无效的传送Token数据'
      });
    }

    // 在本地创建或更新用户账户
    let localUser;
    const existingUserResult = await query(
      'SELECT * FROM users WHERE email = $1',
      [user.email]
    );

    if (existingUserResult.rows.length === 0) {
      // 创建新用户（联邦用户）
      try {
        const insertResult = await query(
          `INSERT INTO users 
           (id, username, email, password_hash)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [uuidv4(), user.username, user.email, 'FEDERATED_USER']
        );
        localUser = insertResult.rows[0];
      } catch (dbError) {
        console.error('❌ 创建联邦用户失败:', dbError);
        return res.status(500).json({
          success: false,
          error: '创建用户失败'
        });
      }
    } else {
      localUser = existingUserResult.rows[0];
    }

    // 查询或创建对应角色（前端 initializeGame 必须有 characterId）
    let localCharacter;
    try {
      const charResult = await query(
        'SELECT * FROM characters WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
        [localUser.id]
      );
      if (charResult.rows.length > 0) {
        localCharacter = charResult.rows[0];
      } else {
        // 联邦用户首次到达，自动创建默认角色（优先使用角色昵称）
        const displayName = user.characterName || user.username;
        const newCharResult = await query(
          `INSERT INTO characters (user_id, name, level, health, max_health, attack_power, defense, experience, position, respawn_point, created_at, updated_at)
           VALUES ($1, $2, 1, 100, 100, 10, 5, 0, $3, $3, NOW(), NOW()) RETURNING *`,
          [localUser.id, displayName, JSON.stringify({ x: 0, y: 0, z: 0 })]
        );
        localCharacter = newCharResult.rows[0];
      }
    } catch (charError) {
      console.error('❌ 查询/创建角色失败:', charError);
      return res.status(500).json({ success: false, error: '角色初始化失败' });
    }

    // 生成本地JWT Token
    const localToken = jwt.sign(
      { userId: localUser.id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // 记录传送历史
    try {
      await query(
        `INSERT INTO teleport_history 
         (user_id, source_world_id, source_world_name, context, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [localUser.id, user.fromWorld.id, user.fromWorld.name, JSON.stringify(context)]
      );
    } catch (dbError) {
      console.error('❌ 记录传送历史失败:', dbError);
      // 传送历史记录失败不影响用户登录
    }

    res.json({
      success: true,
      message: `欢迎来自 ${user.fromWorld.name} 的 ${user.username}！`,
      token: localToken,
      user: {
        id: localUser.id,
        username: localUser.username,
        email: localUser.email,
        role: localUser.role,
        characterId: localCharacter.id
      },
      context,
      characterConfig: context.characterConfig || null,
      inventoryInfo:   context.inventoryInfo   || null
    });

  } catch (error) {
    handleError(res, error, '接收传送用户失败');
  }
});

// 导出世界配置（用于分享）- 需要管理员认证
router.get('/export', authenticateAdminToken, securityCheck, (req, res) => {
  const config = federationSystem.exportConfig();
  
  res.json({
    success: true,
    config
  });
});

// 导入其他世界配置（需要管理员认证）
router.post('/import', authenticateAdminToken, securityCheck, async (req, res) => {
  try {
    const { config } = req.body;

    if (!config) {
      return res.status(400).json({
        success: false,
        error: '请提供世界配置'
      });
    }

    // 验证配置参数
    if (!config.worldId || !config.worldName || !config.worldUrl || !config.publicKey) {
      return res.status(400).json({
        success: false,
        error: '无效的世界配置格式'
      });
    }

    const result = federationSystem.importConfig(config);

    // 保存到数据库
    try {
      await query(
        `INSERT INTO trusted_worlds 
         (world_id, world_name, world_url, public_key, created_at, enabled)
         VALUES ($1, $2, $3, $4, NOW(), true)
         ON CONFLICT (world_id) DO UPDATE 
         SET world_name = $2, world_url = $3, public_key = $4, updated_at = NOW()`,
        [config.worldId, config.worldName, config.worldUrl, config.publicKey]
      );
    } catch (dbError) {
      console.error('❌ 保存信任世界失败:', dbError);
      // 数据库错误不影响导入结果，继续返回成功
    }

    res.json(result);

  } catch (error) {
    handleError(res, error, '导入世界配置失败');
  }
});

// 接收客户端世界的注册（中心世界专用）- 不需要认证，允许其他世界自动注册
router.post('/register-client', securityCheck, async (req, res) => {
  try {
    const { worldConfig } = req.body;

    if (!worldConfig) {
      return res.status(400).json({
        success: false,
        error: '缺少世界配置'
      });
    }

    // 验证配置参数
    if (!worldConfig.worldId || !worldConfig.worldName || !worldConfig.worldUrl || !worldConfig.publicKey) {
      return res.status(400).json({
        success: false,
        error: '无效的世界配置格式'
      });
    }

    console.log('📝 收到客户端世界注册:', worldConfig.worldName);

    // 导入配置并建立信任
    const result = federationSystem.importConfig(worldConfig);

    if (result.success) {
      // 保存到数据库
      try {
        await query(
          `INSERT INTO trusted_worlds 
           (world_id, world_name, world_url, public_key, is_central, created_at, enabled)
           VALUES ($1, $2, $3, $4, false, NOW(), true)
           ON CONFLICT (world_id) DO UPDATE 
           SET world_name = $2, world_url = $3, public_key = $4, updated_at = NOW()`,
          [worldConfig.worldId, worldConfig.worldName, worldConfig.worldUrl, worldConfig.publicKey]
        );
        console.log('✅ 客户端世界注册成功:', worldConfig.worldName);
      } catch (dbError) {
        console.error('❌ 保存客户端世界失败:', dbError);
        // 数据库错误不影响注册结果，继续返回成功
      }
    }

    res.json({
      success: true,
      message: '注册成功',
      centralWorld: {
        worldId: federationSystem.worldId,
        worldName: federationSystem.worldName
      }
    });

  } catch (error) {
    handleError(res, error, '客户端注册失败');
  }
});

// 检查中心世界连接状态
router.get('/central-status', securityCheck, async (req, res) => {
  try {
    if (!centralConnector) {
      return res.json({
        success: true,
        hasCentral: false,
        centralUrl: null
      });
    }

    const status = await centralConnector.checkCentralConnection();

    res.json({
      success: true,
      hasCentral: !!(process.env.CENTRAL_WORLD_URL || 'https://miduo100.com'),
      centralUrl: process.env.CENTRAL_WORLD_URL || 'https://miduo100.com',
      ...status
    });

  } catch (error) {
    handleError(res, error, '检查中心世界连接状态失败');
  }
});

// 获取世界状态
router.get('/worlds/:worldId/status', securityCheck, async (req, res) => {
  try {
    const { worldId } = req.params;
    const status = await federationSystem.checkWorldStatus(worldId);

    res.json({
      success: true,
      worldId: worldId,
      ...status
    });

  } catch (error) {
    handleError(res, error, '获取世界状态失败');
  }
});

// 获取所有世界状态
router.get('/worlds/status', securityCheck, async (req, res) => {
  try {
    const statuses = federationSystem.getAllWorldStatus();

    res.json({
      success: true,
      statuses: statuses
    });

  } catch (error) {
    handleError(res, error, '获取所有世界状态失败');
  }
});

// 同步用户数据（从其他世界接收）
router.post('/sync-user', securityCheck, async (req, res) => {
  try {
    const { userId, sourceWorldId, userData } = req.body;

    if (!userId || !sourceWorldId) {
      return res.status(400).json({
        success: false,
        error: '缺少必要的用户信息参数'
      });
    }

    // 验证源世界是否被信任
    const sourceWorld = federationSystem.trustedWorlds.get(sourceWorldId);
    if (!sourceWorld) {
      return res.status(401).json({
        success: false,
        error: '未信任的源世界'
      });
    }

    // 处理用户数据同步
    if (userData) {
      try {
        // 同步用户基本信息
        if (userData.user) {
          const existingUserResult = await query(
            'SELECT * FROM users WHERE id = $1',
            [userId]
          );
          
          if (existingUserResult.rows.length === 0) {
            // 创建新用户
            await query(
              `INSERT INTO users 
               (id, username, email, password_hash)
               VALUES ($1, $2, $3, $4)`,
              [userId, userData.user.username, userData.user.email, 'FEDERATED_USER']
            );
          } else {
            // 更新用户信息
            await query(
              `UPDATE users 
               SET username = $1, email = $2, role = $3, updated_at = NOW()
               WHERE id = $4`,
              [userData.user.username, userData.user.email, userData.user.role, userId]
            );
          }
        }
        
        // 同步角色信息
        if (userData.characters && Array.isArray(userData.characters)) {
          for (const character of userData.characters) {
            const existingCharResult = await query(
              'SELECT * FROM characters WHERE id = $1',
              [character.id]
            );
            
            if (existingCharResult.rows.length === 0) {
              // 创建新角色
              await query(
                `INSERT INTO characters 
                 (id, user_id, name, level, health, max_health, attack_power, defense, experience, position, respawn_point, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
                [character.id, userId, character.name, character.level, character.health, character.max_health, 
                 character.attack_power, character.defense, character.experience, character.position, character.respawn_point]
              );
            } else {
              // 更新角色信息
              await query(
                `UPDATE characters 
                 SET name = $1, level = $2, health = $3, max_health = $4, attack_power = $5, defense = $6, 
                     experience = $7, position = $8, respawn_point = $9, updated_at = NOW()
                 WHERE id = $10`,
                [character.name, character.level, character.health, character.max_health, character.attack_power, 
                 character.defense, character.experience, character.position, character.respawn_point, character.id]
              );
            }
          }
        }
        
        // 同步背包物品
        if (userData.inventory && Array.isArray(userData.inventory)) {
          for (const item of userData.inventory) {
            const existingItemResult = await query(
              'SELECT * FROM player_inventory WHERE user_id = $1 AND code_id = $2',
              [userId, item.code_id]
            );
            
            if (existingItemResult.rows.length === 0) {
              // 创建新物品
              await query(
                `INSERT INTO player_inventory 
                 (id, user_id, code_id, acquired_at, is_used)
                 VALUES ($1, $2, $3, $4, $5)`,
                [item.id, userId, item.code_id, item.acquired_at, item.is_used]
              );
            }
          }
        }
        
        console.log('用户数据同步成功:', userId);
        
      } catch (dbError) {
        console.error('同步用户数据到数据库失败:', dbError);
        // 数据库错误不影响同步结果，继续返回成功
      }
    }

    res.json({
      success: true,
      message: '用户数据同步成功',
      userId: userId,
      sourceWorldId: sourceWorldId,
      syncedAt: new Date().toISOString()
    });

  } catch (error) {
    handleError(res, error, '同步用户数据失败');
  }
});

// 导出初始化函数
module.exports = {
  router,
  initFederation,
  getFederationSystem: () => federationSystem,
  getCentralConnector: () => centralConnector
};
