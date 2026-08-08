/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// WebSocket client for real-time communication
class WSClient {
  static ws = null;
  static connected = false;
  static messageQueue = [];
  static reconnectAttempts = 0;
  static maxReconnectAttempts = 5;

  static connect(url) {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
          console.log('WebSocket connected');
          this.connected = true;
          this.reconnectAttempts = 0;
          this.flushMessageQueue();
          resolve();
        };

        this.ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        };

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('WebSocket disconnected');
          this.connected = false;
          this.attemptReconnect();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  static send(message) {
    if (this.connected) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  static flushMessageQueue() {
    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      this.send(message);
    }
  }

  static handleMessage(data) {
    const { type, payload } = data;

    switch (type) {
      case 'WORLD_STATE':
        this.handleWorldState(payload);
        break;

      case 'PLAYER_JOINED':
        this.handlePlayerJoined(payload);
        break;

      case 'POSITION_UPDATE':
        this.handlePositionUpdate(payload);
        break;

      case 'SKILL_CAST':
        this.handleSkillCast(payload);
        break;

      case 'MONSTER_ATTACK':
        this.handleMonsterAttack(payload);
        break;

      case 'MONSTER_SPAWNED':
        this.handleMonsterSpawned(payload);
        break;

      case 'MONSTER_MOVE':
        this.handleMonsterMove(payload);
        break;

      case 'MONSTER_DIED':
        this.handleMonsterDied(payload);
        break;

      case 'VOICE_COMMAND':
        this.handleVoiceCommand(payload);
        break;

      case 'CHAT':
        this.handleChat(payload);
        break;

      case 'WEATHER_CHANGE':
        this.handleWeatherChange(payload);
        break;

      case 'MODEL_UPDATE':
        this.handleModelUpdate(payload);
        break;

      default:
        console.log('Unknown message type:', type);
    }
  }

  static handleModelUpdate(payload) {
    const { characterId, glbUrl, animUrls, isSelfContainedBundle } = payload;
    // 忽略自己的广播
    if (characterId === GAME_STATE.characterId) return;
    if (!gameWorld) return;

    const finalGlbUrl = glbUrl && glbUrl !== 'null' ? glbUrl : null;
    // 若没有 glbUrl 但有 animUrls，仍要加载动画
    if (!finalGlbUrl && !animUrls) return;

    const playerData = gameWorld.players.get(characterId);

    if (!playerData) {
      // 该玩家在本地还未创建（PLAYER_JOINED 尚未到达），缓存并多次重试
      console.warn(`[WS] MODEL_UPDATE: 玩家 ${characterId} 不在本地，稍后重试`);
      let retries = 0;
      const maxRetries = 6;
      const retry = () => {
        retries++;
        const pd = gameWorld && gameWorld.players.get(characterId);
        if (pd) {
          if (window.SelfContainedChar) window.SelfContainedChar.markGroup(pd.group, isSelfContainedBundle === true);
          if (finalGlbUrl) {
            delete pd.group.userData._loadingGlbUrl;
            gameWorld._loadPlayerGlb(characterId, pd.group, pd.nameSprite, finalGlbUrl);
          }
          if (animUrls) WSClient._loadRemotePlayerAnims(characterId, animUrls);
          console.log(`[WS] MODEL_UPDATE 重试成功(第${retries}次): ${characterId} →`, finalGlbUrl);
        } else if (retries < maxRetries) {
          setTimeout(retry, 500);
        } else {
          console.warn(`[WS] MODEL_UPDATE 重试${maxRetries}次仍未找到玩家 ${characterId}，放弃`);
        }
      };
      setTimeout(retry, 500);
      return;
    }

    if (window.SelfContainedChar) window.SelfContainedChar.markGroup(playerData.group, isSelfContainedBundle === true);

    if (finalGlbUrl) {
      console.log(`[WS] MODEL_UPDATE: 更新玩家 ${characterId} 的模型 →`, finalGlbUrl);
      // 清除重复加载锁，确保可以重新加载
      delete playerData.group.userData._loadingGlbUrl;
      gameWorld._loadPlayerGlb(characterId, playerData.group, playerData.nameSprite, finalGlbUrl);
    }
    // 加载动画（模型加载后 _loadPlayerAnimGlb 内部会自动重试等待模型就绪）
    if (animUrls) WSClient._loadRemotePlayerAnims(characterId, animUrls);
  }

  // 为远端玩家加载所有动画 GLB
  // 若模型已加载：直接调用 _loadPlayerAnimGlb；
  // 若模型未加载：写入 _pendingAnimUrls，等 _loadPlayerGlb 完成后自动消费
  static _loadRemotePlayerAnims(characterId, animUrls) {
    if (!gameWorld || !animUrls) return;
    const pd = gameWorld.players.get(characterId);
    if (!pd) return;

    const model = pd.group.userData.glbModel;
    if (model) {
      // 模型已就绪，直接加载动画
      console.log(`[WS] 远端玩家 ${characterId} 模型已就绪，直接加载动画:`, Object.keys(animUrls).join('/'));
      Object.entries(animUrls).forEach(([type, url]) => {
        if (url && url.trim() !== '' && url !== 'null') {
          gameWorld._loadPlayerAnimGlb(characterId, type, url);
        }
      });
    } else {
      // 模型未加载，写入 _pendingAnimUrls 等待模型就绪后触发
      if (!pd.group.userData._pendingAnimUrls) pd.group.userData._pendingAnimUrls = {};
      Object.entries(animUrls).forEach(([type, url]) => {
        if (url && url.trim() !== '' && url !== 'null') {
          pd.group.userData._pendingAnimUrls[type] = url;
        }
      });
      console.log(`[WS] 远端玩家 ${characterId} 模型未就绪，动画已写入 _pendingAnimUrls:`, Object.keys(animUrls).join('/'));
    }
  }

  static handlePlayerJoined(payload) {
    const { characterId, characterName, position, isGuest, glbUrl, animUrls, weaponConfig, boneMapConfig, weaponSocketConfig, calibrationConfig, isSelfContainedBundle } = payload;

    if (characterId !== GAME_STATE.characterId) {
      const finalGlbUrl = glbUrl && glbUrl !== 'null' ? glbUrl : null;

      // 把所有配置直接传给 addPlayer，确保在 _loadPlayerGlb 之前写入 userData
      // isGuest为true → isLoggedIn传false，显示星星粒子
      gameWorld.addPlayer(characterId, characterName, position, !isGuest, finalGlbUrl, weaponConfig || null, boneMapConfig || null, weaponSocketConfig || null, calibrationConfig || null);

      const pd = gameWorld.players.get(characterId);
      if (pd && window.SelfContainedChar) {
        window.SelfContainedChar.markGroup(pd.group, isSelfContainedBundle === true);
      }

      if (animUrls && pd) {
        if (!pd.group.userData._pendingAnimUrls) pd.group.userData._pendingAnimUrls = {};
        Object.entries(animUrls).forEach(([type, url]) => {
          if (url && url.trim() !== '' && url !== 'null') {
            pd.group.userData._pendingAnimUrls[type] = url;
          }
        });
        console.log(`[WS] PLAYER_JOINED 预写动画 URL: ${Object.keys(animUrls).join('/')} → 玩家 ${characterId}`);
        // 若模型已就绪（通常不会，但兜底处理），立即触发
        if (pd.group.userData.glbModel) {
          const pending = pd.group.userData._pendingAnimUrls;
          delete pd.group.userData._pendingAnimUrls;
          Object.entries(pending).forEach(([type, url]) => {
            gameWorld._loadPlayerAnimGlb(characterId, type, url);
          });
        }
      }

      const statusText = !isGuest ? '加入了' : '(游客)加入了';
      UI.addChatMessage('系统', `${characterName} ${statusText}虚拟世界`);
    }
  }

  static handlePositionUpdate(payload) {
    const { characterId, position, animMode, rotation } = payload;

    if (characterId !== GAME_STATE.characterId) {
      gameWorld.updatePlayerPosition(characterId, position, false, animMode, rotation);
    }
  }

  static handleSkillCast(payload) {
    const { characterId, skillName, effect, duration } = payload;

    if (effect === 'ATTACK_BOOST_3MIN') {
      UI.addChatMessage('系统', `${characterId} 使用了攻击强化技能！`);
    } else if (effect === 'ENABLE_FLIGHT') {
      UI.addChatMessage('系统', `${characterId} 启动了飞行技能！`);
    }
  }

  static handleMonsterSpawned(payload) {
    if (!window.gameWorld) return;
    const { id, monster_type, spawn_position, health, max_health } = payload;
    if (!id || window.gameWorld.monsters.has(id)) return;
    let pos = spawn_position;
    if (typeof pos === 'string') {
      try { pos = JSON.parse(pos); } catch(e) { pos = { x: 0, y: 0, z: 0 }; }
    }
    if (!pos || typeof pos.x === 'undefined') pos = { x: 0, y: 0, z: 0 };
    window.gameWorld.addMonster(id, monster_type, pos, health || null, max_health || null);
    console.log('[WS] 新怪物已加入场景:', id, monster_type, pos, 'HP:', health);
  }

  static handleMonsterMove(payload) {
    if (!window.gameWorld) return;
    const { monsterId, position } = payload;
    if (!monsterId || !position) return;
    let pos = position;
    if (typeof pos === 'string') {
      try { pos = JSON.parse(pos); } catch(e) { return; }
    }
    window.gameWorld.updateMonsterPosition(monsterId, pos);
  }

  static handleMonsterDied(payload) {
    if (!window.gameWorld) return;
    const { monsterId } = payload;
    if (!monsterId) return;
    window.gameWorld.removeMonster(monsterId);
    console.log('[WS] 怪物已死亡移除:', monsterId);
  }

  static handleMonsterAttack(payload) {
    const { monsterId, targetCharacterId, damage, timestamp } = payload;

    if (targetCharacterId === GAME_STATE.characterId) {
      player.takeDamage(damage);
      UI.addChatMessage('系统', `受到 ${damage} 点伤害`);
    }
  }

  static handleVoiceCommand(payload) {
    const { characterId, recognizedText, timestamp } = payload;

    if (characterId !== GAME_STATE.characterId) {
      UI.addChatMessage('语音', `${characterId}: ${recognizedText}`);
    }
  }

  static handleWorldState(payload) {
    const { players, weather, timestamp } = payload;

    // Update all players in world
    players.forEach((player) => {
      if (player.characterId !== GAME_STATE.characterId) {
        const finalGlbUrl = player.glbUrl && player.glbUrl !== 'null' ? player.glbUrl : null;
        if (!gameWorld.players.has(player.characterId)) {
          // 直接传入骨骼/武器/校准配置，确保在 _loadPlayerGlb 之前写入 userData
          // 游客玩家显示星星粒子，正式玩家显示完整模型
          gameWorld.addPlayer(player.characterId, player.characterName, player.position, !player.isGuest, finalGlbUrl, player.weaponConfig || null, player.boneMapConfig || null, player.weaponSocketConfig || null, player.calibrationConfig || null);
          const pd = gameWorld.players.get(player.characterId);
          if (pd && window.SelfContainedChar) {
            window.SelfContainedChar.markGroup(pd.group, player.isSelfContainedBundle === true);
          }
          if (pd) {
            if (player.animUrls) {
              if (!pd.group.userData._pendingAnimUrls) pd.group.userData._pendingAnimUrls = {};
              Object.entries(player.animUrls).forEach(([type, url]) => {
                if (url && url.trim() !== '' && url !== 'null') pd.group.userData._pendingAnimUrls[type] = url;
              });
              if (pd.group.userData.glbModel) {
                const pending = pd.group.userData._pendingAnimUrls;
                delete pd.group.userData._pendingAnimUrls;
                Object.entries(pending).forEach(([type, url]) => gameWorld._loadPlayerAnimGlb(player.characterId, type, url));
              }
            }
          }
        } else {
          gameWorld.updatePlayerPosition(player.characterId, player.position);
          // 如果 WORLD_STATE 里携带了 glbUrl，但本地该玩家还没有模型（仍是木棍人），则立即加载
          if (finalGlbUrl) {
            const pd = gameWorld.players.get(player.characterId);
            if (pd && !pd.group.userData.glbModel && !pd.group.userData._loadingGlbUrl) {
              console.log(`[WS] WORLD_STATE 补充加载玩家模型 ${player.characterId}:`, finalGlbUrl);
              // 先写入骨骼/武器配置，再加载模型
              if (player.boneMapConfig && Object.keys(player.boneMapConfig).length > 0) pd.group.userData._remoteBoneMapConfig = player.boneMapConfig;
              if (player.weaponSocketConfig && Object.keys(player.weaponSocketConfig).length > 0) pd.group.userData._remoteWeaponSocketConfig = player.weaponSocketConfig;
              if (player.animUrls) {
                if (!pd.group.userData._pendingAnimUrls) pd.group.userData._pendingAnimUrls = {};
                Object.entries(player.animUrls).forEach(([type, url]) => {
                  if (url && url.trim() !== '' && url !== 'null') pd.group.userData._pendingAnimUrls[type] = url;
                });
              }
              gameWorld._loadPlayerGlb(player.characterId, pd.group, pd.nameSprite, finalGlbUrl);
            }
          }
        }
      }
    });

    // 同步天气（新玩家加入时）
    if (weather && gameWorld && gameWorld.setWeather) {
      console.log('🌤️ 服务器发送的天气:', weather);
      gameWorld.setWeather(weather.type || 'clear', weather);
      // 同步前端天气按钮高亮
      document.querySelectorAll('.wb').forEach(b => b.classList.remove('active'));
      document.getElementById('wb-' + (weather.type || 'clear'))?.classList.add('active');
    }
  }

  static handleWeatherChange(payload) {
    if (!gameWorld || !gameWorld.setWeather) return;
    gameWorld.setWeather(payload.type || 'clear', payload);
    // 同步前端天气按钮高亮
    document.querySelectorAll('.wb').forEach(b => b.classList.remove('active'));
    document.getElementById('wb-' + (payload.type || 'clear'))?.classList.add('active');
    // 聊天提示
    const names = { clear:'晴天☀️', rain:'雨天🌧️', snow:'雪天❄️', fog:'大雾🌫️', storm:'雷暴⛈️' };
    UI.addChatMessage('系统', `天气变化：${names[payload.type] || payload.type}`);
  }

  static handleChat(payload) {
    const { sender, message, timestamp } = payload;
    UI.addChatMessage(sender, message);
  }

  static attemptReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.pow(2, this.reconnectAttempts) * 1000;
      console.log(`Attempting to reconnect in ${delay}ms...`);

      setTimeout(() => {
        this.connect(CONFIG.WS_URL).catch(() => {
          this.attemptReconnect();
        });
      }, delay);
    } else {
      console.error('Max reconnect attempts reached');
    }
  }

  static isConnected() {
    return this.connected;
  }
}

// 暴露到全局作用域
if (typeof window !== 'undefined') {
  window.WSClient = WSClient;
}
