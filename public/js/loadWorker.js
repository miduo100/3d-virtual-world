/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 加载Worker，处理模型解析和数据处理等耗时操作

// 监听来自主线程的消息
self.addEventListener('message', function(e) {
  const { type, data, messageId } = e.data;
  
  switch (type) {
    case 'loadModel':
      loadModel(data, messageId);
      break;
    case 'processWorldObjects':
      processWorldObjects(data, messageId);
      break;
    case 'calculateDistances':
      calculateDistances(data, messageId);
      break;
    default:
      console.log('Unknown message type:', type);
  }
});

// 加载模型
function loadModel({ modelPath, modelType }, messageId) {
  // 这里可以实现模型解析逻辑
  // 由于Worker中无法直接使用Three.js的加载器，我们可以返回模型路径和类型
  // 实际的模型加载仍然在主线程中进行，但数据处理可以在这里完成
  
  console.log('Worker: Loading model:', modelPath);
  
  // 模拟处理时间
  setTimeout(() => {
    self.postMessage({
      type: 'modelLoaded',
      data: {
        modelPath,
        modelType,
        status: 'success'
      },
      messageId: messageId
    });
  }, 100);
}

// 处理世界对象数据
function processWorldObjects(worldObjects, messageId) {
  console.log('Worker: Processing world objects:', worldObjects.length);
  
  // 处理世界对象数据，例如排序、过滤等
  const processedObjects = worldObjects.map(obj => {
    // 处理每个对象
    return {
      ...obj,
      processed: true
    };
  });
  
  // 模拟处理时间
  setTimeout(() => {
    self.postMessage({
      type: 'worldObjectsProcessed',
      data: processedObjects,
      messageId: messageId
    });
  }, 150);
}

// 计算距离
function calculateDistances({ playerPosition, objects }, messageId) {
  console.log('Worker: Calculating distances for', objects.length, 'objects');
  
  // 计算每个对象与玩家的距离
  const objectsWithDistance = objects.map(obj => {
    const objectPosition = {
      x: obj.position_x || 0,
      y: obj.position_y || 0,
      z: obj.position_z || 0
    };
    
    const distance = Math.sqrt(
      Math.pow(playerPosition.x - objectPosition.x, 2) +
      Math.pow(playerPosition.z - objectPosition.z, 2)
    );
    
    return {
      ...obj,
      distance
    };
  });
  
  // 按距离排序
  objectsWithDistance.sort((a, b) => a.distance - b.distance);
  
  // 模拟处理时间
  setTimeout(() => {
    self.postMessage({
      type: 'distancesCalculated',
      data: objectsWithDistance,
      messageId: messageId
    });
  }, 100);
}
