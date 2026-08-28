'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveApplicableRule, calculateAmounts } = require('./commissions');

test('resolveApplicableRule: organization scope wins over application and global', () => {
  const rules = [
    { scope: 'global', value: 5, type: 'percentage', effectiveFrom: '2026-01-01' },
    { scope: 'application', applicationId: 'forms', value: 8, type: 'percentage', effectiveFrom: '2026-01-01' },
    { scope: 'organization', organizationId: 'org1', value: 3, type: 'percentage', effectiveFrom: '2026-01-01' }
  ];
  const rule = resolveApplicableRule(rules, { organizationId: 'org1', applicationId: 'forms' });
  assert.equal(rule.scope, 'organization');
  assert.equal(rule.value, 3);
});

test('resolveApplicableRule: falls back to application scope when no org rule matches', () => {
  const rules = [
    { scope: 'global', value: 5, type: 'percentage', effectiveFrom: '2026-01-01' },
    { scope: 'application', applicationId: 'forms', value: 8, type: 'percentage', effectiveFrom: '2026-01-01' },
    { scope: 'organization', organizationId: 'someone-else', value: 3, type: 'percentage', effectiveFrom: '2026-01-01' }
  ];
  const rule = resolveApplicableRule(rules, { organizationId: 'org1', applicationId: 'forms' });
  assert.equal(rule.scope, 'application');
});

test('resolveApplicableRule: falls back to global scope', () => {
  const rules = [{ scope: 'global', value: 5, type: 'percentage', effectiveFrom: '2026-01-01' }];
  const rule = resolveApplicableRule(rules, { organizationId: 'org1', applicationId: 'forms' });
  assert.equal(rule.scope, 'global');
});

test('resolveApplicableRule: ignores rules not yet in effect', () => {
  const rules = [
    { scope: 'global', value: 5, type: 'percentage', effectiveFrom: '2020-01-01' },
    { scope: 'global', value: 10, type: 'percentage', effectiveFrom: '2099-01-01' }
  ];
  const rule = resolveApplicableRule(rules, { organizationId: 'org1', applicationId: 'forms', atDate: new Date('2026-01-01') });
  assert.equal(rule.value, 5);
});

test('resolveApplicableRule: picks the most recently effective rule among same scope', () => {
  const rules = [
    { scope: 'global', value: 5, type: 'percentage', effectiveFrom: '2024-01-01' },
    { scope: 'global', value: 7, type: 'percentage', effectiveFrom: '2025-06-01' }
  ];
  const rule = resolveApplicableRule(rules, { organizationId: 'org1', applicationId: 'forms', atDate: new Date('2026-01-01') });
  assert.equal(rule.value, 7);
});

test('resolveApplicableRule: returns null when no rule exists', () => {
  assert.equal(resolveApplicableRule([], { organizationId: 'org1', applicationId: 'forms' }), null);
});

test('calculateAmounts: percentage commission with no partner share', () => {
  const rule = { type: 'percentage', value: 10, partnerShare: 0 };
  const result = calculateAmounts(1000, rule);
  assert.deepEqual(result, {
    grossAmount: 1000,
    providerFee: 0,
    smartcutFee: 100,
    partnerFee: 0,
    creatorNet: 900
  });
});

test('calculateAmounts: fixed commission', () => {
  const rule = { type: 'fixed', value: 50 };
  const result = calculateAmounts(1000, rule);
  assert.equal(result.smartcutFee, 50);
  assert.equal(result.creatorNet, 950);
});

test('calculateAmounts: partner share splits the smartcut fee, not the gross amount', () => {
  const rule = { type: 'percentage', value: 10, partnerShare: 20 };
  const result = calculateAmounts(1000, rule);
  assert.equal(result.smartcutFee, 100);
  assert.equal(result.partnerFee, 20); // 20% of the 100 smartcut fee, not of the 1000 gross
  assert.equal(result.creatorNet, 880);
});

test('calculateAmounts: respects minFee and maxFee bounds', () => {
  const low = calculateAmounts(10, { type: 'percentage', value: 5, minFee: 5 });
  assert.equal(low.smartcutFee, 5); // 5% of 10 = 0.5, floored up to minFee 5

  const high = calculateAmounts(100000, { type: 'percentage', value: 10, maxFee: 500 });
  assert.equal(high.smartcutFee, 500); // 10% of 100000 = 10000, capped to maxFee 500
});

test('calculateAmounts: subtracts a known provider fee', () => {
  const rule = { type: 'percentage', value: 10 };
  const result = calculateAmounts(1000, rule, 15);
  assert.equal(result.providerFee, 15);
  assert.equal(result.smartcutFee, 100); // 10% of the full grossAmount, not of (gross - providerFee)
  assert.equal(result.creatorNet, 885); // 1000 - 15 - 100 - 0
});

test('calculateAmounts: null rule means zero commission, never a fabricated default', () => {
  const result = calculateAmounts(1000, null);
  assert.equal(result.smartcutFee, 0);
  assert.equal(result.partnerFee, 0);
  assert.equal(result.creatorNet, 1000);
});

test('calculateAmounts: commission never exceeds the amount left after provider fee', () => {
  // Pathological rule (200%) must not push creatorNet negative below zero commission bound.
  const rule = { type: 'percentage', value: 200 };
  const result = calculateAmounts(100, rule, 10);
  assert.ok(result.smartcutFee <= 90);
  assert.ok(result.creatorNet >= 0);
});

test('calculateAmounts: throws on negative grossAmount', () => {
  assert.throws(() => calculateAmounts(-1, null));
});

test('calculateAmounts: rounds to 2 decimal places', () => {
  const rule = { type: 'percentage', value: 7.5 };
  const result = calculateAmounts(33.33, rule);
  assert.equal(result.smartcutFee, 2.5); // 33.33 * 0.075 = 2.49975 -> 2.5
});
