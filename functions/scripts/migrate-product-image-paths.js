'use strict';

// Donne une vraie extension .webp aux images déjà optimisées et remplace les
// URLs dans les documents produits. Les anciens fichiers restent en place.
const admin = require('firebase-admin');

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'smartcutservices-9ce54.firebasestorage.app';
const APPLY = process.argv.includes('--apply');
const IMAGE_EXTENSIONS = /\.(png|jpe?g)$/i;

if (!admin.apps.length) admin.initializeApp({ storageBucket: BUCKET });

function replaceDeep(value, replacements) {
  if (typeof value === 'string') {
    let output = value;
    for (const [oldPath, newPath] of replacements) {
      const oldEncoded = encodeURIComponent(oldPath);
      const newEncoded = encodeURIComponent(newPath);
      output = output.split(oldEncoded).join(newEncoded);
      output = output.split(oldPath).join(newPath);
    }
    return output;
  }
  if (Array.isArray(value)) return value.map((item) => replaceDeep(item, replacements));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceDeep(item, replacements)]));
  }
  return value;
}

function hasChanged(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

async function main() {
  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles({ prefix: 'products/' });
  const mappings = [];
  for (const file of files) {
    const [meta] = await file.getMetadata();
    if (meta.metadata?.imageOptimized !== 'true' || !IMAGE_EXTENSIONS.test(file.name)) continue;
    const newPath = file.name.replace(IMAGE_EXTENSIONS, '.webp');
    mappings.push([file.name, newPath]);
    if (!APPLY) continue;
    const target = bucket.file(newPath);
    const [exists] = await target.exists();
    if (!exists) {
      await file.copy(target);
      await target.setMetadata({
        contentType: 'image/webp',
        cacheControl: 'public,max-age=31536000,immutable',
        metadata: { ...(meta.metadata || {}), pathMigratedToWebp: 'true' }
      });
    }
  }

  let updatedDocs = 0;
  if (process.env.IMAGES_STORAGE_ONLY === '1') {
    console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'audit', mappings: mappings.length, updatedDocs: 0, storageOnly: true, note: 'Documents Firestore non modifiés.' }, null, 2));
    return;
  }
  const db = admin.firestore();
  for (const collectionName of ['vendorProducts', 'products']) {
    const snapshot = await db.collection(collectionName).get();
    let batch = db.batch();
    let writes = 0;
    for (const document of snapshot.docs) {
      const before = document.data();
      const after = replaceDeep(before, mappings);
      if (!hasChanged(before, after)) continue;
      if (APPLY) {
        batch.update(document.ref, after);
        writes += 1;
        if (writes >= 450) { await batch.commit(); batch = db.batch(); writes = 0; }
      }
      updatedDocs += 1;
    }
    if (APPLY && writes) await batch.commit();
  }

  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'audit', mappings: mappings.length, updatedDocs, note: 'Anciens fichiers conservés.' }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
