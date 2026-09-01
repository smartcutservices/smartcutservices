'use strict';

/**
 * Self-service professional profile photo. Distinct from the "Devenir prestataire"
 * application flow (healthSaveApplication) on purpose: that flow REFUSES any write
 * once an account is verified (a fresh admin review is required to change compliance
 * fields like a license number). A profile photo is not a compliance field — it should
 * stay editable any time, before or after verification — so it gets its own narrow
 * endpoint instead of reopening the whole application for edits.
 *
 * Same verify-then-record pattern used everywhere else in Health (see messaging.js):
 * the client uploads the bytes straight to Storage first, then this endpoint only
 * confirms the upload actually happened at the expected, fixed path before recording it.
 */
const { onRequest } = require('firebase-functions/v2/https');
const { HttpError, requireBearerUser, withErrorHandling } = require('../smartsolutiontek/auth');
const { sanitizeText } = require('./lib/validation');
const { APPLICATION_COLLECTIONS, PROFILE_FIELDS } = require('./clinical');

function buildProfile(sstInternals) {
  const { db, admin, REGION: region, verifyBearerUser: verifyBearer } = sstInternals;
  const parseBody = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
  const nowIso = () => new Date().toISOString();

  /** POST { type: 'doctor'|'pharmacy'|'laboratory'|'imaging' } — the object is always at the same fixed path, so a re-upload just overwrites the previous photo. */
  const healthUpdateProfilePhoto = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, { verifyBearerUser: verifyBearer });
    const body = parseBody(req);
    const type = sanitizeText(body.type, 30).toLowerCase();
    if (!APPLICATION_COLLECTIONS[type]) throw new HttpError(400, 'invalid-professional-type', 'Type professionnel invalide.');

    const storagePath = `health-profile-photos/${user.uid}/photo`;
    const [exists] = await admin.storage().bucket().file(storagePath).exists();
    if (!exists) throw new HttpError(400, 'file-not-found', 'Photo introuvable. Téléversez-la avant de confirmer.');

    const now = nowIso();
    const profileField = PROFILE_FIELDS[type];
    const batch = db.batch();
    batch.set(db.collection('clients').doc(user.uid), { [profileField]: { photoPath: storagePath }, updatedAt: now }, { merge: true });
    const applicationRef = db.collection(APPLICATION_COLLECTIONS[type]).doc(user.uid);
    const applicationSnap = await applicationRef.get();
    if (applicationSnap.exists) {
      batch.set(applicationRef, { profile: { photoPath: storagePath }, updatedAt: now }, { merge: true });
    }
    await batch.commit();
    res.status(200).json({ ok: true, storagePath });
  }));

  return { healthUpdateProfilePhoto };
}

module.exports = buildProfile;
