/**
 * uploadedModelMeta.js — 上传模型的 🤖 AI 描述端点（独立小模块）
 *
 * 为什么独立：uploadedModels.js 已 649 行（>500 行红线，禁止追加新功能代码），
 * 本模块只提供一个小端点，挂载在 /api（与 uploadedModelsRoutes 同前缀）。
 *
 * PUT /api/uploaded-models/:id/agent-description
 *   body: { agent_description: string|null }
 *   语义：复用 uploaded_models.description 列（历史闲置），标注为「给 AI 看」。
 *   AI 客户端经放置后的 world_objects.agent_description（observe 下发）读取。
 *   鉴权：与既有 PUT display-name / tags 同级（编辑器同源工具端点）。
 */
const express = require('express');
const router = express.Router();
const { pool } = require('../database/db');

const MAX_LEN = 500;

router.put('/uploaded-models/:id/agent-description', async (req, res) => {
  try {
    const { id } = req.params;
    const raw = req.body ? req.body.agent_description : undefined;
    if (raw === undefined) {
      return res.status(400).json({ success: false, error: '缺少 agent_description 字段' });
    }
    const value = raw === null ? null : String(raw).slice(0, MAX_LEN);

    const result = await pool.query(
      `UPDATE uploaded_models SET description = $1, updated_at = NOW()
       WHERE id = $2 RETURNING id, description`,
      [value, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '模型不存在' });
    }
    res.json({ success: true, id: result.rows[0].id, agent_description: result.rows[0].description });
  } catch (error) {
    console.error('[UploadMeta] AI 描述保存失败:', error);
    res.status(500).json({ success: false, error: '保存失败' });
  }
});

module.exports = router;
