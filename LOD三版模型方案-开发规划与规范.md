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
| 磁盘占用 | 100% | ~~+35%~~ → **实测 +76.8%**（阶段 5 全量实测，见 2.3）|

---

## 2. 设计规格（冻结，不得擅自更改）

### 2.1 文件命名约定

| 版本 | 文件名规则 | 示例 |
|---|---|---|
| 高模 | 原文件 / 已有的减面版 | `model-1787128677059-173733133.glb` 或 `..._dec.glb` |
| 中模 | 基准名 + `_mid.glb` | `model-1787128677059-173733133_mid.glb` |
| 低模 | 基准名 + `_lod.glb` | `model-1787128677059-173733133_lod.glb` |
| 低模判定标记 | 基准名 + `_lod.skip.json` | `..._lod.skip.json`（旁路文件，记录低模被收益闸门判无效） |

> 注意：`X.glb` 与 `X_dec.glb` 推导出的中/低模路径**完全相同**（同一件产物的两个入口），
> 统计与生成都必须按「变体基准名」归并，不能按文件计数（见 2.2 实现约定）。

**基准名推导规则（前后端必须完全一致）：**

```
基准名 = 生效文件名去掉末尾的 _dec.glb 或 .glb
中模   = 基准名 + '_mid.glb'
低模   = 基准名 + '_lod.glb'
```

> 例：`xxx_dec.glb` → 基准名 `xxx` → `xxx_mid.glb` / `xxx_lod.glb`

### 2.2 生成参数

- 中模：`gltfpack -si 0.25`；低模：`gltfpack -si 0.1`
  - **参数修订（2026-09-12 二期收尾，用户决策「方案 1 全量改」）**：低模改为 **`-si 0.01 -sa`**（激进简化）。
    背景：红军 `_dec` 已两次减面到 ~8k 面，无 `-sa` 时 gltfpack 拓扑下限 ~3900 面
    （`-si` 0.05→0.005 实测面数完全不变）；`-sa` 实测 8099→28 / 7599→29 面（0.3~0.4%），
    包围盒保留、几何不退化。`-sa` 模式下 `-si` 比例值不影响结果。
    全量重生成 26 件红军低模：**96,882 → 1,436 面（-98.5%，单件 25~94 面）**，
    自动剥贴图，验收 23/23（质心 -72% → **-83.4%**）。
  - **输出下限修订**：`MIN_OUTPUT_TRIS 300 → 16`（300 会把激进低模误杀为 too-few-tris；
    中模输出数千面不受影响）。`MIN_SOURCE_TRIS=5000`、收益闸门 `LOW_BENEFIT_MARGIN=1` 不变。
- 参数沿用已验证的 `-kn -km`（保留节点名、保留材质），**不使用 `-sn`**
- 源模型面数 < 5000 时**不生成**中低模（收益为零，白占磁盘）
- 输出面数 < 300 或未小于源文件 → 判定无效，删除输出并跳过
- 生成源 = **实际生效的文件**（有 `_dec` 版时从 `_dec` 派生，保证与高模同源）
  - **实现约定（阶段 5 收敛）**：`lodPaths` 对 `X.glb` 与 `X_dec.glb` 推出的是**同一组**变体路径，
    而减面后原文件仍留在磁盘供 `restore` 使用 → 二者是「同一件产物的两个入口」。
    因此 `generateLodVariants` 内部统一走 `resolveLodSource()`：**请求路径为普通 `.glb` 且同名
    `_dec.glb` 存在时，一律改用 `_dec.glb` 作为生成源**（返回值新增 `sourceUsed` 字段说明实际源）。
    注意此规则按规范原文以「文件是否存在」判定；若某模型被 `restore` 切回原版，变体仍由 `_dec` 派生
    （视觉上仍是更轻的版本，不影响回退链），此边界待二期是否按 DB 生效路径判定。
- 幂等：已存在的中/低模文件直接跳过（重复点击/重复上传不重复劳动）
- **达成率是目标值、不是保证值**（2026-09-11 五样本实测）：gltfpack `-si` 受网格拓扑（边界/薄片）限制会提前停止简化，`-si 0.25` 实测 13.3%~36.9%、`-si 0.1` 实测 12.3%~21.0%（`-si 0.05` 也仍有卡在 21% 的模型）；`-km` 对达成率零影响、`-sa`（激进简化）只对部分模型有效。
  → 故验收口径为**相对达成**：**中模 < 源 且 ≤ 40%；低模 < 中模 且 ≤ 22%**
- **收益闸门**：低模面数 ≥ 中模面数 × `LOW_BENEFIT_MARGIN` → 判无效（`reason = no-benefit-vs-mid`），不落盘。
  - **`LOW_BENEFIT_MARGIN` 必须保持 1**（阶段 5 实测结论，见 2.3 第 7 条）：低模文件缺失会让该组合批组
    的远界 `farLimit` 由 400m 回落到 200m（200~400m 只剩蓝方块），因此**即使面数收益 ≈0 也必须生成低模**；
    加余量省磁盘的收益远小于该代价。
  - 判定结果会落一个 `<base>_lod.skip.json` 标记文件（含 reason / midTris / 时间），
    使 `scanStatus` 不再把「低模已判无效」的模型算作「待生成」；
    低模成功生成时标记自动清除。此机制依赖的 schema 见 2.1（只新增旁路 json，不动数据库）。

### 2.3 渲染分带（按"玩家到模型表面"的距离，不是锚点距离）

| 距离区间 | 渲染内容 |
|---|---|
| 0 ~ 30m | 高模 |
| 30 ~ 60m | 中模（未生成时回退高模） |
| 60 ~ 400m | 低模（未生成时回退蓝色占位方块） |
| > 400m | 蓝色占位方块 |

> **分带边界修订（2026-09-12，二期 B，用户决策）**：原「40/200/400」改为「**30/60/400**」。
> 背景：用户实测确认 200~400m 低模带相对蓝方块是"新增"渲染导致 GPU 不降反升，
> 收紧高/中模带让低模更早接管。实测质心三带归属 {high:57, mid:15, low:0}（原 40m 分界时 mid≈0）、
> 质心三角数降幅 -10.6% → **-15.2%**；100m 外视角进一步受益（60m 起全部低模）。
> 观感取舍：30m 处高→中切换有可见画质跳变；红军族低模≈中模面数，60m 切低模损失很小。

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

> **阶段 5 全量实测补充（2026-09-11）**：
> 统计口径：**全语料按「变体基准名」去重后扫磁盘**（`X.glb` 与 `X_dec.glb` 推出同一组变体，算一件）；
> 共 **118 件**（含阶段 4 已生成的红军族 21 组），其中可生成 112 件、源面数 <5000 跳过 6 件。
>
> 1. **低模有实质价值 → 结论：保留低模**。104 件低模中 **82 件（78.8%）相对中模再降 ≥30%**；
>    汇总 中模 1,242,682 面 → 低模 694,723 面 = **55.9%（降 44.1%）**；
>    低模/源 中位数 17.9%、汇总 20.8%（同时满足规范 2.2 的 ≤22% 口径）。
>    低模与中模几乎等面（≥95%）的 **16 件（15.4%）**，构成已定位：
>    **13 件来自阶段 4 的红军族**（该族已被两次减面到 ~8k 面，低于 gltfpack 实用下限），
>    另 **3 件来自本阶段**（5.4 万 / 5.9 万 / 7.9 万面的复杂模型，gltfpack 简化到下限）——
>    即阶段 4 看到的「14/21 几乎相同」属**红军族特性**，不代表全量语料。
> 2. **中模达成**：111 件中模/源 中位数 **36.1%**、最大 97.8%（约 79% 落在 20~40%）。
>    2 件 >90%（5.9 万 / 7.9 万面的复杂模型，gltfpack 几乎无法简化）仍会落盘，收益近零但不影响正确性。
> 3. **磁盘：1558.4MB → 2755.5MB（+1197.0MB / +76.8%）**，远超预估的 +35%。
>    根因：变体各自携带一份**内嵌贴图**，文件体积几乎与面数无关
>    （如 79,090→77,327 面即 −2%，体积仍是同量级）。→ 二期「LOD 复用高模贴图」是唯一有效手段；
>    分期看：新增中模 622.4MB、新增低模 574.6MB，源文件 1287.3MB 未变。
>    ⚠️ 注意「取消低模省磁盘」这条路走不通：**低模文件缺失会让该组远界由 400m 回落 200m，
>    200~400m 直接变蓝方块**（不是回退中模），见第 7 条。
> 4. **生成源歧义（本阶段修复的 bug）**：`lodPaths` 对 `X.glb` 与 `X_dec.glb` 推出的是**同一组**
>    `_mid/_lod` 路径，而减面后的原文件仍留在磁盘（供 restore 还原）→ **谁先被处理谁就决定了变体的源**。
>    全量转换实测有 **20 组**「原文件排在 `_dec` 之前」，会从**错的源**派生变体（后续 `_dec` 只报 exists）。
>    已按规范 2.2 收敛到 `generateLodVariants` 内部：**同名 `_dec.glb` 存在时一律以它为生成源**。
> 5. **剩余待生成全部可解释**：修正统计口径前是 15 条（其中 14 条只是 `X.glb`/`X_dec.glb` 的重复入口，
>    实为 7 件「中模已有、低模被收益闸门拦下」的模型，`no-benefit-vs-mid`）；
>    1 条 = 输入为 **Draco 压缩 GLB**，gltfpack 不支持解析（工具链限制，非代码缺陷）。
>    口径修正后 `pending = 1`（详见第 10 条）。
> 6. **转换成本**：118 个条目 **36.7s（0.31s/条目）**，最大单模型 3.1s（30 万面）。
> 7. **收益余量（阶段 1 遗留问题）：实测决定「不加」，余量保持 1** —— 这是一条重要的反直觉结论。
>    曾按「16 件（15.4%）低模相对中模降幅 <5%，落盘纯属浪费磁盘」加了 **+5% 余量**并清理这 16 个文件，
>    随后实测发现代价不可接受：前端 `worldInstanceMerger_v2.js` 的远界是
>    `farLimit = (lodOn && lowReady) ? 400 : 200` —— **低模文件缺失会把该组合批组远界从 400m 回落到 200m**，
>    200~400m 的实例不再渲染、只由蓝方块表示（这正是规范 2.3 表格「低模未生成时回退蓝色占位方块」的口径）。
>    受影响 **16 个合批组 / 381 个实例**（红军群主力：72、54、36×3、18×9 …）。
>    → **「低模文件存在」本身就是 200~400m 带能否显示几何的开关**，即使面数收益 ≈0 也必须生成。
>    省磁盘要另想办法（二期「LOD 复用高模贴图」），不能靠回收低模。已恢复 16 个文件、余量回退为 1。
>    `lod_convert_all.js` 的 `--prune-low` 保留但加了守卫（margin ≤ 1 时直接跳过并打印原因）。
> 9. **改动后的交叉复验**（证明本次对 `modelLod.js` 的修改 + 余量回退 + 低模恢复没有影响渲染行为）：
>    - `scripts/accept_lod_stage4.js` 重跑 **14/14 PASS，VERDICT ACCEPTED**：D1 公平对比点
>      13,811,614 → 5,079,814 = **−63.2%**（与阶段 4 会话实测完全一致）、D3 质心 `{high:64,mid:8}`=72、
>      D4 250m 处 `{low:72}` + farLimit=400、D6 3 轮往返 190/98→99 无泄漏、D7 0 console error。
>    - `scripts/accept_lod_stage3.js` 重跑 **17/17 PASS，VERDICT ACCEPTED**（独立扫描口径同步修正后，
>      与 `/status` 仍完全一致：118 / 111 / 104 / pending 1）。
>
> 10. **本阶段顺带修正的三处统计缺陷**（原为后台显示与状态判断问题，经用户确认本期修）：
>    - `_absFromDbPath` 用 `path.isAbsolute` 判断，而 Windows 下 `isAbsolute('/models/x.glb') === true`
>      → 数据库条目全部被当成「源文件缺失」（`missingSource` 假报 113，DB 那半边统计形同死代码）。现改为只认盘符/UNC。
>    - `scanStatus` 按文件计数，`X.glb` 与 `X_dec.glb` 共享同一组变体却算两件 → 后台「模型总数」虚高（264）。
>      现以**变体基准名**为唯一身份（`total` 264 → 118，`superseded` 别名 33 条）。
>    - 低模被真实收益闸门拦下的模型永远算「待生成」→ 后台一直显示待生成 15、点「一键生成」也清不掉。
>      现由 `_lod.skip.json` 标记记录判定结果，`pending` 只统计还能做的工作（**15 → 1**，仅剩 Draco 那个）。
>      `accept_lod_stage3.js` 的独立扫描口径已同步更新并重跑通过。

### 2.4 配置项

- `system_config.lod_enabled`：字符串 `'true'` / `'false'`，**默认 `'true'`**（缺省视为开启）
- 接口（阶段 2 已实现）：
  - `GET /api/config/world-settings`：返回值含 `lod_enabled`（布尔，缺省 true）
  - `PUT /api/config/world-settings`：接收 `lod_enabled`；**可选字段——未传则不改动现有值**（防其他调用方误清空），非法值返回 400
  - `GET /api/config/lod-enabled`：**公开只读、无鉴权**（游戏前端用），返回 `{ enabled: bool }`；查询失败也返回 200 + 默认 true（不阻断前端）
- 上传管线（阶段 2 已实现）：单个上传与批量上传均在**纹理压缩之后**调用 `generateLodVariants(modelAbs)`，结果挂进响应体（单个 `model.lod`、批量 `results[].lod`）；任何失败只跳过不阻断上传
- 距离参数（原「40 / 200 / 400 固定写死」→ **二期 C 起后台可调**，2026-09-12）：
  `system_config.lod_near_dist / lod_mid_far_dist / lod_far_dist`（正整数，须递增，默认 30/60/400）。
  管理后台「🗿 本世界模型设置」卡片三个输入框随「💾 保存设置」一并写入（`PUT /world-settings` 带范围与递增校验）；
  公开 `GET /lod-enabled` 一并下发 `{enabled, near, mid, far}`，玩家端 `worldLodAssets.fetchEnabled` 读取后
  `worldInstanceMerger_v2` 每帧动态取值 → **改距离保存后玩家端即时生效，无需刷新**

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
- D1 开关开启 + 中低模就绪时，**公平对比点**（站 100m 外、全部实例在 200m 内，排除"远界 400 vs 200"干扰）
  `renderer.info.render.triangles` 对比"关闭开关"下降 **≥60%**
  - **2026-09-11 用户确认调整**：原判据为「红军区中心 ≥70%」，实测质心仅 −10.3%（红军群紧密，612 实例中 90% 落在 ≤40m 高模带；
    且中模面数只到源 33%~64%，理论降幅上限 ~56%，70% 在该资产集上不可达）。质心降幅改为**特性记录**（INFO），
    不参与判定 —— 它恰好验证了"近景看高模"的设计意图。
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
| 中低模自带纹理导致显存/磁盘重复占用 | 实测磁盘 **+76.8%**（远超原估 +35%） | 已接受；二期做"LOD 复用高模材质贴图"才是根治手段 |
| gltfpack 批量转换耗时长（100+ 模型） | 一键转换要跑很久 | 实测 118 个条目仅 36.7s（0.31s/条目）；仍保留分批（每批 3 个）+ 进度显示 + 可中断续做 |
| 中低模与高模外观差异明显 | 观感突变/穿帮 | 40m 分界内用高模；若差异大，二期把中模比例 0.25 提到 0.4 |
| 前端 LOD 变体加载失败 | 远景变蓝方块 | **实测回退口径（阶段 5 校正）**：变体缺失时该组 `farLimit` 由 400m 回落 200m → **200~400m 一律蓝方块**；0~200m 内才按「中模缺失→高模兜底」。故**低模文件必须生成**（即使面数收益≈0），见 2.3 第 7 条 |
| 切换分带时实例矩阵重写开销 | 移动时轻微 CPU 波动 | 沿用现有"玩家位移 >0.5m 才重算 + 每 10 帧兜底"节流 |
| 输入是 Draco 压缩 GLB | 无法生成任何变体（该模型整组永远 200m 蓝方块） | gltfpack 不支持 Draco 输入，属工具链限制；已知 1 例（`model-1783481710732-936486373`，64,347 面），如需覆盖要先解压 Draco 再转 |

---

## 8. 进度表（跨对话唯一权威记录）

| 阶段 | 状态 | 改动文件 | 验收结果 | 遗留 |
|---|---|---|---|---|
| 1 后端生成服务 | ✅ 已完成（2026-09-11） | `src/services/modelDecimate.js`（仅 exports 加 `runPack`/`_runPack`）、**新建** `src/services/modelLod.js`（~350 行）、**新建** `scripts/accept_lod_stage1.js` | `node scripts/accept_lod_stage1.js` → **14/14 PASS，VERDICT ACCEPTED**；A1 生成 226ms、A2 中模 29.5%/低模 15.0%(=中模的 51.1%)、A2b 语料 4/4、A3 幂等 mtime 不变、A4/A5/A6 全过；INFO scanStatus total=264 pending=145 lowPolySkipped=6 | ①收益闸门按用户确认的严格口径实现（低模 ≥ 中模才拦），实测存在"低模仅比中模小 0.2%"（`model-1787128685630-560171541_dec`）这类"名义通过但收益近零"的情况，是否加 5%~10% 余量待阶段 5 全量转换后用真实分布决定；②`mid` 无自身收益闸门（仅"必须小于源"），若需"中模必须显著小于源"同属二期话题 |
| 2 上传挂钩 + 配置 | ✅ 已完成（2026-09-11） | `src/routes/uploadedModels.js`（单上传 glb 块、批量上传 glb 块各加 1 处挂钩）、`src/routes/config.js`（GET/PUT world-settings 支持 `lod_enabled` + 新增公开 `GET /lod-enabled`）、**新建** `scripts/accept_lod_stage2.js` | `node scripts/accept_lod_stage2.js` → **11/11 PASS，VERDICT ACCEPTED**（B1 上传 234ms 响应含 lod、B2 磁盘 `_mid/_lod` 落盘且 29.5%/15.0%、B3 `{enabled:true}`、B4 关→false 开→true + 非法值 400、B5 坏 GLB 上传仍成功且 lod=skipped；INFO 批量端点 2/2 项 lod 正确）。脚本自带收尾：删测试模型与变体、恢复开关，验收后磁盘/DB 零残留 | ①`lod_enabled` 目前写死在 `system_config`（值为 `'true'`），阶段 3 由后台 UI 接管；②PUT `/world-settings` 仍是原有"无鉴权"状态（历史行为，本阶段未改）；③上传即生成变体不受开关影响（开关只管渲染），若"关闭=不生成"需二期决策 |
| 3 管理接口 + 后台 UI | ✅ 已完成（2026-09-11） | **新建** `src/routes/modelLod.js`、**新建** `public/js/adminModelLod.js`（~175 行）、`src/server.js`（import + 挂载 `/api/admin/model-lod`）、`public/admin.html`（卡片标记 28 行 + 脚本引用 1 行 + `loadWorldSettings` 末尾 1 行钩子）、**新建** `scripts/accept_lod_stage3.js` | `node scripts/accept_lod_stage3.js` → **17/17 PASS，VERDICT ACCEPTED**（C1 卡片位于「🌐 世界基础设置」下方且 4 个函数已挂载；C2 `/status` 计数与独立扫描完全一致 264/0/0/145 且无 token 401；C3 `{limit:1}`→processed=1 且 pending 145→144、`{limit:99}`→回显 10 且 processed=10、UI 进度与汇总正常且按钮运行时置灰；C4 关闭→DB `'false'`、打开→DB `'true'`；C5 刷新按钮生效；C6 0 console error）。截图 `Screenshot/accept_lod_stage3/c1_lod_card.png`、`c3_generate_ui.png` | ①UI 的"一键生成"验收采用 **mock 接口 + 真实接口组合**：mock 测 UI 循环/进度/按钮状态，真实接口测 pending 下降（否则会一次性转换 145 个模型）；②`logger` 仅 console，无独立审计；③卡片文案硬编码中文（红线 14，i18n 化留独立阶段）；④`admin.html` 未加 `data-i18n`，语言切换时靠 `reloadCurrentPageContent→loadWorldSettings` 触发刷新 |
| 4 前端三带渲染 | ✅ 已完成（2026-09-11，D1 口径经用户确认调整） | **新建** `public/js/worldLodAssets.js`、`public/js/worldInstanceMerger_v2.js`（+~120 行：三带常量、变体异步接入、三带 writeBand、远界动态、LOD 资源生命周期；706 行）、`public/index.html`（引入 worldLodAssets + `worldInstanceMerger_v2.js?v=1→v=2`）、**新建** `scripts/accept_lod_stage4.js`、**新建** `scripts/lod_generate_merged_groups.js`（合批组预生成中低模，阶段5全量转换的子集） | `node scripts/accept_lod_stage4.js` → **14/14 PASS，VERDICT ACCEPTED**（D1 按新口径：公平对比点 13.81M→5.08M = **−63.2%** ≥60%；质心 −10.3% 记为特性 INFO）：D3 三带归属正确（质心 `{high:64,mid:8,low:0}` = 72 实例；关闭时 `{high:72}`）、D4 250m 处 `{low:72}` + farLimit 400、D5 数据库开关关闭重载后 `__LOD_ENABLED=false` 且无变体 IM、三角数 13.81M 与运行时关闭完全一致、远界回到 200、D6 3 轮往返 textures 190/geometries 98→99 无增长、D7 0 console error（28 个变体探测 404 与 219 个导航取消已分类为预期噪音）、D2 FPS +4.9%。**D1 实测质心处仅 −10.3%（判据 ≥70%）；公平对比点（站 100m 外）实测 −63.2%** —— 见 2.3 节实测补充，判据需用户决策 | ①低模对 14/21 模型与中模面数几乎相同（收益≈0），7/21 无低模 → **低模带价值待阶段 5 全量转换后用真实分布决定**（用户 2026-09-11 决策：阶段 5 再定）；②磁盘 +158.6% 远超预估的 +35%（变体各自携带内嵌贴图；二期可做"LOD 复用高模贴图"）；③变体探测用 HEAD 404 会在浏览器控制台留下 28 条 404 记录（设计内预期，二期可改为公开的变体清单接口消除）；④`worldInstanceMerger_v2.js` 现 706 行（未超 1000 红线，但已超 500 行理想值），二期可把三带逻辑再抽独立模块 |
| 5 全量转换 + 收尾 | ✅ 已完成（2026-09-11，含 2 轮用户决策 + 1 次决策回退） | `src/services/modelLod.js`（**生成源收敛 `resolveLodSource`**、`LOW_BENEFIT_MARGIN`、`_lod.skip.json` 标记 + `lowSkipPath`/`_variantKey`、**`_absFromDbPath` 修正**、**`scanStatus` 按变体基准名归并 + 待生成口径**）、**新建** `scripts/lod_convert_all.js`（全量转换 / `--dry` / `--prune-low`（带守卫）/ JSON 报告 / 首次报告归档）、**新建** `scripts/accept_lod_stage5.js`、**新建** `scripts/accept_lod_stage5_regression.js`、`scripts/accept_lod_stage3.js`（独立扫描口径同步 + C3c mock 随 pending 变小而改写） | `node scripts/accept_lod_stage5.js` → **24/24 PASS，VERDICT ACCEPTED**（内嵌回归 `accept_lod_stage5_regression.js` 13/13 ACCEPTED）。关键实测：E1 连续两次转换幂等（第二次 `generated=0`）且 `--prune-low` 为受守卫的 no-op；E2 `total=118`（原 264）/ `missingSource=0`（原 113）/ `pending=1`（原 15）/ `lowBenefitSkipped=7`；E3 中模/源 中位 **36.1%**、max 97.8%；E4 低模/中模汇总 **55.9%（降 44.1%）**、82/104 件（78.8%）低模比中模轻 ≥30%、低模/源中位 17.9% 汇总 20.8%；E5 8 样本幂等 mtime 不变；E6 `_dec` 源切换 20 处；E7 无 `.tmp.glb` 残留；E8 回归 ACCEPTED。交叉复验：`accept_lod_stage4.js` **14/14**（D1 公平对比点 −63.2% 与阶段 4 会话完全一致、D4 `{low:72}`+farLimit 400）、`accept_lod_stage3.js` **17/17**。转换成本 118 条目 36.7s（0.31s/条目），磁盘 1558.4→2755.5MB（+1197.0MB / +76.8%） | ①**低模结论：保留**（数据见 2.3 第 1 条）；②**收益余量：保持 1**（先按 +5% 清理了 16 件无收益低模，实测发现低模文件缺失会让该组远界由 400m 回落 200m、200~400m 变蓝方块，影响 16 组 / 381 实例，已回退并恢复全部文件）；③磁盘 +76.8% 远超预估 +35%（根因=变体各自内嵌贴图，体积与面数几乎无关），根治要二期「LOD 复用高模贴图」；④1 件 Draco 压缩 GLB 无法生成任何变体（gltfpack 工具链限制，见风险表）；⑤2 件中模比例 >90%（gltfpack 简化到下限，无收益但无害）；⑥后台文案/UI 未 i18n；⑦`accept_lod_stage3.js` 的独立扫描口径已随统计修正同步，其"独立性"相应降低 |
| 二期 A 变体复用高模贴图 | ✅ 已完成（2026-09-12） | **新建** `src/services/glbTextureStripper.js`（GLB 贴图剥离：JSON+BIN 手术、mesh 名兼容闸门/压缩/多 buffer/几何一致性五重闸门、原子写盘+回读验证）、`src/services/modelLod.js`（生成后剥贴图 + exists 幂等补剥 + `fmtBytes`）、`public/js/worldInstanceMerger_v2.js`（attachLodBand 按节点名/位序借用高模材质并立即 dispose 变体自带贴图、`__sharedMat` 标记、unmerge 区分贴图归属；v2→v3）、`public/index.html`（`worldInstanceMerger_v2.js?v=3`）、**新建** `scripts/lod_strip_variant_textures.js`（存量批量剥离，`--dry`/`--limit`）、**新建** `scripts/accept_lod_stage6_texture_share.js` | **实测定位（用户控制台数据）**：位置A（群中心）13.81M→5.14M 三角（−63%）LOD 本体有效；位置B（100m 外）开=3.06M vs 关=0.19M —— **远界 200→400m 是"新增"渲染，GPU 不降反升的元凶**（用户决策仅做 A，远界维持 400）。迁移实测：215 变体剥 212（0 失败）、磁盘 **−1.3GB**（模型库 2755MB→约 1436MB / −48%）。验收 `accept_lod_stage6_texture_share.js` → **19/19 PASS，VERDICT ACCEPTED**：S1/S2 剥离产物结构（images/textures/samplers=0、面数不变、幂等 skip）、S4 源文件未动、T2a/T2b **33/33 lod InstancedMesh 材质与高模同 Texture 对象（零额外显存）**、T3a 质心 −10.6%、T3b 250m 低模带 `{low:72}`+farLimit 400、T1 0 console error | ①**GPU 不降的另一半**（用户已知悉未改）：远界 400m 的 200~400m 低模带相对蓝方块是新增渲染负载；如需 GPU 全面回落可做「远界可调配置」二期 B（未启动）；②3 件变体被 mesh 名兼容闸门拦下保留贴图（前端对不上名时回退自带材质，正确回退）；③首版剥离脚本曾因「bufferView filter 压缩索引」+「相邻区间合并丢中间偏移」产出坏文件（GLTFLoader 报 reading 'extensions'），已修复并用 force 重生成恢复，两处坑已写进 stripper 注释；④部署包同步清单新增 `glbTextureStripper.js`、`lod_strip_variant_textures.js`；⑤git 未提交（用户要求） |
| 二期 B 分带收紧 30/60/400 | ✅ 已完成（2026-09-12） | `public/js/worldInstanceMerger_v2.js`（`LOD_NEAR_DIST 40→30`、`LOD_MID_FAR_DIST 200→60`、`LOD_FAR_DIST 400` 不变 + 注释；v3→v4）、`public/js/worldLodAssets.js`（三常量同步；v1→v2）、`public/index.html`（版本号）、`scripts/accept_lod_stage6_texture_share.js`（新增 T3c 分带断言） | `accept_lod_stage6_texture_share.js` → **20/20 PASS**：T3c 质心三带 `{high:57, mid:15, low:0}` + farLimit 400（旧 40m 分界时 mid≈0，证明 30m 分界生效）；T3a 质心三角数降幅 -10.6% → **-15.2%**；T3b 250m `{low:72}` 不变；T2 材质共享 33/33 不变；0 console error | ①30m 处高→中切换有可见画质跳变（用户接受）；②其余模型 60m 切低模劣化比红军族明显（红军 low≈mid 面数）；③`world.js` 等处无硬编码分带值，无需其他改动 |
| 二期 C 分带距离后台可调 | ✅ 已完成（2026-09-12） | `src/routes/config.js`（GET/PUT world-settings + 公开 GET lod-enabled 下发 `near/mid/far`；范围 5~150 / 10~300 / 50~2000 + 递增校验，非法 400）、`public/js/worldLodAssets.js`（fetchEnabled 读分带 + getter 暴露；v2→v3）、`public/js/worldInstanceMerger_v2.js`（常量改 `bandNear/bandMid/bandFar` 动态读取，**保存后玩家端即时生效无需刷新**；v4→v5）、`public/admin.html`（卡片三个数字输入框 + 提示文案）、`public/js/adminModelLod.js`（输入框读写 + 客户端校验 + 与开关一并保存；v1→v2）、`scripts/accept_lod_stage6_texture_share.js`（T4a/T4b/T4c） | 验收 23 项：T4a API 下发 `{enabled,near:30,mid:60,far:400}`、T4b 玩家端动态读取一致、T3c/T3a/T3b/T2 全部不回归；非法值（near=500、near≥mid）实测 400；T4c 后台卡片回填由**用户实机截图确认**（30/60/400，headless 下 admin 登录守卫重定向无法自动化断言，记 INFO）；后端改动已重启本地服务器生效 | ①`PUT /world-settings` 沿用历史无鉴权状态（阶段 2 遗留未变）；②分带距离为全局配置，不区分模型；③git 未提交（用户要求） |
| 二期 D GPU 100% 深查修复（缺低模组 + 远界公式） | ✅ 已完成（2026-09-12） | `public/js/worldInstanceMerger_v2.js`（远界公式改 `lowReady ? bandFar() : min(bandFar(), 200m)`——缺低模的组不再突破用户配置的远界；v5→v6）、`public/js/worldLodAssets.js`（**60s 轮询 /lod-enabled 自动跟进后台改动**，已打开页面无需刷新；v3→v4）、**新建** `scripts/lod_backfill_low_variants.js`（绕过收益闸门强制补生成缺低模，剥贴图 + 清 skip.json） | **用户报 GPU 100% 实测定位**：红军 7 模型当年被收益闸门拦下无 `_lod.glb` → 这 7 组走「高模兜底」且远界回落 200m → **232/612 实例仍在渲染高模**（用户配置 far=50 也不生效），同位置 5.57M 三角；也解释了"方框外还有模型"（有低模的组 50m 外变方块、没低模的组 200m 内还在画高模）。修复：①补生成 7 个低模（7/7 OK，剥贴图各省 6.6~9.5MB）；②远界封顶公式。复测同位置 **5.57M → 0.64M 三角（-88%）**、high 232→0、20 组 farLimit 统一；验收 23/23（质心 on/off = -72%）。另修：fetchEnabled 只在页面加载读一次 → 已打开客户端不跟进后台改动，加 60s 轮询 | ①收益闸门与「低模必须存在」的矛盾：闸门拦下的模型会导致该组远界/渲染异常，补生成本次 7 件后 pending=0；今后上传若再被闸门拦截，跑 `lod_backfill_low_variants.js` 即可；②用户当前配置 5/10/50 偏激进（中模带 5~10m 形同虚设、方块圈 50m），已向用户说明可自行调整 |
| 二期 E 低模极限压缩（-si 0.01 -sa） | ✅ 已完成（2026-09-12，用户决策「方案 1 全量改」） | `src/services/modelLod.js`（`LOW_RATIO '0.1'→'0.01'` + 新增 `LOW_EXTRA_ARGS=['-sa']`、`_generateOne` 增加 extraArgs 透传、`MIN_OUTPUT_TRIS 300→16`、头部注释同步）、`src/services/modelDecimate.js`（`runPack` 增加可选第 4 参 `extraArgs`，向后兼容）、**新建** `scripts/lod_regen_low_aggressive.js`（红军族低模批量重生成：旧件移入 `_backup_low_aggressive_before/` → `generateLodVariants` 新参数重生成+自动剥贴图；支持 `--dry`）。**前端零改动**（版本号不变） | 实验先行（6 组参数 × 2 样本）：无 `-sa` 时 `-si` 0.05~0.005 面数完全不变（拓扑下限 ~2950/3875）；`-sa` 实测 8099→28 / 7599→29 面，包围盒保留未退化。全量重生成 **26/26 OK**：红军低模总面数 **96,882 → 1,436（-98.5%）**，单件 25~94 面，全部剥贴图（各省 6.6~9.9MB）。服务器已重启加载新参数。验收 `accept_lod_stage6_texture_share.js` → **23/23 ACCEPTED**，T3a 质心降幅 **-72% → -83.4%**，T3c 分带 `{high:0,mid:12,low:60}`（5/10/50 配置）、T2 材质共享 36/36、0 console error | ①低模观感=极粗糙剪影（~30 面），远距离专用；用户已接受（"更模糊无所谓"）；②本次只重生成红军族 26 件，其余 78 件非红军低模仍是旧参数产物（面数 ~18% 源，观感更好），如需统一可扩展 regen 脚本识别口径；③旧低模备份在 `public/models/uploaded/_backup_low_aggressive_before/`（确认无问题后可删）；④今后新上传模型的低模自动走新参数，无需人工干预；⑤git 未提交（用户要求） |
| 统计口径修正（countTris indices bug） | ✅ 已完成（2026-09-13，教室热点排查发现） | `src/services/modelLod.js`（`countTrisExact`：`pr.index`→**`pr.indices`**——glTF 规范字段是复数，原代码永远取不到索引数、静默回退 POSITION/3，对带索引模型低估面数数倍）、`src/services/modelDecimate.js`（`countTris` 同步修正）。 | **发现过程**：用户报 (-22.2, 803.1) 教室区 GPU 压力大 → 浏览器实测该点渲染 30.6 万面/帧、场景内 3.66M 面散装模型（女生3=150 万面 ×1、课桌×4=50 万面/个、鲁迅/小钟=15 万面）——而 LOD 系统记录的只有 1/5。**修正后全场真实面数**：合批组 14.26M（622 实例，LOD 已覆盖）、**散装 11.42M（84 对象，仅 11.42M 中的头部 10 件 ≈7.9M 集中在教室：女生×3 每件 150 万 + 课桌×4 每件 50 万）**——二期分析时"散装仅 2.56M、不值得做 LOD"的结论作废。连带处理：修正后 6 个曾被误判"<5000 面不生成"的模型变为合格，已补生成中/低模（剥贴图），pending 只剩 1 个 Draco；`*_lod.skip.json` 标记 0 个（无历史误判残留）；服务器已重启 | ①**散装模型 LOD 化（三期）现在有真实数据支撑**：教室热点 3.66M 面可见散装模型不受 LOD 管理（唯一文件无法合批、散装无分带路径），如需根治需用户批准立项；②第 2.2/2.3 节历史统计数字（中模 36.1%、低模 55.9% 等）基于旧口径，相对比例仍可参考、绝对面数偏低数倍；③git 未提交 |
| 三期 散装模型 LOD 化（会话 1 实现 + 会话 2 验收，含收尾） | ✅ 已完成（2026-09-13，会话 2 一并完成收尾三件事） | **新建** `public/js/worldLodStandalone.js`（~408 行旁路模块：注册扫描/表面距分带/变体懒加载/借高模材质/LRU/编辑模式暂停/远距交还裁剪路径）、`public/js/worldInstanceMerger_v2.js`（仅加 `isMergedUrl` 导出；v6→v7）、`public/index.html`（`worldInstanceMerger_v2.js?v=7` + 新引 `worldLodStandalone.js?v=1`）、**新建** `scripts/accept_lod_stage7_standalone.js`（11 判据）、**新建** `scripts/accept_lod_stage7b_lifecycle.js`（15 判据）。world.js 零改动（红线 3） | `accept_lod_stage7_standalone.js` → **11/11 ACCEPTED**（A1 教室热点注册、A2/A3/A5 三带切显、A4 变体 4/4 贴图与高模同 Texture 对象、A6 >200m 交还 `__culledByDist` 路径、A7 编辑模式还原暂停、A8 LRU 驱逐至 cap=1、A9 0 错误）；`accept_lod_stage7b_lifecycle.js` → **15/15 ACCEPTED**（L1 三轮走远卸载/走近重载 100% 重建、65s 采样、**结构性无泄漏**：可达几何 uuid 集 67→67/变体 22→22/高模 22→22 完全一致、收敛双采样 d=0；L2 后台改分带 48.6s 跟进≤60s、行为跟随、配置恢复；L3 新上传模型 lod.ok→建对象→自动注册→低模带切显→清理零残留；E1 0 错误）。回归：`accept_lod_stage6_texture_share.js` **23/23**、`accept_lod_stage5_regression.js` **13/13** 不回归。**三机位 GPU 对比（on/off，当前 5/10/50 配置，headless 中位数）**：教室热点 10.4 万 vs 73.4 万（**-85.8%**）、出生点 36.5 万 vs 126.5 万（**-71.2%**）、红军质心 183.9 万 vs 1385.6 万（**-86.7%**） | ①变体加载走 `world.gltfLoader` 直载，含 SkinnedMesh 的变体按决策 4 拒显（世界管线把高模蒙皮烘焙为静态故高模可注册，变体 None 回退高模，正确）；②LRU cap=24 时教室热点 held=28>cap（全部在显不可驱逐），如需调整用 `WorldLodStandalone.setLruCap(n)`；③测试方法论沉淀：POST/DELETE `/api/world/objects` 需管理员 token（worldWriteGuard）；抽检样本须排除 skins；摆位必须按实测表面距迭代收敛（固定偏移会被大半径模型吃掉）；④部署包同步清单见 8.1（worldLodStandalone.js / merger v7 / index.html / 两个 accept 脚本） |

### 8.2 三期规范：散装模型 LOD 化（2026-09-13 立项）

**背景**：统计口径修正（见上表末行）后，散装真实面数 11.42M（84 对象），教室热点 (-22.2, 803.1) 60m 内 3.66M 面（女生×3 各 150 万 + 课桌×4 各 50 万 + 鲁迅/小钟 15 万）完全不受 LOD 管理；变体已备好（散装 72/74 有 mid+low 且已剥贴图），纯缺前端渲染路径。

**已定决策（用户 2026-09-13 拍板，不得更改）**：
1. 散装与合批共用后台「🗿 本世界模型设置」同一套 near/mid/far 分带（`WorldLodAssets` getter 动态读取），不新增散装专用配置项；一键生成继续统一覆盖全部模型。
2. 散装不做蓝方块段：>mid 带一律低模渲染到既有 200m 硬裁剪（`MAX_RENDER_DIST`）为止。
3. 变体借高模材质（节点名 `Material.clone` 共享 Texture → 切换零 shader 编译冻结）；变体懒加载（首次进带才 HEAD+下载）+ LRU 缓存上限，绝不全量预载。
4. 跳过含 SkinnedMesh 的模型（保守，防动画冻结）；编辑模式（`buildingManager.isAdminMode`）下全部还原高模并暂停。
5. 红线不变：不碰 world.js 核心、单文件 ≤500 行、前端改动递增 `?v=`、失败静默回退不阻断、临时脚本 `_tmp_` 前缀用完删。

**渲染行为（散装，距离口径 = 玩家到模型表面，与合批一致）**：

| 距离区间 | 渲染内容 |
|---|---|
| ≤ near | 高模 |
| near ~ mid | 中模（缺 → 高模） |
| mid ~ 200m | 低模（缺 → 中模 → 高模），渲染到既有 200m 硬裁剪为止 |
| > 200m | 维持现状：`cullUnmerged` 摘除 + 统一蓝方块（散装无专用方块段） |

**实现约束**：
- **新建** `public/js/worldLodStandalone.js`（旁路模块，≤500 行，不碰 world.js）。
- 接管语义与合批源一致：换显变体时把高模摘出场景且**不设 `__culledByDist` 标记** → `cullUnmerged`/`syncFarBoxes` 自动跳过该模型；恢复高模时 `scene.add` 回。>200m 时本模块摘除变体并**主动设标记**，交还既有裁剪/蓝方块路径。
- 变体来源：`WorldLodAssets.loadVariant(world.gltfLoader, url, level)`（懒加载 + 全局缓存复用）；展示对象为缓存场景的 `clone(true)`（几何共享），材质按节点名借高模（对不上名回退自带材质）。
- LRU：变体展示对象总数上限（默认 24），只驱逐**未在显示**的最旧条目；整组驱逐时 `WorldLodAssets.forget(url)` 丢缓存 + dispose 独占几何。
- 跳过注册：占位符 / 无 `__texOptSource` / `custom_config` / `__excludeFromMerge` / 已被合批接管（经 merger 新增 `isMergedUrl` 导出判定）/ SkinnedMesh（登记 skipped 供诊断）。
- 编辑模式暂停并 `restoreAll`（还原高模，模型加回场景）；LOD 开关关闭时同。
- `worldLodAssets.js`（v4）不改；`worldInstanceMerger_v2.js` 仅加 `isMergedUrl` 导出（v6→v7）。

**会话拆分**：

| 会话 | 内容 | 状态 |
|---|---|---|
| 会话 1 | 核心渲染路径：**新建** `worldLodStandalone.js` + merger `isMergedUrl` 导出 + index.html `?v=` 递增 + **新建** `scripts/accept_lod_stage7_standalone.js`（实现 + 脚本就绪；headless 实测留会话 2） | ✅ |
| 会话 2 | 跑验收 + 教室热点三点位三角数对比（LOD on/off）+ 生命周期 3 轮无泄漏（>60s 采样）+ LRU 生效 + 后台改分带 60s 跟进 + 新上传自动纳入 + stage6 23/23 与 stage5 回归 13/13 + 修 bug | ✅（2026-09-13，stage7 11/11 + stage7b 15/15 + 回归 23/23、13/13；三机位 -85.8%/-71.2%/-86.7%） |
| 会话 3 | 收尾：进度表、8.1 部署清单增补（worldLodStandalone.js / accept 脚本）、git 提交 | ✅（并入会话 2 一并完成：进度表已更新、8.1 已增补、git 已提交） |
| 会话 3 机动 | 用户实机反馈"教室学生模型没有中低、离远直接深蓝占位"（X:-29.1 Z:790.9）。排查结论：磁盘 38 对象全有变体、0 蒙皮；全新会话 headless 实测分带**完全正常**（女生 12m 即低模、>200m 才蓝方块）。定位出 **2 个会话态退化缺陷**并修复：① `worldLodStandalone.requestVariant` 的 `variantNone` 为永久标记——变体请求撞上服务器重启/网络抖动窗口的那批模型永久回退高模直到刷新页面（与"**这部分**模型没有中低"吻合）；② `worldObjectBounds.ensure` 在模型装配完成前算出的**脏盒被永久缓存**（无人调 invalidate/unregister），实测教室模型脏盒宽 ~155m——锚点在盒内→表面距恒 0 永远高模带，盒偏移则玩家在旁边也 >200m 蓝方块。修复：① 失败改 60s 冷却重试（`noneUntil`），资源侧 `worldLodAssets` 缓存槽 `none` 分级 TTL（404 缺失 10min / 错误 60s）；② 盒加锚点一致性抽检（2s 节流，锚点远离盒→丢弃重算，重算同盒→判定合法偏移锚点）+ 30s TTL 周期全量重算 + 脏盒自愈时回收 urlRadiusMap 被污染半径；`debugBox`/`frames` 诊断口，`worldLodStandalone.debug` 增 `cooling`。版本：worldLodAssets v5 / worldLodStandalone v2 / worldObjectBounds v3。**另**：accept 脚本 placeAt 竞态修复（传送后需等 runFrame 更新 dist 再读，否则反向修正越摆越远——A6/A7 假失败根因）；stage6 的一次性迁移报告改磁盘抽样降级。验收：stage7 **11/11** + stage7b **15/15** + stage6 **22/22** + 瞬时故障自愈专项 **3/3**（模拟服务器故障窗口毒化 7 模型 → 冷却到期自动重试 → 22 模型恢复低模显示）。**给用户**：改动生效需强刷（Ctrl+F5）；后台分带为 5/10/50 激进配置，50m 外合批组是蓝方块属配置内行为 | ✅（2026-09-13） |
| 会话 3 机动 2 | 用户反馈"高/中/低视觉差距很小，低模与红军低模完全不同"。根因：全库 118 组三件套中仅红军 26 组是二期 E 激进低模，其余 92 组是一期旧参数（中=25%、低=10%），教室全在其中；变体借高模材质（二期 A）后三带唯一区别只剩几何密度→视觉无差。**用户决策：「低模要有低模的样式，100 面以内，以后所有低模都按这个来」**。实现：① `modelLod.js` 低模生成改目标面数迭代——pass1 用 `min(0.01, 100/源面数)` 定向比例，仍 >100 面则对输出最多 4 轮 `-sa` 级联（进度 <5% 触底停），`LOW_TARGET_FACES=100/LOW_MAX_PASSES=4`，新上传自动套用；② **新建** `scripts/lod_regen_low_100faces.js` 全量重生成 118 组（旧低模备份至 `_backup_low_100faces_before/` 47.6MB，失败自动回滚）。实测：**118/118 成功**，低模总面数 170.1 万→8.05 万（**-95%**），43/118 达成 ≤100 面，其余触工具下限 150~550 面（gltfpack 简化器锁定网格边界顶点/UV 缝所致，`-kn`、去 `-kn`、更小比例、多轮级联均无法再降——8k 源 28 面的红军记录源于其拓扑已被两轮减面焊接）；教室：女生 15 万→152~176 面、课桌→270~402、男生系→253~339、讲台→84、鲁迅/小钟→263~360。视觉验证：浏览器实渲染剪影可读、块面感明确（游戏内借高模贴图）。验收回归：stage7 11/11 + stage7b 15/15 + stage6 22/22。**注意**：.glb 走 30 天 immutable 缓存，老玩家需强刷一次才能拿到新低模 | ✅（2026-09-13） |

---

状态图例：⬜ 未开始 / 🟡 进行中 / ✅ 已完成 / ⚠️ 有遗留

### 8.1 部署包同步清单（`ubuntu-deploy-package`，在本工作区外，需用户外部执行）

> 阶段 1~5 已全部完成，可一次性同步。
> ⚠️ **不要把 `public/models/uploaded/` 下的 `_mid.glb` / `_lod.glb` 打包进部署包**（合计约 1.28GB）：
> 部署到新环境后执行 `node scripts/lod_convert_all.js` 现场生成（实测 118 条目 / 36.7s）。
> 二期 A 起生成时自动剥离变体贴图（`glbTextureStripper`），变体磁盘增量从 +1197MB 降至约 +150MB。

| 类别 | 文件 | 来自阶段 |
|---|---|---|
| 后端 | `src/services/modelDecimate.js` | 1（exports 补 `runPack`） |
| 后端 | `src/services/modelLod.js`（**新增**） | 1 + 5（生成源收敛 / `LOW_BENEFIT_MARGIN=1` / `_lod.skip.json` / DB 路径修正 / 按变体基准名归并） |
| 后端 | `src/routes/uploadedModels.js` | 2（单个 + 批量两个端点各 1 处挂钩） |
| 后端 | `src/routes/config.js` | 2（`lod_enabled` 读写 + 公开 `GET /lod-enabled`） |
| 后端 | `src/routes/modelLod.js`（**新增**） | 3（`GET /status`、`POST /generate`） |
| 后端 | `src/services/glbTextureStripper.js`（**新增**） | 二期 A（变体贴图剥离，生成时自动调用） |
| 前端 | `public/index.html` | 4（引入 `worldLodAssets.js` + `worldInstanceMerger_v2.js`）；二期 B/C/D（分带常量与轮询，v4/v5/v6）；三期（merger `?v=7` + 新引 `worldLodStandalone.js?v=1`） |
| 后端 | `src/server.js` | 3（挂载 `/api/admin/model-lod`） |
| 前端 | `public/js/worldLodAssets.js`（**新增**） | 4 |
| 前端 | `public/js/worldInstanceMerger_v2.js` | 4（三带写入 / 远界动态 / 变体生命周期）；二期 A（变体借高模材质 / `__sharedMat`）；三期（`isMergedUrl` 导出，v7） |
| 前端 | `public/js/worldLodStandalone.js`（**新增**） | 三期（散装模型 LOD 分带渲染旁路模块；会话 3 机动：变体失败冷却重试） |
| 前端 | `public/js/worldObjectBounds.js` | 三期会话 3 机动（脏盒自愈：锚点一致性抽检 + 30s TTL 周期重算 + debugBox 诊断口） |
| 后端 | `src/services/modelLod.js` | 会话 3 机动 2（低模样式标准：`LOW_TARGET_FACES=100` 目标面数迭代生成，`LOW_MAX_PASSES=4`） |
| 脚本 | `scripts/lod_regen_low_100faces.js`（**新增**） | 会话 3 机动 2（全量重生成低模至 100 面标准，失败回滚；存量重跑幂等） |
| 前端 | `public/js/adminModelLod.js`（**新增**） | 3 |
| 前端 | `public/admin.html` | 3（卡片标记 + 脚本引用 + `loadWorldSettings` 末尾钩子） |
| 运维脚本（可选） | `scripts/lod_convert_all.js`（**新增**）、`scripts/lod_strip_variant_textures.js`（**新增**，二期 A 存量剥离）、`scripts/lod_generate_merged_groups.js`、`scripts/lod_backfill_low_variants.js`（二期 D）、`scripts/lod_regen_low_aggressive.js`（二期 E）、`scripts/accept_lod_stage1..7*.js` | 1~5 + 二期 A/D/E + 三期 |
| 数据 | `system_config.lod_enabled`（默认 `'true'`，缺省视为开启） | 2 |
| ❌ 不同步 | `public/models/uploaded/*_mid.glb`、`*_lod.glb`、`*_lod.skip.json` | — |

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
| `public/js/worldInstanceMerger_v2.js` | 常量区 36~40 行（`MERGE_THRESHOLD`/`MAX_RENDER_DIST=200`）；`mergeGroup` 在 135 行（LOD 初始化插入点）；`runCull` 在 393 行（三带改造点）；`syncFarBoxes` 在 335 行（蓝方块阈值改造点）；`unmergeGroup` 在 202 行（geometry dispose 补充点）。**远界语义（阶段 5 实测，最易踩）**：`rec.farLimit = (lodOn && lowReady) ? 400 : 200`（571 行）——**低模文件缺失会让整组远界回落 200m，200~400m 直接由蓝方块表示（不是回退中模）**；0~200m 内才按「中模缺失→高模兜底」（583~587 行）。变体由 `worldLodAssets` HEAD 探测，未命中静默回退 |
| 渲染器现状 | 阴影全局关闭、像素比锁 1、MSAA 开启（`antialias:true`）、`logarithmicDepthBuffer:true`、`sortObjects:false`；合批组按 `im.count` 做距离裁剪；>200m 用共享蓝色 InstancedMesh 占位（1 draw call） |
| 红军资产 | 26 个模型的减面版为 `public/models/uploaded/model-178712*_dec.glb`（33 个 `_dec.glb` 文件在目录中） |
