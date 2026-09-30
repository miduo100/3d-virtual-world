/**
 * check_mcp_directories.js — 检查 MCP 目录站是否已收录 agent-virtual-world
 *
 * 判定方式：用我们独有的文案做指纹（搜索页会把查询词回显，不能只看"是否含包名"）。
 * 指纹：'Give your AI a body'（one-liner）/ 'miduo100'（世界域名）/ 'step into a running multiplayer'
 *
 * 用法：cd l:\shegnjir185 && node scripts/check_mcp_directories.js
 * 环境：本机访问国外站点需走系统代理（默认 127.0.0.1:7993，可用 PROXY_SERVER 覆盖）
 */
const { chromium } = require('playwright');

const PROXY = process.env.PROXY_SERVER || 'http://127.0.0.1:7993';
const FINGERPRINTS = [/give your ai a body/i, /miduo100/i, /step into a running multiplayer/i];
const NEGATIVE = [/no servers match/i, /0 results/i, /no plugins found/i, /no results/i];

const PAGES = [
  ['mcp.so', 'https://mcp.so/search?q=agent-virtual-world'],
  ['smithery', 'https://smithery.ai/servers?q=agent-virtual-world'],
  ['cursor.directory', 'https://cursor.directory/mcp?q=agent-virtual-world'],
  ['pulsemcp', 'https://www.pulsemcp.com/servers?q=agent-virtual-world'],
];

// 目录站的「条目直探」：比搜索页可靠得多 —— Glama 的搜索不认 URL 查询参数，
// 但它的条目页是 /mcp/servers/<owner>/<repo>，直接探这个 URL 才是权威口径。
const ENTRY_PROBES = [
  ['glama (条目直探)', 'https://glama.ai/mcp/servers/miduo100/agent-virtual-world', /by miduo100/i],
  ['glama (候选2)', 'https://glama.ai/mcp/servers/miduo100/miduo', /by miduo100/i],
];

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true, proxy: { server: PROXY } });
  for (const [name, url] of PAGES) {
    const p = await b.newPage();
    let verdict = '无法判定';
    let detail = '';
    try {
      await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p.waitForTimeout(7000);
      const t = await p.evaluate(() => document.body.innerText || '');
      const hitFp = FINGERPRINTS.find((re) => re.test(t));
      const hitNeg = NEGATIVE.find((re) => re.test(t));
      if (hitFp) {
        verdict = '✅ 已收录';
        const i = t.search(/miduo100|give your ai a body/i);
        detail = t.slice(Math.max(0, i - 100), i + 160).replace(/\n+/g, ' ⏎ ').slice(0, 260);
      } else if (hitNeg) {
        verdict = '❌ 未收录';
        detail = '页面明确显示：' + t.match(hitNeg)[0];
      } else if (/access denied|verify you are human|安全验证/i.test(t)) {
        verdict = '⚠️ 被反爬拦截';
        detail = t.slice(0, 80).replace(/\n+/g, ' ');
      } else {
        detail = '无指纹、无否定标志（可能仍在审核/抓取中）';
      }
    } catch (e) {
      verdict = '⚠️ 访问失败';
      detail = String(e.message).slice(0, 90);
    }
    console.log('■ ' + name.padEnd(18) + verdict + '   ' + detail);
    await p.close();
  }

  // 条目直探（权威口径）
  for (const [name, url, marker] of ENTRY_PROBES) {
    const p3 = await b.newPage();
    try {
      await p3.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await p3.waitForTimeout(6000);
      const t = await p3.evaluate(() => document.body.innerText || '');
      console.log('■ ' + name.padEnd(20) + (marker.test(t) ? '✅ 已收录' : '❌ 未收录') + '   ' + url);
    } catch (e) {
      console.log('■ ' + name.padEnd(20) + '⚠️ 访问失败   ' + String(e.message).slice(0, 80));
    }
    await p3.close();
  }

  // awesome-mcp-servers：直接查 README（无 JS、无回显问题）
  const p2 = await b.newPage();
  try {
    await p2.goto('https://raw.githubusercontent.com/appcypher/awesome-mcp-servers/main/README.md', { waitUntil: 'domcontentloaded', timeout: 30000 });
    const body = await p2.evaluate(() => document.body.innerText || '');
    const hit = /agent-virtual-world/i.test(body);
    console.log('■ ' + 'awesome-mcp-servers'.padEnd(18) + (hit ? '✅ 已收录' : '❌ 未收录') + '   (README ' + body.length + ' 字节)');
  } catch (e) {
    console.log('■ awesome-mcp-servers ⚠️ 访问失败  ' + String(e.message).slice(0, 80));
  }
  await b.close();
})();
