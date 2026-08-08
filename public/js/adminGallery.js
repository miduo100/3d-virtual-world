/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
/**
 * 画廊管理脚本 - 后台画廊管理页面功能
 * 从 admin_gallery.html 中提取，解决 innerHTML 注入不执行 script 的问题
 */

function galleryLog(msg) {
  const logEl = document.getElementById('gallery-log');
  const card = document.getElementById('gallery-log-card');
  if (!logEl || !card) return;
  card.style.display = 'block';
  const time = new Date().toLocaleTimeString();
  logEl.innerHTML += `<div>[${time}] ${msg}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
}

// 扫描文件夹
async function galleryScan() {
  const btn = document.getElementById('btn-scan');
  btn.disabled = true;
  btn.textContent = '扫描中...';
  galleryLog('开始扫描文件夹...');

  try {
    const res = await fetch('/api/gallery/scan', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      document.getElementById('stat-folders').textContent = data.folders.length;
      document.getElementById('stat-photos').textContent = data.totalPhotos;
      document.getElementById('stat-videos').textContent = data.totalVideos;
      document.getElementById('gallery-stats').style.display = 'grid';

      let html = '';
      for (const folder of data.folders) {
        html += `<div style="margin:4px 0;padding:6px;background:#f5f5f5;border-radius:4px;">
          📁 <b>${folder.name}</b>: ${folder.photoCount}张照片, ${folder.videoCount}个视频
        </div>`;
      }
      if (!data.folders.length) {
        html = '<p style="color:#999;">gallery_content 文件夹为空，请在 public/gallery_content/ 下创建子文件夹并放入照片</p>';
      }
      document.getElementById('scan-result-body').innerHTML = html;
      document.getElementById('scan-result').style.display = 'block';

      galleryLog(`扫描完成: ${data.folders.length}个文件夹, ${data.totalPhotos}张照片, ${data.totalVideos}个视频`);
    } else {
      galleryLog('扫描失败: ' + (data.error || '未知错误'));
      alert('扫描失败: ' + (data.error || '未知错误'));
    }
  } catch (err) {
    galleryLog('扫描出错: ' + err.message);
    alert('扫描出错: ' + err.message);
  }
  btn.disabled = false;
  btn.textContent = '🔍 扫描文件夹';
}

// 保存配置的当前ID
let currentConfigId = null;

// 保存配置
async function gallerySave() {
  const config = {
    name: document.getElementById('cfg-name').value,
    start_x: 193,   // 固定坐标：1931年9月18日 - 勿忘国耻
    start_y: 1,
    start_z: 918,
    matrix_width: parseFloat(document.getElementById('cfg-matrixWidth').value),
    buffer_rate: parseFloat(document.getElementById('cfg-bufferRate').value),
    row_spacing: parseFloat(document.getElementById('cfg-rowSpacing').value),
    col_spacing: parseFloat(document.getElementById('cfg-colSpacing').value),
    max_photo_width: parseFloat(document.getElementById('cfg-maxWidth').value),
    max_photo_height: parseFloat(document.getElementById('cfg-maxHeight').value),
    jitter: parseFloat(document.getElementById('cfg-jitter').value),
    folder_gap: parseFloat(document.getElementById('cfg-folderGap').value),
    is_active: false
  };

  galleryLog('保存配置中...');

  try {
    const url = currentConfigId
      ? `/api/gallery/configs/${currentConfigId}`
      : '/api/gallery/configs';
    const method = currentConfigId ? 'PUT' : 'POST';

    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
    const data = await res.json();

    if (data.success) {
      currentConfigId = data.config.id;
      galleryLog(`配置已保存 (ID: ${data.config.id})`);
      galleryLoadConfigs();
    } else {
      galleryLog('保存失败: ' + (data.error || '未知错误'));
    }
  } catch (err) {
    galleryLog('保存出错: ' + err.message);
  }
}

// 生成坐标
async function galleryGenerate() {
  if (!currentConfigId) {
    alert('请先保存配置！');
    return;
  }

  const btn = document.getElementById('btn-generate');
  btn.disabled = true;
  btn.textContent = '计算中...';
  galleryLog('开始计算坐标（可能需要一些时间，取决于照片数量）...');

  try {
    const res = await fetch('/api/gallery/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config_id: currentConfigId })
    });
    const data = await res.json();

    if (data.success && data.generated > 0) {
      document.getElementById('stat-photos').textContent = data.photos;
      document.getElementById('stat-videos').textContent = data.videos;
      document.getElementById('stat-status').textContent = '已生成';
      document.getElementById('stat-status').style.color = '#4caf50';
      galleryLog(`坐标计算完成: ${data.generated}个物品 (${data.photos}张照片, ${data.videos}个视频)`);
    } else if (data.generated === 0) {
      galleryLog('警告: ' + data.message);
      alert(data.message);
    } else {
      galleryLog('生成失败: ' + (data.error || '未知错误'));
    }
  } catch (err) {
    galleryLog('计算出错: ' + err.message);
    alert('计算出错: ' + err.message);
  }
  btn.disabled = false;
  btn.textContent = '🧮 计算坐标';
}

// 设为当前激活
async function galleryActivate() {
  if (!currentConfigId) {
    alert('请先保存配置！');
    return;
  }

  try {
    const res = await fetch(`/api/gallery/configs/${currentConfigId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: true })
    });
    const data = await res.json();

    if (data.success) {
      document.getElementById('stat-status').textContent = '已激活 ✅';
      document.getElementById('stat-status').style.color = '#4caf50';
      galleryLog('配置已设为当前激活！在虚拟世界中生效');
    } else {
      galleryLog('激活失败');
    }
  } catch (err) {
    galleryLog('激活出错: ' + err.message);
  }
}

// 加载配置列表
async function galleryLoadConfigs() {
  try {
    const res = await fetch('/api/gallery/configs');
    const data = await res.json();
    const select = document.getElementById('cfg-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- 新建配置 --</option>';

    if (data.success && data.configs) {
      for (const cfg of data.configs) {
        const active = cfg.is_active ? ' [已激活]' : '';
        select.innerHTML += `<option value="${cfg.id}">${cfg.name}${active} (${cfg.total_photos || 0}张)</option>`;
      }
    }
  } catch (err) {
    galleryLog('加载配置列表出错');
  }
}

// 加载指定配置
async function galleryLoadConfig(id) {
  if (!id) {
    currentConfigId = null;
    document.getElementById('cfg-name').value = '默认配置';
    return;
  }

  try {
    const res = await fetch('/api/gallery/configs');
    const data = await res.json();
    const cfg = (data.configs || []).find(c => c.id == id);
    if (!cfg) return;

    currentConfigId = cfg.id;
    document.getElementById('cfg-name').value = cfg.name;
    document.getElementById('cfg-matrixWidth').value = cfg.matrix_width;
    document.getElementById('cfg-matrixWidth-val').textContent = cfg.matrix_width;
    document.getElementById('cfg-bufferRate').value = cfg.buffer_rate;
    document.getElementById('cfg-bufferRate-val').textContent = (cfg.buffer_rate * 100).toFixed(0) + '%';
    document.getElementById('cfg-rowSpacing').value = cfg.row_spacing;
    document.getElementById('cfg-rowSpacing-val').textContent = cfg.row_spacing;
    document.getElementById('cfg-colSpacing').value = cfg.col_spacing;
    document.getElementById('cfg-colSpacing-val').textContent = cfg.col_spacing;
    document.getElementById('cfg-maxWidth').value = cfg.max_photo_width;
    document.getElementById('cfg-maxWidth-val').textContent = cfg.max_photo_width;
    document.getElementById('cfg-maxHeight').value = cfg.max_photo_height;
    document.getElementById('cfg-maxHeight-val').textContent = cfg.max_photo_height;
    document.getElementById('cfg-jitter').value = cfg.jitter;
    document.getElementById('cfg-jitter-val').textContent = cfg.jitter;
    document.getElementById('cfg-folderGap').value = cfg.folder_gap;
    document.getElementById('cfg-folderGap-val').textContent = cfg.folder_gap;

    document.getElementById('stat-photos').textContent = cfg.total_photos;
    document.getElementById('stat-videos').textContent = cfg.total_videos;
    document.getElementById('stat-status').textContent = cfg.is_active ? '已激活 ✅' : '未激活';
    document.getElementById('stat-status').style.color = cfg.is_active ? '#4caf50' : '#999';
    document.getElementById('gallery-stats').style.display = 'grid';

    galleryLog(`已加载配置: ${cfg.name}`);
  } catch (err) {
    galleryLog('加载配置出错');
  }
}

// 清理全部数据（换图片时使用）
async function galleryClearAll() {
  if (!confirm('确定要清理全部数据吗？\n\n将清空：\n- 所有照片/视频的坐标数据\n- 统计数据（照片数、视频数）\n- 激活状态\n\n配置参数会保留。')) {
    return;
  }

  const btn = event.target.closest('button');
  btn.disabled = true;
  btn.textContent = '清理中...';
  galleryLog('开始清理全部数据...');

  try {
    const res = await fetch('/api/gallery/clear-all', { method: 'POST' });
    const data = await res.json();

    if (data.success) {
      galleryLog('✅ 清理完成！');
      galleryLog('  删除坐标数据: ' + data.deletedItems + ' 条');
      galleryLog('  重置配置状态: ' + data.resetConfigs + ' 个');

      // 刷新页面显示
      document.getElementById('stat-folders').textContent = '-';
      document.getElementById('stat-photos').textContent = '-';
      document.getElementById('stat-videos').textContent = '-';
      document.getElementById('stat-status').textContent = '未激活';
      document.getElementById('stat-status').style.color = '#999';

      alert('清理完成！现在可以重新扫描文件夹。');
    } else {
      galleryLog('❌ 清理失败: ' + (data.error || '未知错误'));
      alert('清理失败: ' + (data.error || '未知错误'));
    }
  } catch (err) {
    galleryLog('❌ 清理出错: ' + err.message);
    alert('清理出错: ' + err.message);
  }

  btn.disabled = false;
  btn.textContent = '🗑️ 清理全部数据（换图片时使用）';
}

// 画廊页面初始化（由 loadGalleryPage 调用）
window.galleryInit = function() {
  galleryLoadConfigs();
  galleryLog('画廊管理页面已就绪');
};
