'use strict';

const PROFORMA_STATUSES = new Set(['DRAFT', 'SENT', 'VIEWED', 'PENDING_PAYMENT', 'PAID', 'EXPIRED', 'CANCELLED']);
const WITHDRAWAL_STATUSES = new Set(['PENDING', 'PROCESSING', 'COMPLETED', 'REJECTED', 'CANCELLED']);

function toMinor(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('invalid-money');
  const raw = String(value ?? '').trim().replace(',', '.');
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error('invalid-money');
  const [whole, fraction = ''] = raw.split('.');
  const minor = (BigInt(whole) * 100n) + BigInt((fraction + '00').slice(0, 2));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('money-too-large');
  return Number(minor);
}

function fromMinor(value) {
  if (!Number.isSafeInteger(value)) throw new Error('invalid-minor-money');
  return (value / 100).toFixed(2);
}

function calculateProforma(input = {}) {
  const items = Array.isArray(input.items) ? input.items : [];
  if (!items.length || items.length > 100) throw new Error('invalid-items');
  const normalized = items.map((item) => {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) throw new Error('invalid-quantity');
    const unitPriceMinor = Number.isSafeInteger(item.unitPriceMinor) ? item.unitPriceMinor : toMinor(item.unitPrice);
    if (unitPriceMinor < 0) throw new Error('invalid-unit-price');
    const lineTotalMinor = quantity * unitPriceMinor;
    if (!Number.isSafeInteger(lineTotalMinor)) throw new Error('money-too-large');
    return { ...item, quantity, unitPriceMinor, lineTotalMinor };
  });
  const subtotalMinor = normalized.reduce((sum, item) => sum + item.lineTotalMinor, 0);
  const discountMinor = input.discount ? toMinor(input.discount) : Number(input.discountMinor || 0);
  const taxMinor = input.tax ? toMinor(input.tax) : Number(input.taxMinor || 0);
  const feeMinor = input.fee ? toMinor(input.fee) : Number(input.feeMinor || 0);
  if (![discountMinor, taxMinor, feeMinor].every(Number.isSafeInteger)) throw new Error('invalid-money');
  if (discountMinor < 0 || taxMinor < 0 || feeMinor < 0 || discountMinor > subtotalMinor) throw new Error('invalid-adjustments');
  const totalMinor = subtotalMinor - discountMinor + taxMinor + feeMinor;
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) throw new Error('invalid-total');
  return { items: normalized, subtotalMinor, discountMinor, taxMinor, feeMinor, totalMinor };
}

function canTransitionWithdrawal(from, to) {
  if (!WITHDRAWAL_STATUSES.has(from) || !WITHDRAWAL_STATUSES.has(to)) return false;
  return ({
    PENDING: ['PROCESSING', 'REJECTED', 'CANCELLED'],
    PROCESSING: ['COMPLETED', 'REJECTED'],
    COMPLETED: [], REJECTED: [], CANCELLED: []
  })[from].includes(to);
}

function formatDocumentNumber(prefix, year, sequence) {
  if (!/^[A-Z]{2,4}$/.test(prefix) || !Number.isInteger(sequence) || sequence < 1) throw new Error('invalid-document-sequence');
  return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
}

function reserveBalance(balance = {}, amountMinor) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error('invalid-withdrawal-amount');
  const availableMinor = Number(balance.availableMinor || 0);
  if (availableMinor < amountMinor) throw new Error('insufficient-balance');
  return { ...balance, availableMinor: availableMinor - amountMinor, reservedMinor: Number(balance.reservedMinor || 0) + amountMinor };
}

function releaseReservedBalance(balance = {}, amountMinor) {
  const reservedMinor = Number(balance.reservedMinor || 0);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || reservedMinor < amountMinor) throw new Error('reserved-balance-inconsistent');
  return { ...balance, reservedMinor: reservedMinor - amountMinor, availableMinor: Number(balance.availableMinor || 0) + amountMinor };
}

function completeReservedBalance(balance = {}, amountMinor) {
  const reservedMinor = Number(balance.reservedMinor || 0);
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || reservedMinor < amountMinor) throw new Error('reserved-balance-inconsistent');
  return { ...balance, reservedMinor: reservedMinor - amountMinor, paidOutMinor: Number(balance.paidOutMinor || 0) + amountMinor };
}

module.exports = {
  PROFORMA_STATUSES,
  WITHDRAWAL_STATUSES,
  toMinor,
  fromMinor,
  calculateProforma,
  canTransitionWithdrawal,
  formatDocumentNumber,
  reserveBalance,
  releaseReservedBalance,
  completeReservedBalance
};
