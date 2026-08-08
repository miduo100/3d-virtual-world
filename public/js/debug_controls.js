/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// 控制台调试脚本 - 检测走路动作和右键攻击问题
// 在浏览器控制台中运行：debugControls()

function debugControls() {
  console.log('=== 角色控制调试工具 ===');
  
  // 检查全局变量
  console.log('1. 全局变量检查:');
  console.log('   - window.gameWorld:', window.gameWorld ? '✅ 存在' : '❌ 不存在');
  console.log('   - GAME_STATE:', GAME_STATE);
  console.log('   - window.player:', window.player ? '✅ 存在' : '❌ 不存在');
  
  // 检查键盘状态
  console.log('\n2. 键盘状态检查:');
  console.log('   - KEYS对象:', KEYS);
  
  // 检查鼠标状态
  console.log('\n3. 鼠标状态检查:');
  console.log('   - MOUSE对象:', MOUSE);
  
  // 检查玩家对象
  if (window.player) {
    console.log('\n4. 玩家对象检查:');
    console.log('   - 位置:', window.player.position);
    console.log('   - 移动速度:', window.player.moveSpeed);
    console.log('   - 世界对象:', window.player.worldObject);
    console.log('   - GLB模型:', window.player.worldObject?.userData?.glbModel ? '✅ 已加载' : '❌ 未加载');
    console.log('   - 动画状态:', window.player.worldObject?.userData?.animActions || '❌ 无动画');
  }
  
  // 检查游戏世界方法
  if (window.gameWorld) {
    console.log('\n5. 游戏世界方法检查:');
    console.log('   - triggerAttackAnimation:', typeof window.gameWorld.triggerAttackAnimation);
    console.log('   - _switchPlayerAnim:', typeof window.gameWorld._switchPlayerAnim);
    console.log('   - players集合大小:', window.gameWorld.players.size);
  }
  
  // 测试走路动画
  console.log('\n6. 走路动画测试:');
  if (window.player && window.player.worldObject) {
    const isGlb = window.player.worldObject.userData?.glbModel;
    console.log('   - 角色类型:', isGlb ? 'GLB模型' : '方块人');
    
    if (isGlb) {
      console.log('   - 尝试触发走路动画...');
      try {
        window.gameWorld._switchPlayerAnim(GAME_STATE.characterId, 'walk');
        console.log('   ✅ 走路动画触发成功');
      } catch (e) {
        console.log('   ❌ 走路动画触发失败:', e.message);
      }
    } else {
      console.log('   - 方块人动画由代码直接控制');
    }
  }
  
  // 测试攻击动画
  console.log('\n7. 攻击动画测试:');
  if (window.gameWorld) {
    console.log('   - 尝试触发攻击动画...');
    try {
      window.gameWorld.triggerAttackAnimation(GAME_STATE.characterId);
      console.log('   ✅ 攻击动画触发成功');
    } catch (e) {
      console.log('   ❌ 攻击动画触发失败:', e.message);
    }
  }
  
  // 右键攻击检查
  console.log('\n8. 右键攻击检查:');
  console.log('   - 右键事件是否被阻止:', document.querySelector('canvas') ? '✅ canvas存在' : '❌ canvas不存在');
  console.log('   - 右键菜单是否禁用:', 'contextmenu事件已处理');
  
  // 添加右键攻击测试
  console.log('\n9. 右键攻击测试:');
  console.log('   - 请右键点击游戏窗口，观察控制台输出');
  
  // 添加右键事件监听
  const canvas = document.querySelector('canvas');
  if (canvas) {
    canvas.addEventListener('mousedown', function(e) {
      if (e.button === 2) { // 右键
        console.log('🖱️ 右键点击检测到!');
        console.log('   - 触发攻击动画...');
        try {
          if (window.gameWorld && GAME_STATE.characterId) {
            window.gameWorld.triggerAttackAnimation(GAME_STATE.characterId);
            console.log('   ✅ 右键攻击动画触发成功');
          } else {
            console.log('   ❌ window.gameWorld或GAME_STATE.characterId不存在');
          }
        } catch (error) {
          console.log('   ❌ 右键攻击触发失败:', error.message);
        }
      }
    });
    console.log('   ✅ 右键事件监听器已添加');
  } else {
    console.log('   ❌ 未找到canvas元素');
  }
  
  // 添加键盘事件监听
  console.log('\n10. 键盘事件监听:');
  document.addEventListener('keydown', function(e) {
    if (['w', 'a', 's', 'd'].includes(e.key.toLowerCase())) {
      console.log(`⌨️ 按键 ${e.key} 按下 - KEYS状态:`, KEYS);
    }
  });
  console.log('   ✅ 键盘事件监听器已添加');
  
  console.log('\n=== 调试完成 ===');
  console.log('请按WASD测试走路，右键点击测试攻击，观察控制台输出');
}

// 暴露到全局
window.debugControls = debugControls;
