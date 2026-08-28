const assert = require('node:assert/strict');
const test = require('node:test');
const {
  calculateTicketAmounts,
  normalizeTicketStatus,
  signPayload,
  verifySignedRequest
} = require('./jwetpro-ticket-core');

test('calculates the Smart Cut 10 percent commission', () => {
  assert.deepEqual(calculateTicketAmounts(1000, 10), {
    grossAmount: 1000,
    commissionRate: 10,
    commissionAmount: 100,
    netAmount: 900
  });
});

test('verifies signed integration payloads and rejects replay windows', () => {
  const secret = 'test-secret';
  const timestamp = 1_800_000_000_000;
  const eventId = 'event-1';
  const body = { championshipId: 'cup-1' };
  const signature = signPayload(secret, { timestamp, eventId, body });
  const headers = {
    'x-jwetpro-timestamp': timestamp,
    'x-jwetpro-event-id': eventId,
    'x-jwetpro-signature': signature
  };
  assert.equal(verifySignedRequest(secret, headers, body, timestamp).ok, true);
  assert.equal(verifySignedRequest(secret, headers, body, timestamp + 6 * 60 * 1000).ok, false);
});

test('normalizes JwetPro championship lifecycle aliases', () => {
  assert.equal(normalizeTicketStatus('open'), 'registration-open');
  assert.equal(normalizeTicketStatus('finished'), 'completed');
  assert.equal(normalizeTicketStatus('canceled'), 'cancelled');
});
