/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * SkillManager - 特效触发系统
 * 负责：特效触发逻辑、动画和视觉效果
 */
class SkillManager {
  constructor() {
    this.characterId = null;
    this._loaded = false;

    // fx_preset 展开表（与Admin保持一致）
    this.FX_PRESETS = {
      fire_slash:   { fx_blade_color: '#ff3300', fx_glow_intensity: 2.5, fx_particle_type: 'fire',      fx_duration: 2000 },
      ice_stab:     { fx_blade_color: '#88ccff', fx_glow_intensity: 2.0, fx_particle_type: 'ice',       fx_duration: 2000 },
      thunder:      { fx_blade_color: '#ffee44', fx_glow_intensity: 3.0, fx_particle_type: 'lightning', fx_duration: 1500 },
      dark_slash:   { fx_blade_color: '#9900cc', fx_glow_intensity: 2.0, fx_particle_type: 'dark',      fx_duration: 2500 },
      holy_slash:   { fx_blade_color: '#fffacc', fx_glow_intensity: 2.5, fx_particle_type: 'holy',      fx_duration: 2000 },
      poison_sting: { fx_blade_color: '#33ff66', fx_glow_intensity: 1.8, fx_particle_type: 'poison',    fx_duration: 3000 },
    };
  }

  /**
   * 设置角色ID
   * @param {string} characterId
   */
  setCharacterId(characterId) {
    this.characterId = characterId;
  }

  /**
   * 触发武器特效
   * @param {object} effect 特效对象
   */
  triggerEffect(effect) {
    // 1. 动画
    this._triggerAnimation(effect);

    // 2. 武器特效（粒子+颜色）
    this._triggerWeaponFx(effect);

    // 3. 声音
    this._playSound(effect);
  }

  // ─── 内部方法 ───────────────────────────────────────────────────

  _triggerAnimation(effect) {
    const world = window.gameWorld || window.currentWorld;
    const charId = this.characterId || window.GAME_STATE?.characterId;
    if (!world || !charId) return;
    const animKey = effect.animation || 'attack1';
    // 支持的动作键才切换
    const validKeys = ['idle','walk','run','jump','attack1','attack2','attack3',
      'hit','death','draw_sword','sheath','attack_stab','attack_slash','attack_swing','attack_uppercut'];
    if (validKeys.includes(animKey)) {
      world._switchPlayerAnim(charId, animKey);
      // 动作结束后回到idle（非循环动作）
      const duration = effect.duration * 1000 || 2000;
      setTimeout(() => {
        const curMode = world.players?.get(charId)?.group?.userData?.currentAnimMode;
        // 若当前还是技能动作，或取值失败，都回到idle
        if (!curMode || curMode === animKey) {
          world._switchPlayerAnim(charId, 'idle');
        }
      }, duration + 300);
    }
  }

  _triggerWeaponFx(effect) {
    const world = window.gameWorld || window.currentWorld;
    const charId = this.characterId || window.GAME_STATE?.characterId;
    if (!world || !charId) return;
    
    // 映射粒子类型到特效参数
    const typeColorMap = {
      fire:      { fx_blade_color: '#ff3300', fx_glow_intensity: 2.5, fx_particle_type: 'fire',      fx_duration: 2000 },
      ice:       { fx_blade_color: '#88ccff', fx_glow_intensity: 2.0, fx_particle_type: 'ice',       fx_duration: 2000 },
      lightning: { fx_blade_color: '#ffee44', fx_glow_intensity: 3.0, fx_particle_type: 'lightning', fx_duration: 1500 },
      dark:      { fx_blade_color: '#9900cc', fx_glow_intensity: 2.0, fx_particle_type: 'dark',      fx_duration: 2500 },
      holy:      { fx_blade_color: '#fffacc', fx_glow_intensity: 2.5, fx_particle_type: 'holy',      fx_duration: 2000 },
      poison:    { fx_blade_color: '#33ff66', fx_glow_intensity: 1.8, fx_particle_type: 'poison',    fx_duration: 3000 },
      spark:     { fx_blade_color: '#ffffaa', fx_glow_intensity: 1.5, fx_particle_type: 'spark',     fx_duration: 1500 },
    };
    
    const fx = typeColorMap[effect.particleType] || typeColorMap.fire;
    world.triggerSkillWeaponFx(charId, fx);
  }

  _playSound(effect) {
    if (!window.soundManager) return;
    if (effect.soundUrl) {
      // 使用 ?? 而非 || 以正确处理音量为0的情况
      const volume = effect.volume ?? 0.8;
      window.soundManager.play(effect.soundUrl, volume);
    }
  }

  /**
   * 语音触发技能
   * @param {string} text - 语音识别文本
   * @returns {boolean} 是否成功触发技能
   */
  triggerByVoice(text) {
    // 这里应该实现与数据库中技能的 trigger_text 匹配逻辑
    // 暂时返回 false，表明没有匹配到技能
    console.log('SkillManager.triggerByVoice called with:', text);
    return false;
  }
}

// 全局单例
window.skillManager = new SkillManager();
