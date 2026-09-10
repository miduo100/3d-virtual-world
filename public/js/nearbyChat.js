/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 附近文字聊天：底部固定输入框，回车发送（30m 内玩家可见），上限 200 字
 * - 输入期间 stopPropagation 屏蔽移动/快捷键（WASD、V/C/M/P 等）
 * - Esc 取焦
 */
(function () {
  'use strict';

  const MAX_LEN = 200;

  function createUI() {
    if (document.getElementById('nearby-chat-wrap')) return;

    const style = document.createElement('style');
    style.textContent = `
      #nearby-chat-wrap {
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 1300;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 10px;
        background: rgba(0, 0, 0, 0.55);
        border: 1px solid rgba(0, 200, 255, 0.4);
        border-radius: 22px;
        backdrop-filter: blur(4px);
      }
      #nearby-chat-input {
        width: auto;
        field-sizing: content; /* 宽度随占位文字/输入内容自适应；不支持的浏览器回退默认宽度 */
        min-width: 150px;
        max-width: min(340px, 40vw);
        border: none;
        outline: none;
        background: transparent;
        color: #fff;
        font-size: 14px;
        padding: 4px 2px;
      }
      #nearby-chat-input::placeholder { color: rgba(255, 255, 255, 0.45); }
      #nearby-chat-counter {
        color: rgba(255, 255, 255, 0.4);
        font-size: 11px;
        min-width: 34px;
        text-align: right;
      }
      #nearby-chat-counter.empty { display: none; }
      #nearby-chat-send {
        border: none;
        background: rgba(0, 200, 255, 0.25);
        color: #66ddff;
        border-radius: 14px;
        padding: 4px 14px;
        cursor: pointer;
        font-size: 13px;
      }
      #nearby-chat-send:hover { background: rgba(0, 200, 255, 0.45); }
      @media (max-width: 768px) {
        /* 手机端输入框同样自适应内容宽度（仅限最大宽度），再整体等比例缩放 */
        #nearby-chat-input { max-width: 60vw; min-width: 110px; }
        #nearby-chat-wrap {
          bottom: 90px;
          transform: translateX(-50%) scale(0.55);
          transform-origin: center bottom;
        }
      }
    `;
    document.head.appendChild(style);

    const wrap = document.createElement('div');
    wrap.id = 'nearby-chat-wrap';

    const input = document.createElement('input');
    input.id = 'nearby-chat-input';
    input.type = 'text';
    input.maxLength = MAX_LEN;
    input.placeholder = '与附近的玩家聊天…（回车发送）';
    input.autocomplete = 'off';

    const counter = document.createElement('span');
    counter.id = 'nearby-chat-counter';
    counter.textContent = '0/' + MAX_LEN;
    counter.classList.add('empty'); // 未输入时隐藏计数器，消除占位文字右侧空白

    const sendBtn = document.createElement('button');
    sendBtn.id = 'nearby-chat-send';
    sendBtn.textContent = '发送';

    wrap.appendChild(input);
    wrap.appendChild(counter);
    wrap.appendChild(sendBtn);
    document.body.appendChild(wrap);

    // ── 操作指南弹窗显示期间隐藏聊天框（z-index 1300 > 弹窗 999，会挡住"开始游戏"按钮），弹窗关闭后恢复 ──
    const syncWithControlsHint = () => {
      const hint = document.getElementById('controls-hint');
      wrap.style.display = (hint && hint.style.display !== 'none') ? 'none' : '';
    };
    syncWithControlsHint();
    if (typeof UI !== 'undefined' && UI.hideControlsHint) {
      const origHide = UI.hideControlsHint;
      UI.hideControlsHint = function () {
        const r = origHide.apply(this, arguments);
        syncWithControlsHint();
        return r;
      };
    }

    // ── 输入期间屏蔽游戏快捷键：事件不再冒泡到 document/window 监听器 ──
    ['keydown', 'keyup', 'keypress'].forEach((evtName) => {
      input.addEventListener(evtName, (e) => e.stopPropagation());
    });

    input.addEventListener('input', () => {
      counter.textContent = input.value.length + '/' + MAX_LEN;
      counter.classList.toggle('empty', !input.value);
    });

    input.addEventListener('keydown', (e) => {
      // 中文输入法组词中的回车（确认拼音）不发送
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        send();
        input.blur(); // 空消息时也失焦（send 对空文本直接返回），按 Enter 即可退出输入
      } else if (e.key === 'Escape') {
        input.blur();
      }
    });

    sendBtn.addEventListener('click', send);

    // 回车全局快捷键：
    //   第一次按 Enter（焦点不在任何输入类元素上）→ 激活聊天输入框
    //   第二次按 Enter → 由输入框自身 keydown 处理（发送 + 自动失焦）
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      // 焦点已在输入框 → 输入框自己的 Enter 逻辑处理（发送），这里不接管
      const ae = document.activeElement;
      if (ae === input) return;
      // 焦点在其它输入类元素（登录框/弹窗等）→ 不接管
      if (ae && ae !== document.body && ae !== document.documentElement &&
          ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(ae.tagName)) return;
      // 未进世界（登录/加载中）→ 不接管
      if (typeof window.GAME_STATE === 'undefined' || !GAME_STATE.characterId) return;
      e.preventDefault();
      input.focus();
    });

    function send() {
      const text = input.value.trim().slice(0, MAX_LEN);
      if (!text) return;
      if (typeof WSClient === 'undefined' || !WSClient.isConnected()) {
        if (typeof UI !== 'undefined') UI.addChatMessage('系统', '网络未连接，消息发送失败');
        return;
      }
      WSClient.send({
        type: 'CHAT',
        payload: {
          sender: (window.GAME_STATE && GAME_STATE.characterName) || '玩家',
          message: text,
        },
      });
      input.value = '';
      counter.textContent = '0/' + MAX_LEN;
      counter.classList.add('empty');
      // 发送完成自动失焦：控制权立即切回角色移动模式（无需点击屏幕）
      input.blur();
    }

    window.nearbyChat = { send, focus: () => input.focus(), input };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createUI);
  } else {
    createUI();
  }
})();
