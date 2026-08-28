'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validatePaymentResource } = require('./paymentDomain');

const resolver = { applicationId: 'courses', computeAmount: (resource) => resource.amountDue };

test('payment amount always comes from the resource', () => {
  assert.deepEqual(validatePaymentResource({ organizationId: 'org', amountDue: 850 }, { organizationId: 'org', applicationId: 'courses' }, resolver), { amount: 850 });
});

test('payment rejects resource and organization mismatch', () => {
  assert.throws(() => validatePaymentResource({ organizationId: 'other', amountDue: 850 }, { organizationId: 'org', applicationId: 'courses' }, resolver), { code: 'resource-organization-mismatch' });
});

test('payment rejects resource and application mismatch', () => {
  assert.throws(() => validatePaymentResource({ organizationId: 'org', amountDue: 850 }, { organizationId: 'org', applicationId: 'shops' }, resolver), { code: 'resource-application-mismatch' });
});

test('payment rejects free, negative and invalid amounts', () => {
  for (const amountDue of [0, -1, NaN]) {
    assert.throws(() => validatePaymentResource({ organizationId: 'org', amountDue }, { organizationId: 'org', applicationId: 'courses' }, resolver), { code: 'nothing-to-pay' });
  }
});
