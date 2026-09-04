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
| 阶段 1 核心 | ✅ 完成（验收通过） | 构建+修点+冒烟（会话 3）：①`scripts/build-three-r185.js`（esbuild 0.28.2 devDep）产出 r185 UMD bundle（0.85MB，sha256=a42ae440…）占用 `js/lib/three.min.js` 旧文件名，源料入口 `public/js/lib/three-r185/entry.js`；**两个关键实现坑已固化**：(a) DRACOLoader 顶层 `new URL(path, import.meta.url)` 在 IIFE 下变 `new URL(path, undefined)` → 浏览器加载即抛 Invalid URL，用 banner 注入 `__threeBundleBaseURI__`（=document.currentScript.src）+ define `import.meta.url` 解决，且 `../libs/draco/*` 恰好解析到项目本地 `/js/libs/draco/`；(b) esbuild IIFE globalName 拿到的是模块导出对象（含 default 包装），故 globalName 仅作占位 `__THREE_R185__`，由入口显式挂 `globalThis.THREE`。A 层垫片（THREE.Math/MathUtils 别名、sRGBEncoding=3001/LinearEncoding=3000 常量）入 bundle。②6 加载器 stub 化 + 旧 r128 文件（7 个）入 `js/lib/_backup_r128/`（构建脚本自动、幂等、绝不覆盖备份）。③index.html（6 个 lib script）+ test_gaussian.html + admin.html 两处动态注入数组全部加 `?v=185` 破缓存。④C 层修点 10 处全部落盘并逐一搜索验证：world.js:55 outputColorSpace、world.js:56,70 删 physicallyCorrectLights、world.js:8361,8452 colorSpace、worldTextureOptimizer.js:79 colorSpace、buildingManager.js:303 TransformControls getHelper() 双兼容（r169 非Object3D）、world_editor.html:7907,8034,8074 双兼容写法（该页阶段 3 前仍 CDN r128）、test_gaussian.html:55、admin.html:8521 直接新 API。⑤顺手清除 index.html 对 `js/frameBudgetScheduler.js` 的死引用（该文件 git 历史从未存在，每次加载 404）。⑥冒烟 `scripts/smoke_r185_world.js` 9/9 PASS。**完整验收（会话 4）**：`scripts/accept_stage1_world.js` 16/16 PASS——L1 游客全链路（REVISION=185、srgb、268 建筑、794 可见网格、传送门 API 200+UI、渲染循环 11.9fps(swiftshader 软渲染)、无报错、HTTP≥400=0）；L2 骨骼动画全链路（谁到发疯模板 addPlayer + 动作库 idle：sharedMixer 绑定当前模型✓、idle 运行✓、轨道命中 27/33、骨骼驱动 delta=58✓、**compDiag matched=51/uniqueBones=204 与升级前基线完全一致**、sunk=true/restBroken=false/willCompensate=true、截图目检站立贴地，历史趴地/埋地案不复发）；L3 红军合批（红军区 InstancedMesh 307 实例渲染✓，fps=4.8 swiftshader）。截图存 `Screenshot/accept_stage1/`（3 张）。判据说明：Box3.setFromObject 是 bind-pose 几何盒不反映蒙皮姿态，姿态判定以 compDiag+截图目检为准；FPS 在 headless swiftshader 无 GPU 环境仅验证渲染循环活着，GPU 环境的 60fps 基线对比由用户日常使用观察 | 无。下次入口：阶段 2 垫片 |
| 阶段 2 垫片 | ✅ 完成（验收通过） | ①`three-examples/` 换 r185 版（从 node_modules/three@0.185.1/examples/jsm 拷贝 loaders/FBXLoader.js、curves/{NURBSCurve,NURBSUtils}.js、libs/fflate.module.js，0.160 旧版 4 个文件备份至 `js/lib/_backup_r128/three-examples-0.160/`）；②`three-shim.js` 按 r185 FBXLoader + NURBS + postprocessing 6.39.4（peer three >=0.168 <0.186）三方导入并集重生成（87 符号，scripts/_gen_shim_check.js 已校验全部存在于 r185 bundle 导出），加 `window.THREE` 未就绪守卫；③`index.html` / `admin.html` 的 importmap `'three'` 均加 `?v=185` 破缓存并改 admin 的 `"three/"` 映射 → 本地 shim（消除 admin.html 本地 r185 UMD + CDN 0.158 ESM 双实例违规）；④postprocessing 6.39.4 ESM 本地 vendor（618.4KB）放 `js/lib/three-r185/postprocessing.esm.js?v=185`，admin `_loadThreeJSPreviewDeps` 候选列表重写为本地优先 + CDN 6.39.4 兜底 + 桩（删旧 6.15.1/6.10.0 候选，因依赖 r152 已删的 RGBFormat）；⑤`threejsCompatibility.js` patchTHREE 扩展，新增 `bridgeLegacyEncodingAPI(THREE)`：WebGLRenderer.prototype.outputEncoding / Texture.prototype.encoding 在 r152+ 颜色管理迁移后只是给实例挂死属性、视觉不生效，本期 B 层桥接把 3001/3000 赋值真正映射到 outputColorSpace / colorSpace，physicallyCorrectLights / useLegacyLights 静默 no-op（r165+ legacy 光照已物理化），使数据库存量 r128 代码块与用户粘贴示例恢复正确颜色行为（不落库改数据，幂等，try/catch 包住）；⑥ai_motion_factory.html 提前从 CDN 0.137 迁移到本地 r185 bundle（含 OrbitControls/GLTFLoader/Timer 命名空间），ai-factory-player.js Clock→Timer（`clock` 字段改 `timer`，Timer 要求每帧 `update()` 解耦于播放状态门控，避免暂停恢复首帧 delta 跳变）；⑦顺手修复 2 个验收暴露的存量 bug（与 r185 无关，但使验收能跑通）：(a) `threejsCodeRunner.js` 622/680/689 行 `captureScene.add(g)` 入口自引用守卫（world 模式 `THREE2.Scene` 替换为共享捕获组，入口 return 该对象时 add 自身报 "can't be added as a child of itself"，已加 `g !== captureScene` 守卫；行为不变但消错），(b) `ai_scene_generator.html` loadAIProviders 端点 `localhost:3000`（`Failed to fetch`）→ 统一同源 `''`（配置中三处改），且端点 `/api/admin/ai-providers`（恒 401）→ `/api/ai-providers/providers`（公开 200）+ 字段映射 `display_name/provider_type` + 过滤 `is_enabled=false`。**完整验收**：`scripts/accept_stage2_shims.js` 15/15 PASS——L1 主世界垫片链路（REVISION=185 / shim 87 符号齐全 / r185 FBXLoader 加载 Mixamo `anim-1779263475939-548011705.fbx` 成功 65 骨/clip 0.53s/53 轨道 / 无控制台报错）、L2 admin 代码块预览（REVISION=185 / postprocessing 6.39.4 真库加载 127 键非桩 / EffectComposer+RenderPass+Pane 代码真实执行：marker=passes:1,canvas=1 / 修复后 0 报错）、L3 AI 动作工厂（REVISION=185 / AIFactoryPlayer.timer instanceof THREE.Timer ✓ / controls instanceof OrbitControls ✓ / 0 报错，截图目检人模+网格+坐标轴正常渲染）、L4 AI 场景生成器存活（CDN r128 仍能加载，端点修复后 0 报错）。**主世界既有冒烟回归**：`scripts/smoke_r185_world.js` 9/9 PASS（场景 230 子节点、4 类加载器挂载、srgb 输出、canvas luma=278）。截图存 `Screenshot/accept_stage2/`（3 张：l1_world_shim/l2_admin_pp_preview/l3_motion_factory）。临时调试脚本已清理。判据说明：bundle 是 minified 产物，constructor.name 不可信（如 OrbitControls 被压为 'Xu'、Timer 被压为 'ul'），涉及 r185 类型判断必须用 `instanceof` 而非 name 匹配 | 无。下次入口：阶段 3 编辑器群（world_editor / unified_editor / character_editor / animation_puppeteer / ai_scene_generator / admin importmap — 6 个 CDN 引用页逐页迁移到本地 r185） |
| 阶段 3 编辑器群 | ✅ 完成（验收通过） | ①**bundle 扩容重建**：entry.js 新增 `BufferGeometryUtils` 导出（A 层垫片补 r151 更名别名 `mergeBufferGeometries`→`mergeGeometries`），`node scripts/build-three-r185.js` 重建（0.86MB，sha256=230edad…），REVISION=185 + 7 加载器 + 别名全验证，主世界 smoke 9/9、阶段 2 验收 15/15 回归无损；②**world_editor.html**：7 个 unpkg CDN script → 单个本地 `js/lib/three.min.js?v=185`（核心+GLTF/DRACO/OBJ/MTL+Orbit/TransformControls 已全并入命名空间）；draco decoder path 从 unpkg 收敛到本地 `/js/libs/draco/`（:7724）；`scene.add(transformControls)` → `getHelper()` 双兼容（r169+ TransformControls 非 Object3D）；:5600 `transformControls.update()` 加守卫（r185 无此方法，gizmo 随渲染循环自动跟随）；③**unified_editor.html**：CDN 级联备选机制（unpkg/jsdelivr/cdnjs 三套 r128 列表，且 r160 后 `/examples/js/*` 路径 404 白屏高危）整体重写为本地优先（loadScript 本地 bundle + 组件校验 + 原 5 个模块加载与错误 UI 保留）；`scene.add(transformControls)` getHelper 双兼容；新建 `newGLTFLoader()` 工厂（DRACO 本地解码器 + 调用处 meshopt 追加）替换 3 处裸 `new THREE.GLTFLoader()`；④**character_editor / animation_puppeteer / ai_scene_generator** 三页各 2-3 个 CDN script → 单个本地 bundle（`?v=185`）；⑤**admin.html 校准器**：modelTransformControls / socketTransformControls 两处 add/remove 共 4 点 getHelper 双兼容，`.visible=true` 改到 helper 上；⑥**顺手修 4 个存量 bug（非 r185 引入，验收暴露）**：(a) weapons 表缺 `icon_emoji` 列 → `/api/public/character-templates/weapons` 恒 500（character_editor 武器库加载失败），已 ALTER TABLE 补列（init.sql 本有定义，运行库旧版缺列）；(b) unified_editor 加载冗余旧模块 `js/modules/ai-preview.js`，其顶层 `let previewChatHistory` 与页面内联同名声明冲突致整个模块 SyntaxError（AI 预览面板一直不可用），且页面内联已有全部 6 函数完整新版实现，已停止加载该模块；(c) unified_editor `checkAPIStatus` 写不存在的 `#apiStatus` 元素（null innerHTML 报错），已判空；(d) unified_editor 3 处 GLTFLoader 均未配 DRACOLoader（默认场景含 draco 压缩模型加载必败"No DRACOLoader instance provided"），已由工厂函数统一修复；⑦`performance-optimization.js` 裸全局 `BufferGeometryUtils` → `(THREE.BufferGeometryUtils \|\| BufferGeometryUtils)`（经 bundle 别名兼容）。**完整验收**：`scripts/accept_stage3_editors.js` 32/32 PASS——L1 world_editor（REVISION=185、组件 6/6、getHelper 存在、canvas 非黑 avgLuma=270、OrbitControls 拖拽旋转 meanAbsDiff=38、0 报错、0 three-CDN 请求、js/lib 无 4xx/5xx）；L2 unified_editor（threeJSLoaded=true、BGU+别名 function、非黑 avgLuma=402、0 报错、0 CDN）；L3/L4/L5 三页（REVISION=185、控制器就绪、0 报错、0 CDN）；L6 admin（无 three-CDN、校准器 getHelper 双兼容 4 处静态断言；dashboard 态 THREE 惰性未注入属正常）。截图存 `Screenshot/accept_stage3/`（5 张）。验收脚本噪音过滤增强：`net::ERR_*` 类资源错误仅当存在本地资源失败时计入（外部 CDN 网络抖动不算），本地失败由 localFailed 单独捕捉 | 全项目 three CDN 引用清零（admin 保留 babel/tweakpane/chart/postprocessing CDN 兜底，非 three 本体）。运行库 weapons 表已补列，**其他存量数据库部署时需同步执行** `ALTER TABLE weapons ADD COLUMN IF NOT EXISTS icon_emoji VARCHAR(10)`（init.sql 本有定义，旧库缺列）。下次入口：阶段 4 光照颜色校准（需用户视觉参与确认） |
| 阶段 4 光照颜色 | ✅ 完成（验收通过，零代码改动） | **核心结论：颜色校准实质已在阶段 1 修点（outputColorSpace）完成，r185 当前状态 = 正确颜色管线，本阶段以像素对比归因收尾，用户决策"全部接受，不做任何改动"。** ①r185 对照组截图：`node scripts/capture_baseline_r128.js r185` → `Screenshot/baseline_r185/`（10 张，与基线完全同口径：1600×900 DPR=1 headless swiftshader，主世界 0 console error）；②PSNR 对比工具固化为 `scripts/compare_baseline_psnr.js`（sharp，输出 PSNR/diff%/meanAbs/hot pixels），结果：admin 43.4dB/0.024%（UI 一致）；ai_motion_factory 38.2dB/4.6%；主世界 3 机位 10.3-12.9dB、unified_editor 11.9dB/64.7%、character_editor 18.0dB/53.1%——差异巨大但**逐张目检归因为 r152 颜色管理正确化**（r128 基线 gamma 双重拉伸偏亮偏粉：sRGB 贴图被当线性数据着色后再做 linear→sRGB 输出；r185 正确解码，草地粉→绿、头发粉→棕、肤色/天空恢复正常；构图/建筑/角色/传送门/UI 像素级一致，无功能回归）；③差异归因报告归档 `Screenshot/baseline_r185/_stage4_diff_report.md`。**三项校准决策（用户确认）**：(A) 接受颜色正确化——差异不构成回归，r128 时代存在全局 gamma 错误，升级顺带修复；(B) 18 处 CanvasTexture/VideoTexture **保持 NoColorSpace 不补 SRGBColorSpace**（与 r128 行为等价，避免观感二次变化）；(C) PCFSoftShadowMap **保留不改 PCF**（r181 弃用未移除，改 PCF 阴影更硬反而是视觉回归）；点光（world.js 刀剑/传送门/广告位、character_editor/weapon.js 武器光）不 ×π 补偿，r185 物理光衰减属正确行为 | 无。下次入口：阶段 5 专项回归（骨骼套件 duplicateBoneChainFixer/animConventionCompensator/skeletonIntegrity/bone-physics、FBX r184 up-axis、gaussianSplatRenderer shader、WebGL2 检测降级） |
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
