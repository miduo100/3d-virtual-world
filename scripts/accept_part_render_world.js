/**
 * ★ AL-3 关键判据：零件在世界内能否正确渲染贴图（非紫模 / 非白模）
 *
 * 这是 Phase 1 唯一的关键判据 —— 决定 2,336 个 Kenney 零件是「可用资产」
 * 还是「一堆加载不出来的文件」。
 *
 * 实测过的两个真 bug（本脚本的判据就是为拦住它们而设）：
 *   ① 扫描链：同一零件的 .obj 副本 part_key 相同 → ON CONFLICT 覆盖 .glb → 指向渲不出来的文件
 *   ② 加载链：gltfWorker / 主线程 parse 都传 resourcePath=''
 *            → 外置贴图相对 uri 解析到 worker 目录 → 404 → 材质无 map 变白模
 *
 * 判据（机器口径，比截图权威）：
 *   W1 对象已加载（非占位符）      W2 产生了 mesh
 *   W3 ★材质 map 已解码（ImageBitmap 有宽高）
 *   W4 ★按几何 UV 采样贴图取到非纯白色（排除「贴上了但整片白」）
 *   W5 无外置贴图 404 / 相关 console error
 *   W6 结束不残留测试对象
 *
 * 前置：3002 在跑；已导入零件（先跑 scripts/accept_asset_library_scan.js --keep
 *      或 --import-all）；素材源默认 H:\kenney\kenney_modular-buildings。
 * 用法：node scripts/accept_part_render_world.js
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const BASE = process.env.WORLD_AI_BASE || 'http://localhost:3002';
const ROOT = path.join(__dirname, '..');
const SHOT_DIR = path.join(ROOT, 'Screenshot');
const TEST_NAME = '__AL3_part_render';
const PACK = 'kenney_modular_buildings';

let pass = 0, fail = 0;
const log = (ok, name, extra) => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };

async function api(p, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const r = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch (e) { j = {}; }
  return { status: r.status, j };
}

(async () => {
  const login = await api('/api/admin-auth/login', { method: 'POST', body: { username: 'baseline_shot', password: 'Baseline#185' } });
  if (login.status !== 200) { console.log('LOGIN FAIL', login.status); process.exit(1); }
  const token = login.j.token;

  // 零件库必须已有该 kit
  const libs = await api('/api/part-library/libraries', { token });
  const lib = (libs.j.libraries || []).find(l => l.pack_key === PACK);
  if (!lib) { console.log(`零件库没有 ${PACK}，请先跑：node scripts/accept_asset_library_scan.js --keep`); process.exit(1); }
  const det = await api(`/api/part-library/libraries/${lib.id}`, { token });
  const parts = det.j.items || [];
  const part = parts.find(x => x.part_key === 'building_block') || parts[0];
  console.log(`测试零件：${part.part_key}  ${part.model_path}  tris=${part.tris}`);

  // 静态前置：GLB 与其外置贴图都要可达
  const gr = await fetch(BASE + part.model_path);
  const gbuf = Buffer.from(await gr.arrayBuffer());
  const jl = gbuf.readUInt32LE(12);
  const gj = JSON.parse(gbuf.slice(20, 20 + jl).toString('utf8'));
  const uri = (gj.images || [])[0] && gj.images[0].uri;
  const dir = part.model_path.slice(0, part.model_path.lastIndexOf('/') + 1);
  const tr = uri ? await fetch(new URL(uri, BASE + dir).toString()) : { status: 0 };
  log(gr.status === 200, 'W0a 零件 GLB 静态可达', 'HTTP ' + gr.status);
  log(tr.status === 200, 'W0b 外置贴图按相对 uri 可达', `${uri || '(内嵌)'} → HTTP ${tr.status}`);

  // 建对象（放在出生点旁，避开操作指南弹窗区域）
  const sp0 = await api('/api/world/spawn-point');
  const sp = (sp0.j.spawnPoint && sp0.j.spawnPoint.position) || { x: -26.32, y: 9.59, z: 12.56 };
  const PX = Number(sp.x) || -26.32, PY = Number(sp.y) || 9.59, PZ = Number(sp.z) || 12.56;
  const created = await api('/api/world/objects', {
    method: 'POST', token,
    body: {
      type: 'uploaded_model', name: TEST_NAME, model_path: part.model_path,
      position_x: PX + 4, position_y: PY, position_z: PZ - 4,
      rotation_x: 0, rotation_y: 0, rotation_z: 0,
      scale_x: 3, scale_y: 3, scale_z: 3, has_collision: false,
    },
  });
  const objId = created.j.id || (created.j.object && created.j.object.id) || (created.j.data && created.j.data.id);
  if (!objId) { console.log('CREATE FAIL', created.status, JSON.stringify(created.j).slice(0, 300)); process.exit(1); }
  log(true, 'W0c 测试对象已建立', 'id=' + objId);

  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--use-gl=angle'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  // ⚠ Chrome 的 "Failed to load resource: 404" 文本里**不含 URL**，必须按 m.location().url 分类，
  //   否则 favicon.ico 之类的噪音会误判成贴图失败（历史坑）。
  const consoleErrs = [], failed = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const loc = m.location() || {};
    consoleErrs.push({ text: m.text().slice(0, 200), url: String(loc.url || ''), line: loc.lineNumber });
  });
  page.on('requestfailed', r => failed.push(`${r.url().slice(0, 140)} :: ${(r.failure() || {}).errorText}`));
  page.on('response', r => { if (r.status() === 404) failed.push('404 ' + r.url().slice(0, 140)); });

  try {
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.gameWorld && window.player, null, { timeout: 90000 });
    // 操作指南弹窗单次 click 关不掉 → 直接隐藏大尺寸 fixed/absolute 覆盖层
    await page.evaluate(() => {
      document.querySelectorAll('.close-controls-hint, #close-controls-hint').forEach(b => b.click());
      for (const e of document.querySelectorAll('body *')) {
        const s = getComputedStyle(e);
        if (s.position !== 'fixed' && s.position !== 'absolute') continue;
        if (e.offsetWidth > innerWidth * 0.3 && e.offsetHeight > innerHeight * 0.3) e.style.display = 'none';
      }
    });

    const probe = () => page.evaluate((id) => {
      const gb = window.gameWorld.generatedBuildings;
      const e = gb.get(id) || gb.get(String(id));
      if (!e) return { found: false };
      if (e.isPlaceholder || !e.model) return { found: true, placeholder: true };
      const mats = [];
      e.model.traverse(o => {
        if (!o.material) return;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          const t = m.map;
          mats.push({ name: m.name || m.type, hasMap: !!t, imgW: t && t.image ? (t.image.width || 0) : 0, isBitmap: !!(t && t.image && typeof t.image.close === 'function') });
        }
      });
      let meshCount = 0;
      e.model.traverse(o => { if (o.isMesh) meshCount++; });
      // 按几何 UV 采样贴图：验证贴图真的生效（而不只是"挂上了"）
      const texels = new Set();
      e.model.traverse(o => {
        if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.uv) return;
        const uvA = o.geometry.attributes.uv;
        for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
          const t = m && m.map;
          if (!t || !t.image) continue;
          try {
            const cv = document.createElement('canvas');
            cv.width = t.image.width; cv.height = t.image.height;
            const cx = cv.getContext('2d');
            cx.drawImage(t.image, 0, 0);
            const n = Math.min(uvA.count, 400);
            for (let k = 0; k < n; k++) {
              const x = Math.min(t.image.width - 1, Math.max(0, Math.floor(uvA.getX(k) * t.image.width)));
              // 不翻转：glTF 约定 + three 对 ImageBitmap 设 flipY=false → v=0 是图像顶部
              const y = Math.min(t.image.height - 1, Math.max(0, Math.floor(uvA.getY(k) * t.image.height)));
              const d = cx.getImageData(x, y, 1, 1).data;
              texels.add(`${d[0]},${d[1]},${d[2]}`);
            }
          } catch (err) { /* 画布污染等 */ }
        }
      });
      return {
        found: true, placeholder: false, meshCount, inScene: !!e.model.parent, mats,
        uv: { sampled: texels.size, colors: [...texels].slice(0, 8) },
      };
    }, objId);

    let st = null;
    for (let i = 0; i < 90; i++) {
      st = await probe();
      if (st.found && !st.placeholder && st.meshCount > 0) break;
      await page.waitForTimeout(1000);
    }
    console.log('探测：' + JSON.stringify(st).slice(0, 700));
    log(st && st.found && !st.placeholder, 'W1 对象已加载（非占位符）');
    log(st && st.meshCount > 0 && st.inScene, 'W2 产生了 mesh 且在场景里', `mesh=${st && st.meshCount}`);
    const withMap = ((st && st.mats) || []).filter(m => m.hasMap && m.imgW > 0);
    log(withMap.length > 0, 'W3 ★材质贴图已解码（贴上了）', `${withMap.length}/${((st && st.mats) || []).length} 材质，尺寸 ${withMap[0] && withMap[0].imgW}px bitmap=${withMap[0] && withMap[0].isBitmap}`);
    const nonWhite = ((st && st.uv) && st.uv.colors || []).filter(c => c !== '255,255,255' && c !== '0,0,0');
    log(nonWhite.length > 0, 'W4 ★按 UV 取到非白非黑颜色（贴图真的生效，非白模）', JSON.stringify((st && st.uv) || {}));
    const tex404 = failed.filter(f => /Textures|colormap|\.png|\.bin/i.test(f));
    log(tex404.length === 0, 'W5a 无外置贴图/缓冲区 404', tex404.slice(0, 2).join(' | '));
    // 贴图相关的错误：文案命中 或 URL 指向贴图
    const glErr = consoleErrs.filter(e =>
      /Couldn't load texture|GLTFLoader/i.test(e.text) || /Textures|colormap|\.png|\.bin/i.test(e.url));
    const otherErr = consoleErrs.filter(e => !/favicon/i.test(e.url) && !/Couldn't load texture|GLTFLoader/i.test(e.text) && !/Textures|colormap/i.test(e.url));
    log(glErr.length === 0, 'W5b 无「贴图加载失败」类 console error',
      glErr.slice(0, 2).map(e => e.text + ' @' + e.url).join(' | '));
    log(otherErr.length === 0, 'W5c 无其他 console error（favicon 已按 URL 排除）',
      otherErr.slice(0, 3).map(e => e.text.slice(0, 90) + ' @' + e.url.slice(-40)).join(' | '));

    // 截图存档（把物体挪到相机视线上；animate 每帧会重置相机到玩家身后）
    await page.evaluate((id) => {
      const gb = window.gameWorld.generatedBuildings;
      const e = gb.get(id) || gb.get(String(id));
      if (!e || !e.model) return;
      const cam = window.gameWorld.camera;
      const dir = new THREE.Vector3(0, -0.25, 0.5).unproject(cam).sub(cam.position).normalize();
      const target = cam.position.clone().add(dir.multiplyScalar(11));
      const c = new THREE.Box3().setFromObject(e.model).getCenter(new THREE.Vector3());
      const holder = e.model.parent || e.model;
      holder.position.x += target.x - c.x; holder.position.y += target.y - c.y; holder.position.z += target.z - c.z;
      holder.updateMatrixWorld(true);
    }, objId);
    await page.waitForTimeout(3000);
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    const shot = path.join(SHOT_DIR, 'part_render_al3.png');
    await page.screenshot({ path: shot });
    console.log('截图：' + shot);
  } finally {
    await browser.close();
  }

  // 清理
  const del = await api(`/api/world/objects/${objId}`, { method: 'DELETE', token });
  log(del.status === 200 || del.status === 204, 'W6a 测试对象已删除', 'HTTP ' + del.status);
  const still = await api('/api/world/objects');
  const left = (still.j.objects || still.j.data || []).filter(o => o.name === TEST_NAME);
  log(left.length === 0, 'W6b 无残留', 'left=' + left.length);

  console.log(`\n共 ${pass + fail} 条：PASS ${pass} / FAIL ${fail}`);
  console.log(fail === 0 ? 'VERDICT: ACCEPTED（AL-3 通过：零件是可用资产）' : 'VERDICT: REJECTED（AL-3 失败：渲染链路有问题）');
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
