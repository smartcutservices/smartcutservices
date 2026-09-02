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

// Smart Cut Health ne stocke aucun résultat d'examen (laboratoire ou imagerie) :
// aucun préfixe health-lab-results/** ni health-imaging-results/**, donc aucun test.

// ---------- Teleconsultation session media (chat photos / voice notes) ----------

test('the patient of a session can upload a photo attachment', async () => {
  const appointmentId = `appt-session-${RUN_ID}`;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(docRef(context.firestore(), 'healthAppointments', appointmentId), {
      patientUid: 'sessionPatient', providerUid: 'sessionDoctor', providerType: 'doctor', status: 'IN_PROGRESS'
    });
  });
  const path = `health-session-media/sessionPatient__${appointmentId}/photo-1.jpg`;
  await assertSucceeds(uploadBytes(ref(testEnv.authenticatedContext('sessionPatient').storage(), path), smallImage, { contentType: 'image/jpeg' }));
});

test('the doctor of a session can upload a photo attachment too', async () => {
  const appointmentId = `appt-session-doc-${RUN_ID}`;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(docRef(context.firestore(), 'healthAppointments', appointmentId), {
      patientUid: 'sessionPatient2', providerUid: 'sessionDoctor2', providerType: 'doctor', status: 'IN_PROGRESS'
    });
  });
  const path = `health-session-media/sessionPatient2__${appointmentId}/photo-1.jpg`;
  await assertSucceeds(uploadBytes(ref(testEnv.authenticatedContext('sessionDoctor2').storage(), path), smallImage, { contentType: 'image/jpeg' }));
});

test('someone outside the session cannot upload or read its media', async () => {
  const appointmentId = `appt-session-outsider-${RUN_ID}`;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(docRef(context.firestore(), 'healthAppointments', appointmentId), {
      patientUid: 'sessionPatient3', providerUid: 'sessionDoctor3', providerType: 'doctor', status: 'IN_PROGRESS'
    });
  });
  const path = `health-session-media/sessionPatient3__${appointmentId}/photo-1.jpg`;
  await assertFails(uploadBytes(ref(testEnv.authenticatedContext('outsider').storage(), path), smallImage, { contentType: 'image/jpeg' }));
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), path), smallImage, { contentType: 'image/jpeg' });
  });
  await assertFails(getBytes(ref(testEnv.authenticatedContext('outsider').storage(), path)));
});

test('a voice note (audio content type) is accepted for a session', async () => {
  const appointmentId = `appt-session-audio-${RUN_ID}`;
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(docRef(context.firestore(), 'healthAppointments', appointmentId), {
      patientUid: 'sessionPatient4', providerUid: 'sessionDoctor4', providerType: 'doctor', status: 'IN_PROGRESS'
    });
  });
  const path = `health-session-media/sessionPatient4__${appointmentId}/voice-1.webm`;
  await assertSucceeds(uploadBytes(ref(testEnv.authenticatedContext('sessionPatient4').storage(), path), smallImage, { contentType: 'audio/webm' }));
});

// ---------- profile photo (public read, owner-only write, unlike everything above) ----------

test('an unauthenticated user cannot upload a profile photo', async () => {
  const storage = testEnv.unauthenticatedContext().storage();
  await assertFails(uploadBytes(ref(storage, `health-profile-photos/photoOwner-${RUN_ID}/photo`), smallImage, { contentType: 'image/jpeg' }));
});

test('the owner can upload their own profile photo', async () => {
  const storage = testEnv.authenticatedContext(`photoOwner-${RUN_ID}`).storage();
  await assertSucceeds(uploadBytes(ref(storage, `health-profile-photos/photoOwner-${RUN_ID}/photo`), smallImage, { contentType: 'image/jpeg' }));
});

test('the owner can overwrite their own profile photo (unlike compliance documents)', async () => {
  const storage = testEnv.authenticatedContext(`photoOwner2-${RUN_ID}`).storage();
  const fileRef = ref(storage, `health-profile-photos/photoOwner2-${RUN_ID}/photo`);
  await assertSucceeds(uploadBytes(fileRef, smallImage, { contentType: 'image/jpeg' }));
  await assertSucceeds(uploadBytes(fileRef, smallImage, { contentType: 'image/jpeg' }));
});

test('someone else cannot upload into another account\'s profile photo path', async () => {
  const storage = testEnv.authenticatedContext(`photoIntruder-${RUN_ID}`).storage();
  await assertFails(uploadBytes(ref(storage, `health-profile-photos/photoOwner-${RUN_ID}/photo`), smallImage, { contentType: 'image/jpeg' }));
});

test('a non-image content type is rejected for a profile photo', async () => {
  const storage = testEnv.authenticatedContext(`photoOwner3-${RUN_ID}`).storage();
  await assertFails(uploadBytes(ref(storage, `health-profile-photos/photoOwner3-${RUN_ID}/photo`), smallPdf, { contentType: 'application/pdf' }));
});

test('an unauthenticated (or any) user can read a profile photo — it is public by design', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), `health-profile-photos/photoReadable-${RUN_ID}/photo`), smallImage, { contentType: 'image/jpeg' });
  });
  const storage = testEnv.unauthenticatedContext().storage();
  await assertSucceeds(getBytes(ref(storage, `health-profile-photos/photoReadable-${RUN_ID}/photo`)));
});
