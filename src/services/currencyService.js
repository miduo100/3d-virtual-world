/**
 * currencyService —— 钱包 + 原子扣减 + 幂等键（AI World Brain · Phase 6 · §Phase 6 前置#1）
 * 济宁米多信息科技有限公司 版权所有 · 888@miduo100.com / 15660440944
 * ------------------------------------------------------------------
 * 原子性（§H.8 缺陷 5）：
 *   wallets.balance 带 CHECK (balance >= 0)，扣款用
 *   "UPDATE ... SET balance = balance - $n WHERE owner AND balance >= $n RETURNING balance"
 *   —— 数据库层面不可能扣成负数；单条 UPDATE 天然免并发双扣。
 * 幂等：wallet_transactions.idempotency_key UNIQUE —— 同一幂等键的第二笔直接返回首笔结果。
 */
'use strict';

const { query, pool } = require('../database/db');

function bad(code, reason) { return { ok: false, code, reason }; }

function validOwner(o) {
  return o && (o.ownerType === 'user' || o.ownerType === 'agent') && o.ownerId;
}

async function getBalance(ownerType, ownerId, currency) {
  const r = await query(
    `SELECT balance FROM wallets WHERE owner_type=$1 AND owner_id=$2 AND currency=$3`,
    [String(ownerType || 'user'), String(ownerId), String(currency || 'coin')]
  );
  return { ok: true, balance: r.rows.length ? Number(r.rows[0].balance) : 0 };
}

/** 入账（钱包不存在则建；幂等键命中则返回首笔） */
async function deposit(o) {
  const p = o || {};
  if (!validOwner(p)) return bad('OWNER_REQUIRED', '必须给 ownerType(user|agent) 与 ownerId');
  const amount = Math.floor(Number(p.amount));
  if (!Number.isFinite(amount) || amount <= 0) return bad('AMOUNT_INVALID', 'amount 必须是正整数');
  return applyLedger(p.ownerType, p.ownerId, amount, p, 'reward');
}

/** 扣款（原子 + 余额闸在 SQL 内；幂等键命中则返回首笔） */
async function withdraw(o) {
  const p = o || {};
  if (!validOwner(p)) return bad('OWNER_REQUIRED', '必须给 ownerType(user|agent) 与 ownerId');
  const amount = Math.floor(Number(p.amount));
  if (!Number.isFinite(amount) || amount <= 0) return bad('AMOUNT_INVALID', 'amount 必须是正整数');
  return applyLedger(p.ownerType, p.ownerId, -amount, p, 'purchase');
}

/** 单事务入/出账核心。amount 带符号。 */
async function applyLedger(ownerType, ownerId, signedAmount, p, defaultKind) {
  const currency = String(p.currency || 'coin');
  const kind = String(p.kind || defaultKind).slice(0, 40);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (p.idempotencyKey) {
      const prev = await client.query(
        `SELECT amount, balance_after, kind, created_at FROM wallet_transactions WHERE idempotency_key=$1`,
        [String(p.idempotencyKey).slice(0, 100)]
      );
      if (prev.rows.length) {
        await client.query('COMMIT');
        return { ok: true, deduped: true, balance: Number(prev.rows[0].balance_after), kind: prev.rows[0].kind };
      }
    }
    // 钱包不存在则建（ON CONFLICT 防并发双建）
    await client.query(
      `INSERT INTO wallets (owner_type, owner_id, currency, balance) VALUES ($1,$2,$3,0)
       ON CONFLICT (owner_type, owner_id, currency) DO NOTHING`,
      [ownerType, String(ownerId), currency]
    );
    // 原子出/入账：扣款时 balance >= n 是余额闸；入账恒可
    const upd = await client.query(
      `UPDATE wallets SET balance = balance + $1, updated_at = NOW()
        WHERE owner_type=$2 AND owner_id=$3 AND currency=$4 AND balance + $1 >= 0
        RETURNING balance`,
      [signedAmount, ownerType, String(ownerId), currency]
    );
    if (!upd.rows.length) {
      await client.query('ROLLBACK');
      return bad('INSUFFICIENT_FUNDS', '余额不足（或扣减后为负被数据库拒绝）');
    }
    const balanceAfter = Number(upd.rows[0].balance);
    await client.query(
      `INSERT INTO wallet_transactions
         (owner_type, owner_id, currency, amount, balance_after, kind, idempotency_key, ref_type, ref_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [ownerType, String(ownerId), currency, signedAmount, balanceAfter, kind,
        p.idempotencyKey ? String(p.idempotencyKey).slice(0, 100) : null,
        p.refType ? String(p.refType).slice(0, 40) : null,
        p.refId ? String(p.refId).slice(0, 100) : null]
    );
    await client.query('COMMIT');
    return { ok: true, deduped: false, balance: balanceAfter, kind };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (e2) { /* 已回滚 */ }
    if (String(e.code) === '23505') return { ok: true, deduped: true, reason: '幂等键并发撞车，首笔已生效' };
    return bad('LEDGER_FAILED', '记账失败：' + e.message);
  } finally {
    client.release();
  }
}

module.exports = { getBalance, deposit, withdraw };
