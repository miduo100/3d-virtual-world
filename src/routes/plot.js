/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { query } = require('../database/db');

// Get user plots
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await query(
      'SELECT * FROM plots WHERE owner_id = $1',
      [userId]
    );

    res.json({ plots: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch plots' });
  }
});

// Create plot
router.post('/create', async (req, res) => {
  try {
    const { ownerId, position, size } = req.body;

    const plotId = uuidv4();
    await query(
      `INSERT INTO plots (id, owner_id, position, size)
       VALUES ($1, $2, $3, $4)`,
      [plotId, ownerId, JSON.stringify(position), JSON.stringify(size || { width: 10, depth: 10 })]
    );

    res.json({ message: 'Plot created', plotId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create plot' });
  }
});

// Add building to plot
router.post('/:plotId/add-building', async (req, res) => {
  try {
    const { plotId } = req.params;
    const { buildingName, modelUrl, position, rotation, scale } = req.body;

    const buildingId = uuidv4();
    await query(
      `INSERT INTO buildings (id, plot_id, building_name, model_url, position, rotation, scale)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        buildingId,
        plotId,
        buildingName,
        modelUrl,
        JSON.stringify(position),
        JSON.stringify(rotation),
        JSON.stringify(scale || { x: 1, y: 1, z: 1 }),
      ]
    );

    res.json({ message: 'Building added', buildingId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add building' });
  }
});

// Get plot buildings
router.get('/:plotId/buildings', async (req, res) => {
  try {
    const { plotId } = req.params;

    const result = await query(
      'SELECT * FROM buildings WHERE plot_id = $1',
      [plotId]
    );

    res.json({ buildings: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch buildings' });
  }
});

// Add asset to building
router.post('/:buildingId/add-asset', async (req, res) => {
  try {
    const { buildingId } = req.params;
    const { assetName, modelUrl, position } = req.body;

    const buildingResult = await query(
      'SELECT assets FROM buildings WHERE id = $1',
      [buildingId]
    );

    if (buildingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Building not found' });
    }

    const assets = buildingResult.rows[0].assets || [];
    const newAsset = {
      id: uuidv4(),
      name: assetName,
      modelUrl,
      position,
    };

    assets.push(newAsset);

    await query(
      'UPDATE buildings SET assets = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [JSON.stringify(assets), buildingId]
    );

    res.json({ message: 'Asset added', asset: newAsset });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add asset' });
  }
});

module.exports = router;
