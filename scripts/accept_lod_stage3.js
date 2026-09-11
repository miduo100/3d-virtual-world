/**
 * accept_lod_stage3.js — LOD 三版模型方案【阶段 3：管理接口 + 管理后台 UI】可重跑验收脚本
 *
 * 用法：node scripts/accept_lod_stage3.js      （需先启动服务器，默认 http://localhost:3002）
 *
 * 判据（对应规范文档第 4 节 阶段 3）：
 *   C1 卡片位置正确（世界基础设置卡片下方）—— 浏览器 DOM 顺序断言 + 截图
 *   C2 状态行数字与磁盘/数据库实际一致 —— 脚本用独立实现重新统计并与接口返回值比对
 *   C3 点「一键生成中低模」→ 进度显示 → 完成后待生成数下降
 *      C3a 接口真实批量：POST /generate {limit:1} → processed=1 且 pending 减少 1
 *      C3b 上限钳制：POST /generate {limit:99} → 回显 limit=10 且 processed<=10
 *      C3c UI：mock 该接口后点击按钮 → 进度区显示进度 → 结束显示汇总、按钮恢复可用
 *   C4 开关保存后数据库 system_config.lod_enabled 值正确变化（关闭→'false'，打开→'true'）
 *   C5 刷新状态按钮可用（点击后状态行刷新且无报错）
 *   C6 0 console error（过滤浏览器扩展噪音）
 *
 * 副作用控制：脚本产生的 _mid/_lod（仅本次新生成的）在结束时删除；lod_enabled 恢复原值。
 */
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_BASE || 'http://localhost:3002';
const ADMIN_USER = process.env.ADMIN_USER || 'baseline_shot';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Baseline#185';
const UPLOAD_DIR = path.join(__dirname, '..', 'public', 'models', 'uploaded');
const SHOT_DIR = path.join(__dirname, '..', 'Screenshot', 'accept_lod_stage3');

const checks = [];
function check(id, title, pass, detail) {
  checks.push({ id, title, pass: !!pass, detail: detail === undefined ? '' : String(detail) });
}

async function api(method, p, body, token) {
  const opts = { method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(BASE + p, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* ignore */ }
  return { status: r.status, json, text };
}

// ---------- 独立实现的状态统计（用于 C2 交叉验证，不调用被测服务） ----------
function lodNames(absPath) {
  const name = path.basename(absPath);
  let base = name.replace(/_dec\.glb$/i, '');
  if (base === name) base = name.replace(/\.glb$/i, '');
  const dir = path.dirname(absPath);
  return { mid: path.join(dir, base + '_mid.glb'), low: path.join(dir, base + '_lod.glb') };
}

function walkGlb(dir, depth, out) {
  if (depth > 3) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  entries.forEach((ent) => {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (/^_?backup/i.test(ent.name)) return;
      walkGlb(full, depth + 1, out);
    } else if (/\.glb$/i.test(ent.name) && !/_(mid|lod)\.glb$/i.test(ent.name) && !/\.tmp\.glb$/i.test(ent.name)) {
      out.push(full);
    }
  });
  return out;
}

function readTris(absPath) {
  let fd = null;
  try {
    fd = fs.openSync(absPath, 'r');
    const head = Buffer.alloc(20);
    if (fs.readSync(fd, head, 0, 20, 0) < 20) return 0;
    if (head.readUInt32LE(0) !== 0x46546c67) return 0;
    const len = head.readUInt32LE(12);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 20);
    const json = JSON.parse(buf.toString('utf8').replace(/[\s\u0000]+$/, ''));
    const acc = json.accessors || [];
    let t = 0;
    (json.meshes || []).forEach((m) => (m.primitives || []).forEach((p) => {
      if (p.index !== undefined && acc[p.index]) t += Math.floor(acc[p.index].count / 3);
      else if (p.attributes && p.attributes.POSITION !== undefined && acc[p.attributes.POSITION]) t += Math.floor(acc[p.attributes.POSITION].count / 3);
    }));
    return t;
  } catch (e) {
    return 0;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* ignore */ } }
  }
}

const MIN_SOURCE_TRIS = 5000;

async function independentStatus(query) {
  const seen = new Set();
  const list = [];
  const push = (abs) => {
    const k = abs.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    list.push(abs);
  };
  try {
    const rows = await query(`SELECT path FROM uploaded_models WHERE LOWER(file_type) = 'glb'`);
    rows.rows.forEach((r) => {
      if (!r.path) return;
      push(path.isAbsolute(r.path) ? r.path : path.join(__dirname, '..', 'public', r.path.replace(/^[\\/]+/, '')));
    });
  } catch (e) { /* db 不可用时退化为纯磁盘统计 */ }
  walkGlb(UPLOAD_DIR, 0, []).forEach(push);

  let mid = 0; let low = 0; let pending = 0;
  list.forEach((abs) => {
    const n = lodNames(abs);
    const hasMid = fs.existsSync(n.mid);
    const hasLow = fs.existsSync(n.low);
    if (hasMid) mid += 1;
    if (hasLow) low += 1;
    if (fs.existsSync(abs) && (!hasMid || !hasLow) && readTris(abs) >= MIN_SOURCE_TRIS) pending += 1;
  });
  return { total: list.length, midCount: mid, lowCount: low, pending };
}

function isNoise(t) {
  return /runtime\.lastError|index\.global\.js|ResizeObserver loop|favicon\.ico/i.test(t || '');
}

(async () => {
  console.log('=== LOD Stage 3 Acceptance ===');
  console.log('API base:', BASE);
  let db = null;
  let originalLod = true;
  let adminToken = '';
  const createdVariants = []; // 本次新生成的变体文件（结束时删除）

  try {
    // ---------- 登录 & 前置 ----------
    const login = await api('POST', '/api/admin-auth/login', { username: ADMIN_USER, password: ADMIN_PASS });
    adminToken = (login.json && login.json.token) || '';
    check('PRE', 'admin login', !!adminToken, `status=${login.status} user=${ADMIN_USER}`);
    if (!adminToken) throw new Error('admin login failed');

    const ws0 = await api('GET', '/api/config/world-settings');
    originalLod = !!(ws0.json && ws0.json.lod_enabled);

    // ---------- C2 /status 与独立统计一致 ----------
    db = require('../src/database/db');
    const st = await api('GET', '/api/admin/model-lod/status', undefined, adminToken);
    const ind = await independentStatus(db.query);
    const s = st.json || {};
    check('C2', 'GET /status returns counts', st.status === 200 && s.success === true,
      `status=${st.status} body=${JSON.stringify({ total: s.total, mid: s.midCount, low: s.lowCount, pending: s.pending, enabled: s.enabled })}`);
    check('C2', 'status counts match independent scan',
      s.total === ind.total && s.midCount === ind.midCount && s.lowCount === ind.lowCount && s.pending === ind.pending,
      `api(total=${s.total},mid=${s.midCount},low=${s.lowCount},pending=${s.pending}) vs indep(total=${ind.total},mid=${ind.midCount},low=${ind.lowCount},pending=${ind.pending})`);
    check('C2', '/status requires admin token (401 without)', (await api('GET', '/api/admin/model-lod/status')).status === 401, 'no-token request');

    // ---------- C4 开关写库 ----------
    const name = (ws0.json && ws0.json.world_name) || '';
    const url = (ws0.json && ws0.json.world_url) || '';
    const desc = (ws0.json && ws0.json.world_description) || '';
    const putOff = await api('PUT', '/api/config/world-settings', { world_name: name, world_url: url, world_description: desc, lod_enabled: false });
    const dbOff = (await db.query(`SELECT config_value FROM system_config WHERE config_key = 'lod_enabled'`)).rows[0];
    const stOff = await api('GET', '/api/admin/model-lod/status', undefined, adminToken);
    check('C4', 'save OFF -> DB lod_enabled = false',
      putOff.status === 200 && dbOff && dbOff.config_value === 'false' && stOff.json && stOff.json.enabled === false,
      `put=${putOff.status} db=${dbOff && dbOff.config_value} status.enabled=${stOff.json && stOff.json.enabled}`);

    const putOn = await api('PUT', '/api/config/world-settings', { world_name: name, world_url: url, world_description: desc, lod_enabled: true });
    const dbOn = (await db.query(`SELECT config_value FROM system_config WHERE config_key = 'lod_enabled'`)).rows[0];
    const stOn = await api('GET', '/api/admin/model-lod/status', undefined, adminToken);
    check('C4', 'save ON -> DB lod_enabled = true',
      putOn.status === 200 && dbOn && dbOn.config_value === 'true' && stOn.json && stOn.json.enabled === true,
      `put=${putOn.status} db=${dbOn && dbOn.config_value} status.enabled=${stOn.json && stOn.json.enabled}`);

    // ---------- C3a 真实批量：limit=1 → pending 下降 1 ----------
    const pendingBefore = s.pending;
    const gen1 = await api('POST', '/api/admin/model-lod/generate', { limit: 1 }, adminToken);
    const g1 = gen1.json || {};
    const stAfter = await api('GET', '/api/admin/model-lod/status', undefined, adminToken);
    check('C3', 'POST /generate {limit:1} processes exactly 1',
      gen1.status === 200 && g1.success === true && g1.processed === 1 && g1.limit === 1,
      `status=${gen1.status} limit=${g1.limit} processed=${g1.processed} succeeded=${g1.succeeded} failed=${g1.failed} remaining=${g1.remaining}`);
    check('C3', 'pending decreases after generate',
      !!stAfter.json && stAfter.json.pending === pendingBefore - (g1.succeeded || 0),
      `before=${pendingBefore} after=${stAfter.json && stAfter.json.pending} succeeded=${g1.succeeded}`);
    (g1.results || []).forEach((r) => {
      if (!r.absPath) return;
      const n = lodNames(r.absPath);
      if (r.mid === 'generated') createdVariants.push(n.mid);
      if (r.low === 'generated') createdVariants.push(n.low);
    });

    // ---------- C3b 上限钳制 ----------
    const genBig = await api('POST', '/api/admin/model-lod/generate', { limit: 99 }, adminToken);
    const gb = genBig.json || {};
    check('C3', 'POST /generate {limit:99} clamped to 10',
      genBig.status === 200 && gb.limit === 10 && (gb.processed || 0) <= 10,
      `limit=${gb.limit} processed=${gb.processed} succeeded=${gb.succeeded} remaining=${gb.remaining}`);
    (gb.results || []).forEach((r) => {
      if (!r.absPath) return;
      const n = lodNames(r.absPath);
      if (r.mid === 'generated') createdVariants.push(n.mid);
      if (r.low === 'generated') createdVariants.push(n.low);
    });

    // ---------- C3c / C1 / C5 / C6 浏览器 ----------
    let chromium = null;
    try { chromium = require('playwright').chromium; } catch (e) { /* 未安装 */ }
    if (!chromium) {
      check('C1', 'browser checks', false, 'playwright 不可用');
    } else {
      fs.mkdirSync(SHOT_DIR, { recursive: true });
      let browser = null;
      try {
        browser = await chromium.launch({ channel: 'chrome', headless: true });
      } catch (e) {
        browser = await chromium.launch({ headless: true });
      }
      const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
      const errors = { console: [], page: [], localFailed: [] };
      const page = await ctx.newPage();
      page.on('console', (m) => {
        if (m.type() !== 'error' || isNoise(m.text())) return;
        const t = m.text();
        const u = (m.location && m.location() && m.location().url) || '';
        if (/favicon\.ico/.test(u)) return; // chrome 通道固定噪音
        // "Failed to load resource: net::ERR_*" 不带 URL，无法区分来源：
        // 仅当存在本地资源连接失败时计入，否则视为外部网络抖动
        if (/Failed to load resource: net::ERR_/.test(t) && errors.localFailed.length === 0) return;
        errors.console.push(u ? (t + ' @ ' + u) : t);
      });
      page.on('pageerror', (e) => { if (!isNoise(e.message)) errors.page.push(e.message); });
      page.on('requestfailed', (r) => {
        const u = r.url();
        if (/^https?:\/\/(localhost|127\.)/.test(u) || !/^https?:/.test(u)) errors.localFailed.push(u);
      });
      page.on('dialog', (d) => d.accept()); // 一键生成的二次确认

      // 登录态注入
      await page.goto(BASE + '/admin_login.html', { waitUntil: 'domcontentloaded' });
      await page.evaluate((t) => {
        localStorage.setItem('adminToken', t);
        localStorage.setItem('adminUser', JSON.stringify({ username: 'baseline_shot' }));
      }, adminToken);
      const resp = await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);

      // 打开 系统配置 → 系统参数
      await page.evaluate(() => {
        window.showPage('config');
        const btn = document.querySelector('button[onclick*="sys-config"]');
        window.switchSubTab('config', 'sys-config', btn);
      });

      // C1 卡片存在且位于 世界基础设置 卡片下方（同时等待异步状态行渲染出真实数字）
      const cardInfo = await page.waitForFunction(() => {
        const card = document.getElementById('lod-settings-card');
        const host = document.getElementById('config-sub-sys-config');
        if (!card || !host) return null;
        const cards = Array.from(host.querySelectorAll('.card'));
        const idx = cards.indexOf(card);
        const worldCard = cards.find((c) => /世界基础设置/.test(c.textContent || ''));
        const statusText = (document.getElementById('lod-status-line') || {}).textContent || '';
        if (!/模型总数\s*\d+/.test(statusText)) return null; // 等 loadLodStatus 拉取完成
        return {
          inside: host.contains(card),
          cardIndex: idx,
          worldIndex: cards.indexOf(worldCard),
          cardsTotal: cards.length,
          statusText,
          hasCheckbox: !!document.getElementById('lod-enabled-checkbox'),
          hasButtons: ['saveLodEnabled', 'runLodGenerate', 'refreshLodStatus']
            .every((fn) => typeof window[fn] === 'function'),
        };
      }, null, { timeout: 20000 }).then((h) => h.jsonValue()).catch(() => null);

      check('C1', 'LOD card exists inside 系统参数 tab and after 世界基础设置 card',
        !!cardInfo && cardInfo.inside && cardInfo.worldIndex >= 0 && cardInfo.cardIndex === cardInfo.worldIndex + 1,
        JSON.stringify(cardInfo));
      check('C1', 'card has checkbox / 3 buttons wired to module functions',
        !!cardInfo && cardInfo.hasCheckbox && cardInfo.hasButtons, cardInfo ? `checkbox=${cardInfo.hasCheckbox} fns=${cardInfo.hasButtons}` : 'no card');
      check('C2', 'status line rendered with live numbers',
        !!cardInfo && /模型总数\s*\d+/.test(cardInfo.statusText), cardInfo ? cardInfo.statusText : 'timeout waiting for live numbers');
      await page.screenshot({ path: path.join(SHOT_DIR, 'c1_lod_card.png') });

      // C5 刷新状态按钮
      const refreshed = await (async () => {
        const before = cardInfo ? cardInfo.statusText : '';
        await page.click('button[onclick="refreshLodStatus()"]');
        await page.waitForTimeout(1200);
        const after = await page.evaluate(() => ({
          status: (document.getElementById('lod-status-line') || {}).textContent || '',
          msg: (document.getElementById('lod-save-msg') || {}).textContent || '',
        }));
        return { before, after };
      })();
      check('C5', 'refresh button works (status line + feedback message)',
        /模型总数\s*\d+/.test(refreshed.after.status) && /状态已刷新|读取状态失败/.test(refreshed.after.msg),
        `before="${refreshed.before}" after="${refreshed.after.status}" msg="${refreshed.after.msg}"`);

      // C3c 一键生成（mock 接口，避免动到 145 个真实模型）
      let mockCalls = 0;
      let disabledDuringRun = null;
      let progressDuringRun = '';
      await page.route('**/api/admin/model-lod/generate', async (route) => {
        mockCalls += 1;
        if (mockCalls === 1) {
          const snap = await page.evaluate(() => ({
            disabled: !!document.getElementById('lod-generate-btn').disabled,
            progress: (document.getElementById('lod-progress') || {}).textContent || '',
          }));
          disabledDuringRun = snap.disabled;
          progressDuringRun = snap.progress;
        }
        const body = mockCalls === 1
          ? { success: true, limit: 3, processed: 3, succeeded: 3, failed: 0, remaining: 100, results: [{ name: 'mock-1.glb', ok: true }] }
          : { success: true, limit: 3, processed: 3, succeeded: 3, failed: 0, remaining: 0, results: [{ name: 'mock-2.glb', ok: true }] };
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await page.click('#lod-generate-btn');
      await page.waitForTimeout(2500);
      const genUI = await page.evaluate(() => ({
        progress: (document.getElementById('lod-progress') || {}).textContent || '',
        progressVisible: (document.getElementById('lod-progress') || {}).style.display !== 'none',
        btnDisabled: !!document.getElementById('lod-generate-btn').disabled,
      }));
      check('C3', 'click 一键生成中低模 -> button disabled during run + progress text',
        disabledDuringRun === true && /正在生成\s*\d+\/\d+/.test(progressDuringRun),
        `disabledDuringRun=${disabledDuringRun} progressDuringRun="${progressDuringRun}" mockCalls=${mockCalls}`);
      check('C3', 'progress loop completes with summary and button re-enabled',
        mockCalls >= 2 && genUI.progressVisible && /完成：处理\s*\d+\s*个/.test(genUI.progress) && genUI.btnDisabled === false,
        `mockCalls=${mockCalls} progress="${genUI.progress}" btnDisabled=${genUI.btnDisabled}`);
      await page.screenshot({ path: path.join(SHOT_DIR, 'c3_generate_ui.png') });

      check('C6', '0 console error on admin page',
        errors.console.length === 0 && errors.page.length === 0 && errors.localFailed.length === 0,
        `console=${errors.console.length} pageerror=${errors.page.length} localFailed=${errors.localFailed.length}` +
        (errors.console.length ? ' | ' + errors.console.slice(0, 3).join(' ; ') : '') +
        (errors.localFailed.length ? ' | ' + errors.localFailed.slice(0, 3).join(' ; ') : ''));
      check('C6', 'admin.html served 200', !!resp && resp.status() === 200, `status=${resp && resp.status()}`);

      await ctx.close();
      await browser.close();
    }
  } catch (e) {
    check('FATAL', 'acceptance run', false, e.message);
  } finally {
    // 清理本次新生成的变体文件
    let removed = 0;
    createdVariants.forEach((p) => {
      try { if (fs.existsSync(p)) { fs.unlinkSync(p); removed += 1; } } catch (e) { /* ignore */ }
    });
    if (removed) console.log(`cleanup: removed ${removed} newly generated variant files`);
    // 恢复开关
    try {
      const ws = await api('GET', '/api/config/world-settings');
      if (ws.json && ws.json.world_name && ws.json.world_url && ws.json.lod_enabled !== originalLod) {
        await api('PUT', '/api/config/world-settings', {
          world_name: ws.json.world_name, world_url: ws.json.world_url,
          world_description: ws.json.world_description || '', lod_enabled: originalLod,
        });
        console.log('restored lod_enabled =', originalLod);
      }
    } catch (e) { console.log('restore lod_enabled failed:', e.message); }
    if (db && db.pool) { try { await db.pool.end(); } catch (e) { /* ignore */ } }
  }

  console.log('\n=== Results ===');
  checks.forEach((c) => console.log(`${c.pass ? 'PASS' : 'FAIL'} [${c.id}] ${c.title} -- ${c.detail}`));
  const failed = checks.filter((c) => !c.pass);
  console.log(`\nSUMMARY: ${checks.length - failed.length}/${checks.length} passed, failed=${failed.length}`);
  console.log(failed.length === 0 ? 'VERDICT: ACCEPTED' : 'VERDICT: REJECTED');
  process.exit(failed.length === 0 ? 0 : 1);
})();
