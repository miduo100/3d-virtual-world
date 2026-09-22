/**
 * resources.js — MCP Resources（决策点 D）
 *
 * 目的：AI 一连上 MCP server 就能读到"这是什么样的世界、我该怎么做"，
 * 不必先瞎调工具。内容是**文本导览**，不做任何伪造（红线 6）：
 *   - 世界名/ID/是否开放接入：来自发现文档（实时读，读不到就写占位符）；
 *   - "已知场景"只写项目里已确认的事实，并明确标注"以 world_observe 实际返回为准"。
 */

const GUIDE_URI = 'virtual-world://guide';

function buildGuide(client, doc) {
  const st = client.status();
  const world = (doc && doc.world) || {};
  const limitations = (doc && doc.limits) || {};
  const lines = [];

  lines.push('# 虚拟世界（3D 在线世界）AI 接入导览');
  lines.push('');
  lines.push('## 你面对的是什么');
  lines.push('一个**真实的多人 3D 世界**：世界里同时有真人玩家（浏览器里操作 3D 角色）与 AI Agent（就是你）。');
  lines.push('你进入后会有自己的形象，真人能看到你走动、说话、跟随他们。你看不到画面，只能通过文字描述认识它。');
  lines.push('');
  lines.push('## 当前这个世界');
  lines.push(`- 世界名：${world.name || '（未能读取发现文档，调用 world_discover 获取）'}`);
  lines.push(`- worldId：${world.id || '?'}`);
  lines.push(`- 是否开放 AI 接入：${doc ? (doc.agentEnabled ? '是' : '否（agent_enabled=false，进入会被拒）') : '未知'}`);
  lines.push(`- 你的接入档位：${st.mode}`);
  lines.push(`- 说话气泡范围：30m（只有 30m 内的人能看到你说的话）`);
  lines.push(`- 移动速度上限：${limitations.movementSpeed || '约 9~12'} m/s；活动边界 ±${limitations.worldBoundary || 1000}m`);
  lines.push(`- 观察半径：游客 30m ／ Key 档 200m`);
  lines.push('');
  lines.push('## 可做的事（8 个工具）');
  lines.push('1. `world_discover` — 读世界公开信息（无需凭证）');
  lines.push('2. `world_enter` — 进入世界（游客档无需凭证）');
  lines.push('3. `world_observe` — **你的眼睛**：返回附近的人/物体/传送门的文字描述与距离');
  lines.push('4. `world_say` — 说话，30m 内真人可见气泡（限频 1 条/5 秒，≤200 字）');
  lines.push('5. `world_walk_to` — 走到坐标（有真实走路动画；唯一的位移方式）');
  lines.push('6. `world_follow` — 按 id 跟随某个玩家（长时任务，立刻返回）');
  lines.push('7. `world_chat_history` — 读最近聊天（游客档靠它知道有没有人回话）');
  lines.push('8. `world_leave` — 离场（形象消失）');
  lines.push('');
  lines.push('## 已知场景（参考；以 world_observe 实际返回为准）');
  lines.push('- 教室区：教学楼里的教室、课桌、讲台、人物模型（学生/鲁迅等）；');
  lines.push('- 红军阵列：20 种红军模型、约 600 个实例，是世界最密集的区域；');
  lines.push('- 四类几何场景：乡村村落 / 森林 / 城市 / 太空（树、灌木、花、栅栏、车、路灯、小屋、摩天楼、岩石、水晶、山、母鸡、鸟、塔、飞船、猫）；');
  lines.push('- 若干传送门（大学开学、记忆空间、城市、返回中心等）。**AI 不能使用传送门**（服务端红线）。');
  lines.push('不同世界内容不同，不要凭这条导览断言某个物体一定存在。');
  lines.push('');
  lines.push('## 规矩（重要）');
  lines.push('- **用 id 认人，不用名字**：世界里同名是常态（真的有两个叫"米多"的玩家）。`entities[].id` 是唯一标识，`name` 仅供显示。');
  lines.push('- **禁止传送**：`teleport` / `set_position` 是服务端明确禁止的能力，任何"绕过"都是违规。位移只能 walk_to。');
  lines.push('- **文明说话**：say 有 200 字与频率限制，别刷屏；真人会看到你的气泡，代表的是你背后的用户。');
  lines.push('- **描述可能是空的**：物体 `description` 为 null 时如实说"无描述"，**不要用名字去猜内容**。');
  lines.push('');
  lines.push('## 两种档位（升级漏斗）');
  lines.push('| 档位 | 怎么来 | 能得到什么 |');
  lines.push('|---|---|---|');
  lines.push('| 游客档 | 只填 `AGENT_HOST` | 进世界、走动、说话、observe 30m。**收不到实时推送**，只能主动拉取；票 30 分钟且不可续期 |');
  lines.push('| Key 档 | 再填 `AGENT_API_KEY` | observe 200m、实时聊天与位置推送、会话自动续期、可长期驻场 |');
  const hint = client.upgradeHint();
  if (hint) lines.push(`升级方式：${hint}`);
  lines.push('');
  lines.push('## 建议的第一步');
  lines.push('`world_discover` → `world_enter` → `world_observe` → （有人的话）`world_walk_to` 走近 → `world_say` 打招呼 → 离开前 `world_say` 道别 → `world_leave`。');
  return lines.join('\n');
}

export function registerResources(mcp, client, deps = {}) {
  const log = deps.log || (() => {});
  mcp.registerResource(
    'world-guide',
    GUIDE_URI,
    {
      title: '虚拟世界导览（AI 接入指南）',
      description: '这个世界是什么、8 个工具能做什么、规矩与两种档位。建议进入前先读。',
      mimeType: 'text/plain'
    },
    async (uri) => {
      let doc = null;
      try {
        doc = await client.discover();
      } catch (e) {
        log('guide: 发现文档读取失败，导览降级为静态内容：' + e.message);
      }
      return {
        contents: [{ uri: uri && uri.href ? uri.href : GUIDE_URI, mimeType: 'text/plain', text: buildGuide(client, doc) }]
      };
    }
  );
  return { uri: GUIDE_URI };
}
