'use strict';

/**
 * Real Firestore Rules tests against the Firebase Emulator Suite — the tests that
 * TEST_REPORT.md previously listed as blocked (no Java runtime available). Java 21
 * has since been installed and the emulator confirmed running on 127.0.0.1:8080
 * before this file is run (see GUIDE_SMARTSOLUTIONTEK.md for the exact commands).
 *
 * Run with the emulator already started:
 *   firebase emulators:start --only firestore --project smartcutservices-9ce54
 * then, in another terminal:
 *   cd functions && node --test smartsolutiontek/rules.test.js
 *
 * This file is intentionally NOT included in `npm run test:sst` (which must stay
 * runnable without the emulator) — see the separate `test:rules` script.
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
const { setDoc, doc, getDoc, getDocs, collection, deleteDoc, query, where } = require('firebase/firestore');

const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');

let testEnv;

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'smartcut-rules-test',
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

// ---------- Multi-tenant isolation ----------

test('a member of org A cannot read org B organizationMembers', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_uidA'), { organizationId: 'orgA', uid: 'uidA', role: 'creator_owner', status: 'active' });
    await setDoc(doc(db, 'organizationMembers', 'orgB_uidB'), { organizationId: 'orgB', uid: 'uidB', role: 'creator_owner', status: 'active' });
  });

  const uidAContext = testEnv.authenticatedContext('uidA');
  const db = uidAContext.firestore();

  await assertSucceeds(getDoc(doc(db, 'organizationMembers', 'orgA_uidA')));
  await assertFails(getDoc(doc(db, 'organizationMembers', 'orgB_uidB')));
});

test('a member of org A cannot read org B paymentIntents (financial isolation)', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_uidA'), { organizationId: 'orgA', uid: 'uidA', role: 'creator_owner', status: 'active' });
    await setDoc(doc(db, 'paymentIntents', 'intentA'), { organizationId: 'orgA', grossAmount: 1000, status: 'paid' });
    await setDoc(doc(db, 'paymentIntents', 'intentB'), { organizationId: 'orgB', grossAmount: 5000, status: 'paid' });
  });

  const db = testEnv.authenticatedContext('uidA').firestore();
  await assertSucceeds(getDoc(doc(db, 'paymentIntents', 'intentA')));
  await assertFails(getDoc(doc(db, 'paymentIntents', 'intentB')));
});

test('a member of org A cannot read org B ledgerEntries or balances', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_uidA'), { organizationId: 'orgA', uid: 'uidA', role: 'creator_owner', status: 'active' });
    await setDoc(doc(db, 'ledgerEntries', 'entryB'), { organizationId: 'orgB', type: 'payment', creatorNet: 900 });
    await setDoc(doc(db, 'balances', 'orgB'), { organizationId: 'orgB', availableAmount: 5000 });
  });

  const db = testEnv.authenticatedContext('uidA').firestore();
  await assertFails(getDoc(doc(db, 'ledgerEntries', 'entryB')));
  await assertFails(getDoc(doc(db, 'balances', 'orgB')));
});

test('a member of org A cannot read org B draft formSchemas, but can read org B PUBLISHED formSchemas', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_uidA'), { organizationId: 'orgA', uid: 'uidA', role: 'creator_owner', status: 'active' });
    await setDoc(doc(db, 'formSchemas', 'draftB'), { organizationId: 'orgB', status: 'draft', title: 'Brouillon prive' });
    await setDoc(doc(db, 'formSchemas', 'publishedB'), { organizationId: 'orgB', status: 'published', title: 'Formulaire public' });
  });

  const db = testEnv.authenticatedContext('uidA').firestore();
  await assertFails(getDoc(doc(db, 'formSchemas', 'draftB')));
  await assertSucceeds(getDoc(doc(db, 'formSchemas', 'publishedB')));
});

test('an unauthenticated visitor can read a published form but not a draft one', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'formSchemas', 'draft1'), { organizationId: 'orgA', status: 'draft', title: 'Brouillon' });
    await setDoc(doc(db, 'formSchemas', 'published1'), { organizationId: 'orgA', status: 'published', title: 'Publie' });
  });

  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'formSchemas', 'published1')));
  await assertFails(getDoc(doc(db, 'formSchemas', 'draft1')));
});

// ---------- Role-scoped read restrictions within the SAME organization ----------

test('creator_staff cannot read their own organization balances (owner/manager only)', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_staffUid'), { organizationId: 'orgA', uid: 'staffUid', role: 'creator_staff', status: 'active' });
    await setDoc(doc(db, 'balances', 'orgA'), { organizationId: 'orgA', availableAmount: 1000 });
  });

  const db = testEnv.authenticatedContext('staffUid').firestore();
  await assertFails(getDoc(doc(db, 'balances', 'orgA')));
});

test('creator_owner CAN read their own organization balance', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_ownerUid'), { organizationId: 'orgA', uid: 'ownerUid', role: 'creator_owner', status: 'active' });
    await setDoc(doc(db, 'balances', 'orgA'), { organizationId: 'orgA', availableAmount: 1000 });
  });

  const db = testEnv.authenticatedContext('ownerUid').firestore();
  await assertSucceeds(getDoc(doc(db, 'balances', 'orgA')));
});

test('a disabled member cannot read their former organization data', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_disabledUid'), { organizationId: 'orgA', uid: 'disabledUid', role: 'creator_owner', status: 'disabled' });
    await setDoc(doc(db, 'balances', 'orgA'), { organizationId: 'orgA', availableAmount: 1000 });
  });

  const db = testEnv.authenticatedContext('disabledUid').firestore();
  await assertFails(getDoc(doc(db, 'balances', 'orgA')));
});

// ---------- Write locks on financial/money-moving collections ----------

test('a client can NEVER write directly to ledgerEntries, even as the organization owner', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_ownerUid'), { organizationId: 'orgA', uid: 'ownerUid', role: 'creator_owner', status: 'active' });
  });

  const db = testEnv.authenticatedContext('ownerUid').firestore();
  await assertFails(setDoc(doc(db, 'ledgerEntries', 'forged'), { organizationId: 'orgA', type: 'payment', creatorNet: 999999 }));
});

test('a client can NEVER write directly to balances (would let a user fabricate their own balance)', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_ownerUid'), { organizationId: 'orgA', uid: 'ownerUid', role: 'creator_owner', status: 'active' });
  });

  const db = testEnv.authenticatedContext('ownerUid').firestore();
  await assertFails(setDoc(doc(db, 'balances', 'orgA'), { organizationId: 'orgA', availableAmount: 999999 }));
});

test('a client can NEVER write directly to paymentIntents (amounts must always come from the server)', async () => {
  const db = testEnv.authenticatedContext('anyUid').firestore();
  await assertFails(setDoc(doc(db, 'paymentIntents', 'forged'), { organizationId: 'orgA', grossAmount: 1, status: 'paid' }));
});

test('a client cannot forge a payoutRequests write (creation is Cloud-Function-only)', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_ownerUid'), { organizationId: 'orgA', uid: 'ownerUid', role: 'creator_owner', status: 'active' });
  });
  const db = testEnv.authenticatedContext('ownerUid').firestore();
  await assertFails(setDoc(doc(db, 'payoutRequests', 'forged'), { organizationId: 'orgA', amountRequested: 999999, status: 'paid' }));
});

// ---------- Platform roles ----------

test('a regular user cannot read another user platformRoles document', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'platformRoles', 'adminUid'), { role: 'platform_admin', status: 'active' });
  });
  const db = testEnv.authenticatedContext('someOtherUid').firestore();
  await assertFails(getDoc(doc(db, 'platformRoles', 'adminUid')));
});

test('a platform_admin can read any organization (cross-tenant, by design, for the admin dashboard)', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'platformRoles', 'adminUid'), { role: 'platform_admin', status: 'active' });
    await setDoc(doc(db, 'organizations', 'orgA'), { name: 'Org A', ownerUid: 'someone', status: 'active', kycStatus: 'approved' });
  });
  const db = testEnv.authenticatedContext('adminUid').firestore();
  await assertSucceeds(getDoc(doc(db, 'organizations', 'orgA')));
});

// ---------- Protected course content (spec requirement: never expose protected files/videos) ----------

test('lessons collection is never directly readable by an unenrolled client (must go through sstGetPublicCourse)', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'lessons', 'lesson1'), { organizationId: 'orgA', courseId: 'course1', title: 'Secret', content: 'https://private-video-url.example/secret.mp4', isFreePreview: false });
  });
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'lessons', 'lesson1')));
});

test('enrollments are readable by the student themselves, not by an unrelated user', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'enrollments', 'enroll1'), { organizationId: 'orgA', courseId: 'course1', studentUid: 'studentUid', status: 'confirmed' });
  });
  const ownDb = testEnv.authenticatedContext('studentUid').firestore();
  const otherDb = testEnv.authenticatedContext('someoneElse').firestore();
  await assertSucceeds(getDoc(doc(ownDb, 'enrollments', 'enroll1')));
  await assertFails(getDoc(doc(otherDb, 'enrollments', 'enroll1')));
});

test('lesson progress is readable only by its student or an authorized course team member', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_staffUid'), { organizationId: 'orgA', uid: 'staffUid', role: 'creator_staff', status: 'active' });
    await setDoc(doc(db, 'lessonProgress', 'student_course_lesson'), { organizationId: 'orgA', courseId: 'course', lessonId: 'lesson', studentUid: 'studentUid', completed: true });
  });
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('studentUid').firestore(), 'lessonProgress', 'student_course_lesson')));
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('staffUid').firestore(), 'lessonProgress', 'student_course_lesson')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('otherUid').firestore(), 'lessonProgress', 'student_course_lesson')));
});

test('clients cannot forge course progress or audit logs', async () => {
  const db = testEnv.authenticatedContext('studentUid').firestore();
  await assertFails(setDoc(doc(db, 'courseProgress', 'forged'), { organizationId: 'orgA', studentUid: 'studentUid', completionPercentage: 100 }));
  await assertFails(setDoc(doc(db, 'courseAuditLogs', 'forged'), { organizationId: 'orgA', actorUid: 'studentUid', action: 'course.published' }));
});

test('course analytics are manager-readable but never directly client-writable', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_manager'), { organizationId: 'orgA', uid: 'manager', role: 'creator_manager', status: 'active' });
    await setDoc(doc(db, 'organizationMembers', 'orgA_staff'), { organizationId: 'orgA', uid: 'staff', role: 'creator_staff', status: 'active' });
    await setDoc(doc(db, 'courseAnalyticsEvents', 'event1'), { organizationId: 'orgA', courseId: 'course1', eventType: 'page_view' });
  });
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('manager').firestore(), 'courseAnalyticsEvents', 'event1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('staff').firestore(), 'courseAnalyticsEvents', 'event1')));
  await assertFails(setDoc(doc(testEnv.unauthenticatedContext().firestore(), 'courseAnalyticsEvents', 'forged'), { organizationId: 'orgA', eventType: 'page_view' }));
});

test('refund requests are visible to their learner and managers but cannot be forged directly', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'organizationMembers', 'orgA_manager'), { organizationId: 'orgA', uid: 'manager', role: 'creator_manager', status: 'active' });
    await setDoc(doc(db, 'courseRefundRequests', 'refund1'), { organizationId: 'orgA', courseId: 'course1', studentUid: 'student', status: 'requested' });
  });
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('student').firestore(), 'courseRefundRequests', 'refund1')));
  await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('manager').firestore(), 'courseRefundRequests', 'refund1')));
  await assertFails(getDoc(doc(testEnv.authenticatedContext('other').firestore(), 'courseRefundRequests', 'refund1')));
  await assertFails(setDoc(doc(testEnv.authenticatedContext('student').firestore(), 'courseRefundRequests', 'forged'), { organizationId: 'orgA', studentUid: 'student', status: 'approved' }));
});

// ---------- Existing (pre-SmartSolutionTek) collections still behave as before ----------

test('the pre-existing admin-only catch-all still protects an arbitrary unlisted collection', async () => {
  const db = testEnv.authenticatedContext('anyUid').firestore();
  await assertFails(getDoc(doc(db, 'someRandomCollectionNeverListedInRules', 'doc1')));
});

test('products remain publicly readable (pre-existing storefront behavior, unaffected by the new rules)', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'products', 'prod1'), { name: 'Test product', price: 100 });
  });
  const db = testEnv.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(db, 'products', 'prod1')));
});

// ---------- SmartCut Facturation: isolation et finance Admin-SDK only ----------

test('billing owner A cannot read client, proforma, invoice, payment or withdrawal of B', async () => {
  await seed(async (db) => {
    for (const collectionName of ['billingClients', 'billingProformas', 'billingInvoices', 'billingPayments', 'billingWithdrawals']) {
      await setDoc(doc(db, collectionName, `${collectionName}-b`), { ownerUid: 'uidB', status: 'PAID' });
    }
  });
  const db = testEnv.authenticatedContext('uidA').firestore();
  for (const collectionName of ['billingClients', 'billingProformas', 'billingInvoices', 'billingPayments', 'billingWithdrawals']) {
    await assertFails(getDoc(doc(db, collectionName, `${collectionName}-b`)));
  }
});

test('billing owner can read own operational data but cannot write it directly', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'billingProformas', 'pf-a'), { ownerUid: 'uidA', status: 'SENT', totalMinor: 1000000 });
    await setDoc(doc(db, 'billingBalances', 'uidA'), { availableMinor: 1000000, reservedMinor: 0 });
  });
  const db = testEnv.authenticatedContext('uidA').firestore();
  await assertSucceeds(getDoc(doc(db, 'billingProformas', 'pf-a')));
  await assertSucceeds(getDoc(doc(db, 'billingBalances', 'uidA')));
  await assertFails(setDoc(doc(db, 'billingBalances', 'uidA'), { availableMinor: 999999999 }));
  await assertFails(setDoc(doc(db, 'billingLedgerEntries', 'forged'), { ownerUid: 'uidA', amountMinor: 999999999 }));
  await assertFails(setDoc(doc(db, 'billingWithdrawals', 'forged'), { ownerUid: 'uidA', amountMinor: 1, status: 'COMPLETED' }));
});

test('billing public tokens and MonCash transaction locks are never directly public', async () => {
  await seed(async (db) => {
    await setDoc(doc(db, 'billingProformas', 'public-pf'), { ownerUid: 'uidA', publicToken: 'secret-token', status: 'SENT' });
    await setDoc(doc(db, 'billingMoncashTransactions', 'txn-1'), { intentId: 'intent-1' });
  });
  const db = testEnv.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(db, 'billingProformas', 'public-pf')));
  await assertFails(getDoc(doc(db, 'billingMoncashTransactions', 'txn-1')));
});
