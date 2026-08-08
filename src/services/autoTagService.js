/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const { pool } = require('../database/db');
const axios = require('axios');

/**
 * AI自动标签生成服务
 * 为模型自动生成合适的标签
 */
class AutoTagService {
  constructor() {
    // 预定义标签库（从数据库加载）
    this.tagLibrary = null;
    this.loadTagLibrary();
  }

  /**
   * 从数据库加载标签库
   */
  async loadTagLibrary() {
    try {
      const result = await pool.query(`
        SELECT name, category, description 
        FROM model_tags 
        ORDER BY category, usage_count DESC
      `);
      
      this.tagLibrary = result.rows.reduce((acc, tag) => {
        if (!acc[tag.category]) {
          acc[tag.category] = [];
        }
        acc[tag.category].push(tag.name);
        return acc;
      }, {});
      
      console.log('✅ 标签库加载完成:', Object.keys(this.tagLibrary).length, '个分类');
    } catch (error) {
      console.error('❌ 加载标签库失败:', error);
    }
  }

  /**
   * 基于规则的自动标签生成（几何体）
   */
  generateGeometryTags(templateId, geometryData = {}) {
    const tags = [];
    const name = geometryData.name || templateId;
    
    // 建筑类
    const buildingTypes = {
      cottage: ['建筑物', '住宅', '小型', '乡村', '古典', '木质'],
      house: ['建筑物', '住宅', '中型', '现代'],
      skyscraper: ['建筑物', '商业', '巨型', '城市', '现代', '高精度'],
      castle: ['建筑物', '军事', '大型', '古典', '欧式', '石质'],
      tower: ['建筑物', '军事', '大型', '古典'],
      barn: ['建筑物', '农业', '中型', '乡村', '木质'],
      shed: ['建筑物', '储存', '小型', '乡村'],
      temple: ['建筑物', '宗教', '大型', '古典', '中式'],
      pyramid: ['建筑物', '宗教', '巨型', '古典', '沙漠']
    };

    // 自然景观
    const natureTypes = {
      mountain: ['自然景观', '巨型', '森林', '雪地', '石质'],
      hill: ['自然景观', '中型', '草地'],
      tree: ['植物', '自然景观', '森林', '中型', '绿色'],
      rock: ['自然景观', '小型', '石质'],
      bush: ['植物', '自然景观', '小型', '装饰物'],
      flower: ['植物', '自然景观', '微型', '装饰物', '彩色'],
      grass: ['植物', '自然景观', '微型', '草地'],
      crystal: ['装饰物', '中型', '发光', '透明', '魔幻']
    };

    // 动物
    const animalTypes = {
      hen: ['动物', '农场', '小型', '乡村'],
      chick: ['动物', '农场', '微型', '乡村', '卡通'],
      cat: ['动物', '宠物', '小型', '可交互'],
      dog: ['动物', '宠物', '小型', '可交互'],
      bird: ['动物', '飞行', '微型', '动态'],
      butterfly: ['动物', '昆虫', '微型', '动态', '彩色'],
      fish: ['动物', '水生', '小型', '海洋', '动态']
    };

    // 交通工具
    const vehicleTypes = {
      car: ['交通工具', '地面', '小型', '城市', '现代'],
      boat: ['交通工具', '水上', '中型', '海洋'],
      spaceship: ['交通工具', '飞行', '大型', '太空', '科幻', '发光'],
      bike: ['交通工具', '地面', '小型', '现代']
    };

    // 装饰物
    const decorationTypes = {
      fence: ['装饰物', '小型', '木质', '乡村'],
      lamp: ['装饰物', '小型', '发光', '城市', '现代'],
      bench: ['家具', '装饰物', '小型', '城市'],
      fountain: ['装饰物', '中型', '水景', '城市', '欧式'],
      statue: ['装饰物', '中型', '石质', '古典'],
      sign: ['装饰物', '微型', '可交互'],
      portal: ['装饰物', '大型', '可交互', '魔幻', '发光']
    };

    // 道具
    const propTypes = {
      chest: ['道具', '小型', '可交互', '木质'],
      barrel: ['道具', '小型', '木质'],
      crate: ['道具', '小型', '木质']
    };

    // 合并所有类型
    const allTypes = {
      ...buildingTypes,
      ...natureTypes,
      ...animalTypes,
      ...vehicleTypes,
      ...decorationTypes,
      ...propTypes
    };

    // 根据template_id分配标签
    if (allTypes[templateId]) {
      tags.push(...allTypes[templateId]);
    } else {
      // 默认标签
      tags.push('装饰物', '中型');
    }

    // 去重
    return [...new Set(tags)];
  }

  /**
   * 基于AI的智能标签生成（OBJ、图片转模型等）
   */
  async generateAITags(modelName, description = '', filePath = '', aiProvider = 'doubao') {
    try {
      // 准备提示词
      const prompt = `你是一个3D模型标签生成专家。请根据以下信息为模型生成合适的标签：

模型名称：${modelName}
模型描述：${description || '无'}
文件路径：${filePath || '无'}

可用标签库（按分类）：
${JSON.stringify(this.tagLibrary, null, 2)}

请从标签库中选择5-10个最合适的标签，直接输出JSON数组，格式：
["标签1", "标签2", "标签3", ...]

只输出JSON数组，不要其他文字。`;

      // 调用AI生成标签
      let tags = [];
      
      if (aiProvider === 'doubao' && process.env.DOUBAO_API_KEY) {
        tags = await this.callDoubaoForTags(prompt);
      } else if (aiProvider === 'qwen' && process.env.QWEN_API_KEY) {
        tags = await this.callQwenForTags(prompt);
      } else {
        // 降级到基于关键词的标签生成
        tags = this.generateKeywordBasedTags(modelName, description);
      }

      // 验证标签是否在标签库中
      const validTags = tags.filter(tag => 
        Object.values(this.tagLibrary).flat().includes(tag)
      );

      return validTags;

    } catch (error) {
      console.error('❌ AI标签生成失败，使用关键词方法:', error.message);
      return this.generateKeywordBasedTags(modelName, description);
    }
  }

  /**
   * 调用豆包生成标签
   */
  async callDoubaoForTags(prompt) {
    try {
      const response = await axios.post(
        'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
        {
          model: process.env.DOUBAO_ENDPOINT_ID || 'doubao-pro-32k',
          messages: [
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 500
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.DOUBAO_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0].message.content;
      return this.parseTagsFromAI(content);

    } catch (error) {
      console.error('豆包标签生成失败:', error.message);
      throw error;
    }
  }

  /**
   * 调用通义千问生成标签
   */
  async callQwenForTags(prompt) {
    try {
      const response = await axios.post(
        'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
        {
          model: 'qwen-max',
          input: {
            messages: [
              { role: 'user', content: prompt }
            ]
          },
          parameters: {
            result_format: 'message',
            temperature: 0.3,
            max_tokens: 500
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
      return this.parseTagsFromAI(content);

    } catch (error) {
      console.error('通义千问标签生成失败:', error.message);
      throw error;
    }
  }

  /**
   * 解析AI返回的标签
   */
  parseTagsFromAI(content) {
    try {
      // 移除markdown标记
      const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      // 尝试解析JSON
      const tags = JSON.parse(cleaned);
      
      if (Array.isArray(tags)) {
        return tags;
      }
      
      throw new Error('AI返回的不是数组');
      
    } catch (error) {
      console.error('解析AI标签失败:', error.message);
      // 尝试从文本中提取标签
      const matches = content.match(/["']([^"']+)["']/g);
      if (matches) {
        return matches.map(m => m.replace(/["']/g, ''));
      }
      return [];
    }
  }

  /**
   * 基于关键词的标签生成（降级方案）
   */
  generateKeywordBasedTags(name, description = '') {
    const text = `${name} ${description}`.toLowerCase();
    const tags = [];

    // 关键词映射
    const keywordMap = {
      '建筑|房子|大楼|楼房': ['建筑物'],
      '树|森林|植物|花|草': ['植物', '自然景观'],
      '山|石头|岩石': ['自然景观', '石质'],
      '车|汽车|卡车': ['交通工具', '地面'],
      '船|游艇': ['交通工具', '水上'],
      '飞机|飞船': ['交通工具', '飞行'],
      '动物|猫|狗|鸟': ['动物'],
      '家具|桌子|椅子': ['家具'],
      '装饰|雕像|喷泉': ['装饰物'],
      '现代|科技': ['现代'],
      '古典|传统|古代': ['古典'],
      '科幻|未来|太空': ['科幻'],
      '魔幻|魔法|奇幻': ['魔幻'],
      '城市|都市': ['城市'],
      '乡村|农村|田园': ['乡村'],
      '小|小型': ['小型'],
      '中|中型': ['中型'],
      '大|大型': ['大型']
    };

    // 匹配关键词
    for (const [keywords, tagList] of Object.entries(keywordMap)) {
      const patterns = keywords.split('|');
      if (patterns.some(pattern => text.includes(pattern))) {
        tags.push(...tagList);
      }
    }

    // 如果没有匹配到任何标签，返回默认标签
    if (tags.length === 0) {
      tags.push('装饰物', '中型');
    }

    return [...new Set(tags)];
  }

  /**
   * 批量为模型添加标签
   */
  async batchTagModels(modelType, modelIds = []) {
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    try {
      if (modelType === 'geometry') {
        // 为几何体建筑添加标签
        for (const id of modelIds) {
          try {
            const model = await pool.query(
              'SELECT id, name, template_id, geometry_data FROM geometry_buildings WHERE id = $1',
              [id]
            );

            if (model.rows.length === 0) continue;

            const data = model.rows[0];
            const tags = this.generateGeometryTags(data.template_id, data.geometry_data);

            await pool.query(
              `UPDATE geometry_buildings 
               SET tags = $1, 
                   auto_tags = $2,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $3`,
              [
                tags,
                JSON.stringify({
                  generated_by: 'auto_tag_service',
                  method: 'rule_based',
                  confidence: 0.9,
                  generated_at: new Date().toISOString()
                }),
                id
              ]
            );

            results.success++;
          } catch (error) {
            results.failed++;
            results.errors.push({ id, error: error.message });
          }
        }
      } else if (modelType === 'uploaded') {
        // 为上传的模型添加标签
        for (const id of modelIds) {
          try {
            const model = await pool.query(
              'SELECT id, file_name, original_name, description FROM uploaded_models WHERE id = $1',
              [id]
            );

            if (model.rows.length === 0) continue;

            const data = model.rows[0];
            const tags = await this.generateAITags(
              data.original_name || data.file_name,
              data.description || ''
            );

            await pool.query(
              `UPDATE uploaded_models 
               SET tags = $1,
                   auto_tags = $2,
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $3`,
              [
                tags,
                JSON.stringify({
                  generated_by: 'auto_tag_service',
                  method: 'ai_assisted',
                  confidence: 0.8,
                  generated_at: new Date().toISOString()
                }),
                id
              ]
            );

            results.success++;
          } catch (error) {
            results.failed++;
            results.errors.push({ id, error: error.message });
          }
        }
      } else if (modelType === 'building') {
        // 为AI生成建筑添加标签
        for (const id of modelIds) {
          try {
            const model = await pool.query(
              'SELECT id, name, description, building_type FROM generated_buildings WHERE id = $1',
              [id]
            );

            if (model.rows.length === 0) continue;

            const data = model.rows[0];
            const tags = await this.generateAITags(
              data.name,
              data.description || '',
              '',
              'doubao'
            );

            await pool.query(
              `UPDATE generated_buildings 
               SET tags = $1,
                   auto_tags = $2
               WHERE id = $3`,
              [
                tags,
                JSON.stringify({
                  generated_by: 'auto_tag_service',
                  method: 'ai_assisted',
                  confidence: 0.85,
                  generated_at: new Date().toISOString()
                }),
                id
              ]
            );

            results.success++;
          } catch (error) {
            results.failed++;
            results.errors.push({ id, error: error.message });
          }
        }
      }

    } catch (error) {
      console.error('❌ 批量标签生成失败:', error);
    }

    return results;
  }

  /**
   * 自动为所有未打标签的模型添加标签
   */
  async autoTagAllModels() {
    console.log('🏷️ 开始自动标签所有模型...');

    // 1. 几何体建筑
    const geometryResult = await pool.query(
      'SELECT id FROM geometry_buildings WHERE tags = \'{}\' OR tags IS NULL'
    );
    console.log(`  发现 ${geometryResult.rows.length} 个未标签的几何体`);
    
    const geometryIds = geometryResult.rows.map(r => r.id);
    const geometryResults = await this.batchTagModels('geometry', geometryIds);
    console.log(`  ✅ 几何体标签完成: 成功 ${geometryResults.success}, 失败 ${geometryResults.failed}`);

    // 2. 上传的模型
    const uploadedResult = await pool.query(
      'SELECT id FROM uploaded_models WHERE tags = \'{}\' OR tags IS NULL LIMIT 50'
    );
    console.log(`  发现 ${uploadedResult.rows.length} 个未标签的上传模型`);
    
    const uploadedIds = uploadedResult.rows.map(r => r.id);
    const uploadedResults = await this.batchTagModels('uploaded', uploadedIds);
    console.log(`  ✅ 上传模型标签完成: 成功 ${uploadedResults.success}, 失败 ${uploadedResults.failed}`);

    // 3. AI生成建筑
    const buildingResult = await pool.query(
      'SELECT id FROM generated_buildings WHERE (tags = \'{}\' OR tags IS NULL) AND status = \'completed\' LIMIT 50'
    );
    console.log(`  发现 ${buildingResult.rows.length} 个未标签的AI建筑`);
    
    const buildingIds = buildingResult.rows.map(r => r.id);
    const buildingResults = await this.batchTagModels('building', buildingIds);
    console.log(`  ✅ AI建筑标签完成: 成功 ${buildingResults.success}, 失败 ${buildingResults.failed}`);

    return {
      geometry: geometryResults,
      uploaded: uploadedResults,
      building: buildingResults
    };
  }
}

module.exports = new AutoTagService();
