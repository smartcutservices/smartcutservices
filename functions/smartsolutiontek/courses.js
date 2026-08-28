'use strict';

const crypto = require('node:crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { requireBearerUser, requireOrgRole, withErrorHandling, HttpError } = require('./auth');
const { registerResourceResolver } = require('./payments');
const { sanitizeColors, LAYOUTS } = require('./lib/branding');
const { resolveActiveRuleFromFirestore } = require('./commissions');
const { calculateAmounts } = require('./lib/commissions');
const { isSlugAllowed } = require('./lib/slug');
const {
  COURSE_STATUSES, LESSON_STATUSES, LESSON_TYPES, normalizeEmail,
  sanitizePlainText, sanitizeLessonText, normalizeCourseInput,
  buildPublishChecklist, calculateProgress, calculateAccessExpiration, hasActiveEnrollmentAccess
} = require('./lib/courseDomain');

function sanitizeOptionalString(value, maxLen) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str ? str.slice(0, maxLen) : null;
}

function serverTimestamp(sstInternals) {
  return sstInternals.admin.firestore.FieldValue.serverTimestamp();
}

async function writeCourseAudit(db, sstInternals, input) {
  await db.collection('courseAuditLogs').add({
    organizationId: input.organizationId,
    courseId: input.courseId || null,
    actorUid: input.actorUid,
    action: input.action,
    targetType: input.targetType || 'course',
    targetId: input.targetId || input.courseId || null,
    metadata: input.metadata || {},
    createdAt: serverTimestamp(sstInternals)
  });
}

async function getCourseCounts(db, courseId) {
  const [modules, lessons] = await Promise.all([
    db.collection('courseModules').where('courseId', '==', courseId).get(),
    db.collection('lessons').where('courseId', '==', courseId).get()
  ]);
  return { modules: modules.size, lessons: lessons.docs.filter((doc) => doc.data().status !== 'archived').length };
}

/**
 * Application 3 — Cours en ligne. Same shared pattern as forms.js / shops.js.
 *
 * Critical requirement (spec: "Ne jamais exposer directement les fichiers prives ou
 * videos protegees"): the public read path (getPublicCourse) NEVER returns lesson
 * `content` (the video/PDF/file URL) unless the lesson is `isFreePreview`. Full
 * content is only ever returned by getEnrolledCourseContent, which verifies a
 * confirmed enrollment server-side before revealing anything.
 */

function registerCourseFunctions({ db, sstInternals, region }) {
  /** POST { organizationId, courseId?, title, description, price, coverImage? } */
  const saveCourse = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const courseId = String(req.body?.courseId || '').trim();
    const courseRef = courseId ? db.collection('courses').doc(courseId) : db.collection('courses').doc();
    let existingCourse = {};
    if (courseId) {
      const existing = await courseRef.get();
      if (existing.exists && existing.data().organizationId !== organizationId) {
        throw new HttpError(403, 'not-owner', 'Ce cours appartient a une autre organisation.');
      }
      if (!existing.exists) throw new HttpError(404, 'course-not-found', 'Cours introuvable.');
      existingCourse = existing.data();
    }

    let normalized;
    try {
      normalized = normalizeCourseInput(req.body, existingCourse);
    } catch (error) {
      throw new HttpError(400, error.code || 'invalid-course', error.message);
    }
    if (!isSlugAllowed(normalized.slug)) {
      throw new HttpError(400, 'invalid-slug', 'Le slug doit contenir entre 3 et 48 caracteres et ne pas etre reserve.');
    }

    await courseRef.set({
      organizationId,
      ...normalized,
      coverImage: req.body?.coverImage || null,
      heroTitle: sanitizeOptionalString(req.body?.heroTitle, 140),
      heroSubtitle: sanitizeOptionalString(req.body?.heroSubtitle, 300),
      colors: sanitizeColors(req.body?.colors),
      layout: LAYOUTS.includes(req.body?.layout) ? req.body.layout : 'minimal',
      dataModelVersion: 2,
      updatedAt: serverTimestamp(sstInternals),
      ...(courseId ? {} : {
        status: 'draft',
        createdAt: serverTimestamp(sstInternals)
      })
    }, { merge: true });

    if (!courseId) {
      await writeCourseAudit(db, sstInternals, { organizationId, courseId: courseRef.id, actorUid: decodedUser.uid, action: 'course.created' });
    } else if (Number(existingCourse.price) !== Number(normalized.price)) {
      await writeCourseAudit(db, sstInternals, {
        organizationId, courseId: courseRef.id, actorUid: decodedUser.uid, action: 'course.price_changed',
        metadata: { previousAmount: Number(existingCourse.price) || 0, newAmount: Number(normalized.price) || 0, currency: 'HTG' }
      });
    }

    res.status(200).json({ ok: true, courseId: courseRef.id });
  }));

  /** POST { organizationId, courseId, status } */
  const setCourseStatus = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const status = String(req.body?.status || '').trim();
    if (!COURSE_STATUSES.includes(status)) {
      throw new HttpError(400, 'invalid-status', 'Statut invalide.');
    }
    const courseId = String(req.body?.courseId || '').trim();
    const courseRef = db.collection('courses').doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists || courseSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'course-not-found', 'Cours introuvable.');
    }
    if (status === 'published') {
      const counts = await getCourseCounts(db, courseId);
      const organizationSnap = await db.collection('organizations').doc(organizationId).get();
      const organization = organizationSnap.data() || {};
      const paymentReady = Boolean(organization.paymentReady || organization.moncashReady || (organization.status === 'active' && organization.kycStatus !== 'rejected'));
      const checklist = buildPublishChecklist(courseSnap.data(), counts, paymentReady);
      if (!checklist.complete) {
        throw new HttpError(409, 'publish-checklist-incomplete', checklist.items.filter((item) => !item.complete).map((item) => item.reason).join(' '));
      }
      await courseRef.set({ publishChecklist: checklist, publishedAt: serverTimestamp(sstInternals) }, { merge: true });
    }
    await courseRef.set({ status, updatedAt: serverTimestamp(sstInternals) }, { merge: true });
    await writeCourseAudit(db, sstInternals, { organizationId, courseId, actorUid: decodedUser.uid, action: status === 'published' ? 'course.published' : 'course.status_changed', metadata: { status } });
    res.status(200).json({ ok: true });
  }));

  /** Deletes an unused course, or archives it when enrollment history exists. */
  const deleteCourse = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);
    const courseId = String(req.body?.courseId || '').trim();
    const courseRef = db.collection('courses').doc(courseId);
    const courseSnap = await courseRef.get();
    if (!courseSnap.exists || courseSnap.data().organizationId !== organizationId) throw new HttpError(404, 'course-not-found', 'Cours introuvable.');
    const enrollments = await db.collection('enrollments').where('courseId', '==', courseId).limit(1).get();
    if (!enrollments.empty) {
      await courseRef.set({ status: 'archived', updatedAt: serverTimestamp(sstInternals) }, { merge: true });
      await writeCourseAudit(db, sstInternals, { organizationId, courseId, actorUid: decodedUser.uid, action: 'course.archived', metadata: { reason: 'enrollment-history' } });
      res.status(200).json({ ok: true, archived: true });
      return;
    }
    const [modules, lessons] = await Promise.all([
      db.collection('courseModules').where('courseId', '==', courseId).get(),
      db.collection('lessons').where('courseId', '==', courseId).get()
    ]);
    const batch = db.batch();
    modules.docs.forEach((doc) => batch.delete(doc.ref));
    lessons.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(courseRef);
    await batch.commit();
    await writeCourseAudit(db, sstInternals, { organizationId, courseId, actorUid: decodedUser.uid, action: 'course.deleted' });
    res.status(200).json({ ok: true, archived: false });
  }));

  /** POST { organizationId, courseId, moduleId?, title, order } */
  const saveCourseModule = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);

    const courseId = String(req.body?.courseId || '').trim();
    const courseSnap = await db.collection('courses').doc(courseId).get();
    if (!courseSnap.exists || courseSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'course-not-found', 'Cours introuvable.');
    }
    const title = String(req.body?.title || '').trim();
    if (!title) throw new HttpError(400, 'title-required', 'Titre du module requis.');

    const moduleId = String(req.body?.moduleId || '').trim();
    const moduleRef = moduleId ? db.collection('courseModules').doc(moduleId) : db.collection('courseModules').doc();
    if (moduleId) {
      const existingModule = await moduleRef.get();
      if (!existingModule.exists || existingModule.data().organizationId !== organizationId || existingModule.data().courseId !== courseId) {
        throw new HttpError(404, 'module-not-found', 'Module introuvable pour ce cours.');
      }
    }
    await moduleRef.set({
      organizationId, courseId, title: sanitizePlainText(title, 140),
      order: Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : 0,
      status: ['active', 'archived'].includes(req.body?.status) ? req.body.status : 'active',
      updatedAt: serverTimestamp(sstInternals),
      createdAt: moduleId ? undefined : serverTimestamp(sstInternals)
    }, { merge: true });

    res.status(200).json({ ok: true, moduleId: moduleRef.id });
  }));

  /** POST { organizationId, moduleId } — cascade-deletes the module's own lessons too. */
  const deleteCourseModule = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const moduleId = String(req.body?.moduleId || '').trim();
    const moduleRef = db.collection('courseModules').doc(moduleId);
    const moduleSnap = await moduleRef.get();
    if (!moduleSnap.exists || moduleSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'module-not-found', 'Module introuvable.');
    }

    const lessonsSnap = await db.collection('lessons').where('moduleId', '==', moduleId).get();
    const enrollmentHistory = await db.collection('enrollments').where('courseId', '==', moduleSnap.data().courseId).limit(1).get();
    if (!enrollmentHistory.empty) {
      const batch = db.batch();
      lessonsSnap.docs.forEach((doc) => batch.set(doc.ref, { status: 'archived', updatedAt: serverTimestamp(sstInternals) }, { merge: true }));
      batch.set(moduleRef, { status: 'archived', updatedAt: serverTimestamp(sstInternals) }, { merge: true });
      await batch.commit();
      await writeCourseAudit(db, sstInternals, { organizationId, courseId: moduleSnap.data().courseId, actorUid: decodedUser.uid, action: 'module.archived', targetType: 'module', targetId: moduleId });
      res.status(200).json({ ok: true, archived: true });
      return;
    }
    const batch = db.batch();
    lessonsSnap.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(moduleRef);
    await batch.commit();
    await writeCourseAudit(db, sstInternals, { organizationId, courseId: moduleSnap.data().courseId, actorUid: decodedUser.uid, action: 'module.deleted', targetType: 'module', targetId: moduleId });
    res.status(200).json({ ok: true, archived: false });
  }));

  /** POST { organizationId, lessonId } */
  const deleteLesson = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const lessonId = String(req.body?.lessonId || '').trim();
    const lessonRef = db.collection('lessons').doc(lessonId);
    const lessonSnap = await lessonRef.get();
    if (!lessonSnap.exists || lessonSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'lesson-not-found', 'Lecon introuvable.');
    }
    const enrollmentHistory = await db.collection('enrollments').where('courseId', '==', lessonSnap.data().courseId).limit(1).get();
    if (!enrollmentHistory.empty) {
      await lessonRef.set({ status: 'archived', updatedAt: serverTimestamp(sstInternals) }, { merge: true });
      await writeCourseAudit(db, sstInternals, { organizationId, courseId: lessonSnap.data().courseId, actorUid: decodedUser.uid, action: 'lesson.archived', targetType: 'lesson', targetId: lessonId });
      res.status(200).json({ ok: true, archived: true });
      return;
    }
    await lessonRef.delete();
    await writeCourseAudit(db, sstInternals, { organizationId, courseId: lessonSnap.data().courseId, actorUid: decodedUser.uid, action: 'lesson.deleted', targetType: 'lesson', targetId: lessonId });
    res.status(200).json({ ok: true, archived: false });
  }));

  /**
   * POST { organizationId, courseId, moduleId, lessonId?, title, type, content, order, isFreePreview }
   * `content` is the protected payload (video URL, PDF URL, or text body) — never
   * returned by the public endpoint below unless isFreePreview is true.
   */
  const saveLesson = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);

    const moduleId = String(req.body?.moduleId || '').trim();
    const moduleSnap = await db.collection('courseModules').doc(moduleId).get();
    if (!moduleSnap.exists || moduleSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'module-not-found', 'Module introuvable.');
    }
    const type = String(req.body?.type || '').trim();
    if (!LESSON_TYPES.includes(type)) throw new HttpError(400, 'invalid-type', 'Type de lecon invalide.');
    const title = String(req.body?.title || '').trim();
    if (!title) throw new HttpError(400, 'title-required', 'Titre de la lecon requis.');

    const lessonId = String(req.body?.lessonId || '').trim();
    const lessonRef = lessonId ? db.collection('lessons').doc(lessonId) : db.collection('lessons').doc();
    let existingLesson = {};
    if (lessonId) {
      const existing = await lessonRef.get();
      if (!existing.exists || existing.data().organizationId !== organizationId || existing.data().courseId !== moduleSnap.data().courseId) {
        throw new HttpError(404, 'lesson-not-found', 'Lecon introuvable pour ce cours.');
      }
      existingLesson = existing.data();
    }
    const contentRef = sanitizePlainText(req.body?.contentRef ?? (type === 'text' ? '' : existingLesson.contentRef), 1000);
    if (type !== 'text' && contentRef && !contentRef.startsWith(`sst-courses/${moduleSnap.data().courseId}/lessons/`)) {
      throw new HttpError(400, 'invalid-content-ref', 'Le fichier doit appartenir a ce cours.');
    }
    const textContent = type === 'text' ? sanitizeLessonText(req.body?.content ?? existingLesson.content) : null;
    if (type === 'text' && !textContent) throw new HttpError(400, 'content-required', 'Contenu texte requis.');
    if (type !== 'text' && !contentRef && !existingLesson.content) throw new HttpError(400, 'content-required', 'Reference du fichier requise.');
    await lessonRef.set({
      organizationId,
      courseId: moduleSnap.data().courseId,
      moduleId,
      title,
      type,
      content: type === 'text' ? textContent : (existingLesson.content || null),
      contentRef: contentRef || null,
      description: sanitizePlainText(req.body?.description ?? existingLesson.description, 2000) || null,
      estimatedDurationMinutes: Math.max(0, Math.min(10000, Math.round(Number(req.body?.estimatedDurationMinutes ?? existingLesson.estimatedDurationMinutes) || 0))),
      order: Number.isFinite(Number(req.body?.order)) ? Number(req.body.order) : 0,
      isFreePreview: Boolean(req.body?.isFreePreview),
      allowDownload: Boolean(req.body?.allowDownload),
      status: LESSON_STATUSES.includes(req.body?.status) ? req.body.status : (existingLesson.status || 'draft'),
      availability: req.body?.availability && typeof req.body.availability === 'object' ? req.body.availability : (existingLesson.availability || { type: 'immediate' }),
      updatedAt: serverTimestamp(sstInternals),
      createdAt: lessonId ? undefined : serverTimestamp(sstInternals)
    }, { merge: true });

    res.status(200).json({ ok: true, lessonId: lessonRef.id });
  }));

  /** GET ?courseId=... — public. Never returns lesson `content` unless isFreePreview. */
  const getPublicCourse = onRequest({ region }, withErrorHandling(async (req, res) => {
    const courseId = String(req.query?.courseId || '').trim();
    const courseSnap = await db.collection('courses').doc(courseId).get();
    if (!courseSnap.exists || courseSnap.data().status !== 'published') {
      throw new HttpError(404, 'course-not-found', 'Cours introuvable ou non publie.');
    }
    const course = courseSnap.data();

    const modulesSnap = await db.collection('courseModules').where('courseId', '==', courseId).get();
    const lessonsSnap = await db.collection('lessons').where('courseId', '==', courseId).get();

    const modules = modulesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((mod) => mod.status !== 'archived')
      .sort((a, b) => a.order - b.order)
      .map((mod) => ({
        id: mod.id,
        title: mod.title,
        lessons: lessonsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((l) => l.moduleId === mod.id && (l.status === 'published' || !l.status))
          .sort((a, b) => a.order - b.order)
          .map((l) => ({
            id: l.id,
            title: l.title,
            type: l.type,
            status: l.status || 'published',
            estimatedDurationMinutes: l.estimatedDurationMinutes || 0,
            isFreePreview: l.isFreePreview,
            // Content is intentionally omitted for locked lessons — see module docstring.
            content: l.isFreePreview && l.type === 'text' ? l.content : null
          }))
      }));

    res.status(200).json({
      ok: true,
      course: {
        id: courseSnap.id, organizationId: course.organizationId, title: course.title, subtitle: course.subtitle || null,
        description: course.description, shortDescription: course.shortDescription || null, fullDescription: course.fullDescription || null,
        category: course.category || null, level: course.level || 'all', language: course.language || 'fr',
        instructorName: course.instructorName || null, learningOutcomes: course.learningOutcomes || [],
        targetAudience: course.targetAudience || [], prerequisites: course.prerequisites || [], faqs: course.faqs || [],
        testimonials: course.testimonials || [],
        estimatedDurationMinutes: course.estimatedDurationMinutes || 0, accessPolicy: course.accessPolicy || { type: 'lifetime' },
        enrollmentPolicy: course.enrollmentPolicy || { opensAt: null, closesAt: null, capacity: null },
        refundPolicy: course.refundPolicy || null, termsUrl: course.termsUrl || null,
        coverImage: course.coverImage, price: course.price, pricing: course.pricing || null,
        heroTitle: course.heroTitle || null, heroSubtitle: course.heroSubtitle || null,
        colors: course.colors || null, layout: course.layout || 'minimal', slug: course.slug || null,
        pageSections: course.pageSections || null, seo: course.seo || null
      },
      modules
    });
  }));

  /**
   * Authenticated. Verifies the caller has a `confirmed` enrollment for this course
   * before returning the full lesson content (including protected video/file URLs).
   * GET ?courseId=...
   */
  const getEnrolledCourseContent = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const courseId = String(req.query?.courseId || '').trim();

    const enrollmentSnap = await db.collection('enrollments')
      .where('courseId', '==', courseId)
      .where('studentUid', '==', decodedUser.uid)
      .where('status', '==', 'confirmed')
      .limit(1)
      .get();
    if (enrollmentSnap.empty || !hasActiveEnrollmentAccess(enrollmentSnap.docs[0].data())) {
      throw new HttpError(403, 'not-enrolled', "Vous n'etes pas inscrit a ce cours.");
    }
    const enrollment = { id: enrollmentSnap.docs[0].id, ...enrollmentSnap.docs[0].data() };

    const modulesSnap = await db.collection('courseModules').where('courseId', '==', courseId).get();
    const lessonsSnap = await db.collection('lessons').where('courseId', '==', courseId).get();

    const modules = modulesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((mod) => mod.status !== 'archived')
      .sort((a, b) => a.order - b.order)
      .map((mod) => ({
        id: mod.id,
        title: mod.title,
        lessons: lessonsSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((l) => l.moduleId === mod.id)
          .sort((a, b) => a.order - b.order)
          .filter((l) => l.status !== 'archived')
          .map((l) => ({
            id: l.id, title: l.title, description: l.description || null, type: l.type,
            content: l.type === 'text' ? l.content : null,
            contentAvailable: l.type === 'text' ? Boolean(l.content) : Boolean(l.contentRef || l.content),
            estimatedDurationMinutes: l.estimatedDurationMinutes || 0,
            allowDownload: Boolean(l.allowDownload), status: l.status || 'published'
          }))
      }));

    res.status(200).json({ ok: true, modules, progress: enrollment.progress || {} });
  }));

  /** Returns a 15-minute URL after checking lesson ownership and enrollment. */
  const getLessonMediaAccess = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const courseId = String(req.query?.courseId || '').trim();
    const lessonId = String(req.query?.lessonId || '').trim();
    const [lessonSnap, enrollmentSnap] = await Promise.all([
      db.collection('lessons').doc(lessonId).get(),
      db.collection('enrollments').where('courseId', '==', courseId)
        .where('studentUid', '==', decodedUser.uid).where('status', '==', 'confirmed').limit(1).get()
    ]);
    if (!lessonSnap.exists || lessonSnap.data().courseId !== courseId || lessonSnap.data().status === 'archived') {
      throw new HttpError(404, 'lesson-not-found', 'Lecon introuvable pour ce cours.');
    }
    if (enrollmentSnap.empty || !hasActiveEnrollmentAccess(enrollmentSnap.docs[0].data())) throw new HttpError(403, 'not-enrolled', "Votre acces a ce cours est absent ou expire.");
    const lesson = lessonSnap.data();
    if (!lesson.contentRef || !lesson.contentRef.startsWith(`sst-courses/${courseId}/lessons/`)) {
      throw new HttpError(409, 'legacy-media-migration-required', 'Ce media historique doit etre migre vers le stockage prive.');
    }
    const expiresAt = Date.now() + (15 * 60 * 1000);
    const [url] = await sstInternals.admin.storage().bucket().file(lesson.contentRef)
      .getSignedUrl({ action: 'read', expires: expiresAt });
    res.set('Cache-Control', 'private, no-store');
    res.status(200).json({ ok: true, url, expiresAt: new Date(expiresAt).toISOString(), allowDownload: Boolean(lesson.allowDownload) });
  }));

  /** Public short-lived media access, limited to an explicitly published free preview. */
  const getLessonPreviewAccess = onRequest({ region }, withErrorHandling(async (req, res) => {
    const courseId = String(req.query?.courseId || '').trim();
    const lessonId = String(req.query?.lessonId || '').trim();
    const [courseSnap, lessonSnap] = await Promise.all([db.collection('courses').doc(courseId).get(), db.collection('lessons').doc(lessonId).get()]);
    if (!courseSnap.exists || courseSnap.data().status !== 'published' || !lessonSnap.exists) throw new HttpError(404, 'preview-not-found', 'Apercu introuvable.');
    const lesson = lessonSnap.data();
    if (lesson.courseId !== courseId || lesson.status !== 'published' || !lesson.isFreePreview) throw new HttpError(403, 'preview-not-public', 'Cette lecon ne propose pas d’apercu public.');
    if (!lesson.contentRef || !lesson.contentRef.startsWith(`sst-courses/${courseId}/lessons/`)) throw new HttpError(409, 'preview-migration-required', 'Cet apercu historique doit etre migre vers le stockage prive.');
    const expiresAt = Date.now() + (10 * 60 * 1000);
    const [url] = await sstInternals.admin.storage().bucket().file(lesson.contentRef).getSignedUrl({ action: 'read', expires: expiresAt });
    res.set('Cache-Control', 'public, max-age=60');
    res.status(200).json({ ok: true, url, type: lesson.type, expiresAt: new Date(expiresAt).toISOString() });
  }));

  /**
   * Marks a lesson complete for the caller's enrollment. Verifies enrollment
   * ownership + confirmed status server-side before writing.
   * POST { courseId, lessonId, completed? }
   */
  const updateLessonProgress = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const courseId = String(req.body?.courseId || '').trim();
    const lessonId = String(req.body?.lessonId || '').trim();
    const completed = req.body?.completed !== false;

    const lessonSnap = await db.collection('lessons').doc(lessonId).get();
    if (!lessonSnap.exists || lessonSnap.data().courseId !== courseId || lessonSnap.data().status === 'archived') {
      throw new HttpError(400, 'lesson-course-mismatch', 'Cette lecon n’appartient pas a ce cours.');
    }

    const enrollmentSnap = await db.collection('enrollments')
      .where('courseId', '==', courseId)
      .where('studentUid', '==', decodedUser.uid)
      .where('status', '==', 'confirmed')
      .limit(1)
      .get();
    if (enrollmentSnap.empty || !hasActiveEnrollmentAccess(enrollmentSnap.docs[0].data())) throw new HttpError(403, 'not-enrolled', "Votre acces a ce cours est absent ou expire.");

    const enrollmentDoc = enrollmentSnap.docs[0];
    const enrollmentRef = enrollmentDoc.ref;
    const enrollment = enrollmentDoc.data();
    const lessonsSnap = await db.collection('lessons').where('courseId', '==', courseId).get();
    const totalLessonIds = lessonsSnap.docs.filter((doc) => doc.data().status !== 'archived').map((doc) => doc.id);
    const legacyProgress = enrollment.progress || {};
    const completedIds = Object.keys(legacyProgress).filter((id) => legacyProgress[id] === true);
    const nextCompletedIds = completed ? [...completedIds, lessonId] : completedIds.filter((id) => id !== lessonId);
    const progress = calculateProgress(totalLessonIds, nextCompletedIds);
    const progressRef = db.collection('lessonProgress').doc(`${decodedUser.uid}_${courseId}_${lessonId}`);
    const courseProgressRef = db.collection('courseProgress').doc(`${decodedUser.uid}_${courseId}`);
    const batch = db.batch();
    batch.set(progressRef, {
      organizationId: lessonSnap.data().organizationId, courseId, lessonId,
      studentUid: decodedUser.uid, enrollmentId: enrollmentDoc.id, completed,
      completedAt: completed ? serverTimestamp(sstInternals) : null,
      updatedAt: serverTimestamp(sstInternals)
    }, { merge: true });
    batch.set(courseProgressRef, {
      organizationId: lessonSnap.data().organizationId, courseId,
      studentUid: decodedUser.uid, enrollmentId: enrollmentDoc.id,
      ...progress, lastLessonId: lessonId, lastAccessedAt: serverTimestamp(sstInternals),
      completedAt: progress.completionPercentage === 100 ? serverTimestamp(sstInternals) : null,
      updatedAt: serverTimestamp(sstInternals)
    }, { merge: true });
    batch.set(enrollmentRef, {
      [`progress.${lessonId}`]: completed,
      completionPercentage: progress.completionPercentage,
      lastLessonId: lessonId,
      lastAccessedAt: serverTimestamp(sstInternals),
      updatedAt: serverTimestamp(sstInternals)
    }, { merge: true });
    await batch.commit();

    res.status(200).json({ ok: true, progress });
  }));

  /** Creator-only launch checklist with explicit explanations. */
  const getCoursePublishChecklist = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.query?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);
    const courseId = String(req.query?.courseId || '').trim();
    const [courseSnap, organizationSnap, counts] = await Promise.all([
      db.collection('courses').doc(courseId).get(),
      db.collection('organizations').doc(organizationId).get(),
      getCourseCounts(db, courseId)
    ]);
    if (!courseSnap.exists || courseSnap.data().organizationId !== organizationId) throw new HttpError(404, 'course-not-found', 'Cours introuvable.');
    const organization = organizationSnap.data() || {};
    const paymentReady = Boolean(organization.paymentReady || organization.moncashReady || (organization.status === 'active' && organization.kycStatus !== 'rejected'));
    res.status(200).json({ ok: true, checklist: buildPublishChecklist(courseSnap.data(), counts, paymentReady) });
  }));

  /** Honest course overview; every metric is derived from stored records. */
  const getCourseOverview = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.query?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);
    const courseId = String(req.query?.courseId || '').trim();
    const [courseSnap, enrollmentsSnap, counts, organizationSnap] = await Promise.all([
      db.collection('courses').doc(courseId).get(),
      db.collection('enrollments').where('organizationId', '==', organizationId).where('courseId', '==', courseId).get(),
      getCourseCounts(db, courseId),
      db.collection('organizations').doc(organizationId).get()
    ]);
    if (!courseSnap.exists || courseSnap.data().organizationId !== organizationId) throw new HttpError(404, 'course-not-found', 'Cours introuvable.');
    const course = courseSnap.data();
    const enrollments = enrollmentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const confirmed = enrollments.filter((item) => item.status === 'confirmed');
    const grossRevenue = confirmed.reduce((sum, item) => sum + Math.max(0, Number(item.amountDue) || 0), 0);
    const rule = grossRevenue > 0 ? await resolveActiveRuleFromFirestore(db, { organizationId, applicationId: 'courses' }) : null;
    const amounts = grossRevenue > 0 ? calculateAmounts(grossRevenue, rule, 0) : { creatorNet: 0, smartcutFee: 0 };
    const progressValues = confirmed.map((item) => Number(item.completionPercentage)).filter(Number.isFinite);
    const organization = organizationSnap.data() || {};
    const paymentReady = Boolean(organization.paymentReady || organization.moncashReady || (organization.status === 'active' && organization.kycStatus !== 'rejected'));
    const checklist = buildPublishChecklist(course, counts, paymentReady);
    const recentEnrollments = confirmed.sort((a, b) => Number(b.createdAt?.toMillis?.() || 0) - Number(a.createdAt?.toMillis?.() || 0)).slice(0, 5)
      .map((item) => ({ id: item.id, studentName: item.studentName || null, studentEmail: item.studentEmail, createdAt: item.createdAt || null, completionPercentage: Number(item.completionPercentage) || 0 }));
    res.status(200).json({
      ok: true,
      overview: {
        status: course.status || 'draft', lessonCount: counts.lessons, moduleCount: counts.modules,
        studentCount: confirmed.length, grossRevenue, estimatedNetRevenue: amounts.creatorNet,
        estimatedSmartSolutionTekFee: amounts.smartcutFee,
        averageProgress: progressValues.length ? Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length) : null,
        checklist, recentEnrollments,
        definitions: {
          grossRevenue: 'Somme des montants dus des inscriptions confirmees.',
          estimatedNetRevenue: 'Revenu brut moins la commission active estimee; frais fournisseur non inclus.',
          averageProgress: 'Moyenne des pourcentages serveur disponibles pour les inscriptions confirmees.'
        }
      }
    });
  }));

  /** Minimal first-party events. No third-party tracker and no raw IP/user-agent stored. */
  const recordCourseAnalyticsEvent = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const courseId = String(req.body?.courseId || '').trim();
    const eventType = String(req.body?.eventType || '').trim();
    const allowed = ['page_view', 'cta_click', 'checkout_started'];
    if (!allowed.includes(eventType)) throw new HttpError(400, 'invalid-event', 'Evenement invalide.');
    const courseSnap = await db.collection('courses').doc(courseId).get();
    if (!courseSnap.exists || courseSnap.data().status !== 'published') throw new HttpError(404, 'course-not-found', 'Cours introuvable.');
    const sessionId = sanitizePlainText(req.body?.sessionId, 80);
    if (!/^[a-zA-Z0-9_-]{12,80}$/.test(sessionId)) throw new HttpError(400, 'invalid-session', 'Session invalide.');
    const minuteBucket = Math.floor(Date.now() / 60000);
    const dedupeId = crypto.createHash('sha256').update(`${courseId}:${eventType}:${sessionId}:${minuteBucket}`).digest('hex');
    await db.collection('courseAnalyticsEvents').doc(dedupeId).create({
      organizationId: courseSnap.data().organizationId, courseId, eventType,
      sessionHash: crypto.createHash('sha256').update(sessionId).digest('hex'),
      createdAt: serverTimestamp(sstInternals)
    }).catch((error) => { if (error.code !== 6 && error.code !== 'already-exists') throw error; });
    res.status(200).json({ ok: true });
  }));

  const getCourseAnalytics = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.query?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);
    const courseId = String(req.query?.courseId || '').trim();
    const courseSnap = await db.collection('courses').doc(courseId).get();
    if (!courseSnap.exists || courseSnap.data().organizationId !== organizationId) throw new HttpError(404, 'course-not-found', 'Cours introuvable.');
    const [eventsSnap, enrollmentsSnap] = await Promise.all([
      db.collection('courseAnalyticsEvents').where('courseId', '==', courseId).get(),
      db.collection('enrollments').where('courseId', '==', courseId).get()
    ]);
    const counts = { page_view: 0, cta_click: 0, checkout_started: 0 };
    eventsSnap.docs.forEach((doc) => { if (Object.hasOwn(counts, doc.data().eventType)) counts[doc.data().eventType] += 1; });
    const confirmed = enrollmentsSnap.docs.filter((doc) => doc.data().status === 'confirmed');
    const completed = confirmed.filter((doc) => Number(doc.data().completionPercentage) === 100).length;
    res.status(200).json({ ok: true, analytics: {
      pageViews: counts.page_view, ctaClicks: counts.cta_click, checkoutStarts: counts.checkout_started,
      successfulPayments: confirmed.filter((doc) => Number(doc.data().amountDue) > 0).length,
      confirmedEnrollments: confirmed.length,
      conversionRate: counts.page_view ? Math.round((confirmed.length / counts.page_view) * 10000) / 100 : null,
      completionRate: confirmed.length ? Math.round((completed / confirmed.length) * 10000) / 100 : null,
      definitions: {
        pageViews: 'Evenements de vue de page recus, dedupliques par session et minute.',
        conversionRate: 'Inscriptions confirmees divisees par les vues collectees; non disponible sans vue.',
        completionRate: 'Inscriptions confirmees ayant atteint 100 % de progression.'
      }
    } });
  }));

  const getCourseAuditLog = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.query?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);
    const courseId = String(req.query?.courseId || '').trim();
    const snap = await db.collection('courseAuditLogs').where('organizationId', '==', organizationId).where('courseId', '==', courseId).get();
    const logs = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => Number(b.createdAt?.toMillis?.() || 0) - Number(a.createdAt?.toMillis?.() || 0)).slice(0, 50)
      .map((item) => ({ id: item.id, action: item.action, actorUid: item.actorUid, targetType: item.targetType, targetId: item.targetId, metadata: item.metadata || {}, createdAt: item.createdAt || null }));
    res.status(200).json({ ok: true, logs });
  }));

  /** Registers or renames a private course asset after Storage rules accepted the upload. */
  const saveCourseAsset = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);
    const courseId = String(req.body?.courseId || '').trim();
    const courseSnap = await db.collection('courses').doc(courseId).get();
    if (!courseSnap.exists || courseSnap.data().organizationId !== organizationId) throw new HttpError(404, 'course-not-found', 'Cours introuvable.');
    const assetId = String(req.body?.assetId || '').trim();
    let assetRef = assetId ? db.collection('courseAssets').doc(assetId) : null;
    if (assetId) {
      const current = await assetRef.get();
      if (!current.exists || current.data().organizationId !== organizationId) throw new HttpError(404, 'asset-not-found', 'Media introuvable.');
      await assetRef.set({ label: sanitizePlainText(req.body?.label, 160) || current.data().label, updatedAt: serverTimestamp(sstInternals) }, { merge: true });
      res.status(200).json({ ok: true, assetId });
      return;
    }
    const storagePath = String(req.body?.storagePath || '').trim();
    if (!storagePath.startsWith(`sst-courses/${courseId}/lessons/`)) throw new HttpError(400, 'asset-path-mismatch', 'Chemin media invalide pour ce cours.');
    assetRef = db.collection('courseAssets').doc(crypto.createHash('sha256').update(`${organizationId}:${storagePath}`).digest('hex'));
    const file = sstInternals.admin.storage().bucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) throw new HttpError(404, 'asset-file-not-found', 'Fichier Storage introuvable.');
    const [metadata] = await file.getMetadata();
    await assetRef.set({
      organizationId, courseId, storagePath,
      label: sanitizePlainText(req.body?.label, 160) || storagePath.split('/').pop(),
      originalName: sanitizePlainText(req.body?.originalName, 260) || null,
      contentType: String(metadata.contentType || 'application/octet-stream').slice(0, 160),
      sizeBytes: Math.max(0, Number(metadata.size) || 0), createdBy: decodedUser.uid,
      createdAt: serverTimestamp(sstInternals), updatedAt: serverTimestamp(sstInternals)
    }, { merge: true });
    res.status(200).json({ ok: true, assetId: assetRef.id });
  }));

  const listCourseAssets = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.query?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);
    const courseId = String(req.query?.courseId || '').trim();
    const [assetsSnap, lessonsSnap] = await Promise.all([
      db.collection('courseAssets').where('organizationId', '==', organizationId).where('courseId', '==', courseId).get(),
      db.collection('lessons').where('courseId', '==', courseId).get()
    ]);
    const usage = new Map();
    lessonsSnap.docs.forEach((doc) => { const path = doc.data().contentRef; if (path) { const list = usage.get(path) || []; list.push({ lessonId: doc.id, title: doc.data().title || 'Lecon' }); usage.set(path, list); } });
    const assets = assetsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data(), usedBy: usage.get(doc.data().storagePath) || [] }))
      .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'fr'));
    res.status(200).json({ ok: true, assets });
  }));

  const deleteCourseAsset = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);
    const assetId = String(req.body?.assetId || '').trim();
    const assetRef = db.collection('courseAssets').doc(assetId);
    const assetSnap = await assetRef.get();
    if (!assetSnap.exists || assetSnap.data().organizationId !== organizationId) throw new HttpError(404, 'asset-not-found', 'Media introuvable.');
    const asset = assetSnap.data();
    const used = await db.collection('lessons').where('courseId', '==', asset.courseId).where('contentRef', '==', asset.storagePath).limit(1).get();
    if (!used.empty) throw new HttpError(409, 'asset-in-use', 'Ce media est utilise par une lecon et ne peut pas etre supprime.');
    if (!asset.storagePath.startsWith(`sst-courses/${asset.courseId}/lessons/`)) throw new HttpError(409, 'asset-path-invalid', 'Chemin media historique invalide.');
    await sstInternals.admin.storage().bucket().file(asset.storagePath).delete({ ignoreNotFound: true });
    await assetRef.delete();
    await writeCourseAudit(db, sstInternals, { organizationId, courseId: asset.courseId, actorUid: decodedUser.uid, action: 'asset.deleted', targetType: 'courseAsset', targetId: assetId });
    res.status(200).json({ ok: true });
  }));

  /**
   * Public/authenticated enrollment request. Identity comes only from a verified
   * token; a body studentUid is intentionally ignored.
   * POST { courseId, studentEmail, studentName }
   */
  const enrollCourse = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const courseId = String(req.body?.courseId || '').trim();
    const courseSnap = await db.collection('courses').doc(courseId).get();
    if (!courseSnap.exists || courseSnap.data().status !== 'published') {
      throw new HttpError(404, 'course-not-found', 'Cours introuvable ou non publie.');
    }
    const course = courseSnap.data();
    const policy = course.enrollmentPolicy || {};
    const now = Date.now();
    if (policy.opensAt && new Date(policy.opensAt).getTime() > now) throw new HttpError(409, 'enrollment-not-open', 'Les inscriptions ne sont pas encore ouvertes.');
    if (policy.closesAt && new Date(policy.closesAt).getTime() <= now) throw new HttpError(409, 'enrollment-closed', 'Les inscriptions sont fermees.');

    const decodedUser = await requireBearerUser(req, sstInternals);
    const tokenEmail = normalizeEmail(decodedUser?.email);
    const studentEmail = tokenEmail || normalizeEmail(req.body?.studentEmail);
    if (!studentEmail) throw new HttpError(400, 'email-required', 'Email valide requis.');

    const existingSnap = await db.collection('enrollments')
      .where('courseId', '==', courseId)
      .where('studentEmail', '==', studentEmail)
      .where('status', 'in', ['pending_payment', 'confirmed'])
      .limit(1)
      .get();
    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0];
      if (existing.data().studentUid && existing.data().studentUid !== decodedUser?.uid) {
        throw new HttpError(409, 'enrollment-already-claimed', 'Cette inscription est deja rattachee a un autre compte.');
      }
      if (!existing.data().studentUid && decodedUser?.uid && tokenEmail === studentEmail) {
        await existing.ref.set({ studentUid: decodedUser.uid, updatedAt: serverTimestamp(sstInternals) }, { merge: true });
      }
      res.status(200).json({ ok: true, enrollmentId: existing.id, status: existing.data().status });
      return;
    }

    if (Number(policy.capacity) > 0) {
      const activeEnrollments = await db.collection('enrollments').where('courseId', '==', courseId).where('status', 'in', ['pending_payment', 'confirmed']).get();
      if (activeEnrollments.size >= Number(policy.capacity)) throw new HttpError(409, 'course-full', 'La limite d’inscriptions de ce cours est atteinte.');
    }

    const isFree = course.pricing?.type === 'free' || Number(course.price) === 0;
    const enrollmentRef = db.collection('enrollments').doc();
    await enrollmentRef.set({
      courseId,
      organizationId: course.organizationId,
      // Never trust a uid supplied by the request body. The MVP requires a
      // verified Firebase session before creating any enrollment.
      studentUid: decodedUser.uid,
      studentEmail,
      studentName: String(req.body?.studentName || '').trim(),
      amountDue: Number(course.price),
      pricingSnapshot: course.pricing || { type: isFree ? 'free' : 'fixed', amount: Number(course.price), currency: 'HTG' },
      accessPolicySnapshot: course.accessPolicy || { type: 'lifetime', durationDays: null },
      accessExpiresAt: isFree ? calculateAccessExpiration(course.accessPolicy) : null,
      progress: {},
      status: isFree ? 'confirmed' : 'pending_payment',
      paymentIntentId: null,
      createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({ ok: true, enrollmentId: enrollmentRef.id, status: isFree ? 'confirmed' : 'pending_payment' });
  }));

  /** Instructor dashboard: list enrollments for a course. */
  const listEnrollments = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.query?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);

    const courseId = String(req.query?.courseId || '').trim();
    let q = db.collection('enrollments').where('organizationId', '==', organizationId);
    if (courseId) q = q.where('courseId', '==', courseId);
    const snap = await q.get();
    res.status(200).json({ ok: true, enrollments: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  }));

  /** Student dashboard: list the caller's own confirmed enrollments. */
  const getMyEnrollments = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const snap = await db.collection('enrollments').where('studentUid', '==', decodedUser.uid).get();
    res.status(200).json({ ok: true, enrollments: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  }));

  /** Learner library with joined public course metadata and server progress. */
  const getMyCourseLibrary = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const snap = await db.collection('enrollments').where('studentUid', '==', decodedUser.uid).get();
    const enrollments = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const refundSnap = await db.collection('courseRefundRequests').where('studentUid', '==', decodedUser.uid).get();
    const refundByEnrollment = new Map(refundSnap.docs.map((doc) => [doc.data().enrollmentId, { id: doc.id, ...doc.data() }]));
    const courseIds = [...new Set(enrollments.map((item) => item.courseId).filter(Boolean))];
    const courseDocs = await Promise.all(courseIds.map((courseId) => db.collection('courses').doc(courseId).get()));
    const courseMap = new Map(courseDocs.filter((doc) => doc.exists).map((doc) => [doc.id, doc.data()]));
    const items = enrollments.map((enrollment) => {
      const course = courseMap.get(enrollment.courseId) || {};
      return {
        enrollmentId: enrollment.id,
        courseId: enrollment.courseId,
        title: course.title || 'Cours indisponible',
        subtitle: course.subtitle || course.shortDescription || course.description || null,
        coverImage: course.coverImage || null,
        instructorName: course.instructorName || null,
        status: enrollment.status,
        amountDue: Math.max(0, Number(enrollment.amountDue) || 0),
        refundPolicy: course.refundPolicy || null,
        refundRequest: refundByEnrollment.get(enrollment.id) || null,
        hasAccess: hasActiveEnrollmentAccess(enrollment),
        accessExpiresAt: enrollment.accessExpiresAt || null,
        completionPercentage: Number(enrollment.completionPercentage) || 0,
        lastLessonId: enrollment.lastLessonId || null,
        enrolledAt: enrollment.createdAt || null
      };
    });
    res.status(200).json({ ok: true, courses: items });
  }));

  /** Manual refund request only: records the request without moving money. */
  const requestCourseRefund = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const enrollmentId = String(req.body?.enrollmentId || '').trim();
    const reason = sanitizePlainText(req.body?.reason, 1000);
    const enrollmentSnap = await db.collection('enrollments').doc(enrollmentId).get();
    if (!enrollmentSnap.exists || enrollmentSnap.data().studentUid !== decodedUser.uid) {
      throw new HttpError(404, 'enrollment-not-found', 'Inscription introuvable.');
    }
    const enrollment = enrollmentSnap.data();
    if (enrollment.status !== 'confirmed' || Math.max(0, Number(enrollment.amountDue) || 0) <= 0) {
      throw new HttpError(409, 'refund-not-eligible', 'Cette inscription ne peut pas faire l’objet d’une demande de remboursement.');
    }
    const existing = await db.collection('courseRefundRequests').where('enrollmentId', '==', enrollmentId).where('status', '==', 'requested').limit(1).get();
    if (!existing.empty) {
      res.status(200).json({ ok: true, requestId: existing.docs[0].id, status: 'requested' });
      return;
    }
    const requestRef = db.collection('courseRefundRequests').doc();
    await requestRef.set({
      organizationId: enrollment.organizationId, courseId: enrollment.courseId, enrollmentId,
      studentUid: decodedUser.uid, reason: reason || null, status: 'requested',
      resolutionNote: null, createdAt: serverTimestamp(sstInternals), updatedAt: serverTimestamp(sstInternals)
    });
    await writeCourseAudit(db, sstInternals, { organizationId: enrollment.organizationId, courseId: enrollment.courseId, actorUid: decodedUser.uid, action: 'refund.requested', targetType: 'courseRefundRequest', targetId: requestRef.id, metadata: { enrollmentId } });
    res.status(200).json({ ok: true, requestId: requestRef.id, status: 'requested' });
  }));

  /** Role-controlled learner access actions. Financial refunds remain outside this endpoint. */
  const manageEnrollment = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);
    const enrollmentId = String(req.body?.enrollmentId || '').trim();
    const action = String(req.body?.action || '').trim();
    if (action === 'grant') {
      const courseId = String(req.body?.courseId || '').trim();
      const studentUid = String(req.body?.studentUid || '').trim();
      const studentEmail = normalizeEmail(req.body?.studentEmail);
      const courseSnap = await db.collection('courses').doc(courseId).get();
      if (!courseSnap.exists || courseSnap.data().organizationId !== organizationId) throw new HttpError(404, 'course-not-found', 'Cours introuvable.');
      if (!studentUid || !studentEmail) throw new HttpError(400, 'learner-identity-required', 'UID Firebase et email valide requis pour accorder un acces manuel.');
      const existing = await db.collection('enrollments').where('courseId', '==', courseId).where('studentUid', '==', studentUid).limit(1).get();
      const ref = existing.empty ? db.collection('enrollments').doc() : existing.docs[0].ref;
      const policy = courseSnap.data().accessPolicy || { type: 'lifetime' };
      await ref.set({
        organizationId, courseId, studentUid, studentEmail,
        studentName: sanitizePlainText(req.body?.studentName, 160) || null,
        status: 'confirmed', accessPolicySnapshot: policy, accessExpiresAt: calculateAccessExpiration(policy),
        updatedAt: serverTimestamp(sstInternals), ...(existing.empty ? { amountDue: 0, manualGrant: true, grantedBy: decodedUser.uid, createdAt: serverTimestamp(sstInternals), progress: {} } : {})
      }, { merge: true });
      await writeCourseAudit(db, sstInternals, { organizationId, courseId, actorUid: decodedUser.uid, action: 'enrollment.grant', targetType: 'enrollment', targetId: ref.id, metadata: { studentUid } });
      res.status(200).json({ ok: true, enrollmentId: ref.id });
      return;
    }
    const enrollmentRef = db.collection('enrollments').doc(enrollmentId);
    const enrollmentSnap = await enrollmentRef.get();
    if (!enrollmentSnap.exists || enrollmentSnap.data().organizationId !== organizationId) throw new HttpError(404, 'enrollment-not-found', 'Inscription introuvable.');
    const enrollment = enrollmentSnap.data();
    const update = { updatedAt: serverTimestamp(sstInternals) };
    if (action === 'suspend') update.status = 'suspended';
    else if (action === 'restore') update.status = 'confirmed';
    else if (action === 'extend') {
      const days = Math.max(1, Math.min(3650, Math.round(Number(req.body?.days) || 0)));
      const currentExpiry = enrollment.accessExpiresAt?.toMillis?.() || Date.now();
      update.accessExpiresAt = new Date(Math.max(Date.now(), currentExpiry) + (days * 24 * 60 * 60 * 1000));
      update.status = 'confirmed';
    } else if (action === 'note') update.internalNote = sanitizePlainText(req.body?.note, 2000) || null;
    else throw new HttpError(400, 'invalid-action', 'Action apprenant invalide.');
    await enrollmentRef.set(update, { merge: true });
    await writeCourseAudit(db, sstInternals, {
      organizationId, courseId: enrollment.courseId, actorUid: decodedUser.uid,
      action: `enrollment.${action}`, targetType: 'enrollment', targetId: enrollmentId,
      metadata: action === 'extend' ? { days: Math.max(1, Math.min(3650, Math.round(Number(req.body?.days) || 0))) } : {}
    });
    res.status(200).json({ ok: true });
  }));

  registerResourceResolver('enrollment', {
    applicationId: 'courses',
    collection: (firestore) => firestore.collection('enrollments'),
    validateResource: async (enrollment, context) => {
      if (!['pending_payment'].includes(enrollment.status)) {
        throw new HttpError(409, 'enrollment-not-payable', 'Cette inscription n’est pas en attente de paiement.');
      }
      if (enrollment.studentUid && enrollment.studentUid !== context.decodedUser?.uid) {
        throw new HttpError(403, 'enrollment-owner-mismatch', 'Cette inscription appartient a un autre compte.');
      }
    },
    computeAmount: (enrollment) => Number(enrollment.amountDue || 0),
    onConfirmed: async (firestore, intent, sstInternalsRef) => {
      const enrollmentRef = firestore.doc(intent.resourceRef);
      const enrollmentSnap = await enrollmentRef.get();
      const enrollment = enrollmentSnap.data() || {};
      const courseSnap = enrollment.courseId ? await firestore.collection('courses').doc(enrollment.courseId).get() : null;
      const policy = enrollment.accessPolicySnapshot || courseSnap?.data()?.accessPolicy || { type: 'lifetime' };
      await firestore.doc(intent.resourceRef).set({
        status: 'confirmed',
        accessExpiresAt: calculateAccessExpiration(policy),
        ...(intent.customerUid ? { studentUid: intent.customerUid } : {}),
        updatedAt: sstInternalsRef.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  });

  return {
    saveCourse, setCourseStatus, deleteCourse, saveCourseModule, deleteCourseModule, saveLesson, deleteLesson, getPublicCourse,
    getEnrolledCourseContent, getLessonMediaAccess, getLessonPreviewAccess, updateLessonProgress, getCoursePublishChecklist, getCourseOverview, enrollCourse, listEnrollments, getMyEnrollments,
    getMyCourseLibrary, requestCourseRefund, manageEnrollment, recordCourseAnalyticsEvent, getCourseAnalytics, getCourseAuditLog,
    saveCourseAsset, listCourseAssets, deleteCourseAsset
  };
}

module.exports = { registerCourseFunctions };
