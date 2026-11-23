/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * soundSections.js —— 音效库五个分区的定义与占位文案
 *
 * 为什么独立：soundLibrary.js 装完渲染逻辑已接近 500 行红线，
 * 分区元数据是纯数据 + 文案，抽出来既降行数，也给 S2/S3 各区实现留位置
 * （后续 objects/scenes/weather/assets 的界面逻辑可以直接挂在本文件）。
 *
 * 分区按「声音用在哪」划分，最后一个是素材仓库：
 *   ① actions  角色动作   ② objects  模型声源
 *   ③ scenes   环境声景   ④ weather  天气联动
 *   ⑤ assets   声音资产
 *
 * 对外：window.SoundSections.list() / placeholderHtml(sec)
 */
(function () {
  'use strict';

  // ─── i18n：i18n 未就绪时一律回退中文，绝不显示裸 key ───
  function tr(key, fallback) {
    try {
      var i18n = window.i18n;
      if (i18n && i18n.initialized) {
        var v = i18n.t(key);
        if (v && v !== key) return v;
      }
    } catch (e) { /* ignore */ }
    return fallback;
  }

  // ★ 2026-11-03 结构调整（用户定的）：
  //   ② 模型声源   → 从音效库移除。模型列表里分不清哪个模型是哪个，没意义；
  //                  给某个模型挂声音应该去统一编辑器点中它、在属性面板里配（world_objects.custom_config.audio 字段不变）。
  //   ④ 天气联动   → 从音效库移除。天气音要跟着「下雨了」一起生效，应该放在
  //                  「世界与场景 → 天气控制」里，选完跟天气一起广播。
  //   编号因此重排成 ① 角色动作 ② 环境声景 ③ 声音资产（背景音乐待加，排 ④）。
  var SECTIONS = [
    {
      id: 'actions', label: '① 角色动作', count: '20', ready: true,
      intro: '每个角色的 15 个动作 + 5 个武器槽位，逐个显示实际在播什么。'
    },
    {
      id: 'scenes', label: '② 环境声景', count: '0', ready: false,
      intro: '在坐标上放一段声音，玩家走进半径就响、走出去淡出。'
    },
    {
      id: 'assets', label: '③ 声音资产', count: '21', ready: false,
      intro: '所有声音素材的中央仓库，上面两区都从这里挑声音。'
    },
    {
      // ★ 2026-11-03 新增：AI 生成声音
      //   放在「③ 声音资产」之后而不是之前 —— 生成是**产出**新素材的入口，
      //   仓库是**消费**素材的地方，顺序上「先有产出、再进仓库」更顺。
      id: 'aigen', label: '④ AI 生成声音', count: '0', ready: true,
      intro: '用提示词生成新音效，试听满意后入库，入库后各处都能直接调用。'
    },
    // ★ ⑤ 场景背景音已搬到「世界与场景 → 天气控制」，和天气声音放一起
  ];

  function list() {
    // 返回翻译后的副本，中文原文作为兜底；每次调用都取当前语言，切换语言后重新取值即生效
    return SECTIONS.map(function (s) {
      return {
        id: s.id,
        label: tr('adminSound.sec_' + s.id, s.label),
        count: s.count,
        ready: s.ready,
        intro: tr('adminSound.sec_' + s.id + '_intro', s.intro)
      };
    });
  }

  function get(id) {
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].id === id) return SECTIONS[i];
    }
    return null;
  }

  /** 未实现分区的占位内容：告诉用户这一区将包含什么、什么时候做 */
  function placeholderHtml(sec) {
    if (!sec) return '';
    var title = String(sec.label || '').replace(/^[①②③④⑤]\s*/, '');
    return '<div class="sl-ph">' +
      '<div class="sl-ph-title">' + esc(title) + '</div>' +
      '<div class="sl-ph-intro">' + esc(sec.intro || '') + '</div>' +
      '<div class="sl-ph-sub">' + esc(tr('adminSound.sectionPlaceholderLead', '这一区将包含')) + '</div>' +
      '<ul class="sl-ph-list">' +
        (sec.plans || []).map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') +
      '</ul>' +
      (sec.eta ? '<div class="sl-ph-eta">' + esc(sec.eta) + '</div>' : '') +
      '</div>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── ① 的槽位定义（纯数据，从 soundLibrary.js 挪过来）───────
  // soundLibrary 加完「变体」入口后 516 行撞了 500 红线，按本文件最初的定位
  //（分区元数据 = 纯数据 + 文案，抽出来既降行数又给出处）把这两个表挪到这里。
  var ANIM_KEYS = [
    { key: 'idle',          label: '待机',    desc: '布甲轻呼吸，存在感很低' },
    { key: 'walk',          label: '走路',    desc: '布鞋踩土，短促' },
    { key: 'run',           label: '奔跑',    desc: '脚步更急，带衣料风' },
    { key: 'jump',          label: '跳跃',    desc: '蹬地 + 气流上冲' },
    { key: 'land',          label: '落地',    desc: '体重落地的闷响' },
    { key: 'attack1',       label: '普攻1',   desc: '轻剑横挥破风' },
    { key: 'attack2',       label: '普攻2',   desc: '反手回挥' },
    { key: 'attack3',       label: '普攻3',   desc: '重挥，带重量' },
    { key: 'attack_slash',  label: '斩击',    desc: '快速细切破风' },
    { key: 'attack_stab',   label: '刺击',    desc: '突刺，锐利' },
    { key: 'attack_swing',  label: '挥舞',    desc: '钝器横扫，低沉' },
    { key: 'hit',           label: '受击',    desc: '闷噗，钝击体感偏薄' },
    { key: 'death',         label: '死亡',    desc: '低频闷响下沉，长尾' },
    { key: 'draw_sword',    label: '拔剑',    desc: '短促一记嚓，偏钝' },
    { key: 'sheath',        label: '收剑',    desc: '入鞘的嗒，带闷底' }
  ];

  var WEAPON_KEYS = [
    { key: 'equip_hum',  label: '常态嗡鸣', desc: '低频底噪，几乎听不出内容' },
    { key: 'swing',      label: '挥击',     desc: '重型武器挥动' },
    { key: 'hit_impact', label: '命中',     desc: '极短噗，无锐利瞬态' },
    { key: 'draw',       label: '拔出',     desc: '拖拽的沙，含混渐起' },
    { key: 'sheath',     label: '收起',     desc: '更干更细的刮擦' }
  ];

  function keys(type) {
    var src = type === 'weapon' ? WEAPON_KEYS : ANIM_KEYS;
    var pre = type === 'weapon' ? 'adminSound.wpn_' : 'adminSound.anim_';
    return src.map(function (it) {
      return {
        key: it.key,
        label: tr(pre + it.key, it.label),
        desc: tr(pre + it.key + '_desc', it.desc)
      };
    });
  }

  window.SoundSections = {
    list: list,
    get: get,
    placeholderHtml: placeholderHtml,
    keys: keys
  };
})();
