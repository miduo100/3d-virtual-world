/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * SoundManager - 游戏音效引擎
 * 基于 Web Audio API（原生，无需第三方库）
 * 支持：预加载、一次性播放、循环音效（武器嗡嗡声）、主音量/音效音量
 */
class SoundManager {
  constructor() {
    this._ctx = null;          // AudioContext（懒初始化，需要用户手势）
    this._buffers = {};        // url → AudioBuffer
    this._loopNodes = {};      // key → { source, gain }
    this._masterGain = null;
    this._sfxGain = null;
    this._unlocked = false;
    this._pendingPreloads = []; // 解锁前积压的预加载任务
    this._currentAnimSounds = {};
    this._currentWeaponSounds = {};

    // 音量设置（持久化，加 fallback 防止非法值）
    this._masterVolume = parseFloat(localStorage.getItem('sm_master') ?? '') || 0.8;
    this._sfxVolume    = parseFloat(localStorage.getItem('sm_sfx')    ?? '') || 0.7;
    // 确保在 NaN 时回退到默认值
    if (isNaN(this._masterVolume)) this._masterVolume = 0.8;
    if (isNaN(this._sfxVolume))    this._sfxVolume    = 0.7;

    // 监听首次用户交互，自动解锁 AudioContext
    this._setupAutoUnlock();
  }

  // ─── 初始化 / 解锁 ─────────────────────────────────────────────

  _setupAutoUnlock() {
    const events = ['click', 'touchstart', 'keydown'];
    const unlock = () => {
      if (this._unlocked) return;
      this._unlock();
      // 解锁成功后移除监听器（无论成功与否都移除，避免重复调用）
      events.forEach(ev => document.removeEventListener(ev, unlock));
    };
    // 使用 once: true，触发一次后自动移除，防止内存泄漏
    events.forEach(ev => document.addEventListener(ev, unlock, { once: true }));
  }

  _unlock() {
    if (this._unlocked) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._masterGain = this._ctx.createGain();
      this._sfxGain    = this._ctx.createGain();
      this._masterGain.gain.value = this._masterVolume;
      this._sfxGain.gain.value   = this._sfxVolume;
      this._sfxGain.connect(this._masterGain);
      this._masterGain.connect(this._ctx.destination);
      this._unlocked = true;
      console.log('[SoundManager] AudioContext 已解锁');
      // 处理积压的预加载
      if (this._pendingPreloads.length > 0) {
        const pending = this._pendingPreloads.slice();
        this._pendingPreloads = [];
        this.preload(pending);
      }
    } catch (e) {
      console.warn('[SoundManager] AudioContext 创建失败:', e.message);
    }
  }

  // ─── 预加载 ────────────────────────────────────────────────────

  /**
   * 批量预加载音频URL
   * @param {string[]} urls
   */
  async preload(urls) {
    if (!Array.isArray(urls)) urls = [urls];
    if (!this._unlocked) {
      // 积压，等解锁后处理（去重，避免同一URL多次加载）
      urls.filter(u => u && !this._buffers[u] && !this._pendingPreloads.includes(u))
          .forEach(u => this._pendingPreloads.push(u));
      return;
    }
    const tasks = urls.filter(u => u && !this._buffers[u]).map(url => this._loadBuffer(url));
    await Promise.allSettled(tasks);
  }

  async _loadBuffer(url) {
    if (this._buffers[url]) return this._buffers[url];
    if (!this._ctx) return null;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuf = await res.arrayBuffer();
      const audioBuf = await this._ctx.decodeAudioData(arrayBuf);
      this._buffers[url] = audioBuf;
      return audioBuf;
    } catch (e) {
      console.warn(`[SoundManager] 加载音频失败: ${url}`, e.message);
      return null;
    }
  }

  // ─── 播放 ──────────────────────────────────────────────────────

  /**
   * 一次性播放音效（技能激发音、动作音）
   * @param {string} url
   * @param {number} volume  0~1，默认使用 sfxVolume
   */
  async play(url, volume = null) {
    if (!url) return;
    if (!this._unlocked) { this._unlock(); }
    if (!this._ctx) return;

    // 确保已加载
    let buf = this._buffers[url];
    if (!buf) {
      buf = await this._loadBuffer(url);
      if (!buf) return;
    }

    try {
      const src = this._ctx.createBufferSource();
      src.buffer = buf;
      const gainNode = this._ctx.createGain();
      // 使用 volume !== null && volume !== undefined 精确判断，正确处理 volume=0
      gainNode.gain.value = (volume != null) ? Math.max(0, Math.min(1, volume)) : 1.0;
      src.connect(gainNode);
      gainNode.connect(this._sfxGain);
      src.start(0);
    } catch (e) {
      console.warn('[SoundManager] play 失败:', e.message);
    }
  }

  /**
   * 启动循环音效（武器常态嗡嗡声）
   * @param {string} key   循环音效的唯一键（如 'weapon_hum'）
   * @param {string} url   音频URL
   * @param {number} volume 0~1
   */
  async startLoop(key, url, volume = 0.4) {
    if (!url) return;
    if (!this._unlocked) { this._unlock(); }
    if (!this._ctx) return;

    // 先停止同名旧循环
    this.stopLoop(key);

    let buf = this._buffers[url];
    if (!buf) {
      buf = await this._loadBuffer(url);
      if (!buf) return;
    }

    try {
      const src = this._ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const gainNode = this._ctx.createGain();
      gainNode.gain.value = Math.max(0, Math.min(1, volume));
      src.connect(gainNode);
      gainNode.connect(this._sfxGain);
      src.start(0);
      this._loopNodes[key] = { source: src, gain: gainNode };
    } catch (e) {
      console.warn('[SoundManager] startLoop 失败:', e.message);
    }
  }

  /**
   * 停止循环音效
   * @param {string} key
   */
  stopLoop(key) {
    const node = this._loopNodes[key];
    if (!node) return;
    // 先移除引用，防止资源泄漏
    delete this._loopNodes[key];
    if (!this._ctx) return;
    try {
      node.gain.gain.setTargetAtTime(0, this._ctx.currentTime, 0.1); // 淡出0.1s
      node.source.stop(this._ctx.currentTime + 0.15);
    } catch (e) { /* 忽略已停止的节点 */ }
  }

  /**
   * 停止所有循环音效（卸下武器时调用）
   */
  stopAllLoops() {
    Object.keys(this._loopNodes).forEach(k => this.stopLoop(k));
  }

  // ─── 音量控制 ──────────────────────────────────────────────────

  setMasterVolume(v) {
    this._masterVolume = Math.max(0, Math.min(1, v));
    if (this._masterGain && this._ctx) {
      this._masterGain.gain.setTargetAtTime(this._masterVolume, this._ctx.currentTime, 0.05);
    }
    localStorage.setItem('sm_master', this._masterVolume);
  }

  setSfxVolume(v) {
    this._sfxVolume = Math.max(0, Math.min(1, v));
    if (this._sfxGain && this._ctx) {
      this._sfxGain.gain.setTargetAtTime(this._sfxVolume, this._ctx.currentTime, 0.05);
    }
    localStorage.setItem('sm_sfx', this._sfxVolume);
  }

  getMasterVolume() { return this._masterVolume; }
  getSfxVolume()    { return this._sfxVolume; }

  // ─── 与角色模板集成 ────────────────────────────────────────────

  /**
   * 加载角色模板的动作音效和武器音效
   * @param {object} template  { anim_sounds: {}, weapon_sounds: {} }
   */
  async loadTemplateAudio(template) {
    if (!template) return;
    const urls = [];
    if (template.anim_sounds) {
      Object.values(template.anim_sounds).forEach(u => { if (u) urls.push(u); });
    }
    if (template.weapon_sounds) {
      Object.values(template.weapon_sounds).forEach(u => { if (u) urls.push(u); });
    }
    if (urls.length > 0) {
      console.log(`[SoundManager] 预加载模板音频 ${urls.length} 个`);
      await this.preload(urls);
    }
    // 存储当前模板音效引用（供 playAnimSound 调用）
    this._currentAnimSounds   = template.anim_sounds   || {};
    this._currentWeaponSounds = template.weapon_sounds || {};

    // 启动武器常态嗡嗡声
    if (template.weapon_sounds?.equip_hum) {
      this.startLoop('weapon_hum', template.weapon_sounds.equip_hum, 0.35);
    }
  }

  /**
   * 播放指定动作的音效（由 world.js 或 player.js 调用）
   * @param {string} animKey  'walk'|'run'|'jump'|'attack1'|...
   */
  playAnimSound(animKey) {
    if (!this._currentAnimSounds) return;
    const url = this._currentAnimSounds[animKey];
    if (url) this.play(url);
  }

  /**
   * 播放指定武器音效
   * @param {string} soundKey  武器音效键名
   */
  playWeaponSound(soundKey) {
    if (!this._currentWeaponSounds) return;
    const url = this._currentWeaponSounds[soundKey];
    if (url) this.play(url);
  }
}

// 全局单例
window.soundManager = new SoundManager();
