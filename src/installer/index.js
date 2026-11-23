/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * index.js — 安装向导入口
 *
 * 用法（在 src/server.js 的最前面，dotenv 之后、JWT 校验之前）：
 *   const installer = require('./installer');
 *   if (!installer.isInstalled()) {
 *     installer.startInstaller({ port: process.env.PORT || 3002 });
 *     return;
 *   }
 *
 * 判定策略（重要）：
 *   只有「连 .env 都不存在」才算未安装。
 *   只要 .env 存在（无论有没有 INSTALLED=1），一律按已安装处理，
 *   避免升级到带安装向导的版本时，把正在运行的老环境误判成新装。
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const { createRouter } = require('./routes');

const ROOT = path.join(__dirname, '..', '..');
const ENV_PATH = path.join(ROOT, '.env');
const PAGE_PATH = path.join(__dirname, 'page.html');

/**
 * 是否已完成安装
 * @returns {boolean}
 */
function isInstalled() {
  if (!fs.existsSync(ENV_PATH)) return false;
  let txt = '';
  try {
    txt = fs.readFileSync(ENV_PATH, 'utf-8');
  } catch (_) {
    // 读不了就当已安装，宁可不让外人进安装页
    return true;
  }
  // 显式标记未安装（重装流程用：把 INSTALLED=1 改成 0）
  if (/^\s*INSTALLED\s*=\s*0\s*$/m.test(txt)) return false;
  return true;
}

/**
 * 启动安装模式
 * @param {object} opts
 * @param {number} opts.port      监听端口（与主程序一致，宝塔反代不用改）
 * @param {string} [opts.bind]    监听地址，默认 0.0.0.0
 * @returns {import('http').Server}
 */
function startInstaller(opts) {
  const port = Number(opts && opts.port) || 3002;
  const bind = (opts && opts.bind) || '0.0.0.0';

  let server = null;
  const ctx = {
    /**
     * 重启：先释放端口再退出，交给 pm2 / 宝塔 Node 管理器拉起新进程。
     * 必须先 close 再 exit——否则新进程抢不到同一个端口，会表现为"一直转圈"。
     */
    restart() {
      console.log('\n[安装向导] 配置已写入，正在重启服务…');
      const done = () => {
        console.log('[安装向导] 进程退出，由 pm2/宝塔拉起新实例');
        process.exit(0);
      };
      if (server) {
        server.close(done);
        // 兜底：5 秒内没关干净就强退，避免卡住
        setTimeout(done, 5000);
      } else {
        done();
      }
    }
  };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '300kb' }));

  // 安装页
  const sendPage = (req, res) => {
    if (!fs.existsSync(PAGE_PATH)) {
      return res.status(500).send('安装页面缺失：src/installer/page.html 不存在');
    }
    res.set('Cache-Control', 'no-store');
    res.sendFile(PAGE_PATH);
  };
  app.get('/install', sendPage);
  app.get('/install/', sendPage);

  // 公司 LOGO（安装页用，同时兼作 favicon）
  app.get('/install/logo.png', (req, res) => {
    const p = path.join(__dirname, 'logo.png');
    if (!fs.existsSync(p)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=86400');
    res.sendFile(p);
  });

  // 接口
  app.use('/api/install', createRouter(ctx));

  // 其余请求：页面跳安装页，接口明确报"未安装"
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(503).json({
        ok: false,
        error: 'NOT_INSTALLED',
        message: '世界尚未安装，请先访问 /install 完成安装'
      });
    }
    if (req.method === 'GET' && req.accepts('html')) {
      return res.redirect('/install');
    }
    res.status(503).type('text/plain').send('世界尚未安装，请访问 /install');
  });

  // 错误兜底（express 默认会输出 HTML 堆栈，这里统一成 JSON）
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error('[安装向导] 未捕获异常:', err && err.message);
    if (res.headersSent) return;
    res.status(500).json({ ok: false, error: (err && err.message) || '服务器内部错误' });
  });

  server = app.listen(port, bind, () => {
    const lines = [
      '',
      '============================================================',
      '  创世 Genesis · 尚未安装',
      '',
      `  请用浏览器打开：http://<本机地址>:${port}/install`,
      '',
      '  安装完成后本入口会自动关闭；',
      '  如需重装，把 .env 里的 INSTALLED=1 改成 INSTALLED=0 再重启。',
      '============================================================',
      ''
    ];
    console.log(lines.join('\n'));
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`\n[安装向导] 端口 ${port} 已被占用。`);
      console.error('  可能已有一个实例在运行，或宝塔里重复添加了项目。');
      console.error('  请先在宝塔 Node 项目里停掉旧实例，或在 .env 里换一个 PORT。\n');
    } else {
      console.error('[安装向导] 启动失败:', err && err.message);
    }
    process.exit(1);
  });

  return server;
}

module.exports = { isInstalled, startInstaller, ENV_PATH };
