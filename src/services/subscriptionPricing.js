/**
 * 订阅计费规则服务
 * 规则：
 * 1. 首次购买（无已付款记录）：60 元授权费，有效期 2 个月。
 * 2. 正常续费（有已付款记录且未断订超过 12 个月）：3 元/月。
 * 3. 重新授权（断订超过 12 个月）：60 元授权费，有效期 2 个月。
 * 免费试用（payment_method = 'free_trial'）不计入已付款记录。
 */

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

function isPaidRecord(record) {
  return record && record.payment_method !== 'free_trial';
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function monthsSince(date) {
  const d = parseDate(date);
  if (!d) return 0;
  const diff = Date.now() - d.getTime();
  return Math.max(0, Math.floor(diff / MONTH_MS));
}

function sortByCreatedAtDesc(records) {
  return [...(records || [])].sort((a, b) => {
    const ta = parseDate(a.created_at)?.getTime() || 0;
    const tb = parseDate(b.created_at)?.getTime() || 0;
    return tb - ta;
  });
}

function calculatePricing({
  history,
  requestedMonths,
  firstAuthCents = 6000,
  unitPriceCents = 300,
  firstAuthMonths = 2,
  reauthAfterMonths = 12
}) {
  const paidHistory = sortByCreatedAtDesc((history || []).filter(isPaidRecord));
  const hasPaidHistory = paidHistory.length > 0;
  const lastPaid = paidHistory[0] || null;

  if (!hasPaidHistory) {
    const months = Math.max(firstAuthMonths, parseInt(requestedMonths, 10) || firstAuthMonths);
    const extra = Math.max(0, months - firstAuthMonths);
    return {
      mode: 'first',
      amountCents: firstAuthCents + extra * unitPriceCents,
      finalMonths: months,
      reason: '首次授权（无支付记录）'
    };
  }

  const gapMonths = monthsSince(lastPaid.expires_at || lastPaid.expiresAt);
  if (gapMonths > reauthAfterMonths) {
    const months = Math.max(firstAuthMonths, parseInt(requestedMonths, 10) || firstAuthMonths);
    const extra = Math.max(0, months - firstAuthMonths);
    return {
      mode: 'reauth',
      amountCents: firstAuthCents + extra * unitPriceCents,
      finalMonths: months,
      reason: `断订超过${reauthAfterMonths}个月，需重新授权`
    };
  }

  const months = Math.max(1, parseInt(requestedMonths, 10) || 1);
  return {
    mode: 'renew',
    amountCents: months * unitPriceCents,
    finalMonths: months,
    reason: '正常续费'
  };
}

function buildStatus({
  history,
  firstAuthCents = 6000,
  unitPriceCents = 300,
  firstAuthMonths = 2,
  reauthAfterMonths = 12
}) {
  const paidHistory = sortByCreatedAtDesc((history || []).filter(isPaidRecord));
  const lastPaid = paidHistory[0] || null;
  const lastExpiresAt = lastPaid
    ? (lastPaid.expires_at || lastPaid.expiresAt)
    : null;

  return {
    mode: paidHistory.length === 0
      ? 'first'
      : monthsSince(lastExpiresAt) > reauthAfterMonths
        ? 'reauth'
        : 'renew',
    hasPaidHistory: paidHistory.length > 0,
    lastExpiresAt,
    monthsSinceExpiry: lastPaid ? monthsSince(lastExpiresAt) : null,
    firstAuthCents,
    unitPriceCents,
    firstAuthMonths,
    reauthAfterMonths
  };
}

module.exports = {
  calculatePricing,
  buildStatus,
  isPaidRecord
};
