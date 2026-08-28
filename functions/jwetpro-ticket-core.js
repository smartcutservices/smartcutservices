const crypto = require('crypto');

const DEFAULT_COMMISSION_RATE = 10;
const SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

function stablePayload(timestamp, eventId, body) {
  return `${String(timestamp)}.${String(eventId)}.${JSON.stringify(body || {})}`;
}

function signPayload(secret, { timestamp, eventId, body }) {
  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(stablePayload(timestamp, eventId, body))
    .digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifySignedRequest(secret, headers, body, now = Date.now()) {
  const timestamp = Number(headers?.['x-jwetpro-timestamp'] || headers?.['X-Jwetpro-Timestamp']);
  const eventId = String(headers?.['x-jwetpro-event-id'] || headers?.['X-Jwetpro-Event-Id'] || '').trim();
  const signature = String(headers?.['x-jwetpro-signature'] || headers?.['X-Jwetpro-Signature'] || '').trim();
  if (!timestamp || !eventId || !signature) return { ok: false, error: 'missing-signature' };
  if (Math.abs(now - timestamp) > SIGNATURE_MAX_AGE_MS) return { ok: false, error: 'expired-signature' };
  const expected = signPayload(secret, { timestamp, eventId, body });
  return safeEqual(signature, expected)
    ? { ok: true, eventId, timestamp }
    : { ok: false, error: 'invalid-signature' };
}

function normalizeRate(value, fallback = DEFAULT_COMMISSION_RATE) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, parsed));
}

function calculateTicketAmounts(amount, rate = DEFAULT_COMMISSION_RATE) {
  const grossAmount = Math.max(0, Number(amount) || 0);
  const commissionRate = normalizeRate(rate);
  const commissionAmount = Math.round((grossAmount * commissionRate / 100) * 100) / 100;
  return {
    grossAmount,
    commissionRate,
    commissionAmount,
    netAmount: Math.round((grossAmount - commissionAmount) * 100) / 100
  };
}

function normalizeTicketStatus(value) {
  const status = String(value || '').trim().toLowerCase();
  if (['registration-open', 'open'].includes(status)) return 'registration-open';
  if (['completed', 'finished', 'ended'].includes(status)) return 'completed';
  if (['cancelled', 'canceled', 'annule', 'annulé'].includes(status)) return 'cancelled';
  return 'closed';
}

module.exports = {
  DEFAULT_COMMISSION_RATE,
  SIGNATURE_MAX_AGE_MS,
  calculateTicketAmounts,
  normalizeRate,
  normalizeTicketStatus,
  signPayload,
  verifySignedRequest
};
