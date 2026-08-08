/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// Monster AI and spawning system
const { query } = require('../database/db');
const { broadcastToAll } = require('../websocket/wsServer');

class MonsterAI {
  static async spawnRandomMonsters() {
    const monsterTypes = ['goblin', 'orc', 'skeleton', 'dragon'];
    const spawnAreas = [
      { x: 100, z: 100 },
      { x: -100, z: 100 },
      { x: 100, z: -100 },
      { x: -100, z: -100 },
    ];

    setInterval(async () => {
      // Random chance to spawn
      if (Math.random() > 0.7) {
        const monsterType = monsterTypes[Math.floor(Math.random() * monsterTypes.length)];
        const area = spawnAreas[Math.floor(Math.random() * spawnAreas.length)];
        const position = {
          x: area.x + (Math.random() - 0.5) * 30,
          y: 0,
          z: area.z + (Math.random() - 0.5) * 30,
        };

        await this.spawnMonster(monsterType, position);
      }
    }, 10000); // Check every 10 seconds
  }

  static async spawnMonster(monsterType, position) {
    try {
      const health = this.getMonsterStats(monsterType).health;
      const attack = this.getMonsterStats(monsterType).attack;

      await query(
        `INSERT INTO monsters (id, monster_type, spawn_position, health, max_health, attack_power)
         VALUES ($1, $2, $3, $4, $4, $5)`,
        [require('uuid').v4(), monsterType, JSON.stringify(position), health, attack]
      );

      broadcastToAll({
        type: 'MONSTER_SPAWNED',
        payload: {
          monsterType,
          position,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      console.error('Failed to spawn monster:', error);
    }
  }

  static getMonsterStats(monsterType) {
    const stats = {
      goblin: { health: 30, attack: 5, exp: 10 },
      orc: { health: 50, attack: 10, exp: 25 },
      skeleton: { health: 40, attack: 8, exp: 20 },
      dragon: { health: 150, attack: 20, exp: 100 },
    };

    return stats[monsterType] || stats.goblin;
  }

  static async updateMonsterBehavior() {
    // Periodically update monster positions and behaviors
    setInterval(async () => {
      const result = await query('SELECT * FROM monsters WHERE is_active = TRUE');

      result.rows.forEach((monster) => {
        // 解析数据
        const spawnPosition = monster.spawn_position;
        const moveRange = monster.move_range || 10.0;
        const patrolMode = monster.patrol_mode || 'random';
        const patrolPath = monster.patrol_path || [];
        const moveSpeed = monster.move_speed || 2.0;

        let newPosition = { ...spawnPosition };

        if (patrolMode === 'patrol' && patrolPath.length > 0) {
          // 巡逻路径模式
          if (!monster.currentPatrolIndex) {
            monster.currentPatrolIndex = 0;
          }

          const targetPoint = patrolPath[monster.currentPatrolIndex];
          const direction = {
            x: targetPoint.x - spawnPosition.x,
            y: targetPoint.y - spawnPosition.y,
            z: targetPoint.z - spawnPosition.z
          };

          const distance = Math.sqrt(direction.x * direction.x + direction.z * direction.z);
          if (distance < 1) {
            // 到达当前巡逻点，移动到下一个
            monster.currentPatrolIndex = (monster.currentPatrolIndex + 1) % patrolPath.length;
          } else {
            // 向目标点移动
            const normalizedDirection = {
              x: direction.x / distance,
              y: direction.y / distance,
              z: direction.z / distance
            };
            newPosition.x += normalizedDirection.x * moveSpeed * 0.5;
            newPosition.y += normalizedDirection.y * moveSpeed * 0.5;
            newPosition.z += normalizedDirection.z * moveSpeed * 0.5;
          }
        } else {
          // 随机移动模式
          // 随机移动
          const randomMove = {
            x: (Math.random() - 0.5) * moveSpeed,
            z: (Math.random() - 0.5) * moveSpeed
          };

          // 计算新位置
          newPosition.x += randomMove.x;
          newPosition.z += randomMove.z;

          // 检查是否超出活动范围
          const distanceFromSpawn = Math.sqrt(
            Math.pow(newPosition.x - spawnPosition.x, 2) +
            Math.pow(newPosition.z - spawnPosition.z, 2)
          );

          if (distanceFromSpawn > moveRange) {
            // 超出范围，将怪物拉回
            const direction = {
              x: spawnPosition.x - newPosition.x,
              z: spawnPosition.z - newPosition.z
            };
            const normalizedDirection = {
              x: direction.x / distanceFromSpawn,
              z: direction.z / distanceFromSpawn
            };
            newPosition.x = spawnPosition.x + normalizedDirection.x * moveRange;
            newPosition.z = spawnPosition.z + normalizedDirection.z * moveRange;
          }
        }

        // 更新怪物位置
        query('UPDATE monsters SET spawn_position = $1 WHERE id = $2', [
          JSON.stringify(newPosition),
          monster.id
        ]).catch(err => console.error('Failed to update monster position:', err));

        // Broadcast movement
        broadcastToAll({
          type: 'MONSTER_MOVE',
          payload: {
            monsterId: monster.id,
            position: newPosition,
          },
        });
      });
    }, 500); // Update every 500ms
  }
}

module.exports = MonsterAI;
