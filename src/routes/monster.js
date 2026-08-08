/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');

let _wsModule = null;
function getWs() {
  if (!_wsModule) {
    try { _wsModule = require('../websocket/wsServer'); } catch(e) {}
  }
  return _wsModule;
}

// ============================================================
// 工具：怪物死亡后尝试掉落兑换码
// ============================================================
async function tryDropReward(monster, killerUserId) {
  try {
    const {
      id: monsterId,
      drop_rate, drop_pool_id, drop_expire_seconds,
      drop_max_per_user, spawn_position
    } = monster;

    // 没绑奖励池，不掉
    if (!drop_pool_id) return null;
    // 概率判断
    if (Math.random() > (drop_rate || 0)) return null;

    // 每用户获得次数限制
    if (killerUserId && drop_max_per_user > 0) {
      const countRes = await query(
        `SELECT COUNT(*) as cnt FROM player_inventory pi
         JOIN reward_codes rc ON rc.id = pi.code_id
         JOIN world_drops wd ON wd.code_id = rc.id
         WHERE pi.user_id = $1 AND wd.monster_id = $2`,
        [killerUserId, monsterId]
      );
      if (parseInt(countRes.rows[0]?.cnt || 0) >= drop_max_per_user) return null;
    }

    // 从奖励池取一条未领取且未过期的码（静默：无码则不掉）
    const codeRes = await query(
      `SELECT * FROM reward_codes
       WHERE pool_id = $1 AND is_claimed = FALSE
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at ASC LIMIT 1`,
      [drop_pool_id]
    );
    if (!codeRes.rows.length) return null;

    const code = codeRes.rows[0];
    const expireSeconds = drop_expire_seconds || 120;
    const expiresAt = new Date(Date.now() + expireSeconds * 1000);

    const dropId = uuidv4();
    await query(
      `INSERT INTO world_drops (id, code_id, monster_id, position, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [dropId, code.id, monsterId, JSON.stringify(spawn_position || { x: 0, y: 0, z: 0 }), expiresAt]
    );

    return {
      dropId,
      position: spawn_position || { x: 0, y: 0, z: 0 },
      rewardName: code.reward_name,
      expireSeconds
    };
  } catch (e) {
    console.error('[tryDropReward]', e);
    return null;
  }
}

// ============================================================
// GET /api/monster/  获取所有激活怪物（含扩展字段）
// ============================================================
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT m.*,
             rp.pool_name,
             (SELECT COUNT(*) FROM reward_codes rc
              WHERE rc.pool_id = m.drop_pool_id AND rc.is_claimed = FALSE
                AND (rc.expires_at IS NULL OR rc.expires_at > NOW())
             ) AS pool_remaining
      FROM monsters m
      LEFT JOIN reward_pools rp ON rp.id = m.drop_pool_id
      ORDER BY m.created_at DESC
    `);
    res.json({ monsters: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch monsters' });
  }
});

// ============================================================
// POST /api/monster/spawn  创建怪物（完整字段）
// ============================================================
router.post('/spawn', async (req, res) => {
  try {
    const {
      monsterType, spawnPosition,
      health, attackPower, rewardExp,
      geometryType, geometryColor,
      defense, level, moveSpeed, aggroRange, attackRange,
      respawnSeconds,
      dropRate, dropExpireSeconds, dropPoolId, dropMaxPerUser,
      moveRange, patrolMode, patrolPath
    } = req.body;

    // 按类型的默认值
    const typeDefaults = {
      slime:    { health: 20,  attackPower: 3,  rewardExp: 5,  geometryType: 'slime',   geometryColor: '#44ff88' },
      goblin:   { health: 30,  attackPower: 5,  rewardExp: 10, geometryType: 'goblin',  geometryColor: '#88cc44' },
      orc:      { health: 50,  attackPower: 8,  rewardExp: 20, geometryType: 'golem',   geometryColor: '#886644' },
      skeleton: { health: 40,  attackPower: 6,  rewardExp: 15, geometryType: 'ghost',   geometryColor: '#cccccc' },
      spider:   { health: 35,  attackPower: 7,  rewardExp: 12, geometryType: 'spider',  geometryColor: '#333333' },
      boss:     { health: 300, attackPower: 25, rewardExp: 100, geometryType: 'boss',   geometryColor: '#ff4444' },
      dragon:   { health: 150, attackPower: 20, rewardExp: 50, geometryType: 'golem',   geometryColor: '#cc2222' },
    };
    const d = typeDefaults[monsterType] || { health: 50, attackPower: 8, rewardExp: 10, geometryType: 'slime', geometryColor: '#44ff88' };

    const monsterId = uuidv4();
    const hp = health || d.health;
    await query(
      `INSERT INTO monsters (
         id, monster_type, spawn_position,
         health, max_health, attack_power, reward_exp,
         geometry_type, geometry_color,
         defense, level, move_speed, aggro_range, attack_range,
         respawn_seconds,
         drop_rate, drop_expire_seconds, drop_pool_id, drop_max_per_user,
         move_range, patrol_mode, patrol_path,
         is_active
       ) VALUES (
         $1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,TRUE
       )`,
      [
        monsterId,
        monsterType || 'slime',
        JSON.stringify(spawnPosition || { x: 0, y: 0, z: 0 }),
        hp,
        attackPower || d.attackPower,
        rewardExp || d.rewardExp,
        geometryType || d.geometryType,
        geometryColor || d.geometryColor,
        defense || 0,
        level || 1,
        moveSpeed || 2.0,
        aggroRange || 10.0,
        attackRange || 1.5,
        respawnSeconds !== undefined ? respawnSeconds : 60,
        dropRate !== undefined ? dropRate : 0.3,
        dropExpireSeconds || 120,
        dropPoolId || null,
        dropMaxPerUser !== undefined ? dropMaxPerUser : 1,
        moveRange !== undefined ? moveRange : 10.0,
        patrolMode || 'random',
        patrolPath ? JSON.stringify(patrolPath) : null,
      ]
    );

    res.json({ message: 'Monster spawned', monsterId });

    // 广播给所有在线玩家
    try {
      const ws = getWs();
      if (ws && typeof ws.broadcastToAll === 'function') {
        ws.broadcastToAll({
          type: 'MONSTER_SPAWNED',
          payload: {
            id: monsterId,
            monster_type: monsterType || 'slime',
            spawn_position: spawnPosition || { x: 0, y: 0, z: 0 },
            health: hp,
            max_health: hp,
            geometry_type: geometryType || d.geometryType,
            geometry_color: geometryColor || d.geometryColor,
          }
        });
      }
    } catch(e) { console.error('[monster] WS broadcast error:', e); }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to spawn monster' });
  }
});

// ============================================================
// PUT /api/monster/:id  更新怪物配置
// ============================================================
router.put('/:monsterId', async (req, res) => {
  try {
    const { monsterId } = req.params;
    const {
      monsterType, spawnPosition,
      health, maxHealth, attackPower, rewardExp,
      geometryType, geometryColor,
      defense, level, moveSpeed, aggroRange, attackRange,
      respawnSeconds,
      dropRate, dropExpireSeconds, dropPoolId, dropMaxPerUser,
      moveRange, patrolMode, patrolPath,
      isActive
    } = req.body;

    await query(
      `UPDATE monsters SET
         monster_type = COALESCE($1, monster_type),
         spawn_position = COALESCE($2, spawn_position),
         health = COALESCE($3, health),
         max_health = COALESCE($4, max_health),
         attack_power = COALESCE($5, attack_power),
         reward_exp = COALESCE($6, reward_exp),
         geometry_type = COALESCE($7, geometry_type),
         geometry_color = COALESCE($8, geometry_color),
         defense = COALESCE($9, defense),
         level = COALESCE($10, level),
         move_speed = COALESCE($11, move_speed),
         aggro_range = COALESCE($12, aggro_range),
         attack_range = COALESCE($13, attack_range),
         respawn_seconds = COALESCE($14, respawn_seconds),
         drop_rate = COALESCE($15, drop_rate),
         drop_expire_seconds = COALESCE($16, drop_expire_seconds),
         drop_pool_id = COALESCE($17, drop_pool_id),
         drop_max_per_user = COALESCE($18, drop_max_per_user),
         move_range = COALESCE($19, move_range),
         patrol_mode = COALESCE($20, patrol_mode),
         patrol_path = COALESCE($21, patrol_path),
         is_active = COALESCE($22, is_active),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $23`,
      [
        monsterType || null,
        spawnPosition ? JSON.stringify(spawnPosition) : null,
        health || null,
        maxHealth || null,
        attackPower || null,
        rewardExp || null,
        geometryType || null,
        geometryColor || null,
        defense !== undefined ? defense : null,
        level || null,
        moveSpeed || null,
        aggroRange || null,
        attackRange || null,
        respawnSeconds !== undefined ? respawnSeconds : null,
        dropRate !== undefined ? dropRate : null,
        dropExpireSeconds || null,
        dropPoolId !== undefined ? (dropPoolId || null) : null,
        dropMaxPerUser !== undefined ? dropMaxPerUser : null,
        moveRange !== undefined ? moveRange : null,
        patrolMode || null,
        patrolPath ? JSON.stringify(patrolPath) : null,
        isActive !== undefined ? isActive : null,
        monsterId,
      ]
    );

    res.json({ message: '怪物已更新' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update monster' });
  }
});

// ============================================================
// DELETE /api/monster/:id  删除怪物
// ============================================================
router.delete('/:monsterId', async (req, res) => {
  try {
    await query('DELETE FROM monsters WHERE id = $1', [req.params.monsterId]);
    res.json({ message: '怪物已删除' });

    // 广播删除事件
    try {
      const ws = getWs();
      if (ws && typeof ws.broadcastToAll === 'function') {
        ws.broadcastToAll({ type: 'MONSTER_DIED', payload: { monsterId: req.params.monsterId } });
      }
    } catch(e) {}
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete monster' });
  }
});

// ============================================================
// POST /api/monster/:id/take-damage  受击（含掉落逻辑）
// ============================================================
router.post('/:monsterId/take-damage', async (req, res) => {
  try {
    const { monsterId } = req.params;
    const { damage, characterId, userId } = req.body;

    const monsterResult = await query(
      'SELECT * FROM monsters WHERE id = $1',
      [monsterId]
    );
    if (!monsterResult.rows.length) return res.status(404).json({ error: 'Monster not found' });

    const monster = monsterResult.rows[0];
    // 实际伤害 = damage - defense，最低1点
    const effectiveDamage = Math.max(1, (damage || 0) - (monster.defense || 0));
    const newHealth = Math.max(0, monster.health - effectiveDamage);

    if (newHealth <= 0) {
      await query(
        'UPDATE monsters SET health = 0, is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [monsterId]
      );

      // 经验奖励
      const rewardExp = monster.reward_exp || 10;
      let levelUp = false;
      let newLevel = null;

      if (characterId) {
        const charResult = await query(
          'SELECT experience, level, max_health FROM characters WHERE id = $1',
          [characterId]
        );
        if (charResult.rows.length > 0) {
          const char = charResult.rows[0];
          const newExp = (char.experience || 0) + rewardExp;
          const newLevelCalc = Math.min(100, Math.floor(newExp / 100) + 1);
          if (newLevelCalc > char.level) {
            levelUp = true;
            newLevel = newLevelCalc;
            const newMaxHp = 100 + (newLevelCalc - 1) * 10;
            await query(
              'UPDATE characters SET experience=$1, level=$2, max_health=$3, health=$3, updated_at=CURRENT_TIMESTAMP WHERE id=$4',
              [newExp, newLevelCalc, newMaxHp, characterId]
            );
          } else {
            await query(
              'UPDATE characters SET experience=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2',
              [newExp, characterId]
            );
          }
        }
      }

      // 掉落逻辑（静默：无码不掉）
      const drop = await tryDropReward(monster, userId || null);

      // 重生计划（respawn_seconds > 0 则重置并激活）
      if (monster.respawn_seconds > 0) {
        setTimeout(async () => {
          try {
            await query(
              'UPDATE monsters SET health = max_health, is_active = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
              [monsterId]
            );
            // 广播重生事件
            try {
              const ws = getWs();
              if (ws && typeof ws.broadcastToAll === 'function') {
                let spawnPos = monster.spawn_position;
                if (typeof spawnPos === 'string') { try { spawnPos = JSON.parse(spawnPos); } catch(e) {} }
                ws.broadcastToAll({
                  type: 'MONSTER_SPAWNED',
                  payload: {
                    id: monsterId,
                    monster_type: monster.monster_type,
                    spawn_position: spawnPos || { x: 0, y: 0, z: 0 },
                    health: monster.max_health,
                    max_health: monster.max_health,
                  }
                });
              }
            } catch(e) {}
          } catch (e) { console.error('[respawn]', e); }
        }, monster.respawn_seconds * 1000);
      }

      // 广播怪物死亡
      try {
        const ws = getWs();
        if (ws && typeof ws.broadcastToAll === 'function') {
          ws.broadcastToAll({ type: 'MONSTER_DIED', payload: { monsterId } });
        }
      } catch(e) {}

      return res.json({
        message: 'Monster defeated',
        effectiveDamage,
        rewards: { exp: rewardExp },
        levelUp,
        newLevel,
        drop, // null 表示没有掉落
      });
    }

    await query(
      'UPDATE monsters SET health=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2',
      [newHealth, monsterId]
    );

    res.json({
      message: 'Damage applied',
      effectiveDamage,
      currentHealth: newHealth,
      isDead: false,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to apply damage' });
  }
});

// ============================================================
// POST /api/monster/character/:characterId/take-damage  玩家受击
// ============================================================
router.post('/character/:characterId/take-damage', async (req, res) => {
  try {
    const { characterId } = req.params;
    const { damage } = req.body;

    const charResult = await query(
      'SELECT health, max_health, respawn_point FROM characters WHERE id = $1',
      [characterId]
    );
    if (!charResult.rows.length) return res.status(404).json({ error: 'Character not found' });

    const character = charResult.rows[0];
    const newHealth = Math.max(0, character.health - damage);

    if (newHealth <= 0) {
      const respawnPoint = character.respawn_point || { x: 0, y: 0, z: 0 };
      await query(
        'UPDATE characters SET health=max_health, position=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2',
        [JSON.stringify(respawnPoint), characterId]
      );
      return res.json({ message: 'Character respawned', respawnPoint, health: character.max_health });
    }

    await query(
      'UPDATE characters SET health=$1, updated_at=CURRENT_TIMESTAMP WHERE id=$2',
      [newHealth, characterId]
    );
    res.json({ message: 'Character took damage', currentHealth: newHealth });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to apply damage' });
  }
});

module.exports = router;
