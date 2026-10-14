'use strict';
/** LDraw 批量转换：playwright 驱动 three LDrawLoader（权威语义）逐件出 GLB */
const path = require('path');
process.chdir(path.join(__dirname, '..'));
require('dotenv').config();
const fs = require('fs');
const { chromium } = require('playwright');

(async function () {
  const manifest = JSON.parse(fs.readFileSync('scripts/ldraw_parts_manifest.json', 'utf8'));
  const outDir = 'public/models/builtin/ldraw';
  fs.mkdirSync(outDir, { recursive: true });
  const b = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11'] });
  const p = await b.newPage();
  p.on('pageerror', (e) => console.log('[pageerror] ' + String(e).slice(0, 120)));
  await p.goto('http://localhost:3002/ldraw_convert.html', { waitUntil: 'commit' });
  try {
    await p.waitForFunction('window.__ready===true', { timeout: 30000 });
  } catch (e) {
    console.log('页面初始化失败: ' + await p.evaluate('window.__err'));
    process.exit(1);
  }
  let ok = 0, fail = 0;
  const t0 = Date.now();
  for (let i = 0; i < manifest.items.length; i++) {
    const it = manifest.items[i];
    const name = it.part.replace(/\.dat$/i, '');
    try {
      const b64 = await p.evaluate(async (pf) => await window.__conv(pf), it.part);
      fs.writeFileSync(path.join(outDir, name + '.glb'), Buffer.from(b64, 'base64'));
      ok++;
      if (ok % 20 === 0) console.log('  ' + ok + '/' + manifest.items.length + ' (' + Math.round((Date.now() - t0) / 1000) + 's)');
    } catch (e) {
      fail++;
      console.log('  FAIL ' + name + ': ' + String(e && e.message || e).slice(0, 100));
    }
  }
  console.log('完成: ok=' + ok + ' fail=' + fail + ' ' + Math.round((Date.now() - t0) / 1000) + 's');
  await b.close(); process.exit(0);
})();