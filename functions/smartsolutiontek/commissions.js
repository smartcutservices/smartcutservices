'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { resolveApplicableRule } = require('./lib/commissions');
const { requireBearerUser, requireOrgRole, requirePlatformRole, withErrorHandling, HttpError } = require('./auth');

/**
 * Reads all commissionRules relevant to a given organization/application and
 * resolves the single applicable one via ./lib/commissions.js (pure logic).
 * Never returns a fabricated default rate — a null result means zero commission
 * (see FINANCIAL_MODEL.md §2).
 */
async function resolveActiveRuleFromFirestore(db, { organizationId, applicationId, atDate = new Date() }) {
  const [globalSnap, appSnap, orgSnap] = await Promise.all([
    db.collection('commissionRules').where('scope', '==', 'global').get(),
    db.collection('commissionRules').where('scope', '==', 'application').where('applicationId', '==', applicationId).get(),
    db.collection('commissionRules').where('scope', '==', 'organization').where('organizationId', '==', organizationId).get()
  ]);

  const rules = [...globalSnap.docs, ...appSnap.docs, ...orgSnap.docs].map((doc) => ({ id: doc.id, ...doc.data() }));
  return resolveApplicableRule(rules, { organizationId, applicationId, atDate });
}

function registerCommissionFunctions({ db, sstInternals, region }) {
  /**
   * Creates or updates a commission rule. Global rules: platform_admin only.
   * Organization-scoped rules: platform_admin or finance_admin (see SECURITY_MODEL.md §1).
   * POST { scope, applicationId?, organizationId?, type, value, minFee?, maxFee?, partnerShare?, effectiveFrom }
   */
  const saveCommissionRule = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);

    const scope = String(req.body?.scope || '').trim();
    if (!['global', 'application', 'organization'].includes(scope)) {
      throw new HttpError(400, 'invalid-scope', 'scope doit etre global, application ou organization.');
    }
    if (scope === 'global') {
      await requirePlatformRole(db, decodedUser, ['platform_admin']);
    } else {
      await requirePlatformRole(db, decodedUser, ['platform_admin', 'finance_admin']);
    }

    const type = String(req.body?.type || '').trim();
    if (!['percentage', 'fixed'].includes(type)) {
      throw new HttpError(400, 'invalid-type', 'type doit etre percentage ou fixed.');
    }
    const value = Number(req.body?.value);
    if (!Number.isFinite(value) || value < 0) {
      throw new HttpError(400, 'invalid-value', 'value doit etre un nombre positif.');
    }

    const ruleRef = db.collection('commissionRules').doc();
    await ruleRef.set({
      scope,
      applicationId: scope === 'application' ? String(req.body?.applicationId || '').trim() : null,
      organizationId: scope === 'organization' ? String(req.body?.organizationId || '').trim() : null,
      type,
      value,
      minFee: Number.isFinite(Number(req.body?.minFee)) ? Number(req.body.minFee) : null,
      maxFee: Number.isFinite(Number(req.body?.maxFee)) ? Number(req.body.maxFee) : null,
      partnerShare: Number.isFinite(Number(req.body?.partnerShare)) ? Number(req.body.partnerShare) : 0,
      effectiveFrom: req.body?.effectiveFrom ? new Date(req.body.effectiveFrom).toISOString() : new Date().toISOString(),
      createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
      createdBy: decodedUser.uid
    });

    res.status(200).json({ ok: true, ruleId: ruleRef.id });
  }));

  /** Preview the commission that would apply right now for an organization/application pair. */
  const previewCommission = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.query?.organizationId || '').trim();
    const applicationId = String(req.query?.applicationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const rule = await resolveActiveRuleFromFirestore(db, { organizationId, applicationId });
    res.status(200).json({ ok: true, rule });
  }));

  return { saveCommissionRule, previewCommission };
}

module.exports = { registerCommissionFunctions, resolveActiveRuleFromFirestore };
