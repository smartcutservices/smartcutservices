import {
  createFallbackApp,
  getFallbackApp,
  listFallbackApps
} from './firebase-compat-core.js';

export function initializeApp(config = {}) {
  return createFallbackApp(config);
}

export function getApps() {
  return listFallbackApps();
}

export function getApp() {
  return getFallbackApp();
}
