import { auth } from './firebase-init.js';

const BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';

async function call(name, { method = 'GET', query = {}, body, authRequired = false } = {}) {
  const url = new URL(`${BASE}/${name}`);
  Object.entries(query).forEach(([key, value]) => value != null && value !== '' && url.searchParams.set(key, value));
  // Keep GET requests a "simple" CORS request: sending Content-Type on a GET
  // needlessly triggers an OPTIONS preflight and makes the public tutor catalog
  // fragile when a cached/older function version is still serving the endpoint.
  const headers = method === 'GET' ? {} : { 'Content-Type': 'application/json' };
  if (auth.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  else if (authRequired) throw new Error('Connectez-vous pour continuer.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}), signal: controller.signal });
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? 'Le serveur met trop de temps à répondre. Réessayez.' : 'Impossible de contacter le serveur. Vérifiez votre connexion.');
  } finally {
    clearTimeout(timeout);
  }
  let payload = null;
  try { payload = await response.json(); } catch (_) {}
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Le service est momentanément indisponible.');
  return payload;
}

export const tutorApi = {
  catalog: (tutorId = '') => call('educationGetTutorCatalog', { query: { tutorId } }),
  dashboard: () => call('educationGetTutorDashboard', { authRequired: true }),
  saveProfile: (body) => call('educationSaveTutorProfile', { method: 'POST', authRequired: true, body }),
  saveService: (body) => call('educationSaveTutorService', { method: 'POST', authRequired: true, body }),
  archiveService: (serviceId) => call('educationArchiveTutorService', { method: 'POST', authRequired: true, body: { serviceId } }),
  createRequest: (body) => call('educationCreateTutorRequest', { method: 'POST', authRequired: true, body }),
  updateRequest: (body) => call('educationUpdateTutorRequest', { method: 'POST', authRequired: true, body })
};
