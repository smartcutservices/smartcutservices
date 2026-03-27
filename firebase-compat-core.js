const SDK_URLS = {
  app: 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js',
  auth: 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js',
  firestore: 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js'
};

const CACHE_KEY = 'veltrixa_firestore_cache_v1';
const AUTH_KEY = 'veltrixa_auth_fallback_v1';

const state = {
  apps: [],
  app: null,
  nativeApp: null,
  sdkPromises: {},
  authListeners: new Set(),
  authState: readJson(AUTH_KEY, { currentUser: null, users: [] })
};

function hasStorage() {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch (_) {
    return false;
  }
}

function clone(value) {
  if (value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return value;
  }
}

function readJson(key, fallback) {
  if (!hasStorage()) return clone(fallback);
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : clone(fallback);
  } catch (_) {
    return clone(fallback);
  }
}

function writeJson(key, value) {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {}
}

function getCache() {
  return readJson(CACHE_KEY, { collections: {} });
}

function saveCache(cache) {
  writeJson(CACHE_KEY, cache);
}

function toPathArray(path) {
  if (Array.isArray(path)) return [...path];
  return String(path || '').split('/').filter(Boolean);
}

function pathKey(path) {
  return toPathArray(path).join('/');
}

function getCollectionEntry(cache, path) {
  const key = pathKey(path);
  cache.collections[key] ||= {
    path: toPathArray(path),
    docs: {}
  };
  return cache.collections[key];
}

function recordToDocSnapshot(record, ref = null) {
  const safeData = record ? clone(record.data) : undefined;
  return {
    id: record?.id || '',
    ref: ref || makeDocument(record?.path || []),
    exists() {
      return safeData != null;
    },
    data() {
      return safeData == null ? undefined : clone(safeData);
    }
  };
}

function recordsToQuerySnapshot(records, ref) {
  const docs = records.map((record) => recordToDocSnapshot(record, makeDocument(record.path)));
  return {
    docs,
    empty: docs.length === 0,
    size: docs.length,
    query: ref,
    forEach(cb) {
      docs.forEach(cb);
    }
  };
}

function getFieldValue(record, field) {
  if (field === '__name__') return record.id;
  return String(field || '')
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), record.data);
}

function normalizeComparable(value) {
  if (value && typeof value === 'object') {
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') {
      return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);
    }
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return value;
}

function readCollectionRecords(ref) {
  const cache = getCache();

  if (ref?.kind === 'collectionGroup') {
    return Object.values(cache.collections)
      .filter((entry) => entry.path?.[entry.path.length - 1] === ref.collectionId)
      .flatMap((entry) =>
        Object.entries(entry.docs || {}).map(([id, data]) => ({
          id,
          data: clone(data),
          path: [...entry.path, id]
        }))
      );
  }

  const entry = cache.collections[pathKey(ref?.path || [])];
  if (!entry) return [];
  return Object.entries(entry.docs || {}).map(([id, data]) => ({
    id,
    data: clone(data),
    path: [...entry.path, id]
  }));
}

function readDocRecord(path) {
  const docPath = toPathArray(path);
  if (docPath.length < 2) return null;
  const cache = getCache();
  const entry = cache.collections[pathKey(docPath.slice(0, -1))];
  const id = docPath[docPath.length - 1];
  const data = entry?.docs?.[id];
  if (data == null) return null;
  return { id, data: clone(data), path: docPath };
}

function writeDocRecord(path, data, merge = false) {
  const docPath = toPathArray(path);
  if (docPath.length < 2) return;
  const cache = getCache();
  const entry = getCollectionEntry(cache, docPath.slice(0, -1));
  const id = docPath[docPath.length - 1];
  const previous = entry.docs[id] || {};
  entry.docs[id] = merge ? { ...previous, ...clone(data) } : clone(data);
  saveCache(cache);
}

function removeDocRecord(path) {
  const docPath = toPathArray(path);
  if (docPath.length < 2) return;
  const cache = getCache();
  const entry = getCollectionEntry(cache, docPath.slice(0, -1));
  delete entry.docs[docPath[docPath.length - 1]];
  saveCache(cache);
}

function patchCollectionRecords(path, docs) {
  const cache = getCache();
  const entry = getCollectionEntry(cache, path);
  docs.forEach((doc) => {
    if (doc?.id) entry.docs[doc.id] = clone(doc.data);
  });
  saveCache(cache);
}

function replaceCollectionRecords(path, docs) {
  const cache = getCache();
  const entry = getCollectionEntry(cache, path);
  entry.docs = {};
  docs.forEach((doc) => {
    if (doc?.id) entry.docs[doc.id] = clone(doc.data);
  });
  saveCache(cache);
}

function applyQueryClauses(records, clauses = []) {
  let result = [...records];

  for (const clause of clauses) {
    if (!clause) continue;

    if (clause.type === 'where') {
      result = result.filter((record) => {
        const left = normalizeComparable(getFieldValue(record, clause.field));
        const right = normalizeComparable(clause.value);
        switch (clause.op) {
          case '==': return left === right;
          case '!=': return left !== right;
          case '>': return left > right;
          case '>=': return left >= right;
          case '<': return left < right;
          case '<=': return left <= right;
          case 'array-contains': return Array.isArray(left) && left.includes(right);
          default: return false;
        }
      });
    }

    if (clause.type === 'orderBy') {
      const direction = clause.direction === 'desc' ? -1 : 1;
      result = [...result].sort((a, b) => {
        const left = normalizeComparable(getFieldValue(a, clause.field));
        const right = normalizeComparable(getFieldValue(b, clause.field));
        if (left === right) return 0;
        if (left == null) return 1;
        if (right == null) return -1;
        return left > right ? direction : -direction;
      });
    }

    if (clause.type === 'limit') {
      result = result.slice(0, Math.max(0, Number(clause.count) || 0));
    }
  }

  return result;
}

async function loadSdk(kind) {
  if (!state.sdkPromises[kind]) {
    state.sdkPromises[kind] = import(SDK_URLS[kind]).catch((error) => {
      console.warn(`[firebase-compat] SDK ${kind} indisponible, fallback local active.`, error);
      return null;
    });
  }
  return state.sdkPromises[kind];
}

async function ensureNativeApp() {
  if (state.nativeApp) return state.nativeApp;
  const sdk = await loadSdk('app');
  if (!sdk || !state.app?.options) return null;
  try {
    state.nativeApp = sdk.getApps().length ? sdk.getApp() : sdk.initializeApp(state.app.options);
    return state.nativeApp;
  } catch (_) {
    return null;
  }
}

async function withNativeFirestore(run) {
  const [sdk, app] = await Promise.all([loadSdk('firestore'), ensureNativeApp()]);
  if (!sdk || !app) return null;
  try {
    return await run(sdk, app);
  } catch (error) {
    console.warn('[firebase-compat] Firestore natif indisponible, fallback local utilise.', error);
    return null;
  }
}

async function withNativeAuth(run) {
  const [sdk, app] = await Promise.all([loadSdk('auth'), ensureNativeApp()]);
  if (!sdk || !app) return null;
  try {
    return await run(sdk, app);
  } catch (error) {
    console.warn('[firebase-compat] Auth native indisponible, fallback local utilise.', error);
    return null;
  }
}

function toNativeConstraint(sdk, clause) {
  if (clause.type === 'where') return sdk.where(clause.field, clause.op, clause.value);
  if (clause.type === 'orderBy') return sdk.orderBy(clause.field, clause.direction);
  if (clause.type === 'limit') return sdk.limit(clause.count);
  return null;
}

async function toNativeRef(sdk, app, ref) {
  const db = sdk.getFirestore(app);

  if (ref?.kind === 'collection') return sdk.collection(db, ...ref.path);
  if (ref?.kind === 'collectionGroup') return sdk.collectionGroup(db, ref.collectionId);
  if (ref?.kind === 'doc') return sdk.doc(db, ...ref.path);
  if (ref?.kind === 'query') {
    const base = await toNativeRef(sdk, app, ref.ref);
    const clauses = ref.clauses.map((clause) => toNativeConstraint(sdk, clause)).filter(Boolean);
    return sdk.query(base, ...clauses);
  }

  return null;
}

function syncQuerySnapshotToCache(ref, snapshot) {
  if (!snapshot?.docs) return;
  const docs = snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data(),
    path: toPathArray(docSnap.ref?.path || '')
  }));

  if (ref?.kind === 'collection') {
    replaceCollectionRecords(ref.path, docs);
    return;
  }

  if (ref?.kind === 'query' && ref.ref?.kind === 'collection') {
    patchCollectionRecords(ref.ref.path, docs);
  }
}

function syncDocSnapshotToCache(snapshot) {
  if (!snapshot?.exists || !snapshot.exists()) return;
  writeDocRecord(toPathArray(snapshot.ref?.path || ''), snapshot.data());
}

function emitAuth(user) {
  state.authListeners.forEach((listener) => {
    try {
      listener(clone(user));
    } catch (error) {
      console.error('[firebase-compat] auth listener error', error);
    }
  });
}

function persistAuth() {
  writeJson(AUTH_KEY, state.authState);
}

export function createFallbackApp(config = {}) {
  if (state.app) return state.app;
  state.app = { __compat: true, name: '[DEFAULT]', options: clone(config) };
  state.apps = [state.app];
  return state.app;
}

export function getFallbackApp() {
  return state.app || createFallbackApp();
}

export function listFallbackApps() {
  return [...state.apps];
}

export function makeFirestoreDb(app = null) {
  return { __compat: true, kind: 'db', app: app || getFallbackApp() };
}

export function makeCollection(...args) {
  const base = (args[0] && typeof args[0] === 'object' && args[0].path) ? args.shift() : null;
  return { kind: 'collection', path: [...toPathArray(base?.path || []), ...args.map(String)] };
}

export function makeCollectionGroup(_db, collectionId) {
  return { kind: 'collectionGroup', collectionId: String(collectionId || '') };
}

export function makeDocument(...args) {
  const base = (args[0] && typeof args[0] === 'object' && args[0].path) ? args.shift() : null;
  const path = [...toPathArray(base?.path || []), ...args.map(String)];
  return { kind: 'doc', path, id: path[path.length - 1] || '' };
}

export function makeQuery(ref, ...clauses) {
  return { kind: 'query', ref, clauses };
}

export function makeWhere(field, op, value) {
  return { type: 'where', field, op, value };
}

export function makeOrderBy(field, direction = 'asc') {
  return { type: 'orderBy', field, direction };
}

export function makeLimit(count) {
  return { type: 'limit', count };
}

export function makeServerTimestamp() {
  return new Date().toISOString();
}

export async function getDocuments(ref) {
  const native = await withNativeFirestore(async (sdk, app) => {
    const nativeRef = await toNativeRef(sdk, app, ref);
    return sdk.getDocs(nativeRef);
  });

  if (native) {
    syncQuerySnapshotToCache(ref, native);
    return native;
  }

  const baseRecords = ref?.kind === 'query'
    ? applyQueryClauses(readCollectionRecords(ref.ref), ref.clauses)
    : readCollectionRecords(ref);
  return recordsToQuerySnapshot(baseRecords, ref);
}

export async function getDocument(ref) {
  const native = await withNativeFirestore(async (sdk, app) => {
    const nativeRef = await toNativeRef(sdk, app, ref);
    return sdk.getDoc(nativeRef);
  });

  if (native) {
    syncDocSnapshotToCache(native);
    return native;
  }

  return recordToDocSnapshot(readDocRecord(ref?.path), ref);
}

export async function setDocument(ref, data, options = {}) {
  const native = await withNativeFirestore(async (sdk, app) => {
    const nativeRef = await toNativeRef(sdk, app, ref);
    return sdk.setDoc(nativeRef, data, options);
  });
  writeDocRecord(ref?.path, data, !!options?.merge);
  return native ?? undefined;
}

export async function updateDocument(ref, data) {
  const native = await withNativeFirestore(async (sdk, app) => {
    const nativeRef = await toNativeRef(sdk, app, ref);
    return sdk.updateDoc(nativeRef, data);
  });
  writeDocRecord(ref?.path, data, true);
  return native ?? undefined;
}

export async function addDocument(ref, data) {
  const native = await withNativeFirestore(async (sdk, app) => {
    const nativeRef = await toNativeRef(sdk, app, ref);
    return sdk.addDoc(nativeRef, data);
  });

  const id = native?.id || `local_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  writeDocRecord([...(ref?.path || []), id], data);
  return native || makeDocument([...(ref?.path || []), id]);
}

export async function deleteDocument(ref) {
  const native = await withNativeFirestore(async (sdk, app) => {
    const nativeRef = await toNativeRef(sdk, app, ref);
    return sdk.deleteDoc(nativeRef);
  });
  removeDocRecord(ref?.path);
  return native ?? undefined;
}

export function subscribeTo(ref, onNext, onError) {
  let cancelled = false;
  let nativeUnsubscribe = null;

  (async () => {
    const unsubscribe = await withNativeFirestore(async (sdk, app) => {
      const nativeRef = await toNativeRef(sdk, app, ref);
      return sdk.onSnapshot(
        nativeRef,
        (snapshot) => {
          if (ref?.kind === 'doc') syncDocSnapshotToCache(snapshot);
          else syncQuerySnapshotToCache(ref, snapshot);
          if (!cancelled) onNext(snapshot);
        },
        (error) => {
          if (cancelled) return;
          if (typeof onError === 'function') onError(error);
          const fallback = ref?.kind === 'doc'
            ? recordToDocSnapshot(readDocRecord(ref?.path), ref)
            : recordsToQuerySnapshot(
                ref?.kind === 'query'
                  ? applyQueryClauses(readCollectionRecords(ref.ref), ref.clauses)
                  : readCollectionRecords(ref),
                ref
              );
          onNext(fallback);
        }
      );
    });

    if (unsubscribe) {
      nativeUnsubscribe = unsubscribe;
      return;
    }

    if (cancelled) return;

    const fallback = ref?.kind === 'doc'
      ? recordToDocSnapshot(readDocRecord(ref?.path), ref)
      : recordsToQuerySnapshot(
          ref?.kind === 'query'
            ? applyQueryClauses(readCollectionRecords(ref.ref), ref.clauses)
            : readCollectionRecords(ref),
          ref
        );
    onNext(fallback);
  })();

  return () => {
    cancelled = true;
    if (typeof nativeUnsubscribe === 'function') {
      try { nativeUnsubscribe(); } catch (_) {}
    }
  };
}

export async function enableLocalPersistence() {
  return withNativeFirestore(async (sdk, app) => {
    const db = sdk.getFirestore(app);
    return sdk.enableIndexedDbPersistence(db, { cacheSizeBytes: sdk.CACHE_SIZE_UNLIMITED });
  });
}

export function makeAuth(app = null) {
  return {
    __compat: true,
    kind: 'auth',
    app: app || getFallbackApp(),
    currentUser: clone(state.authState.currentUser)
  };
}

export function subscribeAuthState(_auth, callback) {
  state.authListeners.add(callback);
  Promise.resolve().then(() => callback(clone(state.authState.currentUser)));

  withNativeAuth(async (sdk, app) => {
    const auth = sdk.getAuth(app);
    return sdk.onAuthStateChanged(auth, (user) => {
      state.authState.currentUser = user ? {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || '',
        photoURL: user.photoURL || ''
      } : null;
      persistAuth();
      emitAuth(state.authState.currentUser);
    });
  });

  return () => {
    state.authListeners.delete(callback);
  };
}

export async function signInEmailPassword(_auth, email, password) {
  const native = await withNativeAuth(async (sdk, app) => {
    const auth = sdk.getAuth(app);
    return sdk.signInWithEmailAndPassword(auth, email, password);
  });
  if (native?.user) return native;

  const entry = state.authState.users.find((user) => user.email === email && user.password === password);
  if (!entry) {
    const error = new Error('Utilisateur indisponible hors ligne.');
    error.code = 'auth/offline-user-not-found';
    throw error;
  }

  state.authState.currentUser = clone(entry.user);
  persistAuth();
  emitAuth(state.authState.currentUser);
  return { user: clone(entry.user) };
}

export async function createUserEmailPassword(_auth, email, password) {
  const native = await withNativeAuth(async (sdk, app) => {
    const auth = sdk.getAuth(app);
    return sdk.createUserWithEmailAndPassword(auth, email, password);
  });
  if (native?.user) return native;

  if (state.authState.users.some((user) => user.email === email)) {
    const error = new Error('Compte deja existant.');
    error.code = 'auth/email-already-in-use';
    throw error;
  }

  const user = {
    uid: `local_${Date.now().toString(36)}`,
    email,
    displayName: '',
    photoURL: ''
  };

  state.authState.users.push({ email, password, user });
  state.authState.currentUser = clone(user);
  persistAuth();
  emitAuth(state.authState.currentUser);
  return { user: clone(user) };
}

export async function signOutUser(_auth) {
  const native = await withNativeAuth(async (sdk, app) => {
    const auth = sdk.getAuth(app);
    return sdk.signOut(auth);
  });
  state.authState.currentUser = null;
  persistAuth();
  emitAuth(null);
  return native ?? undefined;
}

export async function sendPasswordReset(_auth, email) {
  const native = await withNativeAuth(async (sdk, app) => {
    const auth = sdk.getAuth(app);
    return sdk.sendPasswordResetEmail(auth, email);
  });
  if (native !== null) return native;

  if (!state.authState.users.some((user) => user.email === email)) {
    const error = new Error('Compte introuvable hors ligne.');
    error.code = 'auth/user-not-found';
    throw error;
  }

  return undefined;
}

export async function updateUserProfile(user, profile = {}) {
  const native = await withNativeAuth(async (sdk, app) => {
    const auth = sdk.getAuth(app);
    if (!auth.currentUser) return null;
    return sdk.updateProfile(auth.currentUser, profile);
  });

  if (state.authState.currentUser?.uid === user?.uid) {
    state.authState.currentUser = { ...state.authState.currentUser, ...profile };
  }
  state.authState.users = state.authState.users.map((entry) =>
    entry.user?.uid === user?.uid ? { ...entry, user: { ...entry.user, ...profile } } : entry
  );
  persistAuth();
  emitAuth(state.authState.currentUser);
  return native ?? undefined;
}

export async function signInPopup(_auth, provider) {
  const native = await withNativeAuth(async (sdk, app) => {
    const auth = sdk.getAuth(app);
    return sdk.signInWithPopup(auth, provider?.__native || provider);
  });
  if (native?.user) return native;

  const error = new Error('Connexion Google indisponible hors ligne.');
  error.code = 'auth/popup-unavailable-offline';
  throw error;
}

export async function setAuthPersistence(_auth, persistence) {
  const native = await withNativeAuth(async (sdk, app) => {
    const auth = sdk.getAuth(app);
    return sdk.setPersistence(auth, persistence);
  });
  return native ?? undefined;
}

export async function createGoogleProvider() {
  const native = await withNativeAuth(async (sdk) => new sdk.GoogleAuthProvider());
  return {
    __compat: true,
    __native: native || null,
    params: {},
    setCustomParameters(params = {}) {
      this.params = { ...this.params, ...params };
      if (this.__native?.setCustomParameters) {
        this.__native.setCustomParameters(params);
      }
    }
  };
}

export const browserLocalPersistenceValue = 'local';
export const cacheSizeUnlimitedValue = -1;
