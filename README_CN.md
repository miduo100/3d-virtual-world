# Virtual World — 3D 多人虚拟世界平台

> 🌐 [English](./README.md) | 简体中文

[![License](https://img.shields.io/badge/License-Subscription-blue.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-≥18-green.svg)](https://nodejs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-≥17-blue.svg)](https://www.postgresql.org)
[![Three.js](https://img.shields.io/badge/Three.js-0.183-black.svg)](https://threejs.org)
[![在线演示](https://img.shields.io/badge/在线演示-miduo100.com-orange.svg)](https://miduo100.com/)

![演示视频](./Screenshot/shipin.gif)

> 基于 Three.js + Express.js + PostgreSQL 构建的沉浸式 3D 多人虚拟世界系统。  
> 支持多世界联邦互联、角色定制、3D 建筑搭建和实时多人交互。  
> **VWFP v2.1 协议** | Copyright © 2026 济宁米多信息科技有限公司

---

## 目录

- [项目简介](#项目简介)
- [核心技术特点](#核心技术特点)
- [我为什么要做这个？](#我为什么要做这个)
- [核心特性](#核心特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [项目结构](#项目结构)
- [部署方式](#部署方式)
- [联邦系统](#联邦系统)
- [管理后台](#管理后台)
- [许可证与订阅](#许可证与订阅)
- [常见问题](#常见问题)
- [相关文档](#相关文档)

---

## 项目简介

**一个跑在浏览器里的 3D 虚拟世界——部署在你自己的机器上，数据完全归你。**

你把它装在自己的电脑或服务器上，打开浏览器就能进入一个完整的 3D 世界：可以拖拽搭建场景、自定义角色、邀请朋友进来一起逛。不同人部署的世界之间还能互相传送，身份和资产跨世界跟随。
它不是托管在某个平台上的云服务，而是**你自己的独立节点**。没有账号注册、没有内容审核、没有平台抽成，代码未加密，想怎么改就怎么改。

> **很抱歉让它在不完善的状态下与大家见面。**
> 这个产品做到这个程度已经消耗了我所能承受的范围。很抱歉让他在不完善的状态下与大家见面。因为我需要赚钱去了，然后继续再做这个项目。如果喜欢的人多订阅多，我将会快速的更新。即使喜欢的人少我也会持续更新，多了我会加快进度，少了我就慢点。一边生活一边筑梦吧！

## 核心技术特点

- **独立世界** —— 数据 100% 归自己，不论是电脑还是服务器，都可以部署本世界。这个世界就是你的私有资产，放到服务器或者 IPv6 的电脑上即可对外公开，通过域名或者 IP 让其他用户访问。
- **资产私有化** —— 虚拟资产只存在您的电脑或者服务器上。
- **跨世界获得** —— 在其他世界获得的物品会归属到当前用户注册使用的服务器上。
- **跨世界传送** —— 跨世界传送时用户当前配置的角色样式、骨骼、动画、声音、模型样式等，在目标世界依然生效，在其他人眼里也是你配置的样式。
- **极致性能** —— 模型上传自动两级压缩（gltfpack 几何压缩 + sharp 纹理重压缩），体积平均降低 70%+、显存节省最高 75%，配合智能优先级加载队列与分级进度反馈，低配机器也能流畅逛世界。

为了这个想法能更广阔的被使用，现在我公布防御性技术公开文档：[PATENT_DISCLOSURE.md](./PATENT_DISCLOSURE.md)

## 我为什么要做这个？

你是否察觉到，当下的互联网正身处层层束缚之中。AI之后程序不难编写，人人都具备开发软件的能力，可是否感觉处处束手束脚? 想详细看就看我的文章吧：

👉 [AI 让人人变成开发者，中心化牢笼再也压不住创造力——Web 2.0走到头了](./AI%20让人人变成开发者，中心化牢笼再也压不住创造力——Web%202.0走到头了.md)

### 适合谁用

| 用户群体 | 使用场景 |
|---------|---------|
| **个人** | 零成本拥有自己的 3D 虚拟空间存放图片视频和回忆等各种虚拟资产，如果能实现数字永生，这里可能会是你的…… |
| **中小企业** | 把店变成可逛可玩的 3D 虚拟旗舰店，停留时间提升 10 倍 |
| **大型企业** | 多地分公司联邦互联，数据安全自主可控 |
| **教育机构** | 把课本变成可以走进去的 3D 世界，完课率和兴趣度翻倍 |
| **景区/博物馆** | 永不闭馆、无限容量、全球可达的数字孪生景区 |
| **政府/公共组织** | 智慧城市的 3D 交互界面，市民看得见摸得着的数字政务 |
| **会展行业** | 零场地费的 365 天永不落幕的全球 virtual expo |
| **联邦多世界互联** | 多个独立部署的世界实例之间互联，玩家可跨世界旅行 |

### 截图预览

| 用户首页（3D 世界） | 管理后台仪表盘 |
|:---:|:---:|
| ![世界首页](./Screenshot/current_app.png.jpg) | ![管理后台](./Screenshot/dashboard.jpg) |
| **传送** | **传送按钮** |
| ![传送](./Screenshot/teleport.jpg) | ![传送按钮](./Screenshot/teleport_button.jpg) |
| **世界布置后台** | **世界信息** |
| ![世界布置后台](./Screenshot/world_layout.jpg) | ![世界信息](./Screenshot/world_info.jpg) |
| **手机版首页** | **手机版世界** |
| ![手机版首页](./Screenshot/mobile_home.jpg) | ![手机版世界](./Screenshot/mobile_world.jpg) |

---

## 核心特性

### 3D 场景与渲染
- **Three.js 驱动**：完整的 3D 场景渲染引擎，支持动态光照、阴影和天空盒
- **自由搭建建筑**：几何体建筑（立方体/球体/圆柱等）和 GLB/GLTF 模型上传
- **实时多人同步**：WebSocket 驱动的角色位置、动画和场景变更广播
- **移动端适配**：虚拟摇杆 + 触屏操作
- **自动模型压缩**：上传 GLB 自动执行两级压缩——gltfpack 几何压缩（meshopt）+ 纹理重压缩（法线/遮挡无损、颜色贴图量化降分辨率），大模型体积平均降低 70%~90%，显存占用最高减少 75%
- **智能加载调度**：优先级加载队列（几何体/媒体 → 小模型 → 大模型）、大模型并发控制、基于距离的分阶段加载与自动卸载，世界秒开不卡顿
- **加载进度可视化**：顶部进度条 + 场景内 3D 进度浮标（已下载/总字节数），配合模拟进度兜底，任何网络条件下都有清晰反馈

### 多世界联邦系统
- **世界互联**：多个服务器组成联邦网络，实现跨世界传送和访问
- **对等架构**：各世界平等互联，无需中央协调节点
- **安全握手**：基于 RSA-2048 公钥交换 + JWT 签名验证的世界间认证机制
- **VWFP v2.1 协议**：自研跨虚拟世界联邦协议

### 角色与动画
- **角色自定义**：支持 Mixamo、ReadyPlayerMe、VRoid 等多平台骨骼
- **动画系统**：动作库管理、骨骼重定向（Retargeting）、武器挂载点
- **实时换装**：切换角色模板和外观
- **跨世界角色迁移**：角色配置在联邦世界间安全传递

### 世界生态
- **NPC 系统**：自定义 NPC 创建、对话和行为配置
- **怪物系统**：战斗怪物创建与管理，掉落物品
- **传送门**：世界内部和跨世界传送
- **商城与背包**：完整的虚拟物品交易和库存管理
- **技能系统**：语音触发技能、效果、范围、冷却
- **画廊系统**：3D 画廊展示

### 编辑器套件
- **统一编辑器**：几何体 + 模型库，二合一
- **世界编辑器**：对象摆放/移动/旋转/缩放/出生点设置
- **角色编辑器**：外观定制（发型/面部/服装/装备）`待优化`
- **动画编辑器**：骨骼关键帧录制/时间轴播放 `待优化`
- **Three.js 代码块**：直接编写 Three.js 代码生成 3D 对象

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端 3D** | Three.js 0.183, WebGL |
| **前端 UI** | React 18（管理后台）, Vanilla JS（世界页）|
| **后端** | Express.js 4.18 (Node.js) |
| **数据库** | PostgreSQL ≥ 17 |
| **实时通信** | WebSocket (ws 8.14) |
| **认证** | JWT (用户 + 管理员双密钥) + bcryptjs 密码哈希 |
| **跨世界安全** | RSA-2048 非对称加密 + JWT RS256 签名 |
| **样式** | Tailwind CSS |
| **文件处理** | multer（上传）+ adm-zip（ZIP解压）+ gltfpack（几何压缩）+ sharp（纹理重压缩）|
| **构建工具** | Vite 5 + TypeScript |

---

## 快速开始

### 环境要求

| 软件 | 最低版本 | 推荐版本 |
|------|---------|---------|
| Node.js | 18.x | 20.x |
| PostgreSQL | 17 | 18.1 |
| 端口 | 3002（应用 + WebSocket 共用）| - |

> **完整部署流程**（环境配置 / .env 详解 / 数据库导入 / Nginx / PM2 / 联邦系统）请参阅独立部署文档：

| 文档 | 说明 |
|------|------|
| [程序部署说明](./程序部署说明.md) | 完整部署步骤（中文） |
| [数据库导入](./数据库导入.md) | 数据库创建与数据导入（中文） |
| [Deployment Guide](./Deployment_Guide.md) | Complete deployment guide (English) |
| [Database Import](./Database_Import.md) | Database setup guide (English) |

### 访问入口

| 入口 | 地址 |
|------|------|
| 用户首页（3D 世界） | `http://localhost:3002/` |
| 管理后台 | `http://localhost:3002/admin.html` |
| 管理员登录页 | `http://localhost:3002/admin_login.html` |
| 默认管理员账号 | `admin / admin123456`（**请立即修改！**） |

---

## 项目结构

```
├── src/                              # 后端源码
│   ├── server.js                     # 主入口
│   ├── server_simple.js              # 简化入口
│   ├── federationSystem.js           # 联邦系统核心
│   ├── centralWorldConnector.js      # 联邦连接器
│   ├── routes/                       # API 路由（35+ 模块）
│   │   ├── auth.js                   # 用户认证
│   │   ├── world.js                  # 世界场景管理
│   │   ├── federation.js             # 联邦通信
│   │   ├── portal.js                 # 传送门
│   │   ├── users.js                  # 用户管理
│   │   ├── shop.js / inventory.js    # 商城/背包
│   │   ├── npc.js / monster.js       # NPC/怪物
│   │   ├── aiSceneGenerator.js       # 场景生成
│   │   ├── aiProviders.js            # 服务商管理
│   │   ├── geometryBuilding.js       # 几何体建筑
│   │   ├── characterTemplates/       # 角色模板（12 文件）
│   │   └── ...                       # 更多模块
│   ├── services/                     # 业务逻辑层（14 文件）
│   ├── middleware/                   # 中间件（限流、权限等）
│   ├── websocket/                    # WebSocket 处理
│   ├── database/                     # 数据库连接与迁移
│   └── utils/                        # 工具函数
├── public/                           # 前端资源
│   ├── index.html                    # 3D 世界主页
│   ├── admin.html                    # 管理后台（React）
│   ├── character_editor.html         # 角色编辑器
│   ├── world_editor.html             # 世界编辑器
│   ├── unified_editor.html           # 统一编辑器
│   ├── animation_puppeteer.html      # 动画编辑器
│   ├── ai_scene_generator.html       # 场景生成器
│   ├── ai_motion_factory.html        # 动作工厂
│   ├── js/                           # 前端 JS（67 个文件）
│   │   ├── world.js                  # 3D 场景主逻辑
│   │   ├── player.js                 # 玩家控制
│   │   ├── ui.js                     # UI 交互
│   │   ├── websocket.js              # 实时通信
│   │   ├── portalManager.js          # 传送门管理
│   │   └── ...                       # 更多模块
│   ├── models/                       # 3D 模型文件（GLB/OBJ）
│   ├── uploads/                      # 用户上传文件
│   └── i18n/                         # 国际化资源
├── database/                         # SQL 迁移脚本
├── db_export.sql                     # 完整数据库导出
├── Dockerfile                        # Docker 构建配置
├── docker-compose.yml                # Docker Compose 编排
├── package.json                      # 项目依赖
├── EULA.md                           # 最终用户许可协议
├── LICENSE                           # 许可证
└── PATENT_DISCLOSURE.md              # 专利技术公开文档
```

---

## 部署方式

支持 Windows 直装、Docker 部署、宝塔面板等多种方式。

| 文档 | 说明 |
|------|------|
| [程序部署说明](./程序部署说明.md) | 完整部署步骤（环境配置 / 启动 / Nginx / 联邦系统） |
| [数据库导入](./数据库导入.md) | 数据库创建与数据导入指南 |

> 英文版请参阅 [Deployment Guide](./Deployment_Guide.md) 和 [Database Import](./Database_Import.md)。

### Nginx 反向代理配置（生产环境推荐）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 200m;  # 3D 模型上传最大 200MB

    # 静态文件缓存
    location ~* \.(jpg|jpeg|png|gif|ico|css|js|svg|woff2?|glb|gltf)$ {
        root /var/www/virtual-world/public;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # 主应用
    location / {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 300s;
    }

    # WebSocket
    location /ws {
        proxy_pass http://localhost:3002;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 7d;
    }
}
```

---

## 联邦系统

联邦系统允许多个独立部署的虚拟世界实例互联，玩家可跨世界传送。

### 架构

各世界之间平等互联，通过双向信任握手建立联邦关系：

```
┌──────────┐    双向信任     ┌──────────┐
│  世界A    │◄──────────────►│  世界B    │
│ (World1) │                │ (World2) │
└────┬─────┘                └────┬─────┘
     │        双向信任             │
     └────────────────────────────┘
```

### 配置

**联邦参与世界的 `.env`：**
```env
IS_CENTRAL_WORLD=false
WORLD_NAME=我的世界
WORLD_URL=https://my-world.your-domain.com
```

### 验证联邦连接

```bash
# 检查联邦状态
curl https://your-domain.com/api/federation/info

# 预期返回
{
  "success": true,
  "worldName": "我的世界",
  "connectedWorlds": [...]
}
```

---

## 管理后台

管理后台基于 React 构建，提供完整的运营管理功能。

### 功能模块

| 模块 | 功能 |
|------|------|
| 控制台 | 用户数/建筑数/传送门数/传送次数 统计看板 |
| 用户管理 | 查看所有用户，修改角色权限，删除用户 |
| 传送门管理 | 创建/编辑/统计传送门 |
| 系统配置 | 敏感配置加密存储 / 热更新 |
| 联邦信任 | 审批/拒绝联邦连接请求 |
| 模型守卫 | 远程模型复杂度阈值 / 文件大小限制 |
| 操作日志 | 管理员操作审计追踪 |

### 编辑器工具

| 编辑器 | 入口 | 功能 |
|--------|------|------|
| 统一编辑器 | `unified_editor.html` | 几何体 + 模型库 |
| 世界编辑器 | `world_editor.html` | 场景对象摆放/调整 |
| 角色编辑器 | `character_editor.html` | 角色外观定制 |
| 动画编辑器 | `animation_puppeteer.html` | 骨骼动画录制 |


---

## 许可证与订阅

### 免费使用（仅限本地个人使用）

在以下条件**全部满足**时可免费使用：
- 仅在本地机器上个人使用
- 不通过 IP 或域名向他人提供服务
- 不与其他世界建立联邦连接
- 不进行二次开发对外销售

### 订阅许可（联网/联邦/商业使用）

如果进行以下任一操作，**必须**获取订阅许可：
- 通过 IP 地址或域名向他人提供访问
- 与其他世界建立联邦连接
- 进行二次开发并对外销售

| 项目 | 费用 |
|------|------|
| 首次订阅（含2个月免费） | ¥60 / $9.18 |
| 月续费（每个世界） | ¥3/月 / $0.46 |
| 年续费 | ¥36/年 / $5.51 |
| 10年续费 | ¥360 / $55.08 |
| 100年续费 | ¥3,600 / $550.80 |

> 完整许可协议请参阅 [EULA.md](./EULA.md) 和 [LICENSE](./LICENSE)。

### 联系方式

- **公司**：济宁米多信息科技有限公司
- **统一社会信用代码**：913708003104166341
- **邮箱**：888@miduo100.com

- **官网**：https://miduo100.com

---

## 常见问题

### 启动报错：`EADDRINUSE: address already in use :::3002`

端口 3002 被占用，先释放端口再重启：

```bash
# Linux
kill $(lsof -t -i:3002)

# Windows
netstat -ano | findstr :3002
taskkill /PID <进程ID> /F
```

### 启动报错：`password authentication failed for user "postgres"`

数据库密码错误，检查 `.env` 中 `DB_PASSWORD` 是否与 PostgreSQL 实际密码一致。

### 启动报错：`column "xxx" does not exist`

数据库缺少字段，执行迁移脚本或重新导入 `db_export.sql`。

### 前端报错：`Failed to fetch`

API 地址错误或服务未启动，检查：
1. 服务是否在运行（`pm2 status`）
2. `.env` 中 `WORLD_URL` 配置是否正确
3. 浏览器控制台 Network 标签查看请求详情

### 3D 模型加载失败

1. 检查模型文件是否在 `public/uploads/` 目录
2. 检查 Nginx 是否配置了 CORS 头
3. 联邦场景下检查目标世界的资源是否可跨域访问

### WebSocket 连接失败

检查 Nginx 是否配置了 WebSocket 代理（参考上方 Nginx 配置）。

---

## 相关文档

| 文档 | 说明 |
|------|------|
| [程序部署说明](./程序部署说明.md) | 中文部署指南 |
| [Deployment Guide](./Deployment_Guide.md) | 英文部署指南 |
| [数据库导入](./数据库导入.md) | 数据库导入步骤 |
| [Database Import](./Database_Import.md) | 英文数据库导入指南 |
| [EULA](./EULA.md) | 最终用户许可协议 |
| [LICENSE](./LICENSE) | 许可证 |
| [专利公开文档](./PATENT_DISCLOSURE.md) | 防御性技术公开 |
| [Patent Disclosure](./PATENT_DISCLOSURE_EN.md) | 英文专利公开文档 |

---

## 开发者信息

- **作者**：济宁米多信息科技有限公司
- **版本**：1.0.0
- **协议版本**：VWFP v2.1
- **仓库**：Git

### 技术支持

如需技术支持或有任何问题，请通过以下方式联系：

- 邮箱：888@miduo100.com


---

## Star History

如果这个项目对你有帮助，请给个 Star ⭐

---

Copyright © 2026 济宁米多信息科技有限公司. All Rights Reserved.
VWFP is a protocol developed by 济宁米多信息科技有限公司.
