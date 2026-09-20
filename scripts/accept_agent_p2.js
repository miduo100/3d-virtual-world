/**
 * P2 验收脚本：Agent 观察 API（GET /observe）
 * 判据（文档第 7 节 P2）：
 *   ① observe 返回附近已知对象（用真实坐标核对）
 *   ② radius 截断（radius 内对象距离 <= radius）
 *   ③ /around 返回结构不变（回归，existing 人类空间 API 不受影响）
 *   ④ 1Hz 超频 429
 * 前置：p1_test_agent 已存在（active）；agent_enabled 须先打开（60s 缓存）。
 * 注意：服务器端 agentConfigService 有 60s 缓存，
 *   "开开关"在任何 HTTP 请求之前完成，"关开关"测试放最后并轮询等待缓存过期。
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const BASE = 'http://localhost:3002';
const { pool, query } = require('../src/database/db');

const results = [];
function record(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}  ${name}${detail ? '  -> ' + detail : ''}`);
}

async function req(method, url, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch(BASE + url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (e) { /* ignore */ }
  return { status: res.status, json };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// 每个 HTTP observe 请求前等 1.1s，避开 1Hz 限频（eco 档）误伤后续测试
async function observeReq(url, token) {
  await sleep(1100);
  return req('GET', url, { token });
}

async function main() {
  const agentManager = require('../src/agent/agentManager');
  const agentConfigService = require('../src/agent/agentConfigService');

  // ---------- 准备：默认配置 + 开总开关（在任何 HTTP 前） ----------
  await agentConfigService.ensureDefaultConfig();
  // v6 批次 D：记住运行前原值，收尾按原值还原（原实现硬编码 false → 连跑回归时
  // 紧随其后的脚本会撞 503 AGENT_DISABLED_GLOBALLY，见文档 §9 坑 35）
  const cfgBefore = await agentConfigService.getConfig(true);
  const origEnabled = !!cfgBefore.agentEnabled;
  await agentConfigService.setConfigValue('agent_enabled', 'true');

  let agent = await agentManager.getAgentByName('p1_test_agent');
  if (!agent) {
    const created = await agentManager.createAgent({ name: 'p1_test_agent', description: 'P2 验收' });
    agent = created.agent;
  }
  // 换发一把新 Key（P1 的 Key 可能已吊销）
  const apiKey = (await agentManager.createApiKey(agent.id)).key;

  // 等服务器 60s 缓存过期
  console.log('\n[wait] agent_enabled=true，轮询等待服务器 60s 缓存过期（最长 140s）...');
  let sessionOk = false;
  let token = null;
  const deadline1 = Date.now() + 140000;
  while (Date.now() < deadline1) {
    const s = await req('POST', '/api/agent/v1/session', { token: apiKey });
    if (s.status === 200 && s.json?.token) { sessionOk = true; token = s.json.token; break; }
    if (s.status === 429) { await sleep(5000); continue; }   // 限流窗口
    await sleep(3000);
  }
  if (!sessionOk) {
    record('Z', '前置：POST /session 换 token', false, '无法获取 token，后续测试全部跳过');
    await finish(); return;
  }
  record('Z', '前置：POST /session 换 token', true);

  // ---------- ① observe 返回附近已知对象（真实坐标核对） ----------
  // 取一个真实世界对象坐标作为观察点
  const sample = await query(`SELECT id, name, type, position_x, position_y, position_z FROM world_objects ORDER BY id LIMIT 1`);
  if (sample.rows.length === 0) {
    record('A1', 'observe 返回附近已知对象', false, 'world_objects 表为空');
  } else {
    const obj = sample.rows[0];
    const x = obj.position_x, y = obj.position_y, z = obj.position_z;
    const obs = await observeReq(`/api/agent/v1/observe?x=${x}&y=${y}&z=${z}&radius=50&limit=500`, token);
    const ok = obs.status === 200 && obs.json?.success
      && Array.isArray(obs.json?.objects) && obs.json?.objects.length > 0
      && obs.json?.objects.some(o => String(o.id) === String(obj.id) && o.name === obj.name && o.type === obj.type);
    record('A1', 'observe 返回附近已知对象（真实坐标核对）', ok,
      `status=${obs.status} objectsCount=${obs.json?.objects?.length} foundSelf=${obs.json?.objects?.some(o => String(o.id) === String(obj.id))}`);

    // self 字段核对
    const selfOk = obs.json?.self?.id === agent.id && obs.json?.self?.position?.x === x;
    record('A2', 'observe self 字段（id/位置）', selfOk,
      `selfId=${obs.json?.self?.id} selfPos=${JSON.stringify(obs.json?.self?.position)}`);

    // entities 含本 Agent
    const entSelf = Array.isArray(obs.json?.entities) && obs.json?.entities.some(e => String(e.id) === String(agent.id) && e.isSelf === true && e.type === 'agent');
    record('A3', 'observe entities 含本 Agent（isSelf:true, type:agent）', entSelf,
      `entitiesCount=${obs.json?.entities?.length}`);

    // world 字段
    const worldOk = obs.json?.world && typeof obs.json?.world === 'object';
    record('A4', 'observe world 字段存在', worldOk, `world=${JSON.stringify(obs.json?.world)}`);

    // 无管理员私有字段（不含 model_path/file_size/geometry_data/threejs_code 等）
    const objFields = obs.json?.objects?.[0] ? Object.keys(obs.json.objects[0]) : [];
    const forbidden = ['model_path', 'file_size', 'geometry_data', 'threejs_code', 'custom_config', 'is_locked', 'has_collision', 'video_props'];
    const leaked = forbidden.filter(f => objFields.includes(f));
    record('A5', 'observe objects 无管理员私有字段', leaked.length === 0,
      `leaked=${leaked.join(',') || 'none'} fields=${objFields.join(',')}`);
  }

  // ---------- ② radius 截断 ----------
  // 用一个已知对象坐标，设极小 radius=1，确认该对象不在结果（除非恰好在 1m 内）
  {
    const far = await query(`SELECT id, position_x, position_z FROM world_objects ORDER BY id OFFSET 5 LIMIT 1`);
    if (far.rows.length > 0) {
      const o = far.rows[0];
      const obs = await observeReq(`/api/agent/v1/observe?x=${o.position_x}&z=${o.position_z}&radius=1`, token);
      const within = (obs.json?.objects || []).filter(obj => obj.distance <= 1);
      const radiusOk = obs.status === 200 && obs.json?.radius === 1 && within.length === obs.json.objects.length;
      record('B1', 'radius 截断（所有返回对象 distance <= radius）', radiusOk,
        `radius=${obs.json?.radius} maxDist=${obs.json?.objects && obs.json.objects.length ? Math.max(...obs.json.objects.map(o => o.distance)) : 0}`);

      // radius 硬上限 200：传 999 应被截为 200
      const obs2 = await observeReq(`/api/agent/v1/observe?x=0&z=0&radius=999`, token);
      const capOk = obs2.status === 200 && obs2.json?.radius === 200;
      record('B2', 'radius 硬上限 200（传 999 被截为 200）', capOk, `radius=${obs2.json?.radius}`);
    } else {
      record('B1', 'radius 截断', false, '无法取到测试对象');
      record('B2', 'radius 硬上限 200', false, '依赖 B1');
    }
  }

  // ---------- ③ /around 回归（existing 人类空间 API 不变） ----------
  {
    const around = await req('GET', '/api/world/spatial/around?x=0&z=0&radius=100');
    const aroundOk = around.status === 200 && around.json?.success && Array.isArray(around.json?.objects)
      && typeof around.json?.total === 'number';
    record('C1', '/api/world/spatial/around 回归（结构不变）', aroundOk,
      `status=${around.status} total=${around.json?.total} objects=${around.json?.objects?.length}`);

    // /around 返回完整字段（含 model_path 等），observe 不含 —— 验证口径分离
    if (around.json?.objects?.length > 0) {
      const aroundFields = Object.keys(around.json.objects[0]);
      const hasModelPath = aroundFields.includes('model_path');
      record('C2', '/around 仍返回完整字段（含 model_path，与 observe 精简口径分离）', hasModelPath,
        `fields=${aroundFields.join(',')}`);
    } else {
      record('C2', '/around 完整字段核对', false, '无对象');
    }
  }

  // ---------- ④ 1Hz 超频 429 ----------
  {
    // 立即连发 3 次（1Hz 限制 = 每秒 1 次，第 2 次必 429）
    let saw429 = false;
    for (let i = 0; i < 3; i++) {
      const r = await req('GET', '/api/agent/v1/observe?x=0&z=0', { token });
      if (r.status === 429) { saw429 = true; break; }
      await sleep(50);  // 极短间隔确保触发限频
    }
    record('D1', '1Hz 超频触发 429', saw429, `saw429=${saw429}`);

    // 等 1.2s 后应恢复正常
    await sleep(1200);
    const r2 = await req('GET', '/api/agent/v1/observe?x=0&z=0', { token });
    const recoverOk = r2.status === 200 && r2.json?.success;
    record('D2', '限频窗口过后恢复正常 200', recoverOk, `status=${r2.status}`);
  }

  // ---------- 无 token / 错误 token 防御 ----------
  {
    const noToken = await req('GET', '/api/agent/v1/observe?x=0&z=0', {});
    record('E1', '无 token 访问 /observe 返回 401', noToken.status === 401, `status=${noToken.status}`);

    const fakeToken = await req('GET', '/api/agent/v1/observe?x=0&z=0', { token: 'fake-token' });
    record('E2', '伪造 token 访问 /observe 被拒', fakeToken.status === 401 || fakeToken.status === 403, `status=${fakeToken.status}`);
  }

  // ---------- 收尾：按运行前原值还原（v6 批次 D） ----------
  await agentConfigService.setConfigValue('agent_enabled', origEnabled ? 'true' : 'false');
  console.log(`\n[cleanup] agent_enabled 已恢复运行前值 = ${origEnabled}（红线 6：默认关）`);
  await finish();
}

async function finish() {
  const pass = results.filter(r => r.pass).length;
  console.log(`\n===== P2 验收: ${pass}/${results.length} PASS =====`);
  process.exitCode = pass === results.length ? 0 : 1;
  try { await pool.end(); } catch (e) { /* ignore */ }
}

main().catch(e => { console.error('[FATAL]', e); process.exit(1); });
