/**
 * accept_lod_stage8_farbox_leak.js —— 「深蓝占位方块永不回收」修复验收（2026-09-24）
 *
 * 背景（用户实测）：红军集群 X:-256.2 Z:-1130.8 处，612 个实例【全部在渲染】（高2/中17/低593），
 *   但场上仍有 364 个深蓝占位方块（0x0066ff）盖在士兵身上、采样 2 分钟不回收。
 * 根因：worldLodStandalone.onModelShown（模型上屏钩子）在【合批之后】才回调，给"已由合批组
 *   实例化渲染"的模型挂 __lodCandidatePending；该标记唯一清理点是 worldInstanceMerger 的
 *   mergeGroup（组创建/重建时），而 scanAndMerge 对"id 集合无变化"的组直接 return 不重建
 *   → 标记永生 → syncFarBoxes 第 1 段每帧为已渲染的实例重复画方块。
 *
 * 判据：
 *   F1 红军实例加载 + 合批组成立
 *   F2 稳态：合批组三带渲染数 == 实例总数（没有被"方块化"顶掉）
 *   F3 稳态：__lodCandidatePending == 0                ← 修复目标
 *   F4 稳态：farBox 实例数 == 0（本场景无超界、无变体加载中） ← 修复目标
 *   F5a 人为延迟 _lod.glb 20s：变体"加载中"期间必须出现合法占位方块（pendingIdx>0 且 farBox>0）
 *   F5b 变体到达后：pending 归 0、方块回收、三带恢复渲染（合法路径未被误杀）
 *   F6 0 pageerror / 0 console error（两轮页面）
 *
 * 用法：node scripts/accept_lod_stage8_farbox_leak.js [BASE]
 *   BASE 默认 http://localhost:3002（可传 https://miduo100.com 打线上）
 *   可用 LOD_TEST_URL_RE 覆盖目标模型族正则（默认 model-1787128 = 红军）
 */
const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.LOD_TEST_BASE || 'http://localhost:3002';
const POS = { x: -256.2, y: 3, z: -1130.8 };
const URL_RE = process.env.LOD_TEST_URL_RE ? new RegExp(process.env.LOD_TEST_URL_RE, 'i') : /model-1787128/i;

const R = [];
function check(name, ok, detail) {
  R.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '   [' + detail + ']' : ''}`);
}

const SAMPLER = (arg) => {
  const { pos, re } = arg;
  const W = window.gameWorld;
  const rx = new RegExp(re, 'i');
  const out = { loaded: 0, groups: 0, instances: 0, rendered: 0, pending: 0, candidatePending: 0, otherFlags: {}, farBox: null };
  if (!W || !W.generatedBuildings) return out;
  W.generatedBuildings.forEach((e) => {
    if (!e || !e.model || e.isPlaceholder) return;
    const ud = e.model.userData || {};
    if (ud.__texOptSource && rx.test(ud.__texOptSource)) out.loaded++;
    if (ud.__lodCandidatePending) out.candidatePending++;
    if (ud.__lodPending) out.otherFlags.lodPending = (out.otherFlags.lodPending || 0) + 1;
    if (ud.__culledByDist) out.otherFlags.culled = (out.otherFlags.culled || 0) + 1;
  });
  if (window.WorldInstanceMerger && window.WorldInstanceMerger.debugLod) {
    window.WorldInstanceMerger.debugLod().groups.forEach((g) => {
      if (!rx.test(g.url)) return;
      out.groups++;
      out.instances += g.instances;
      out.rendered += (g.counts.high || 0) + (g.counts.mid || 0) + (g.counts.low || 0) + (g.counts.unknown || 0);
      out.pending += g.pending || 0;
    });
  }
  let fb = null;
  W.scene.traverse((o) => { if (o.isInstancedMesh && o.material && o.material.color && o.material.color.getHex() === 0x0066ff) fb = o; });
  if (fb) {
    const m = new (window.THREE.Matrix4)(); const v = new (window.THREE.Vector3)();
    let nearest = Infinity;
    for (let i = 0; i < fb.count; i++) {
      fb.getMatrixAt(i, m); v.setFromMatrixPosition(m);
      const d = Math.hypot(v.x - pos.x, v.z - pos.z);
      if (d < nearest) nearest = d;
    }
    out.farBox = { count: fb.count, nearest: fb.count ? +nearest.toFixed(1) : null };
  }
  return out;
};

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });

  console.log('打开 ' + BASE);
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.gameWorld && window.player, null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });
  await page.evaluate((p) => { window.player.position.set(p.x, p.y, p.z); }, POS);

  const sample = (pos) => page.evaluate(SAMPLER, { pos: pos || POS, re: URL_RE.source });

  let s = null, waited = 0;
  while (waited < 150000) {
    await page.waitForTimeout(5000); waited += 5000;
    s = await sample();
    if (s.groups >= 15 && s.loaded >= 500) break;
  }
  console.log('加载阶段：目标实例已加载=' + s.loaded + ' 合批组=' + s.groups + '（' + waited / 1000 + 's）');

  await page.waitForTimeout(8000);
  const steady1 = await sample();
  await page.waitForTimeout(8000);
  const steady2 = await sample();
  console.log('稳态① ' + JSON.stringify(steady1));
  console.log('稳态② ' + JSON.stringify(steady2));

  check('F1 目标实例加载 + 合批组成立', steady2.loaded >= 500 && steady2.groups >= 15,
    'loaded=' + steady2.loaded + ' groups=' + steady2.groups);
  check('F2 三带渲染数 == 合批实例总数（未被方块化顶掉）',
    steady2.rendered === steady2.instances && steady2.instances > 0,
    'rendered=' + steady2.rendered + '/' + steady2.instances + ' pending=' + steady2.pending);
  check('F3 稳态 __lodCandidatePending == 0（修复目标）', steady2.candidatePending === 0,
    '①=' + steady1.candidatePending + ' ②=' + steady2.candidatePending);
  check('F4 稳态 farBox == 0（修复目标）',
    (!steady2.farBox || steady2.farBox.count === 0),
    '①=' + JSON.stringify(steady1.farBox) + ' ②=' + JSON.stringify(steady2.farBox) +
    ' 其他标记=' + JSON.stringify(steady2.otherFlags));

  // F5 合法方块路径回归：人为把 _lod.glb 延迟 20s → 变体"加载中"期间必须出现占位方块；
  //    变体到达后方块必须被回收（这是 __lodCandidatePending 之外唯一的合法方块来源）
  const page2 = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const errs2 = [];
  page2.on('pageerror', (e) => errs2.push('PAGEERROR ' + e.message));
  page2.on('console', (m) => { if (m.type() === 'error') errs2.push(m.text()); });
  let delayed = 0;
  await page2.route('**/*_lod.glb', async (route) => {
    // 只延迟 GET（下载本体）；HEAD 是存在性探测，一并延迟会让每个变体多等一倍时间
    if (route.request().method() !== 'GET') { try { await route.continue(); } catch (e) { } return; }
    delayed++;
    await new Promise((r) => setTimeout(r, 20000));
    try { await route.continue(); } catch (e) { /* 页面已关闭 */ }
  });
  await page2.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page2.waitForFunction(() => window.gameWorld && window.player, null, { timeout: 120000 });
  await page2.waitForTimeout(3000);
  await page2.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); });
  await page2.evaluate((p) => { window.player.position.set(p.x, p.y, p.z); }, POS);
  await page2.waitForTimeout(12000);                      // 仍在 20s 延迟窗口内
  const s2 = await page2.evaluate(SAMPLER, { pos: POS, re: URL_RE.source });
  check('F5a 变体延迟期间：出现合法占位方块 + pendingIdx>0（方块路径未被误杀）',
    s2.pending > 0 && !!s2.farBox && s2.farBox.count > 0,
    'pending=' + s2.pending + ' farBox=' + JSON.stringify(s2.farBox) + ' 延迟请求=' + delayed);
  await page2.waitForTimeout(25000);                      // 等变体真正到达
  const s3 = await page2.evaluate(SAMPLER, { pos: POS, re: URL_RE.source });
  check('F5b 变体到达后：pending 归 0、方块回收、三带恢复渲染',
    s2.pending > 0 && s3.pending === 0 && (!s3.farBox || s3.farBox.count === 0) &&
    s3.rendered === s3.instances && s3.instances > 0,
    'pending=' + s3.pending + ' farBox=' + JSON.stringify(s3.farBox) + ' rendered=' + s3.rendered + '/' + s3.instances);
  await page2.close();

  const realErrs = errs.filter((t) => !/favicon/i.test(t) && !/Failed to load resource/.test(t))
    .concat(errs2.filter((t) => !/favicon/i.test(t) && !/Failed to load resource/.test(t)));
  check('F6 0 pageerror / 0 console error（两轮页面）', realErrs.length === 0, realErrs.slice(0, 3).join(' | '));

  const pass = R.filter((r) => r.ok).length;
  console.log('\n===== ' + pass + '/' + R.length + ' =====');
  console.log(pass === R.length ? 'VERDICT: ACCEPTED' : 'VERDICT: FAILED');
  await browser.close();
  process.exit(pass === R.length ? 0 : 1);
})();
