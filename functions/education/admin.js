'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { HttpError, requireBearerUser, withErrorHandling } = require('../smartsolutiontek/auth');

const text = (value, max = 1000) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const serialize = (value) => {
  if (!value || typeof value !== 'object') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serialize(item)]));
};

module.exports = function buildEducationAdminFunctions(sstInternals) {
  const { db, admin, REGION, isAdminUser } = sstInternals;
  const stamp = () => admin.firestore.FieldValue.serverTimestamp();

  async function requireAdmin(req) {
    const user = await requireBearerUser(req, sstInternals);
    if (!(await isAdminUser(user.uid))) throw new HttpError(403, 'admin-required', 'Accès administrateur requis.');
    return user;
  }

  async function listCollection(name, limit = 200) {
    const snapshot = await db.collection(name).limit(limit).get();
    return snapshot.docs.map((doc) => serialize({ id: doc.id, ...doc.data() }));
  }

  const getAdminDashboard = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    await requireAdmin(req);
    const [schools, programs, tutorProfiles, tutorServices, publicationRequests, certificates, documents] = await Promise.all([
      listCollection('educationSchools'),
      listCollection('educationPrograms'),
      listCollection('educationTutorProfiles'),
      listCollection('educationTutorServices'),
      listCollection('educationPublicationRequests'),
      listCollection('educationCertificates'),
      listCollection('educationDocuments')
    ]);
    const pendingPrograms = programs.filter((item) => ['review', 'submitted', 'pending_review'].includes(item.publicationStatus));
    const pendingTutors = tutorProfiles.filter((item) => ['review', 'submitted', 'pending_review'].includes(item.publicationStatus) || item.verificationStatus === 'pending');
    const pendingServices = tutorServices.filter((item) => ['review', 'submitted', 'pending_review'].includes(item.publicationStatus));
    res.status(200).json({ ok: true, metrics: { schools: schools.length, activePrograms: programs.filter((item) => item.publicationStatus === 'published').length, activeTutors: tutorProfiles.filter((item) => item.publicationStatus === 'published').length, activeTutorServices: tutorServices.filter((item) => item.publicationStatus === 'published').length, pendingRequests: publicationRequests.filter((item) => ['submitted', 'review', 'changes_requested'].includes(item.status)).length, pendingCertificates: certificates.filter((item) => item.status === 'requested').length, pendingDocuments: documents.filter((item) => ['submitted','changes_requested'].includes(item.status)).length }, queues: { programs: pendingPrograms, tutors: pendingTutors, tutorServices: pendingServices, publicationRequests: publicationRequests.filter((item) => ['submitted', 'review', 'changes_requested'].includes(item.status)), certificates: certificates.filter((item) => item.status === 'requested'), documents: documents.filter((item) => ['submitted','changes_requested'].includes(item.status)) }, schools, programs, tutorProfiles, tutorServices, publicationRequests, certificates, documents });
  }));

  async function review(req, res, { collection, idField, approvedStatus = 'published' }) {
    const reviewer = await requireAdmin(req);
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const id = text(req.body?.[idField], 160);
    const decision = text(req.body?.decision, 30);
    const reason = text(req.body?.reason, 1200);
    if (!id) throw new HttpError(400, 'resource-id-required', 'Identifiant requis.');
    if (!['approve', 'reject', 'changes', 'suspend'].includes(decision)) throw new HttpError(400, 'invalid-decision', 'Décision invalide.');
    if (['reject', 'changes', 'suspend'].includes(decision) && !reason) throw new HttpError(400, 'reason-required', 'Un motif est obligatoire pour cette décision.');
    const ref = db.collection(collection).doc(id);
    const snapshot = await ref.get();
    if (!snapshot.exists) throw new HttpError(404, 'resource-not-found', 'Ressource introuvable.');
    const status = decision === 'approve' ? approvedStatus : decision === 'changes' ? 'changes_requested' : decision === 'suspend' ? 'suspended' : 'rejected';
    await ref.set({ publicationStatus: status, verificationStatus: decision === 'approve' ? 'verified' : decision === 'reject' ? 'rejected' : 'pending', moderation: { decision, reason: reason || null, reviewerUid: reviewer.uid, reviewedAt: stamp() }, updatedAt: stamp(), ...(decision === 'approve' ? { publishedAt: stamp() } : {}) }, { merge: true });
    const requestSnapshot = await db.collection('educationPublicationRequests').where('resourceId', '==', id).where('status', 'in', ['submitted', 'review', 'changes_requested']).limit(1).get();
    if (!requestSnapshot.empty) await requestSnapshot.docs[0].ref.set({ status: decision === 'approve' ? 'approved' : decision === 'changes' ? 'changes_requested' : decision === 'suspend' ? 'suspended' : 'rejected', decision, reason: reason || null, reviewedBy: reviewer.uid, reviewedAt: stamp(), updatedAt: stamp() }, { merge: true });
    await db.collection('educationAuditLogs').add({ actorUid: reviewer.uid, action: `admin.${collection}.${decision}`, resourceId: id, reason: reason || null, createdAt: stamp() });
    const ownerUid = snapshot.data().ownerUid || (collection === 'educationTutorProfiles' ? id : null);
    if (ownerUid) await db.collection('educationNotifications').add({ recipientUid: ownerUid, type: `publication_${decision}`, resourceType: collection, resourceId: id, title: decision === 'approve' ? 'Publication approuvée' : decision === 'changes' ? 'Corrections demandées' : decision === 'suspend' ? 'Publication suspendue' : 'Publication refusée', message: reason || null, read: false, createdAt: stamp() });
    res.status(200).json({ ok: true, id, status, decision });
  }

  const reviewProgram = onRequest({ region: REGION }, withErrorHandling((req, res) => review(req, res, { collection: 'educationPrograms', idField: 'programId' })));
  const reviewTutorProfile = onRequest({ region: REGION }, withErrorHandling((req, res) => review(req, res, { collection: 'educationTutorProfiles', idField: 'tutorId' })));
  const reviewTutorService = onRequest({ region: REGION }, withErrorHandling((req, res) => review(req, res, { collection: 'educationTutorServices', idField: 'serviceId' })));

  return { educationGetAdminDashboard: getAdminDashboard, educationReviewProgram: reviewProgram, educationReviewTutorProfile: reviewTutorProfile, educationReviewTutorService: reviewTutorService };
};
