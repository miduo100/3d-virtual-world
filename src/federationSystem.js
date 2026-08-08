/**
 * 虚拟世界联邦系统
 * 实现多个独立部署的虚拟世界之间的互联互通
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { query } = require('./database/db');

// 骨骼识别和规范化模块
class BoneNormalization {
  // 规范化骨骼名称（支持多种命名约定）
  static normalizeBoneName(boneName) {
    const normalizationRules = [
      { regex: /mixamorig(\w+)/i, replacement: '$1' },
      { regex: /^bone_?/i, replacement: '' },
      { regex: /_L$|_R$|_Left$|_Right$|_Side$|_Side$/i, 
        replacement: match => match.toLowerCase() },
      { regex: /\d+$/i, replacement: '' } // 移除尾部数字
    ];
    
    let normalized = boneName.trim();
    normalizationRules.forEach(rule => {
      normalized = normalized.replace(rule.regex, rule.replacement);
    });
    
    return normalized.toLowerCase();
  }

  // 识别骨骼所属的身体部位
  static identifyBodyPart(boneName, bodyPartMap = {}) {
    const defaultBodyPartMap = {
      head: ['head', 'face', 'neck', 'hair'],
      upperBody: ['spine', 'chest', 'clavicle', 'shoulder', 'arm'],
      lowerBody: ['hip', 'leg', 'thigh', 'knee', 'calf', 'ankle', 'foot'],
      hands: ['hand', 'palm', 'finger', 'thumb']
    };
    
    const map = Object.assign(defaultBodyPartMap, bodyPartMap);
    const lowerName = boneName.toLowerCase();
    
    for (const [part, keywords] of Object.entries(map)) {
      if (keywords.some(keyword => lowerName.includes(keyword.toLowerCase()))) {
        return part;
      }
    }
    
    return 'unknown';
  }

  // 标准化骨骼层次结构
  static normalizeBoneHierarchy(bones) {
    return bones.map(bone => ({
      ...bone,
      normalizedName: this.normalizeBoneName(bone.name),
      bodyPart: this.identifyBodyPart(bone.name)
    }));
  }

  // 骨骼映射匹配算法
  static generateBoneMapping(sourceBones, targetBones) {
    const sourceNormalized = this.normalizeBoneHierarchy(sourceBones);
    const targetNormalized = this.normalizeBoneHierarchy(targetBones);
    
    const mapping = {};
    
    // 精确匹配
    sourceNormalized.forEach(sourceBone => {
      const match = targetNormalized.find(targetBone => 
        targetBone.normalizedName === sourceBone.normalizedName
      );
      
      if (match) {
        mapping[sourceBone.originalName] = match.originalName;
      }
    });
    
    // 模糊匹配（基于身体部位）
    sourceNormalized.forEach(sourceBone => {
      if (!mapping[sourceBone.originalName]) {
        const samePartBones = targetNormalized.filter(targetBone => 
          targetBone.bodyPart === sourceBone.bodyPart && 
          !Object.values(mapping).includes(targetBone.originalName)
        );
        
        if (samePartBones.length > 0) {
          const bestMatch = this.findBestMatch(sourceBone, samePartBones);
          if (bestMatch) {
            mapping[sourceBone.originalName] = bestMatch.originalName;
          }
        }
      }
    });
    
    return mapping;
  }

  // 简单的最佳匹配算法（基于名称相似度）
  static findBestMatch(sourceBone, candidateBones) {
    let bestMatch = null;
    let highestScore = 0;
    
    candidateBones.forEach(candidate => {
      const score = this.calculateNameSimilarity(
        sourceBone.normalizedName, 
        candidate.normalizedName
      );
      
      if (score > highestScore) {
        highestScore = score;
        bestMatch = candidate;
      }
    });
    
    return bestMatch;
  }

  // 计算骨骼名称相似度（简单的字符匹配）
  static calculateNameSimilarity(name1, name2) {
    const n1 = name1.toLowerCase();
    const n2 = name2.toLowerCase();
    
    // 计算相同字符的数量
    let sameChars = 0;
    for (let i = 0; i < Math.min(n1.length, n2.length); i++) {
      if (n1[i] === n2[i]) {
        sameChars++;
      }
    }
    
    return sameChars / Math.max(n1.length, n2.length);
  }
}

// 动画适配模块
class AnimationAdaptation {
  // 动画数据重定向算法
  static redirectAnimation(animationData, boneMapping) {
    const redirected = {
      name: animationData.name,
      duration: animationData.duration,
      frames: []
    };
    
    animationData.frames.forEach(frame => {
      const newFrame = {};
      Object.entries(frame).forEach(([boneName, transform]) => {
        if (boneMapping[boneName]) {
          newFrame[boneMapping[boneName]] = transform;
        } else {
          console.warn(`骨骼 "${boneName}" 未找到映射，跳过动画数据`);
        }
      });
      redirected.frames.push(newFrame);
    });
    
    return redirected;
  }

  // 骨骼变换插值
  static interpolateAnimationTransforms(sourceTransform, targetTransform, progress) {
    return {
      position: {
        x: sourceTransform.position.x + (targetTransform.position.x - sourceTransform.position.x) * progress,
        y: sourceTransform.position.y + (targetTransform.position.y - sourceTransform.position.y) * progress,
        z: sourceTransform.position.z + (targetTransform.position.z - sourceTransform.position.z) * progress
      },
      rotation: {
        x: sourceTransform.rotation.x + (targetTransform.rotation.x - sourceTransform.rotation.x) * progress,
        y: sourceTransform.rotation.y + (targetTransform.rotation.y - sourceTransform.rotation.y) * progress,
        z: sourceTransform.rotation.z + (targetTransform.rotation.z - sourceTransform.rotation.z) * progress
      },
      scale: {
        x: sourceTransform.scale.x + (targetTransform.scale.x - sourceTransform.scale.x) * progress,
        y: sourceTransform.scale.y + (targetTransform.scale.y - sourceTransform.scale.y) * progress,
        z: sourceTransform.scale.z + (targetTransform.scale.z - sourceTransform.scale.z) * progress
      }
    };
  }

  // 动画约束适配算法
  static adaptAnimationConstraints(animationData, boneConstraints) {
    return animationData.frames.map(frame => {
      const constrainedFrame = { ...frame };
      Object.entries(boneConstraints).forEach(([boneName, constraints]) => {
        if (constrainedFrame[boneName]) {
          constrainedFrame[boneName] = this.applyConstraints(constrainedFrame[boneName], constraints);
        }
      });
      return constrainedFrame;
    });
  }

  // 应用骨骼约束
  static applyConstraints(transform, constraints) {
    const constrained = { ...transform };
    
    if (constraints.rotation) {
      constrained.rotation = this.constrainRotation(transform.rotation, constraints.rotation);
    }
    if (constraints.position) {
      constrained.position = this.constrainPosition(transform.position, constraints.position);
    }
    if (constraints.scale) {
      constrained.scale = this.constrainScale(transform.scale, constraints.scale);
    }
    
    return constrained;
  }

  // 旋转约束
  static constrainRotation(rotation, constraints) {
    return {
      x: this.clamp(rotation.x, constraints.min.x, constraints.max.x),
      y: this.clamp(rotation.y, constraints.min.y, constraints.max.y),
      z: this.clamp(rotation.z, constraints.min.z, constraints.max.z)
    };
  }

  // 位置约束
  static constrainPosition(position, constraints) {
    return {
      x: this.clamp(position.x, constraints.min.x, constraints.max.x),
      y: this.clamp(position.y, constraints.min.y, constraints.max.y),
      z: this.clamp(position.z, constraints.min.z, constraints.max.z)
    };
  }

  // 缩放约束
  static constrainScale(scale, constraints) {
    return {
      x: this.clamp(scale.x, constraints.min.x, constraints.max.x),
      y: this.clamp(scale.y, constraints.min.y, constraints.max.y),
      z: this.clamp(scale.z, constraints.min.z, constraints.max.z)
    };
  }

  // 数值约束
  static clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  // 动画播放验证
  static validateAnimationPlayback(model, animation, mapping) {
    const validationResult = {
      isValid: true,
      warnings: [],
      errors: []
    };
    
    // 检查骨骼映射完整性
    const requiredBones = this.getAnimationRequiredBones(animation);
    const missingBones = requiredBones.filter(bone => !mapping[bone]);
    
    if (missingBones.length > 0) {
      validationResult.isValid = false;
      validationResult.errors.push(`缺少骨骼映射: ${missingBones.join(', ')}`);
    }
    
    // 检查骨骼层次结构匹配
    const hierarchyIssues = this.checkBoneHierarchyMatch(model, animation);
    if (hierarchyIssues.length > 0) {
      validationResult.warnings.push(...hierarchyIssues);
    }
    
    // 检查动画范围
    if (!this.isAnimationDurationValid(animation)) {
      validationResult.warnings.push('动画时长异常');
    }
    
    return validationResult;
  }

  // 获取动画需要的骨骼
  static getAnimationRequiredBones(animation) {
    const bones = new Set();
    animation.frames.forEach(frame => {
      Object.keys(frame).forEach(boneName => {
        bones.add(boneName);
      });
    });
    return Array.from(bones);
  }

  // 检查骨骼层次结构匹配
  static checkBoneHierarchyMatch(model, animation) {
    const issues = [];
    // 简单的层次结构检查
    if (model.bones.length === 0) {
      issues.push('模型无骨骼数据');
    }
    
    return issues;
  }

  // 检查动画时长有效性
  static isAnimationDurationValid(animation) {
    return animation.duration > 0 && animation.duration < 3600; // 0到1小时之间
  }
}

class FederationSystem {
  constructor(config) {
    this.worldId = config.worldId; // 当前世界的唯一ID
    this.worldName = config.worldName; // 世界名称
    this.worldUrl = config.worldUrl; // 当前世界的公网URL
    this.privateKey = config.privateKey; // 当前世界的私钥
    this.publicKey = config.publicKey; // 当前世界的公钥
    
    // 已信任的其他世界（公钥注册表）
    this.trustedWorlds = new Map();
    
    // 世界状态缓存
    this.worldStatus = new Map();
    
    // 安全设置
    this.ipWhitelist = new Set(); // IP白名单
    this.rateLimits = new Map(); // 速率限制
    this.maxRequestsPerMinute = 60; // 每分钟最大请求数
    
    // 启动定期状态检查
    this.startStatusCheck();
    
    // 启动定期清理速率限制
    this.startRateLimitCleanup();
  }

  /**
   * 生成世界的密钥对
   */
  static generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem'
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem'
      }
    });
    
    return { publicKey, privateKey };
  }

  /**
   * 注册信任的其他世界
   */
  trustWorld(worldId, worldName, worldUrl, publicKey) {
    this.trustedWorlds.set(worldId, {
      worldId,
      worldName,
      worldUrl,
      publicKey,
      trustedAt: new Date()
    });
    
    console.log(`✅ 已信任世界: ${worldName} (${worldId})`);
  }

  /**
   * 获取所有已连接的世界列表
   */
  getConnectedWorlds() {
    return Array.from(this.trustedWorlds.values()).map(world => ({
      worldId: world.worldId,
      worldName: world.worldName,
      worldUrl: world.worldUrl
    }));
  }

  /**
   * 为用户生成跨世界传送Token
   * @param {object} user - 用户信息
   * @param {string} targetWorldId - 目标世界ID
   * @param {object} context - 传送上下文（位置、状态等）
   */
  async generateTeleportToken(user, targetWorldId, context = {}) {
    const targetWorld = this.trustedWorlds.get(targetWorldId);
    
    if (!targetWorld) {
      throw new Error(`未信任的目标世界: ${targetWorldId}`);
    }

    // 构建跨世界Token载荷
    const payload = {
      // 用户信息
      userId: user.id,
      username: user.username,
      characterName: user.characterName || user.username, // 角色昵称（用户可能修改过），优先使用
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      
      // 联邦信息
      sourceWorldId: this.worldId,
      sourceWorldName: this.worldName,
      sourceWorldUrl: this.worldUrl,
      targetWorldId: targetWorldId,
      
      // 传送上下文
      context: {
        position:        context.position        || { x: 0, y: 0, z: 0 },
        inventory:       context.inventory       || [],
        achievements:    context.achievements    || [],
        customData:      context.customData      || {},
        characterConfig: context.characterConfig || null,
        inventoryInfo:   context.inventoryInfo   || null
      },
      
      // 时间戳和过期时间
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300, // 5分钟有效期
      
      // 随机nonce防重放
      nonce: crypto.randomBytes(16).toString('hex')
    };

    // 使用当前世界的私钥签名
    const token = jwt.sign(payload, this.privateKey, { 
      algorithm: 'RS256',
      issuer: this.worldId,
      audience: targetWorldId
    });

    // 记录传送历史到数据库
    try {
      await query(
        `INSERT INTO teleport_history 
         (user_id, source_world_id, source_world_name, target_world_id, target_world_name, context, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [user.id, this.worldId, this.worldName, targetWorldId, targetWorld.worldName, JSON.stringify(payload.context)]
      );
    } catch (error) {
      console.error('记录传送历史失败:', error);
      // 数据库错误不影响Token生成
    }

    return token;
  }

  /**
   * 验证来自其他世界的传送Token
   * @param {string} token - 跨世界Token
   */
  async verifyTeleportToken(token) {
    try {
      // 首先解码不验证，获取源世界信息
      const decoded = jwt.decode(token, { complete: true });
      
      if (!decoded) {
        throw new Error('无效的Token格式');
      }

      const sourceWorldId = decoded.payload.iss;
      const sourceWorld = this.trustedWorlds.get(sourceWorldId);

      if (!sourceWorld) {
        throw new Error(`未信任的源世界: ${sourceWorldId}`);
      }

      // 使用源世界的公钥验证签名
      const verified = jwt.verify(token, sourceWorld.publicKey, {
        algorithms: ['RS256'],
        issuer: sourceWorldId,
        audience: this.worldId
      });

      // 检查是否已被使用（防重放）
      // 由于这是一个新的验证系统，暂时跳过防重放检查
      // 后续可以实现一个token_usage表来存储已使用的nonce

      return {
        success: true,
        user: {
          id: verified.userId,
          username: verified.username,
          email: verified.email,
          role: verified.role,
          avatar: verified.avatar,
          fromWorld: {
            id: verified.sourceWorldId,
            name: verified.sourceWorldName,
            url: verified.sourceWorldUrl
          }
        },
        context: verified.context
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }



  /**
   * 与其他世界建立信任关系
   * @param {string} targetWorldUrl - 目标世界的URL
   */
  async establishTrust(targetWorldUrl) {
    try {
      // 清理URL末尾斜杠，避免路由404
      targetWorldUrl = targetWorldUrl.replace(/\/+$/, '');
      // 向目标世界发送握手请求
      const response = await axios.post(`${targetWorldUrl}/api/federation/handshake`, {
        worldId: this.worldId,
        worldName: this.worldName,
        worldUrl: this.worldUrl,
        publicKey: this.publicKey
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        // 允许跨域请求
        withCredentials: true
      });

      if (response.data.success) {
        // 保存目标世界的公钥（无论对方是否开启审批，发起方都信任对方）
        this.trustWorld(
          response.data.worldId,
          response.data.worldName,
          response.data.worldUrl,
          response.data.publicKey
        );

        // 对方开启了审批，需要等待对方管理员同意
        if (response.data.requiresApproval) {
          return {
            success: true,
            requiresApproval: true,
            message: `信任请求已发送给 ${response.data.worldName}，等待对方管理员审批`
          };
        }

        return {
          success: true,
          message: `已与 ${response.data.worldName} 建立信任关系`
        };
      }

      return {
        success: false,
        error: response.data.error
      };

    } catch (error) {
      return {
        success: false,
        error: `连接失败: ${error.message}`
      };
    }
  }

  /**
   * 广播本世界URL变更到所有已连接的世界
   * 当管理员修改世界URL后调用，遍历所有trusted_worlds逐个握手通知对方更新
   */
  async broadcastWorldUrlChange() {
    const results = [];

    for (const [worldId, world] of this.trustedWorlds) {
      try {
        const targetUrl = world.worldUrl.replace(/\/+$/, '');
        console.log(`[URL广播] → ${world.worldName} (${targetUrl})`);

        const response = await axios.post(
          `${targetUrl}/api/federation/handshake`,
          {
            worldId: this.worldId,
            worldName: this.worldName,
            worldUrl: this.worldUrl,
            publicKey: this.publicKey
          },
          { headers: { 'Content-Type': 'application/json' }, timeout: 10000 }
        );

        results.push({
          worldId,
          worldName: world.worldName,
          success: response.data.success,
          message: response.data.success ? '已更新' : (response.data.error || '失败')
        });

        if (response.data.success) {
          console.log(`[URL广播] → ${world.worldName}: ✅ 已更新`);
        } else {
          console.warn(`[URL广播] → ${world.worldName}: ❌ ${response.data.error}`);
        }

      } catch (err) {
        results.push({ worldId, worldName: world.worldName, success: false, message: err.message });
        console.warn(`[URL广播] → ${world.worldName}: ❌ ${err.message}`);
      }
    }

    return results;
  }

  /**
   * 处理其他世界的握手请求
   */
  handleHandshake(requestData) {
    const { worldId, worldName, worldUrl, publicKey } = requestData;

    // 验证请求数据
    if (!worldId || !worldName || !worldUrl || !publicKey) {
      return {
        success: false,
        error: '握手数据不完整'
      };
    }

    // 添加到信任列表
    this.trustWorld(worldId, worldName, worldUrl, publicKey);

    // 返回当前世界的公钥
    return {
      success: true,
      worldId: this.worldId,
      worldName: this.worldName,
      worldUrl: this.worldUrl,
      publicKey: this.publicKey
    };
  }

  /**
   * 同步用户数据到其他世界
   * @param {string} userId - 用户ID
   * @param {string} targetWorldId - 目标世界ID
   */
  async syncUserData(userId, targetWorldId) {
    const targetWorld = this.trustedWorlds.get(targetWorldId);
    
    if (!targetWorld) {
      throw new Error('未信任的目标世界');
    }

    try {
      // 获取用户数据
      const userData = await this.getUserData(userId);
      
      const response = await axios.post(
        `${targetWorld.worldUrl}/api/federation/sync-user`,
        {
          userId,
          sourceWorldId: this.worldId,
          userData: userData
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data;

    } catch (error) {
      console.error('用户数据同步失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取用户数据
   * @param {string} userId - 用户ID
   */
  async getUserData(userId) {
    try {
      // 从数据库获取用户基本信息
      const userResult = await query(
        'SELECT id, username, email, role FROM users WHERE id = $1',
        [userId]
      );
      
      if (userResult.rows.length === 0) {
        throw new Error('用户不存在');
      }
      
      const user = userResult.rows[0];
      
      // 获取用户角色信息
      const characterResult = await query(
        'SELECT * FROM characters WHERE user_id = $1',
        [userId]
      );
      
      // 获取用户背包物品
      const inventoryResult = await query(
        'SELECT * FROM player_inventory WHERE user_id = $1 AND is_used = false',
        [userId]
      );
      
      // 构建用户数据
      const userData = {
        user: user,
        characters: characterResult.rows,
        inventory: inventoryResult.rows,
        lastSync: new Date().toISOString()
      };
      
      return userData;
      
    } catch (error) {
      console.error('获取用户数据失败:', error);
      throw error;
    }
  }

  /**
   * 导出世界配置（用于分享给其他人）
   */
  exportConfig() {
    return {
      worldId: this.worldId,
      worldName: this.worldName,
      worldUrl: this.worldUrl,
      publicKey: this.publicKey
    };
  }

  /**
   * 获取角色模板的完整资源URL引用
   * @param {string} templateId - 角色模板ID
   * @returns {Promise} 包含模板配置和资源引用的Promise
   */
  async getCharacterTemplateReferences(templateId) {
    try {
      // 从数据库获取角色模板信息
      const templateResult = await query(
        'SELECT * FROM character_templates WHERE id = $1',
        [templateId]
      );

      if (templateResult.rows.length === 0) {
        throw new Error(`角色模板 ${templateId} 不存在`);
      }

      const template = templateResult.rows[0];
      
      // 获取角色模板相关的资源引用
      const resourcesResult = await query(
        'SELECT * FROM resource_references WHERE template_id = $1',
        [templateId]
      );

      // 组织资源引用数据
      const resources = {
        model: null,
        animations: [],
        sounds: [],
        textures: []
      };

      resourcesResult.rows.forEach(resource => {
        const resourceInfo = {
          url: resource.resource_url,
          hash: resource.resource_hash,
          size: resource.file_size,
          format: resource.format,
          quality: resource.quality_level
        };

        switch (resource.resource_type) {
          case 'model':
            resources.model = resourceInfo;
            break;
          case 'animation':
            resources.animations.push(resourceInfo);
            break;
          case 'sound':
            resources.sounds.push(resourceInfo);
            break;
          case 'texture':
            resources.textures.push(resourceInfo);
            break;
        }
      });

      // 返回模板配置和资源引用
      return {
        success: true,
        templateData: {
          id: template.id,
          name: template.name,
          is_federated: template.is_federated,
          source_world_id: template.source_world_id,
          source_template_id: template.source_template_id,
          bone_map: template.bone_map,
          anim_adapt: template.anim_adapt
        },
        resources: resources,
        boneMapping: template.bone_map,
        animAdapt: template.anim_adapt
      };

    } catch (error) {
      console.error('获取角色模板资源引用失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 接收并存储角色模板资源引用
   * @param {Object} importData - 导入数据
   * @param {string} importData.sourceWorldId - 源世界ID
   * @param {string} importData.sourceTemplateId - 源世界模板ID
   * @param {Object} importData.templateData - 角色模板配置数据
   * @param {Object} importData.resources - 资源引用信息
   * @param {Object} importData.boneMapping - 骨骼绑定映射表
   * @param {Object} importData.animAdapt - 动画适配配置
   * @returns {Promise} 导入结果
   */
  async importCharacterTemplateReferences(importData) {
    try {
      const { 
        sourceWorldId, 
        sourceTemplateId, 
        templateData, 
        resources, 
        boneMapping, 
        animAdapt 
      } = importData;

      // 检查是否已存在相同的联邦模板
      const existingResult = await query(
        'SELECT * FROM federation_templates WHERE source_world_id = $1 AND source_template_id = $2',
        [sourceWorldId, sourceTemplateId]
      );

      let localTemplateId;

      if (existingResult.rows.length > 0) {
        // 已存在，使用现有模板ID
        localTemplateId = existingResult.rows[0].local_template_id;
      } else {
        // 创建新的本地角色模板（作为联邦引用的模板）
        const insertResult = await query(
          `INSERT INTO character_templates 
           (name, is_federated, source_world_id, source_template_id, bone_map, anim_adapt)
           VALUES ($1, true, $2, $3, $4, $5)
           RETURNING id`,
          [templateData.name || '联邦模板', sourceWorldId, sourceTemplateId, 
           JSON.stringify(boneMapping), JSON.stringify(animAdapt)]
        );

        localTemplateId = insertResult.rows[0].id;
      }

      // 存储联邦模板管理记录
      const federationResult = await query(
        `INSERT INTO federation_templates 
         (user_id, source_world_id, source_template_id, local_template_id, template_data, 
          resource_urls, bone_map, anim_adapt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, source_world_id, source_template_id) 
         DO UPDATE SET 
           template_data = $5, 
           resource_urls = $6, 
           bone_map = $7, 
           anim_adapt = $8, 
           updated_at = NOW()
         RETURNING id`,
        [null, sourceWorldId, sourceTemplateId, localTemplateId,
         JSON.stringify(templateData), JSON.stringify(resources), 
         JSON.stringify(boneMapping), JSON.stringify(animAdapt)]
      );

      // 存储或更新资源引用
      for (const [resourceType, resourceInfo] of Object.entries(resources)) {
        // 处理不同类型的资源
        if (resourceType === 'model' && resourceInfo) {
          await this.upsertResourceReference(localTemplateId, 'model', resourceInfo);
        } else if (Array.isArray(resourceInfo)) {
          // 处理数组类型的资源（动画、声音、纹理）
          for (const resource of resourceInfo) {
            await this.upsertResourceReference(localTemplateId, resourceType, resource);
          }
        }
      }

      return {
        success: true,
        localTemplateId: localTemplateId,
        importStatus: 'success',
        validationResult: {
          isValid: true,
          warnings: [],
          errors: []
        }
      };

    } catch (error) {
      console.error('接收角色模板资源引用失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 资源缓存管理
   */
  static resourceCache = new Map();
  static cacheExpirationTime = 3600000; // 1小时

  /**
   * 缓存资源引用
   */
  static cacheResourceReference(resourceId, resourceData) {
    FederationSystem.resourceCache.set(resourceId, {
      data: resourceData,
      timestamp: Date.now()
    });
  }

  /**
   * 获取缓存的资源引用
   */
  static getCachedResourceReference(resourceId) {
    const cached = FederationSystem.resourceCache.get(resourceId);
    if (cached && Date.now() - cached.timestamp < FederationSystem.cacheExpirationTime) {
      return cached.data;
    }
    // 缓存过期，删除该条目
    if (cached) {
      FederationSystem.resourceCache.delete(resourceId);
    }
    return null;
  }

  /**
   * 清除过期的缓存
   */
  static clearExpiredCache() {
    const now = Date.now();
    for (const [resourceId, cacheEntry] of FederationSystem.resourceCache) {
      if (now - cacheEntry.timestamp > FederationSystem.cacheExpirationTime) {
        FederationSystem.resourceCache.delete(resourceId);
      }
    }
  }

  /**
   * 动画播放验证
   * @param {Object} modelData - 模型数据
   * @param {Object} animationData - 动画数据
   * @param {Object} boneMapping - 骨骼映射表
   * @returns {Object} 验证结果
   */
  validateAnimationPlayback(modelData, animationData, boneMapping) {
    return AnimationAdaptation.validateAnimationPlayback(modelData, animationData, boneMapping);
  }

  /**
   * 存储或更新资源引用
   * @param {string} templateId - 角色模板ID
   * @param {string} resourceType - 资源类型
   * @param {Object} resourceInfo - 资源信息
   */
  async upsertResourceReference(templateId, resourceType, resourceInfo) {
    try {
      await query(
        `INSERT INTO resource_references 
         (template_id, resource_type, resource_url, resource_hash, file_size, format, quality_level)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (template_id, resource_type) 
         DO UPDATE SET 
           resource_url = $3, 
           resource_hash = $4, 
           file_size = $5, 
           format = $6, 
           quality_level = $7, 
           updated_at = NOW()`,
        [templateId, resourceType, resourceInfo.url, resourceInfo.hash, 
         resourceInfo.size, resourceInfo.format, resourceInfo.quality]
      );
    } catch (error) {
      console.error(`存储资源引用失败 (${resourceType}):`, error);
    }
  }

  /**
   * 导入其他世界的配置
   */
  importConfig(config) {
    if (!config.worldId || !config.publicKey) {
      throw new Error('配置数据不完整');
    }

    this.trustWorld(
      config.worldId,
      config.worldName,
      config.worldUrl,
      config.publicKey
    );

    return {
      success: true,
      message: `已导入世界配置: ${config.worldName}`
    };
  }

  /**
   * 启动定期状态检查
   */
  startStatusCheck() {
    // 每30秒检查一次所有世界状态
    setInterval(() => {
      this.checkAllWorldsStatus();
    }, 30000);
    
    console.log('✅ 世界状态监控已启动');
  }

  /**
   * 检查所有世界状态
   */
  async checkAllWorldsStatus() {
    for (const world of this.trustedWorlds.values()) {
      await this.checkWorldStatus(world.worldId);
    }
  }

  /**
   * 检查单个世界状态
   * @param {string} worldId - 世界ID
   */
  async checkWorldStatus(worldId) {
    const world = this.trustedWorlds.get(worldId);
    if (!world) {
      return { success: false, error: '世界不存在' };
    }

    try {
      const response = await axios.get(`${world.worldUrl}/api/federation/info`, {
        timeout: 5000
      });

      if (response.status === 200 && response.data.success) {
        const status = {
          status: 'online',
          lastChecked: new Date(),
          responseTime: response.config.timeout
        };
        this.worldStatus.set(worldId, status);
        return { success: true, status: status };
      } else {
        const status = {
          status: 'offline',
          lastChecked: new Date(),
          error: 'Invalid response'
        };
        this.worldStatus.set(worldId, status);
        return { success: false, status: status };
      }
    } catch (error) {
      const status = {
        status: 'offline',
        lastChecked: new Date(),
        error: error.message
      };
      this.worldStatus.set(worldId, status);
      return { success: false, status: status };
    }
  }

  /**
   * 获取世界状态
   * @param {string} worldId - 世界ID
   */
  getWorldStatus(worldId) {
    return this.worldStatus.get(worldId) || {
      status: 'unknown',
      lastChecked: null
    };
  }

  /**
   * 获取所有世界状态
   */
  getAllWorldStatus() {
    const statuses = {};
    for (const [worldId, status] of this.worldStatus.entries()) {
      statuses[worldId] = status;
    }
    return statuses;
  }

  /**
   * 启动定期清理速率限制
   */
  startRateLimitCleanup() {
    // 每分钟清理一次过期的速率限制记录
    setInterval(() => {
      this.cleanupRateLimits();
    }, 60000);
    
    console.log('✅ 速率限制清理已启动');
  }

  /**
   * 清理过期的速率限制记录
   */
  cleanupRateLimits() {
    const now = Date.now();
    for (const [ip, data] of this.rateLimits.entries()) {
      // 清理超过1分钟的记录
      if (now - data.timestamp > 60000) {
        this.rateLimits.delete(ip);
      }
    }
  }

  /**
   * 检查IP是否在白名单中
   * @param {string} ip - IP地址
   */
  isIpWhitelisted(ip) {
    return this.ipWhitelist.has(ip);
  }

  /**
   * 添加IP到白名单
   * @param {string} ip - IP地址
   */
  addIpToWhitelist(ip) {
    this.ipWhitelist.add(ip);
    console.log(`✅ IP ${ip} 已添加到白名单`);
  }

  /**
   * 从白名单移除IP
   * @param {string} ip - IP地址
   */
  removeIpFromWhitelist(ip) {
    this.ipWhitelist.delete(ip);
    console.log(`✅ IP ${ip} 已从白名单移除`);
  }

  /**
   * 检查速率限制
   * @param {string} ip - IP地址
   */
  checkRateLimit(ip) {
    const now = Date.now();
    const limit = this.rateLimits.get(ip);
    
    if (!limit) {
      // 第一次请求，创建记录
      this.rateLimits.set(ip, {
        count: 1,
        timestamp: now
      });
      return true;
    }
    
    // 检查是否在1分钟内
    if (now - limit.timestamp <= 60000) {
      // 检查请求次数是否超过限制
      if (limit.count >= this.maxRequestsPerMinute) {
        return false;
      }
      // 增加请求次数
      limit.count++;
      this.rateLimits.set(ip, limit);
      return true;
    } else {
      // 超过1分钟，重置计数
      this.rateLimits.set(ip, {
        count: 1,
        timestamp: now
      });
      return true;
    }
  }

  /**
   * 检查IP是否允许访问
   * @param {string} ip - IP地址
   */
  isIpAllowed(ip) {
    // 白名单中的IP直接允许
    if (this.isIpWhitelisted(ip)) {
      return true;
    }
    
    // 检查速率限制
    return this.checkRateLimit(ip);
  }
}

module.exports = FederationSystem;
