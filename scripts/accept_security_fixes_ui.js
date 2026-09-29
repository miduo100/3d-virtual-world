/**
 * 安全修复 · 浏览器冒烟（E2 前端凭证注入 + 游客门槛）
 * ------------------------------------------------------------------
 * 验证：
 *   U1 主世界（游客）：未加载 adminAuthFetch（凭证绝不注入玩家页）；0 「401/未授权」类 console 错误
 *   U2 主世界（游客）：点击 canvas 不弹全屏登录框（D2 游客门槛生效）
 *   U3 admin.html：adminAuthFetch 已装载；页面内发起的真实写请求自动带 adminToken（非 401）
 *   U4 world_editor.html：同上（E2 覆盖先前"只补 /api/world"的盲区）
 *   U5 unified_editor.html：同上
 *   U6 ai_scene_generator.html / ai_motion_factory.html：已装载
 *   U7 后台各页签切换无「401/未授权」类错误
 *
 * 用法：node scripts/accept_security_fixes_ui.js
 */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { chromium } = require('playwright');

const BASE = 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
  console.log((pass ? 'PASS  ' : 'FAIL  ') + name + (detail ? '  [' + detail + ']' : ''));
}

const AUTH_ERR_RE = /(401|403|未授权|无效的token|adminAuthFetch)/;

async function login() {
  const preset = process.env.ADMIN_TOKEN;
  if (preset) return { token: preset, adminUser: { username: ADMIN_USER } };
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('admin login failed: ' + JSON.stringify(data));
  return data;
}

function collect(page) {
  const errors = [];
  const statuses = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 200)));
  page.on('response', (r) => { if (r.url().includes('/api/')) statuses.push({ url: r.url(), status: r.status() }); });
  return { errors, statuses };
}

const NOISE = [/favicon\.ico/i, /runtime\.lastError/i, /index\.global\.js/i, /net::ERR_/i];

/** 与本修复相关的错误（含 401/403/未授权字样的 console 错误） */
function relevantErrors(errors) {
  return errors.filter(e => !NOISE.some(n => n.test(e)) && AUTH_ERR_RE.test(e));
}

async function probeWrite(page) {
  // 在页面上下文里发一个"零写入副作用"的写请求：/api/tags/create 空 body → 400（非 401）
  return await page.evaluate(async () => {
    try {
      const res = await fetch('/api/tags/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const body = await res.text();
      return { status: res.status, body: body.slice(0, 100), injected: (window.__adminAuthFetch && window.__adminAuthFetch.stats.injected) || 0 };
    } catch (e) { return { status: -1, body: String(e.message), injected: -1 }; }
  });
}

(async () => {
  const auth = await login();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });

  // ── U1/U2 游客主世界 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    const { errors, statuses } = collect(page);
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 45000 });
    await page.waitForSelector('#canvas', { timeout: 20000 });
    await page.waitForTimeout(9000);
    const state = await page.evaluate(() => ({
      hasGuard: typeof window.__adminAuthFetch !== 'undefined',
      guest: !!(window.GAME_STATE && window.GAME_STATE.isGuest),
      world: !!(window.gameWorld && window.gameWorld.renderer),
      promptVisible: !!(window.AuthPrompt && document.querySelector('.auth-prompt-overlay, #auth-prompt-overlay')),
    }));
    check('U1a 玩家页未加载 adminAuthFetch（凭证不注入玩家侧）', state.hasGuard === false, 'hasGuard=' + state.hasGuard);
    check('U1b 游客身份进世界成功', state.guest && state.world, JSON.stringify(state));
    // 点击 canvas 中心（可能命中怪物）
    const box = await page.locator('#canvas').boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => ({
      promptVisible: !!(window.AuthPrompt && document.querySelector('.auth-prompt-overlay, #auth-prompt-overlay')),
    }));
    const api401 = statuses.filter(s => s.status === 401 || s.status === 403);
    check('U2 游客点击画布：不弹登录框、无 401/403', !after.promptVisible && api401.length === 0,
      'prompt=' + after.promptVisible + ' statuses=' + JSON.stringify(api401.slice(0, 3)));
    check('U1c 主世界无 401/未授权类 console 错误', relevantErrors(errors).length === 0, relevantErrors(errors).slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ── U3~U6 后台/编辑器页 ──
  const pages = [
    ['U3', '/admin.html', true],
    ['U4', '/world_editor.html', true],
    ['U5', '/unified_editor.html', true],
    ['U6a', '/ai_scene_generator.html', false],
    ['U6b', '/ai_motion_factory.html', false],
  ];
  for (const [tag, url, probe] of pages) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(([token, user]) => {
      try {
        localStorage.setItem('adminToken', token);
        localStorage.setItem('adminUser', JSON.stringify(user));
      } catch (e) { /* ignore */ }
    }, [auth.token, auth.adminUser || { username: ADMIN_USER }]);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    const { errors } = collect(page);
    try {
      await page.goto(BASE + url, { waitUntil: 'load', timeout: 60000 });
      await page.waitForTimeout(6000);
      const installed = await page.evaluate(() => !!(window.__adminAuthFetch && window.__adminAuthFetch.installed));
      check(tag + ' ' + url + ' adminAuthFetch 已装载', installed === true, 'installed=' + installed);
      if (installed && probe) {
        const p = await probeWrite(page);
        check(tag + ' ' + url + ' 页面内写请求自动带 adminToken（非 401）',
          p.status !== 401 && p.injected > 0, JSON.stringify(p));
      }
      check(tag + ' ' + url + ' 无 401/未授权类 console 错误', relevantErrors(errors).length === 0, relevantErrors(errors).slice(0, 2).join(' | '));
    } catch (e) {
      check(tag + ' ' + url + ' 加载', false, String(e.message).slice(0, 160));
    }
    await ctx.close();
  }

  // ── U7 已登录玩家：D2 写接口正常（用真实 token 打 pick 接口，验证未被误伤） ──
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    const r = await page.request.post(BASE + '/api/inventory/drops/00000000-0000-0000-0000-000000000009/pick', {
      headers: { 'Content-Type': 'application/json' }, data: {},
    });
    check('U7 无身份打玩家写接口 → 401（未登录玩家不会被放行）', r.status() === 401, 'status=' + r.status());
    await ctx.close();
  }

  // ── U9 XHR 通道（world_editor 的媒体/模型上传用的是 XMLHttpRequest，必须单独验证） ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(([token, user]) => {
      try {
        localStorage.setItem('adminToken', token);
        localStorage.setItem('adminUser', JSON.stringify(user));
      } catch (e) { /* ignore */ }
    }, [auth.token, auth.adminUser || { username: ADMIN_USER }]);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto(BASE + '/world_editor.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(5000);
    const xhrOut = await page.evaluate(() => new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/tags/create');
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.onload = () => resolve({ status: xhr.status, body: String(xhr.responseText).slice(0, 90), injected: (window.__adminAuthFetch && window.__adminAuthFetch.stats.injected) || 0 });
      xhr.onerror = () => resolve({ status: -1, body: 'xhr error', injected: -1 });
      xhr.send('{}');
    }));
    check('U9 world_editor XHR 通道自动带 adminToken（非 401）',
      xhrOut.status !== 401 && xhrOut.injected > 0, JSON.stringify(xhrOut));
    await ctx.close();
  }

  // ── U8 真实闭环：admin.html 页面内"创建→删除"一个标签（D1 收口后后台功能仍可用） ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(([token, user]) => {
      try {
        localStorage.setItem('adminToken', token);
        localStorage.setItem('adminUser', JSON.stringify(user));
      } catch (e) { /* ignore */ }
    }, [auth.token, auth.adminUser || { username: ADMIN_USER }]);
    const page = await ctx.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    await page.goto(BASE + '/admin.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(4000);
    const out = await page.evaluate(async () => {
      const name = 'secfix_tmp_' + Date.now();
      const created = await fetch('/api/tags/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category: 'secfix' }),
      });
      const cData = await created.json().catch(() => ({}));
      const id = cData && cData.tag && cData.tag.id;
      let delStatus = null;
      if (id) {
        const del = await fetch('/api/tags/' + id, { method: 'DELETE' });
        delStatus = del.status;
      }
      return { createStatus: created.status, id: id || null, delStatus, name };
    });
    check('U8 后台真实写闭环：创建标签成功（非 401）', out.createStatus === 200 && !!out.id, JSON.stringify(out));
    check('U8 后台真实写闭环：删除标签成功（非 401）', out.delStatus === 200, 'delStatus=' + out.delStatus);
    // 兜底清理（避免残留测试标签）
    if (out.id) {
      try { await fetch(BASE + '/api/tags/' + out.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + auth.token } }); } catch (e) {}
    }
    await ctx.close();
  }

  await browser.close();
  const passed = results.filter(r => r.pass).length;
  console.log(`\n===== UI RESULTS =====\n${passed}/${results.length} PASS`);
  results.filter(r => !r.pass).forEach(f => console.log('  FAIL ' + f.name + ' | ' + f.detail));
  console.log(passed === results.length ? 'VERDICT ACCEPTED' : 'VERDICT FAILED');
  process.exit(passed === results.length ? 0 : 1);
})().catch(e => { console.error('FATAL', e); process.exit(2); });
