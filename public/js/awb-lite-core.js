/**
 * awb-lite-core —— AI 世界大脑双入口简化的逻辑层（无 DOM，可单测）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 只做四件事：选项预设 / prompt 拼装 / 选址请求 / 建造编排。
 * 全部走现有 /api/world-ai 端点，不新增后端写接口。
 *
 * ★ 规模预设里的 maxObjects 是硬要求：后台旧表单默认 60 件，模板链路会继承它，
 *   60 件根本建不出村（10 栋实测 1398 件）。这里必须显式给 1200/3000/5000。
 * ★ 风格不设控件、不做关键词映射：指令原样传给模型，由 templatePlanner 自己输出 style。
 */
(function () {
  'use strict';
  var API = '/api/world-ai';

  var SCALES = {
    small:  { key: 'small',  label: '小', width: 90,  depth: 70,  maxObjects: 1200, prefix: '【规模】约 3~5 栋房。',  estimate: '约 400~600 件' },
    medium: { key: 'medium', label: '中', width: 180, depth: 120, maxObjects: 3000, prefix: '【规模】约 8~10 栋房。', estimate: '约 1200~1500 件' },
    large:  { key: 'large',  label: '大', width: 260, depth: 180, maxObjects: 5000, prefix: '【规模】约 12~16 栋房。', estimate: '约 2000~2800 件（待实测）' },
  };
  var MAX_PLOTS = 8;   // §11 决策 4：一次世界建设片区上限，成本闸门

  function jreq(method, url, body) {
    var opt = { method: method, headers: {} };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    var tk = localStorage.getItem('adminToken');
    opt.headers.Authorization = 'Bearer ' + (tk || '');
    return fetch(url, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || j.success === false) {
          throw new Error(j.error || j.reason || j.code || ('HTTP ' + r.status));
        }
        return j;
      });
    });
  }

  function scaleOf(key) { return SCALES[key] || SCALES.medium; }
  /** 规模只拼进 prompt 前缀；风格完全由用户指令表达，前端不做提取 */
  function buildPrompt(text, scaleKey) {
    return scaleOf(scaleKey).prefix + String(text || '').trim();
  }
  function regionKey() {
    return 'awb_r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
  }

  function nearOf(posKey, manual) {
    if (posKey === 'manual') {
      var x = Number(manual && manual.x), z = Number(manual && manual.z);
      if (!isFinite(x) || !isFinite(z)) throw new Error('手填坐标 x / z 必须是数字');
      // §11 决策 3：禁止落到山地（山地范围 x/z ∈ [2000,8000]）
      if (Math.abs(x) > 1000 || Math.abs(z) > 1000) {
        throw new Error('坐标超出平地范围（±1000m）。山地不允许手填建设，否则房子会半埋');
      }
      return x + ',' + z;
    }
    return posKey === 'spawn' ? 'spawn' : 'auto';
  }

  /** 只读取址，不落库。limit=N 时返回的 N 块地保证互不重叠 */
  function findSites(scaleKey, posKey, manual, limit) {
    var s = scaleOf(scaleKey);
    var near = nearOf(posKey, manual);
    var n = Math.min(MAX_PLOTS, Math.max(1, Number(limit) || 1));
    var url = API + '/sites/find?width=' + s.width + '&depth=' + s.depth
      + '&near=' + encodeURIComponent(near) + '&limit=' + n;
    return jreq('GET', url).then(function (j) {
      if (!j.sites || !j.sites.length) throw new Error(j.reason || '没找到可用空地');
      return j;
    });
  }

  function createRegion(site, scaleKey, label) {
    var s = scaleOf(scaleKey);
    return jreq('POST', API + '/regions', {
      regionKey: regionKey(),
      name: label || ('AI 建设区 ' + new Date().toLocaleString('zh-CN', { hour12: false }).slice(5, 16)),
      bounds: { kind: 'rect', x: site.x, z: site.z, width: site.width, depth: site.depth },
      autonomy: 'managed',
      constraints: { maxObjects: s.maxObjects },
    }).then(function (j) { return j.region; });
  }

  function createMission(region, promptText, scaleKey) {
    var s = scaleOf(scaleKey);
    var p = buildPrompt(promptText, scaleKey);
    return jreq('POST', API + '/missions', {
      regionKey: region.region_key,
      title: p.slice(0, 30),
      prompt: p,
      constraints: { planMode: 'template', maxObjects: s.maxObjects, placementPolicy: 'avoid' },
    }).then(function (j) { return j.mission; });
  }

  function runMission(id) {
    return jreq('POST', API + '/missions/' + encodeURIComponent(id) + '/run',
      { confirm: true, useSavedPlan: true });
  }
  function rollback(id) {
    return jreq('POST', API + '/missions/' + encodeURIComponent(id) + '/rollback', {});
  }
  function deleteRegion(key) {
    return jreq('DELETE', API + '/regions/' + encodeURIComponent(key));
  }
  function reloadStatus() {
    return Promise.all([
      jreq('GET', API + '/config').catch(function () { return null; }),
      jreq('GET', API + '/usage').catch(function () { return null; }),
    ]).then(function (a) {
      return { config: a[0] && a[0].config, usage: a[1] && a[1].usage };
    });
  }

  /**
   * 一次区域建设：选址 → 建区域 → 下委托 → 执行。
   * onStep(text) 用于把进度显示出来，绝不静默。
   * 失败时不抛：返回 error 字段，且把已建的 region/mission 带回去供回滚或排查。
   */
  function buildOnce(opts, onStep) {
    var step = function (t) { if (typeof onStep === 'function') onStep(t); };
    var region = null, mission = null;
    step('正在选址…');
    return findSites(opts.scale, opts.position, opts.manual, 1).then(function (j) {
      var site = j.sites[0];
      // 打印落库范围：11-07 踩过坐标写错整村挪 570m 的坑，件数与外形都看不出来
      step('选址 (' + site.x + ', ' + site.z + ') ' + site.width + '×' + site.depth + 'm，正在建区域…');
      return createRegion(site, opts.scale, opts.label);
    }).then(function (r) {
      region = r;
      step('区域 ' + region.region_key + ' 已建，正在下委托…');
      return createMission(region, opts.prompt, opts.scale);
    }).then(function (m) {
      mission = m;
      step('委托已建，正在执行（约 10 秒，勿刷新）…');
      return runMission(mission.id);
    }).then(function (result) {
      return { region: region, mission: mission, result: result };
    }).catch(function (e) {
      // 委托都没建起来 → 空区域是垃圾，尝试清掉；执行阶段失败则保留（可回滚）
      if (region && !mission) {
        deleteRegion(region.region_key).catch(function () {});
      }
      return { region: region, mission: mission, error: e.message };
    });
  }

  window.AWBCore = {
    SCALES: SCALES, MAX_PLOTS: MAX_PLOTS,
    scaleOf: scaleOf, buildPrompt: buildPrompt, regionKey: regionKey, nearOf: nearOf,
    findSites: findSites, createRegion: createRegion, createMission: createMission,
    runMission: runMission, rollback: rollback, deleteRegion: deleteRegion,
    reloadStatus: reloadStatus, buildOnce: buildOnce, jreq: jreq,
  };
})();
