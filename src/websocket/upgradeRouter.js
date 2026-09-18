/**
 * HTTP upgrade 请求路由器（P3 核心 · 红线 a：兜底分流）
 *
 * server.on('upgrade', upgradeRouter) 调用。
 * /ws/agent            → Agent WS（agentWsServer.handleUpgrade，需 Bearer token 鉴权）
 * 其余一切路径（含 /）→ 人类 WS（wsServer.getWss().handleUpgrade，兜底）
 *
 * 铁律（P0 审计 #5 + 第 9 节坑 1）：
 *   CONFIG.WS_URL 无路径，浏览器连根路径 ws://host/。
 *   任何"只允许 /ws 路径"的 upgrade 路由都会杀死全部现有浏览器客户端。
 *   兜底分流是铁律——除 /ws/agent 外全部走人类 WS。
 */

const url = require('url');

const AGENT_WS_PATH = '/ws/agent';

/**
 * upgrade 路由入口
 * @param {import('http').IncomingMessage} request
 * @param {import('net').Socket} socket
 * @param {Buffer} head
 */
function handleUpgrade(request, socket, head) {
  let pathname = '/';
  try {
    const parsed = url.parse(request.url);
    pathname = parsed.pathname || '/';
  } catch (e) {
    pathname = '/';
  }

  if (pathname === AGENT_WS_PATH) {
    try {
      const agentWs = require('./agentWsServer');
      agentWs.handleUpgrade(request, socket, head);
    } catch (err) {
      console.error('[upgradeRouter] agentWs 加载失败:', err.message);
      try { socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n'); } catch (e) {}
      socket.destroy();
    }
    return;
  }

  // 兜底：所有非 /ws/agent 路径 → 人类 WS（含根路径 /，浏览器 CONFIG.WS_URL 无路径）
  try {
    const wsServer = require('./wsServer');
    const wss = wsServer.getWss ? wsServer.getWss() : null;
    if (wss) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    } else {
      // 人类 WS 尚未初始化（启动早期），拒绝
      socket.destroy();
    }
  } catch (err) {
    console.error('[upgradeRouter] 人类 WS 路由失败:', err.message);
    socket.destroy();
  }
}

module.exports = handleUpgrade;
module.exports.AGENT_WS_PATH = AGENT_WS_PATH;
