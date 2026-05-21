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

async function configureAuthPersistence(authInstance) {
  const candidates = [
    { label: 'local', value: browserLocalPersistence },
    { label: 'session', value: browserSessionPersistence },
    { label: 'memory', value: inMemoryPersistence }
  ];

  for (const candidate of candidates) {
    try {
      await setPersistence(authInstance, candidate.value);
      console.info('[AUTH] Persistence activee', { mode: candidate.label });
      return candidate.label;
    } catch (error) {
      console.warn('[AUTH] Persistence refusee', {
        mode: candidate.label,
        code: error?.code || null,
        message: error?.message || String(error)
      });
    }
  }

  return 'default';
}

function waitForFirstAuthState(authInstance) {
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = null;

    const settle = (user = null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout?.(fallbackTimer);
      try {
        unsubscribe?.();
      } catch (_) {}
      console.info('[AUTH] Etat initial Firebase resolu', {
        uid: user?.uid || null,
        isAnonymous: Boolean(user?.isAnonymous)
      });
      resolve(user);
    };

    const fallbackTimer = window.setTimeout?.(() => {
      console.warn('[AUTH] Etat initial Firebase trop lent, poursuite sans blocage');
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
} catch (error) {
  console.error('Firebase initialization error:', error);
}

export { app, db, auth, googleProvider, storage, STORAGE_BUCKET_URL, authReadyPromise };
