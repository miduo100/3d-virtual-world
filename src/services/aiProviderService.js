/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const crypto = require('crypto');

/**
 * 密文格式版本前缀。
 * g1 = 新格式：AES-256-GCM + **随机 IV** + 认证标签 → `g1:<ivHex>:<tagHex>:<cipherHex>`
 * 旧格式：aes-256-cbc + **固定 IV(全 0)** + 无前缀 → 16 进制串
 *
 * ⚠ 必须双格式兼容：库里存量 12 条密钥都是旧格式加密的（Phase 0 之前），
 *   若只认新格式，升级后所有 provider 立刻失效且密钥**无法找回**（不可逆）。
 *   所以 decrypt 按前缀分流，encrypt 一律写新格式（下次保存时自动升级）。
 */
const CIPHER_PREFIX = 'g1';
const LEGACY_SALT = 'salt';
const SALT = 'virtual-world-ai-provider-salt-v1';

/** 解密失败只告警一次（避免每次读库刷屏），但绝不静默返回明文 */
const warned = new Set();
function decryptWarned(kind, key, err) {
  const tag = `${kind}:${key}`;
  if (warned.has(tag)) return;
  warned.add(tag);
  console.error(`[aiProviderService] ${tag} 解密失败：${err && err.message}`);
}

/**
 * AI提供商配置管理服务
 * 支持多个AI提供商的动态配置
 */
class AIProviderService {
  constructor() {
    this.encryptionKey = process.env.CONFIG_ENCRYPTION_KEY || 'default-key-change-in-production';
  }

  /** 派生加密密钥（keyId 用于将来轮换密钥时区分） */
  _deriveKey(salt) {
    return crypto.scryptSync(this.encryptionKey, salt, 32);
  }

  /**
   * 加密敏感配置值（新格式：随机 IV + GCM 认证）
   * 失败**抛错**（旧实现静默返回明文 = 密钥明文入库）
   */
  encrypt(text) {
    if (text === undefined || text === null) return text;
    const plain = String(text);
    const iv = crypto.randomBytes(12);                      // GCM 建议 12 字节 IV
    const cipher = crypto.createCipheriv('aes-256-gcm', this._deriveKey(SALT), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [CIPHER_PREFIX, iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':');
  }

  /**
   * 解密敏感配置值。
   * 兼容两种格式；**解密失败抛错**（旧实现返回密文原文，调用方会把 hex 当 API Key 发出去）
   */
  decrypt(encryptedText) {
    if (encryptedText === undefined || encryptedText === null) return encryptedText;
    const raw = String(encryptedText);
    if (!raw) return raw;

    // 新格式
    if (raw.startsWith(CIPHER_PREFIX + ':')) {
      const parts = raw.split(':');
      if (parts.length !== 4) throw new Error('密文格式损坏（g1 需要 4 段）');
      const [, ivHex, tagHex, dataHex] = parts;
      const decipher = crypto.createDecipheriv('aes-256-gcm', this._deriveKey(SALT), Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      return Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]).toString('utf8');
    }

    // 旧格式（aes-256-cbc + 固定 IV），保留仅为读存量数据
    try {
      const decipher = crypto.createDecipheriv('aes-256-cbc', this._deriveKey(LEGACY_SALT), Buffer.alloc(16, 0));
      return Buffer.concat([decipher.update(Buffer.from(raw, 'hex')), decipher.final()]).toString('utf8');
    } catch (e) {
      throw new Error('解密失败：值不是本系统加密的密文（可能是明文误存或密钥已变更）');
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
      
      provider.configs = configResult.rows.map(config => {
        const base = { key: config.config_key, is_sensitive: config.is_sensitive, has_value: !!config.config_value };
        if (!config.is_sensitive) return { ...base, value: config.config_value };
        if (!includeSensitive) return { ...base, value: '********' };
        // 逐条隔离：某条密钥解密失败不能连带整个 provider 变成「不存在」，
        // 否则后台会误判 provider 丢失（decrypt 现在会抛错，见上）
        try {
          return { ...base, value: this.decrypt(config.config_value) };
        } catch (e) {
          decryptWarned('config', config.config_key, e);
          return { ...base, value: '********', decrypt_error: 'DECRYPT_FAILED' };
        }
      });

      return provider;
    } catch (error) {
      console.error('Get provider error:', error);
      return null;
    }
  }

  /**
   * 根据类型获取默认提供商（Phase 0 复活：此前全库零调用者 = 死代码）
   *
   * `provider_type = $1` 精确匹配对 'chat,image_to_3d' 这类**逗号多值**失效
   * （混元存 'chat,image_to_3d'，按 'chat' 查 → 0 行）→ 改为 LIKE 精确段匹配。
   */
  async getDefaultProvider(type) {
    try {
      const { pool } = require('../database/db');

      const result = await pool.query(
        `SELECT * FROM ai_providers
         WHERE (provider_type = $1 OR provider_type LIKE $1 || ',%' OR provider_type LIKE '%,' || $1 || ',%' OR provider_type LIKE '%,' || $1)
           AND is_enabled = true AND is_default = true
         ORDER BY id ASC
         LIMIT 1`,
        [type]
      );

      if (result.rows.length === 0) {
        // 没有 is_default 的，就取该类型第一个启用的（getDefaultProvider 语义应是"能用"）
        const fb = await pool.query(
          `SELECT * FROM ai_providers
            WHERE (provider_type = $1 OR provider_type LIKE $1 || ',%' OR provider_type LIKE '%,' || $1 || ',%' OR provider_type LIKE '%,' || $1)
              AND is_enabled = true
            ORDER BY id ASC LIMIT 1`,
          [type]
        );
        if (fb.rows.length === 0) return null;
        return await this.getProvider(fb.rows[0].id, true);
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
