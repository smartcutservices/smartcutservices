'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEmail, slugify, cleanText, normalizeService, publicationChecklist, canTransitionOrder, calculateCommission, calculateRefundDebit } = require('./domain');

test('normalise email, slug and untrusted text', () => {
  assert.equal(normalizeEmail('  TEST@Example.COM '), 'test@example.com');
  assert.equal(slugify('Création Logo Professionnel'), 'creation-logo-professionnel');
  assert.equal(cleanText('<b>Bonjour</b>\u0000 monde'), 'Bonjour monde');
  assert.throws(() => normalizeEmail('bad@'));
});

test('legacy services remain private drafts when enriched', () => {
  const service = normalizeService({ name: 'Logo', pricingType: 'FIXED', priceMinor: 250000, deliveryDays: 3, revisionsIncluded: 2 });
  assert.equal(service.visibility, 'PRIVATE');
  assert.equal(service.publicationStatus, 'DRAFT');
});

test('publication checklist blocks incomplete listings', () => {
  const service = normalizeService({ name: 'Logo', pricingType: 'CUSTOM_QUOTE', deliveryDays: 3, revisionsIncluded: 1 });
  assert.deepEqual(publicationChecklist(service, { status: 'ACTIVE' }).sort(), ['catégorie', 'description', 'image'].sort());
});

test('order transitions are actor scoped', () => {
  assert.equal(canTransitionOrder('IN_PROGRESS', 'DELIVERED', 'provider'), true);
  assert.equal(canTransitionOrder('IN_PROGRESS', 'COMPLETED', 'provider'), false);
  assert.equal(canTransitionOrder('DELIVERED', 'COMPLETED', 'buyer'), true);
});

test('commission is server calculated with bounds', () => {
  assert.deepEqual(calculateCommission(100000, { basisPoints: 1250 }), { grossMinor: 100000, commissionMinor: 12500, netMinor: 87500, basisPoints: 1250 });
  assert.equal(calculateCommission(100000, { basisPoints: 500, minimumMinor: 10000 }).commissionMinor, 10000);
});

test('partial refund reverses the provider net proportionally', () => {
  assert.equal(calculateRefundDebit(100000, 87500, 40000), 35000);
  assert.equal(calculateRefundDebit(100000, 87500, 100000), 87500);
  assert.throws(() => calculateRefundDebit(100000, 87500, 100001));
});
