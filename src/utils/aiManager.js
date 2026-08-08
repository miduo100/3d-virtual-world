/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// AI Manager for autonomous world management
class AIManager {
  constructor() {
    this.isEnabled = true;
    this.updateInterval = 30000; // 30 seconds
    this.worldState = null;
  }

  enable() {
    this.isEnabled = true;
    this.start();
  }

  disable() {
    this.isEnabled = false;
  }

  start() {
    this.mainLoop();
  }

  async mainLoop() {
    while (this.isEnabled) {
      try {
        await this.updateWorldState();
        await this.manageMonstersSpawning();
        await this.updateNPCBehaviors();
        await this.updateEnvironment();
        await this.checkGameEvents();
      } catch (error) {
        console.error('AI Manager error:', error);
      }

      await this.sleep(this.updateInterval);
    }
  }

  async updateWorldState() {
    // Fetch current world state from database
    const { query } = require('../database/db');

    try {
      const charactersResult = await query('SELECT COUNT(*) FROM characters WHERE position IS NOT NULL');
      const monstersResult = await query('SELECT COUNT(*) FROM monsters WHERE is_active = TRUE');
      const shopsResult = await query('SELECT COUNT(*) FROM shops');

      this.worldState = {
        activePlayers: parseInt(charactersResult.rows[0].count),
        activeMonsters: parseInt(monstersResult.rows[0].count),
        shops: parseInt(shopsResult.rows[0].count),
        timestamp: new Date(),
      };

      console.log('[AI] World state updated:', this.worldState);
    } catch (error) {
      console.error('Failed to update world state:', error);
    }
  }

  async manageMonstersSpawning() {
    const { query } = require('../database/db');
    const { v4: uuidv4 } = require('uuid');

    try {
      const monsterCount = this.worldState?.activeMonsters || 0;
      const maxMonsters = 50;

      if (monsterCount < maxMonsters) {
        const spawnCount = Math.floor((maxMonsters - monsterCount) * 0.2); // Spawn 20% of deficit

        for (let i = 0; i < spawnCount; i++) {
          const position = {
            x: (Math.random() - 0.5) * 500,
            y: 0,
            z: (Math.random() - 0.5) * 500,
          };

          const monsterType = ['goblin', 'orc', 'skeleton'][Math.floor(Math.random() * 3)];

          await query(
            `INSERT INTO monsters (id, monster_type, spawn_position, health, max_health, attack_power)
             VALUES ($1, $2, $3, $4, $4, $5)`,
            [uuidv4(), monsterType, JSON.stringify(position), 40, 12]
          );
        }

        console.log(`[AI] Spawned ${spawnCount} monsters`);
      }
    } catch (error) {
      console.error('Failed to manage monster spawning:', error);
    }
  }

  async updateNPCBehaviors() {
    // Update NPC (non-player character) behaviors
    console.log('[AI] NPCs are patrolling...');
  }

  async updateEnvironment() {
    // Dynamic environment changes
    // Weather, day/night cycle, etc.
    const hour = new Date().getHours();
    const timeOfDay = hour < 6 || hour >= 18 ? 'night' : 'day';

    console.log(`[AI] Environment: ${timeOfDay} (${hour}:00)`);
  }

  async checkGameEvents() {
    // Check for special events that should trigger
    const { query } = require('../database/db');

    try {
      const playerCount = this.worldState?.activePlayers || 0;

      if (playerCount > 10) {
        console.log('[AI] World population high - considering spawning boss monster');
      }

      if (playerCount < 2) {
        console.log('[AI] World is quiet - reducing monster spawns');
      }
    } catch (error) {
      console.error('Failed to check game events:', error);
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = new AIManager();
