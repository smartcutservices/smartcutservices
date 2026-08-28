'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const {
  cleanText,
  normalizeVehicle,
  normalizePart,
  normalizeOffer,
  fitmentMatchesVehicle,
  buildSearchTokens,
  selectRelevantAutoVendors
} = require('./core');

function buildAutoParts(internals) {
  const { admin, db, REGION, verifyBearerUser, isAdminUser, getVendorProfile } = internals;
  const timestamp = () => admin.firestore.FieldValue.serverTimestamp();

  function cors(res) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }

  function reply(res, status, payload) {
    cors(res);
    return res.status(status).json(payload);
  }

  function bodyOf(req) {
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
    try { return JSON.parse(Buffer.from(req.rawBody || '').toString('utf8') || '{}'); } catch (_) { return {}; }
  }

  async function requireUser(req) {
    const user = await verifyBearerUser(req);
    if (!user?.uid) throw Object.assign(new Error('authentication-required'), { status: 401 });
    return user;
  }

  async function requireVendor(req) {
    const user = await requireUser(req);
    const profile = await getVendorProfile(user.uid) || {};
    return { user, profile };
  }

  async function getCatalog(req, res) {
    const limit = Math.min(48, Math.max(1, Number.parseInt(req.query.limit, 10) || 24));
    const categoryId = cleanText(req.query.categoryId, 100);
    const queryText = cleanText(req.query.q, 100).toLowerCase();
    const vehicle = normalizeVehicle({
      type: req.query.type,
      make: req.query.make,
      model: req.query.model,
      year: req.query.year,
      engine: req.query.engine,
      trim: req.query.trim
    });
    let query = db.collection('autoParts').where('publicationStatus', '==', 'published').limit(120);
    if (categoryId) query = query.where('categoryId', '==', categoryId);
    const snapshot = await query.get();
    let parts = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    if (queryText) {
      parts = parts.filter((part) => [part.title, part.partNumber, part.brand, ...(part.oemNumbers || []), ...(part.searchTokens || [])]
        .some((value) => String(value || '').toLowerCase().includes(queryText)));
    }
    const hasVehicle = Boolean(vehicle.make && vehicle.model && vehicle.year);
    if (hasVehicle) parts = parts.filter((part) => (part.fitments || []).some((fitment) => fitmentMatchesVehicle(fitment, vehicle)));
    parts = parts.slice(0, limit);

    const offerSnaps = parts.length
      ? await Promise.all(parts.map((part) => db.collection('vendorProducts')
          .where('canonicalPartId', '==', part.id).where('vertical', '==', 'auto_parts').where('status', '==', 'active').limit(20).get()))
      : [];
    const result = parts.map((part, index) => {
      const matchingFitments = hasVehicle ? (part.fitments || []).filter((fitment) => fitmentMatchesVehicle(fitment, vehicle)) : [];
      const requiresEngine = hasVehicle && !vehicle.engine && matchingFitments.some((fitment) => Array.isArray(fitment.engines) && fitment.engines.length);
      return {
      ...part,
      compatibilityStatus: !hasVehicle ? 'unknown' : (requiresEngine ? 'verify' : 'compatible'),
      offers: offerSnaps[index].docs.map((doc) => {
        const data = doc.data() || {};
        return {
          id: doc.id,
          vendorId: data.vendorId,
          vendorName: data.vendorName || '',
          price: Number(data.price || 0),
          stock: Math.max(0, Number(data.stock || 0)),
          condition: data.condition || 'new',
          warranty: data.warranty || '',
          deliveryMode: data.deliveryMode || '',
          deliveryDelay: data.deliveryDelay || '',
          images: Array.isArray(data.images) ? data.images.slice(0, 8) : [],
          commissionRule: data.commissionRule || null
        };
      }).filter((offer) => offer.stock > 0).sort((a, b) => a.price - b.price)
    };}).filter((part) => part.offers.length);
    return reply(res, 200, { ok: true, vehicle: hasVehicle ? vehicle : null, parts: result });
  }

  async function getTaxonomy(res) {
    const [categories, vehicles] = await Promise.all([
      db.collection('autoPartCategories').where('isActive', '==', true).orderBy('order', 'asc').limit(100).get(),
      db.collection('autoVehicleCatalog').where('isActive', '==', true).limit(1000).get()
    ]);
    return reply(res, 200, {
      ok: true,
      categories: categories.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      vehicles: vehicles.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
    });
  }

  async function garage(req, res, action) {
    const user = await requireUser(req);
    const body = bodyOf(req);
    const vehicles = db.collection('clients').doc(user.uid).collection('garageVehicles');
    if (action === 'listGarage') {
      const snapshot = await vehicles.orderBy('updatedAt', 'desc').limit(20).get();
      return reply(res, 200, { ok: true, vehicles: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
    }
    if (action === 'saveGarageVehicle') {
      const vehicle = normalizeVehicle(body.vehicle);
      if (!vehicle.make || !vehicle.model || !vehicle.year) return reply(res, 400, { ok: false, error: 'invalid-vehicle' });
      const id = cleanText(body.id, 160);
      const ref = id ? vehicles.doc(id) : vehicles.doc();
      if (id) {
        const current = await ref.get();
        if (!current.exists) return reply(res, 404, { ok: false, error: 'vehicle-not-found' });
      }
      const vehiclePatch = { ...vehicle, nickname: cleanText(body.nickname, 80), ownerUid: user.uid, updatedAt: timestamp() };
      if (!id) vehiclePatch.createdAt = timestamp();
      await ref.set(vehiclePatch, { merge: true });
      return reply(res, 200, { ok: true, id: ref.id });
    }
    if (action === 'deleteGarageVehicle') {
      const id = cleanText(body.id, 160);
      if (!id) return reply(res, 400, { ok: false, error: 'vehicle-id-required' });
      const ref = vehicles.doc(id);
      const current = await ref.get();
      if (!current.exists) return reply(res, 404, { ok: false, error: 'vehicle-not-found' });
      await ref.delete();
      return reply(res, 200, { ok: true });
    }
    return reply(res, 400, { ok: false, error: 'unsupported-action' });
  }

  async function saveOffer(req, res) {
    const { user, profile } = await requireVendor(req);
    const body = bodyOf(req);
    let canonicalPartId = cleanText(body.canonicalPartId, 160);
    let partSnap = canonicalPartId ? await db.collection('autoParts').doc(canonicalPartId).get() : null;
    if (!partSnap?.exists) {
      const categoryName = cleanText(body.categoryName, 120);
      const categoryId = cleanText(body.categoryId, 100) || categoryName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'pieces-auto';
      const partData = normalizePart({
        title: body.title,
        partNumber: body.partNumber,
        oemNumbers: Array.isArray(body.oemNumbers) ? body.oemNumbers : String(body.oemNumbers || '').split(','),
        brand: body.brand,
        categoryId,
        categoryName,
        description: body.description,
        fitments: [body.vehicle || {}],
        publicationStatus: 'published'
      });
      const existing = await db.collection('autoParts').where('partNumber', '==', partData.partNumber).limit(1).get();
      if (!existing.empty) {
        partSnap = existing.docs[0];
        canonicalPartId = partSnap.id;
      } else {
        const partRef = db.collection('autoParts').doc();
        await partRef.set({ ...partData, searchTokens: buildSearchTokens(partData), createdByUid: user.uid, createdAt: timestamp(), updatedAt: timestamp() });
        partSnap = await partRef.get();
        canonicalPartId = partRef.id;
      }
    }
    if (!partSnap?.exists || partSnap.data()?.publicationStatus !== 'published') return reply(res, 404, { ok: false, error: 'canonical-part-not-found' });
    const input = normalizeOffer({ ...body, canonicalPartId });
    const offerId = cleanText(body.offerId, 160);
    const ref = offerId ? db.collection('vendorProducts').doc(offerId) : db.collection('vendorProducts').doc();
    if (offerId) {
      const current = await ref.get();
      if (!current.exists || current.data()?.vendorId !== user.uid || current.data()?.vertical !== 'auto_parts') {
        return reply(res, 404, { ok: false, error: 'offer-not-found' });
      }
    }
    const part = partSnap.data() || {};
    const commissionRulesSnap = await db.collection('vendorCommissionRules').where('active', '==', true).limit(100).get();
    const normalizeCategory = (value) => cleanText(value, 120).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const categoryKey = normalizeCategory(part.categoryName || 'Auto & Parts');
    const configuredRule = commissionRulesSnap.docs.map((doc) => doc.data() || {}).find((rule) => normalizeCategory(rule.category) === categoryKey || normalizeCategory(rule.category) === 'auto-parts');
    const profileCommission = profile?.commissionRule;
    const commissionRule = configuredRule ? {
      category: configuredRule.category || part.categoryName || 'Auto & Parts',
      categoryRate: Number(configuredRule.rate),
      source: 'vendorCommissionRules'
    } : profileCommission && Number.isFinite(Number(profileCommission.categoryRate ?? profileCommission.rate))
      ? profileCommission
      : { category: part.categoryName || 'Auto & Parts', categoryRate: 0, source: 'temporary-direct-access' };
    const offerPatch = {
      ...input,
      vendorId: user.uid,
      vendorName: cleanText(profile?.businessName || profile?.shopName || profile?.name || user.email?.split('@')[0] || 'Vendeur Auto', 160),
      vertical: 'auto_parts',
      name: part.title,
      category: part.categoryName || 'Pièces auto',
      categoryId: part.categoryId,
      partNumber: part.partNumber,
      brand: part.brand || '',
      description: part.description || '',
      oemNumbers: part.oemNumbers || [],
      fitments: part.fitments || [],
      commissionRule,
      updatedAt: timestamp(),
    };
    if (!offerId) offerPatch.createdAt = timestamp();
    await ref.set(offerPatch, { merge: true });
    await db.collection('autoPartsAuditLogs').add({ actorUid: user.uid, action: offerId ? 'offer.updated' : 'offer.created', offerId: ref.id, at: timestamp() });
    return reply(res, 200, { ok: true, id: ref.id, status: input.status });
  }

  async function getVendorWorkspace(req, res) {
    const user = await requireUser(req);
    const profile = await getVendorProfile(user.uid);
    const [applicationSnap, partsSnap, offersSnap, garageApplicationSnap, garageSnap, garageServicesSnap, availabilitySnap, bookingsSnap, claimsSnap, catalogRequestsSnap] = await Promise.all([
      db.collection('autoVendorApplications').doc(user.uid).get(),
      db.collection('autoParts').where('publicationStatus', '==', 'published').limit(250).get(),
      db.collection('vendorProducts').where('vendorId', '==', user.uid).where('vertical', '==', 'auto_parts').limit(250).get()
      ,db.collection('autoGarageApplications').doc(user.uid).get()
      ,db.collection('autoGarages').doc(user.uid).get()
      ,db.collection('autoGarageServices').where('garageId', '==', user.uid).limit(100).get()
      ,db.collection('autoGarageAvailability').doc(user.uid).get()
      ,db.collection('autoGarageBookings').where('garageId', '==', user.uid).limit(100).get()
      ,db.collection('autoClaims').where('vendorId', '==', user.uid).limit(100).get()
      ,db.collection('autoPartCatalogRequests').where('vendorId', '==', user.uid).limit(100).get()
    ]);
    return reply(res, 200, {
      ok: true,
      sellerEligible: true,
      verificationStatus: 'direct_access',
      application: applicationSnap.exists ? { id: applicationSnap.id, ...applicationSnap.data() } : null,
      parts: partsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      offers: offersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      garage: {
        verificationStatus: cleanText(garageSnap.data()?.verificationStatus || garageApplicationSnap.data()?.status || 'not_started', 40),
        application: garageApplicationSnap.exists ? { id: garageApplicationSnap.id, ...garageApplicationSnap.data() } : null,
        profile: garageSnap.exists ? { id: garageSnap.id, ...garageSnap.data() } : null,
        services: garageServicesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
        availability: availabilitySnap.exists ? availabilitySnap.data() : { slots: [] },
        bookings: bookingsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      },
      claims: claimsSnap.docs.map((doc) => ({ id:doc.id, ...doc.data() })),
      catalogRequests: catalogRequestsSnap.docs.map((doc) => ({ id:doc.id, ...doc.data() }))
    });
  }

  async function applyAsAutoVendor(req, res) {
    const user = await requireUser(req);
    const profile = await getVendorProfile(user.uid);
    const role = cleanText(profile?.role, 30).toLowerCase();
    const status = cleanText(profile?.status || profile?.vendorStatus, 40).toLowerCase();
    if (role !== 'vendor' || !['active', 'approved'].includes(status)) return reply(res, 403, { ok: false, error: 'approved-vendor-required' });
    const body = bodyOf(req);
    const specialties = Array.isArray(body.specialties) ? body.specialties.map((value) => cleanText(value, 80)).filter(Boolean).slice(0, 20) : [];
    if (!specialties.length) return reply(res, 400, { ok: false, error: 'specialty-required' });
    const ref = db.collection('autoVendorApplications').doc(user.uid);
    const current = await ref.get();
    if (current.exists && current.data()?.status === 'approved') return reply(res, 409, { ok: false, error: 'already-approved' });
    await ref.set({
      vendorId: user.uid,
      vendorName: cleanText(profile?.businessName || profile?.shopName || profile?.vendorName, 160),
      specialties,
      experience: cleanText(body.experience, 500),
      serviceArea: cleanText(body.serviceArea, 180),
      status: 'pending',
      submittedAt: timestamp(),
      updatedAt: timestamp()
    }, { merge: true });
    await db.collection('autoPartsAuditLogs').add({ actorUid: user.uid, action: 'vendor.application_submitted', targetUid: user.uid, at: timestamp() });
    return reply(res, 200, { ok: true, status: 'pending' });
  }

  async function reviewAutoVendor(req, res) {
    const adminUser = await requireUser(req);
    if (!(await isAdminUser(adminUser.uid))) return reply(res, 403, { ok: false, error: 'admin-required' });
    const body = bodyOf(req);
    const vendorId = cleanText(body.vendorId, 160);
    const decision = cleanText(body.decision, 30).toLowerCase();
    if (!vendorId || !['approved', 'rejected', 'suspended'].includes(decision)) return reply(res, 400, { ok: false, error: 'invalid-review' });
    const applicationRef = db.collection('autoVendorApplications').doc(vendorId);
    const applicationSnap = await applicationRef.get();
    if (!applicationSnap.exists) return reply(res, 404, { ok: false, error: 'application-not-found' });
    const batch = db.batch();
    batch.set(applicationRef, { status: decision, reviewNote: cleanText(body.reviewNote, 500), reviewedAt: timestamp(), reviewedBy: adminUser.uid, updatedAt: timestamp() }, { merge: true });
    batch.set(db.collection('vendors').doc(vendorId), { autoPartsVerificationStatus: decision, autoPartsVerifiedAt: decision === 'approved' ? timestamp() : null, updatedAt: timestamp() }, { merge: true });
    batch.set(db.collection('clients').doc(vendorId), { autoPartsVerificationStatus: decision, updatedAt: timestamp() }, { merge: true });
    batch.set(db.collection('autoPartsAuditLogs').doc(), { actorUid: adminUser.uid, action: `vendor.${decision}`, targetUid: vendorId, at: timestamp() });
    await batch.commit();
    return reply(res, 200, { ok: true, status: decision });
  }

  async function deleteOffer(req, res) {
    const { user } = await requireVendor(req);
    const offerId = cleanText(bodyOf(req).offerId, 160);
    const ref = db.collection('vendorProducts').doc(offerId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.vendorId !== user.uid || snap.data()?.vertical !== 'auto_parts') return reply(res, 404, { ok: false, error: 'offer-not-found' });
    await ref.delete();
    await db.collection('autoPartsAuditLogs').add({ actorUid: user.uid, action: 'offer.deleted', offerId, at: timestamp() });
    return reply(res, 200, { ok: true });
  }

  async function submitCatalogPartRequest(req, res) {
    const { user } = await requireVendor(req);
    const body = bodyOf(req);
    const title = cleanText(body.title, 180);
    const partNumber = cleanText(body.partNumber, 100).toUpperCase();
    const brand = cleanText(body.brand, 100);
    const categoryName = cleanText(body.categoryName, 120);
    const vehicle = normalizeVehicle(body.vehicle || {});
    if (!title || !partNumber || !brand || !categoryName || !vehicle.make || !vehicle.model || !vehicle.year) {
      return reply(res, 400, { ok:false, error:'invalid-catalog-part-request' });
    }
    const duplicate = await db.collection('autoPartCatalogRequests').where('vendorId','==',user.uid).where('partNumber','==',partNumber).where('status','==','pending').limit(1).get();
    if (!duplicate.empty) return reply(res, 409, { ok:false, error:'catalog-request-already-pending' });
    const ref = db.collection('autoPartCatalogRequests').doc();
    const now = timestamp();
    await ref.set({
      vendorId:user.uid, title, partNumber, brand, categoryName,
      oemNumbers:Array.isArray(body.oemNumbers)?body.oemNumbers.map((value)=>cleanText(value,100).toUpperCase()).filter(Boolean).slice(0,20):[],
      vehicle, notes:cleanText(body.notes,800), status:'pending', createdAt:now, updatedAt:now
    });
    await db.collection('autoPartsAuditLogs').add({actorUid:user.uid,action:'catalog_part.requested',requestId:ref.id,partNumber,at:now});
    return reply(res,200,{ok:true,id:ref.id,status:'pending'});
  }

  function validateRequestMedia(urls, uid) {
    const expected = [
      `/auto-parts%2Frequests%2F${encodeURIComponent(uid)}%2F`,
      `/auto-parts%2Fvendors%2F${encodeURIComponent(uid)}%2F`,
      `/auto-parts%2Fclaims%2F${encodeURIComponent(uid)}%2F`
    ];
    return (Array.isArray(urls) ? urls : []).map((value) => cleanText(value, 1600)).filter(Boolean)
      .filter((value) => value.includes('firebasestorage.googleapis.com') && expected.some((prefix) => value.includes(prefix))).slice(0, 6);
  }

  function validateClaimMedia(urls, uid, claimId) {
    const prefix = `auto-parts/claims/${uid}__${claimId}/`;
    return (Array.isArray(urls) ? urls : []).map((value) => cleanText(value, 1600)).filter(Boolean)
      .filter((value) => value.startsWith(prefix)).slice(0, 6);
  }

  async function createPartRequest(req, res) {
    const user = await requireUser(req);
    const body = bodyOf(req);
    const title = cleanText(body.title, 180);
    const description = cleanText(body.description, 1800);
    const vehicle = normalizeVehicle(body.vehicle || {});
    const categoryId = cleanText(body.categoryId, 100);
    if (!title || !description || !vehicle.make || !vehicle.model || !vehicle.year) return reply(res, 400, { ok: false, error: 'invalid-part-request' });
    const requestRef = db.collection('autoPartRequests').doc();
    const mediaUrls = validateRequestMedia(body.mediaUrls, user.uid);
    const applications = await db.collection('autoVendorApplications').where('status', '==', 'approved').limit(100).get();
    const normalizedCategory = cleanText(body.categoryName || categoryId, 100).toLowerCase();
    const relevant = selectRelevantAutoVendors(applications.docs.map((doc) => ({ id: doc.id, ...doc.data() })), normalizedCategory, 30);
    const now = timestamp();
    const requestData = {
      customerUid: user.uid, title, description, vehicle, categoryId,
      categoryName: cleanText(body.categoryName, 120),
      partNumber: cleanText(body.partNumber, 100).toUpperCase(),
      quantity: Math.min(100, Math.max(1, Number.parseInt(body.quantity, 10) || 1)),
      mediaUrls, status: 'open', routedVendorCount: relevant.length,
      createdAt: now, updatedAt: now
    };
    const batch = db.batch();
    batch.set(requestRef, requestData);
    relevant.forEach((application) => batch.set(db.collection('autoPartRequestRoutes').doc(`${requestRef.id}_${application.id}`), {
      requestId: requestRef.id, vendorId: application.id, customerUid: user.uid,
      categoryId, status: 'open', createdAt: now, updatedAt: now
    }));
    batch.set(db.collection('autoPartsAuditLogs').doc(), { actorUid: user.uid, action: 'request.created', requestId: requestRef.id, routedVendorCount: relevant.length, at: now });
    await batch.commit();
    return reply(res, 200, { ok: true, id: requestRef.id, routedVendorCount: relevant.length });
  }

  async function listMyPartRequests(req, res) {
    const user = await requireUser(req);
    const requests = await db.collection('autoPartRequests').where('customerUid', '==', user.uid).limit(100).get();
    const results = await Promise.all(requests.docs.map(async (doc) => {
      const quotes = await db.collection('autoPartQuotes').where('requestId', '==', doc.id).limit(50).get();
      return { id: doc.id, ...doc.data(), quotes: quotes.docs.map((quote) => ({ id: quote.id, ...quote.data() })) };
    }));
    return reply(res, 200, { ok: true, requests: results });
  }

  async function listVendorPartRequests(req, res) {
    const { user } = await requireVendor(req);
    const routes = await db.collection('autoPartRequestRoutes').where('vendorId', '==', user.uid).where('status', '==', 'open').limit(100).get();
    const requests = [];
    for (const route of routes.docs) {
      const requestSnap = await db.collection('autoPartRequests').doc(route.data()?.requestId || '').get();
      if (!requestSnap.exists || requestSnap.data()?.status !== 'open') continue;
      const quoteSnap = await db.collection('autoPartQuotes').doc(`${requestSnap.id}_${user.uid}`).get();
      requests.push({ id: requestSnap.id, ...requestSnap.data(), myQuote: quoteSnap.exists ? { id: quoteSnap.id, ...quoteSnap.data() } : null });
    }
    return reply(res, 200, { ok: true, requests });
  }

  async function submitPartQuote(req, res) {
    const { user, profile } = await requireVendor(req);
    const body = bodyOf(req);
    const requestId = cleanText(body.requestId, 160);
    const routeSnap = await db.collection('autoPartRequestRoutes').doc(`${requestId}_${user.uid}`).get();
    const requestSnap = await db.collection('autoPartRequests').doc(requestId).get();
    if (!routeSnap.exists || routeSnap.data()?.status !== 'open' || !requestSnap.exists || requestSnap.data()?.status !== 'open') return reply(res, 404, { ok: false, error: 'request-not-available' });
    const price = Number(body.price);
    const stock = Number.parseInt(body.stock, 10);
    if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < Number(requestSnap.data()?.quantity || 1)) return reply(res, 400, { ok: false, error: 'invalid-quote' });
    const quoteRef = db.collection('autoPartQuotes').doc(`${requestId}_${user.uid}`);
    await quoteRef.set({
      requestId, customerUid: requestSnap.data()?.customerUid, vendorId: user.uid,
      vendorName: cleanText(profile?.businessName || profile?.shopName || profile?.vendorName, 160),
      price: Math.round(price * 100) / 100, stock,
      condition: ['new', 'used', 'refurbished'].includes(body.condition) ? body.condition : 'new',
      warranty: cleanText(body.warranty, 180), deliveryDelay: cleanText(body.deliveryDelay, 100),
      notes: cleanText(body.notes, 500), images: validateRequestMedia(body.images, user.uid),
      status: 'submitted', updatedAt: timestamp(), createdAt: timestamp()
    }, { merge: true });
    await db.collection('autoPartsAuditLogs').add({ actorUid: user.uid, action: 'quote.submitted', requestId, quoteId: quoteRef.id, at: timestamp() });
    return reply(res, 200, { ok: true, id: quoteRef.id });
  }

  async function choosePartQuote(req, res) {
    const user = await requireUser(req);
    const body = bodyOf(req);
    const requestId = cleanText(body.requestId, 160);
    const quoteId = cleanText(body.quoteId, 220);
    const [requestSnap, quoteSnap] = await Promise.all([
      db.collection('autoPartRequests').doc(requestId).get(),
      db.collection('autoPartQuotes').doc(quoteId).get()
    ]);
    if (!requestSnap.exists || requestSnap.data()?.customerUid !== user.uid || requestSnap.data()?.status !== 'open') return reply(res, 404, { ok: false, error: 'request-not-found' });
    if (!quoteSnap.exists || quoteSnap.data()?.requestId !== requestId || quoteSnap.data()?.customerUid !== user.uid || quoteSnap.data()?.status !== 'submitted') return reply(res, 404, { ok: false, error: 'quote-not-found' });
    const requestData = requestSnap.data() || {};
    const quote = quoteSnap.data() || {};
    const rules = await db.collection('vendorCommissionRules').where('active', '==', true).limit(100).get();
    const key = cleanText(requestData.categoryName || 'Auto & Parts', 120).toLowerCase();
    const rule = rules.docs.map((doc) => doc.data() || {}).find((item) => {
      const category = cleanText(item.category, 120).toLowerCase();
      return category === key || category === 'auto & parts' || category === 'auto parts';
    });
    if (!rule || !Number.isFinite(Number(rule.rate))) return reply(res, 409, { ok: false, error: 'commission-rule-required' });
    const offerRef = db.collection('vendorProducts').doc();
    const now = timestamp();
    const commissionRule = { category: rule.category || requestData.categoryName || 'Auto & Parts', categoryRate: Number(rule.rate), source: 'vendorCommissionRules' };
    const batch = db.batch();
    batch.set(offerRef, {
      vertical: 'auto_parts', sourceType: 'part_request_quote', requestId,
      vendorId: quote.vendorId, vendorName: quote.vendorName, name: requestData.title,
      categoryId: requestData.categoryId, category: requestData.categoryName || 'Auto & Parts',
      partNumber: requestData.partNumber || '', price: quote.price, stock: quote.stock,
      condition: quote.condition, warranty: quote.warranty, deliveryDelay: quote.deliveryDelay,
      images: quote.images || requestData.mediaUrls || [], status: 'active', commissionRule,
      createdAt: now, updatedAt: now
    });
    batch.set(requestSnap.ref, { status: 'quote_selected', selectedQuoteId: quoteId, selectedOfferId: offerRef.id, updatedAt: now }, { merge: true });
    batch.set(quoteSnap.ref, { status: 'selected', selectedAt: now }, { merge: true });
    batch.set(db.collection('autoPartsAuditLogs').doc(), { actorUid: user.uid, action: 'quote.selected', requestId, quoteId, offerId: offerRef.id, at: now });
    await batch.commit();
    return reply(res, 200, { ok: true, offer: { id: offerRef.id, name: requestData.title, price: quote.price, stock: quote.stock, vendorId: quote.vendorId, vendorName: quote.vendorName, image: (quote.images || requestData.mediaUrls || [])[0] || '', categoryId: requestData.categoryId, category: requestData.categoryName || 'Auto & Parts', partNumber: requestData.partNumber || '', commissionRule } });
  }

  async function listMyAutoSupport(req, res) {
    const user = await requireUser(req);
    const [ordersSnap, claimsSnap] = await Promise.all([
      db.collection('clients').doc(user.uid).collection('orders').limit(100).get(),
      db.collection('autoClaims').where('customerUid','==',user.uid).limit(100).get()
    ]);
    const orders = ordersSnap.docs.map((doc)=>({id:doc.id,...doc.data()})).filter((order)=>
      cleanText(order.paymentStatus,30).toLowerCase()==='paid' && (order.items||[]).some((item)=>item?.autoProgramType==='auto_parts'))
      .map((order)=>({id:order.id,paidAt:order.paidAt||order.updatedAt||'',items:(order.items||[]).filter((item)=>item?.autoProgramType==='auto_parts').map((item)=>({productId:cleanText(item.productId,160),name:cleanText(item.name,180),vendorId:cleanText(item.vendorId,160),vendorName:cleanText(item.vendorName,160),warranty:cleanText(item.warranty,180)}))}));
    return reply(res,200,{ok:true,orders,claims:claimsSnap.docs.map((doc)=>({id:doc.id,...doc.data()}))});
  }

  async function createAutoClaim(req, res) {
    const user = await requireUser(req); const body=bodyOf(req);
    const orderId=cleanText(body.orderId,160);const productId=cleanText(body.productId,160);const issueType=cleanText(body.issueType,40).toLowerCase();const description=cleanText(body.description,1800);
    if(!orderId||!productId||!['warranty','return','damaged','wrong_part','other'].includes(issueType)||description.length<10)return reply(res,400,{ok:false,error:'invalid-claim'});
    const orderSnap=await db.collection('clients').doc(user.uid).collection('orders').doc(orderId).get();
    if(!orderSnap.exists||cleanText(orderSnap.data()?.paymentStatus,30).toLowerCase()!=='paid')return reply(res,404,{ok:false,error:'eligible-order-not-found'});
    const item=(orderSnap.data()?.items||[]).find((entry)=>cleanText(entry?.productId,160)===productId&&entry?.autoProgramType==='auto_parts');
    if(!item||!cleanText(item.vendorId,160))return reply(res,404,{ok:false,error:'eligible-item-not-found'});
    const existing=await db.collection('autoClaims').where('customerUid','==',user.uid).where('orderId','==',orderId).where('productId','==',productId).where('status','in',['submitted','reviewing','approved','return_in_transit']).limit(1).get();
    if(!existing.empty)return reply(res,409,{ok:false,error:'active-claim-exists'});
    const claimId=cleanText(body.claimId,160);if(!/^[A-Za-z0-9_-]{12,160}$/.test(claimId))return reply(res,400,{ok:false,error:'invalid-claim-id'});
    const ref=db.collection('autoClaims').doc(claimId);if((await ref.get()).exists)return reply(res,409,{ok:false,error:'claim-already-exists'});
    const mediaUrls=validateClaimMedia(body.mediaUrls,user.uid,claimId);const now=timestamp();
    await ref.set({customerUid:user.uid,orderId,productId,productName:cleanText(item.name,180),vendorId:cleanText(item.vendorId,160),vendorName:cleanText(item.vendorName,160),issueType,description,mediaUrls,status:'submitted',history:[{status:'submitted',actorUid:user.uid,at:new Date().toISOString()}],createdAt:now,updatedAt:now});
    await db.collection('autoPartsAuditLogs').add({actorUid:user.uid,action:'claim.created',claimId:ref.id,orderId,productId,at:now});
    return reply(res,200,{ok:true,id:ref.id});
  }

  async function updateAutoClaimStatus(req, res) {
    const user=await requireUser(req);const body=bodyOf(req);const id=cleanText(body.id,160);const nextStatus=cleanText(body.status,40).toLowerCase();const ref=db.collection('autoClaims').doc(id);const snap=await ref.get();
    if(!snap.exists)return reply(res,404,{ok:false,error:'claim-not-found'});const claim=snap.data()||{};const adminAccess=await isAdminUser(user.uid);const vendorAccess=claim.vendorId===user.uid;
    if(!adminAccess&&!vendorAccess)return reply(res,403,{ok:false,error:'claim-access-denied'});
    const current=cleanText(claim.status,40).toLowerCase();const transitions={submitted:['reviewing','rejected'],reviewing:['approved','rejected'],approved:['return_in_transit','refunded','replaced'],return_in_transit:['refunded','replaced']};
    if(!(transitions[current]||[]).includes(nextStatus))return reply(res,409,{ok:false,error:'invalid-claim-transition'});
    const history=Array.isArray(claim.history)?claim.history.slice(-30):[];history.push({status:nextStatus,actorUid:user.uid,note:cleanText(body.note,500),at:new Date().toISOString()});
    await ref.set({status:nextStatus,resolutionNote:cleanText(body.note,500),history,updatedAt:timestamp()},{merge:true});
    await db.collection('autoPartsAuditLogs').add({actorUid:user.uid,action:`claim.${nextStatus}`,claimId:id,previousStatus:current,at:timestamp()});
    return reply(res,200,{ok:true,status:nextStatus});
  }

  async function applyAsGarage(req, res) {
    const user = await requireUser(req);
    const body = bodyOf(req);
    const name = cleanText(body.name, 160);
    const commune = cleanText(body.commune, 100);
    const department = cleanText(body.department, 100);
    const services = Array.isArray(body.services) ? body.services.map((value) => cleanText(value, 100)).filter(Boolean).slice(0, 30) : [];
    if (!name || !commune || !department || !services.length) return reply(res, 400, { ok: false, error: 'invalid-garage-application' });
    const ref = db.collection('autoGarageApplications').doc(user.uid);
    await ref.set({ ownerUid:user.uid, name, commune, department, address:cleanText(body.address, 240), phone:cleanText(body.phone, 50), experience:cleanText(body.experience, 600), services, status:'pending', submittedAt:timestamp(), updatedAt:timestamp() }, { merge:true });
    await db.collection('autoPartsAuditLogs').add({ actorUid:user.uid, action:'garage.application_submitted', targetUid:user.uid, at:timestamp() });
    return reply(res, 200, { ok:true, status:'pending' });
  }

  async function reviewGarage(req, res) {
    const adminUser = await requireUser(req);
    if (!(await isAdminUser(adminUser.uid))) return reply(res, 403, { ok:false, error:'admin-required' });
    const body = bodyOf(req);
    const garageId = cleanText(body.garageId, 160);
    const decision = cleanText(body.decision, 30).toLowerCase();
    if (!garageId || !['approved','rejected','suspended'].includes(decision)) return reply(res, 400, { ok:false, error:'invalid-review' });
    const applicationRef = db.collection('autoGarageApplications').doc(garageId);
    const snap = await applicationRef.get();
    if (!snap.exists) return reply(res, 404, { ok:false, error:'application-not-found' });
    const application = snap.data() || {};
    const batch = db.batch();
    batch.set(applicationRef,{ status:decision,reviewNote:cleanText(body.reviewNote,500),reviewedBy:adminUser.uid,reviewedAt:timestamp(),updatedAt:timestamp() },{merge:true});
    batch.set(db.collection('autoGarages').doc(garageId),{ ownerUid:garageId,name:application.name,commune:application.commune,department:application.department,address:application.address||'',phone:application.phone||'',services:application.services||[],verificationStatus:decision,publicationStatus:decision==='approved'?'published':'suspended',updatedAt:timestamp(),createdAt:timestamp() },{merge:true});
    batch.set(db.collection('clients').doc(garageId),{ garageVerificationStatus:decision,updatedAt:timestamp() },{merge:true});
    if(decision==='approved')batch.set(db.collection('vendors').doc(garageId),{role:'vendor',status:'active',vendorStatus:'active',vendorName:application.name,shopName:application.name,garageVerificationStatus:'approved',verticalRoles:['garage'],updatedAt:timestamp()},{merge:true});
    batch.set(db.collection('autoPartsAuditLogs').doc(),{actorUid:adminUser.uid,action:`garage.${decision}`,targetUid:garageId,at:timestamp()});
    await batch.commit();
    return reply(res, 200, {ok:true,status:decision});
  }

  async function listGarages(req, res) {
    const department = cleanText(req.query.department, 100).toLowerCase();
    const commune = cleanText(req.query.commune, 100).toLowerCase();
    const snapshot = await db.collection('autoGarages').where('publicationStatus','==','published').limit(100).get();
    const garages = snapshot.docs.map((doc)=>({id:doc.id,...doc.data()})).filter((garage)=>
      (!department || cleanText(garage.department,100).toLowerCase()===department) &&
      (!commune || cleanText(garage.commune,100).toLowerCase()===commune));
    const results = await Promise.all(garages.map(async(garage)=>{
      const services = await db.collection('autoGarageServices').where('garageId','==',garage.id).where('status','==','published').limit(100).get();
      return {...garage,services:services.docs.map((doc)=>({id:doc.id,...doc.data()}))};
    }));
    return reply(res,200,{ok:true,garages:results});
  }

  async function saveGarageService(req, res) {
    const user = await requireUser(req);
    const garageSnap = await db.collection('autoGarages').doc(user.uid).get();
    if (!garageSnap.exists || garageSnap.data()?.verificationStatus!=='approved') return reply(res,403,{ok:false,error:'verified-garage-required'});
    const body=bodyOf(req); const name=cleanText(body.name,160); const price=Number(body.price); const durationMinutes=Number.parseInt(body.durationMinutes,10);
    if(!name||!Number.isFinite(price)||price<=0||!Number.isInteger(durationMinutes)||durationMinutes<15||durationMinutes>720)return reply(res,400,{ok:false,error:'invalid-garage-service'});
    const id=cleanText(body.id,160); const ref=id?db.collection('autoGarageServices').doc(id):db.collection('autoGarageServices').doc();
    if(id){const current=await ref.get();if(!current.exists||current.data()?.garageId!==user.uid)return reply(res,404,{ok:false,error:'service-not-found'});}
    const patch={garageId:user.uid,name,description:cleanText(body.description,600),price:Math.round(price*100)/100,durationMinutes,status:body.status==='draft'?'draft':'published',updatedAt:timestamp()};if(!id)patch.createdAt=timestamp();
    await ref.set(patch,{merge:true});
    return reply(res,200,{ok:true,id:ref.id});
  }

  async function deleteGarageService(req, res) {
    const user = await requireUser(req);
    const id = cleanText(bodyOf(req).id, 160);
    if (!id) return reply(res, 400, { ok:false, error:'service-id-required' });
    const ref = db.collection('autoGarageServices').doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.garageId !== user.uid) return reply(res, 404, { ok:false, error:'service-not-found' });
    const futureBooking = await db.collection('autoGarageBookings').where('serviceId','==',id).where('status','in',['held','confirmed']).limit(1).get();
    if (!futureBooking.empty) return reply(res, 409, { ok:false, error:'service-has-active-bookings' });
    await ref.delete();
    await db.collection('autoPartsAuditLogs').add({ actorUid:user.uid, action:'garage.service_deleted', serviceId:id, at:timestamp() });
    return reply(res, 200, { ok:true });
  }

  async function saveGarageAvailability(req,res){
    const user=await requireUser(req);const garage=await db.collection('autoGarages').doc(user.uid).get();
    if(!garage.exists||garage.data()?.verificationStatus!=='approved')return reply(res,403,{ok:false,error:'verified-garage-required'});
    const body=bodyOf(req);const slots=(Array.isArray(body.slots)?body.slots:[]).map((slot)=>({dayOfWeek:Number(slot.dayOfWeek),start:cleanText(slot.start,5),end:cleanText(slot.end,5)})).filter((slot)=>Number.isInteger(slot.dayOfWeek)&&slot.dayOfWeek>=0&&slot.dayOfWeek<=6&&/^\d{2}:\d{2}$/.test(slot.start)&&/^\d{2}:\d{2}$/.test(slot.end)&&slot.start<slot.end).slice(0,28);
    await db.collection('autoGarageAvailability').doc(user.uid).set({garageId:user.uid,slots,timezone:'America/Port-au-Prince',updatedAt:timestamp()},{merge:true});
    return reply(res,200,{ok:true,slots});
  }

  async function updateGarageBookingStatus(req, res) {
    const user = await requireUser(req);
    const body = bodyOf(req);
    const id = cleanText(body.id, 160);
    const nextStatus = cleanText(body.status, 30).toLowerCase();
    const ref = db.collection('autoGarageBookings').doc(id);
    const snap = await ref.get();
    if (!snap.exists || snap.data()?.garageId !== user.uid) return reply(res, 404, { ok:false, error:'booking-not-found' });
    const currentStatus = cleanText(snap.data()?.status, 30).toLowerCase();
    const allowed = { confirmed:['in_progress'], in_progress:['completed'] };
    if (!(allowed[currentStatus] || []).includes(nextStatus)) return reply(res, 409, { ok:false, error:'invalid-booking-transition' });
    await ref.set({ status:nextStatus, statusNote:cleanText(body.note,300), updatedAt:timestamp() }, { merge:true });
    await db.collection('autoPartsAuditLogs').add({ actorUid:user.uid, action:`garage.booking_${nextStatus}`, bookingId:id, previousStatus:currentStatus, at:timestamp() });
    return reply(res, 200, { ok:true, status:nextStatus });
  }

  async function createGarageBookingCheckout(req,res){
    const user=await requireUser(req);const body=bodyOf(req);const serviceId=cleanText(body.serviceId,160);const startAt=cleanText(body.startAt,40);
    const startMs=Date.parse(startAt);if(!serviceId||!Number.isFinite(startMs)||startMs<Date.now()+15*60*1000)return reply(res,400,{ok:false,error:'invalid-booking-time'});
    const serviceSnap=await db.collection('autoGarageServices').doc(serviceId).get();
    if(!serviceSnap.exists||serviceSnap.data()?.status!=='published')return reply(res,404,{ok:false,error:'service-not-found'});
    const service=serviceSnap.data()||{};const garageSnap=await db.collection('autoGarages').doc(service.garageId||'').get();
    if(!garageSnap.exists||garageSnap.data()?.publicationStatus!=='published')return reply(res,404,{ok:false,error:'garage-not-found'});
    const availabilitySnap=await db.collection('autoGarageAvailability').doc(service.garageId).get();
    const localParts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Port-au-Prince',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(startMs));
    const value=(type)=>localParts.find((part)=>part.type===type)?.value||'';
    const dayMap={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};const dayOfWeek=dayMap[value('weekday')];const localStart=`${value('hour')}:${value('minute')}`;
    const endLocalMinutes=Number(value('hour'))*60+Number(value('minute'))+Number(service.durationMinutes||60);
    const scheduleMatch=(availabilitySnap.data()?.slots||[]).some((slot)=>{const [endHour,endMinute]=String(slot.end||'').split(':').map(Number);return Number(slot.dayOfWeek)===dayOfWeek&&localStart>=slot.start&&endLocalMinutes<=endHour*60+endMinute;});
    if(!scheduleMatch)return reply(res,409,{ok:false,error:'outside-garage-availability'});
    const endAt=new Date(startMs+Number(service.durationMinutes||60)*60000).toISOString();const bookingRef=db.collection('autoGarageBookings').doc();const offerRef=db.collection('vendorProducts').doc();
    const rules=await db.collection('vendorCommissionRules').where('active','==',true).limit(100).get();const rule=rules.docs.map((doc)=>doc.data()||{}).find((item)=>['garage','auto & parts','auto parts'].includes(cleanText(item.category,120).toLowerCase()));
    if(!rule||!Number.isFinite(Number(rule.rate)))return reply(res,409,{ok:false,error:'commission-rule-required'});
    const commissionRule={category:rule.category||'Garage',categoryRate:Number(rule.rate),source:'vendorCommissionRules'};const vehicle=normalizeVehicle(body.vehicle||{});
    try{await db.runTransaction(async(transaction)=>{
      const conflicts=await transaction.get(db.collection('autoGarageBookings').where('garageId','==',service.garageId).where('startAt','==',new Date(startMs).toISOString()).where('status','in',['held','confirmed']).limit(1));
      if(!conflicts.empty)throw new Error('slot-unavailable');const now=timestamp();
      transaction.set(bookingRef,{customerUid:user.uid,garageId:service.garageId,serviceId,serviceName:service.name,offerId:offerRef.id,vehicle,startAt:new Date(startMs).toISOString(),endAt,status:'held',holdExpiresAt:new Date(Date.now()+20*60*1000).toISOString(),price:Number(service.price),createdAt:now,updatedAt:now});
      transaction.set(offerRef,{vertical:'auto_parts',sourceType:'garage_booking',autoBookingId:bookingRef.id,vendorId:service.garageId,vendorName:garageSnap.data()?.name||'Garage vérifié',name:service.name,category:'Garage',price:Number(service.price),stock:1,status:'active',commissionRule,deliveryMode:'Rendez-vous au garage',createdAt:now,updatedAt:now});
    });}catch(error){return reply(res,error.message==='slot-unavailable'?409:500,{ok:false,error:error.message||'booking-failed'});}
    return reply(res,200,{ok:true,bookingId:bookingRef.id,offer:{id:offerRef.id,name:service.name,price:Number(service.price),stock:1,vendorId:service.garageId,vendorName:garageSnap.data()?.name||'Garage vérifié',category:'Garage',commissionRule,autoBookingId:bookingRef.id,startAt:new Date(startMs).toISOString()}});
  }

  async function saveCanonicalPart(req, res) {
    const user = await requireUser(req);
    if (!(await isAdminUser(user.uid))) return reply(res, 403, { ok: false, error: 'admin-required' });
    const body = bodyOf(req);
    const part = normalizePart(body);
    const id = cleanText(body.id, 160);
    const ref = id ? db.collection('autoParts').doc(id) : db.collection('autoParts').doc();
    const partPatch = { ...part, searchTokens: buildSearchTokens(part), updatedAt: timestamp() };
    if (!id) partPatch.createdAt = timestamp();
    await ref.set(partPatch, { merge: true });
    await db.collection('autoPartsAuditLogs').add({ actorUid: user.uid, action: id ? 'part.updated' : 'part.created', partId: ref.id, at: timestamp() });
    return reply(res, 200, { ok: true, id: ref.id });
  }

  const autoPartsApi = onRequest({ region: REGION }, async (req, res) => {
    if (req.method === 'OPTIONS') { cors(res); return res.status(204).send(''); }
    const action = cleanText(req.query.action || bodyOf(req).action, 80);
    try {
      if (req.method === 'GET' && action === 'catalog') return await getCatalog(req, res);
      if (req.method === 'GET' && action === 'taxonomy') return await getTaxonomy(res);
      if (action === 'getVendorWorkspace') return await getVendorWorkspace(req, res);
      if (req.method === 'POST' && action === 'applyAsAutoVendor') return await applyAsAutoVendor(req, res);
      if (req.method === 'POST' && action === 'reviewAutoVendor') return await reviewAutoVendor(req, res);
      if (['listGarage', 'saveGarageVehicle', 'deleteGarageVehicle'].includes(action)) return await garage(req, res, action);
      if (req.method === 'POST' && action === 'saveOffer') return await saveOffer(req, res);
      if (req.method === 'POST' && action === 'deleteOffer') return await deleteOffer(req, res);
      if (req.method === 'POST' && action === 'submitCatalogPartRequest') return await submitCatalogPartRequest(req,res);
      if (req.method === 'POST' && action === 'createPartRequest') return await createPartRequest(req, res);
      if (action === 'listMyPartRequests') return await listMyPartRequests(req, res);
      if (action === 'listVendorPartRequests') return await listVendorPartRequests(req, res);
      if (req.method === 'POST' && action === 'submitPartQuote') return await submitPartQuote(req, res);
      if (req.method === 'POST' && action === 'choosePartQuote') return await choosePartQuote(req, res);
      if (action === 'listMyAutoSupport') return await listMyAutoSupport(req,res);
      if (req.method === 'POST' && action === 'createAutoClaim') return await createAutoClaim(req,res);
      if (req.method === 'POST' && action === 'updateAutoClaimStatus') return await updateAutoClaimStatus(req,res);
      if (req.method === 'POST' && action === 'applyAsGarage') return await applyAsGarage(req,res);
      if (req.method === 'POST' && action === 'reviewGarage') return await reviewGarage(req,res);
      if (req.method === 'GET' && action === 'listGarages') return await listGarages(req,res);
      if (req.method === 'POST' && action === 'saveGarageService') return await saveGarageService(req,res);
      if (req.method === 'POST' && action === 'deleteGarageService') return await deleteGarageService(req,res);
      if (req.method === 'POST' && action === 'saveGarageAvailability') return await saveGarageAvailability(req,res);
      if (req.method === 'POST' && action === 'updateGarageBookingStatus') return await updateGarageBookingStatus(req,res);
      if (req.method === 'POST' && action === 'createGarageBookingCheckout') return await createGarageBookingCheckout(req,res);
      if (req.method === 'POST' && action === 'saveCanonicalPart') return await saveCanonicalPart(req, res);
      return reply(res, 400, { ok: false, error: 'unsupported-action' });
    } catch (error) {
      logger.error('Auto Parts API failed', { action, message: error?.message || '' });
      return reply(res, error?.status || 500, { ok: false, error: error?.message || 'auto-parts-request-failed' });
    }
  });

  const releaseExpiredGarageBookings = onSchedule({ region: REGION, schedule:'every 15 minutes', timeZone:'America/Port-au-Prince' }, async()=>{
    const now=new Date().toISOString();const snapshot=await db.collection('autoGarageBookings').where('status','==','held').where('holdExpiresAt','<=',now).limit(100).get();
    if(snapshot.empty)return;const batch=db.batch();snapshot.docs.forEach((doc)=>{batch.set(doc.ref,{status:'expired',updatedAt:timestamp()},{merge:true});const offerId=cleanText(doc.data()?.offerId,160);if(offerId)batch.set(db.collection('vendorProducts').doc(offerId),{status:'inactive',stock:0,updatedAt:timestamp()},{merge:true});});await batch.commit();
  });

  return { autoPartsApi, releaseExpiredGarageBookings };
}

module.exports = buildAutoParts;
