'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const crypto = require('node:crypto');
const { formatDocumentNumber } = require('../invoicing/domain');
const {
  cleanText, normalizeEmail, normalizeService, publicationChecklist,
  canTransitionOrder, calculateCommission, calculateRefundDebit, asMinor
} = require('./domain');

const PUBLIC_SITE = 'https://smartcutservices.com';
const PAGE_LIMIT = 24;

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function buildMarketplace(internals) {
  const { db, admin, REGION: region } = internals;
  const timestamp = () => admin.firestore.FieldValue.serverTimestamp();
  const token = () => crypto.randomBytes(24).toString('base64url');
  const serialize = (snap) => ({ id: snap.id, ...snap.data() });

  function endpoint(handler) {
    return onRequest({ region }, async (req, res) => {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      if (req.method === 'OPTIONS') return res.status(204).send('');
      try { await handler(req, res); }
      catch (error) {
        if (error instanceof ApiError) return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
        logger.error('marketplace endpoint failed', { message: error?.message, stack: error?.stack });
        return res.status(500).json({ ok: false, error: 'internal-error', message: 'Une erreur est survenue. Veuillez réessayer.' });
      }
    });
  }

  async function user(req) {
    const decoded = await internals.verifyBearerUser(req);
    if (!decoded?.uid) throw new ApiError(401, 'auth-required', 'Connexion requise.');
    return decoded;
  }

  async function isStaff(uid, roles = ['platform_admin', 'support_agent']) {
    if (await internals.isAdminUser(uid)) return true;
    const snap = await db.collection('platformRoles').doc(uid).get();
    return snap.exists && snap.data().status === 'active' && roles.includes(snap.data().role);
  }

  async function requireStaff(req, roles) {
    const current = await user(req);
    if (!(await isStaff(current.uid, roles))) throw new ApiError(403, 'admin-required', 'Accès administrateur requis.');
    return current;
  }

  async function owned(collection, id, uid) {
    if (!id || id.includes('/')) throw new ApiError(400, 'invalid-id', 'Identifiant invalide.');
    const snap = await db.collection(collection).doc(id).get();
    if (!snap.exists || snap.data().ownerUid !== uid) throw new ApiError(404, 'not-found', 'Élément introuvable.');
    return snap;
  }

  async function participant(collection, id, uid) {
    const snap = await db.collection(collection).doc(id).get();
    const data = snap.data();
    if (!snap.exists || ![data?.buyerUid, data?.providerUid, data?.ownerUid].includes(uid)) throw new ApiError(404, 'not-found', 'Élément introuvable.');
    return snap;
  }

  async function throttle(uid, action, max = 8) {
    const bucket = Math.floor(Date.now() / 60000);
    const ref = db.collection('marketplaceRateLimits').doc(`${uid}_${action}_${bucket}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref); const count = Number(snap.data()?.count || 0);
      if (count >= max) throw new ApiError(429, 'rate-limited', 'Trop de tentatives. Réessayez dans une minute.');
      tx.set(ref, { uid, action, bucket, count: count + 1, expiresAt: new Date(Date.now() + 120000) }, { merge: true });
    });
  }

  async function audit(data) {
    await db.collection('serviceModerationLogs').add({ ...data, createdAt: timestamp() });
  }

  function profileIsComplete(profile = {}) {
    if (['ACTIVE', 'PENDING_REVIEW'].includes(profile.status)) return true;
    return Boolean(
      profile.businessName && profile.professionalTitle && profile.shortBio &&
      profile.biography && profile.specialties?.length && (profile.address || profile.commune)
    );
  }

  async function nextNumber(tx, uid, kind, prefix) {
    const year = new Date().getUTCFullYear();
    const ref = db.collection('billingCounters').doc(`${uid}_${kind}_${year}`);
    const snap = await tx.get(ref); const sequence = Number(snap.data()?.sequence || 0) + 1;
    tx.set(ref, { ownerUid: uid, kind, year, sequence, updatedAt: timestamp() }, { merge: true });
    return formatDocumentNumber(prefix, year, sequence);
  }

  async function commissionRule(service) {
    const [global, category, provider] = await Promise.all([
      db.collection('marketplaceSettings').doc('commission').get(),
      service.categoryId ? db.collection('marketplaceCommissionRules').doc(`category_${service.categoryId}`).get() : null,
      db.collection('marketplaceCommissionRules').doc(`provider_${service.ownerUid}`).get()
    ]);
    const active = (snap) => snap?.exists && (!snap.data().effectiveAt || new Date(snap.data().effectiveAt).valueOf() <= Date.now());
    if (active(provider)) return provider.data();
    if (active(category)) return category.data();
    if (active(global)) return global.data();
    throw new ApiError(503, 'commission-unconfigured', 'La commission SmartCut doit être configurée avant de créer une proposition.');
  }

  const bootstrap = endpoint(async (req, res) => {
    const current = await user(req);
    const [profile, services, requests, orders, proposals, messages, notifications, categories] = await Promise.all([
      db.collection('providerProfiles').doc(current.uid).get(),
      db.collection('billingServices').where('ownerUid', '==', current.uid).limit(100).get(),
      db.collection('serviceRequests').where('providerUid', '==', current.uid).limit(50).get(),
      db.collection('serviceOrders').where('providerUid', '==', current.uid).limit(50).get(),
      db.collection('serviceProposals').where('providerUid', '==', current.uid).limit(50).get(),
      db.collection('serviceOrderMessages').where('participantUids', 'array-contains', current.uid).limit(50).get(),
      db.collection('marketplaceNotifications').where('recipientUid', '==', current.uid).limit(30).get(),
      db.collection('serviceCategories').where('active', '==', true).limit(50).get()
    ]);
    res.json({ ok: true, profile: profile.exists ? profile.data() : null, services: services.docs.map(serialize), requests: requests.docs.map(serialize),
      orders: orders.docs.map(serialize), proposals: proposals.docs.map(serialize), messages: messages.docs.map(serialize),
      notifications: notifications.docs.map(serialize), categories: categories.docs.map(serialize) });
  });

  const clientBootstrap = endpoint(async (req, res) => {
    const current = await user(req);
    const [requests, orders, proposals, messages] = await Promise.all([
      db.collection('serviceRequests').where('buyerUid', '==', current.uid).limit(50).get(),
      db.collection('serviceOrders').where('buyerUid', '==', current.uid).limit(50).get(),
      db.collection('serviceProposals').where('buyerUid', '==', current.uid).limit(50).get(),
      db.collection('serviceOrderMessages').where('participantUids', 'array-contains', current.uid).limit(50).get()
    ]);
    res.json({ ok: true, requests: requests.docs.map(serialize), orders: orders.docs.map(serialize), proposals: proposals.docs.map(serialize), messages: messages.docs.map(serialize) });
  });

  const saveProfile = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const b = req.body || {}; const ref = db.collection('providerProfiles').doc(current.uid); const old = await ref.get();
    const profile = { ownerUid: current.uid, businessName: cleanText(b.businessName, 140), professionalTitle: cleanText(b.professionalTitle, 160),
      shortBio: cleanText(b.shortBio, 260), biography: cleanText(b.biography, 3000), specialties: toList(b.specialties, 12, 80),
      address: cleanText(b.address, 220), commune: '', languages: [], experience: cleanText(b.experience, 1000),
      responseTimeLabel: old.data()?.responseTimeLabel || '', whatsapp: '', showWhatsappAfterAcceptance: false,
      professionalEmail: '', showProfessionalEmail: false, socialLinks: [], portfolio: [],
      availability: cleanText(b.availability, 300), terms: cleanText(b.terms, 3000), revisionPolicy: cleanText(b.revisionPolicy, 2000),
      logoUrl: cleanText(b.logoUrl, 700), coverUrl: '', status: old.data()?.status || 'INCOMPLETE', updatedAt: timestamp() };
    if (!old.exists) profile.createdAt = timestamp();
    const complete = profileIsComplete(profile);
    if (b.submit && complete && profile.status !== 'ACTIVE') profile.status = 'PENDING_REVIEW';
    await ref.set(profile, { merge: true }); res.json({ ok: true, profile });
  });

  const saveService = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const providerProfile = await db.collection('providerProfiles').doc(current.uid).get();
    if (!providerProfile.exists || !profileIsComplete(providerProfile.data())) throw new ApiError(403, 'profile-required', 'Complétez votre profil public avant de créer un service.');
    const id = cleanText(req.body?.id, 120); const ref = id ? db.collection('billingServices').doc(id) : db.collection('billingServices').doc();
    const previous = id ? await owned('billingServices', id, current.uid) : null;
    if (['PUBLISHED', 'SUSPENDED'].includes(previous?.data()?.publicationStatus)) throw new ApiError(409, 'moderated-service', 'Dupliquez ce service pour modifier une fiche publiée.');
    let service; try { service = normalizeService(req.body, previous?.data() || {}); } catch (e) { throw new ApiError(400, e.message, 'Vérifiez les informations du service.'); }
    service.ownerUid = current.uid; service.providerProfileId = current.uid; service.updatedAt = timestamp(); if (!previous) service.createdAt = timestamp();
    if (req.body?.publish) {
      const missing = publicationChecklist(service, providerProfile.data());
      if (missing.length) throw new ApiError(400, 'publication-incomplete', `À compléter : ${missing.join(', ')}.`);
      if (!['DRAFT', 'REJECTED'].includes(service.publicationStatus || 'DRAFT')) throw new ApiError(409, 'invalid-status', 'Ce service ne peut pas être publié.');
      service.publicationStatus = 'PUBLISHED';
      service.visibility = 'PUBLIC';
      service.publishedAt = timestamp();
      service.moderation = { lastAction: 'AUTO_PUBLISHED', submittedAt: timestamp(), rejectionReason: '' };
    }
    await ref.set(service, { merge: true });
    if (req.body?.publish) await audit({ actorUid: current.uid, ownerUid: current.uid, serviceId: ref.id, action: 'PUBLISHED' });
    res.json({ ok: true, id: ref.id, service });
  });

  const serviceAction = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const snap = await owned('billingServices', cleanText(req.body?.id, 120), current.uid); const action = cleanText(req.body?.action, 30);
    if (action === 'archive') { await snap.ref.set({ publicationStatus: 'ARCHIVED', visibility: 'PRIVATE', archived: true, updatedAt: timestamp() }, { merge: true }); return res.json({ ok: true }); }
    if (action === 'duplicate') { const copy = { ...snap.data(), name: `${snap.data().name} — copie`, slug: '', publicationStatus: 'DRAFT', visibility: 'PRIVATE', archived: false, createdAt: timestamp(), updatedAt: timestamp() }; delete copy.publishedAt; delete copy.moderation; const ref = await db.collection('billingServices').add(copy); return res.json({ ok: true, id: ref.id }); }
    if (action !== 'submit') throw new ApiError(400, 'invalid-action', 'Action invalide.');
    const profile = await db.collection('providerProfiles').doc(current.uid).get(); const missing = publicationChecklist(snap.data(), profile.data());
    if (missing.length) throw new ApiError(400, 'publication-incomplete', `À compléter : ${missing.join(', ')}.`);
    if (!['DRAFT', 'REJECTED'].includes(snap.data().publicationStatus || 'DRAFT')) throw new ApiError(409, 'invalid-status', 'Ce service ne peut pas être envoyé.');
    await snap.ref.set({ publicationStatus: 'PUBLISHED', visibility: 'PUBLIC', publishedAt: timestamp(), moderation: { lastAction: 'AUTO_PUBLISHED', submittedAt: timestamp(), rejectionReason: '' }, updatedAt: timestamp() }, { merge: true });
    await audit({ actorUid: current.uid, ownerUid: current.uid, serviceId: snap.id, action: 'PUBLISHED' }); res.json({ ok: true, publicationStatus: 'PUBLISHED' });
  });

  const moderationQueue = endpoint(async (req, res) => {
    await requireStaff(req); const status = cleanText(req.query.status || 'PENDING_REVIEW', 30);
    const services = await db.collection('billingServices').where('publicationStatus', '==', status).limit(50).get();
    const providerIds = [...new Set(services.docs.map((x) => x.data().ownerUid))];
    const profiles = await Promise.all(providerIds.map((uid) => db.collection('providerProfiles').doc(uid).get()));
    const [pendingProfiles, openDisputes] = await Promise.all([
      db.collection('providerProfiles').where('status', '==', 'PENDING_REVIEW').limit(50).get(),
      db.collection('serviceDisputes').where('status', '==', 'OPEN').limit(50).get()
    ]);
    res.json({ ok: true, services: services.docs.map(serialize), profiles: profiles.filter((x) => x.exists).map(serialize), pendingProfiles: pendingProfiles.docs.map(serialize), openDisputes: openDisputes.docs.map(serialize) });
  });

  const moderateProfile = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const staff = await requireStaff(req);
    const uid = cleanText(req.body?.uid, 128), action = cleanText(req.body?.action, 20).toUpperCase(); const ref = db.collection('providerProfiles').doc(uid); const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, 'not-found', 'Profil introuvable.'); const next = { APPROVE: 'ACTIVE', REJECT: 'INCOMPLETE', SUSPEND: 'SUSPENDED' }[action];
    if (!next) throw new ApiError(400, 'invalid-action', 'Action invalide.'); const reason = cleanText(req.body?.reason, 1000);
    await ref.set({ status: next, moderation: { action, reason, moderatorUid: staff.uid, decidedAt: timestamp() }, updatedAt: timestamp() }, { merge: true });
    await audit({ actorUid: staff.uid, ownerUid: uid, profileId: uid, action: `PROFILE_${action}`, reason }); res.json({ ok: true });
  });

  const moderateService = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
    const staff = await requireStaff(req); const id = cleanText(req.body?.id, 120); const action = cleanText(req.body?.action, 20).toUpperCase();
    const snap = await db.collection('billingServices').doc(id).get(); if (!snap.exists) throw new ApiError(404, 'not-found', 'Service introuvable.');
    const next = { APPROVE: 'PUBLISHED', REJECT: 'REJECTED', SUSPEND: 'SUSPENDED', ARCHIVE: 'ARCHIVED' }[action];
    if (!next) throw new ApiError(400, 'invalid-action', 'Action invalide.');
    if (action === 'APPROVE' && snap.data().publicationStatus !== 'PENDING_REVIEW') throw new ApiError(409, 'invalid-status', 'Le service doit être en attente.');
    const reason = cleanText(req.body?.reason, 1000); if (action === 'REJECT' && !reason) throw new ApiError(400, 'reason-required', 'Le motif est requis.');
    await snap.ref.set({ publicationStatus: next, visibility: next === 'PUBLISHED' ? 'PUBLIC' : 'PRIVATE', archived: next === 'ARCHIVED',
      moderation: { lastAction: action, reason, moderatorUid: staff.uid, decidedAt: timestamp() }, ...(next === 'PUBLISHED' ? { publishedAt: timestamp() } : {}), updatedAt: timestamp() }, { merge: true });
    await audit({ actorUid: staff.uid, ownerUid: snap.data().ownerUid, serviceId: id, action, reason }); res.json({ ok: true });
  });

  const publicServices = endpoint(async (req, res) => {
    const limit = Math.min(PAGE_LIMIT, Math.max(1, Number(req.query.limit || 12))); let query = db.collection('billingServices')
      .where('publicationStatus', '==', 'PUBLISHED').where('visibility', '==', 'PUBLIC');
    if (req.query.category) query = query.where('categoryId', '==', cleanText(req.query.category, 80));
    const snap = await query.limit(limit).get(); const profileIds = [...new Set(snap.docs.map((x) => x.data().ownerUid))];
    const profiles = await Promise.all(profileIds.map((uid) => db.collection('providerProfiles').doc(uid).get()));
    const profileMap = Object.fromEntries(profiles.filter((x) => x.exists && ['ACTIVE', 'PENDING_REVIEW'].includes(x.data().status)).map((x) => [x.id, publicProfile(x.data(), x.id)]));
    let services = snap.docs.map(serialize).filter((x) => profileMap[x.ownerUid]);
    const search = cleanText(req.query.q, 100).toLowerCase(); if (search) services = services.filter((x) => `${x.name} ${x.shortDescription} ${(x.tags || []).join(' ')}`.toLowerCase().includes(search));
    const pricingType = cleanText(req.query.pricingType, 30); if (pricingType) services = services.filter((x) => x.pricingType === pricingType);
    const maxPriceMinor = Number(req.query.maxPriceMinor || 0); if (maxPriceMinor > 0) services = services.filter((x) => x.pricingType === 'CUSTOM_QUOTE' || Number(x.priceMinor || 0) <= maxPriceMinor);
    const maxDeliveryDays = Number(req.query.maxDeliveryDays || 0); if (maxDeliveryDays > 0) services = services.filter((x) => Number(x.deliveryDays || 9999) <= maxDeliveryDays);
    if (req.query.remote === '1') services = services.filter((x) => (x.serviceArea || 'REMOTE') === 'REMOTE');
    const sort = cleanText(req.query.sort, 20); if (sort === 'price-asc') services.sort((a,b)=>(a.priceMinor||0)-(b.priceMinor||0)); if (sort === 'price-desc') services.sort((a,b)=>(b.priceMinor||0)-(a.priceMinor||0));
    res.set('Cache-Control', 'no-store'); res.json({ ok: true, services, providers: profileMap });
  });

  const publicService = endpoint(async (req, res) => {
    const slug = cleanText(req.query.slug, 100); const snap = await db.collection('billingServices').where('slug', '==', slug).where('publicationStatus', '==', 'PUBLISHED').where('visibility', '==', 'PUBLIC').limit(1).get();
    if (snap.empty) throw new ApiError(404, 'not-found', 'Service introuvable.'); const service = serialize(snap.docs[0]);
    const profile = await db.collection('providerProfiles').doc(service.ownerUid).get(); if (!profile.exists || !['ACTIVE', 'PENDING_REVIEW'].includes(profile.data().status)) throw new ApiError(404, 'not-found', 'Service introuvable.');
    const reviews = await db.collection('serviceReviews').where('serviceId', '==', service.id).where('status', '==', 'PUBLISHED').limit(20).get();
    res.set('Cache-Control', 'no-store'); res.json({ ok: true, service, provider: publicProfile(profile.data(), profile.id), reviews: reviews.docs.map((x) => ({ id: x.id, rating: x.data().rating, comment: x.data().comment, createdAt: x.data().createdAt })) });
  });

  const publicProvider = endpoint(async (req, res) => {
    const uid = cleanText(req.query.uid, 128); const profile = await db.collection('providerProfiles').doc(uid).get();
    if (!profile.exists || !['ACTIVE', 'PENDING_REVIEW'].includes(profile.data().status)) throw new ApiError(404, 'not-found', 'Prestataire introuvable.');
    const services = await db.collection('billingServices').where('ownerUid', '==', uid).limit(50).get();
    const published = services.docs.map(serialize).filter((x) => x.publicationStatus === 'PUBLISHED' && x.visibility === 'PUBLIC');
    const reviews = await db.collection('serviceReviews').where('providerUid', '==', uid).where('status', '==', 'PUBLISHED').limit(20).get();
    res.set('Cache-Control', 'no-store'); res.json({ ok: true, provider: publicProfile(profile.data(), uid), services: published, reviews: reviews.docs.map(serialize) });
  });

  const createRequest = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req); await throttle(current.uid, 'request', 5);
    const service = await db.collection('billingServices').doc(cleanText(req.body?.serviceId, 120)).get();
    if (!service.exists || service.data().publicationStatus !== 'PUBLISHED' || service.data().visibility !== 'PUBLIC') throw new ApiError(404, 'not-found', 'Service introuvable.');
    if (service.data().ownerUid === current.uid) throw new ApiError(409, 'self-request', 'Vous ne pouvez pas commander votre propre service.');
    const objective = cleanText(req.body?.objective, 220), description = cleanText(req.body?.description, 4000); if (!objective || description.length < 20) throw new ApiError(400, 'details-required', 'Décrivez votre besoin avec au moins 20 caractères.');
    const ref = db.collection('serviceRequests').doc(); const files = safeFiles(req.body?.files);
    await ref.set({ serviceId: service.id, serviceSnapshot: serviceSnapshot(service.data(), service.id), buyerUid: current.uid, providerUid: service.data().ownerUid,
      objective, description, budgetMinor: Number.isSafeInteger(req.body?.budgetMinor) ? req.body.budgetMinor : null, desiredDate: cleanText(req.body?.desiredDate, 10),
      files, status: 'NEW', contactReleased: false, createdAt: timestamp(), updatedAt: timestamp() });
    await notify(service.data().ownerUid, 'NEW_REQUEST', 'Nouvelle demande', objective, ref.id); res.json({ ok: true, id: ref.id });
  });

  const requestAction = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req);
    const snap = await db.collection('serviceRequests').doc(cleanText(req.body?.id, 120)).get(); if (!snap.exists || snap.data().providerUid !== current.uid) throw new ApiError(404, 'not-found', 'Demande introuvable.');
    const next = String(req.body?.action || '').toUpperCase() === 'ACCEPT' ? 'ACCEPTED' : String(req.body?.action || '').toUpperCase() === 'DECLINE' ? 'DECLINED' : null;
    if (!next || !['NEW','VIEWED'].includes(snap.data().status)) throw new ApiError(409, 'invalid-status', 'Transition invalide.');
    const profile = await db.collection('providerProfiles').doc(current.uid).get(); const release = next === 'ACCEPTED' && profile.data()?.showWhatsappAfterAcceptance === true;
    await snap.ref.set({ status: next, contactReleased: release, updatedAt: timestamp() }, { merge: true }); await notify(snap.data().buyerUid, `REQUEST_${next}`, next === 'ACCEPTED' ? 'Demande acceptée' : 'Demande refusée', snap.data().objective, snap.id); res.json({ ok: true });
  });

  const fixedRequestToProforma = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req);
    const request = await db.collection('serviceRequests').doc(cleanText(req.body?.requestId, 120)).get();
    if (!request.exists || request.data().buyerUid !== current.uid) throw new ApiError(404, 'not-found', 'Demande introuvable.');
    if (request.data().proformaId) throw new ApiError(409, 'proforma-exists', 'Une proforma existe déjà pour cette demande.');
    const service = await db.collection('billingServices').doc(request.data().serviceId).get();
    if (!service.exists || !['FIXED', 'STARTING_AT'].includes(service.data().pricingType) || !Number.isSafeInteger(service.data().priceMinor) || service.data().priceMinor <= 0) throw new ApiError(409, 'fixed-price-required', 'Ce service nécessite une proposition personnalisée.');
    const provider = await db.collection('providerProfiles').doc(service.data().ownerUid).get(); const priceMinor = service.data().priceMinor;
    const commission = calculateCommission(priceMinor, await commissionRule(service.data())); const proposalRef = db.collection('serviceProposals').doc();
    const proformaRef = db.collection('billingProformas').doc(); const publicToken = token(); const today = new Date(); const expiry = new Date(Date.now() + 7 * 86400000).toISOString().slice(0,10);
    await db.runTransaction(async (tx) => {
      const number = await nextNumber(tx, service.data().ownerUid, 'proforma', 'PF');
      tx.set(proposalRef, { requestId: request.id, serviceId: service.id, providerUid: service.data().ownerUid, buyerUid: current.uid, summary: request.data().objective,
        deliverables: service.data().deliverables || [], deliveryDays: service.data().deliveryDays, revisionsIncluded: service.data().revisionsIncluded || 0,
        priceMinor, depositMinor: priceMinor, balanceMinor: 0, currency: 'HTG', terms: service.data().terms || '', expiresOn: expiry, commissionSnapshot: commission,
        status: 'PROFORMA_CREATED', proformaId: proformaRef.id, publicToken, fixedPackage: true, createdAt: timestamp(), updatedAt: timestamp() });
      tx.set(proformaRef, { ownerUid: service.data().ownerUid, buyerUid: current.uid, number,
        clientSnapshot: { uid: current.uid, name: cleanText(current.name || current.email || 'Client SmartCut', 140), email: normalizeEmail(current.email) },
        items: [{ serviceId: service.id, name: service.data().name, description: service.data().shortDescription || '', quantity: 1, unit: 'service', unitPriceMinor: priceMinor, lineTotalMinor: priceMinor }],
        subtotalMinor: priceMinor, discountMinor: 0, taxMinor: 0, feeMinor: 0, totalMinor: priceMinor, currency: 'HTG', issueDate: today.toISOString().slice(0,10), expiryDate: expiry,
        notes: `Demande ${request.id}`, terms: service.data().terms || '', status: 'SENT', publicToken,
        marketplace: { proposalId: proposalRef.id, requestId: request.id, serviceId: service.id, providerUid: service.data().ownerUid, buyerUid: current.uid,
          grossMinor: priceMinor, installmentMinor: priceMinor, balanceMinor: 0, commissionSnapshot: commission,
          providerSnapshot: { businessName: provider.data()?.businessName || '' }, serviceSnapshot: serviceSnapshot(service.data(), service.id) }, createdAt: timestamp(), updatedAt: timestamp() });
      tx.set(request.ref, { status: 'QUOTED', proposalId: proposalRef.id, proformaId: proformaRef.id, updatedAt: timestamp() }, { merge: true });
    });
    await notify(service.data().ownerUid, 'FIXED_ORDER_READY', 'Forfait accepté', service.data().name, request.id);
    res.json({ ok: true, id: proformaRef.id, publicUrl: `${PUBLIC_SITE}/facture.html?t=${encodeURIComponent(publicToken)}` });
  });

  const createProposal = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req);
    const request = await db.collection('serviceRequests').doc(cleanText(req.body?.requestId, 120)).get(); if (!request.exists || request.data().providerUid !== current.uid) throw new ApiError(404, 'not-found', 'Demande introuvable.');
    if (!['ACCEPTED', 'QUOTED'].includes(request.data().status)) throw new ApiError(409, 'invalid-status', 'Acceptez la demande avant de proposer.');
    const service = await db.collection('billingServices').doc(request.data().serviceId).get(); const priceMinor = asMinor(req.body?.priceMinor); const depositMinor = req.body?.depositMinor ? asMinor(req.body.depositMinor) : priceMinor;
    if (depositMinor !== priceMinor) throw new ApiError(400, 'installments-unavailable', 'Les acomptes ne sont pas encore activés. Utilisez le paiement intégral.'); const commission = calculateCommission(priceMinor, await commissionRule(service.data()));
    const ref = db.collection('serviceProposals').doc(); const proposal = { requestId: request.id, serviceId: service.id, providerUid: current.uid, buyerUid: request.data().buyerUid,
      summary: cleanText(req.body?.summary || request.data().objective, 1000), deliverables: toList(req.body?.deliverables, 20, 300), deliveryDays: Number(req.body?.deliveryDays || service.data().deliveryDays),
      revisionsIncluded: Number(req.body?.revisionsIncluded ?? service.data().revisionsIncluded ?? 0), priceMinor, depositMinor, balanceMinor: priceMinor - depositMinor, currency: 'HTG',
      terms: cleanText(req.body?.terms, 3000), expiresOn: cleanText(req.body?.expiresOn, 10), commissionSnapshot: commission, status: 'SENT', createdAt: timestamp(), updatedAt: timestamp() };
    await ref.set(proposal); await request.ref.set({ status: 'QUOTED', proposalId: ref.id, updatedAt: timestamp() }, { merge: true }); await notify(proposal.buyerUid, 'PROPOSAL_RECEIVED', 'Nouvelle proposition', proposal.summary, ref.id); res.json({ ok: true, id: ref.id, proposal });
  });

  const proposalToProforma = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req);
    const proposal = await db.collection('serviceProposals').doc(cleanText(req.body?.proposalId, 120)).get(); if (!proposal.exists || proposal.data().providerUid !== current.uid) throw new ApiError(404, 'not-found', 'Proposition introuvable.');
    const p = proposal.data(); const request = await db.collection('serviceRequests').doc(p.requestId).get(); const profile = await db.collection('providerProfiles').doc(current.uid).get();
    const ref = db.collection('billingProformas').doc(); const publicToken = token();
    await db.runTransaction(async (tx) => { const number = await nextNumber(tx, current.uid, 'proforma', 'PF'); tx.set(ref, { ownerUid: current.uid, buyerUid: p.buyerUid,
      number, clientSnapshot: { uid: p.buyerUid, name: cleanText(req.body?.clientName || 'Client SmartCut', 140), email: normalizeEmail(req.body?.clientEmail) },
      items: [{ serviceId: p.serviceId, name: request.data()?.serviceSnapshot?.name || p.summary, description: p.summary, quantity: 1, unit: 'service', unitPriceMinor: p.depositMinor, lineTotalMinor: p.depositMinor }],
      subtotalMinor: p.depositMinor, discountMinor: 0, taxMinor: 0, feeMinor: 0, totalMinor: p.depositMinor, currency: 'HTG', issueDate: new Date().toISOString().slice(0,10),
      expiryDate: p.expiresOn, notes: `Demande ${p.requestId}`, terms: p.terms, status: 'SENT', publicToken, marketplace: { proposalId: proposal.id, requestId: p.requestId, serviceId: p.serviceId,
        providerUid: current.uid, buyerUid: p.buyerUid, grossMinor: p.priceMinor, installmentMinor: p.depositMinor, balanceMinor: p.balanceMinor, commissionSnapshot: p.commissionSnapshot,
        providerSnapshot: { businessName: profile.data()?.businessName || '' }, serviceSnapshot: request.data()?.serviceSnapshot || {} }, createdAt: timestamp(), updatedAt: timestamp() }); });
    await proposal.ref.set({ status: 'PROFORMA_CREATED', proformaId: ref.id, publicToken, updatedAt: timestamp() }, { merge: true }); res.json({ ok: true, id: ref.id, publicUrl: `${PUBLIC_SITE}/facture.html?t=${encodeURIComponent(publicToken)}` });
  });

  const sendMessage = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req); await throttle(current.uid, 'message', 20);
    const contextType = req.body?.orderId ? 'ORDER' : 'REQUEST'; const contextId = cleanText(req.body?.orderId || req.body?.requestId, 120);
    const context = await participant(contextType === 'ORDER' ? 'serviceOrders' : 'serviceRequests', contextId, current.uid); const message = cleanText(req.body?.message, 2000);
    if (!message && !safeFiles(req.body?.files).length) throw new ApiError(400, 'message-required', 'Message requis.');
    const ref = db.collection('serviceOrderMessages').doc(); await ref.set({ contextType, contextId, orderId: contextType === 'ORDER' ? contextId : null, requestId: contextType === 'REQUEST' ? contextId : null,
      authorUid: current.uid, participantUids: [context.data().buyerUid, context.data().providerUid], message, files: safeFiles(req.body?.files), createdAt: timestamp() }); res.json({ ok: true, id: ref.id });
  });

  const attachFiles = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req);
    const type = req.body?.orderId ? 'orders' : 'requests'; const id = cleanText(req.body?.orderId || req.body?.requestId, 120);
    const collection = type === 'orders' ? 'serviceOrders' : 'serviceRequests'; const context = await participant(collection, id, current.uid);
    const files = safeFiles(req.body?.files); const prefix = `marketplace-private/${type}/${id}/${current.uid}/`;
    if (!files.length || files.some((x) => !x.path.startsWith(prefix))) throw new ApiError(400, 'invalid-files', 'Pièces jointes invalides.');
    const existing = Array.isArray(context.data().files) ? context.data().files : [];
    await context.ref.set({ files: [...existing, ...files].slice(0, 8), updatedAt: timestamp() }, { merge: true }); res.json({ ok: true, files });
  });

  const deliver = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req); const order = await owned('serviceOrders', cleanText(req.body?.orderId, 120), current.uid);
    if (!['ACCEPTED','IN_PROGRESS','REVISION_REQUESTED'].includes(order.data().status)) throw new ApiError(409, 'invalid-status', 'Commande non livrable.');
    const files = safeFiles(req.body?.files); const links = toList(req.body?.links, 10, 700); if (!files.length && !links.length) throw new ApiError(400, 'delivery-required', 'Ajoutez un fichier ou un lien.');
    const ref = db.collection('serviceDeliveries').doc(); const version = Number(order.data().deliveryVersion || 0) + 1;
    await ref.set({ orderId: order.id, providerUid: current.uid, buyerUid: order.data().buyerUid, message: cleanText(req.body?.message, 2000), files, links, version, status: 'DELIVERED', createdAt: timestamp() });
    await order.ref.set({ status: 'DELIVERED', deliveryVersion: version, latestDeliveryId: ref.id, deliveredAt: timestamp(), updatedAt: timestamp() }, { merge: true }); await notify(order.data().buyerUid, 'ORDER_DELIVERED', 'Livraison disponible', `Version ${version}`, order.id); res.json({ ok: true, id: ref.id });
  });

  const requestRevision = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req); const order = await participant('serviceOrders', cleanText(req.body?.orderId, 120), current.uid);
    if (order.data().buyerUid !== current.uid || order.data().status !== 'DELIVERED') throw new ApiError(409, 'invalid-status', 'Révision indisponible.');
    const used = Number(order.data().revisionsUsed || 0), included = Number(order.data().revisionsIncluded || 0); if (used >= included) throw new ApiError(409, 'revision-payment-required', 'Les révisions incluses sont épuisées. Une proposition supplémentaire est requise.');
    const reason = cleanText(req.body?.reason, 200), comment = cleanText(req.body?.comment, 2000); if (!reason || !comment) throw new ApiError(400, 'details-required', 'Motif et commentaire requis.');
    const ref = db.collection('serviceRevisionRequests').doc(); await ref.set({ orderId: order.id, buyerUid: current.uid, providerUid: order.data().providerUid, reason, comment, files: safeFiles(req.body?.files), revisionNumber: used + 1, createdAt: timestamp() });
    await order.ref.set({ status: 'REVISION_REQUESTED', revisionsUsed: used + 1, updatedAt: timestamp() }, { merge: true }); res.json({ ok: true, id: ref.id });
  });

  const transitionOrder = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req); const order = await participant('serviceOrders', cleanText(req.body?.orderId, 120), current.uid); const next = cleanText(req.body?.status, 30).toUpperCase();
    const actor = order.data().providerUid === current.uid ? 'provider' : order.data().buyerUid === current.uid ? 'buyer' : 'none'; if (!canTransitionOrder(order.data().status, next, actor)) throw new ApiError(409, 'invalid-transition', 'Transition de commande refusée.');
    await order.ref.set({ status: next, updatedAt: timestamp(), ...(next === 'COMPLETED' ? { completedAt: timestamp() } : {}) }, { merge: true }); res.json({ ok: true });
  });

  const createReview = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req); const order = await participant('serviceOrders', cleanText(req.body?.orderId, 120), current.uid);
    if (order.data().buyerUid !== current.uid || order.data().status !== 'COMPLETED' || order.data().paymentStatus !== 'PAID') throw new ApiError(403, 'review-forbidden', 'Avis réservé à une commande payée et terminée.');
    const ref = db.collection('serviceReviews').doc(order.id); if ((await ref.get()).exists) throw new ApiError(409, 'review-exists', 'Un avis existe déjà.');
    const rating = Number(req.body?.rating); if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new ApiError(400, 'invalid-rating', 'Note invalide.');
    await ref.set({ orderId: order.id, serviceId: order.data().serviceId, providerUid: order.data().providerUid, buyerUid: current.uid, rating, comment: cleanText(req.body?.comment, 800), status: 'PUBLISHED', verifiedOrder: true, createdAt: timestamp() }); res.json({ ok: true, id: ref.id });
  });

  const openDispute = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.'); const current = await user(req); const order = await participant('serviceOrders', cleanText(req.body?.orderId, 120), current.uid);
    if (['COMPLETED','CANCELLED','REFUNDED'].includes(order.data().status)) throw new ApiError(409, 'invalid-status', 'Litige indisponible.'); const explanation = cleanText(req.body?.explanation, 3000); if (explanation.length < 20) throw new ApiError(400, 'details-required', 'Expliquez le litige.');
    const ref = db.collection('serviceDisputes').doc(); await ref.set({ orderId: order.id, openedByUid: current.uid, buyerUid: order.data().buyerUid, providerUid: order.data().providerUid,
      reason: cleanText(req.body?.reason, 200), explanation, files: safeFiles(req.body?.files), amountMinor: order.data().grossMinor, status: 'OPEN', createdAt: timestamp(), updatedAt: timestamp() });
    await order.ref.set({ status: 'DISPUTED', disputeId: ref.id, updatedAt: timestamp() }, { merge: true }); res.json({ ok: true, id: ref.id });
  });

  const resolveDispute = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
    const staff = await requireStaff(req, ['platform_admin', 'finance_admin', 'support_agent']); const id = cleanText(req.body?.id, 120), action = cleanText(req.body?.action, 30).toUpperCase();
    const disputeRef = db.collection('serviceDisputes').doc(id); const disputeSnap = await disputeRef.get(); if (!disputeSnap.exists || !['OPEN','UNDER_REVIEW'].includes(disputeSnap.data().status)) throw new ApiError(409, 'invalid-status', 'Litige déjà traité ou introuvable.');
    const orderRef = db.collection('serviceOrders').doc(disputeSnap.data().orderId); const orderSnap = await orderRef.get(); if (!orderSnap.exists) throw new ApiError(404, 'order-not-found', 'Commande introuvable.');
    if (action === 'RESOLVE_PROVIDER') { await db.runTransaction(async (tx) => { tx.set(disputeRef, { status:'RESOLVED_PROVIDER', resolution:cleanText(req.body?.resolution,2000), resolvedByUid:staff.uid, resolvedAt:timestamp(), updatedAt:timestamp() }, { merge:true }); tx.set(orderRef, { status:'COMPLETED', completedAt:timestamp(), updatedAt:timestamp() }, { merge:true }); tx.set(db.collection('billingAuditLogs').doc(), { actorUid:staff.uid, ownerUid:orderSnap.data().providerUid, action:'DISPUTE_RESOLVED_PROVIDER', targetId:id, createdAt:timestamp() }); }); return res.json({ ok:true }); }
    if (!['FULL_REFUND','PARTIAL_REFUND'].includes(action)) throw new ApiError(400, 'invalid-action', 'Action invalide.');
    if (!(await isStaff(staff.uid, ['platform_admin','finance_admin']))) throw new ApiError(403, 'finance-admin-required', 'Un rôle financier est requis pour valider un remboursement.');
    const refundReference = cleanText(req.body?.refundReference, 180); if (!refundReference) throw new ApiError(400, 'refund-reference-required', 'La référence du remboursement réel est requise.');
    const grossMinor = Number(orderSnap.data().grossMinor || 0); const refundMinor = action === 'FULL_REFUND' ? grossMinor : asMinor(req.body?.amountMinor);
    if (refundMinor <= 0 || refundMinor > grossMinor) throw new ApiError(400, 'invalid-refund', 'Montant de remboursement invalide.');
    const providerNetMinor = Number(orderSnap.data().netMinor || grossMinor); const providerDebitMinor = calculateRefundDebit(grossMinor, providerNetMinor, refundMinor);
    const balanceRef = db.collection('billingBalances').doc(orderSnap.data().providerUid); const ledgerRef = db.collection('billingLedgerEntries').doc(`${orderSnap.id}_REFUND_${crypto.createHash('sha256').update(refundReference).digest('hex').slice(0,20)}`);
    await db.runTransaction(async (tx) => {
      const [freshDispute,balance,ledger] = await Promise.all([tx.get(disputeRef),tx.get(balanceRef),tx.get(ledgerRef)]); if (ledger.exists) return;
      if (!['OPEN','UNDER_REVIEW'].includes(freshDispute.data().status)) throw new ApiError(409,'invalid-status','Litige déjà traité.'); const available = Number(balance.data()?.availableMinor || 0);
      if (available < providerDebitMinor) throw new ApiError(409,'insufficient-provider-balance','Solde prestataire insuffisant; traitement financier manuel requis.');
      tx.set(ledgerRef, { ownerUid:orderSnap.data().providerUid,type:'REFUND_ISSUED',amountMinor:providerDebitMinor,grossRefundMinor:refundMinor,currency:'HTG',direction:'DEBIT',source:'MANUAL_REFUND',referenceId:orderSnap.id,refundReference,createdAt:timestamp() });
      tx.set(balanceRef, { availableMinor:available-providerDebitMinor,updatedAt:timestamp() }, { merge:true });
      tx.set(disputeRef, { status:action,amountMinor:refundMinor,resolution:cleanText(req.body?.resolution,2000),refundReference,resolvedByUid:staff.uid,resolvedAt:timestamp(),updatedAt:timestamp() }, { merge:true });
      tx.set(orderRef, { status:action==='FULL_REFUND'?'REFUNDED':'COMPLETED',refundMinor,refundReference,updatedAt:timestamp(),...(action==='FULL_REFUND'?{refundedAt:timestamp()}:{completedAt:timestamp()}) }, { merge:true });
      tx.set(db.collection('billingAuditLogs').doc(), { actorUid:staff.uid,ownerUid:orderSnap.data().providerUid,action,targetId:id,refundMinor,refundReference,createdAt:timestamp() });
    }); res.json({ ok:true,refundMinor,providerDebitMinor });
  });

  function publicProfile(data, id) { return { id, businessName: data.businessName || '', professionalTitle: data.professionalTitle || '', shortBio: data.shortBio || '', biography: data.biography || '', specialties: data.specialties || [], address: data.address || data.commune || '', logoUrl: data.logoUrl || '', availability: data.availability || '', responseTimeLabel: data.responseTimeLabel || '' }; }
  function serviceSnapshot(data, id) { return { id, name: data.name, slug: data.slug, pricingType: data.pricingType, priceMinor: data.priceMinor || 0, currency: 'HTG', deliveryDays: data.deliveryDays, revisionsIncluded: data.revisionsIncluded, coverImage: data.coverImage || '' }; }
  function safeFiles(files) { return (Array.isArray(files) ? files : []).filter((x) => x && typeof x === 'object').slice(0, 8).map((x) => ({ path: cleanText(x.path, 700), name: cleanText(x.name, 180), contentType: cleanText(x.contentType, 100), size: Number(x.size || 0) })).filter((x) => x.path && x.name && x.size > 0 && x.size <= 20 * 1024 * 1024 && /^(image\/(jpeg|png|webp)|application\/pdf|application\/zip)$/.test(x.contentType)); }
  function toList(value, maxItems, maxLength) { const values = Array.isArray(value) ? value : String(value || '').split(/[\n,]/); return [...new Set(values.map((x) => cleanText(x, maxLength)).filter(Boolean))].slice(0, maxItems); }
  async function notify(uid, type, title, message, referenceId) { await db.collection('marketplaceNotifications').add({ recipientUid: uid, type, title, message: cleanText(message, 500), referenceId, read: false, createdAt: timestamp() }); }

  return { bootstrap, clientBootstrap, saveProfile, saveService, serviceAction, moderationQueue, moderateProfile, moderateService, publicServices, publicService, publicProvider, createRequest,
    requestAction, fixedRequestToProforma, createProposal, proposalToProforma, sendMessage, attachFiles, deliver, requestRevision, transitionOrder, createReview, openDispute, resolveDispute };
}

module.exports = buildMarketplace;
