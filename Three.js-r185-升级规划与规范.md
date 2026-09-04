# Three.js r185 升级规划与规范

> 版本：v2（2026-09-04，两轮全仓排查后定稿）
> 适用范围：l:\shegnjir185 全部前端页面、本地 vendor 库、node 端脚本
> 目标版本：three 0.185.x（npm 最新 0.185.1，2026-07-01 发布）

---

## 一、目标与原则

**目标**：全项目 Three.js 从当前 5 版本并存（r128 UMD / 0.137 / 0.158 / 0.183 npm / 0.160 ESM 局部）收敛到唯一 0.185.x，页面零白屏、功能零回归、视觉差异有据可查可回退。

**总原则**：
1. 只做"加载层重建 + API 适配 + 明确回归点修复"，不借机重构业务代码。
2. 数据库中存量用户代码（threejs 代码块、几何代码）**不改数据**，一律靠运行时垫片兼容。
3. 每阶段可独立验收、可独立回退。

---

## 二、现状盘点（升级前基线）

### 2.1 版本矩阵

| 位置 | 版本 | 形态 | 使用方 |
|---|---|---|---|
| `public/js/lib/three.min.js` + GLTF/DRACO/OBJ/MTL/Orbit/TransformControls | r128 | UMD + examples/js | index.html 主世界、admin.html 动态注入（2 处）、test_gaussian.html |
| `public/js/lib/three-examples/`（FBXLoader/fflate/NURBS）+ `three-shim.js` | 0.160 | ESM + importmap 桥接全局 | animLoader.js（FBX 动作） |
| `world_editor.html` | 0.128 | unpkg CDN examples/js | 世界编辑器 |
| `unified_editor.html` | 0.128 | unpkg/jsdelivr CDN 备选机制 | 统一编辑器 |
| `character_editor.html` | r128 | cdnjs + unpkg 混用 | 角色编辑器 |
| `animation_puppeteer.html` | r128 | cdnjs + jsdelivr | 动画提线器 |
| `ai_scene_generator.html` | r128 | cdnjs + jsdelivr | AI 场景生成 |
| `ai_motion_factory.html` | 0.137 | jsdelivr | 动作工厂 |
| `admin.html` importmap | 0.158 | jsdelivr three.module.js | postprocessing 等裸模块解析 |
| `package.json` | ^0.183.2 | npm | node 端 scripts/*.mjs（3 个） |

CDN 来源合计 4 家（cdnjs / unpkg / jsdelivr ×2），5 个版本。

### 2.2 架构核心约束

- index.html 依赖 **35+ 个传统 IIFE 脚本共享全局 `window.THREE`**，加载器要求挂 `THREE.xxx` 命名空间——r148 以前的产物形态。
- admin.html 两处硬编码动态注入数组：`['js/lib/three.min.js', 'js/lib/OrbitControls.js', 'js/lib/TransformControls.js', 'js/lib/GLTFLoader.js']`。
- 主世界 GLTFLoader 依赖本地 MeshoptDecoder（`/js/libs/meshopt/`，gltfpack -cc 压缩模型必需）与 DRACOLoader（`/js/libs/draco/`）。

### 2.3 已确认的旧 API 命中点（业务代码）

| 位置 | 旧 API | r185 状态 |
|---|---|---|
| `world.js:54` | `renderer.outputEncoding = THREE.sRGBEncoding` | r152 移除，赋值静默失效 |
| `world.js:55,70` | `renderer.physicallyCorrectLights = false`（两处） | r149 改名 useLegacyLights，r165 彻底移除 → **主世界从 legacy 光照强制切换物理模式** |
| `worldTextureOptimizer.js:79` | `newTex.encoding = texture.encoding` | r152 改为 `colorSpace` |
| `modules/performance-optimization.js:290` | `THREE.PCFSoftShadowMap` | r181 起弃用（改 PCFShadowMap） |
| `ai-factory-player.js:75` | `new THREE.Clock()` | r183 弃用（改 Timer） |
| `admin.html:1996-1999` | postprocessing@6.15.1/6.10.0 CDN | 为 r158 编译，r185 需 6.37+ |
| `unified_editor.html:1372-1400` | CDN 拼接 `/build/three.min.js` + `/examples/js/*` | **r160 后官方包无此路径，直接 404 白屏** |
| `world_editor.html:7724` | unpkg r128 draco decoder path | 需收敛到本地 `/js/libs/draco/` |
| `three-shim.js` | 按 0.160 FBXLoader 手工枚举导出 | r185 FBXLoader import 符号集已变，需 diff 补全 |
| `gaussianSplatRenderer.js` | GLSL1 shader + 手动 pow(1/2.2) sRGB（假设 r128 不自动编码） | r185 需实测 WebGL2 GLSL3 自动转换与颜色管线 |
| `world_editor.html:8032,8071`（内联脚本） | `tex.encoding / vTex.encoding = THREE.sRGBEncoding` | r152 改为 `colorSpace = SRGBColorSpace` |
| `world.js:8362,8453`（扫描器新发现） | `tex.encoding / vTex.encoding = THREE.sRGBEncoding` | 同上 |
| `world_editor.html:7906`（扫描器新发现） | `newTex.encoding = texture.encoding` | 同上 |
| `test_gaussian.html:55`（内联脚本） | `renderer.outputEncoding = THREE.sRGBEncoding` | r152 移除 |
| `admin.html:8521`（内联脚本） | `renderer.outputEncoding = THREE.sRGBEncoding !== undefined ? ... : 3001` | 有防御判断但属性已不存在，赋值无效 |
| `package.json` | `@types/three: ^0.183.1` | 需同步升 0.185.x |

### 2.4 已确认无碍项（排查过，不列入改造）

- Raycaster `intersectObjects` recursive 默认值（r132 变 true）：全部调用点显式传参。
- `uv2` 属性（r151 改名 uv1）：业务代码零引用。
- `morphTargets` 材质属性（r130 移除）：仅旧 GLTFLoader 内部。
- draco decoder（本地 js+wasm）与 meshopt decoder（本地 ESM）：与 r185 兼容。
- `worldInstanceMerger_v2.js`：已显式 `frustumCulled=false`，覆盖 r150 InstancedMesh 新默认行为。
- `stencil:false` / `logarithmicDepthBuffer` / `precision:'mediump'` 构造参数：r185 保留。
- 阴影：主世界 `shadowMap.enabled=false` 全禁用，PCFSoft 风险仅在编辑器预览。
- 后端 `src/services/geometryBuilder.js`：不含 THREE 引用（生成数据 JSON）。
- `geometryRenderer.js`：仅基础几何 API；注意 r148 起圆柱/圆锥等 radialSegments 默认值提高的细微观感变化。
- node 端 `scripts/*.mjs`（3 个）：import 'three' 随 npm 升级，API 兼容。
- CSP：全部页面无 Content-Security-Policy meta，本地 vendor 无 CSP 风险。
- `gltfpack ^0.24.0`（dependencies，上传模型压缩管线）：产物 EXT_meshopt_compression 为 r185 GLTFLoader 支持的标准扩展，无碍。
- `import_models.html`、`ui_controls_editor.html`、`feedback.html`、`subscription.html`：无任何 three 引用，不在迁移范围。
- `CanvasTexture`（13+ 处）与 `VideoTexture`（3 处）：r185 默认 NoColorSpace，行为与 r128（LinearEncoding 默认）基本等价；列入阶段 4 观感核对项（建议统一补 `colorSpace = SRGBColorSpace` 提升正确性，非必改）。
- vite / typescript / react 系依赖为**残留依赖**（无 vite.config、src 无 ts/tsx 源文件，`npm run dev/build` 无实际构建对象）：升级不动它们；esbuild 通过 devDependencies 单独引入。

---

## 三、r128 → r185 分水岭变更（本项目命中项）

按对项目影响排序：

1. **r160 移除 UMD 构建**：`build/three.min.js` 与 `examples/js/` 目录不复存在 → 全局 THREE 形态必须重建。
2. **r152 颜色管理革命**：`outputEncoding/sRGBEncoding/texture.encoding` → `outputColorSpace/colorSpace`；`ColorManagement.enabled` 默认 true。
3. **r155 光照物理化**（r165 彻底移除 legacy）：`useLegacyLights` 无效，点光/聚光 `decay=2` 物理默认（r147 起）→ 全局光照视觉必变。
4. **r163 WebGL1 移除**：需 WebGL2 环境，旧设备需检测提示。
5. **r148 GLTFLoader 仅 ESM + 节点顺序保证**：蒙皮/命名（createUniqueName `_N` 后缀）行为需专项回归。
6. **r169 TransformControls 改 Controls 派生**：`scene.add(controls)` → `scene.add(controls.getHelper())`。
7. **r181 PCFSoftShadowMap 弃用**；**r183 Clock 弃用 → Timer**；**r184 FBXLoader 自动 +Z-up→+Y-up**（影响 FBX 动画姿态）；**r184 FileLoader.load() 无返回值**。
8. 骨骼侧（与 node 端 0.183 一致化）：`SkinnedMesh.applyBoneTransform`（r151）、`bindMode:'attached'` 字符串形式——r185 与 0.183 行为一致。

---

## 四、升级策略

### 4.1 主策略：本地 vendor 化 + esbuild 重建"r185 UMD bundle"

```
构建产物：public/js/lib/three-r185/（构建源料目录）
         → public/js/lib/three.min.js（r185 UMD bundle，占用旧文件名）

esbuild 输入：
  node_modules/three@0.185 的 build/three.module.js（核心）
  + examples/jsm 的 GLTFLoader / DRACOLoader / OBJLoader / MTLLoader /
    OrbitControls / TransformControls / FBXLoader（含 fflate、NURBS 依赖）

esbuild 输出：
  IIFE 格式，global-name=THREE
  加载器类挂回命名空间：THREE.GLTFLoader / THREE.DRACOLoader / ...
```

- 重建流程固化为 `scripts/build-three-r185.js`（可重复构建，产物 sha256 校验）。
- esbuild 以 devDependencies 引入（项目现有 vite 内置 esbuild 但无 vite.config 可用；不启用整套 vite 构建）。**npm install 已知坑**：会清除未登记 package.json 的包（playwright 曾被误删），安装 esbuild 前确认已登记；如遇 postinstall 钩子超时参照 sharp 先例加 `--ignore-scripts`。
- 唯一版本来源 = `node_modules/three@0.185`（package.json 锁 0.185.x，`@types/three` 同步 0.185.x），前端 bundle 与 node 端脚本同源，杜绝双实例。

### 4.2 文件名兼容层（关键降本手段）

> **`js/lib/` 下的文件名是全站隐式契约。r185 bundle 直接占用旧文件名，不引入新名。**

| 旧文件 | 处理 |
|---|---|
| `js/lib/three.min.js` | 替换为 r185 UMD bundle；原 r128 文件移入 `js/lib/_backup_r128/` |
| `js/lib/GLTFLoader.js`、`OrbitControls.js`、`TransformControls.js`、`DRACOLoader.js`、`OBJLoader.js`、`MTLLoader.js` | 替换为 1 行 stub（注释说明"已并入主 bundle"），保证旧引用路径不 404 |
| `js/lib/three-shim.js` | 保留 importmap 桥接职责，导出清单按 r185 FBXLoader diff 重生成 |
| `js/lib/three-examples/` | FBXLoader/fflate/NURBS 替换为 r185 版拷贝 |

收益：index.html、admin.html 两处动态注入数组、test_gaussian.html 及任何硬编码路径 **零改动自动切换**。

### 4.3 兼容三层防线（优先垫片，不落库不改数据）

- **A 层（bundle 层）**：打包产物内补导出别名与常量兜底（`THREE.Math` → MathUtils 等），不污染源码。
- **B 层（运行时垫片）**：扩展 `threejsCompatibility.js` 的 `patchTHREE` 名单 + `threejsCodeRunner.js`；用户粘贴代码与数据库存量代码块走旧 API 时的最后防线。
- **C 层（显式修点）**：业务代码真实触碰已删 API 的位置（见 2.3 清单）逐个显式迁移。

---

## 五、约束规则（红线，共 11 条）

1. **版本单一来源**：全站唯一 0.185.x；npm 依赖与前端 bundle 同源；任何页面不得同时加载两个 THREE 实例（现 admin.html 已埋雷：本地 r128 UMD + importmap 0.158 module 并存，升级时一并清除）。
2. **加载层统一本地 vendor**：删除全部 CDN 版本引用（cdnjs r128 / unpkg 0.128 / jsdelivr 0.128+0.137+0.158）；CDN 兜底逻辑（unified_editor 备选机制、admin postprocessing 候选列表、world_editor draco path）一律重写为本地优先。
3. **文件名即接口**：r185 bundle 占用 `js/lib/three.min.js` 旧名；新增文件只进 `js/lib/three-r185/` 子目录。
4. **兼容优先垫片**：A/B/C 三层顺序执行，用户代码与存量数据不落库改写。
5. **文件行数规范沿用**：单文件 ≤500 行（理想）/ ≤1000 行（绝对）；黑名单大文件（`world.js` 299KB、`geometryBuilder.js`、`federation.js`、`admin.js`、`templates.js` 等）**禁止追加任何新功能代码**；所有迁移/垫片逻辑放独立新模块（如 `public/js/threeR185Adapter.js`）。
6. **不动数据**：数据库 threejs 代码块、几何代码、模型文件一律不改。
7. **不顺手重构**：只动"加载/适配层 + 明确 API 命中点 + 回归修复"。
8. **光照校准先于全量切换**：legacy → 物理模式是不可逆跳变，必须先在独立验证页完成光强重标定（点光/聚光 `intensity × π` 补偿表 + `decay` 核对），标定值入集中常量模块，再切主世界。
9. **shader 黑盒区单独回归**：`gaussianSplatRenderer.js` 不改代码先实测；如需修复，最小改动并保留 r128 行为注释。
10. **可回退**：旧文件统一移入 `js/lib/_backup_r128/`；页面切换一律加 `?v=185` 破缓存（浏览器与 agent-browser 均会缓存旧 JS）；每阶段 git 独立提交。
11. **重构决策须请示**：升级过程中若发现某处"整体重构"比"原地改写/打补丁"更有利于项目长远发展，**不擅自做主、也不默认走保守补丁路线**——先向用户说明"重构前现状（含问题）→ 重构后结构（含收益与影响面）"，经用户确认后才执行重构；未确认前一律按最小改动处理。

---

## 六、分阶段任务与验收

| 阶段 | 内容 | 验收标准 |
|---|---|---|
| **0 基线** | ① package.json 升 three 0.185.x（**含 @types/three 同步**）并 lock；② 写全仓旧 API 扫描器 `scripts/scan-three-legacy-api.js`（以 2.3 清单为种子，覆盖 12 类模式：outputEncoding/physicallyCorrectLights/useLegacyLights/sRGBEncoding/texture.encoding/THREE.Math/uv2/PCFSoftShadowMap/THREE.Clock/examples\/js\//CDN 版本号/FileLoader 返回值用法；**扫描范围必须含 HTML 内联 `<script>`，不能只扫 *.js**——第三轮已在内联脚本中补出 4 处漏网）；③ 用 `Screenshot/` 建"视觉基线"截图集（主世界 3 个机位 + 每编辑器 1 张），**e2e 用 devDependencies 中已有的 playwright 编脚本**；④ 扫描 `public/uploads`、`public/models` 下 GLB 是否含 `KHR_materials_pbrSpecularGlossiness`（r146 起 GLTFLoader 拒绝加载的扩展） | 扫描报告：业务代码旧 API 命中=0（A/B 垫片区除外）；spec/gloss 扩展清单产出 |
| **1 核心** | ① `scripts/build-three-r185.js` 产出 UMD bundle 并占用旧文件名；② 6 个加载器文件 stub 化，旧文件入 `_backup_r128/`；③ index.html / test_gaussian.html 引用加 `?v=185`；④ 修 `world.js:54-55`（outputColorSpace + 删 physicallyCorrectLights，两处）；⑤ 修 `worldTextureOptimizer.js:79`（encoding→colorSpace）；⑥ **修 HTML 内联 4 处**（world_editor:8032,8071 / test_gaussian:55 / admin:8521，encoding→colorSpace） | 登录→进世界→建筑/角色/动画/传送门/合批全链路无控制台报错；动画命中率与升级前一致（204 骨 51 匹配等基线） |
| **2 垫片** | ① `three-shim.js` 按 r185 FBXLoader import 符号 diff 重生成导出清单；② `three-examples/` 换 r185 版（FBXLoader/fflate/NURBS）；③ `threejsCompatibility.js` 扩展 patchTHREE 名单；④ admin postprocessing 候选升 6.37+；⑤ `ai-factory-player.js` Clock→Timer | 代码块预览（含 EffectComposer/tweakpane 类）、AI 生成场景、AI 动作工厂全部跑通 |
| **3 编辑器群** | world_editor / unified_editor / character_editor / animation_puppeteer / ai_scene_generator / ai_motion_factory / admin importmap 逐页迁移到本地 r185；**unified_editor CDN 备选机制重写为本地优先**；TransformControls `getHelper()` 适配；world_editor draco path 收敛本地 | 每页：模型预览、OrbitControls 旋转缩放、TransformControls 拖拽、骨骼绑定编辑器可用 |
| **4 光照颜色校准** | ① 独立验证页完成物理模式光强重标定（点光/聚光 intensity×π 补偿表、decay 核对）；② ColorManagement 影响面核对（手动创建的贴图 colorSpace=SRGBColorSpace）；③ **CanvasTexture/VideoTexture 全量核对**（13+ 处 Canvas、3 处 Video，建议统一 `colorSpace = SRGBColorSpace`）；④ 阴影 bias 重调（如启用）；⑤ PCFSoftShadowMap→PCFShadowMap；⑥ 标定值入 `customConfigRegistry` 或独立常量模块 | 与阶段 0 基线截图逐场景像素对比（PSNR 阈值法），差异逐项归因 |
| **5 专项回归** | ① 骨骼动画套件：duplicateBoneChainFixer / animConventionCompensator / skeletonIntegrity / bone-physics 在 r185 GLTFLoader 下回归；② **FBX r184 up-axis 行为实测**（Mixamo FBX 动画套 GLB 模型）；③ **gaussianSplatRenderer shader 实测**（3DGS 显示）；④ WebGL2 检测与友好降级提示 | 8 个角色模板站立/动画正常（趴地/半埋地/裙子收起等历史案不复现）；FBX 动画姿态正确；3DGS 正常渲染 |
| **6 收尾** | ① 删 `_backup_r128/`（需用户确认）；② 提醒同步外部 ubuntu-deploy-package 部署包；③ **重新生成 `linux_node_modules.gz`**（根目录部署用 node_modules 打包，含升级后的 three 0.185）；④ package.json 锁 0.185.x；⑤ 本文档归档进 README 引用 | git diff 全量评审；全页面清单逐项打勾 |

---

## 七、风险矩阵（按影响排序）

| # | 风险 | 概率 | 阶段 | 缓解 |
|---|---|---|---|---|
| 1 | 光照物理化（legacy 移除）→ 全局亮度/衰减剧变 | 必现 | 4 | 光强补偿表 + 基线截图对比 |
| 2 | 颜色管线切换（ColorManagement 默认开）→ 偏色 | 必现 | 4 | 逐场景 PSNR 对比归因 |
| 3 | unified_editor CDN 404 → 白屏 | 必现（若只改版本号） | 3 | 重写为本地优先 |
| 4 | three-shim 导出缺失 → FBX 动态加载报 undefined | 大概率 | 2 | diff 补全 + FBX 冒烟测试 |
| 5 | FBX r184 自动 up-axis → FBX 动画姿态偏转 | 中 | 5 | Mixamo 样本实测，必要时加载后逆补偿 |
| 6 | gaussianSplat GLSL1 shader → 3DGS 渲染异常 | 中 | 5 | 黑盒实测，最小修复 |
| 7 | GLTFLoader 蒙皮/命名行为微变 → 4 个自研骨骼修复模块连锁回归 | 中 | 5 | 8 模板全量回归（历史案清单） |
| 8 | WebGL1 设备淘汰（r163）→ 旧设备黑屏 | 低 | 5 | WebGL2 检测 + 友好提示 |
| 9 | postprocessing 旧版失效 | 低（有桩兜底） | 2 | 升 6.37+ 候选 |
| 10 | radialSegments 默认值提高 → 生成几何观感微变 | 低 | — | 知晓即可，不做补偿 |

---

## 八、历史回归清单（阶段 5 必测项，来自项目记忆）

- zhu/Lazuli 模板趴地案（mofx_rig 动画 Hips rest 约定）
- 谁到发疯模板半身埋地案（Armature +90°X 容器）
- Kipfel 裙子收起/前倾案（骨骼 rest 轴向约定补偿）
- 拿剑武士副本骨骼链换绑案（`_N` 后缀 + skin.joints）
- 玩家远距离"透明"案（容器旋转下沉折叠坐标系）
- Lazuli 衣服随距离消失案（SkinnedMesh frustumCulled，已知遗留）
- 416 红军副本合批 + 视距裁剪性能（FPS ≥ 60 基线）
- 原点幻影石头案（已删除对象 #482，确认不复发即可）

---

## 九、升级后禁止事项（长期约束）

1. 禁止再次引入 CDN 版本 Three.js 或 examples/js 形态引用。
2. 禁止在业务代码使用 r152 前 color API（`encoding`/`sRGBEncoding`/`outputEncoding`）。
3. 禁止依赖 legacy 光照语义（`physicallyCorrectLights`/`useLegacyLights`）。
4. 新增页面一律从 `js/lib/three.min.js`（r185 bundle）加载，禁止私建第二份 vendor。
5. 涉及 THREE 内部 API（shader chunk、renderer 内部状态）的改动必须在 `gaussianSplatRenderer` 同级的注释中登记版本假设。

---

## 十、执行进度与会话协议（跨对话框持续推进机制）

本升级工作量大（预计 8-12 个工作会话），无法在单个对话框内完成。以下机制保证跨会话无缝接续。

### 10.1 单一事实来源

**本文档第十节的进度表是唯一权威进度记录**。每次会话结束前必须更新；任何新会话以本表为起点，不凭记忆臆测进度。

### 10.2 会话协议

| 环节 | 规则 |
|---|---|
| **会话开场** | 用户只需说"继续 r185 升级"（或直接说当前阶段名）。助手第一件事：读本文档进度表 + 阶段任务描述，恢复上下文后复述"当前在阶段 X、上次做到哪、本次计划做什么"，再动手 |
| **会话单元** | 一个会话 = 一个阶段内的一个可验收子任务。会话结束时工作区必须处于**可运行状态**（不留半成品：改了一半的文件、跑不通的构建） |
| **会话收尾** | 三件事缺一不可：① 更新本进度表（状态 + 完成内容 + 遗留问题）；② 阶段级里程碑写入长期记忆；③ git 提交（独立 commit，消息含阶段编号） |
| **中断恢复** | 会话中途断掉（未走到收尾）：下次开场先 `git status` + 读进度表 + 检查上会话涉及文件的中间状态，确认无半成品后再继续 |
| **验收卡点** | 阶段验收未通过不得进入下一阶段；验收标准见第六节表格，逐项打勾记录在进度表 |

### 10.3 进度表（随执行更新）

| 阶段 | 状态 | 已完成内容 | 遗留问题 / 下次入口 |
|---|---|---|---|
| 规划与规范 | ✅ 完成 | 三轮全仓排查（版本矩阵/分水岭/命中点/无碍项/风险矩阵），规范 v2 落盘，11 条红线 | 无 |
| 阶段 0 基线 | ✅ 完成 | ①npm 升级完成：three 0.185.1 + @types/three 0.185.4，REVISION=185 验证通过；②旧 API 扫描器完成：`scripts/scan-three-legacy-api.js`（234 文件/13.8 万行，业务区 must-fix 78 处：outputEncoding×3、physicallyCorrectLights×2、texture.encoding×6、PCFSoft×3、Clock×1、CDN/examples-js 引用×54，完整清单见 `scripts/_scan_legacy_report.txt`）；③GLB 扩展扫描完成：`scripts/scan-glb-extensions.js`，350 个 GLB，**spec/gloss 风险 0**，全部扩展（meshopt/quantization/texture_transform/specular 等）为 r185 标准支持；④视觉基线截图完成（会话 2）：`scripts/capture_baseline_r128.js`（参数化输出目录，r185 后重跑生成对照组），10 张 PNG（1600×900 DPR=1 headless swiftshader WebGL）→ `Screenshot/baseline_r128/`，覆盖：world_editor / unified_editor / character_editor / animation_puppeteer / ai_scene_generator / ai_motion_factory / admin_dashboard + 主世界 3 机位（默认/yaw/yaw+pitch）。测试账号 `baseline_shot / Baseline#185`（仅截图专用，离线管理员表）。test_gaussian.html 跳过：全项目无 .ply 样本（`public/scenes/3dgs/` 为空目录） | 无 |
| 阶段 1 核心 | 🔶 进行中 | 构建+修点+冒烟已完成（会话 3）：①`scripts/build-three-r185.js`（esbuild 0.28.2 devDep）产出 r185 UMD bundle（0.85MB，sha256=a42ae440…）占用 `js/lib/three.min.js` 旧文件名，源料入口 `public/js/lib/three-r185/entry.js`；**两个关键实现坑已固化**：(a) DRACOLoader 顶层 `new URL(path, import.meta.url)` 在 IIFE 下变 `new URL(path, undefined)` → 浏览器加载即抛 Invalid URL，用 banner 注入 `__threeBundleBaseURI__`（=document.currentScript.src）+ define `import.meta.url` 解决，且 `../libs/draco/*` 恰好解析到项目本地 `/js/libs/draco/`；(b) esbuild IIFE globalName 拿到的是模块导出对象（含 default 包装），故 globalName 仅作占位 `__THREE_R185__`，由入口显式挂 `globalThis.THREE`。A 层垫片（THREE.Math/MathUtils 别名、sRGBEncoding=3001/LinearEncoding=3000 常量）入 bundle。②6 加载器 stub 化 + 旧 r128 文件（7 个）入 `js/lib/_backup_r128/`（构建脚本自动、幂等、绝不覆盖备份）。③index.html（6 个 lib script）+ test_gaussian.html + admin.html 两处动态注入数组全部加 `?v=185` 破缓存。④C 层修点 10 处全部落盘并逐一搜索验证：world.js:55 outputColorSpace、world.js:56,70 删 physicallyCorrectLights、world.js:8361,8452 colorSpace、worldTextureOptimizer.js:79 colorSpace、buildingManager.js:303 TransformControls getHelper() 双兼容（r169 非Object3D）、world_editor.html:7907,8034,8074 双兼容写法（该页阶段 3 前仍 CDN r128）、test_gaussian.html:55、admin.html:8521 直接新 API。⑤顺手清除 index.html 对 `js/frameBudgetScheduler.js` 的死引用（该文件 git 历史从未存在，每次加载 404）。⑥冒烟 `scripts/smoke_r185_world.js` 9/9 PASS：主世界 REVISION=185、7 加载器挂载、outputColorSpace=srgb、场景渲染非黑、console errors=0、404=0、test_gaussian REVISION=185 | **剩余（会话 4=阶段 1 完整验收）**：登录→进世界全链路（建筑/角色/动画/传送门/合批）回归；动画命中率与升级前对比（204 骨 51 匹配等基线）；416 红军合批 FPS 基线。验收通过后阶段 1 才标 ✅ |
| 阶段 2 垫片 | ⬜ 未开始 | — | — |
| 阶段 3 编辑器群 | ⬜ 未开始 | — | — |
| 阶段 4 光照颜色 | ⬜ 未开始 | — | — |
| 阶段 5 专项回归 | ⬜ 未开始 | — | — |
| 阶段 6 收尾 | ⬜ 未开始 | — | — |

状态标记：⬜ 未开始 / 🔶 进行中 / ✅ 完成（验收通过）/ ⚠️ 受阻（附原因）

### 10.4 预计会话划分（参考，可按实际调整）

| 会话 | 内容 | 预估 |
|---|---|---|
| 会话 1 | 阶段 0 全部：npm 升级 + 旧 API 扫描器 + GLB 扩展扫描 | 1 个对话框 |
| 会话 2 | 阶段 0.5：playwright 视觉基线截图集（主世界 3 机位 + 7 编辑器页） | 1 个对话框 |
| 会话 3 | 阶段 1：esbuild bundle + 文件名兼容层 + stub 化 + 5 处 JS/4 处内联 API 修复 | 1 个对话框 |
| 会话 4 | 阶段 1 验收：主世界全链路回归（动画命中率、合批、传送门） | 1 个对话框 |
| 会话 5 | 阶段 2 垫片：three-shim 重生成 + three-examples 换 r185 + postprocessing + Clock→Timer | 1 个对话框 |
| 会话 6-7 | 阶段 3 编辑器群逐页迁移（每页迁完即验） | 2 个对话框 |
| 会话 8 | 阶段 4 光照颜色校准（需用户视觉参与确认） | 1 个对话框 |
| 会话 9-10 | 阶段 5 专项回归（骨骼套件 / FBX / 3DGS，含历史 8 案清单） | 2 个对话框 |
| 会话 11 | 阶段 6 收尾：清理备份（用户确认）+ 部署包提醒 + 文档归档 | 1 个对话框 |

### 10.5 变更控制

- 执行中发现规划需修订（新风险、新命中点、任务拆分变化）：**先改本文档再动代码**，并在进度表记录修订原因。
- 遇到适合"重构"优于"改写"的点：按红线第 11 条，先向用户说明前后对比，确认后执行。
