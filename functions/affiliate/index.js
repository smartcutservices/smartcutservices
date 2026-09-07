'use strict';

const crypto = require('node:crypto');
const { onRequest } = require('firebase-functions/v2/https');

module.exports = function buildAffiliate(internals) {
  const { db, admin, REGION: region, verifyBearerUser } = internals;
  const timestamp = () => admin.firestore.FieldValue.serverTimestamp();
  const token = () => crypto.randomBytes(18).toString('base64url');
  const json = (res, status, body) => res.status(status).json(body);
  const cors = (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    return req.method === 'OPTIONS';
  };
  const endpoint = (handler) => onRequest({ region }, async (req, res) => {
    if (cors(req, res)) return res.status(204).send('');
    try { await handler(req, res); } catch (error) {
      console.error('[AFFILIATE]', error);
      json(res, error.status || 500, { ok: false, error: error.code || 'internal-error', message: error.status ? error.message : 'Une erreur est survenue.' });
    }
  });
  const fail = (status, code, message) => Object.assign(new Error(message), { status, code });
  const body = req => typeof req.body === 'object' && req.body ? req.body : {};
  const currentUser = async req => {
    const user = await verifyBearerUser(req);
    if (!user?.uid) throw fail(401, 'auth-required', 'Connexion requise.');
    return user;
  };
  const activeAffiliate = async uid => {
    const snap = await db.collection('affiliateAccounts').doc(uid).get();
    if (!snap.exists || snap.data()?.status !== 'ACTIVE') throw fail(403, 'affiliate-not-active', 'Compte affilié inactif.');
    return snap.data();
  };
  async function findProduct(productId) {
    if (!productId || productId.includes('/')) throw fail(400, 'invalid-product', 'Produit invalide.');
    const smart = await db.collection('products').doc(productId).get();
    if (smart.exists) return { snap: smart, sourceCollection: 'products' };
    const vendor = await db.collection('vendorProducts').doc(productId).get();
    if (vendor.exists) return { snap: vendor, sourceCollection: 'vendorProducts' };
    throw fail(404, 'product-not-found', 'Produit introuvable.');
  }
  async function eligibleProduct(productId) {
    const found = await findProduct(productId); const product = found.snap.data() || {};
    if (product.status !== 'active' || product.affiliateEligible !== true) throw fail(409, 'product-not-eligible', 'Produit non éligible au programme.');
    if (found.sourceCollection === 'vendorProducts') {
      const settings = product.vendorId ? await db.collection('sellerAffiliateSettings').doc(product.vendorId).get() : null;
      if (settings?.exists && settings.data()?.enabled !== true) throw fail(409, 'seller-not-participating', 'Le vendeur ne participe plus au programme.');
    }
    return { ...found, product };
  }

  const generateLink = endpoint(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' });
    const user = await currentUser(req); await activeAffiliate(user.uid);
    const productId = String(body(req).productId || '').trim(); const found = await eligibleProduct(productId);
    const existing = await db.collection('affiliateLinks').where('affiliateId', '==', user.uid).where('productId', '==', productId).limit(1).get();
    if (!existing.empty) return json(res, 200, { ok: true, link: { id: existing.docs[0].id, ...existing.docs[0].data() } });
    const tokenValue = token(); const url = `https://smartcutservices.com/product.html?product=${encodeURIComponent(productId)}&ref=${encodeURIComponent(tokenValue)}`;
    const ref = await db.collection('affiliateLinks').add({ affiliateId: user.uid, productId, sourceCollection: found.sourceCollection, productName: String(found.product.name || 'Produit'), token: tokenValue, url, status: 'ACTIVE', clicks: 0, conversions: 0, createdAt: timestamp(), updatedAt: timestamp() });
    return json(res, 201, { ok: true, link: { id: ref.id, affiliateId: user.uid, productId, productName: found.product.name || 'Produit', token: tokenValue, url, status: 'ACTIVE', clicks: 0, conversions: 0 } });
  });

  const trackClick = endpoint(async (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' });
    const tokenValue = String(req.query?.ref || req.query?.token || '').trim();
    if (!tokenValue) return json(res, 400, { ok: false, error: 'missing-token' });
    const links = await db.collection('affiliateLinks').where('token', '==', tokenValue).where('status', '==', 'ACTIVE').limit(1).get();
    if (links.empty) return json(res, 404, { ok: false, error: 'invalid-link' });
    const linkSnap = links.docs[0]; const link = linkSnap.data() || {}; await activeAffiliate(String(link.affiliateId || '')); await eligibleProduct(String(link.productId || ''));
    const sessionId = crypto.randomBytes(16).toString('hex'); const now = new Date(); const days = 7; const expiresAt = new Date(now.getTime() + days * 86400000);
    const ip = String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(); const ipHash = crypto.createHash('sha256').update(ip || 'anonymous').digest('hex');
    await Promise.all([
      db.collection('affiliateClicks').add({ affiliateId: link.affiliateId, productId: link.productId, affiliateLinkId: linkSnap.id, sessionId, clickedAt: timestamp(), referrer: String(req.headers.referer || '').slice(0,500), ipHash }),
      db.collection('affiliateReferrals').doc(sessionId).set({ affiliateId: link.affiliateId, productId: link.productId, affiliateLinkId: linkSnap.id, sessionId, startedAt: timestamp(), expiresAt, status: 'ACTIVE', attributionRule: 'LAST_VALID_CLICK' }),
      linkSnap.ref.set({ clicks: admin.firestore.FieldValue.increment(1), updatedAt: timestamp() }, { merge: true })
    ]);
    return json(res, 200, { ok: true, sessionId, affiliateId: link.affiliateId, productId: link.productId, expiresAt: expiresAt.toISOString() });
  });
  const requestPayout = endpoint(async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' });
    const user = await currentUser(req); await activeAffiliate(user.uid);
    const requestedAmount = Math.max(0, Number(body(req).amount || 0));
    const method = String(body(req).method || 'moncash').trim().slice(0, 40);
    const destination = String(body(req).destination || '').trim().slice(0, 160);
    if (!destination || requestedAmount <= 0) return json(res, 400, { ok: false, error: 'invalid-payout-request' });
    const existing = await db.collection('affiliatePayouts').where('affiliateId', '==', user.uid).get();
    if (existing.docs.some((snap) => ['REQUESTED', 'PROCESSING'].includes(String(snap.data()?.status || '')))) return json(res, 409, { ok: false, error: 'payout-already-requested' });
    const commissions = await db.collection('affiliateCommissions').where('affiliateId', '==', user.uid).where('status', '==', 'AVAILABLE').get();
    const available = commissions.docs.reduce((sum, snap) => sum + Math.max(0, Number(snap.data()?.commissionAmount || 0)), 0);
    if (requestedAmount > available) return json(res, 409, { ok: false, error: 'insufficient-available-balance', available });
    if (Math.abs(requestedAmount - available) > 0.01) return json(res, 409, { ok: false, error: 'amount-must-equal-available-balance', available });
    const ref = db.collection('affiliatePayouts').doc();
    await ref.set({ affiliateId: user.uid, amount: requestedAmount, method, destination, status: 'REQUESTED', commissionIds: commissions.docs.map(s => s.id), requestedAt: timestamp(), updatedAt: timestamp() });
    return json(res, 201, { ok: true, payoutId: ref.id, amount: requestedAmount, available });
  });
  return { affiliateGenerateLink: generateLink, affiliateTrackClick: trackClick, affiliateRequestPayout: requestPayout };
};
