'use strict';

/**
 * One-time migration: give existing products a `departmentId` / `department`
 * and a department-based `commissionRule`, so the new department commission
 * scale (commissionDepartments) applies to them.
 *
 * Strategy: build a name -> departmentId index from product-taxonomy.json
 * (department labels, category labels and sub-category labels, all normalized),
 * then for each doc in `products` and `vendorProducts` try to resolve its
 * stored `category` / `categoryName` / `department` to a department. Products
 * that cannot be resolved are LEFT UNTOUCHED (they keep their current
 * commissionRule until the vendor re-saves them from the dashboard).
 *
 * Historical orders / payoutRequests are never touched — only the product
 * catalog documents.
 *
 * Usage (owner, admin credentials):
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 node functions/scripts/backfill-product-departments.js --dry-run
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/key.json node functions/scripts/backfill-product-departments.js
 *
 * Flags: --dry-run (report only), --collection=products|vendorProducts (default: both)
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const DRY_RUN = process.argv.includes('--dry-run');
const collectionArg = (process.argv.find((a) => a.startsWith('--collection=')) || '').split('=')[1];
const COLLECTIONS = collectionArg ? [collectionArg] : ['products', 'vendorProducts'];
const TAXONOMY_PATH = path.resolve(__dirname, '..', '..', 'product-taxonomy.json');

function norm(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function buildIndex(taxonomy) {
  const index = new Map(); // normalized name -> departmentId
  const rates = {};        // departmentId -> { label, rate }
  for (const dep of taxonomy.departments) {
    rates[dep.id] = { label: dep.label, rate: Number(dep.commissionRate) };
    const put = (name) => {
      const k = norm(name);
      if (k && !index.has(k)) index.set(k, dep.id);
    };
    put(dep.label);
    put(dep.id);
    for (const cat of dep.categories || []) {
      put(cat.label);
      for (const sub of cat.subcategories || []) put(sub.label);
    }
  }
  return { index, rates };
}

function resolveDepartmentId(data, index) {
  const candidates = [
    data.departmentId, data.department,
    data.category, data.categoryName, data.categoryLabel,
    Array.isArray(data.categorySelections) ? data.categorySelections[0] : null
  ];
  for (const c of candidates) {
    if (!c) continue;
    const hit = index.get(norm(c));
    if (hit) return hit;
  }
  return '';
}

async function main() {
  const taxonomy = JSON.parse(fs.readFileSync(TAXONOMY_PATH, 'utf8'));
  const { index, rates } = buildIndex(taxonomy);

  if (!admin.apps.length) {
    admin.initializeApp(
      process.env.FIRESTORE_EMULATOR_HOST
        ? { projectId: process.env.GCLOUD_PROJECT || 'smartcutservices-9ce54' }
        : undefined
    );
  }
  const db = admin.firestore();
  const nowIso = new Date().toISOString();

  for (const collectionName of COLLECTIONS) {
    let scanned = 0;
    let matched = 0;
    let written = 0;
    let alreadySet = 0;
    const snap = await db.collection(collectionName).get();
    for (const doc of snap.docs) {
      scanned += 1;
      const data = doc.data() || {};
      if (String(data.departmentId || '').trim() && rates[String(data.departmentId).trim()]) {
        alreadySet += 1;
        continue;
      }
      const depId = resolveDepartmentId(data, index);
      if (!depId) continue;
      matched += 1;
      const entry = rates[depId];
      const patch = {
        departmentId: depId,
        department: entry.label,
        commissionRule: {
          ...(data.commissionRule && typeof data.commissionRule === 'object' ? data.commissionRule : {}),
          department: entry.label,
          departmentId: depId,
          departmentRate: entry.rate,
          categoryRate: entry.rate,
          rate: entry.rate,
          source: 'commissionDepartments',
          updatedAt: nowIso,
          updatedBy: 'backfill-product-departments'
        }
      };
      if (DRY_RUN) {
        console.log(`  [dry] ${collectionName}/${doc.id}  "${data.category || data.categoryName || ''}" -> ${depId} (${entry.rate}%)`);
      } else {
        await doc.ref.set(patch, { merge: true });
        written += 1;
      }
    }
    console.log(`\n${collectionName}: scanned=${scanned} alreadySet=${alreadySet} matched=${matched} written=${written} unresolved=${scanned - alreadySet - matched}`);
  }
  if (DRY_RUN) console.log('\n(dry run — no writes performed)');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
