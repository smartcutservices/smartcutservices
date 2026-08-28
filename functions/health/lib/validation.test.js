'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canTransitionPrescription,
  canTransitionOrder,
  prescriptionStatusLabel,
  computeOfferTotal,
  sanitizeMedicinePayload,
  tokenizeSearchName
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

test('PAID can move to PREPARING', () => {
  assert.equal(canTransitionOrder('PAID', 'PREPARING'), true);
});

test('PAYMENT_PENDING cannot skip straight to DELIVERED', () => {
  assert.equal(canTransitionOrder('PAYMENT_PENDING', 'DELIVERED'), false);
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
