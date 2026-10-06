/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 管理员凭证自动注入（安全修复 D1 / 例外 E2）
 * ------------------------------------------------------------------
 * 背景：后台（admin.html）与两个编辑器（world_editor.html / unified_editor.html）里
 * 绝大多数写操作是**逐处裸 fetch / XHR，不带 Authorization**（S0 普查 §13.1 实测）。
 * 一旦后端给管理级写接口加门禁，这些调用会全部 401、后台自己就不能用了。
 * 本文件是**唯一**的前端改动：统一在发请求前注入 `Authorization: Bearer <adminToken>`。
 *
 * 注入条件（三条同时满足）：
 *   1. 方法**不是** GET / HEAD / OPTIONS；
 *      ⚠️ 例外：命中「敏感读白名单」的 GET 也会注入（见下 SENTITIVE_GET_RULES）。
 *   2. URL 是**本站同源**且路径含 `/api/`；
 *      ⚠️ 同源限制是本实现的必要收紧：联邦传送/家园世界会向**其他世界**发起
 *      `/api/inventory/remote-add` 等请求，把管理员凭证发给别的世界等于凭证外泄。
 *   3. `localStorage.adminToken` 存在。
 *
 * ★敏感读白名单（Phase 0 新增，2026-10-06）：
 *   背景：给 `GET /api/ai-providers/providers/:id` 加了 `authenticateAdminToken`
 *   （该端点 `?include_sensitive=true` 会返回 **API Key 明文**，原来是匿名可读的）。
 *   但后台「AI 服务商」页恰好用 **GET** 调它（`adminAIProviders.js:226` 拉密钥做编辑回填），
 *   而本模块原本对 GET 一律不注入 → 加门禁后后台自己 401，功能反而被打断。
 *   规则：只有**显式列出**的敏感读才注入，且必须同源 + 有 token；
 *   绝不扩大到"所有 /api/ GET"（那等于把管理员凭证发去所有读接口）。
 *   新增敏感读端点时，同步在这里加一条规则。
 *
 * 注入的判定口 `window.__adminAuthFetch.shouldInject(url, method)` 已含白名单逻辑，
 * 验收脚本直接断言它，不依赖真实网络。
 *
 * 不注入的情况：
 *   - 登录/注册类端点（`/api/auth/*`、`/api/admin-auth/*`）——它们本就不需要凭证，
 *     且登录页可能残留过期 token；
 *   - 调用点已自行设置 `Authorization`（保留调用方原值，绝不覆盖）。
 *
 * 其它约定：
 *   - **从不设置 Content-Type**，因此 `FormData` 上传天然带正确的 multipart boundary；
 *   - fetch 与 XMLHttpRequest 双通道包装；
 *   - 暴露 `window.__adminAuthFetch`（含 installed / 计数 / shouldInject）供验收断言。
 */
(function () {
  'use strict';

  if (window.__adminAuthFetch && window.__adminAuthFetch.installed) return;

  var LOGIN_PREFIXES = ['/api/auth/', '/api/admin-auth/'];

  /**
   * 敏感读白名单（GET 也需要管理员凭证的端点）
   * 每条 = { test(pathname, search): bool, why: 说明 }
   * 刻意用函数而不是前缀数组：这些端点都是 /api/xxx/<id> 形态，
   * 用前缀会把同层的无关端点（如 /providers/5/toggle 的 GET 变体）一起捞进来。
   */
  var SENTITIVE_GET_RULES = [
    {
      why: 'AI 服务商详情（?include_sensitive=true 返回 API Key 明文）',
      test: function (p, search) {
        return /^\/api\/ai-providers\/providers\/\d+$/.test(p) && /include_sensitive=true/.test(search || '');
      }
    },
    {
      why: 'AI 服务商审计日志（暴露谁改了哪个键）',
      test: function (p) {
        return /^\/api\/ai-providers\/(providers\/\d+\/audit-logs|audit-logs)$/.test(p);
      }
    },
  ];

  function isSensitiveGet(pathname, search) {
    for (var i = 0; i < SENTITIVE_GET_RULES.length; i++) {
      try { if (SENTITIVE_GET_RULES[i].test(pathname, search)) return SENTITIVE_GET_RULES[i].why; } catch (e) { /* 规则异常不阻断 */ }
    }
    return null;
  }

  var stats = { injected: 0, skippedLogin: 0, skippedNoToken: 0, skippedCrossOrigin: 0, injectedSensitiveGet: 0 };

  function token() {
    try { return localStorage.getItem('adminToken') || ''; } catch (e) { return ''; }
  }

  function toAbsolute(url) {
    try { return new URL(String(url), window.location.href); } catch (e) { return null; }
  }

  function shouldInject(url, method) {
    var m = String(method || 'GET').toUpperCase();
    var abs = toAbsolute(url);
    if (!token()) { stats.skippedNoToken++; return false; }
    if (!abs) return false;
    if (abs.origin !== window.location.origin) { stats.skippedCrossOrigin++; return false; }
    if (abs.pathname.indexOf('/api/') === -1) return false;

    for (var i = 0; i < LOGIN_PREFIXES.length; i++) {
      if (abs.pathname.indexOf(LOGIN_PREFIXES[i]) === 0) { stats.skippedLogin++; return false; }
    }

    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') {
      // 只有白名单里的敏感读才注入（Phase 0）
      if (m === 'GET' && isSensitiveGet(abs.pathname, abs.search)) { stats.injectedSensitiveGet++; return true; }
      return false;
    }
    return true;
  }

  function hasAuthorization(headers) {
    if (!headers) return false;
    if (typeof Headers !== 'undefined' && headers instanceof Headers) return headers.has('Authorization');
    if (Array.isArray(headers)) {
      return headers.some(function (p) { return String(p[0]).toLowerCase() === 'authorization'; });
    }
    return Object.keys(headers).some(function (k) { return k.toLowerCase() === 'authorization'; });
  }

  /** 返回注入了 Authorization 的新 headers（保持原类型） */
  function withAuthorization(headers) {
    var value = 'Bearer ' + token();
    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
      var h = new Headers(headers);
      h.set('Authorization', value);
      return h;
    }
    if (Array.isArray(headers)) {
      var arr = headers.slice();
      arr.push(['Authorization', value]);
      return arr;
    }
    var obj = Object.assign({}, headers || {});
    obj['Authorization'] = value;
    return obj;
  }

  // ────────────────────────── fetch ──────────────────────────
  var originalFetch = window.fetch;
  if (typeof originalFetch === 'function') {
    window.fetch = function (input, init) {
      try {
        var isRequest = typeof Request !== 'undefined' && input instanceof Request;
        var url = isRequest ? input.url : input;
        var method = (init && init.method) || (isRequest ? input.method : 'GET');
        var headers = init && init.headers;

        if (shouldInject(url, method) && !hasAuthorization(headers || (isRequest ? input.headers : null))) {
          if (isRequest && !init) {
            var cloned = new Request(input, { headers: withAuthorization(input.headers) });
            stats.injected++;
            return originalFetch.call(this, cloned);
          }
          var nextInit = Object.assign({}, init || {});
          nextInit.headers = withAuthorization(headers || (isRequest ? input.headers : undefined));
          stats.injected++;
          return originalFetch.call(this, input, nextInit);
        }
      } catch (e) {
        // 注入失败绝不能影响原请求
        console.warn('[adminAuthFetch] fetch 注入失败（已按原样放行）:', e && e.message);
      }
      return originalFetch.apply(this, arguments);
    };
  }

  // ───────────────────── XMLHttpRequest ─────────────────────
  if (typeof XMLHttpRequest !== 'undefined') {
    var originalOpen = XMLHttpRequest.prototype.open;
    var originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    var originalSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
      this.__adminAuthMethod = method;
      this.__adminAuthUrl = url;
      this.__adminAuthHasAuth = false;
      return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
      if (String(name).toLowerCase() === 'authorization') this.__adminAuthHasAuth = true;
      return originalSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function () {
      try {
        if (!this.__adminAuthHasAuth && shouldInject(this.__adminAuthUrl, this.__adminAuthMethod)) {
          originalSetRequestHeader.call(this, 'Authorization', 'Bearer ' + token());
          stats.injected++;
        }
      } catch (e) {
        console.warn('[adminAuthFetch] XHR 注入失败（已按原样放行）:', e && e.message);
      }
      return originalSend.apply(this, arguments);
    };
  }

  window.__adminAuthFetch = {
    installed: true,
    version: 2,
    stats: stats,
    shouldInject: shouldInject,
    isSensitiveGet: isSensitiveGet,
    sensitiveGetRules: SENTITIVE_GET_RULES.map(function (r) { return r.why; }),
    tokenPresent: function () { return !!token(); },
  };
})();
