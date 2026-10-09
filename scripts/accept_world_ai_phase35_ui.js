/**
 * accept_world_ai_phase35_ui.js —— Phase 3.5-2 后台 UI 验收（playwright · chrome）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * 判据：U35-1 tab+模块 / U35-2 自主度三档且不预选 / U35-3 区域列表渲染 / U35-4 玩法说明 / U35-5 0 console error
 *
 * ★ 为什么所有断言都放进**一次** page.evaluate 里做（3.5-2 实测踩坑）：
 *   admin.html 的登录守卫会先跳 admin_login.html 再跳回 admin.html；
 *   任何跨多次 evaluate 的断言都可能被导航打断（表现为 null / "上下文销毁"），
 *   假失败率极高。改成"页面内轮询 + 一次返回"，与导航完全解耦。
 */
'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('playwright');
const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
const REPORT = [];
function log(name, ok, detail) {
  REPORT.push({ name, ok: !!ok });
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
}
(async () => {
  const li = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'baseline_shot', password: 'Baseline#185' }),
  });
  const lj = await li.json();
  const ADMIN_TOKEN = lj.token ? lj.token : lj.adminToken;
  if (!ADMIN_TOKEN) { console.log('FATAL 管理员登录失败', li.status, JSON.stringify(lj)); process.exit(1); }

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript((tk) => {
    localStorage.setItem('adminToken', tk);
    // ★ adminUser 必须是 **JSON 字符串**（checkAdminAuth 会 JSON.parse）——
    //   写成裸字符串会被判未登录 → admin.html ⇄ admin_login.html 无限重定向（3.5-2 实测踩坑）
    localStorage.setItem('adminUser', JSON.stringify({ username: 'baseline_shot', role: 'superadmin' }));
  }, ADMIN_TOKEN);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e && e.message).slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const loc = (m.location() && m.location().url) ? m.location().url : '';
    if (loc.indexOf('favicon') >= 0) return;
    errors.push('console: ' + m.text().slice(0, 160) + ' @ ' + loc);
  });
  try {
    await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
    const inPage = async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const out = { tab: false, module: false, autonomy: null, listLen: 0, listTxt: '', gameplay: '', patched: false, note: '' };
      for (let i = 0; i < 60; i++) {
        out.tab = !!document.getElementById('awr-tab');
        out.module = typeof window.adminWorldRegions === 'object';
        if (out.tab && out.module && document.getElementById('ai-world-brain-sub-awb-regions')) break;
        await sleep(250);
      }
      const el = document.getElementById('awr-autonomy');
      if (el) out.autonomy = { options: Array.from(el.options).map((o) => o.value), selected: el.value };
      out.patched = !!window.__awrPatched;
      const w = document.getElementById('ai-world-brain-sub-awb-regions');
      if (w) w.style.display = 'block';
      try { if (window.adminWorldRegions) await window.adminWorldRegions.load(); } catch (e) { out.note = 'load: ' + e.message; }
      await sleep(1200);
      out.listTxt = ((document.getElementById('awr-list') || {}).innerHTML) || '';
      out.listLen = out.listTxt.length;
      out.gameplay = ((document.getElementById('awr-gameplay') || {}).innerHTML) || '';
      out.wrapTxt = ((document.getElementById('ai-world-brain-sub-awb-regions') || {}).innerHTML) || '';
      return out;
    };
    // 守卫的跳转会把正在跑的 evaluate 打断 → 整段重跑（最终文档是稳定的，第二次必成）
    let R = null;
    for (let i = 0; i < 6 && !R; i++) {
      try { R = await page.evaluate(inPage); } catch (e) { await page.waitForTimeout(2000); }
    }
    if (!R) throw new Error('页面始终在跳转，evaluate 无法稳定执行');
    log('U35-1 「🗺️ 区域与建设」sub-tab 已注入且模块导出 window.adminWorldRegions', R.tab === true && R.module === true, 'tab=' + R.tab + ' module=' + R.module);
    log('U35-2 自主度三档齐全且未预选（UI 不预选是刻意的）',
      !!R.autonomy && R.autonomy.options.length === 4 && R.autonomy.options[0] === '' && R.autonomy.selected === '',
      JSON.stringify(R.autonomy ? R.autonomy.options : null));
    log('U35-1c switchSubTab 补丁已安装（点子页会自动加载，走同一路径）', R.patched === true, '');
    log('U35-3 区域列表已渲染（含「AI 不能碰 N 件」红线回显或空态提示）',
      R.listLen > 0 && (R.listTxt.indexOf('AI 不能碰') >= 0 || R.listTxt.indexOf('还没有区域') >= 0), 'len=' + R.listLen);
    log('U35-4 玩法说明写明「真人交互属 Phase 6、不是故障」（静态面板文案）', R.wrapTxt.indexOf('Phase 6') >= 0, R.note);
    log('U35-5 0 console error', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    log('FATAL UI 验收异常', false, e && e.message);
  } finally {
    await browser.close();
  }
  const fails = REPORT.filter((r) => !r.ok);
  console.log('\n共 ' + REPORT.length + ' 条：PASS ' + (REPORT.length - fails.length) + ' / FAIL ' + fails.length);
  console.log('\n════════ VERDICT: ' + (fails.length ? 'FAILED' : 'ACCEPTED') + '（' + (REPORT.length - fails.length) + '/' + REPORT.length + '）════════');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });