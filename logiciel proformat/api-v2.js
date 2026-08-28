function functionsBase() {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const local = params?.get('useFunctionsEmulator') === '1' || params?.get('useFirebaseEmulators') === '1';
  return local ? 'http://127.0.0.1:5001/smartcutservices-9ce54/us-central1' : 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
}

export async function billingApi(name, { method = 'GET', body, query, user, idempotencyKey } = {}) {
  const url = new URL(`${functionsBase()}/billing${name}`);
  Object.entries(query || {}).forEach(([key, value]) => value !== '' && value != null && url.searchParams.set(key, value));
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  let response;
  try { response = await fetch(url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); }
  catch { throw new Error('Impossible de joindre SmartCut. Verifiez votre connexion.'); }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Une erreur est survenue.');
  return payload;
}

export const money = (minor = 0) => `${(Number(minor || 0) / 100).toLocaleString('fr-HT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} HTG`;
export const esc = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export const dateLabel = (value) => {
  const date = value?.toDate?.() || (value ? new Date(value) : null);
  return date && !Number.isNaN(date.valueOf()) ? new Intl.DateTimeFormat('fr-HT', { dateStyle: 'medium' }).format(date) : '—';
};
