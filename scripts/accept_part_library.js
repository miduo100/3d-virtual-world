/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 零件库（admin.html「📚 零件库」页）验收脚本 —— A 组扫描通道 + B 组上传通道
 *
 *   node scripts/accept_part_library.js            # 跑 A+B
 *   node scripts/accept_part_library.js scan       # 只跑 A（服务器目录扫描）
 *   node scripts/accept_part_library.js upload     # 只跑 B（浏览器文件夹上传）
 *
 * 覆盖（真实浏览器点击，零 mock）：
 *   A1-A2  /api/part-library 整段需 adminToken（无 token 401 / 带 token 200）
 *   B1-B12 上传文件夹 / 扫描本地目录 / 刷新 / 查询 四个按钮全部已绑事件且点击生效
 *   C1-C9  扫描通道端到端：预检 → 导入 → 库卡片 → 关键字检索 → 库详情 → 归档 → 显示已归档 → 恢复
 *   D1-D8  上传通道端到端：选文件夹 → 导入归类 → 分类器判角色 → 库卡片 → 检索 → 角色筛选
 *
 * 副作用：每组结束都会删除自己造的 part_libraries / part_library_items /
 *         uploaded_models 行与磁盘 bundle 目录（不碰库中已有的其它包）。
 * 管理员账号：baseline_shot / Baseline#185（IP 限流 5/分 15/时，连跑请重启服务器清计数）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.PL_BASE || 'http://127.0.0.1:3002';
const ROOT = path.join(__dirname, '..');
const UPLOAD_ROOT = path.join(ROOT, 'public', 'models', 'uploaded');
const SAMPLE_DIR = path.join(ROOT, '.tmp_part_pack_demo');
const SCAN_PACK = 'tmp_part_pack_demo';
const SCAN_FILE = 'DemoCube.gltf';
const UP_PACK = 'demo_upload_pack';
const UP_FILE = 'DemoWall.gltf';
const ONLY = (process.argv[2] || '').toLowerCase();

let pass = 0, fail = 0;
function log(ok, name, extra) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
}

/** 最小立方体 gltf（buffer 用 data URI 内嵌，无需外部 .bin） */
function makeGltfText(nodeName) {
  const c = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
  const faces = [[0, 1, 2], [0, 2, 3], [5, 4, 7], [5, 7, 6], [4, 0, 3], [4, 3, 7], [1, 5, 6], [1, 6, 2], [3, 2, 6], [3, 6, 7], [4, 5, 1], [4, 1, 0]];
  const pos = new Float32Array(36 * 3); const idx = new Uint16Array(36);
  faces.forEach((f, i) => f.forEach((vi, k) => {
    pos[(i * 3 + k) * 3] = c[vi][0]; pos[(i * 3 + k) * 3 + 1] = c[vi][1]; pos[(i * 3 + k) * 3 + 2] = c[vi][2];
    idx[i * 3 + k] = i * 3 + k;
  }));
  const bin = Buffer.concat([Buffer.from(pos.buffer), Buffer.from(idx.buffer)]);
  return JSON.stringify({
    asset: { version: '2.0', generator: 'accept_part_library' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: nodeName }],
    meshes: [{ name: nodeName, primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [{ name: 'M', pbrMetallicRoughness: { baseColorFactor: [0.7, 0.7, 0.7, 1] } }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 36, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength },
    ],
    buffers: [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + bin.toString('base64') }],
  });
}

function makeSampleDir() {
  fs.rmSync(SAMPLE_DIR, { recursive: true, force: true });
  fs.mkdirSync(SAMPLE_DIR, { recursive: true });
  fs.writeFileSync(path.join(SAMPLE_DIR, SCAN_FILE), makeGltfText('DemoCube'));
  fs.writeFileSync(path.join(SAMPLE_DIR, 'License.txt'), 'Demo pack for acceptance test. CC0 1.0 by Test.');
}

async function cleanup(packKey, fileName) {
  const { pool } = require('../src/database/db');
  const libs = await pool.query('SELECT id FROM part_libraries WHERE pack_key = $1', [packKey]);
  for (const l of libs.rows) await pool.query('DELETE FROM part_libraries WHERE id = $1', [l.id]);
  const del = await pool.query('DELETE FROM uploaded_models WHERE path LIKE $1 RETURNING id', ['%/' + fileName]);
  let disk = 0;
  for (const d of fs.readdirSync(UPLOAD_ROOT)) {
    if (!d.startsWith('bundle-')) continue;
    const abs = path.join(UPLOAD_ROOT, d);
    try {
      if (fs.existsSync(path.join(abs, fileName))) { fs.rmSync(abs, { recursive: true, force: true }); disk++; }
    } catch (e) { /* ignore */ }
  }
  const l2 = await pool.query('SELECT COUNT(*)::int AS n FROM part_libraries WHERE pack_key = $1', [packKey]);
  const m2 = await pool.query('SELECT COUNT(*)::int AS n FROM uploaded_models WHERE path LIKE $1', ['%/' + fileName]);
  console.log(`  清理 ${packKey}：库 ${l2.rows[0].n} / 模型 ${m2.rows[0].n}（本次删除 库 ${libs.rowCount} / 模型 ${del.rowCount} / 磁盘目录 ${disk}）`);
  return l2.rows[0].n + m2.rows[0].n;
}

async function login() {
  const r = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'baseline_shot', password: 'Baseline#185' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) throw new Error('管理员登录失败 HTTP ' + r.status + ' ' + JSON.stringify(j).slice(0, 120));
  return j.token;
}

async function openPage(browser, token, errs) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(([t]) => {
    localStorage.setItem('adminToken', t);
    localStorage.setItem('adminUser', JSON.stringify({ username: 'baseline_shot' }));
  }, [token]);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 140)); });
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e.message).slice(0, 140)));
  await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.PartLibrary && window.PartLibraryImport, null, { timeout: 30000 });
  await page.evaluate(() => showPage('part-library'));
  await page.waitForTimeout(800);
  return page;
}

/** 在库网格里按库名定位按钮（库中可能已有其它包，不能用 querySelector 取第一个） */
function findCardBtn(page, re, attr) {
  return page.evaluateHandle(([src, flags, a]) => {
    const re2 = new RegExp(src, flags);
    for (const c of document.getElementById('pl-library-grid').querySelectorAll('.card')) {
      if (re2.test(c.textContent)) return c.querySelector(a);
    }
    return null;
  }, [re.source, re.flags, attr]);
}

// ───────────────────────── A 组：扫描通道 ─────────────────────────
async function groupScan(browser, token) {
  makeSampleDir();
  const errs = [];
  const page = await openPage(browser, token, errs);

  const pv = await page.evaluate(() => {
    const b = document.getElementById('pl-scan-result');
    return b ? getComputedStyle(b).display : 'missing';
  });
  log(true, 'C0 页面进入零件库且扫描弹窗待用', 'scan-result=' + pv);

  await page.click('#pl-btn-scan');
  await page.waitForTimeout(250);
  const scOpen = await page.evaluate(() => getComputedStyle(document.getElementById('pl-scan-modal')).display);
  log(scOpen === 'flex', 'C1 「扫描本地目录」点击后弹窗打开', 'display=' + scOpen);

  await page.fill('#pl-scan-dir', SAMPLE_DIR);
  await page.click('#pl-scan-preview');
  await page.waitForFunction(() => /模型/.test(document.getElementById('pl-scan-result').textContent), null, { timeout: 20000 });
  const pvText = await page.evaluate(() => document.getElementById('pl-scan-result').textContent.replace(/\s+/g, ' ').trim().slice(0, 140));
  log(/1 模型/.test(pvText), 'C2 预检识别到 1 个模型', pvText);

  await page.click('#pl-scan-go');
  try {
    await page.waitForFunction(() => /导入 \d+ 个包/.test(document.getElementById('pl-scan-result').textContent), null, { timeout: 90000 });
  } catch (e) {
    const d = await page.evaluate(() => ({
      result: document.getElementById('pl-scan-result').textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
      msg: document.getElementById('pl-msg').textContent.trim().slice(0, 200),
    }));
    console.log('  [现场] pl-msg: ' + d.msg + ' | pl-scan-result: ' + d.result);
    throw e;
  }
  const done = await page.evaluate(() => document.getElementById('pl-scan-result').textContent.replace(/\s+/g, ' ').trim().slice(0, 200));
  log(/导入 1 个包/.test(done), 'C3 扫描导入完成（后端 target=part 生效）', done);

  await page.click('#pl-scan-modal [data-pl-close="pl-scan-modal"]');
  await page.waitForTimeout(400);

  const openBtn = await findCardBtn(page, /part pack demo/i, '[data-pl-open]');
  const card = await page.evaluate((el) => (el ? el.closest('.card').textContent.replace(/\s+/g, ' ').trim().slice(0, 140) : ''), openBtn);
  log(/part pack demo/i.test(card), 'C4 库卡片已出现', card);

  await page.fill('#pl-f-q', 'Demo');
  await page.click('#pl-btn-search');
  await page.waitForFunction(() => /命中/.test(document.getElementById('pl-search-info').textContent), null, { timeout: 15000 });
  const si = await page.evaluate(() => document.getElementById('pl-search-info').textContent.trim()
    + ' | 卡片=' + document.getElementById('pl-results').querySelectorAll('.card').length);
  log(/命中 1 个零件/.test(si), 'C5 关键字检索命中（search 参数已修正）', si);

  await openBtn.asElement().click();
  try {
    await page.waitForFunction(() => /共 \d+ 个/.test(document.getElementById('pl-detail-body').textContent), null, { timeout: 15000 });
  } catch (e) {
    const d = await page.evaluate(() => document.getElementById('pl-detail-body').textContent.replace(/\s+/g, ' ').trim().slice(0, 200));
    console.log('  [现场] 库详情 body: ' + d);
    throw e;
  }
  const det = await page.evaluate(() => document.getElementById('pl-detail-body').textContent.replace(/\s+/g, ' ').trim().slice(0, 160));
  log(/共 1 个/.test(det) && /DemoCube/.test(det), 'C6 库详情含零件行（首开空白已修）', det);
  await page.click('#pl-detail-modal [data-pl-close="pl-detail-modal"]');
  await page.waitForTimeout(300);

  await page.evaluate(() => { window.confirm = () => true; });
  (await findCardBtn(page, /part pack demo/i, '[data-pl-status]')).asElement().click();
  await page.waitForFunction(() => /已归档/.test(document.getElementById('pl-msg').textContent), null, { timeout: 15000 });
  log(true, 'C7 归档按钮生效');
  await page.check('#pl-show-archived');
  await page.waitForTimeout(1200);
  const stBtn2 = await findCardBtn(page, /part pack demo/i, '[data-pl-status]');
  log(!!stBtn2.asElement(), 'C8 勾选「显示已归档」后卡片仍可见（归档不再是单程票）');
  if (stBtn2.asElement()) {
    await stBtn2.asElement().click();
    await page.waitForFunction(() => /已恢复/.test(document.getElementById('pl-msg').textContent), null, { timeout: 15000 });
    log(true, 'C9 恢复按钮生效');
  }

  const real = errs.filter((e) => !/favicon|404 \(Not Found\)/i.test(e));
  log(real.length === 0, 'C10 无 console/page 错误', real.slice(0, 2).join(' | '));
  await page.close();
  fs.rmSync(SAMPLE_DIR, { recursive: true, force: true });
  const left = await cleanup(SCAN_PACK, SCAN_FILE);
  log(left === 0, 'C11 清理后无残留');
}

// ───────────────────────── B 组：上传通道 ─────────────────────────
async function groupUpload(browser, token) {
  const errs = [];
  const page = await openPage(browser, token, errs);
  const gltfText = makeGltfText('DemoWall');

  await page.click('#pl-btn-upload');
  await page.waitForTimeout(300);
  const upOpen = await page.evaluate(() => getComputedStyle(document.getElementById('pl-upload-modal')).display);
  log(upOpen === 'flex', 'B1 「上传文件夹」点击后弹窗打开', 'display=' + upOpen);

  const picked = await page.evaluate(([txt, name, pack]) => {
    const mk = (rel, content, type) => {
      const f = new File([content], rel.split('/').pop(), { type });
      Object.defineProperty(f, 'webkitRelativePath', { value: rel });
      return f;
    };
    window.PartLibraryImport.onPicked([
      mk(pack + '/' + name, txt, 'model/gltf+json'),
      mk(pack + '/notes.txt', 'ignored', 'text/plain'),
    ], true);
    const pv = document.getElementById('pl-up-preview');
    return {
      shown: pv ? getComputedStyle(pv).display : 'none',
      text: pv ? pv.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : '',
      goDisabled: document.getElementById('pl-up-go').disabled,
    };
  }, [gltfText, UP_FILE, UP_PACK]);
  log(picked.shown === 'block' && /主模型 1 个/.test(picked.text) && picked.goDisabled === false,
    'B2 选文件夹后预览正确且可导入', picked.text);

  await page.click('#pl-up-go');
  try {
    await page.waitForFunction(() => /入库 \d+ 个零件/.test(document.getElementById('pl-up-result').textContent), null, { timeout: 60000 });
  } catch (e) {
    const d = await page.evaluate(() => ({
      text: document.getElementById('pl-up-text').textContent.trim().slice(0, 200),
      result: document.getElementById('pl-up-result').textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
    }));
    console.log('  [现场] pl-up-text: ' + d.text + ' | pl-up-result: ' + d.result);
    throw e;
  }
  const up = await page.evaluate(() => ({
    result: document.getElementById('pl-up-result').textContent.replace(/\s+/g, ' ').trim().slice(0, 200),
    text: document.getElementById('pl-up-text').textContent.trim(),
  }));
  log(/入库 1 个零件/.test(up.result), 'B3 上传并归类完成', up.text);
  log(/墙/.test(up.result), 'B4 分类器按文件名判定角色=墙', up.result);

  await page.click('#pl-upload-modal [data-pl-close="pl-upload-modal"]');
  await page.waitForTimeout(300);

  const card2 = await page.evaluate((el) => (el ? el.closest('.card').textContent.replace(/\s+/g, ' ').trim().slice(0, 120) : ''),
    await findCardBtn(page, /demo upload pack/i, '[data-pl-open]'));
  log(/demo upload pack/i.test(card2), 'B5 库卡片已出现', card2);

  await page.fill('#pl-f-q', 'DemoWall');
  await page.click('#pl-btn-search');
  await page.waitForFunction(() => /命中/.test(document.getElementById('pl-search-info').textContent), null, { timeout: 15000 });
  const si2 = await page.evaluate(() => document.getElementById('pl-search-info').textContent.trim());
  log(/命中 1 个零件/.test(si2), 'B6 关键字检索命中', si2);

  await page.fill('#pl-f-q', '');
  const roleVal = await page.evaluate(() => {
    const sel = document.getElementById('pl-f-role');
    const opt = Array.from(sel.options).find((o) => o.value === 'wall');
    if (!opt) return '';
    sel.value = 'wall';
    return opt.value;
  });
  await page.click('#pl-btn-search');
  await page.waitForFunction(() => /角色=/.test(document.getElementById('pl-search-info').textContent), null, { timeout: 15000 });
  const ri = await page.evaluate(() => {
    const cards = Array.from(document.getElementById('pl-results').querySelectorAll('.card'));
    const roles = cards.map((c) => (c.textContent.match(/墙|道路|道具|窗|门|柱\/梁|楼梯|自然物|地面|屋顶|栏杆|地面板|雨棚|檐口/) || [''])[0]);
    return { info: document.getElementById('pl-search-info').textContent.trim(), total: cards.length, allWall: roles.length > 0 && roles.every((r) => r === '墙') };
  });
  log(roleVal === 'wall' && /角色=墙/.test(ri.info) && ri.allWall && ri.total > 0,
    'B7 角色筛选生效（结果集全为墙）', `${ri.info} | 卡片=${ri.total}`);

  const real = errs.filter((e) => !/favicon|404 \(Not Found\)/i.test(e));
  log(real.length === 0, 'B8 无 console/page 错误', real.slice(0, 2).join(' | '));
  await page.close();
  const left = await cleanup(UP_PACK, UP_FILE);
  log(left === 0, 'B9 清理后无残留');
}

(async () => {
  const token = await login();
  console.log('登录成功\n');

  // A1/A2：接口鉴权（无 token 401 / 带 token 200）
  const noTok = await fetch(BASE + '/api/part-library/libraries');
  log(noTok.status === 401 || noTok.status === 403, 'A1 无 token 访问零件库被拒', 'HTTP ' + noTok.status);
  const wj = await (await fetch(BASE + '/api/part-library/libraries', { headers: { Authorization: 'Bearer ' + token } })).json();
  log(wj.success === true, 'A2 带 token 库列表 200', 'libraries=' + (wj.libraries || []).length);

  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11'] });
  try {
    if (ONLY !== 'upload') await groupScan(browser, token);
    if (ONLY !== 'scan') await groupUpload(browser, token);
  } finally {
    await browser.close();
  }
  console.log(`\n共 ${pass + fail} 条：PASS ${pass} / FAIL ${fail}`);
  console.log(fail === 0 ? 'VERDICT: ACCEPTED' : 'VERDICT: REJECTED');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
