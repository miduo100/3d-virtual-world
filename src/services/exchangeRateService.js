/**
 * 汇率获取服务
 * 从 Frankfurter API 获取 CNY→USD 参考汇率
 * 内存缓存24小时，失败降级用默认值
 */
const axios = require('axios');

const FRANKFURTER_URL = 'https://api.frankfurter.app/latest?from=CNY&to=USD';
const DEFAULT_RATE = 0.1475;              // 降级默认汇率（1 CNY ≈ 0.1475 USD）
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24小时

let cachedRate = null;
let cachedAt = 0;

async function fetchRateFromAPI() {
  const resp = await axios.get(FRANKFURTER_URL, { timeout: 5000 });
  const rate = resp.data && resp.data.rates && resp.data.rates.USD;
  if (typeof rate === 'number' && rate > 0) {
    return rate;
  }
  throw new Error('Invalid rate response');
}

/**
 * 获取 USD 汇率（1 CNY = ? USD）
 * 优先用缓存，缓存过期则调API，API失败用上次缓存或默认值
 */
async function getUsdRate() {
  const now = Date.now();
  if (cachedRate && (now - cachedAt) < CACHE_TTL_MS) {
    return cachedRate; // 缓存有效
  }
  try {
    const rate = await fetchRateFromAPI();
    cachedRate = rate;
    cachedAt = now;
    console.log(`[exchangeRate] 汇率更新成功: 1 CNY = ${rate} USD`);
    return rate;
  } catch (err) {
    console.warn(`[exchangeRate] 获取汇率失败，使用${cachedRate ? '缓存' : '默认'}值:`, err.message);
    if (cachedRate) return cachedRate;    // 用上次缓存
    return DEFAULT_RATE;                   // 最终降级
  }
}

module.exports = { getUsdRate, DEFAULT_RATE };
