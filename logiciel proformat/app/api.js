import { billingApi } from '../api-v2.js';
import { marketplaceApi } from '../../marketplace-api.js?v=20260827-2';

export async function loadWorkspace(user) {
  if (new URLSearchParams(location.search).get('useMarketplaceFixtures') === '1') {
    const fixture = await fetch('../marketplace-fixtures.json').then((r) => r.json());
    return { marketplace: { profile: { ...fixture.providers['provider-demo'], ownerUid: 'provider-demo', status: 'ACTIVE', logoUrl: '../logo.png', address: 'Pétion-Ville, Haïti', terms: 'Conditions de prestation enregistrées.', revisionPolicy: 'Deux révisions selon le forfait.' }, services: fixture.services, requests: [{ id:'request-demo', providerUid:'provider-demo', buyerUid:'buyer-demo', objective:'Nouvelle identité pour une boutique', description:'Créer une identité simple pour le lancement.', serviceSnapshot:fixture.services[0], status:'NEW', createdAt:new Date().toISOString() }], orders: [], proposals: [], messages: [], notifications: [{ title:'Nouvelle demande', message:'Nouvelle identité pour une boutique' }], categories: [] }, billing: { profile:{ businessName:'Atelier Nord', moncashNumber:'37000000' }, balance:{ availableMinor:1250000,reservedMinor:0,paidOutMinor:400000 }, clients:[],proformas:[],invoices:[],payments:[],withdrawals:[],ledger:[],notifications:[] } };
  }
  const [marketplace, billing] = await Promise.all([
    marketplaceApi('Bootstrap', { requireAuth: true }),
    billingApi('Bootstrap', { user })
  ]);
  return { marketplace, billing };
}

export { billingApi, marketplaceApi };
