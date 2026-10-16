/**
 * 主世界首屏加载遮罩「光之门户」验收（loadingMask.js v1）
 * ------------------------------------------------------------------
 * 被测对象：public/js/loadingMask.js（自注入 CSS+DOM）+ index.html 的 1 行 <script>
 *
 * 判据：
 *   M1 首帧即遮罩：页面刚开始解析（commit）后 #loadingMask 已存在、铺满视口、
 *      且视口中心命中的就是遮罩（不白屏、不闪旧黑屏）
 *   M2 结构齐全：三重光环 + 光核 + 品牌 + 标题 + 提示 + 进度条
 *   M2b i18n 完好：带 data-i18n 的节点文案不等于其 key（防"缺键被 translatePage 覆盖成 key"）
 *   M3 进度单调递增：两次采样（1.5s 间隔）百分比不回退，且进度条已铺开
 *   M4 撤除：WorldReadyGate 就绪后 ≤1.5s 内撤下；撤下后中心点不再命中遮罩，
 *      且「开始游戏」按钮可被真实点击（命中测试通过）→ 遮罩不再挡交互
 *   M5 压住顶栏：遮罩期内 1000 级 body 级 fixed 元素（模拟 loadingProgress 顶栏）
 *      在视口顶部被遮罩盖住（z-index 1200 生效）
 *   M6 硬兜底：从导航到撤除 ≤17s（MAX_VISIBLE_MS 15s + 淡出 0.62s + 余量）
 *   M7 干净：0 console error / 0 pageerror（按 url 过滤 favicon 噪音）+ uiHidePatched=true
 *   M8 传送失败分支：?teleport=true&token=bad → 登录页出现时遮罩不再盖住它（独立 profile）
 *   M9 画布未出画时不撤罩（>15s 仍盖着，防"撤罩后黑屏"；独立 profile）
 *   M10 免遮档（v2）：本机曾成功进过世界（localStorage 标记）时，刷新不再出现完整遮罩，
 *       改为一层 pointer-events:none、无品牌内容、画布一出画就撤（≤5s）的渐变薄幕；
 *       且 show()（跨世界传送到达）仍能弹回完整遮罩
 *
 * 用法：node scripts/accept_loading_mask.js
 * 说明：①全程游客态（不登录），不依赖管理员账号 → 不受 admin 登录 IP 限流影响；
 *      ②默认走真 GPU 的 Chrome（channel:'chrome' + d3d11/ANGLE）——headless 软渲染
 *        （swiftshader）下主线程会被初始加载冻住 20s+，任何 JS 定时器都无法触发，
 *        会把「进度单调/硬兜底」测成假失败（已实测）；自动回退到内置 chromium。
 */
const { chromium } = require('playwright');
const sharp = require('sharp');

const BASE = process.env.LOADING_MASK_BASE || 'http://localhost:3002';
const GPU_ARGS = ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--hide-scrollbars'];
const SOFT_ARGS = ['--enable-unsafe-swiftshader', '--disable-gpu', '--hide-scrollbars'];

async function launchBrowser() {
  // 优先真 GPU Chrome（与项目其它验收同口径）；不可用时回退内置 chromium 软渲染
  try {
    const b = await chromium.launch({ channel: 'chrome', headless: true, args: GPU_ARGS });
    log('浏览器 = chrome 通道（真 GPU，ANGLE D3D11）');
    return { browser: b, mode: 'gpu' };
  } catch (e) {
    log('chrome 通道不可用（' + e.message.slice(0, 80) + '），回退内置 chromium 软渲染');
    const b = await chromium.launch({ headless: true, args: SOFT_ARGS });
    return { browser: b, mode: 'soft' };
  }
}

const results = [];
function push(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: String(detail == null ? '' : detail).slice(0, 200) });
  console.log((pass ? '  PASS  ' : '  FAIL  ') + name + '  [' + String(detail).slice(0, 160) + ']');
}
function log(m) { console.log('[loadingMask] ' + m); }

// 收集页面错误（favicon 噪音按 m.location().url 过滤：Chrome 的 "Failed to load resource" 文本不含 URL）
function attachErrorCollectors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const url = (m.location && m.location().url) || '';
    const text = m.text();
    if (/favicon\.ico/.test(url)) return;
    if (/runtime\.lastError|index\.global\.js|ResizeObserver/i.test(text)) return;
    errors.push((url ? url + ' :: ' : '') + text.slice(0, 180));
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e.message).slice(0, 180)));
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  return errors;
}

async function main() {
  const { browser, mode } = await launchBrowser();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = attachErrorCollectors(page);

  let navStart = 0;
  try {
    // ---------- M1 首帧即遮罩 ----------
    navStart = Date.now();
    await page.goto(BASE + '/', { waitUntil: 'commit', timeout: 40000 });
    await page.waitForSelector('#loadingMask', { state: 'attached', timeout: 8000 });
    const m1 = await page.evaluate(() => {
      const el = document.getElementById('loadingMask');
      const r = el.getBoundingClientRect();
      const hit = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2));
      const cs = getComputedStyle(el);
      return {
        display: cs.display, opacity: cs.opacity, z: cs.zIndex,
        w: Math.round(r.width), h: Math.round(r.height),
        vw: window.innerWidth, vh: window.innerHeight,
        coversViewport: r.width >= window.innerWidth - 1 && r.height >= window.innerHeight - 1,
        hitIsMask: !!(hit && (hit === el || el.contains(hit))),
        hitDesc: hit ? (hit.id || hit.className || hit.tagName) : 'null',
        phase: window.LoadingMask ? window.LoadingMask._diag().phase : null,
        injectedAtParse: true
      };
    });
    log('M1 ' + JSON.stringify(m1));
    push('M1 首帧即遮罩（铺满视口 + 中心命中遮罩）',
      m1.display === 'flex' && m1.coversViewport && m1.hitIsMask,
      'display=' + m1.display + ' size=' + m1.w + 'x' + m1.h + '/' + m1.vw + 'x' + m1.vh + ' hit=' + m1.hitDesc + ' phase=' + m1.phase);

    // ---------- M2 结构齐全 ----------
    const m2 = await page.evaluate(() => {
      const el = document.getElementById('loadingMask');
      const tip = el.querySelector('.lm-tip');
      return {
        rings: el.querySelectorAll('.lm-ring').length,
        core: el.querySelectorAll('.lm-core').length,
        brand: (el.querySelector('.lm-brand') || {}).textContent || '',
        title: (el.querySelector('.lm-title') || {}).textContent || '',
        tip: tip ? tip.textContent : '',
        barFill: !!el.querySelector('.lm-bar > i'),
        pctText: (el.querySelector('.lm-pct b') || {}).textContent || ''
      };
    });
    log('M2 ' + JSON.stringify(m2));
    push('M2 结构齐全（3 环 + 光核 + 品牌 + 标题 + 提示 + 进度条）',
      m2.rings === 3 && m2.core === 1 && m2.barFill && /GENESIS/.test(m2.brand) &&
      m2.title.length > 0 && m2.tip.length > 0 && /%$/.test(m2.pctText),
      'rings=' + m2.rings + ' core=' + m2.core + ' title="' + m2.title + '" pct=' + m2.pctText);

    // ---------- M2b i18n 完好 ----------
    const m2b = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('#loadingMask [data-i18n]').forEach((n) => {
        const k = n.getAttribute('data-i18n');
        if (n.textContent.trim() === k) bad.push(k);
      });
      const tip = document.querySelector('#loadingMask .lm-tip');
      return { bad, tip: tip ? tip.textContent.trim() : '', i18nReady: !!(window.i18n && window.i18n.initialized) };
    });
    push('M2b i18n 文案未被 key 覆盖', m2b.bad.length === 0,
      'badKeys=' + (m2b.bad.join(',') || '0') + ' tip="' + m2b.tip + '" i18nInit=' + m2b.i18nReady);

    // M2c 缺键自愈：模拟 translatePage 把 key 原文写进遮罩（= 线上语言包没同步时的真实故障态）
    await page.evaluate(() => {
      document.querySelectorAll('#loadingMask [data-i18n]').forEach((n) => {
        n.textContent = n.getAttribute('data-i18n');
      });
    });
    await page.waitForTimeout(1400);
    const m2c = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll('#loadingMask [data-i18n]').forEach((n) => {
        if (n.textContent.trim() === n.getAttribute('data-i18n')) bad.push(n.getAttribute('data-i18n'));
      });
      const tip = document.querySelector('#loadingMask .lm-tip');
      return { bad, tip: tip ? tip.textContent.trim() : '' };
    });
    push('M2c 语言包缺键时自愈为兜底文案', m2c.bad.length === 0,
      'badKeys=' + (m2c.bad.join(',') || '0') + ' tip="' + m2c.tip + '"');

    // ---------- M5 压住顶栏（遮罩期内，用合成探针模拟 1000 级 fixed 元素）----------
    const m5 = await page.evaluate(() => {
      const mask = document.getElementById('loadingMask');
      const phase = window.LoadingMask ? window.LoadingMask._diag().phase : null;
      if (!mask || phase === 'done') return { skipped: true, phase };
      const probe = document.createElement('div');
      probe.id = '__lmProbe';
      probe.setAttribute('style', 'position:fixed;top:0;left:0;width:100%;height:6px;z-index:1000;background:#f0f0f0');
      document.body.appendChild(probe);
      const cx = Math.floor(window.innerWidth / 2);
      const stackEls = document.elementsFromPoint(cx, 3);
      const probeIdx = stackEls.findIndex((e) => e.id === '__lmProbe');
      const maskIdx = stackEls.findIndex((e) => e.id === 'loadingMask');
      const stack = stackEls.slice(0, 6).map((e) => {
        const cs = getComputedStyle(e);
        return (e.id || String(e.className) || e.tagName) + '(z=' + cs.zIndex + ',op=' + cs.opacity + ')';
      });
      // 游客提示条（z-index:3000，会浮在遮罩上）：缺失时临时造一个探针，直接验证
      // body.lm-masking #guestBanner{display:none} 这条规则是否生效
      let banner = document.getElementById('guestBanner');
      const bannerProbe = !banner;
      if (bannerProbe) { banner = document.createElement('div'); banner.id = 'guestBanner'; document.body.appendChild(banner); }
      const bannerDisplay = getComputedStyle(banner).display;
      if (bannerProbe) banner.remove();
      const out = {
        skipped: false,
        // 判据：同一点上"探针层"必须低于"遮罩层"（z-index 1200 压住 1000）。
        // 不用 elementFromPoint 判 top：同一点上还可能有 z-index 更高的元素（如游客提示条 3000），
        // 那是本来就压在一切之上的常驻条，与本判据无关。
        probeCoveredByMask: probeIdx > -1 && maskIdx > -1 && probeIdx > maskIdx,
        stack: stack,
        maskZ: getComputedStyle(mask).zIndex,
        maskIsBodyChild: mask.parentElement === document.body,
        bannerDisplay: banner ? getComputedStyle(banner).display : 'absent',
        realBarExists: !!document.getElementById('loading-progress-container'),
        realBarDisplay: (document.getElementById('loading-progress-container') || { style: {} }).style.display
      };
      probe.remove();
      return out;
    });
    log('M5 ' + JSON.stringify(m5));
    push('M5 遮罩压住 body 级 1000 顶栏（z-index 1200 生效）',
      !m5.skipped && m5.probeCoveredByMask && m5.maskIsBodyChild,
      m5.skipped ? ('跳过：遮罩已撤 phase=' + m5.phase)
        : ('栈=' + (m5.stack || []).join(' > ') + ' maskZ=' + m5.maskZ +
           ' bodyChild=' + m5.maskIsBodyChild + ' 游客条display=' + m5.bannerDisplay +
           ' 真实顶栏=' + (m5.realBarExists ? 'display:' + m5.realBarDisplay : '未出现')));
    push('M5b 遮罩期内游客提示条被隐藏（上面"看得见点不动"的按钮不出现）',
      m5.skipped || m5.bannerDisplay === 'none', 'bannerDisplay=' + m5.bannerDisplay);

    // ---------- M3 进度单调递增 ----------
    // 采样序列（每 400ms 一次，最多 4s）：一方面证明「不回退」，一方面避免只取两点时
    // 恰好撞上主线程阻塞窗口导致假失败（软渲染下实测会连续 20s 无 tick）
    const series = [];
    let barWidthPx = 0;
    for (let i = 0; i < 10; i++) {
      const s = await page.evaluate(() => {
        const d = window.LoadingMask ? window.LoadingMask._diag() : null;
        const fill = document.querySelector('#loadingMask .lm-bar > i');
        return {
          pct: d ? d.pct : null, phase: d ? d.phase : null,
          barWidthPx: fill ? Math.round(fill.getBoundingClientRect().width) : 0
        };
      });
      series.push(s);
      barWidthPx = Math.max(barWidthPx, s.barWidthPx);
      if (s.phase === 'done' || s.pct >= 60) break;
      await page.waitForTimeout(400);
    }
    const vals = series.map((s) => s.pct).filter((v) => v != null);
    const nonDecreasing = vals.every((v, i) => i === 0 || v >= vals[i - 1]);
    const distinct = new Set(vals.map((v) => v.toFixed(2))).size;
    const doneNow = series.some((s) => s.phase === 'done');
    push('M3 进度单调不回退且进度条已铺开',
      nonDecreasing && distinct >= 2 && (barWidthPx > 0 || doneNow),
      'samples=[' + vals.map((v) => v.toFixed(1)).join(',') + '] distinct=' + distinct +
      ' barWidth=' + barWidthPx + 'px 浏览器=' + mode);

    // ---------- M4 撤除 ----------
    let removed = true;
    try {
      await page.waitForFunction(() => window.LoadingMask && window.LoadingMask._diag().phase === 'done', null, { timeout: 20000 });
    } catch (e) { removed = false; }
    const totalMs = Date.now() - navStart;
    const m4a = await page.evaluate(() => {
      const el = document.getElementById('loadingMask');
      const hit = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2));
      return {
        display: el ? el.style.display : null,
        opacity: el ? getComputedStyle(el).opacity : null,
        centerHitMask: !!(el && hit && (hit === el || el.contains(hit))),
        centerHit: hit ? (hit.id || hit.className || hit.tagName) : 'null',
        uiHidePatched: window.LoadingMask ? window.LoadingMask._diag().uiHidePatched : null,
        lastReason: window.LoadingMask ? window.LoadingMask._diag().lastReason : null,
        frames: window.LoadingMask ? window.LoadingMask._diag().frames : null,
        canvasDrewFrames: window.LoadingMask ? window.LoadingMask._diag().canvasDrewFrames : null
      };
    });
    push('M4 遮罩已撤下且不再挡交互', removed && m4a.display === 'none' && !m4a.centerHitMask,
      'phase done=' + removed + ' display=' + m4a.display + ' centerHit=' + m4a.centerHit +
      ' 原因=' + m4a.lastReason + ' 用时=' + totalMs + 'ms 帧=' + m4a.frames + ' 出画过=' + m4a.canvasDrewFrames);

    // 真实点击「开始游戏」：会做命中测试，可证明遮罩（或别的层）不再拦截
    let clickOK = false, hintHidden = null, clickErr = '', hitAtBtn = '';
    try {
      hitAtBtn = await page.evaluate(() => {
        const b = document.getElementById('close-controls-hint');
        if (!b) return 'no-button';
        const r = b.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
        return hit ? (hit.id || String(hit.className) || hit.tagName) : 'null';
      });
      await page.click('#close-controls-hint', { timeout: 6000 });
      await page.waitForTimeout(200);
      hintHidden = await page.evaluate(() => {
        const h = document.getElementById('controls-hint');
        return h ? getComputedStyle(h).display : null;
      });
      clickOK = hintHidden === 'none';
    } catch (e) { clickOK = false; clickErr = String(e.message).slice(0, 90); }
    push('M4b 「开始游戏」按钮可真实点击（命中测试通过）', clickOK,
      'clicked=' + clickOK + ' 按钮中心命中=' + hitAtBtn + ' controls-hint.display=' + hintHidden +
      (clickErr ? ' err=' + clickErr : ''));

    // M4c 撤罩后画面非黑（端到端兜底判据）：
    // alpha:false 的 opaque 画布若"从未绘制"或"drawingBuffer 被重新分配后未重画"，按规范就是纯黑，
    // 而 body 底色也是 #000 → 这就是线上"遮罩撤下后一段黑屏"的画面。这里直接量像素。
    let shotLuma = -1;
    try {
      const buf = await page.screenshot();
      const { data, info: ii } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
      let sum = 0, n = 0;
      const step = ii.channels * 37;
      for (let i = 0; i + 2 < data.length; i += step) { sum += (data[i] + data[i + 1] + data[i + 2]) / 3; n++; }
      shotLuma = +(sum / Math.max(1, n)).toFixed(1);
    } catch (e) { /* 截图失败按 -1 判失败 */ }
    // 判据已从"整页截图是否纯黑"改为"画布是否真的出过画"：
    // body 底色改为品牌渐变后整页永远有亮度，luma 对"画布黑屏"不再有判别力。
    push('M4c 撤罩后画布确实已出画（body 改渐变后不再用亮度判定）',
      m4a.canvasDrewFrames === true && (m4a.frames | 0) >= 3,
      'canvasDrewFrames=' + m4a.canvasDrewFrames + ' frames=' + m4a.frames + ' 截图亮度=' + shotLuma + '(仅参考)');

    // M5c 撤罩后游客提示条恢复显示（body 上的 lm-masking 已摘除）
    const m5c = await page.evaluate(() => {
      const b = document.getElementById('guestBanner');
      return { exists: !!b, display: b ? getComputedStyle(b).display : 'absent', bodyCls: document.body.className };
    });
    push('M5c 撤罩后游客提示条恢复显示', !m5c.exists || m5c.display !== 'none',
      JSON.stringify(m5c));

    push('M6 硬兜底：导航→撤除 ≤17s', totalMs <= 17000, totalMs + 'ms（原因=' + m4a.lastReason + '）');

    // ---------- M7 干净 ----------
    const realErrors = errors.filter((t) => !/Failed to load resource/i.test(t));
    push('M7 0 console error / 0 pageerror', realErrors.length === 0,
      realErrors.length ? realErrors.slice(0, 5).join(' || ') : '0');
    push('M7b 已包装 UI.hideLoadingScreen（保护期生效）', m4a.uiHidePatched === true, 'uiHidePatched=' + m4a.uiHidePatched);
  } catch (e) {
    push('主流程异常', false, e.message);
  } finally {
    await page.close();
  }

  // ---------- M8 传送失败分支 ----------
  // 用独立 context（全新 profile）：本流程走完后同一 context 里已带"曾进过世界"标记，
  // 而本条要验的正是"完整遮罩在场时不挡登录页"，必须在首访态（无标记）下测。
  try {
    const ctx8 = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const p8 = await ctx8.newPage();
    const err8 = attachErrorCollectors(p8);
    await p8.goto(BASE + '/?teleport=true&token=definitely_invalid_token', { waitUntil: 'load', timeout: 40000 });
    await p8.waitForFunction(() => {
      const login = Array.from(document.body.children).find(
        (d) => /z-index:\s*2000/.test(d.getAttribute('style') || ''));
      return !!login;
    }, null, { timeout: 15000 }).catch(() => {});
    await p8.waitForTimeout(2500);
    const m8 = await p8.evaluate(() => {
      const login = Array.from(document.body.children).find(
        (d) => /z-index:\s*2000/.test(d.getAttribute('style') || ''));
      const mask = document.getElementById('loadingMask');
      const hit = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2));
      return {
        loginShown: !!login,
        maskDisplay: mask ? mask.style.display : 'absent',
        centerHitMask: !!(mask && hit && (hit === mask || mask.contains(hit))),
        phase: window.LoadingMask ? window.LoadingMask._diag().phase : null
      };
    });
    log('M8 ' + JSON.stringify(m8));
    const m8err = err8.filter((t) => !/Failed to load resource|401|403/i.test(t));
    push('M8 传送失败→登录页不被遮罩盖住', m8.loginShown && !m8.centerHitMask,
      'loginShown=' + m8.loginShown + ' maskDisplay=' + m8.maskDisplay + ' centerHitMask=' + m8.centerHitMask +
      ' phase=' + m8.phase + (m8err.length ? ' | errors=' + m8err.slice(0, 2).join(' || ') : ''));
    await ctx8.close();
  } catch (e) {
    push('M8 传送失败分支', false, e.message);
  }

  // ---------- M9 画布未出画时不撤罩（防"撤罩后黑屏"）----------
  // 机理：body 底色 #000 + WebGL 画布在渲染器出第一帧前是透明的 → 撤罩若无画面就是纯黑。
  // 这里"冻结帧号"模拟慢网/弱机撤罩那一刻画布还没出画的状态（线上实测过）。
  // 同样用独立 context：免遮档档位下遮罩一开始就不显示，本条要验的"未出画时不撤罩"
  // 只能在首访态（完整遮罩）下测。
  try {
    const ctx9 = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
    const p9 = await ctx9.newPage();
    attachErrorCollectors(p9);
    await p9.goto(BASE + '/', { waitUntil: 'commit', timeout: 40000 });
    await p9.waitForSelector('#loadingMask', { state: 'attached', timeout: 10000 });
    const froze = await p9.waitForFunction(() => !!(window.gameWorld && window.gameWorld.renderer), null, { timeout: 20000 })
      .then(() => p9.evaluate(() => {
        const info = window.gameWorld.renderer.info;
        const frozenAt = info.render.frame;
        Object.defineProperty(info.render, 'frame', { get: () => frozenAt, set: () => {}, configurable: true });
        return { frozenAt };
      })).catch((e) => ({ err: e.message.slice(0, 60) }));
    // 等超过"画布已出画"档的硬兜底（15s），若闸门失效此刻遮罩早该被撤掉了
    await p9.waitForTimeout(16000);
    const st = await p9.evaluate(() => {
      const d = window.LoadingMask._diag();
      const rg = window.WorldReadyGate && window.WorldReadyGate._diag ? window.WorldReadyGate._diag() : null;
      return { phase: d.phase, reason: d.lastReason, frames: d.frames, drew: d.canvasDrewFrames, gateReady: rg ? rg.ready : null };
    });
    push('M9a 画布未出画时不撤罩（>15s 仍盖着，不露纯黑）',
      froze && !froze.err && st.phase === 'running' && st.reason === null,
      '冻结=' + JSON.stringify(froze) + ' 16s后 ' + JSON.stringify(st));

    // 解冻 → 帧号恢复推进 → 应立即撤罩（reason=ready）
    await p9.evaluate(() => {
      const info = window.gameWorld.renderer.info;
      const v = info.render.frame;
      Object.defineProperty(info.render, 'frame', { value: v, writable: true, enumerable: true, configurable: true });
    });
    let recovered = true;
    try {
      await p9.waitForFunction(() => window.LoadingMask._diag().phase === 'done', null, { timeout: 8000 });
    } catch (e) { recovered = false; }
    const after9 = await p9.evaluate(() => window.LoadingMask._diag());
    push('M9b 画布恢复出画后立即撤罩', recovered && after9.lastReason === 'ready',
      'phase=' + after9.phase + ' reason=' + after9.lastReason + ' frames=' + after9.frames);
    await ctx9.close();
  } catch (e) {
    push('M9 画布未出画闸门', false, e.message);
  }

  // ---------- M10 免遮档（老玩家刷新不再出现完整遮罩）----------
  // 场景：同一个 context（= 本机已成功进过世界、localStorage 已写标记）再开一个页面。
  // 采样器用 addInitScript 在文档最早注入，才能抓到只存在约 0.5s 的薄幕现场。
  try {
    const p10 = await context.newPage();
    const err10 = attachErrorCollectors(p10);
    await p10.addInitScript(() => {
      window.__lmEarlySamples = [];
      const t0 = performance.now();
      const timer = setInterval(() => {
        const el = document.getElementById('loadingMask');
        if (el) {
          const cs = getComputedStyle(el);
          const kid = el.firstElementChild ? getComputedStyle(el.firstElementChild).display : null;
          const d = window.LoadingMask && window.LoadingMask._diag ? window.LoadingMask._diag() : null;
          window.__lmEarlySamples.push({
            t: Math.round(performance.now() - t0),
            cls: String(el.className), display: el.style.display || cs.display,
            pe: cs.pointerEvents, childDisplay: kid,
            bodyCls: document.body ? String(document.body.className) : '',
            phase: d ? d.phase : null, mode: d ? d.mode : null
          });
        }
        if (window.__lmEarlySamples.length > 150) clearInterval(timer);
      }, 60);
    });

    const navT10 = Date.now();
    await p10.goto(BASE + '/', { waitUntil: 'commit', timeout: 40000 });
    let done10 = true;
    try {
      await p10.waitForFunction(() => window.LoadingMask && window.LoadingMask._diag().phase === 'done', null, { timeout: 20000 });
    } catch (e) { done10 = false; }
    const ms10 = Date.now() - navT10;

    const d10 = await p10.evaluate(() => {
      const s = window.__lmEarlySamples || [];
      let entered = null;
      try { entered = localStorage.getItem('genesis_entered_world'); } catch (e) { entered = 'unreadable'; }
      return {
        diag: window.LoadingMask._diag(),
        entered: entered,
        sampleCount: s.length,
        curtainSamples: s.filter((x) => x.mode === 'curtain').length,
        shownCurtain: s.filter((x) => x.mode === 'curtain' && x.cls.indexOf('lm-curtain') >= 0 && x.display !== 'none').length,
        badPointerEvents: s.filter((x) => x.mode === 'curtain' && x.display !== 'none' && x.pe !== 'none').length,
        badChildVisible: s.filter((x) => x.mode === 'curtain' && x.display !== 'none' && x.childDisplay !== 'none').length,
        badMaskingBody: s.filter((x) => /lm-masking/.test(x.bodyCls)).length
      };
    });
    log('M10 ' + JSON.stringify({ diag: d10.diag, entered: d10.entered, samples: d10.sampleCount, curtain: d10.curtainSamples, shown: d10.shownCurtain }));

    push('M10a 首访成功后写入"曾进过世界"标记（localStorage）', d10.entered === '1', 'marker=' + d10.entered);
    push('M10b 刷新走免遮档薄幕路径（mode=curtain，未回到完整遮罩）',
      d10.diag.mode === 'curtain' && d10.curtainSamples > 0,
      'mode=' + d10.diag.mode + ' curtainSamples=' + d10.curtainSamples + '/' + d10.sampleCount);
    push('M10c 薄幕不挡点击（pointer-events:none 全程成立）', d10.badPointerEvents === 0,
      '违规样本=' + d10.badPointerEvents + ' 铺过薄幕的样本=' + d10.shownCurtain);
    push('M10d 薄幕不含品牌/进度内容（子元素不可见）', d10.badChildVisible === 0,
      '违规样本=' + d10.badChildVisible);
    push('M10e 免遮档下不隐藏游客提示条（body 无 lm-masking）', d10.badMaskingBody === 0,
      '违规样本=' + d10.badMaskingBody);
    push('M10f 薄幕很快撤除（≤5s，不等 12s 兜底）', done10 && d10.diag.phase === 'done' && ms10 <= 5000,
      'phase=' + d10.diag.phase + ' 用时=' + ms10 + 'ms reason=' + d10.diag.lastReason);

    // 传送到达联动：show() 必须能把薄幕升级回完整品牌遮罩
    const sf = await p10.evaluate(() => {
      window.LoadingMask.show();
      const el = document.getElementById('loadingMask');
      const cs = getComputedStyle(el);
      return {
        display: el.style.display, pe: cs.pointerEvents, cls: String(el.className),
        body: String(document.body.className), mode: window.LoadingMask._diag().mode
      };
    });
    push('M10g 免遮档下 show() 仍能弹回完整遮罩（跨世界传送到达联动未破坏）',
      sf.display === 'flex' && sf.cls.indexOf('lm-curtain') < 0 && sf.pe !== 'none' &&
      /lm-masking/.test(sf.body) && sf.mode === 'full', JSON.stringify(sf));
    await p10.evaluate(() => window.LoadingMask.hide());

    const real10 = err10.filter((t) => !/Failed to load resource/i.test(t));
    push('M10h 免遮档路径 0 console error / 0 pageerror', real10.length === 0,
      real10.length ? real10.slice(0, 3).join(' || ') : '0');
    await p10.close();
  } catch (e) {
    push('M10 免遮档薄幕', false, e.message);
  }

  await browser.close();

  console.log('\n===== LOADING MASK RESULTS =====');
  let failed = 0;
  for (const r of results) {
    console.log((r.pass ? 'PASS' : 'FAIL') + '  ' + r.name + '  [' + r.detail + ']');
    if (!r.pass) failed++;
  }
  console.log('===== ' + (results.length - failed) + '/' + results.length + ' passed =====');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('[loadingMask] FATAL', e); process.exit(1); });
