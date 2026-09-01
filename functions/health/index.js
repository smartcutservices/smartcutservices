'use strict';

/**
 * Smart Cut Health — Phase 1 (Pharmacy) Cloud Functions.
 *
 * Factory mirrors functions/smartsolutiontek/index.js exactly: takes the reused
 * internals already assembled in functions/index.js (admin, db, REGION,
 * verifyBearerUser, isAdminUser, createMoncashRedirect, retrieveMoncashPayment, the
 * MonCash secret params) and returns every healthXxx-prefixed Cloud Function. Mounted
 * from functions/index.js with:
 *
 *   Object.assign(exports, require('./health')(__sstInternals));
 *
 * Architecture notes (see the final report for the full rationale):
 * - Reuses the SAME MonCash integration (createMoncashRedirect / retrieveMoncashPayment,
 *   same secrets, same gateway) as the rest of the site — no new payment infrastructure.
 * - Does NOT write into the generic `paymentSessions` / `clients/{uid}/orders`
 *   collections or route through the generic marketplace payment-confirmation
 *   transaction (`syncMoncashPayment` in functions/index.js): that transaction assumes
 *   a vendor/commission/inventory order shape this module doesn't produce, and is a
 *   business-critical path used by the whole site's real orders today — extending it
 *   blind was judged too risky. Health payments live in their own
 *   `healthPaymentSessions` / `healthOrders` collections instead, confirmed by this
 *   module's own `healthCheckPaymentStatus`, called from a dedicated return page
 *   (`/health/payment-return.html`) that the shared `/moncash/return` page redirects to
 *   — the exact same additive pattern already used by SmartCut Facturation's
 *   `redirectBillingReturnIfNeeded()` in moncash/return/moncash-return.js.
 * - Every price is recomputed server-side from the pharmacy's own catalog at write
 *   time; a client never gets to supply a price that is trusted as-is.
 * - Every prescription status transition is validated against lib/validation.js's
 *   transition table; there is no direct client write path to prescription status.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const {
  HttpError,
  requireBearerUser,
  withErrorHandling
} = require('../smartsolutiontek/auth');
const {
  canTransitionPrescription,
  canTransitionOrder,
  computeOfferTotal,
  sanitizeMedicinePayload,
  tokenizeSearchName,
  sanitizeText,
  PHARMACEUTICAL_FORMS,
  THERAPEUTIC_CLASSES
} = require('./lib/validation');
const { applyHealthLedger } = require('./lib/healthLedger');
const { notifyUser } = require('./lib/healthNotify');
const { creditPatientWallet } = require('./lib/healthWallet');

const HEALTH_CURRENCY = 'HTG';

function buildHealth(sstInternals) {
  if (!sstInternals || !sstInternals.db) {
    throw new Error('health requires sstInternals (db, verifyBearerUser, createMoncashRedirect, ...).');
  }
  const { db, admin, REGION: region, verifyBearerUser: verifyBearer, createMoncashRedirect, retrieveMoncashPayment,
    MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY } = sstInternals;
  const moncashSecrets = [MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY];

  // ---------- shared helpers ----------

  async function logAudit(actorUid, action, resource, context = {}) {
    try {
      await db.collection('healthAuditLogs').add({
        actorUid,
        action,
        resource,
        context, // never put medical content (medicine names, notes, file contents) here — ids/counts only
        createdAt: new Date().toISOString()
      });
    } catch (error) {
      // Audit logging must never take down the actual operation it's logging.
      logger.error('healthAuditLog failed', { action, resource, message: error?.message });
    }
  }

  async function getClientProfile(uid) {
    const snap = await db.collection('clients').doc(uid).get();
    return snap.exists ? { id: snap.id, ...snap.data() } : null;
  }

  /** @throws {HttpError} 403 unless the caller is a verified pharmacy. */
  async function requireVerifiedPharmacy(uid) {
    const profile = await getClientProfile(uid);
    if (!profile || String(profile.role || '').toLowerCase() !== 'pharmacy' || String(profile.pharmacyStatus || '').toLowerCase() !== 'verified') {
      throw new HttpError(403, 'pharmacy-not-verified', "Cette pharmacie n'est pas encore vérifiée par Smart Cut.");
    }
    return profile;
  }

  async function isCallerAdmin(uid) {
    return typeof sstInternals.isAdminUser === 'function' ? sstInternals.isAdminUser(uid) : false;
  }

  function parseBody(req) {
    return req.body && typeof req.body === 'object' ? req.body : {};
  }

  // Doctor appointments are the one exception: crediting is deferred to the moment the
  // consultation actually starts (healthDoctorUpdateConsultation's IN_PROGRESS
  // transition, in clinical.js) rather than raw payment — matching what the doctor
  // dashboard already tells doctors ("crédités uniquement après démarrage effectif")
  // and what makes the "patient absent = 0 HTG médecin" rule trivially correct (the
  // credit simply never happens if the session never starts). Pharmacy/lab/imaging
  // orders keep the original at-payment timing — nothing in the spec asks otherwise
  // there, and changing it would be a materially bigger, riskier change to those flows.
  async function creditHealthLedgerIfApplicable(orderId, order) {
    if (order?.kind === 'appointment' && order?.providerType === 'doctor') return;
    await applyHealthLedger(db, sstInternals, orderId, order);
  }

  async function enforceRateLimit(uid, action, { limit = 10, windowMs = 60_000 } = {}) {
    const bucket = Math.floor(Date.now() / windowMs);
    const ref = db.collection('healthRateLimits').doc(`${uid}_${action}_${bucket}`.replace(/[^a-zA-Z0-9_-]/g, '_'));
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      const count = Number(snap.data()?.count || 0);
      if (count >= limit) throw new HttpError(429, 'rate-limited', 'Trop de tentatives. Réessayez dans un instant.');
      transaction.set(ref, { uid, action, bucket, count: count + 1, expiresAt: new Date((bucket + 2) * windowMs).toISOString() }, { merge: true });
    });
  }

  // ---------- public reads (no auth — non-sensitive catalog data only) ----------

  const healthListVerifiedPharmacies = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const snap = await db.collection('clients').where('role', '==', 'pharmacy').where('pharmacyStatus', '==', 'verified').limit(100).get();
    const pharmacies = snap.docs.map((doc) => {
      const data = doc.data() || {};
      const profile = data.pharmacyProfile || {};
      return {
        id: doc.id,
        businessName: profile.businessName || '',
        address: profile.address || '',
        department: profile.department || '',
        commune: profile.commune || '',
        phone: profile.phone || ''
      };
    });
    res.status(200).json({ ok: true, pharmacies });
  }));

  const healthSearchMedicines = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const query = sanitizeText(req.query?.q, 80).toLowerCase();
    if (query.length < 2) {
      res.status(200).json({ ok: true, results: [] });
      return;
    }
    const token = tokenizeSearchName(query)[0] || query;
    const snap = await db.collection('healthPharmacyProducts').where('nameTokens', 'array-contains', token).limit(60).get();
    if (snap.empty) {
      res.status(200).json({ ok: true, results: [] });
      return;
    }
    // Cross-check every candidate's owning pharmacy is still verified server-side —
    // an unverified/suspended pharmacy's listings must never surface in search,
    // regardless of what's cached on the product doc itself.
    const pharmacyIds = Array.from(new Set(snap.docs.map((doc) => doc.data().pharmacyId).filter(Boolean)));
    const pharmacySnaps = await Promise.all(pharmacyIds.map((id) => db.collection('clients').doc(id).get()));
    const verifiedPharmacies = new Map();
    pharmacySnaps.forEach((pSnap) => {
      if (!pSnap.exists) return;
      const data = pSnap.data() || {};
      if (String(data.role || '') === 'pharmacy' && String(data.pharmacyStatus || '') === 'verified') {
        verifiedPharmacies.set(pSnap.id, data.pharmacyProfile?.businessName || 'Pharmacie');
      }
    });
    const results = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((product) => verifiedPharmacies.has(product.pharmacyId) && product.active !== false)
      .map((product) => ({
        id: product.id,
        pharmacyId: product.pharmacyId,
        pharmacyName: verifiedPharmacies.get(product.pharmacyId),
        name: product.name,
        dci: product.dci || '',
        dosage: product.dosage || '',
        pharmaceuticalForm: product.pharmaceuticalForm || '',
        price: product.price,
        stock: product.stock,
        prescriptionRequired: Boolean(product.prescriptionRequired),
        coldChainRequired: Boolean(product.coldChainRequired)
      }));
    res.status(200).json({ ok: true, results });
  }));

  const healthListAvailableMedicines = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const snap = await db.collection('healthPharmacyProducts').limit(60).get();
    const pharmacyIds = Array.from(new Set(snap.docs.map((doc) => doc.data().pharmacyId).filter(Boolean)));
    const pharmacySnaps = await Promise.all(pharmacyIds.map((id) => db.collection('clients').doc(id).get()));
    const verifiedPharmacies = new Map();
    pharmacySnaps.forEach((pSnap) => {
      if (!pSnap.exists) return;
      const data = pSnap.data() || {};
      if (String(data.role || '') === 'pharmacy' && String(data.pharmacyStatus || '') === 'verified') {
        verifiedPharmacies.set(pSnap.id, data.pharmacyProfile?.businessName || 'Pharmacie');
      }
    });
    const medicines = snap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((product) => verifiedPharmacies.has(product.pharmacyId) && product.active !== false && Number(product.stock) > 0)
      .slice(0, 6)
      .map((product) => ({
        id: product.id,
        name: product.name,
        dosage: product.dosage || '',
        pharmaceuticalForm: product.pharmaceuticalForm || '',
        price: Number(product.price) || 0,
        pharmacyName: verifiedPharmacies.get(product.pharmacyId)
      }));
    res.status(200).json({ ok: true, medicines });
  }));

  // ---------- pharmacy: catalog management ----------

  /** Public — the reference lists a pharmacy's product form needs (forms + therapeutic classes). */
  const healthGetMedicineFormOptions = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    res.status(200).json({ ok: true, pharmaceuticalForms: PHARMACEUTICAL_FORMS, therapeuticClasses: THERAPEUTIC_CLASSES });
  }));

  const healthSaveMedicine = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decoded = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    await enforceRateLimit(decoded.uid, 'save-medicine', { limit: 80, windowMs: 300_000 });
    await requireVerifiedPharmacy(decoded.uid);
    const body = parseBody(req);

    let sanitized;
    try {
      sanitized = sanitizeMedicinePayload(body);
    } catch (error) {
      throw new HttpError(400, error.code || 'invalid-payload', error.message || 'Donnees invalides.');
    }

    const productId = sanitizeText(body.productId, 200);
    const now = new Date().toISOString();
    const doc = {
      ...sanitized,
      nameTokens: tokenizeSearchName(sanitized.name),
      pharmacyId: decoded.uid, // never trust a pharmacyId from the client
      updatedAt: now
    };

    if (productId) {
      const ref = db.collection('healthPharmacyProducts').doc(productId);
      const existing = await ref.get();
      if (!existing.exists || existing.data().pharmacyId !== decoded.uid) {
        throw new HttpError(404, 'product-not-found', 'Médicament introuvable pour cette pharmacie.');
      }
      await ref.set(doc, { merge: true });
      res.status(200).json({ ok: true, productId });
      return;
    }

    doc.createdAt = now;
    const ref = await db.collection('healthPharmacyProducts').add(doc);
    res.status(200).json({ ok: true, productId: ref.id });
  }));

  const healthDeleteMedicine = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decoded = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    await requireVerifiedPharmacy(decoded.uid);
    const productId = sanitizeText(parseBody(req).productId, 200);
    if (!productId) throw new HttpError(400, 'product-id-required', 'Identifiant du médicament requis.');
    const ref = db.collection('healthPharmacyProducts').doc(productId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().pharmacyId !== decoded.uid) {
      throw new HttpError(404, 'product-not-found', 'Médicament introuvable pour cette pharmacie.');
    }
    await ref.delete();
    res.status(200).json({ ok: true });
  }));

  // ---------- patient: prescriptions ----------

  const healthSubmitPrescription = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decoded = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    await enforceRateLimit(decoded.uid, 'submit-prescription', { limit: 5, windowMs: 3_600_000 });
    const body = parseBody(req);
    // The client generates this id (a Firestore auto-id, e.g. via `doc().id`) BEFORE
    // uploading, so the file can be stored at a path that already encodes it —
    // storage.rules needs prescriptionId in the path to check per-file pharmacy
    // routing access. We then create the Firestore doc at this exact id (not a fresh
    // auto-id) so the two always match.
    const prescriptionId = sanitizeText(body.prescriptionId, 200);
    const storagePath = sanitizeText(body.storagePath, 500);
    const fileName = sanitizeText(body.fileName, 200);
    const mimeType = sanitizeText(body.mimeType, 100);
    const notes = sanitizeText(body.notes, 500);

    if (!prescriptionId) throw new HttpError(400, 'prescription-id-required', 'Identifiant requis.');
    // Path shape is health-prescriptions/{patientUid}__{prescriptionId}/{fileName} —
    // see storage.rules for why the two ids share one segment instead of two.
    const expectedPrefix = `health-prescriptions/${decoded.uid}__${prescriptionId}/`;
    if (!storagePath || !storagePath.startsWith(expectedPrefix)) {
      throw new HttpError(400, 'invalid-storage-path', 'Le fichier ne correspond pas à votre compte ou à cette ordonnance.');
    }

    const prescriptionRef = db.collection('healthPrescriptions').doc(prescriptionId);
    if ((await prescriptionRef.get()).exists) {
      throw new HttpError(409, 'prescription-already-exists', 'Cette ordonnance a déjà été envoyée.');
    }

    // Confirm the object genuinely exists in Storage before creating a Firestore
    // record for it — never trust a client-claimed upload.
    const [exists] = await admin.storage().bucket().file(storagePath).exists();
    if (!exists) {
      throw new HttpError(400, 'file-not-found', 'Le fichier envoyé est introuvable.');
    }

    const now = new Date().toISOString();
    const verifiedPharmaciesSnap = await db.collection('clients')
      .where('role', '==', 'pharmacy')
      .where('pharmacyStatus', '==', 'verified')
      .get();
    const routedPharmacyIds = verifiedPharmaciesSnap.docs.map((doc) => doc.id);

    const batch = db.batch();
    batch.set(prescriptionRef, {
      patientUid: decoded.uid,
      storagePath,
      fileName,
      mimeType,
      notes,
      status: 'RECEIVED',
      routedPharmacyIds,
      createdAt: now,
      updatedAt: now
    });
    routedPharmacyIds.forEach((pharmacyId) => {
      const routeRef = db.collection('healthPrescriptionRoutes').doc(`${prescriptionRef.id}_${pharmacyId}`);
      batch.set(routeRef, {
        prescriptionId: prescriptionRef.id,
        pharmacyId,
        status: 'pending',
        createdAt: now
      });
    });
    await batch.commit();

    await logAudit(decoded.uid, 'prescription_received', `healthPrescriptions/${prescriptionRef.id}`, {
      routedPharmacyCount: routedPharmacyIds.length
    });

    res.status(200).json({ ok: true, prescriptionId: prescriptionRef.id, routedPharmacyCount: routedPharmacyIds.length });
  }));

  /** Pharmacy (routed) or admin: advance a prescription through the review workflow. */
  const healthReviewPrescription = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decoded = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const body = parseBody(req);
    const prescriptionId = sanitizeText(body.prescriptionId, 200);
    const action = sanitizeText(body.action, 40).toUpperCase(); // UNDER_REVIEW | REJECTED | NEEDS_CLARIFICATION
    const reason = sanitizeText(body.reason, 500);
    if (!prescriptionId) throw new HttpError(400, 'prescription-id-required', 'Identifiant requis.');

    const ref = db.collection('healthPrescriptions').doc(prescriptionId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'prescription-not-found', 'Ordonnance introuvable.');
    const prescription = snap.data();

    const admin_ = await isCallerAdmin(decoded.uid);
    if (!admin_) {
      const routeSnap = await db.collection('healthPrescriptionRoutes').doc(`${prescriptionId}_${decoded.uid}`).get();
      if (!routeSnap.exists) throw new HttpError(403, 'not-routed', "Cette ordonnance ne vous a pas été transmise.");
      await requireVerifiedPharmacy(decoded.uid);
    }

    if (!canTransitionPrescription(prescription.status, action)) {
      throw new HttpError(409, 'invalid-transition', `Impossible de passer de ${prescription.status} à ${action}.`);
    }

    await ref.set({
      status: action,
      rejectionReason: ['REJECTED', 'NEEDS_CLARIFICATION'].includes(action) ? reason : (prescription.rejectionReason || ''),
      reviewedBy: decoded.uid,
      updatedAt: new Date().toISOString()
    }, { merge: true });

    await logAudit(decoded.uid, `prescription_${action.toLowerCase()}`, `healthPrescriptions/${prescriptionId}`, {});
    res.status(200).json({ ok: true });
  }));

  /** Pharmacy: submit priced availability for a prescription routed to them. */
  const healthSubmitPrescriptionOffer = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decoded = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    await enforceRateLimit(decoded.uid, 'submit-offer', { limit: 40, windowMs: 300_000 });
    const pharmacyProfile = await requireVerifiedPharmacy(decoded.uid);
    const body = parseBody(req);
    const prescriptionId = sanitizeText(body.prescriptionId, 200);
    const items = Array.isArray(body.items) ? body.items : [];
    const deliveryFee = Math.max(0, Number(body.deliveryFee) || 0);
    const deliveryEtaLabel = sanitizeText(body.deliveryEtaLabel, 100);

    const routeRef = db.collection('healthPrescriptionRoutes').doc(`${prescriptionId}_${decoded.uid}`);
    const routeSnap = await routeRef.get();
    if (!routeSnap.exists) throw new HttpError(403, 'not-routed', "Cette ordonnance ne vous a pas été transmise.");

    const prescriptionRef = db.collection('healthPrescriptions').doc(prescriptionId);
    const prescriptionSnap = await prescriptionRef.get();
    if (!prescriptionSnap.exists) throw new HttpError(404, 'prescription-not-found', 'Ordonnance introuvable.');

    // Build the pharmacy's own catalog map — item prices are NEVER taken from the request.
    const productIds = Array.from(new Set(items.map((item) => String(item?.productId || '').trim()).filter(Boolean)));
    if (!productIds.length) throw new HttpError(400, 'items-required', 'Au moins un produit est requis.');
    const productSnaps = await Promise.all(productIds.map((id) => db.collection('healthPharmacyProducts').doc(id).get()));
    const catalog = new Map();
    productSnaps.forEach((snap) => {
      if (!snap.exists) return;
      const data = snap.data();
      if (data.pharmacyId !== decoded.uid) return; // ignore a product that isn't this pharmacy's own
      catalog.set(snap.id, { name: data.name, price: data.price });
    });

    let offerTotal;
    try {
      offerTotal = computeOfferTotal(items, catalog);
    } catch (error) {
      throw new HttpError(400, 'invalid-offer-items', error.message || 'Articles invalides.');
    }

    const now = new Date().toISOString();
    const offerRef = await db.collection('healthPrescriptionOffers').add({
      prescriptionId,
      pharmacyId: decoded.uid,
      pharmacyName: pharmacyProfile.pharmacyProfile?.businessName || 'Pharmacie',
      items: offerTotal.lines,
      subtotal: offerTotal.subtotal,
      allAvailable: offerTotal.allAvailable,
      deliveryFee,
      deliveryEtaLabel,
      status: 'SUBMITTED',
      createdAt: now
    });

    const batch = db.batch();
    batch.set(routeRef, { status: 'responded', respondedAt: now }, { merge: true });
    if (canTransitionPrescription(prescriptionSnap.data().status, 'VALIDATED')) {
      batch.set(prescriptionRef, { status: 'VALIDATED', updatedAt: now }, { merge: true });
    }
    await batch.commit();

    await logAudit(decoded.uid, 'prescription_offer_submitted', `healthPrescriptionOffers/${offerRef.id}`, {
      prescriptionId,
      itemCount: offerTotal.lines.length
    });
    res.status(200).json({ ok: true, offerId: offerRef.id, subtotal: offerTotal.subtotal });
  }));

  /** Patient: accept one of the offers received for their prescription. */
  const healthAcceptPrescriptionOffer = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decoded = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const offerId = sanitizeText(parseBody(req).offerId, 200);
    if (!offerId) throw new HttpError(400, 'offer-id-required', 'Identifiant requis.');

    const offerRef = db.collection('healthPrescriptionOffers').doc(offerId);
    const offerSnap = await offerRef.get();
    if (!offerSnap.exists) throw new HttpError(404, 'offer-not-found', 'Offre introuvable.');
    const offer = offerSnap.data();

    const prescriptionRef = db.collection('healthPrescriptions').doc(offer.prescriptionId);
    const prescriptionSnap = await prescriptionRef.get();
    if (!prescriptionSnap.exists || prescriptionSnap.data().patientUid !== decoded.uid) {
      throw new HttpError(403, 'not-your-prescription', "Cette ordonnance ne vous appartient pas.");
    }
    if (!canTransitionPrescription(prescriptionSnap.data().status, 'PRICE_CONFIRMED')) {
      throw new HttpError(409, 'invalid-transition', 'Cette ordonnance ne peut plus être confirmée à ce stade.');
    }

    const siblingOffersSnap = await db.collection('healthPrescriptionOffers').where('prescriptionId', '==', offer.prescriptionId).get();
    const now = new Date().toISOString();
    const batch = db.batch();
    siblingOffersSnap.docs.forEach((doc) => {
      batch.set(doc.ref, { status: doc.id === offerId ? 'ACCEPTED' : 'DECLINED', updatedAt: now }, { merge: true });
    });
    batch.set(prescriptionRef, { status: 'PRICE_CONFIRMED', acceptedOfferId: offerId, updatedAt: now }, { merge: true });
    await batch.commit();

    await logAudit(decoded.uid, 'prescription_offer_accepted', `healthPrescriptionOffers/${offerId}`, {
      prescriptionId: offer.prescriptionId
    });
    res.status(200).json({ ok: true });
  }));

  // ---------- orders + payment ----------

  async function createHealthPaymentSession({ patientUid, pharmacyId, kind, prescriptionId, offerId, items, subtotal, deliveryFee, deliveryMethod, address, refreshCatalogPricing = false }) {
    const now = new Date().toISOString();
    const reservationExpiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const orderRef = db.collection('healthOrders').doc();
    const sessionRef = db.collection('healthPaymentSessions').doc();
    let lockedItems = [];
    let lockedSubtotal = Number(subtotal) || 0;

    // Reserve stock and create both records in one transaction. No second checkout
    // can reserve the same last unit. If MonCash redirect creation fails below, the
    // catch block compensates this reservation atomically.
    await db.runTransaction(async (transaction) => {
      let lockedOfferRef = null;
      if (offerId) {
        const offerRef = db.collection('healthPrescriptionOffers').doc(offerId);
        const offerSnap = await transaction.get(offerRef);
        if (!offerSnap.exists || offerSnap.data().status !== 'ACCEPTED') throw new HttpError(409, 'offer-not-payable', 'Cette offre ne peut plus être payée.');
        if (offerSnap.data().paymentOrderId) throw new HttpError(409, 'payment-already-created', 'Un paiement existe déjà pour cette offre.');
        lockedOfferRef = offerRef;
      }
      const refs = items.filter((item) => item.available !== false).map((item) => db.collection('healthPharmacyProducts').doc(String(item.productId || '')));
      const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));
      const byId = new Map(snaps.map((snap) => [snap.id, snap]));
      lockedItems = [];
      lockedSubtotal = refreshCatalogPricing ? 0 : lockedSubtotal;
      for (const item of items) {
        if (item.available === false) {
          lockedItems.push({ ...item, lineTotal: 0 });
          continue;
        }
        const productId = String(item.productId || '');
        const snap = byId.get(productId);
        const qty = Math.max(1, Math.floor(Number(item.qty) || 0));
        if (!snap?.exists || snap.data().pharmacyId !== pharmacyId) throw new HttpError(400, 'unknown-product', 'Un article est introuvable pour cette pharmacie.');
        const product = snap.data();
        if (kind === 'otc' && product.prescriptionRequired === true) throw new HttpError(409, 'prescription-required', `${product.name} nécessite une ordonnance.`);
        if (deliveryMethod === 'home' && product.coldChainRequired === true) throw new HttpError(409, 'cold-chain-unsupported', `${product.name} exige une chaîne du froid. Choisissez le retrait en pharmacie.`);
        if (Number(product.stock) < qty) throw new HttpError(409, 'insufficient-stock', `Stock insuffisant pour ${product.name}.`);
        const unitPrice = refreshCatalogPricing ? Math.max(0, Number(product.price) || 0) : Math.max(0, Number(item.unitPrice) || 0);
        const line = { productId, name: product.name, qty, available: true, unitPrice, lineTotal: unitPrice * qty };
        lockedItems.push(line);
        if (refreshCatalogPricing) lockedSubtotal += line.lineTotal;
        transaction.update(snap.ref, { stock: Number(product.stock) - qty, updatedAt: now });
      }
      const total = Math.round(lockedSubtotal + deliveryFee);
      if (total <= 0) throw new HttpError(400, 'invalid-total', 'Montant invalide.');
      if (lockedOfferRef) transaction.set(lockedOfferRef, { paymentOrderId: orderRef.id, paymentStartedAt: now }, { merge: true });
      transaction.set(orderRef, {
        patientUid, pharmacyId, kind, prescriptionId: prescriptionId || null, offerId: offerId || null,
        items: lockedItems, subtotal: lockedSubtotal, deliveryFee, total, currency: HEALTH_CURRENCY,
        deliveryMethod, address: address || null, status: 'PAYMENT_PENDING', paymentSessionId: sessionRef.id,
        stockReservationStatus: 'HELD', reservationExpiresAt, createdAt: now, updatedAt: now
      });
      transaction.set(sessionRef, { orderId: orderRef.id, patientUid, amount: total, currency: HEALTH_CURRENCY, status: 'creating_redirect', createdAt: now, updatedAt: now });
    });
    const total = Math.round(lockedSubtotal + deliveryFee);
    try {
      const redirect = await createMoncashRedirect(orderRef.id, total);
      await sessionRef.set({ status: 'redirect_ready', moncash: { orderId: orderRef.id }, paymentToken: redirect.paymentToken, checkoutUrl: redirect.checkoutUrl, updatedAt: new Date().toISOString() }, { merge: true });
      return { orderId: orderRef.id, sessionId: sessionRef.id, total, checkoutUrl: redirect.checkoutUrl };
    } catch (error) {
      await releaseStockReservation(orderRef.id, 'PAYMENT_SETUP_FAILED');
      throw error;
    }
  }

  async function releaseStockReservation(orderId, terminalStatus = 'CANCELLED') {
    const orderRef = db.collection('healthOrders').doc(orderId);
    await db.runTransaction(async (transaction) => {
      const orderSnap = await transaction.get(orderRef);
      if (!orderSnap.exists || orderSnap.data().stockReservationStatus !== 'HELD') return;
      const order = orderSnap.data();
      const refs = (order.items || []).filter((item) => item.available !== false).map((item) => db.collection('healthPharmacyProducts').doc(String(item.productId || '')));
      const snaps = await Promise.all(refs.map((ref) => transaction.get(ref)));
      snaps.forEach((snap, index) => {
        if (!snap.exists) return;
        transaction.update(snap.ref, { stock: Number(snap.data().stock || 0) + Math.max(1, Number(order.items.filter((i) => i.available !== false)[index]?.qty) || 1), updatedAt: new Date().toISOString() });
      });
      transaction.update(orderRef, { status: terminalStatus, stockReservationStatus: 'RELEASED', updatedAt: new Date().toISOString() });
      if (order.paymentSessionId) transaction.set(db.collection('healthPaymentSessions').doc(order.paymentSessionId), { status: 'cancelled', updatedAt: new Date().toISOString() }, { merge: true });
      if (order.offerId) transaction.set(db.collection('healthPrescriptionOffers').doc(order.offerId), { paymentOrderId: null, paymentStartedAt: null, updatedAt: new Date().toISOString() }, { merge: true });
    });
  }

  /** Patient: direct purchase of OTC (non-prescription) medicines from one pharmacy. */
  const healthCreateOtcOrder = onRequest({ region, secrets: moncashSecrets }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decoded = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    await enforceRateLimit(decoded.uid, 'create-order', { limit: 10, windowMs: 300_000 });
    const body = parseBody(req);
    const pharmacyId = sanitizeText(body.pharmacyId, 200);
    const requestedItems = Array.isArray(body.items) ? body.items : [];
    const deliveryMethod = body.deliveryMethod === 'home' ? 'home' : 'pickup';
    const address = deliveryMethod === 'home' && body.address && typeof body.address === 'object' ? {
      address: sanitizeText(body.address.address, 300),
      department: sanitizeText(body.address.department, 100),
      commune: sanitizeText(body.address.commune, 100),
      phone: sanitizeText(body.address.phone, 40)
    } : null;

    if (!pharmacyId || !requestedItems.length) throw new HttpError(400, 'invalid-request', 'Pharmacie et articles requis.');
    if (deliveryMethod === 'home' && (!address || !address.address || !address.department || !address.commune)) {
      throw new HttpError(400, 'address-required', 'Adresse de livraison requise.');
    }

    const pharmacyProfile = await getClientProfile(pharmacyId);
    if (!pharmacyProfile || pharmacyProfile.role !== 'pharmacy' || pharmacyProfile.pharmacyStatus !== 'verified') {
      throw new HttpError(403, 'pharmacy-not-verified', "Cette pharmacie n'est pas disponible.");
    }

    const orderItems = requestedItems.map((item) => ({ productId: sanitizeText(item?.productId, 200), qty: Math.max(1, Math.floor(Number(item?.qty) || 0)), available: true }));

    const deliveryFee = deliveryMethod === 'home' ? Math.max(0, Number(pharmacyProfile.pharmacyProfile?.homeDeliveryFee) || 0) : 0;
    const session = await createHealthPaymentSession({
      patientUid: decoded.uid, pharmacyId, kind: 'otc', items: orderItems, subtotal: 0, deliveryFee, deliveryMethod, address, refreshCatalogPricing: true
    });

    await logAudit(decoded.uid, 'health_order_created', `healthOrders/${session.orderId}`, { kind: 'otc', pharmacyId });
    res.status(200).json({ ok: true, ...session });
  }));

  /** Patient: pay for a prescription offer they already accepted. */
  const healthCreatePrescriptionOrderPayment = onRequest({ region, secrets: moncashSecrets }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decoded = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    await enforceRateLimit(decoded.uid, 'create-order', { limit: 10, windowMs: 300_000 });
    const body = parseBody(req);
    const offerId = sanitizeText(body.offerId, 200);
    const deliveryMethod = body.deliveryMethod === 'home' ? 'home' : 'pickup';
    const address = deliveryMethod === 'home' && body.address && typeof body.address === 'object' ? {
      address: sanitizeText(body.address.address, 300),
      department: sanitizeText(body.address.department, 100),
      commune: sanitizeText(body.address.commune, 100),
      phone: sanitizeText(body.address.phone, 40)
    } : null;

    const offerSnap = await db.collection('healthPrescriptionOffers').doc(offerId).get();
    if (!offerSnap.exists) throw new HttpError(404, 'offer-not-found', 'Offre introuvable.');
    const offer = offerSnap.data();
    if (offer.status !== 'ACCEPTED') throw new HttpError(409, 'offer-not-accepted', "Cette offre n'a pas été confirmée.");

    const prescriptionSnap = await db.collection('healthPrescriptions').doc(offer.prescriptionId).get();
    if (!prescriptionSnap.exists || prescriptionSnap.data().patientUid !== decoded.uid) {
      throw new HttpError(403, 'not-your-prescription', "Cette ordonnance ne vous appartient pas.");
    }
    if (deliveryMethod === 'home' && (!address || !address.address || !address.department || !address.commune)) {
      throw new HttpError(400, 'address-required', 'Adresse de livraison requise.');
    }

    const session = await createHealthPaymentSession({
      patientUid: decoded.uid,
      pharmacyId: offer.pharmacyId,
      kind: 'prescription',
      prescriptionId: offer.prescriptionId,
      offerId,
      items: offer.items,
      subtotal: offer.subtotal, // recomputed and locked server-side back in healthSubmitPrescriptionOffer — never re-read from the client here
      deliveryFee: offer.deliveryFee || 0,
      deliveryMethod,
      address
    });

    await db.collection('healthPrescriptions').doc(offer.prescriptionId).set({ status: 'PAYMENT_PENDING', updatedAt: new Date().toISOString() }, { merge: true });
    await logAudit(decoded.uid, 'health_order_created', `healthOrders/${session.orderId}`, { kind: 'prescription', prescriptionId: offer.prescriptionId });
    res.status(200).json({ ok: true, ...session });
  }));

  /** Called by /health/payment-return.html — resolves the real MonCash status and syncs it. */
  const healthCheckPaymentStatus = onRequest({ region, secrets: moncashSecrets }, withErrorHandling(async (req, res) => {
    const decoded = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const query = req.method === 'GET' ? req.query : parseBody(req);
    const sessionId = sanitizeText(query.sessionId, 200);
    const orderId = sanitizeText(query.orderId, 200);
    const transactionId = sanitizeText(query.transactionId, 200);
    if (!sessionId && !orderId && !transactionId) {
      throw new HttpError(400, 'reference-required', 'Référence de paiement requise.');
    }

    let sessionRef = null;
    let sessionSnap = null;
    if (sessionId) {
      sessionRef = db.collection('healthPaymentSessions').doc(sessionId);
      sessionSnap = await sessionRef.get();
    }
    if (!sessionSnap?.exists && orderId) {
      const bySession = await db.collection('healthPaymentSessions').where('orderId', '==', orderId).limit(1).get();
      if (!bySession.empty) {
        sessionSnap = bySession.docs[0];
        sessionRef = sessionSnap.ref;
      }
    }
    if (!sessionSnap?.exists) throw new HttpError(404, 'session-not-found', 'Session de paiement introuvable.');

    const session = sessionSnap.data();
    const accessOrderSnap = await db.collection('healthOrders').doc(session.orderId).get();
    const accessOrder = accessOrderSnap.data() || {};
    if (session.patientUid !== decoded.uid && accessOrder.pharmacyId !== decoded.uid && !(await isCallerAdmin(decoded.uid))) {
      throw new HttpError(403, 'forbidden', 'Accès refusé à ce paiement.');
    }
    if (session.status === 'paid') {
      const orderSnap = await db.collection('healthOrders').doc(session.orderId).get();
      if (orderSnap.exists) await creditHealthLedgerIfApplicable(orderSnap.id, orderSnap.data());
      res.status(200).json({ ok: true, status: 'paid', amount: session.amount, orderId: session.orderId, order: orderSnap.exists ? { id: orderSnap.id, ...orderSnap.data() } : null });
      return;
    }

    const details = await retrieveMoncashPayment({ orderId: session.orderId, transactionId });
    const paid = Boolean(details.ok) && Math.round(Number(details.amount) || 0) === Math.round(Number(session.amount) || 0);
    const now = new Date().toISOString();

    if (paid) {
      const orderRef = db.collection('healthOrders').doc(session.orderId);
      await db.runTransaction(async (transaction) => {
        const freshSession = await transaction.get(sessionRef);
        if (freshSession.data()?.status === 'paid') return; // already processed — avoid double side-effects on a retry
        transaction.set(sessionRef, { status: 'paid', providerTransactionId: details.transactionId || null, updatedAt: now, paidAt: now }, { merge: true });
        transaction.set(orderRef, { status: 'PAID', stockReservationStatus: 'CAPTURED', updatedAt: now, paidAt: now }, { merge: true });
      });
      const orderSnap = await orderRef.get();
      const order = orderSnap.data();
      await creditHealthLedgerIfApplicable(orderSnap.id, order);
      if (order?.prescriptionId) {
        await db.collection('healthPrescriptions').doc(order.prescriptionId).set({ status: 'PAID', updatedAt: now }, { merge: true });
      }
      if (order?.appointmentId) {
    await db.collection('healthAppointments').doc(order.appointmentId).set({ status: 'CONFIRMED', paymentStatus: 'PAYÉ', paidAt: now, updatedAt: now }, { merge: true });
      }
      const professionalUid = order?.pharmacyId || order?.providerUid;
      // Real-time desktop push (existing generic notificationBroadcasts consumer in
      // notification.js expects target/targetUid — earlier code here wrote
      // audience/pharmacyId/providerUid instead, which that consumer never recognizes;
      // this is the fix) plus a persistent in-app notification for the professional.
      await db.collection('notificationBroadcasts').add({
        title: order?.appointmentId ? 'Nouvelle consultation payée' : 'Nouvelle commande Smart Cut Health',
        body: order?.appointmentId ? 'Un patient a payé son rendez-vous.' : 'Une commande pharmacie vient d’être payée et attend préparation.',
        type: 'health_payment',
        target: 'user',
        targetUid: professionalUid || null,
        url: order?.appointmentId ? './health-doctor.html' : './health-professionnel.html',
        createdBy: 'health',
        createdAt: now
      });
      await notifyUser(db, professionalUid, order?.appointmentId ? 'new_teleconsultation' : 'pharmacy_order', {
        title: order?.appointmentId ? 'Nouvelle demande de consultation' : 'Nouvelle commande reçue',
        body: order?.appointmentId ? 'Un patient a payé son rendez-vous et attend votre réponse.' : 'Une commande vient d’être payée et attend préparation.',
        url: order?.appointmentId ? './health-doctor.html' : './health-professionnel.html',
        context: { orderId: session.orderId }
      });
      await notifyUser(db, order?.patientUid, 'payment_confirmed', {
        title: 'Paiement confirmé',
        body: order?.appointmentId ? 'Votre rendez-vous est confirmé.' : 'Votre commande a été payée avec succès.',
        url: order?.appointmentId ? './health-espace.html' : './health-espace.html?tab=orders',
        context: { orderId: session.orderId }
      });
      await logAudit(order?.patientUid || 'unknown', 'health_order_paid', `healthOrders/${session.orderId}`, {});
      res.status(200).json({ ok: true, status: 'paid', amount: session.amount, orderId: session.orderId, order: { id: orderSnap.id, ...order } });
      return;
    }

    const status = String(details.message || '').toLowerCase().includes('fail') ? 'failed' : 'pending';
    if (status === 'failed') {
      await releaseStockReservation(session.orderId, 'PAYMENT_FAILED');
      if (accessOrder.appointmentId) {
        const appointmentRef = db.collection('healthAppointments').doc(accessOrder.appointmentId);
        const appointmentSnap = await appointmentRef.get();
        if (appointmentSnap.exists && appointmentSnap.data().status === 'PAYMENT_PENDING') {
          const batch = db.batch();
          batch.set(appointmentRef, { status: 'CANCELLED', cancellationReason: 'PAYMENT_FAILED', updatedAt: new Date().toISOString() }, { merge: true });
          batch.set(db.collection('healthAvailabilitySlots').doc(appointmentSnap.data().slotId), { status: 'AVAILABLE', appointmentId: null, updatedAt: new Date().toISOString() }, { merge: true });
          await batch.commit();
        }
      }
    }
    res.status(200).json({ ok: true, status, amount: session.amount, orderId: session.orderId });
  }));

  /** Pharmacy (owner) or admin: advance an order's fulfillment status. */
  const healthUpdateOrderFulfillment = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decoded = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const body = parseBody(req);
    const orderId = sanitizeText(body.orderId, 200);
    const nextStatus = sanitizeText(body.status, 40).toUpperCase();
    const deliveryProof = nextStatus === 'DELIVERED' ? {
      deliveredAt: new Date().toISOString(),
      deliveredByUid: decoded.uid,
      recipientConfirmation: sanitizeText(body.recipientConfirmation, 100),
      proofReference: sanitizeText(body.proofReference, 120)
    } : {};

    const ref = db.collection('healthOrders').doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'order-not-found', 'Commande introuvable.');
    const order = snap.data();

    const admin_ = await isCallerAdmin(decoded.uid);
    if (!admin_ && order.pharmacyId !== decoded.uid) {
      throw new HttpError(403, 'not-your-order', "Cette commande ne vous appartient pas.");
    }
    if (!canTransitionOrder(order.status, nextStatus)) {
      throw new HttpError(409, 'invalid-transition', `Impossible de passer de ${order.status} à ${nextStatus}.`);
    }

    const now = new Date().toISOString();
    // A pharmacy always *requests* CANCELLED (one button either way) — but the status
    // actually stored is REFUNDED whenever payment had already been captured
    // (order.status past PAYMENT_PENDING), keeping "Annulée" (never charged) and
    // "Remboursée" (charged, then refunded) as the distinct terminal states the
    // pharmacy dashboard needs to show separately.
    const isRefusalAfterPayment = nextStatus === 'CANCELLED' && order.status !== 'PAYMENT_PENDING';
    const storedStatus = isRefusalAfterPayment ? 'REFUNDED' : nextStatus;
    await ref.set({ status: storedStatus, updatedAt: now, ...deliveryProof }, { merge: true });
    if (order.prescriptionId && canTransitionPrescription(order.status, storedStatus)) {
      // Mirror the same status onto the prescription when it's meaningful there too
      // (PREPARING/READY/DELIVERING/DELIVERED all exist on both enums with the same name).
      await db.collection('healthPrescriptions').doc(order.prescriptionId).set({ status: storedStatus, updatedAt: now }, { merge: true }).catch(() => {});
    }
    if (isRefusalAfterPayment) {
      await creditPatientWallet(db, order.patientUid, Number(order.total) || 0, 'order_cancelled', { orderId });
    }
    await notifyUser(db, order.patientUid, isRefusalAfterPayment ? 'order_cancelled' : 'order_status_changed', {
      title: isRefusalAfterPayment ? 'Commande annulée' : 'Commande mise à jour',
      body: isRefusalAfterPayment ? 'Votre commande a été annulée et remboursée dans votre portefeuille.' : `Votre commande est maintenant : ${storedStatus.toLowerCase()}.`,
      url: './health-espace.html?tab=orders', context: { orderId }
    });
    await logAudit(decoded.uid, 'health_order_fulfillment_updated', `healthOrders/${orderId}`, { nextStatus: storedStatus });
    res.status(200).json({ ok: true, status: storedStatus });
  }));

  const healthReleaseExpiredReservations = onSchedule({ region, schedule: 'every 15 minutes', timeZone: 'America/Port-au-Prince' }, async () => {
    const now = new Date().toISOString();
    const snap = await db.collection('healthOrders').where('stockReservationStatus', '==', 'HELD').where('reservationExpiresAt', '<=', now).limit(100).get();
    await Promise.all(snap.docs.map((doc) => releaseStockReservation(doc.id, 'PAYMENT_EXPIRED')));
    logger.info('health expired stock reservations released', { count: snap.size });
  });

  return {
    healthListVerifiedPharmacies,
    healthSearchMedicines,
    healthListAvailableMedicines,
    healthGetMedicineFormOptions,
    healthSaveMedicine,
    healthDeleteMedicine,
    healthSubmitPrescription,
    healthReviewPrescription,
    healthSubmitPrescriptionOffer,
    healthAcceptPrescriptionOffer,
    healthCreateOtcOrder,
    healthCreatePrescriptionOrderPayment,
    healthCheckPaymentStatus,
    healthUpdateOrderFulfillment,
    healthReleaseExpiredReservations,
    ...require('./clinical')(sstInternals),
    ...require('./profile')(sstInternals)
  };
}

module.exports = buildHealth;
