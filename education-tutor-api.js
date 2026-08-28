import { auth } from './firebase-init.js';

const BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';

async function call(name, { method = 'GET', query = {}, body, authRequired = false } = {}) {
  const url = new URL(`${BASE}/${name}`);
  Object.entries(query).forEach(([key, value]) => value != null && value !== '' && url.searchParams.set(key, value));
  const headers = { 'Content-Type': 'application/json' };
  if (auth.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  else if (authRequired) throw new Error('Connectez-vous pour continuer.');
  const response = await fetch(url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
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
