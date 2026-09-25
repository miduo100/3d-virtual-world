/**
 * 自动连接中心世界功能
 * 新部署的世界会自动连接到预设的中心世界
 */

const axios = require('axios');
const { query } = require('./database/db');
const { classifyUrlHost } = require('./services/worldReachabilityChecker');

// 【2026-09-25】中心世界默认地址。原来这里是 `|| null`，而 routes/federation.js 的
// /central-status 与 .env.production.example 都写着"不配置则默认连接 https://miduo100.com"，
// 结果：后台显示「已配置中心世界」但真正发请求的这里从不发（配置假象）。
// 现在统一以本常量兜底；用 CENTRAL_WORLD_URL 可覆盖，用 AUTO_CONNECT_CENTRAL=false 可关闭自连。
const DEFAULT_CENTRAL_WORLD_URL = 'https://miduo100.com';

// 去掉末尾斜杠，便于比较（https://a.com/ 与 https://a.com 视为同一个）
const stripTrailingSlash = (u) => String(u || '').replace(/\/+$/, '');

// 两个 URL 是否指向同一台主机（host 含端口；解析失败时退化为去斜杠字符串比较）
function isSameHost(a, b) {
  if (!a || !b) return false;
  try { return new URL(a).host === new URL(b).host; }
  catch { return stripTrailingSlash(a) === stripTrailingSlash(b); }
}

class CentralWorldConnector {
  constructor(federationSystem) {
    this.federationSystem = federationSystem;
    // 默认连接到中心世界（部署后自动生效）
    this.centralWorldUrl = process.env.CENTRAL_WORLD_URL || DEFAULT_CENTRAL_WORLD_URL;
    this.autoCentralConnect = process.env.AUTO_CONNECT_CENTRAL !== 'false';
  }

  /**
   * 自动连接到中心世界
   */
  async autoConnectToCentral() {
    if (!this.centralWorldUrl) {
      console.log('ℹ️  未配置中心世界URL，跳过自动连接');
      return { success: false, reason: 'no_central_url' };
    }

    if (!this.autoCentralConnect) {
      console.log('ℹ️  自动连接已禁用，跳过');
      return { success: false, reason: 'disabled' };
    }

    // 【2026-09-25】中心世界 == 本世界时跳过：中心世界自己不需要自连，
    // 否则每次启动都会把自己写进互信列表（列表里会多出一条"本世界"）。
    if (isSameHost(this.centralWorldUrl, this.federationSystem.worldUrl)) {
      console.log('ℹ️  中心世界与本世界是同一个地址，跳过自动连接');
      return { success: false, reason: 'self_world' };
    }

    // 握手也会向对方登记本世界的 URL，同样先做源头自检
    const selfUrlForTrust = this.federationSystem.worldUrl;
    const selfClsForTrust = classifyUrlHost(selfUrlForTrust);
    if (selfClsForTrust.type !== 'public' && process.env.FEDERATION_ALLOW_PRIVATE !== '1') {
      console.warn('⚠️  [联邦] 本世界 worldUrl 为内网/本机地址，跳过与中心世界的握手建信任');
      return { success: false, reason: 'private_url' };
    }

    try {
      // 检查是否已经连接过
      const existingResult = await query(
        'SELECT * FROM trusted_worlds WHERE world_url = $1',
        [this.centralWorldUrl]
      );

      if (existingResult.rows.length > 0) {
        console.log('✅ 已经连接到中心世界:', this.centralWorldUrl);
        return { success: true, reason: 'already_connected' };
      }

      console.log('🔄 正在自动连接到中心世界:', this.centralWorldUrl);

      // 建立信任连接
      const result = await this.federationSystem.establishTrust(this.centralWorldUrl);

      if (result.success) {
        console.log('✅ 成功连接到中心世界！');
        
        // 保存到数据库
        const worldInfo = this.federationSystem.trustedWorlds.get(result.worldId);
        if (worldInfo) {
          await query(
            `INSERT INTO trusted_worlds 
             (world_id, world_name, world_url, public_key, is_central, created_at, enabled)
             VALUES ($1, $2, $3, $4, true, NOW(), true)
             ON CONFLICT (world_id) DO UPDATE 
             SET world_name = $2, world_url = $3, public_key = $4, is_central = true, updated_at = NOW()`,
            [worldInfo.worldId, worldInfo.worldName, worldInfo.worldUrl, worldInfo.publicKey]
          );
        }

        return { success: true, worldInfo };
      } else {
        console.error('❌ 连接中心世界失败:', result.error);
        return { success: false, error: result.error };
      }

    } catch (error) {
      console.error('❌ 自动连接中心世界时出错:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 向中心世界注册自己
   */
  async registerToCentral() {
    if (!this.centralWorldUrl) {
      return { success: false, reason: 'no_central_url' };
    }

    // 【2026-09-25】同理：中心世界不需要把自己注册给自己
    if (isSameHost(this.centralWorldUrl, this.federationSystem.worldUrl)) {
      console.log('ℹ️  中心世界与本世界是同一个地址，跳过向中心世界注册');
      return { success: false, reason: 'self_world' };
    }

    // 发送前自检：本机 worldUrl 为内网/本机地址时不向中心世界发请求（源头屏蔽）
    const selfUrl = this.federationSystem.worldUrl;
    const selfCls = classifyUrlHost(selfUrl);
    if (selfCls.type !== 'public' && process.env.FEDERATION_ALLOW_PRIVATE !== '1') {
      console.warn('⚠️  [联邦] 本世界 worldUrl 为内网/本机地址，外部用户无法访问，跳过联邦注册:');
      console.warn(`    ${selfUrl}`);
      console.warn('    如需加入联邦，请配置公网域名或端口映射后，在管理后台重新保存世界设置');
      return { success: false, reason: 'private_url' };
    }

    try {
      const myWorldConfig = this.federationSystem.exportConfig();

      // 向中心世界发送注册请求
      // 注意：中心世界的register-client端点应该允许无认证注册
      const response = await axios.post(
        `${this.centralWorldUrl}/api/federation/register-client`,
        {
          worldConfig: myWorldConfig,
          timestamp: Date.now()
        },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.success) {
        console.log('✅ 已向中心世界注册');
        return { success: true };
      } else {
        console.error('❌ 中心世界注册失败:', response.data.error);
        return { success: false, error: response.data.error };
      }

    } catch (error) {
      console.error('❌ 向中心世界注册时出错:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取中心世界的信息
   */
  async getCentralWorldInfo() {
    if (!this.centralWorldUrl) {
      return null;
    }

    try {
      const response = await axios.get(`${this.centralWorldUrl}/api/federation/info`);
      
      if (response.data.success) {
        return response.data.world;
      }

      return null;
    } catch (error) {
      console.error('获取中心世界信息失败:', error.message);
      return null;
    }
  }

  /**
   * 检查中心世界连接状态
   */
  async checkCentralConnection() {
    if (!this.centralWorldUrl) {
      return { connected: false, reason: 'no_central_url' };
    }

    try {
      const result = await query(
        'SELECT * FROM trusted_worlds WHERE world_url = $1 AND is_central = true',
        [this.centralWorldUrl]
      );

      if (result.rows.length > 0) {
        // 尝试ping中心世界
        const info = await this.getCentralWorldInfo();
        
        return {
          connected: true,
          online: !!info,
          worldInfo: result.rows[0]
        };
      }

      return { connected: false, reason: 'not_trusted' };

    } catch (error) {
      return { connected: false, error: error.message };
    }
  }
}

module.exports = CentralWorldConnector;
