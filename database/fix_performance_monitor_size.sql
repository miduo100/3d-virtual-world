-- 直接修复 performance_monitor 尺寸异常数据
-- 将任何超出合理范围的尺寸重置为默认值
-- 桌面端: 200×120, 移动端: 150×100

-- 先查看当前数据
SELECT control_id, width, height, mobile_width, mobile_height
FROM ui_controls 
WHERE control_id = 'performance_monitor';

-- 修复桌面端尺寸（正常范围：200~400 × 120~250）
UPDATE ui_controls
SET 
  width = CASE 
    WHEN width IS NULL THEN '200px'
    WHEN CAST(REGEXP_REPLACE(width, '[^0-9.]', '', 'g') AS NUMERIC) < 200 THEN '200px'
    WHEN CAST(REGEXP_REPLACE(width, '[^0-9.]', '', 'g') AS NUMERIC) > 400 THEN '200px'
    ELSE width
  END,
  height = CASE
    WHEN height IS NULL THEN '120px'
    WHEN CAST(REGEXP_REPLACE(height, '[^0-9.]', '', 'g') AS NUMERIC) < 120 THEN '120px'
    WHEN CAST(REGEXP_REPLACE(height, '[^0-9.]', '', 'g') AS NUMERIC) > 250 THEN '120px'
    ELSE height
  END,
  mobile_width = CASE
    WHEN mobile_width IS NULL THEN '150px'
    WHEN CAST(REGEXP_REPLACE(mobile_width, '[^0-9.]', '', 'g') AS NUMERIC) < 150 THEN '150px'
    WHEN CAST(REGEXP_REPLACE(mobile_width, '[^0-9.]', '', 'g') AS NUMERIC) > 300 THEN '150px'
    ELSE mobile_width
  END,
  mobile_height = CASE
    WHEN mobile_height IS NULL THEN '100px'
    WHEN CAST(REGEXP_REPLACE(mobile_height, '[^0-9.]', '', 'g') AS NUMERIC) < 100 THEN '100px'
    WHEN CAST(REGEXP_REPLACE(mobile_height, '[^0-9.]', '', 'g') AS NUMERIC) > 200 THEN '100px'
    ELSE mobile_height
  END,
  updated_at = NOW()
WHERE control_id = 'performance_monitor';

-- 验证修复后的数据
SELECT control_id, width, height, mobile_width, mobile_height
FROM ui_controls 
WHERE control_id = 'performance_monitor';
