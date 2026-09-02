import { auth } from './firebase-init.js?v=20260901-1';

function functionBase() {
  const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
  const local = params?.get('useFunctionsEmulator') === '1' || params?.get('useFirebaseEmulators') === '1';
  return local ? 'http://127.0.0.1:5001/smartcutservices-9ce54/us-central1' : 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
}

export async function marketplaceApi(name, { method = 'GET', body, query, requireAuth = false } = {}) {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('useMarketplaceFixtures') === '1' && method === 'GET') {
    const fixture = await fetch('./marketplace-fixtures.json').then((r) => r.json());
    if (name === 'PublicServices') { let services = [...fixture.services]; if (query?.category) services = services.filter((x) => x.categoryId === query.category); if (query?.pricingType) services = services.filter((x) => x.pricingType === query.pricingType); if (query?.maxPriceMinor) services = services.filter((x) => x.pricingType === 'CUSTOM_QUOTE' || x.priceMinor <= Number(query.maxPriceMinor)); if (query?.maxDeliveryDays) services = services.filter((x) => x.deliveryDays <= Number(query.maxDeliveryDays)); if (query?.q) { const q = String(query.q).toLowerCase(); services = services.filter((x) => `${x.name} ${x.shortDescription}`.toLowerCase().includes(q)); } if (query?.sort === 'price-asc') services.sort((a,b)=>a.priceMinor-b.priceMinor); if (query?.sort === 'price-desc') services.sort((a,b)=>b.priceMinor-a.priceMinor); return { ok: true, services, providers: fixture.providers }; }
    if (name === 'PublicService') { const service = fixture.services.find((x) => x.slug === query?.slug); if (!service) throw new Error('Service introuvable.'); return { ok: true, service, provider: fixture.providers[service.ownerUid], reviews: fixture.reviews.filter((x) => x.serviceId === service.id) }; }
    if (name === 'PublicProvider') { const provider = fixture.providers[query?.uid]; if (!provider) throw new Error('Prestataire introuvable.'); return { ok: true, provider, services: fixture.services.filter((x) => x.ownerUid === query.uid), reviews: fixture.reviews.filter((x) => x.providerUid === query.uid) }; }
  }
  const url = new URL(`${functionBase()}/marketplace${name}`);
  Object.entries(query || {}).forEach(([key, value]) => value !== '' && value != null && url.searchParams.set(key, value));
  const headers = { 'Content-Type': 'application/json' };
  if (auth?.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
  else if (requireAuth) throw new Error('Connexion requise.');
  let response;
  try { response = await fetch(url, { method, headers, cache: name.startsWith('Public') ? 'no-store' : 'default', body: method === 'GET' ? undefined : JSON.stringify(body || {}) }); }
  catch { throw new Error('Impossible de joindre SmartCut. Vérifiez votre connexion.'); }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) {
    const error = new Error(payload?.message || 'Une erreur est survenue.'); error.code = payload?.error || 'request-failed'; throw error;
  }
  if (name === 'SaveService' && body?.publish && payload.id && ['DRAFT', 'REJECTED'].includes(payload.service?.publicationStatus || 'DRAFT')) {
    await marketplaceApi('ServiceAction', { method: 'POST', body: { id: payload.id, action: 'submit' }, requireAuth: true });
    payload.service = { ...payload.service, publicationStatus: 'PUBLISHED', visibility: 'PUBLIC' };
  }
  return payload;
}

export const money = (minor = 0) => `${(Number(minor || 0) / 100).toLocaleString('fr-HT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} HTG`;
export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
export const dateLabel = (value) => { const date = value?.toDate?.() || (value?._seconds ? new Date(value._seconds * 1000) : value ? new Date(value) : null); return date && !Number.isNaN(date.valueOf()) ? new Intl.DateTimeFormat('fr-HT', { dateStyle: 'medium' }).format(date) : '—'; };
