/**
 * 动作趴地检测修复（前端入口）
 *
 * 在"编辑角色模板 → 动作配置 → 自定义上传动作"列表中，
 * 每个已上传动作卡片的"检测修复"按钮调用本模块。
 *
 * 依赖全局：
 *   - _currentTmplId        （当前模板 id）
 *   - getAdminToken()        （admin.html 已有，返回 Bearer token）
 *   - _tchT(key, fallback)   （角色模板 i18n 翻译函数）
 *   - showToast(msg, type)   （admin.html 已有提示函数）
 */
window.AnimUpAxisFixer = (function () {

  // 安全访问 admin.html 内的局部函数（通过 window 或全局兜底）
  function toast(msg, type) {
    if (typeof window.showToast === 'function') return window.showToast(msg, type);
    if (typeof showToast === 'function') return showToast(msg, type);
    // 最后兜底：alert
    console.warn('[AnimUpAxisFixer] toast:', msg);
    return null;
  }
  function t(key, fallback) {
    // 兼容历史前缀：adminChars -> adminCharacters（i18n 资源命名空间）
    if (key.indexOf('adminChars.') === 0) key = 'adminCharacters.' + key.slice('adminChars.'.length);
    if (typeof window._tchT === 'function') return window._tchT(key, fallback);
    if (typeof _tchT === 'function') return _tchT(key, fallback);
    if (window.i18n && typeof window.i18n.t === 'function') {
      const r = window.i18n.t(key);
      return (r && r !== key) ? r : fallback;
    }
    return fallback;
  }
  function getToken() {
    try {
      if (typeof window.getAdminToken === 'function') return window.getAdminToken();
      if (typeof getAdminToken === 'function') return getAdminToken();
      const tk = (typeof localStorage !== 'undefined') ? localStorage.getItem('adminToken') : '';
      return tk || '';
    } catch (e) { return ''; }
  }

  // 统一的检测/修复调用
  function fix(animKey, animUrl, templateId, btnEl) {
    let tid = templateId;
    if (tid === 'null' || tid === 'undefined' || tid === '' || tid == null) {
      try {
        tid = (typeof _currentTmplId !== 'undefined' && _currentTmplId != null && _currentTmplId !== '') ? _currentTmplId : null;
      } catch (e) { tid = null; }
    }
    if (!tid) {
      toast(t('adminChars.animFixTmplErr', '请先保存模板基本信息后再修复'), 'error');
      return;
    }
    if (!animUrl) {
      toast(t('adminChars.animFixNoFile', '该动作尚未上传文件'), 'error');
      return;
    }

    const originalText = btnEl ? btnEl.textContent : '';
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = t('adminChars.animFixing', '检测修复中…');
    }

    fetch(`/api/character-templates/anim-library/${tid}/fix-up-axis`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + getToken(),
      },
      body: JSON.stringify({ anim_url: animUrl }),
    })
      .then((r) => r.json().then((d) => ({ ok: r.ok, data: d })))
      .then(({ ok, data }) => {
        if (!ok || !data.success) {
          toast(t('adminChars.animFixFailed', '修复失败') + ': ' + (data.error || ''), 'error');
          return;
        }
        if (data.detected) {
          toast(t('adminChars.animFixDone', '已修复 {count} 帧，请刷新预览').replace('{count}', data.fixedFrames), 'success');
          // 自动给预览 url 加版本号，强制刷新缓存
          try {
            const cacheBust = animUrl + (animUrl.indexOf('?') >= 0 ? '&' : '?') + 'v=' + Date.now();
            const field = 'anim_' + animKey + '_url';
            if (window._tmplAnimData) window._tmplAnimData[field] = cacheBust;
          } catch (e) { /* 忽略缓存处理异常 */ }
        } else {
          toast(t('adminChars.animFixNone', '未检测到趴地问题，无需修复'), 'info');
        }
      })
      .catch((e) => {
        toast(t('adminChars.animFixFailed', '修复失败') + ': ' + e.message, 'error');
      })
      .finally(() => {
        if (btnEl) {
          btnEl.disabled = false;
          btnEl.textContent = originalText;
        }
      });
  }

  return { fix };
})();
