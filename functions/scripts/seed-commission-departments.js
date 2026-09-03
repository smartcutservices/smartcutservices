'use strict';

/**
 * One-time seed for the `commissionDepartments` Firestore collection.
 *
 * Commissions are now department-based (see product-taxonomy.json ->
 * commissionByDepartment). This collection is the authoritative, admin-editable
 * source of each department's commission rate. `functions/index.js`
 * (getCommissionDepartmentsMap / applyDepartmentCommissionRule) reads it when
 * enriching marketplace items, so a rate change here applies to new orders.
 *
 * Document shape: commissionDepartments/{departmentId} =
 *   { id, label, rate (percent), active: true, updatedAt, source }
 *
 * Usage (owner runs this with admin credentials, e.g. a service-account key):
 *
 *   # against the emulator:
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node functions/scripts/seed-commission-departments.js
 *
 *   # against production (creates only the docs that don't exist yet):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node functions/scripts/seed-commission-departments.js
 *
 *   # add --force to also overwrite the `rate` of docs that already exist
 *   ... node functions/scripts/seed-commission-departments.js --force
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const FORCE = process.argv.includes('--force');
const TAXONOMY_PATH = path.resolve(__dirname, '..', '..', 'product-taxonomy.json');
const COLLECTION = 'commissionDepartments';

function loadTaxonomy() {
  const raw = fs.readFileSync(TAXONOMY_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.departments) || !data.departments.length) {
    throw new Error('product-taxonomy.json has no departments');
  }
  return data;
}

async function main() {
  const taxonomy = loadTaxonomy();

  if (!admin.apps.length) {
    admin.initializeApp(
      process.env.FIRESTORE_EMULATOR_HOST
        ? { projectId: process.env.GCLOUD_PROJECT || 'smartcutservices-9ce54' }
        : undefined
    );
  }
  const db = admin.firestore();
  const now = admin.firestore.FieldValue.serverTimestamp();

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const dep of taxonomy.departments) {
    const id = String(dep.id || '').trim();
    const rate = Number(dep.commissionRate);
    if (!id || !Number.isFinite(rate)) {
      console.warn('  ! skipping malformed department entry:', JSON.stringify(dep).slice(0, 120));
      continue;
    }
    const ref = db.collection(COLLECTION).doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set({
        id,
        label: dep.label || id,
        rate,
        active: true,
        source: 'product-taxonomy.json',
        updatedAt: now,
        updatedBy: 'seed-commission-departments'
      });
      created += 1;
      console.log(`  + ${id} -> ${rate}%`);
      continue;
    }

    if (FORCE) {
      await ref.set(
        { label: dep.label || id, rate, source: 'product-taxonomy.json', updatedAt: now, updatedBy: 'seed-commission-departments --force' },
        { merge: true }
      );
      updated += 1;
      console.log(`  ~ ${id} -> ${rate}% (forced)`);
    } else {
      skipped += 1;
      console.log(`  = ${id} (exists, kept ${snap.data() && snap.data().rate}% — use --force to overwrite)`);
    }
  }

  console.log(`\nDone. created=${created} updated=${updated} skipped=${skipped} (total ${taxonomy.departments.length}).`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
