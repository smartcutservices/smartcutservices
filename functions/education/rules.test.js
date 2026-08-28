'use strict';

/**
 * Firestore Rules tests for the Smart Cut Education foundation
 * (educationCategories / educationSchools / educationPrograms), against the
 * real Firebase Emulator Suite — same convention as smartsolutiontek/rules.test.js.
 *
 * Run with the emulator already started:
 *   firebase emulators:start --only firestore --project smartcut-rules-test
 * then, in another terminal:
 *   cd functions && node --test education/rules.test.js
 *
 * Not included in `npm test` / `npm run test:education` (which must stay
 * runnable without the emulator) — see the separate `test:education-rules` script.
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
const { setDoc, doc, getDoc, deleteDoc } = require('firebase/firestore');

const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'smartcut-education-rules-test',
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

// ---------- educationSchools ----------

test('an anonymous visitor can read a published school', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'educationSchools', 'school-published'), {
      name: 'Institut NumériTech',
      publicationStatus: 'published',
      verification: { status: 'unverified' }
    });
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'educationSchools', 'school-published')));
});

test('an anonymous visitor cannot read a draft school', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'educationSchools', 'school-draft'), {
      name: 'Brouillon interne',
      publicationStatus: 'draft'
    });
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'educationSchools', 'school-draft')));
});

test('an anonymous visitor cannot read an archived school', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'educationSchools', 'school-archived'), {
      name: 'Ancien etablissement',
      publicationStatus: 'archived'
    });
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'educationSchools', 'school-archived')));
});

test('no client — anonymous or authenticated — can write an educationSchools document directly', async () => {
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(anon, 'educationSchools', 'school-anon-write'), { name: 'x', publicationStatus: 'published' }));

  const authed = testEnv.authenticatedContext('regular-user-uid').firestore();
  await assertFails(setDoc(doc(authed, 'educationSchools', 'school-authed-write'), { name: 'x', publicationStatus: 'published' }));
});

test('an ordinary authenticated user cannot flip their own school verification to "verified"', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'educationSchools', 'school-owned'), {
      name: 'Mon etablissement',
      ownerUid: 'owner-uid',
      publicationStatus: 'published',
      verification: { status: 'unverified' }
    });
  });

  const ownerDb = testEnv.authenticatedContext('owner-uid').firestore();
  await assertFails(setDoc(
    doc(ownerDb, 'educationSchools', 'school-owned'),
    { name: 'Mon etablissement', ownerUid: 'owner-uid', publicationStatus: 'published', verification: { status: 'verified' } },
    { merge: true }
  ));
});

test('no client can delete an educationSchools document', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'educationSchools', 'school-to-delete'), { name: 'x', publicationStatus: 'published' });
  });

  const authed = testEnv.authenticatedContext('regular-user-uid').firestore();
  await assertFails(deleteDoc(doc(authed, 'educationSchools', 'school-to-delete')));
});

// ---------- educationPrograms ----------

test('an anonymous visitor can read a published program', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'educationPrograms', 'program-published'), {
      title: 'Initiation au développement web',
      publicationStatus: 'published'
    });
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'educationPrograms', 'program-published')));
});

test('an anonymous visitor cannot read an archived program', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'educationPrograms', 'program-archived'), {
      title: 'Formation retiree',
      publicationStatus: 'archived'
    });
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'educationPrograms', 'program-archived')));
});

test('an anonymous visitor cannot read a review-stage program', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'educationPrograms', 'program-review'), {
      title: 'En cours de relecture',
      publicationStatus: 'review'
    });
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'educationPrograms', 'program-review')));
});

test('no client can write an educationPrograms document directly', async () => {
  const anon = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(anon, 'educationPrograms', 'program-anon-write'), { title: 'x', publicationStatus: 'published' }));

  const authed = testEnv.authenticatedContext('regular-user-uid').firestore();
  await assertFails(setDoc(doc(authed, 'educationPrograms', 'program-authed-write'), { title: 'x', publicationStatus: 'published' }));
});

test('professional course internals stay server-only', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'educationProgramModules', 'module-1'), { ownerUid: 'owner-uid', programId: 'program-1' });
    await setDoc(doc(db, 'educationProgramLessons', 'lesson-1'), { ownerUid: 'owner-uid', programId: 'program-1' });
  });

  const owner = testEnv.authenticatedContext('owner-uid').firestore();
  await assertFails(getDoc(doc(owner, 'educationProgramModules', 'module-1')));
  await assertFails(getDoc(doc(owner, 'educationProgramLessons', 'lesson-1')));
  await assertFails(setDoc(doc(owner, 'educationProgramAssets', 'asset-1'), { programId: 'program-1' }));
});

// ---------- educationCategories ----------

test('an anonymous visitor can read an active category but not an inactive one', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'educationCategories', 'cat-active'), { name: 'Langues', isActive: true });
    await setDoc(doc(db, 'educationCategories', 'cat-inactive'), { name: 'Retiree', isActive: false });
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'educationCategories', 'cat-active')));
  await assertFails(getDoc(doc(db, 'educationCategories', 'cat-inactive')));
});

test('no client can write an educationCategories document directly', async () => {
  const authed = testEnv.authenticatedContext('regular-user-uid').firestore();
  await assertFails(setDoc(doc(authed, 'educationCategories', 'cat-authed-write'), { name: 'x', isActive: true }));
});

// ---------- No regression on pre-existing rules ----------

test('pre-existing rule is untouched: anonymous read of a product still succeeds', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'products', 'product-1'), { name: 'Produit test', isFeatured: false });
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'products', 'product-1')));
});

test('pre-existing rule is untouched: anonymous write of a product still fails', async () => {
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(setDoc(doc(db, 'products', 'product-anon-write'), { name: 'x' }));
});
