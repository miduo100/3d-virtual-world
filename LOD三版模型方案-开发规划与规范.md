# 模型 LOD 三版方案 — 开发规划与规范

> 版本：v1.0（2026-09-11 制定）
> 适用范围：l:\shegnjir185 虚拟世界项目
> **文档作用：跨对话开发的唯一权威依据。每个新对话开场先读本文件 + 第 8 节进度表。**

---

## 1. 目标与背景

### 1.1 要解决的问题

红军模型群（26 个模型 × 16~24 份副本 ≈ 400~600 实例）在玩家**站在集群中心**时，视距裁剪圈 360° 全方向失效 → 每帧渲染 1300 万+ 三角形 → GTX 960 级别显卡 GPU 占用 100%、帧率崩塌。

单点减面只能治标：已做过两轮（50 万面 → 7.5 万 → 2.25 万面），继续减会明显掉画质。

### 1.2 方案主张

**把 LOD 做成上传管线的通用能力，而不是给红军做特例：**

- 任何模型上传后自动生成**三个版本**：高模（原文件/`_dec`）+ 中模 `_mid.glb`（约 25% 面数）+ 低模 `_lod.glb`（约 10% 面数）
- 渲染端按玩家距离自动切换：**近景高模、中景中模、远景低模**，超远距离回退蓝色占位方块
- 管理后台提供**总开关**（关闭 = 全部高模，本机高性能电脑用）+ **一键批量转换**（把存量模型补齐中低模）

### 1.3 预期收益

| 指标 | 现状 | 目标 |
|---|---|---|
| 红军区中心每帧三角数 | ~1380 万 | ≤ 200 万（-85%） |
| 红军区 FPS（GTX 960） | 12~20 | 50~60 |
| 磁盘占用 | 100% | +35%（中模 25% + 低模 10%） |

---

## 2. 设计规格（冻结，不得擅自更改）

### 2.1 文件命名约定

| 版本 | 文件名规则 | 示例 |
|---|---|---|
| 高模 | 原文件 / 已有的减面版 | `model-1787128677059-173733133.glb` 或 `..._dec.glb` |
| 中模 | 基准名 + `_mid.glb` | `model-1787128677059-173733133_mid.glb` |
| 低模 | 基准名 + `_lod.glb` | `model-1787128677059-173733133_lod.glb` |

**基准名推导规则（前后端必须完全一致）：**

```
基准名 = 生效文件名去掉末尾的 _dec.glb 或 .glb
中模   = 基准名 + '_mid.glb'
低模   = 基准名 + '_lod.glb'
```

> 例：`xxx_dec.glb` → 基准名 `xxx` → `xxx_mid.glb` / `xxx_lod.glb`

### 2.2 生成参数

- 中模：`gltfpack -si 0.25`；低模：`gltfpack -si 0.1`
- 参数沿用已验证的 `-kn -km`（保留节点名、保留材质），**不使用 `-sn`**
- 源模型面数 < 5000 时**不生成**中低模（收益为零，白占磁盘）
- 输出面数 < 300 或未小于源文件 → 判定无效，删除输出并跳过
- 生成源 = **实际生效的文件**（有 `_dec` 版时从 `_dec` 派生，保证与高模同源）
- 幂等：已存在的中/低模文件直接跳过（重复点击/重复上传不重复劳动）
- **达成率是目标值、不是保证值**（2026-09-11 五样本实测）：gltfpack `-si` 受网格拓扑（边界/薄片）限制会提前停止简化，`-si 0.25` 实测 13.3%~36.9%、`-si 0.1` 实测 12.3%~21.0%（`-si 0.05` 也仍有卡在 21% 的模型）；`-km` 对达成率零影响、`-sa`（激进简化）只对部分模型有效。
  → 故验收口径为**相对达成**：**中模 < 源 且 ≤ 40%；低模 < 中模 且 ≤ 22%**
- **收益闸门**：低模面数 ≥ 中模面数 → 判无效（`reason = no-benefit-vs-mid`），不落盘，渲染端回退中模

### 2.3 渲染分带（按"玩家到模型表面"的距离，不是锚点距离）

| 距离区间 | 渲染内容 |
|---|---|
| 0 ~ 40m | 高模 |
| 40 ~ 200m | 中模（未生成时回退高模） |
| 200 ~ 400m | 低模（未生成时回退蓝色占位方块） |
| > 400m | 蓝色占位方块 |

- 开关关闭（`lod_enabled = false`）时：**完全维持现有行为**（≤200m 高模 / >200m 蓝方块），不加载任何中低模
- 分带切换**只作用于合批组**（同源多副本，如红军）；散装单模型本期不改（二期可选）

> **阶段 4 实测补充（2026-09-11，红军群 612 实例）**：
> 1. 红军群是**紧密集群**（质心到各实例水平距离：中位 25m、p75 34m、最大 74m）→
>    玩家站质心时约 90% 实例落在 ≤40m 高模带，LOD 在质心处收益天然很小（实测三角数 −10.3%）。
> 2. 中远景（站 100m 外，全部实例在 200m 内、排除"远界 400 vs 200"干扰）实测
>    **13.81M → 5.08M 三角数（−63.2%）**，三带归属 `{mid:72}` —— 这才是 LOD 的真实收益区间。
> 3. 中模面数实测为源模型 **33%~64%**（红军 `_dec` 已二次减面到 ~8k 面，gltfpack 再简化已接近下限），
>    故"所有实例都走中模"的理论上限降幅也只有 ~56%，**70% 在该资产集上不可达**。
> 4. 低模**形同虚设**：21 个红军族模型中 14 个的 `_lod.glb` 与 `_mid.glb` 面数几乎相同
>    （如 3876 vs 3875、5760 vs 5756），另 7 个被收益闸门直接拦下（200~400m 只剩蓝方块）。
> 5. 磁盘成本远超预估：21 组 170.9MB → 442.1MB（**+271MB / +158.6%**，变体各自携带一份内嵌贴图）。

### 2.4 配置项

- `system_config.lod_enabled`：字符串 `'true'` / `'false'`，**默认 `'true'`**（缺省视为开启）
- 接口（阶段 2 已实现）：
  - `GET /api/config/world-settings`：返回值含 `lod_enabled`（布尔，缺省 true）
  - `PUT /api/config/world-settings`：接收 `lod_enabled`；**可选字段——未传则不改动现有值**（防其他调用方误清空），非法值返回 400
  - `GET /api/config/lod-enabled`：**公开只读、无鉴权**（游戏前端用），返回 `{ enabled: bool }`；查询失败也返回 200 + 默认 true（不阻断前端）
- 上传管线（阶段 2 已实现）：单个上传与批量上传均在**纹理压缩之后**调用 `generateLodVariants(modelAbs)`，结果挂进响应体（单个 `model.lod`、批量 `results[].lod`）；任何失败只跳过不阻断上传
- 距离参数（40 / 200 / 400）**固定写死**在代码中，本期不暴露界面

---

## 3. UI 规格（管理后台）

### 3.1 位置

管理后台 → 系统配置 → **系统参数**页签 → 「🌐 世界基础设置」卡片**下方**，新增卡片「🗿 本世界模型设置」。

> **实现约定（阶段 3 落地，受红线 2 约束）**：`public/admin.html` 已超 1 万行属黑名单文件，
> 页面内只做 3 处最小改动 —— ①插入卡片标记（`#lod-settings-card`）；②引入 `<script src="js/adminModelLod.js?v=1" defer>`；
> ③`loadWorldSettings()` 末尾 1 行 `window.loadLodStatus(true)`。四个 JS 函数
> （`loadLodStatus` / `saveLodEnabled` / `runLodGenerate` / `refreshLodStatus`）全部放在**新建**的
> `public/js/adminModelLod.js`（约 175 行）中，沿用项目既有的 `js/admin*.js` 模块惯例。

### 3.2 卡片布局

```
┌─ 🗿 本世界模型设置 ──────────────────────────────────────┐
│  模型 LOD 分级渲染：远景自动用低模，降低 GPU 负载          │
│                                                           │
│  [说明区·灰底文字块]                                       │
│   作用：为模型自动生成“中模(25%面数)/低模(10%面数)”两个轻量 │
│         副本。玩家靠近看高模，中远景自动切换中/低模，大幅降  │
│         低 GPU 负载（大量复制的模型群收益最大）。           │
│   方法：① 开启开关并保存；② 点击“一键生成中低模”，等待进度  │
│         完成（存量模型分批转换）；③ 之后新上传的模型会自动  │
│         生成三版。关闭开关 = 全部按高模渲染（本机显卡好时用）。│
│                                                           │
│  ☑ 启用 LOD 分级渲染（关闭后全部使用高模）                 │
│                                                           │
│  📊 模型总数 128 — 已有中模 30、低模 28，待生成 98          │
│                                                           │
│  [ 💾 保存设置 ] [ 🗿 一键生成中低模 ] [ 🔄 刷新状态 ]     │
│                                                           │
│  [进度区] 正在生成 12/98：model-xxx.glb（生成中才显示）     │
└───────────────────────────────────────────────────────────┘
```

### 3.3 控件与按钮规格

| 控件 | 名称 | 功能 | 行为约定 |
|---|---|---|---|
| 复选框 | 启用 LOD 分级渲染（关闭后全部使用高模） | 控制游戏前端是否分带渲染 | 改表单值不立即生效，需点「保存设置」 |
| 按钮 1 | 💾 保存设置 | 把开关写入 `system_config.lod_enabled` | **只保存开关**，不动世界名称/URL/描述（先 GET 当前设置再整体 PUT，避免互相覆盖） |
| 按钮 2 | 🗿 一键生成中低模 | 给存量模型批量补齐中低模 | 二次确认 → 分批（每批 3 个）循环调用后端 → 按钮置灰显示进度 → 完成显示汇总；单个失败跳过不中断；已存在自动跳过；中断后可再次点击续做 |
| 按钮 3 | 🔄 刷新状态 | 重新扫描磁盘统计覆盖情况 | 只读，刷新状态行 |
| 文字行 | 📊 状态行 | 显示 总数/已有中模/已有低模/待生成 | 进页面自动加载（随 `loadWorldSettings()` 触发） |
| 进度区 | （自动出现/消失） | 批量生成进度与结果 | 完成后自动刷新状态行 |

**本期不做**：清理中低模文件按钮（留二期）、距离参数输入框、i18n 多语言（文案硬编码中文）

---

## 4. 阶段拆解与验收标准

> 每阶段独立可验证；**未通过验收不得进入下一阶段**。

### 阶段 1：后端 LOD 生成服务（不接任何调用方）

**改动文件**
1. `src/services/modelDecimate.js`：导出 `runPack`（`_runPack` 别名），1 行
2. **新建** `src/services/modelLod.js`：
   - `lodPaths(absPath)`：基准名推导
   - `generateLodVariants(absPath, { force })`：幂等生成中/低模，失败自清理，含"低模 < 中模"收益闸门
   - `scanStatus()`：扫描 `uploaded_models` + 磁盘，统计覆盖情况
   - `batchGenerateMissing({ limit })`：批量补齐，返回进度（processed/remaining/total）
   - `countTrisExact(absPath)`：只读 GLB 头部 JSON chunk 计面（`index.count/3`，无索引退化为 `POSITION.count/3`），避免整读大文件

**验收标准**（必须写可重跑脚本 `scripts/accept_lod_stage1.js`）
- A1 对 1 个真实模型生成成功：`_mid.glb` / `_lod.glb` 存在
- A2 面数**相对达成**（2026-09-11 用户确认调整口径）：中模 < 源 且 ≤40%；低模 < 中模 且 ≤22%
- A2b 语料抽检：低模必须严格小于中模，或被收益闸门正确拦下（`no-benefit-vs-mid`）
- A3 幂等：再跑一次返回 `exists`，文件 mtime 不变
- A4 低面数模型（<5000 面）跳过，reason = `low-poly-source`
- A5 源文件不存在 / 非 GLB → 返回 skipped，不抛异常
- A6 失败后不留垃圾文件

**对话数**：1 个

---

### 阶段 2：上传管线挂钩 + 配置读写

**改动文件**
1. `src/routes/uploadedModels.js`：两个端点（单个上传 ~153 行、批量上传 ~291 行）在纹理压缩之后调用 `generateLodVariants(modelAbs)`，结果挂进响应体（失败不阻断上传）
2. `src/routes/config.js`：
   - `GET /world-settings`：返回值增加 `lod_enabled`（默认 true）
   - `PUT /world-settings`：接收 `lod_enabled`，upsert 到 `system_config`
   - 新增公开 `GET /lod-enabled`（无鉴权，游戏前端用），返回 `{ enabled: true|false }`

**验收标准**（`scripts/accept_lod_stage2.js`）
- B1 用 Node 脚本上传一个小 GLB（fetch + FormData，**禁止 curl 传中文路径**）→ 响应体含 lod 结果
- B2 磁盘出现 `_mid.glb` / `_lod.glb`
- B3 `GET /api/config/lod-enabled` 返回 `{enabled:true}`
- B4 `PUT /world-settings` 关闭后 GET 返回 `{enabled:false}`，再打开恢复 true
- B5 上传一个坏 GLB → 上传仍成功，lod 结果为 skipped（不阻断）

**对话数**：1 个

---

### 阶段 3：管理接口 + 管理后台 UI

**改动文件**
1. **新建** `src/routes/modelLod.js`：`authenticateAdminToken` 保护；`GET /status`、`POST /generate`（body `{limit}`，默认 3，上限 10）
2. `src/server.js`：挂载 `app.use('/api/admin/model-lod', modelLodRoutes)`
3. `public/admin.html`：
   - 系统参数页签插入「🗿 本世界模型设置」卡片（位置见 3.1）
   - **新建** `public/js/adminModelLod.js`：`loadLodStatus()` / `saveLodEnabled()` / `runLodGenerate()` / `refreshLodStatus()`
     （admin.html 属黑名单大文件，逻辑不放页面内 —— 见 3.1 实现约定）
   - `loadWorldSettings()` 末尾追加 `loadLodStatus()` 调用

**验收标准**（`scripts/accept_lod_stage3.js` 或浏览器手测 + 截图）
- C1 卡片位置正确（世界基础设置卡片下方）
- C2 状态行数字与磁盘实际一致（脚本比对）
- C3 点「一键生成中低模」→ 进度显示 → 完成后待生成数下降
- C4 开关保存后数据库 `system_config.lod_enabled` 值正确变化
- C5 刷新状态按钮可用
- C6 0 console error

**对话数**：1~2 个（UI 代码量大，留 1 个做验收修复）

---

### 阶段 4：前端渲染 LOD 三带（核心，风险最高）

**改动文件**
0. **新建** `public/js/worldLodAssets.js`（资源侧助手，~160 行）：开关读取、变体 URL 推导、HEAD 探测、异步加载与缓存
1. `public/js/worldInstanceMerger_v2.js`：
   - 常量：`LOD_NEAR_DIST = 40`、`LOD_FAR_DIST = 400`
   - 启动时 `fetch('/api/config/lod-enabled')` → `window.__LOD_ENABLED`（失败默认 true）
   - 合批组创建后异步探测并加载中/低模（HEAD 探测 → `world.gltfLoader.load`），构建各自模板 → 追加同组 InstancedMesh（初值 count=0）
   - 裁剪循环改为三带：高/中/低各自写入实例矩阵与 count；三带编号列表变化才重建
   - 蓝方块（`syncFarBoxes`）阈值按"该组低模是否就绪"动态取 400 或 200
   - 组解散时额外 dispose 中/低模 geometry（不与高模/纹理缓存共享）
2. `public/index.html`：`worldInstanceMerger_v2.js?v=1` → `?v=2`

**验收标准**（`scripts/accept_lod_stage4.js`，真 GPU：`chromium.launch({channel:'chrome', headless:true})`）
- D1 开关开启 + 中低模就绪时，红军区中心 `renderer.info.render.triangles` 对比"关闭开关"下降 ≥70%
- D2 实测 FPS：开启后显著提升（记录开/关两组数据）
- D3 近景（<40m）为高模（目视 + 顶点数断言）
- D4 远景（200~400m）使用低模（`im.userData.__lodLevel === 'low'` 的 count > 0）
- D5 开关关闭 → 行为与改动前一致（三角数、蓝方块阈值回到 200）
- D6 走远卸载/走近重载循环 3 次无泄漏（textures/geometries 回到基线）
- D7 0 console error

**对话数**：2 个（第 1 个实现，第 2 个实测调优/修 bug）

---

### 阶段 5：全量转换 + 收尾

**内容**
1. 执行一键转换跑完所有存量模型（记录耗时、磁盘增量）
2. 全项目回归：主世界加载、几何建筑、媒体、3DGS、多人在线不受影响
3. 文档：更新本文件第 8 节进度表；部署包同步清单
4. git 提交

**对话数**：1 个

---

## 5. 对话总数与衔接方式

### 5.1 总数

| 阶段 | 内容 | 对话数 |
|---|---|---|
| 1 | 后端生成服务 | 1 |
| 2 | 上传挂钩 + 配置 | 1 |
| 3 | 管理接口 + 后台 UI | 1~2 |
| 4 | 前端三带渲染 | 2 |
| 5 | 全量转换 + 收尾 | 1 |
| **合计** | | **6~7 个对话** |

### 5.2 每个新对话的开场提示词模板

> 直接复制发送，只改「阶段号」和「阶段名称」：

```
继续 LOD 三版模型方案开发。
第一步：读 l:\shegnjir185\LOD三版模型方案-开发规划与规范.md，重点看第 2 节（设计规格）、
第 4 节中【阶段 N】的改动文件与验收标准、第 6 节（开发红线）、第 8 节进度表。
第二步：向我复述：当前进度、本阶段要改哪些文件、验收标准是什么。
第三步：确认无误后再开始写代码，一次只做本阶段范围内的事。
```

### 5.3 每个对话的收尾动作（三件事，缺一不可）

1. **更新进度表**（本文件第 8 节）：状态、实际改动文件、验收结果、遗留问题
2. **写记忆**（update_memory）：本阶段关键结论 + 踩坑 + 下一步入口
3. **git 提交**：commit message 说明阶段与验收结论（Windows 中文提交用 `git commit -F 文件`，勿用 `-m`）

> 会话中途被打断时，至少把进度表更新为「进行中 + 已完成的文件清单」，不留无法接手的半成品。

---

## 6. 开发红线（防止 AI 乱写）

### A. 改动范围

1. **只改本阶段清单内的文件**。禁止"顺手优化""顺便重构"任何无关代码。
2. 单文件代码 ≤ 500 行；**已超 1000 行的黑名单文件禁止追加新功能**（`public/js/world.js`、`admin.html`、`src/routes/admin.js`、`federation.js`、`federationSystem.js`、`geometryBuilder.js`、`templates.js`、`aiSceneGenerator.js`）。新逻辑一律放独立模块，用 require 调用或旁路 monkey-patch。
3. **禁止修改 `world.js` 的加载/卸载/渲染核心逻辑**。前端渲染接入只允许在 `worldInstanceMerger_v2.js` 内完成（该文件本就是旁路模块）。
4. 改代码前**必须先 read_file 确认现状**，禁止凭记忆或凭历史对话内容直接改。

### B. 行为约束

5. **失败不得阻断主流程**：LOD 生成失败 → 跳过该模型；上传仍返回成功；前端加载中低模失败 → 静默回退高模。
6. **幂等优先**：任何"生成/转换"操作必须可重复执行而不产生重复劳动或重复文件。
7. **不删原始资产**：不删除、不覆盖任何原始 `.glb` 或已有的 `_dec.glb`；只新建 `_mid.glb` / `_lod.glb`。
8. **数据库只增不删**：只新增 `system_config` 键，**本期不改任何表结构**。
9. 改任何前端 JS/CSS → **必须递增 `index.html` 里的 `?v=` 版本号**（否则浏览器缓存旧代码）。
10. 发现"重构比打补丁更合适"时，**先向用户说明现状与收益，等确认后再动手**（项目红线第 11 条）。

### C. 工程习惯

11. 每阶段必须产出**可重跑验收脚本**（`scripts/accept_lod_stageN.js`），并把实际输出贴给用户；无验收不算完成。
12. 临时诊断脚本用 `scripts/_tmp_*.js` 命名，**用完立即删除**。
13. Windows PowerShell 坑：内联中文会 GBK 乱码、`node -e` 的 `$1` 会被吃、`$conn` 变量会被外层吃掉 → **一律写成脚本文件执行**，脚本内输出用英文。
14. 修改前端文案本期**硬编码中文**，不引入 `data-i18n`（避免破坏现有 i18n 体系；i18n 化留独立阶段）。
15. 一次对话只做**一个阶段**；如需跨阶段，先在进度表登记原因。

---

## 7. 风险与预案

| 风险 | 影响 | 预案 |
|---|---|---|
| 中低模自带纹理导致显存重复占用 | 显存 +35% | 可接受；若不足，二期做"LOD 复用高模材质贴图" |
| gltfpack 批量转换耗时长（100+ 模型） | 一键转换要跑很久 | 分批（每批 3 个）+ 进度显示 + 可中断续做 |
| 中低模与高模外观差异明显 | 观感突变/穿帮 | 40m 分界内用高模；若差异大，二期把中模比例 0.25 提到 0.4 |
| 前端 LOD 加载失败 | 远景变蓝方块 | 回退链：低模→中模→高模→蓝方块 |
| 切换分带时实例矩阵重写开销 | 移动时轻微 CPU 波动 | 沿用现有"玩家位移 >0.5m 才重算 + 每 10 帧兜底"节流 |

---

## 8. 进度表（跨对话唯一权威记录）

| 阶段 | 状态 | 改动文件 | 验收结果 | 遗留 |
|---|---|---|---|---|
| 1 后端生成服务 | ✅ 已完成（2026-09-11） | `src/services/modelDecimate.js`（仅 exports 加 `runPack`/`_runPack`）、**新建** `src/services/modelLod.js`（~350 行）、**新建** `scripts/accept_lod_stage1.js` | `node scripts/accept_lod_stage1.js` → **14/14 PASS，VERDICT ACCEPTED**；A1 生成 226ms、A2 中模 29.5%/低模 15.0%(=中模的 51.1%)、A2b 语料 4/4、A3 幂等 mtime 不变、A4/A5/A6 全过；INFO scanStatus total=264 pending=145 lowPolySkipped=6 | ①收益闸门按用户确认的严格口径实现（低模 ≥ 中模才拦），实测存在"低模仅比中模小 0.2%"（`model-1787128685630-560171541_dec`）这类"名义通过但收益近零"的情况，是否加 5%~10% 余量待阶段 5 全量转换后用真实分布决定；②`mid` 无自身收益闸门（仅"必须小于源"），若需"中模必须显著小于源"同属二期话题 |
| 2 上传挂钩 + 配置 | ✅ 已完成（2026-09-11） | `src/routes/uploadedModels.js`（单上传 glb 块、批量上传 glb 块各加 1 处挂钩）、`src/routes/config.js`（GET/PUT world-settings 支持 `lod_enabled` + 新增公开 `GET /lod-enabled`）、**新建** `scripts/accept_lod_stage2.js` | `node scripts/accept_lod_stage2.js` → **11/11 PASS，VERDICT ACCEPTED**（B1 上传 234ms 响应含 lod、B2 磁盘 `_mid/_lod` 落盘且 29.5%/15.0%、B3 `{enabled:true}`、B4 关→false 开→true + 非法值 400、B5 坏 GLB 上传仍成功且 lod=skipped；INFO 批量端点 2/2 项 lod 正确）。脚本自带收尾：删测试模型与变体、恢复开关，验收后磁盘/DB 零残留 | ①`lod_enabled` 目前写死在 `system_config`（值为 `'true'`），阶段 3 由后台 UI 接管；②PUT `/world-settings` 仍是原有"无鉴权"状态（历史行为，本阶段未改）；③上传即生成变体不受开关影响（开关只管渲染），若"关闭=不生成"需二期决策 |
| 3 管理接口 + 后台 UI | ✅ 已完成（2026-09-11） | **新建** `src/routes/modelLod.js`、**新建** `public/js/adminModelLod.js`（~175 行）、`src/server.js`（import + 挂载 `/api/admin/model-lod`）、`public/admin.html`（卡片标记 28 行 + 脚本引用 1 行 + `loadWorldSettings` 末尾 1 行钩子）、**新建** `scripts/accept_lod_stage3.js` | `node scripts/accept_lod_stage3.js` → **17/17 PASS，VERDICT ACCEPTED**（C1 卡片位于「🌐 世界基础设置」下方且 4 个函数已挂载；C2 `/status` 计数与独立扫描完全一致 264/0/0/145 且无 token 401；C3 `{limit:1}`→processed=1 且 pending 145→144、`{limit:99}`→回显 10 且 processed=10、UI 进度与汇总正常且按钮运行时置灰；C4 关闭→DB `'false'`、打开→DB `'true'`；C5 刷新按钮生效；C6 0 console error）。截图 `Screenshot/accept_lod_stage3/c1_lod_card.png`、`c3_generate_ui.png` | ①UI 的"一键生成"验收采用 **mock 接口 + 真实接口组合**：mock 测 UI 循环/进度/按钮状态，真实接口测 pending 下降（否则会一次性转换 145 个模型）；②`logger` 仅 console，无独立审计；③卡片文案硬编码中文（红线 14，i18n 化留独立阶段）；④`admin.html` 未加 `data-i18n`，语言切换时靠 `reloadCurrentPageContent→loadWorldSettings` 触发刷新 |
| 4 前端三带渲染 | ⚠️ 有遗留（2026-09-11，代码完成、D1 判据待决策） | **新建** `public/js/worldLodAssets.js`、`public/js/worldInstanceMerger_v2.js`（+~120 行：三带常量、变体异步接入、三带 writeBand、远界动态、LOD 资源生命周期；706 行）、`public/index.html`（引入 worldLodAssets + `worldInstanceMerger_v2.js?v=1→v=2`）、**新建** `scripts/accept_lod_stage4.js`、**新建** `scripts/lod_generate_merged_groups.js`（合批组预生成中低模，阶段5全量转换的子集） | `node scripts/accept_lod_stage4.js` → **13/14 PASS，VERDICT REJECTED（仅 D1 未过）**：D3 三带归属正确（质心 `{high:64,mid:8,low:0}` = 72 实例；关闭时 `{high:72}`）、D4 250m 处 `{low:72}` + farLimit 400、D5 数据库开关关闭重载后 `__LOD_ENABLED=false` 且无变体 IM、三角数 13.81M 与运行时关闭完全一致、远界回到 200、D6 3 轮往返 textures 190/geometries 98→99 无增长、D7 0 console error（28 个变体探测 404 与 219 个导航取消已分类为预期噪音）、D2 FPS +4.9%。**D1 实测质心处仅 −10.3%（判据 ≥70%）；公平对比点（站 100m 外）实测 −63.2%** —— 见 2.3 节实测补充，判据需用户决策 | ①D1 判据与资产现实冲突（红军队列紧密 + 中模只到源 33~64%），理论上限 ~56%，待用户决策处理方式；②低模对 14/21 模型与中模面数几乎相同（收益≈0），7/21 无低模 → 低模带实际价值待评估；③磁盘 +158.6% 远超预估的 +35%；④变体探测用 HEAD 404 会在浏览器控制台留下 28 条 404 记录（设计内预期，二期可改为公开的变体清单接口消除）；⑤`worldInstanceMerger_v2.js` 现 706 行（未超 1000 红线，但已超 500 行理想值），二期可把三带逻辑再抽独立模块 |
| 5 全量转换 + 收尾 | ⬜ 未开始 | — | — | — |

状态图例：⬜ 未开始 / 🟡 进行中 / ✅ 已完成 / ⚠️ 有遗留

---

## 9. 附：已完成的侦察结论（新对话直接使用，无需重新摸代码）

| 文件 | 关键位置与结论 |
|---|---|
| `src/services/modelDecimate.js` | 已有 `_runPack(src,dst,ratio)`（60 行，gltfpack 文件接口）与 `countTris(absPath)`；`module.exports` 在 126 行，需补导出 `runPack` |
| `src/routes/uploadedModels.js` | 单个上传：减面 117~126 行，纹理压缩 150~165 行（挂钩点）；批量上传：减面 247~257 行，纹理压缩 288~303 行（挂钩点）。`savedFileName` 会变成生效文件名（`_dec.glb` 或原文件名） |
| `src/routes/config.js` | 当前 342 行。`GET /world-settings` 在 92 行（`IN` 列表需加 `lod_enabled`）；`PUT /world-settings` 在 114 行（`upsert` 辅助函数在 127 行）；挂载方式见 server.js 147 行（`app.use('/api/config', configRoutes)`） |
| `src/server.js` | `/api/admin/maintenance` 挂在 136 行、`/api/config` 挂在 147 行；新路由照此风格挂载 |
| `src/routes/adminMaintenance.js` | 鉴权写法：`router.use(authenticateAdminToken)`（18 行），`require('../middleware/adminAuth')` |
| `public/admin.html` | 系统参数页签容器在 2382~2412 行（`config-sub-sys-config`）；世界基础设置卡片结束于 2411 行（新卡片插在此后）；`loadWorldSettings()` 在 5595 行、`saveWorldSettings()` 在 5608 行 |
| `public/js/worldInstanceMerger_v2.js` | 常量区 36~40 行（`MERGE_THRESHOLD`/`MAX_RENDER_DIST=200`）；`mergeGroup` 在 135 行（LOD 初始化插入点）；`runCull` 在 393 行（三带改造点）；`syncFarBoxes` 在 335 行（蓝方块阈值改造点）；`unmergeGroup` 在 202 行（geometry dispose 补充点） |
| 渲染器现状 | 阴影全局关闭、像素比锁 1、MSAA 开启（`antialias:true`）、`logarithmicDepthBuffer:true`、`sortObjects:false`；合批组按 `im.count` 做距离裁剪；>200m 用共享蓝色 InstancedMesh 占位（1 draw call） |
| 红军资产 | 26 个模型的减面版为 `public/models/uploaded/model-178712*_dec.glb`（33 个 `_dec.glb` 文件在目录中） |
