/**
 * 国际化（i18n）核心库
 * 支持中英文切换
 * 
 * 特性：
 * - 语言切换器显示对方语言（中文界面显示"Language"，英文界面显示"语言"）
 * - 管理员在后台切换语言后全局生效（通过服务器 API 持久化）
 * - 前端从服务器获取语言设置，自动同步
 * 
 * 济宁米多信息科技有限公司 版权所有
 */
class I18n {
  constructor() {
    this.currentLocale = 'zh-CN';
    this.translations = {};
    this.initialized = false;
    this.callbacks = [];
    this._initPromise = null;
  }

  /**
   * 获取存储的语言设置（仅本地缓存）
   */
  getStoredLocale() {
    try {
      return localStorage.getItem('locale');
    } catch (e) {
      return null;
    }
  }

  /**
   * 从服务器获取系统语言设置（权威来源）
   */
  async fetchLocaleFromServer() {
    try {
      const response = await fetch('/api/config/language');
      if (response.ok) {
        const data = await response.json();
        if (data.language && ['zh-CN', 'en-US'].includes(data.language)) {
          this.currentLocale = data.language;
          try { localStorage.setItem('locale', this.currentLocale); } catch (e) { /* ignore */ }
          console.log('[i18n] 从服务器获取语言:', this.currentLocale);
          return this.currentLocale;
        }
      }
    } catch (error) {
      console.warn('[i18n] 从服务器获取语言失败，使用本地缓存:', error.message);
    }
    
    // 降级：使用本地缓存或默认中文
    const cached = this.getStoredLocale();
    this.currentLocale = cached || 'zh-CN';
    console.log('[i18n] 使用缓存/默认语言:', this.currentLocale);
    return this.currentLocale;
  }

  /**
   * 初始化 i18n：获取语言设置 + 加载语言包
   */
  async init() {
    if (this.initialized) return Promise.resolve();
    
    if (this._initPromise) return this._initPromise;
    
    this._initPromise = (async () => {
      // 1. 从服务器获取语言设置
      await this.fetchLocaleFromServer();
      
      // 2. 加载对应的语言包
      await this._loadTranslations(this.currentLocale);
      
      this.initialized = true;
      console.log('[i18n] 初始化完成, locale:', this.currentLocale);
      return;
    })();
    
    return this._initPromise;
  }

  /**
   * 加载语言包 JSON
   */
  async _loadTranslations(locale) {
    // 如果已缓存则跳过
    if (this.translations[locale]) return;

    try {
      const response = await fetch(`/i18n/${locale}.json`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      this.translations[locale] = await response.json();
      console.log('[i18n] 语言包加载完成:', locale);
    } catch (error) {
      console.error('[i18n] 加载语言包失败:', error);
      // 降级：尝试加载另一语言
      const fallback = locale === 'en-US' ? 'zh-CN' : 'en-US';
      if (!this.translations[fallback]) {
        try {
          const fbResp = await fetch(`/i18n/${fallback}.json`, { cache: 'no-store' });
          if (fbResp.ok) {
            this.translations[fallback] = await fbResp.json();
            this.currentLocale = fallback;
            console.warn('[i18n] 已降级到:', fallback);
          }
        } catch (e) {
          console.error('[i18n] 降级也失败:', e);
        }
      }
    }
  }

  /**
   * 管理员在后台切换语言 → 保存到服务器，全局生效
   * @param {string} locale - 'zh-CN' 或 'en-US'
   * @returns {Promise<boolean>} 是否成功
   */
  async setLocaleToServer(locale) {
    if (!['zh-CN', 'en-US'].includes(locale)) {
      console.error('[i18n] 无效的语言:', locale);
      return false;
    }

    try {
      const token = localStorage.getItem('adminToken');
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch('/api/config/language', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ language: locale })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${response.status}`);
      }

      // 保存成功后本地切换
      this.currentLocale = locale;
      try { localStorage.setItem('locale', locale); } catch (e) { /* ignore */ }
      this.initialized = false;
      this._initPromise = null;
      // 清除旧的语言包缓存，强制重新加载（确保最新翻译生效）
      delete this.translations[locale];
      await this._loadTranslations(locale);
      this.initialized = true;

      // 触发所有回调
      this.callbacks.forEach(cb => {
        try { cb(this.currentLocale); } catch (e) { console.error('[i18n] callback error:', e); }
      });

      console.log('[i18n] 语言已切换到:', locale);
      return true;
    } catch (error) {
      console.error('[i18n] 保存语言到服务器失败:', error);
      return false;
    }
  }

  /**
   * 前端本地切换语言（仅刷新当前页面，不持久化到服务器）
   * 用于前端 index.html 收到 WebSocket 广播后切换
   */
  async setLocaleLocal(locale) {
    if (!['zh-CN', 'en-US'].includes(locale)) return;
    if (this.currentLocale === locale && this.initialized) return;

    this.currentLocale = locale;
    try { localStorage.setItem('locale', locale); } catch (e) { /* ignore */ }
    this.initialized = false;
    this._initPromise = null;
    await this._loadTranslations(locale);
    this.initialized = true;

    this.callbacks.forEach(cb => {
      try { cb(this.currentLocale); } catch (e) { console.error('[i18n] callback error:', e); }
    });
  }

  /**
   * 注册语言切换回调
   */
  onLocaleChange(callback) {
    if (typeof callback === 'function') {
      this.callbacks.push(callback);
    }
  }

  /**
   * 翻译函数
   * @param {string} key - 点分隔的翻译键，如 "admin.title"、"world.health"
   * @returns {string} 翻译后的文字
   */
  t(key) {
    if (!this.initialized) return key;

    const keys = key.split('.');
    let result = this.translations[this.currentLocale];

    for (const k of keys) {
      if (result && typeof result === 'object' && k in result) {
        result = result[k];
      } else {
        console.warn(`[i18n] 缺少翻译: ${key}`);
        return key;
      }
    }

    return typeof result === 'string' ? result : key;
  }

  /**
   * 带参数替换的翻译
   * @param {string} key - 翻译键
   * @param {Object} params - 参数对象，如 { count: 20 }
   */
  tp(key, params = {}) {
    let text = this.t(key);
    if (params && typeof text === 'string') {
      Object.keys(params).forEach(param => {
        text = text.replace(`{{${param}}}`, params[param]);
      });
    }
    return text;
  }

  /**
   * 获取语言切换器的显示文字（显示对方的语言）
   * 中文界面 → 返回 "Language"
   * 英文界面 → 返回 "语言"
   */
  getSwitchText() {
    return this.t('language_switch');
  }

  /**
   * 获取当前语言代码
   */
  getCurrentLocale() {
    return this.currentLocale;
  }
}

// 创建全局实例
window.i18n = new I18n();
