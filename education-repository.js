// ============= SMART CUT EDUCATION - REPOSITORY FIRESTORE =============
// Seul module autorise a interroger Firestore pour Smart Cut Education. Les
// pages et composants ne doivent jamais importer firebase-firestore
// directement : ils passent par les fonctions ci-dessous, qui retournent
// toujours des objets normalises (education-normalize.js) et ne renvoient
// jamais une erreur Firebase brute a l'appelant — voir EducationRepositoryError.
//
// Chaque requete de liste inclut explicitement `where('publicationStatus',
// '==', 'published')` : les regles Firestore (firestore.rules) exigent que
// cette contrainte soit dans la requete elle-meme pour l'autoriser (une regle
// de type "list" ne peut etre validee que si la requete la rend vraie pour
// tous les resultats possibles).

import { db } from './firebase-init.js';
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit as fsLimit,
  orderBy,
  query,
  where
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { normalizeCategory, normalizeProgram, normalizeSchool, normalizeSlug } from './education-normalize.js?v=20260827-2';

const CATEGORIES_COLLECTION = 'educationCategories';
const SCHOOLS_COLLECTION = 'educationSchools';
const PROGRAMS_COLLECTION = 'educationPrograms';

export class EducationRepositoryError extends Error {
  constructor(operation, cause) {
    super('Impossible de charger les données Smart Cut Education pour le moment.');
    this.name = 'EducationRepositoryError';
    this.operation = operation;
    this.cause = cause;
  }
}

function isPermissionDeniedError(error) {
  return error?.code === 'permission-denied' || error?.code === 'firestore/permission-denied';
}

// getDoc()/getDocs() silently fall back to the (empty, since nothing was ever
// cached) local cache when the server is unreachable, resolving successfully
// instead of rejecting — which would misrepresent a real connectivity failure
// as "no content yet" to the visitor. getDocFromServer()/getDocsFromServer()
// require an actual server round-trip and reject on failure, so a genuine
// outage surfaces the honest error/retry state instead of a false empty one.

function wrapError(operation, error) {
  console.error(`[education-repository] ${operation} a échoué:`, error);
  return new EducationRepositoryError(operation, error);
}

export async function listPublishedCategories() {
  try {
    const snap = await getDocsFromServer(query(collection(db, CATEGORIES_COLLECTION), where('isActive', '==', true)));
    return snap.docs
      .map((docSnap) => normalizeCategory(docSnap.data(), docSnap.id))
      .sort((a, b) => a.order - b.order);
  } catch (error) {
    throw wrapError('listPublishedCategories', error);
  }
}

export async function listPublishedPrograms(filters = {}) {
  try {
    const constraints = [where('publicationStatus', '==', 'published')];

    if (filters.categoryId) constraints.push(where('categoryId', '==', filters.categoryId));
    else if (filters.schoolId) constraints.push(where('schoolId', '==', filters.schoolId));
    else if (filters.commune) constraints.push(where('commune', '==', filters.commune));
    else if (filters.modality) constraints.push(where('modality', '==', filters.modality));
    else constraints.push(orderBy('publishedAt', 'desc'));

    if (filters.limit) constraints.push(fsLimit(filters.limit));

    const snap = await getDocsFromServer(query(collection(db, PROGRAMS_COLLECTION), ...constraints));
    return snap.docs.map((docSnap) => normalizeProgram(docSnap.data(), docSnap.id));
  } catch (error) {
    throw wrapError('listPublishedPrograms', error);
  }
}

export async function listPublishedSchools(filters = {}) {
  try {
    const constraints = [where('publicationStatus', '==', 'published')];

    if (filters.commune) constraints.push(where('commune', '==', filters.commune));
    else constraints.push(orderBy('publishedAt', 'desc'));

    if (filters.limit) constraints.push(fsLimit(filters.limit));

    const snap = await getDocsFromServer(query(collection(db, SCHOOLS_COLLECTION), ...constraints));
    return snap.docs.map((docSnap) => normalizeSchool(docSnap.data(), docSnap.id));
  } catch (error) {
    throw wrapError('listPublishedSchools', error);
  }
}

export async function getPublishedProgramById(id) {
  const trimmedId = String(id || '').trim();
  if (!trimmedId) return null;
  try {
    const snap = await getDocFromServer(doc(db, PROGRAMS_COLLECTION, trimmedId));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data.publicationStatus !== 'published') return null;
    return normalizeProgram(data, snap.id);
  } catch (error) {
    if (isPermissionDeniedError(error)) return null; // draft/archived: looks like "not found" to the public
    throw wrapError('getPublishedProgramById', error);
  }
}

export async function getPublishedProgramBySlug(slug) {
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  try {
    const snap = await getDocsFromServer(query(
      collection(db, PROGRAMS_COLLECTION),
      where('publicationStatus', '==', 'published'),
      where('slug', '==', normalized),
      fsLimit(1)
    ));
    if (snap.empty) return null;
    const docSnap = snap.docs[0];
    return normalizeProgram(docSnap.data(), docSnap.id);
  } catch (error) {
    throw wrapError('getPublishedProgramBySlug', error);
  }
}

export async function getPublishedSchoolById(id) {
  const trimmedId = String(id || '').trim();
  if (!trimmedId) return null;
  try {
    const snap = await getDocFromServer(doc(db, SCHOOLS_COLLECTION, trimmedId));
    if (!snap.exists()) return null;
    const data = snap.data();
    if (data.publicationStatus !== 'published') return null;
    return normalizeSchool(data, snap.id);
  } catch (error) {
    if (isPermissionDeniedError(error)) return null;
    throw wrapError('getPublishedSchoolById', error);
  }
}

export async function getPublishedSchoolBySlug(slug) {
  const normalized = normalizeSlug(slug);
  if (!normalized) return null;
  try {
    const snap = await getDocsFromServer(query(
      collection(db, SCHOOLS_COLLECTION),
      where('publicationStatus', '==', 'published'),
      where('slug', '==', normalized),
      fsLimit(1)
    ));
    if (snap.empty) return null;
    const docSnap = snap.docs[0];
    return normalizeSchool(docSnap.data(), docSnap.id);
  } catch (error) {
    throw wrapError('getPublishedSchoolBySlug', error);
  }
}

export async function listPublishedProgramsBySchool(schoolId) {
  if (!schoolId) return [];
  return listPublishedPrograms({ schoolId });
}

export async function listRelatedPublishedPrograms(program, { limit = 4 } = {}) {
  if (!program?.categoryId) return [];
  const siblings = await listPublishedPrograms({ categoryId: program.categoryId });
  return siblings.filter((item) => item.id !== program.id).slice(0, limit);
}
