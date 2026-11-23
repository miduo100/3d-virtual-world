/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 互联网免费模型库 —— 服务端「资产源白名单」
 * ------------------------------------------------------------------
 * 设计红线（务必保持）：
 *   1. **只接受 {provider, id}，绝不接受客户端传 URL**。URL 一律由本文件的
 *      `cdnPath()` 拼接 → 天然没有 SSRF 面（比"校验任意 URL"更省心）。
 *   2. 新增一家源 = 在这里加一条配置 + 前端 js/freeAssetLibrary.js 里 register 一个 provider。
 *   3. 许可策略：**默认热链**（用户在世界里点一次才加载一件）；「下载入库」是显式开关，
 *      前端必须先弹许可提醒，后端只负责落盘与入 uploaded_models。
 *
 * 已接入：
 *   - polyfork —— https://polyfork.dev/  （2026-10-25 起全部低模免费；米制 Y-up；GLB 保留 rig 命名节点）
 *     许可要点：免费商用、免署名；**禁止把文件本体转售/再分发**（自建副本对外分发需 platform 许可）。
 */

const PROVIDERS = {
  polyfork: {
    id: 'polyfork',
    label: 'Polyfork.dev',
    homepage: 'https://polyfork.dev/',
    license: '免费商用·免署名；禁止再分发文件本体（自建副本对外分发需 platform 许可）',
    // 浏览器能否直连搜索（true=前端直连，省一层代理；false=走 /api/free-assets/search 代理）
    corsDirect: true,
    searchApi: 'https://polyfork.dev/api/assets',
    // 成套场景（kit）：列表公开可读，**完整 layout 需要免费账号的 API key**
    kitsApi: 'https://polyfork.dev/api/kits',
    kitIdRe: /^[a-z0-9][a-z0-9-]{2,79}$/i,
    kitApiOf: (kitId) => `https://polyfork.dev/api/kits/${encodeURIComponent(kitId)}`,
    // key 的存放位置：环境变量优先，其次 system_config（后台配置页可改）
    keyEnv: 'POLYFORK_API_KEY',
    keyConfigKey: 'POLYFORK_API_KEY',
    // 允许的下载域名与路径形态（双重闸门）
    hosts: ['polyfork.dev'],
    pathRe: /^\/cdn\/[a-z0-9][a-z0-9-]{2,79}\.glb$/i,
    idRe: /^[a-z0-9][a-z0-9-]{2,79}$/i,
    cdnPath: (id) => `/cdn/${id}.glb`,
    maxBytes: 20 * 1024 * 1024,
    // 落盘目录（相对 public/）
    saveDir: 'models/uploaded/free/polyfork'
  }
};

/** 单个 kit 的导入上限（防止一次点下去把服务器和世界都塞爆） */
const KIT_LIMITS = {
  maxPlacements: 2000,     // 摆放点上限（目前最大的 kit 是 559）
  maxDistinctParts: 120,   // 一次最多下载多少个零件
  downloadConcurrency: 3   // 同时下载几个（对方 CDN 单请求 TTFB 约 1.3s，串行太慢）
};

/** 取源的公开信息（前端下拉框用；不含任何内部字段） */
function listPublic() {
  return Object.keys(PROVIDERS).map((k) => {
    const p = PROVIDERS[k];
    return {
      id: p.id,
      label: p.label,
      homepage: p.homepage,
      license: p.license,
      corsDirect: !!p.corsDirect,
      maxBytes: p.maxBytes
    };
  });
}

function getProvider(providerId) {
  return PROVIDERS[String(providerId || '')] || null;
}

/**
 * 由 {provider, id} 拼出可下载的绝对 URL。
 * 任何一环不合法都返回 {ok:false, code}，绝不"尽力而为"地拼。
 */
function buildAssetUrl(providerId, assetId) {
  const p = getProvider(providerId);
  if (!p) return { ok: false, code: 'UNKNOWN_PROVIDER', message: '未知资产源：' + providerId };
  const id = String(assetId || '').trim();
  if (!p.idRe.test(id)) return { ok: false, code: 'BAD_ASSET_ID', message: '资产 id 不合法' };

  const relUrl = p.cdnPath(id);
  if (!p.pathRe.test(relUrl)) return { ok: false, code: 'BAD_PATH', message: '路径未通过白名单校验' };

  const url = new URL(relUrl, p.homepage).toString();
  const u = new URL(url);
  if (!p.hosts.includes(u.hostname)) {
    return { ok: false, code: 'BAD_HOST', message: '域名不在白名单内' };
  }
  return { ok: true, provider: p, assetId: id, url };
}

/**
 * 由 {provider, kitId} 拼出 kit 详情 API 的绝对 URL。
 * 和 buildAssetUrl 一样：任何一环不合法就返回 {ok:false}，不"尽力而为"。
 */
function buildKitUrl(providerId, kitId) {
  const p = getProvider(providerId);
  if (!p) return { ok: false, code: 'UNKNOWN_PROVIDER', message: '未知资产源：' + providerId };
  if (typeof p.kitApiOf !== 'function') {
    return { ok: false, code: 'NO_KIT_SUPPORT', message: '该资产源不支持成套场景' };
  }
  const id = String(kitId || '').trim();
  if (!p.kitIdRe.test(id)) return { ok: false, code: 'BAD_KIT_ID', message: '套件 id 不合法' };

  const url = p.kitApiOf(id);
  const u = new URL(url);
  if (!p.hosts.includes(u.hostname)) {
    return { ok: false, code: 'BAD_HOST', message: '域名不在白名单内' };
  }
  return { ok: true, provider: p, kitId: id, url };
}

/** kit 列表 API 的绝对 URL（列表不需要 key） */
function buildKitsListUrl(providerId) {
  const p = getProvider(providerId);
  if (!p || !p.kitsApi) return { ok: false, code: 'NO_KIT_SUPPORT', message: '该资产源不支持成套场景' };
  const u = new URL(p.kitsApi);
  if (!p.hosts.includes(u.hostname)) {
    return { ok: false, code: 'BAD_HOST', message: '域名不在白名单内' };
  }
  return { ok: true, provider: p, url: u.toString() };
}

/**
 * 取该源的 API key：环境变量优先，其次 system_config。
 * 只在本进程内使用，绝不下发给前端（前端只拿到 configured:true/false）。
 */
async function resolveApiKey(providerId) {
  const p = getProvider(providerId);
  if (!p || !p.keyEnv) return '';
  const fromEnv = String(process.env[p.keyEnv] || '').trim();
  if (fromEnv) return fromEnv;
  try {
    // 延迟 require，避免服务启动时的循环依赖
    const configService = require('./configService');
    const v = await configService.getConfig(p.keyConfigKey);
    return String(v || '').trim();
  } catch (e) {
    return '';
  }
}

module.exports = {
  PROVIDERS,
  KIT_LIMITS,
  listPublic,
  getProvider,
  buildAssetUrl,
  buildKitUrl,
  buildKitsListUrl,
  resolveApiKey
};
