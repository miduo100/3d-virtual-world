/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 定制NPC路由
 * - CRUD管理
 * - 独立AI接口代理转发
 * - Three.js外形代码生成
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { query } = require('../database/db');
const { authenticateAdminToken } = require('../middleware/adminAuth');
const aiProviderService = require('../services/aiProviderService');

// 简化：把 authenticateAdminToken 当作 verifyAdminToken 使用
const verifyAdminToken = authenticateAdminToken;

// ===== 获取系统AI配置（复用后台配置的提供商）=====
async function getSystemAIConfig() {
  const nameMap = { qwen: 'aliyun_qianwen', doubao: 'bytedance_doubao' };
  for (const [shortName, dbName] of Object.entries(nameMap)) {
    try {
      const providers = await aiProviderService.getAllProviders(false);
      const provider = providers.find(p => p.provider_name === dbName);
      if (!provider || !provider.is_enabled) continue;
      const full = await aiProviderService.getProvider(provider.id, true);
      if (!full) continue;
      const configs = {};
      for (const c of (full.configs || [])) { if (c.key && c.value) configs[c.key] = c.value; }
      if (!configs.api_key) continue;
      if (shortName === 'qwen') {
        return {
          providerName: 'qwen',
          apiKey: configs.api_key,
          model: configs.model || 'qwen-plus',
          endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
        };
      }
      if (shortName === 'doubao') {
        let ep = configs.base_url || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
        if (!ep.endsWith('/chat/completions')) ep = ep.replace(/\/$/, '') + '/chat/completions';
        return { providerName: 'doubao', apiKey: configs.api_key, model: configs.endpoint_id || 'doubao-pro-32k', endpoint: ep };
      }
    } catch (_) {}
  }
  return null;
}

// ===== 建表（首次运行时自动创建）=====
async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS custom_npcs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      avatar_emoji VARCHAR(10) DEFAULT '🤖',
      description TEXT,
      world_name VARCHAR(100),
      tag VARCHAR(100),
      position JSONB DEFAULT '{"x":0,"y":0,"z":0}',
      ai_provider VARCHAR(50),
      ai_model VARCHAR(200),
      ai_endpoint TEXT,
      ai_key TEXT,
      system_prompt TEXT,
      shape_code TEXT,
      shape_desc TEXT,
      detect_range INTEGER DEFAULT 10,
      approach_range INTEGER DEFAULT 5,
      greeting TEXT,
      farewell TEXT,
      greet_trigger VARCHAR(20) DEFAULT 'approach',
      is_active BOOLEAN DEFAULT TRUE,
      roam BOOLEAN DEFAULT FALSE,
      face_player BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
ensureTable().catch(e => console.error('[customNpc] 建表失败:', e.message));

// ===== GET /api/custom-npc - 列表 =====
router.get('/', verifyAdminToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, avatar_emoji, description, world_name, tag,
              ai_provider, ai_model, is_active, position, created_at
       FROM custom_npcs ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== GET /api/custom-npc/active - 已启用（供前端游戏场景用）=====
router.get('/active', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, avatar_emoji, description, world_name, tag,
              shape_code, shape_desc, position, detect_range, approach_range,
              greeting, farewell, greet_trigger, face_player, roam
       FROM custom_npcs WHERE is_active = TRUE ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== GET /api/custom-npc/:id - 详情 =====
router.get('/:id', verifyAdminToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, avatar_emoji, description, world_name, tag,
              position, ai_provider, ai_model, ai_endpoint,
              CASE WHEN ai_key IS NOT NULL AND ai_key != '' THEN '••••••••' ELSE '' END as ai_key,
              system_prompt, shape_code, shape_desc,
              detect_range, approach_range, greeting, farewell,
              greet_trigger, is_active, roam, face_player, created_at
       FROM custom_npcs WHERE id = $1`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: '未找到' });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== POST /api/custom-npc - 创建 =====
router.post('/', verifyAdminToken, async (req, res) => {
  try {
    const {
      name, avatar_emoji, description, world_name, tag, position,
      ai_provider, ai_model, ai_endpoint, ai_key, system_prompt,
      shape_code, shape_desc, detect_range, approach_range,
      greeting, farewell, greet_trigger, is_active, roam, face_player
    } = req.body;
    if (!name) return res.status(400).json({ error: 'name 必填' });

    const result = await query(
      `INSERT INTO custom_npcs
        (name, avatar_emoji, description, world_name, tag, position,
         ai_provider, ai_model, ai_endpoint, ai_key, system_prompt,
         shape_code, shape_desc, detect_range, approach_range,
         greeting, farewell, greet_trigger, is_active, roam, face_player)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id`,
      [
        name, avatar_emoji || '🤖', description || '', world_name || '', tag || '',
        JSON.stringify(position || { x: 0, y: 0, z: 0 }),
        ai_provider || 'openai', ai_model || '', ai_endpoint || '', ai_key || '', system_prompt || '',
        shape_code || null, shape_desc || '',
        detect_range || 10, approach_range || 5,
        greeting || '', farewell || '', greet_trigger || 'approach',
        is_active !== false, !!roam, face_player !== false
      ]
    );
    res.json({ id: result.rows[0].id, success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== PUT /api/custom-npc/:id - 更新 =====
router.put('/:id', verifyAdminToken, async (req, res) => {
  try {
    const {
      name, avatar_emoji, description, world_name, tag, position,
      ai_provider, ai_model, ai_endpoint, ai_key, system_prompt,
      shape_code, shape_desc, detect_range, approach_range,
      greeting, farewell, greet_trigger, is_active, roam, face_player
    } = req.body;

    // ai_key只在传了新值（非掩码）时才更新
    const keyUpdate = (ai_key && !ai_key.includes('•')) ? ', ai_key = $21' : '';
    const params = [
      name, avatar_emoji || '🤖', description || '', world_name || '', tag || '',
      JSON.stringify(position || { x: 0, y: 0, z: 0 }),
      ai_provider || 'openai', ai_model || '', ai_endpoint || '', system_prompt || '',
      shape_code || null, shape_desc || '',
      detect_range || 10, approach_range || 5,
      greeting || '', farewell || '', greet_trigger || 'approach',
      is_active !== false, !!roam, face_player !== false,
      req.params.id
    ];
    if (ai_key && !ai_key.includes('•')) params.splice(20, 0, ai_key);

    const idxParam = keyUpdate ? '$22' : '$21';
    await query(
      `UPDATE custom_npcs SET
        name=$1, avatar_emoji=$2, description=$3, world_name=$4, tag=$5,
        position=$6, ai_provider=$7, ai_model=$8, ai_endpoint=$9,
        system_prompt=$10, shape_code=$11, shape_desc=$12,
        detect_range=$13, approach_range=$14, greeting=$15, farewell=$16,
        greet_trigger=$17, is_active=$18, roam=$19, face_player=$20
        ${keyUpdate},
        updated_at=CURRENT_TIMESTAMP
       WHERE id=${idxParam}`,
      params
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== DELETE /api/custom-npc/:id - 删除 =====
router.delete('/:id', verifyAdminToken, async (req, res) => {
  try {
    await query('DELETE FROM custom_npcs WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===== POST /api/custom-npc/test-api - 测试AI接口连接 =====
router.post('/test-api', verifyAdminToken, async (req, res) => {
  const { endpoint, model, api_key, message } = req.body;
  if (!endpoint || !model || !api_key) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  try {
    const resp = await axios.post(endpoint, {
      model,
      messages: [{ role: 'user', content: message || '你好' }],
      max_tokens: 50
    }, {
      headers: { 'Authorization': `Bearer ${api_key}`, 'Content-Type': 'application/json' },
      timeout: 10000
    });
    const reply = resp.data?.choices?.[0]?.message?.content || '已响应';
    res.json({ success: true, reply });
  } catch (e) {
    const errMsg = e.response?.data?.error?.message || e.response?.data?.message || e.message;
    res.json({ success: false, error: errMsg });
  }
});

// ===== POST /api/custom-npc/generate-shape - Three.js外形生成 =====
router.post('/generate-shape', verifyAdminToken, async (req, res) => {
  const { description, current_code } = req.body;
  if (!description) return res.status(400).json({ error: '描述不能为空' });

  // 使用系统已配置的AI提供商
  const aiCfg = await getSystemAIConfig();
  if (!aiCfg) return res.status(500).json({ error: '未配置AI提供商，请在后台"系统设置 → AI提供商"中启用至少一个提供商' });

  const isModify = !!current_code;
  const systemPrompt = `你是一个Three.js 3D角色外形生成专家。
请根据描述生成一段Three.js代码，创建一个NPC角色外形。
要求：
1. 代码中必须定义一个名为 createNPC 的函数，签名为 function createNPC(THREE, scene)
2. 使用 THREE.Group、THREE.Mesh、MeshLambertMaterial 等构建人形NPC
3. NPC整体高度约1.8单位，站立在 y=0 的平面上
4. 使用基础几何体（BoxGeometry、SphereGeometry、CylinderGeometry等）拼接成人形
5. 颜色、比例、装饰根据描述创意发挥
6. 不要使用任何外部资源或加载器，纯代码生成
7. 只输出代码，不要任何解释、注释或markdown标记`;

  const userMsg = isModify
    ? `当前NPC外形代码：\n${current_code}\n\n请按以下要求修改：${description}`
    : `请生成以下描述的NPC外形：${description}`;

  try {
    const resp = await axios.post(aiCfg.endpoint, {
      model: aiCfg.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ],
      max_tokens: 2000,
      temperature: 0.7
    }, {
      headers: { 'Authorization': `Bearer ${aiCfg.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 45000
    });

    let code = resp.data?.choices?.[0]?.message?.content || '';
    // 清理markdown代码块
    code = code.replace(/```(?:javascript|js)?\n?/g, '').replace(/```\s*$/g, '').trim();
    if (!code.includes('function createNPC') && !code.includes('createNPC')) {
      return res.json({ error: 'AI返回的代码格式不正确，请重试', raw: code });
    }
    res.json({ code });
  } catch (e) {
    const errMsg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: '生成失败: ' + errMsg });
  }
});

// ===== POST /api/custom-npc/:id/chat - 代理对话（转发到NPC专属AI）=====
router.post('/:id/chat', async (req, res) => {
  const { message, player_id } = req.body;
  if (!message) return res.status(400).json({ error: '消息不能为空' });

  try {
    const result = await query(
      `SELECT ai_endpoint, ai_model, ai_key, system_prompt, name, greeting
       FROM custom_npcs WHERE id = $1 AND is_active = TRUE`,
      [req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'NPC不存在或已禁用' });

    const npc = result.rows[0];
    if (!npc.ai_key || !npc.ai_endpoint || !npc.ai_model) {
      return res.status(400).json({ error: '该NPC未配置AI接口' });
    }

    const messages = [];
    if (npc.system_prompt) {
      messages.push({ role: 'system', content: npc.system_prompt });
    }
    messages.push({ role: 'user', content: message });

    const resp = await axios.post(npc.ai_endpoint, {
      model: npc.ai_model,
      messages,
      max_tokens: 500,
      temperature: 0.8
    }, {
      headers: { 'Authorization': `Bearer ${npc.ai_key}`, 'Content-Type': 'application/json' },
      timeout: 20000
    });

    const reply = resp.data?.choices?.[0]?.message?.content || '...';
    res.json({ reply, npc_name: npc.name });
  } catch (e) {
    const errMsg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: '对话失败: ' + errMsg });
  }
});

module.exports = router;
