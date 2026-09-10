/**
 * 联邦注册可达性检查器 验收脚本
 * 运行: node scripts/test_federation_register_guard.js
 *
 * 覆盖:
 *   A. classifyUrlHost 样本集（公网/私网/非法/边界）
 *   B. checkRegistration 私网拒绝（未开 override，不发网络请求）
 *   C. checkRegistration 非法 URL 拒绝
 *   D. FEDERATION_ALLOW_PRIVATE=1 + 本地 mock /info（worldId 匹配）→ reachable
 *   E. worldId 不匹配 → worldid_mismatch
 *   F. 公网死地址 → unreachable（真实超时路径）
 *   G. 回拨并发闸：6 并发时 mock 观察到的同时连接数 ≤ 3
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'development';

const http = require('http');
const os = require('os');

const MODULE_PATH = require('path').join(__dirname, '..', 'src', 'services', 'worldReachabilityChecker.js');

let passCount = 0, failCount = 0;
function check(name, cond, detail) {
  if (cond) { passCount++; console.log(`  PASS  ${name}`); }
  else { failCount++; console.error(`  FAIL  ${name}${detail ? ' | ' + detail : ''}`); }
}

// ============ A. classifyUrlHost ============
function testClassify() {
  console.log('\n[A] classifyUrlHost 样本集');
  delete process.env.FEDERATION_ALLOW_PRIVATE;
  // 重新加载以脱离缓存影响
  delete require.cache[MODULE_PATH];
  const { classifyUrlHost } = require(MODULE_PATH);

  const cases = [
    // [url, expected]
    ['http://localhost:3002', 'private'],
    ['http://127.0.0.1:3002', 'private'],
    ['http://127.200.1.1:80', 'private'],
    ['http://192.168.1.5:3002', 'private'],
    ['http://10.0.0.7:3002', 'private'],
    ['http://172.16.0.1:3002', 'private'],
    ['http://172.31.255.255:3002', 'private'],
    ['http://172.32.0.1:3002', 'public'],      // 边界: 172.32 不属私网
    ['http://169.254.3.4:3002', 'private'],    // 链路本地
    ['http://0.0.0.0:3002', 'private'],
    ['http://100.64.0.1:3002', 'private'],     // CGNAT
    ['http://100.128.0.1:3002', 'public'],     // CGNAT 之外
    ['http://mypc.local:3002', 'private'],     // mDNS
    [`http://${os.hostname().toLowerCase()}:3002`, 'private'],
    ['https://miduo100.com', 'public'],
    ['http://8.8.8.8:3002', 'public'],
    ['http://203.0.113.1:3002', 'public'],     // TEST-NET-3, 格式合法的公网段
    ['http://[::1]:3002', 'private'],
    ['http://[fe80::1]:3002', 'private'],
    ['http://[fd00::1]:3002', 'private'],
    ['http://[2408:8207::1]:3002', 'public'],
    ['ftp://example.com', 'invalid'],
    ['not a url', 'invalid'],
    ['', 'invalid']
  ];
  for (const [url, expected] of cases) {
    const r = classifyUrlHost(url);
    check(`"${url}" → ${expected}`, r.type === expected, `got ${r.type}`);
  }
}

// ============ B/C. checkRegistration 静态拒绝 ============
async function testStaticReject() {
  console.log('\n[B/C] checkRegistration 私网/非法拒绝（零网络 I/O）');
  delete process.env.FEDERATION_ALLOW_PRIVATE;
  delete require.cache[MODULE_PATH];
  const { checkRegistration } = require(MODULE_PATH);

  const t0 = Date.now();
  const r1 = await checkRegistration({ worldId: 'w1', worldUrl: 'http://192.168.1.5:3002' });
  check('私网 IP → private_url', !r1.allowed && r1.code === 'private_url', JSON.stringify(r1));
  const r2 = await checkRegistration({ worldId: 'w1', worldUrl: 'http://localhost:3002' });
  check('localhost → private_url', !r2.allowed && r2.code === 'private_url');
  const r3 = await checkRegistration({ worldId: 'w1', worldUrl: '::::' });
  check('非法 URL → invalid_url', !r3.allowed && r3.code === 'invalid_url');
  const elapsed = Date.now() - t0;
  check('三次静态拒绝总耗时 < 2s（证明未做网络请求）', elapsed < 2000, `${elapsed}ms`);
}

// ============ 本地 mock 世界（/api/federation/info）============
function startMockWorld(port, worldId) {
  let active = 0, maxActive = 0;
  const server = http.createServer((req, res) => {
    active++; maxActive = Math.max(maxActive, active);
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true,
        world: { worldId, worldName: 'MockWorld', worldUrl: `http://127.0.0.1:${port}`, publicKey: 'k' }
      }));
      active--;
    }, 50);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({
    server, url: `http://127.0.0.1:${port}`, getMaxActive: () => maxActive
  })));
}

// ============ D/E/G. override + mock ============
async function testCallback() {
  console.log('\n[D/E/G] 回拨验证（FEDERATION_ALLOW_PRIVATE=1 + 本地 mock 世界）');
  process.env.FEDERATION_ALLOW_PRIVATE = '1';
  delete require.cache[MODULE_PATH];
  const { checkRegistration, verifyReachability } = require(MODULE_PATH);

  const mock = await startMockWorld(35501, 'world_mock_1');

  // D. worldId 匹配 → 放行
  const rD = await checkRegistration({ worldId: 'world_mock_1', worldUrl: mock.url });
  check('回拨可达且 worldId 匹配 → allowed', rD.allowed && rD.code === 'reachable', JSON.stringify(rD));

  // E. worldId 不匹配 → 拒绝
  const rE = await checkRegistration({ worldId: 'world_impostor', worldUrl: mock.url });
  check('worldId 不匹配 → worldid_mismatch', !rE.allowed && rE.code === 'worldid_mismatch', JSON.stringify(rE));

  // G. 并发闸：6 个并发回拨，mock 观察到的同时连接数 ≤ 3
  await Promise.all(Array.from({ length: 6 }, () =>
    verifyReachability(mock.url, 'world_mock_1', 3000)));
  const maxActive = mock.getMaxActive();
  check(`并发闸生效（观察峰值 ${maxActive} ≤ 3）`, maxActive <= 3, `peak=${maxActive}`);

  mock.server.close();

  // F. 公网死地址（TEST-NET-3 不可路由）→ unreachable（真实超时，约 2×3s）
  console.log('\n[F] 公网死地址回拨超时（约 6-7 秒）');
  const t0 = Date.now();
  const rF = await checkRegistration({ worldId: 'w1', worldUrl: 'http://203.0.113.1:3002' });
  check('不可达公网地址 → unreachable', !rF.allowed && rF.code === 'unreachable', JSON.stringify(rF));
  console.log(`  (耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

(async () => {
  console.log('========== 联邦注册可达性检查器 验收 ==========');
  testClassify();
  await testStaticReject();
  await testCallback();

  console.log('\n==============================================');
  console.log(`结果: PASS=${passCount}  FAIL=${failCount}`);
  process.exit(failCount > 0 ? 1 : 0);
})().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(1);
});
