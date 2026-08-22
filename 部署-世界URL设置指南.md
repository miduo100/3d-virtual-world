# 部署 - 世界URL设置指南

> 适用于：新服务器部署、世界迁移、外网访问异常排查。
> 核心结论：**世界 URL（world_url）决定联邦系统的"转向地址"** —— 中心世界用它来跳转/传送/检查其他世界，外部用户用它来访问你的世界。该值必须是**外部可访问的公网地址**，而不是内网 IP。

---

## 一、世界 URL 是什么

世界 URL 是本世界对外公布的访问地址，存储在数据库 `system_config.world_url` 和 `world_config.federation_config.worldUrl` 两处（保存时自动保持一致）。

它的用途：
1. **联邦注册**：子世界启动时把 `worldUrl` 提交给中心世界（`POST /api/federation/register-client`），中心世界存入 `trusted_worlds` 表，作为该世界的"转向地址"
2. **传送跳转**：中心世界/其他世界生成传送链接时用该地址做跳转目标
3. **在线状态检查**：中心世界每 30 秒用该地址 ping 各子世界
4. **跨世界资源加载**：传送后加载源世界的 GLB/动画模型

---

## 二、新服务器部署完整流程

### 第 1 步：服务器环境准备

| 项目 | 要求 |
|------|------|
| Node.js | v18 LTS 及以上 |
| PostgreSQL | 14+ |
| 端口 | 3002（应用）、80/443（可选域名） |
| 防火墙/安全组 | **放行 3002 入站**（Windows 防火墙 / ufw / 云安全组） |
| 路由器 NAT | 若有公网 IP 但机器在内网，需把 3002 端口转发到内网机器 |

### 第 2 步：部署程序与数据库

1. 解压/拉取项目代码到服务器
2. `npm install`（或使用随包 `linux_node_modules.gz` / `node_modules`）
3. 配置 `.env`（端口、数据库连接、JWT 密钥等）
4. 导入数据库（`database/init.sql` 或 `db_export.sql`）

### 第 3 步：启动并登录管理后台

```bash
node src/server.js        # 或 pm2 start src/server.js --name virtual-world
```

- 首次启动会自动初始化联邦系统（生成 worldId、RSA 密钥对）
- 浏览器访问 `http://服务器地址:3002/admin.html`，用管理员账号登录

> ⚠️ 注意：首次启动若 `.env` 未配置 `WORLD_URL`，世界 URL 默认为 `http://localhost:3002`；若导入的是旧数据库，系统自检会把指向"外部域名"的 URL 自动改为**本机内网 IP**（如 `http://192.168.1.3:3002`）。这两种情况都需要在第 4 步手动改为公网地址。

### 第 4 步：设置世界 URL（管理员手动设置）

**管理后台 → 系统设置 → 世界基础设置**：

1. 填写 **世界名称**
2. 填写 **世界 URL**：必须是外部可访问的公网地址
3. 填写世界描述（选填）
4. 点击 **💾 保存设置**

保存后系统自动完成：
- 写入 `system_config` 三键（world_name / world_url / world_description）
- 同步 `world_config.federation_config` 并打上 `url_source = 'manual'` 标记
- 更新运行中的联邦系统内存配置
- **广播 URL 变更**给所有已连接世界
- **重新注册到中心世界**（更新中心世界 `trusted_worlds` 里的转向地址）

### 第 5 步：验证

```bash
# 1. 本机自检：返回本世界的联邦信息
curl http://localhost:3002/api/federation/info

# 2. 中心世界侧：确认转向地址已更新（在中心世界执行）
curl http://中心世界地址/api/federation/info

# 3. 外网实测：在**另一台公网设备**（手机流量/其他网络）访问
#    http://公网IP:3002   应能打开世界首页
```

---

## 三、世界 URL 各取值场景对照表

| 取值 | 适用场景 | 外部用户能否访问 | 说明 |
|------|---------|----------------|------|
| `http://localhost:3002` | 本机开发 | 否 | 仅本机 |
| `http://192.168.1.3:3002`（内网 IP） | 局域网测试 | **否** | NAT 私有地址，公网不可路由 |
| `http://公网IP:3002` | 有独立公网 IP 的服务器 | **是** | 需放行 3002 端口 |
| `https://world.example.com` | 绑定域名 | **是** | 需 DNS 解析 + 备案（国内）+ Nginx 反代 |
| `https://xxx.frp.example.com` | 无公网 IP（内网穿透） | **是** | 用 frp/ngrok/cloudflared 穿透 |

---

## 四、外网访问失败排查清单

即使世界 URL 已填公网地址，外网访问仍可能失败，按以下顺序排查：

### 1. 端口是否放行（最常见）
```bash
# Windows
netstat -ano | findstr :3002
# Linux
ss -tlnp | grep 3002
```
- 服务器防火墙：放行 3002 入站
- 云服务器安全组：添加入站规则 3002
- 路由器 NAT：公网 3002 → 内网机器 3002 端口转发

### 2. 是否有独立公网 IP
- 宽带用户常为 CGN 大内网（拨号 IP 是 `100.64.x.x` / `10.x.x.x`），**没有**独立公网 IP
- 判断方法：用公网 IP 查询服务（如 `ip.sb`）得到的 IP，与路由器 WAN 口 IP 对比；不一致即无公网 IP
- 解决：向运营商申请公网 IP，或改用内网穿透

### 3. 域名解析与备案
- 用域名时确认 DNS 已解析到公网 IP
- 国内服务器 80/443 需 ICP 备案；**`IP:端口` 形式不受备案限制**

### 4. 重启后 URL 被自动覆盖
- 现象：设置公网地址后，重启服务器又变回 `http://192.168.1.x:3002`
- 原因：数据库里 `world_config.federation_config` 缺失或不含 `url_source = 'manual'` 标记，启动自检 `autoFixWorldUrl` 误判为"指向外部域名"
- 解决：
  - 使用最新代码重新保存一次世界设置（保存时已确保写入 manual 标记）
  - 或手动补标记：
    ```sql
    UPDATE world_config
    SET value = value::jsonb || '{"url_source":"manual"}'::jsonb
    WHERE key = 'federation_config';
    ```

### 5. 中心世界仍是旧地址
- 现象：中心世界世界列表里显示的是旧 URL
- 原因：修改世界 URL 后未重新注册
- 解决：正常保存世界设置会自动重新注册；若仍为旧值，在中心世界管理后台删除该世界信任记录，或重启本世界触发重新注册

---

## 五、常见问题（FAQ）

**Q1：本地测试时世界 URL 填什么？**
填 `http://localhost:3002`。保存后同样打 manual 标记，重启不会被覆盖。

**Q2：设置公网 URL 后，会不会影响本机访问？**
不会。本机依然通过 `http://localhost:3002` 访问；公网 URL 只用于联邦通信和外部访问。

**Q3：改了世界 URL 需要重启服务器吗？**
不需要。保存时已同步运行中的联邦系统并重新注册中心世界。重启也安全（manual 标记保证不被覆盖）。

**Q4：联邦传送时提示"目标世界无法访问"？**
先确认目标世界的 URL 是否符合本指南场景表，再按第四节排查清单逐项检查。

---

## 六、技术原理（可选了解）

启动时序：
```
server.js start()
  ├─ initializeDatabase()
  ├─ autoFixWorldUrl()      ← 自检：检测到"指向外部域名"且无 manual 标记时，改为本机内网 IP
  ├─ app.listen()
  └─ initFederation()       ← 读取 federation_config 创建联邦实例；向中心世界握手+注册
```

保存时序（管理后台 → 世界设置）：
```
saveWorldSettings()
  └─ PUT /api/config/world-settings
       ├─ UPSERT system_config (world_name/world_url/world_description)
       ├─ 同步 world_config.federation_config + url_source='manual'
       │    └─ (新部署场景) federation_config 不存在时自动创建完整配置 + manual 标记
       ├─ 更新内存 fs.worldName / fs.worldUrl
       ├─ broadcastWorldUrlChange()   → 通知所有已连接世界
       └─ registerToCentral()         → 更新中心世界转向地址
```

> `url_source='manual'` 标记是"管理员手动设置"与"系统自检修正"的分界：有该标记，重启自检跳过；无该标记，系统默认把外部地址修正为内网 IP（这是历史遗留数据导入时的自动适配逻辑）。
