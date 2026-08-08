/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// Voice recognition and command processing
class VoiceManager {
  constructor(player) {
    this.player = player;
    this.isListening = false;
    this.recognition = null;
    this.setupVoiceRecognition();
  }

  setupVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      console.warn('Speech Recognition not supported');
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'zh-CN';

    this.recognition.onstart = () => {
      this.isListening = true;
      UI.showVoiceIndicator(true);
    };

    this.recognition.onresult = (event) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;

        if (event.results[i].isFinal) {
          finalTranscript += transcript + ' ';
        } else {
          interimTranscript += transcript;
        }
      }

      if (finalTranscript) {
        this.processVoiceCommand(finalTranscript.trim());
      }
    };

    this.recognition.onerror = (event) => {
      console.error('Voice recognition error:', event.error);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      UI.showVoiceIndicator(false);
    };
  }

  startListening() {
    if (this.recognition && !this.isListening) {
      this.recognition.start();
    }
  }

  stopListening() {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
    }
  }

  async processVoiceCommand(text) {
    console.log('Voice command received:', text);

    // 优先走 SkillManager 的语音匹配（基于数据库技能的 trigger_text）
    if (window.skillManager && window.skillManager._loaded) {
      const matched = window.skillManager.triggerByVoice(text);
      if (matched) return;
    }

    // 降级：本地 CONFIG.VOICE_SKILLS 匹配（保持向后兼容）
    if (typeof CONFIG !== 'undefined' && CONFIG.VOICE_SKILLS) {
      for (const [triggerText, skillConfig] of Object.entries(CONFIG.VOICE_SKILLS)) {
        if (text.includes(triggerText)) {
          this.activateSkill(skillConfig);
          return;
        }
      }
    }

    // 最后降级：API远程匹配
    try {
      const result = await API.triggerSkill(this.player.characterId, text);
      if (result.effect) {
        WSClient.send({
          type: 'SKILL_CAST',
          payload: {
            characterId: this.player.characterId,
            skillId: result.skill.id,
            targetPosition: this.player.position,
            skillEffect: result.effect,
          },
        });
      }
    } catch (error) {
      console.log('No matching skill found');
    }
  }

  activateSkill(skillConfig) {
    switch (skillConfig.effect) {
      case 'ATTACK_BOOST_3MIN':
        this.player.applyBuff('ATTACK_BOOST_3MIN', skillConfig.duration, skillConfig.powerMultiplier);
        WSClient.send({
          type: 'SKILL_CAST',
          payload: {
            characterId: this.player.characterId,
            skillName: 'attack_boost',
            effect: skillConfig.effect,
            duration: skillConfig.duration,
          },
        });
        break;

      case 'ENABLE_FLIGHT':
        this.player.enableFlying();
        WSClient.send({
          type: 'SKILL_CAST',
          payload: {
            characterId: this.player.characterId,
            skillName: 'flight',
            effect: skillConfig.effect,
          },
        });
        break;

      default:
        console.log('Unknown skill effect:', skillConfig.effect);
    }
  }

  // Get user's microphone permission
  async requestMicrophonePermission() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
      return true;
    } catch (error) {
      console.error('Microphone permission denied:', error);
      return false;
    }
  }
}

// 暴露到全局作用域
if (typeof window !== 'undefined') {
  window.VoiceManager = VoiceManager;
}
