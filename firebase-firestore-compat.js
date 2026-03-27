import {
  addDocument,
  cacheSizeUnlimitedValue,
  deleteDocument,
  enableLocalPersistence,
  getDocument,
  getDocuments,
  makeCollection,
  makeCollectionGroup,
  makeDocument,
  makeFirestoreDb,
  makeLimit,
  makeOrderBy,
  makeQuery,
  makeServerTimestamp,
  makeWhere,
  setDocument,
  subscribeTo,
  updateDocument
} from './firebase-compat-core.js';

export const CACHE_SIZE_UNLIMITED = cacheSizeUnlimitedValue;

export function getFirestore(app) {
  return makeFirestoreDb(app);
}

export function enableIndexedDbPersistence(db, options = {}) {
  void db;
  void options;
  return enableLocalPersistence();
}

export function collection(...args) {
  return makeCollection(...args);
}

export function collectionGroup(...args) {
  return makeCollectionGroup(...args);
}

export function doc(...args) {
  return makeDocument(...args);
}

export function query(...args) {
  return makeQuery(...args);
}

export function where(field, op, value) {
  return makeWhere(field, op, value);
}

export function orderBy(field, direction = 'asc') {
  return makeOrderBy(field, direction);
}

export function limit(count) {
  return makeLimit(count);
}

export function getDocs(ref) {
  return getDocuments(ref);
}

export function getDoc(ref) {
  return getDocument(ref);
}

export function onSnapshot(ref, onNext, onError) {
  return subscribeTo(ref, onNext, onError);
}

export function setDoc(ref, data, options = {}) {
  return setDocument(ref, data, options);
}

export function addDoc(ref, data) {
  return addDocument(ref, data);
}

export function updateDoc(ref, data) {
  return updateDocument(ref, data);
}

export function deleteDoc(ref) {
  return deleteDocument(ref);
}

export function serverTimestamp() {
  return makeServerTimestamp();
}
