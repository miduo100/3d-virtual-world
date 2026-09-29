/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * 通用写操作鉴权守卫（安全修复 D1/D2/D3）
 * ------------------------------------------------------------------
 * 设计原则（见《安全修复-开发规划与规范.md》§3 红线 R1/R2/R4/R5）：
 *   1. **GET / HEAD / OPTIONS 一律放行**——世界加载、游客逛世界、联邦跨域读取全部依赖公开读；
 *   2. 只在**挂载层**加中间件（`app.use(prefix, forMount(prefix), routes)`），
 *      超限大文件（federation.js / aiSceneGenerator.js / uploadedModels.js / media.js / npc.js …）零改动；
 *   3. 唯一允许的行为变化 = 对匿名写请求新增 401/403/429；
 *   4. 每处挂载独立可回退：摘掉该行的中间件参数即恢复原状。
 *
 * 三级策略：
 *   - `admin`  → `authenticateAdminToken`（复用 src/middleware/adminAuth.js，零复制）
 *   - `user`   → `authenticateToken`（复用 src/middleware/auth.js）
 *   - `quota`  → `aiQuotaGuard`（只限次数，不验身份；工具页无登录门槛，上门禁会打死页面）
 *   - `public` → 直接放行（红线：`POST /api/inventory/remote-add` 家园世界跨域回写必须匿名）
 *
 * 紧急回退（无需回滚代码）：
 *   - `SECURITY_GUARD_OFF=1`            → 所有策略全部放行
 *   - `SECURITY_GUARD_ALLOW=/api/xxx`   → 按路径前缀精确豁免（逗号分隔多个）
 */
const { authenticateAdminToken } = require('./adminAuth');
const { authenticateToken } = require('./auth');
const { resolveClientIp } = require('./clientIp');

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 挂载点默认策略（键=server.js 里 app.use 的挂载前缀）。
 * 只影响该挂载点下的**非读请求**；未列出的挂载点不挂本守卫。
 */
const MOUNT_DEFAULT = {
  '/api/users': 'user',                 // D2：玩家自身数据（handler 内再做属主校验）
  '/api/plot': 'admin',                 // S0：前端 0 处调用点
  '/api/shop': 'admin',                 // 广告位/商店管理；purchase 见 PATH_RULES
  '/api/skills': 'admin',               // 技能管理；trigger 见 PATH_RULES
  '/api/monster': 'admin',              // 怪物管理；take-damage 见 PATH_RULES
  '/api/inventory': 'admin',            // 奖励池管理；pick/use/remote-add 见 PATH_RULES
  '/api/tags': 'admin',
  '/api/gallery': 'admin',
  '/api/geometry-building': 'admin',
  '/api/media': 'admin',
  '/api/npc': 'admin',                  // 调用方仅 unified_editor（管理员工具页）
  '/api/custom-npc': 'admin',
  '/api/ai-providers': 'admin',
  '/api/character-templates': 'admin',  // 修 S2-04d：templates 子路由此前挂在鉴权之前
  '/api/threejs-blocks': 'admin',       // 仅挂在 threejsImport 那一行（import-url 的 SSRF 面）
  '/api': 'admin',                      // uploadedModels / uploadedModelMeta / modelBundleUpload 三个挂载
  '/api/ai-scene': 'quota',             // 生成类=花钱；写库类见 PATH_RULES
  '/api/ai-factory': 'quota',
  '/api/ai': 'quota',
  '/api/tripo': 'quota',
};

/**
 * 挂载点**作用域**（仅对宽前缀挂载点必需）。
 *
 * ⚠️ 重要：`app.use('/api', ...)` 是**宽前缀挂载**——Express 按注册顺序分发，任何
 * 未被前面路由响应的 `/api/xxx` 写请求都会落到这一层。若不限定作用域，本守卫就会
 * 变成"全局写操作守卫"，把后面注册的 `/api/ai-factory/*`、`/api/config/*`、
 * `/api/portal/*` 等一并当成 admin 拦掉（实测 `POST /api/ai-factory/generate`
 * 曾被误判为 policy=admin）。
 *
 * 因此对宽前缀挂载点，只守卫其**自己那几个 router 实际提供的路径**。
 */
const MOUNT_SCOPE = {
  '/api': [
    '/api/upload-model',
    '/api/upload-models-batch',
    '/api/uploaded-models',
    '/api/upload-model-bundle',
    '/api/upload-model-zip',
  ],
};

/**
 * 路径级策略（绝对路径，优先于 MOUNT_DEFAULT；按顺序首个命中生效）。
 * method 支持 '*'（任意非读方法）。
 */
const PATH_RULES = [
  // ── 红线：家园世界跨域回写，任何情况下保持匿名 ──
  { method: 'POST', path: '/api/inventory/remote-add', policy: 'public' },

  // ── 玩家级（D2）：身份只从 token 派生，handler 内做属主校验 ──
  { method: 'POST', path: '/api/skills/trigger', policy: 'user' },
  { method: 'POST', path: '/api/monster/:monsterId/take-damage', policy: 'user' },
  { method: 'POST', path: '/api/monster/character/:characterId/take-damage', policy: 'user' },
  { method: 'POST', path: '/api/inventory/drops/:dropId/pick', policy: 'user' },
  { method: 'POST', path: '/api/inventory/drops/:dropId/mark-picked', policy: 'user' },
  { method: 'POST', path: '/api/inventory/bag/:itemId/use', policy: 'user' },
  { method: 'POST', path: '/api/shop/purchase', policy: 'user' },

  // ── 写库类入口收 admin（S2-05b，绕开 worldWriteGuard 匿名写 world_objects 的那批）──
  { method: 'POST', path: '/api/ai-scene/save-scene', policy: 'admin' },
  { method: 'POST', path: '/api/ai-scene/default-scene', policy: 'admin' },
  { method: 'POST', path: '/api/ai-scene/import-to-world/:id', policy: 'admin' },
  { method: 'PUT', path: '/api/ai-scene/scene/:id', policy: 'admin' },
  { method: 'DELETE', path: '/api/ai-scene/scene/:id', policy: 'admin' },
];

/**
 * 「限次数」与「收 admin」的取舍（避免误伤后台，也避免重复设限）：
 *   - D3 §2 列出的 AI 花费端点里，`/api/ai/*`、`/api/ai-factory/*`、`/api/tripo/*`、
 *     `/api/ai-scene/*` 生成类 → **只上 quota**：它们的宿主页（ai_scene_generator.html /
 *     ai_motion_factory.html）无登录门槛，直接收 admin 会把页面打死（见 D3 §4）。
 *   - `/api/tags/*`（含 auto-tag-all）、`/api/ai-providers/*`、`/api/npc/*`、`/api/custom-npc/*`
 *     的非读请求 → **收 admin**（§13.3 A/B 组的既定结论）：其调用方全在 admin.html /
 *     unified_editor.html（E2 后自动带管理员凭证），admin 严格强于 quota，无需再叠加配额。
 */

/** 保险丝：全放行 */
function isGuardOff() {
  const raw = String(process.env.SECURITY_GUARD_OFF || '').trim().toLowerCase();
  return ['1', 'true', 'on', 'yes'].includes(raw);
}

/** 保险丝：按路径前缀精确豁免（灰度/救火） */
function allowList() {
  return String(process.env.SECURITY_GUARD_ALLOW || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function isAllowlisted(absPath) {
  const list = allowList();
  if (!list.length) return false;
  return list.some(prefix => absPath === prefix || absPath.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'));
}

/** 路径匹配：支持 `:param` 段与末尾 `*` 前缀通配 */
function matchPath(pattern, target) {
  if (pattern.endsWith('*')) return target.startsWith(pattern.slice(0, -1));
  const p = pattern.split('/');
  const t = target.split('/');
  if (p.length !== t.length) return false;
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) continue;
    if (p[i] !== t[i]) return false;
  }
  return true;
}

/** 解析某挂载点下、某个绝对路径 + 方法的策略（导出供验收脚本断言） */
function resolvePolicy(mountPrefix, absPath, method) {
  for (const rule of PATH_RULES) {
    if (rule.method !== '*' && rule.method !== method) continue;
    if (matchPath(rule.path, absPath)) return rule.policy;
  }
  return MOUNT_DEFAULT[mountPrefix] || 'public';
}

/** 被拦请求打一条 warn（方法/路径/IP/policy），便于发现误伤 */
function logBlocked(req, absPath, policy) {
  console.warn(`[apiWriteGuard] 拦截 ${req.method} ${absPath} ip=${resolveClientIp(req)} policy=${policy}`);
}

/**
 * 挂在 server.js 各挂载行的守卫工厂：
 *   app.use('/api/media', apiWriteGuard.forMount('/api/media'), mediaRoutes);
 */
function forMount(mountPrefix) {
  return function apiWriteGuardForMount(req, res, next) {
    if (READ_METHODS.has(req.method)) return next();       // R1：GET 全公开
    if (isGuardOff()) return next();                       // 保险丝

    const absPath = (req.baseUrl || '') + (req.path || '');
    if (isAllowlisted(absPath)) return next();

    // 宽前缀挂载点只守卫自己的路径（否则会兜住后续挂载的写请求）
    const scope = MOUNT_SCOPE[mountPrefix];
    if (scope && !scope.some(p => absPath === p || absPath.indexOf(p + '/') === 0)) return next();

    const policy = resolvePolicy(mountPrefix, absPath, req.method);

    if (policy === 'public') return next();

    if (policy === 'quota') {
      // 懒惰 require：避免 apiWriteGuard ←→ aiQuotaGuard 的加载顺序问题
      return require('./aiQuotaGuard').middleware(req, res, next);
    }

    // user / admin：复用既有中间件，这里只加"被拦即记录"的可观测性
    const originalStatus = res.status.bind(res);
    res.status = function (code) {
      if (code === 401 || code === 403) logBlocked(req, absPath, policy);
      return originalStatus(code);
    };

    return policy === 'user'
      ? authenticateToken(req, res, next)
      : authenticateAdminToken(req, res, next);
  };
}

/** 直接使用（不按路径区分，整段非读请求都要 admin），如 characterTemplates/index.js */
function guardAdmin(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  if (isGuardOff()) return next();
  const absPath = (req.baseUrl || '') + (req.path || '');
  if (isAllowlisted(absPath)) return next();
  const originalStatus = res.status.bind(res);
  res.status = function (code) {
    if (code === 401 || code === 403) logBlocked(req, absPath, 'admin');
    return originalStatus(code);
  };
  return authenticateAdminToken(req, res, next);
}

/** 直接使用：非读请求需玩家 JWT */
function guardUser(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  if (isGuardOff()) return next();
  const absPath = (req.baseUrl || '') + (req.path || '');
  if (isAllowlisted(absPath)) return next();
  const originalStatus = res.status.bind(res);
  res.status = function (code) {
    if (code === 401 || code === 403) logBlocked(req, absPath, 'user');
    return originalStatus(code);
  };
  return authenticateToken(req, res, next);
}

module.exports = {
  forMount,
  guardAdmin,
  guardUser,
  resolvePolicy,
  matchPath,
  isGuardOff,
  MOUNT_DEFAULT,
  MOUNT_SCOPE,
  PATH_RULES,
  /** 与 forMount 完全同口径的"该请求会被守卫拦吗"判定（供验收脚本使用） */
  wouldGuard(mountPrefix, absPath, method) {
    if (isGuardOff()) return false;
    if (READ_METHODS.has(method)) return false;
    if (isAllowlisted(absPath)) return false;
    const scope = MOUNT_SCOPE[mountPrefix];
    if (scope && !scope.some(p => absPath === p || absPath.indexOf(p + '/') === 0)) return false;
    return resolvePolicy(mountPrefix, absPath, method) !== 'public';
  },
};
