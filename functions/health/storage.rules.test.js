'use strict';

/**
 * Storage Rules tests for the Smart Cut Health prescription-upload path — the first
 * genuinely private (non `allow read: if true`) path in ../../storage.rules. Same
 * pattern as functions/smartsolutiontek/storage.rules.test.js (needs BOTH the
 * firestore and storage emulators — the read rule does a cross-service firestore.get()
 * / firestore.exists()).
 *
 * Path shape note: health-prescriptions/{patientUid}__{prescriptionId}/{fileName} uses
 * one composite segment (split with .split('__') inside the rule) rather than two
 * separate templated segments. That's a deliberate workaround, not a stylistic choice
 * — see storage.rules' comment on this match block: the local Storage emulator
 * (firebase-tools 15.12.0 / firebase 12.18.0) does not correctly enforce a condition
 * comparing request.auth.uid against a path variable once a third templated segment
 * sits between it and the file name (verified via isolated repro scripts outside this
 * suite; a 2-variable path evaluates correctly). If a future firebase-tools upgrade
 * fixes this, the two-segment form can be restored and this test suite should still
 * pass unchanged either way.
 *
 * Run with the emulators already started:
 *   firebase emulators:start --only firestore,storage --project smartcutservices-9ce54
 * then, in another terminal:
 *   cd functions && node --test health/storage.rules.test.js
 *
 * Not included in `npm run test:sst` — see the separate `test:health-storage-rules` script.
 */

const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { setDoc, doc: docRef } = require('firebase/firestore');
const { ref, uploadBytes, getBytes } = require('firebase/storage');

const STORAGE_RULES_PATH = path.resolve(__dirname, '../../storage.rules');
const FIRESTORE_RULES_PATH = path.resolve(__dirname, '../../firestore.rules');

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'smartcutservices-9ce54',
    firestore: {
      rules: fs.readFileSync(FIRESTORE_RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 8080
    },
    storage: {
      rules: fs.readFileSync(STORAGE_RULES_PATH, 'utf8'),
      host: '127.0.0.1',
      port: 9199
    }
  });
});

test.after(async () => {
  if (testEnv) await testEnv.cleanup();
});

const smallImage = new Uint8Array([1, 2, 3, 4]);
const smallPdf = new Uint8Array([37, 80, 68, 70, 45]);
const oversized = new Uint8Array(16 * 1024 * 1024);

// The Storage emulator persists uploaded objects across separate `node --test` runs
// within the same emulator process — suffix the prescriptionId half of the composite
// segment (never the patientUid half, which must equal the authenticated uid exactly
// for the rule to evaluate correctly) with a run-scoped id so repeated runs never
// collide with a previous run's objects (same trick as the SmartSolutionTek tests).
const RUN_ID = Date.now();

async function seedRoute(prescriptionId, pharmacyId) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(docRef(context.firestore(), 'healthPrescriptionRoutes', `${prescriptionId}_${pharmacyId}`), { prescriptionId, pharmacyId, status: 'pending' });
  });
}

async function seedAdmin(uid) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(docRef(context.firestore(), 'clients', uid), { role: 'admin' });
  });
}

// ---------- create ----------

test('an unauthenticated user cannot upload a prescription', async () => {
  const storage = testEnv.unauthenticatedContext().storage();
  const fileRef = ref(storage, `health-prescriptions/patientA__rx1-${RUN_ID}/scan.jpg`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'image/jpeg' }));
});

test('a patient can upload their own prescription (image, under the size cap)', async () => {
  const storage = testEnv.authenticatedContext('patientA').storage();
  const fileRef = ref(storage, `health-prescriptions/patientA__rx1-${RUN_ID}/scan.jpg`);
  await assertSucceeds(uploadBytes(fileRef, smallImage, { contentType: 'image/jpeg' }));
});

test('a patient cannot upload into another patient\'s prescription folder', async () => {
  const storage = testEnv.authenticatedContext('patientB').storage();
  const fileRef = ref(storage, `health-prescriptions/patientA__rx-hijack-${RUN_ID}/scan.jpg`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'image/jpeg' }));
});

test('a non-image, non-PDF content type is rejected', async () => {
  const storage = testEnv.authenticatedContext('patientA').storage();
  const fileRef = ref(storage, `health-prescriptions/patientA__rx1-${RUN_ID}/scan.exe`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'application/x-msdownload' }));
});

test('an oversized prescription file is rejected', async () => {
  const storage = testEnv.authenticatedContext('patientA').storage();
  const fileRef = ref(storage, `health-prescriptions/patientA__rx-big-${RUN_ID}/scan.jpg`);
  await assertFails(uploadBytes(fileRef, oversized, { contentType: 'image/jpeg' }));
});

// ---------- read: owner, routed pharmacy, admin, unrelated parties ----------

test('the owning patient can read their own prescription file', async () => {
  const patientStorage = testEnv.authenticatedContext('patientC').storage();
  const uploadRef = ref(patientStorage, `health-prescriptions/patientC__rx-read1-${RUN_ID}/scan.jpg`);
  await uploadBytes(uploadRef, smallImage, { contentType: 'image/jpeg' });
  await assertSucceeds(getBytes(uploadRef));
});

test('a different, unrouted patient cannot read someone else\'s prescription file', async () => {
  const patientStorage = testEnv.authenticatedContext('patientD').storage();
  const uploadRef = ref(patientStorage, `health-prescriptions/patientD__rx-read2-${RUN_ID}/scan.jpg`);
  await uploadBytes(uploadRef, smallImage, { contentType: 'image/jpeg' });

  const intruderStorage = testEnv.authenticatedContext('patientE').storage();
  const intruderRef = ref(intruderStorage, `health-prescriptions/patientD__rx-read2-${RUN_ID}/scan.jpg`);
  await assertFails(getBytes(intruderRef));
});

test('a pharmacy NOT routed to the prescription cannot read the file', async () => {
  const patientStorage = testEnv.authenticatedContext('patientF').storage();
  const uploadRef = ref(patientStorage, `health-prescriptions/patientF__rx-read3-${RUN_ID}/scan.jpg`);
  await uploadBytes(uploadRef, smallImage, { contentType: 'image/jpeg' });

  const pharmacyStorage = testEnv.authenticatedContext('pharmNotRouted').storage();
  const pharmacyRef = ref(pharmacyStorage, `health-prescriptions/patientF__rx-read3-${RUN_ID}/scan.jpg`);
  await assertFails(getBytes(pharmacyRef));
});

test('a pharmacy routed to the prescription CAN read the file', async () => {
  const prescriptionId = `rx-read4-${RUN_ID}`;
  const patientStorage = testEnv.authenticatedContext('patientG').storage();
  const uploadRef = ref(patientStorage, `health-prescriptions/patientG__${prescriptionId}/scan.jpg`);
  await uploadBytes(uploadRef, smallImage, { contentType: 'image/jpeg' });

  await seedRoute(prescriptionId, 'pharmRouted1');

  const pharmacyStorage = testEnv.authenticatedContext('pharmRouted1').storage();
  const pharmacyRef = ref(pharmacyStorage, `health-prescriptions/patientG__${prescriptionId}/scan.jpg`);
  await assertSucceeds(getBytes(pharmacyRef));
});

test('an admin can read any prescription file', async () => {
  const patientStorage = testEnv.authenticatedContext('patientH').storage();
  const uploadRef = ref(patientStorage, `health-prescriptions/patientH__rx-read5-${RUN_ID}/scan.jpg`);
  await uploadBytes(uploadRef, smallImage, { contentType: 'image/jpeg' });

  await seedAdmin('admin1');
  const adminStorage = testEnv.authenticatedContext('admin1').storage();
  const adminRef = ref(adminStorage, `health-prescriptions/patientH__rx-read5-${RUN_ID}/scan.jpg`);
  await assertSucceeds(getBytes(adminRef));
});

test('laboratory result PDF is private to assigned laboratory and patient', async () => {
  const appointmentId = `appt-lab-${RUN_ID}`;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(docRef(context.firestore(), 'healthAppointments', appointmentId), {
      patientUid: 'patientLab', providerUid: 'labAssigned', providerType: 'laboratory', status: 'CONFIRMED'
    });
  });
  const assigned = testEnv.authenticatedContext('labAssigned').storage();
  const path = `health-lab-results/patientLab__${appointmentId}/result.pdf`;
  await assertSucceeds(uploadBytes(ref(assigned, path), smallPdf, { contentType: 'application/pdf' }));
  await assertSucceeds(getBytes(ref(testEnv.authenticatedContext('patientLab').storage(), path)));
  await assertFails(getBytes(ref(testEnv.authenticatedContext('labOther').storage(), path)));
});

test('an unrelated laboratory cannot upload a result for another lab appointment', async () => {
  const appointmentId = `appt-hijack-${RUN_ID}`;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(docRef(context.firestore(), 'healthAppointments', appointmentId), {
      patientUid: 'patientLab2', providerUid: 'labAssigned2', providerType: 'laboratory', status: 'CONFIRMED'
    });
  });
  const path = `health-lab-results/patientLab2__${appointmentId}/result.pdf`;
  await assertFails(uploadBytes(ref(testEnv.authenticatedContext('labOther2').storage(), path), smallPdf, { contentType: 'application/pdf' }));
});
