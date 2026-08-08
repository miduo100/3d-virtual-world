/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const { query } = require('../database/db');
const aiProviderService = require('../services/aiProviderService');

// ===== 确保 npcs 表有 shape_code / shape_desc 列 =====
async function ensureNPCShapeCols() {
  try {
    await query('ALTER TABLE npcs ADD COLUMN IF NOT EXISTS shape_code TEXT');
    await query('ALTER TABLE npcs ADD COLUMN IF NOT EXISTS shape_desc TEXT');
  } catch (_) {}
}
ensureNPCShapeCols();

// ===== 获取AI提供商配置（复用已有逻辑）=====
async function getProviderConfig(providerName) {
  try {
    const dbProviderNameMap = { doubao: 'bytedance_doubao', qwen: 'aliyun_qianwen', hunyuan: 'tencent_hunyuan' };
    const dbName = dbProviderNameMap[providerName];
    if (!dbName) return null;

    const providers = await aiProviderService.getAllProviders(false);
    const provider = providers.find(p => p.provider_name === dbName);
    if (!provider || !provider.is_enabled) return null;

    const full = await aiProviderService.getProvider(provider.id, true);
    if (!full) return null;

    const configs = {};
    for (const c of (full.configs || [])) {
      if (c.key && c.value) configs[c.key] = c.value;
    }

    if (providerName === 'qwen' && configs.api_key) {
      let ep = configs.base_url || 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
      if (!ep.includes('/services/')) ep = ep.replace(/\/$/, '') + '/services/aigc/text-generation/generation';
      return { apiKey: configs.api_key, endpoint: ep, model: configs.model || 'qwen-plus', enabled: true };
    }
    if (providerName === 'doubao' && configs.api_key) {
      let ep = configs.base_url || 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
      if (!ep.endsWith('/chat/completions')) ep = ep.replace(/\/$/, '') + '/chat/completions';
      return { apiKey: configs.api_key, endpoint: ep, model: configs.endpoint_id || 'doubao-pro-32k', enabled: true };
    }
    return null;
  } catch (e) {
    console.error('[NPC] getProviderConfig error:', e.message);
    return null;
  }
}

// ===== AI 对话核心 =====
async function callAI(providerName, messages, aiModel) {
  const cfg = await getProviderConfig(providerName);
  if (!cfg) throw new Error(`AI提供商 ${providerName} 未配置或未启用`);

  // 角色模型不适合NPC对话，自动降级
  const CHARACTER_MODELS = ['qwen-flash-character', 'qwen-turbo-character', 'qwen-plus-character', 'qwen-max-character'];
  const model = aiModel || cfg.model;
  const useModel = CHARACTER_MODELS.includes(model) ? 'qwen-plus' : model;

  if (providerName === 'qwen') {
    const resp = await axios.post(cfg.endpoint, {
      model: useModel,
      input: { messages },
      parameters: { result_format: 'message', temperature: 0.8, max_tokens: 500 }
    }, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });
    return resp.data.output.choices[0].message.content;
  } else {
    // doubao / OpenAI-compatible
    const resp = await axios.post(cfg.endpoint, {
      model: useModel,
      messages,
      temperature: 0.8,
      max_tokens: 500
    }, {
      headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });
    return resp.data.choices[0].message.content;
  }
}

// ===================================
// CRUD
// ===================================

// GET /api/npc  — 获取所有NPC
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT id, name, description, model_url, model_type, avatar_emoji,
             position, rotation, scale, ai_provider, ai_model,
             system_prompt, personality, behavior, memory_config, is_active,
             shape_code, shape_desc, created_at, updated_at
      FROM npcs
      ORDER BY created_at DESC
    `);
    res.json({ success: true, npcs: result.rows });
  } catch (e) {
    console.error('[NPC GET ALL]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/npc/active  — 只获取启用的NPC（前端3D场景用）
router.get('/active', async (req, res) => {
  try {
    const result = await query(`
      SELECT id, name, description, model_url, model_type, avatar_emoji,
             position, rotation, scale, ai_provider, ai_model,
             system_prompt, personality, behavior, memory_config,
             shape_code, shape_desc
      FROM npcs
      WHERE is_active = TRUE
      ORDER BY created_at DESC
    `);
    res.json({ success: true, npcs: result.rows });
  } catch (e) {
    console.error('[NPC GET ACTIVE]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/npc/:id  — 获取单个NPC
router.get('/:id', async (req, res) => {
  try {
    const result = await query('SELECT * FROM npcs WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'NPC不存在' });
    res.json({ success: true, npc: result.rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/npc  — 创建NPC
router.post('/', async (req, res) => {
  try {
    const {
      name, description, model_url, model_type = 'glb', avatar_emoji = '🧑',
      position, rotation, scale = 1.0,
      ai_provider = 'qwen', ai_model,
      system_prompt, personality, behavior, memory_config,
      is_active = true, shape_code, shape_desc
    } = req.body;

    if (!name) return res.status(400).json({ success: false, error: '名称不能为空' });

    const result = await query(`
      INSERT INTO npcs (name, description, model_url, model_type, avatar_emoji,
        position, rotation, scale, ai_provider, ai_model,
        system_prompt, personality, behavior, memory_config, is_active,
        shape_code, shape_desc)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING *
    `, [
      name,
      description || '',
      model_url || null,
      model_type,
      avatar_emoji,
      JSON.stringify(position || { x: 0, y: 0, z: 0 }),
      JSON.stringify(rotation || { x: 0, y: 0, z: 0 }),
      scale,
      ai_provider,
      ai_model || null,
      system_prompt || `你是${name}，一个生活在虚拟世界中的NPC。请用自然、友好的语气与玩家交流，对话简洁，每次回复不超过60字。`,
      JSON.stringify(personality || { tags: [], greeting: `你好，旅行者！我是${name}。`, farewell: '再见，保重！' }),
      JSON.stringify(behavior || { detection_radius: 8, approach_player: true, approach_distance: 2.5, auto_greet: true, greet_cooldown: 30, idle_animation: 'idle', walk_animation: 'walk', talk_animation: 'talk', patrol_points: [], patrol_enabled: false }),
      JSON.stringify(memory_config || { remember_players: true, context_turns: 8 }),
      is_active,
      shape_code || null,
      shape_desc || null
    ]);

    res.json({ success: true, npc: result.rows[0] });
  } catch (e) {
    console.error('[NPC CREATE]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// PUT /api/npc/:id  — 更新NPC
router.put('/:id', async (req, res) => {
  try {
    const {
      name, description, model_url, model_type, avatar_emoji,
      position, rotation, scale,
      ai_provider, ai_model,
      system_prompt, personality, behavior, memory_config,
      is_active, shape_code, shape_desc
    } = req.body;

    const existing = await query('SELECT * FROM npcs WHERE id = $1', [req.params.id]);
    if (!existing.rows.length) return res.status(404).json({ success: false, error: 'NPC不存在' });

    const old = existing.rows[0];
    const result = await query(`
      UPDATE npcs SET
        name = $1, description = $2, model_url = $3, model_type = $4, avatar_emoji = $5,
        position = $6, rotation = $7, scale = $8,
        ai_provider = $9, ai_model = $10,
        system_prompt = $11, personality = $12, behavior = $13, memory_config = $14,
        is_active = $15, shape_code = $16, shape_desc = $17, updated_at = NOW()
      WHERE id = $18 RETURNING *
    `, [
      name ?? old.name,
      description ?? old.description,
      model_url !== undefined ? model_url : old.model_url,
      model_type ?? old.model_type,
      avatar_emoji ?? old.avatar_emoji,
      JSON.stringify(position ?? old.position),
      JSON.stringify(rotation ?? old.rotation),
      scale ?? old.scale,
      ai_provider ?? old.ai_provider,
      ai_model !== undefined ? ai_model : old.ai_model,
      system_prompt ?? old.system_prompt,
      JSON.stringify(personality ?? old.personality),
      JSON.stringify(behavior ?? old.behavior),
      JSON.stringify(memory_config ?? old.memory_config),
      is_active !== undefined ? is_active : old.is_active,
      shape_code !== undefined ? shape_code : old.shape_code,
      shape_desc !== undefined ? shape_desc : old.shape_desc,
      req.params.id
    ]);

    res.json({ success: true, npc: result.rows[0] });
  } catch (e) {
    console.error('[NPC UPDATE]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/npc/:id  — 删除NPC
router.delete('/:id', async (req, res) => {
  try {
    const result = await query('DELETE FROM npcs WHERE id = $1 RETURNING id, name', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, error: 'NPC不存在' });
    res.json({ success: true, deleted: result.rows[0] });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ===================================
// AI 对话
// ===================================

// POST /api/npc/generate-shape  — Three.js NPC外形生成（供编辑器前端使用）
router.post('/generate-shape', async (req, res) => {
  const { description, current_code } = req.body;
  if (!description) return res.status(400).json({ success: false, error: '描述不能为空' });

  // 依次尝试已配置的提供商
  let cfg = null, providerName = null;
  for (const name of ['qwen', 'doubao']) {
    cfg = await getProviderConfig(name);
    if (cfg) { providerName = name; break; }
  }
  if (!cfg) return res.status(500).json({ success: false, error: '未配置AI提供商，请在后台"系统设置 → AI提供商"中启用至少一个提供商' });

  const isModify = !!current_code;
  const systemPrompt = `你是一个Three.js 3D角色外形生成专家。
请根据描述生成一段Three.js代码，创建一个NPC角色外形。
要求：
1. 代码中必须定义一个名为 createNPC 的函数，签名为 function createNPC(THREE, scene)
2. 使用 THREE.Group、THREE.Mesh、THREE.MeshLambertMaterial 等构建人形NPC
3. NPC整体高度约1.8单位，站立在 y=0 的平面上
4. 只使用以下安全的几何体：BoxGeometry、SphereGeometry、CylinderGeometry、ConeGeometry、TorusGeometry
5. 颜色、比例、装饰根据描述创意发挥
6. 不要使用任何外部资源或加载器，纯代码生成
7. 只输出代码，不要任何解释、注释或markdown标记
8. 严禁使用 import、export、require、module.exports 等模块语法
9. 严禁在函数外声明变量；严禁声明名为 THREE 或 scene 的变量（已由外部传入）
10. 严禁使用 Quaternion、setFromEuler、setFromAxisAngle 等四元数API，旋转请直接设置 mesh.rotation.x/y/z
11. 所有 mesh/group 必须最终通过 scene.add() 添加到场景中
12. 严格注意 Three.js 类名大小写，正确写法：THREE.Object3D（D大写）、THREE.MeshLambertMaterial、THREE.AmbientLight、THREE.DirectionalLight、THREE.PerspectiveCamera

示例结构（请严格遵守）：
function createNPC(THREE, scene) {
  var group = new THREE.Group();
  // 头部
  var headGeo = new THREE.SphereGeometry(0.25, 16, 16);
  var headMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
  var head = new THREE.Mesh(headGeo, headMat);
  head.position.set(0, 1.65, 0);
  group.add(head);
  // ... 其他部位 ...
  scene.add(group);
}`;

  const userMsg = isModify
    ? `当前NPC外形代码如下：\n\`\`\`\n${current_code}\n\`\`\`\n\n修改要求：${description}\n\n注意：必须返回完整的修改后代码（包含完整的 createNPC 函数），不要只描述修改内容，不要只返回片段。`
    : `请生成以下描述的NPC外形：${description}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMsg }
  ];

  try {
    let rawContent;
    if (providerName === 'qwen') {
      // 千问旧版API，使用compatible模式endpoint（支持更大max_tokens）
      const compatEndpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
      const resp = await axios.post(compatEndpoint, {
        model: cfg.model,
        messages,
        max_tokens: 2000,
        temperature: 0.7
      }, {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 45000
      });
      rawContent = resp.data?.choices?.[0]?.message?.content || '';
    } else {
      // doubao / OpenAI-compatible
      const resp = await axios.post(cfg.endpoint, {
        model: cfg.model,
        messages,
        max_tokens: 2000,
        temperature: 0.7
      }, {
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        timeout: 45000
      });
      rawContent = resp.data?.choices?.[0]?.message?.content || '';
    }

    // 清理markdown代码块
    let code = rawContent
      .replace(/```(?:javascript|js|typescript|ts)?\n?/gi, '')
      .replace(/```\s*$/g, '')
      .trim();

    // 若代码中没有 createNPC，尝试自动包装
    if (!code.includes('createNPC')) {
      const hasThreeCode = code.includes('THREE.') || code.includes('new THREE') || code.includes('scene.add') || code.includes('Geometry') || code.includes('Material');
      if (hasThreeCode) {
        // 有效Three.js代码，直接包裹
        code = `function createNPC(THREE, scene) {\n${code}\n}`;
      } else {
        // 不含Three.js代码特征，AI可能返回了纯文字说明而非代码
        // 修改模式下尝试重新用原代码+说明重试（此处直接报错让前端提示用户重试）
        return res.json({ success: false, error: 'AI未返回有效的Three.js代码，请换个描述重试', raw: code });
      }
    }
    res.json({ success: true, code });
  } catch (e) {
    const errMsg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ success: false, error: '生成失败: ' + errMsg });
  }
});

// POST /api/npc/test-prompt  — 临时测试提示词（不需要已存在的NPC）
router.post('/test-prompt', async (req, res) => {
  try {
    const { name = 'NPC', system_prompt, message = '你好', ai_provider = 'qwen', ai_model } = req.body;
    if (!system_prompt) return res.status(400).json({ success: false, error: '请提供system_prompt' });

    const messages = [
      { role: 'system', content: system_prompt + '\n当前与你对话的玩家叫：测试玩家' },
      { role: 'user', content: message }
    ];
    const reply = await callAI(ai_provider, messages, ai_model);
    res.json({ success: true, reply, npc_name: name });
  } catch (e) {
    console.error('[NPC TEST PROMPT]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/npc/:id/chat  — 与NPC对话
router.post('/:id/chat', async (req, res) => {
  try {
    const { message, player_id = 'anonymous', player_name = '旅行者' } = req.body;
    if (!message) return res.status(400).json({ success: false, error: '消息不能为空' });

    // 获取NPC配置
    const npcResult = await query('SELECT * FROM npcs WHERE id = $1 AND is_active = TRUE', [req.params.id]);
    if (!npcResult.rows.length) return res.status(404).json({ success: false, error: 'NPC不存在或未启用' });
    const npc = npcResult.rows[0];

    const memCfg = npc.memory_config || { remember_players: true, context_turns: 8 };
    const contextTurns = memCfg.context_turns || 8;

    // 获取对话历史
    const historyResult = await query(`
      SELECT role, content FROM npc_chat_history
      WHERE npc_id = $1 AND player_id = $2
      ORDER BY created_at DESC LIMIT $3
    `, [req.params.id, player_id, contextTurns * 2]);

    const history = historyResult.rows.reverse();

    // 构建系统提示词（融合人格和知识）
    const personality = npc.personality || {};
    const systemPrompt = npc.system_prompt ||
      `你是${npc.name}，一个生活在虚拟世界中的NPC。请用自然、友好的语气与玩家 ${player_name} 交流，对话简洁，每次回复不超过60字。`;

    const messages = [
      { role: 'system', content: systemPrompt + `\n当前与你对话的玩家名叫：${player_name}` },
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];

    // 调用AI
    const reply = await callAI(npc.ai_provider || 'qwen', messages, npc.ai_model);

    // 保存对话历史
    await query(`
      INSERT INTO npc_chat_history (npc_id, player_id, player_name, role, content)
      VALUES ($1,$2,$3,'user',$4), ($1,$2,$3,'assistant',$5)
    `, [req.params.id, player_id, player_name, message, reply]);

    res.json({ success: true, reply, npc_name: npc.name, npc_emoji: npc.avatar_emoji });
  } catch (e) {
    console.error('[NPC CHAT]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/npc/:id/greet  — NPC主动问候（玩家靠近时触发）
router.post('/:id/greet', async (req, res) => {
  try {
    const { player_id = 'anonymous', player_name = '旅行者' } = req.body;

    const npcResult = await query('SELECT * FROM npcs WHERE id = $1 AND is_active = TRUE', [req.params.id]);
    if (!npcResult.rows.length) return res.status(404).json({ success: false, error: 'NPC不存在' });
    const npc = npcResult.rows[0];

    const personality = npc.personality || {};
    let greetMsg = personality.greeting || `你好，${player_name}！很高兴见到你！`;

    // 替换变量
    greetMsg = greetMsg.replace('{player_name}', player_name);

    // 如果开启了AI问候，让AI生成个性化问候
    const behavior = npc.behavior || {};
    let reply = greetMsg;
    if (behavior.ai_greet && npc.system_prompt) {
      try {
        const messages = [
          { role: 'system', content: npc.system_prompt },
          { role: 'user', content: `玩家 ${player_name} 走近了你，请发出一句自然的问候语（不超过30字）` }
        ];
        reply = await callAI(npc.ai_provider || 'qwen', messages, npc.ai_model);
      } catch (_) {
        reply = greetMsg;
      }
    }

    res.json({ success: true, reply, npc_name: npc.name, npc_emoji: npc.avatar_emoji });
  } catch (e) {
    console.error('[NPC GREET]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

// GET /api/npc/:id/history  — 获取对话历史
router.get('/:id/history', async (req, res) => {
  try {
    const { player_id = 'anonymous', limit = 20 } = req.query;
    const result = await query(`
      SELECT role, content, player_name, created_at FROM npc_chat_history
      WHERE npc_id = $1 AND player_id = $2
      ORDER BY created_at DESC LIMIT $3
    `, [req.params.id, player_id, parseInt(limit)]);
    res.json({ success: true, history: result.rows.reverse() });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// DELETE /api/npc/:id/history  — 清空对话历史
router.delete('/:id/history', async (req, res) => {
  try {
    const { player_id } = req.query;
    if (player_id) {
      await query('DELETE FROM npc_chat_history WHERE npc_id = $1 AND player_id = $2', [req.params.id, player_id]);
    } else {
      await query('DELETE FROM npc_chat_history WHERE npc_id = $1', [req.params.id]);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// POST /api/npc/:id/test-chat  — 测试对话（不保存历史）
router.post('/:id/test-chat', async (req, res) => {
  try {
    const { message = '你好', player_name = '测试玩家' } = req.body;

    const npcResult = await query('SELECT * FROM npcs WHERE id = $1', [req.params.id]);
    if (!npcResult.rows.length) return res.status(404).json({ success: false, error: 'NPC不存在' });
    const npc = npcResult.rows[0];

    const systemPrompt = npc.system_prompt ||
      `你是${npc.name}，一个生活在虚拟世界中的NPC。请用自然、友好的语气与玩家 ${player_name} 交流，对话简洁，每次回复不超过60字。`;

    const messages = [
      { role: 'system', content: systemPrompt + `\n当前与你对话的玩家名叫：${player_name}` },
      { role: 'user', content: message }
    ];

    const reply = await callAI(npc.ai_provider || 'qwen', messages, npc.ai_model);
    res.json({ success: true, reply, npc_name: npc.name });
  } catch (e) {
    console.error('[NPC TEST CHAT]', e.message);
    res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
