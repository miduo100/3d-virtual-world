/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const { pool } = require('../database/db');
const axios = require('axios');

/**
 * 智能模型匹配服务
 * 根据场景描述，从已有模型库中智能选择合适的模型
 */
class ModelMatcherService {
  constructor() {
    this.aiProvider = null; // 将使用配置的AI提供商
  }

  /**
   * 从场景描述中提取关键词和需求
   */
  async analyzeSceneDescription(description) {
    // 这里可以接入AI提供商进行语义分析
    // 暂时使用简单的关键词提取
    const keywords = this.extractKeywords(description);
    
    return {
      keywords,
      style: this.detectStyle(description),
      buildingTypes: this.detectBuildingTypes(description),
      atmosphere: this.detectAtmosphere(description)
    };
  }

  /**
   * 简单关键词提取（可以用AI增强）
   */
  extractKeywords(text) {
    const commonWords = ['的', '是', '有', '在', '和', '与', '了', '着', '过', '也', '都', '个', '一', '这', '那'];
    const words = text
      .toLowerCase()
      .replace(/[，。！？；：""''（）【】]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 1 && !commonWords.includes(word));
    
    return [...new Set(words)];
  }

  /**
   * 检测风格
   */
  detectStyle(text) {
    const styles = {
      modern: ['现代', '摩登', '时尚', '简约', '科技'],
      classic: ['古典', '传统', '复古', '怀旧', '历史'],
      fantasy: ['魔幻', '奇幻', '神秘', '仙境', '梦幻'],
      industrial: ['工业', '厂房', '钢铁', '机械'],
      natural: ['自然', '生态', '绿色', '田园', '乡村']
    };

    for (const [style, keywords] of Object.entries(styles)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return style;
      }
    }
    return 'general';
  }

  /**
   * 检测建筑类型
   */
  detectBuildingTypes(text) {
    const types = {
      residential: ['住宅', '房子', '公寓', '别墅', '小区'],
      commercial: ['商业', '商店', '商场', '市场', '购物'],
      office: ['办公', '写字楼', '大厦', '总部'],
      cultural: ['博物馆', '图书馆', '剧院', '展览', '文化'],
      dining: ['餐厅', '咖啡', '酒吧', '食堂', '餐饮'],
      entertainment: ['娱乐', '游乐', '电影院', 'KTV'],
      industrial: ['工厂', '仓库', '厂房', '车间']
    };

    const detected = [];
    for (const [type, keywords] of Object.entries(types)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        detected.push(type);
      }
    }
    return detected;
  }

  /**
   * 检测氛围
   */
  detectAtmosphere(text) {
    if (text.match(/热闹|繁华|喧嚣/)) return 'busy';
    if (text.match(/安静|宁静|平静/)) return 'peaceful';
    if (text.match(/神秘|诡异|阴森/)) return 'mysterious';
    return 'normal';
  }

  /**
   * 搜索匹配的模型（增强版 - 支持标签搜索）
   */
  async searchModels(analysis, userId = null) {
    const { keywords, style, buildingTypes } = analysis;
    
    try {
      // 构建搜索条件
      const searchTerms = [
        ...keywords,
        style,
        ...buildingTypes
      ].filter(Boolean);

      console.log('🔍 搜索关键词:', searchTerms);

      // 使用统一视图搜索所有模型（支持标签）
      const unifiedQuery = `
        SELECT 
          source,
          model_id,
          name,
          description,
          model_path,
          tags,
          category,
          created_at,
          -- 计算相关度分数（标签匹配优先级最高）
          (
            -- 标签完全匹配：20分
            CASE WHEN tags && $1::text[] THEN 20 ELSE 0 END +
            -- 名称匹配：10分
            CASE WHEN LOWER(name) SIMILAR TO $2 THEN 10 ELSE 0 END +
            -- 描述匹配：5分
            CASE WHEN description IS NOT NULL AND LOWER(description) SIMILAR TO $2 THEN 5 ELSE 0 END +
            -- 分类匹配：3分
            CASE WHEN category = ANY($3::text[]) THEN 3 ELSE 0 END
          ) as relevance_score
        FROM v_all_models
        WHERE 
          -- 至少有一个条件匹配
          (
            tags && $1::text[] OR
            LOWER(name) SIMILAR TO $2 OR
            (description IS NOT NULL AND LOWER(description) SIMILAR TO $2)
          )
          ${userId ? 'AND user_id = $4' : ''}
        ORDER BY relevance_score DESC, created_at DESC
        LIMIT 50
      `;

      const searchPattern = `%(${searchTerms.join('|')})%`;
      const categoryTerms = this.extractCategories(searchTerms);

      const params = [
        searchTerms,  // $1: 标签数组
        searchPattern, // $2: 名称/描述模糊匹配
        categoryTerms  // $3: 分类数组
      ];

      if (userId) params.push(userId);

      const result = await pool.query(unifiedQuery, params);

      console.log(`✅ 找到 ${result.rows.length} 个匹配的模型`);

      // 转换结果格式
      return result.rows.map(row => ({
        id: row.model_id,
        source_type: row.source,
        name: row.name,
        description: row.description,
        model_path: row.model_path,
        tags: row.tags,
        category: row.category,
        created_at: row.created_at,
        relevance_score: row.relevance_score
      }));

    } catch (error) {
      console.error('❌ 搜索模型失败:', error);
      // 降级到旧版搜索
      return this.searchModelsLegacy(analysis, userId);
    }
  }

  /**
   * 从搜索词中提取分类
   */
  extractCategories(terms) {
    const categoryMap = {
      '建筑|房子|大楼': 'building',
      '树|植物|花': 'nature',
      '车|船|飞机': 'vehicle',
      '动物|猫|狗': 'animal',
      '装饰|雕像': 'decoration',
      '家具|桌|椅': 'furniture'
    };

    const categories = [];
    for (const [keywords, category] of Object.entries(categoryMap)) {
      const patterns = keywords.split('|');
      if (terms.some(term => patterns.some(p => term.includes(p)))) {
        categories.push(category);
      }
    }

    return categories.length > 0 ? categories : ['building', 'nature', 'decoration'];
  }

  /**
   * 旧版搜索（降级方案）
   */
  async searchModelsLegacy(analysis, userId = null) {
    const { keywords, style, buildingTypes } = analysis;
    
    try {
      const searchTerms = [
        ...keywords,
        style,
        ...buildingTypes
      ].filter(Boolean);

      // 搜索AI生成的建筑
      const buildingsQuery = `
        SELECT 
          id,
          name,
          description,
          model_path,
          thumbnail_path,
          ai_provider,
          'building' as source_type,
          created_at,
          ARRAY[]::text[] as tags,
          'building' as category,
          (
            CASE 
              WHEN LOWER(name) SIMILAR TO $1 THEN 10
              WHEN LOWER(description) SIMILAR TO $1 THEN 5
              ELSE 0
            END
          ) as relevance_score
        FROM buildings
        WHERE 
          status = 'completed'
          AND model_path IS NOT NULL
          ${userId ? 'AND user_id = $2' : ''}
        ORDER BY relevance_score DESC, created_at DESC
        LIMIT 20
      `;

      const searchPattern = `%(${searchTerms.join('|')})%`;
      const buildingsResult = userId 
        ? await pool.query(buildingsQuery, [searchPattern, userId])
        : await pool.query(buildingsQuery, [searchPattern]);

      // 搜索上传的模型
      const uploadedQuery = `
        SELECT 
          id,
          original_name as name,
          file_name,
          path as model_path,
          file_type,
          'uploaded' as source_type,
          created_at,
          ARRAY[]::text[] as tags,
          'uploaded' as category,
          (
            CASE 
              WHEN LOWER(original_name) SIMILAR TO $1 THEN 10
              ELSE 0
            END
          ) as relevance_score
        FROM uploaded_models
        WHERE path IS NOT NULL
        ORDER BY relevance_score DESC, created_at DESC
        LIMIT 20
      `;

      const uploadedResult = await pool.query(uploadedQuery, [searchPattern]);

      // 搜索几何体
      const geometryQuery = `
        SELECT 
          id,
          name,
          NULL as description,
          NULL as model_path,
          template_id,
          'geometry' as source_type,
          created_at,
          ARRAY[]::text[] as tags,
          category,
          (
            CASE 
              WHEN LOWER(name) SIMILAR TO $1 THEN 10
              WHEN LOWER(template_id) SIMILAR TO $1 THEN 8
              ELSE 0
            END
          ) as relevance_score
        FROM geometry_buildings
        ORDER BY relevance_score DESC, created_at DESC
        LIMIT 20
      `;

      const geometryResult = await pool.query(geometryQuery, [searchPattern]);

      // 合并结果并按相关度排序
      const allModels = [
        ...buildingsResult.rows,
        ...uploadedResult.rows,
        ...geometryResult.rows
      ].sort((a, b) => b.relevance_score - a.relevance_score);

      console.log(`✅ 找到 ${allModels.length} 个匹配的模型（降级模式）`);

      return allModels;

    } catch (error) {
      console.error('❌ 降级搜索也失败:', error);
      throw error;
    }
  }

  /**
   * 使用AI进行语义匹配（更精确）
   */
  async semanticMatch(description, models) {
    // TODO: 接入AI的embedding功能
    // 1. 将场景描述转为向量
    // 2. 将每个模型的描述转为向量
    // 3. 计算余弦相似度
    // 4. 返回最相似的top N

    // 暂时返回原始列表
    return models;
  }

  /**
   * 主函数：根据场景描述匹配模型
   */
  async matchModelsForScene(description, userId = null, maxResults = 10) {
    try {
      console.log('🎨 开始智能模型匹配...');
      console.log('  场景描述:', description);

      // 1. 分析场景描述
      const analysis = await this.analyzeSceneDescription(description);
      console.log('  分析结果:', analysis);

      // 2. 搜索匹配的模型
      let models = await this.searchModels(analysis, userId);

      // 3. 使用AI进行语义匹配（可选，更精确）
      // models = await this.semanticMatch(description, models);

      // 4. 返回top N结果
      const results = models.slice(0, maxResults);

      console.log(`✅ 返回 ${results.length} 个最匹配的模型`);

      return {
        success: true,
        models: results,
        analysis,
        total: models.length
      };

    } catch (error) {
      console.error('❌ 模型匹配失败:', error);
      return {
        success: false,
        error: error.message,
        models: []
      };
    }
  }

  /**
   * 为匹配的模型生成布局
   */
  generateLayoutForModels(models, sceneType = 'city') {
    const layout = [];
    const spacing = 15; // 模型间距

    models.forEach((model, index) => {
      // 网格布局
      const row = Math.floor(index / 5);
      const col = index % 5;

      layout.push({
        modelId: model.id,
        sourceType: model.source_type,
        name: model.name,
        modelPath: model.model_path,
        position: {
          x: col * spacing - 30,
          y: 0,
          z: row * spacing - 30
        },
        rotation: {
          x: 0,
          y: Math.random() * Math.PI * 2, // 随机旋转
          z: 0
        },
        scale: {
          x: 1,
          y: 1,
          z: 1
        }
      });
    });

    return layout;
  }
}

module.exports = new ModelMatcherService();
