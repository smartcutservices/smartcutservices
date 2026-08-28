'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { toMinor, fromMinor, calculateProforma, canTransitionWithdrawal, formatDocumentNumber, reserveBalance, releaseReservedBalance, completeReservedBalance } = require('./domain');
const { FakeFirestore } = require('../smartsolutiontek/lib/firestoreFake');

test('money conversion avoids floating point arithmetic', () => {
  assert.equal(toMinor('10000'), 1000000);
  assert.equal(toMinor('0.10'), 10);
  assert.equal(fromMinor(1000000), '10000.00');
  assert.throws(() => toMinor('1.001'));
});

test('proforma totals are server-computed from integer minor units', () => {
  const result = calculateProforma({
    items: [{ quantity: 2, unitPrice: '5000.00' }],
    discount: '500.00', tax: '0', fee: '100.00'
  });
  assert.equal(result.subtotalMinor, 1000000);
  assert.equal(result.totalMinor, 960000);
});

test('withdrawal state machine refuses final-state replay', () => {
  assert.equal(canTransitionWithdrawal('PENDING', 'PROCESSING'), true);
  assert.equal(canTransitionWithdrawal('PROCESSING', 'COMPLETED'), true);
  assert.equal(canTransitionWithdrawal('COMPLETED', 'COMPLETED'), false);
  assert.equal(canTransitionWithdrawal('REJECTED', 'PROCESSING'), false);
});

test('document numbers are stable and readable', () => {
  assert.equal(formatDocumentNumber('PF', 2026, 1), 'PF-2026-000001');
});

test('reservation, rejection and completion preserve exact integer balances', () => {
  const reserved = reserveBalance({ availableMinor: 2000000, reservedMinor: 0, paidOutMinor: 0 }, 1000000);
  assert.deepEqual(reserved, { availableMinor: 1000000, reservedMinor: 1000000, paidOutMinor: 0 });
  assert.deepEqual(releaseReservedBalance(reserved, 1000000), { availableMinor: 2000000, reservedMinor: 0, paidOutMinor: 0 });
  assert.deepEqual(completeReservedBalance(reserved, 1000000), { availableMinor: 1000000, reservedMinor: 0, paidOutMinor: 1000000 });
  assert.throws(() => reserveBalance({ availableMinor: 1000000 }, 1500000), /insufficient-balance/);
});

test('two concurrent 8000 HTG reservations against 10000 HTG accept exactly one', async () => {
  const db = new FakeFirestore();
  const balanceRef = db.collection('billingBalances').doc('user-a');
  await balanceRef.set({ availableMinor: 1000000, reservedMinor: 0, paidOutMinor: 0 });
  async function attempt(id) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(balanceRef);
      const next = reserveBalance(snap.data(), 800000);
      tx.set(db.collection('billingLedgerEntries').doc(id), { type: 'WITHDRAWAL_RESERVED', amountMinor: 800000 });
      tx.set(balanceRef, next);
      return id;
    });
  }
  const results = await Promise.allSettled([attempt('a'), attempt('b')]);
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(results.filter((x) => x.status === 'rejected').length, 1);
  const finalBalance = (await balanceRef.get()).data();
  assert.equal(finalBalance.availableMinor, 200000);
  assert.equal(finalBalance.reservedMinor, 800000);
});
