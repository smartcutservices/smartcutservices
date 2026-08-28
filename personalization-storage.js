// Upload et controle qualite pour le Studio de personnalisation.
//
// Trois familles de fichiers sont enregistrees SEPAREMENT dans Firebase Storage,
// jamais melangees:
//   personalization/originals/   -> fichier importe par le client, haute resolution,
//                                    jamais retouche (c'est la source de verite atelier)
//   personalization/print-files/ -> composition haute resolution generee depuis les
//                                    calques (texte + images) via personalization-editor.js
//                                    composeCanvas(), SANS capture du rendu 3D
//   personalization/previews/    -> vignette basse resolution utilisee uniquement pour
//                                    l'affichage panier/checkout (jamais utilisee comme
//                                    fichier d'impression)
//
// storage.rules autorise ce dossier en creation (voir bloc `personalization/`),
// avec les memes contraintes que les autres modules d'impression (type image, taille max).

import { uploadImageFile } from './firebase-storage.js';

const ALLOWED_IMPORT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_IMPORT_SIZE_MB = 15;

export function validateImportedImage(file) {
  if (!file) throw new Error('Aucun fichier selectionne.');
  if (!ALLOWED_IMPORT_TYPES.has(file.type)) {
    throw new Error('Format non supporte. Utilisez une image PNG, JPG ou WEBP.');
  }
  const maxBytes = MAX_IMPORT_SIZE_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`Image trop lourde. Maximum ${MAX_IMPORT_SIZE_MB} Mo.`);
  }
}

// Estime la qualite d'impression d'un calque image en comparant sa resolution
// reelle a la resolution necessaire pour un rendu net a `product.printDpiTarget`,
// compte tenu de la taille a laquelle l'image est actuellement placee (layer.w/h,
// fractions 0..1 du canvas produit). A rappeler apres chaque redimensionnement.
export function assessImageQuality({ naturalWidth, naturalHeight, layerW, layerH, product, printArea = null }) {
  if (!naturalWidth || !naturalHeight || !product) {
    return { status: 'inconnue', effectiveDpi: 0, message: 'Resolution indisponible.' };
  }
  const canvasSize = product.canvasSize || 1200;
  const targetDpi = printArea?.recommendedDpi || product.printDpiTarget || 150;
  const canvasPhysicalInches = canvasSize / targetDpi;

  const areaWidth = Number(printArea?.bounds?.width) || 1;
  const areaHeight = Number(printArea?.bounds?.height) || 1;
  const areaPhysicalWidth = Number(printArea?.physicalWidthInches) || canvasPhysicalInches * areaWidth;
  const areaPhysicalHeight = Number(printArea?.physicalHeightInches) || canvasPhysicalInches * areaHeight;
  const placedWidthInches = Math.max(0.01, ((layerW || 0.3) / areaWidth) * areaPhysicalWidth);
  const placedHeightInches = Math.max(0.01, ((layerH || 0.3) / areaHeight) * areaPhysicalHeight);

  const dpiFromWidth = naturalWidth / placedWidthInches;
  const dpiFromHeight = naturalHeight / placedHeightInches;
  const effectiveDpi = Math.round(Math.min(dpiFromWidth, dpiFromHeight));

  let status = 'insuffisante';
  let message = `Resolution faible (${effectiveDpi} DPI environ). L'impression pourrait paraitre floue a cette taille.`;
  if (effectiveDpi >= targetDpi) {
    status = 'excellente';
    message = `Excellente resolution (${effectiveDpi} DPI environ).`;
  } else if (effectiveDpi >= targetDpi * 0.6) {
    status = 'acceptable';
    message = `Resolution acceptable (${effectiveDpi} DPI environ). Une taille plus petite donnerait un meilleur rendu.`;
  }

  return { status, effectiveDpi, message };
}

export async function uploadOriginalImage(file) {
  validateImportedImage(file);
  return uploadImageFile(file, 'personalization/originals', { maxSizeMb: MAX_IMPORT_SIZE_MB });
}

export function canvasToBlob(canvas, type = 'image/png', quality = 0.92) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Impossible de generer le fichier a partir du canvas.'));
    }, type, quality);
  });
}

async function uploadCanvasAs(canvas, folder, filenameHint, { maxSizeMb = 20 } = {}) {
  const blob = await canvasToBlob(canvas, 'image/png');
  const file = new File([blob], `${filenameHint}.png`, { type: 'image/png' });
  return uploadImageFile(file, folder, { maxSizeMb });
}

// Rendu haute resolution destine a l'atelier (un fichier par emplacement utilise).
export async function uploadPrintFile(canvas, { face = 'front', designId = 'design' } = {}) {
  return uploadCanvasAs(canvas, 'personalization/print-files', `${designId}-${face}-print`, { maxSizeMb: 25 });
}

// Vignette client (apercu compact), affichee dans le panier/checkout. Jamais utilisee
// comme fichier d'impression - c'est le role exclusif de uploadPrintFile ci-dessus.
export async function uploadPreviewImage(canvas, { face = 'front', designId = 'design' } = {}) {
  const previewCanvas = document.createElement('canvas');
  const maxDim = 640;
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  previewCanvas.width = Math.round(canvas.width * scale);
  previewCanvas.height = Math.round(canvas.height * scale);
  previewCanvas.getContext('2d').drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height);
  return uploadCanvasAs(previewCanvas, 'personalization/previews', `${designId}-${face}-preview`, { maxSizeMb: 5 });
}

export function generateDesignId() {
  return `pz_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
