'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { HttpError, requireBearerUser, withErrorHandling } = require('../smartsolutiontek/auth');

const text = (value, max = 1000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const list = (value, maxItems = 20, maxLength = 100) => Array.isArray(value) ? value.map((item) => text(item, maxLength)).filter(Boolean).slice(0, maxItems) : [];
const number = (value, min, max, fallback = 0) => Math.max(min, Math.min(max, Number(value) || fallback));
const slug = (value) => text(value, 100).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

function normalizeAvailability(value) {
  if (!Array.isArray(value)) return [];
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  return value.slice(0, 21).map((slot) => ({
    day: days.includes(slot?.day) ? slot.day : '',
    start: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(slot?.start || '')) ? String(slot.start) : '',
    end: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(slot?.end || '')) ? String(slot.end) : ''
  })).filter((slot) => slot.day && slot.start && slot.end && slot.end > slot.start);
}

function profileInput(body = {}, current = {}) {
  const displayName = text(body.displayName ?? current.displayName, 120);
  const headline = text(body.headline ?? current.headline, 160);
  const bio = text(body.bio ?? current.bio, 3000);
  const subjects = list(body.subjects ?? current.subjects, 15, 80);
  return {
    displayName,
    slug: slug(body.slug ?? current.slug ?? displayName),
    headline,
    bio,
    subjects,
    categoryIds: list(body.categoryIds ?? current.categoryIds, 12, 100),
    subcategoryIds: list(body.subcategoryIds ?? current.subcategoryIds, 24, 100),
    teachingLevels: list(body.teachingLevels ?? current.teachingLevels, 8, 80),
    languages: list(body.languages ?? current.languages, 8, 60),
    experienceYears: Math.round(number(body.experienceYears ?? current.experienceYears, 0, 70)),
    education: text(body.education ?? current.education, 1200),
    city: text(body.city ?? current.city, 100),
    timezone: text(body.timezone ?? current.timezone ?? 'America/Port-au-Prince', 80),
    photoUrl: text(body.photoUrl ?? current.photoUrl, 1200) || null,
    photoPath: text(body.photoPath ?? current.photoPath, 500) || null,
    weeklyAvailability: normalizeAvailability(body.weeklyAvailability ?? current.weeklyAvailability),
    responseTimeHours: Math.round(number(body.responseTimeHours ?? current.responseTimeHours, 1, 168, 24))
  };
}

function serviceInput(body = {}, current = {}) {
  const title = text(body.title ?? current.title, 160);
  return {
    title,
    slug: slug(body.slug ?? current.slug ?? title),
    summary: text(body.summary ?? current.summary, 500),
    description: text(body.description ?? current.description, 5000),
    subject: text(body.subject ?? current.subject, 100),
    categoryId: text(body.categoryId ?? current.categoryId, 100) || null,
    subcategoryIds: list(body.subcategoryIds ?? current.subcategoryIds, 12, 100),
    level: ['primary','secondary','university','professional','all'].includes(body.level) ? body.level : (current.level || 'all'),
    language: text(body.language ?? current.language ?? 'Français', 60),
    price: Math.round(number(body.price ?? current.price, 0, 1000000)),
    durationMinutes: Math.round(number(body.durationMinutes ?? current.durationMinutes, 15, 300, 60)),
    maxStudents: Math.round(number(body.maxStudents ?? current.maxStudents, 1, 100, 1)),
    format: 'online',
    imageUrl: text(body.imageUrl ?? current.imageUrl, 1200) || null,
    imagePath: text(body.imagePath ?? current.imagePath, 500) || null,
    outcomes: list(body.outcomes ?? current.outcomes, 12, 180)
  };
}

const profileComplete = (profile) => Boolean(profile.displayName && profile.headline && profile.bio && profile.subjects?.length);
const serviceComplete = (service) => Boolean(service.title && service.summary && service.subject && service.durationMinutes >= 15 && service.price >= 0);

module.exports = function buildEducationTutorFunctions(sstInternals) {
  const { db, admin, REGION } = sstInternals;
  const stamp = () => admin.firestore.FieldValue.serverTimestamp();

  const getPublicCatalog = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    const tutorId = text(req.query?.tutorId, 160);
    const [profilesSnap, servicesSnap] = await Promise.all([
      db.collection('educationTutorProfiles').where('publicationStatus', '==', 'published').get(),
      db.collection('educationTutorServices').where('publicationStatus', '==', 'published').get()
    ]);
    let tutors = profilesSnap.docs.map((doc) => {
      const item = doc.data();
      return { id: doc.id, slug:item.slug, displayName:item.displayName, headline:item.headline, bio:item.bio, subjects:item.subjects, categoryIds:item.categoryIds, subcategoryIds:item.subcategoryIds, teachingLevels:item.teachingLevels, languages:item.languages, experienceYears:item.experienceYears, education:item.education, city:item.city, photoUrl:item.photoUrl, weeklyAvailability:item.weeklyAvailability, responseTimeHours:item.responseTimeHours, verificationStatus:item.verificationStatus, visibility:item.visibility || 'public' };
    }).filter((item) => item.visibility !== 'hidden');
    let services = servicesSnap.docs.map((doc) => {
      const item = doc.data();
      return { id:doc.id, tutorUid:item.tutorUid, tutorName:item.tutorName, title:item.title, slug:item.slug, summary:item.summary, description:item.description, subject:item.subject, categoryId:item.categoryId, subcategoryIds:item.subcategoryIds, level:item.level, language:item.language, price:item.price, durationMinutes:item.durationMinutes, maxStudents:item.maxStudents, format:item.format, imageUrl:item.imageUrl, outcomes:item.outcomes };
    });
    if (tutorId) {
      tutors = tutors.filter((item) => item.id === tutorId || item.slug === tutorId);
      const ids = new Set(tutors.map((item) => item.id));
      services = services.filter((item) => ids.has(item.tutorUid));
    }
    const serviceCount = new Map();
    services.forEach((item) => serviceCount.set(item.tutorUid, (serviceCount.get(item.tutorUid) || 0) + 1));
    tutors = tutors.map((item) => ({ ...item, serviceCount: serviceCount.get(item.id) || 0 })).filter((item) => item.serviceCount > 0);
    res.status(200).json({ ok: true, tutors, services });
  }));

  const getDashboard = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    const user = await requireBearerUser(req, sstInternals);
    const [profileSnap, servicesSnap, requestsSnap, notificationsSnap, documentsSnap] = await Promise.all([
      db.collection('educationTutorProfiles').doc(user.uid).get(),
      db.collection('educationTutorServices').where('ownerUid', '==', user.uid).get(),
      db.collection('educationTutorRequests').where('tutorUid', '==', user.uid).get(),
      db.collection('educationNotifications').where('recipientUid', '==', user.uid).limit(50).get(),
      db.collection('educationDocuments').where('ownerUid', '==', user.uid).limit(100).get()
    ]);
    const services = servicesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const requests = requestsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const notifications = notificationsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const documents = documentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json({ ok: true, profile: profileSnap.exists ? { id: profileSnap.id, ...profileSnap.data() } : null, services, requests, notifications, documents, metrics: { publishedServices: services.filter((item) => item.publicationStatus === 'published').length, pendingRequests: requests.filter((item) => item.status === 'pending').length, acceptedRequests: requests.filter((item) => item.status === 'accepted').length, completedSessions: requests.filter((item) => item.status === 'completed').length } });
  }));

  const saveProfile = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const ref = db.collection('educationTutorProfiles').doc(user.uid);
    const snap = await ref.get();
    const input = profileInput(req.body, snap.exists ? snap.data() : {});
    const requestedStatus = text(req.body?.publicationStatus, 30);
    if (requestedStatus === 'published' && !profileComplete(input)) throw new HttpError(409, 'profile-incomplete', 'Complétez votre nom, titre, présentation et matières avant publication.');
    // A partner can submit a profile, but only Smart Akademi moderation can
    // make it public. The former direct `published` path is intentionally
    // converted into a review request.
    const publicationStatus = requestedStatus === 'published' ? 'review' : (requestedStatus === 'paused' ? 'paused' : (snap.data()?.publicationStatus || 'draft'));
    const verificationStatus = requestedStatus === 'published' ? 'pending' : (snap.data()?.verificationStatus || 'unverified');
    await ref.set({ ...input, ownerUid: user.uid, publicationStatus, verificationStatus, ...(requestedStatus === 'published' ? { submittedAt: stamp() } : {}), updatedAt: stamp(), ...(snap.exists ? {} : { createdAt: stamp() }) }, { merge: true });
    if (requestedStatus === 'published') {
      const openRequest = await db.collection('educationPublicationRequests').where('ownerUid', '==', user.uid).where('resourceId', '==', user.uid).where('status', 'in', ['submitted','changes_requested']).limit(1).get();
      if (!openRequest.empty) { res.status(200).json({ ok: true, tutorId: user.uid, publicationStatus, submittedForReview: true, requestId: openRequest.docs[0].id }); return; }
      await db.collection('educationPublicationRequests').add({ resourceType: 'tutor_profile', resourceId: user.uid, ownerUid: user.uid, status: 'submitted', submittedAt: stamp(), updatedAt: stamp() });
    }
    res.status(200).json({ ok: true, tutorId: user.uid, publicationStatus, submittedForReview: requestedStatus === 'published' });
  }));

  const saveService = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const profileSnap = await db.collection('educationTutorProfiles').doc(user.uid).get();
    if (!profileSnap.exists || !profileComplete(profileSnap.data())) throw new HttpError(409, 'profile-required', 'Complétez votre profil tuteur avant de créer une offre.');
    const serviceId = text(req.body?.serviceId, 160);
    const ref = serviceId ? db.collection('educationTutorServices').doc(serviceId) : db.collection('educationTutorServices').doc();
    const snap = serviceId ? await ref.get() : null;
    if (snap && (!snap.exists || snap.data().ownerUid !== user.uid)) throw new HttpError(404, 'service-not-found', 'Offre introuvable.');
    const input = serviceInput(req.body, snap?.data() || {});
    const requestedStatus = text(req.body?.publicationStatus, 30);
    if (requestedStatus === 'published' && profileSnap.data().publicationStatus !== 'published') throw new HttpError(409, 'profile-not-published', 'Votre profil tuteur doit être approuvé avant la publication d’une offre.');
    if (requestedStatus === 'published' && !serviceComplete(input)) throw new HttpError(409, 'service-incomplete', 'Complétez le titre, le résumé, la matière, le prix et la durée.');
    const publicationStatus = requestedStatus === 'published' ? 'review' : (['draft','paused'].includes(requestedStatus) ? requestedStatus : (snap?.data()?.publicationStatus || 'draft'));
    await ref.set({ ...input, ownerUid: user.uid, tutorUid: user.uid, tutorName: profileSnap.data().displayName, publicationStatus, ...(requestedStatus === 'published' ? { submittedAt: stamp() } : {}), updatedAt: stamp(), ...(snap?.exists ? {} : { createdAt: stamp() }) }, { merge: true });
    if (requestedStatus === 'published') {
      const openRequest = await db.collection('educationPublicationRequests').where('ownerUid', '==', user.uid).where('resourceId', '==', ref.id).where('status', 'in', ['submitted','changes_requested']).limit(1).get();
      if (!openRequest.empty) { res.status(200).json({ ok: true, serviceId: ref.id, publicationStatus, submittedForReview: true, requestId: openRequest.docs[0].id }); return; }
      await db.collection('educationPublicationRequests').add({ resourceType: 'tutor_service', resourceId: ref.id, ownerUid: user.uid, status: 'submitted', submittedAt: stamp(), updatedAt: stamp() });
    }
    res.status(200).json({ ok: true, serviceId: ref.id, publicationStatus, submittedForReview: requestedStatus === 'published' });
  }));

  const archiveService = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const serviceId = text(req.body?.serviceId, 160);
    const ref = db.collection('educationTutorServices').doc(serviceId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().ownerUid !== user.uid) throw new HttpError(404, 'service-not-found', 'Offre introuvable.');
    await ref.set({ publicationStatus: 'archived', updatedAt: stamp() }, { merge: true });
    res.status(200).json({ ok: true });
  }));

  const createRequest = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const serviceId = text(req.body?.serviceId, 160);
    const serviceSnap = await db.collection('educationTutorServices').doc(serviceId).get();
    if (!serviceSnap.exists || serviceSnap.data().publicationStatus !== 'published') throw new HttpError(404, 'service-not-found', 'Cette offre n’est plus disponible.');
    if (serviceSnap.data().tutorUid === user.uid) throw new HttpError(409, 'self-request', 'Vous ne pouvez pas réserver votre propre offre.');
    const goal = text(req.body?.goal, 1000);
    if (!goal) throw new HttpError(400, 'goal-required', 'Précisez votre objectif.');
    const duplicateSnap = await db.collection('educationTutorRequests').where('studentUid', '==', user.uid).where('serviceId', '==', serviceId).get();
    if (duplicateSnap.docs.some((doc) => ['pending','accepted'].includes(doc.data().status))) throw new HttpError(409, 'request-already-open', 'Une demande est déjà en cours pour ce cours.');
    const ref = db.collection('educationTutorRequests').doc();
    await ref.set({ tutorUid: serviceSnap.data().tutorUid, serviceId, serviceTitle: serviceSnap.data().title, studentUid: user.uid, studentName: text(user.name || user.email || 'Apprenant', 120), studentEmail: text(user.email, 180), goal, preferredSlot: text(req.body?.preferredSlot, 160), status: 'pending', price: serviceSnap.data().price, durationMinutes: serviceSnap.data().durationMinutes, createdAt: stamp(), updatedAt: stamp() });
    res.status(200).json({ ok: true, requestId: ref.id });
  }));

  const updateRequest = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const requestId = text(req.body?.requestId, 160);
    const status = text(req.body?.status, 30);
    if (!['accepted','declined','completed','cancelled'].includes(status)) throw new HttpError(400, 'invalid-status', 'Statut invalide.');
    const ref = db.collection('educationTutorRequests').doc(requestId);
    const snap = await ref.get();
    if (!snap.exists || snap.data().tutorUid !== user.uid) throw new HttpError(404, 'request-not-found', 'Demande introuvable.');
    const transitions = { pending:['accepted','declined'], accepted:['completed','cancelled'] };
    if (!(transitions[snap.data().status] || []).includes(status)) throw new HttpError(409, 'invalid-transition', 'Cette demande a déjà été traitée.');
    await ref.set({ status, tutorMessage: text(req.body?.tutorMessage, 1000), meetingLink: status === 'accepted' ? text(req.body?.meetingLink, 1200) : null, updatedAt: stamp() }, { merge: true });
    res.status(200).json({ ok: true, status });
  }));

  return { educationGetTutorCatalog: getPublicCatalog, educationGetTutorDashboard: getDashboard, educationSaveTutorProfile: saveProfile, educationSaveTutorService: saveService, educationArchiveTutorService: archiveService, educationCreateTutorRequest: createRequest, educationUpdateTutorRequest: updateRequest };
};
