/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const crypto = require('crypto');

/**
 * AI提供商配置管理服务
 * 支持多个AI提供商的动态配置
 */
class AIProviderService {
  constructor() {
    this.encryptionKey = process.env.CONFIG_ENCRYPTION_KEY || 'default-key-change-in-production';
  }

  /**
   * 加密敏感配置值
   */
  encrypt(text) {
    try {
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const iv = Buffer.alloc(16, 0);
      
      const cipher = crypto.createCipheriv(algorithm, key, iv);
      let encrypted = cipher.update(text, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      return encrypted;
    } catch (error) {
      console.error('Encryption error:', error);
      return text;
    }
  }

  /**
   * 解密敏感配置值
   */
  decrypt(encryptedText) {
    try {
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const iv = Buffer.alloc(16, 0);
      
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      return encryptedText;
    }
  }

  /**
   * 获取所有AI提供商
   */
  async getAllProviders(includeDisabled = true) {
    try {
      const { pool } = require('../database/db');
      
      let query = `
        SELECT p.*, 
               COUNT(pc.id) as config_count,
               json_agg(
                 json_build_object(
                   'key', pc.config_key,
                   'value', CASE WHEN pc.is_sensitive THEN '********' ELSE pc.config_value END,
                   'has_value', pc.config_value IS NOT NULL AND pc.config_value != '',
                   'is_sensitive', pc.is_sensitive
                 ) ORDER BY pc.display_order
               ) FILTER (WHERE pc.id IS NOT NULL) as configs
        FROM ai_providers p
        LEFT JOIN ai_provider_configs pc ON p.id = pc.provider_id
      `;
      
      if (!includeDisabled) {
        query += ' WHERE p.is_enabled = true';
      }
      
      query += ' GROUP BY p.id ORDER BY p.provider_type, p.display_name';
      
      const result = await pool.query(query);
      return result.rows;
    } catch (error) {
      console.error('Get all providers error:', error);
      return [];
    }
  }

  /**
   * 获取单个提供商详情
   */
  async getProvider(providerId, includeSensitive = false) {
    try {
      const { pool } = require('../database/db');
      
      const providerResult = await pool.query(
        'SELECT * FROM ai_providers WHERE id = $1',
        [providerId]
      );
      
      if (providerResult.rows.length === 0) {
        return null;
      }
      
      const provider = providerResult.rows[0];
      
      // 获取配置
      const configResult = await pool.query(
        'SELECT * FROM ai_provider_configs WHERE provider_id = $1 ORDER BY display_order',
        [providerId]
      );
      
      provider.configs = configResult.rows.map(config => ({
        key: config.config_key,
        value: config.is_sensitive && !includeSensitive 
          ? '********' 
          : (config.is_sensitive ? this.decrypt(config.config_value) : config.config_value),
        is_sensitive: config.is_sensitive,
        has_value: !!config.config_value
      }));
      
      return provider;
    } catch (error) {
      console.error('Get provider error:', error);
      return null;
    }
  }

  /**
   * 根据类型获取默认提供商
   */
  async getDefaultProvider(type) {
    try {
      const { pool } = require('../database/db');
      
      const result = await pool.query(
        `SELECT * FROM ai_providers 
         WHERE provider_type = $1 AND is_enabled = true AND is_default = true
         LIMIT 1`,
        [type]
      );
      
      if (result.rows.length === 0) {
        return null;
      }
      
      return await this.getProvider(result.rows[0].id, true);
    } catch (error) {
      console.error('Get default provider error:', error);
      return null;
    }
  }

  /**
   * 设置提供商配置
   */
  async setProviderConfig(providerId, configKey, configValue, userId = null, ipAddress = null) {
    try {
      const { pool } = require('../database/db');
      
      // 获取提供商信息和schema
      const provider = await this.getProvider(providerId);
      if (!provider) {
        return { success: false, error: '提供商不存在' };
      }
      
      // 检查配置键是否在schema中定义
      const schema = provider.config_schema?.fields || [];
      const fieldDef = schema.find(f => f.key === configKey);
      
      if (!fieldDef) {
        return { success: false, error: '无效的配置键' };
      }
      
      // 获取旧值用于审计
      const oldResult = await pool.query(
        'SELECT config_value, is_sensitive FROM ai_provider_configs WHERE provider_id = $1 AND config_key = $2',
        [providerId, configKey]
      );
      
      const isSensitive = fieldDef.sensitive || false;
      const oldValue = oldResult.rows.length > 0 ? oldResult.rows[0].config_value : null;
      
      // 如果是敏感配置，加密存储
      const finalValue = isSensitive && configValue ? this.encrypt(configValue) : configValue;
      
      // 更新或插入配置
      await pool.query(
        `INSERT INTO ai_provider_configs (provider_id, config_key, config_value, is_sensitive, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (provider_id, config_key) 
         DO UPDATE SET config_value = $3, updated_by = $5, updated_at = NOW()`,
        [providerId, configKey, finalValue, isSensitive, userId]
      );
      
      // 记录审计日志
      await pool.query(
        `INSERT INTO ai_provider_audit_log (provider_id, action, config_key, old_value, new_value, changed_by, ip_address, changed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [providerId, 'config_updated', configKey, 
         isSensitive ? '****' : oldValue, 
         isSensitive ? '****' : finalValue, 
         userId, ipAddress]
      );
      
      return { success: true };
    } catch (error) {
      console.error('Set provider config error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量设置提供商配置
   */
  async setProviderConfigs(providerId, configs, userId = null, ipAddress = null) {
    const results = [];
    for (const [key, value] of Object.entries(configs)) {
      const result = await this.setProviderConfig(providerId, key, value, userId, ipAddress);
      results.push({ key, ...result });
    }
    return results;
  }

  /**
   * 启用/禁用提供商
   */
  async toggleProvider(providerId, enabled, userId = null, ipAddress = null) {
    try {
      const { pool } = require('../database/db');
      
      await pool.query(
        'UPDATE ai_providers SET is_enabled = $1, updated_at = NOW() WHERE id = $2',
        [enabled, providerId]
      );
      
      // 记录审计日志
      await pool.query(
        `INSERT INTO ai_provider_audit_log (provider_id, action, changed_by, ip_address, changed_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [providerId, enabled ? 'enabled' : 'disabled', userId, ipAddress]
      );
      
      return { success: true };
    } catch (error) {
      console.error('Toggle provider error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 设置默认提供商
   */
  async setDefaultProvider(providerId, userId = null, ipAddress = null) {
    try {
      const { pool } = require('../database/db');
      
      // 获取提供商类型
      const providerResult = await pool.query(
        'SELECT provider_type FROM ai_providers WHERE id = $1',
        [providerId]
      );
      
      if (providerResult.rows.length === 0) {
        return { success: false, error: '提供商不存在' };
      }
      
      const providerType = providerResult.rows[0].provider_type;
      
      // 取消同类型其他提供商的默认状态
      await pool.query(
        'UPDATE ai_providers SET is_default = false WHERE provider_type = $1',
        [providerType]
      );
      
      // 设置新的默认提供商
      await pool.query(
        'UPDATE ai_providers SET is_default = true, is_enabled = true WHERE id = $1',
        [providerId]
      );
      
      // 记录审计日志
      await pool.query(
        `INSERT INTO ai_provider_audit_log (provider_id, action, changed_by, ip_address, changed_at)
         VALUES ($1, 'set_default', $2, $3, NOW())`,
        [providerId, userId, ipAddress]
      );
      
      return { success: true };
    } catch (error) {
      console.error('Set default provider error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 添加自定义提供商
   */
  async addCustomProvider(providerData, userId = null, ipAddress = null) {
    try {
      const { pool } = require('../database/db');
      
      const result = await pool.query(
        `INSERT INTO ai_providers (provider_name, display_name, provider_type, is_enabled, config_schema, description, icon_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          providerData.provider_name,
          providerData.display_name,
          providerData.provider_type,
          providerData.is_enabled || false,
          JSON.stringify(providerData.config_schema),
          providerData.description,
          providerData.icon_url
        ]
      );
      
      // 记录审计日志
      await pool.query(
        `INSERT INTO ai_provider_audit_log (provider_id, action, changed_by, ip_address, changed_at)
         VALUES ($1, 'created', $2, $3, NOW())`,
        [result.rows[0].id, userId, ipAddress]
      );
      
      return { success: true, provider: result.rows[0] };
    } catch (error) {
      console.error('Add custom provider error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取审计日志
   */
  async getAuditLogs(providerId = null, limit = 50) {
    try {
      const { pool } = require('../database/db');
      
      let query = `
        SELECT pal.*, p.display_name as provider_display_name, u.username 
        FROM ai_provider_audit_log pal
        LEFT JOIN ai_providers p ON pal.provider_id = p.id
        LEFT JOIN users u ON pal.changed_by = u.id
      `;
      
      if (providerId) {
        query += ' WHERE pal.provider_id = $1';
      }
      
      query += ' ORDER BY pal.changed_at DESC LIMIT ' + (providerId ? '$2' : '$1');
      
      const params = providerId ? [providerId, limit] : [limit];
      const result = await pool.query(query, params);
      
      return result.rows;
    } catch (error) {
      console.error('Get audit logs error:', error);
      return [];
    }
  }

  /**
   * 测试提供商连接
   */
  async testConnection(providerId) {
    try {
      const provider = await this.getProvider(providerId, true);
      
      if (!provider || !provider.is_enabled) {
        return { success: false, message: '提供商未启用' };
      }
      
      // 检查必需的配置是否已填写
      const schema = provider.config_schema?.fields || [];
      const requiredFields = schema.filter(f => f.required);
      
      const configs = {};
      provider.configs.forEach(c => {
        configs[c.key] = c.value;
      });
      
      for (const field of requiredFields) {
        if (!configs[field.key]) {
          return { success: false, message: `缺少必需配置: ${field.label}` };
        }
      }
      
      // TODO: 这里可以添加实际的API测试调用
      // 根据不同的provider_type调用不同的测试接口
      
      return { success: true, message: '配置验证通过' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

module.exports = new AIProviderService();
