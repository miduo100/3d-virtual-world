/**
 * P1 验收：bundle 上传（glTF 原生管线）
 * 用 H:\导入文件\glTF 真样本走全链路：
 *   T1 文件夹上传端点 → 主文件入库 + glTF 变体(_mid/_lod) + 外置纹理压缩
 *   T2 变体结构校验（buffer/贴图 uri 全部可解析）
 *   T3 zip 端点
 *   T4 非法相对路径拒绝（zip-slip 防护）
 * 结束清理测试产生的 DB 行与 bundle 目录。
 * 运行：node scripts/accept_model_bundle_gltf.js [--keep]
 */
const path = require('path');
const fs = require('fs');
const fsp = require('fs').promises;
const AdmZip = require('adm-zip');
const { pool } = require('../src/database/db');

const BASE = process.env.BASE || 'http://localhost:3002';
const SAMPLE_DIR = 'H:/导入文件/glTF';
const UPLOAD_ROOT = path.join(__dirname, '../public/models/uploaded');
const KEEP = process.argv.includes('--keep');

let passCount = 0, failCount = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passCount++; console.log(`  ✅ ${name}${detail ? ' — ' + detail : ''}`); }
  else { failCount++; failures.push(name); console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(BASE + '/api/health');
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  return false;
}

function toBlob(buf, type) { return new Blob([buf], { type }); }

async function main() {
  console.log('== bundle 上传验收（glTF 原生管线）==');
  if (!(await waitServer())) { console.log('❌ 服务器未就绪'); process.exit(1); }

  const createdBundles = [];
  const rowIds = [];
  const startTime = Date.now();

  try {
    // ---------- T1 文件夹上传 ----------
    console.log('\n[T1] 文件夹上传端点（全部 glTF 样本）');
    const files = fs.readdirSync(SAMPLE_DIR).filter((f) => !f.startsWith('.'));
    const fd = new FormData();
    const relPaths = [];
    for (const f of files) {
      const buf = fs.readFileSync(path.join(SAMPLE_DIR, f));
      fd.append('files', toBlob(buf, 'application/octet-stream'), f);
      relPaths.push(f);
    }
    fd.append('relPaths', JSON.stringify(relPaths));
    const t0 = Date.now();
    const r1 = await fetch(BASE + '/api/upload-model-bundle', { method: 'POST', body: fd });
    const j1 = await r1.json();
    check('T1.1 上传成功', r1.ok && j1.success, r1.ok ? `耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s` : JSON.stringify(j1).slice(0, 200));
    if (!r1.ok || !j1.success) throw new Error('T1 失败，终止');
    createdBundles.push(j1.bundleName);
    const gltfCount = files.filter((f) => f.toLowerCase().endsWith('.gltf')).length;
    check('T1.2 主模型数 = gltf 文件数', j1.modelCount === gltfCount, `${j1.modelCount}/${gltfCount}`);
    for (const m of j1.models) rowIds.push(m.id);

    // 引用完整性
    const badRefs = j1.models.filter((m) => m.warnings && m.warnings.length);
    check('T1.3 glTF 引用完整（bin/贴图齐全）', badRefs.length === 0,
      badRefs.length ? badRefs.map((m) => `${m.name}: ${m.warnings.join(',')}`).join(' | ') : `${j1.models.length} 个模型 0 缺失`);

    // 变体生成（按门槛断言：源 ≥ MIN_SOURCE_TRIS 必须生成；低于门槛必须 low-poly 跳过）
    const { MIN_SOURCE_TRIS } = require('../src/services/nativeModelPipeline');
    let midOk = 0, lowOk = 0, midOkTri = true, lowFloor = [], gateBad = [];
    for (const m of j1.models) {
      const v = m.variants || {};
      const tris = v.sourceTris || 0;
      const shouldGen = tris >= MIN_SOURCE_TRIS;
      if (shouldGen && v.mid && (v.mid.status === 'generated' || v.mid.status === 'exists')) {
        midOk++;
        if (!(v.mid.tris > 0 && v.mid.tris < tris)) midOkTri = false;
      }
      if (shouldGen && v.low && v.low.status === 'generated') {
        lowOk++;
        if ((v.low.tris || 0) > 100) lowFloor.push(`${m.name}:${v.low.tris}`);
      }
      if (!shouldGen && !(v.skipped && v.reason === 'low-poly')) gateBad.push(m.name);
      if (shouldGen && (!v.mid || !['generated', 'exists'].includes(v.mid.status))) gateBad.push(m.name + '(mid)');
    }
    const expectGen = j1.models.filter((m) => ((m.variants || {}).sourceTris || 0) >= MIN_SOURCE_TRIS).length;
    check('T1.4 达门槛 glTF 全部生成中模变体', midOk === expectGen, `${midOk}/${expectGen}（${j1.models.length - expectGen} 个低多边形按门槛跳过）`);
    check('T1.5 中模面数有效（0 < mid < 源）', midOkTri);
    check('T1.6 达门槛 glTF 全部生成低模变体', lowOk === expectGen, `${lowOk}/${expectGen}`);
    if (lowFloor.length) console.log(`  ℹ️ 低模 gltfpack 拓扑触底（>100 面，如实落盘）: ${lowFloor.join(', ')}`);
    check('T1.9 门槛判定正确（低多边形跳过 / 达门槛生成）', gateBad.length === 0, gateBad.length ? gateBad.join(',') : '');

    // 纹理压缩
    const tc = j1.textureCompression || {};
    check('T1.7 外置纹理压缩生效', tc.processed > 0 && tc.savedBytes > 0,
      tc.error ? ('error: ' + tc.error) : `压了 ${tc.processed} 张，省 ${(tc.savedBytes / 1048576).toFixed(2)}MB`);
    const marker = path.join(UPLOAD_ROOT, j1.bundleName, '.texopt-done.json');
    check('T1.8 压缩幂等标记落盘', fs.existsSync(marker));

    // ---------- T2 变体结构校验 ----------
    console.log('\n[T2] 变体结构校验（buffer/贴图 uri 全部可解析）');
    let structOk = 0, structTotal = 0;
    for (const m of j1.models) {
      const v = m.variants || {};
      for (const key of ['mid', 'low']) {
        if (!v[key] || !(v[key].status === 'generated' || v[key].status === 'exists')) continue;
        structTotal++;
        const gltfAbs = path.join(UPLOAD_ROOT, j1.bundleName, path.basename(v[key].path));
        let ok = false, why = '';
        try {
          const json = JSON.parse(await fsp.readFile(gltfAbs, 'utf8'));
          const dir = path.dirname(gltfAbs);
          ok = true;
          for (const b of json.buffers || []) {
            if (typeof b.uri === 'string' && !/^(data|https?):/i.test(b.uri)) {
              const p = path.resolve(dir, decodeURIComponent(b.uri));
              if (!fs.existsSync(p)) { ok = false; why = `buffer 缺失 ${b.uri}`; }
            }
          }
          if (ok) for (const im of json.images || []) {
            if (typeof im.uri === 'string' && !/^(data|https?):/i.test(im.uri)) {
              const p = path.resolve(dir, decodeURIComponent(im.uri));
              if (!fs.existsSync(p)) { ok = false; why = `贴图缺失 ${im.uri}`; }
            }
          }
          if (ok && (!json.meshes || !json.meshes.length)) { ok = false; why = '无 mesh'; }
        } catch (e) { why = e.message.slice(0, 80); }
        if (ok) structOk++; else console.log(`    · ${path.basename(v[key].path)} 校验失败: ${why}`);
      }
    }
    check('T2.1 变体 JSON/buffer/贴图全部可解析', structOk === structTotal, `${structOk}/${structTotal}`);

    // ---------- T3 zip 端点 ----------
    console.log('\n[T3] zip 上传端点');
    const zip = new AdmZip();
    for (const f of ['CommonTree_1.gltf', 'CommonTree_1.bin', 'Bark_NormalTree.png']) {
      const p = path.join(SAMPLE_DIR, f);
      if (fs.existsSync(p)) zip.addLocalFile(p);
    }
    const zipBuf = zip.toBuffer();
    const fd3 = new FormData();
    fd3.append('file', toBlob(zipBuf, 'application/zip'), 'sample_bundle.zip');
    const r3 = await fetch(BASE + '/api/upload-model-zip', { method: 'POST', body: fd3 });
    const j3 = await r3.json();
    check('T3.1 zip 上传成功', r3.ok && j3.success, r3.ok ? `模型 ${j3.modelCount}` : JSON.stringify(j3).slice(0, 200));
    if (r3.ok && j3.success) {
      createdBundles.push(j3.bundleName);
      for (const m of j3.models) rowIds.push(m.id);
      check('T3.2 zip 内 gltf 识别为主模型', j3.modelCount === 1 && j3.models[0].fileType === 'gltf');
      check('T3.3 zip 模型变体生成', j3.models[0].variants && (j3.models[0].variants.mid || {}).status === 'generated');
    }

    // ---------- T4 非法路径拒绝 ----------
    console.log('\n[T4] zip-slip 防护');
    const fd4 = new FormData();
    fd4.append('files', toBlob(Buffer.from('x'), 'application/octet-stream'), 'a.bin');
    fd4.append('relPaths', JSON.stringify(['../evil.bin']));
    const r4 = await fetch(BASE + '/api/upload-model-bundle', { method: 'POST', body: fd4 });
    check('T4.1 ../ 逃逸路径被拒 400', r4.status === 400, `status=${r4.status}`);

    // ---------- 汇总 ----------
    console.log(`\n======== 验收结果: ${passCount} PASS / ${failCount} FAIL ========`);
    if (failures.length) console.log('失败项: ' + failures.join(' | '));
  } finally {
    if (!KEEP) {
      console.log('\n清理测试产物...');
      for (const b of createdBundles) {
        await fsp.rm(path.join(UPLOAD_ROOT, b), { recursive: true, force: true }).catch(() => {});
      }
      if (rowIds.length) {
        await pool.query('DELETE FROM uploaded_models WHERE id = ANY($1::int[])', [rowIds]).catch((e) => console.log('DB 清理失败:', e.message));
      }
      console.log(`已删除 ${createdBundles.length} 个 bundle 目录 / ${rowIds.length} 条记录`);
    } else {
      console.log('\n[--keep] 保留测试产物: ' + createdBundles.join(', '));
    }
    await pool.end().catch(() => {});
  }
  process.exit(failCount ? 1 : 0);
}

main().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
