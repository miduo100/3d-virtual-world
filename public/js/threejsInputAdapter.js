/**
 * 济宁米多信息科技有限公司 版权所有
 * Three.js 代码输入适配器
 *
 * 目标：让低技术水平用户以任何方式提交 Three.js 代码都能被正确识别和预处理。
 * 支持输入形态：完整HTML文件、Markdown代码块、AI回复混杂文本、纯JS、URL链接
 *
 * 提供：
 *  1. detect(input)    — 输入形态识别，返回 { type, code, meta }
 *  2. extractFromHtml(html) — 从完整 HTML 提取所有内联 <script> 内容
 *  3. runWithRescue(rawInput, options) — 容错救援链，逐级降级试运行
 */
(function (global) {
  'use strict';

  /**
   * 计算代码中可渲染对象数（Points/Line/Sprite/InstancedMesh/Group 等）
   * 用于救援链验证
   */
  function countRenderables(obj) {
    if (!obj) return 0;
    let count = 0;
    obj.traverse(function (child) {
      if (child.isMesh || child.isPoints || child.isLine ||
          child.isLineSegments || child.isLineLoop || child.isSprite ||
          (child.isInstancedMesh)) {
        count++;
      }
    });
    return count;
  }

  /**
   * 简单 hash 函数 (djb2)
   */
  function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return (hash >>> 0).toString(16);
  }

  /**
   * 从完整 HTML 文档中提取所有内联 <script> 内容
   * 使用 DOMParser 解析，比正则更可靠
   * @param {string} html - 完整 HTML 文本
   * @returns {string} 提取的 JS 代码（多个 <script> 块按顺序拼接）
   */
  function extractFromHtml(html) {
    if (!html) return '';
    const scripts = [];
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script').forEach(function (s) {
        const type = (s.getAttribute('type') || '').trim().toLowerCase();
        // 丢弃 importmap（THREE 已由宿主注入）
        if (type === 'importmap') return;
        // 丢弃 JSON 数据块
        if (type === 'application/json' || type === 'application/ld+json') return;
        // 丢弃外部 src 引用（库已由宿主注入，避免重复加载冲突）
        if (s.src && s.src.trim()) return;
        // 丢弃 module 标记但实际是 import map 的
        if (s.textContent && s.textContent.trim()) {
          scripts.push(s.textContent.trim());
        }
      });
    } catch (e) {
      console.warn('[ThreeJSInputAdapter] DOMParser 解析失败，回退到正则提取:', e.message);
      // 回退方案：正则提取 <script> 块（不含 src 属性）
      const regex = /<script\b(?![^>]*\bsrc\s*=)([^>]*)>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = regex.exec(html)) !== null) {
        const attrs = m[1] || '';
        if (/type\s*=\s*["']importmap["']/i.test(attrs)) continue;
        if (/type\s*=\s*["']application\/(?:json|ld\+json)["']/i.test(attrs)) continue;
        if (m[2] && m[2].trim()) scripts.push(m[2].trim());
      }
    }
    return scripts.join('\n;\n');
  }

  /**
   * 检测用户输入形态
   * @param {string} input - 原始输入文本
   * @returns {{ type: string, code: string, meta: object }}
   *   type: 'html' | 'markdown' | 'mixed' | 'js' | 'url' | 'empty'
   */
  function detect(input) {
    const text = (input || '').trim();
    if (!text) return { type: 'empty', code: '', meta: { message: '输入为空' } };

    // 1. URL: 整个输入就是一个链接（单行或多行中第一行是URL）
    const lines = text.split(/\r?\n/);
    const firstMeaningful = lines.find(function (l) { return l.trim(); }) || '';
    const urlMatch = firstMeaningful.match(/^https?:\/\/\S+$/i);
    if (urlMatch) {
      return {
        type: 'url',
        code: '',
        meta: { url: urlMatch[0], message: '检测到 URL 链接' }
      };
    }

    // 2. 完整 HTML: 包含 doctype / <html / <head> / <body> / importmap 任一强特征
    const strongHtmlSignals = /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<script[^>]*type\s*=\s*["']importmap/i;
    // 包含 <script>...</script> 且同时有 <style>,<div>,<meta> 等 HTML 特征
    const htmlLike = /<script[\s>]/i.test(text) && /<\/script>/i.test(text) &&
      (/<style[\s>]|<div[\s>]|<meta[\s>]|<!DOCTYPE/i.test(text));
    if (strongHtmlSignals.test(text) || htmlLike) {
      const extracted = extractFromHtml(text);
      return {
        type: 'html',
        code: extracted,
        meta: { message: '检测到完整 HTML 文件，已自动提取脚本代码', scriptCount: (extracted.split('\n;\n') || []).length }
      };
    }

    // 3. Markdown 围栏: ```js / ```javascript / ```html / ```threejs / ```
    const fencePatterns = ['javascript', 'js', 'html', 'threejs', ''];
    for (let i = 0; i < fencePatterns.length; i++) {
      const lang = fencePatterns[i];
      const fenceRegex = new RegExp('```' + (lang ? lang : '') + '\\s*\\n([\\s\\S]*?)```', 'i');
      const fence = text.match(fenceRegex);
      if (fence) {
        const inner = fence[1].trim();
        // 围栏内还是 HTML 就递归走 extractFromHtml
        if (/<script[\s>]/i.test(inner) && /<\/script>/i.test(inner)) {
          return {
            type: 'html',
            code: extractFromHtml(inner),
            meta: { message: '检测到 Markdown 代码块（含 HTML），已提取脚本', fenceLang: lang || 'plain' }
          };
        }
        return {
          type: 'markdown',
          code: inner,
          meta: { message: '检测到 Markdown 代码块', fenceLang: lang || 'plain' }
        };
      }
    }

    // 4. 混杂文本（AI 回复）：含 <script> 标签
    if (/<script[\s>]/i.test(text) && /<\/script>/i.test(text)) {
      return {
        type: 'mixed',
        code: extractFromHtml(text),
        meta: { message: '检测到混杂文本（AI回复），已自动提取代码部分' }
      };
    }

    // 5. 默认纯 JS
    return { type: 'js', code: text, meta: { message: '检测为纯 JavaScript 代码' } };
  }

  /**
   * 容错救援链：逐级降级试运行，直到找到能产生有效对象的候选
   *
   * @param {string} rawInput  - 用户原始输入（HTML/MD/JS 任意形态）
   * @param {object} options   - 传递给 ThreeJSCodeRunner.runThreeJSCode 的选项
   *   必须包含: { THREE, container, mode }
   *   可选: normalizer - ThreeJSCodeNormalizer 实例
   * @returns {{ result: object|null, usedLabel: string, attempts: array, detection: object }}
   */
  function runWithRescue(rawInput, options) {
    options = options || {};
    const Runner = global.ThreeJSCodeRunner;
    if (!Runner) {
      return { result: null, usedLabel: 'none', attempts: [{ label: 'init', error: 'ThreeJSCodeRunner 未加载' }], detection: null };
    }

    const Normalizer = options.normalizer || global.ThreeJSCodeNormalizer;
    const detection = detect(rawInput);
    const attempts = [];

    // 清理预览容器
    function clearContainer() {
      const container = options.container;
      if (container && typeof container.innerHTML !== 'undefined') {
        container.innerHTML = '';
      }
    }

    // 收集候选代码列表
    const candidates = [];

    // 候选 1: 检测后的代码 + 完整规范化
    if (detection.code) {
      let normalized = detection.code;
      if (Normalizer && typeof Normalizer.normalize === 'function') {
        normalized = Normalizer.normalize(detection.code).code;
      }
      candidates.push({ label: '形态识别+规范化 (' + detection.type + ')', code: normalized });
    }

    // 候选 2: 仅安全检查规范化（不含激进规则）
    if (detection.code && Normalizer && typeof Normalizer.normalizeSafe === 'function') {
      const safeResult = Normalizer.normalizeSafe(detection.code);
      if (safeResult.code !== candidates[0].code) {
        candidates.push({ label: '仅安全规范化', code: safeResult.code });
      }
    }

    // 候选 3: 原始代码
    if (detection.code && candidates.length === 0) {
      candidates.push({ label: '原样 (' + detection.type + ')', code: detection.code });
    }

    // 逐个尝试
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      clearContainer();

      let resultObj;
      try {
        resultObj = Runner.runThreeJSCode(c.code, {
          mode: options.mode || 'world',
          THREE: options.THREE,
          container: options.container,
          renderer: options.renderer,
          camera: options.camera
        });
      } catch (e) {
        attempts.push({ label: c.label, error: '执行异常: ' + e.message });
        continue;
      }

      if (resultObj.error) {
        attempts.push({ label: c.label, error: resultObj.error.message || String(resultObj.error) });
        if (resultObj.dispose) resultObj.dispose();
        continue;
      }

      // 校验是否产生了有效对象
      const renderableCount = countRenderables(resultObj.object);
      if (renderableCount > 0) {
        return {
          result: resultObj,
          usedLabel: c.label,
          attempts: attempts,
          detection: detection
        };
      }

      // 对象为空但可能有 onFrame（如代码在 animate 里异步添加）
      if (resultObj.onFrame && typeof resultObj.onFrame === 'function') {
        try { resultObj.onFrame(); } catch (e) { /* ignore */ }
        const retryCount = countRenderables(resultObj.object);
        if (retryCount > 0) {
          return {
            result: resultObj,
            usedLabel: c.label + '（执行 onFrame 后检测到对象）',
            attempts: attempts,
            detection: detection
          };
        }
      }

      attempts.push({ label: c.label, error: '代码执行成功但未产生可渲染对象（0个Mesh/Points/Line）' });
      if (resultObj.dispose) resultObj.dispose();
    }

    return { result: null, usedLabel: 'none', attempts: attempts, detection: detection };
  }

  global.ThreeJSInputAdapter = {
    detect: detect,
    extractFromHtml: extractFromHtml,
    runWithRescue: runWithRescue,
    countRenderables: countRenderables,
    djb2: djb2
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = global.ThreeJSInputAdapter;
  }
})(typeof window !== 'undefined' ? window : this);
