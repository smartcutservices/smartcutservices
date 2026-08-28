'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeFirestore } = require('./firestoreFake');
const { applyPaymentToLedger, applyPayoutToLedger } = require('./ledger');

test('applyPaymentToLedger creates a ledger entry and increments pendingAmount', async () => {
  const db = new FakeFirestore();
  const rule = { type: 'percentage', value: 10 };

  const result = await applyPaymentToLedger(db, {
    paymentIntentId: 'pi_1',
    organizationId: 'org1',
    applicationId: 'forms',
    grossAmount: 1000,
    rule
  });

  assert.equal(result.applied, true);
  assert.equal(result.amounts.creatorNet, 900);

  const balance = (await db.collection('balances').doc('org1').get()).data();
  assert.equal(balance.pendingAmount, 900);
  assert.equal(balance.availableAmount, 0);

  const entry = (await db.collection('ledgerEntries').doc('pi_1_payment').get()).data();
  assert.equal(entry.type, 'payment');
  assert.equal(entry.creatorNet, 900);
  assert.equal(entry.grossAmount, 1000);
});

test('applyPaymentToLedger is idempotent: calling twice with the same paymentIntentId only applies once', async () => {
  const db = new FakeFirestore();
  const rule = { type: 'percentage', value: 10 };
  const input = { paymentIntentId: 'pi_dup', organizationId: 'org1', applicationId: 'forms', grossAmount: 1000, rule };

  const first = await applyPaymentToLedger(db, input);
  const second = await applyPaymentToLedger(db, input);

  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(second.reason, 'already-applied');

  const balance = (await db.collection('balances').doc('org1').get()).data();
  assert.equal(balance.pendingAmount, 900, 'balance must not be double-counted on replay');
});

test('applyPaymentToLedger: two different organizations never share a balance', async () => {
  const db = new FakeFirestore();
  const rule = { type: 'percentage', value: 10 };

  await applyPaymentToLedger(db, { paymentIntentId: 'pi_a', organizationId: 'orgA', applicationId: 'forms', grossAmount: 1000, rule });
  await applyPaymentToLedger(db, { paymentIntentId: 'pi_b', organizationId: 'orgB', applicationId: 'forms', grossAmount: 500, rule });

  const balanceA = (await db.collection('balances').doc('orgA').get()).data();
  const balanceB = (await db.collection('balances').doc('orgB').get()).data();
  assert.equal(balanceA.pendingAmount, 900);
  assert.equal(balanceB.pendingAmount, 450);
});

test('applyPaymentToLedger: repeated payments accumulate correctly', async () => {
  const db = new FakeFirestore();
  const rule = { type: 'percentage', value: 10 };

  await applyPaymentToLedger(db, { paymentIntentId: 'pi_1', organizationId: 'org1', applicationId: 'forms', grossAmount: 1000, rule });
  await applyPaymentToLedger(db, { paymentIntentId: 'pi_2', organizationId: 'org1', applicationId: 'forms', grossAmount: 500, rule });

  const balance = (await db.collection('balances').doc('org1').get()).data();
  assert.equal(balance.pendingAmount, 1350); // 900 + 450
});

test('applyPayoutToLedger requires a providerReference', async () => {
  const db = new FakeFirestore();
  await assert.rejects(
    () => applyPayoutToLedger(db, { payoutRequestId: 'req_1', organizationId: 'org1', amount: 100 }),
    /providerReference is required/
  );
});

test('applyPayoutToLedger refuses to pay out more than the available balance', async () => {
  const db = new FakeFirestore();
  // Manually seed a balance with 0 available (payments only move money into pendingAmount).
  await db.collection('balances').doc('org1').set({ pendingAmount: 900, availableAmount: 0, onHoldAmount: 0, paidOutAmount: 0 });

  await assert.rejects(
    () => applyPayoutToLedger(db, { payoutRequestId: 'req_1', organizationId: 'org1', amount: 100, providerReference: 'MC-123' }),
    /insufficient-available-balance/
  );
});

test('applyPayoutToLedger moves money from availableAmount to paidOutAmount and is idempotent', async () => {
  const db = new FakeFirestore();
  await db.collection('balances').doc('org1').set({ pendingAmount: 0, availableAmount: 900, onHoldAmount: 0, paidOutAmount: 0 });

  const first = await applyPayoutToLedger(db, { payoutRequestId: 'req_1', organizationId: 'org1', amount: 900, providerReference: 'MC-123' });
  const second = await applyPayoutToLedger(db, { payoutRequestId: 'req_1', organizationId: 'org1', amount: 900, providerReference: 'MC-123' });

  assert.equal(first.applied, true);
  assert.equal(second.applied, false);

  const balance = (await db.collection('balances').doc('org1').get()).data();
  assert.equal(balance.availableAmount, 0);
  assert.equal(balance.paidOutAmount, 900);
});

test('applyPaymentToLedger with no commission rule credits the full gross amount to the creator', async () => {
  const db = new FakeFirestore();
  const result = await applyPaymentToLedger(db, { paymentIntentId: 'pi_x', organizationId: 'org1', applicationId: 'forms', grossAmount: 250, rule: null });
  assert.equal(result.amounts.creatorNet, 250);
  assert.equal(result.amounts.smartcutFee, 0);
});
