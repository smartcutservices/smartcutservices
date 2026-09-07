'use strict';
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { setDoc, doc, getDoc, updateDoc, addDoc, collection } = require('firebase/firestore');

let env;
test.before(async () => {
  env = await initializeTestEnvironment({ projectId: 'smartcutservices-9ce54', firestore: { rules: fs.readFileSync(path.resolve(__dirname, '../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 } });
});
test.after(async () => env?.cleanup());

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'clients', 'adminA'), { role: 'admin' });
    await setDoc(doc(db, 'products', 'productA'), { status: 'active', affiliateEligible: true, name: 'Produit A' });
    await setDoc(doc(db, 'affiliateDepartmentRates', 'digital'), { id: 'digital', label: 'Digital', affiliateCommissionRate: 5, customerDiscountRate: 2, active: true });
    await setDoc(doc(db, 'affiliateAccounts', 'affiliateA'), { userId: 'affiliateA', status: 'ACTIVE' });
    await setDoc(doc(db, 'affiliateAccounts', 'affiliateB'), { userId: 'affiliateB', status: 'ACTIVE' });
    await setDoc(doc(db, 'affiliateLinks', 'linkA'), { affiliateId: 'affiliateA', productId: 'productA', status: 'ACTIVE' });
    await setDoc(doc(db, 'affiliateCommissions', 'commissionA'), { affiliateId: 'affiliateA', status: 'PENDING', commissionAmount: 250 });
  });
}

test('public rates are readable but only admin can edit them', async () => {
  await seed();
  const visitor = env.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(visitor, 'affiliateDepartmentRates', 'digital')));
  await assertFails(updateDoc(doc(visitor, 'affiliateDepartmentRates', 'digital'), { customerDiscountRate: 3 }));
  await assertSucceeds(updateDoc(doc(env.authenticatedContext('adminA').firestore(), 'affiliateDepartmentRates', 'digital'), { customerDiscountRate: 3 }));
});

test('applications and seller settings are owner-scoped', async () => {
  await seed();
  const a = env.authenticatedContext('affiliateA').firestore();
  const b = env.authenticatedContext('affiliateB').firestore();
  await assertSucceeds(addDoc(collection(a, 'affiliateApplications'), { userId: 'affiliateA', status: 'PENDING' }));
  await assertFails(addDoc(collection(a, 'affiliateApplications'), { userId: 'affiliateB', status: 'PENDING' }));
  await assertSucceeds(setDoc(doc(a, 'sellerAffiliateSettings', 'affiliateA'), { vendorId: 'affiliateA', enabled: true }));
  await assertFails(getDoc(doc(b, 'sellerAffiliateSettings', 'affiliateA')));
});

test('affiliate data is private and commissions are admin-reviewed', async () => {
  await seed();
  const a = env.authenticatedContext('affiliateA').firestore();
  const b = env.authenticatedContext('affiliateB').firestore();
  await assertSucceeds(getDoc(doc(a, 'affiliateLinks', 'linkA')));
  await assertFails(getDoc(doc(b, 'affiliateLinks', 'linkA')));
  await assertFails(updateDoc(doc(a, 'affiliateCommissions', 'commissionA'), { status: 'AVAILABLE' }));
  await assertSucceeds(updateDoc(doc(env.authenticatedContext('adminA').firestore(), 'affiliateCommissions', 'commissionA'), { status: 'AVAILABLE' }));
});
