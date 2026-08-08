/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
const axios = require('axios');
const configService = require('./configService');

/**
 * Tripo AI 3D生成服务
 * 官方文档: https://platform.tripo3d.ai/docs
 */
class TripoService {
  constructor() {
    this.apiKey = null;
    this.baseUrl = 'https://api.tripo3d.ai/v2/openapi';
  }

  /**
   * 初始化API密钥
   */
  async initApiKey() {
    if (!this.apiKey) {
      this.apiKey = await configService.getConfig('TRIPO_API_KEY');
      if (!this.apiKey) {
        throw new Error('未配置 Tripo API Key，请在后台系统配置中设置');
      }
    }
  }

  /**
   * 图片转3D模型
   * @param {string} imageUrl - 图片的base64数据URL或HTTP URL
   * @param {object} options - 生成选项
   */
  async imageToModel(imageUrl, options = {}) {
    await this.initApiKey();

    try {
      console.log('🎨 Tripo: 开始图片转3D模型...');

      // 调用Tripo图片转3D API
      const response = await axios.post(
        `${this.baseUrl}/task`,
        {
          type: 'image_to_model',
          file: {
            type: 'url',
            url: imageUrl
          },
          mode: options.mode || 'preview', // preview 或 refine
          model_version: options.modelVersion || 'v2.0-20240919'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: 30000
        }
      );

      const data = response.data;

      if (data.code === 0 && data.data?.task_id) {
        console.log('✅ Tripo任务创建成功:', data.data.task_id);
        return {
          success: true,
          taskId: data.data.task_id,
          status: 'processing',
          message: '任务已创建，正在处理中'
        };
      } else {
        console.error('❌ Tripo任务创建失败:', data);
        return {
          success: false,
          error: data.message || '创建任务失败'
        };
      }

    } catch (error) {
      console.error('❌ Tripo API调用失败:', error.message);
      if (error.response) {
        console.error('错误详情:', error.response.data);
      }
      return {
        success: false,
        error: `API调用失败: ${error.message}`
      };
    }
  }

  /**
   * 查询任务状态
   * @param {string} taskId - 任务ID
   */
  async queryTaskStatus(taskId) {
    await this.initApiKey();

    try {
      console.log(`🔍 Tripo: 查询任务状态 ${taskId}`);

      const response = await axios.get(
        `${this.baseUrl}/task/${taskId}`,
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: 10000
        }
      );

      const data = response.data;

      if (data.code === 0 && data.data) {
        const task = data.data;
        
        // Tripo状态映射: queued, running, success, failed, cancelled
        const statusMap = {
          'queued': 'processing',
          'running': 'processing',
          'success': 'completed',
          'failed': 'failed',
          'cancelled': 'failed'
        };

        const mappedStatus = statusMap[task.status] || task.status;

        console.log(`📊 Tripo任务状态: ${task.status} -> ${mappedStatus}`);

        const result = {
          success: true,
          taskId: taskId,
          status: mappedStatus,
          originalStatus: task.status,
          progress: task.progress || 0
        };

        // 如果任务完成，返回模型下载链接
        if (task.status === 'success' && task.output) {
          result.modelUrl = task.output.model;
          result.renderedImage = task.output.rendered_image;
          result.pbr_model = task.output.pbr_model;
          console.log('✅ Tripo模型生成完成:', result.modelUrl);
        }

        // 如果任务失败，返回错误信息
        if (task.status === 'failed') {
          result.error = task.error || '任务执行失败';
        }

        return result;

      } else {
        return {
          success: false,
          error: data.message || '查询任务状态失败'
        };
      }

    } catch (error) {
      console.error('❌ Tripo查询任务失败:', error.message);
      return {
        success: false,
        error: `查询失败: ${error.message}`
      };
    }
  }

  /**
   * 下载模型文件
   * @param {string} modelUrl - 模型下载URL
   * @param {string} savePath - 保存路径
   */
  async downloadModel(modelUrl, savePath) {
    try {
      console.log('📥 Tripo: 下载模型文件...');
      console.log('  URL:', modelUrl);
      console.log('  保存到:', savePath);

      const response = await axios.get(modelUrl, {
        responseType: 'arraybuffer',
        timeout: 60000
      });

      const fs = require('fs').promises;
      await fs.writeFile(savePath, response.data);

      console.log('✅ Tripo模型下载完成');
      return { success: true };

    } catch (error) {
      console.error('❌ Tripo下载模型失败:', error.message);
      return {
        success: false,
        error: `下载失败: ${error.message}`
      };
    }
  }

  /**
   * 文本转3D模型
   * @param {string} prompt - 文本描述
   * @param {object} options - 生成选项
   */
  async textToModel(prompt, options = {}) {
    await this.initApiKey();

    try {
      console.log('📝 Tripo: 文本转3D模型...');
      console.log('  提示词:', prompt);

      const response = await axios.post(
        `${this.baseUrl}/task`,
        {
          type: 'text_to_model',
          prompt: prompt,
          mode: options.mode || 'preview',
          model_version: options.modelVersion || 'v2.0-20240919'
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          timeout: 30000
        }
      );

      const data = response.data;

      if (data.code === 0 && data.data?.task_id) {
        console.log('✅ Tripo文本转模型任务创建成功:', data.data.task_id);
        return {
          success: true,
          taskId: data.data.task_id,
          status: 'processing',
          message: '任务已创建'
        };
      } else {
        return {
          success: false,
          error: data.message || '创建任务失败'
        };
      }

    } catch (error) {
      console.error('❌ Tripo文本转模型失败:', error.message);
      return {
        success: false,
        error: `API调用失败: ${error.message}`
      };
    }
  }
}

module.exports = new TripoService();
