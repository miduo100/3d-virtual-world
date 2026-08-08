/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 */
// UI Management
class UI {
  static updateHealthBar(current, max) {
    const percentage = (current / max) * 100;
    const fillElement = document.getElementById('healthFill');
    fillElement.style.width = percentage + '%';

    // Color gradient based on health
    if (percentage > 60) {
      fillElement.style.background = 'linear-gradient(90deg, #00ff00, #ffff00)';
    } else if (percentage > 30) {
      fillElement.style.background = 'linear-gradient(90deg, #ffff00, #ff6600)';
    } else {
      fillElement.style.background = 'linear-gradient(90deg, #ff0000, #ff6600)';
    }
  }

  static showVoiceIndicator(show) {
    const indicator = document.getElementById('voiceIndicator');
    if (show) {
      indicator.classList.add('active');
    } else {
      indicator.classList.remove('active');
    }
  }

  static addChatMessage(sender, message) {
    const chatBox = document.getElementById('chatBox');
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';

    const timestamp = new Date().toLocaleTimeString();
    messageEl.textContent = `[${timestamp}] ${sender}: ${message}`;

    chatBox.appendChild(messageEl);
    chatBox.scrollTop = chatBox.scrollHeight;

    // Remove old messages if too many
    while (chatBox.children.length > 50) {
      chatBox.removeChild(chatBox.firstChild);
    }
  }

  static hideLoadingScreen() {
    const loadingScreen = document.getElementById('loadingScreen');
    loadingScreen.style.display = 'none';
  }

  static hideControlsHint() {
    const controlsHint = document.getElementById('controls-hint');
    if (controlsHint) {
      controlsHint.style.display = 'none';
    }
  }

  static showNotification(title, message, duration = 3000) {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 100px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.9);
      color: #00ff00;
      padding: 15px 30px;
      border: 2px solid #00ff00;
      font-family: 'Courier New', monospace;
      border-radius: 5px;
      z-index: 999;
    `;

    notification.innerHTML = `
      <div style="font-weight: bold;">${title}</div>
      <div style="font-size: 14px;">${message}</div>
    `;

    document.body.appendChild(notification);

    setTimeout(() => {
      notification.remove();
    }, duration);
  }

  static updateMinimap(playerPosition, monsters, shops) {
    const canvas = document.getElementById('minimap');
    if (!canvas) return; // 如果minimap元素不存在，直接返回
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Clear
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = 0.1; // 10 pixels per world unit

    // Draw grid
    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= canvas.width; i += 20) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, canvas.height);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(canvas.width, i);
      ctx.stroke();
    }

    // Draw player
    const playerScreenX = canvas.width / 2 + playerPosition.x * scale;
    const playerScreenY = canvas.height / 2 - playerPosition.z * scale;

    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.arc(playerScreenX, playerScreenY, 5, 0, Math.PI * 2);
    ctx.fill();

    // Draw monsters
    ctx.fillStyle = '#ff0000';
    monsters.forEach((monster) => {
      const monsterScreenX = canvas.width / 2 + monster.position.x * scale;
      const monsterScreenY = canvas.height / 2 - monster.position.z * scale;

      ctx.beginPath();
      ctx.arc(monsterScreenX, monsterScreenY, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw shops
    ctx.fillStyle = '#ffaa00';
    shops.forEach((shop) => {
      const shopScreenX = canvas.width / 2 + shop.position.x * scale;
      const shopScreenY = canvas.height / 2 - shop.position.z * scale;

      ctx.fillRect(shopScreenX - 4, shopScreenY - 4, 8, 8);
    });
  }

  static showShopUI(shop) {
    const shopWindow = document.createElement('div');
    shopWindow.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: rgba(0, 0, 0, 0.95);
      color: #00ff00;
      padding: 20px;
      border: 3px solid #00ff00;
      border-radius: 5px;
      width: 400px;
      font-family: 'Courier New', monospace;
      z-index: 100;
    `;

    shopWindow.innerHTML = `
      <div style="font-weight: bold; font-size: 18px; margin-bottom: 10px;">
        商店: ${shop.shop_name}
      </div>
      <div id="shopItems" style="max-height: 300px; overflow-y: auto; margin-bottom: 10px;">
      </div>
      <button style="
        background: #00ff00;
        color: #000;
        border: none;
        padding: 8px 16px;
        cursor: pointer;
        font-weight: bold;
        width: 100%;
      ">关闭</button>
    `;

    document.body.appendChild(shopWindow);

    const itemsContainer = shopWindow.querySelector('#shopItems');
    shop.items.forEach((item) => {
      const itemEl = document.createElement('div');
      itemEl.style.cssText = `
        background: rgba(0, 100, 0, 0.3);
        padding: 10px;
        margin: 5px 0;
        border: 1px solid #00ff00;
        cursor: pointer;
      `;
      itemEl.innerHTML = `
        <div style="font-weight: bold;">${item.item_name}</div>
        <div style="font-size: 12px;">价格: ¥${item.price}</div>
        <div style="font-size: 12px;">库存: ${item.quantity}</div>
      `;

      itemEl.addEventListener('click', () => {
        this.addChatMessage('系统', `购买了 ${item.item_name}`);
      });

      itemsContainer.appendChild(itemEl);
    });

    shopWindow.querySelector('button').addEventListener('click', () => {
      shopWindow.remove();
    });
  }
}

// Export UI class to global scope
if (typeof window !== 'undefined') {
  window.UI = UI;
}
