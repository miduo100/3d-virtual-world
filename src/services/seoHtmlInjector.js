/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * seoHtmlInjector.js — 首页 SEO「服务端注入」
 *
 * 【要解决的问题】
 *   public/index.html 里的 title/meta 原本靠**浏览器端 JS**覆盖：
 *     fetch('/api/config/seo') → document.title = data.seo_title / meta.content = ...
 *   而 **AI 爬虫与搜索引擎不执行 JavaScript** → 它们永远只能看到 HTML 里
 *   硬编码的旧文案，后台 SEO 配置对它们完全无效（"我改了 SEO 怎么没生效"的隐形陷阱）。
 *
 * 【本模块做的事】
 *   把 SEO 配置在**服务端**注入到首页 HTML，使浏览器与爬虫拿到同一份内容：
 *   **system_config 里的 SEO 配置是唯一权威数据源**（改一次，两端同时生效）。
 *
 * 【用法】src/server.js —— 必须注册在 express.static **之前**：
 *     const seoHtml = require('./services/seoHtmlInjector');
 *     app.get(['/', '/index.html'], seoHtml.handler);
 *
 * 【设计要点】
 *   1. 优雅降级：注入失败一律 next() 交回 express.static，首页永不 500
 *   2. 注入失败时保留 HTML 里硬编码的兜底文案（见 public/index.html 的 head）
 *   3. SEO 配置 10 秒 TTL 自过期 → 后台改完最多 10 秒对所有访问者生效
 *      （因此无需在 config.js 的 PUT /seo 里做缓存失效，避免动那个已 550 行的文件）
 *   4. HTML 模板按 mtime 缓存，避免每请求读盘
 *   5. SEO 值来自后台输入 → 注入 HTML 前必须转义（防属性断开 / XSS）
 */

const fs = require('fs');
const path = require('path');
const { query } = require('../database/db');

const INDEX_HTML = path.join(__dirname, '../../public/index.html');
const SEO_KEYS = ['seo_title', 'seo_description', 'seo_keywords'];
const SEO_CACHE_TTL_MS = 10 * 1000;

/**
 * 默认 SEO 文案（DB 未配置时使用）。
 * ⚠️ 这三条必须与 public/index.html 里硬编码的兜底文案保持同义——
 * 前者用于"服务端注入成功"，后者用于"注入失败回退静态文件"，两条路都不该露出旧措辞。
 */
const DEFAULT_SEO = {
  title: '创世虚拟世界 · 让 AI Agent 走进的 3D 世界',
  description: '创世虚拟世界是一个把 AI Agent 当作一等公民的 3D 在线世界：任何 AI 仅凭域名即可零凭证进入，获得身份与 Avatar，在世界里行走、说话、互动，并被真人玩家实时看见。世界由玩家与 AI 共同建造的场景与建筑组成，配有聊天、传送门与跨世界联邦传送，AI 与真人共用同一个世界。Node.js 18+ 零依赖，二十行代码即可接入（WebSocket 动作 + HTTP 观察接口）。技术栈：Three.js、Express、PostgreSQL、WebSocket。',
  keywords: 'AI Agent,虚拟世界,3D世界,在线游戏,Three.js,WebSocket,MCP,PostgreSQL,联邦传送'
};

let _htmlCache = null;
let _htmlMtime = 0;
let _seoCache = null;
let _seoCacheAt = 0;

// ==================== 转义 ====================

/** 用于 <title> 内容（文本节点） */
function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 用于 HTML 属性值（content="..."） */
function escapeAttr(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 正则元字符转义（用于把 meta 的 name/property 值安全地拼进正则） */
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ==================== 读取配置与模板 ====================

/** 读 SEO 配置（10s 缓存；DB 有值则用 DB，否则用默认） */
async function loadSeo() {
  const now = Date.now();
  if (_seoCache && (now - _seoCacheAt) < SEO_CACHE_TTL_MS) return _seoCache;

  const seo = Object.assign({}, DEFAULT_SEO);
  try {
    const r = await query(
      `SELECT config_key, config_value FROM system_config WHERE config_key = ANY($1)`,
      [SEO_KEYS]
    );
    const map = {};
    r.rows.forEach(row => { map[row.config_key] = String(row.config_value || '').trim(); });
    if (map.seo_title) seo.title = map.seo_title;
    if (map.seo_description) seo.description = map.seo_description;
    if (map.seo_keywords) seo.keywords = map.seo_keywords;
  } catch (e) {
    // DB 不可用时用默认值，绝不让首页挂掉
    console.error('[SEO注入] 读取 SEO 配置失败，使用默认值:', e.message);
  }

  _seoCache = seo;
  _seoCacheAt = now;
  return seo;
}

/** 读首页 HTML 模板（按 mtime 失效，避免每请求读盘） */
function loadTemplate() {
  const st = fs.statSync(INDEX_HTML);
  if (_htmlCache && st.mtimeMs === _htmlMtime) return _htmlCache;
  _htmlCache = fs.readFileSync(INDEX_HTML, 'utf8');
  _htmlMtime = st.mtimeMs;
  return _htmlCache;
}

// ==================== 正文摘要区块（body 注入） ====================

/**
 * 首页正文里的「AI 访客摘要」区块。
 *
 * 【为什么需要它】
 *   head 里的 meta description 只在爬虫解析元数据时被用；而**页面正文**才是
 *   搜索引擎与 LLM 判断"这个站讲什么"的主要依据。原首页正文只有 canvas + HUD
 *   键位说明，无 JS 时近乎空壳 —— 于是 AI 访客能学会"怎么接入"，却始终说不出
 *   "世界里有什么"。把 SEO 描述同时渲染进正文，这条才真正闭合。
 *
 * 【数据源】与 head 完全同源（seo_title / seo_description / seo_keywords），
 *   后台改一次 → head 的 meta 与正文区块同时变（10s TTL 内生效）。
 *
 * 【位置】首屏「🎮 操作指南」弹窗（#controls-hint）内的最后一个分组，
 *   点「开始游戏」后随弹窗一起消失（UI.hideControlsHint()）。
 *   为什么选这里：该弹窗本来就是首屏可见的 —— 对真人只是顺带看一眼的介绍，
 *   对爬虫则是货真价实的静态正文，而且**不是隐藏文本**（初始可见，
 *   用户点「开始游戏」才收起，等同于常见的欢迎遮罩）。
 *
 * 【为什么不做成"完全不可见"】display:none、或挪到滚不到的页面底部
 *   （body 是 overflow:hidden 的全屏游戏）都会让内容对真人不可见 → 被判隐藏文本（SEO 作弊）。
 *   公开可见 + 用户主动关闭，才是"不影响游戏体验"与"合规"的交叉点。
 *
 * 【只替换不新增】public/index.html 里已预置同构的兜底区块（section#world-intro），
 *   与 head 的兜底策略一致：模板里存在则整段替换；模板里没有就**不插入**
 *   （位置在弹窗内部，乱插会破坏布局），只打日志提醒。
 */

/** 固定的正文入口链接（均已实测 200）：AI 进来之后该往哪走 */
const INTRO_LINKS_HTML =
  '入口：<a href="/agents/">AI 接入说明</a>' +
  ' · <a href="/llms.txt">llms.txt</a>' +
  ' · <a href="/.well-known/virtual-world-agent.json">发现文档</a>';

/**
 * 结构里的 class 名（wi-block / wi-title / wi-desc / wi-meta）与 #controls-hint 内的样式
 * 全部定义在 public/index.html 的 <head> 里 —— 样式不进注入片段，注入版与兜底版
 * 因此天然同构，改造型只需改那一处 CSS。
 */

/** 把后台 keywords（中英文逗号/分号分隔）转成去重后的"主题"展示串 */
function formatKeywords(keywords) {
  const seen = new Set();
  return String(keywords || '')
    .split(/[,，;；]/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .join(' · ');
}

/** 生成「AI 访客摘要」区块 HTML（配置值一律转义后再落地） */
function buildIntroSection(seo) {
  const title = escapeText(seo.title);
  const desc = escapeText(seo.description);
  const kw = escapeText(formatKeywords(seo.keywords));

  return '<section class="wi-block" id="world-intro" aria-label="关于这个世界">' +
    `<h1 class="wi-title">🌍 ${title}</h1>` +
    `<p class="wi-desc">${desc}</p>` +
    (kw ? `<p class="wi-meta">主题：${kw}</p>` : '') +
    `<p class="wi-meta">${INTRO_LINKS_HTML}</p>` +
    '</section>';
}

/**
 * 把区块写进模板：替换 public/index.html 里预置的兜底区块（在「操作指南」弹窗内部）。
 * 模板里找不到就**不插入** —— 这个区块的位置有语义（弹窗内的最后一个分组），
 * 盲目追加到 body 开头会变成一坨无样式的裸文本，反而破坏首页。
 */
function injectBody(html, sectionHtml) {
  const re = /<section[^>]*\bid=["']world-intro["'][^>]*>[\s\S]*?<\/section>/i;
  if (!re.test(html)) {
    console.warn('[SEO注入] 模板里没有 #world-intro 兜底区块，跳过正文摘要注入');
    return html;
  }
  return html.replace(re, sectionHtml);
}

// ==================== 注入 ====================

/** 替换指定 meta（attr 为 name 或 property）的 content 值 */
function replaceMeta(html, attr, key, newContent) {
  const re = new RegExp(
    `(<meta\\s+${attr}=["']${escapeRe(key)}["']\\s+content=["'])[^"']*(["'])`,
    'i'
  );
  return html.replace(re, `$1${newContent}$2`);
}

/**
 * 把 SEO 值注入 HTML。
 * 每个字段独立判断：HO 模板里存在对应标签才替换，不存在则整段跳过（不会插入新标签）
 * —— 所以标签必须在 public/index.html 里预先写好（含兜底文案）。
 */
function inject(html, seo, baseUrl) {
  let out = html;

  const titleText = escapeText(seo.title);
  const titleAttr = escapeAttr(seo.title);
  const descAttr = escapeAttr(seo.description);
  const kwAttr = escapeAttr(seo.keywords);

  // <title>
  if (seo.title) {
    out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${titleText}</title>`);
  }

  // 基础 meta
  if (seo.description) out = replaceMeta(out, 'name', 'description', descAttr);
  if (seo.keywords) out = replaceMeta(out, 'name', 'keywords', kwAttr);

  // Open Graph / Twitter（AI 摘要与社交分享卡片会用）
  if (seo.title) out = replaceMeta(out, 'property', 'og:title', titleAttr);
  if (seo.description) out = replaceMeta(out, 'property', 'og:description', descAttr);
  if (seo.title) out = replaceMeta(out, 'name', 'twitter:title', titleAttr);
  if (seo.description) out = replaceMeta(out, 'name', 'twitter:description', descAttr);
  if (baseUrl) out = replaceMeta(out, 'property', 'og:url', escapeAttr(baseUrl));

  // 正文区块：把同一份 SEO 描述渲染进 body —— 爬虫抓到的"页面正文"里
  // 从此也有"这个世界是什么 / 世界里有什么 / AI 怎么进来"。
  out = injectBody(out, buildIntroSection(seo));

  return out;
}

// ==================== 路由 handler ====================

/**
 * 首页 handler。注册于 express.static 之前。
 * 任何异常都 next()，交回 express.static 出原始 HTML（优雅降级，首页永不 500）。
 */
async function handler(req, res, next) {
  try {
    const seo = await loadSeo();
    const html = loadTemplate();
    const baseUrl = `${req.protocol}://${req.get('host')}/`;

    const out = inject(html, seo, baseUrl);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // 与 staticCacheOptions 对 .html 的策略一致：协商缓存，改了立刻生效
    res.setHeader('Cache-Control', 'no-cache');
    res.send(out);
  } catch (e) {
    console.error('[SEO注入] 失败，回退静态文件:', e.message);
    return next();
  }
}

module.exports = {
  handler,
  DEFAULT_SEO,
  // 测试/诊断用：清空两级缓存
  _reset() {
    _htmlCache = null;
    _htmlMtime = 0;
    _seoCache = null;
    _seoCacheAt = 0;
  }
};
