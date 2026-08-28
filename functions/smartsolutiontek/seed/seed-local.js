'use strict';

/**
 * Local-only seed script for the SmartSolutionTek shared core.
 *
 * SAFETY GUARD: refuses to run unless FIRESTORE_EMULATOR_HOST is set, so this can
 * never accidentally write test data into the real production Firestore
 * (smartcutservices-9ce54). This script was written but NOT executed in this
 * session — the Firebase Emulator Suite could not be started locally (no Java
 * runtime available in this environment, see SECURITY_MODEL.md §6). Run it with:
 *
 *   firebase emulators:start --only firestore
 *   # in another terminal:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node functions/smartsolutiontek/seed/seed-local.js
 *
 * Every document created here has `seed: true` so it can never be mistaken for
 * real data (per the instruction "les données seed doivent être clairement
 * marquées comme test").
 */

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set. This script must only ' +
    'target the Firebase emulator, never production. Start the emulator first, then set ' +
    'FIRESTORE_EMULATOR_HOST=localhost:8080 (or your configured port) before re-running.');
  process.exit(1);
}

const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'smartsolutiontek-local-emulator' });
const db = admin.firestore();

async function seed() {
  const seedOrgRef = db.collection('organizations').doc('seed-org-1');
  await seedOrgRef.set({
    name: 'Organisation de test (seed)',
    legalName: null,
    ownerUid: 'seed-owner-uid',
    status: 'active',
    kycStatus: 'approved',
    defaultCurrency: 'HTG',
    seed: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await db.collection('organizationMembers').doc('seed-org-1_seed-owner-uid').set({
    organizationId: 'seed-org-1',
    uid: 'seed-owner-uid',
    role: 'creator_owner',
    invitedBy: null,
    status: 'active',
    seed: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await db.collection('platformRoles').doc('seed-platform-admin-uid').set({
    role: 'platform_admin',
    status: 'active',
    seed: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  // A single global commission rule — required before any real payment can be
  // processed (see FINANCIAL_MODEL.md §2: no rate is ever hardcoded). Value is a
  // placeholder for local testing only, NOT a negotiated business figure.
  await db.collection('commissionRules').doc('seed-global-rule').set({
    scope: 'global',
    applicationId: null,
    organizationId: null,
    type: 'percentage',
    value: 10,
    minFee: null,
    maxFee: null,
    partnerShare: 0,
    effectiveFrom: new Date('2020-01-01').toISOString(),
    seed: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: 'seed-script'
  });

  await db.collection('formSchemas').doc('seed-form-1').set({
    organizationId: 'seed-org-1',
    title: 'Formulaire de test (seed)',
    description: 'Formulaire cree par le script de seed local, a usage de test uniquement.',
    logoUrl: null,
    colors: { primary: '#131921', accent: '#FFA41C' },
    fields: [
      { id: 'fullName', type: 'text', label: 'Nom complet', required: true, options: [], order: 0 },
      { id: 'email', type: 'email', label: 'Email', required: true, options: [], order: 1 }
    ],
    pricingType: 'fixed',
    price: 500,
    maxParticipants: 10,
    opensAt: null,
    closesAt: null,
    status: 'published',
    seed: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  console.log('Seed complete. Documents created:');
  console.log('  organizations/seed-org-1');
  console.log('  organizationMembers/seed-org-1_seed-owner-uid');
  console.log('  platformRoles/seed-platform-admin-uid');
  console.log('  commissionRules/seed-global-rule');
  console.log('  formSchemas/seed-form-1');
}

seed().then(() => process.exit(0)).catch((error) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
