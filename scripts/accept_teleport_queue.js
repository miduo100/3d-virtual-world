/**
 * 验证方案 A+B：传送后旧区域排队对象清理 / 队列满时踢远客 / 媒体通道独立
 * 只读验证，不修改任何数据。
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3002';
const USER = 'diag_tmp_1';
const PASS = 'Diag#2026tmp';

(async () => {
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  }).then(r => r.json());
  if (!login.token) throw new Error('login failed');

  const browser = await chromium.launch({ channel: 'chrome', headless: true }).catch(() =>
    chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] }));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });

  const p0 = await ctx.newPage();
  await p0.goto(BASE + '/index.html', { waitUntil: 'domcontentloaded' });
  await p0.evaluate((d) => {
    localStorage.setItem('token', d.token);
    localStorage.setItem('userId', String(d.userId));
    localStorage.setItem('characterId', String(d.characterId));
  }, login);
  await p0.close();

  const page = await ctx.newPage();
  page.on('console', (m) => {
    const t = m.text();
    if (/\[Queue\]/.test(t)) console.log('[console] ' + t.slice(0, 180));
  });

  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.gameWorld && window.gameWorld.renderer && window.player, null, { timeout: 180000 });
  await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });
  await page.waitForTimeout(6000); // 等初始加载安静

  const results = [];
  const check = (name, pass, detail) => { results.push({ name, pass }); console.log((pass ? 'PASS ' : 'FAIL ') + name + ' :: ' + detail); };

  // ---------- Test A: 真实传送 ----------
  // 1. 传到红军区 (41, -223)，让队列装满红军对象
  await page.evaluate(() => { window.player.position.set(41, 3, -223); });
  await page.waitForTimeout(10000);
  const st1 = await page.evaluate(() => {
    const gw = window.gameWorld;
    const ld = gw.loadDistance, px = window.player.position.x, pz = window.player.position.z;
    let inR = 0, out = 0;
    gw.loadingQueue.forEach(o => {
      const dx = px - (o.position_x || 0), dz = pz - (o.position_z || 0);
      (dx * dx + dz * dz < ld * ld) ? inR++ : out++;
    });
    return { qLen: gw.loadingQueue.length, inR, out, px, pz };
  });
  console.log('红军区排队状态:', JSON.stringify(st1));
  check('A1 红军区入队有对象', st1.qLen > 0, 'queue=' + st1.qLen);

  // 2. 传送到出生点区 (0, 0)，等几轮扫描
  await page.evaluate(() => { window.player.position.set(0, 3, 0); });
  await page.waitForTimeout(4000);
  const st2 = await page.evaluate(() => {
    const gw = window.gameWorld;
    const ld = gw.loadDistance, px = window.player.position.x, pz = window.player.position.z;
    let inR = 0, out = 0;
    gw.loadingQueue.forEach(o => {
      const dx = px - (o.position_x || 0), dz = pz - (o.position_z || 0);
      (dx * dx + dz * dz < ld * ld) ? inR++ : out++;
    });
    return { qLen: gw.loadingQueue.length, inR, out };
  });
  console.log('传送后排队状态:', JSON.stringify(st2));
  check('A2 传送后队列无旧区域残留', st2.out === 0, `out=${st2.out} inR=${st2.inR} qLen=${st2.qLen}`);
  check('A3 新区域对象能入队', st2.inR > 0, 'inR=' + st2.inR);

  // ---------- Test B: 合成填满（真实对象塞满队列，全部在加载半径外） ----------
  const st3 = await page.evaluate(() => {
    const gw = window.gameWorld;
    // 停掉正常入队干扰：把玩家挪到无对象区（远处高空）
    window.player.position.set(0, 500, 5000);
    gw.loadingQueue.length = 0;
    // 从 allWorldObjects 里挑红军区的真实对象塞满队列（全部距玩家极远）
    const far = gw.allWorldObjects.filter(o => {
      const dx = 41 - (o.position_x || 0), dz = -223 - (o.position_z || 0);
      return dx * dx + dz * dz < 400 * 400;
    });
    for (let i = 0; gw.loadingQueue.length < gw.maxLoadingQueueSize && i < 100000; i++) {
      gw.loadingQueue.push(far[i % far.length]);
    }
    return { filled: gw.loadingQueue.length, pool: far.length };
  });
  console.log('合成填满:', JSON.stringify(st3));
  check('B1 队列已塞满', st3.filled >= 200, 'qLen=' + st3.filled);

  // 等几轮扫描（B 清理应把全部出半径条目踢出）
  await page.waitForTimeout(4000);
  const st4 = await page.evaluate(() => window.gameWorld.loadingQueue.length);
  check('B2 队列满时踢出全部出半径条目', st4 === 0, '剩余=' + st4);

  // ---------- Test C: 媒体通道独立（主队列满时媒体仍按距离加载） ----------
  // 找一个 media 对象坐标（记忆：图片493(-4.5,10.9,14.9)、视频453(-49.2,9.4,64.2)）
  const st5 = await page.evaluate(() => {
    const gw = window.gameWorld;
    window.player.position.set(-4.5, 30, 14.9);
    gw.loadingQueue.length = 0;
    // 再塞满远对象
    const far = gw.allWorldObjects.filter(o => {
      const dx = 41 - (o.position_x || 0), dz = -223 - (o.position_z || 0);
      return dx * dx + dz * dz < 400 * 400;
    });
    for (let i = 0; gw.loadingQueue.length < gw.maxLoadingQueueSize && i < 100000; i++) {
      gw.loadingQueue.push(far[i % far.length]);
    }
    const media = gw.allWorldObjects.find(o => o.id === 493);
    return { filled: gw.loadingQueue.length, mediaFound: !!media, mediaLoaded: gw.loadedObjects.has(493) };
  });
  console.log('媒体测试准备:', JSON.stringify(st5));
  await page.waitForTimeout(6000);
  const st6 = await page.evaluate(() => {
    const gw = window.gameWorld;
    const e = gw.generatedBuildings.get(493);
    return { mediaLoaded: gw.loadedObjects.has(493), hasEntry: !!e, isPlaceholder: e ? !!e.isPlaceholder : null };
  });
  check('C1 主队列满时媒体仍加载(493图片)', st6.mediaLoaded === true, JSON.stringify(st6));

  const pass = results.filter(r => r.pass).length;
  console.log(`\n=== ${pass}/${results.length} PASS ===`);
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
