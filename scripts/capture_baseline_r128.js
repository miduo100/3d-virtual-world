/**
 * r185 升级视觉基线截图器（会话 2 / 阶段 0.5）
 * ------------------------------------------------------------------
 * 用途：在当前 THREE 版本下为主世界 + 6 编辑器页 + admin 后台拍摄
 *       统一口径（1600x900, DPR=1, headless swiftshader WebGL）截图，
 *       作为阶段 4 像素对比（PSNR）的基线；升级后重跑同一脚本拍对照组。
 *
 * 用法：
 *   node scripts/capture_baseline_r128.js            -> Screenshot/baseline_r128/
 *   node scripts/capture_baseline_r128.js r185       -> Screenshot/baseline_r185/
 *
 * 说明：
 *  - test_gaussian.html 跳过：全项目无 .ply 样本，页面必然空载（阶段 5 再实测 3DGS）。
 *  - 登录态：使用专用截图管理员 baseline_shot / Baseline#185（adminToken 注入 localStorage）。
 *  - 等待时长为固定值，保证基线组与对照组完全同口径。
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';
const TAG = process.argv[2] || 'r128';
const OUT_DIR = path.join(__dirname, '..', 'Screenshot', 'baseline_' + TAG);

// 固定等待（毫秒）——两组截图必须一致
const WAIT_EDITORS = 9000;
const WAIT_ADMIN = 15000;
const WAIT_WORLD = 28000;
const WAIT_AFTER_DRAG = 3500;

const EDITOR_PAGES = [
  'world_editor.html',
  'unified_editor.html',
  'character_editor.html',
  'animation_puppeteer.html',
  'ai_scene_generator.html',
  'ai_motion_factory.html',
];

function log(msg) { console.log('[baseline] ' + msg); }

async function fetchAdminToken() {
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  });
  const data = await res.json();
  if (!res.ok || !data.token) throw new Error('admin login failed: ' + JSON.stringify(data));
  return data;
}

async function injectAdminStorage(context, loginData) {
  // 同 origin 任意页面打开后注入 localStorage（编辑器守卫只查 adminToken 存在性）
  const p = await context.newPage();
  await p.goto(BASE + '/admin_login.html', { waitUntil: 'domcontentloaded' });
  await p.evaluate((d) => {
    localStorage.setItem('adminToken', d.token);
    localStorage.setItem('adminUser', JSON.stringify(d.adminUser || { username: 'baseline_shot' }));
  }, loginData);
  await p.close();
  log('admin localStorage injected');
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, name + '.png');
  await page.screenshot({ path: file });
  log('saved ' + name + '.png');
}

async function captureEditors(context) {
  for (const html of EDITOR_PAGES) {
    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    try {
      await page.goto(BASE + '/' + html, { waitUntil: 'load', timeout: 30000 });
      await page.waitForTimeout(WAIT_EDITORS);
      await shot(page, html.replace('.html', ''));
    } catch (e) {
      log('ERROR ' + html + ': ' + e.message);
    } finally {
      await page.close();
    }
  }
}

async function captureAdmin(context) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  try {
    await page.goto(BASE + '/admin.html', { waitUntil: 'load', timeout: 40000 });
    await page.waitForTimeout(WAIT_ADMIN);
    await shot(page, 'admin_dashboard');
  } catch (e) {
    log('ERROR admin.html: ' + e.message);
  } finally {
    await page.close();
  }
}

async function captureWorld(context) {
  const page = await context.newPage();
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  try {
    await page.goto(BASE + '/', { waitUntil: 'load', timeout: 40000 });
    await page.waitForSelector('#canvas', { timeout: 15000 });
    await page.waitForTimeout(WAIT_WORLD);
    await shot(page, 'world_cam1_default');

    // 机位2：水平拖拽旋转视角（不点击，避免 pointer-lock / 移动）
    await page.mouse.move(800, 450);
    await page.mouse.down();
    await page.mouse.move(1250, 450, { steps: 25 });
    await page.mouse.up();
    await page.waitForTimeout(WAIT_AFTER_DRAG);
    await shot(page, 'world_cam2_yaw');

    // 机位3：再转 + 带俯仰
    await page.mouse.move(800, 450);
    await page.mouse.down();
    await page.mouse.move(400, 300, { steps: 25 });
    await page.mouse.up();
    await page.waitForTimeout(WAIT_AFTER_DRAG);
    await shot(page, 'world_cam3_yaw_pitch');

    log('world console errors captured: ' + errors.length);
    errors.slice(0, 10).forEach((t) => log('  console.error: ' + t));
  } catch (e) {
    log('ERROR world: ' + e.message);
  } finally {
    await page.close();
  }
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log('output dir: ' + OUT_DIR);

  const loginData = await fetchAdminToken();
  log('admin token acquired (len=' + loginData.token.length + ')');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--enable-unsafe-swiftshader', // 软件 WebGL（headless 像素口径统一）
      '--disable-gpu',
      '--hide-scrollbars',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
  });

  try {
    await injectAdminStorage(context, loginData);
    await captureEditors(context);
    await captureAdmin(context);
    await captureWorld(context);
  } finally {
    await browser.close();
  }

  const files = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.png'));
  log('DONE. total screenshots: ' + files.length);
})().catch((e) => { console.error('[baseline] FATAL', e); process.exit(1); });
