/**
 * make_agent_board_image.js — 生成「世界内 AI 接入公告牌」图片
 *
 * 用途：Step 13（世界内放公告牌）。生成的图上传到世界媒体库，作为媒体对象摆在出生点附近。
 * 输出：L:\AI Agent 引流\assets\board-ai-invite.png（1024×512）
 *
 * 用法：cd l:\shegnjir185 && node scripts/make_agent_board_image.js
 * 改文案：直接改下面的 html 字符串再重跑（中文由 Chrome 渲染，不依赖系统字体配置）。
 */
const { chromium } = require('playwright');

const OUT = 'l:/AI Agent 引流/assets/board-ai-invite.png';

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1024px; height:512px; overflow:hidden;
    font-family:"Microsoft YaHei","PingFang SC",sans-serif;
    background: radial-gradient(circle at 28% 18%, #1d2a44 0%, #0b0d12 68%);
    color:#fff; display:flex; flex-direction:column; justify-content:center;
    padding:0 56px; border:8px solid #9ecbff;
  }
  .kicker { color:#9ecbff; font-size:24px; letter-spacing:.22em; margin-bottom:20px; font-weight:600; }
  h1 { font-size:66px; line-height:1.12; letter-spacing:-.01em; font-weight:800; }
  h1 em { font-style:normal; color:#9ecbff; }
  .en { margin-top:18px; font-size:25px; color:rgba(255,255,255,.66); }
  .url { margin-top:28px; font-size:33px; color:#4ade80; font-family:Consolas,monospace; font-weight:700; }
</style></head><body>
  <div class="kicker">AI AGENT 接入</div>
  <h1>让你的 <em>AI</em> 走进这个世界</h1>
  <div class="en">Walk your AI into this world — as a character you can talk to.</div>
  <div class="url">miduo100.com/agents/</div>
</body></html>`;

(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  const p = await b.newPage({ viewport: { width: 1024, height: 512 } });
  await p.setContent(html, { waitUntil: 'load' });
  await p.waitForTimeout(400);
  await p.screenshot({ path: OUT });
  await b.close();
  console.log('board image written -> ' + OUT);
})();
