/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * 系统配置管理服务
 * 支持从数据库读取配置，优先级高于环境变量
 */
class ConfigService {
  constructor() {
    this.configCache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5分钟缓存
    this.lastCacheUpdate = 0;
    this.encryptionKey = process.env.CONFIG_ENCRYPTION_KEY || 'default-key-change-in-production';
  }

  /**
   * 加密敏感配置值
   */
  encrypt(text) {
    try {
      // 使用 createCipheriv 替代已废弃的 createCipher
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const iv = Buffer.alloc(16, 0); // 初始化向量
      
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
      // 使用 createDecipheriv 替代已废弃的 createDecipher
      const algorithm = 'aes-256-cbc';
      const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
      const iv = Buffer.alloc(16, 0);
      
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (error) {
      // 解密失败时返回原文（可能是明文存储的）
      return encryptedText;
    }
  }

  /**
   * 从数据库获取配置
   */
  async getConfig(key, decrypt = true) {
    try {
      const { pool } = require('../database/db');
      
      const result = await pool.query(
        'SELECT config_value, is_sensitive FROM system_config WHERE config_key = $1',
        [key]
      );

      if (result.rows.length === 0) {
        // 如果数据库中没有，尝试从环境变量读取
        return process.env[key] || null;
      }

      const { config_value, is_sensitive } = result.rows[0];

      if (is_sensitive && decrypt && config_value) {
        return this.decrypt(config_value);
      }

      return config_value;
    } catch (error) {
      console.error('Get config error:', error);
      // 降级到环境变量
      return process.env[key] || null;
    }
  }

  /**
   * 获取所有配置
   */
  async getAllConfigs(includeSensitive = false) {
    try {
      const { pool } = require('../database/db');
      
      const result = await pool.query(
        'SELECT config_key, config_value, description, is_sensitive, updated_at FROM system_config ORDER BY config_key'
      );

      const configs = {};
      for (const row of result.rows) {
        if (row.is_sensitive && !includeSensitive) {
          // 敏感信息只返回掩码
          configs[row.config_key] = {
            value: row.config_value ? '********' : '',
            description: row.description,
            is_sensitive: row.is_sensitive,
            updated_at: row.updated_at,
            has_value: !!row.config_value
          };
        } else if (row.is_sensitive && includeSensitive) {
          // 解密敏感信息
          configs[row.config_key] = {
            value: row.config_value ? this.decrypt(row.config_value) : '',
            description: row.description,
            is_sensitive: row.is_sensitive,
            updated_at: row.updated_at
          };
        } else {
          configs[row.config_key] = {
            value: row.config_value,
            description: row.description,
            is_sensitive: row.is_sensitive,
            updated_at: row.updated_at
          };
        }
      }

      return configs;
    } catch (error) {
      console.error('Get all configs error:', error);
      return {};
    }
  }

  /**
   * 设置配置
   */
  async setConfig(key, value, userId = null, ipAddress = null) {
    try {
      const { pool } = require('../database/db');

      // 获取旧值用于审计
      const oldResult = await pool.query(
        'SELECT config_value, is_sensitive FROM system_config WHERE config_key = $1',
        [key]
      );

      const isSensitive = oldResult.rows.length > 0 ? oldResult.rows[0].is_sensitive : false;
      const oldValue = oldResult.rows.length > 0 ? oldResult.rows[0].config_value : null;

      // 如果是敏感配置，加密存储
      const finalValue = isSensitive && value ? this.encrypt(value) : value;

      // 更新或插入配置
      await pool.query(
        `INSERT INTO system_config (config_key, config_value, is_sensitive, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (config_key) 
         DO UPDATE SET config_value = $2, updated_by = $4, updated_at = NOW()`,
        [key, finalValue, isSensitive, userId]
      );

      // 记录审计日志
      await pool.query(
        `INSERT INTO config_audit_log (config_key, old_value, new_value, changed_by, ip_address, changed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [key, isSensitive ? '****' : oldValue, isSensitive ? '****' : finalValue, userId, ipAddress]
      );

      // 清除缓存
      this.configCache.delete(key);

      return { success: true };
    } catch (error) {
      console.error('Set config error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 批量设置配置
   */
  async setConfigs(configs, userId = null, ipAddress = null) {
    const results = [];
    for (const [key, value] of Object.entries(configs)) {
      const result = await this.setConfig(key, value, userId, ipAddress);
      results.push({ key, ...result });
    }
    return results;
  }

  /**
   * 删除配置
   */
  async deleteConfig(key, userId = null, ipAddress = null) {
    try {
      const { pool } = require('../database/db');

      // 记录审计日志
      await pool.query(
        `INSERT INTO config_audit_log (config_key, old_value, new_value, changed_by, ip_address, changed_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [key, 'DELETED', '', userId, ipAddress]
      );

      await pool.query('DELETE FROM system_config WHERE config_key = $1', [key]);

      this.configCache.delete(key);

      return { success: true };
    } catch (error) {
      console.error('Delete config error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 验证腾讯云配置是否有效
   */
  async validateTencentConfig() {
    try {
      const secretId = await this.getConfig('TENCENT_SECRET_ID');
      const secretKey = await this.getConfig('TENCENT_SECRET_KEY');

      if (!secretId || !secretKey) {
        return { valid: false, message: '密钥未配置' };
      }

      if (!secretId.startsWith('AKID')) {
        return { valid: false, message: 'SecretId 格式不正确' };
      }

      if (secretKey.length < 20) {
        return { valid: false, message: 'SecretKey 格式不正确' };
      }

      return { valid: true, message: '配置有效' };
    } catch (error) {
      return { valid: false, message: error.message };
    }
  }

  /**
   * 测试混元3D API连接
   */
  async testHunyuan3DConnection() {
    try {
      const hunyuan3dService = require('./hunyuan3d');
      
      // 更新服务使用数据库配置
      hunyuan3dService.secretId = await this.getConfig('TENCENT_SECRET_ID');
      hunyuan3dService.secretKey = await this.getConfig('TENCENT_SECRET_KEY');
      hunyuan3dService.region = await this.getConfig('TENCENT_REGION') || 'ap-guangzhou';

      // 这里可以添加实际的API测试调用
      // 目前只验证配置是否存在
      const validation = await this.validateTencentConfig();
      
      return validation;
    } catch (error) {
      return { valid: false, message: error.message };
    }
  }

  /**
   * 获取配置审计日志
   */
  async getAuditLogs(limit = 50) {
    try {
      const { pool } = require('../database/db');
      
      const result = await pool.query(
        `SELECT cal.*, u.username 
         FROM config_audit_log cal
         LEFT JOIN users u ON cal.changed_by = u.id
         ORDER BY cal.changed_at DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows;
    } catch (error) {
      console.error('Get audit logs error:', error);
      return [];
    }
  }
}

module.exports = new ConfigService();
