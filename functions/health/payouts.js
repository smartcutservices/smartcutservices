'use strict';

/**
 * Health-professional payout requests. Reuses the exact same payoutRequests/balances
 * collections and admin review/pay Cloud Functions as the rest of the platform
 * (functions/smartsolutiontek/payouts.js's sstReviewPayoutRequest / sstMarkPayoutPaid —
 * both already organization-type-agnostic, so they work unchanged here) — only the
 * *request* endpoint needs its own version, because the generic one gates on
 * sstOrganizations membership, which a health professional (a plain `clients/{uid}`
 * role, never an sstOrganizations member) doesn't have. organizationId is always the
 * professional's own uid, matching how applyHealthLedger already credits balances.
 *
 * Additionally enforces one PAID payout per rolling 30-day window
 * (PAYOUT_COOLDOWN_DAYS) — a Health-specific rule the generic system doesn't have.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { HttpError, requireBearerUser, withErrorHandling } = require('../smartsolutiontek/auth');
const { MIN_PAYOUT_AMOUNT } = require('../smartsolutiontek/payouts');
const { isWithinPayoutCooldown } = require('./lib/validation');

const STATUS_FIELDS = { doctor: 'doctorStatus', pharmacy: 'pharmacyStatus', laboratory: 'labStatus', imaging: 'imagingStatus' };

function buildHealthPayouts(sstInternals) {
  const { db, admin, REGION: region, verifyBearerUser: verifyBearer } = sstInternals;
  const parseBody = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

  async function requireVerifiedProfessional(uid) {
    const snap = await db.collection('clients').doc(uid).get();
    const data = snap.data() || {};
    const isVerified = Object.entries(STATUS_FIELDS).some(([type, field]) => data.role === type && String(data[field] || '').toLowerCase() === 'verified');
    if (!isVerified) throw new HttpError(403, 'professional-not-verified', 'Ce compte professionnel n’est pas vérifié.');
  }

  /** POST { amountRequested, periodKey? } */
  const healthRequestPayout = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    await requireVerifiedProfessional(user.uid);

    const amountRequested = Number(parseBody(req).amountRequested);
    const periodKey = String(parseBody(req).periodKey || '').trim().slice(0, 7);
    if (!Number.isFinite(amountRequested) || amountRequested < MIN_PAYOUT_AMOUNT) {
      throw new HttpError(400, 'amount-below-minimum', `Montant minimum de décaissement : ${MIN_PAYOUT_AMOUNT} HTG.`);
    }

    const balanceSnap = await db.collection('balances').doc(user.uid).get();
    const available = balanceSnap.exists ? Number(balanceSnap.data().availableAmount || 0) : 0;
    if (amountRequested > available) {
      throw new HttpError(400, 'insufficient-balance', `Solde disponible insuffisant (${available} HTG).`);
    }

    const openSnap = await db.collection('payoutRequests')
      .where('organizationId', '==', user.uid).where('status', 'in', ['requested', 'approved']).limit(1).get();
    if (!openSnap.empty) throw new HttpError(409, 'open-payout-request', 'Une demande de décaissement est déjà en cours.');

    if (periodKey) {
      const periodSnap = await db.collection('payoutRequests').where('organizationId', '==', user.uid).get();
      const duplicate = periodSnap.docs.some((item) => item.data()?.periodKey === periodKey && ['requested', 'approved', 'paid'].includes(item.data()?.status));
      if (duplicate) throw new HttpError(409, 'period-already-requested', 'Ce mois a déjà fait l’objet d’une demande de décaissement.');
    }

    // No orderBy here on purpose (avoids requiring a composite index for a per-professional
    // list that stays small) — sorted in memory instead.
    const paidSnap = await db.collection('payoutRequests').where('organizationId', '==', user.uid).where('status', '==', 'paid').get();
    const lastPaidAt = paidSnap.docs
      .map((d) => d.data().updatedAt)
      .map((v) => (v?.toDate ? v.toDate().toISOString() : v))
      .filter(Boolean)
      .sort()
      .pop() || null;
    if (isWithinPayoutCooldown(lastPaidAt)) {
      throw new HttpError(409, 'payout-cooldown', 'Un seul décaissement est possible par période de 30 jours.');
    }

    const requestRef = db.collection('payoutRequests').doc();
    await requestRef.set({
      organizationId: user.uid, amountRequested, periodKey: /^\d{4}-\d{2}$/.test(periodKey) ? periodKey : null, status: 'requested', disbursementMethod: 'manual',
      providerReference: null, requestedBy: user.uid, approvedBy: null, paidBy: null, rejectionReason: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(), updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.status(200).json({ ok: true, payoutRequestId: requestRef.id });
  }));

  return { healthRequestPayout };
}

module.exports = buildHealthPayouts;
