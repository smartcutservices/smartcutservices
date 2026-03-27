import { storage } from './firebase-init.js';
import {
  ref,
  uploadBytes,
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

function sanitizeSegment(value, fallback = 'file') {
  return String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
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
  return uploadStorageFile(file, folder, options);
}

export async function uploadStorageFile(file, folder = 'misc', options = {}) {
  validateStorageFile(file, options);

  const folderPath = sanitizeSegment(folder, 'misc');
  const baseName = sanitizeSegment(String(file.name || 'image').replace(/\.[^.]+$/, ''), 'image');
  const extension = getFileExtension(file);
  const uniqueName = `${baseName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const storagePath = `${folderPath}/${uniqueName}`;
  const storageRef = ref(storage, storagePath);

  await uploadBytes(storageRef, file, {
    contentType: file.type,
    cacheControl: 'public,max-age=31536000,immutable'
  });

  const url = await getDownloadURL(storageRef);
  return {
    url,
    path: storagePath,
    name: uniqueName
  };
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
