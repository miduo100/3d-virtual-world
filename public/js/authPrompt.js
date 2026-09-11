/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 登录过期弹窗模块（authPrompt.js）
 *
 * 作用：token 过期/失效时，在当前页面弹出登录框，用户重新登录后
 * 不刷新页面、不移动玩家位置，由 api.js 拿到新 token 后自动重试原请求。
 *
 * 对外接口：
 *   window.AuthPrompt.prompt() -> Promise<loginResult>
 *     - 登录成功：resolve({ token, userId, characterId })
 *     - 用户取消：reject(new Error('用户取消登录'))
 *   window.AuthPrompt.isShowing() -> boolean
 *
 * 特性：
 *   - 全局单例：多个请求同时失效时只弹一次框，后续请求共享同一次登录结果
 *   - 登录失败在弹窗内提示，可反复重试，不清空已输入的账号
 *   - 成功后同步更新 localStorage（token/userId/characterId）与 GAME_STATE
 */
(function () {
  'use strict';

  let _overlay = null;      // 弹窗 DOM（懒创建）
  let _pendingPromise = null; // 当前进行中的登录 Promise（单例门）

  const CSS = `
    ap-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);
      display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px);}
    ap-card{width:320px;max-width:90vw;background:#1e2430;
      border:1px solid #3a4254;border-radius:10px;padding:24px;box-shadow:0 8px 32px rgba(0,0,0,.5);
      font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;color:#e8ecf1;}
    ap-card h3{margin:0 0 6px;font-size:17px;color:#ffd166;}
    ap-card .ap-sub{margin:0 0 16px;font-size:12px;color:#9aa4b2;line-height:1.5;}
    ap-card label{display:block;font-size:12px;color:#9aa4b2;margin:10px 0 4px;}
    ap-card input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:6px;
      border:1px solid #3a4254;background:#141922;color:#e8ecf1;font-size:14px;outline:none;}
    ap-card input:focus{border-color:#5b8cff;}
    ap-card .ap-err{min-height:18px;margin-top:10px;font-size:12px;color:#ff6b6b;}
    ap-card .ap-btns{display:flex;gap:10px;margin-top:8px;}
    ap-card button{flex:1;padding:9px 0;border-radius:6px;border:none;font-size:14px;cursor:pointer;}
    ap-card .ap-ok{background:#5b8cff;color:#fff;}
    ap-card .ap-ok:disabled{background:#3a4254;cursor:not-allowed;}
    ap-card .ap-cancel{background:transparent;color:#9aa4b2;border:1px solid #3a4254;}
  `;

  function buildDom() {
    if (_overlay) return _overlay;
    const style = document.createElement('style');
    style.textContent = CSS.replace(/ap-/g, '.ap-');
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'ap-overlay';
    overlay.innerHTML = `
      <div class="ap-card">
        <h3>登录已过期</h3>
        <p class="ap-sub">为了继续本次操作，请重新登录。登录后当前进度和位置不会丢失。</p>
        <label>账号</label>
        <input class="ap-user" type="text" autocomplete="username" maxlength="32">
        <label>密码</label>
        <input class="ap-pass" type="password" autocomplete="current-password" maxlength="64">
        <div class="ap-err"></div>
        <div class="ap-btns">
          <button class="ap-cancel" type="button">取消</button>
          <button class="ap-ok" type="button">登 录</button>
        </div>
      </div>`;

    const $user = overlay.querySelector('.ap-user');
    const $pass = overlay.querySelector('.ap-pass');
    const $err = overlay.querySelector('.ap-err');
    const $ok = overlay.querySelector('.ap-ok');
    const $cancel = overlay.querySelector('.ap-cancel');

    $cancel.addEventListener('click', () => close());
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !$ok.disabled) $ok.click();
      if (e.key === 'Escape') close();
      // 阻止游戏快捷键（WASD/空格等）落到世界页
      e.stopPropagation();
    });

    function close() {
      if (_overlay) { _overlay.remove(); _overlay = null; }
    }

    function setBusy(busy) {
      $ok.disabled = busy;
      $ok.textContent = busy ? '登录中...' : '登 录';
      $user.disabled = busy; $pass.disabled = busy; $cancel.disabled = busy;
    }

    function setError(msg) { $err.textContent = msg || ''; }

    $ok.addEventListener('click', async () => {
      const username = $user.value.trim();
      const password = $pass.value;
      if (!username) { setError('请输入账号'); return; }
      if (!password) { setError('请输入密码'); return; }
      setError(''); setBusy(true);
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) {
          setError(data.error || ('登录失败 (' + res.status + ')'));
          setBusy(false);
          return;
        }
        // 登录成功：更新本地登录态
        localStorage.setItem('token', data.token);
        if (data.userId) localStorage.setItem('userId', data.userId);
        if (data.characterId) localStorage.setItem('characterId', data.characterId);
        if (typeof GAME_STATE !== 'undefined' && GAME_STATE) {
          GAME_STATE.userId = data.userId || GAME_STATE.userId;
          GAME_STATE.characterId = data.characterId || GAME_STATE.characterId;
        }
        close();
        _resolvePending({ token: data.token, userId: data.userId, characterId: data.characterId });
      } catch (e) {
        setError('网络错误，请稍后重试');
        setBusy(false);
      }
    });

    _overlay = overlay;
    document.body.appendChild(overlay);
    return overlay;
  }

  let _resolveFn = null;
  let _rejectFn = null;
  function _resolvePending(v) {
    if (_resolveFn) { const f = _resolveFn; _resolveFn = null; _rejectFn = null; _pendingPromise = null; f(v); }
  }
  function _rejectPending(e) {
    if (_rejectFn) { const f = _rejectFn; _resolveFn = null; _rejectFn = null; _pendingPromise = null; f(e); }
  }

  /**
   * 弹出登录框。重复调用（并发 403）返回同一个 Promise。
   */
  function prompt() {
    if (_pendingPromise) return _pendingPromise;
    _pendingPromise = new Promise((resolve, reject) => {
      _resolveFn = resolve;
      _rejectFn = reject;
    });
    const overlay = buildDom();
    const $user = overlay.querySelector('.ap-user');
    const $pass = overlay.querySelector('.ap-pass');
    const $err = overlay.querySelector('.ap-err');
    $err.textContent = '';
    $pass.value = '';
    if (!$user.value) {
      try {
        const info = localStorage.getItem('userInfo');
        const name = info ? (JSON.parse(info).username || '') : '';
        if (name) $user.value = name;
      } catch (e) { /* ignore */ }
    }
    setTimeout(() => { try { $user.focus(); } catch (e) {} }, 50);
    return _pendingPromise;
  }

  /** 用户取消时由 api.js 调用，拒绝所有等待中的请求 */
  function cancel() { _rejectPending(new Error('用户取消登录')); }

  window.AuthPrompt = {
    prompt,
    cancel,
    isShowing: function () { return !!_overlay; },
  };
})();
