/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 玩家头顶气泡 + 正在说话指示器
 * - 气泡：5 秒后开始淡出，8 秒完全消失；每人同时只有 1 个气泡（新消息立即覆盖）
 * - 🎤：VOICE_STATE 驱动的"正在说话"红色徽标
 * - 每帧将 3D 头顶坐标投影到屏幕定位（被墙挡不做遮挡检测，超出屏幕/过远隐藏）
 */
const NearbyBubbles = {
  container: null,
  items: new Map(),     // characterId -> { el, fadeTimer, removeTimer }
  speaking: new Map(),  // characterId -> boolean
  HEAD_OFFSET_Y: 2.2,   // 头顶偏移（米）
  MAX_SHOW_DIST: 40,    // 超过此距离不显示
  FADE_AT_MS: 5000,
  REMOVE_AT_MS: 8000,
  _raf: null,
  _styleInjected: false,

  _ensureInit() {
    if (this.container) return true;
    if (!document.body) return false;

    if (!this._styleInjected) {
      this._styleInjected = true;
      const style = document.createElement('style');
      style.textContent = `
        #nearby-bubble-layer {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 1200;
          overflow: hidden;
        }
        .nb-bubble {
          position: absolute;
          transform: translate(-50%, -100%);
          max-width: 220px;
          padding: 6px 10px;
          background: rgba(0, 0, 0, 0.78);
          border: 1px solid rgba(0, 200, 255, 0.45);
          border-radius: 10px;
          color: #fff;
          font-size: 13px;
          line-height: 1.45;
          word-break: break-word;
          white-space: normal;
          text-align: left;
          transition: opacity 3s linear;
          text-shadow: 0 1px 2px #000;
        }
        .nb-bubble .nb-name {
          color: #66ddff;
          font-size: 11px;
          margin-right: 4px;
        }
        .nb-speaking {
          position: absolute;
          transform: translate(-50%, -100%);
          background: rgba(255, 68, 68, 0.9);
          color: #fff;
          border-radius: 10px;
          padding: 2px 8px;
          font-size: 13px;
        }
      `;
      document.head.appendChild(style);
    }

    this.container = document.createElement('div');
    this.container.id = 'nearby-bubble-layer';
    document.body.appendChild(this.container);
    this._loop();
    return true;
  },

  /**
   * 显示某玩家头顶气泡（新消息覆盖该玩家旧消息）
   */
  show(characterId, name, text) {
    if (!this._ensureInit() || !characterId || !text) return;
    this._removeItem(characterId);

    const el = document.createElement('div');
    el.className = 'nb-bubble';
    const nameEl = document.createElement('span');
    nameEl.className = 'nb-name';
    nameEl.textContent = (name || '玩家') + ':';
    const textEl = document.createElement('span');
    textEl.textContent = String(text).slice(0, 200);
    el.appendChild(nameEl);
    el.appendChild(textEl);
    el.style.opacity = '1';
    this.container.appendChild(el);

    const entry = {
      el,
      fadeTimer: setTimeout(() => { el.style.opacity = '0'; }, this.FADE_AT_MS),
      removeTimer: setTimeout(() => this._removeItem(characterId), this.REMOVE_AT_MS),
    };
    this.items.set(characterId, entry);
  },

  /**
   * 正在说话指示（🎤）
   */
  setSpeaking(characterId, speaking) {
    if (!characterId) return;
    if (speaking) {
      this.speaking.set(characterId, true);
      this._ensureInit();
    } else {
      this.speaking.delete(characterId);
      const badge = this.container && this.container.querySelector(`.nb-speaking[data-cid="${characterId}"]`);
      if (badge) badge.remove();
    }
  },

  _removeItem(characterId) {
    const entry = this.items.get(characterId);
    if (!entry) return;
    clearTimeout(entry.fadeTimer);
    clearTimeout(entry.removeTimer);
    entry.el.remove();
    this.items.delete(characterId);
  },

  /**
   * 每帧把 3D 头顶坐标投影到屏幕
   */
  _loop() {
    this._raf = requestAnimationFrame(() => this._loop());
    if (!this.container) return;

    const camera = window.gameWorld && gameWorld.camera;
    const self = window.player && window.player.position;
    if (!camera) return;

    const project = (characterId, offsetY) => {
      // 自己的角色不在 gameWorld.players 时，用本地 player 的角色组兜底
      const isSelf = characterId === (window.GAME_STATE && GAME_STATE.characterId);
      let pos = null;
      if (isSelf) {
        const selfGroup = (window.player && player.characterGroup) ||
          (window.gameWorld && gameWorld.players.get(characterId) && gameWorld.players.get(characterId).group);
        if (selfGroup) pos = selfGroup.position;
      } else {
        const pd = window.gameWorld && gameWorld.players.get(characterId);
        if (pd && pd.group) pos = pd.group.position;
      }
      if (!pos) return null;
      if (self) {
        const dx = pos.x - self.x, dy = pos.y - self.y, dz = pos.z - self.z;
        if (dx * dx + dy * dy + dz * dz > this.MAX_SHOW_DIST * this.MAX_SHOW_DIST) return null;
      }
      const world = window.THREE
        ? new THREE.Vector3(pos.x, pos.y + offsetY, pos.z)
        : { x: pos.x, y: pos.y + offsetY, z: pos.z };
      if (window.THREE) world.project(camera);
      if (!window.THREE || world.z > 1) return null;
      return {
        x: (world.x * 0.5 + 0.5) * window.innerWidth,
        y: (-world.y * 0.5 + 0.5) * window.innerHeight,
      };
    };

    // 气泡
    this.items.forEach((entry, characterId) => {
      let p = project(characterId, this.HEAD_OFFSET_Y + 0.35);
      if (!p && characterId === (window.GAME_STATE && GAME_STATE.characterId)) {
        // 自己的气泡在第一视角/相机过近时投影会失败 → 兜底显示在屏幕顶部中央
        p = { x: window.innerWidth / 2, y: 80 };
      }
      if (p) {
        entry.el.style.display = 'block';
        entry.el.style.left = p.x + 'px';
        entry.el.style.top = p.y + 'px';
      } else {
        entry.el.style.display = 'none';
      }
    });

    // 🎤 指示
    this.speaking.forEach((_, characterId) => {
      let badge = this.container.querySelector(`.nb-speaking[data-cid="${characterId}"]`);
      const p = project(characterId, this.HEAD_OFFSET_Y + 0.35);
      if (!p) {
        if (badge) badge.style.display = 'none';
        return;
      }
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'nb-speaking';
        badge.dataset.cid = characterId;
        badge.textContent = '🎤';
        this.container.appendChild(badge);
      }
      badge.style.display = 'block';
      badge.style.left = p.x + 'px';
      badge.style.top = p.y + 'px';
    });
  },
};

// 全局单例
if (typeof window !== 'undefined') {
  window.nearbyBubbles = NearbyBubbles;
}
