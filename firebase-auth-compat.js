import {
  browserLocalPersistenceValue,
  createGoogleProvider,
  createUserEmailPassword,
  makeAuth,
  sendPasswordReset,
  setAuthPersistence,
  signInEmailPassword,
  signInPopup,
  signOutUser,
  subscribeAuthState,
  updateUserProfile
} from './firebase-compat-core.js';

export const browserLocalPersistence = browserLocalPersistenceValue;

export function getAuth(app) {
  return makeAuth(app);
}

export function setPersistence(auth, persistence) {
  return setAuthPersistence(auth, persistence);
}

export class GoogleAuthProvider {
  constructor() {
    this.__native = null;
    this._providerPromise = createGoogleProvider().then((provider) => {
      this._provider = provider;
      this.__native = provider?.__native || null;
      return provider;
    });
    this._provider = null;
  }

  setCustomParameters(params = {}) {
    if (this._provider) {
      this._provider.setCustomParameters(params);
      return;
    }

    this._providerPromise.then((provider) => provider.setCustomParameters(params));
  }
}

export function onAuthStateChanged(auth, callback) {
  return subscribeAuthState(auth, callback);
}

export function signInWithEmailAndPassword(auth, email, password) {
  return signInEmailPassword(auth, email, password);
}

export function createUserWithEmailAndPassword(auth, email, password) {
  return createUserEmailPassword(auth, email, password);
}

export function signOut(auth) {
  return signOutUser(auth);
}

export function sendPasswordResetEmail(auth, email) {
  return sendPasswordReset(auth, email);
}

export function updateProfile(user, profile) {
  return updateUserProfile(user, profile);
}

export function signInWithPopup(auth, provider) {
  return signInPopup(auth, provider);
}
