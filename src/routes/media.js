/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');

// 图片上传存储配置
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../public/uploads/media/images');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'img-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 1 * 1024 * 1024, // 1MB 限制
    files: 20
  },
  fileFilter: (req, file, cb) => {
    const allowed = /jpg|jpeg|png|gif|webp|svg/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    const mimeOk = file.mimetype.startsWith('image/');
    if (extOk && mimeOk) {
      cb(null, true);
    } else {
      cb(new Error('只支持图片格式：JPG、PNG、GIF、WEBP、SVG'));
    }
  }
});

/**
 * POST /api/media/upload
 * 批量上传图片（≤1MB each）
 */
router.post('/upload', upload.array('images', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, error: '请选择图片文件' });
    }

    const results = req.files.map(file => ({
      success: true,
      id: path.basename(file.filename, path.extname(file.filename)),
      filename: file.filename,
      originalName: file.originalname,
      url: `/uploads/media/images/${file.filename}`,
      size: file.size,
      mimeType: file.mimetype
    }));

    console.log(`✅ 成功上传 ${results.length} 张图片`);

    res.json({
      success: true,
      message: `成功上传 ${results.length} 张图片`,
      images: results
    });
  } catch (error) {
    console.error('图片上传失败:', error);
    res.status(500).json({ success: false, error: error.message || '上传失败' });
  }
});

// multer 错误处理
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, error: '图片大小超过1MB限制' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ success: false, error: '最多同时上传20张图片' });
    }
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
  next();
});

/**
 * GET /api/media/images
 * 获取已上传的图片列表
 */
router.get('/images', async (req, res) => {
  try {
    const uploadDir = path.join(__dirname, '../../public/uploads/media/images');
    
    // 确保目录存在
    await fs.mkdir(uploadDir, { recursive: true });
    
    const files = await fs.readdir(uploadDir);
    const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f));
    
    const images = await Promise.all(imageFiles.map(async filename => {
      try {
        const stat = await fs.stat(path.join(uploadDir, filename));
        return {
          filename,
          url: `/uploads/media/images/${filename}`,
          size: stat.size,
          createdAt: stat.birthtime || stat.ctime
        };
      } catch {
        return null;
      }
    }));

    res.json({
      success: true,
      images: images.filter(Boolean).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });
  } catch (error) {
    console.error('获取图片列表失败:', error);
    res.status(500).json({ success: false, error: '获取列表失败' });
  }
});

/**
 * DELETE /api/media/images/:filename
 * 删除已上传的图片
 */
router.delete('/images/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    
    // 安全校验：只允许删除图片格式文件，防止路径穿越
    if (!/^img-[\w-]+\.(jpg|jpeg|png|gif|webp|svg)$/i.test(filename)) {
      return res.status(400).json({ success: false, error: '无效的文件名' });
    }

    const filePath = path.join(__dirname, '../../public/uploads/media/images', filename);
    
    await fs.unlink(filePath);
    
    res.json({ success: true, message: '图片已删除' });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ success: false, error: '文件不存在' });
    }
    console.error('删除图片失败:', error);
    res.status(500).json({ success: false, error: '删除失败' });
  }
});

// ==================== 视频上传管理 ====================

// 视频上传存储配置
const videoStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../public/uploads/media/videos');
    try {
      await fs.mkdir(uploadDir, { recursive: true });
      cb(null, uploadDir);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, 'video-' + uniqueSuffix + ext);
  }
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB 限制
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowed = /mp4|webm|ogg|mov|avi|mkv/;
    const extOk = allowed.test(path.extname(file.originalname).toLowerCase());
    if (extOk) {
      cb(null, true);
    } else {
      cb(new Error('只支持视频格式：MP4、WEBM、OGG、MOV、AVI、MKV'));
    }
  }
});

// 视频元数据JSON文件路径
const VIDEO_META_FILE = path.join(__dirname, '../../public/uploads/media/videos/meta.json');

// ========== 锁机制：防止并发写入导致数据丢失 ==========
let videoMetaLock = Promise.resolve(); // 锁队列，确保所有读写操作串行执行

// 原子化读写操作 - 防止并发覆盖
async function withVideoLock(fn) {
  videoMetaLock = videoMetaLock.then(() => fn());
  return videoMetaLock;
}

// 读取视频元数据
async function readVideoMeta() {
  return withVideoLock(async () => {
    try {
      const data = await fs.readFile(VIDEO_META_FILE, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  });
}

// 写入视频元数据
async function writeVideoMeta(meta) {
  return withVideoLock(async () => {
    await fs.writeFile(VIDEO_META_FILE, JSON.stringify(meta, null, 2), 'utf-8');
  });
}

// 格式化文件大小
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * POST /api/media/upload-video
 * 上传视频文件（≤100MB）
 */
router.post('/upload-video', uploadVideo.single('video'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请选择视频文件' });
    }

    const { name, tags } = req.body;
    
    // 读取现有元数据
    const metaList = await readVideoMeta();
    
    // 创建新记录
    const videoRecord = {
      id: 'vid_' + Date.now(),
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: `/uploads/media/videos/${req.file.filename}`,
      name: name || req.file.originalname.replace(/\.[^/.]+$/, ''),
      tags: tags || '',
      size: req.file.size,
      mimeType: req.file.mimetype,
      createdAt: new Date().toISOString()
    };
    
    metaList.push(videoRecord);
    await writeVideoMeta(metaList);

    console.log(`✅ 视频上传成功: ${videoRecord.name} (${formatFileSize(videoRecord.size)})`);

    res.json({
      success: true,
      message: `视频 "${videoRecord.name}" 上传成功`,
      video: videoRecord
    });
  } catch (error) {
    console.error('视频上传失败:', error);
    res.status(500).json({ success: false, error: error.message || '上传失败' });
  }
});

/**
 * GET /api/media/videos
 * 获取已上传的视频列表
 */
router.get('/videos', async (req, res) => {
  try {
    const uploadDir = path.join(__dirname, '../../public/uploads/media/videos');
    
    // 确保目录存在
    await fs.mkdir(uploadDir, { recursive: true });
    
    // 读取元数据
    const metaList = await readVideoMeta();
    
    // 获取实际存在的文件
    const existingFiles = new Set();
    try {
      const files = await fs.readdir(uploadDir);
      files.forEach(f => existingFiles.add(f));
    } catch {}
    
    // 过滤出存在的视频
    const validVideos = [];
    const videoExtensions = /\.(mp4|webm|ogg|mov|avi|mkv)$/i;
    
    for (const meta of metaList) {
      if (existingFiles.has(meta.filename)) {
        validVideos.push(meta);
        existingFiles.delete(meta.filename);
      }
    }
    
    // 添加没有元数据的视频文件
    for (const filename of existingFiles) {
      if (videoExtensions.test(filename)) {
        try {
          const stat = await fs.stat(path.join(uploadDir, filename));
          validVideos.push({
            id: 'vid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            filename,
            originalName: filename,
            url: `/uploads/media/videos/${filename}`,
            name: filename.replace(/^video-/, '').replace(/\.[^/.]+$/, ''),
            tags: '',
            size: stat.size,
            mimeType: 'video/' + filename.split('.').pop(),
            createdAt: stat.birthtime?.toISOString() || new Date().toISOString()
          });
        } catch {}
      }
    }

    res.json({
      success: true,
      videos: validVideos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    });
  } catch (error) {
    console.error('获取视频列表失败:', error);
    res.status(500).json({ success: false, error: '获取列表失败' });
  }
});

/**
 * GET /api/media/videos/scan
 * 扫描视频目录，返回未入库的视频文件
 */
router.get('/videos/scan', async (req, res) => {
  try {
    const uploadDir = path.join(__dirname, '../../public/uploads/media/videos');
    await fs.mkdir(uploadDir, { recursive: true });
    
    let files;
    try {
      files = await fs.readdir(uploadDir);
    } catch {
      files = [];
    }
    
    const videoExtensions = /\.(mp4|webm|ogg|mov|avi|mkv)$/i;
    
    // 获取已入库的视频
    const metaList = await readVideoMeta();
    const knownFilenames = new Set(metaList.map(v => v.filename));
    
    // 找出未入库的视频
    const newVideos = [];
    for (const filename of files) {
      if (videoExtensions.test(filename) && !knownFilenames.has(filename)) {
        try {
          const stat = await fs.stat(path.join(uploadDir, filename));
          newVideos.push({
            filename,
            originalName: filename.replace(/^video-/, '').replace(/\.[^/.]+$/, ''),
            url: `/uploads/media/videos/${filename}`,
            size: stat.size,
            mimeType: 'video/' + (filename.split('.').pop() || 'mp4'),
            modifiedAt: stat.mtime?.toISOString()
          });
        } catch {}
      }
    }

    res.json({
      success: true,
      newVideos: newVideos.sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt)),
      totalNew: newVideos.length,
      uploadPath: '/public/uploads/media/videos/'
    });
  } catch (error) {
    console.error('扫描视频目录失败:', error);
    res.status(500).json({ success: false, error: '扫描失败' });
  }
});

/**
 * POST /api/media/videos/register
 * 将目录中的视频注册入库（填写名称和标签）
 */
router.post('/videos/register', async (req, res) => {
  try {
    const { filename, name, tags } = req.body;
    
    if (!filename) {
      return res.status(400).json({ success: false, error: '缺少filename参数' });
    }

    // 安全校验
    if (!/^[\w\-.]+\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(filename)) {
      return res.status(400).json({ success: false, error: '无效的文件名' });
    }

    const filePath = path.join(__dirname, '../../public/uploads/media/videos', filename);
    
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({ success: false, error: '文件不存在' });
    }

    const stat = await fs.stat(filePath);

    const videoRecord = {
      id: 'vid_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      filename,
      originalName: filename.replace(/^video-/, '').replace(/\.[^/.]+$/, ''),
      url: `/uploads/media/videos/${filename}`,
      name: name || filename.replace(/^video-/, '').replace(/\.[^/.]+$/, ''),
      tags: tags || '',
      size: stat.size,
      mimeType: 'video/' + (filename.split('.').pop() || 'mp4'),
      createdAt: new Date().toISOString(),
      registeredAt: new Date().toISOString()
    };
    
    const metaList = await readVideoMeta();
    
    if (metaList.some(v => v.filename === filename)) {
      return res.status(400).json({ success: false, error: '该视频已在库中' });
    }
    
    metaList.push(videoRecord);
    await writeVideoMeta(metaList);

    console.log(`✅ 视频注册入库: ${videoRecord.name} (${formatFileSize(videoRecord.size)})`);

    res.json({
      success: true,
      message: `视频 "${videoRecord.name}" 已添加到视频库`,
      video: videoRecord
    });
  } catch (error) {
    console.error('视频注册失败:', error);
    res.status(500).json({ success: false, error: error.message || '注册失败' });
  }
});

/**
 * PUT /api/media/videos/:id
 * 更新视频信息（名称、标签）
 */
router.put('/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, tags } = req.body;
    
    const metaList = await readVideoMeta();
    const index = metaList.findIndex(v => v.id === id);
    
    if (index === -1) {
      return res.status(404).json({ success: false, error: '视频不存在' });
    }
    
    if (name !== undefined) metaList[index].name = name;
    if (tags !== undefined) metaList[index].tags = tags;
    
    await writeVideoMeta(metaList);
    
    res.json({ success: true, message: '视频信息已更新', video: metaList[index] });
  } catch (error) {
    console.error('更新视频信息失败:', error);
    res.status(500).json({ success: false, error: '更新失败' });
  }
});

/**
 * DELETE /api/media/videos/:id
 * 删除视频文件和元数据
 */
router.delete('/videos/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const metaList = await readVideoMeta();
    const index = metaList.findIndex(v => v.id === id);
    
    if (index === -1) {
      return res.status(404).json({ success: false, error: '视频不存在' });
    }
    
    const video = metaList[index];
    
    // 安全校验
    if (!/^video-[\w-]+\.(mp4|webm|ogg|mov|avi|mkv)$/i.test(video.filename)) {
      return res.status(400).json({ success: false, error: '无效的视频文件名' });
    }
    
    // 删除物理文件
    const filePath = path.join(__dirname, '../../public/uploads/media/videos', video.filename);
    try {
      await fs.unlink(filePath);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    
    // 从元数据中移除
    metaList.splice(index, 1);
    await writeVideoMeta(metaList);
    
    console.log(`🗑️ 视频已删除: ${video.name}`);
    
    res.json({ success: true, message: '视频已删除' });
  } catch (error) {
    console.error('删除视频失败:', error);
    res.status(500).json({ success: false, error: '删除失败' });
  }
});

// 视频上传错误处理
router.use((err, req, res, next) => {
  if (err.message && err.message.includes('只支持视频格式')) {
    return res.status(400).json({ success: false, error: err.message });
  }
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, error: '视频超过100MB限制，建议使用"大视频导入"功能' });
  }
  next(err);
});

module.exports = router;
