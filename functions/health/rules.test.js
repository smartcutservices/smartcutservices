'use strict';

/**
 * Firestore Rules tests for Smart Cut Health — Phase 1 (Pharmacy), against the real
 * Firebase Emulator Suite. Same convention as functions/education/rules.test.js and
 * functions/smartsolutiontek/rules.test.js.
 *
 * Run with the emulator already started:
 *   firebase emulators:start --only firestore --project smartcut-health-rules-test
 * then, in another terminal:
 *   cd functions && node --test health/rules.test.js
 *
 * Not included in `npm test` (must stay runnable without the emulator) — see the
 * separate `test:health-rules` script.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} = require('@firebase/rules-unit-testing');
const { setDoc, doc, getDoc, updateDoc } = require('firebase/firestore');

const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'smartcut-health-rules-test',
    firestore: {
      rules: fs.readFileSync(RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080
    }
  });
});

test.after(async () => {
  if (testEnv) await testEnv.cleanup();
});

async function seed(setupFn) {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setupFn(context.firestore());
  });
}

// ---------- Self-verification is blocked (clients/{uid}.pharmacyStatus) ----------

test('a pharmacy cannot set its own pharmacyStatus to verified', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'clients', 'pharm1'), { role: 'pharmacy', pharmacyStatus: 'pending', name: 'Pharmacie Test' });
  });
  const db = testEnv.authenticatedContext('pharm1').firestore();
  await assertFails(updateDoc(doc(db, 'clients', 'pharm1'), { pharmacyStatus: 'verified' }));
});

test('a pharmacy can still update its own non-Health fields', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'clients', 'pharm1'), { role: 'pharmacy', pharmacyStatus: 'pending', name: 'Pharmacie Test', phone: '' });
  });
  const db = testEnv.authenticatedContext('pharm1').firestore();
  await assertSucceeds(updateDoc(doc(db, 'clients', 'pharm1'), { phone: '+50912345678' }));
});

test('an admin CAN set pharmacyStatus to verified', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'clients', 'admin1'), { role: 'admin' });
    await setDoc(doc(db, 'clients', 'pharm1'), { role: 'pharmacy', pharmacyStatus: 'pending' });
  });
  const db = testEnv.authenticatedContext('admin1').firestore();
  await assertSucceeds(updateDoc(doc(db, 'clients', 'pharm1'), { pharmacyStatus: 'verified' }));
});

// ---------- Prescription isolation (patient A cannot see patient B's) ----------

test('a patient can read their own prescription', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthPrescriptions', 'rx1'), { patientUid: 'patientA', status: 'RECEIVED' });
  });
  const db = testEnv.authenticatedContext('patientA').firestore();
  await assertSucceeds(getDoc(doc(db, 'healthPrescriptions', 'rx1')));
});

test('a different patient CANNOT read someone else\'s prescription', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthPrescriptions', 'rx1'), { patientUid: 'patientA', status: 'RECEIVED' });
  });
  const db = testEnv.authenticatedContext('patientB').firestore();
  await assertFails(getDoc(doc(db, 'healthPrescriptions', 'rx1')));
});

test('a pharmacy NOT routed to a prescription cannot read it', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthPrescriptions', 'rx1'), { patientUid: 'patientA', status: 'RECEIVED' });
  });
  const db = testEnv.authenticatedContext('pharmNotRouted').firestore();
  await assertFails(getDoc(doc(db, 'healthPrescriptions', 'rx1')));
});

test('a pharmacy routed to a prescription CAN read it', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthPrescriptions', 'rx1'), { patientUid: 'patientA', status: 'RECEIVED' });
    await setDoc(doc(db, 'healthPrescriptionRoutes', 'rx1_pharm1'), { prescriptionId: 'rx1', pharmacyId: 'pharm1', status: 'pending' });
  });
  const db = testEnv.authenticatedContext('pharm1').firestore();
  await assertSucceeds(getDoc(doc(db, 'healthPrescriptions', 'rx1')));
});

test('nobody can write a prescription directly — not even the owning patient', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthPrescriptions', 'rx1'), { patientUid: 'patientA', status: 'RECEIVED' });
  });
  const db = testEnv.authenticatedContext('patientA').firestore();
  await assertFails(updateDoc(doc(db, 'healthPrescriptions', 'rx1'), { status: 'PAID' }));
});

// ---------- Medicine catalog: public read, Admin-SDK-only write ----------

test('anyone (even unauthenticated) can read a medicine listing', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthPharmacyProducts', 'med1'), { pharmacyId: 'pharm1', name: 'Amoxicilline', price: 250, stock: 10 });
  });
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'healthPharmacyProducts', 'med1')));
});

test('even the owning pharmacy cannot write a medicine listing directly (must go through healthSaveMedicine)', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthPharmacyProducts', 'med1'), { pharmacyId: 'pharm1', name: 'Amoxicilline', price: 250, stock: 10 });
  });
  const db = testEnv.authenticatedContext('pharm1').firestore();
  await assertFails(updateDoc(doc(db, 'healthPharmacyProducts', 'med1'), { price: 1 }));
});

// ---------- Order isolation ----------

test('a patient can read their own order', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthOrders', 'order1'), { patientUid: 'patientA', pharmacyId: 'pharm1', status: 'PAYMENT_PENDING' });
  });
  const db = testEnv.authenticatedContext('patientA').firestore();
  await assertSucceeds(getDoc(doc(db, 'healthOrders', 'order1')));
});

test('a different patient cannot read someone else\'s order', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthOrders', 'order1'), { patientUid: 'patientA', pharmacyId: 'pharm1', status: 'PAYMENT_PENDING' });
  });
  const db = testEnv.authenticatedContext('patientB').firestore();
  await assertFails(getDoc(doc(db, 'healthOrders', 'order1')));
});

test('the owning pharmacy can read the order', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthOrders', 'order1'), { patientUid: 'patientA', pharmacyId: 'pharm1', status: 'PAYMENT_PENDING' });
  });
  const db = testEnv.authenticatedContext('pharm1').firestore();
  await assertSucceeds(getDoc(doc(db, 'healthOrders', 'order1')));
});

test('a different pharmacy cannot read someone else\'s order', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthOrders', 'order1'), { patientUid: 'patientA', pharmacyId: 'pharm1', status: 'PAYMENT_PENDING' });
  });
  const db = testEnv.authenticatedContext('pharm2').firestore();
  await assertFails(getDoc(doc(db, 'healthOrders', 'order1')));
});

// ---------- Applications ----------

test('a signed-in user can create their own pharmacy application', async () => {
  const db = testEnv.authenticatedContext('applicant1').firestore();
  await assertSucceeds(setDoc(doc(db, 'pharmacyApplications', 'applicant1'), { businessName: 'Ma Pharmacie', status: 'pending' }));
});

test('a non-admin cannot update someone else\'s pharmacy application', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'pharmacyApplications', 'applicant1'), { businessName: 'Ma Pharmacie', status: 'pending' });
  });
  const db = testEnv.authenticatedContext('applicant2').firestore();
  await assertFails(updateDoc(doc(db, 'pharmacyApplications', 'applicant1'), { status: 'approved' }));
});

test('a different signed-in user cannot read a pharmacy application', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'pharmacyApplications', 'applicant1'), { businessName: 'Ma Pharmacie', status: 'pending' });
  });
  const db = testEnv.authenticatedContext('applicant2').firestore();
  await assertFails(getDoc(doc(db, 'pharmacyApplications', 'applicant1')));
});

test('a doctor cannot self-verify through clients', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'clients', 'doctor1'), { role: 'doctor', doctorStatus: 'pending' });
  });
  const db = testEnv.authenticatedContext('doctor1').firestore();
  await assertFails(updateDoc(doc(db, 'clients', 'doctor1'), { doctorStatus: 'verified' }));
});

test('appointment is readable only by its patient and provider', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthAppointments', 'appt1'), { patientUid: 'patientA', providerUid: 'doctor1', status: 'CONFIRMED' });
  });
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('patientA').firestore(), 'healthAppointments', 'appt1')));
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('doctor1').firestore(), 'healthAppointments', 'appt1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('doctor2').firestore(), 'healthAppointments', 'appt1')));
});

test('lab result is isolated from unrelated users', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'healthLabResults', 'result1'), { patientUid: 'patientA', laboratoryId: 'lab1', storagePath: 'private' });
  });
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('patientA').firestore(), 'healthLabResults', 'result1')));
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('lab1').firestore(), 'healthLabResults', 'result1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('patientB').firestore(), 'healthLabResults', 'result1')));
});

test('verified Health professional reads only their own reused ledger balance', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'clients', 'pharmLedger'), { role: 'pharmacy', pharmacyStatus: 'verified' });
    await setDoc(doc(db, 'clients', 'pharmOther'), { role: 'pharmacy', pharmacyStatus: 'verified' });
    await setDoc(doc(db, 'balances', 'pharmLedger'), { pendingAmount: 100, currency: 'HTG' });
    await setDoc(doc(db, 'ledgerEntries', 'health_order_payment'), { organizationId: 'pharmLedger', applicationId: 'health-pharmacy', grossAmount: 100 });
  });
  const ownDb = testEnv.authenticatedContext('pharmLedger').firestore();
  const otherDb = testEnv.authenticatedContext('pharmOther').firestore();
  await assertSucceeds(getDoc(doc(ownDb, 'balances', 'pharmLedger')));
  await assertSucceeds(getDoc(doc(ownDb, 'ledgerEntries', 'health_order_payment')));
  await assertFails(getDoc(doc(otherDb, 'balances', 'pharmLedger')));
  await assertFails(getDoc(doc(otherDb, 'ledgerEntries', 'health_order_payment')));
});
