'use strict';

/**
 * Doctor-issued e-prescriptions (healthClinicalPrescriptions) — medications, lab exam
 * requests, imaging exam requests, free-text notes — written during or after a
 * teleconsultation the doctor actually conducted. Distinct from healthPrescriptions,
 * which is a scanned paper prescription the PATIENT uploads and routes to pharmacies;
 * this module is the doctor's own clinical output, never a client-supplied file.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { HttpError, requireBearerUser, withErrorHandling } = require('../smartsolutiontek/auth');
const { sanitizeText } = require('./lib/validation');
const { notifyUser } = require('./lib/healthNotify');

const MAX_LINES = 20;

function sanitizeMedicationLines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_LINES).map((item) => ({
    name: sanitizeText(item?.name, 180),
    dosage: sanitizeText(item?.dosage, 120),
    instructions: sanitizeText(item?.instructions, 300)
  })).filter((item) => item.name);
}

function sanitizeExamLines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => sanitizeText(item, 200)).filter(Boolean).slice(0, MAX_LINES);
}

function buildPrescriptions(sstInternals) {
  const { db, REGION: region, verifyBearerUser: verifyBearer, isAdminUser } = sstInternals;
  const parseBody = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
  const nowIso = () => new Date().toISOString();
  const isAdmin = async (uid) => Boolean(await isAdminUser?.(uid));

  /** POST { appointmentId, medications?, labExams?, imagingExams?, notes? } */
  const healthDoctorIssuePrescription = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const body = parseBody(req);
    const appointmentId = sanitizeText(body.appointmentId, 200);
    const appointmentSnap = await db.collection('healthAppointments').doc(appointmentId).get();
    if (!appointmentSnap.exists) throw new HttpError(404, 'appointment-not-found', 'Consultation introuvable.');
    const appointment = appointmentSnap.data();
    if (appointment.providerUid !== user.uid || appointment.providerType !== 'doctor') {
      throw new HttpError(403, 'doctor-only', 'Cette consultation ne vous est pas attribuée.');
    }
    if (!['IN_PROGRESS', 'COMPLETED'].includes(appointment.status)) {
      throw new HttpError(409, 'session-not-eligible', 'Une ordonnance ne peut être émise que pendant ou après la séance.');
    }

    const medications = sanitizeMedicationLines(body.medications);
    const labExams = sanitizeExamLines(body.labExams);
    const imagingExams = sanitizeExamLines(body.imagingExams);
    const notes = sanitizeText(body.notes, 1000);
    if (!medications.length && !labExams.length && !imagingExams.length) {
      throw new HttpError(400, 'prescription-empty', 'Ajoutez au moins un médicament ou un examen.');
    }

    const ref = db.collection('healthClinicalPrescriptions').doc();
    await ref.set({
      appointmentId, patientUid: appointment.patientUid, providerUid: user.uid,
      specialtyName: appointment.specialtyName || null,
      medications, labExams, imagingExams, notes,
      createdAt: nowIso()
    });
    await notifyUser(db, appointment.patientUid, 'prescription_received', {
      title: 'Ordonnance reçue', body: 'Votre médecin vous a transmis une ordonnance.',
      url: './health-espace.html?tab=prescriptions', context: { prescriptionId: ref.id }
    });
    res.status(200).json({ ok: true, prescriptionId: ref.id });
  }));

  /** GET ?appointmentId= (both participants) or, without it, the caller's own as patient. */
  const healthListClinicalPrescriptions = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'GET') throw new HttpError(405, 'method-not-allowed', 'GET requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const appointmentId = sanitizeText(req.query?.appointmentId, 200);
    let query = db.collection('healthClinicalPrescriptions');
    query = appointmentId ? query.where('appointmentId', '==', appointmentId) : query.where('patientUid', '==', user.uid);
    const snap = await query.limit(100).get();
    const admin_ = await isAdmin(user.uid);
    const prescriptions = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((p) => admin_ || p.patientUid === user.uid || p.providerUid === user.uid);
    res.status(200).json({ ok: true, prescriptions });
  }));

  return { healthDoctorIssuePrescription, healthListClinicalPrescriptions };
}

module.exports = buildPrescriptions;
