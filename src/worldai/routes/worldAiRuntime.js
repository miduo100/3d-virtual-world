/**
 * worldAiRuntime 路由（/api/world-ai/runtime/*，Phase 2b · P1-7/8/9）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 挂载在 worldAi.js 的 router.use('/runtime', ...) 之下 → 继承 authenticateAdminToken。
 * 端点与 §C.2 契约一致：GET 状态 / start|pause|resume|stop|restart / tick（手动一轮，调试用）。
 * 业务失败（如 RUNTIME_DISABLED / ALREADY_RUNNING）一律 400 + code，绝不 500。
 */
const express = require('express');
const router = express.Router();
const runtime = require('../runtime/worldAiRuntime');

function send(res, r) {
  if (r && r.ok) return res.json(Object.assign({ success: true }, r));
  return res.status(400).json(Object.assign({ success: false }, r));
}

router.get('/', async (req, res) => {
  try { res.json({ success: true, runtime: await runtime.getStatus() }); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/start', async (req, res) => {
  try { send(res, await runtime.start(req.body || {})); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/pause', async (req, res) => {
  try { send(res, await runtime.pause()); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/resume', async (req, res) => {
  try { send(res, await runtime.resume()); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/stop', async (req, res) => {
  try { send(res, await runtime.stop()); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/restart', async (req, res) => {
  try { send(res, await runtime.restart(req.body || {})); }
  catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// 手动触发一轮（调试用）：仅管理员；injectPlan 仅演练口径（与 missionRunner 验收同款）
router.post('/tick', async (req, res) => {
  try {
    const b = req.body || {};
    send(res, await runtime.tickNow(b.injectPlan ? { injectPlan: b.injectPlan } : {}));
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
