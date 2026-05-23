// ============= FIREBASE INIT - MODULAR V9 =============
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  onAuthStateChanged,
  GoogleAuthProvider
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js';

const firebaseConfig = {
  apiKey: "AIzaSyBVTWSRyv7mzVhXLj5NHmg_MKKyWYgeBXg",
  authDomain: "smartcutservices-9ce54.firebaseapp.com",
  projectId: "smartcutservices-9ce54",
  storageBucket: "smartcutservices-9ce54.firebasestorage.app",
  messagingSenderId: "12148835666",
  appId: "1:12148835666:web:d18d80cedd5a36ec81e68b",
  measurementId: "G-TXG8KQDBBG"
};

const STORAGE_BUCKET_URL = 'gs://smartcutservices-9ce54.firebasestorage.app';

let app = null;
let db = null;
let auth = null;
let googleProvider = null;
let storage = null;
let authReadyPromise = Promise.resolve();
const firebaseState = globalThis.__SMART_CUT_FIREBASE__ || (globalThis.__SMART_CUT_FIREBASE__ = {});
const AUTH_DEBUG_VERSION = '20260523-5';

function testStorageArea(name) {
  try {
    const area = globalThis[name];
    if (!area) return 'missing';
    const key = `smartcut_auth_debug_${Date.now()}`;
    area.setItem(key, '1');
    const value = area.getItem(key);
    area.removeItem(key);
    return value === '1' ? 'ok' : 'read_mismatch';
  } catch (error) {
    return `error:${error?.name || error?.code || 'unknown'}`;
  }
}

function getAuthDebugContext(extra = {}) {
  return {
    version: AUTH_DEBUG_VERSION,
    href: globalThis.location?.href || '',
    origin: globalThis.location?.origin || '',
    userAgent: globalThis.navigator?.userAgent || '',
    cookieEnabled: Boolean(globalThis.navigator?.cookieEnabled),
    isSecureContext: Boolean(globalThis.isSecureContext),
    localStorage: testStorageArea('localStorage'),
    sessionStorage: testStorageArea('sessionStorage'),
    indexedDB: typeof globalThis.indexedDB !== 'undefined' ? 'available' : 'missing',
    currentUid: auth?.currentUser?.uid || null,
    currentAnonymous: Boolean(auth?.currentUser?.isAnonymous),
    ...extra
  };
}

function logAuthDebug(stage, extra = {}) {
  console.info('[AUTH_DEBUG]', getAuthDebugContext({ stage, ...extra }));
}

async function configureAuthPersistence(authInstance) {
  logAuthDebug('persistence:start');
  const candidates = [
    { label: 'local', value: browserLocalPersistence },
    { label: 'session', value: browserSessionPersistence },
    { label: 'memory', value: inMemoryPersistence }
  ];

  for (const candidate of candidates) {
    try {
      await setPersistence(authInstance, candidate.value);
      console.info('[AUTH] Persistence activee', { mode: candidate.label });
      logAuthDebug('persistence:active', { mode: candidate.label });
      return candidate.label;
    } catch (error) {
      console.warn('[AUTH] Persistence refusee', {
        mode: candidate.label,
        code: error?.code || null,
        message: error?.message || String(error)
      });
      logAuthDebug('persistence:refused', {
        mode: candidate.label,
        code: error?.code || null,
        message: error?.message || String(error)
      });
    }
  }

  logAuthDebug('persistence:default');
  return 'default';
}

function waitForFirstAuthState(authInstance) {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = null;
    let fallbackTimer = null;

    const settle = (user = null) => {
      if (settled) return;
      settled = true;
      globalThis.clearTimeout?.(fallbackTimer);
      try {
        unsubscribe?.();
      } catch (_) {}
      console.info('[AUTH] Etat initial Firebase resolu', {
        uid: user?.uid || null,
        isAnonymous: Boolean(user?.isAnonymous)
      });
      logAuthDebug('initial-state:resolved', {
        uid: user?.uid || null,
        isAnonymous: Boolean(user?.isAnonymous)
      });
      resolve(user);
    };

    fallbackTimer = globalThis.setTimeout?.(() => {
      console.warn('[AUTH] Etat initial Firebase trop lent, poursuite sans blocage');
      logAuthDebug('initial-state:timeout');
      settle(authInstance?.currentUser || null);
    }, 3500);

    unsubscribe = onAuthStateChanged(
      authInstance,
      (user) => settle(user),
      (error) => {
        console.warn('[AUTH] Erreur pendant la resolution initiale', error);
        settle(authInstance?.currentUser || null);
      }
    );
});
}

try {
  if (firebaseState.app && firebaseState.db && firebaseState.auth) {
    app = firebaseState.app;
    db = firebaseState.db;
    auth = firebaseState.auth;
    googleProvider = firebaseState.googleProvider;
    storage = firebaseState.storage;
    authReadyPromise = firebaseState.authReadyPromise || Promise.resolve(auth?.currentUser || null);
    console.info('[AUTH] Firebase singleton reutilise');
    logAuthDebug('firebase-singleton:reused');
  } else {
    logAuthDebug('firebase-singleton:create');
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    googleProvider = new GoogleAuthProvider();
    storage = getStorage(app, STORAGE_BUCKET_URL);

    googleProvider.setCustomParameters({
      prompt: 'select_account'
    });
    googleProvider.addScope('email');
    googleProvider.addScope('profile');

    authReadyPromise = configureAuthPersistence(auth)
      .then(() => waitForFirstAuthState(auth))
      .catch((err) => {
        console.warn('[AUTH] Initialisation auth incomplete:', err?.code || err);
        return auth?.currentUser || null;
      });

    Object.assign(firebaseState, {
      app,
      db,
      auth,
      googleProvider,
      storage,
      authReadyPromise
    });
    logAuthDebug('firebase-singleton:stored');
  }
} catch (error) {
  console.error('Firebase initialization error:', error);
  logAuthDebug('firebase-init:error', {
    message: error?.message || String(error),
    code: error?.code || null
  });
}

export { app, db, auth, googleProvider, storage, STORAGE_BUCKET_URL, authReadyPromise };

