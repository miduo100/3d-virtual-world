/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// ModelCacheDB.js - IndexedDB-based model caching system
class ModelCacheDB {
  constructor() {
    this.dbName = 'model-cache';
    this.dbVersion = 2; // 升级版本，清空旧缓存
    this.db = null;
    this.maxCacheSize = 500 * 1024 * 1024; // 500MB
  }

  /**
   * 初始化数据库连接
   */
  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);
      
      request.onerror = (event) => {
        console.error('Failed to open database:', event.target.error);
        reject('Failed to open database');
      };
      
      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('Model cache database opened successfully');
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // 创建模型文件存储
        if (!db.objectStoreNames.contains('model_files')) {
          const fileStore = db.createObjectStore('model_files', { keyPath: 'url' });
          console.log('Created model_files store');
        }
        
        // 创建模型元数据存储
        if (!db.objectStoreNames.contains('model_metadata')) {
          const metadataStore = db.createObjectStore('model_metadata', { keyPath: 'url' });
          metadataStore.createIndex('lastUsed', 'lastUsed');
          metadataStore.createIndex('storedAt', 'storedAt');
          console.log('Created model_metadata store');
        }
      };
    });
  }

  /**
   * 从缓存中获取模型
   * @param {string} url - 模型URL
   * @returns {Promise<ArrayBuffer|null>} 模型数据或null
   */
  async getModel(url) {
    if (!this.db) {
      try {
        await this.init();
      } catch (error) {
        console.warn('Failed to initialize database:', error);
        return null;
      }
    }
    
    return new Promise((resolve) => {
      const transaction = this.db.transaction(['model_files', 'model_metadata'], 'readonly');
      const fileStore = transaction.objectStore('model_files');
      const metadataStore = transaction.objectStore('model_metadata');
      
      const fileRequest = fileStore.get(url);
      
      fileRequest.onsuccess = () => {
        const modelFile = fileRequest.result;
        if (modelFile) {
          // 更新最后使用时间
          const updateTransaction = this.db.transaction(['model_metadata'], 'readwrite');
          const updateStore = updateTransaction.objectStore('model_metadata');
          
          const metadataRequest = metadataStore.get(url);
          metadataRequest.onsuccess = () => {
            const metadata = metadataRequest.result;
            if (metadata) {
              metadata.lastUsed = Date.now();
              updateStore.put(metadata);
            }
          };
          
          resolve(modelFile.data);
        } else {
          resolve(null);
        }
      };
      
      fileRequest.onerror = () => {
        console.warn('Error getting model from cache');
        resolve(null);
      };
    });
  }

  /**
   * 存储模型到缓存
   * @param {string} url - 模型URL
   * @param {ArrayBuffer} data - 模型数据
   * @param {Object} metadata - 模型元数据
   * @returns {Promise<void>}
   */
  async storeModel(url, data, metadata) {
    if (!this.db) {
      try {
        await this.init();
      } catch (error) {
        console.warn('Failed to initialize database:', error);
        return;
      }
    }
    
    return new Promise((resolve, reject) => {
      // 检查缓存大小
      this.checkCacheSize().then(async (currentSize) => {
        if (currentSize + data.byteLength > this.maxCacheSize) {
          await this.cleanupCache();
        }
        
        const transaction = this.db.transaction(['model_files', 'model_metadata'], 'readwrite');
        const fileStore = transaction.objectStore('model_files');
        const metadataStore = transaction.objectStore('model_metadata');
        
        fileStore.put({ url, data });
        metadataStore.put({ 
          url, 
          ...metadata, 
          lastUsed: Date.now(),
          storedAt: Date.now(),
          size: data.byteLength
        });
        
        transaction.oncomplete = () => {
          console.log('Model stored in cache:', url);
          resolve();
        };
        
        transaction.onerror = (event) => {
          console.error('Failed to store model:', event.target.error);
          reject('Failed to store model');
        };
      }).catch(error => {
        console.warn('Error checking cache size:', error);
        reject('Failed to store model');
      });
    });
  }

  /**
   * 检查缓存大小
   * @returns {Promise<number>} 当前缓存大小（字节）
   */
  async checkCacheSize() {
    if (!this.db) {
      try {
        await this.init();
      } catch (error) {
        return 0;
      }
    }
    
    return new Promise((resolve) => {
      const transaction = this.db.transaction(['model_metadata'], 'readonly');
      const metadataStore = transaction.objectStore('model_metadata');
      const request = metadataStore.getAll();
      
      request.onsuccess = () => {
        const models = request.result;
        const totalSize = models.reduce((sum, model) => sum + (model.size || 0), 0);
        resolve(totalSize);
      };
      
      request.onerror = () => {
        resolve(0);
      };
    });
  }

  /**
   * 清理缓存，删除最久未使用的模型
   * @returns {Promise<void>}
   */
  async cleanupCache() {
    if (!this.db) {
      try {
        await this.init();
      } catch (error) {
        return;
      }
    }
    
    return new Promise((resolve) => {
      const transaction = this.db.transaction(['model_metadata'], 'readonly');
      const metadataStore = transaction.objectStore('model_metadata');
      const lastUsedIndex = metadataStore.index('lastUsed');
      const request = lastUsedIndex.openCursor(null, 'prev');
      
      const models = [];
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          models.push(cursor.value);
          cursor.continue();
        } else {
          // 删除最久未使用的模型，直到缓存大小降到80%
          const targetSize = this.maxCacheSize * 0.8;
          let currentSize = models.reduce((sum, model) => sum + (model.size || 0), 0);
          
          if (currentSize > targetSize) {
            const deleteTransaction = this.db.transaction(['model_files', 'model_metadata'], 'readwrite');
            const fileStore = deleteTransaction.objectStore('model_files');
            const metadataStore = deleteTransaction.objectStore('model_metadata');
            
            let deletedSize = 0;
            for (let i = models.length - 1; i >= 0; i--) {
              const model = models[i];
              fileStore.delete(model.url);
              metadataStore.delete(model.url);
              deletedSize += model.size || 0;
              
              if (currentSize - deletedSize <= targetSize) {
                break;
              }
            }
            
            deleteTransaction.oncomplete = () => {
              console.log('Cache cleanup completed');
              resolve();
            };
          } else {
            resolve();
          }
        }
      };
      
      request.onerror = () => {
        resolve();
      };
    });
  }

  /**
   * 清除所有缓存
   * @returns {Promise<void>}
   */
  async clearCache() {
    if (!this.db) {
      try {
        await this.init();
      } catch (error) {
        return;
      }
    }
    
    return new Promise((resolve) => {
      const transaction = this.db.transaction(['model_files', 'model_metadata'], 'readwrite');
      const fileStore = transaction.objectStore('model_files');
      const metadataStore = transaction.objectStore('model_metadata');
      
      fileStore.clear();
      metadataStore.clear();
      
      transaction.oncomplete = () => {
        console.log('Cache cleared');
        resolve();
      };
      
      transaction.onerror = () => {
        resolve();
      };
    });
  }

  /**
   * 获取缓存状态
   * @returns {Promise<Object>} 缓存状态
   */
  async getCacheStatus() {
    if (!this.db) {
      try {
        await this.init();
      } catch (error) {
        return {
          size: 0,
          count: 0,
          maxSize: this.maxCacheSize
        };
      }
    }
    
    return new Promise((resolve) => {
      const transaction = this.db.transaction(['model_metadata'], 'readonly');
      const metadataStore = transaction.objectStore('model_metadata');
      const request = metadataStore.getAll();
      
      request.onsuccess = () => {
        const models = request.result;
        const totalSize = models.reduce((sum, model) => sum + (model.size || 0), 0);
        
        resolve({
          size: totalSize,
          count: models.length,
          maxSize: this.maxCacheSize
        });
      };
      
      request.onerror = () => {
        resolve({
          size: 0,
          count: 0,
          maxSize: this.maxCacheSize
        });
      };
    });
  }
}

// 导出单例实例
const modelCacheDB = new ModelCacheDB();

// 兼容不同环境
if (typeof window !== 'undefined') {
  window.modelCacheDB = modelCacheDB;
} else if (typeof global !== 'undefined') {
  global.modelCacheDB = modelCacheDB;
}