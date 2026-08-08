/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 平台选择 UI 组件
 * 
 * 负责：下拉框渲染、自动检测按钮、信息面板显示
 * 与 ai-factory.js 通过事件解耦调用
 */

var PlatformSelector = {
  
  _containerId: null,
  _selectId: 'platform-select',
  _btnId: 'btn-detect-platform',
  _resultId: 'detect-result',
  _infoId: 'platform-info',
  _currentPlatform: null,
  _currentConfig: null,
  _glbFile: null,
  _onChangeCallback: null,

  init: function(containerId) {
    this._containerId = containerId;
    this._currentPlatform = null;
    this._currentConfig = null;
    this._glbFile = null;
    this._onChangeCallback = null;
    this._render();
  },

  setGlbFile: function(file) {
    this._glbFile = file;
  },

  onPlatformChange: function(callback) {
    this._onChangeCallback = callback;
  },

  getCurrentPlatform: function() {
    return this._currentPlatform;
  },

  getCurrentConfig: function() {
    return this._currentConfig;
  },

  setPlatform: function(platformId) {
    var select = document.getElementById(this._selectId);
    if (select) {
      select.value = platformId;
      this._handlePlatformChange(platformId);
    }
  },

  _render: function() {
    var container = document.getElementById(this._containerId);
    if (!container) return;

    var platforms = this._getPlatforms();
    var html = '<div class="platform-selector-container">';
    
    html += '<div class="form-group">';
    html += '<label>📍 模型来源平台</label>';
    html += '<select id="' + this._selectId + '" class="form-control" onchange="PlatformSelector._handlePlatformChange(this.value)">';
    html += '<option value="">-- 请选择 / 自动检测 --</option>';
    
    var popular = platforms.filter(function(p) { return p.popular; });
    var others = platforms.filter(function(p) { return !p.popular; });
    
    popular.forEach(function(p) {
      html += '<option value="' + p.id + '">' + p.icon + ' ' + p.name + '</option>';
    });
    
    if (others.length > 0) {
      html += '<optgroup label="──── 更多平台 ────">';
      others.forEach(function(p) {
        html += '<option value="' + p.id + '">' + p.icon + ' ' + p.name + '</option>';
      });
      html += '</optgroup>';
    }
    
    html += '</select></div>';

    html += '<button type="button" id="' + this._btnId + '" class="btn btn-sm btn-default" ';
    html += 'style="margin-top:8px;width:100%;" onclick="PlatformSelector._handleAutoDetect()">';
    html += '🔍 自动检测平台来源</button>';

    html += '<div id="' + this._resultId + '" style="display:none;margin-top:10px;padding:10px;border-radius:6px;font-size:12px;"></div>';

    html += '<div id="' + this._infoId + '" style="display:none;margin-top:10px;padding:12px;background:rgba(0,100,255,0.08);border-radius:6px;">';
    html += '<div id="' + this._infoId + '-name" style="font-weight:bold;color:#00aaff;margin-bottom:6px;"></div>';
    html += '<div id="' + this._infoId + '-desc" style="font-size:11px;color:#888;margin-bottom:8px;"></div>';
    html += '<div id="' + this._infoId + '-details" style="display:flex;gap:12px;flex-wrap:wrap;font-size:11px;"></div>';
    html += '<div id="' + this._infoId + '-tip" style="margin-top:8px;padding:8px;background:rgba(255,170,0,0.1);border-radius:4px;font-size:11px;color:#ffaa00;display:none;"></div>';
    html += '</div></div>';

    container.innerHTML = html;
  },

  _getPlatforms: function() {
    if (typeof window.getSupportedPlatforms === 'function') {
      return window.getSupportedPlatforms();
    }
    if (typeof window.SUPPORTED_PLATFORMS !== 'undefined') {
      return window.SUPPORTED_PLATFORMS.map(function(p) {
        return { id: p.id, name: p.name, icon: p.icon, description: p.description, popular: p.popular };
      });
    }
    return [];
  },

  _handlePlatformChange: function(platformId) {
    this._currentPlatform = platformId;
    this._currentConfig = null;

    var infoPanel = document.getElementById(this._infoId);
    var resultDiv = document.getElementById(this._resultId);

    if (!platformId) {
      if (infoPanel) infoPanel.style.display = 'none';
      if (this._onChangeCallback) this._onChangeCallback(null, null);
      return;
    }

    var config = null;
    if (typeof window.getPlatformConfig === 'function') {
      config = window.getPlatformConfig(platformId);
    }
    this._currentConfig = config;

    if (infoPanel) {
      infoPanel.style.display = 'block';
      
      var nameEl = document.getElementById(this._infoId + '-name');
      var descEl = document.getElementById(this._infoId + '-desc');
      var detailsEl = document.getElementById(this._infoId + '-details');
      var tipEl = document.getElementById(this._infoId + '-tip');
      
      if (nameEl) nameEl.textContent = (config && config.icon ? config.icon + ' ' : '') + (config && config.name ? config.name : platformId);
      if (descEl) descEl.textContent = config && config.description ? config.description : '';
      
      if (detailsEl) {
        var details = '';
        var defaults = config && (config._defaults || config.defaults);
        var system = config && (config._system || config.systemBones);
        if (defaults) {
          details += '<span style="background:rgba(0,100,255,0.15);padding:3px 8px;border-radius:3px;">';
          details += '缩放: <strong>' + (defaults.scale || '?') + '</strong> (' + (defaults.unit || '?') + ')</span> ';
          details += '<span style="background:rgba(0,100,255,0.15);padding:3px 8px;border-radius:3px;">';
          details += '姿势: <strong>' + (defaults.poseType || '?') + '</strong></span>';
        }
        if (system) {
          details += '<span style="background:rgba(0,100,255,0.15);padding:3px 8px;border-radius:3px;">';
          details += '右手骨骼: <strong>' + (system.rightHand || '(未设置)') + '</strong></span>';
        }
        detailsEl.innerHTML = details;
      }
      
      if (tipEl && defaults && defaults.needsManualCalibration) {
        tipEl.style.display = 'block';
        tipEl.textContent = '⚠️ 该平台模型可能需要手动校准，建议上传后在"校准"Tab中微调';
      } else if (tipEl) {
        tipEl.style.display = 'none';
      }
    }

    if (resultDiv) resultDiv.style.display = 'none';
    if (this._onChangeCallback) this._onChangeCallback(platformId, config);
  },

  _handleAutoDetect: function() {
    var btn = document.getElementById(this._btnId);
    var resultDiv = document.getElementById(this._resultId);
    var self = this;

    if (!this._glbFile) {
      if (typeof window.createGlbFile !== 'undefined') this._glbFile = window.createGlbFile;
      else if (typeof createGlbFile !== 'undefined') this._glbFile = createGlbFile;
    }

    if (!this._glbFile) {
      this._showResult(resultDiv, '❌ 请先上传GLB模型文件', 'error');
      return;
    }

    if (!this._glbFile.name.toLowerCase().endsWith('.glb')) {
      this._showResult(resultDiv, '⚠️ 自动检测仅支持 .glb 文件', 'warning');
      return;
    }

    btn.disabled = true;
    btn.textContent = '⏳ 检测中...';
    this._showResult(resultDiv, '<div style="color:#ffaa00;">正在分析模型骨骼结构...</div>', 'loading');

    var reader = new FileReader();
    reader.onload = function(e) {
      try {
        self._parseGlbAndDetect(e.target.result, function(detections) {
          btn.disabled = false;
          btn.textContent = '🔍 自动检测平台来源';

          if (!detections || detections.length === 0 || detections[0].platform === 'unknown') {
            self._showResult(resultDiv, 
              '❓ 无法识别平台<br><span style="color:#aaa;">该模型骨骼命名不在已知的平台范围内。请手动选择平台，或选择"⚙️ 完全手动配置"。</span>', 
              'warning');
            return;
          }

          var best = detections[0];
          var config = null;
          if (typeof window.getPlatformConfig === 'function') {
            config = window.getPlatformConfig(best.platform);
          }

          var confPercent = Math.round(best.confidence * 100);
          var html = '<div style="color:#00ff00;">✅ 检测成功!</div>';
          html += '<div style="margin-top:6px;"><strong>' + (config && config.icon ? config.icon + ' ' : '') + (config && config.name ? config.name : best.platform) + '</strong> (置信度 ' + confPercent + '%)</div>';
          
          if (best.tip) {
            html += '<div style="margin-top:4px;font-size:11px;color:#888;">识别依据: ' + best.tip + '</div>';
          }
          
          html += '<div style="margin-top:8px;color:#aaa;">已自动选中该平台，如不正确请手动切换</div>';

          self._showResult(resultDiv, html, 'success');
          self.setPlatform(best.platform);
        });
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '🔍 自动检测平台来源';
        self._showResult(resultDiv, '<div style="color:#ff4444;">❌ 检测失败: ' + err.message + '</div>', 'error');
      }
    };

    reader.onerror = function() {
      btn.disabled = false;
      btn.textContent = '🔍 自动检测平台来源';
      self._showResult(resultDiv, '<div style="color:#ff4444;">❌ 文件读取失败</div>', 'error');
    };

    reader.readAsArrayBuffer(this._glbFile);
  },

  _parseGlbAndDetect: function(arrayBuffer, callback) {
    var self = this;

    if (typeof THREE === 'undefined' || typeof THREE.GLTFLoader === 'undefined') {
      this._loadThreeAndParse(arrayBuffer, callback);
      return;
    }

    var loader = new THREE.GLTFLoader();
    loader.parse(arrayBuffer, '', function(gltf) {
      var detections = self._detectFromGltf(gltf);
      callback(detections);
    }, function(error) {
      console.error('[PlatformSelector] GLB解析失败:', error);
      callback(null);
    });
  },

  _loadThreeAndParse: function(arrayBuffer, callback) {
    var self = this;
    
    if (typeof THREE === 'undefined') {
      var script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
      script.onload = function() {
        var loaderScript = document.createElement('script');
        loaderScript.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
        loaderScript.onload = function() { self._parseGlbAndDetect(arrayBuffer, callback); };
        loaderScript.onerror = function() { callback(null); };
        document.head.appendChild(loaderScript);
      };
      script.onerror = function() { callback(null); };
      document.head.appendChild(script);
    } else if (typeof THREE.GLTFLoader === 'undefined') {
      var loaderScript = document.createElement('script');
      loaderScript.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';
      loaderScript.onload = function() { self._parseGlbAndDetect(arrayBuffer, callback); };
      loaderScript.onerror = function() { callback(null); };
      document.head.appendChild(loaderScript);
    } else {
      callback(null);
    }
  },

  _detectFromGltf: function(gltf) {
    var boneNames = [];
    
    if (gltf && gltf.scene) {
      gltf.scene.traverse(function(node) {
        if (node.isBone && node.name) boneNames.push(node.name);
      });
    }

    if (boneNames.length === 0) {
      return [{ platform: 'unknown', confidence: 0, tip: '模型中未检测到骨骼结构' }];
    }

    return this._detectBySignatures(boneNames);
  },

  _detectBySignatures: function(boneNames) {
    var signatures = window.PLATFORM_SIGNATURES;
    if (!signatures) {
      return [{ platform: 'unknown', confidence: 0, tip: '平台特征库未加载' }];
    }

    var results = [];
    for (var platformId in signatures) {
      if (signatures.hasOwnProperty(platformId)) {
        var sig = signatures[platformId];
        try {
          if (sig.test(boneNames)) {
            results.push({
              platform: platformId,
              confidence: sig.confidence || 0.5,
              tip: sig.tip || '',
            });
          }
        } catch (e) {}
      }
    }

    results.sort(function(a, b) { return b.confidence - a.confidence; });
    if (results.length === 0) {
      results.push({ platform: 'unknown', confidence: 0, tip: '无法识别该平台的骨骼命名格式' });
    }

    console.log('[PlatformSelector] 骨骼列表:', boneNames.slice(0, 15).join(', '));
    return results;
  },

  _showResult: function(el, html, type) {
    if (!el) return;
    el.style.display = 'block';
    var bgColors = { 'success': 'rgba(0, 255, 0, 0.1)', 'error': 'rgba(255, 68, 68, 0.1)', 'warning': 'rgba(255, 170, 0, 0.1)', 'loading': 'rgba(100, 100, 100, 0.1)' };
    el.style.background = bgColors[type] || bgColors.loading;
    el.innerHTML = html;
  },

  destroy: function() {
    var container = document.getElementById(this._containerId);
    if (container) container.innerHTML = '';
    this._containerId = null;
    this._glbFile = null;
    this._onChangeCallback = null;
  }
};

/**
 * 便利函数：初始化平台选择器（适配 admin.html 等页面调用）
 * @param {string} containerId - 容器元素ID
 * @param {string} fileInputId - 文件输入框ID（可选，用于自动检测）
 * @param {function} onChangeCallback - 平台变化回调函数(platformId, config)
 * @param {string} initialValue - 初始选中的平台ID（可选）
 */
function initPlatformSelector(containerId, fileInputId, onChangeCallback, initialValue) {
  var selector = Object.create(PlatformSelector);
  selector._containerId = containerId;
  selector._currentPlatform = initialValue || null;
  selector._currentConfig = null;
  selector._glbFile = null;
  selector._onChangeCallback = onChangeCallback || null;
  selector._render();

  // 绑定文件输入框变化事件
  if (fileInputId) {
    var fileInput = document.getElementById(fileInputId);
    if (fileInput) {
      fileInput.addEventListener('change', function(e) {
        if (e.target.files && e.target.files[0]) {
          selector._glbFile = e.target.files[0];
          console.log('[initPlatformSelector] 已绑定文件:', e.target.files[0].name);
        }
      });
    }
  }

  // 如果有初始值，应用它
  if (initialValue && initialValue !== 'auto') {
    selector.setPlatform(initialValue);
  }

  // 将 selector 实例存储到全局，供后续访问
  window['_platformSelector_' + containerId] = selector;

  return selector;
}
