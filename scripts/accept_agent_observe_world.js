/**
 * accept_agent_observe_world.js —— observe.world「世界身份」断言（2026-09-22 新增）
 *
 * 背景（AI 访客体检 [6-2]）：
 *   `src/agent/agentObservationService.js` 的 getWorldInfo() 查的键名是
 *   `config_key IN ('147','20','21','22','148')`，而真实库（本地与线上一致）用的是**命名键**
 *   `world_id` / `world_name` / `world_url` → 该查询恒返回 0 行 → `observe.world` 从写下那天起
 *   就恒为 `{id:null,name:null}`，MCP 里 world_observe 首行显示「世界「未知」（id=?）」，
 *   与同一会话的 world_discover（「世界「创世虚拟世界」」）自相矛盾。
 *
 *   **根因是这个缺陷从没有任何验收断言覆盖** —— 本脚本就是补上这条判据（防复发）。
 *
 * 判据：
 *   W1 agent_enabled 总闸可用（脚本会临时开闸并在收尾恢复运行前值）
 *   W2 游客签票 200（纯 HTTP，不需 WS 连接，不占每 IP 并发名额）
 *   W3 observe.world.id 非空
 *   W4 observe.world.name 非空
 *   W5 world.name === GET /api/config/world-settings 的 world_name（**必须相等**，强判据）
 *   W6 world.name === well-known 的 world.name（well-known 侧非空时必须一致）
 *   W7 world.id  === GET /api/agent/v1/me 的 worldId（/me 侧非空时必须一致）
 *   W8 服务器无 5xx
 *
 * 用法：node scripts/accept_agent_observe_world.js
 *   可用 AGENT_TEST_BASE 指向线上（线上会消耗 1 张游客票，见报告 §1.5 配额纪律）
 */
const kit = require('./agentV2TestKit');
const mcp = require('./mcpTestKit');

const R = kit.createReporter('accept_agent_observe_world');
const { httpJson, guestTicket, sleep } = kit;

// 用非回环测试 IP，避免烧掉本机 IP 的游客签票窗口（每 IP 10 张/小时）
const TEST_IP = process.env.AUDIT_IP || '203.0.113.66';

// AUDIT_NO_ADMIN=1：只读模式（**线上验证用**）——不调用任何管理员接口、不改总闸，
// 只在"闸已开"的前提下做断言；收尾也不恢复（因为没改过）。线上管理员凭据与本机不同，
// 用本机账密去打线上管理员登录会白吃限流，所以线上验证必须走这个模式。
const NO_ADMIN = process.env.AUDIT_NO_ADMIN === '1';

(async () => {
  const BASE = kit.BASE;
  R.info('base', BASE);
  R.info('模式', NO_ADMIN ? '只读（AUDIT_NO_ADMIN=1，不碰管理员接口）' : '本地（会自动开闸并收尾恢复）');

  // ---------- 总闸 ----------
  const originalEnabled = await readAgentEnabled();
  R.info('运行前 agent_enabled', String(originalEnabled));
  let enabledTouched = false;
  if (NO_ADMIN) {
    // 只读模式：闸没开就直接给出可操作结论，不做任何变更
    R.check('W1 agent_enabled 已开（只读模式不会自动开闸）', originalEnabled === true,
      originalEnabled === true ? 'ok' : '请先在后台打开「AI Agent 接入」总闸后再跑本脚本');
    if (originalEnabled !== true) return finish();
  } else {
    // 本地：临时开闸（走 admin API，避免 60s 缓存不生效），收尾恢复
    if (originalEnabled !== true) {
      const token = await mcp.adminToken();
      if (!token) {
        R.check('W1 需要管理员 token 才能临时开闸', false, 'adminToken 取不到（限流或凭据失效）');
        return finish();
      }
      const r = await mcp.setAgentEnabled(token, true);
      enabledTouched = r.status === 200;
      for (let i = 0; i < 20 && (await readAgentEnabled()) !== true; i++) await sleep(400);
    }
    R.check('W1 agent_enabled 总闸已开', (await readAgentEnabled()) === true);
  }

  // ---------- W2 签票 ----------
  const t = await guestTicket(TEST_IP);
  R.check('W2 游客签票 200', t.status === 200 && !!(t.ticket && t.ticket.token),
    `status=${t.status} body=${JSON.stringify(t.json).slice(0, 160)}`);
  if (!t.ticket) return finish();
  const auth = { Authorization: 'Bearer ' + t.ticket.token };

  // ---------- W3/W4 observe.world ----------
  const ob = await httpJson('/api/agent/v1/observe?radius=5', { method: 'GET', headers: auth });
  R.check('W3 observe 200 且带 world 字段', ob.status === 200 && !!ob.json && !!ob.json.world,
    `status=${ob.status} world=${JSON.stringify(ob.json && ob.json.world)}`);
  const w = (ob.json && ob.json.world) || {};
  R.check('W4 observe.world.id 非空（缺陷 [6-2] 的核心判据）', !!w.id, `id=${JSON.stringify(w.id)}`);
  R.check('W4b observe.world.name 非空（缺陷 [6-2] 的核心判据）', !!w.name, `name=${JSON.stringify(w.name)}`);

  // ---------- W5 与 system_config 命名键一致（强判据）----------
  const ws = await httpJson('/api/config/world-settings', { method: 'GET' });
  const cfgName = ws.json && ws.json.world_name ? String(ws.json.world_name).trim() : null;
  R.check('W5 world.name === /api/config/world-settings 的 world_name',
    !!cfgName && !!w.name && String(w.name).trim() === cfgName,
    `observe=${JSON.stringify(w.name)} cfg=${JSON.stringify(cfgName)}`);

  // ---------- W6 与 well-known 一致（非空时必须一致）----------
  const wk = await httpJson('/.well-known/virtual-world-agent.json', { method: 'GET' });
  const wkWorld = (wk.json && wk.json.world) || {};
  const nameOk = !wkWorld.name || String(wkWorld.name).trim() === String(w.name || '').trim();
  R.check('W6 world.name 与 well-known 一致', nameOk,
    `well-known=${JSON.stringify(wkWorld.name)} observe=${JSON.stringify(w.name)}`);
  if (wkWorld.id && w.id) {
    R.check('W6b world.id 与 well-known 一致', String(wkWorld.id) === String(w.id),
      `well-known=${wkWorld.id} observe=${w.id}`);
  } else {
    R.info('W6b 跳过（well-known.world.id 为空，联邦未初始化时属正常）', `wk=${JSON.stringify(wkWorld.id)}`);
  }

  // ---------- W7 与 /me 一致 ----------
  const me = await httpJson('/api/agent/v1/me', { method: 'GET', headers: auth });
  const meWorldId = me.json && me.json.worldId;
  if (meWorldId && w.id) {
    R.check('W7 world.id 与 /me 的 worldId 一致', String(meWorldId) === String(w.id),
      `me=${meWorldId} observe=${w.id}`);
  } else {
    R.info('W7 跳过（/me 未返回 worldId）', `status=${me.status} meWorldId=${JSON.stringify(meWorldId)}`);
  }

  // ---------- W8 无 5xx ----------
  const codes = [ob.status, ws.status, wk.status, me.status];
  R.check('W8 全链路无 5xx', codes.every(c => c > 0 && c < 500), `codes=${JSON.stringify(codes)}`);

  return finish();

  async function readAgentEnabled() {
    const r = await httpJson('/.well-known/virtual-world-agent.json', { method: 'GET' });
    return r.json ? r.json.agentEnabled : null;
  }

  async function finish() {
    if (enabledTouched && !NO_ADMIN) {
      const token = await mcp.adminToken();
      if (token) await mcp.setAgentEnabled(token, originalEnabled === true);
      R.info('收尾：agent_enabled 已恢复', String(originalEnabled));
    }
    const s = R.summary();
    process.exit(s.fail > 0 ? 1 : 0);
  }
})().catch(e => {
  console.error('FATAL ' + (e && e.stack || e));
  process.exit(2);
});
