'use strict';

/**
 * Real Storage Rules tests against the Firebase Emulator Suite for the two new
 * SmartSolutionTek form-builder blocks in ../../storage.rules (branding uploads,
 * public file-type form-field uploads). Same pattern as rules.test.js, but needs
 * BOTH the firestore and storage emulators running (the public-upload rule does a
 * cross-service firestore.get() to check the form is published).
 *
 * Run with the emulators already started:
 *   firebase emulators:start --only firestore,storage --project smartcutservices-9ce54
 * then, in another terminal:
 *   cd functions && node --test smartsolutiontek/storage.rules.test.js
 *
 * NOT included in `npm run test:sst` (must stay runnable without the emulator) —
 * see the separate `test:storage-rules` script, mirroring `test:rules`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');
const { setDoc, doc } = require('firebase/firestore');
const { ref, uploadBytes, deleteObject, getBytes } = require('firebase/storage');

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

async function seedForm(formSchemaId, status) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'formSchemas', formSchemaId), {
      organizationId: 'org1',
      status,
      title: 'Test form'
    });
  });
}

async function seedCourse(courseId, status = 'draft') {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'courses', courseId), { organizationId: 'org1', status, title: 'Cours test' });
    await setDoc(doc(context.firestore(), 'organizationMembers', 'org1_creator1'), {
      organizationId: 'org1', uid: 'creator1', role: 'creator_owner', status: 'active'
    });
    await setDoc(doc(context.firestore(), 'organizationMembers', 'org2_otherCreator'), {
      organizationId: 'org2', uid: 'otherCreator', role: 'creator_owner', status: 'active'
    });
  });
}

const smallImage = new Uint8Array([1, 2, 3, 4]);
const pdfBytes = new Uint8Array([1, 2, 3, 4]);
const oversized = new Uint8Array(11 * 1024 * 1024);

// The Storage emulator persists uploaded objects across separate `node --test` runs
// within the same emulator process (unlike Firestore, there is no clearStorage()
// helper in @firebase/rules-unit-testing) — every path used below is suffixed with
// a run-scoped id so repeated runs never collide with a previous run's objects.
const RUN_ID = Date.now();

// ---------- Smart Cut Education ----------

test('education cover is owner-only to write and public to read', async () => {
  const path = `education-public/teacher1/program-${RUN_ID}/cover/photo.png`;
  const ownerRef = ref(testEnv.authenticatedContext('teacher1').storage(), path);
  await assertSucceeds(uploadBytes(ownerRef, smallImage, { contentType: 'image/png' }));
  await assertSucceeds(getBytes(ref(testEnv.unauthenticatedContext().storage(), path)));
  const otherRef = ref(testEnv.authenticatedContext('teacher2').storage(), `education-public/teacher1/program-${RUN_ID}/cover/other.png`);
  await assertFails(uploadBytes(otherRef, smallImage, { contentType: 'image/png' }));
});

test('education lesson media stays private to its professional', async () => {
  const path = `education-content/teacher1/program-${RUN_ID}/media/lesson.pdf`;
  const ownerRef = ref(testEnv.authenticatedContext('teacher1').storage(), path);
  await assertSucceeds(uploadBytes(ownerRef, pdfBytes, { contentType: 'application/pdf' }));
  await assertSucceeds(getBytes(ownerRef));
  await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), path)));
  await assertFails(getBytes(ref(testEnv.authenticatedContext('teacher2').storage(), path)));
});

test('education media rejects an unsupported executable', async () => {
  const storage = testEnv.authenticatedContext('teacher1').storage();
  const fileRef = ref(storage, `education-content/teacher1/program-${RUN_ID}/media/payload.exe`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'application/x-msdownload' }));
});

// ---------- Boutique (Application 2) uploads: signed-in only, same shape as forms branding ----------

test('shop upload is rejected for an unauthenticated user', async () => {
  const storage = testEnv.unauthenticatedContext().storage();
  const fileRef = ref(storage, `sst-shops/shop1-${RUN_ID}/logo.png`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'image/png' }));
});

test('shop upload succeeds for a signed-in user with a valid image under the size cap', async () => {
  const storage = testEnv.authenticatedContext('creator1').storage();
  const fileRef = ref(storage, `sst-shops/shop1-${RUN_ID}/products/prod1/photo.png`);
  await assertSucceeds(uploadBytes(fileRef, smallImage, { contentType: 'image/png' }));
});

// ---------- Nourriture (Application 5) uploads: signed-in only ----------

test('food upload is rejected for an unauthenticated user', async () => {
  const storage = testEnv.unauthenticatedContext().storage();
  const fileRef = ref(storage, `sst-food/menu1-${RUN_ID}/cover.png`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'image/png' }));
});

test('food upload succeeds for a signed-in user with a valid image under the size cap', async () => {
  const storage = testEnv.authenticatedContext('creator1').storage();
  const fileRef = ref(storage, `sst-food/menu1-${RUN_ID}/items/item1/photo.png`);
  await assertSucceeds(uploadBytes(fileRef, smallImage, { contentType: 'image/png' }));
});

// ---------- Cours (Application 3) uploads: signed-in only ----------

test('course branding upload is rejected for an unauthenticated user', async () => {
  await seedCourse(`course1-${RUN_ID}`);
  const storage = testEnv.unauthenticatedContext().storage();
  const fileRef = ref(storage, `sst-courses/course1-${RUN_ID}/branding/cover.png`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'image/png' }));
});

test('course lesson upload succeeds for a signed-in user with a pdf under the 50MB cap', async () => {
  await seedCourse(`course1-${RUN_ID}`);
  const storage = testEnv.authenticatedContext('creator1').storage();
  const fileRef = ref(storage, `sst-courses/course1-${RUN_ID}/lessons/doc.pdf`);
  await assertSucceeds(uploadBytes(fileRef, pdfBytes, { contentType: 'application/pdf' }));
});

test('course lesson upload rejects a disallowed content type', async () => {
  await seedCourse(`course1-${RUN_ID}`);
  const storage = testEnv.authenticatedContext('creator1').storage();
  const fileRef = ref(storage, `sst-courses/course1-${RUN_ID}/lessons/payload.exe`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'application/x-msdownload' }));
});

test('course lesson upload is rejected for a signed-in user from another organization', async () => {
  await seedCourse(`course1-${RUN_ID}`);
  const storage = testEnv.authenticatedContext('otherCreator').storage();
  const fileRef = ref(storage, `sst-courses/course1-${RUN_ID}/lessons/cross-org.pdf`);
  await assertFails(uploadBytes(fileRef, pdfBytes, { contentType: 'application/pdf' }));
});

test('premium course lesson is not publicly readable after upload', async () => {
  await seedCourse(`private-course-${RUN_ID}`, 'published');
  const ownerStorage = testEnv.authenticatedContext('creator1').storage();
  const fileRef = ref(ownerStorage, `sst-courses/private-course-${RUN_ID}/lessons/private.pdf`);
  await assertSucceeds(uploadBytes(fileRef, pdfBytes, { contentType: 'application/pdf' }));
  const publicRef = ref(testEnv.unauthenticatedContext().storage(), `sst-courses/private-course-${RUN_ID}/lessons/private.pdf`);
  await assertFails(getBytes(publicRef));
});

// ---------- Services (Application 4) uploads: signed-in only ----------

test('service photo upload is rejected for an unauthenticated user', async () => {
  const storage = testEnv.unauthenticatedContext().storage();
  const fileRef = ref(storage, `sst-services/svc1-${RUN_ID}/photo.png`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'image/png' }));
});

test('service photo upload succeeds for a signed-in user', async () => {
  const storage = testEnv.authenticatedContext('creator1').storage();
  const fileRef = ref(storage, `sst-services/svc1-${RUN_ID}/photo.png`);
  await assertSucceeds(uploadBytes(fileRef, smallImage, { contentType: 'image/png' }));
});

// ---------- Branding uploads: signed-in only ----------

test('branding upload is rejected for an unauthenticated user', async () => {
  const storage = testEnv.unauthenticatedContext().storage();
  const fileRef = ref(storage, `sst-forms/form1-${RUN_ID}/branding/logo.png`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'image/png' }));
});

test('branding upload succeeds for a signed-in user with a valid image under the size cap', async () => {
  const storage = testEnv.authenticatedContext('creator1').storage();
  const fileRef = ref(storage, `sst-forms/form1-${RUN_ID}/branding/logo.png`);
  await assertSucceeds(uploadBytes(fileRef, smallImage, { contentType: 'image/png' }));
});

test('branding upload rejects a non-image content type', async () => {
  const storage = testEnv.authenticatedContext('creator1').storage();
  const fileRef = ref(storage, `sst-forms/form1-${RUN_ID}/branding/payload.zip`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'application/zip' }));
});

// ---------- Public form-field uploads: gated by the form's Firestore status ----------

test('public upload is rejected when the referenced form does not exist', async () => {
  const storage = testEnv.unauthenticatedContext().storage();
  const fileRef = ref(storage, `sst-form-uploads/missing-form-${RUN_ID}/doc.pdf`);
  await assertFails(uploadBytes(fileRef, pdfBytes, { contentType: 'application/pdf' }));
});

test('public upload is rejected when the referenced form is a draft', async () => {
  const formId = `draft-form-${RUN_ID}`;
  await seedForm(formId, 'draft');
  const storage = testEnv.unauthenticatedContext().storage();
  const fileRef = ref(storage, `sst-form-uploads/${formId}/doc.pdf`);
  await assertFails(uploadBytes(fileRef, pdfBytes, { contentType: 'application/pdf' }));
});

test('public upload succeeds (unauthenticated) when the referenced form is published, image or pdf, under the size cap', async () => {
  const formId = `published-form-${RUN_ID}`;
  await seedForm(formId, 'published');
  const storage = testEnv.unauthenticatedContext().storage();
  const imageRef = ref(storage, `sst-form-uploads/${formId}/photo.png`);
  await assertSucceeds(uploadBytes(imageRef, smallImage, { contentType: 'image/png' }));
  const pdfRef = ref(storage, `sst-form-uploads/${formId}/doc.pdf`);
  await assertSucceeds(uploadBytes(pdfRef, pdfBytes, { contentType: 'application/pdf' }));
});

test('public upload rejects an oversized file even on a published form', async () => {
  const formId = `published-form-2-${RUN_ID}`;
  await seedForm(formId, 'published');
  const storage = testEnv.unauthenticatedContext().storage();
  const fileRef = ref(storage, `sst-form-uploads/${formId}/huge.png`);
  await assertFails(uploadBytes(fileRef, oversized, { contentType: 'image/png' }));
});

test('public upload rejects a disallowed content type on a published form', async () => {
  const formId = `published-form-3-${RUN_ID}`;
  await seedForm(formId, 'published');
  const storage = testEnv.unauthenticatedContext().storage();
  const fileRef = ref(storage, `sst-form-uploads/${formId}/payload.exe`);
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'application/x-msdownload' }));
});

test('a successfully uploaded public form file can never be updated or deleted, even re-created at the same path', async () => {
  const formId = `published-form-4-${RUN_ID}`;
  await seedForm(formId, 'published');
  const storage = testEnv.unauthenticatedContext().storage();
  const fileRef = ref(storage, `sst-form-uploads/${formId}/photo.png`);
  await assertSucceeds(uploadBytes(fileRef, smallImage, { contentType: 'image/png' }));
  await assertFails(deleteObject(fileRef));
  await assertFails(uploadBytes(fileRef, smallImage, { contentType: 'image/png' }));
});
