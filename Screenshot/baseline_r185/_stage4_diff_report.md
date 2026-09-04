# r185 阶段 4：光照颜色校准 —— 像素对比差异归因报告

> 生成时间：2026-09-04（阶段 4 会话）
> 对比对象：`Screenshot/baseline_r128/`（升级前）vs `Screenshot/baseline_r185/`（升级后，含阶段 1-3 全部修改）
> 工具：`scripts/compare_baseline_psnr.js`（PSNR + 差异像素比例 + 平均通道偏差）

## 一、量化结果

| 截图 | PSNR(dB) | 差异像素% | meanAbs | 归因 |
|---|---|---|---|---|
| admin_dashboard | 43.40 | 0.024% | 0.017 | UI 动态内容（无 3D），基本一致 ✓ |
| ai_motion_factory | 38.18 | 4.6% | 0.630 | 基础几何体无贴图，颜色变化小 ✓ |
| ai_scene_generator | 26.08 | 8.4% | 2.406 | 3D 视口小 + AI 列表动态差异 ✓ |
| animation_puppeteer | 24.02 | 32.1% | 7.913 | 3D 视口颜色正确化（偏粉→正确肤色） |
| character_editor | 17.99 | 53.1% | 20.9 | 3D 视口颜色正确化（偏粉→正常蓝） |
| unified_editor | 11.85 | 64.7% | 49.2 | 粉色草地→绿色草地（最大翻转源） |
| world_cam1_default | 12.93 | 63.1% | 41.6 | 全屏 3D 颜色正确化 |
| world_cam2_yaw | 11.95 | 59.8% | 46.9 | 同上 |
| world_cam3_yaw_pitch | 10.25 | 58.9% | 53.7 | 同上 |
| world_editor | 19.24 | 49.1% | 16.0 | 同上 |

## 二、核心结论：差异本质是「r152 颜色管理正确化」，不是功能回归

**r128（升级前）的渲染管线是错的**：
- `renderer.outputEncoding = THREE.sRGBEncoding`（手动开启 sRGB 输出）
- 但所有贴图（GLTF map / CanvasTexture / 颜色材质）默认 `LinearEncoding`，即 **sRGB 像素数据被当作线性数据**直接进入着色计算
- 输出时再做 linear→sRGB 编码 → 双重 gamma 拉伸 → **画面整体偏亮、偏粉、饱和度异常**

**r185（升级后）是正确管线**：
- `renderer.outputColorSpace = THREE.SRGBColorSpace` + `ColorManagement.enabled = true`（默认）
- 贴图按 sRGB→linear 正确解码，着色后 linear→sRGB 输出
- **颜色准确、画面略暗**（r128 的"亮"本来就是 gamma 错误的增益）

**视觉目检证据**（逐张对比）：
- 主世界：r128 角色头发粉红→r185 正确棕色；r128 草地亮黄绿→r185 正常绿；r128 天空偏粉蓝→r185 正常蓝
- unified_editor：r128 草地明显粉色→r185 正常绿色（G/B 通道翻转，65% 像素差异的最大来源）
- character_editor / animation_puppeteer：r128 角色皮肤偏粉、衣服偏品蓝→r185 正常肤色/正常蓝
- 所有页面 UI（HTML 部分）像素级一致，无布局/功能变化
- 世界 3 个机位构图、建筑位置、角色位置、传送门 UI 完全一致，主世界 0 console error

## 三、最终决策（用户确认，2026-09-04）

**选项 C：全部接受，不做任何改动。**

- (A) 接受颜色正确化——差异不构成回归，r128 时代存在全局 gamma 错误，升级顺带修复。
- (B) 18 处 CanvasTexture/VideoTexture 保持 NoColorSpace 不补 SRGBColorSpace（与 r128 行为等价，避免观感二次变化）。
- (C) PCFSoftShadowMap 保留不改 PCF（r181 弃用未移除，改 PCF 阴影更硬反而是视觉回归）；点光不 ×π 补偿，r185 物理光衰减属正确行为。

## 四、结论

阶段 4 的"校准"实质上已在阶段 1（outputColorSpace 修点）完成大半：**r185 当前状态 = 颜色管线正确**。
基线 PSNR 差异大不构成回归，反而证明 r128 时代存在全局 gamma 错误，升级顺带修复。
