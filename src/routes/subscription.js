/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 * 
 * 订阅管理路由 - 本地虚拟支付系统
 * 用户上传支付凭证截图后自动续期，无需管理员确认
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const { query } = require('../database/db');
const { authenticateAdminToken } = require('../middleware/adminAuth');
const subscriptionPricing = require('../services/subscriptionPricing');
const { getUsdRate } = require('../services/exchangeRateService');

// ==================== 凭证图片上传配置 ====================
const proofStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../public/uploads/payment_proofs');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const username = req.adminUser ? req.adminUser.username : 'admin';
    const timestamp = Date.now();
    cb(null, `${username}_${timestamp}${ext}`);
  }
});

const uploadProof = multer({
  storage: proofStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|bmp)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('仅支持图片文件（jpg/png/gif/webp/bmp）'));
    }
  }
});

// ==================== GET /status - 查询系统订阅状态（仅管理员） ====================
router.get('/status', authenticateAdminToken, async (req, res) => {
  try {
    const userId = req.adminUser.id;

    // 获取用户最新订阅记录
    const subResult = await query(
      `SELECT * FROM user_subscriptions 
       WHERE user_id::text = $1::text ORDER BY expires_at DESC LIMIT 1`,
      [String(userId)]
    );

    // 获取系统价格配置 + 当前版本号
    const configResult = await query(
      `SELECT config_key as key, config_value as value FROM system_config 
       WHERE config_key IN ('subscription_price_cents', 'subscription_first_auth_cents', 'subscription_first_auth_months', 'subscription_reauth_after_months', 'billing_company', 'cn_payment_methods', 'en_payment_methods', 'current_version')`
    );
    const config = {};
    configResult.rows.forEach(row => { config[row.key] = row.value; });

    const firstAuthCents = parseInt(config.subscription_first_auth_cents || '6000');
    const firstAuthMonths = parseInt(config.subscription_first_auth_months || '2');
    const reauthAfterMonths = parseInt(config.subscription_reauth_after_months || '12');

    const currentVersion = config.current_version || '1.0.0';

    // 获取联邦世界ID + 世界地址 + 部署时间
    let federationWorldId = null;
    let worldUrl = null;
    let deployDate = null;
    try {
      const fedResult = await query(
        `SELECT value, created_at FROM world_config WHERE key = 'federation_config'`
      );
      if (fedResult.rows.length > 0) {
        const fedConfig = JSON.parse(fedResult.rows[0].value);
        federationWorldId = fedConfig.worldId || null;
        worldUrl = fedConfig.worldUrl || null;
        deployDate = fedResult.rows[0].created_at 
          ? new Date(fedResult.rows[0].created_at).toISOString().split('T')[0]
          : null;
      }
    } catch (e) {
      console.warn('[subscription/status] 读取联邦配置失败:', e.message);
    }

    // 从 system_config 获取世界地址（域名），兜底用 federation 里的 worldUrl
    if (!worldUrl) {
      try {
        const urlResult = await query(
          `SELECT config_value FROM system_config WHERE config_key = 'world_url'`
        );
        worldUrl = urlResult.rows[0]?.config_value || null;
      } catch (e) {
        console.warn('[subscription/status] 读取 world_url 失败:', e.message);
      }
    }

    const priceCents = parseInt(config.subscription_price_cents || '300');
    const now = new Date();

    // 【兜底】无订阅记录 → 尝试补发免费试用
    if (subResult.rows.length === 0 && deployDate) {
      try {
        const tableCheck = await query(
          `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'user_subscriptions')`
        );
        if (tableCheck.rows[0].exists) {
          const expiresAt = new Date(deployDate);
          expiresAt.setMonth(expiresAt.getMonth() + 2);
          await query(
            `INSERT INTO user_subscriptions (user_id, months, amount_cents, payment_method, started_at, expires_at, note)
             VALUES ($1, 2, 0, 'free_trial', $2, $3, '首次部署赠送两个月')`,
            [userId, deployDate, expiresAt.toISOString()]
          );
          console.log(`🎁 [subscription/status] 兜底补发2个月订阅: 用户ID=${userId}`);
        }
      } catch (fallbackError) {
        console.warn('[subscription/status] 兜底补发失败:', fallbackError.message);
      }
    }

    // 重新查询订阅（可能刚由兜底补发）
    let subscription = null;
    let allSubs = subResult;
    if (subResult.rows.length === 0 && deployDate) {
      // 兜底补发后重新查
      const reQuery = await query(
        `SELECT * FROM user_subscriptions 
         WHERE user_id::text = $1::text ORDER BY expires_at DESC LIMIT 1`,
        [String(userId)]
      );
      allSubs = reQuery;
    }
    if (allSubs.rows.length > 0) {
      const sub = allSubs.rows[0];
      const expiresAt = new Date(sub.expires_at);
      const remainingMs = expiresAt - now;
      const isExpired = remainingMs <= 0;

      // 版本检查：授权版本 < 当前版本 → 版本已过期
      const authVersion = sub.authorized_version || '1.0.0';
      const versionExpired = compareVersions(authVersion, currentVersion) < 0;

      subscription = {
        id: sub.id,
        months: sub.months,
        amountCents: sub.amount_cents,
        amountYuan: sub.amount_cents / 100,
        paymentMethod: sub.payment_method,
        proofImageUrl: sub.proof_image_url,
        note: sub.note,
        startedAt: sub.started_at,
        expiresAt: sub.expires_at,
        isExpired,
        versionExpired,
        authorizedVersion: authVersion,
        remainingDays: isExpired ? 0 : Math.ceil(remainingMs / (1000 * 60 * 60 * 24)),
        remainingHours: isExpired ? 0 : Math.floor(remainingMs / (1000 * 60 * 60)),
        createdAt: sub.created_at
      };
    }

    // 获取用户所有订阅历史（兼容 world_id 列可能不存在）
    let historyResult;
    try {
      historyResult = await query(
        `SELECT id, months, amount_cents, payment_method, proof_image_url, note, 
                txn_no, order_no, world_id, started_at, expires_at, created_at 
         FROM user_subscriptions 
         WHERE user_id::text = $1::text ORDER BY created_at DESC`,
        [String(userId)]
      );
    } catch (colErr) {
      if (colErr.message && colErr.message.includes('column')) {
        console.log('[subscription/status] world_id 列不存在，使用兼容模式查询');
        historyResult = await query(
          `SELECT id, months, amount_cents, payment_method, proof_image_url, note, 
                  started_at, expires_at, created_at 
           FROM user_subscriptions 
           WHERE user_id::text = $1::text ORDER BY created_at DESC`,
          [String(userId)]
        );
      } else {
        throw colErr;
      }
    }

    const pricingStatus = subscriptionPricing.buildStatus({
      history: historyResult.rows,
      firstAuthCents,
      unitPriceCents: priceCents,
      firstAuthMonths,
      reauthAfterMonths
    });

    res.json({
      subscription,
      history: historyResult.rows.map(h => ({
        id: h.id,
        months: h.months,
        amountYuan: h.amount_cents / 100,
        paymentMethod: h.payment_method,
        proofImageUrl: h.proof_image_url,
        note: h.note,
        txnNo: h.txn_no || null,
        orderNo: h.order_no || null,
        worldId: h.world_id || null,
        startedAt: h.started_at,
        expiresAt: h.expires_at,
        createdAt: h.created_at
      })),
      config: {
        worldId: federationWorldId || 'N/A',
        worldUrl: worldUrl || '',
        deployDate: deployDate || '',
        priceCents,
        priceYuan: priceCents / 100,
        firstAuthCents,
        firstAuthYuan: firstAuthCents / 100,
        firstAuthMonths,
        reauthAfterMonths,
        currentVersion,
        billingCompany: config.billing_company || '济宁米多信息科技有限公司',
        cnPaymentMethods: (config.cn_payment_methods || 'wechat,alipay').split(','),
        enPaymentMethods: (config.en_payment_methods || 'paypal,crypto').split(','),
        usdRate: await getUsdRate()
      },
      pricingStatus
    });
  } catch (error) {
    console.error('[subscription/status]', error);
    res.status(500).json({ error: '查询订阅状态失败' });
  }
});

// ==================== POST /buy - 购买订阅（上传凭证+自动续期，仅管理员） ====================
router.post('/buy', authenticateAdminToken, uploadProof.single('proof'), async (req, res) => {
  try {
    const userId = req.adminUser.id;
    const { months, payment_method, note, txn_no, order_no } = req.body;

    if (!months || parseInt(months) < 1) {
      return res.status(400).json({ error: '购买月数至少为1' });
    }

    // 获取计费相关配置
    const pricingConfigResult = await query(
      `SELECT config_key, config_value FROM system_config
       WHERE config_key IN ('subscription_price_cents', 'subscription_first_auth_cents', 'subscription_first_auth_months', 'subscription_reauth_after_months')`
    );
    const pricingConfig = {};
    pricingConfigResult.rows.forEach(row => { pricingConfig[row.config_key] = row.config_value; });

    const unitPriceCents = parseInt(pricingConfig.subscription_price_cents || '300');
    const firstAuthCents = parseInt(pricingConfig.subscription_first_auth_cents || '6000');
    const firstAuthMonths = parseInt(pricingConfig.subscription_first_auth_months || '2');
    const reauthAfterMonths = parseInt(pricingConfig.subscription_reauth_after_months || '12');

    // 获取用户历史订阅（排除免费试用后用于计费判断）
    const historyResult = await query(
      `SELECT payment_method, expires_at, created_at FROM user_subscriptions
       WHERE user_id::text = $1::text ORDER BY created_at DESC`,
      [String(userId)]
    );

    const pricing = subscriptionPricing.calculatePricing({
      history: historyResult.rows,
      requestedMonths: months,
      firstAuthCents,
      unitPriceCents,
      firstAuthMonths,
      reauthAfterMonths
    });

    const finalMonths = pricing.finalMonths;
    const amountCents = pricing.amountCents;

    // 获取当前系统版本号
    let currentVersion = '1.0.0';
    try {
      const verResult = await query(
        `SELECT config_value FROM system_config WHERE config_key = 'current_version'`
      );
      currentVersion = verResult.rows[0]?.config_value || '1.0.0';
    } catch (e) {
      console.warn('[subscription/buy] 读取版本号失败:', e.message);
    }

    // 获取联邦世界ID
    let federationWorldId = null;
    try {
      const fedResult = await query(
        `SELECT value FROM world_config WHERE key = 'federation_config'`
      );
      if (fedResult.rows.length > 0) {
        const fedConfig = JSON.parse(fedResult.rows[0].value);
        federationWorldId = fedConfig.worldId || null;
      }
    } catch (e) {
      console.warn('[subscription/buy] 读取联邦世界ID失败:', e.message);
    }

    // 计算到期时间
    let startsAt;
    let expiresAt;
    const now = new Date();

    if (pricing.mode === 'renew') {
      // 正常续费：从当前最新到期时间往后延，如果已过期则从今天开始
      const currentSub = await query(
        `SELECT expires_at FROM user_subscriptions 
         WHERE user_id::text = $1::text ORDER BY expires_at DESC LIMIT 1`,
        [String(userId)]
      );

      if (currentSub.rows.length > 0) {
        const lastExpires = new Date(currentSub.rows[0].expires_at);
        if (lastExpires > now) {
          startsAt = lastExpires;
          expiresAt = new Date(lastExpires);
          expiresAt.setMonth(expiresAt.getMonth() + finalMonths);
        } else {
          startsAt = now;
          expiresAt = new Date(now);
          expiresAt.setMonth(expiresAt.getMonth() + finalMonths);
        }
      } else {
        startsAt = now;
        expiresAt = new Date(now);
        expiresAt.setMonth(expiresAt.getMonth() + finalMonths);
      }
    } else {
      // 首次/重新授权：从今天开始
      startsAt = now;
      expiresAt = new Date(now);
      expiresAt.setMonth(expiresAt.getMonth() + finalMonths);
    }

    // 凭证图片路径
    const proofImageUrl = req.file ? `/uploads/payment_proofs/${req.file.filename}` : null;

    // 写入订阅记录（兼容 txn_no/order_no/world_id/authorized_version 列可能不存在的情况）
    let result;
    try {
      result = await query(
        `INSERT INTO user_subscriptions (user_id, months, amount_cents, payment_method, proof_image_url, note, txn_no, order_no, world_id, authorized_version, started_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING *`,
        [userId, finalMonths, amountCents, payment_method || 'wechat', proofImageUrl, note || null, txn_no || null, order_no || null, federationWorldId, currentVersion, startsAt, expiresAt]
      );
    } catch (insertErr) {
      // txn_no/order_no/world_id/authorized_version 列不存在，回退到不包含这些列的插入
      if (insertErr.message && insertErr.message.includes('column')) {
        console.log('[subscription/buy] 扩展列不存在，使用兼容模式插入');
        // 尝试包含 authorized_version 的插入
        try {
          result = await query(
            `INSERT INTO user_subscriptions (user_id, months, amount_cents, payment_method, proof_image_url, note, txn_no, order_no, world_id, authorized_version, started_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             RETURNING *`,
            [userId, finalMonths, amountCents, payment_method || 'wechat', proofImageUrl, note || null, txn_no || null, order_no || null, federationWorldId, currentVersion, startsAt, expiresAt]
          );
        } catch (innerErr) {
          // 回退到基础插入
          const fallbackNote = [note, txn_no ? `交易单号:${txn_no}` : '', order_no ? `经营单号:${order_no}` : '', federationWorldId ? `世界ID:${federationWorldId}` : '', currentVersion ? `授权版本:${currentVersion}` : '']
            .filter(Boolean).join(' | ');
          result = await query(
            `INSERT INTO user_subscriptions (user_id, months, amount_cents, payment_method, proof_image_url, note, started_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [userId, finalMonths, amountCents, payment_method || 'wechat', proofImageUrl, fallbackNote || null, startsAt, expiresAt]
          );
        }
      } else {
        throw insertErr;
      }
    }

    const sub = result.rows[0];
    const remainingMs = new Date(sub.expires_at) - now;

    const modeText = pricing.mode === 'first' ? '首次授权' : pricing.mode === 'reauth' ? '重新授权' : '续费';
    res.json({
      success: true,
      message: `${modeText}${finalMonths}个月（授权版本：${currentVersion}）`,
      pricingMode: pricing.mode,
      subscription: {
        id: sub.id,
        months: sub.months,
        amountYuan: sub.amount_cents / 100,
        paymentMethod: sub.payment_method,
        proofImageUrl: sub.proof_image_url,
        txnNo: sub.txn_no,
        orderNo: sub.order_no,
        note: sub.note,
        authorizedVersion: currentVersion,
        startedAt: sub.started_at,
        expiresAt: sub.expires_at,
        remainingDays: Math.ceil(remainingMs / (1000 * 60 * 60 * 24)),
        createdAt: sub.created_at
      }
    });
  } catch (error) {
    console.error('[subscription/buy] 完整错误:', error.message, error.stack);
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: '凭证图片超过5MB限制' });
      }
    }
    res.status(500).json({ error: '购买订阅失败: ' + (error.message || '未知错误') });
  }
});

// ==================== GET /admin/list - 管理员查看所有订阅 ====================
router.get('/admin/list', authenticateAdminToken, async (req, res) => {
  try {
    const { page = 1, limit = 50, status } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = '';
    if (status === 'expired') {
      whereClause = 'WHERE us.expires_at <= NOW()';
    } else if (status === 'active') {
      whereClause = 'WHERE us.expires_at > NOW()';
    }

    const result = await query(
      `SELECT us.*, u.username, u.email
       FROM user_subscriptions us
       JOIN users u ON us.user_id = u.id
       ${whereClause}
       ORDER BY us.created_at DESC
       LIMIT $1 OFFSET $2`,
      [parseInt(limit), offset]
    );

    const totalResult = await query(
      `SELECT COUNT(*) as total FROM user_subscriptions us JOIN users u ON us.user_id = u.id ${whereClause}`
    );

    res.json({
      subscriptions: result.rows.map(s => ({
        id: s.id,
        userId: s.user_id,
        username: s.username,
        email: s.email,
        months: s.months,
        amountYuan: s.amount_cents / 100,
        paymentMethod: s.payment_method,
        proofImageUrl: s.proof_image_url,
        note: s.note,
        startedAt: s.started_at,
        expiresAt: s.expires_at,
        isExpired: new Date(s.expires_at) <= new Date(),
        createdAt: s.created_at
      })),
      total: parseInt(totalResult.rows[0].total),
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('[subscription/admin/list]', error);
    res.status(500).json({ error: '查询订阅列表失败' });
  }
});

// ==================== GET /admin/config - 管理员获取系统订阅配置 ====================
router.get('/admin/config', authenticateAdminToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT config_key as key, config_value as value FROM system_config 
       WHERE config_key IN ('subscription_price_cents', 'billing_company', 'cn_payment_methods', 'en_payment_methods', 'current_version')`
    );
    const config = {};
    result.rows.forEach(row => { config[row.key] = row.value; });

    // 获取最新到期时间
    const expireResult = await query(
      `SELECT MAX(expires_at) as max_expires FROM user_subscriptions`
    );

    const priceCents = parseInt(config.subscription_price_cents || '300');
    const maxExpires = expireResult.rows[0]?.max_expires;
    const now = new Date();
    let remainingDays = 0;
    let isExpired = true;

    if (maxExpires) {
      const remainingMs = new Date(maxExpires) - now;
      remainingDays = remainingMs > 0 ? Math.ceil(remainingMs / (1000 * 60 * 60 * 24)) : 0;
      isExpired = remainingMs <= 0;
    }

    res.json({
      config: {
        priceCents,
        priceYuan: priceCents / 100,
        currentVersion: config.current_version || '1.0.0',
        billingCompany: config.billing_company || '济宁米多信息科技有限公司',
        cnPaymentMethods: (config.cn_payment_methods || 'wechat,alipay').split(','),
        enPaymentMethods: (config.en_payment_methods || 'paypal,crypto').split(',')
      },
      expiresAt: maxExpires,
      remainingDays,
      isExpired
    });
  } catch (error) {
    console.error('[subscription/admin/config]', error);
    res.status(500).json({ error: '查询订阅配置失败' });
  }
});

// ==================== POST /admin/update-config - 管理员更新订阅配置 ====================
router.post('/admin/update-config', authenticateAdminToken, async (req, res) => {
  try {
    const { subscription_price_cents, cn_payment_methods, en_payment_methods, billing_company } = req.body;

    const updates = [];
    if (subscription_price_cents) {
      updates.push(query(
        `INSERT INTO system_config(config_key, config_value) VALUES('subscription_price_cents', $1) ON CONFLICT(config_key) DO UPDATE SET config_value = $1, updated_at = NOW()`,
        [String(subscription_price_cents)]
      ));
    }
    if (cn_payment_methods) {
      updates.push(query(
        `INSERT INTO system_config(config_key, config_value) VALUES('cn_payment_methods', $1) ON CONFLICT(config_key) DO UPDATE SET config_value = $1, updated_at = NOW()`,
        [cn_payment_methods]
      ));
    }
    if (en_payment_methods) {
      updates.push(query(
        `INSERT INTO system_config(config_key, config_value) VALUES('en_payment_methods', $1) ON CONFLICT(config_key) DO UPDATE SET config_value = $1, updated_at = NOW()`,
        [en_payment_methods]
      ));
    }
    if (billing_company) {
      updates.push(query(
        `INSERT INTO system_config(config_key, config_value) VALUES('billing_company', $1) ON CONFLICT(config_key) DO UPDATE SET config_value = $1, updated_at = NOW()`,
        [billing_company]
      ));
    }

    await Promise.all(updates);
    res.json({ success: true, message: '配置更新成功' });
  } catch (error) {
    console.error('[subscription/admin/update-config]', error);
    res.status(500).json({ error: '更新配置失败' });
  }
});

// ==================== 版本比较辅助函数 ====================
function compareVersions(a, b) {
  // 比较语义化版本号，返回 -1/0/1
  if (!a || !b) return 0;
  const clean = v => v.replace(/^v/i, '');
  const aParts = clean(a).split('.').map(Number);
  const bParts = clean(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const av = aParts[i] || 0;
    const bv = bParts[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

// ==================== POST /admin/bump-version - 管理员发布新版本 ====================
router.post('/admin/bump-version', authenticateAdminToken, async (req, res) => {
  try {
    const { newVersion, note } = req.body;
    const userId = req.adminUser.id;

    if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
      return res.status(400).json({ error: '版本号格式错误，请使用 x.y.z 格式，如 1.1.0' });
    }

    // 获取当前版本号
    const currentResult = await query(
      `SELECT config_value FROM system_config WHERE config_key = 'current_version'`
    );
    const oldVersion = currentResult.rows[0]?.config_value || '1.0.0';

    // 检查新版本必须高于旧版本
    if (compareVersions(newVersion, oldVersion) <= 0) {
      return res.status(400).json({
        error: `新版本号(${newVersion})必须高于当前版本(${oldVersion})`
      });
    }

    // 更新系统版本号
    await query(
      `INSERT INTO system_config(config_key, config_value) VALUES('current_version', $1)
       ON CONFLICT(config_key) DO UPDATE SET config_value = $1, updated_at = NOW()`,
      [newVersion]
    );

    // 记录版本更新日志
    try {
      await query(
        `INSERT INTO version_updates (old_version, new_version, updated_by, note)
         VALUES ($1, $2, $3, $4)`,
        [oldVersion, newVersion, userId, note || null]
      );
    } catch (e) {
      console.warn('[subscription/bump-version] 记录版本日志失败（可能表不存在）:', e.message);
    }

    console.log(`🚀 [subscription/bump-version] 版本升级: ${oldVersion} → ${newVersion}, 操作人ID=${userId}`);

    res.json({
      success: true,
      message: `版本已从 ${oldVersion} 升级到 ${newVersion}，旧版本订阅需重新购买授权`,
      oldVersion,
      newVersion
    });
  } catch (error) {
    console.error('[subscription/bump-version]', error);
    res.status(500).json({ error: '版本升级失败: ' + (error.message || '未知错误') });
  }
});

// ==================== GET /admin/version-history - 查看版本更新历史 ====================
router.get('/admin/version-history', authenticateAdminToken, async (req, res) => {
  try {
    let history;
    try {
      const result = await query(
        `SELECT vu.*, u.username 
         FROM version_updates vu 
         LEFT JOIN users u ON vu.updated_by = u.id 
         ORDER BY vu.created_at DESC LIMIT 20`
      );
      history = result.rows.map(r => ({
        id: r.id,
        oldVersion: r.old_version,
        newVersion: r.new_version,
        updatedBy: r.username || '系统',
        note: r.note,
        createdAt: r.created_at
      }));
    } catch (e) {
      history = [];
    }

    // 获取当前版本
    const verResult = await query(
      `SELECT config_value FROM system_config WHERE config_key = 'current_version'`
    );
    const currentVersion = verResult.rows[0]?.config_value || '1.0.0';

    res.json({ currentVersion, history });
  } catch (error) {
    console.error('[subscription/admin/version-history]', error);
    res.status(500).json({ error: '查询版本历史失败' });
  }
});

module.exports = router;
