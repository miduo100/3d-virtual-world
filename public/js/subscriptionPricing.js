/**
 * 订阅计费前端逻辑
 * 规则：
 * 1. 首次购买（无已付款记录）：60 元授权费，有效期 2 个月。
 * 2. 正常续费（有已付款记录且未断订超过 12 个月）：3 元/月。
 * 3. 重新授权（断订超过 12 个月）：60 元授权费，有效期 2 个月。
 * 免费试用（paymentMethod = 'free_trial'）不计入已付款记录。
 */
const SubscriptionPricing = (function () {
  const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

  function isPaidRecord(record) {
    return record && record.paymentMethod !== 'free_trial';
  }

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }

  function monthsSince(date) {
    const d = parseDate(date);
    if (!d) return 0;
    return Math.max(0, Math.floor((Date.now() - d.getTime()) / MONTH_MS));
  }

  function sortByCreatedAtDesc(records) {
    return [...(records || [])].sort((a, b) => {
      const ta = parseDate(a.createdAt)?.getTime() || 0;
      const tb = parseDate(b.createdAt)?.getTime() || 0;
      return tb - ta;
    });
  }

  function getPricingState(history, config, requestedMonths) {
    const cfg = config || {};
    const firstAuthCents = cfg.firstAuthCents || 6000;
    const unitPriceCents = cfg.priceCents || 300;
    const firstAuthMonths = cfg.firstAuthMonths || 2;
    const reauthAfterMonths = cfg.reauthAfterMonths || 12;

    const paidHistory = sortByCreatedAtDesc((history || []).filter(isPaidRecord));
    const lastPaid = paidHistory[0] || null;

    if (paidHistory.length === 0) {
      const months = Math.max(firstAuthMonths, parseInt(requestedMonths, 10) || firstAuthMonths);
      const extra = Math.max(0, months - firstAuthMonths);
      return {
        mode: 'first',
        amountYuan: (firstAuthCents + extra * unitPriceCents) / 100,
        months,
        fixed: false,
        label: `首次授权费 ¥${((firstAuthCents + extra * unitPriceCents) / 100).toFixed(2)}`,
        description: `首次使用需支付授权费，含 ${firstAuthMonths} 个月使用权，超出部分 ¥${(unitPriceCents / 100).toFixed(2)}/月`
      };
    }

    const gapMonths = monthsSince(lastPaid.expiresAt);
    if (gapMonths > reauthAfterMonths) {
      const months = Math.max(firstAuthMonths, parseInt(requestedMonths, 10) || firstAuthMonths);
      const extra = Math.max(0, months - firstAuthMonths);
      return {
        mode: 'reauth',
        amountYuan: (firstAuthCents + extra * unitPriceCents) / 100,
        months,
        fixed: false,
        label: `重新授权费 ¥${((firstAuthCents + extra * unitPriceCents) / 100).toFixed(2)}`,
        description: `订阅已断订超过 ${reauthAfterMonths} 个月，需重新支付授权费，含 ${firstAuthMonths} 个月，超出部分 ¥${(unitPriceCents / 100).toFixed(2)}/月`
      };
    }

    const months = Math.max(1, parseInt(requestedMonths, 10) || 1);
    return {
      mode: 'renew',
      amountYuan: (months * unitPriceCents) / 100,
      months: months,
      fixed: false,
      label: '续费订阅',
      description: `按 ¥${(unitPriceCents / 100).toFixed(2)} / 月 续费`
    };
  }

  return {
    getPricingState,
    isPaidRecord
  };
})();
