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
    this._synthWarmed = false;  // 合成器是否已预热（每个实例只预热一次）
    // 走/跑的脚步循环当前处于哪个模式（null=没在播）。见 startMoveLoop
    this._moveLoopMode = null;
    // 脚步循环的启动序号：异步解码期间状态变了就靠它作废那次启动（防漏网循环）
    this._moveLoopToken = 0;

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
      // 短音效做 ±5% 音高微扰：同一段音频重复播放时不再机械重复（长音频不抖，避免人声/音乐变调）
      let rate = 1;
      if (buf.duration <= 3) {
        try {
          rate = 1 + (Math.random() * 0.1 - 0.05);
          src.playbackRate.value = rate;
        } catch (e2) { rate = 1; /* 个别浏览器不支持 playbackRate，忽略 */ }
      }
      const gainNode = this._ctx.createGain();
      // 使用 volume !== null && volume !== undefined 精确判断，正确处理 volume=0
      const vol = (volume != null) ? Math.max(0, Math.min(1, volume)) : 1.0;
      gainNode.gain.value = vol;
      src.connect(gainNode);
      gainNode.connect(this._sfxGain);
      // 尾端 15ms 淡出：消除波形硬切产生的“咔”声。不改变音效内容，只让尾巴更干净
      if (buf.duration > 0.08) {
        try {
          const t = this._ctx.currentTime;
          const end = t + (buf.duration / rate);
          gainNode.gain.setValueAtTime(vol, Math.max(t, end - 0.015));
          gainNode.gain.linearRampToValueAtTime(0, end);
        } catch (e3) { /* 时间线异常忽略，不影响播放 */ }
      }
      src.start(0);
    } catch (e) {
      console.warn('[SoundManager] play 失败:', e.message);
    }
  }

  /**
   * 启动循环音效（武器常态嗡嗡声 / 走跑脚步）
   * @param {string} key   循环音效的唯一键（如 'weapon_hum'、'anim_move'）
   * @param {string} url   音频URL
   * @param {number} volume 0~1
   * @param {object} [opts]
   * @param {number} [opts.rate=1]     播放速率（脚步用：run 素材步频偏慢，靠提速校正）
   * @param {number} [opts.fadeIn=0]   淡入秒数（脚步用，避免每步硬起"咔"一声）
   */
  async startLoop(key, url, volume = 0.4, opts = {}) {
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
    this._startLoopWithBuffer(key, buf, volume, opts);
  }

  /**
   * 用已解码好的 buffer **同步**启动循环，不经过 await。
   * 拆出来是为了让 startMoveLoop 能在解码完成后先检查"是否已被取代"再启动，
   * 避免启动一个没人管的漏网循环（详见 startMoveLoop 的注释）。
   */
  _startLoopWithBuffer(key, buf, volume = 0.4, opts = {}) {
    if (!this._ctx || !buf) return;
    // ★ 必须先把同 key 的旧节点停掉再覆盖 _loopNodes[key]。
    //   少这一行就会漏音：旧 source 还在播，引用被新节点覆盖后彻底丢失，
    //   之后 stopLoop 只能停到新的那条，旧的会一直响到页面关掉。
    //   （2026-11-14 走→跑切换踩到的就是这个：停下后脚步还在响，永远停不下来。）
    this.stopLoop(key);
    try {
      const rate = Math.max(0.25, Math.min(4, opts.rate || 1));
      const fadeIn = Math.max(0, opts.fadeIn || 0);
      const vol = Math.max(0, Math.min(1, volume));

      const src = this._ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = rate;
      const gainNode = this._ctx.createGain();
      if (fadeIn > 0) {
        gainNode.gain.setValueAtTime(0.0001, this._ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, vol), this._ctx.currentTime + fadeIn);
      } else {
        gainNode.gain.value = vol;
      }
      src.connect(gainNode);
      gainNode.connect(this._sfxGain);
      src.start(0);
      this._loopNodes[key] = { source: src, gain: gainNode };
    } catch (e) {
      console.warn('[SoundManager] startLoop 失败:', e.message);
    }
  }

  /**
   * 启动「走 / 跑」的脚步循环（2026-11-14 新增）
   *
   * 为什么需要：走和跑是**持续状态**，而音效只在 _switchPlayerAnim 真正切换动画时触发一次
   * （prevMode === mode 会早退）。结果就是按下 W 只响一下脚步，之后一路静音。
   *
   * 三个刻意的决定：
   *   1. **只对「用户配了自定义文件」的槽位循环**，不回落到 audioSynth。
   *      合成器的 walk/run 配方是 0.25s/0.32s 的单次噪声，循环起来会变成持续电噪，
   *      比没声音更糟。
   *   2. **步频靠 playbackRate 校正**（实测：walk 素材 1.6 步/秒 = 正常走路，原速；
   *      run 素材 1.8 步/秒偏慢，×1.3 拉到约 2.3 步/秒才像跑）。
   *   3. 循环接缝安全：两段素材的首尾都是安静段（最后一步之后有 0.26~0.4s 余韵），
   *      循环点落在安静处，听不出接缝，不需要额外做交叉淡化。
   *
   * @param {'walk'|'run'} mode
   */
  startMoveLoop(mode) {
    const slot = this._normalizeSlot((this._currentAnimSounds || {})[mode]);
    if (!slot || slot.muted || !slot.urls || !slot.urls.length) {
      this.stopMoveLoop();
      return;
    }
    // 已经在循环同一个模式就不重启（startMoveLoop 每帧都可能被调用）
    if (this._moveLoopMode === mode && this._loopNodes[SoundManager.MOVE_LOOP_KEY]) return;

    const url = slot.urls[0];
    const vol = (mode === 'run' ? 0.62 : 0.52);
    const opts = { rate: mode === 'run' ? 1.3 : 1.0, fadeIn: 0.08 };

    // 竞态防护（真踩过的坑）：
    //   首次启动要 await 解码。如果玩家按一下 W 立刻松开，
    //   stopMoveLoop 在解码完成**之前**就执行了，随后解码完成照常启动 →
    //   得到一个 _moveLoopMode 已经是 null、却一直在响的循环，且再也停不掉
    //   （stopMoveLoop 看到 null 直接 return）。
    //   所以每次启动/停止都递增 token，解码回来发现 token 已被取代就**什么都不做**。
    //   注意这里必须"不启动"而不是"启动后再 stop"——后者会误杀后继的新循环。
    const token = ++this._moveLoopToken;
    const start = (buf) => {
      if (!buf || token !== this._moveLoopToken) return;
      this._moveLoopMode = mode;
      this._startLoopWithBuffer(SoundManager.MOVE_LOOP_KEY, buf, vol, opts);
    };
    const cached = this._buffers[url];
    if (cached) { start(cached); return; }
    if (!this._unlocked) { this._unlock(); }
    this._loadBuffer(url).then(start).catch(() => {});
  }

  /** 停止脚步循环（离开走/跑、或切到攻击/跳跃/死亡时调用） */
  stopMoveLoop() {
    // 递增 token：让还在解码中的那次启动作废，不要再起来
    this._moveLoopToken++;
    if (this._moveLoopMode == null) return;
    this._moveLoopMode = null;
    this.stopLoop(SoundManager.MOVE_LOOP_KEY);
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
    // 也要清状态：否则 _moveLoopMode 还停在 'walk'，下次 startMoveLoop 会误判"已在播"
    this._moveLoopMode = null;
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

  // 供 soundRuntime.js 复用同一个 AudioContext 与音效总线。
  // 项目里已经有 4 个独立 AudioContext（本文件、voiceChat、视频各一个），
  // 场景声源绝不能再开第 5 个 —— 移动端上限只有 6 个。
  getContext()   { return this._ctx; }
  getSfxGain()   { return this._sfxGain; }
  isUnlocked()   { return this._unlocked; }

  // ─── 与角色模板集成 ────────────────────────────────────────────

  /**
   * 加载角色模板的动作音效和武器音效
   * @param {object} template  { anim_sounds: {}, weapon_sounds: {} }
   */
  async loadTemplateAudio(template) {
    if (!template) return;

    // 防御：服务端偶尔回的是 JSON 字符串（JSONB 未解析），若直接 Object.values()
    // 会被拆成单字符数组，最终去请求 "h"、"t" 这种诡异 URL
    const parseMaybe = (v) => {
      if (typeof v === 'string') { try { return JSON.parse(v) || {}; } catch (e) { return {}; } }
      return v || {};
    };
    const animSounds   = parseMaybe(template.anim_sounds);
    const weaponSounds = parseMaybe(template.weapon_sounds);

    // 先预热合成音（常用 9 键）：与下面的网络预载并行，等玩家真正走动时早已渲染完
    // 实测 20 键全量渲染仅 43ms（桌面），但低端机单键可能 30~50ms，故只热常用键，其余按需
    // 未预热的键首次触发会静默一次（合成中），预热这些高频键可避免"第一次跳跃没声"
    if (!this._synthWarmed && typeof window !== 'undefined' && window.audioSynth && window.audioSynth.prewarm) {
      this._synthWarmed = true;
      try {
        window.audioSynth.prewarm([
          // idle 已静音（2026-11-05），不再预热
          { type: 'anim', key: 'walk' },
          { type: 'anim', key: 'run' },
          { type: 'anim', key: 'jump' },
          { type: 'anim', key: 'land' },
          { type: 'anim', key: 'attack1' },
          { type: 'anim', key: 'attack2' },
          { type: 'anim', key: 'hit' },
          { type: 'weapon', key: 'swing' }
        ]);
      } catch (e) { /* 合成器异常绝不影响原有加载流程 */ }
    }

    const urls = [];
    // 兼容两种值形态：字符串（老数据）与对象（{urls:[],synth:{},volume,loop}）
    // 只把真正的字符串 URL 送进 preload，否则会去请求 "[object Object]"
    if (animSounds) {
      Object.values(animSounds).forEach(v => {
        const slot = this._normalizeSlot(v);
        if (slot && slot.urls) slot.urls.forEach(u => { if (u) urls.push(u); });
      });
    }
    if (weaponSounds) {
      Object.values(weaponSounds).forEach(v => {
        const slot = this._normalizeSlot(v);
        if (slot && slot.urls) slot.urls.forEach(u => { if (u) urls.push(u); });
      });
    }
    if (urls.length > 0) {
      console.log(`[SoundManager] 预加载模板音频 ${urls.length} 个`);
      await this.preload(urls);
    }
    // 存储当前模板音效引用（供 playAnimSound 调用）
    this._currentAnimSounds   = animSounds;
    this._currentWeaponSounds = weaponSounds;

    // 启动武器常态嗡嗡声（仅当配的是自定义文件时）
    // 合成音的 equip_hum 刻意不做循环：低频持续嗡鸣用合成做出来会非常刺耳，宁可不出声
    const humSlot = this._normalizeSlot(weaponSounds.equip_hum);
    if (humSlot && humSlot.urls && humSlot.urls.length && !humSlot.muted) {
      this.startLoop('weapon_hum', humSlot.urls[0], 0.35);
    }
  }

  // ─── 三层解析（自定义 → 合成兜底） ────────────────────────────
  // 值形态兼容：老数据是 URL 字符串，新数据是 { urls:[], synth:{}, volume, loop, muted }
  // 这一层保证「读不懂的值」也不会让播放链路抛错

  _normalizeSlot(v) {
    if (v == null) return null;
    // 注意：空字符串必须当成"未配置"，否则会被拼成空 URL 发请求
    if (typeof v === 'string') return v ? { urls: [v], volume: 1, loop: false } : null;
    if (Array.isArray(v)) {
      const urls = v.filter(x => typeof x === 'string' && x);
      return urls.length ? { urls: urls, volume: 1, loop: false } : null;
    }
    if (typeof v === 'object') {
      let urls = [];
      if (Array.isArray(v.urls)) urls = v.urls.filter(x => typeof x === 'string' && x);
      else if (typeof v.url === 'string' && v.url) urls = [v.url];
      return {
        urls: urls,
        synth: (v.synth && typeof v.synth === 'object') ? v.synth : null,
        volume: (typeof v.volume === 'number') ? Math.max(0, Math.min(1, v.volume)) : 1,
        loop: !!v.loop,
        muted: !!v.muted
      };
    }
    return null;
  }

  /**
   * 解析某个槽位实际该播什么
   * @returns {{kind:'custom'|'synth'|'synth-pending'|'muted'|'none', url?, buffer?, volume?, loop?}}
   *   synth-pending：合成音首次尚未渲染完，本次静默（已在后台渲染，下一次就有声），绝不阻塞主线程
   */
  _resolveSound(key, type) {
    // ★ 2026-11-05 待机不配音（用户要求「去掉待机声音，让槽位空着」）：
    //   动作结束回 idle 时每次都会响一声，很突兀。这里放在最前面，
    //   连模板里已经配过的自定义文件（DB anim_sounds.idle）也不播，保证「点了也不响」。
    if (type === 'anim' && key === 'idle') return { kind: 'none' };

    const dict = (type === 'weapon') ? this._currentWeaponSounds : this._currentAnimSounds;
    const slot = dict ? this._normalizeSlot(dict[key]) : null;

    if (slot && slot.muted) return { kind: 'muted' };

    // 第一层：角色自定义文件（支持变体池随机）
    if (slot && slot.urls && slot.urls.length) {
      const url = slot.urls.length > 1
        ? slot.urls[Math.floor(Math.random() * slot.urls.length)]
        : slot.urls[0];
      return { kind: 'custom', url: url, volume: slot.volume, loop: slot.loop };
    }

    // 第二层：程序化合成兜底（零素材也有声）
    if (typeof window !== 'undefined' && window.audioSynth && window.audioSynth.getCached) {
      const ov = (slot && slot.synth) ? slot.synth : null;
      const cached = window.audioSynth.getCached(type, key, ov);
      if (cached) {
        return { kind: 'synth', buffer: cached, volume: (slot && slot.volume) || 1 };
      }
      try { window.audioSynth.ensure(type, key, ov); } catch (e) { /* 静默 */ }
      return { kind: 'synth-pending' };
    }

    return { kind: 'none' };
  }

  _playResolved(key, type) {
    let r;
    try { r = this._resolveSound(key, type); } catch (e) { r = null; }
    if (!r) return;
    if (r.kind === 'custom') { this.play(r.url, r.volume); return; }
    if (r.kind === 'synth') { this._playBuffer(r.buffer, r.volume); return; }
    // muted / none / synth-pending 一律静默
  }

  /** 播放一个已渲染好的 AudioBuffer（合成音专用；与 play() 走同一条 sfx 总线） */
  _playBuffer(buffer, volume) {
    if (!buffer || !this._ctx) return;
    if (!this._unlocked) { this._unlock(); }
    if (!this._ctx) return;
    try {
      const src = this._ctx.createBufferSource();
      src.buffer = buffer;
      const gainNode = this._ctx.createGain();
      const vol = (volume != null) ? Math.max(0, Math.min(1, volume)) : 1;
      gainNode.gain.value = vol;
      src.connect(gainNode);
      gainNode.connect(this._sfxGain);
      src.start(0);
    } catch (e) {
      console.warn('[SoundManager] 合成音播放失败:', e.message);
    }
  }

  /**
   * 播放指定动作的音效（由 world.js 或 player.js 调用）
   * @param {string} animKey  'walk'|'run'|'jump'|'attack1'|...
   */
  playAnimSound(animKey) {
    this._playResolved(animKey, 'anim');
  }

  /**
   * 播放指定武器音效
   * @param {string} soundKey  武器音效键名
   */
  playWeaponSound(soundKey) {
    this._playResolved(soundKey, 'weapon');
  }
}

// 脚步循环在 _loopNodes 里占用的固定 key（走/跑共用一条，切换时替换）
SoundManager.MOVE_LOOP_KEY = 'anim_move';

// 全局单例
window.soundManager = new SoundManager();
