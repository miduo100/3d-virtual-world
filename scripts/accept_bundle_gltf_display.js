/**
 * 验收：bundle 导入的 .gltf 在世界端与编辑器端真实显示
 *   W1 世界端 addUploadedModel 加载 bundle gltf → mesh > 0
 *   W2 外置贴图真正挂上（material.map 存在）
 *   W3 GLB 回归（同一函数加载一个存量 glb 不回归）
 *   E1 编辑器 addUploadedModelToScene → 场景出现真实 mesh（并清理测试对象）
 * 运行：node scripts/accept_bundle_gltf_display.js
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:3002';
const GLTF_URL = '/models/uploaded/bundle-1790395701463/glTF/TwistedTree_5.gltf';
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  // 管理员登录（编辑器 + 对象清理都要用）
  const lr = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'baseline_shot', password: 'Baseline#185' }),
  });
  const lj = await lr.json();
  const adminToken = lj.token || lj.adminToken;
  if (!adminToken) { console.log('❌ 管理员登录失败'); process.exit(1); }

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  try {
    // ---------- 世界端 ----------
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    page.on('pageerror', (e) => errors.push('world pageerror: ' + e.message.slice(0, 100)));
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.gameWorld && window.gameWorld.glbLoaderReady !== false && window.player, null, { timeout: 60000 }).catch(() => {});
    await page.waitForFunction(() => window.gameWorld && window.player, null, { timeout: 30000 });
    await page.evaluate(() => { const b = document.querySelector('.close-controls-hint'); if (b) b.click(); }).catch(() => {});

    // W1+W2 世界端加载 bundle gltf
    const w = await page.evaluate(async (gltfUrl) => {
      const gw = window.gameWorld;
      const id = 'test-bundle-gltf';
      gw.generatedBuildings.delete(id);
      gw.generatedBuildings.delete(String(id));
      await gw.addUploadedModel({
        id, name: 'TwistedTree_5', model_path: gltfUrl, model_type: 'gltf',
        position_x: -26.3, position_y: 9.59, position_z: 30, rotation_x: 0, rotation_y: 0, rotation_z: 0,
        scale_x: 1, scale_y: 1, scale_z: 1,
      });
      const entry = gw.generatedBuildings.get(id) || gw.generatedBuildings.get(String(id));
      if (!entry || !entry.model) return { hasEntry: false };
      let meshes = 0, withMap = 0, tris = 0;
      entry.model.traverse((c) => {
        if (c.isMesh) {
          meshes++;
          const mats = Array.isArray(c.material) ? c.material : [c.material];
          for (const m of mats) if (m && (m.map || m.normalMap)) withMap++;
          const g = c.geometry;
          if (g && g.index) tris += g.index.count / 3;
        }
      });
      return { hasEntry: true, meshes, withMap, tris, inScene: !!entry.model.parent };
    }, GLTF_URL);
    check('W1 世界端 bundle gltf 产出真实 mesh', w.hasEntry && w.meshes > 0,
      w.hasEntry ? `meshes=${w.meshes} tris=${Math.round(w.tris || 0)}` : '无 entry/model');
    check('W2 外置贴图挂载（map/normalMap）', w.hasEntry && w.withMap > 0, `带贴图材质 ${w.withMap} 个`);
    check('W2.x 模型已入场景', w.hasEntry && w.inScene);

    // W3 GLB 回归
    const gb = await page.evaluate(async () => {
      const rows = await (await fetch('/api/uploaded-models')).json();
      const glb = (rows.models || []).find((m) => m.file_type === 'glb' && (m.path || '').toLowerCase().endsWith('.glb'));
      if (!glb) return { skipped: true };
      const gw = window.gameWorld;
      const id = 'test-glb-regression';
      gw.generatedBuildings.delete(id);
      await gw.addUploadedModel({
        id, name: 'glb-regression', model_path: glb.path, model_type: 'glb',
        position_x: -20, position_y: 9.59, position_z: 30, rotation_x: 0, rotation_y: 0, rotation_z: 0,
        scale_x: 1, scale_y: 1, scale_z: 1,
      });
      const entry = gw.generatedBuildings.get(id);
      if (!entry || !entry.model) return { hasEntry: false };
      let meshes = 0;
      entry.model.traverse((c) => { if (c.isMesh) meshes++; });
      return { hasEntry: true, meshes, path: glb.path };
    });
    if (gb.skipped) console.log('  ℹ️ W3 库中无 GLB，跳过回归');
    else check('W3 GLB 加载回归', gb.hasEntry && gb.meshes > 0, `${gb.path} meshes=${gb.meshes}`);

    // 清理世界内测试对象（仅前端实例，无 DB 写入）
    await page.evaluate(() => {
      const gw = window.gameWorld;
      for (const id of ['test-bundle-gltf', 'test-glb-regression']) {
        const e = gw.generatedBuildings.get(id);
        if (e && e.model && e.model.parent) e.model.parent.remove(e.model);
        gw.generatedBuildings.delete(id);
      }
    });

    // ---------- 编辑器 ----------
    const ep = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    ep.on('pageerror', (e) => errors.push('editor pageerror: ' + e.message.slice(0, 100)));
    await ep.addInitScript(([t]) => {
      localStorage.setItem('adminToken', t);
      localStorage.setItem('adminUser', JSON.stringify({ username: 'baseline_shot' }));
    }, [adminToken]);
    await ep.goto(BASE + '/world_editor.html', { waitUntil: 'domcontentloaded' });
    await ep.waitForFunction(() => typeof window.addUploadedModelToScene === 'function', null, { timeout: 30000 });
    await ep.waitForTimeout(2500);

    let createdId = null;
    const e1 = await ep.evaluate(async (gltfUrl) => {
      const readList = () => (typeof worldObjects !== 'undefined') ? worldObjects : [];
      const before = readList().length;
      await window.addUploadedModelToScene(gltfUrl, 'TwistedTree_5_test');
      // 轮询最多 25s：等范围加载队列下载+解析+克隆（loadWorldObjects 全量重载会重绑数组，必须每轮重读）
      let wo = null, diag = '';
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const cur = readList();
        wo = cur.find((o) => o.data && o.data.type === 'uploaded_model' && o.mesh && o.mesh.userData && (o.mesh.userData._realMesh || o.mesh.userData._showReal));
        if (wo) break;
        if (i === 20) {
          const cand = cur.filter((o) => o.data && o.data.type === 'uploaded_model').slice(-3).map((o) => ({
            keys: o.mesh ? Object.keys(o.mesh.userData || {}).slice(0, 8) : null,
            pending: !!(o.mesh && o.mesh.userData && o.mesh.userData.pendingGlb),
          }));
          diag = JSON.stringify(cand);
        }
      }
      let meshes = 0, inScene = false;
      if (wo) {
        wo.mesh.traverse((c) => { if (c.isMesh) meshes++; });
        inScene = !!wo.mesh.parent;
        if (wo.id !== undefined && wo.id !== null) createdId = wo.id;
        else if (wo.mesh.userData && wo.mesh.userData.worldObjectId) createdId = wo.mesh.userData.worldObjectId;
      }
      return { before, after: readList().length, found: !!wo, meshes, inScene, diag };
    }, GLTF_URL);
    check('E1 编辑器放置 bundle gltf 产出真实 mesh', e1.found && e1.meshes > 0,
      `editorObjects ${e1.before}→${e1.after} meshes=${e1.meshes}${e1.diag ? ' | ' + e1.diag : ''}`);

    // 清理编辑器创建的 DB 对象
    if (createdId !== null && createdId !== undefined) {
      const del = await fetch(BASE + '/api/world/objects/' + createdId, {
        method: 'DELETE', headers: { 'Authorization': 'Bearer ' + adminToken },
      });
      console.log(`  🧹 已清理编辑器测试对象 #${createdId}（HTTP ${del.status}）`);
    }
  } finally {
    await browser.close();
  }

  if (errors.length) console.log('\n页面错误: ' + errors.join(' | '));
  console.log(`\n======== 结果: ${pass} PASS / ${fail} FAIL ========`);
  if (failures.length) console.log('失败项: ' + failures.join(' | '));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
