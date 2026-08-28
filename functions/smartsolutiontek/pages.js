'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { isSlugAllowed } = require('./lib/slug');
const { requireBearerUser, requireOrgRole, withErrorHandling, HttpError } = require('./auth');

function registerPageFunctions({ db, sstInternals, region }) {
  /** GET ?slug=... — public, no auth required (checked before a creator types a name). */
  const checkSlugAvailability = onRequest({ region }, withErrorHandling(async (req, res) => {
    const slug = String(req.query?.slug || '').trim().toLowerCase();
    if (!isSlugAllowed(slug)) {
      res.status(200).json({ ok: true, available: false, reason: 'invalid-or-reserved' });
      return;
    }
    const existing = await db.collection('publicPages').where('slug', '==', slug).limit(1).get();
    res.status(200).json({ ok: true, available: existing.empty });
  }));

  /**
   * Publishes (or re-publishes) a page for an organization's application resource.
   * Slug uniqueness is enforced inside a transaction to avoid a race between two
   * simultaneous publish attempts for the same slug (see SECURITY_MODEL.md §4).
   * POST { organizationId, applicationId, slug, title, description, resourcePath }
   */
  const publishPage = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const applicationId = String(req.body?.applicationId || '').trim();
    const slug = String(req.body?.slug || '').trim().toLowerCase();
    if (!isSlugAllowed(slug)) {
      throw new HttpError(400, 'invalid-slug', 'Ce slug est invalide ou reserve.');
    }
    const title = String(req.body?.title || '').trim();
    if (!title) throw new HttpError(400, 'title-required', 'Titre requis.');

    const pageId = `${organizationId}_${slug}`;
    const pageRef = db.collection('publicPages').doc(pageId);

    await db.runTransaction(async (tx) => {
      const conflictSnap = await tx.get(db.collection('publicPages').where('slug', '==', slug).limit(1));
      const conflictDoc = conflictSnap.docs[0];
      if (conflictDoc && conflictDoc.id !== pageId) {
        throw new HttpError(409, 'slug-taken', 'Ce slug est deja utilise par une autre organisation.');
      }

      const existingSnap = await tx.get(pageRef);
      if (existingSnap.exists && existingSnap.data().organizationId !== organizationId) {
        throw new HttpError(409, 'slug-taken', 'Ce slug est deja utilise par une autre organisation.');
      }

      tx.set(pageRef, {
        organizationId,
        applicationId,
        slug,
        title,
        description: String(req.body?.description || '').trim(),
        logoUrl: req.body?.logoUrl || null,
        faviconUrl: req.body?.faviconUrl || null,
        seoTitle: req.body?.seoTitle || title,
        seoDescription: req.body?.seoDescription || null,
        resourceRef: req.body?.resourcePath || null,
        status: 'published',
        publishedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    res.status(200).json({ ok: true, pageId, url: `/p/${slug}` });
  }));

  /** POST { organizationId, slug, status } — unpublish/suspend/archive/draft. */
  const setPageStatus = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const status = String(req.body?.status || '').trim();
    if (!['draft', 'published', 'suspended', 'archived'].includes(status)) {
      throw new HttpError(400, 'invalid-status', 'Statut invalide.');
    }
    const slug = String(req.body?.slug || '').trim().toLowerCase();
    const pageRef = db.collection('publicPages').doc(`${organizationId}_${slug}`);
    const pageSnap = await pageRef.get();
    if (!pageSnap.exists || pageSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'page-not-found', 'Page introuvable.');
    }

    await pageRef.set({ status, updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.status(200).json({ ok: true });
  }));

  return { checkSlugAvailability, publishPage, setPageStatus };
}

module.exports = { registerPageFunctions };
