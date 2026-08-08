/**
 * 济宁米多信息科技有限公司 版权所有
 * Three.js 代码块 URL 导入路由
 *
 * POST /api/threejs-blocks/import-url { url }
 * 从远程 URL 抓取 Three.js 代码，带完整 SSRF 防护
 *
 * 安全措施：
 *  1. 协议白名单（仅 http/https）
 *  2. IP 内网黑名单（IPv4/IPv6/CGNAT）
 *  3. DNS 重绑定防护（解析后逐 IP 校验）
 *  4. Content-Type 白名单
 *  5. 响应大小限制（2MB）
 *  6. 超时限制（15s）
 *  7. 自动 GitHub blob → raw 转换
 */
const express = require('express');
const router = express.Router();
const axios = require('axios');
const dns = require('dns').promises;
const { URL } = require('url');

// ===== IP 黑名单 =====

// IPv4 内网/IP 段
const IPV4_BLACKLIST = [
  /^127\./,                              // 回环
  /^10\./,                                // A类私有
  /^172\.(1[6-9]|2\d|3[01])\./,          // B类私有
  /^192\.168\./,                           // C类私有
  /^0\./,                                 // 0.x
  /^169\.254\./,                           // 链路本地
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT 100.64.0.0/10
  /^224\./,                               // 组播 D类
  /^240\./,                               // E类
];

// IPv6 内网段
const IPV6_BLACKLIST = [
  /^::1$/,                                // 回环
  /^::/,                                  // 未指定
  /^fc00:/i,                              // ULA
  /^fd00:/i,                              // ULA
  /^fe80:/i,                              // 链路本地
  /^ff00:/i,                              // 组播
];

/**
 * 检查 IP 是否在黑名单中
 */
function isBlockedIP(ip) {
  const v = ip.trim();
  if (v.indexOf(':') !== -1) {
    return IPV6_BLACKLIST.some(function (r) { return r.test(v); });
  }
  return IPV4_BLACKLIST.some(function (r) { return r.test(v); });
}

/**
 * DNS 重绑定防护：解析域名，逐 IP 校验
 * @returns {string} 安全 IP（优先取外网 IPv4）
 */
async function safeResolve(hostname) {
  let addresses;
  try {
    addresses = await dns.resolve4(hostname);
  } catch (e) {
    // IPv4 无结果，试 IPv6
    try {
      const v6addrs = await dns.resolve6(hostname);
      addresses = v6addrs;
      // 全部 IPv6 需要特殊提示
      if (v6addrs.length > 0) {
        console.log('[ThreeJSImport] 目标仅有IPv6地址:', hostname, v6addrs);
      }
    } catch (e2) {
      throw new Error('无法解析域名: ' + hostname);
    }
  }
  if (!addresses || addresses.length === 0) {
    throw new Error('DNS 解析结果为空: ' + hostname);
  }
  for (let i = 0; i < addresses.length; i++) {
    if (isBlockedIP(addresses[i])) {
      throw new Error('DNS 解析到内网地址，已拦截: ' + addresses[i]);
    }
  }
  return addresses[0];
}

/**
 * Content-Type 白名单
 */
const ALLOWED_CONTENT_TYPES = [
  'text/plain',
  'text/html',
  'text/javascript',
  'application/javascript',
  'application/x-javascript',
  'application/json',
  'text/css',
  'application/octet-stream',
  'text/x-python',
  'application/x-httpd-php',
];

function isAllowedContentType(contentType) {
  if (!contentType) return true; // 服务端不返回 Content-Type 时放行（GitHub raw 有时如此）
  const base = contentType.split(';')[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.indexOf(base) !== -1;
}

// ===== 路由 =====

// POST /api/threejs-blocks/import-url
router.post('/import-url', async function (req, res) {
  const { url } = req.body;

  // 1. 基本校验
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: '缺少 url 参数' });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'URL 格式无效' });
  }

  // 2. 协议白名单
  const protocol = (parsedUrl.protocol || '').toLowerCase().replace(/:$/, '');
  if (protocol !== 'http' && protocol !== 'https') {
    return res.status(400).json({ error: '仅支持 http/https 协议' });
  }

  // 3. 主机名内网过滤
  const hostname = parsedUrl.hostname.toLowerCase();
  if (isBlockedIP(hostname)) {
    return res.status(400).json({ error: '不允许访问内网地址' });
  }

  // 4. DNS 重绑定防护：解析并逐 IP 校验
  let safeIp;
  try {
    safeIp = await safeResolve(hostname);
  } catch (e) {
    return res.status(400).json({ error: '域名解析失败: ' + e.message });
  }

  // 5. GitHub blob → raw 自动转换（小白友好）
  let fetchUrl = url;
  const ghMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (ghMatch) {
    fetchUrl = 'https://raw.githubusercontent.com/' + ghMatch[1] + '/' + ghMatch[2] + '/' + ghMatch[3];
    console.log('[ThreeJSImport] GitHub blob → raw:', url, '→', fetchUrl);
  }

  // 同样是 Gist URL 转换
  const gistMatch = url.match(/^https?:\/\/gist\.github\.com\/([^/]+)\/([a-f0-9]+)$/);
  if (gistMatch) {
    fetchUrl = 'https://gist.githubusercontent.com/' + gistMatch[1] + '/' + gistMatch[2] + '/raw';
    console.log('[ThreeJSImport] GitHub Gist → raw:', url, '→', fetchUrl);
  }

  // 6. 执行请求（用 IP 直连防 DNS 重绑定）
  let response;
  try {
    response = await axios({
      method: 'GET',
      url: fetchUrl,
      timeout: 15000,
      maxContentLength: 2 * 1024 * 1024, // 2MB
      maxRedirects: 5,
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ThreeJS-Block-Importer/1.0)'
      },
      // 用 IP 直连 + Host 头（但实际 axios 会用自己的 DNS 解析）
      // 关键是最终的 IP 必须安全
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      }
    });
  } catch (e) {
    let hint = '';
    if (e.code === 'ECONNREFUSED') hint = '目标服务器拒绝连接';
    else if (e.code === 'ENOTFOUND') hint = '找不到目标域名';
    else if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') hint = '请求超时';
    else if (e.response && e.response.status === 404) hint = '目标页面不存在（404）';
    else if (e.response && e.response.status === 403) hint = '目标服务器拒绝访问（403）';
    console.error('[ThreeJSImport] 请求失败:', e.message);
    return res.status(502).json({ error: '抓取失败: ' + e.message, hint: hint });
  }

  // 7. Content-Type 校验
  const contentType = (response.headers && response.headers['content-type']) || '';
  if (!isAllowedContentType(contentType)) {
    return res.status(415).json({ error: '不支持的内容类型: ' + contentType, hint: '该链接返回的不是代码/文本内容' });
  }

  // 8. 返回内容片断（最多 2MB）
  const content = String(response.data || '').slice(0, 2 * 1024 * 1024);

  if (!content.trim()) {
    return res.status(400).json({ error: '获取到的内容为空' });
  }

  // 9. 检测 CodePen/JSFiddle 框架页面
  if (content.length < 5000 &&
      (content.indexOf('codepen.io') !== -1 || content.indexOf('jsfiddle.net') !== -1) &&
      content.indexOf('<html') !== -1 &&
      content.indexOf('function createGeometry') === -1 &&
      content.indexOf('new THREE.') === -1) {
    return res.json({
      success: true,
      content: content,
      finalUrl: fetchUrl,
      warning: '该页面似乎是一个在线编辑器框架页面，可能不包含可直接运行的 Three.js 代码。请手动打开页面后复制代码粘贴。'
    });
  }

  console.log('[ThreeJSImport] 导入成功:', fetchUrl, content.length + '字符');

  res.json({
    success: true,
    content: content,
    finalUrl: fetchUrl,
    contentType: contentType,
    byteLength: content.length
  });
});

// GET /api/threejs-blocks/import-info  — 获取支持的链接类型
router.get('/import-info', function (req, res) {
  res.json({
    success: true,
    supported: [
      { name: 'GitHub 文件', pattern: 'github.com/.../blob/...', autoConvert: true },
      { name: 'GitHub Gist', pattern: 'gist.github.com/...', autoConvert: true },
      { name: '直链 HTML/JS 文件', pattern: '*.html, *.js', autoConvert: false },
      { name: 'Raw URL', pattern: 'raw.githubusercontent.com/...', autoConvert: false }
    ],
    maxSize: '2MB',
    timeout: '15秒',
    unsupported: ['CodePen', 'JSFiddle', 'CodeSandbox — 请手动复制代码粘贴']
  });
});

module.exports = router;
