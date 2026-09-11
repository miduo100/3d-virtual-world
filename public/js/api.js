/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// API functions
class API {
  static async request(method, endpoint, data = null, _retryState = null) {
    try {
      const options = {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (localStorage.getItem('token')) {
        options.headers['Authorization'] = `Bearer ${localStorage.getItem('token')}`;
      }

      if (data) {
        options.body = JSON.stringify(data);
      }

      // 检查CONFIG.API_BASE是否定义，如果未定义则使用默认值
      const apiBase = CONFIG.API_BASE || (window.location.origin + '/api');

      // 🆕 添加15秒超时保护，防止请求无限等待
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const response = await fetch(`${apiBase}${endpoint}`, { ...options, signal: controller.signal });
        clearTimeout(timeoutId);

        // 滑动续期：token 剩余有效期不足时服务端随响应头下发新 token
        const renewed = response.headers.get('X-Renewed-Token');
        if (renewed) {
          localStorage.setItem('token', renewed);
        }

        if (!response.ok) {
          let err;
          try {
            const errorData = await response.json();
            err = new Error(errorData.error || `API error: ${response.status}`);
            err.status = response.status;
            err.code = errorData.code || null;
            err.retryAfter = errorData.retryAfter || null;
          } catch (e) {
            err = new Error(`API error: ${response.status}`);
            err.status = response.status;
          }

          // token 失效兜底：弹出登录框，重登成功后自动重试原请求（仅一次）
          if (API._isTokenInvalid(err) && !(_retryState && _retryState.retried) && window.AuthPrompt) {
            try {
              await window.AuthPrompt.prompt();
            } catch (e) {
              throw err; // 用户取消登录：维持原始错误
            }
            return await this.request(method, endpoint, data, { retried: true });
          }

          throw err;
        }

        return await response.json();
      } catch (fetchError) {
        clearTimeout(timeoutId);
        if (fetchError.name === 'AbortError') {
          throw new Error('请求超时，请检查网络连接或稍后重试');
        }
        throw fetchError;
      }
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * 判断是否为"token 无效/过期"类错误（区别于业务 403 如"需要管理员权限"）
   */
  static _isTokenInvalid(err) {
    if (!err || !err.status) return false;
    const msg = String(err.message || '');
    if (err.status === 403 && msg.includes('无效的token')) return true;
    if (err.status === 401 && /token/i.test(msg)) return true;
    return false;
  }

  // Authentication
  static async register(username, email, password, securityQuestionId, securityAnswer) {
    return this.request('POST', '/auth/register', { username, email, password, securityQuestionId, securityAnswer });
  }

  static async login(username, password) {
    return this.request('POST', '/auth/login', { username, password });
  }

  // 获取可用的安全问题列表（注册时调用）
  static async getSecurityQuestions() {
    return this.request('GET', '/auth/security-questions');
  }

  // 找回密码 - 步骤1：输入账号，返回安全问题
  static async forgotStep1(username) {
    return this.request('POST', '/auth/forgot-step1', { username });
  }

  // 找回密码 - 步骤2：验证答案，获取重置令牌
  static async forgotStep2(username, answer) {
    return this.request('POST', '/auth/forgot-step2', { username, answer });
  }

  // 找回密码 - 步骤3：使用令牌重置密码
  static async resetPassword(token, newPassword) {
    return this.request('POST', '/auth/reset-password', { token, newPassword });
  }

  // Users
  static async getCharacter(characterId) {
    return this.request('GET', `/users/character/${characterId}`);
  }

  static async updateAppearance(characterId, appearanceData) {
    return this.request('POST', `/users/character/${characterId}/appearance`, appearanceData);
  }

  static async updatePosition(characterId, position) {
    return this.request('POST', `/users/character/${characterId}/position`, { position });
  }

  static async setRespawnPoint(characterId, respawnPoint) {
    return this.request('POST', `/users/character/${characterId}/respawn-point`, { respawnPoint });
  }

  // World
  static async getWorldState() {
    return this.request('GET', '/world/state');
  }

  // Shop
  static async getShops() {
    return this.request('GET', '/shop');
  }

  static async getShop(shopId) {
    return this.request('GET', `/shop/${shopId}`);
  }

  static async purchaseItem(buyerId, shopItemId, quantity) {
    return this.request('POST', '/shop/purchase', { buyerId, shopItemId, quantity });
  }

  // Plots
  static async getUserPlots(userId) {
    return this.request('GET', `/plot/user/${userId}`);
  }

  static async createPlot(ownerId, position, size) {
    return this.request('POST', '/plot/create', { ownerId, position, size });
  }

  static async addBuilding(plotId, buildingName, modelUrl, position, rotation, scale) {
    return this.request('POST', `/plot/${plotId}/add-building`, {
      buildingName,
      modelUrl,
      position,
      rotation,
      scale,
    });
  }

  static async getPlotBuildings(plotId) {
    return this.request('GET', `/plot/${plotId}/buildings`);
  }

  // Skills
  static async getSkills(characterId) {
    return this.request('GET', `/skills/character/${characterId}`);
  }

  static async addSkill(characterId, skillName, triggerText, effectType, effectDuration, effectPower, rangeDistance) {
    return this.request('POST', '/skills/add', {
      characterId,
      skillName,
      triggerText,
      effectType,
      effectDuration,
      effectPower,
      rangeDistance,
    });
  }

  static async triggerSkill(characterId, triggerText) {
    return this.request('POST', '/skills/trigger', { characterId, triggerText });
  }

  // Monster
  static async getMonsters() {
    return this.request('GET', '/monster');
  }

  static async spawnMonster(monsterType, spawnPosition, health, attackPower) {
    return this.request('POST', '/monster/spawn', { monsterType, spawnPosition, health, attackPower });
  }

  static async monsterTakeDamage(monsterId, damage, characterId, userId) {
    return this.request('POST', `/monster/${monsterId}/take-damage`, { damage, characterId, userId });
  }

  static async characterTakeDamage(characterId, damage) {
    return this.request('POST', `/monster/character/${characterId}/take-damage`, { damage });
  }

  // Generic methods for convenience
  static async get(endpoint) {
    return this.request('GET', endpoint);
  }

  static async post(endpoint, data) {
    return this.request('POST', endpoint, data);
  }

  static async put(endpoint, data) {
    return this.request('PUT', endpoint, data);
  }

  static async delete(endpoint) {
    return this.request('DELETE', endpoint);
  }
}

// 暴露到全局作用域
if (typeof window !== 'undefined') {
  window.API = API;
}
