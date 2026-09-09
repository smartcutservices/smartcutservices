const assert = require('node:assert/strict');
const crypto = require('crypto');
const test = require('node:test');
const { _test } = require('./whatsapp');

test('normalizes Haitian and international WhatsApp numbers', () => {
  assert.equal(_test.normalizePhone('3491-3988'), '50934913988');
  assert.equal(_test.normalizePhone('+509 3491 3988'), '50934913988');
  assert.equal(_test.normalizePhone('+33 6 12 34 56 78'), '33612345678');
  assert.equal(_test.normalizePhone('123'), '');
});

test('accepts only a valid Meta HMAC signature', () => {
  const raw = '{"object":"whatsapp_business_account"}';
  const signature = `sha256=${crypto.createHmac('sha256', 'meta-secret').update(raw).digest('hex')}`;
  assert.equal(_test.verifySignature(raw, signature, 'meta-secret'), true);
  assert.equal(_test.verifySignature(raw, signature, 'wrong-secret'), false);
  assert.equal(_test.verifySignature(raw, '', 'meta-secret'), false);
});

test('parses incoming messages and delivery statuses without mixing them', () => {
  const parsed = _test.parseWebhook({ entry: [{ changes: [{ field: 'messages', value: {
    contacts: [{ profile: { name: 'Marie' } }],
    messages: [{ id: 'in_1', from: '50934913988', type: 'text', text: { body: 'STOP' }, timestamp: '100' }],
    statuses: [{ id: 'out_1', recipient_id: '50934913988', status: 'read', timestamp: '101' }]
  } }] }] });
  assert.equal(parsed.incoming.length, 1);
  assert.equal(parsed.incoming[0].text, 'STOP');
  assert.equal(parsed.statuses.length, 1);
  assert.equal(parsed.statuses[0].status, 'read');
});

test('recognizes only completed payments and public products', () => {
  assert.equal(_test.isPaidOrder({ paymentStatus: 'paid' }), true);
  assert.equal(_test.isPaidOrder({ status: 'payment_initiated' }), false);
  assert.equal(_test.isActiveProduct({ status: 'active' }), true);
  assert.equal(_test.isActiveProduct({ publicationStatus: 'published' }), true);
  assert.equal(_test.isActiveProduct({ status: 'draft' }), false);
});
