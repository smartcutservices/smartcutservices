'use strict';

const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');

let env;
test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'smartcutservices-9ce54',
    firestore: {
      rules: fs.readFileSync(path.resolve(__dirname, '../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'paymentLinks', 'pay_test'), {
      reference: 'pay_test',
      amount: 500,
      payerName: 'Donnée privée'
    });
  });
});

test.after(async () => env?.cleanup());

test('payment links stay inaccessible through direct Firestore access', async () => {
  const visitor = env.unauthenticatedContext().firestore();
  const admin = env.authenticatedContext('adminA').firestore();
  await assertFails(getDoc(doc(visitor, 'paymentLinks', 'pay_test')));
  await assertFails(getDoc(doc(admin, 'paymentLinks', 'pay_test')));
});
