'use strict';

/**
 * Pure commission-resolution and amount-decomposition logic.
 * No Firestore dependency here on purpose — this module is fully unit-testable
 * with `node --test` and no emulator. Firestore-reading callers live in
 * ../commissions.js (resolveActiveRuleFromFirestore).
 *
 * See FINANCIAL_MODEL.md §2 for the specification this implements.
 */

const SCOPE_PRIORITY = { organization: 3, application: 2, global: 1 };

/**
 * Picks the single most specific commission rule applicable to a payment.
 * @param {Array<object>} rules - candidate commissionRules docs (already fetched),
 *   each shaped like { id, scope, applicationId, organizationId, type, value,
 *   minFee, maxFee, partnerShare, effectiveFrom (ISO string or Date) }.
 * @param {{ organizationId: string, applicationId: string, atDate?: Date }} ctx
 * @returns {object|null} the winning rule, or null if none apply.
 */
function resolveApplicableRule(rules, { organizationId, applicationId, atDate = new Date() }) {
  if (!Array.isArray(rules) || !rules.length) return null;
  const atMs = atDate instanceof Date ? atDate.getTime() : new Date(atDate).getTime();

  const eligible = rules.filter((rule) => {
    if (!rule || typeof rule !== 'object') return false;
    const effectiveFromMs = rule.effectiveFrom instanceof Date
      ? rule.effectiveFrom.getTime()
      : new Date(rule.effectiveFrom).getTime();
    if (Number.isFinite(effectiveFromMs) && effectiveFromMs > atMs) return false;

    if (rule.scope === 'organization') return rule.organizationId === organizationId;
    if (rule.scope === 'application') return rule.applicationId === applicationId;
    if (rule.scope === 'global') return true;
    return false;
  });
  if (!eligible.length) return null;

  eligible.sort((a, b) => {
    const priorityDelta = (SCOPE_PRIORITY[b.scope] || 0) - (SCOPE_PRIORITY[a.scope] || 0);
    if (priorityDelta !== 0) return priorityDelta;
    const aMs = new Date(a.effectiveFrom).getTime();
    const bMs = new Date(b.effectiveFrom).getTime();
    return bMs - aMs;
  });

  return eligible[0];
}

/**
 * Decomposes a gross amount into provider fee / smartcut fee / partner fee / creator net,
 * per the formula in FINANCIAL_MODEL.md §1:
 *   grossAmount - providerFee - smartcutFee - partnerFee = creatorNet
 *
 * @param {number} grossAmount
 * @param {object|null} rule - the resolved commission rule (see resolveApplicableRule), or
 *   null if no rule applies (treated as zero commission — never a fabricated default rate).
 * @param {number} [providerFee] - known provider fee for this transaction, defaults to 0
 *   because MonCash's verification API does not currently return this figure
 *   (see FINANCIAL_MODEL.md §6).
 */
function calculateAmounts(grossAmount, rule, providerFee = 0) {
  if (!Number.isFinite(grossAmount) || grossAmount < 0) {
    throw new Error('grossAmount must be a non-negative finite number');
  }
  if (!Number.isFinite(providerFee) || providerFee < 0) {
    throw new Error('providerFee must be a non-negative finite number');
  }

  let smartcutFee = 0;
  if (rule) {
    if (rule.type === 'percentage') {
      const value = Number(rule.value);
      smartcutFee = grossAmount * (Number.isFinite(value) ? value : 0) / 100;
    } else if (rule.type === 'fixed') {
      const value = Number(rule.value);
      smartcutFee = Number.isFinite(value) ? value : 0;
    }
    const minFee = Number(rule.minFee);
    const maxFee = Number(rule.maxFee);
    if (Number.isFinite(minFee) && smartcutFee < minFee) smartcutFee = minFee;
    if (Number.isFinite(maxFee) && smartcutFee > maxFee) smartcutFee = maxFee;
  }
  smartcutFee = Math.max(0, Math.min(smartcutFee, grossAmount - providerFee));

  const partnerShareRatio = rule && Number.isFinite(Number(rule.partnerShare))
    ? Math.max(0, Math.min(100, Number(rule.partnerShare))) / 100
    : 0;
  const partnerFee = round2(smartcutFee * partnerShareRatio);
  const smartcutFeeRounded = round2(smartcutFee);
  const providerFeeRounded = round2(providerFee);
  const creatorNet = round2(grossAmount - providerFeeRounded - smartcutFeeRounded - partnerFee);

  return {
    grossAmount: round2(grossAmount),
    providerFee: providerFeeRounded,
    smartcutFee: smartcutFeeRounded,
    partnerFee,
    creatorNet
  };
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

module.exports = { resolveApplicableRule, calculateAmounts, round2 };
