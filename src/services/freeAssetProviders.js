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

module.exports = {
  PROVIDERS,
  listPublic,
  getProvider,
  buildAssetUrl
};
