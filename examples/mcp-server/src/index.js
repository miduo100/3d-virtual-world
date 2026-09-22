#!/usr/bin/env node
/**
 * index.js — virtual-world-mcp 入口（MCP stdio transport）
 *
 * 让你的 AI 走进一个真实的 3D 多人世界：与真人玩家实时共处，无需浏览器、无需 3D 引擎。
 *
 * 一行配置（Claude Desktop / Cursor / Cline 等任意 stdio MCP 宿主）：
 *   {
 *     "mcpServers": {
 *       "virtual-world": {
 *         "command": "npx",
 *         "args": ["-y", "virtual-world-mcp"],
 *         "env": { "AGENT_HOST": "https://你的世界域名" }
 *       }
 *     }
 *   }
 *
 * 本地开发（未发布 npm 时）：
 *   {
 *     "command": "node",
 *     "args": ["L:/shegnjir185/examples/mcp-server/src/index.js"],
 *     "env": { "AGENT_HOST": "http://localhost:3002" }
 *   }
 *
 * 环境变量：
 *   AGENT_HOST              世界域名（默认 http://localhost:3002）
 *   AGENT_API_KEY           可选：agk_live_...  —— 填了才是 Key 档（推流 / 200m 半径 / 自动续期）
 *   MCP_WS_RADIUS           可选：订阅推送的半径（默认 60，仅 Key 档有效）
 *   MCP_KEEPALIVE_SECONDS   可选：每 N 秒发一次 PING（默认 0 = 不发）
 *                           仅 Key 档有意义：服务端"活跃"信号里游客的 PING 不计入，
 *                           且游客票本来就 30 分钟到期不可续期。默认不发 = 让空闲会话
 *                           自然被服务端 5 分钟空闲超时清掉，不占世界名额。
 *
 * ⚠️ stdio 协议铁律：**stdout 只能出现 JSON-RPC 报文**。
 * 本进程所有日志一律走 console.error（stderr），否则会破坏协议、宿主直接报解析错误。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { WorldClient } from './worldClient.js';
import { registerTools } from './tools.js';
import { registerResources } from './resources.js';
import { registerPrompts } from './prompts.js';

const VERSION = '0.1.0';
const log = (...a) => console.error('[virtual-world-mcp]', ...a);

const client = new WorldClient({ log });
const server = new McpServer({ name: 'virtual-world', version: VERSION });

registerTools(server, client, { log });
registerResources(server, client, { log });
registerPrompts(server, client);

/** 启动时的"体检"：只读发现文档，失败绝不影响启动（MCP 宿主应当是永远能起来的） */
async function healthCheck() {
  try {
    const doc = await client.discover();
    const name = (doc.world && doc.world.name) || '?';
    if (doc.agentEnabled === false) {
      log(`⚠️ 世界「${name}」当前 agentEnabled=false（管理员未开放 AI 接入），进入会被拒。`);
    } else {
      log(`世界「${name}」可接入（agentEnabled=true）。`);
    }
    if (client.protocolMismatch) {
      log('⚠️ 发现文档广播的端点协议与 AGENT_HOST 不一致，已按 AGENT_HOST 的协议访问'
        + '（世界侧反向代理可能没透传 X-Forwarded-Proto）。');
    }
  } catch (e) {
    log(`启动体检未能读取发现文档（不影响启动）：${e.message}`);
  }
}

async function shutdown(signal) {
  log(`收到 ${signal}，正在离场并退出…`);
  try { await client.close(); } catch (e) { /* noop */ }
  try { await server.close(); } catch (e) { /* noop */ }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ready v${VERSION} | host=${client.host} | 档位=${client.apiKey ? 'Key（可推流）' : '游客（只填了 AGENT_HOST，拉模式）'}`
    + ` | 工具 8 个 / 资源 1 个 / 提示 2 个`);
  if (client.keepAliveSeconds > 0) {
    if (client.apiKey) {
      client.startKeepAlive(client.keepAliveSeconds);
      log(`保活已开启：每 ${client.keepAliveSeconds}s 一次 PING`);
    } else {
      log('MCP_KEEPALIVE_SECONDS 已设置，但当前是游客档：服务端不把游客 PING 计入活跃，保活无效（已忽略）。');
    }
  }
  healthCheck();   // 不 await：体检失败不能挡住启动
}

main().catch((e) => {
  log('FATAL 启动失败：' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
