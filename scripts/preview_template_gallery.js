/**
 * preview_template_gallery.js —— 批量渲染全部模板，出一张对比页（M1-2 交付）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 做什么：
 *   ① 对 templates/ 下每个模板跑一遍 preview_assemble.js → public/assembly-preview/<id>.json
 *   ② 生成 public/assembly-gallery.html：把所有模板放进一个网格，逐格 iframe 复用现有预览页
 *      （不重写渲染器：assembly-preview.html 早就支持 ?plan=<文件名>）
 *
 * 为什么用 iframe 而不是自己写一套 three 渲染：
 *   预览页里已经有「接缝检测 / 出檐标尺 / 分组开关 / 相机预设」，重写一遍必然两边口径不一致，
 *   下次改判据就得改两处。iframe 保证「看到的」和「判据算的」是同一份代码。
 *
 * 用法：node scripts/preview_template_gallery.js
 *       打开 http://127.0.0.1:3002/assembly-gallery.html
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const registry = require('../src/worldai/assembly/templateRegistry');

const OUT_HTML = path.join(ROOT, 'public', 'assembly-gallery.html');
const PREVIEW_DIR = path.join(ROOT, 'public', 'assembly-preview');

const list = registry.listTemplates();
console.log('批量渲染 ' + list.length + ' 个模板…\n');

const cards = [];
for (const brief of list) {
  const t = registry.getTemplate(brief.id);
  try {
    execFileSync(process.execPath, ['scripts/preview_assemble.js', t.id], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    console.error('✗ ' + t.id + ' 渲染失败：' + String((e && e.stdout) || (e && e.message)).slice(-300));
    continue;
  }
  const jsonPath = path.join(PREVIEW_DIR, t.id + '.json');
  if (!fs.existsSync(jsonPath)) { console.error('✗ ' + t.id + ' 没产出 json'); continue; }
  const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const m = t.metrics || {};
  cards.push({
    id: t.id,
    name: t.name,
    cap: t.capability,
    style: t.style,
    material: t.material || '—',
    w: t.dimensions.width,
    d: t.dimensions.depth,
    h: t.dimensions.wallHeight,
    n: j.stats && j.stats.total,
    eave: m.eave ? m.eave.x + ' / ' + m.eave.z : '—',
    seam: m.seamMax,
    gable: m.gableVsRidge == null ? '无（平顶）' : m.gableVsRidge + 'm',
    roof: t.roof && t.roof.mode,
  });
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const cells = cards.map((c) => `
  <section class="card">
    <header>
      <h2>${esc(c.name)}</h2>
      <div class="meta">
        <span class="tag">${esc(c.id)}</span>
        <span class="tag">${esc(c.cap)}</span>
        <span class="tag">${esc(c.style)} / ${esc(c.material)}</span>
        <span class="tag">屋顶 ${esc(c.roof)}</span>
      </div>
      <table>
        <tr><th>尺寸</th><td>${c.w} × ${c.d} × ${c.h}m</td><th>件数</th><td>${c.n}</td></tr>
        <tr><th>出檐 X/Z</th><td>${esc(c.eave)} m</td><th>接缝</th><td>${c.seam} m</td></tr>
        <tr><th>山墙 vs 屋脊</th><td colspan="3">${esc(c.gable)}</td></tr>
      </table>
    </header>
    <div class="view"><iframe loading="lazy" src="/assembly-preview.html?plan=${encodeURIComponent(c.id + '.json')}" title="${esc(c.id)}"></iframe></div>
  </section>`).join('\n');

const html = `<!DOCTYPE html>
<!--
  模板库 v1 对比页（M1-2 交付物 · 由 scripts/preview_template_gallery.js 生成，勿手改）
  每格复用 public/assembly-preview.html（接缝检测 / 出檐标尺 / 分组开关都在那边）
-->
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>模板库 v1 · ${cards.length} 个模板对比</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0d1117; color:#e6edf3; font-family:system-ui,-apple-system,"Segoe UI",sans-serif; }
  .top { position:sticky; top:0; z-index:10; background:rgba(13,17,23,.96); border-bottom:1px solid rgba(0,255,0,.18);
         padding:14px 20px; display:flex; align-items:baseline; gap:16px; backdrop-filter:blur(8px); flex-wrap:wrap; }
  .top h1 { font-size:16px; font-weight:600; color:#00ff00; }
  .top .sum { font-size:12px; color:#8b949e; }
  .top a { color:#58a6ff; font-size:12px; text-decoration:none; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(480px,1fr)); gap:14px; padding:14px 20px 40px; }
  .card { border:1px solid rgba(0,255,0,.16); border-radius:12px; overflow:hidden; background:#11151c; }
  .card header { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,.06); }
  .card h2 { font-size:13px; font-weight:600; color:#e6edf3; margin-bottom:6px; }
  .meta { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
  .tag { font-size:10px; padding:1px 6px; border:1px solid rgba(88,166,255,.35); border-radius:99px; color:#58a6ff; }
  table { width:100%; border-collapse:collapse; font-size:11px; }
  th { text-align:left; color:#8b949e; font-weight:400; padding:1px 4px 1px 0; white-space:nowrap; }
  td { padding:1px 10px 1px 0; font-variant-numeric:tabular-nums; }
  .view { position:relative; width:100%; aspect-ratio:16/10; background:#0d1117; }
  .view iframe { position:absolute; inset:0; width:100%; height:100%; border:0; }
</style>
</head>
<body>
<div class="top">
  <h1>模板库 v1 · ${cards.length} 个模板</h1>
  <span class="sum">每格 = 同一个 preview 页面换 plan 文件；接缝/出檐判据与 accept_m1_2 同源</span>
  <a href="/assembly-preview.html?plan=medieval_6x10.json" target="_blank">单开中世纪小屋 ↗</a>
</div>
<div class="grid">${cells}
</div>
</body>
</html>
`;

fs.writeFileSync(OUT_HTML, html, 'utf8');
console.log('\n✓ ' + path.relative(ROOT, OUT_HTML) + '  ←  ' + cards.length + ' 个模板');
console.log('  打开：http://127.0.0.1:3002/assembly-gallery.html');
