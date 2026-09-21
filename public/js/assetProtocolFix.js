/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 资产地址协议修正（只处理"表头"）
 *
 * ── 背景（2026-09-21）───────────────────────────────────────────────
 * 联邦传送把角色配置（GLB / 动画 / 武器）以「源世界绝对 URL」带给目标世界，
 * 地址里写死的协议可能是 http://。若当前页面是 https://，浏览器会以
 * Mixed Content 直接拦掉该请求：
 *   The page at 'https://x/' was loaded over HTTPS, but requested an insecure
 *   resource 'http://x/...'. This request has been blocked.
 * → 角色模板不显示（停在方块人）、动画不播放。
 *
 * 浏览器侧规则（服务器不区分协议，是浏览器在做裁决）：
 *   fetch / XHR / WebSocket（GLB、动画走这类）→ https 页面上的 http 一律硬拦；
 *   图片 / 视频 → 浏览器会先自动升级成 https 再请求；
 *   顶层跳转 → https → http 允许（所以传送到 http 世界能成功）。
 *
 * ── 本模块只做一件事 ──────────────────────────────────────────────
 *   https 页面 + http:// 开头  →  把前缀换成 https://
 *   其余情况（含 http 页面、相对路径、https:// 开头、null/空）  →  原样返回
 *
 * 依据：同域服务器通常两个协议都能访问（miduo100.com 实测 http / https 均 200，
 * 静态资源都带 Access-Control-Allow-Origin: *），所以"换前缀"就能取到同一个文件。
 *
 * 边界：对方服务器只提供 http、没有证书时，换成 https 会连不上 —— 但 https 页面
 * 上本来就会被浏览器拦，两种都是失败，因此没有额外损失。
 *
 * 加载位置：public/index.html 中 config.js 之后（world.js 之前）。
 */
(function () {
  'use strict';

  /**
   * 纯函数：按指定页面协议修正 URL（便于单测）
   * @param {string} url 原始地址
   * @param {string} pageProtocol 当前页面协议，如 'https:' / 'http:'
   * @returns {string} 修正后的地址；无需修正时返回原值
   */
  function fixUrl(url, pageProtocol) {
    if (typeof url !== 'string') return url;
    var s = url.trim();
    if (!s) return url;
    if (pageProtocol === 'https:' && s.slice(0, 7).toLowerCase() === 'http://') {
      return 'https://' + s.slice(7);
    }
    return url;
  }

  /**
   * 便利入口：按当前页面协议修正
   * @param {string} url
   * @returns {string}
   */
  function fix(url) {
    return fixUrl(url, (typeof location !== 'undefined' && location.protocol) || '');
  }

  var api = {
    version: '1.0.0',
    fix: fix,
    fixUrl: fixUrl
  };

  if (typeof window !== 'undefined') {
    window.fixAssetProtocol = fix;   // 调用点使用的短入口
    window.AssetProtocolFix = api;   // 测试 / 控制台诊断入口
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
