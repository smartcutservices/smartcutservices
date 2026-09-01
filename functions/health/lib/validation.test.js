'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canTransitionPrescription,
  canTransitionOrder,
  prescriptionStatusLabel,
  computeOfferTotal,
  sanitizeMedicinePayload,
  tokenizeSearchName,
  slotConflictsWithExisting,
  canSendSessionMedia,
  isPastNoShowDeadline,
  isWithinPayoutCooldown
} = require('./validation');

// ---------- prescription status transitions ----------

test('RECEIVED can move to UNDER_REVIEW', () => {
  assert.equal(canTransitionPrescription('RECEIVED', 'UNDER_REVIEW'), true);
});

test('RECEIVED cannot jump straight to PAID', () => {
  assert.equal(canTransitionPrescription('RECEIVED', 'PAID'), false);
});

test('a terminal status (DELIVERED) has no further transitions', () => {
  assert.equal(canTransitionPrescription('DELIVERED', 'PREPARING'), false);
});

test('NEEDS_CLARIFICATION can return to UNDER_REVIEW', () => {
  assert.equal(canTransitionPrescription('NEEDS_CLARIFICATION', 'UNDER_REVIEW'), true);
});

test('unknown status has no valid transitions', () => {
  assert.equal(canTransitionPrescription('BOGUS', 'PAID'), false);
});

test('every status has a French label, never the raw enum as a fallback for a known status', () => {
  assert.equal(prescriptionStatusLabel('UNDER_REVIEW'), 'En cours de vérification');
  assert.notEqual(prescriptionStatusLabel('UNDER_REVIEW'), 'UNDER_REVIEW');
});

// ---------- order fulfillment transitions ----------
// Nouvelle(PAID) -> Acceptée(ACCEPTED) -> En préparation(PREPARING) -> Prête(READY)
// -> Remise/Livrée(DELIVERED) -> Terminée(COMPLETED).

test('PAID must be explicitly accepted before preparation — it cannot jump straight to PREPARING', () => {
  assert.equal(canTransitionOrder('PAID', 'PREPARING'), false);
  assert.equal(canTransitionOrder('PAID', 'ACCEPTED'), true);
  assert.equal(canTransitionOrder('ACCEPTED', 'PREPARING'), true);
});

test('PAYMENT_PENDING cannot skip straight to DELIVERED', () => {
  assert.equal(canTransitionOrder('PAYMENT_PENDING', 'DELIVERED'), false);
});

test('a pharmacy can refuse an order at PAID, ACCEPTED or PREPARING, never once READY', () => {
  assert.equal(canTransitionOrder('PAID', 'CANCELLED'), true);
  assert.equal(canTransitionOrder('ACCEPTED', 'CANCELLED'), true);
  assert.equal(canTransitionOrder('PREPARING', 'CANCELLED'), true);
  assert.equal(canTransitionOrder('READY', 'CANCELLED'), false);
});

test('DELIVERED can be closed out as COMPLETED, and COMPLETED is terminal', () => {
  assert.equal(canTransitionOrder('DELIVERED', 'COMPLETED'), true);
  assert.equal(canTransitionOrder('COMPLETED', 'CANCELLED'), false);
});

test('REFUNDED is a terminal status with no further transitions', () => {
  assert.equal(canTransitionOrder('REFUNDED', 'PREPARING'), false);
});

// ---------- computeOfferTotal: server-side pricing, client price ignored ----------

test('computes total from the server catalog, ignoring any price on the item', () => {
  const catalog = new Map([
    ['med1', { name: 'Amoxicilline', price: 250 }],
    ['med2', { name: 'Doliprane', price: 100 }]
  ]);
  const result = computeOfferTotal(
    [
      { productId: 'med1', qty: 2, available: true, price: 1 }, // price:1 must be ignored
      { productId: 'med2', qty: 1, available: true, price: 999999 }
    ],
    catalog
  );
  assert.equal(result.subtotal, 250 * 2 + 100 * 1);
  assert.equal(result.allAvailable, true);
});

test('unavailable items contribute zero to the total but are still listed', () => {
  const catalog = new Map([['med1', { name: 'Amoxicilline', price: 250 }]]);
  const result = computeOfferTotal([{ productId: 'med1', qty: 3, available: false }], catalog);
  assert.equal(result.subtotal, 0);
  assert.equal(result.allAvailable, false);
  assert.equal(result.lines.length, 1);
});

test('throws on a product id not present in the pharmacy catalog', () => {
  const catalog = new Map([['med1', { name: 'Amoxicilline', price: 250 }]]);
  assert.throws(() => computeOfferTotal([{ productId: 'med-not-mine', qty: 1, available: true }], catalog));
});

test('throws when items is empty', () => {
  assert.throws(() => computeOfferTotal([], new Map()));
});

test('rejects an available offer line with a zero quantity', () => {
  const catalog = new Map([['med1', { name: 'X', price: 10 }]]);
  assert.throws(() => computeOfferTotal([{ productId: 'med1', qty: 0, available: true }], catalog));
});

// ---------- sanitizeMedicinePayload ----------

test('accepts a valid medicine payload', () => {
  const result = sanitizeMedicinePayload({ name: 'Amoxicilline', price: 250, stock: 10, prescriptionRequired: true });
  assert.equal(result.name, 'Amoxicilline');
  assert.equal(result.price, 250);
  assert.equal(result.stock, 10);
  assert.equal(result.prescriptionRequired, true);
  assert.equal(result.coldChainRequired, false);
});

test('rejects a missing name', () => {
  assert.throws(() => sanitizeMedicinePayload({ price: 10, stock: 1 }), (error) => error.code === 'name-required');
});

test('rejects a negative price', () => {
  assert.throws(() => sanitizeMedicinePayload({ name: 'X', price: -5, stock: 1 }), (error) => error.code === 'invalid-price');
});

test('rejects a non-integer or negative stock', () => {
  assert.throws(() => sanitizeMedicinePayload({ name: 'X', price: 5, stock: -1 }), (error) => error.code === 'invalid-stock');
});

test('defaults prescriptionRequired and coldChainRequired to false when absent', () => {
  const result = sanitizeMedicinePayload({ name: 'X', price: 5, stock: 1 });
  assert.equal(result.prescriptionRequired, false);
  assert.equal(result.coldChainRequired, false);
});

test('accepts therapeutic class/subclass, active ingredients, presentation and images', () => {
  const result = sanitizeMedicinePayload({
    name: 'Amoxicilline', price: 250, stock: 10,
    therapeuticClass: 'Antibiotiques', therapeuticSubclass: 'Bêta-lactamines',
    activeIngredients: 'Amoxicilline trihydratée', presentation: 'Boîte de 12 comprimés',
    images: ['health-pharmacy-products/pharm1/photo1.jpg', 'health-pharmacy-products/pharm1/photo2.jpg']
  });
  assert.equal(result.therapeuticClass, 'Antibiotiques');
  assert.equal(result.therapeuticSubclass, 'Bêta-lactamines');
  assert.equal(result.activeIngredients, 'Amoxicilline trihydratée');
  assert.equal(result.presentation, 'Boîte de 12 comprimés');
  assert.equal(result.images.length, 2);
});

test('caps product images at MAX_PRODUCT_IMAGES and ignores non-array input', () => {
  const many = Array.from({ length: 10 }, (_, i) => `path-${i}.jpg`);
  const result = sanitizeMedicinePayload({ name: 'X', price: 5, stock: 1, images: many });
  assert.ok(result.images.length <= 6);
  const noImages = sanitizeMedicinePayload({ name: 'X', price: 5, stock: 1, images: 'not-an-array' });
  assert.deepEqual(noImages.images, []);
});

// ---------- tokenizeSearchName ----------

test('tokenizes and lowercases a medicine name', () => {
  assert.deepEqual(tokenizeSearchName('Amoxicilline 500mg'), ['amoxicilline', '500mg']);
});

test('strips accents', () => {
  assert.deepEqual(tokenizeSearchName('Doliprané'), ['doliprane']);
});

test('deduplicates repeated tokens', () => {
  assert.deepEqual(tokenizeSearchName('test test test'), ['test']);
});

test('drops tokens shorter than 2 characters', () => {
  assert.deepEqual(tokenizeSearchName('a bb c'), ['bb']);
});

// ---------- slotConflictsWithExisting: no double-booking, 30-minute gap ----------

test('an empty candidate range against no existing slots never conflicts', () => {
  assert.equal(slotConflictsWithExisting('2026-09-01T09:00:00Z', '2026-09-01T09:10:00Z', []), false);
});

test('an identical slot conflicts', () => {
  const existing = [{ startsAt: '2026-09-01T09:00:00Z', endsAt: '2026-09-01T09:10:00Z' }];
  assert.equal(slotConflictsWithExisting('2026-09-01T09:00:00Z', '2026-09-01T09:10:00Z', existing), true);
});

test('a slot starting exactly at the end of the previous one (0-minute gap) conflicts — 30 minutes required', () => {
  const existing = [{ startsAt: '2026-09-01T09:00:00Z', endsAt: '2026-09-01T09:10:00Z' }];
  assert.equal(slotConflictsWithExisting('2026-09-01T09:10:00Z', '2026-09-01T09:20:00Z', existing), true);
});

test('a slot starting exactly 30 minutes after the previous one ends does not conflict', () => {
  const existing = [{ startsAt: '2026-09-01T09:00:00Z', endsAt: '2026-09-01T09:10:00Z' }];
  assert.equal(slotConflictsWithExisting('2026-09-01T09:40:00Z', '2026-09-01T09:50:00Z', existing), false);
});

test('a slot starting 29 minutes after the previous one ends still conflicts', () => {
  const existing = [{ startsAt: '2026-09-01T09:00:00Z', endsAt: '2026-09-01T09:10:00Z' }];
  assert.equal(slotConflictsWithExisting('2026-09-01T09:39:00Z', '2026-09-01T09:49:00Z', existing), true);
});

test('a slot far away on the same day never conflicts', () => {
  const existing = [{ startsAt: '2026-09-01T09:00:00Z', endsAt: '2026-09-01T09:10:00Z' }];
  assert.equal(slotConflictsWithExisting('2026-09-01T14:00:00Z', '2026-09-01T14:10:00Z', existing), false);
});

test('malformed existing slot data is ignored rather than crashing', () => {
  const existing = [{ startsAt: 'not-a-date', endsAt: 'also-not-a-date' }];
  assert.equal(slotConflictsWithExisting('2026-09-01T09:00:00Z', '2026-09-01T09:10:00Z', existing), false);
});

// ---------- canSendSessionMedia: per-patient photo/voice caps by plan ----------

test('allows a photo when under the plan cap', () => {
  const limits = { maxPhotos: 2, maxVoiceMessages: 1 };
  assert.equal(canSendSessionMedia([{ kind: 'photo' }], 'photo', limits), true);
});

test('refuses a photo once the plan cap is reached', () => {
  const limits = { maxPhotos: 1, maxVoiceMessages: 1 };
  assert.equal(canSendSessionMedia([{ kind: 'photo' }], 'photo', limits), false);
});

test('photo and voice caps are tracked independently', () => {
  const limits = { maxPhotos: 1, maxVoiceMessages: 1 };
  assert.equal(canSendSessionMedia([{ kind: 'photo' }], 'voice', limits), true);
});

test('refuses any media when the plan has no recognized cap', () => {
  assert.equal(canSendSessionMedia([], 'photo', {}), false);
});

// ---------- isPastNoShowDeadline: 5-minute grace period ----------

test('not past the no-show deadline right when the session starts', () => {
  const now = new Date('2026-09-01T09:00:00Z');
  assert.equal(isPastNoShowDeadline('2026-09-01T09:00:00Z', now), false);
});

test('not past the no-show deadline at 4 minutes 59 seconds', () => {
  const now = new Date('2026-09-01T09:04:59Z');
  assert.equal(isPastNoShowDeadline('2026-09-01T09:00:00Z', now), false);
});

test('past the no-show deadline at exactly 5 minutes', () => {
  const now = new Date('2026-09-01T09:05:00Z');
  assert.equal(isPastNoShowDeadline('2026-09-01T09:00:00Z', now), true);
});

// ---------- isWithinPayoutCooldown: one paid payout per rolling 30 days ----------

test('no prior payout means never within cooldown', () => {
  assert.equal(isWithinPayoutCooldown(null), false);
});

test('within cooldown the day after a paid payout', () => {
  const lastPaidAt = '2026-08-01T00:00:00Z';
  const now = new Date('2026-08-02T00:00:00Z');
  assert.equal(isWithinPayoutCooldown(lastPaidAt, now), true);
});

test('outside cooldown exactly 30 days after a paid payout', () => {
  const lastPaidAt = '2026-08-01T00:00:00Z';
  const now = new Date('2026-08-31T00:00:00Z');
  assert.equal(isWithinPayoutCooldown(lastPaidAt, now), false);
});
