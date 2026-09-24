/**
 * accept_first_load_player_sched.js — 首屏加载丝滑化 Step 3 验收
 * ------------------------------------------------------------------
 * 覆盖（§10 Step 3）：
 *   用例1 单人        ：自己角色 GLB 请求 start ≥ T_ready；角色 ≤ T_ready+8s 上屏
 *                        且 8 动画可用（无 500ms×20 空转）。
 *   用例2 双人同模板  ：两人模型请求都 ≥ T_ready；parseCount === 1；
 *                        两人动画各自正确、互不干扰（sharedMixer 各归各模型子树）。
 *   用例3 视野过滤    ：远端玩家 200m 外不加载（保持方块人）；移入 60m 内开始加载；
 *                        并发 = 1（第二个远端在第一个完成后才发起）。
 *   用例4 离队取消    ：排队中移除远端玩家 → 队列清空、无模型上屏、无请求。
 *   反向断言          ：0 ~ T_ready 期间没有任何 /uploads/character-templates/*.glb 请求。
 *
 * 构造：登录 diag_tmp_1（localStorage 注入登录态 + 模板键），远端玩家用
 *       gameWorld.addPlayer 注入（r185 验收沉淀：无需真实用户/数据库）。
 * 模板：self/remote2=新生成美女无皮 0.76MB；C=美女 4.86MB；D=metool 9.5MB；
 *       E=拿剑武士 URL（仅标识，不应产生请求）。
 * 限速：CDP 6Mbps / RTT 200ms。
 *
 * 用法：node scripts/accept_first_load_player_sched.js
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3002';
const THROTTLE = { latency: 200, downloadThroughput: 6 * 1024 * 1024 / 8, uploadThroughput: 6 * 1024 * 1024 / 8 };

const ACC = { username: 'diag_tmp_1', password: 'Diag#2026tmp' };
const TPL_SELF = '/uploads/character-templates/char-1780308958337-973251791.glb';   // 新生成美女无皮 0.76MB
const TPL_SELF_ID = '3e7089c4-0b2e-46e3-b51e-6bcffdb186e1';
const TPL_C = '/uploads/character-templates/char-1780048961474-732397004.glb';      // 美女 4.86MB
const TPL_D = '/uploads/character-templates/char-1780047374315-163599099.glb';      // metool 9.5MB
const TPL_E = '/uploads/character-templates/char-1779180094927-135896146.glb';      // 拿剑武士（仅标识）
const ANIMS = [
  ['idle', '/uploads/anim-library/anim-1788167785209-773140698.glb'],
  ['walk', '/uploads/anim-library/anim-1788168032972-885973649.glb'],
  ['run', '/uploads/anim-library/anim-1779353424049-284795928.glb'],
  ['jump', '/uploads/anim-library/anim-1788167798666-521945808.glb'],
  ['attack1', '/uploads/anim-library/anim-1779410080245-425427073.glb'],
  ['attack2', '/uploads/anim-library/anim-1779416734316-192850102.glb'],
  ['attack3', '/uploads/anim-library/anim-1779359981454-823651996.glb'],
  ['hit', '/uploads/anim-library/anim-1779415657416-64578244.glb'],
];

function log(msg) { console.log('[sched] ' + msg); }
const NOISE = [/runtime\.lastError/i, /index\.global\.js/i, /favicon/i, /net::ERR_ABORTED/i, /net::ERR_CONNECTION/, /net::ERR_INTERNET/i];
const isNoise = (t) => NOISE.some((p) => p.test(t));

async function login() {
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ACC),
  });
  const data = await res.json();
  if (!data.token) throw new Error('login failed: ' + JSON.stringify(data));
  return data;
}

async function main() {
  const results = [];
  const auth = await login();
  log('登录成功: userId=' + auth.userId.slice(0, 8) + '...');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => {}));

    // ---- 请求时间线 ----
    const pageStart = Date.now();
    const charReq = []; // { t, url, phase:'start'|'end', status }
    page.on('request', (r) => {
      const u = r.url();
      if (/\/uploads\/character-templates\/.*\.glb/.test(u)) {
        charReq.push({ t: Date.now() - pageStart, url: u.split('/').pop(), phase: 'start' });
      }
    });
    page.on('response', (r) => {
      const u = r.url();
      if (/\/uploads\/character-templates\/.*\.glb/.test(u) && r.status() < 400) {
        charReq.push({ t: Date.now() - pageStart, url: u.split('/').pop(), phase: 'end' });
      }
    });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 200)));

    // ---- 登录态 + 模板键注入 ----
    await context.addInitScript(({ auth, tpl, tplId, anims }) => {
      localStorage.setItem('token', auth.token);
      localStorage.setItem('userId', auth.userId);
      localStorage.setItem('characterId', auth.characterId);
      localStorage.setItem('selectedTemplateGlbUrl', tpl);
      localStorage.setItem('selectedTemplateId', tplId);
      anims.forEach(([k, u]) => localStorage.setItem('selectedTemplateAnim_' + k, u));
    }, { auth, tpl: TPL_SELF, tplId: TPL_SELF_ID, anims: ANIMS });

    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: THROTTLE.latency,
      downloadThroughput: THROTTLE.downloadThroughput,
      uploadThroughput: THROTTLE.uploadThroughput,
    });
    log('CDP 限速已启用: 6Mbps / RTT 200ms');

    await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 40000 });
    await page.waitForFunction(() =>
      window.WorldReadyGate && window.PlayerModelScheduler && window.GltfTemplateCache &&
      window.gameWorld && window.player, null, { timeout: 40000 });
    log('模块与世界已挂载（cid=' + auth.characterId.slice(0, 8) + '...）');

    const cid = auth.characterId;

    // ============ 用例 1：单人 ============
    const t0 = Date.now();
    let readyDiag = null;
    while (Date.now() - t0 < 40000) {
      readyDiag = await page.evaluate(() => window.WorldReadyGate._diag());
      if (readyDiag.ready) break;
      await page.waitForTimeout(300);
    }
    if (!readyDiag || !readyDiag.ready) throw new Error('gate 未就绪');
    const tReadyDate = await page.evaluate((ms) => performance.timeOrigin + ms, readyDiag.tReadyMs);
    const T_ready = tReadyDate - pageStart;
    log('T_ready=' + Math.round(T_ready) + 'ms reason=' + readyDiag.reason);

    // 等自己角色上屏 + 8 动画可用
    let u1 = null;
    const t1 = Date.now();
    while (Date.now() - t1 < 30000) {
      u1 = await page.evaluate((cid) => {
        const pd = window.gameWorld.players.get(cid);
        if (!pd) return null;
        return {
          glbModel: !!pd.group.userData.glbModel,
          animKeys: Object.keys(pd.group.userData.animActions || {}),
          animMode: pd.group.userData.currentAnimMode || null,
        };
      }, cid);
      if (u1 && u1.glbModel && u1.animKeys.length >= 8) break;
      await page.waitForTimeout(400);
    }
    const selfDoneRel = Date.now() - pageStart; // 采样上界（含轮询间隔误差 ≤400ms）
    results.push({ name: 'U1a 自己角色已上屏', pass: !!(u1 && u1.glbModel), detail: JSON.stringify(u1) });
    results.push({ name: 'U1b 上屏 ≤ T_ready+8s', pass: !!(u1 && u1.glbModel && selfDoneRel <= T_ready + 8000 + 500), detail: 'selfDone≈' + selfDoneRel + 'ms T_ready=' + Math.round(T_ready) + 'ms（0.76MB 模型）' });
    results.push({ name: 'U1c 8 动画可用（无空转）', pass: !!(u1 && u1.animKeys.length >= 8), detail: 'animKeys=' + (u1 ? u1.animKeys.join(',') : 'none') });
    results.push({ name: 'U1d idle 自动播放', pass: !!(u1 && u1.animMode === 'idle'), detail: 'mode=' + (u1 && u1.animMode) });

    const sched1 = await page.evaluate(() => window.PlayerModelScheduler._diag());
    results.push({ name: 'U1e self 状态 done/active', pass: !!(sched1.selfState && sched1.selfState.state !== 'held'), detail: JSON.stringify(sched1.selfState) });

    // ============ 用例 2：双人同模板 ============
    await page.evaluate(({ cid, tpl }) => {
      const p = window.player.position;
      window.gameWorld.addPlayer('sched-remote-2', '测试B', { x: p.x + 3, y: p.y, z: p.z }, true, tpl);
    }, { cid, tpl: TPL_SELF });
    // 等远端2 模型就位（视野内 3m，evalTick 2s + 加载）
    const t2 = Date.now();
    let u2 = null;
    while (Date.now() - t2 < 25000) {
      u2 = await page.evaluate(() => {
        const pd = window.gameWorld.players.get('sched-remote-2');
        if (!pd) return null;
        return { glbModel: !!pd.group.userData.glbModel };
      });
      if (u2 && u2.glbModel) break;
      await page.waitForTimeout(400);
    }
    // 给远端2 注入 idle 动画（验证互不干扰）
    await page.evaluate((animUrl) => {
      window.gameWorld._loadPlayerAnimGlb('sched-remote-2', 'idle', animUrl);
    }, ANIMS[0][1]);
    await page.waitForTimeout(3000);
    const mix = await page.evaluate((cid) => {
      const a = window.gameWorld.players.get(cid);
      const b = window.gameWorld.players.get('sched-remote-2');
      if (!a || !b) return null;
      const inSubtree = (root, node) => {
        let cur = node;
        while (cur) { if (cur === root) return true; cur = cur.parent; }
        return false;
      };
      const ma = a.group.userData.sharedMixer, mb = b.group.userData.sharedMixer;
      return {
        aIdle: !!a.group.userData.animActions.idle,
        bIdle: !!b.group.userData.animActions.idle,
        mixersDistinct: !!ma && !!mb && ma !== mb,
        aRootInA: !!(ma && inSubtree(a.group.userData.glbModel, ma._root)),
        bRootInB: !!(mb && inSubtree(b.group.userData.glbModel, mb._root)),
        scenesDistinct: a.group.userData.glbModel !== b.group.userData.glbModel,
        matsIsolated: (() => {
          const am = [], bm = [];
          a.group.userData.glbModel.traverse((o) => { if (o.isMesh) am.push(o.material); });
          b.group.userData.glbModel.traverse((o) => { if (o.isMesh) bm.push(o.material); });
          return am.length > 0 && bm.length > 0 && !am.some((m) => bm.indexOf(m) >= 0);
        })()
      };
    }, cid);
    const cache2 = await page.evaluate(() => window.GltfTemplateCache._diag());
    // per-key 断言：真实在线玩家（其他模板）不计入本模板口径
    const selfKey = cache2.keys.find((k) => k.key.indexOf(TPL_SELF.split('/').pop()) >= 0);
    results.push({ name: 'U2a 远端2 同模板模型已上屏', pass: !!(u2 && u2.glbModel), detail: JSON.stringify(u2) });
    results.push({
      name: 'U2b 同模板解析一次（per-key parses===1）',
      pass: !!selfKey && selfKey.parses === 1 && selfKey.shared >= 2,
      detail: 'selfKey=' + JSON.stringify(selfKey) + '（第二人 hit 无网络请求）',
    });
    results.push({ name: 'U2c 克隆实例 ≥ 2（本模板）', pass: !!selfKey && selfKey.shared >= 2, detail: 'shared=' + (selfKey && selfKey.shared) + ' totalShared=' + cache2.sharedInstances });
    results.push({
      name: 'U2d 动画各自正确互不干扰',
      pass: !!(mix && mix.aIdle && mix.bIdle && mix.mixersDistinct && mix.aRootInA && mix.bRootInB && mix.scenesDistinct),
      detail: JSON.stringify(mix),
    });
    results.push({ name: 'U2e 材质隔离（共享纹理、独立材质）', pass: !!(mix && mix.matsIsolated), detail: 'matsIsolated=' + (mix && mix.matsIsolated) });

    // ============ 用例 3：视野过滤 + 并发 1 ============
    // C 置于 200m 外（用不同模板 URL 便于区分请求）；D 在视野内等接力
    await page.evaluate(({ tplC, tplD }) => {
      const p = window.player.position;
      window.gameWorld.addPlayer('sched-remote-C', '测试C', { x: p.x + 200, y: p.y, z: p.z }, true, tplC);
      window.gameWorld.addPlayer('sched-remote-D', '测试D', { x: p.x + 5, y: p.y, z: p.z + 5 }, true, tplD);
    }, { tplC: TPL_C, tplD: TPL_D });

    // 等 >2 个 evalTick，断言 C(200m) 未加载
    await page.waitForTimeout(5500);
    let vis = await page.evaluate(() => {
      const d = window.PlayerModelScheduler._diag();
      const pd = window.gameWorld.players.get('sched-remote-C');
      return {
        cModel: !!(pd && pd.group.userData.glbModel),
        queued: d.remoteQueued.map((t) => t.cid),
        active: d.remoteActive ? d.remoteActive.cid : null,
        blocks: d.blocks,
      };
    });
    const cReqsBefore = charReq.filter((r) => r.url === TPL_C.split('/').pop());
    results.push({ name: 'U3a 200m 外不加载（保持方块人）', pass: vis.cModel === false && cReqsBefore.length === 0, detail: JSON.stringify(vis) + ' cReqs=' + cReqsBefore.length });

    // C 移入 ≤25m（视野豁免区，避免 40m 恰在相机视锥外的构造误差）
    await page.evaluate(() => {
      const pd = window.gameWorld.players.get('sched-remote-C');
      const p = window.player.position;
      pd.group.position.set(p.x + 20, p.y, p.z);
    });
    // 等 evalTick 放行 C + 加载完成 + D 接力（真实在线玩家的模板也会占用并发 1 槽位，窗口放宽）
    const t3 = Date.now();
    let flow = null;
    let yieldProbe = null; // 让路探针：首次观察到有模型在途（active 非空）即触发
    while (Date.now() - t3 < 60000) {
      const s = await page.evaluate(() => {
        const d = window.PlayerModelScheduler._diag();
        const c = window.gameWorld.players.get('sched-remote-C');
        const dd = window.gameWorld.players.get('sched-remote-D');
        return {
          active: d.remoteActive ? d.remoteActive.cid : (d.selfState && d.selfState.state === 'active' ? 'self' : null),
          cModel: !!(c && c.group.userData.glbModel),
          dModel: !!(dd && dd.group.userData.glbModel),
        };
      });
      flow = s;
      if (yieldProbe === null && s.active !== null) {
        // 有玩家模型档在途：构造 >15MB 假队首对象，1.5s 后检查是否被消费（应否）
        yieldProbe = await page.evaluate(() => new Promise((resolve) => {
          const fake = {
            id: 'sched_fake_yield', type: 'uploaded_model', name: 'sched_fake_yield',
            fileSize: 20 * 1024 * 1024,
            position_x: window.player.position.x, position_z: window.player.position.z,
          };
          window.gameWorld.loadingQueue.unshift(fake);
          const before = window.PlayerModelScheduler._diag().blocks;
          setTimeout(() => {
            const idx = window.gameWorld.loadingQueue.findIndex((o) => o && o.id === 'sched_fake_yield');
            const consumed = idx < 0;
            if (idx >= 0) window.gameWorld.loadingQueue.splice(idx, 1); // 清理，防后续真实消费噪音
            const after = window.PlayerModelScheduler._diag();
            resolve({ before, blocks: after.blocks, consumed, active: after.remoteActive ? after.remoteActive.cid : null });
          }, 1500);
        }));
      }
      if (flow.cModel && flow.dModel) break;
      await page.waitForTimeout(300);
    }
    // 并发=1：全序列中 C 与 D 的模型到达顺序 + active 单值
    const cStart = charReq.filter((r) => r.url === TPL_C.split('/').pop() && r.phase === 'start').map((r) => r.t);
    const cEnd = charReq.filter((r) => r.url === TPL_C.split('/').pop() && r.phase === 'end').map((r) => r.t);
    const dStart = charReq.filter((r) => r.url === TPL_D.split('/').pop() && r.phase === 'start').map((r) => r.t);
    results.push({ name: 'U3b 移入后开始加载并上屏', pass: !!(flow && flow.cModel), detail: 'cStart=' + JSON.stringify(cStart) + ' cEnd=' + JSON.stringify(cEnd) });
    // 并发=1 的不变量：C 与 D 两个远端模型的请求区间互不重叠
    //（谁先谁后取决于注入时谁在视野内——D 注入即在 5m 视野内故先放行，C 移入后接力）
    const dEnd = charReq.filter((r) => r.url === TPL_D.split('/').pop() && r.phase === 'end').map((r) => r.t);
    results.push({
      name: 'U3c 并发 = 1（两远端请求区间不重叠）',
      pass: !!(cStart.length > 0 && cEnd.length > 0 && dStart.length > 0 && dEnd.length > 0 &&
        ((cStart[0] >= dEnd[dEnd.length - 1] - 200) || (dStart[0] >= cEnd[cEnd.length - 1] - 200))),
      detail: 'c=[' + cStart[0] + ',' + cEnd[0] + '] d=[' + dStart[0] + ',' + dEnd[0] + ']',
    });
    results.push({ name: 'U3d D 也完成（接力）', pass: !!(flow && flow.dModel), detail: JSON.stringify(flow) });
    results.push({
      name: 'U3e 让路包装（>15MB 本轮不启动）',
      pass: !!yieldProbe && yieldProbe.blocks > (yieldProbe.before || 0) && yieldProbe.consumed === false,
      detail: JSON.stringify(yieldProbe),
    });

    // ============ 用例 4：离队取消 ============
    const before4 = await page.evaluate(() => window.PlayerModelScheduler._diag());
    await page.evaluate(({ tpl }) => {
      const p = window.player.position;
      window.gameWorld.addPlayer('sched-remote-E', '测试E', { x: p.x + 200, y: p.y, z: p.z + 200 }, true, tpl);
    }, { tpl: TPL_E });
    await page.waitForTimeout(600);
    const queued4 = await page.evaluate(() => window.PlayerModelScheduler._diag().remoteQueued.map((t) => t.cid));
    results.push({ name: 'U4a 排队中（200m 外）', pass: queued4.indexOf('sched-remote-E') >= 0, detail: 'queued=' + JSON.stringify(queued4) });
    await page.evaluate(() => { window.gameWorld.removePlayer('sched-remote-E'); });
    await page.waitForTimeout(3500); // >1 evalTick
    const after4 = await page.evaluate(() => window.PlayerModelScheduler._diag());
    const eReqs = charReq.filter((r) => r.url === TPL_E.split('/').pop());
    results.push({
      name: 'U4b 队列清空且无请求无上屏',
      pass: after4.remoteQueued.every((t) => t.cid !== 'sched-remote-E') && eReqs.length === 0 && after4.canceled > (before4.canceled || 0),
      detail: JSON.stringify({ queued: after4.remoteQueued.map((t) => t.cid), eReqs: eReqs.length, canceled: after4.canceled }),
    });

    // ============ 反向断言：0~T_ready 无角色模板请求 ============
    const early = charReq.filter((r) => r.phase === 'start' && r.t < T_ready - 300);
    results.push({ name: 'R1 T_ready 前 0 条角色模板 GLB 请求', pass: early.length === 0, detail: 'early=' + early.length + ' T_ready=' + Math.round(T_ready) + 'ms' });
    const selfStarts = charReq.filter((r) => r.phase === 'start' && r.url === TPL_SELF.split('/').pop());
    results.push({ name: 'R2 自己角色请求 start ≥ T_ready', pass: selfStarts.length > 0 && selfStarts.every((r) => r.t >= T_ready - 300), detail: 'starts=[' + selfStarts.map((r) => r.t).join(',') + ']' });

    // ============ 汇总 ============
    const schedErrors = errors.filter((e) => /PlayerModelScheduler|GltfTemplateCache|ReadyGate/i.test(e));
    results.push({ name: 'E1 三个新模块 0 报错', pass: schedErrors.length === 0, detail: schedErrors.slice(0, 3).join(' | ') });
    if (errors.length > 0) log('（INFO）console 错误 ' + errors.length + ' 条（含环境噪音，不判定）: ' + errors.slice(0, 3).join(' || '));

    const failed = results.filter((r) => !r.pass);
    console.log('\n========== Step 3 验收结果 ==========');
    results.forEach((r) => console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  [' + r.detail + ']'));
    console.log('总计: ' + (results.length - failed.length) + '/' + results.length + ' PASS');
    process.exit(failed.length === 0 ? 0 : 1);
  } catch (e) {
    console.error('[sched] FATAL: ' + (e && e.stack || e));
    process.exit(2);
  } finally {
    await browser.close().catch(() => {});
  }
}

main();
