/**
 * UI 冒烟：admin.html「📁 文件夹导入」自注入模块
 *   U1 按钮注入到「上传模型」旁
 *   U2 弹窗打开、元素齐全
 *   U3 onPicked 预览渲染 + 上传按钮解禁
 *   U4 zip 分支预览
 *   U5 0 pageerror / 0 console error
 * 运行：node scripts/accept_model_bundle_ui.js
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3002';
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message.slice(0, 120)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location() && m.location().url) || '';
    if (/favicon|runtime\.lastError|index\.global\.js/.test(url) || /favicon|runtime\.lastError|index\.global\.js/.test(m.text())) return;
    consoleErrors.push(`[${url.split('/').pop() || 'inline'}] ` + m.text().slice(0, 120));
  });

  try {
    // 登录管理员并注入登录态
    const lr = await fetch(BASE + '/api/admin-auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'baseline_shot', password: 'Baseline#185' }),
    });
    const lj = await lr.json();
    check('P0 管理员登录', lr.ok && (lj.token || lj.adminToken), lr.ok ? '' : JSON.stringify(lj).slice(0, 120));
    const token = lj.token || lj.adminToken;
    await page.addInitScript(([t]) => {
      localStorage.setItem('adminToken', t);
      localStorage.setItem('adminUser', JSON.stringify({ username: 'baseline_shot' }));
    }, [token]);

    await page.goto(BASE + '/admin.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    // 先进入 3D资产 → 上传模型 子页签（按钮在页签内，页签隐藏时不可见）
    await page.evaluate(() => {
      window.showPage('assets');
      const btns = document.querySelectorAll('#page-assets .sub-tab');
      for (const b of btns) if (b.getAttribute('onclick') && b.getAttribute('onclick').includes("'uploaded'")) b.click();
    });
    await page.waitForTimeout(500);

    // U1 按钮注入
    const btn = page.locator('#amb-open-btn');
    check('U1 「📁 文件夹导入」按钮注入且可见', await btn.count() === 1 && await btn.isVisible());

    // U2 弹窗
    await btn.click();
    await page.waitForTimeout(300);
    check('U2 弹窗打开', await page.locator('#amb-modal').isVisible());
    for (const id of ['amb-pick-folder', 'amb-pick-zip', 'amb-file-folder', 'amb-preview', 'amb-progress', 'amb-upload']) {
      check(`U2.x 元素存在 #${id}`, await page.locator('#' + id).count() === 1);
    }
    check('U2.y webkitdirectory 已启用', await page.locator('#amb-file-folder').getAttribute('webkitdirectory') !== null);

    // U3 onPicked 预览（文件夹模式，模拟 3 个文件）
    await page.evaluate(() => {
      const mk = (name, size) => new File([new Uint8Array(size)], name);
      window.AdminModelBundle.onPicked([mk('Tree_1.gltf', 2100), mk('Tree_1.bin', 491576), mk('Bark_NormalTree.png', 4446091)], true);
    });
    await page.waitForTimeout(200);
    const previewText = await page.locator('#amb-preview').innerText();
    check('U3 预览渲染（文件数/构成）', previewText.includes('3 个文件') && previewText.includes('.gltf×1') && previewText.includes('Tree_1.gltf'),
      previewText.split('\n')[0].slice(0, 60));
    check('U3.x 上传按钮解禁', await page.locator('#amb-upload').isEnabled());

    // U4 zip 分支预览
    await page.evaluate(() => {
      window.AdminModelBundle.onPicked([new File([new Uint8Array(1024)], 'models.zip')], false);
    });
    await page.waitForTimeout(200);
    check('U4 zip 分支预览', (await page.locator('#amb-preview').innerText()).includes('models.zip'));

    // U5 console
    check('U5 无 pageerror / console error', consoleErrors.length === 0,
      consoleErrors.length ? consoleErrors.join(' | ').slice(0, 200) : '');

    await page.evaluate(() => window.AdminModelBundle.close());
  } finally {
    await browser.close();
  }

  console.log(`\n======== UI 冒烟: ${pass} PASS / ${fail} FAIL ========`);
  if (failures.length) console.log('失败项: ' + failures.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
