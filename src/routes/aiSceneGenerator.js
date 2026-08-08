/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const modelMatcher = require('../services/modelMatcher');
const aiProviderService = require('../services/aiProviderService');

// ===== 配置多个AI提供商 =====
const AI_PROVIDERS = {
  qwen: {
    name: '通义千问',
    endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
    model: 'qwen-max',
    enabled: !!process.env.QWEN_API_KEY
  },
  doubao: {
    name: '豆包',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    model: 'doubao-pro-32k',
    enabled: !!process.env.DOUBAO_API_KEY
  },
  hunyuan: {
    name: '腾讯混元',
    endpoint: 'https://hunyuan.tencentcloudapi.com',
    model: 'hunyuan-pro',
    enabled: !!process.env.HUNYUAN_SECRET_ID && !!process.env.HUNYUAN_SECRET_KEY
  }
};

/**
 * 从数据库获取AI提供商配置
 * 优先使用数据库配置，如果没有则使用环境变量
 */
async function getAIProviderConfig(providerName) {
  try {
    console.log(`\n🔍 [getAIProviderConfig] 开始获取 ${providerName} 配置...`);
    
    // 映射provider名称到数据库中的provider_name
    const dbProviderNameMap = {
      'doubao': 'bytedance_doubao',
      'qwen': 'aliyun_qianwen',
      'hunyuan': 'tencent_hunyuan'
    };
    
    const dbProviderName = dbProviderNameMap[providerName];
    if (!dbProviderName) {
      console.log(`❌ [getAIProviderConfig] 未知的提供商名称: ${providerName}`);
      return null;
    }
    
    console.log(`📝 [getAIProviderConfig] 映射到数据库名称: ${dbProviderName}`);
    
    // 从数据库获取所有提供商配置（不包括敏感信息）
    const providers = await aiProviderService.getAllProviders(false); // 只获取启用的
    console.log(`📋 [getAIProviderConfig] 获取到 ${providers.length} 个已启用的提供商`);
    
    const provider = providers.find(p => p.provider_name === dbProviderName);
    
    if (!provider) {
      console.log(`❌ [getAIProviderConfig] 未找到提供商: ${dbProviderName}`);
      return null;
    }
    
    if (!provider.is_enabled) {
      console.log(`⚠️ [getAIProviderConfig] 提供商未启用: ${dbProviderName}`);
      return null;
    }
    
    console.log(`✅ [getAIProviderConfig] 找到提供商: ${provider.display_name} (ID: ${provider.id})`);
    
    // 获取包含敏感信息的完整配置
    console.log('🔐 [getAIProviderConfig] 获取包含敏感信息的完整配置...');
    const fullProvider = await aiProviderService.getProvider(provider.id, true);
    
    if (!fullProvider) {
      console.log('❌ [getAIProviderConfig] 无法获取完整配置');
      return null;
    }
    
    console.log('📦 [getAIProviderConfig] 完整配置数组:', JSON.stringify(fullProvider.configs.map(c => ({
      key: c.key,
      hasValue: c.has_value,
      isSensitive: c.is_sensitive,
      valueLength: c.value?.length || 0
    })), null, 2));
    
    // 解析配置
    const configs = {};
    if (fullProvider.configs && Array.isArray(fullProvider.configs)) {
      console.log(`🔧 [getAIProviderConfig] 开始解析 ${fullProvider.configs.length} 个配置项...`);
      
      for (const config of fullProvider.configs) {
        console.log('  - 处理配置项:', {
          key: config.key,
          hasValue: config.has_value,
          isSensitive: config.is_sensitive,
          valueLength: config.value?.length || 0
        });
        
        if (config.key && config.value) {
          configs[config.key] = config.value;
          console.log(`    ✓ 已添加: ${config.key} (长度: ${config.value.length})`);
        } else {
          console.log(`    ✗ 跳过: ${config.key} (缺少值)`);
        }
      }
    }
    
    console.log('📊 [getAIProviderConfig] 解析后的配置键:', Object.keys(configs));
    
    // 检查必需的配置
    if (providerName === 'doubao') {
      console.log('🔍 [getAIProviderConfig] 检查豆包必需配置...');
      console.log(`  - api_key: ${configs.api_key ? `存在 (${configs.api_key.length}字符)` : '❌ 缺失'}`);
      if (configs.api_key) {
        const key = configs.api_key;
        console.log(`  - api_key预览: ${key.substring(0, 8)}...${key.substring(key.length - 4)}`);
      }
      console.log(`  - endpoint_id: ${configs.endpoint_id ? '存在' : '缺失'}`);
      console.log(`  - base_url: ${configs.base_url ? '存在' : '缺失'}`);
      
      if (configs.api_key) {
        console.log('✅ [getAIProviderConfig] 豆包配置完整，返回配置对象');
        
        // 修复endpoint: 确保包含 /chat/completions 后缀
        let endpoint = configs.base_url || AI_PROVIDERS.doubao.endpoint;
        if (endpoint && !endpoint.endsWith('/chat/completions')) {
          endpoint = endpoint.replace(/\/$/, '') + '/chat/completions';
          console.log(`🔧 [getAIProviderConfig] 修正endpoint: ${endpoint}`);
        }
        
        const configObj = {
          apiKey: configs.api_key,
          endpoint: endpoint,
          model: configs.endpoint_id || AI_PROVIDERS.doubao.model,
          enabled: true
        };
        console.log('📤 [getAIProviderConfig] 返回配置:', {
          apiKeyLength: configObj.apiKey.length,
          endpoint: configObj.endpoint,
          model: configObj.model
        });
        return configObj;
      } else {
        console.log('❌ [getAIProviderConfig] 豆包缺少api_key');
      }
    } else if (providerName === 'qwen' && configs.api_key) {
      console.log('✅ [getAIProviderConfig] 千问配置完整');
      // 修复endpoint：如果base_url只到/api/v1，自动补全完整路径
      let qwenEndpoint = configs.base_url || AI_PROVIDERS.qwen.endpoint;
      const QWEN_FULL_PATH = '/services/aigc/text-generation/generation';
      if (qwenEndpoint && !qwenEndpoint.includes('/services/')) {
        qwenEndpoint = qwenEndpoint.replace(/\/$/, '') + QWEN_FULL_PATH;
        console.log(`🔧 [getAIProviderConfig] 修正千问endpoint: ${qwenEndpoint}`);
      }
      return {
        apiKey: configs.api_key,
        endpoint: qwenEndpoint,
        model: configs.model || AI_PROVIDERS.qwen.model,
        enabled: true
      };
    } else if (providerName === 'hunyuan' && configs.secret_id && configs.secret_key) {
      console.log('✅ [getAIProviderConfig] 混元配置完整');
      return {
        secretId: configs.secret_id,
        secretKey: configs.secret_key,
        endpoint: configs.endpoint || AI_PROVIDERS.hunyuan.endpoint,
        model: configs.model || AI_PROVIDERS.hunyuan.model,
        enabled: true
      };
    }
    
    console.log(`⚠️ [getAIProviderConfig] ${providerName}配置不完整，已有配置:`, Object.keys(configs));
    return null;
    
  } catch (error) {
    console.error(`❌ [getAIProviderConfig] 获取${providerName}配置失败:`, error.message);
    console.error(error.stack);
    return null;
  }
}

// ===== 动态生成AI提示词（使用真实模型数据）=====
async function generateSystemPromptWithRealModels() {
  const { modelsByTag, availableTags, totalCount } = await getAvailableModels();
  
  if (totalCount === 0) {
    console.warn('⚠️ 数据库中没有可用模型，使用默认提示词');
    return SYSTEM_PROMPT; // 使用下面的备用提示词
  }
  
  // 按标签组织模型列表
  let modelLibrary = '## 数据库中可用的模型库\n';
  modelLibrary += `> 共有 ${totalCount} 个可用模型，分布在 ${availableTags.length} 个标签中\n\n`;
  
  // 生成标签模型列表（前5个标签显示详情，其他仅显示名称）
  const featuredTags = availableTags.slice(0, 20);
  featuredTags.forEach(tag => {
    const models = modelsByTag[tag] || [];
    if (models.length > 0) {
      const modelExamples = models.slice(0, 3).map(m => m.name).join(', ');
      const moreCount = models.length > 3 ? ` 等${models.length}个模型` : '';
      modelLibrary += `- **${tag}**: ${modelExamples}${moreCount}\n`;
    }
  });
  
  if (availableTags.length > 20) {
    modelLibrary += `\n其他可用标签: ${availableTags.slice(20).join(', ')}\n`;
  }
  
  const DYNAMIC_PROMPT = `你是一个3D虚拟世界场景规划专家。
根据用户的场景描述和**数据库中实际可用的模型**，生成一个合理的JSON配置。

## ⚠️ 重要：只能使用数据库中存在的模型
- **必须从下面"可用的模型库"中选择标签作为type字段**
- 不要使用不存在的模型类型
- 优先选择有多个模型的标签，增加多样性

## 输出JSON格式（不要markdown标记）
{
  "scene_type": "场景类型描述",
  "atmosphere": "氛围描述",
  "objects": [
    {
      "type": "模型标签(必须是下面列出的标签之一)",
      "count": 数量,
      "layout": "布局方式(random/circle/grid/line/clustered)",
      "properties": {
        "size": "large/medium/small/varied"
      }
    }
  ]
}

${modelLibrary}

## 生成规则
1. **数量要合理**：村庄5-15个，城市10-30个，自然场景多样化
2. **模型搭配要协调**：风格统一，不要混搭
3. **必须输出有效JSON**，不要其他文字
4. **type字段必须是上面列出的标签之一**

## 示例
用户："温馨的村庄"
输出：{"scene_type":"温馨村庄","atmosphere":"宁静祥和","objects":[{"type":"茅草屋","count":3,"layout":"clustered","properties":{"size":"medium"}}]}`;

  return DYNAMIC_PROMPT;
}

// ===== 系统提示词（备用）=====
const SYSTEM_PROMPT = `你是3D虚拟场景配置专家。根据用户的自然语言描述，生成标准的JSON场景配置。

## 输出格式（严格遵守，不要markdown标记）
{
  "scene_type": "village|city|forest|beach|desert|snow|space|castle|cyberpunk",
  "environment": {
    "terrain": "flat|hills|mountains",
    "time": "day|night|sunset|sunrise",
    "weather": "clear|rain|snow|fog|storm"
  },
  "objects": [
    {
      "type": "物体类型",
      "count": 数量,
      "properties": {
        "size": "small|medium|large",
        "distribution": "random|clustered|grid|circle|line",
        "custom_attributes": {}
      }
    }
  ],
  "layout_hints": {
    "物体类型": "布局建议文字"
  }
}

## 可用物体类型库
### 建筑类
- cottage: 茅草屋/小屋
- house: 房子
- skyscraper: 摩天大楼
- castle: 城堡
- tower: 塔楼
- barn: 谷仓
- shed: 棚屋
- temple: 神殿
- pyramid: 金字塔

### 自然类
- mountain: 山
- hill: 小山丘
- tree: 树
- rock: 岩石
- bush: 灌木
- flower: 花
- grass: 草地
- crystal: 水晶

### 动物类
- hen: 母鸡
- chick: 小鸡
- cat: 猫
- dog: 狗
- bird: 鸟
- butterfly: 蝴蝶
- fish: 鱼

### 装饰类
- fence: 栅栏
- lamp: 路灯
- bench: 长凳
- fountain: 喷泉
- statue: 雕像
- sign: 标识牌
- portal: 传送门

### 交通工具
- car: 汽车
- boat: 船
- spaceship: 宇宙飞船
- bike: 自行车

### 道具类
- chest: 宝箱
- barrel: 木桶
- crate: 木箱

## 生成规则
1. 数量要合理：
   - 村庄场景：5-10个建筑
   - 城市场景：10-30个建筑
   - 自然场景：多样化植物和地形
2. 物体搭配要协调（村子不能有摩天大楼，太空站不能有茅草屋）
3. 必须输出有效JSON，不要任何其他文字
4. 如果用户描述模糊，使用合理默认值
5. 动物如果有"带着"的描述，要分别创建父对象和子对象`;

// ===== 通义千问调用 =====
async function callQwen(userDescription, systemPrompt) {
  try {
    const response = await axios.post(
      AI_PROVIDERS.qwen.endpoint,
      {
        model: AI_PROVIDERS.qwen.model,
        input: {
          messages: [
            { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
            { role: 'user', content: userDescription }
          ]
        },
        parameters: {
          result_format: 'message',
          temperature: 0.3,
          max_tokens: 2000
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.QWEN_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.output.choices[0].message.content;
    return cleanAndParseJSON(content);

  } catch (error) {
    console.error('通义千问调用失败:', error.response?.data || error.message);
    throw new Error('通义千问API调用失败');
  }
}

// ===== 豆包调用 =====
async function callDoubao(userDescription, systemPrompt) {
  try {
    const response = await axios.post(
      AI_PROVIDERS.doubao.endpoint,
      {
        model: AI_PROVIDERS.doubao.model,
        messages: [
          { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
          { role: 'user', content: userDescription }
        ],
        temperature: 0.3,
        max_tokens: 2000
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.DOUBAO_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const content = response.data.choices[0].message.content;
    return cleanAndParseJSON(content);

  } catch (error) {
    console.error('豆包调用失败:', error.response?.data || error.message);
    throw new Error('豆包API调用失败');
  }
}

// ===== 清理和解析JSON =====
function cleanAndParseJSON(text) {
  // 移除markdown代码块标记
  let cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  
  // 移除可能的前后文字
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    console.error('JSON解析失败，原文:', cleaned);
    throw new Error('AI返回的JSON格式无效');
  }
}

// ===== 智能场景生成（带降级，优先从数据库读取配置）=====
async function generateScene(userDescription, preferredProvider = null) {
  const providerOrder = [];
  
  // 优先使用用户指定的提供商
  if (preferredProvider) providerOrder.push(preferredProvider);
  // 备选顺序
  if (!providerOrder.includes('doubao')) providerOrder.push('doubao');
  if (!providerOrder.includes('qwen')) providerOrder.push('qwen');
  
  // 🔥 生成包含真实模型数据的动态提示词
  const dynamicPrompt = await generateSystemPromptWithRealModels();
  console.log('📝 使用动态生成的提示词（包含数据库模型）');
  
  for (const prov of providerOrder) {
    try {
      console.log(`🎨 尝试使用 ${prov}...`);
      
      // 优先从数据库获取配置
      const dbConfig = await getAIProviderConfig(prov);
      
      let sceneConfig;
      if (dbConfig && dbConfig.enabled) {
        // 使用数据库配置
        console.log(`  ✅ 使用数据库配置的 ${prov}`);
        if (prov === 'qwen') {
          sceneConfig = await callQwenWithConfig(userDescription, dynamicPrompt, dbConfig);
        } else {
          sceneConfig = await callDoubaoWithConfig(userDescription, dynamicPrompt, dbConfig);
        }
      } else if (prov === 'qwen' && AI_PROVIDERS.qwen.enabled) {
        sceneConfig = await callQwen(userDescription, dynamicPrompt);
      } else if (prov === 'doubao' && AI_PROVIDERS.doubao.enabled) {
        sceneConfig = await callDoubao(userDescription, dynamicPrompt);
      } else {
        console.log(`  ⚠️ ${prov} 未配置，跳过`);
        continue;
      }
      
      // 验证配置完整性
      if (!sceneConfig.scene_type || !sceneConfig.objects) {
        throw new Error('配置格式不完整');
      }
      
      console.log(`✅ ${prov} 生成成功`);
      return {
        config: sceneConfig,
        provider: AI_PROVIDERS[prov]?.name || prov
      };
      
    } catch (error) {
      console.log(`❌ ${prov} 失败:`, error.message);
      continue;
    }
  }
  
  // 所有AI都失败，使用默认场景
  console.log('⚠️ 所有AI提供商失败，使用默认场景');
  return {
    config: getDefaultSceneByKeywords(userDescription),
    provider: 'fallback'
  };
}

// 使用数据库配置调用千问（场景生成）
async function callQwenWithConfig(userDescription, systemPrompt, config) {
  // 角色扮演专用模型不支持场景生成，自动替换为通用模型
  const CHARACTER_MODELS = ['qwen-flash-character', 'qwen-turbo-character', 'qwen-plus-character', 'qwen-max-character'];
  let model = config.model;
  if (CHARACTER_MODELS.includes(model)) {
    model = 'qwen-plus';
    console.log(`🔧 [callQwenWithConfig] 角色模型不适合场景生成，自动切换为: ${model}`);
  }
  const response = await axios.post(config.endpoint, {
    model: model,
    input: {
      messages: [
        { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
        { role: 'user', content: userDescription }
      ]
    },
    parameters: { result_format: 'message', temperature: 0.3, max_tokens: 2000 }
  }, {
    headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    timeout: 60000
  });
  const content = response.data.output.choices[0].message.content;
  return cleanAndParseJSON(content);
}

// 使用数据库配置调用豆包（场景生成）
async function callDoubaoWithConfig(userDescription, systemPrompt, config) {
  const response = await axios.post(config.endpoint, {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt || SYSTEM_PROMPT },
      { role: 'user', content: userDescription }
    ],
    temperature: 0.3,
    max_tokens: 2000
  }, {
    headers: { 'Authorization': `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    timeout: 60000
  });
  const content = response.data.choices[0].message.content;
  return cleanAndParseJSON(content);
}

// ===== 基于关键词的默认场景 =====
function getDefaultSceneByKeywords(description) {
  const keywords = {
    village: ['村', '村子', '村庄', '茅草', '农村', '乡村'],
    city: ['城市', '大厦', '街道', '高楼', '都市'],
    forest: ['森林', '树林', '丛林', '树木'],
    beach: ['海滩', '沙滩', '海边', '海岸'],
    desert: ['沙漠', '沙丘', '荒漠'],
    snow: ['雪山', '冰雪', '冬天', '雪地'],
    space: ['太空', '宇宙', '星空', '飞船'],
    castle: ['城堡', '堡垒', '魔法'],
    cyberpunk: ['赛博', '朋克', '霓虹', '未来']
  };

  let sceneType = 'village';  // 默认
  for (const [type, words] of Object.entries(keywords)) {
    if (words.some(word => description.includes(word))) {
      sceneType = type;
      break;
    }
  }

  const templates = {
    village: {
      scene_type: 'village',
      environment: { terrain: 'hills', time: 'day', weather: 'clear' },
      objects: [
        { type: 'mountain', count: 3, properties: { size: 'medium', distribution: 'background' } },
        { type: 'cottage', count: 5, properties: { size: 'small', distribution: 'clustered' } },
        { type: 'tree', count: 10, properties: { size: 'varied', distribution: 'random' } },
        { type: 'fence', count: 8, properties: { size: 'small', distribution: 'circle' } },
        { type: 'hen', count: 2, properties: { size: 'small', distribution: 'random' } },
        { type: 'cat', count: 1, properties: { size: 'small', distribution: 'random' } }
      ],
      layout_hints: {
        cottages: '围绕中心圆形分布',
        mountains: '远景背景',
        trees: '随机散布',
        animals: '村子内活动'
      }
    },
    city: {
      scene_type: 'city',
      environment: { terrain: 'flat', time: 'night', weather: 'clear' },
      objects: [
        { type: 'skyscraper', count: 12, properties: { size: 'varied', distribution: 'grid' } },
        { type: 'lamp', count: 20, properties: { size: 'small', distribution: 'grid' } },
        { type: 'car', count: 8, properties: { size: 'small', distribution: 'line' } },
        { type: 'tree', count: 15, properties: { size: 'small', distribution: 'line' } }
      ],
      layout_hints: {
        skyscrapers: '网格排列',
        lamps: '街道两侧',
        cars: '道路上行驶',
        trees: '街道绿化'
      }
    },
    forest: {
      scene_type: 'forest',
      environment: { terrain: 'hills', time: 'day', weather: 'fog' },
      objects: [
        { type: 'tree', count: 30, properties: { size: 'varied', distribution: 'clustered' } },
        { type: 'rock', count: 10, properties: { size: 'varied', distribution: 'random' } },
        { type: 'bush', count: 20, properties: { size: 'small', distribution: 'random' } },
        { type: 'flower', count: 15, properties: { size: 'small', distribution: 'random' } },
        { type: 'bird', count: 5, properties: { size: 'small', distribution: 'random' } }
      ],
      layout_hints: {
        trees: '成林分布',
        rocks: '随机点缀',
        flowers: '林间开放'
      }
    },
    beach: {
      scene_type: 'beach',
      environment: { terrain: 'flat', time: 'sunset', weather: 'clear' },
      objects: [
        { type: 'rock', count: 8, properties: { size: 'varied', distribution: 'random' } },
        { type: 'tree', count: 5, properties: { size: 'medium', distribution: 'line' } },
        { type: 'boat', count: 2, properties: { size: 'medium', distribution: 'random' } }
      ],
      layout_hints: {
        rocks: '海滩上散布',
        trees: '岸边排列',
        boats: '停靠水边'
      }
    },
    space: {
      scene_type: 'space',
      environment: { terrain: 'flat', time: 'night', weather: 'clear' },
      objects: [
        { type: 'spaceship', count: 3, properties: { size: 'large', distribution: 'random' } },
        { type: 'crystal', count: 10, properties: { size: 'varied', distribution: 'random' } },
        { type: 'tower', count: 2, properties: { size: 'large', distribution: 'random' } }
      ],
      layout_hints: {
        spaceships: '随机停靠',
        crystals: '发光点缀',
        towers: '通讯设施'
      }
    },
    castle: {
      scene_type: 'castle',
      environment: { terrain: 'hills', time: 'day', weather: 'clear' },
      objects: [
        { type: 'castle', count: 1, properties: { size: 'large', distribution: 'random' } },
        { type: 'tower', count: 4, properties: { size: 'medium', distribution: 'circle' } },
        { type: 'fence', count: 12, properties: { size: 'small', distribution: 'circle' } },
        { type: 'statue', count: 3, properties: { size: 'medium', distribution: 'random' } }
      ],
      layout_hints: {
        castle: '中心位置',
        towers: '四角分布',
        fence: '围墙保护'
      }
    }
  };

  return templates[sceneType] || templates.village;
}

// ===== 计算3D布局 =====
function calculateLayout(sceneConfig) {
  const layout = [];
  const usedPositions = [];
  
  for (const obj of sceneConfig.objects) {
    const distribution = obj.properties?.distribution || 'random';
    
    for (let i = 0; i < obj.count; i++) {
      let position;
      
      switch (distribution) {
        case 'background':
          // 远景物体（如山）
          position = {
            x: -30 + Math.random() * 60,
            y: 0,
            z: -30 - Math.random() * 15
          };
          break;
          
        case 'circle':
          // 圆形分布
          const angle = (i / obj.count) * Math.PI * 2;
          const radius = 8 + Math.random() * 2;
          position = {
            x: Math.cos(angle) * radius,
            y: 0,
            z: Math.sin(angle) * radius
          };
          break;
          
        case 'grid':
          // 网格分布
          const gridSize = Math.ceil(Math.sqrt(obj.count));
          const row = Math.floor(i / gridSize);
          const col = i % gridSize;
          position = {
            x: (col - gridSize / 2) * 8,
            y: 0,
            z: (row - gridSize / 2) * 8
          };
          break;
          
        case 'line':
          // 直线分布
          position = {
            x: -15 + (i / obj.count) * 30,
            y: 0,
            z: -5 + Math.random() * 2
          };
          break;
          
        case 'clustered':
          // 聚集分布
          const clusterX = (Math.random() - 0.5) * 10;
          const clusterZ = (Math.random() - 0.5) * 10;
          position = {
            x: clusterX + (Math.random() - 0.5) * 5,
            y: 0,
            z: clusterZ + (Math.random() - 0.5) * 5
          };
          break;
          
        default:
          // 随机分布
          position = {
            x: -20 + Math.random() * 40,
            y: 0,
            z: -20 + Math.random() * 40
          };
      }
      
      layout.push({
        type: obj.type,
        position,
        rotation: {
          x: 0,
          y: Math.random() * Math.PI * 2,
          z: 0
        },
        scale: getScaleBySize(obj.properties?.size),
        properties: obj.properties
      });
      
      usedPositions.push(position);
    }
  }
  
  return layout;
}

// ===== 根据size获取缩放比例 =====
function getScaleBySize(size) {
  const scales = {
    small: 0.7 + Math.random() * 0.3,
    medium: 1.0,
    large: 1.3 + Math.random() * 0.5,
    varied: 0.7 + Math.random() * 0.8
  };
  return scales[size] || 1.0;
}

// ===== API路由 =====

// 1. 生成场景
router.post('/generate-scene', async (req, res) => {
  try {
    const { description, provider, generation_mode } = req.body;

    if (!description || description.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: '请提供有效的场景描述（至少3个字符）'
      });
    }

    console.log('🎨 收到场景生成请求:', description);
    if (provider) {
      console.log('👤 用户指定AI提供商:', provider);
    }
    console.log('🔧 生成方式:', generation_mode || 'model-first');

    // 根据生成方式选择不同的处理逻辑
    if (generation_mode === 'threejs-direct') {
      // Three.js直接生成模式
      console.log('⚡ 使用Three.js直接生成模式');
      
      // 生成Three.js代码的提示词
      const threejsPrompt = `你是一个专业的Three.js 3D场景构建专家。请根据用户描述，生成完整的Three.js代码来创建一个3D场景。

## 用户描述：${description}

## 要求：
1. 生成完整的HTML文件，包含所有必要的Three.js导入
2. 创建一个美观的3D场景，包含用户描述的所有元素
3. 添加适当的光照、材质和纹理
4. 包含相机控制（OrbitControls）
5. 添加简单的动画效果
6. 代码要完整可运行，不需要用户修改
7. 只输出HTML代码，不要其他文字

## 示例结构：
<!DOCTYPE html>
<html>
<head>
    <title>Three.js场景</title>
    <!-- Three.js导入 -->
</head>
<body>
    <div id="scene-container"></div>
    <script>
        // Three.js代码
    </script>
</body>
</html>`;
      
      // 调用AI生成Three.js代码（优先从数据库读取配置）
      let threejsCode;
      const selectedProvider = provider || 'doubao';
      const dbConfig = await getAIProviderConfig(selectedProvider);
      
      if (dbConfig && dbConfig.enabled) {
        // 使用数据库配置
        console.log(`✅ Three.js生成：使用数据库配置的 ${selectedProvider}`);
        if (selectedProvider === 'qwen') {
          // 角色扮演模型不适合代码生成，自动替换
          const CHARACTER_MODELS = ['qwen-flash-character', 'qwen-turbo-character', 'qwen-plus-character', 'qwen-max-character'];
          const qwenModel = CHARACTER_MODELS.includes(dbConfig.model) ? 'qwen-plus' : dbConfig.model;
          if (qwenModel !== dbConfig.model) console.log(`🔧 Three.js模式：千问模型自动替换 ${dbConfig.model} → ${qwenModel}`);
          const resp = await axios.post(dbConfig.endpoint, {
            model: qwenModel,
            input: {
              messages: [
                { role: 'system', content: '你是一个专业的Three.js 3D场景构建专家' },
                { role: 'user', content: threejsPrompt }
              ]
            },
            parameters: { result_format: 'message', temperature: 0.3, max_tokens: 5000 }
          }, {
            headers: { 'Authorization': `Bearer ${dbConfig.apiKey}`, 'Content-Type': 'application/json' },
            timeout: 120000
          });
          threejsCode = resp.data.output.choices[0].message.content;
        } else {
          // doubao or others using OpenAI-compatible API
          const resp = await axios.post(dbConfig.endpoint, {
            model: dbConfig.model,
            messages: [
              { role: 'system', content: '你是一个专业的Three.js 3D场景构建专家' },
              { role: 'user', content: threejsPrompt }
            ],
            temperature: 0.3,
            max_tokens: 5000
          }, {
            headers: { 'Authorization': `Bearer ${dbConfig.apiKey}`, 'Content-Type': 'application/json' },
            timeout: 120000
          });
          threejsCode = resp.data.choices[0].message.content;
        }
      } else if (selectedProvider === 'qwen' && AI_PROVIDERS.qwen.enabled) {
        // 环境变量降级
        const resp = await axios.post(AI_PROVIDERS.qwen.endpoint, {
          model: AI_PROVIDERS.qwen.model,
          input: { messages: [{ role: 'system', content: '你是一个专业的Three.js 3D场景构建专家' }, { role: 'user', content: threejsPrompt }] },
          parameters: { result_format: 'message', temperature: 0.3, max_tokens: 5000 }
        }, { headers: { 'Authorization': `Bearer ${process.env.QWEN_API_KEY}`, 'Content-Type': 'application/json' } });
        threejsCode = resp.data.output.choices[0].message.content;
      } else if (AI_PROVIDERS.doubao.enabled) {
        const resp = await axios.post(AI_PROVIDERS.doubao.endpoint, {
          model: AI_PROVIDERS.doubao.model,
          messages: [{ role: 'system', content: '你是一个专业的Three.js 3D场景构建专家' }, { role: 'user', content: threejsPrompt }],
          temperature: 0.3,
          max_tokens: 5000
        }, { headers: { 'Authorization': `Bearer ${process.env.DOUBAO_API_KEY}`, 'Content-Type': 'application/json' } });
        threejsCode = resp.data.choices[0].message.content;
      } else {
        throw new Error('没有可用的AI提供商，请在后台配置AI密钥');
      }
      
      console.log('✅ Three.js代码生成完成');
      
      res.json({
        success: true,
        description,
        generation_mode: 'threejs-direct',
        threejs_code: threejsCode,
        provider: selectedProvider,
        timestamp: new Date().toISOString()
      });
    } else {
      // 模型库优先模式（默认）
      console.log('📦 使用模型库优先模式');
      
      // 调用AI生成（传递用户选择的提供商）
      const { config, provider: usedProvider } = await generateScene(description, provider);

      // 计算布局
      const layout = calculateLayout(config);

      console.log(`✅ 场景生成完成，使用 ${usedProvider}，共 ${layout.length} 个物体`);

      res.json({
        success: true,
        description,
        generation_mode: 'model-first',
        config,
        layout,
        object_count: layout.length,
        provider: usedProvider,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('❌ 场景生成错误:', error);
    res.status(500).json({
      success: false,
      error: '场景生成失败',
      details: error.message
    });
  }
});

// 2. 检查API状态
router.get('/status', (req, res) => {
  const status = {};
  
  for (const [key, provider] of Object.entries(AI_PROVIDERS)) {
    status[key] = {
      name: provider.name,
      enabled: provider.enabled,
      model: provider.model
    };
  }
  
  res.json({
    success: true,
    providers: status,
    has_any_provider: Object.values(AI_PROVIDERS).some(p => p.enabled)
  });
});

// 3. 获取默认场景（不消耗API）
router.post('/default-scene', (req, res) => {
  try {
    const { description } = req.body;
    const config = getDefaultSceneByKeywords(description || '村庄');
    const layout = calculateLayout(config);

    res.json({
      success: true,
      config,
      layout,
      object_count: layout.length,
      provider: 'default'
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ===== 场景保存和管理 =====
const { query } = require('../database/db');

// ===== 获取数据库中可用的模型 =====
async function getAvailableModels() {
  try {
    console.log('📦 开始获取数据库中的可用模型...');
    
    // 1. 获取几何体建筑（geometry_buildings）- 显示所有模型
    const geometryResult = await query(`
      SELECT id, name, tags, created_at
      FROM geometry_buildings
      ORDER BY created_at DESC
    `);
    
    // 2. 获取上传的模型（uploaded_models）- 显示所有模型
    const uploadedResult = await query(`
      SELECT id, file_name as name, tags, model_path, created_at
      FROM uploaded_models
      ORDER BY created_at DESC
    `).catch(() => ({ rows: [] }));
    
    // 3. 获取AI生成的建筑（generated_buildings表）- 显示所有模型
    const buildingsResult = await query(`
      SELECT id, name, tags, local_path as model_path, created_at
      FROM generated_buildings
      WHERE status = 'completed'
      ORDER BY created_at DESC
      LIMIT 50
    `).catch(() => ({ rows: [] }));
    
    // 4. 获取AI生成的场景（ai_generated_scenes表）- 显示所有场景
    const scenesResult = await query(`
      SELECT id, scene_name as name, tags, scene_type, object_count, created_at
      FROM ai_generated_scenes
      ORDER BY created_at DESC
    `).catch(() => ({ rows: [] }));
    
    // 5. 获取world_objects中的几何体建筑（去重）- 提取几何体类型
    const worldObjectsResult = await query(`
      SELECT DISTINCT model_path
      FROM world_objects
      WHERE model_path LIKE 'geometry:%'
      LIMIT 100
    `).catch((err) => {
      console.warn('⚠️ 查询world_objects失败:', err.message);
      return { rows: [] };
    });
    
    // 按标签分组模型
    const modelsByTag = {};
    const allModels = [];
    
    // 处理几何体建筑
    geometryResult.rows.forEach(model => {
      const modelInfo = {
        id: `geometry_${model.id}`,
        name: model.name,
        type: 'geometry_building',
        model_id: model.id,
        tags: model.tags || []
      };
      allModels.push(modelInfo);
      
      // 如果没有标签，归类到"未分类"
      if (!model.tags || model.tags.length === 0) {
        if (!modelsByTag['未分类']) modelsByTag['未分类'] = [];
        modelsByTag['未分类'].push(modelInfo);
      } else {
        model.tags.forEach(tag => {
          if (!modelsByTag[tag]) modelsByTag[tag] = [];
          modelsByTag[tag].push(modelInfo);
        });
      }
    });
    
    // 处理上传的模型
    uploadedResult.rows.forEach(model => {
      const modelInfo = {
        id: `uploaded_${model.id}`,
        name: model.name,
        type: 'uploaded_model',
        model_id: model.id,
        model_path: model.model_path,
        tags: model.tags || []
      };
      allModels.push(modelInfo);
      
      // 如果没有标签，归类到"未分类"
      if (!model.tags || model.tags.length === 0) {
        if (!modelsByTag['未分类']) modelsByTag['未分类'] = [];
        modelsByTag['未分类'].push(modelInfo);
      } else {
        model.tags.forEach(tag => {
          if (!modelsByTag[tag]) modelsByTag[tag] = [];
          modelsByTag[tag].push(modelInfo);
        });
      }
    });
    
    // 处理AI建筑（buildings表）
    buildingsResult.rows.forEach(model => {
      const modelInfo = {
        id: `building_${model.id}`,
        name: model.name,
        type: 'generated_building',
        model_id: model.id,
        model_path: model.model_path,
        tags: model.tags || []
      };
      allModels.push(modelInfo);
      
      // 如果没有标签，归类到"未分类"
      if (!model.tags || model.tags.length === 0) {
        if (!modelsByTag['未分类']) modelsByTag['未分类'] = [];
        modelsByTag['未分类'].push(modelInfo);
      } else {
        model.tags.forEach(tag => {
          if (!modelsByTag[tag]) modelsByTag[tag] = [];
          modelsByTag[tag].push(modelInfo);
        });
      }
    });
    
    // 处理AI生成的场景（ai_generated_scenes表）
    scenesResult.rows.forEach(scene => {
      const modelInfo = {
        id: `scene_${scene.id}`,
        name: scene.name,
        type: 'ai_scene',
        model_id: scene.id,
        scene_type: scene.scene_type,
        object_count: scene.object_count,
        tags: scene.tags || []
      };
      allModels.push(modelInfo);
      
      // 如果没有标签，归类到"未分类"
      if (!scene.tags || scene.tags.length === 0) {
        if (!modelsByTag['未分类']) modelsByTag['未分类'] = [];
        modelsByTag['未分类'].push(modelInfo);
      } else {
        scene.tags.forEach(tag => {
          if (!modelsByTag[tag]) modelsByTag[tag] = [];
          modelsByTag[tag].push(modelInfo);
        });
      }
    });
    
    // 处理world_objects中的几何体（提取几何体类型）
    worldObjectsResult.rows.forEach(obj => {
      // 从 model_path 提取几何体类型，例如 "geometry:tree" -> "tree"
      const geometryType = obj.model_path.replace('geometry:', '');
      const modelInfo = {
        id: `world_geo_${geometryType}`,
        name: `${geometryType} (场景物体)`,
        type: 'world_geometry',
        model_id: geometryType, // 使用几何体类型作为ID
        geometry_type: geometryType,
        tags: ['场景物体', geometryType]
      };
      
      // 检查是否已存在相同的几何体类型
      const exists = allModels.some(m => 
        m.type === 'world_geometry' && m.geometry_type === geometryType
      );
      
      if (!exists) {
        allModels.push(modelInfo);
        
        // 添加到标签分类
        modelInfo.tags.forEach(tag => {
          if (!modelsByTag[tag]) modelsByTag[tag] = [];
          modelsByTag[tag].push(modelInfo);
        });
      }
    });
    
    console.log(`✅ 获取到 ${allModels.length} 个可用模型`);
    console.log(`   - 几何体建筑: ${geometryResult.rows.length}`);
    console.log(`   - 上传模型: ${uploadedResult.rows.length}`);
    console.log(`   - AI建筑: ${buildingsResult.rows.length}`);
    console.log(`   - AI场景: ${scenesResult.rows.length}`);
    console.log(`   - 场景几何体: ${worldObjectsResult.rows.length}`);
    console.log(`📊 标签分类: ${Object.keys(modelsByTag).length} 个标签`);
    
    return {
      allModels,
      modelsByTag,
      totalCount: allModels.length,
      availableTags: Object.keys(modelsByTag).sort()
    };
    
  } catch (error) {
    console.error('❌ 获取可用模型失败:', error);
    return {
      allModels: [],
      modelsByTag: {},
      totalCount: 0,
      availableTags: []
    };
  }
}

// 5. API: 获取可用模型列表
router.get('/available-models', async (req, res) => {
  try {
    const models = await getAvailableModels();
    res.json({
      success: true,
      ...models
    });
  } catch (error) {
    console.error('❌ 获取可用模型失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 调试API: 检查所有模型数量（包括无标签的）
router.get('/debug-models-count', async (req, res) => {
  try {
    // 获取所有模型（不管有没有标签）
    const geometryAll = await query('SELECT COUNT(*) FROM geometry_buildings');
    const geometryTagged = await query('SELECT COUNT(*) FROM geometry_buildings WHERE tags IS NOT NULL AND array_length(tags, 1) > 0');
    
    const uploadedAll = await query('SELECT COUNT(*) FROM uploaded_models').catch(() => ({ rows: [{ count: 0 }] }));
    const uploadedTagged = await query('SELECT COUNT(*) FROM uploaded_models WHERE tags IS NOT NULL AND array_length(tags, 1) > 0').catch(() => ({ rows: [{ count: 0 }] }));
    
    const buildingsAll = await query('SELECT COUNT(*) FROM buildings');
    const buildingsTagged = await query('SELECT COUNT(*) FROM buildings WHERE tags IS NOT NULL AND array_length(tags, 1) > 0');
    
    res.json({
      success: true,
      geometry_buildings: {
        total: parseInt(geometryAll.rows[0].count),
        with_tags: parseInt(geometryTagged.rows[0].count),
        without_tags: parseInt(geometryAll.rows[0].count) - parseInt(geometryTagged.rows[0].count)
      },
      uploaded_models: {
        total: parseInt(uploadedAll.rows[0].count),
        with_tags: parseInt(uploadedTagged.rows[0].count),
        without_tags: parseInt(uploadedAll.rows[0].count) - parseInt(uploadedTagged.rows[0].count)
      },
      buildings: {
        total: parseInt(buildingsAll.rows[0].count),
        with_tags: parseInt(buildingsTagged.rows[0].count),
        without_tags: parseInt(buildingsAll.rows[0].count) - parseInt(buildingsTagged.rows[0].count)
      }
    });
  } catch (error) {
    console.error('❌ 调试查询失败:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 4. 保存场景到数据库
router.post('/save-scene', async (req, res) => {
  try {
    const {
      scene_name,
      description,
      scene_type,
      scene_config,
      layout_data,
      object_count,
      ai_provider,
      user_id,
      is_public,
      tags
    } = req.body;

    // 验证必填字段
    if (!scene_name || !description || !scene_config || !layout_data) {
      return res.status(400).json({
        success: false,
        error: '缺少必要字段：scene_name, description, scene_config, layout_data'
      });
    }

    // 插入数据库
    const result = await query(`
      INSERT INTO ai_generated_scenes 
      (scene_name, description, scene_type, scene_config, layout_data, object_count, ai_provider, user_id, is_public, tags)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, scene_name, created_at
    `, [
      scene_name,
      description,
      scene_type || 'unknown',
      JSON.stringify(scene_config),
      JSON.stringify(layout_data),
      object_count || 0,
      ai_provider || 'unknown',
      user_id || null,
      is_public || false,
      tags || []
    ]);

    const savedScene = result.rows[0];

    console.log(`✅ 场景已保存: ID=${savedScene.id}, Name=${savedScene.scene_name}`);

    res.json({
      success: true,
      message: '场景保存成功',
      scene_id: savedScene.id,
      scene_name: savedScene.scene_name,
      created_at: savedScene.created_at
    });

  } catch (error) {
    console.error('❌ 保存场景失败:', error);
    res.status(500).json({
      success: false,
      error: '保存场景失败',
      details: error.message
    });
  }
});

// 5. 获取已保存的场景列表
router.get('/saved-scenes', async (req, res) => {
  try {
    const { user_id, is_public, scene_type, limit = 50, offset = 0 } = req.query;

    let queryText = `
      SELECT 
        id, scene_name, description, scene_type, object_count, 
        ai_provider, view_count, tags, is_public, created_at, updated_at
      FROM ai_generated_scenes
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    // 过滤条件
    if (user_id) {
      queryText += ` AND user_id = $${paramIndex++}`;
      params.push(user_id);
    }
    if (is_public !== undefined) {
      queryText += ` AND is_public = $${paramIndex++}`;
      params.push(is_public === 'true');
    }
    if (scene_type) {
      queryText += ` AND scene_type = $${paramIndex++}`;
      params.push(scene_type);
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await query(queryText, params);

    // 获取总数
    const countResult = await query(`
      SELECT COUNT(*) as total FROM ai_generated_scenes WHERE 1=1
      ${user_id ? 'AND user_id = $1' : ''}
    `, user_id ? [user_id] : []);

    res.json({
      success: true,
      scenes: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

  } catch (error) {
    console.error('❌ 获取场景列表失败:', error);
    res.status(500).json({
      success: false,
      error: '获取场景列表失败',
      details: error.message
    });
  }
});

// 6. 获取单个场景详情
router.get('/scene/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      SELECT * FROM ai_generated_scenes WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '场景不存在'
      });
    }

    // 增加浏览次数
    await query(`
      UPDATE ai_generated_scenes SET view_count = view_count + 1 WHERE id = $1
    `, [id]);

    res.json({
      success: true,
      scene: result.rows[0]
    });

  } catch (error) {
    console.error('❌ 获取场景详情失败:', error);
    res.status(500).json({
      success: false,
      error: '获取场景详情失败',
      details: error.message
    });
  }
});

// 7. 更新场景
router.put('/scene/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { scene_name, description, is_public, tags } = req.body;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (scene_name) {
      updates.push(`scene_name = $${paramIndex++}`);
      params.push(scene_name);
    }
    if (description) {
      updates.push(`description = $${paramIndex++}`);
      params.push(description);
    }
    if (is_public !== undefined) {
      updates.push(`is_public = $${paramIndex++}`);
      params.push(is_public);
    }
    if (tags) {
      updates.push(`tags = $${paramIndex++}`);
      params.push(tags);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: '没有要更新的字段'
      });
    }

    params.push(id);
    const queryText = `
      UPDATE ai_generated_scenes 
      SET ${updates.join(', ')} 
      WHERE id = $${paramIndex}
      RETURNING id, scene_name, updated_at
    `;

    const result = await query(queryText, params);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '场景不存在'
      });
    }

    res.json({
      success: true,
      message: '场景更新成功',
      scene: result.rows[0]
    });

  } catch (error) {
    console.error('❌ 更新场景失败:', error);
    res.status(500).json({
      success: false,
      error: '更新场景失败',
      details: error.message
    });
  }
});

// 8. 删除场景
router.delete('/scene/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(`
      DELETE FROM ai_generated_scenes WHERE id = $1 RETURNING id, scene_name
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '场景不存在'
      });
    }

    res.json({
      success: true,
      message: '场景删除成功',
      deleted_scene: result.rows[0]
    });

  } catch (error) {
    console.error('❌ 删除场景失败:', error);
    res.status(500).json({
      success: false,
      error: '删除场景失败',
      details: error.message
    });
  }
});

// 9. 获取场景统计信息
router.get('/stats', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        COUNT(*) as total_scenes,
        COUNT(CASE WHEN is_public = true THEN 1 END) as public_scenes,
        COUNT(DISTINCT scene_type) as scene_types,
        SUM(view_count) as total_views,
        COUNT(DISTINCT ai_provider) as ai_providers_used
      FROM ai_generated_scenes
    `);

    const typeDistribution = await query(`
      SELECT scene_type, COUNT(*) as count
      FROM ai_generated_scenes
      GROUP BY scene_type
      ORDER BY count DESC
    `);

    res.json({
      success: true,
      stats: result.rows[0],
      type_distribution: typeDistribution.rows
    });

  } catch (error) {
    console.error('❌ 获取统计信息失败:', error);
    res.status(500).json({
      success: false,
      error: '获取统计信息失败',
      details: error.message
    });
  }
});

// ===== 场景导入到虚拟世界 =====

// 10. 将AI场景导入到虚拟世界
router.post('/import-to-world/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { base_position } = req.body; // 可选：场景在世界中的基础位置

    console.log(`🌍 开始导入场景 ${id} 到虚拟世界...`);

    // 1. 获取场景数据
    const sceneResult = await query(`
      SELECT * FROM ai_generated_scenes WHERE id = $1
    `, [id]);

    if (sceneResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '场景不存在'
      });
    }

    const scene = sceneResult.rows[0];
    const layout = scene.layout_data;
    
    // 基础位置偏移（默认在原点）
    const baseX = base_position?.x || 0;
    const baseY = base_position?.y || 0;
    const baseZ = base_position?.z || 0;

    // 2. 几何体类型到world_objects类型的映射
    const typeMapping = {
      // 建筑类
      cottage: 'geometry_building',
      house: 'geometry_building',
      skyscraper: 'geometry_building',
      castle: 'geometry_building',
      tower: 'geometry_building',
      barn: 'geometry_building',
      shed: 'geometry_building',
      temple: 'geometry_building',
      pyramid: 'geometry_building',
      
      // 自然类
      mountain: 'geometry_terrain',
      hill: 'geometry_terrain',
      tree: 'geometry_nature',
      rock: 'geometry_nature',
      bush: 'geometry_nature',
      flower: 'geometry_nature',
      grass: 'geometry_nature',
      crystal: 'geometry_decoration',
      
      // 动物类
      hen: 'geometry_animal',
      chick: 'geometry_animal',
      cat: 'geometry_animal',
      dog: 'geometry_animal',
      bird: 'geometry_animal',
      butterfly: 'geometry_animal',
      fish: 'geometry_animal',
      
      // 装饰类
      fence: 'geometry_decoration',
      lamp: 'geometry_decoration',
      bench: 'geometry_decoration',
      fountain: 'geometry_decoration',
      statue: 'geometry_decoration',
      sign: 'geometry_decoration',
      portal: 'geometry_decoration',
      
      // 交通工具
      car: 'geometry_vehicle',
      boat: 'geometry_vehicle',
      spaceship: 'geometry_vehicle',
      bike: 'geometry_vehicle',
      
      // 道具
      chest: 'geometry_prop',
      barrel: 'geometry_prop',
      crate: 'geometry_prop'
    };

    // 3. 批量插入到world_objects表
    const insertedObjects = [];
    let successCount = 0;
    let failedCount = 0;

    for (const item of layout) {
      try {
        const worldType = typeMapping[item.type] || 'geometry_object';
        const name = `${scene.scene_name}_${item.type}_${insertedObjects.length + 1}`;

        const result = await query(`
          INSERT INTO world_objects 
          (type, name, model_path, position_x, position_y, position_z, 
           rotation_x, rotation_y, rotation_z, scale_x, scale_y, scale_z)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING id
        `, [
          worldType,
          name,
          `geometry:${item.type}`, // 使用特殊标记表示这是几何体
          baseX + item.position.x,
          baseY + item.position.y,
          baseZ + item.position.z,
          item.rotation.x,
          item.rotation.y,
          item.rotation.z,
          item.scale || 1,
          item.scale || 1,
          item.scale || 1
        ]);

        insertedObjects.push({
          id: result.rows[0].id,
          type: item.type,
          world_type: worldType,
          name: name
        });
        
        successCount++;
      } catch (error) {
        console.error(`❌ 插入对象失败 (${item.type}):`, error.message);
        failedCount++;
      }
    }

    // 4. 更新场景的view_count
    await query(`
      UPDATE ai_generated_scenes SET view_count = view_count + 1 WHERE id = $1
    `, [id]);

    console.log(`✅ 场景导入完成: 成功 ${successCount}, 失败 ${failedCount}`);

    res.json({
      success: true,
      message: '场景已导入到虚拟世界',
      scene_id: id,
      scene_name: scene.scene_name,
      imported_objects: insertedObjects,
      success_count: successCount,
      failed_count: failedCount,
      base_position: {
        x: baseX,
        y: baseY,
        z: baseZ
      }
    });

  } catch (error) {
    console.error('❌ 导入场景到虚拟世界失败:', error);
    res.status(500).json({
      success: false,
      error: '导入场景失败',
      details: error.message
    });
  }
});

// 11. 预览场景可以导入的位置
router.get('/import-preview/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // 获取场景数据
    const sceneResult = await query(`
      SELECT id, scene_name, scene_type, layout_data, object_count
      FROM ai_generated_scenes WHERE id = $1
    `, [id]);

    if (sceneResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: '场景不存在'
      });
    }

    const scene = sceneResult.rows[0];
    const layout = scene.layout_data;

    // 计算场景的边界框
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    layout.forEach(item => {
      minX = Math.min(minX, item.position.x);
      maxX = Math.max(maxX, item.position.x);
      minZ = Math.min(minZ, item.position.z);
      maxZ = Math.max(maxZ, item.position.z);
      minY = Math.min(minY, item.position.y);
      maxY = Math.max(maxY, item.position.y);
    });

    const size = {
      width: maxX - minX,
      height: maxY - minY,
      depth: maxZ - minZ
    };

    const center = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2
    };

    // 推荐的导入位置（避开原点）
    const recommendedPositions = [
      { name: '原点附近', x: 0, y: 0, z: 0 },
      { name: '东侧区域', x: 100, y: 0, z: 0 },
      { name: '西侧区域', x: -100, y: 0, z: 0 },
      { name: '北侧区域', x: 0, y: 0, z: 100 },
      { name: '南侧区域', x: 0, y: 0, z: -100 }
    ];

    res.json({
      success: true,
      scene: {
        id: scene.id,
        name: scene.scene_name,
        type: scene.scene_type,
        object_count: scene.object_count
      },
      bounds: {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
        size,
        center
      },
      recommended_positions: recommendedPositions
    });

  } catch (error) {
    console.error('❌ 预览导入失败:', error);
    res.status(500).json({
      success: false,
      error: '预览导入失败',
      details: error.message
    });
  }
});

// ===== 智能模型匹配功能 =====

// 8. 智能模型匹配 - 根据场景描述匹配已有模型
router.post('/match-models', async (req, res) => {
  try {
    const { description, userId, maxResults = 10 } = req.body;

    if (!description || description.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: '请提供有效的场景描述（至少3个字符）'
      });
    }

    console.log('🔍 收到模型匹配请求:', description);

    // 调用智能匹配服务
    const result = await modelMatcher.matchModelsForScene(
      description, 
      userId, 
      maxResults
    );

    if (!result.success) {
      return res.status(500).json(result);
    }

    // 为匹配的模型生成布局
    const layout = modelMatcher.generateLayoutForModels(result.models);

    console.log(`✅ 模型匹配完成，找到 ${result.models.length} 个模型`);

    res.json({
      success: true,
      description,
      models: result.models,
      layout,
      analysis: result.analysis,
      total: result.total,
      returned: result.models.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ 模型匹配失败:', error);
    res.status(500).json({
      success: false,
      error: '模型匹配失败',
      details: error.message
    });
  }
});

// 9. 混合模式 - AI生成 + 模型匹配（增强版）
router.post('/generate-with-models', async (req, res) => {
  try {
    const { description, userId, useExistingModels = true, provider } = req.body;

    if (!description || description.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: '请提供有效的场景描述'
      });
    }

    console.log('🎨 收到混合模式场景生成请求:', description);
    console.log('   用户ID:', userId || 'anonymous');
    console.log('   使用已有模型:', useExistingModels);
    console.log('   指定提供商:', provider || 'auto');

    const result = {
      success: true,
      description,
      timestamp: new Date().toISOString()
    };

    // 1. 先尝试匹配已有模型（通过标签）
    if (useExistingModels) {
      console.log('📦 步骤1: 搜索匹配的已有模型（基于标签）...');
      try {
        const matchResult = await modelMatcher.matchModelsForScene(description, userId, 30);
        
        result.existingModels = {
          found: matchResult.models.length,
          models: matchResult.models,
          layout: modelMatcher.generateLayoutForModels(matchResult.models)
        };
        
        console.log(`  ✅ 从所有模型库找到 ${matchResult.models.length} 个匹配模型`);
        console.log(`     - 几何体: ${matchResult.models.filter(m => m.source_type === 'geometry').length}`);
        console.log(`     - 上传模型: ${matchResult.models.filter(m => m.source_type === 'uploaded').length}`);
        console.log(`     - AI建筑: ${matchResult.models.filter(m => m.source_type === 'building').length}`);
      } catch (error) {
        console.warn('  ⚠️ 模型匹配失败，跳过:', error.message);
        result.existingModels = {
          found: 0,
          models: [],
          layout: []
        };
      }
    }

    // 2. 然后用AI生成补充模型
    console.log('🤖 步骤2: AI生成补充场景...');
    try {
      const { config, provider: usedProvider } = await generateScene(description, provider);
      const aiLayout = calculateLayout(config);
      
      result.aiGenerated = {
        config,
        layout: aiLayout,
        count: aiLayout.length,
        provider: usedProvider
      };
      
      console.log(`  ✅ AI生成 ${aiLayout.length} 个物体（使用${usedProvider}）`);
    } catch (error) {
      console.warn('  ⚠️ AI生成失败，仅使用已有模型:', error.message);
      result.aiGenerated = null;
    }

    // 3. 合并布局（优先使用已有模型）
    const combinedLayout = [];
    
    // 添加已有模型（优先，带真实模型路径）
    if (result.existingModels && result.existingModels.models.length > 0) {
      result.existingModels.layout.forEach(item => {
        combinedLayout.push({
          ...item,
          source: 'existing_model',
          sourceType: item.sourceType || 'uploaded',
          modelPath: item.modelPath,
          hasRealModel: true,
          tags: item.tags || [],
          relevance: item.relevance_score || 0
        });
      });
    }
    
    // 添加AI生成的物体（作为补充）
    if (result.aiGenerated && result.aiGenerated.layout.length > 0) {
      result.aiGenerated.layout.forEach(item => {
        combinedLayout.push({
          ...item,
          source: 'ai_generated',
          sourceType: 'geometry',
          type: item.type,
          hasRealModel: false,  // 这些是几何体，不是真实模型
          isGeometry: true
        });
      });
    }

    result.combinedLayout = combinedLayout;
    result.totalObjects = combinedLayout.length;
    result.realModelsCount = combinedLayout.filter(item => item.hasRealModel).length;
    result.geometryCount = combinedLayout.filter(item => item.isGeometry).length;

    console.log(`✅ 混合场景生成完成，共 ${result.totalObjects} 个物体`);
    console.log(`   - 真实模型: ${result.realModelsCount} 个`);
    console.log(`   - 几何体补充: ${result.geometryCount} 个`);

    res.json(result);

  } catch (error) {
    console.error('❌ 混合模式生成失败:', error);
    res.status(500).json({
      success: false,
      error: '场景生成失败',
      details: error.message
    });
  }
});

// ============ 新功能：生成单个OBJ模型 ============

const objGenerator = require('../services/objGenerator');
const autoTagService = require('../services/autoTagService');
const fs = require('fs').promises;
const path = require('path');

/**
 * 10. 生成单个OBJ几何体模型
 * POST /api/ai-scene/generate-geometry-obj
 */
router.post('/generate-geometry-obj', async (req, res) => {
  try {
    const { description, provider = 'doubao' } = req.body;

    if (!description || description.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: '请提供有效的模型描述'
      });
    }

    console.log('🎲 收到OBJ模型生成请求:', description);
    console.log('   AI提供商:', provider);

    // Step 1: 使用AI分析模型描述，提取几何体类型和属性
    const analysis = await analyzeModelDescription(description, provider);
    
    console.log('📊 AI分析结果:', JSON.stringify(analysis, null, 2));

    // Step 2: 生成OBJ文件内容
    const objContent = objGenerator.generateGeometryOBJ(
      analysis.geometryType,
      analysis.properties
    );

    // Step 3: 生成文件名
    const modelName = analysis.name || `model_${Date.now()}`;
    const fileName = `${modelName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')}.obj`;

    // Step 4: 保存OBJ文件到临时目录
    const uploadsDir = path.join(__dirname, '../../public/uploaded/geometry_obj');
    await fs.mkdir(uploadsDir, { recursive: true });
    
    const objPath = path.join(uploadsDir, fileName);
    await fs.writeFile(objPath, objContent, 'utf8');

    console.log(`✅ OBJ文件已生成: ${fileName}`);

    // Step 5: AI自动打标签
    let tags = [];
    let category = 'building';
    
    try {
      const tagResult = await autoTagService.autoTagGeometry({
        name: modelName,
        template_id: analysis.geometryType,
        config: analysis.properties
      });
      
      tags = tagResult.tags || [];
      category = tagResult.category || 'building';
      
      console.log(`🏷️ 自动标签: ${tags.join(', ')} [${category}]`);
    } catch (error) {
      console.warn('⚠️ 自动标签失败，使用默认标签:', error.message);
      tags = [analysis.geometryType, '几何体'];
    }

    // 返回结果
    const result = {
      success: true,
      model: {
        name: modelName,
        obj_content: objContent,
        obj_path: `/uploaded/geometry_obj/${fileName}`,
        geometry_type: analysis.geometryType,
        properties: analysis.properties,
        tags,
        category
      },
      provider: AI_PROVIDERS[provider]?.name || provider,
      description: analysis.description || description
    };

    res.json(result);

  } catch (error) {
    console.error('❌ OBJ模型生成失败:', error);
    res.status(500).json({
      success: false,
      error: '模型生成失败',
      details: error.message
    });
  }
});

/**
 * AI分析模型描述，提取几何体类型和属性
 */
async function analyzeModelDescription(description, provider) {
  const systemPrompt = `你是3D模型分析专家。根据用户的模型描述，提取几何体信息。

**输出JSON格式（不要markdown标记）：**
{
  "name": "模型名称",
  "geometryType": "几何体类型",
  "properties": {
    "width": 数值,
    "height": 数值,
    "depth": 数值,
    "radius": 数值
  },
  "description": "简短描述"
}

**可用几何体类型：**
box, cube, cylinder, sphere, cone, pyramid, house, cottage, tower, tree

**示例：**
输入："一个现代风格的公寓大楼"
输出：{"name":"现代公寓","geometryType":"box","properties":{"width":8,"height":20,"depth":6},"description":"现代风格的高层公寓建筑"}

输入："中式古典亭子"
输出：{"name":"古典亭子","geometryType":"house","properties":{"width":4,"height":5,"depth":4},"description":"中式古典风格的凉亭"}`;

  const userPrompt = `分析模型描述：${description}`;

  try {
    let response;
    
    if (provider === 'doubao' && AI_PROVIDERS.doubao.enabled) {
      response = await callDoubaoAnalysis(userPrompt, systemPrompt);
    } else if (provider === 'qwen' && AI_PROVIDERS.qwen.enabled) {
      response = await callQwenAnalysis(userPrompt, systemPrompt);
    } else {
      // 降级到关键词匹配
      return analyzeByKeywords(description);
    }

    // 解析JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    throw new Error('AI返回格式无效');

  } catch (error) {
    console.warn('⚠️ AI分析失败，使用关键词匹配:', error.message);
    return analyzeByKeywords(description);
  }
}

/**
 * 关键词匹配分析（降级方案）
 */
function analyzeByKeywords(description) {
  const lower = description.toLowerCase();
  
  // 建筑类型检测
  if (lower.includes('房') || lower.includes('屋') || lower.includes('building')) {
    return {
      name: '建筑物',
      geometryType: 'house',
      properties: { width: 5, height: 6, depth: 5 },
      description: description
    };
  }
  
  if (lower.includes('塔') || lower.includes('tower')) {
    return {
      name: '塔楼',
      geometryType: 'tower',
      properties: { radius: 2, height: 15, segments: 12 },
      description: description
    };
  }
  
  if (lower.includes('树') || lower.includes('tree')) {
    return {
      name: '树',
      geometryType: 'tree',
      properties: { height: 5, radius: 2 },
      description: description
    };
  }
  
  if (lower.includes('圆柱') || lower.includes('cylinder') || lower.includes('柱子')) {
    return {
      name: '圆柱体',
      geometryType: 'cylinder',
      properties: { radius: 1, height: 5, segments: 16 },
      description: description
    };
  }
  
  if (lower.includes('球') || lower.includes('sphere')) {
    return {
      name: '球体',
      geometryType: 'sphere',
      properties: { radius: 2, segments: 16 },
      description: description
    };
  }
  
  if (lower.includes('锥') || lower.includes('cone') || lower.includes('金字塔') || lower.includes('pyramid')) {
    return {
      name: '圆锥体',
      geometryType: 'cone',
      properties: { radius: 2, height: 4, segments: 16 },
      description: description
    };
  }
  
  // 动物类型检测
  if (lower.includes('鸡') || lower.includes('小鸡') || lower.includes('chick') || lower.includes('chicken')) {
    return {
      name: '小鸡',
      geometryType: 'chick',
      properties: { width: 1.5, height: 1.5, depth: 1.5 },
      description: description
    };
  }
  
  // 默认：立方体
  return {
    name: '立方体',
    geometryType: 'box',
    properties: { width: 3, height: 3, depth: 3 },
    description: description
  };
}

/**
 * 专用于模型分析的AI调用函数
 */
async function callDoubaoAnalysis(userPrompt, systemPrompt) {
  const response = await axios.post(
    AI_PROVIDERS.doubao.endpoint,
    {
      model: AI_PROVIDERS.doubao.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.DOUBAO_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  return response.data.choices[0].message.content;
}

async function callQwenAnalysis(userPrompt, systemPrompt) {
  const response = await axios.post(
    AI_PROVIDERS.qwen.endpoint,
    {
      model: AI_PROVIDERS.qwen.model,
      input: {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      },
      parameters: {
        result_format: 'message'
      }
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.QWEN_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  return response.data.output.choices[0].message.content;
}

/**
 * 使用数据库配置调用豆包AI
 */
async function callDoubaoAnalysisWithConfig(userPrompt, systemPrompt, config) {
  console.log('🌐 [callDoubaoAnalysisWithConfig] 准备调用豆包API:');
  console.log(`  - endpoint: ${config.endpoint}`);
  console.log(`  - model: ${config.model}`);
  console.log(`  - apiKey长度: ${config.apiKey.length}`);
  console.log(`  - apiKey预览: ${config.apiKey.substring(0, 8)}...${config.apiKey.substring(config.apiKey.length - 4)}`);
  
  try {
    const response = await axios.post(
      config.endpoint,
      {
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 300000  // 300秒(5分钟),确保足够的处理时间
      }
    );
    
    console.log('✅ [callDoubaoAnalysisWithConfig] API调用成功');
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('❌ [callDoubaoAnalysisWithConfig] API调用失败:');
    console.error(`  - 状态码: ${error.response?.status}`);
    console.error(`  - 错误消息: ${error.message}`);
    console.error(`  - 错误代码: ${error.code}`);
    console.error('  - 响应数据:', error.response?.data);
    
    if (error.code === 'ECONNABORTED') {
      console.error('  ⚠️ 请求超时! 可能原因:');
      console.error('     1. 网络连接缓慢');
      console.error('     2. 模型推理时间过长');
      console.error('     3. 火山引擎服务响应慢');
    } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
      console.error('  ⚠️ 网络连接失败! 请检查:');
      console.error('     1. 网络连接是否正常');
      console.error('     2. DNS解析是否正常');
      console.error('     3. 防火墙设置');
    }
    
    throw error;
  }
}

/**
 * 使用数据库配置调用千问AI
 */
async function callQwenAnalysisWithConfig(userPrompt, systemPrompt, config) {
  const response = await axios.post(
    config.endpoint,
    {
      model: config.model,
      input: {
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      },
      parameters: {
        result_format: 'message'
      }
    },
    {
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  return response.data.output.choices[0].message.content;
}


/**
 * 11. AI生成Three.js几何体代码
 * POST /api/ai-scene/generate-threejs-code
 */
// 存储生成任务的Map（用于跟踪进度）
const generationTasks = new Map();

router.post('/generate-threejs-code', async (req, res) => {
  try {
    const { description, provider = 'doubao' } = req.body;

    if (!description || description.trim().length < 3) {
      return res.status(400).json({
        success: false,
        error: '请提供有效的模型描述'
      });
    }

    console.log('🎨 收到Three.js代码生成请求:', description);
    console.log('   AI提供商:', provider);

    // 生成任务ID
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 创建任务记录
    generationTasks.set(taskId, {
      status: 'starting',
      progress: 0,
      startTime: Date.now(),
      description,
      provider
    });

    // 设置10分钟超时
    const timeout = 600000; // 10分钟
    const timeoutTimer = setTimeout(() => {
      if (generationTasks.has(taskId)) {
        generationTasks.set(taskId, {
          ...generationTasks.get(taskId),
          status: 'timeout',
          error: '生成超时（10分钟）'
        });
      }
    }, timeout);

    try {
      // Step 1: 调用AI生成Three.js代码
      generationTasks.set(taskId, {
        ...generationTasks.get(taskId),
        status: 'generating',
        progress: 10
      });

      const codeResult = await generateThreeJSCode(description, provider, taskId);
      
      clearTimeout(timeoutTimer);
      
      console.log('✅ Three.js代码生成成功');

      generationTasks.set(taskId, {
        ...generationTasks.get(taskId),
        status: 'processing',
        progress: 60
      });

      // Step 2: 生成文件名
      const modelName = codeResult.name || `model_${Date.now()}`;
      const fileName = `${modelName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')}.js`;

      // Step 3: 保存JavaScript文件
      const jsDir = path.join(__dirname, '../../public/generated/geometry_js');
      await fs.mkdir(jsDir, { recursive: true });
      
      const jsPath = path.join(jsDir, fileName);
      await fs.writeFile(jsPath, codeResult.code, 'utf8');

      console.log(`✅ JavaScript文件已生成: ${fileName}`);

      generationTasks.set(taskId, {
        ...generationTasks.get(taskId),
        status: 'tagging',
        progress: 80
      });

      // Step 4: AI自动打标签
      let tags = [];
      let category = 'building';
      
      try {
        const tagResult = await autoTagService.autoTagGeometry({
          name: modelName,
          template_id: codeResult.geometryType || 'custom',
          config: {}
        });
        
        tags = tagResult.tags || [];
        category = tagResult.category || 'building';
        
        console.log(`🏷️ 自动标签: ${tags.join(', ')} [${category}]`);
      } catch (error) {
        console.warn('⚠️ 自动标签失败，使用默认标签:', error.message);
        tags = ['自定义', '几何体'];
      }

      // 标记完成
      generationTasks.set(taskId, {
        ...generationTasks.get(taskId),
        status: 'completed',
        progress: 100,
        completedTime: Date.now()
      });

      // 返回结果
      res.json({
        success: true,
        taskId,
        model: {
          name: modelName,
          js_code: codeResult.code,
          js_path: `/generated/geometry_js/${fileName}`,
          geometry_type: codeResult.geometryType || 'custom',
          description: codeResult.description,
          tags,
          category
        }
      });

      // 5分钟后清理任务记录
      setTimeout(() => {
        generationTasks.delete(taskId);
      }, 300000);

    } catch (error) {
      clearTimeout(timeoutTimer);
      throw error;
    }

  } catch (error) {
    console.error('❌ Three.js代码生成失败:', error);
    res.status(500).json({
      success: false,
      error: 'Three.js代码生成失败',
      details: error.message
    });
  }
});

// 新增：查询生成任务状态
router.get('/generate-threejs-status/:taskId', (req, res) => {
  const { taskId } = req.params;
  const task = generationTasks.get(taskId);
  
  if (!task) {
    return res.json({
      success: false,
      error: '任务不存在或已过期'
    });
  }

  const elapsedTime = Date.now() - task.startTime;
  const elapsedSeconds = Math.floor(elapsedTime / 1000);

  res.json({
    success: true,
    task: {
      status: task.status,
      progress: task.progress,
      elapsedSeconds,
      description: task.description,
      provider: task.provider
    }
  });
});

/**
 * AI生成Three.js几何体代码
 */
async function generateThreeJSCode(description, provider) {
  const systemPrompt = `你是Three.js 3D编程专家。根据用户描述，生成完整的Three.js几何体创建代码。

**输出JSON格式（不要markdown标记）：**
{
  "name": "模型名称",
  "geometryType": "几何体类型",
  "description": "简短描述",
  "code": "完整的JavaScript代码"
}

**代码要求：**
1. 必须是完整的JavaScript函数
2. 函数名为 createGeometry，接收 properties 参数
3. 返回 THREE.Group 或 THREE.Mesh 对象
4. 使用 Three.js 几何体API（BoxGeometry, SphereGeometry, CylinderGeometry等）
5. 包含材质、颜色、位置设置
6. 可以组合多个几何体
7. 代码要清晰、有注释

**示例1：**
输入："一个红色的立方体"
输出：
{
  "name": "红色立方体",
  "geometryType": "box",
  "description": "简单的红色立方体",
  "code": "function createGeometry(properties = {}) {\\n  const size = properties.size || 2;\\n  const geometry = new THREE.BoxGeometry(size, size, size);\\n  const material = new THREE.MeshLambertMaterial({ color: 0xff0000 });\\n  const mesh = new THREE.Mesh(geometry, material);\\n  mesh.castShadow = true;\\n  mesh.receiveShadow = true;\\n  return mesh;\\n}"
}

**示例2：**
输入："一只可爱的小鸡"
输出：
{
  "name": "小鸡",
  "geometryType": "chick",
  "description": "可爱的几何体小鸡",
  "code": "function createGeometry(properties = {}) {\\n  const scale = properties.scale || 1;\\n  const group = new THREE.Group();\\n  \\n  // 身体（椭圆体）\\n  const bodyGeom = new THREE.SphereGeometry(0.8 * scale, 16, 16);\\n  bodyGeom.scale(1, 1.2, 0.9);\\n  const body = new THREE.Mesh(\\n    bodyGeom,\\n    new THREE.MeshLambertMaterial({ color: 0xffff00 })\\n  );\\n  body.position.y = 0.8 * scale;\\n  body.castShadow = true;\\n  group.add(body);\\n  \\n  // 头部\\n  const head = new THREE.Mesh(\\n    new THREE.SphereGeometry(0.5 * scale, 16, 16),\\n    new THREE.MeshLambertMaterial({ color: 0xffff00 })\\n  );\\n  head.position.y = 1.8 * scale;\\n  head.castShadow = true;\\n  group.add(head);\\n  \\n  // 喙\\n  const beak = new THREE.Mesh(\\n    new THREE.ConeGeometry(0.1 * scale, 0.3 * scale, 8),\\n    new THREE.MeshLambertMaterial({ color: 0xff8800 })\\n  );\\n  beak.position.set(0, 1.8 * scale, 0.5 * scale);\\n  beak.rotation.x = Math.PI / 2;\\n  group.add(beak);\\n  \\n  // 眼睛\\n  const eyeGeom = new THREE.SphereGeometry(0.08 * scale, 8, 8);\\n  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x000000 });\\n  const leftEye = new THREE.Mesh(eyeGeom, eyeMat);\\n  leftEye.position.set(-0.2 * scale, 1.9 * scale, 0.4 * scale);\\n  const rightEye = new THREE.Mesh(eyeGeom, eyeMat);\\n  rightEye.position.set(0.2 * scale, 1.9 * scale, 0.4 * scale);\\n  group.add(leftEye, rightEye);\\n  \\n  // 腿\\n  const legGeom = new THREE.CylinderGeometry(0.08 * scale, 0.08 * scale, 0.5 * scale, 8);\\n  const legMat = new THREE.MeshLambertMaterial({ color: 0xff8800 });\\n  const leftLeg = new THREE.Mesh(legGeom, legMat);\\n  leftLeg.position.set(-0.3 * scale, 0.25 * scale, 0);\\n  const rightLeg = new THREE.Mesh(legGeom, legMat);\\n  rightLeg.position.set(0.3 * scale, 0.25 * scale, 0);\\n  group.add(leftLeg, rightLeg);\\n  \\n  return group;\\n}"
}

现在请根据用户描述生成Three.js代码。`;

  const userPrompt = `生成模型：${description}`;

  try {
    let response;
    
    // 优先从数据库获取AI提供商配置
    console.log(`🔍 尝试从数据库获取${provider}配置...`);
    const dbConfig = await getAIProviderConfig(provider);
    
    if (dbConfig && dbConfig.enabled) {
      console.log(`✅ 使用数据库配置的${provider}`);
      if (provider === 'doubao') {
        response = await callDoubaoAnalysisWithConfig(userPrompt, systemPrompt, dbConfig);
        console.log('📥 豆包AI原始返回内容（前500字符）:', response.substring(0, 500));
      } else if (provider === 'qwen') {
        response = await callQwenAnalysisWithConfig(userPrompt, systemPrompt, dbConfig);
        console.log('📥 千问AI原始返回内容（前500字符）:', response.substring(0, 500));
      } else if (provider === 'hunyuan') {
        response = await callHunyuanAnalysisWithConfig(userPrompt, systemPrompt, dbConfig);
        console.log('📥 混元AI原始返回内容（前500字符）:', response.substring(0, 500));
      } else if (provider === 'chatgpt' || provider === 'openai') {
        response = await callChatGPTAnalysisWithConfig(userPrompt, systemPrompt, dbConfig);
        console.log('📥 ChatGPT AI原始返回内容（前500字符）:', response.substring(0, 500));
      }
    } else if (provider === 'doubao' && AI_PROVIDERS.doubao.enabled) {
      console.log(`⚠️ 使用环境变量配置的${provider}`);
      response = await callDoubaoAnalysis(userPrompt, systemPrompt);
      console.log('📥 豆包AI原始返回内容（前500字符）:', response.substring(0, 500));
    } else if (provider === 'qwen' && AI_PROVIDERS.qwen.enabled) {
      console.log(`⚠️ 使用环境变量配置的${provider}`);
      response = await callQwenAnalysis(userPrompt, systemPrompt);
      console.log('📥 千问AI原始返回内容（前500字符）:', response.substring(0, 500));
    } else {
      // 降级到模板代码
      console.log(`⚠️ ${provider} 未配置或未启用，使用模板代码`);
      return generateTemplateCode(description);
    }

    console.log('🔍 开始解析AI返回的JSON...');
    
    // 解析JSON
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      console.log('✅ 找到JSON格式数据');
      const result = JSON.parse(jsonMatch[0]);
      console.log('📋 解析结果:', {
        name: result.name,
        geometryType: result.geometryType,
        description: result.description,
        codeLength: result.code ? result.code.length : 0,
        hasCreateGeometry: result.code ? result.code.includes('createGeometry') : false
      });
      
      // 验证代码格式
      if (!result.code || !result.code.includes('createGeometry')) {
        console.error('❌ AI返回的代码格式无效:', result.code ? '代码存在但缺少createGeometry' : '代码不存在');
        throw new Error('AI返回的代码格式无效');
      }
      
      console.log('✅ 代码验证通过');
      return result;
    }

    console.error('❌ 未找到有效的JSON格式');
    throw new Error('AI返回格式无效');

  } catch (error) {
    console.warn('⚠️ AI代码生成失败，使用模板代码:', error.message);
    return generateTemplateCode(description);
  }
}

/**
 * 模板代码生成（降级方案）
 */
function generateTemplateCode(description) {
  const lower = description.toLowerCase();
  
  // 小鸡/鸡
  if (lower.includes('鸡') || lower.includes('chick') || lower.includes('chicken')) {
    return {
      name: '小鸡',
      geometryType: 'chick',
      description: description,
      code: `function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 身体（椭圆体）
  const bodyGeom = new THREE.SphereGeometry(0.8 * scale, 16, 16);
  bodyGeom.scale(1, 1.2, 0.9);
  const body = new THREE.Mesh(
    bodyGeom,
    new THREE.MeshLambertMaterial({ color: 0xffff00 })
  );
  body.position.y = 0.8 * scale;
  body.castShadow = true;
  group.add(body);
  
  // 头部
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.5 * scale, 16, 16),
    new THREE.MeshLambertMaterial({ color: 0xffff00 })
  );
  head.position.y = 1.8 * scale;
  head.castShadow = true;
  group.add(head);
  
  // 喙
  const beak = new THREE.Mesh(
    new THREE.ConeGeometry(0.1 * scale, 0.3 * scale, 8),
    new THREE.MeshLambertMaterial({ color: 0xff8800 })
  );
  beak.position.set(0, 1.8 * scale, 0.5 * scale);
  beak.rotation.x = Math.PI / 2;
  group.add(beak);
  
  // 眼睛
  const eyeGeom = new THREE.SphereGeometry(0.08 * scale, 8, 8);
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x000000 });
  const leftEye = new THREE.Mesh(eyeGeom, eyeMat);
  leftEye.position.set(-0.2 * scale, 1.9 * scale, 0.4 * scale);
  const rightEye = new THREE.Mesh(eyeGeom, eyeMat);
  rightEye.position.set(0.2 * scale, 1.9 * scale, 0.4 * scale);
  group.add(leftEye, rightEye);
  
  // 腿
  const legGeom = new THREE.CylinderGeometry(0.08 * scale, 0.08 * scale, 0.5 * scale, 8);
  const legMat = new THREE.MeshLambertMaterial({ color: 0xff8800 });
  const leftLeg = new THREE.Mesh(legGeom, legMat);
  leftLeg.position.set(-0.3 * scale, 0.25 * scale, 0);
  const rightLeg = new THREE.Mesh(legGeom, legMat);
  rightLeg.position.set(0.3 * scale, 0.25 * scale, 0);
  group.add(leftLeg, rightLeg);
  
  return group;
}`
    };
  }
  
  // 树
  if (lower.includes('树') || lower.includes('tree')) {
    return {
      name: '树',
      geometryType: 'tree',
      description: description,
      code: `function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 树干
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3 * scale, 0.4 * scale, 3 * scale, 8),
    new THREE.MeshLambertMaterial({ color: 0x8b4513 })
  );
  trunk.position.y = 1.5 * scale;
  trunk.castShadow = true;
  group.add(trunk);
  
  // 树冠（三层球体）
  const foliageMat = new THREE.MeshLambertMaterial({ color: 0x228b22 });
  
  const foliage1 = new THREE.Mesh(
    new THREE.SphereGeometry(1.5 * scale, 12, 12),
    foliageMat
  );
  foliage1.position.y = 3.5 * scale;
  foliage1.castShadow = true;
  group.add(foliage1);
  
  const foliage2 = new THREE.Mesh(
    new THREE.SphereGeometry(1.2 * scale, 12, 12),
    foliageMat
  );
  foliage2.position.y = 4.5 * scale;
  foliage2.castShadow = true;
  group.add(foliage2);
  
  const foliage3 = new THREE.Mesh(
    new THREE.SphereGeometry(0.8 * scale, 12, 12),
    foliageMat
  );
  foliage3.position.y = 5.3 * scale;
  foliage3.castShadow = true;
  group.add(foliage3);
  
  return group;
}`
    };
  }
  
  // 房子/建筑
  if (lower.includes('房') || lower.includes('屋') || lower.includes('house') || lower.includes('building')) {
    return {
      name: '房子',
      geometryType: 'house',
      description: description,
      code: `function createGeometry(properties = {}) {
  const scale = properties.scale || 1;
  const group = new THREE.Group();
  
  // 墙体
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(3 * scale, 2 * scale, 3 * scale),
    new THREE.MeshLambertMaterial({ color: 0xd4a574 })
  );
  wall.position.y = 1 * scale;
  wall.castShadow = true;
  wall.receiveShadow = true;
  group.add(wall);
  
  // 屋顶
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(2.5 * scale, 1.5 * scale, 4),
    new THREE.MeshLambertMaterial({ color: 0xdaa520 })
  );
  roof.position.y = 2.75 * scale;
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  group.add(roof);
  
  // 门
  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.8 * scale, 1.2 * scale, 0.1 * scale),
    new THREE.MeshLambertMaterial({ color: 0x654321 })
  );
  door.position.set(0, 0.6 * scale, 1.51 * scale);
  group.add(door);
  
  // 窗户
  const windowGeom = new THREE.BoxGeometry(0.6 * scale, 0.6 * scale, 0.1 * scale);
  const windowMat = new THREE.MeshLambertMaterial({ color: 0x87ceeb });
  
  const leftWindow = new THREE.Mesh(windowGeom, windowMat);
  leftWindow.position.set(-0.9 * scale, 1.2 * scale, 1.51 * scale);
  group.add(leftWindow);
  
  const rightWindow = new THREE.Mesh(windowGeom, windowMat);
  rightWindow.position.set(0.9 * scale, 1.2 * scale, 1.51 * scale);
  group.add(rightWindow);
  
  return group;
}`
    };
  }
  
  // 球体
  if (lower.includes('球') || lower.includes('sphere')) {
    return {
      name: '球体',
      geometryType: 'sphere',
      description: description,
      code: `function createGeometry(properties = {}) {
  const radius = properties.radius || 1;
  const color = properties.color || 0x4488ff;
  
  const geometry = new THREE.SphereGeometry(radius, 32, 32);
  const material = new THREE.MeshLambertMaterial({ color: color });
  const mesh = new THREE.Mesh(geometry, material);
  
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  
  return mesh;
}`
    };
  }
  
  // 圆柱体
  if (lower.includes('圆柱') || lower.includes('cylinder')) {
    return {
      name: '圆柱体',
      geometryType: 'cylinder',
      description: description,
      code: `function createGeometry(properties = {}) {
  const radius = properties.radius || 0.5;
  const height = properties.height || 2;
  const color = properties.color || 0x8b4513;
  
  const geometry = new THREE.CylinderGeometry(radius, radius, height, 32);
  const material = new THREE.MeshLambertMaterial({ color: color });
  const mesh = new THREE.Mesh(geometry, material);
  
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  
  return mesh;
}`
    };
  }
  
  // 默认：立方体
  return {
    name: '立方体',
    geometryType: 'box',
    description: description,
    code: `function createGeometry(properties = {}) {
  const width = properties.width || 2;
  const height = properties.height || 2;
  const depth = properties.depth || 2;
  const color = properties.color || 0xcccccc;
  
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const material = new THREE.MeshLambertMaterial({ color: color });
  const mesh = new THREE.Mesh(geometry, material);
  
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  
  return mesh;
}`
  };
}

/**
 * 使用数据库配置调用混元AI
 */
async function callHunyuanAnalysisWithConfig(userPrompt, systemPrompt, config) {
  console.log('🌐 [callHunyuanAnalysisWithConfig] 准备调用混元API');
  
  const crypto = require('crypto');
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = Math.random().toString(36).substring(2, 15);
  
  // 腾讯云API签名算法
  const params = {
    Action: 'ChatCompletions',
    Version: '2023-09-01',
    Region: config.region || 'ap-beijing',
    Timestamp: timestamp,
    Nonce: nonce,
    SecretId: config.secretId
  };
  
  const signStr = Object.keys(params)
    .sort()
    .map(key => `${key}=${params[key]}`)
    .join('&');
  
  const signature = crypto
    .createHmac('sha256', config.secretKey)
    .update(`POSThunyuan.tencentcloudapi.com/?${signStr}`)
    .digest('base64');
  
  try {
    const response = await axios.post(
      config.endpoint || 'https://hunyuan.tencentcloudapi.com',
      {
        Model: config.model || 'hunyuan-pro',
        Messages: [
          { Role: 'system', Content: systemPrompt },
          { Role: 'user', Content: userPrompt }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': signature,
          'X-TC-Action': 'ChatCompletions',
          'X-TC-Version': '2023-09-01',
          'X-TC-Region': config.region || 'ap-beijing',
          'X-TC-Timestamp': timestamp,
          'X-TC-Token': config.token || ''
        },
        timeout: 300000
      }
    );
    
    console.log('✅ [callHunyuanAnalysisWithConfig] API调用成功');
    return response.data.Response.Choices[0].Message.Content;
  } catch (error) {
    console.error('❌ [callHunyuanAnalysisWithConfig] API调用失败:', error.message);
    throw error;
  }
}

/**
 * 使用数据库配置调用ChatGPT
 */
async function callChatGPTAnalysisWithConfig(userPrompt, systemPrompt, config) {
  console.log('🌐 [callChatGPTAnalysisWithConfig] 准备调用ChatGPT API');
  console.log(`  - endpoint: ${config.endpoint || 'https://api.openai.com/v1/chat/completions'}`);
  console.log(`  - model: ${config.model || 'gpt-4'}`);
  
  try {
    const response = await axios.post(
      config.endpoint || 'https://api.openai.com/v1/chat/completions',
      {
        model: config.model || 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 4000
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey}`
        },
        timeout: 300000
      }
    );
    
    console.log('✅ [callChatGPTAnalysisWithConfig] API调用成功');
    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('❌ [callChatGPTAnalysisWithConfig] API调用失败:');
    console.error(`  - 状态码: ${error.response?.status}`);
    console.error(`  - 错误消息: ${error.message}`);
    console.error('  - 响应数据:', error.response?.data);
    throw error;
  }
}

module.exports = router;
