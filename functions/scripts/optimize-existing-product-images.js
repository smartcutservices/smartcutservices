'use strict';

// Migration contrôlée des images produits déjà présentes dans Storage.
// Par défaut le script est en audit uniquement; utiliser --apply pour écrire.
const admin = require('firebase-admin');
const sharp = require('sharp');

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET || 'smartcutservices-9ce54.firebasestorage.app';
const APPLY = process.argv.includes('--apply');
const MAX_DIMENSION = 2000;
const QUALITY = 84;

if (!admin.apps.length) admin.initializeApp({ storageBucket: BUCKET });

async function main() {
  const [files] = await admin.storage().bucket().getFiles({ prefix: 'products/' });
  let scanned = 0;
  let candidates = 0;
  let optimized = 0;
  let savedBytes = 0;

  for (const file of files) {
    const [meta] = await file.getMetadata();
    const type = String(meta.contentType || '').toLowerCase();
    if (!type.startsWith('image/') || type === 'image/gif' || type === 'image/svg+xml' || meta.metadata?.imageOptimized === 'true') continue;
    scanned += 1;
    const [source] = await file.download();
    const output = await sharp(source)
      .rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY })
      .toBuffer();
    if (!output.length || output.length >= source.length * .98) continue;
    candidates += 1;
    savedBytes += source.length - output.length;
    if (!APPLY) continue;
    await file.save(output, {
      resumable: false,
      metadata: {
        contentType: 'image/webp',
        cacheControl: 'public,max-age=31536000,immutable',
        metadata: {
          ...(meta.metadata || {}),
          imageOptimized: 'true',
          optimizedFormat: 'webp',
          originalContentType: type,
          originalSize: String(source.length),
          optimizedSize: String(output.length),
          optimizedAt: new Date().toISOString()
        }
      }
    });
    optimized += 1;
  }

  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'audit', files: files.length, scanned, candidates, optimized, savedBytes }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
