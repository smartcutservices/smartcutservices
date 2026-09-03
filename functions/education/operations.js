'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { HttpError, requireBearerUser, withErrorHandling } = require('../smartsolutiontek/auth');

const text = (value, max = 500) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);

module.exports = function buildEducationOperations(sstInternals) {
  const { db, admin, REGION, isAdminUser } = sstInternals;
  const stamp = () => admin.firestore.FieldValue.serverTimestamp();
  const user = (req) => requireBearerUser(req, sstInternals);

  const markNotification = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const id = text(req.body?.notificationId, 160);
    if (!id) throw new HttpError(400, 'notification-id-required', 'Notification requise.');
    const ref = db.collection('educationNotifications').doc(id); const snap = await ref.get();
    if (!snap.exists || snap.data().recipientUid !== current.uid) throw new HttpError(404, 'notification-not-found', 'Notification introuvable.');
    await ref.set({ read: true, readAt: stamp() }, { merge: true }); res.status(200).json({ ok: true });
  }));

  const markAllNotifications = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const snap = await db.collection('educationNotifications').where('recipientUid', '==', current.uid).where('read', '==', false).limit(200).get();
    const batch = db.batch(); snap.docs.forEach((doc) => batch.set(doc.ref, { read: true, readAt: stamp() }, { merge: true })); await batch.commit();
    res.status(200).json({ ok: true, updated: snap.size });
  }));

  const requestCertificate = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const enrollmentId = text(req.body?.enrollmentId, 160);
    const enrollment = await db.collection('educationEnrollments').doc(enrollmentId).get();
    if (!enrollment.exists || enrollment.data().studentUid !== current.uid) throw new HttpError(404, 'enrollment-not-found', 'Inscription introuvable.');
    const data = enrollment.data();
    if (data.status !== 'completed' && Number(data.progress || 0) < 100) throw new HttpError(409, 'course-not-complete', 'La formation doit être terminée avant la demande.');
    const existing = await db.collection('educationCertificates').where('enrollmentId', '==', enrollmentId).limit(1).get();
    if (!existing.empty) { res.status(200).json({ ok: true, certificateId: existing.docs[0].id, existing: true }); return; }
    const ref = db.collection('educationCertificates').doc();
    await ref.set({ enrollmentId, programId: data.programId || null, studentUid: current.uid, studentName: text(current.name || current.email || 'Apprenant', 160), status: 'requested', requestedAt: stamp(), createdAt: stamp(), updatedAt: stamp() });
    res.status(200).json({ ok: true, certificateId: ref.id });
  }));

  const getCertificates = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    const current = await user(req); const adminUser = await isAdminUser(current.uid);
    let query = db.collection('educationCertificates');
    if (!adminUser) query = query.where('studentUid', '==', current.uid);
    const snap = await query.limit(200).get();
    res.status(200).json({ ok: true, certificates: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  }));

  const verifyCertificate = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    const code = text(req.query?.code, 120); if (!code) throw new HttpError(400, 'verification-code-required', 'Code de vérification requis.');
    const snap = await db.collection('educationCertificates').where('verificationCode', '==', code).limit(1).get();
    if (snap.empty || snap.docs[0].data().status !== 'issued') throw new HttpError(404, 'certificate-invalid', 'Certificat introuvable ou non valide.');
    const item = snap.docs[0].data(); res.status(200).json({ ok: true, valid: true, certificate: { id: snap.docs[0].id, studentName: item.studentName || null, programId: item.programId || null, issuedAt: item.reviewedAt || item.updatedAt || null } });
  }));

  const reviewCertificate = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const reviewer = await user(req); if (!(await isAdminUser(reviewer.uid))) throw new HttpError(403, 'admin-required', 'Accès administrateur requis.');
    const id = text(req.body?.certificateId, 160); const decision = text(req.body?.decision, 30); const reason = text(req.body?.reason, 1000);
    if (!id || !['approve','reject'].includes(decision)) throw new HttpError(400, 'invalid-certificate-review', 'Certificat ou décision invalide.');
    if (decision === 'reject' && !reason) throw new HttpError(400, 'reason-required', 'Un motif est obligatoire.');
    const ref = db.collection('educationCertificates').doc(id); const snap = await ref.get();
    if (!snap.exists) throw new HttpError(404, 'certificate-not-found', 'Certificat introuvable.');
    const token = `SA-${id.slice(0, 8).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
    await ref.set({ status: decision === 'approve' ? 'issued' : 'rejected', verificationCode: decision === 'approve' ? token : null, rejectionReason: reason || null, reviewedBy: reviewer.uid, reviewedAt: stamp(), updatedAt: stamp() }, { merge: true });
    if (snap.data().studentUid) await db.collection('educationNotifications').add({ recipientUid: snap.data().studentUid, type: `certificate_${decision}`, resourceType: 'certificate', resourceId: id, title: decision === 'approve' ? 'Certificat disponible' : 'Certificat refusé', message: reason || 'Votre certificat est disponible dans votre espace.', read: false, createdAt: stamp() });
    res.status(200).json({ ok: true, certificateId: id, status: decision === 'approve' ? 'issued' : 'rejected', verificationCode: decision === 'approve' ? token : null });
  }));

  const savePartnership = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const id = text(req.body?.partnershipId, 160);
    const ref = id ? db.collection('educationPartnerships').doc(id) : db.collection('educationPartnerships').doc();
    if (id) { const snap = await ref.get(); if (!snap.exists || snap.data().ownerUid !== current.uid) throw new HttpError(404, 'partnership-not-found', 'Partenariat introuvable.'); }
    const name = text(req.body?.partnerName, 180); if (!name) throw new HttpError(400, 'partner-name-required', 'Nom du partenaire requis.');
    await ref.set({ ownerUid: current.uid, partnerName: name, type: text(req.body?.type, 60) || 'academic', description: text(req.body?.description, 2000), ...(id ? {} : { status: 'requested', createdAt: stamp() }), updatedAt: stamp() }, { merge: true });
    res.status(200).json({ ok: true, partnershipId: ref.id });
  }));

  const reviewPartnership = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const reviewer = await user(req); if (!(await isAdminUser(reviewer.uid))) throw new HttpError(403, 'admin-required', 'Accès administrateur requis.');
    const id = text(req.body?.partnershipId, 160); const status = text(req.body?.status, 30);
    if (!id || !['approved','rejected','changes_requested','suspended'].includes(status)) throw new HttpError(400, 'invalid-partnership-review', 'Partenariat ou statut invalide.');
    const ref = db.collection('educationPartnerships').doc(id); const snap = await ref.get(); if (!snap.exists) throw new HttpError(404, 'partnership-not-found', 'Partenariat introuvable.');
    await ref.set({ status, reviewReason: text(req.body?.reason, 1000) || null, reviewedBy: reviewer.uid, reviewedAt: stamp(), updatedAt: stamp() }, { merge: true });
    if (snap.data().ownerUid) await db.collection('educationNotifications').add({ recipientUid: snap.data().ownerUid, type: 'partnership_review', resourceType: 'partnership', resourceId: id, title: 'Partenariat mis à jour', message: text(req.body?.reason, 1000) || status, read: false, createdAt: stamp() });
    res.status(200).json({ ok: true, partnershipId: id, status });
  }));

  const setTutorVisibility = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const visible = req.body?.visible === true;
    const ref = db.collection('educationTutorProfiles').doc(current.uid); const snap = await ref.get();
    if (!snap.exists || snap.data().publicationStatus !== 'published') throw new HttpError(409, 'profile-not-published', 'Le profil doit être approuvé avant de modifier sa visibilité.');
    await ref.set({ visibility: visible ? 'public' : 'hidden', visibilityUpdatedAt: stamp(), updatedAt: stamp() }, { merge: true });
    res.status(200).json({ ok: true, visibility: visible ? 'public' : 'hidden' });
  }));

  const saveDocument = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const id = text(req.body?.documentId, 160); const name = text(req.body?.name, 180);
    if (!name) throw new HttpError(400, 'document-name-required', 'Nom du document requis.');
    const ref = id ? db.collection('educationDocuments').doc(id) : db.collection('educationDocuments').doc();
    if (id) { const snap = await ref.get(); if (!snap.exists || snap.data().ownerUid !== current.uid) throw new HttpError(404, 'document-not-found', 'Document introuvable.'); }
    const storagePath = text(req.body?.storagePath, 500) || null;
    if (storagePath) {
      const prefix = `education-documents/${current.uid}/`;
      if (!storagePath.startsWith(prefix)) throw new HttpError(400, 'invalid-document-path', 'Chemin de document invalide.');
      const [exists] = await admin.storage().bucket().file(storagePath).exists();
      if (!exists) throw new HttpError(404, 'document-file-not-found', 'Fichier du document introuvable.');
    }
    await ref.set({ ownerUid: current.uid, name, type: text(req.body?.type, 80) || 'other', storagePath, downloadUrl: text(req.body?.downloadUrl, 1200) || null, status: 'submitted', updatedAt: stamp(), ...(id ? {} : { createdAt: stamp() }) }, { merge: true });
    res.status(200).json({ ok: true, documentId: ref.id });
  }));

  const getDocuments = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    const current = await user(req); const snap = await db.collection('educationDocuments').where('ownerUid', '==', current.uid).limit(100).get();
    res.status(200).json({ ok: true, documents: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  }));

  const setTutorPlan = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const plan = text(req.body?.plan, 30);
    if (!['free','standard','pro'].includes(plan)) throw new HttpError(400, 'invalid-plan', 'Plan invalide.');
    const ref = db.collection('educationTutorProfiles').doc(current.uid); const snap = await ref.get(); if (!snap.exists) throw new HttpError(404, 'profile-not-found', 'Profil introuvable.');
    await ref.set({ visibilityPlan: plan, planStatus: plan === 'free' ? 'active' : 'pending_payment', planUpdatedAt: stamp(), updatedAt: stamp() }, { merge: true });
    res.status(200).json({ ok: true, visibilityPlan: plan, planStatus: plan === 'free' ? 'active' : 'pending_payment' });
  }));

  const requestTutorPlanPayment = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const plan = text(req.body?.plan, 30); const amounts = { standard: 1500, pro: 3000 };
    if (!amounts[plan]) throw new HttpError(400, 'invalid-plan', 'Plan payant invalide.');
    const open = await db.collection('educationPlanPayments').where('ownerUid', '==', current.uid).where('status', '==', 'pending').limit(1).get();
    if (!open.empty) { res.status(200).json({ ok: true, paymentId: open.docs[0].id, existing: true }); return; }
    const ref = db.collection('educationPlanPayments').doc(); await ref.set({ ownerUid: current.uid, plan, amount: amounts[plan], currency: 'HTG', status: 'pending', createdAt: stamp(), updatedAt: stamp() });
    res.status(200).json({ ok: true, paymentId: ref.id, amount: amounts[plan], currency: 'HTG', status: 'pending' });
  }));

  const confirmTutorPlanPayment = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const reviewer = await user(req); if (!(await isAdminUser(reviewer.uid))) throw new HttpError(403, 'admin-required', 'Accès administrateur requis.');
    const id = text(req.body?.paymentId, 160); const reference = text(req.body?.reference, 180); if (!id || !reference) throw new HttpError(400, 'payment-reference-required', 'Référence de paiement requise.');
    const ref = db.collection('educationPlanPayments').doc(id); const snap = await ref.get(); if (!snap.exists) throw new HttpError(404, 'payment-not-found', 'Paiement introuvable.');
    await ref.set({ status: 'paid', reference, confirmedBy: reviewer.uid, confirmedAt: stamp(), updatedAt: stamp() }, { merge: true });
    await db.collection('educationTutorProfiles').doc(snap.data().ownerUid).set({ visibilityPlan: snap.data().plan, planStatus: 'active', planPaymentId: id, updatedAt: stamp() }, { merge: true });
    res.status(200).json({ ok: true, paymentId: id, status: 'paid' });
  }));

  const reviewDocument = onRequest({ region: REGION }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const reviewer = await user(req); if (!(await isAdminUser(reviewer.uid))) throw new HttpError(403, 'admin-required', 'Accès administrateur requis.');
    const id = text(req.body?.documentId, 160); const status = text(req.body?.status, 30); const reason = text(req.body?.reason, 1000);
    if (!id || !['approved','rejected','changes_requested'].includes(status)) throw new HttpError(400, 'invalid-document-review', 'Document ou statut invalide.');
    if (status !== 'approved' && !reason) throw new HttpError(400, 'reason-required', 'Un motif est obligatoire.');
    const ref = db.collection('educationDocuments').doc(id); const snap = await ref.get(); if (!snap.exists) throw new HttpError(404, 'document-not-found', 'Document introuvable.');
    await ref.set({ status, reviewReason: reason || null, reviewedBy: reviewer.uid, reviewedAt: stamp(), updatedAt: stamp() }, { merge: true });
    if (snap.data().ownerUid) await db.collection('educationNotifications').add({ recipientUid: snap.data().ownerUid, type: 'document_review', resourceType: 'document', resourceId: id, title: status === 'approved' ? 'Document validé' : 'Document à corriger', message: reason || 'Votre document a été validé.', read: false, createdAt: stamp() });
    res.status(200).json({ ok: true, documentId: id, status });
  }));

  return { educationMarkNotificationRead: markNotification, educationMarkAllNotificationsRead: markAllNotifications, educationRequestCertificate: requestCertificate, educationGetCertificates: getCertificates, educationVerifyCertificate: verifyCertificate, educationReviewCertificate: reviewCertificate, educationSavePartnership: savePartnership, educationReviewPartnership: reviewPartnership, educationSetTutorVisibility: setTutorVisibility, educationSaveDocument: saveDocument, educationGetDocuments: getDocuments, educationSetTutorPlan: setTutorPlan, educationRequestTutorPlanPayment: requestTutorPlanPayment, educationConfirmTutorPlanPayment: confirmTutorPlanPayment, educationReviewDocument: reviewDocument };
};
