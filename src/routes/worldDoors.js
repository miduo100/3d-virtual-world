/**
 * worldDoors —— 世界内门的开关（按 E 开关 · 服务端权威）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 三件事：
 *   ① 校验：登录用户 → 角色属主 → 用「玩家 WS 实时位置」与该对象锚点比距离
 *   ② 持久化：world_objects.custom_config.doors[doorId] = { open, at, by }
 *      （merge 写入，绝不覆盖 custom_config 里其它键）
 *   ③ 广播：向 45m 内玩家发 DOOR_STATE，其余客户端同步播放（排除发起者自己）
 *
 * 前端配套：public/js/worldDoors.js
 * 说明：门只是场景状态（不涉及奖励/金额），且建筑锚点 ≠ 门的确切坐标，
 *       所以距离阈值取宽松值 NEAR_OBJECT_M；真正的「走近才能按 E」由前端 5m 判定。
 *
 * 红线：不改 wsServer.js（用其导出的 broadcastToNearby），不碰 world.js。
 */
const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

const NEAR_OBJECT_M = 30;      // 玩家与对象锚点的最大允许距离（宽松：锚点在建筑内部）
const BROADCAST_RANGE_M = 45;  // 广播半径
const DOOR_ID_MAX = 40;
// 门节点名白名单：door / doors / gate / gate_L / door-leaf / door_1 ...
const DOOR_ID_RE = /^(door|doors|gate|gates)([-_][a-z0-9]+)*$/i;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function dist2d(a, b) {
  if (!a || !b) return Infinity;
  const dx = Number(a.x) - Number(b.x);
  const dz = Number(a.z) - Number(b.z);
  return Math.sqrt(dx * dx + dz * dz);
}

/** 从 WS 在线表找该角色的实时位置（玩家必须真的在世界里） */
function findLivePosition(characterId) {
  try {
    const ws = require('../websocket/wsServer');
    const map = ws.getPlayerPositions ? ws.getPlayerPositions() : null;
    if (!map) return null;
    let hit = null;
    map.forEach((p, connId) => {
      if (!p || !p.position) return;
      if (String(p.characterId) === String(characterId)) {
        hit = { position: p.position, connectionId: connId };
      }
    });
    return hit;
  } catch (e) {
    return null;
  }
}

function parseCustomConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }
  return (typeof raw === 'object') ? raw : {};
}

/**
 * POST /api/world-doors/toggle
 * body: { objectId, doorId, open, characterId }
 * 返回: { success, open, objectId, doorId, changed }
 */
router.post('/toggle', authenticateToken, async (req, res) => {
  try {
    const objectId = num(req.body.objectId);
    const doorId = String(req.body.doorId || '').trim();
    const characterId = String(req.body.characterId || '').trim();
    const open = req.body.open === true || req.body.open === 'true' || req.body.open === 1;

    if (!objectId || !Number.isInteger(objectId)) {
      return res.status(400).json({ success: false, error: 'objectId 无效' });
    }
    if (!doorId || doorId.length > DOOR_ID_MAX || !DOOR_ID_RE.test(doorId)) {
      return res.status(400).json({ success: false, error: 'doorId 不是合法门节点名' });
    }
    if (!characterId) {
      return res.status(400).json({ success: false, error: '缺少 characterId' });
    }

    // 角色必须属于当前登录用户（防冒用他人角色）
    const ch = await query('SELECT id FROM characters WHERE id = $1 AND user_id = $2', [characterId, req.user.userId]);
    if (!ch.rows.length) {
      return res.status(403).json({ success: false, error: '角色不属于当前账号' });
    }

    // 玩家必须在线（有实时位置），且离该对象足够近
    const live = findLivePosition(characterId);
    if (!live) {
      return res.status(409).json({ success: false, error: '你当前不在世界里，无法操作门' });
    }

    const obj = await query(
      'SELECT id, type, name, position_x, position_y, position_z, custom_config FROM world_objects WHERE id = $1',
      [objectId]
    );
    if (!obj.rows.length) {
      return res.status(404).json({ success: false, error: '对象不存在' });
    }
    const row = obj.rows[0];
    if (row.type !== 'uploaded_model' && row.type !== 'geometry_building') {
      return res.status(400).json({ success: false, error: '该对象不支持门操作' });
    }

    const anchor = { x: row.position_x, y: row.position_y, z: row.position_z };
    const d = dist2d(live.position, anchor);
    if (!(d <= NEAR_OBJECT_M)) {
      return res.status(403).json({ success: false, error: `离得太远（${d.toFixed(1)}m），走近再操作` });
    }

    const cfg = parseCustomConfig(row.custom_config);
    const doors = (cfg.doors && typeof cfg.doors === 'object') ? cfg.doors : {};
    const prev = doors[doorId];
    const prevOpen = !!(prev && prev.open);

    if (prev && prevOpen === open) {
      // 幂等：状态没变化，不写库不广播
      return res.json({ success: true, open, objectId, doorId, changed: false });
    }

    doors[doorId] = {
      open,
      at: new Date().toISOString(),
      by: characterId,
    };
    cfg.doors = doors;

    await query(
      'UPDATE world_objects SET custom_config = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(cfg), objectId]
    );

    // 广播给附近玩家（排除发起者：它已本地播放）
    try {
      const ws = require('../websocket/wsServer');
      if (ws.broadcastToNearby) {
        ws.broadcastToNearby(anchor, BROADCAST_RANGE_M, {
          type: 'DOOR_STATE',
          payload: { objectId, doorId, open, by: characterId },
        }, live.connectionId);
      }
    } catch (e) {
      console.warn('[worldDoors] 广播失败:', e.message);
    }

    res.json({ success: true, open, objectId, doorId, changed: true });
  } catch (e) {
    console.error('[worldDoors] toggle 失败:', e);
    res.status(500).json({ success: false, error: '门操作失败' });
  }
});

/**
 * GET /api/world-doors/status?objectId=123
 * 备用查询口（前端正常从 /api/world/objects 的 custom_config 直接读，走不到这里）
 */
router.get('/status', async (req, res) => {
  try {
    const objectId = num(req.query.objectId);
    if (!objectId || !Number.isInteger(objectId)) {
      return res.status(400).json({ success: false, error: 'objectId 无效' });
    }
    const r = await query('SELECT custom_config FROM world_objects WHERE id = $1', [objectId]);
    if (!r.rows.length) return res.status(404).json({ success: false, error: '对象不存在' });
    const cfg = parseCustomConfig(r.rows[0].custom_config);
    res.json({ success: true, objectId, doors: cfg.doors || {} });
  } catch (e) {
    res.status(500).json({ success: false, error: '查询失败' });
  }
});

module.exports = router;
module.exports.DOOR_ID_RE = DOOR_ID_RE;
module.exports.NEAR_OBJECT_M = NEAR_OBJECT_M;
