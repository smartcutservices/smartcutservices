'use strict';

// Audit/migration des images statiques du site. Les originaux sont conservés.
// Exécution depuis functions/ : npm run static-images:audit
// puis npm run static-images:optimize pour générer les .webp.
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..', '..');
const APPLY = process.argv.includes('--apply');
const SKIP = new Set(['node_modules', '.git', '.firebase', 'functions', 'tmp', '_git_vendor', '.vendor', '.vendor_git', '.vendor_git_src', '.vendor_manual']);
const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const MAX_DIMENSION = 2000;
const QUALITY = 84;

async function walk(dir, files = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && (SKIP.has(entry.name) || /^\.tmp|^\.codex|^\.claude/i.test(entry.name))) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(absolute, files);
    else if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
  }
  return files;
}

async function main() {
  const files = await walk(ROOT);
  let candidates = 0;
  let generated = 0;
  let originalBytes = 0;
  let webpBytes = 0;
  for (const file of files) {
    const target = `${file.slice(0, -path.extname(file).length)}.webp`;
    if (!APPLY && await fs.stat(target).then(() => true).catch(() => false)) continue;
    const source = await fs.readFile(file);
    const output = await sharp(source).rotate()
      .resize({ width: MAX_DIMENSION, height: MAX_DIMENSION, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: QUALITY }).toBuffer();
    candidates += 1;
    originalBytes += source.length;
    webpBytes += output.length;
    if (APPLY) { await fs.writeFile(target, output); generated += 1; }
  }
  console.log(JSON.stringify({ mode: APPLY ? 'apply' : 'audit', files: files.length, candidates, generated, originalBytes, webpBytes, estimatedSavedBytes: Math.max(0, originalBytes - webpBytes) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
