/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * SkillHUD - 技能栏 UI
 * 负责：屏幕技能按钮渲染、冷却动画、语音按钮、移动端/PC自适应
 */
class SkillHUD {
  constructor() {
    this.container = null;
    this.slotEls = {};        // { skillId: Element }
    this.cooldownTimers = {}; // { skillId: rafId }
    this.voiceBtn = null;
    this._styleInjected = false;
    this._cdTipTimer = null;  // 冷却提示弹窗定时器

    // 等待 DOM 就绪后初始化
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
  }

  init() {
    this._injectStyles();
    this._createContainer();
    this._createVoiceButton();
    // 初始渲染空槽位（5个）
    this.renderSlots({});
  }

  // ─── 样式注入 ──────────────────────────────────────────────────

  _injectStyles() {
    if (this._styleInjected) return;
    this._styleInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      #skill-hud {
        position: fixed;
        bottom: 24px;
        right: 24px;
        display: flex;
        flex-direction: row;
        gap: 8px;
        align-items: flex-end;
        z-index: 1500;
        pointer-events: auto;
      }

      /* 移动端：按钮更大，避免遮挡跳跃按钮 */
      @media (max-width: 768px) {
        #skill-hud {
          bottom: 200px;
          right: 16px;
          gap: 6px;
        }
      }

      .skill-slot {
        position: relative;
        width: 58px;
        height: 58px;
        border-radius: 10px;
        border: 2px solid rgba(0,255,0,0.5);
        background: rgba(0,0,0,0.75);
        cursor: pointer;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        transition: transform 0.1s, border-color 0.2s;
        overflow: hidden;
        user-select: none;
        -webkit-tap-highlight-color: transparent;
        backdrop-filter: blur(4px);
      }

      .skill-slot:hover,
      .skill-slot:active {
        transform: scale(0.92);
        border-color: rgba(0,255,0,0.9);
      }

      .skill-slot.empty {
        border-color: rgba(255,255,255,0.15);
        cursor: default;
      }

      .skill-slot.on-cooldown {
        cursor: not-allowed;
      }

      .skill-slot .sk-icon {
        font-size: 22px;
        line-height: 1;
        margin-bottom: 1px;
      }

      .skill-slot .sk-name {
        font-size: 9px;
        color: #00ff00;
        font-family: 'Courier New', monospace;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        max-width: 52px;
        text-overflow: ellipsis;
      }

      .skill-slot.empty .sk-icon { opacity: 0.2; }
      .skill-slot.empty .sk-name { opacity: 0.2; }

      /* 冷却遮罩（顺时针扇形，CSS conic-gradient）*/
      .skill-slot .sk-cooldown-mask {
        position: absolute;
        inset: 0;
        border-radius: 8px;
        background: conic-gradient(
          rgba(0,0,0,0.7) var(--cd-angle, 0deg),
          transparent var(--cd-angle, 0deg)
        );
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s;
      }

      .skill-slot.on-cooldown .sk-cooldown-mask {
        opacity: 1;
      }

      /* 冷却倒计时文字 */
      .skill-slot .sk-cd-text {
        position: absolute;
        bottom: 2px;
        right: 4px;
        font-size: 10px;
        font-weight: bold;
        color: #ffffff;
        font-family: 'Courier New', monospace;
        text-shadow: 0 0 4px #000;
        opacity: 0;
        pointer-events: none;
      }

      .skill-slot.on-cooldown .sk-cd-text {
        opacity: 1;
      }

      /* 技能触发闪光效果 */
      .skill-slot.activated::after {
        content: '';
        position: absolute;
        inset: 0;
        border-radius: 8px;
        background: rgba(255,255,255,0.4);
        animation: sk-flash 0.3s ease-out forwards;
      }

      @keyframes sk-flash {
        0%   { opacity: 1; }
        100% { opacity: 0; }
      }

      /* 语音按钮 */
      #skill-voice-btn {
        position: fixed !important;
        bottom: 24px !important;
        right: 24px !important;
        width: 58px !important;
        height: 58px !important;
        border-radius: 50% !important;
        border: 2px solid rgba(255,80,80,0.6) !important;
        background: rgba(0,0,0,0.75) !important;
        cursor: pointer !important;
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        justify-content: center !important;
        transition: transform 0.1s, border-color 0.2s, box-shadow 0.2s !important;
        user-select: none !important;
        -webkit-tap-highlight-color: transparent !important;
        backdrop-filter: blur(4px) !important;
        flex-shrink: 0 !important;
        z-index: 1500 !important;
      }

      #skill-voice-btn.listening {
        border-color: #ff4444;
        box-shadow: 0 0 14px rgba(255,68,68,0.8);
        animation: voice-pulse 0.8s ease-in-out infinite alternate;
      }

      @keyframes voice-pulse {
        0%   { transform: scale(1.0); }
        100% { transform: scale(1.08); }
      }

      #skill-voice-btn .sv-icon { font-size: 22px; }
      #skill-voice-btn .sv-label {
        font-size: 9px;
        color: #ff8888;
        font-family: 'Courier New', monospace;
        margin-top: 1px;
      }

      /* 冷却提示弹窗 */
      #skill-cd-tip {
        position: fixed;
        bottom: 100px;
        right: 24px;
        background: rgba(0,0,0,0.85);
        color: #ff8800;
        font-size: 12px;
        font-family: 'Courier New', monospace;
        padding: 6px 12px;
        border: 1px solid #ff8800;
        border-radius: 6px;
        z-index: 2000;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s;
      }
      #skill-cd-tip.visible { opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  // ─── 容器创建 ──────────────────────────────────────────────────

  _createContainer() {
    this.container = document.createElement('div');
    this.container.id = 'skill-hud';
    document.body.appendChild(this.container);

    // 冷却提示弹窗
    this.cdTip = document.createElement('div');
    this.cdTip.id = 'skill-cd-tip';
    document.body.appendChild(this.cdTip);

    // 应用UI控件管理器的配置（如果已初始化）
    this._applyUIControlConfig();
  }

  /**
   * 应用UI控件管理器的配置
   */
  _applyUIControlConfig() {
    // 轮询等待 uiControlManager 初始化完成后应用配置
    const maxRetries = 30; // 最多等3秒
    let retries = 0;
    const tryApply = () => {
      retries++;
      if (window.uiControlManager && window.uiControlManager.initialized) {
        // 应用技能栏配置
        window.uiControlManager.applyControl('skill_hud', this.container);
        // 语音按钮已独立添加到body，在_createVoiceButton中已应用配置
      } else if (retries < maxRetries) {
        setTimeout(tryApply, 100);
      }
    };
    setTimeout(tryApply, 100);
  }

  // ─── 渲染技能槽位 ──────────────────────────────────────────────

  renderSlots(slots) {
    // 先取消所有正在运行的冷却动画RAF，避免内存泄漏
    Object.keys(this.cooldownTimers).forEach(id => {
      cancelAnimationFrame(this.cooldownTimers[id]);
    });
    this.cooldownTimers = {};

    // 清空旧的技能槽
    Array.from(this.container.children).forEach(el => {
      el.remove();
    });
    this.slotEls = {};

    // 渲染5个槽位
    for (let i = 1; i <= 5; i++) {
      const skill = slots[i];
      const el = this._createSlotEl(i, skill);
      this.container.appendChild(el);
      if (skill) this.slotEls[skill.id] = el;
    }
  }

  _createSlotEl(slotIndex, skill) {
    const el = document.createElement('div');
    el.className = 'skill-slot' + (skill ? '' : ' empty');
    el.dataset.slot = slotIndex;
    if (skill) el.dataset.skillId = skill.id;

    // 冷却遮罩层
    const mask = document.createElement('div');
    mask.className = 'sk-cooldown-mask';
    el.appendChild(mask);

    // 图标
    const icon = document.createElement('div');
    icon.className = 'sk-icon';
    const presetInfo = skill && window.skillManager
      ? window.skillManager.FX_PRESET_INFO[skill.fx_preset] || { emoji: skill.icon_emoji || '⚡' }
      : { emoji: '·' };
    icon.textContent = skill ? (skill.icon_emoji || presetInfo.emoji || '⚡') : '·';
    el.appendChild(icon);

    // 名称
    const name = document.createElement('div');
    name.className = 'sk-name';
    name.textContent = skill ? (skill.skill_name || '技能' + slotIndex) : '空';
    el.appendChild(name);

    // 冷却倒计时文字
    const cdText = document.createElement('div');
    cdText.className = 'sk-cd-text';
    el.appendChild(cdText);

    // 事件：防止移动端 touchend + click 双重触发
    if (skill) {
      let touchTriggered = false;

      const triggerSkill = () => {
        if (window.skillManager) {
          window.skillManager.trigger(skill.id);
        }
        // 触发闪光
        el.classList.add('activated');
        setTimeout(() => el.classList.remove('activated'), 400);
      };

      el.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        touchTriggered = true;
        triggerSkill();
        // 300ms内阻止click
        setTimeout(() => { touchTriggered = false; }, 400);
      }, { passive: false });

      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (touchTriggered) return; // 移动端已由touchend处理
        triggerSkill();
      });
    }

    return el;
  }

  // ─── 冷却动画 ──────────────────────────────────────────────────

  startCooldown(skillId, cooldownMs) {
    const el = this.slotEls[skillId];
    if (!el) return;

    el.classList.add('on-cooldown');
    const mask = el.querySelector('.sk-cooldown-mask');
    const cdText = el.querySelector('.sk-cd-text');
    const endTime = Date.now() + cooldownMs;

    const update = () => {
      const now = Date.now();
      const remaining = endTime - now;
      if (remaining <= 0) {
        el.classList.remove('on-cooldown');
        if (mask) mask.style.setProperty('--cd-angle', '0deg');
        if (cdText) cdText.textContent = '';
        delete this.cooldownTimers[skillId];
        return;
      }
      // 冷却角度（从360deg减到0deg，代表剩余时间）
      const progress = remaining / cooldownMs; // 1→0
      const angle = Math.round(progress * 360);
      if (mask) mask.style.setProperty('--cd-angle', angle + 'deg');
      if (cdText) cdText.textContent = (remaining / 1000).toFixed(1) + 's';
      this.cooldownTimers[skillId] = requestAnimationFrame(update);
    };

    if (this.cooldownTimers[skillId]) cancelAnimationFrame(this.cooldownTimers[skillId]);
    this.cooldownTimers[skillId] = requestAnimationFrame(update);
  }

  // ─── 冷却提示 ──────────────────────────────────────────────────

  showCooldownTip(skillName, remaining) {
    if (!this.cdTip) return;
    this.cdTip.textContent = `${skillName} 冷却中 ${remaining}s`;
    this.cdTip.classList.add('visible');
    clearTimeout(this._cdTipTimer);
    this._cdTipTimer = setTimeout(() => {
      if (this.cdTip) this.cdTip.classList.remove('visible');
    }, 1500);
  }

  // ─── 语音按钮 ──────────────────────────────────────────────────

  _createVoiceButton() {
    this.voiceBtn = document.createElement('div');
    this.voiceBtn.id = 'skill-voice-btn';
    // 设置默认内联样式，确保初始位置正确
    this.voiceBtn.style.position = 'fixed';
    this.voiceBtn.style.bottom = '24px';
    this.voiceBtn.style.right = '24px';
    this.voiceBtn.style.zIndex = '1500';
    this.voiceBtn.innerHTML = `
      <div class="sv-icon">🎤</div>
      <div class="sv-label">语音</div>
    `;
    // 将语音按钮直接添加到body，独立定位（不受技能栏容器影响）
    document.body.appendChild(this.voiceBtn);

    // 应用UI控件管理器的配置（如果已初始化）
    if (window.uiControlManager && window.uiControlManager.initialized) {
      setTimeout(() => {
        window.uiControlManager.applyControl('skill_voice_btn', this.voiceBtn);
      }, 100);
    }

    let isListening = false;

    const startVoice = (e) => {
      e.preventDefault();
      e.stopPropagation();
      // 懒获取已有的VoiceManager实例（由main.js或voice.js创建）
      // 注意：skillHUD不应自行创建VoiceManager（需要完整player对象）
      const vm = window.voiceManagerInstance;
      if (vm && !isListening) {
        vm.startListening();
        isListening = true;
        this.voiceBtn.classList.add('listening');
      } else if (!vm) {
        console.warn('[SkillHUD] voiceManagerInstance 未初始化，请确保 main.js 中已创建');
      }
    };

    const stopVoice = (e) => {
      e.preventDefault();
      const vm = window.voiceManagerInstance;
      if (vm && isListening) {
        vm.stopListening();
        isListening = false;
        this.voiceBtn.classList.remove('listening');
      }
    };

    // 长按触发持续监听，松开停止
    this.voiceBtn.addEventListener('mousedown', startVoice);
    this.voiceBtn.addEventListener('mouseup', stopVoice);
    this.voiceBtn.addEventListener('mouseleave', stopVoice);
    this.voiceBtn.addEventListener('touchstart', startVoice, { passive: false });
    this.voiceBtn.addEventListener('touchend', stopVoice, { passive: false });
    this.voiceBtn.addEventListener('touchcancel', stopVoice, { passive: false });
  }
}

// 全局单例，页面加载后自动初始化
window.skillHUD = new SkillHUD();
