import { storage } from './firebase-init.js';
import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js';

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml'
]);

const PDF_TYPES = new Set([
  'application/pdf'
]);

const DEFAULT_IMAGE_MAX_DIMENSION = 2000;
const DEFAULT_IMAGE_QUALITY = 0.84;

function sanitizeSegment(value, fallback = 'file') {
  return String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function sanitizeFolderPath(value, fallback = 'misc') {
  const segments = String(value || '')
    .split('/')
    .map((segment) => sanitizeSegment(segment, ''))
    .filter(Boolean);

  if (segments.length === 0) {
    return sanitizeSegment(fallback, 'misc');
  }

  return segments.join('/');
}

function getFileExtension(file) {
  const explicit = String(file?.name || '').split('.').pop();
  if (explicit && explicit !== file?.name) return sanitizeSegment(explicit, 'bin');

  const mime = String(file?.type || '').toLowerCase();
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('svg')) return 'svg';
  if (mime.includes('pdf')) return 'pdf';
  return 'jpg';
}

function getStorageBucketName() {
  return storage?.app?.options?.storageBucket || '';
}

function buildMediaUrl(storagePath) {
  const bucket = getStorageBucketName();
  if (!bucket || !storagePath) return '';
  return `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}?alt=media`;
}

export function validateImageFile(file, { maxSizeMb = 8 } = {}) {
  validateStorageFile(file, {
    allowedTypes: IMAGE_TYPES,
    maxSizeMb,
    unsupportedMessage: 'Format image non supporte. Utilisez JPG, PNG, WEBP, GIF ou SVG.'
  });
}

export function validatePdfFile(file, { maxSizeMb = 20 } = {}) {
  validateStorageFile(file, {
    allowedTypes: PDF_TYPES,
    maxSizeMb,
    unsupportedMessage: 'Format non supporte. Utilisez un fichier PDF.'
  });
}

export function validateStorageFile(file, {
  allowedTypes = null,
  maxSizeMb = 8,
  unsupportedMessage = 'Format de fichier non supporte.'
} = {}) {
  if (!file) throw new Error('Aucun fichier selectionne.');
  if (allowedTypes && !allowedTypes.has(file.type)) {
    throw new Error(unsupportedMessage);
  }

  const maxBytes = maxSizeMb * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error(`Fichier trop lourd. Maximum ${maxSizeMb} Mo.`);
  }
}

export async function uploadImageFile(file, folder = 'misc', options = {}) {
  validateImageFile(file, options);
  const normalized = await optimizeImageFile(file, options);
  const result = await uploadStorageFile(normalized.file, folder, {
    ...options,
    maxSizeMb: options.optimizedMaxSizeMb || 8
  });
  return {
    ...result,
    originalName: file.name || '',
    originalSize: Number(file.size || 0),
    optimizedSize: Number(normalized.file.size || 0),
    optimizedFormat: normalized.converted ? 'webp' : String(file.type || '').replace('image/', '')
  };
}

async function optimizeImageFile(file, options = {}) {
  const type = String(file?.type || '').toLowerCase();
  // Les SVG et GIF animés doivent conserver leur format et leur animation.
  if (type === 'image/svg+xml' || type === 'image/gif') {
    return { file, converted: false };
  }

  const maxDimension = Math.max(320, Number(options.maxDimension || DEFAULT_IMAGE_MAX_DIMENSION));
  const quality = Math.min(1, Math.max(.55, Number(options.quality || DEFAULT_IMAGE_QUALITY)));
  let bitmap;
  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(file);
    } else {
      bitmap = await new Promise((resolve, reject) => {
        const image = new Image();
        const url = URL.createObjectURL(file);
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); };
        image.src = url;
      });
    }
  } catch (_) {
    // Si un navigateur ne sait pas décoder l’image, on conserve le fichier
    // original plutôt que de bloquer l’upload.
    return { file, converted: false };
  }

  const sourceWidth = Number(bitmap.width || bitmap.naturalWidth || 0);
  const sourceHeight = Number(bitmap.height || bitmap.naturalHeight || 0);
  if (!sourceWidth || !sourceHeight) return { file, converted: false };
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) return { file, converted: false };
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
  if (!blob) return { file, converted: false };
  const baseName = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
  return { file: new File([blob], `${baseName}.webp`, { type: 'image/webp', lastModified: Date.now() }), converted: true };
}

export async function uploadStorageFile(file, folder = 'misc', options = {}) {
  validateStorageFile(file, options);

  const folderPath = sanitizeFolderPath(folder, 'misc');
  const baseName = sanitizeSegment(String(file.name || 'image').replace(/\.[^.]+$/, ''), 'image');
  const extension = getFileExtension(file);
  const uniqueName = `${baseName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const storagePath = `${folderPath}/${uniqueName}`;
  const storageRef = ref(storage, storagePath);

  try {
    const uploadTask = uploadBytesResumable(storageRef, file, {
      contentType: file.type,
      cacheControl: options.exposeDownloadUrl === false
        ? 'private,no-store,max-age=0'
        : 'public,max-age=31536000,immutable'
    });
    options.onTask?.(uploadTask);
    await new Promise((resolve, reject) => uploadTask.on('state_changed',
      (snapshot) => options.onProgress?.(snapshot.totalBytes ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0),
      reject,
      resolve
    ));

    let url = '';
    let urlSource = 'firebase-download-url';
    if (options.exposeDownloadUrl !== false) {
      try {
        url = await getDownloadURL(storageRef);
      } catch (downloadError) {
        url = buildMediaUrl(storagePath);
        urlSource = 'direct-media-url-fallback';
        console.warn('[STORAGE] uploadStorageFile:getDownloadURL:fallback', {
          storagePath,
          fallbackUrl: url,
          code: downloadError?.code || null,
          message: downloadError?.message || String(downloadError),
          customData: downloadError?.customData || null
        });
      }
    }

    if (!url && options.exposeDownloadUrl !== false) {
      throw new Error(`Upload reussi, mais URL image introuvable pour ${storagePath}.`);
    }

    return {
      url,
      path: storagePath,
      name: uniqueName,
      private: options.exposeDownloadUrl === false
    };
  } catch (error) {
    console.error('[STORAGE] uploadStorageFile:error', {
      storagePath,
      code: error?.code || null,
      message: error?.message || String(error),
      customData: error?.customData || null,
      serverResponse: error?.serverResponse || null
    });
    throw error;
  }
}

export async function uploadPdfFile(file, folder = 'documents', options = {}) {
  validatePdfFile(file, options);
  return uploadStorageFile(file, folder, {
    allowedTypes: PDF_TYPES,
    maxSizeMb: 20,
    unsupportedMessage: 'Format non supporte. Utilisez un fichier PDF.',
    ...options
  });
}

export async function deleteStorageFile(storagePath) {
  if (!storagePath) return;
  const storageRef = ref(storage, storagePath);
  await deleteObject(storageRef);
}
