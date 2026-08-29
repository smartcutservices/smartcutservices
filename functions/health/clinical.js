'use strict';

/**
 * Smart Cut Health clinical extensions (doctors, appointments, laboratories).
 * All mutations are server-authorized. Public endpoints only expose deliberately
 * public professional/catalog fields; medical documents are returned through a
 * short-lived signed URL after an explicit authorization check and audit entry.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { HttpError, requireBearerUser, withErrorHandling } = require('../smartsolutiontek/auth');
const { sanitizeText } = require('./lib/validation');
const { resolveConsultationSelection, publicConsultationCatalog } = require('./teleconsultation-config');

const APPLICATION_COLLECTIONS = {
  pharmacy: 'pharmacyApplications',
  doctor: 'healthDoctorApplications',
  laboratory: 'healthLabApplications'
};
const STATUS_FIELDS = {
  pharmacy: 'pharmacyStatus',
  doctor: 'doctorStatus',
  laboratory: 'labStatus'
};
const PROFILE_FIELDS = {
  pharmacy: 'pharmacyProfile',
  doctor: 'doctorProfile',
  laboratory: 'labProfile'
};

function buildClinical(sstInternals) {
  const { db, admin, REGION: region, verifyBearerUser: verifyBearer, createMoncashRedirect,
    MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY } = sstInternals;
  const moncashSecrets = [MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY];

  const parseBody = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
  const nowIso = () => new Date().toISOString();
  const isAdmin = async (uid) => Boolean(await sstInternals.isAdminUser?.(uid));

  async function audit(actorUid, action, resource, context = {}) {
    try {
      await db.collection('healthAuditLogs').add({ actorUid, action, resource, context, createdAt: nowIso() });
    } catch (error) {
      logger.error('health clinical audit failed', { action, resource, message: error?.message });
    }
  }

  async function enforceRateLimit(uid, action, { limit = 10, windowMs = 60_000 } = {}) {
    const bucket = Math.floor(Date.now() / windowMs);
    const key = `${uid}_${action}_${bucket}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    const ref = db.collection('healthRateLimits').doc(key);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const count = Number(snap.data()?.count || 0);
      if (count >= limit) throw new HttpError(429, 'rate-limited', 'Trop de tentatives. Réessayez dans un instant.');
      tx.set(ref, { uid, action, bucket, count: count + 1, expiresAt: new Date((bucket + 2) * windowMs).toISOString() }, { merge: true });
    });
  }

  async function requireVerified(uid, type) {
    const snap = await db.collection('clients').doc(uid).get();
    const data = snap.data() || {};
    if (!snap.exists || data.role !== type || String(data[STATUS_FIELDS[type]] || '').toLowerCase() !== 'verified') {
      throw new HttpError(403, 'professional-not-verified', 'Ce compte professionnel n’est pas vérifié.');
    }
    return data;
  }

  const healthApplyProfessional = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const body = parseBody(req);
    const type = sanitizeText(body.type, 30).toLowerCase();
    if (!APPLICATION_COLLECTIONS[type]) throw new HttpError(400, 'invalid-professional-type', 'Type professionnel invalide.');

    const action = sanitizeText(body.action, 20).toLowerCase() === 'draft' ? 'draft' : 'submit';
    await enforceRateLimit(user.uid, `professional-application-${action}`, { limit: action === 'draft' ? 120 : 3, windowMs: 3_600_000 });
    const profile = {
      businessName: sanitizeText(body.businessName, 180),
      responsibleName: sanitizeText(body.responsibleName, 180),
      professionalName: sanitizeText(body.professionalName, 180),
      specialty: sanitizeText(body.specialty, 120),
      facility: sanitizeText(body.facility, 180),
      address: sanitizeText(body.address, 300),
      department: sanitizeText(body.department, 100),
      commune: sanitizeText(body.commune, 100),
      phone: sanitizeText(body.phone, 40),
      phones: Array.isArray(body.phones) ? body.phones.map((v) => sanitizeText(v, 40)).filter(Boolean).slice(0, 4) : [],
      email: sanitizeText(body.email, 180),
      nif: sanitizeText(body.nif, 80),
      licenseNumber: sanitizeText(body.licenseNumber, 120),
      authorizationNumber: sanitizeText(body.authorizationNumber, 120),
      issuingAuthority: sanitizeText(body.issuingAuthority, 160),
      issueDate: sanitizeText(body.issueDate, 30),
      expiryDate: sanitizeText(body.expiryDate, 30),
      category: sanitizeText(body.category, 100),
      languages: Array.isArray(body.languages) ? body.languages.map((v) => sanitizeText(v, 40)).filter(Boolean).slice(0, 8) : [],
      experienceYears: Math.max(0, Number(body.experienceYears) || 0),
      indicativeFee: Math.max(0, Number(body.indicativeFee) || 0),
      services: body.services && typeof body.services === 'object' ? body.services : {},
      operations: body.operations && typeof body.operations === 'object' ? body.operations : {},
      declarations: body.declarations && typeof body.declarations === 'object' ? body.declarations : {},
      details: body.details && typeof body.details === 'object' ? body.details : {},
      documentPaths: Array.isArray(body.documentPaths) ? body.documentPaths.map((v) => sanitizeText(v, 500)).filter(Boolean).slice(0, 20) : [],
      documentMetadata: Array.isArray(body.documentMetadata) ? body.documentMetadata.map((item) => ({
        type: sanitizeText(item?.type, 80), path: sanitizeText(item?.path, 500), fileName: sanitizeText(item?.fileName, 180),
        issueDate: sanitizeText(item?.issueDate, 30), expiryDate: sanitizeText(item?.expiryDate, 30), status: 'unverified'
      })).filter((item) => item.type && item.path).slice(0, 20) : []
    };
    if (action === 'submit' && (!(profile.businessName || profile.professionalName) || !profile.phone || !profile.address || !profile.email || !profile.nif)) {
      throw new HttpError(400, 'required-fields-missing', 'Nom, téléphone, e-mail, NIF et adresse sont requis.');
    }
    if (action === 'submit' && profile.documentPaths.length === 0) {
      throw new HttpError(400, 'documents-required', 'Ajoutez les pièces justificatives obligatoires avant la soumission.');
    }
    const statusField = STATUS_FIELDS[type];
    const profileField = PROFILE_FIELDS[type];
    const applicationRef = db.collection(APPLICATION_COLLECTIONS[type]).doc(user.uid);
    const existing = await applicationRef.get();
    if (existing.exists && String(existing.data()?.status || '').toLowerCase() === 'verified') {
      throw new HttpError(409, 'already-verified', 'Ce compte est déjà vérifié.');
    }
    const now = nowIso();
    const applicationNumber = existing.data()?.applicationNumber || `SCH-${type.slice(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    const nextStatus = action === 'draft' ? 'draft' : 'submitted';
    const batch = db.batch();
    batch.set(applicationRef, { uid: user.uid, type, profile, applicationNumber, status: nextStatus, submittedAt: action === 'submit' ? now : existing.data()?.submittedAt || null, updatedAt: now, createdAt: existing.data()?.createdAt || now }, { merge: true });
    batch.set(db.collection('clients').doc(user.uid), { [profileField]: profile, [statusField]: nextStatus, healthApplicationType: type, updatedAt: now }, { merge: true });
    await batch.commit();
    await audit(user.uid, action === 'draft' ? 'professional_application_draft_saved' : 'professional_application_submitted', `${APPLICATION_COLLECTIONS[type]}/${user.uid}`, { type, applicationNumber });
    res.status(200).json({ ok: true, status: nextStatus, applicationNumber });
  }));

  const healthGetProfessionalApplication = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const type = sanitizeText(req.query?.type, 30).toLowerCase();
    if (type && !APPLICATION_COLLECTIONS[type]) throw new HttpError(400, 'invalid-professional-type', 'Type professionnel invalide.');
    const types = type ? [type] : Object.keys(APPLICATION_COLLECTIONS);
    for (const candidateType of types) {
      const snap = await db.collection(APPLICATION_COLLECTIONS[candidateType]).doc(user.uid).get();
      if (!snap.exists) continue;
      const data = snap.data() || {};
      res.status(200).json({ ok: true, application: { type: candidateType, status: data.status, applicationNumber: data.applicationNumber || '', profile: data.profile || {}, createdAt: data.createdAt || null, updatedAt: data.updatedAt || null, submittedAt: data.submittedAt || null, reviewReason: data.reviewReason || '' } });
      return;
    }
    res.status(200).json({ ok: true, application: null });
  }));

  const healthGetConsultationCatalog = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const catalog = publicConsultationCatalog();
    const pricing = await db.collection('healthConsultationPricing').where('active', '==', true).get();
    pricing.docs.forEach((doc) => {
      const item = catalog.specialties.find((specialty) => specialty.code === doc.id);
      const prices = doc.data()?.prices || {};
      if (item && Number.isFinite(Number(prices.essential)) && Number.isFinite(Number(prices.advanced))) {
        item.prices = { essential: Math.max(0, Number(prices.essential)), advanced: Math.max(0, Number(prices.advanced)) };
      }
    });
    res.status(200).json({ ok: true, ...catalog });
  }));

  const healthAdminSaveConsultationPricing = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    if (!(await isAdmin(user.uid))) throw new HttpError(403, 'admin-required', 'Accès administrateur requis.');
    const body = parseBody(req);
    const specialtyCode = sanitizeText(body.specialtyCode, 80);
    const essential = Number(body.essential);
    const advanced = Number(body.advanced);
    const commissionRate = body.commissionRate === undefined ? 15 : Number(body.commissionRate);
    const source = publicConsultationCatalog().specialties.find((item) => item.code === specialtyCode);
    if (!source || !Number.isFinite(essential) || !Number.isFinite(advanced) || essential < 0 || advanced < 0 || !Number.isFinite(commissionRate) || commissionRate < 0 || commissionRate > 100) {
      throw new HttpError(400, 'invalid-consultation-pricing', 'Spécialité ou tarifs invalides.');
    }
    const now = nowIso();
    await db.collection('healthConsultationPricing').doc(specialtyCode).set({ specialtyCode, prices: { essential, advanced }, commissionRate, effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom).toISOString() : now, active: body.active !== false, updatedAt: now, updatedBy: user.uid }, { merge: true });
    await db.collection('healthConsultationPriceVersions').add({ specialtyCode, prices: { essential, advanced }, commissionRate, effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom).toISOString() : now, createdAt: now, createdBy: user.uid });
    await audit(user.uid, 'health_consultation_pricing_updated', `healthConsultationPricing/${specialtyCode}`, { specialtyCode });
    res.status(200).json({ ok: true, specialtyCode, prices: { essential, advanced }, commissionRate });
  }));

  const healthListDoctors = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const q = sanitizeText(req.query?.q, 80).toLowerCase();
    const specialty = sanitizeText(req.query?.specialty, 100).toLowerCase();
    const snap = await db.collection('clients').where('role', '==', 'doctor').where('doctorStatus', '==', 'verified').limit(100).get();
    const doctors = snap.docs.map((doc) => {
      const p = doc.data().doctorProfile || {};
      return { id: doc.id, name: p.professionalName || '', specialty: p.specialty || '', facility: p.facility || '', department: p.department || '', commune: p.commune || '', indicativeFee: Number(p.indicativeFee) || 0 };
    }).filter((p) => (!q || `${p.name} ${p.specialty} ${p.facility}`.toLowerCase().includes(q)) && (!specialty || p.specialty.toLowerCase().includes(specialty)));
    res.status(200).json({ ok: true, doctors });
  }));

  const healthListLaboratories = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const snap = await db.collection('clients').where('role', '==', 'laboratory').where('labStatus', '==', 'verified').limit(100).get();
    const laboratories = snap.docs.map((doc) => {
      const p = doc.data().labProfile || {};
      return { id: doc.id, name: p.businessName || '', address: p.address || '', department: p.department || '', commune: p.commune || '', phone: p.phone || '' };
    });
    res.status(200).json({ ok: true, laboratories });
  }));

  const healthSaveAvailability = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const body = parseBody(req);
    const type = sanitizeText(body.type, 20).toLowerCase();
    if (!['doctor', 'laboratory'].includes(type)) throw new HttpError(400, 'invalid-type', 'Type invalide.');
    await requireVerified(user.uid, type);
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt >= endsAt || startsAt < new Date()) {
      throw new HttpError(400, 'invalid-slot', 'Créneau invalide.');
    }
    const id = `${user.uid}_${startsAt.toISOString()}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    await db.collection('healthAvailabilitySlots').doc(id).set({ providerUid: user.uid, providerType: type, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), status: 'AVAILABLE', updatedAt: nowIso() }, { merge: true });
    res.status(200).json({ ok: true, slotId: id });
  }));

  const healthListAvailability = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const providerUid = sanitizeText(req.query?.providerUid, 200);
    if (!providerUid) throw new HttpError(400, 'provider-required', 'Professionnel requis.');
    const snap = await db.collection('healthAvailabilitySlots').where('providerUid', '==', providerUid).where('status', '==', 'AVAILABLE').limit(60).get();
    const slots = snap.docs.map((d) => ({ id: d.id, startsAt: d.data().startsAt, endsAt: d.data().endsAt, providerType: d.data().providerType }));
    res.status(200).json({ ok: true, slots });
  }));

  const healthBookAppointment = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    await enforceRateLimit(user.uid, 'book-appointment', { limit: 8, windowMs: 300_000 });
    const body = parseBody(req);
    const slotId = sanitizeText(body.slotId, 240);
    const reason = sanitizeText(body.reason, 500);
    const examId = sanitizeText(body.examId, 200);
    const specialtyCode = sanitizeText(body.specialtyCode, 80);
    const planCode = sanitizeText(body.planCode, 40);
    const slotRef = db.collection('healthAvailabilitySlots').doc(slotId);
    const appointmentRef = db.collection('healthAppointments').doc();
    const slotBefore = await slotRef.get();
    if (!slotBefore.exists) throw new HttpError(404, 'slot-not-found', 'Créneau introuvable.');
    const providerSnap = await db.collection('clients').doc(slotBefore.data().providerUid).get();
    const provider = providerSnap.data() || {};
    const expectedStatusField = slotBefore.data().providerType === 'doctor' ? 'doctorStatus' : 'labStatus';
    if (String(provider[expectedStatusField] || '').toLowerCase() !== 'verified') throw new HttpError(403, 'provider-unavailable', 'Ce professionnel n’est plus disponible.');
    let amount = slotBefore.data().providerType === 'doctor' ? Math.max(0, Number(provider.doctorProfile?.indicativeFee) || 0) : 0;
    let consultationSelection = null;
    if (slotBefore.data().providerType === 'doctor' && (specialtyCode || planCode)) {
      consultationSelection = resolveConsultationSelection(specialtyCode, planCode);
      if (!consultationSelection) throw new HttpError(400, 'invalid-consultation-selection', 'Spécialité ou plan de consultation invalide.');
      amount = consultationSelection.price;
    }
    let examSnapshot = null;
    if (slotBefore.data().providerType === 'laboratory') {
      if (!examId) throw new HttpError(400, 'exam-required', 'Choisissez un examen.');
      examSnapshot = await db.collection('healthLabExams').doc(examId).get();
      if (!examSnapshot.exists || examSnapshot.data().laboratoryId !== slotBefore.data().providerUid || examSnapshot.data().active !== true) throw new HttpError(400, 'exam-unavailable', 'Cet examen n’est pas disponible dans ce laboratoire.');
      amount = Math.max(0, Number(examSnapshot.data().price) || 0);
    }
    await db.runTransaction(async (tx) => {
      const slotSnap = await tx.get(slotRef);
      if (!slotSnap.exists || slotSnap.data().status !== 'AVAILABLE') throw new HttpError(409, 'slot-unavailable', 'Ce créneau n’est plus disponible.');
      const slot = slotSnap.data();
      tx.update(slotRef, { status: 'BOOKED', appointmentId: appointmentRef.id, updatedAt: nowIso() });
      tx.set(appointmentRef, { patientUid: user.uid, providerUid: slot.providerUid, providerType: slot.providerType, slotId, startsAt: slot.startsAt, endsAt: slot.endsAt, reason, examId: examId || null, examName: examSnapshot?.data()?.name || null, specialtyCode: consultationSelection?.specialty.code || null, specialtyName: consultationSelection?.specialty.name || null, planCode: consultationSelection?.plan.code || null, planName: consultationSelection?.plan.name || null, consultationRights: consultationSelection ? consultationSelection.plan : null, amount, commissionRate: consultationSelection?.commissionRate ?? null, platformFee: consultationSelection?.platformFee ?? null, professionalAmount: consultationSelection?.professionalAmount ?? null, currency: 'HTG', status: amount > 0 ? 'PAYMENT_PENDING' : 'CONFIRMED', createdAt: nowIso(), updatedAt: nowIso() });
    });
    await audit(user.uid, 'appointment_booked', `healthAppointments/${appointmentRef.id}`, { slotId });
    res.status(200).json({ ok: true, appointmentId: appointmentRef.id, amount, paymentRequired: amount > 0 });
  }));

  const healthCreateAppointmentPayment = onRequest({ region, secrets: moncashSecrets }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const appointmentId = sanitizeText(parseBody(req).appointmentId, 200);
    const appointmentRef = db.collection('healthAppointments').doc(appointmentId);
    const appointmentSnap = await appointmentRef.get();
    if (!appointmentSnap.exists || appointmentSnap.data().patientUid !== user.uid) throw new HttpError(403, 'forbidden', 'Rendez-vous non autorisé.');
    const appointment = appointmentSnap.data();
    if (appointment.status !== 'PAYMENT_PENDING' || Number(appointment.amount) <= 0) throw new HttpError(409, 'payment-not-required', 'Ce rendez-vous ne nécessite pas ce paiement.');
    const existing = await db.collection('healthPaymentSessions').where('appointmentId', '==', appointmentId).limit(1).get();
    if (!existing.empty) {
      const data = existing.docs[0].data();
      res.status(200).json({ ok: true, sessionId: existing.docs[0].id, orderId: data.orderId, total: data.amount, checkoutUrl: data.checkoutUrl });
      return;
    }
    const orderRef = db.collection('healthOrders').doc();
    const sessionRef = db.collection('healthPaymentSessions').doc();
    const now = nowIso();
    await orderRef.set({ patientUid: user.uid, providerUid: appointment.providerUid, providerType: appointment.providerType, kind: 'appointment', appointmentId, specialtyCode: appointment.specialtyCode || null, specialtyName: appointment.specialtyName || null, planCode: appointment.planCode || null, planName: appointment.planName || null, consultationRights: appointment.consultationRights || null, commissionRate: appointment.commissionRate ?? null, platformFee: appointment.platformFee ?? null, professionalAmount: appointment.professionalAmount ?? null, items: [{ name: appointment.planName || appointment.examName || 'Rendez-vous santé', qty: 1, unitPrice: appointment.amount, lineTotal: appointment.amount }], subtotal: appointment.amount, deliveryFee: 0, total: appointment.amount, currency: 'HTG', status: 'PAYMENT_PENDING', paymentSessionId: sessionRef.id, createdAt: now, updatedAt: now });
    try {
      const redirect = await createMoncashRedirect(orderRef.id, appointment.amount);
      await sessionRef.set({ orderId: orderRef.id, appointmentId, patientUid: user.uid, amount: appointment.amount, currency: 'HTG', status: 'redirect_ready', checkoutUrl: redirect.checkoutUrl, paymentToken: redirect.paymentToken, createdAt: now, updatedAt: now });
      res.status(200).json({ ok: true, sessionId: sessionRef.id, orderId: orderRef.id, total: appointment.amount, checkoutUrl: redirect.checkoutUrl });
    } catch (error) {
      await orderRef.set({ status: 'PAYMENT_SETUP_FAILED', updatedAt: nowIso() }, { merge: true });
      throw error;
    }
  }));

  const healthUpdateAppointment = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const body = parseBody(req);
    const appointmentId = sanitizeText(body.appointmentId, 200);
    const next = sanitizeText(body.status, 30).toUpperCase();
    const allowed = { CONFIRMED: ['CANCELLED', 'RESCHEDULE_REQUESTED', 'COMPLETED', 'NO_SHOW'], RESCHEDULE_REQUESTED: ['CONFIRMED', 'CANCELLED'], COMPLETED: [], NO_SHOW: [], CANCELLED: [] };
    const ref = db.collection('healthAppointments').doc(appointmentId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'appointment-not-found', 'Rendez-vous introuvable.');
    const item = snap.data();
    const admin_ = await isAdmin(user.uid);
    if (!admin_ && item.patientUid !== user.uid && item.providerUid !== user.uid) throw new HttpError(403, 'forbidden', 'Accès refusé.');
    if (!allowed[item.status]?.includes(next)) throw new HttpError(409, 'invalid-transition', 'Transition de statut invalide.');
    const batch = db.batch();
    batch.update(ref, { status: next, updatedAt: nowIso() });
    if (next === 'CANCELLED') batch.update(db.collection('healthAvailabilitySlots').doc(item.slotId), { status: 'AVAILABLE', appointmentId: null, updatedAt: nowIso() });
    await batch.commit();
    await audit(user.uid, 'appointment_status_updated', `healthAppointments/${appointmentId}`, { nextStatus: next });
    res.status(200).json({ ok: true });
  }));

  // Doctor workspace: explicit accept/refuse/start/complete actions.
  const healthDoctorUpdateConsultation = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const body = parseBody(req);
    const appointmentId = sanitizeText(body.appointmentId, 200);
    const nextStatus = sanitizeText(body.status, 40).toUpperCase();
    const ref = db.collection('healthAppointments').doc(appointmentId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'appointment-not-found', 'Consultation introuvable.');
    const item = snap.data() || {};
    if (item.providerUid !== user.uid || item.providerType !== 'doctor') throw new HttpError(403, 'doctor-only', 'Cette consultation ne vous est pas attribuée.');
    const transitions = {
      CONFIRMED: ['DOCTOR_ACCEPTED', 'DOCTOR_REFUSED'],
      DOCTOR_ACCEPTED: ['IN_PROGRESS', 'PATIENT_NO_SHOW'],
      IN_PROGRESS: ['COMPLETED']
    };
    if (!transitions[item.status]?.includes(nextStatus)) throw new HttpError(409, 'invalid-transition', `Action impossible depuis ${item.status}.`);
    const now = nowIso();
    const patch = { status: nextStatus, updatedAt: now };
    if (nextStatus === 'DOCTOR_ACCEPTED') patch.acceptedAt = now;
    if (nextStatus === 'DOCTOR_REFUSED') { patch.refusedAt = now; patch.refusalReason = sanitizeText(body.reason, 300); }
    if (nextStatus === 'IN_PROGRESS') patch.startedAt = now;
    if (nextStatus === 'COMPLETED') patch.completedAt = now;
    await ref.set(patch, { merge: true });
    await audit(user.uid, 'doctor_consultation_status_updated', `healthAppointments/${appointmentId}`, { nextStatus });
    res.status(200).json({ ok: true, status: nextStatus });
  }));

  const healthSaveLabExam = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    await requireVerified(user.uid, 'laboratory');
    const body = parseBody(req);
    const name = sanitizeText(body.name, 180);
    const price = Number(body.price);
    if (!name || !Number.isFinite(price) || price < 0) throw new HttpError(400, 'invalid-exam', 'Nom et prix valides requis.');
    const id = sanitizeText(body.examId, 200);
    const ref = id ? db.collection('healthLabExams').doc(id) : db.collection('healthLabExams').doc();
    if (id) {
      const old = await ref.get();
      if (!old.exists || old.data().laboratoryId !== user.uid) throw new HttpError(404, 'exam-not-found', 'Examen introuvable.');
    }
    const examData = { laboratoryId: user.uid, name, description: sanitizeText(body.description, 500), specimen: sanitizeText(body.specimen, 100), price, active: body.active !== false, updatedAt: nowIso() };
    if (!id) examData.createdAt = nowIso();
    await ref.set(examData, { merge: true });
    res.status(200).json({ ok: true, examId: ref.id });
  }));

  const healthListLabExams = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const laboratoryId = sanitizeText(req.query?.laboratoryId, 200);
    let query = db.collection('healthLabExams').where('active', '==', true);
    if (laboratoryId) query = query.where('laboratoryId', '==', laboratoryId);
    const snap = await query.limit(100).get();
    res.status(200).json({ ok: true, exams: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  }));

  const healthUploadLabResult = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    await requireVerified(user.uid, 'laboratory');
    await enforceRateLimit(user.uid, 'upload-result', { limit: 15, windowMs: 300_000 });
    const body = parseBody(req);
    const appointmentId = sanitizeText(body.appointmentId, 200);
    const storagePath = sanitizeText(body.storagePath, 500);
    const appointment = await db.collection('healthAppointments').doc(appointmentId).get();
    if (!appointment.exists || appointment.data().providerUid !== user.uid || appointment.data().providerType !== 'laboratory') throw new HttpError(403, 'forbidden', 'Rendez-vous laboratoire non autorisé.');
    const patientUid = appointment.data().patientUid;
    const expectedPrefix = `health-lab-results/${patientUid}__${appointmentId}/`;
    if (!storagePath.startsWith(expectedPrefix)) throw new HttpError(400, 'invalid-storage-path', 'Chemin de résultat invalide.');
    const [exists] = await admin.storage().bucket().file(storagePath).exists();
    if (!exists) throw new HttpError(400, 'file-not-found', 'Fichier introuvable.');
    const ref = db.collection('healthLabResults').doc();
    await ref.set({ appointmentId, patientUid, laboratoryId: user.uid, storagePath, status: 'AVAILABLE', createdAt: nowIso() });
    await audit(user.uid, 'lab_result_uploaded', `healthLabResults/${ref.id}`, { appointmentId });
    res.status(200).json({ ok: true, resultId: ref.id });
  }));

  const healthGetPrivateDocument = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    await enforceRateLimit(user.uid, 'private-document', { limit: 30, windowMs: 60_000 });
    const type = sanitizeText(req.query?.type, 30);
    const id = sanitizeText(req.query?.id, 200);
    let path = '';
    let resource = '';
    if (type === 'prescription') {
      const snap = await db.collection('healthPrescriptions').doc(id).get();
      if (!snap.exists) throw new HttpError(404, 'not-found', 'Document introuvable.');
      const data = snap.data();
      const routed = await db.collection('healthPrescriptionRoutes').doc(`${id}_${user.uid}`).get();
      if (!(await isAdmin(user.uid)) && data.patientUid !== user.uid && !routed.exists) throw new HttpError(403, 'forbidden', 'Accès refusé.');
      path = data.storagePath;
      resource = `healthPrescriptions/${id}`;
    } else if (type === 'lab-result') {
      const snap = await db.collection('healthLabResults').doc(id).get();
      if (!snap.exists) throw new HttpError(404, 'not-found', 'Document introuvable.');
      const data = snap.data();
      if (!(await isAdmin(user.uid)) && data.patientUid !== user.uid && data.laboratoryId !== user.uid) throw new HttpError(403, 'forbidden', 'Accès refusé.');
      path = data.storagePath;
      resource = `healthLabResults/${id}`;
    } else if (type === 'application-document') {
      if (!(await isAdmin(user.uid))) throw new HttpError(403, 'admin-required', 'Accès administrateur requis.');
      const professionalType = sanitizeText(req.query?.professionalType, 30).toLowerCase();
      const applicantUid = sanitizeText(req.query?.applicantUid, 200);
      const requestedPath = sanitizeText(req.query?.path, 500);
      if (!APPLICATION_COLLECTIONS[professionalType] || !applicantUid || !requestedPath) throw new HttpError(400, 'invalid-application-document', 'Référence de document invalide.');
      const appSnap = await db.collection(APPLICATION_COLLECTIONS[professionalType]).doc(applicantUid).get();
      const paths = appSnap.data()?.profile?.documentPaths || [];
      if (!appSnap.exists || !paths.includes(requestedPath)) throw new HttpError(404, 'not-found', 'Document de candidature introuvable.');
      path = requestedPath;
      resource = `${APPLICATION_COLLECTIONS[professionalType]}/${applicantUid}`;
    } else {
      throw new HttpError(400, 'invalid-document-type', 'Type de document invalide.');
    }
    const [url] = await admin.storage().bucket().file(path).getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60_000 });
    await audit(user.uid, 'private_document_accessed', resource, { type });
    res.status(200).json({ ok: true, url, expiresInSeconds: 300 });
  }));

  const healthAdminReviewProfessional = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    if (!(await isAdmin(user.uid))) throw new HttpError(403, 'admin-required', 'Accès administrateur requis.');
    const body = parseBody(req);
    const type = sanitizeText(body.type, 30).toLowerCase();
    const uid = sanitizeText(body.uid, 200);
    const status = sanitizeText(body.status, 30).toLowerCase();
    if (!APPLICATION_COLLECTIONS[type] || !['verified', 'suspended', 'rejected', 'pending', 'submitted', 'needs_completion'].includes(status) || !uid) throw new HttpError(400, 'invalid-review', 'Décision invalide.');
    const appRef = db.collection(APPLICATION_COLLECTIONS[type]).doc(uid);
    const appSnap = await appRef.get();
    if (!appSnap.exists) throw new HttpError(404, 'application-not-found', 'Demande introuvable.');
    const now = nowIso();
    const batch = db.batch();
    batch.set(appRef, { status, reviewReason: sanitizeText(body.reason, 500), reviewedBy: user.uid, reviewedAt: now, updatedAt: now }, { merge: true });
    batch.set(db.collection('clients').doc(uid), { role: type, [STATUS_FIELDS[type]]: status, [PROFILE_FIELDS[type]]: appSnap.data().profile || {}, updatedAt: now }, { merge: true });
    await batch.commit();
    await audit(user.uid, 'professional_application_reviewed', `${APPLICATION_COLLECTIONS[type]}/${uid}`, { type, status });
    res.status(200).json({ ok: true, status });
  }));

  const healthAdminSaveCommissionRule = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    if (!(await isAdmin(user.uid))) throw new HttpError(403, 'admin-required', 'Accès administrateur requis.');
    const body = parseBody(req);
    const applicationId = sanitizeText(body.applicationId, 50);
    const type = sanitizeText(body.type, 20);
    const value = Number(body.value);
    if (!['health-pharmacy', 'health-doctor', 'health-laboratory'].includes(applicationId) || !['percentage', 'fixed'].includes(type) || !Number.isFinite(value) || value < 0) {
      throw new HttpError(400, 'invalid-commission-rule', 'Configuration de commission invalide.');
    }
    const ref = db.collection('commissionRules').doc();
    await ref.set({
      scope: 'application', applicationId, organizationId: null, type, value,
      minFee: Number.isFinite(Number(body.minFee)) ? Math.max(0, Number(body.minFee)) : null,
      maxFee: Number.isFinite(Number(body.maxFee)) ? Math.max(0, Number(body.maxFee)) : null,
      partnerShare: 0, effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom).toISOString() : nowIso(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(), createdBy: user.uid, source: 'smart-cut-health-admin'
    });
    await audit(user.uid, 'health_commission_rule_created', `commissionRules/${ref.id}`, { applicationId, type });
    res.status(200).json({ ok: true, ruleId: ref.id });
  }));

  const healthReleaseExpiredAppointments = onSchedule({ region, schedule: 'every 15 minutes', timeZone: 'America/Port-au-Prince' }, async () => {
    const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
    const snap = await db.collection('healthAppointments').where('status', '==', 'PAYMENT_PENDING').where('createdAt', '<=', cutoff).limit(100).get();
    await Promise.all(snap.docs.map((appointmentDoc) => db.runTransaction(async (tx) => {
      const fresh = await tx.get(appointmentDoc.ref);
      if (!fresh.exists || fresh.data().status !== 'PAYMENT_PENDING') return;
      tx.update(appointmentDoc.ref, { status: 'CANCELLED', cancellationReason: 'PAYMENT_EXPIRED', updatedAt: nowIso() });
      tx.update(db.collection('healthAvailabilitySlots').doc(fresh.data().slotId), { status: 'AVAILABLE', appointmentId: null, updatedAt: nowIso() });
    })));
  });

  return { healthApplyProfessional, healthGetProfessionalApplication, healthGetConsultationCatalog, healthAdminSaveConsultationPricing, healthListDoctors, healthListLaboratories, healthSaveAvailability, healthListAvailability, healthBookAppointment, healthCreateAppointmentPayment, healthUpdateAppointment, healthDoctorUpdateConsultation, healthSaveLabExam, healthListLabExams, healthUploadLabResult, healthGetPrivateDocument, healthAdminReviewProfessional, healthAdminSaveCommissionRule, healthReleaseExpiredAppointments };
}

module.exports = buildClinical;
