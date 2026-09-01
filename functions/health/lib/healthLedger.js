'use strict';

/**
 * Shared by functions/health/index.js (pharmacy/lab/imaging orders, credited at
 * payment time) and functions/health/clinical.js (doctor appointments, credited only
 * once the consultation actually starts — see healthDoctorUpdateConsultation's
 * IN_PROGRESS transition). Pulled out of index.js into its own module specifically so
 * clinical.js can call it too without a circular require between the two.
 */
const { resolveActiveRuleFromFirestore } = require('../../smartsolutiontek/commissions');
const { applyPaymentToLedger } = require('../../smartsolutiontek/lib/ledger');

async function applyHealthLedger(db, sstInternals, orderId, order) {
  const professionalUid = order?.pharmacyId || order?.providerUid;
  if (!professionalUid || Number(order?.total) <= 0) return;
  const applicationId = order.kind === 'appointment'
    ? (order.providerType === 'laboratory' ? 'health-laboratory'
      : order.providerType === 'imaging' ? 'health-imaging'
        : 'health-doctor')
    : 'health-pharmacy';
  const snapshotRate = Number(order?.commissionRate);
  const rule = Number.isFinite(snapshotRate) && snapshotRate >= 0
    ? { id: `health-snapshot-${orderId}`, scope: 'transaction', type: 'percentage', value: snapshotRate, partnerShare: 0 }
    : await resolveActiveRuleFromFirestore(db, { organizationId: professionalUid, applicationId });
  await applyPaymentToLedger(db, {
    paymentIntentId: `health_${orderId}`,
    organizationId: professionalUid,
    applicationId,
    grossAmount: Number(order.total),
    rule,
    providerFee: 0
  });
}

module.exports = { applyHealthLedger };
