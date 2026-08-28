'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { requireBearerUser, requireOrgRole, requirePlatformRole, withErrorHandling, HttpError } = require('./auth');
const { applyPayoutToLedger } = require('./lib/ledger');

const MIN_PAYOUT_AMOUNT = 500; // HTG — configurable in a future settings doc, not hardcoded in the ledger math itself.

function registerPayoutFunctions({ db, sstInternals, region }) {
  /**
   * Creator requests a payout of their available balance.
   * Refuses if KYC is not approved (SECURITY_MODEL.md §5) or balance is below minimum.
   * POST { organizationId, amountRequested }
   */
  const createPayoutRequest = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner']);

    const orgSnap = await db.collection('organizations').doc(organizationId).get();
    if (!orgSnap.exists) throw new HttpError(404, 'organization-not-found', 'Organisation introuvable.');
    if (orgSnap.data().kycStatus !== 'approved') {
      throw new HttpError(403, 'kyc-not-approved', 'Verification KYC requise avant un premier decaissement.');
    }

    const amountRequested = Number(req.body?.amountRequested);
    if (!Number.isFinite(amountRequested) || amountRequested < MIN_PAYOUT_AMOUNT) {
      throw new HttpError(400, 'amount-below-minimum', `Montant minimum de decaissement: ${MIN_PAYOUT_AMOUNT} HTG.`);
    }

    const balanceSnap = await db.collection('balances').doc(organizationId).get();
    const available = balanceSnap.exists ? Number(balanceSnap.data().availableAmount || 0) : 0;
    if (amountRequested > available) {
      throw new HttpError(400, 'insufficient-balance', `Solde disponible insuffisant (${available} HTG).`);
    }

    const openSnap = await db.collection('payoutRequests')
      .where('organizationId', '==', organizationId)
      .where('status', 'in', ['requested', 'approved'])
      .limit(1)
      .get();
    if (!openSnap.empty) {
      throw new HttpError(409, 'open-payout-request', 'Une demande de decaissement est deja en cours.');
    }

    const requestRef = db.collection('payoutRequests').doc();
    await requestRef.set({
      organizationId,
      amountRequested,
      status: 'requested',
      disbursementMethod: 'manual',
      providerReference: null,
      requestedBy: decodedUser.uid,
      approvedBy: null,
      paidBy: null,
      rejectionReason: null,
      createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({ ok: true, payoutRequestId: requestRef.id });
  }));

  /** finance_admin/platform_admin approves or rejects a payout request (no money moves yet). */
  const reviewPayoutRequest = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    await requirePlatformRole(db, decodedUser, ['platform_admin', 'finance_admin']);

    const payoutRequestId = String(req.body?.payoutRequestId || '').trim();
    const decision = String(req.body?.decision || '').trim();
    if (!['approve', 'reject'].includes(decision)) {
      throw new HttpError(400, 'invalid-decision', 'decision doit etre approve ou reject.');
    }

    const requestRef = db.collection('payoutRequests').doc(payoutRequestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) throw new HttpError(404, 'payout-request-not-found', 'Demande introuvable.');
    if (requestSnap.data().status !== 'requested') {
      throw new HttpError(409, 'not-pending', 'Cette demande n est plus en attente.');
    }

    if (decision === 'approve') {
      await requestRef.set({
        status: 'approved',
        approvedBy: decodedUser.uid,
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } else {
      const rejectionReason = String(req.body?.rejectionReason || '').trim();
      if (!rejectionReason) throw new HttpError(400, 'rejection-reason-required', 'Raison du rejet requise.');
      await requestRef.set({
        status: 'rejected',
        approvedBy: decodedUser.uid,
        rejectionReason,
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    res.status(200).json({ ok: true });
  }));

  /**
   * finance_admin/platform_admin marks a payout as actually paid, AFTER performing
   * the transfer manually outside this system (see FINANCIAL_MODEL.md §5 — no
   * automated disbursement exists). A providerReference is mandatory; the system
   * refuses to fabricate a paid status without it.
   * POST { payoutRequestId, providerReference }
   */
  const markPayoutPaid = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    await requirePlatformRole(db, decodedUser, ['platform_admin', 'finance_admin']);

    const payoutRequestId = String(req.body?.payoutRequestId || '').trim();
    const providerReference = String(req.body?.providerReference || '').trim();
    if (!providerReference) {
      throw new HttpError(400, 'provider-reference-required', 'Reference du virement effectue requise.');
    }

    const requestRef = db.collection('payoutRequests').doc(payoutRequestId);
    const requestSnap = await requestRef.get();
    if (!requestSnap.exists) throw new HttpError(404, 'payout-request-not-found', 'Demande introuvable.');
    const request = requestSnap.data();
    if (request.status !== 'approved') {
      throw new HttpError(409, 'not-approved', 'Cette demande doit etre approuvee avant d etre marquee payee.');
    }

    let ledgerResult;
    try {
      ledgerResult = await applyPayoutToLedger(db, {
        payoutRequestId,
        organizationId: request.organizationId,
        amount: request.amountRequested,
        providerReference
      });
    } catch (error) {
      if (error.message === 'insufficient-available-balance') {
        throw new HttpError(409, 'insufficient-available-balance', 'Le solde disponible a change depuis la demande.');
      }
      throw error;
    }

    if (ledgerResult.applied) {
      await requestRef.set({
        status: 'paid',
        providerReference,
        paidBy: decodedUser.uid,
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      await db.collection('payouts').doc(payoutRequestId).set({
        payoutRequestId,
        organizationId: request.organizationId,
        amount: request.amountRequested,
        providerReference,
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      });
    }

    res.status(200).json({ ok: true });
  }));

  /**
   * finance_admin/platform_admin confirms a refund was actually issued (manually,
   * outside this system — same honesty constraint as payouts).
   * POST { paymentIntentId, amount, reason }
   */
  const confirmRefund = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    await requirePlatformRole(db, decodedUser, ['platform_admin', 'finance_admin']);

    const paymentIntentId = String(req.body?.paymentIntentId || '').trim();
    const amount = Number(req.body?.amount);
    const reason = String(req.body?.reason || '').trim();
    if (!Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'invalid-amount', 'Montant invalide.');
    if (!reason) throw new HttpError(400, 'reason-required', 'Raison du remboursement requise.');

    const intentRef = db.collection('paymentIntents').doc(paymentIntentId);
    const intentSnap = await intentRef.get();
    if (!intentSnap.exists) throw new HttpError(404, 'payment-intent-not-found', 'Payment intent introuvable.');
    const intent = intentSnap.data();

    const refundRef = db.collection('refunds').doc();
    const balanceRef = db.collection('balances').doc(intent.organizationId);

    const result = await db.runTransaction(async (tx) => {
      const balanceSnap = await tx.get(balanceRef);
      const balance = balanceSnap.exists ? balanceSnap.data() : { pendingAmount: 0, availableAmount: 0, onHoldAmount: 0, paidOutAmount: 0 };
      const recoverableFrom = balance.availableAmount >= amount
        ? 'availableAmount'
        : (balance.pendingAmount >= amount ? 'pendingAmount' : null);

      tx.set(refundRef, {
        paymentIntentId,
        organizationId: intent.organizationId,
        amount,
        reason,
        initiatedBy: decodedUser.uid,
        status: recoverableFrom ? 'confirmed' : 'pending_recovery',
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
        confirmedAt: recoverableFrom ? sstInternals.admin.firestore.FieldValue.serverTimestamp() : null
      });

      if (recoverableFrom) {
        tx.set(balanceRef, {
          ...balance,
          [recoverableFrom]: Math.round((balance[recoverableFrom] - amount) * 100) / 100,
          updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }

      tx.set(db.collection('ledgerEntries').doc(`${paymentIntentId}_refund_${refundRef.id}`), {
        paymentIntentId,
        organizationId: intent.organizationId,
        type: 'refund',
        grossAmount: 0,
        providerFee: 0,
        smartcutFee: 0,
        partnerFee: 0,
        creatorNet: -amount,
        refundedAmount: amount,
        currency: 'HTG',
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      });

      return { recoverableFrom };
    });

    res.status(200).json({
      ok: true,
      status: result.recoverableFrom ? 'confirmed' : 'pending_recovery'
    });
  }));

  return { createPayoutRequest, reviewPayoutRequest, markPayoutPaid, confirmRefund };
}

module.exports = { registerPayoutFunctions, MIN_PAYOUT_AMOUNT };
