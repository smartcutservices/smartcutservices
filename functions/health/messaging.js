'use strict';

/**
 * Teleconsultation session chat (text / photo / voice), scoped to one appointment.
 * Every message carries both patientUid and providerUid so firestore.rules never needs
 * a cross-collection lookup (see healthMessages in ../../firestore.rules). Photos and
 * voice notes live in Storage under health-session-media/{patientUid}__{appointmentId}/
 * — this module only ever confirms an upload that already happened (same
 * verify-then-record pattern as healthSubmitPrescription), it never receives raw bytes
 * itself. Everything here is purged 30 days after creation (healthPurgeExpiredSessionMessages),
 * per the confidentiality requirement in the spec.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');
const { HttpError, requireBearerUser, withErrorHandling } = require('../smartsolutiontek/auth');
const { sanitizeText, sanitizeSessionMessageText, canSendSessionMedia } = require('./lib/validation');
const { notifyUser } = require('./lib/healthNotify');

const MESSAGE_RETENTION_MS = 30 * 24 * 60 * 60_000;

function buildMessaging(sstInternals) {
  const { db, admin, REGION: region, verifyBearerUser: verifyBearer, isAdminUser } = sstInternals;
  const parseBody = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
  const nowIso = () => new Date().toISOString();
  const isAdmin = async (uid) => Boolean(await isAdminUser?.(uid));

  async function requireSessionParticipant(uid, appointmentId) {
    const snap = await db.collection('healthAppointments').doc(appointmentId).get();
    if (!snap.exists) throw new HttpError(404, 'appointment-not-found', 'Consultation introuvable.');
    const item = snap.data();
    if (item.patientUid !== uid && item.providerUid !== uid) throw new HttpError(403, 'forbidden', 'Vous ne participez pas à cette séance.');
    if (!['DOCTOR_ACCEPTED', 'IN_PROGRESS'].includes(item.status)) {
      throw new HttpError(409, 'session-not-active', 'La séance n’est pas (ou plus) active.');
    }
    return item;
  }

  /** POST { appointmentId, text } — text chat message, no count limit (only length-capped). */
  const healthSendSessionMessage = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const body = parseBody(req);
    const appointmentId = sanitizeText(body.appointmentId, 200);
    const text = sanitizeSessionMessageText(body.text);
    if (!text) throw new HttpError(400, 'text-required', 'Message vide.');
    const appointment = await requireSessionParticipant(user.uid, appointmentId);

    const ref = db.collection('healthMessages').doc();
    await ref.set({
      appointmentId, patientUid: appointment.patientUid, providerUid: appointment.providerUid,
      senderUid: user.uid, kind: 'text', text, storagePath: null,
      createdAt: nowIso(), expiresAt: new Date(Date.now() + MESSAGE_RETENTION_MS).toISOString()
    });
    const recipientUid = user.uid === appointment.patientUid ? appointment.providerUid : appointment.patientUid;
    await notifyUser(db, recipientUid, 'session_message', {
      title: 'Nouveau message', body: 'Un message vous attend dans la séance.',
      url: `./health-session.html?appointment=${appointmentId}`
    });
    res.status(200).json({ ok: true, messageId: ref.id });
  }));

  /**
   * POST { appointmentId, kind: 'photo'|'voice', storagePath } — confirms a media
   * upload already sitting in Storage. Enforces the plan's per-PATIENT caps (max 2
   * photos / 2 voice notes on the Essential+Advanced plans as configured in
   * teleconsultation-config.js) — the doctor's own uploads are never capped.
   */
  const healthConfirmSessionMedia = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const body = parseBody(req);
    const appointmentId = sanitizeText(body.appointmentId, 200);
    const kind = sanitizeText(body.kind, 20).toLowerCase();
    if (!['photo', 'voice'].includes(kind)) throw new HttpError(400, 'invalid-kind', 'Type de média invalide.');
    const storagePath = sanitizeText(body.storagePath, 500);
    const appointment = await requireSessionParticipant(user.uid, appointmentId);

    const expectedPrefix = `health-session-media/${appointment.patientUid}__${appointmentId}/`;
    if (!storagePath.startsWith(expectedPrefix)) throw new HttpError(400, 'invalid-storage-path', 'Fichier invalide pour cette séance.');
    const [exists] = await admin.storage().bucket().file(storagePath).exists();
    if (!exists) throw new HttpError(400, 'file-not-found', 'Fichier introuvable.');

    if (user.uid === appointment.patientUid) {
      const plan = appointment.consultationRights || {};
      const existingSnap = await db.collection('healthMessages')
        .where('appointmentId', '==', appointmentId)
        .where('senderUid', '==', user.uid)
        .get();
      const existing = existingSnap.docs.map((d) => d.data());
      if (!canSendSessionMedia(existing, kind, plan)) {
        throw new HttpError(409, 'media-limit-reached', kind === 'photo'
          ? 'Limite de photos atteinte pour cette séance.'
          : 'Limite de messages vocaux atteinte pour cette séance.');
      }
    }

    const ref = db.collection('healthMessages').doc();
    await ref.set({
      appointmentId, patientUid: appointment.patientUid, providerUid: appointment.providerUid,
      senderUid: user.uid, kind, text: null, storagePath,
      createdAt: nowIso(), expiresAt: new Date(Date.now() + MESSAGE_RETENTION_MS).toISOString()
    });
    const recipientUid = user.uid === appointment.patientUid ? appointment.providerUid : appointment.patientUid;
    await notifyUser(db, recipientUid, 'session_message', {
      title: 'Nouveau message', body: kind === 'photo' ? 'Une photo vous attend dans la séance.' : 'Un message vocal vous attend dans la séance.',
      url: `./health-session.html?appointment=${appointmentId}`
    });
    res.status(200).json({ ok: true, messageId: ref.id });
  }));

  /** Short-lived signed URL for one message's attachment — audited, same pattern as healthGetPrivateDocument. */
  const healthGetSessionMediaUrl = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const messageId = sanitizeText(req.query?.messageId, 200);
    const snap = await db.collection('healthMessages').doc(messageId).get();
    if (!snap.exists) throw new HttpError(404, 'not-found', 'Message introuvable.');
    const data = snap.data();
    if (!(await isAdmin(user.uid)) && data.patientUid !== user.uid && data.providerUid !== user.uid) throw new HttpError(403, 'forbidden', 'Accès refusé.');
    if (!data.storagePath) throw new HttpError(400, 'not-a-media-message', 'Ce message n’a pas de pièce jointe.');
    const [url] = await admin.storage().bucket().file(data.storagePath).getSignedUrl({ action: 'read', expires: Date.now() + 5 * 60_000 });
    res.status(200).json({ ok: true, url, expiresInSeconds: 300 });
  }));

  /** Doctor session action: propose a follow-up appointment (just a targeted notification + link, no auto-booking). */
  const healthDoctorProposeFollowUp = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const body = parseBody(req);
    const appointmentId = sanitizeText(body.appointmentId, 200);
    const note = sanitizeText(body.note, 300);
    const snap = await db.collection('healthAppointments').doc(appointmentId).get();
    if (!snap.exists) throw new HttpError(404, 'appointment-not-found', 'Consultation introuvable.');
    const item = snap.data();
    if (item.providerUid !== user.uid) throw new HttpError(403, 'forbidden', 'Cette consultation ne vous est pas attribuée.');
    await notifyUser(db, item.patientUid, 'appointment_proposed', {
      title: 'Nouveau rendez-vous proposé',
      body: note || 'Votre médecin vous propose de reprendre rendez-vous.',
      url: `./health-teleconsultation.html${item.specialtyCode ? `?specialty=${encodeURIComponent(item.specialtyCode)}` : ''}`,
      context: { appointmentId }
    });
    res.status(200).json({ ok: true });
  }));

  /** Purges every session message (and its Storage attachment) 30 days after creation. */
  const healthPurgeExpiredSessionMessages = onSchedule({ region, schedule: 'every 24 hours', timeZone: 'America/Port-au-Prince' }, async () => {
    const snap = await db.collection('healthMessages').where('expiresAt', '<=', nowIso()).limit(400).get();
    await Promise.all(snap.docs.map(async (docSnap) => {
      const data = docSnap.data();
      if (data.storagePath) await admin.storage().bucket().file(data.storagePath).delete().catch(() => {});
      await docSnap.ref.delete();
    }));
    logger.info('health session messages purged', { count: snap.size });
  });

  return { healthSendSessionMessage, healthConfirmSessionMedia, healthGetSessionMediaUrl, healthDoctorProposeFollowUp, healthPurgeExpiredSessionMessages };
}

module.exports = buildMessaging;
