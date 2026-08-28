'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { requireBearerUser, requireOrgRole, requirePlatformRole, withErrorHandling, HttpError } = require('./auth');

function registerOrganizationFunctions({ db, sstInternals, region }) {
  /**
   * Creates a new organization. The caller becomes creator_owner. Never trusts an
   * ownerUid from the client — always the verified token's uid.
   * POST { name, legalName? }
   */
  const createOrganization = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);

    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'name-required', 'Le nom de l organisation est requis.');
    const legalName = String(req.body?.legalName || '').trim() || null;

    const orgRef = db.collection('organizations').doc();
    const memberRef = db.collection('organizationMembers').doc(`${orgRef.id}_${decodedUser.uid}`);

    await db.runTransaction(async (tx) => {
      tx.set(orgRef, {
        name,
        legalName,
        ownerUid: decodedUser.uid,
        status: 'active',
        kycStatus: 'not_started',
        defaultCurrency: 'HTG',
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      });
      tx.set(memberRef, {
        organizationId: orgRef.id,
        uid: decodedUser.uid,
        role: 'creator_owner',
        invitedBy: null,
        status: 'active',
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      });
    });

    res.status(200).json({ ok: true, organizationId: orgRef.id });
  }));

  /**
   * Invites a member into an organization. Only creator_owner may invite.
   * POST { organizationId, uid, role }
   */
  const inviteMember = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner']);

    const uid = String(req.body?.uid || '').trim();
    const role = String(req.body?.role || '').trim();
    const allowedInviteRoles = ['creator_manager', 'creator_staff'];
    if (!uid) throw new HttpError(400, 'uid-required', 'uid du membre requis.');
    if (!allowedInviteRoles.includes(role)) {
      throw new HttpError(400, 'invalid-role', `role doit etre l un de: ${allowedInviteRoles.join(', ')}`);
    }

    const memberRef = db.collection('organizationMembers').doc(`${organizationId}_${uid}`);
    await memberRef.set({
      organizationId,
      uid,
      role,
      invitedBy: decodedUser.uid,
      status: 'active',
      createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(200).json({ ok: true });
  }));

  /**
   * Disables a member's access to an organization. Only creator_owner may do this,
   * and an owner cannot disable themselves through this endpoint (avoids a locked-out
   * organization with no active owner).
   * POST { organizationId, uid }
   */
  const removeMember = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner']);

    const uid = String(req.body?.uid || '').trim();
    if (!uid) throw new HttpError(400, 'uid-required', 'uid du membre requis.');
    if (uid === decodedUser.uid) {
      throw new HttpError(400, 'cannot-remove-self', "Le proprietaire ne peut pas se retirer lui-meme.");
    }

    const memberRef = db.collection('organizationMembers').doc(`${organizationId}_${uid}`);
    await memberRef.set({ status: 'disabled', updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });

    res.status(200).json({ ok: true });
  }));

  /** Lists the organizations the caller belongs to (any role, active membership). */
  const getMyOrganizations = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const membershipsSnap = await db.collection('organizationMembers')
      .where('uid', '==', decodedUser.uid)
      .where('status', '==', 'active')
      .get();

    const organizationIds = membershipsSnap.docs.map((doc) => doc.data().organizationId);
    if (!organizationIds.length) {
      res.status(200).json({ ok: true, organizations: [] });
      return;
    }

    const orgDocs = await Promise.all(organizationIds.map((id) => db.collection('organizations').doc(id).get()));
    const organizations = orgDocs
      .filter((snap) => snap.exists)
      .map((snap) => {
        const membership = membershipsSnap.docs.find((doc) => doc.data().organizationId === snap.id);
        return { id: snap.id, ...snap.data(), myRole: membership?.data()?.role || null };
      });

    res.status(200).json({ ok: true, organizations });
  }));

  /**
   * finance_admin/platform_admin approves or rejects an organization's KYC.
   * Manual review, per SECURITY_MODEL.md §5 — no automated identity verification exists.
   * POST { organizationId, status: "approved"|"rejected", rejectionReason? }
   */
  const setKycStatus = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    await requirePlatformRole(db, decodedUser, ['platform_admin', 'finance_admin']);

    const status = String(req.body?.status || '').trim();
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      throw new HttpError(400, 'invalid-status', 'status doit etre approved, rejected ou pending.');
    }
    const organizationId = String(req.body?.organizationId || '').trim();
    const orgRef = db.collection('organizations').doc(organizationId);
    const orgSnap = await orgRef.get();
    if (!orgSnap.exists) throw new HttpError(404, 'organization-not-found', 'Organisation introuvable.');

    if (status === 'rejected' && !String(req.body?.rejectionReason || '').trim()) {
      throw new HttpError(400, 'rejection-reason-required', 'Raison du rejet requise.');
    }

    await orgRef.set({
      kycStatus: status,
      kycRejectionReason: status === 'rejected' ? String(req.body.rejectionReason).trim() : null,
      kycReviewedBy: decodedUser.uid,
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    await db.collection('auditLogs').doc().set({
      actorUid: decodedUser.uid,
      action: 'organization.kycStatus',
      targetType: 'organization',
      targetId: organizationId,
      organizationId,
      metadata: { status },
      createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({ ok: true });
  }));

  /** platform_admin/finance_admin/support_agent: lists all organizations for the admin dashboard. */
  const listAllOrganizations = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    await requirePlatformRole(db, decodedUser, ['platform_admin', 'finance_admin', 'support_agent']);

    const snap = await db.collection('organizations').get();
    res.status(200).json({ ok: true, organizations: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  }));

  return { createOrganization, inviteMember, removeMember, getMyOrganizations, setKycStatus, listAllOrganizations };
}

module.exports = { registerOrganizationFunctions };
