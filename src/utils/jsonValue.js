/**
 * 济宁米多信息科技有限公司 版权所有
 * 如需获取软件授权请联系：888@miduo100.com / 15660440944
 *
 * jsonb 字段的安全读取工具
 *
 * 背景（2026-10-30 部署实测）：
 *   `world_config.value` 列类型是 **jsonb**，node-postgres 会直接把结果解析成 JS 对象。
 *   而历史代码有 9 处对 `rows[0].value` 做 `JSON.parse(...)`，对对象调用会抛
 *   `"[object Object]" is not valid JSON`。
 *   这些异常又分别被各处的 try/catch 吞掉，最终表现为一串互相矛盾的"玄学"：
 *     - 后台保存世界设置显示成功，但「本世界联邦信息」永远是旧地址
 *     - 重启后 /api/federation/info 返回 503（联邦系统未初始化）
 *     - 启动自检 autoFixWorldUrl 每轮都失败跳过，世界地址永远不自动修正
 *     - AI Agent 读取 worldId 失败、联邦信任设置读不到
 *   统一改用本函数后，jsonb 对象与 JSON 字符串两种形态都能正确读取。
 */

/**
 * @param {*} v       数据库返回的字段值（jsonb 对象 / JSON 字符串 / null）
 * @param {object} fallback 解析失败时的兜底值
 * @returns {object}
 */
function parseJsonValue(v, fallback = {}) {
  if (v === null || v === undefined) return fallback;
  // jsonb：pg 已解析为对象/数组，直接返回
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return fallback;
    try {
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch (_) {
      return fallback;
    }
  }
  return fallback;
}

module.exports = { parseJsonValue };
