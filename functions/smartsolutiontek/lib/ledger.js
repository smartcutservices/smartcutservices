'use strict';

/**
 * Transactional ledger + balance update. Firestore-dependent (needs a real `db`
 * from admin.firestore()), but written so the transactional shape can be exercised
 * against the in-memory fake in ./firestoreFake.js for local testing without the
 * Firebase Emulator Suite (see FINANCIAL_MODEL.md §3 and SECURITY_MODEL.md §6 for
 * why the emulator itself could not be run in this environment: no Java runtime).
 *
 * Ledger entries are append-only: this module only ever calls `.create()`-style
 * writes (via `tx.set(ref, data)` on a fresh, deterministic doc ID) for
 * `ledgerEntries`, never `.update()`. Corrections are new entries (type: "refund"
 * or "adjustment"), never edits of an existing entry.
 */

const { calculateAmounts } = require('./commissions');

/**
 * Applies a confirmed payment to the ledger + balance, atomically, and idempotently.
 * Idempotency key: ledgerEntries doc id `${paymentIntentId}_payment` — a second call
 * with the same paymentIntentId is a no-op (returns { applied: false }).
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {{ paymentIntentId: string, organizationId: string, applicationId: string,
 *           grossAmount: number, rule: object|null, providerFee?: number }} input
 */
async function applyPaymentToLedger(db, input) {
  const { paymentIntentId, organizationId, applicationId, grossAmount, rule, providerFee = 0 } = input;
  if (!paymentIntentId) throw new Error('paymentIntentId is required');
  if (!organizationId) throw new Error('organizationId is required');

  const ledgerRef = db.collection('ledgerEntries').doc(`${paymentIntentId}_payment`);
  const balanceRef = db.collection('balances').doc(organizationId);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ledgerRef);
    if (existing.exists) {
      return { applied: false, reason: 'already-applied' };
    }

    const amounts = calculateAmounts(grossAmount, rule, providerFee);
    const balanceSnap = await tx.get(balanceRef);
    const current = balanceSnap.exists ? balanceSnap.data() : {
      pendingAmount: 0, availableAmount: 0, onHoldAmount: 0, paidOutAmount: 0, currency: 'HTG'
    };

    tx.set(ledgerRef, {
      paymentIntentId,
      organizationId,
      applicationId,
      type: 'payment',
      ...amounts,
      refundedAmount: 0,
      currency: 'HTG',
      createdAt: serverTimestampOrNow(db)
    });

    tx.set(balanceRef, {
      ...current,
      pendingAmount: round2(current.pendingAmount + amounts.creatorNet),
      currency: 'HTG',
      updatedAt: serverTimestampOrNow(db)
    }, { merge: true });

    return { applied: true, amounts };
  });
}

/**
 * Moves a payout out of the available balance and records a `payout` ledger entry.
 * Idempotency key: ledgerEntries doc id `${payoutRequestId}_payout`.
 * Refuses (throws) if the requested amount exceeds the current available balance —
 * never lets a balance go negative.
 */
async function applyPayoutToLedger(db, { payoutRequestId, organizationId, amount, providerReference }) {
  if (!payoutRequestId) throw new Error('payoutRequestId is required');
  if (!providerReference) throw new Error('providerReference is required before marking a payout paid');

  const ledgerRef = db.collection('ledgerEntries').doc(`${payoutRequestId}_payout`);
  const balanceRef = db.collection('balances').doc(organizationId);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(ledgerRef);
    if (existing.exists) {
      return { applied: false, reason: 'already-applied' };
    }

    const balanceSnap = await tx.get(balanceRef);
    const current = balanceSnap.exists ? balanceSnap.data() : { availableAmount: 0, pendingAmount: 0, onHoldAmount: 0, paidOutAmount: 0 };

    if (round2(amount) > round2(current.availableAmount)) {
      throw new Error('insufficient-available-balance');
    }

    tx.set(ledgerRef, {
      payoutRequestId,
      organizationId,
      type: 'payout',
      grossAmount: 0,
      providerFee: 0,
      smartcutFee: 0,
      partnerFee: 0,
      creatorNet: -round2(amount),
      refundedAmount: 0,
      currency: 'HTG',
      providerReference,
      createdAt: serverTimestampOrNow(db)
    });

    tx.set(balanceRef, {
      ...current,
      availableAmount: round2(current.availableAmount - amount),
      paidOutAmount: round2((current.paidOutAmount || 0) + amount),
      updatedAt: serverTimestampOrNow(db)
    }, { merge: true });

    return { applied: true };
  });
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function serverTimestampOrNow(db) {
  // Real admin.firestore.FieldValue.serverTimestamp() when available; falls back to
  // a plain Date for the in-memory test fake, which has no FieldValue concept.
  try {
    // eslint-disable-next-line global-require
    const admin = require('firebase-admin');
    if (admin?.firestore?.FieldValue?.serverTimestamp) {
      return admin.firestore.FieldValue.serverTimestamp();
    }
  } catch (_) { /* fall through */ }
  return new Date();
}

module.exports = { applyPaymentToLedger, applyPayoutToLedger };
