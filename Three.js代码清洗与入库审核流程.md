# Three.js 代码清洗与入库审核流程

> 版本：v1.0（2026-09-24）
> 适用范围：从网上收集的 HTML/JS 代码（Three.js 示例、特效片段、场景代码）清洗后入后台 Three.js 代码库的全流程。
> 目标环境：本项目后台 Three.js 代码块体系（admin 预规范化 → runner 二次规范化 → new Function 执行 → 入口解析），运行时为本地 Three.js **r185 UMD bundle**，世界模式共享场景，**无 importmap、无 ESM、无 CDN**。
> 样本依据：`L:\shegnjir185\网上找的代码\` 首批 8 个文件（草地/城堡/代码云/光柱/教学楼/小区/新的文档 7/展台）实测归纳。

---

## 一、代码来源与问题归纳

### 1.1 来源渠道

| 来源类型 | 特征 | 首批样本实例 | 风险等级 |
|---|---|---|---|
| three-cesium-examples 等个人示例站 | "Open Three" 统一模板，资源挂个人 GitHub Pages | 草地、代码云、光柱、新的文档 7、展台、小区 | 中（资源失效/版权） |
| three.js 官方 examples 原样拷贝 | importmap 用相对路径 `../build/three.module.js`，依赖 main.css 与模型文件，**脱离官网仓库跑不起来** | 城堡、教学楼 | 高（不可运行） |
| 后续预期：CodePen/JSFiddle/GitHub 片段 | 只有 JS 片段无 HTML 骨架 | — | 视情况 |

### 1.2 问题类型清单（按出现频率排序）

| # | 问题类型 | 首批样本实证 | 处置优先级 |
|---|---|---|---|
| P1 | **依赖版本失控**：无版本号 CDN（`threejs.org/build/three.module.js` 永远拉最新版），旧式 `three/examples/jsm/` 映射 | 7/8 文件 | 必修 |
| P2 | **硬编码外链资源**：贴图/模型/视频/解码器全部指向同一个人站点 `z2586300277.github.io`，存在失效、跨域、版权三重风险 | 6/8 文件 | 必修 |
| P3 | **不可独立运行**：相对路径依赖缺失（main.css、模型文件、本地 three.js 目录） | 城堡、教学楼 | 必修（或剔除） |
| P4 | **结构碎片化/顶层副作用**：内联 `<script type="module">` 顶层直接执行，无入口函数、无 export，无法被 runner 的入口解析（`__export_entries` → `create*/build*/make*` → 候选名单）识别 | 8/8 文件 | 必修 |
| P5 | **API 版本不兼容风险**：r152 颜色管理革命前后的写法差异（outputEncoding/sRGBEncoding/texture.encoding）、旧式 addons 路径、可能混入已删除 API（如 RGBFormat） | 潜在 | 必修 |
| P6 | **光照配置缺失或不匹配**：无灯（草地、展台）、castShadow 被注释、仅靠 AmbientLight，与本世界光照环境叠加后观感不可控 | 6/8 文件 | 打标+按需修 |
| P7 | **性能隐患**：10 万株草、setInterval 每 100ms 遍历 1000 平面改 uniform、无实例化 | 草地、代码云 | 打标+按需修 |
| P8 | **质量污点**：console.log 残留、大段注释掉的死代码、中英注释混杂、var/let 混用、私有 API hack（dat.GUI `__min/__max`、Group 挂非标准属性）、可疑字面量（`0x0a0a0a0` 七位十六进制） | 多个 | 清洗时顺手修 |
| P9 | **DOM/UI 耦合**：创建 `<video>` 元素、lil-gui/dat.gui 面板、`#box` 容器、页面 CSS——与代码块运行环境（共享场景、无独立页面）冲突 | 展台、小区、多个 | 必修（剥离） |
| P10 | **资源路径错误**：traverse 无条件覆盖所有 mesh 的 material.map、URL 模板拼接 | 展台、草地 | 审查项 |
| P11 | **碰撞检测缺失**：8/8 全部无碰撞；注意**勿把硬编码路径巡检动画误判为物理仿真**（小区.html） | 全部 | 打标注明 |
| P12 | **渲染模式差异**：RAF 循环 vs 按需渲染（教学楼 controls change 触发），世界模式下语义不同 | 教学楼 | 打标+适配 |
| P13 | **TS 语法混入**（本项目历史坑：正则兜底剥离误伤对象字面量） | 首批未发现 | 抽查项 |
| P14 | **NaN 顶点/异常数据**（本项目历史坑：导致包围球 NaN、视锥剔除异常） | 首批未发现 | 自动化检查项 |

---

## 二、清洗方法设计

### 2.1 人工视觉检测清单（逐项过，每项给 通过/修复/不适用 三态结论）

**A 组：可运行性（先看能不能跑）**

- A1 打开页面是否直接渲染出内容？白屏还是报错？
- A2 引用的 three.js 从哪来：CDN（哪个域名、有无版本号）/ 相对路径 / importmap？
- A3 是否引用了附加组件（OrbitControls/GLTFLoader/DRACOLoader/Stats/GUI 等）？来源路径是 `examples/jsm`、`three/addons` 还是第三方？
- A4 是否引用了页面外的资源：main.css、模型、贴图、视频、WASM、字体？逐个记录 URL 清单。
- A5 是否官方 examples 原样拷贝（特征：OG meta 标签、相对 importmap、main.css）？是则直接走"补依赖或剔除"分支。

**B 组：结构完整性（看代码骨架）**

- B1 是否包含完整四件套：scene / camera / renderer / 渲染循环？缺哪件？
- B2 渲染循环形态：RAF 循环 / 按需渲染 / setInterval 驱动？（setInterval 与渲染职责重叠要标出）
- B3 入口形态：顶层直接执行 / init() 调用 / load 事件 / 顶层 await？是否有可识别的工厂函数（create*/build*/make*）？
- B4 是否引用了不存在的变量或方法（肉眼扫未定义标识符，重点：跨函数引用、被注释掉的定义、拷贝时漏带过来的辅助函数）？
- B5 核心效果集中在哪段代码：几何构造、材质/着色器、动画更新、交互绑定——能不能一句话说清"这段代码干什么"？

**C 组：光照与材质**

- C1 灯光清单：类型/数量/强度/颜色/是否 castShadow？还是完全无灯？
- C2 材质类型与光照是否匹配：MeshBasic/ShaderMaterial 不受光（无灯合理）；MeshStandard/Physical/Lambert 必须有灯，否则全黑。
- C3 是否用了 envMap/天空盒/视频贴图"代替光照"？（展台模式——视觉上亮但无灯光对象）
- C4 颜色空间写法：有没有 outputEncoding/sRGBEncoding/texture.encoding 这类 r152 前旧 API？（本项目 r185 下是死属性，靠兼容桥接，但新入库代码应直接写新 API）
- C5 阴影：renderer.shadowMap 是否开启？有没有被注释掉的阴影代码？

**D 组：资源与路径**

- D1 逐个列出所有外部资源 URL，标注：协议（http/https）、域名归属（官方 CDN/个人站点/相对路径）、文件是否实际存在。
- D2 是否有硬编码绝对路径/盘符/localhost？
- D3 资源加载失败的兜底行为：加载失败是报错中断还是静默继续？
- D4 是否动态创建 DOM 元素（video/canvas/img）拿资源？（注意：规范化工具的 stripDOMBox 只匹配 getElementById/querySelector，**不匹配 createElement**——Canvas 纹理生成是合法代码勿误删，video 元素则要剥离）

**E 组：交互与副作用**

- E1 用了哪些控制器/交互：OrbitControls/PointerLockControls/GUI 面板/键盘鼠标监听？这些在世界模式下是否冲突（世界有自己的相机控制）？
- E2 是否有全局副作用：往 window/document 挂属性、setInterval/setTimeout 常驻、事件监听不注销？
- E3 动画驱动方式：动画循环内更新 / 外部定时器 / 第三方动画库（animejs/GSAP）？

**F 组：质量污点**

- F1 console.log/debugger 残留？
- F2 大段注释掉的死代码？
- F3 可疑写法：七位十六进制颜色、私有属性 hack（`__xxx`）、给 three 对象挂非标准属性、魔法数字坐标？
- F4 注释语言与署名信息（保留来源署名，记录到入库元数据）。

**G 组：本项目特定检查（血泪教训沉淀）**

- G1 是否含 TS 语法（类型标注/接口/泛型）？——本项目正则兜底剥离曾误伤对象字面量，含 TS 必须走完整 Babel 链或手工改写。
- G2 顶点数据是否可能含 NaN？（大模型/程序化生成代码高发）
- G3 是否有嵌套模板字符串（`` `${...${}...}` ``）？——本项目语法错误高发点。
- G4 是否访问 `renderer.info`、私有 `_xxx`、压缩后会被混淆的内部名？
- G5 性能粗估：draw call 量级、三角形量级、每帧分配（new 对象在循环里）？超过世界预算（draw call≤80/特效）的标性能警告。

### 2.2 自动化辅助手段（只定功能目标，不限定工具）

| 环节 | 功能目标 | 产出 |
|---|---|---|
| 语法体检 | 对抽取出的 JS 做语法解析，确认无语法错误、无未闭合括号；识别 ESM/import/export/顶层 await 等需要改造的结构特征 | 语法结论 + 结构特征清单 |
| 依赖扫描 | 正则/AST 提取所有外部引用：script src、importmap 映射、import from、贴图/模型/视频 URL、WASM 地址；生成"依赖清单"并自动标注域名归属与协议 | 依赖清单表（人工核对用） |
| 旧 API 扫描 | 对照废弃/变更 API 名单做全文命中扫描（outputEncoding、sRGBEncoding、texture.encoding、RGBFormat、examples/js 路径、Clock 等；本项目已有 r185 升级期同款扫描器思路可复用） | must-fix 命中表 |
| 格式化 | 统一缩进/引号/分号，消除 var/let 混用噪音，让代码可读可审 | 格式化后代码（不改变语义） |
| 资源可用性探测 | 对依赖清单中的 URL 逐个发 HEAD 请求，标注 200/404/跨域头 | 资源存活表 |
| 沙箱运行探针 | 在无头浏览器里加载页面，捕获 console error / 未捕获异常 / 首帧是否绘制（截图像素非纯色判定） | 运行结论 + 首帧截图 |
| 死代码/残留统计 | 统计 console.log 数量、注释行占比、被注释代码块位置 | 清洗工作量预估 |
| 世界模式适配验证 | 把改造后代码块走真实预览链路（预规范化 → 二次规范化 → 执行 → 入口解析），断言入口解析成功、返回 Object3D、无 console error、渲染有像素 | 入库准出报告 |

### 2.3 清洗程度分级（入库门槛）

| 级别 | 名称 | 定义 | 存放位置 |
|---|---|---|---|
| **L0 原始存档** | 留证级 | 原文件一字不动归档，记录来源 URL/下载日期/作者署名 | `incoming/` 原始目录 |
| **L1 可运行** | 沙箱级 | 在其原始形态下（自带 HTML 骨架）本地能打开、首帧有画面、无 console error；依赖未修 | `quarantine/` 隔离区 |
| **L2 已清洗** | 候选级 | 完成 P1-P5 必修项：版本锁定到 r185 写法、外链资源本地化或替换、入口函数化、DOM/UI 剥离、旧 API 改写；通过世界模式适配验证 | `cleaned/` 待入库区 |
| **L3 已入库** | 正式级 | 带完整分类标签+元数据写入代码库，后台预览通过，进入回归集 | 后台代码库 |

**入库最低标准（L2→L3 准出，五条全过才准入）：**

1. **零报错**：世界模式沙箱执行全程 0 console error（favicon 404、浏览器扩展噪音等环境噪音除外）。
2. **有入口**：能被入口解析三层机制（`__export_entries` → `create*/build*/make*` 扫描 → 候选名单）确定性识别，返回值为 THREE.Object3D（世界模式）或完整 scene+camera（独立模式）。
3. **零外部副作用**：不创建/依赖页面 DOM 容器，不挂 window 全局，无常驻 setInterval/setTimeout 泄漏，事件监听可注销；动画必须走渲染循环驱动（delta 参数），禁止与帧率强耦合的每帧固定增量（本项目历史教训：低帧率下手感全变）。
4. **资源闭环**：所有外部资源要么本地化、要么程序化生成、要么声明为"需挂载资源"并在标签中注明；禁止指向个人站点/无版本 CDN 的活链接。
5. **性能达标**：静态对象 draw call ≤ 预算；动态特效有粒子/实例数上限；无每帧大量堆分配。

**关于碰撞检测的特别约定**：入库代码块**不要求自包含碰撞**——本世界碰撞由 capsuleCollision.js 统一在场景层处理。但必须在标签中注明"无碰撞"（静态摆设）/"需碰撞"（可进入建筑类，入库后由世界碰撞管线接管），并**严禁**代码块自带一套半截碰撞实现（要么没有，要么完整）。

---

## 三、入库与分类策略

### 3.1 分类标签体系（多维打标，入库元数据）

| 维度 | 取值 | 说明 |
|---|---|---|
| **动态性** | `static` 静态摆设 / `animated` 自驱动动画 / `interactive` 依赖用户输入 | 展台=static，草地=animated，小区=interactive |
| **光照** | `no-light` 无灯（Basic/Shader 自发光）/ `basic-light` 自带基础灯 / `shadow` 带阴影 / `needs-world-light` 依赖世界光照 | 草地=no-light，代码云=basic-light；**带灯代码块入世界会叠加世界光照，优先改造为 needs-world-light 或标注警告** |
| **场景完整性** | `full-scene` 完整场景（含天空盒/地面/多对象）/ `single-object` 单一对象 / `effect` 纯特效（光柱、水波）/ `utility` 工具函数片段 | 决定提取策略 |
| **渲染模式** | `raf` RAF 循环 / `on-demand` 按需渲染 / `delta-driven` 已改造为 delta 驱动 | 世界模式下统一收编为 delta-driven |
| **资源依赖** | `self-contained` 零外部资源 / `local-asset` 资源已本地化 / `needs-asset:<清单>` 需挂载资源 | 入库硬性检查项 |
| **技术特征** | `shader` 自定义 GLSL / `instanced` 实例化 / `particle` 粒子 / `gltf-load` 加载模型 / `video-tex` 视频纹理 / `wasm` WASM 依赖 | 可叠加多个 |
| **性能档** | `perf-light`（draw call<10）/ `perf-medium`（10-50）/ `perf-heavy`（>50 或大规模实例，仅管理员谨慎使用） | 依据自动化粗估+人工复核 |
| **碰撞** | `no-collision` / `world-collision` 交给世界碰撞管线 | 见 2.3 特别约定 |
| **来源与许可** | `source:<站点名>` + `author:<署名>` + `license:<已知许可/unknown>` | 溯源与版权底线 |
| **质量级** | 即 L1/L2/L3 + 入库日期 + 清洗人 | 回归追踪用 |

### 3.2 存放规则

```
网上找的代码/
  incoming/     L0 原始存档（永不修改，按 批次号_日期 建子目录）
  quarantine/   L1 沙箱可运行版（修到能跑为止）
  cleaned/      L2 已清洗待入库（按分类建子目录：building/ effect/ object/ scene/ utility/）
  _rejected/    判定不可救药的（官方拷贝缺依赖且补不齐、版权不明、效果重复）
  _登记表.md     批次登记（见 4.2）
```

后台代码库中的名称规范：`[分类]-[效果名]-[批次号]`，例：`effect-光柱-b001`。

### 3.3 从复杂场景提取子模块的规则

**何时提取**：full-scene 类代码（展台、小区、草地）通常只有一部分有复用价值。提取前先回答："这段代码里别人想要的到底是什么？"——是天空盒？是某种材质？是巡检路径？还是整体场景？

**提取手法（按侵入性从低到高）：**

1. **整体保留**：single-object/effect 类且结构干净的，只入口函数化，不拆。
2. **切层提取**：把"效果核心"与"场景装饰"切开。例：
   - 草地.html → 提取 `Grass` 类 + GLSL（effect-草地），丢弃天空盒/cloud.jpg 贴图依赖（世界自带天空）；
   - 光柱.html → 提取 `createLightBar()` 工厂函数（天然就是好入口），丢弃 AmbientLight 和 OrbitControls；
   - 展台.html → 拆成两份：`video-tex-视频材质`（VideoTexture + traverse 覆写，加多材质保护条件）与 `gltf-load-展台`（模型加载壳），天空盒丢弃。
3. **着色器移植**：shader 类代码（草地/代码云/新的文档 7）核心在 GLSL 字符串，提取 ShaderMaterial 构造段 + uniforms 初始化 + 动画更新段为三件套，丢弃原页面骨架；注意把 setInterval 驱动的 uniform 更新**收编进渲染循环 delta 驱动**。
4. **路径/数据提取**：小区.html 这类交互场景，漫游路径坐标数组可单独提取为数据资产，交互逻辑（PointerLockControls/双相机）与世界相机体系冲突，整体不入库，只留参考。

**提取后验证**：每个提取物单独过一遍 L2 准出五条，禁止"从能跑的代码里拆出跑不动的零件"直接入库。

**不可提取的直接判 rejected**：城堡.html、教学楼.html 这类官方拷贝缺依赖型——除非补齐模型与 CSS 并确有独特价值，否则不入库（官方 examples 的价值在文档不在代码）。

---

## 四、扩展性与长期维护

### 4.1 可重复执行的批次流水线（应对"特别特别多"）

固定七步，每批（建议 10-20 个文件）走一遍，任何一步发现批量性问题就停下来修规则而不是逐个硬扛：

```
S0 登记    → incoming/ 建批次目录，逐文件记录来源 URL/日期/作者 → _登记表.md
S1 初筛    → 沙箱运行探针全自动跑一遍，按结果三分流：
             能跑 → S2；报错但结构完整 → S2 标记"先修后审"；官方拷贝/空壳 → _rejected/
S2 自动清洗 → 格式化 + 依赖扫描 + 旧 API 扫描 + 资源探测，产出每文件的"清洗工作单"
S3 人工清洗 → 按 2.1 清单 A-G 组逐项过，完成 P1-P5 必修项；提取子模块
S4 适配验证 → 走真实预览链路（规范化→执行→入口解析→渲染断言），出准出报告
S5 入库    → 打全标签，命名规范，写入代码库；后台预览人工目检一次
S6 回归    → 加入回归集（见 4.3）
```

**效率原则**：同类模板（如本批 6 个文件共享同一 "Open Three" 骨架）只精审第一份，其余走"模板差异比对"——只看差异化代码段。后续批次同质化会更高，人工耗时大头在 S3 的 A/D/E 三组。

### 4.2 版本记录方式

- **批次号**：`b001`、`b002`……递增，入库名称、登记表、标签三处同源。
- **登记表字段**：批次号 / 原文件名 / 来源 URL / 下载日期 / 作者署名 / 初筛结论 / 清洗人 / 清洗日期 / 入库名 / 标签全量 / 准出报告结论 / 备注。
- **代码内溯源注释**：清洗后代码头部固定注释块（来源、作者、批次、清洗日期、清洗人、改动摘要）——一字不改的"原始存档"在 incoming/ 兜底，注释里只需写清"从哪来、改了什么"。
- **库存量台账**：每批次结束更新一次总数与分类分布，观察"哪类代码在堆积"（堆积=清洗规则或来源选择要调整）。

### 4.3 质量回归检查机制

| 触发时机 | 回归内容 | 判定 |
|---|---|---|
| **Three.js 运行时升级**（如 r185→更高） | 全量回归集走适配验证：入口解析 + 执行零报错 + 渲染像素断言；旧 API 扫描器重新扫一遍库存 | 任一不亮 → 标 `broken-rXXX`，暂停使用待修 |
| **runner/规范化工具变更** | 同上，重点验证入口解析命中率（本项目历史坑：入口解析失败不抛异常只渲染空场景） | 同上 |
| **定期抽检（每月）** | 随机抽 20% 库存重跑沙箱；外链资源存活表重扫（防已本地化之外的漏网链接失效） | 失效率 >5% 触发整批复查 |
| **世界管线变更**（颜色管理、光照体系、碰撞管线调整） | 针对变更维度专项回归（如光照体系改了，重点复跑 basic-light/shadow 标签的库存） | 按维度判定 |

**回归集维护**：每个 L3 入库代码自动进入回归集；被标 broken 的修复后重新过 S4-S5 再归队；连续两次升级无法修复的降级移入 `_rejected/` 并在登记表注明原因。

### 4.4 人员分工建议（代码量上来之后）

- **清洗人**：执行 S0-S4，对单个文件负责到底（避免多人接力丢上下文）。
- **审核人**：S5 准出复核，只查两件事——五条准出标准逐条过 + 标签是否打全。**清洗人不得自审**。
- **维护人**：负责 S6 回归与登记表台账，可以兼任。

---

## 五、首批 8 个样本的处置速查（按本流程的预判）

| 文件 | 初筛 | 主要必修项 | 预判分类 | 预判结论 |
|---|---|---|---|---|
| 草地.html | 能跑 | 外链天空盒/贴图、10 万株性能、入口化 | effect-草地（shader/instanced/no-light/perf-heavy） | 提取 Grass 类入库，性能档标 heavy |
| 城堡.html | 跑不起来 | 官方拷贝缺依赖 | — | rejected（除非补 monu10.vox） |
| 代码云.html | 能跑 | 9 张外链贴图、setInterval 收编、着色器 if-else 链 | effect-代码云（shader/needs-asset/perf-medium） | 提取后入库 |
| 光柱.html | 能跑 | 外链贴图本地化、depthTest hack 评估 | effect-光柱（self-contained 可改/no-light/perf-light） | 最优质样本，清洗量最小 |
| 教学楼.html | 跑不起来 | 官方拷贝缺 IFC 模型与 WASM | — | rejected（WASM 依赖与世界管线不符） |
| 小区.html | 能跑 | 模型/DRACO 外链、交互体系冲突 | full-scene 参考件 | 只提取路径数据，整体不入库 |
| 新的文档 7.html | 能跑 | console.log×5、dat.GUI hack、七位色值 | effect-水波（shader/self-contained/perf-light） | 提取着色器三件套入库 |
| 展台.html | 能跑 | 天空盒/视频/模型三外链、traverse 覆写保护、顶层 await | video-tex + gltf-load 两份 | 切层提取入库 |

> **2026-09-24 链路加固后的实测更新**（本表"预判"列已部分过时）：
> | 文件 | 世界模式实测 | 说明 |
> |---|---|---|
> | 城堡.html | **能显示**（2 渲染物） | VOXLoader 已本地化 + monu10.vox 已入库；样本自带 scale=0.0015，进世界约 0.18m，需编辑器放大 |
> | 小区.html | **14 渲染物** | 外链模型加载后产出内容；尺寸 932×1100m 由世界侧自动缩到 50m |
> | 展台.html | **15 渲染物**（异步晚到） | 异步等待 + 外部资源加载，需轮询 9s 才见内容 |
> | 教学楼.html | 0 渲染物 | 缺 IFC 模型与 WASM，属 needs-asset，仍建议 rejected |
> | 其余 4 个 | 正常产出 | 代码云 2000 / 光柱 44 / 草地 2 / 水波 1+1 |

---

## 五点五、链路加固记录（2026-09-24，已实施）

首批 8 样本实测驱动的一轮执行链路加固，核心策略转变：**清洗从"删代码"改为"运行时桩化"**。

| 项 | 改动 | 文件 |
|---|---|---|
| F1 | 存库不再删代码。原 `cleanThreeJSCode` 删 renderer/controls 声明但留下悬空引用（8 样本中 4 个因此 ReferenceError），现保存链 = 形态识别 → normalize → 直接入库；`clean_options` 仅作元数据记录 | admin.html saveThreejsBlock |
| F2 | 万能桩。`makeSmartStub` 首字母大写分支改为万能 Proxy 桩：任意方法存在、链式返回自身、可 new 可调用；`isXxx` 判定恒假、`children` 恒 `[]`、`then` 恒 undefined（防 Promise 捕获/递归/误添加）。一处修复覆盖 VOXLoader/dat.GUI/anime 等所有未知库类 | threejsCodeRunner.js |
| F3 | 顶层 await 兜底。同步 Function 构造报 await 语法错误时自动换 AsyncFunction 执行（world 模式捕获组为活引用，异步完成后照样显示），异步完成后补一遍世界清洗；ReferenceError 自愈由"重试一次"升级为最多 5 个缺失变量循环注入 | threejsCodeRunner.js |
| F4 | 超大模型自动等比缩小：最大维度 >50m 缩到 50m（与小模型放大到 1m 对称；小区样本 1100m 实测 ×0.05 生效） | world.js addThreeJSModel |
| 附带 | unified_editor 裸 `new Function` 恢复路径（无规范化/无桩化/无安全层）统一改走 runner | unified_editor.html |

**加固后实测**：8/8 样本 world 模式零执行错误；草地/代码云/光柱/新的文档 7 直接出内容；城堡/教学楼/展台/小区（外链资源缺失）优雅降级为空组，由 admin 预览"零渲染物"预验证门槛标黄拦截。主世界冒烟 9/9 无回归。

**留待后续评估**（本轮未动）：normalizer 的 16 条 legacy API 规则仍是 r128 基线方向（把新 API 降级旧写法，靠 compatibility 的 accessor 桥救回），r185 下建议评估反转或停用；world_editor/unified_editor 未加载 normalizer（二次规范化静默跳过，用户决策暂不补）。

### 加固第二轮（2026-09-24 晚）：层级/显示问题修复

用户实测反馈"光柱/代码云层级不对、城堡不显示"，三根因全部定位并修复：

| 问题 | 根因 | 修复 |
|---|---|---|
| 光柱穿透一切（X 光） | 样本 `planeMaterial.depthTest=false`，而清洗器的 depthTest 修正只覆盖点/线/精灵、不管 Mesh | 清洗器 `normalizeDepthState` 扩展到 Mesh（threejsWorldSanitizer.js，v=185fix2） |
| 代码云遮挡错乱 | 世界渲染器 `logarithmicDepthBuffer:true`（world.js:37），用户 ShaderMaterial 不含 logdepth 着色器块 → 深度编码与世界不一致 | 清洗器新增 `patchShaderLogDepth`：按 r185 ShaderChunk 等价注入（`USE_LOGARITHMIC_DEPTH_BUFFER` 宏包裹 + `logDepthBufFC`），渲染器未开 logdepth（admin 预览）时编译为空零副作用；已在 `gl_Position` 赋值后/片元 main 开头安全注入，自带 logdepth 处理的跳过 |
| 城堡不显示 | `VOXLoader` 不在 r185 bundle → 万能桩吞掉；且 monu10.vox 属无节点图老式文件，r185 解析器返回 `scene=null` → 代码 `result.scene.children[0]` 抛错被吞 | ①本地化 `public/js/lib/VOXLoader.js`（自 three r185 examples 转换：剥 import/export、等待式挂载 `THREE.VOXLoader`、无节点 scene 兜底补丁）；②资产 `public/models/vox/monu10.vox`（632KB，magic 校验通过）；③接入 index/world_editor/unified_editor/admin 四处（admin 两处惰性链） |

验证：世界内实测 光柱 depthTestFalse 33→0、代码云 logdepthInShader 0→2000、城堡 0→2 mesh；截图目检代码雨被建筑正确遮挡；冒烟 9/9。**注意**：城堡样本自带 `scale.setScalar(0.0015)`（demo 微距相机专用），进世界约 0.18m 很小，需在编辑器放大。

### 加固第三轮（2026-09-24 深夜）：草地/城堡不可见

用户实测反馈"草地不显示、城堡不显示"，两个根因：

| 问题 | 根因 | 修复 |
|---|---|---|
| 草地（自带 logdepth chunk 的着色器）静默消失 | 上一轮的对数深度注入**检测漏判 `#include <logdepthbuf_*>` 形式**（源码里没有 `vFragDepth` 字面量）→ 重复声明 `vFragDepth`/`logDepthBufFC` → 着色器编译失败；世界渲染器 `checkShaderErrors=false` → 无报错、直接不可见 | 清洗器与问题库的跳过判据都加上 `logdepthbuf_`（大小写不敏感）。实测草地 `hasInjectedUniform` 0、代码云仍 2000/2000 注入、无着色器错误、草地截图可见 |
| 城堡 0.18m 不可见 | ①样本微缩尺度（`setScalar(0.0015)`）；②更隐蔽的是**尺寸归一化跑在代码执行后同步阶段，而城堡是 VOX 异步加载**（500ms 后才出现）→ 归一化时组内为空 → 自动缩放完全失效（此缺陷对 展台/小区 等异步代码块同样存在） | ①新增阈值 `minObjectDim`（默认 0.5m，后台可调）：小于该值自动放大到 1m，与"超 50m 缩小"对称；②归一化抽成 `_normalizeThreejsSize()`，同步阶段测不到内容时**轮询等待内容出现后补做一次**（500ms×20 次 / 对象被卸载即止） |

验收：城堡自动放大 ×5.46 → 1.0m；草地渲染恢复；accept_threejs_pipeline 18/18、smoke_r185_world 9/9。

**教训（重要）**：给第三方着色器注入代码前，必须同时识别 `#include <chunk>` 形式；注入类"修复"一旦猜错就会静默破坏（世界侧关闭了着色器错误上报）。异步加载的内容不能只在同步阶段做尺寸/清洗处理。

### 加固第四轮（2026-09-24）：编辑器/管理员模式复制代码块副本异常

现象："草地 (副本)"、"光柱 (副本)" 复制后不正常。根因在后端 `POST /api/world/objects/:id/copy`：

- 其 `INSERT` 列清单**不含 `threejs_code`** → 副本代码为空 → 世界端 `addThreeJSModel` 拿到空代码直接 return（什么都不显示）；
- 而前端副本原地加载器（`buildingCopyLoader.js`）只判断"方法存在且调用没抛错"，于是**认为复制成功、连页面都不刷新** → 表现为"复制出来了但不对"（静默失败，最难排查的一类）。

修复：副本 INSERT 补齐 `threejs_code`、`custom_config`（粒子/自定义参数）、`video_props`、`model_type`、`world_id`；`is_locked` 刻意不复制（副本应可编辑）。存量两份坏副本已用原始对象代码回填。

验收：复制 光柱/草地 → 副本 codeLen 2529/5952；前端链路端到端（POST copy → copyLoader 原地加载 → 场景 44 个网格上屏）PASS；修复后两份存量副本分别渲染 1 / 44 个网格；accept_threejs_pipeline 18/18、smoke 9/9。

**教训**：平台侧"复制/迁移"类操作要逐列核对是否漏字段（历史上已因漏 `has_collision` 修过一次）；前端"加载成功"的判定不能只看没抛异常，要断言真正产生了渲染物。

---

## 六、落地记录

### v1.1（2026-09-24）链路稳健化改造已实施

基于首批 8 样本实测（改造前仅 2/8 能过），完成 4 项修复 + 1 项一致性统一，验收 **12/12 PASS**（`scripts/accept_threejs_pipeline.js`，可重跑，含 F4 世界侧验证）+ 主世界冒烟 9/9：

| # | 修复 | 位置 | 内容 |
|---|---|---|---|
| F1 | 存库不再删代码 | `public/admin.html` saveThreejsBlock | 旧 cleanThreeJSCode 删 renderer/controls 声明留悬空引用（4/8 样本被它破坏）；现保存=规范化后完整代码，clean_options 仅作元数据记录 |
| F2 | 万能桩 | `public/js/threejsCodeRunner.js` makeSmartStub | 大写开头未知类一律返回万能 Proxy 桩（任意方法链式、可 new、防 thenable 捕获、防 Box3 无限递归）；修复 VOXLoader.load、gui.addColor 两类崩溃 |
| F3 | 顶层 await 兜底 + 自愈升级 | `threejsCodeRunner.js` 执行层 | await 语法错误自动换 AsyncFunction（world 模式捕获组活引用，异步完成后照样显示，并补一遍世界清洗）；ReferenceError 自愈由重试 1 次升级为最多 5 个缺失变量循环注入 |
| F4 | 超大自动缩小 | `public/js/world.js` 尺寸归一化 | 最大维度 >50m 等比缩到 50m（用户拍板），与小模型放大对称；实测 1000m→×0.05、10m 不变 |
| F5 | unified_editor 裸执行统一 | `public/unified_editor.html` | 废弃绕开规范化/桩化/安全层的裸 new Function 恢复路径，统一走 runner |

版本号：`threejsCodeRunner.js?v=1`（4 个 HTML）、`world.js?v=14`。

**实测断点归因备忘**（供后续批次参考）：①最大断点是旧存库删行逻辑本身（4/8）；②`autoDeclareImports` 生成的 `var X = typeof X!=='undefined' ? X : …` 因 var 提升自判失败，永远落到 THREE 命名空间桩——万能桩从根上兜住了这类问题；③"OK 但 0 渲染物"（城堡/教学楼/展台）由后台 world 预验证拦截，属正常分流；④展台的视频材质部分卡在外部 video 元素等待上，需按 3.3 节切层提取，不是 runner 问题。

**遗留待评估**（本次未动）：normalizer 的 16 条 legacy API 规则仍是 r128 基线方向（把新 API 降级旧写法、靠 compatibility 的 accessor 桥接救回），r185 下建议后续专项评估反转或停用；`threejs_code_blocks` 表的 source_type/auto_fixes/import_status 三列缺 DDL 迁移。

---

## 五点八、问题知识库（自动检测与处置，2026-09-24 建成）

**目的**：把踩过的坑固化成「机器可识别 + 可自动处置」的条目。问题库越大，新代码放进来被自动识别/修正的比例越高。

**实现**：`public/js/threejsIssueRegistry.js`（知识库 + 执行器，浏览器/Node 双端可用）

| 作用域 | 触发时机 | 行为 |
|---|---|---|
| `code` | 入库前（admin 预览诊断区、批量 CLI） | 静态体检：只读源码，命中即在后台诊断区列出 ISS 编号 + 处置建议 |
| `scene` | 世界加载时（runner world 模式，清洗器之前） | 对象体检验：命中即**自动修复**，控制台按 ISS 编号输出 |
| `delegated` | — | 已由其它模块（清洗器/世界归一化）自动处理，知识库只登记根因与处置位置，不重复执行 |

**动作分级**：`auto-fix`（安全自动修复，幂等）/ `warn`（自动识别 + 人工判断）/ `fatal`（必须人工处理）/ `delegated`（已自动处理，仅记录）。

**现有条目（v1.0.0，16 条）**

| 编号 | 问题 | 作用域 | 动作 |
|---|---|---|---|
| ISS-0001 | 材质 depthTest=false 穿透遮挡物 | scene | auto-fix |
| ISS-0002 | ShaderMaterial 缺对数深度适配（遮挡层级错乱） | scene | auto-fix |
| ISS-0003 | 执行成功但零渲染物（空对象） | scene | warn |
| ISS-0004 | NaN 顶点（视锥剔除异常） | scene | delegated |
| ISS-0005 | 非标准材质 | scene | delegated |
| ISS-1001 | 顶层 await | code | delegated |
| ISS-1002 | 外链资源依赖 | code | warn |
| ISS-1003 | 未内置的 Loader | code | warn |
| ISS-1004 | 悬空引用（renderer/controls 未声明） | code | warn |
| ISS-1005 | depthTest=false 静态出现 | code | delegated |
| ISS-1006 | 已删除的旧 API | code | fatal |
| ISS-1007 | TypeScript 语法 | code | delegated |
| ISS-1008 | 定时器驱动动画 | code | warn |
| ISS-1009 | 无入口函数且不产生对象 | code | warn |
| ISS-1010 | 代码自带灯光 | code | delegated |
| ISS-1011 | 尺寸超出世界尺度 | code | delegated |

**批量体检（入库前第一步）**

```
node scripts/audit_threejs_issues.js [目录]     # 默认 L:\shegnjir185\网上找的代码
node scripts/audit_threejs_issues.js --json     # 机器可读输出
```

输出逐文件命中的 ISS 编号 + 处置建议 + 汇总（按编号统计命中次数、致命项数量）；退出码 1 = 存在致命项。检测前会自动剥注释，避免注释掉的代码产生误报（代码云.html 的 `// vertexColors: THREE.VertexColors` 曾误命中旧 API 规则）。

**词条配置层（v1.1.0，数据与逻辑分离，2026-09-24 建成）**

清单型规则的数据不再写死在代码里，改存 `system_config('threejs_issue_config')`，**后台可视化增删、改完即时生效、不需要改代码或发版**：

| 可维护项 | 作用 |
|---|---|
| 内置加载器白名单 | 本地化一个新加载器后，加一行名字即不再告警（如 VOXLoader） |
| 已删除 API 清单 | 发现新的废弃 API，加一行即被识别为致命 |
| 灯光类名 | 代码自建灯光会被世界移除，按此清单识别 |
| 允许的外链域名 | 放行后该域名的资源不再报 ISS-1002（如官方 CDN） |
| 阈值（大几何 / 自动缩小尺寸 / 定时器数） | 调整触发灵敏度 |
| 规则启停 | 误报时临时停用某条规则 |

三处入口：
- **后台**：admin.html 右下角固定按钮「🧠 问题库」→ 弹窗内编辑清单/阈值/规则启停、查看条目总览与会话命中；保存写库（需管理员登录态）
- **API**：`GET /api/threejs-issues/config`（公开读）/ `PUT`（管理员写，含键校验、限长限量、未鉴权 401）
- **CLI**：`node scripts/audit_threejs_issues.js [--config 文件] [--api http://host] [--no-config]`——默认自动读后台配置，与浏览器端同源

**累积新问题的三步流程（缺一不可）**

1. 现象定位到根因后，在 `threejsIssueRegistry.js` 末尾按文件头模板追加条目（编号递增：场景级 ISS-00xx、代码级 ISS-10xx）；
2. `detect` 写"能判定的最小条件"，`fix` 必须**幂等**（重复执行无副作用）；能自动处理写 `auto-fix`，需人判断写 `warn`；
3. 本节表格补一行，并把案例样本写进条目的 `samples` 字段——下次同类代码进来即自动命中。

**实测纠正（重要）**：判定"有没有内容"必须**轮询等待**，异步加载晚到会让即时计数误判为空对象——城堡/展台/小区三个样本都曾被误判，轮询后分别为 2/15/14 个渲染物。验收脚本已改为轮询最多 9s，并把"内容产出"作为独立判据。

---

## 七、红线（任何批次不得突破）

1. **incoming/ 原始存档永不修改**——所有清洗在副本上进行。
2. **无版本号 CDN、个人站点活链接严禁入库**——资源必须闭环。
3. **入口解析必须确定性命中**——禁止靠"兜底候选名单"蒙混入库（本项目历史坑：入口解析失败只渲染空场景不报错）。
4. **禁止带 DOM/UI 依赖入库**——video 元素、GUI 面板、页面容器一律剥离或改造。
5. **动画必须 delta 驱动**——每帧固定增量的写法一律改造（本项目帧率耦合历史教训）。
6. **清洗人不得自审**——L3 准入必须经第二人复核。
7. **版权存疑不入库**——无署名无许可的代码只进 quarantine 参考，不进代码库。
