/**
 * accept_agent_fix_f.js — 第一轮联测缺陷 F + H 验收：实体标识契约 + 发现端点同源
 *
 * F（契约项）：entities[].id(=characterId) 是唯一标识、name 仅供显示、chat 的 senderId/characterId
 *   与 entities[].id 同一命名空间、同角色多连接先去重再定位 —— 以机器可读形式写进发现端点。
 * H：/.well-known/virtual-world-agent.json 与 /api/agent/v1/capabilities 必须同源同形
 *   （此前 well-known 有 limits/tiers 明细而 capabilities 没有；且 pushTiers 一处数组一处对象）。
 *
 * 判据：
 *  F1  well-known 含 entityIdentity 且关键字段齐全
 *  F2  capabilities 含同一 entityIdentity
 *  F3  两处 tiers/scopes/actions/pushTiers/limits/entityIdentity 逐字一致（深比较）
 *  F4  capabilities 现在含 limits（含 agent_max_speed / observe 采样率 / 半径上限）
 *  F5  pushTiers 两处同形（不再是「一处数组一处对象」）
 *  F6  openapi 含 x-entity-identity，且 /observe 描述写明标识契约
 *  F7  openapi 与两处发现端点的 actions 一致（都含 follow）
 *  F8  limits.observeRateLimitPerSecond 反映后台配置（改成 3 → 两处都变 3 → 恢复）
 *  F9  两个发现端点均公开可读（无鉴权）
 *
 * 运行：node scripts/accept_agent_fix_f.js
 */
'use strict';

const BASE = process.env.TEST_BASE || 'http://localhost:3002';
const ADMIN_USER = 'baseline_shot';
const ADMIN_PASS = 'Baseline#185';

let pass = 0, fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}${detail ? ' :: ' + detail : ''}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? ' :: ' + detail : ''}`); }
}
function section(t) { console.log(`\n[${t}]`); }
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function j(method, url, body, token) {
  const opts = { method, headers: {} };
  if (token) opts.headers['Authorization'] = 'Bearer ' + token;
  if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
  const r = await fetch(url, opts);
  let jr = null;
  try { jr = await r.json(); } catch (e) { /* ignore */ }
  return { status: r.status, body: jr };
}

/** 稳定序列化（按 key 排序），用于逐字比对共享段 */
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

(async () => {
  console.log('=== Fix F+H acceptance: entity identity contract & discovery parity ===');
  let adminToken = null, origEnabled = false, origRate = 1, origPush = 'eco', origMaxSpeed = 9, origMaxConn = 1;

  try {
    section('0. fetch discovery endpoints (public, no auth)');
    const wk = await j('GET', `${BASE}/.well-known/virtual-world-agent.json`);
    const cap = await j('GET', `${BASE}/api/agent/v1/capabilities`);
    const oa = await j('GET', `${BASE}/api/agent/v1/openapi.json`);
    ok('F9a well-known public 200', wk.status === 200, 'status=' + wk.status);
    ok('F9b capabilities public 200', cap.status === 200, 'status=' + cap.status);
    ok('F9c openapi public 200', oa.status === 200, 'status=' + oa.status);

    section('1. entity identity contract (F)');
    const wi = wk.body.entityIdentity;
    const ci = cap.body.entityIdentity;
    ok('F1 well-known has entityIdentity', !!wi && wi.uniqueIdField === 'id' && wi.nameIsDisplayOnly === true
      && wi.chatSenderIdEqualsEntityId === true && wi.duplicateConnectionsDeduped === true,
      JSON.stringify(wi || null));
    ok('F2 capabilities has the same entityIdentity', !!ci && stable(ci) === stable(wi), JSON.stringify(ci || null));
    ok('F2b aliases include characterId', !!wi && Array.isArray(wi.aliases) && wi.aliases.includes('characterId'),
      JSON.stringify(wi && wi.aliases));

    section('2. discovery parity (H)');
    const sharedKeys = ['tiers', 'scopes', 'actions', 'pushTiers', 'limits', 'entityIdentity'];
    const diffs = sharedKeys.filter(k => stable(wk.body[k]) !== stable(cap.body[k]));
    ok('F3 tiers/scopes/actions/pushTiers/limits/entityIdentity identical in both',
      diffs.length === 0, diffs.length ? 'differ: ' + diffs.join(',') : 'all identical');
    ok('F4 capabilities now exposes limits',
      !!cap.body.limits && Number.isFinite(cap.body.limits.observeRadiusMax) && Number.isFinite(cap.body.limits.movementSpeed),
      JSON.stringify(cap.body.limits || null));
    ok('F5 pushTiers is an object in both (no array/object mismatch)',
      !!wk.body.pushTiers && !Array.isArray(wk.body.pushTiers) && !!wk.body.pushTiers.default && Array.isArray(wk.body.pushTiers.options),
      'wellKnown=' + JSON.stringify(wk.body.pushTiers));

    section('3. openapi alignment');
    ok('F6 openapi has x-entity-identity', !!oa.body['x-entity-identity']
      && oa.body['x-entity-identity'].uniqueIdField === 'id', JSON.stringify(oa.body['x-entity-identity'] || null));
    ok('F6b observe description states identity contract',
      /name\s*is display-only|display-only/.test(oa.body.paths['/observe'].get.description || ''));
    const oaActions = (oa.body['x-websocket'] && oa.body['x-websocket'].actions) || [];
    ok('F7 actions consistent across capabilities/well-known/openapi (all include follow)',
      oaActions.includes('follow') && cap.body.actions.includes('follow') && wk.body.actions.includes('follow'),
      `cap=${cap.body.actions.length} oa=${oaActions.length}`);

    section('4. limits reflect live config');
    const login = await j('POST', `${BASE}/api/admin-auth/login`, { username: ADMIN_USER, password: ADMIN_PASS });
    if (login.status !== 200) { console.log('FATAL: admin login failed'); process.exit(1); }
    adminToken = login.body.token;
    const cfg = await j('GET', `${BASE}/api/agent/v1/admin/config`, undefined, adminToken);
    origEnabled = cfg.body.config.agentEnabled;
    origRate = cfg.body.config.observeRateKey || 1;
    origPush = cfg.body.config.pushDefault;
    origMaxSpeed = cfg.body.config.maxSpeed || 9;
    origMaxConn = cfg.body.config.maxConnectionsPerAgent || 1;

    await j('PUT', `${BASE}/api/agent/v1/admin/config`, { agent_observe_rate_key: '3' }, adminToken);
    await sleep(2000);
    const cap2 = await j('GET', `${BASE}/api/agent/v1/capabilities`);
    const wk2 = await j('GET', `${BASE}/.well-known/virtual-world-agent.json`);
    ok('F8 limits.observeRateLimitPerSecond follows config (3)',
      cap2.body.limits.observeRateLimitPerSecond === 3 && wk2.body.limits.observeRateLimitPerSecond === 3,
      `cap=${cap2.body.limits.observeRateLimitPerSecond} wk=${wk2.body.limits.observeRateLimitPerSecond}`);
    ok('F8b limits.movementSpeed equals configured max speed',
      cap2.body.limits.movementSpeed === origMaxSpeed, `movementSpeed=${cap2.body.limits.movementSpeed} cfg=${origMaxSpeed}`);
  } catch (e) {
    ok('unexpected error', false, e.message);
  } finally {
    if (adminToken) {
      try {
        await j('PUT', `${BASE}/api/agent/v1/admin/config`, {
          agent_enabled: origEnabled ? 'true' : 'false',
          agent_push_default: origPush || 'eco',
          agent_observe_rate_key: String(origRate),
          agent_max_speed: String(origMaxSpeed),
          agent_max_connections_per_agent: String(origMaxConn)
        }, adminToken);
      } catch (e) { /* ignore */ }
      console.log(`\n[restore] enabled=${origEnabled} push=${origPush} observeRate=${origRate} maxSpeed=${origMaxSpeed}`);
    }
  }

  console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
  if (failures.length) console.log('FAILED: ' + failures.join(' | '));
  process.exitCode = fail === 0 ? 0 : 1;
})();
