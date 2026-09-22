#!/usr/bin/env node
/**
 * accept_agent_desc_completion.js — 「世界 AI 描述补全」验收（可重跑）
 *
 * 对应提示词：AI-Agent引流提示词-3-世界AI描述补全-v2.md §4 验收标准（V1~V11）
 *
 * 判据：
 *   V1  审计基线：对象/几何体覆盖率显著高于 0%（几何体应 100%）
 *   V2  传导正确性：临时模型填描述 → 其 10 个对象被回填为同一描述
 *   V3  不覆盖人工值：预置人工描述的对象在传导后保持不变（安全红线）
 *   V4  幂等：连续跑两次传导，第二次影响行数 0
 *   V5  几何体映射：抽 10 个不同类型词的几何体对象，DB 描述 == 映射表值
 *   V6  新增路径（媒体）：编辑器媒体库放置 → 带描述注入 / 不带描述保持 null
 *   V7  新增路径（几何体）：新建几何体对象无需人工即被 AI 读到映射描述；人工填写的优先
 *   V8  端到端：游客 Agent observe 真的能读到 objects[].description 与 portals[].description
 *   V9  防漏标记：后台模型库「🤖 未填」统计与接口数据一致
 *   V10 无回归：smoke_r185_world.js 9/9；accept_agent_p8.js 52/52
 *   V11 收尾：agent_enabled 恢复运行前的值
 *
 * 运行：node scripts/accept_agent_desc_completion.js
 *      node scripts/accept_agent_desc_completion.js --skip-regression   （跳过 V10，快速模式）
 *
 * 会创建/清理的测试数据（全部以 __agentdesc_test 前缀命名，收尾一律删除）：
 *   uploaded_models(path=/models/uploaded/__agentdesc_test.glb)
 *   world_objects(name=__agentdesc_test_*)
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const K = require('./agentV2TestKit');
const { pool, query } = require('../src/database/db');
const geom = require('../src/services/geometryAgentDesc');

const R = K.createReporter('AI 描述补全验收');
const ADMIN = { username: 'baseline_shot', password: 'Baseline#185' };
const SYNC = path.join(__dirname, 'sync_agent_descriptions.js');
const SKIP_REGRESSION = process.argv.includes('--skip-regression');

const TEST_MODEL_PATH = '/models/uploaded/__agentdesc_test.glb';
const TEST_MODEL_DESC = '【测试】用于 AI 描述传导验证的占位模型（静态装饰，不可交互）';
const MANUAL_DESC = '【人工填写】这段描述是人工写的，传导脚本绝不能覆盖它。';
const OBJ_PREFIX = '__agentdesc_test_';

let adminToken = '';
let adminUser = null;      // admin.html 的 checkAdminAuth 要求 localStorage 同时有 adminToken + adminUser
let enabledBefore = null;

const cleanup = {
  modelIds: [],
  objectIds: [],
  transientNote: []
};

// ==================== 工具 ====================

function runSync(args) {
  const r = spawnSync(process.execPath, [SYNC, ...args], { encoding: 'utf8', timeout: 180000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const apply = /models_updated=(\d+)\s+geometry_updated=(\d+)/.exec(out);
  const plan = /plan_models=(\d+)\s+plan_geometry=(\d+)/.exec(out);
  return {
    out, status: r.status,
    modelsUpdated: apply ? Number(apply[1]) : null,
    geometryUpdated: apply ? Number(apply[2]) : null,
    planModels: plan ? Number(plan[1]) : null,
    planGeometry: plan ? Number(plan[2]) : null
  };
}

async function adminLogin() {
  const r = await K.httpJson('/api/admin-auth/login', { method: 'POST', body: ADMIN });
  adminUser = (r.json && r.json.adminUser) || { username: ADMIN.username };
  return (r.json && r.json.token) || '';
}

async function agentCfgGet() {
  const r = await K.httpJson('/api/agent/v1/admin/config', { headers: { Authorization: 'Bearer ' + adminToken } });
  const c = (r.json && r.json.config) || {};
  // 注意：GET 返回的是 camelCase（agentEnabled），PUT 收的是 snake_case（agent_enabled）
  return { agentEnabled: !!c.agentEnabled };
}

async function agentEnabledPut(v) {
  return K.httpJson('/api/agent/v1/admin/config', {
    method: 'PUT', headers: { Authorization: 'Bearer ' + adminToken }, body: { agent_enabled: v }
  });
}

async function observe(token, qs, ip) {
  return K.httpJson('/api/agent/v1/observe?' + qs, {
    headers: { Authorization: 'Bearer ' + token }, ip
  });
}

/**
 * 游客 observe（带限频处理）：游客档 observe 限 1 次/2 秒（429 GUEST_OBSERVE_RATE_LIMITED），
 * 连续探测必须在两次调用间留 ≥2.1s，命中 429 再退避重试一次。
 */
async function guestObserve(token, qs) {
  let r = await observe(token, qs, K.testIp(191));
  if (r.status === 429) {
    await K.sleep(2300);
    r = await observe(token, qs, K.testIp(191));
  }
  return r;
}

async function cleanupAll() {
  try {
    await query(`DELETE FROM world_objects WHERE name LIKE $1 OR model_path = $2`, [OBJ_PREFIX + '%', TEST_MODEL_PATH]);
    await query(`DELETE FROM world_objects WHERE model_path LIKE '/uploads/__agentdesc_test%'`);
    await query(`DELETE FROM uploaded_models WHERE path = $1`, [TEST_MODEL_PATH]);
  } catch (e) {
    console.error('[cleanup] ' + e.message);
  }
}

// ==================== 主流程 ====================

async function main() {
  const browser = { b: null, ctx: null };

  try {
    adminToken = await adminLogin();
    R.check('S0 管理员登录', !!adminToken);

    const cfg = await agentCfgGet();
    enabledBefore = cfg.agentEnabled;
    R.info('S0b agent_enabled(before)', String(enabledBefore));
    await agentEnabledPut(true);
    await K.sleep(400);

    // ---------------- V1 审计基线 ----------------
    const covAll = (await query(`SELECT count(*)::int AS total, count(agent_description)::int AS wd FROM world_objects`)).rows[0];
    const covGeo = (await query(`SELECT count(*)::int AS total, count(agent_description)::int AS wd
                                 FROM world_objects WHERE type LIKE 'geometry_%'`)).rows[0];
    const coverage = covAll.wd * 100 / Math.max(1, covAll.total);
    R.check('V1a 对象覆盖率 > 0 且 ≥30%', covAll.wd > 0 && coverage >= 30, `${covAll.wd}/${covAll.total} = ${coverage.toFixed(1)}%`);
    const geoRate = covGeo.wd * 100 / Math.max(1, covGeo.total);
    R.check('V1b 几何体覆盖率 = 100%', covGeo.total > 0 && covGeo.wd === covGeo.total, `${covGeo.wd}/${covGeo.total} = ${geoRate.toFixed(1)}%`);

    const dry = runSync([]);
    R.check('V1c 审计/传导 dry-run 可跑通且幂等（plan 全为 0）',
      dry.status === 0 && dry.planModels === 0 && dry.planGeometry === 0,
      `plan_models=${dry.planModels} plan_geometry=${dry.planGeometry}`);

    // ---------------- V2/V3/V4 传导（临时模型 + 10 个对象）----------------
    const insModel = await query(
      `INSERT INTO uploaded_models (file_name, saved_file_name, path, file_type, file_size, description, category)
       VALUES ('__agentdesc_test.glb', '__agentdesc_test.glb', $1, 'glb', 2048, $2, 'uploaded')
       RETURNING id`, [TEST_MODEL_PATH, TEST_MODEL_DESC]);
    cleanup.modelIds.push(insModel.rows[0].id);

    const objIds = [];
    for (let i = 1; i <= 10; i++) {
      const r = await query(
        `INSERT INTO world_objects (type, name, model_path, position_x, position_y, position_z, agent_description)
         VALUES ('uploaded_model', $1, $2, $3, 0, $4, NULL) RETURNING id`,
        [`${OBJ_PREFIX}${i}`, TEST_MODEL_PATH, 900 + i, 900 + i]);
      objIds.push(r.rows[0].id);
    }
    cleanup.objectIds.push(...objIds);

    // V3 前置：把第 1 个对象写成"人工描述"
    await query(`UPDATE world_objects SET agent_description = $1 WHERE id = $2`, [MANUAL_DESC, objIds[0]]);

    const run1 = runSync(['--apply', '--only=models']);
    // 10 个对象里 1 个是"人工描述"（V3 前置），传导只填空 → 正确结果是 9 行
    R.check('V2 传导执行成功（只填空：9 行，人工那行不动）',
      run1.status === 0 && run1.modelsUpdated === 9, `models_updated=${run1.modelsUpdated}`);

    const rowsAfter = (await query(
      `SELECT id, agent_description FROM world_objects WHERE id = ANY($1::int[]) ORDER BY id`, [objIds])).rows;
    const gotDesc = rowsAfter.filter(r => r.agent_description === TEST_MODEL_DESC).length;
    R.check('V2b 10 个对象中 9 个被回填为模型描述（含 1 个人工值不覆盖）', gotDesc === 9, `matched=${gotDesc}/10`);
    const manualRow = rowsAfter.find(r => r.id === objIds[0]);
    R.check('V3 人工填写的描述未被覆盖（安全红线）',
      manualRow && manualRow.agent_description === MANUAL_DESC, manualRow && manualRow.agent_description);

    const run2 = runSync(['--apply']);
    R.check('V4 幂等：第二次传导影响行数 = 0',
      run2.status === 0 && run2.modelsUpdated === 0 && run2.geometryUpdated === 0,
      `models=${run2.modelsUpdated} geometry=${run2.geometryUpdated}`);

    // ---------------- V5 几何体映射 ----------------
    const geoRows = (await query(
      `SELECT id, name, type, model_path, agent_description FROM world_objects
       WHERE type LIKE 'geometry_%' ORDER BY random() LIMIT 60`)).rows;
    const seen = new Set();
    const samples = [];
    for (const row of geoRows) {
      const parsed = geom.parseGeometryName(row.name);
      const key = (parsed && parsed.typeWord) || geom.stripCopySuffix(row.name);
      if (seen.has(key)) continue;
      seen.add(key);
      samples.push(row);
      if (samples.length >= 10) break;
    }
    const v5bad = samples.filter(row => row.agent_description !== geom.deriveAgentDescription(row));
    R.check('V5 抽 10 个不同类型词的几何体：DB 描述 == 映射表值',
      samples.length === 10 && v5bad.length === 0,
      `samples=${samples.length} mismatched=${v5bad.length}${v5bad.length ? ' first=' + JSON.stringify(v5bad[0]) : ''}`);

    // ---------------- V6 新增路径：媒体库（浏览器实测）----------------
    let chromium = null;
    try { chromium = require('playwright').chromium; } catch (e) { /* ignore */ }
    if (!chromium) {
      R.check('V6 媒体放置注入描述', false, 'playwright 不可用');
    } else {
      const launchOpts = { headless: true };
      try { browser.b = await chromium.launch({ channel: 'chrome', headless: true }); }
      catch (e) { browser.b = await chromium.launch(launchOpts); }
      browser.ctx = await browser.b.newContext({ viewport: { width: 1440, height: 900 } });
      // admin.html 的守卫要求 adminToken + adminUser 同时存在，否则会在 admin.html ⇄ admin_login.html 之间来回跳
      await browser.ctx.addInitScript(
        `window.localStorage.setItem('adminToken', ${JSON.stringify(adminToken)});` +
        `window.localStorage.setItem('adminUser', ${JSON.stringify(JSON.stringify(adminUser || {}))});`);
      const page = await browser.ctx.newPage();
      await page.goto(K.BASE + '/world_editor.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(
        () => typeof window.startPlaceMedia === 'function' && typeof window.MediaAgentDesc === 'object',
        null, { timeout: 40000 });

      const withDescUrl = '/uploads/__agentdesc_test_media_a.png';
      const noDescUrl = '/uploads/__agentdesc_test_media_b.png';
      await page.evaluate(([a, b]) => {
        const lib = [
          { id: '__agentdesc_media_a', name: '测试图片A', type: 'image', mediaType: 'image', url: a, source: 'upload', addedAt: Date.now(), agentDescription: '【测试】一幅景区导览图（媒体描述注入验证）' },
          { id: '__agentdesc_media_b', name: '测试图片B', type: 'image', mediaType: 'image', url: b, source: 'upload', addedAt: Date.now() }
        ];
        localStorage.setItem('world_editor_media_library', JSON.stringify(lib));
        mediaLibrary = lib;
        if (typeof saveMediaLibrary === 'function') saveMediaLibrary();
      }, [withDescUrl, noDescUrl]);

      await page.evaluate((id) => window.startPlaceMedia(id), '__agentdesc_media_a');
      await page.evaluate((id) => window.startPlaceMedia(id), '__agentdesc_media_b');
      await K.sleep(2500);

      const mediaRows = (await query(
        `SELECT id, model_path, agent_description FROM world_objects
         WHERE model_path IN ($1, $2) AND type = 'media_image' ORDER BY id`, [withDescUrl, noDescUrl])).rows;
      cleanup.objectIds.push(...mediaRows.map(r => r.id));
      const withDesc = mediaRows.find(r => r.model_path === withDescUrl);
      const noDesc = mediaRows.find(r => r.model_path === noDescUrl);
      R.check('V6a 媒体放置：带描述 → 对象 agent_description 已写入',
        !!withDesc && withDesc.agent_description === '【测试】一幅景区导览图（媒体描述注入验证）',
        withDesc ? withDesc.agent_description : 'row missing');
      R.check('V6b 媒体放置：未填描述 → 对象 agent_description 保持 null（不写空串）',
        !!noDesc && noDesc.agent_description === null, noDesc ? JSON.stringify(noDesc.agent_description) : 'row missing');
      await page.close();
    }

    // ---------------- V7 新增路径：几何体（API + observe）----------------
    const ts = Date.now();
    const geoName = `${OBJ_PREFIX}场景_${ts}_tree_1`;
    const manualObjName = `${OBJ_PREFIX}人工_${ts}_rock_1`;
    const creation = await K.httpJson('/api/world/objects', {
      method: 'POST', headers: { Authorization: 'Bearer ' + adminToken },
      body: { type: 'geometry_nature', name: geoName, position_x: 600, position_y: 0, position_z: 600 }
    });
    const manualCreation = await K.httpJson('/api/world/objects', {
      method: 'POST', headers: { Authorization: 'Bearer ' + adminToken },
      body: {
        type: 'geometry_nature', name: manualObjName, position_x: 601, position_y: 0, position_z: 600,
        agent_description: MANUAL_DESC
      }
    });
    const geoId = creation.json && (creation.json.id || creation.json.object_id);
    const manualId = manualCreation.json && (manualCreation.json.id || manualCreation.json.object_id);
    if (geoId) cleanup.objectIds.push(geoId);
    if (manualId) cleanup.objectIds.push(manualId);
    R.check('V7a 几何体对象创建成功', creation.status === 200 && !!geoId, `status=${creation.status} id=${geoId}`);

    // ---------------- V8 端到端：游客 observe 真读到 ----------------
    const ticketR = await K.guestTicket(K.testIp(191));
    const ticket = ticketR.ticket && ticketR.ticket.token;
    R.check('V8a 游客签票成功', !!ticket, ticketR.status);

    const obs = await guestObserve(ticket, 'radius=30&limit=200&x=600&z=600');
    const obsObjects = (obs.json && obs.json.objects) || [];
    const gotGeo = obsObjects.find(o => String(o.id) === String(geoId));
    const gotManual = obsObjects.find(o => String(o.id) === String(manualId));
    R.check('V8b observe 命中新建几何体对象', !!gotGeo, `objects=${obsObjects.length}`);
    R.check('V8c 几何体描述 = 类型词映射值（新增对象无需人工也生效）',
      !!gotGeo && gotGeo.description === geom.deriveAgentDescription({ name: geoName, type: 'geometry_nature' }),
      gotGeo && gotGeo.description);
    R.check('V8d 人工填写的描述优先（覆盖推导值）',
      !!gotManual && gotManual.description === MANUAL_DESC, gotManual && gotManual.description);

    // V8e 真实几何体对象（库里已回填的）也能被读到
    const realGeo = (await query(
      `SELECT id, name, type, agent_description, position_x, position_z FROM world_objects
       WHERE type LIKE 'geometry_%' AND agent_description IS NOT NULL
         AND position_x IS NOT NULL AND position_z IS NOT NULL
       ORDER BY random() LIMIT 1`)).rows[0];
    if (realGeo) {
      await K.sleep(2200);   // 游客 observe 限 1 次/2 秒
      const obsReal = await guestObserve(ticket, `radius=30&limit=200&x=${realGeo.position_x}&z=${realGeo.position_z}`);
      const hitReal = ((obsReal.json && obsReal.json.objects) || []).find(o => String(o.id) === String(realGeo.id));
      R.check('V8e 真实几何体对象的描述可被 observe 读到', !!hitReal && !!hitReal.description,
        hitReal ? hitReal.description : `not in radius (status=${obsReal.status}, objects=${((obsReal.json && obsReal.json.objects) || []).length})`);
    } else {
      R.check('V8e 真实几何体对象的描述可被 observe 读到', false, 'no backfilled geometry found');
    }

    // V8f 传送门描述（E1）
    const portal = (await query(
      `SELECT id, name, description, source_position FROM portals
       WHERE is_active = true AND description IS NOT NULL AND description <> '' LIMIT 1`)).rows[0];
    if (portal) {
      const sp = portal.source_position || {};
      await K.sleep(2200);
      const obsP = await guestObserve(ticket, `radius=30&limit=200&x=${Number(sp.x) || 0}&z=${Number(sp.z) || 0}`);
      const hitP = ((obsP.json && obsP.json.portals) || []).find(p => String(p.id) === String(portal.id));
      R.check('V8f observe 能读到传送门 description（E1）', !!hitP && !!hitP.description,
        hitP ? hitP.description : `portal ${portal.name} not in radius (status=${obsP.status}, portals=${((obsP.json && obsP.json.portals) || []).length})`);
    } else {
      R.check('V8f observe 能读到传送门 description（E1）', false, 'no portal with description');
    }

    // ---------------- V9 防漏标记 ----------------
    const models = (await K.httpJson('/api/uploaded-models')).json;
    const modelList = (models && (models.models || models.data)) || [];
    const missingFromApi = modelList.filter(m => !(m.description && String(m.description).trim())).length;

    const served = await K.httpJson('/js/adminAgentDescBadge.js');
    R.check('V9a 防漏标记脚本可访问', served.status === 200 && /AdminAgentDescBadge/.test(served.text || ''), `status=${served.status}`);

    if (browser.b && browser.ctx) {
      const adminPage = await browser.ctx.newPage();
      adminPage.on('dialog', d => { d.dismiss().catch(() => {}); });
      await adminPage.goto(K.BASE + '/admin.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
      // 后台默认进入「上传模型」子页签并自动 loadUploadedModels；等列表渲染出足够行数（不调页面内部函数，避免作用域耦合）
      // 注意：默认子页签不是"上传模型"时该区域是 display:none → 只能等 attached，不能等 visible
      await adminPage.waitForSelector('#agent-desc-stats', { state: 'attached', timeout: 40000 });
      // 显式触发一次「🔄 刷新」按钮（= 调 loadUploadedModels），不依赖默认子页签是否已加载
      await adminPage.evaluate(() => {
        const btn = document.querySelector('button[onclick="loadUploadedModels()"]');
        if (btn) btn.click();
      });
      await adminPage.waitForFunction(
        (expect) => document.querySelectorAll('#uploaded-models-content tbody tr').length >= expect,
        modelList.length, { timeout: 30000 });
      const dom = await adminPage.evaluate(() => {
        const stats = document.getElementById('agent-desc-stats');
        return {
          statsText: stats ? stats.textContent : '',
          missing: document.querySelectorAll('#uploaded-models-content .agent-desc-missing').length,
          ok: document.querySelectorAll('#uploaded-models-content .agent-desc-ok').length,
          rows: document.querySelectorAll('#uploaded-models-content tbody tr').length
        };
      });
      R.check('V9b 后台列表：未填标记数量与接口数据一致',
        dom.rows === modelList.length && dom.missing === missingFromApi,
        `rows=${dom.rows}/${modelList.length} missing=${dom.missing}/${missingFromApi} ok=${dom.ok}`);
      R.check('V9c 后台列表顶部统计含"未填"数字',
        /未填/.test(dom.statsText) && new RegExp(String(missingFromApi)).test(dom.statsText),
        dom.statsText.slice(0, 120));
      await adminPage.close();
    } else {
      R.check('V9b 后台列表：未填标记数量与接口数据一致', false, 'browser 不可用');
      R.check('V9c 后台列表顶部统计含"未填"数字', false, 'browser 不可用');
    }

    // ---------------- V10 回归 ----------------
    if (SKIP_REGRESSION) {
      R.info('V10 回归', 'skipped (--skip-regression)');
    } else {
      const smoke = spawnSync(process.execPath, [path.join(__dirname, 'smoke_r185_world.js')], { encoding: 'utf8', timeout: 300000 });
      const smokeOut = (smoke.stdout || '') + (smoke.stderr || '');
      const m = /=====\s*(\d+)\/(\d+) passed/.exec(smokeOut);
      R.check('V10a smoke_r185_world.js 全绿', !!m && m[1] === m[2], m ? `${m[1]}/${m[2]}` : 'no summary');

      const p8 = spawnSync(process.execPath, [path.join(__dirname, 'accept_agent_p8.js')], { encoding: 'utf8', timeout: 900000 });
      const p8Out = (p8.stdout || '') + (p8.stderr || '');
      const m8 = /RESULT:\s*(\d+) passed,\s*(\d+) failed/.exec(p8Out);
      R.check('V10b accept_agent_p8.js 全绿', !!m8 && m8[2] === '0', m8 ? `${m8[1]} passed, ${m8[2]} failed` : 'no summary');
    }
  } catch (e) {
    R.check('FATAL ' + e.message, false);
  } finally {
    try { if (browser.b) await browser.b.close(); } catch (e) { /* ignore */ }
    await cleanupAll();
    // ---------------- V11 收尾 ----------------
    if (enabledBefore !== null) {
      await agentEnabledPut(enabledBefore);
      await K.sleep(300);
      const cfgAfter = await agentCfgGet();
      R.check('V11 agent_enabled 恢复运行前的值',
        cfgAfter.agentEnabled === enabledBefore, `now=${cfgAfter.agentEnabled} before=${enabledBefore}`);
    } else {
      R.check('V11 agent_enabled 恢复运行前的值', false, 'enabledBefore unknown');
    }
  }

  const sum = R.summary();
  try { await pool.end(); } catch (e) { /* ignore */ }
  process.exitCode = sum.fail === 0 ? 0 : 1;
}

main();
