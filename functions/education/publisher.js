'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { HttpError, requireBearerUser, withErrorHandling } = require('../smartsolutiontek/auth');
const {
  normalizeSchoolInput, normalizeProgramInput, normalizeModuleInput,
  normalizeLessonInput, buildPublishChecklist, text
} = require('./lib/publisher-domain');

function registerEducationPublisherFunctions({ db, sstInternals, region }) {
  const stamp = () => sstInternals.admin.firestore.FieldValue.serverTimestamp();

  async function owned(ref, uid, label) {
    const snap = await ref.get();
    if (!snap.exists || snap.data().ownerUid !== uid) throw new HttpError(404, `${label}-not-found`, 'Ressource introuvable.');
    return snap;
  }

  async function audit(uid, action, data = {}) {
    await db.collection('educationAuditLogs').add({ ownerUid: uid, action, ...data, createdAt: stamp() });
  }

  async function programTree(programId, uid) {
    const [modulesSnap, lessonsSnap, assetsSnap] = await Promise.all([
      db.collection('educationProgramModules').where('programId', '==', programId).get(),
      db.collection('educationProgramLessons').where('programId', '==', programId).get(),
      db.collection('educationProgramAssets').where('programId', '==', programId).get()
    ]);
    const modules = modulesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => item.ownerUid === uid && item.status !== 'archived').sort((a, b) => a.order - b.order);
    const lessons = lessonsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => item.ownerUid === uid && item.status !== 'archived').sort((a, b) => a.order - b.order);
    const assets = assetsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => item.ownerUid === uid).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return { modules, lessons, assets };
  }

  const getPublisherDashboard = onRequest({ region }, withErrorHandling(async (req, res) => {
    const user = await requireBearerUser(req, sstInternals);
    const programId = text(req.query?.programId, 160);
    const [schoolsSnap, programsSnap] = await Promise.all([
      db.collection('educationSchools').where('ownerUid', '==', user.uid).get(),
      db.collection('educationPrograms').where('ownerUid', '==', user.uid).get()
    ]);
    const schools = schoolsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const programs = programsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    let selected = null;
    if (programId) {
      const program = programs.find((item) => item.id === programId);
      if (!program) throw new HttpError(404, 'program-not-found', 'Cours introuvable.');
      const tree = await programTree(programId, user.uid);
      const [studentsSnap, eventsSnap] = await Promise.all([
        db.collection('educationEnrollments').where('programId', '==', programId).get(),
        db.collection('educationAnalyticsEvents').where('programId', '==', programId).get()
      ]);
      const students = studentsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => item.ownerUid === user.uid);
      const events = eventsSnap.docs.map((doc) => doc.data()).filter((item) => item.ownerUid === user.uid);
      selected = { ...program, ...tree, students, analytics: { pageViews: events.filter((item) => item.type === 'page_view').length, inquiries: events.filter((item) => item.type === 'inquiry').length, enrollments: students.length, revenue: students.filter((item) => item.paymentStatus === 'paid').reduce((sum, item) => sum + (Number(item.amount) || 0), 0) } };
      selected.checklist = buildPublishChecklist(selected, { modules: tree.modules.length, lessons: tree.lessons.length });
    }
    res.status(200).json({ ok: true, schools, programs, selected });
  }));

  const saveSchool = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const schoolId = text(req.body?.schoolId, 160);
    const ref = schoolId ? db.collection('educationSchools').doc(schoolId) : db.collection('educationSchools').doc();
    const current = schoolId ? await owned(ref, user.uid, 'school') : null;
    let input;
    try { input = normalizeSchoolInput(req.body, current?.data() || {}); } catch (error) { throw new HttpError(400, error.code || 'invalid-school', error.message); }
    await ref.set({ ...input, ownerUid: user.uid, publicationStatus: current?.data().publicationStatus || 'draft', verification: current?.data().verification || { status: 'unverified', label: 'Profil à vérifier' }, updatedAt: stamp(), ...(current ? {} : { createdAt: stamp() }) }, { merge: true });
    await audit(user.uid, schoolId ? 'school.updated' : 'school.created', { schoolId: ref.id });
    res.status(200).json({ ok: true, schoolId: ref.id });
  }));

  const saveProgram = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const programId = text(req.body?.programId, 160);
    const schoolId = text(req.body?.schoolId, 160);
    if (!schoolId) throw new HttpError(400, 'school-required', 'Profil professionnel requis.');
    await owned(db.collection('educationSchools').doc(schoolId), user.uid, 'school');
    const ref = programId ? db.collection('educationPrograms').doc(programId) : db.collection('educationPrograms').doc();
    const current = programId ? await owned(ref, user.uid, 'program') : null;
    let input;
    try { input = normalizeProgramInput(req.body, current?.data() || {}); } catch (error) { throw new HttpError(400, error.code || 'invalid-program', error.message); }
    await ref.set({ ...input, ownerUid: user.uid, schoolId, publicationStatus: current?.data().publicationStatus || 'draft', updatedAt: stamp(), ...(current ? {} : { createdAt: stamp() }) }, { merge: true });
    await audit(user.uid, programId ? 'program.updated' : 'program.created', { programId: ref.id, schoolId });
    res.status(200).json({ ok: true, programId: ref.id });
  }));

  const saveModule = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const programId = text(req.body?.programId, 160);
    await owned(db.collection('educationPrograms').doc(programId), user.uid, 'program');
    const moduleId = text(req.body?.moduleId, 160);
    const ref = moduleId ? db.collection('educationProgramModules').doc(moduleId) : db.collection('educationProgramModules').doc();
    const current = moduleId ? await owned(ref, user.uid, 'module') : null;
    let input;
    try { input = normalizeModuleInput(req.body, current?.data() || {}); } catch (error) { throw new HttpError(400, error.code || 'invalid-module', error.message); }
    await ref.set({ ...input, ownerUid: user.uid, programId, updatedAt: stamp(), ...(current ? {} : { createdAt: stamp() }) }, { merge: true });
    await audit(user.uid, moduleId ? 'module.updated' : 'module.created', { programId, moduleId: ref.id });
    res.status(200).json({ ok: true, moduleId: ref.id });
  }));

  const saveLesson = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const programId = text(req.body?.programId, 160);
    const moduleId = text(req.body?.moduleId, 160);
    await owned(db.collection('educationPrograms').doc(programId), user.uid, 'program');
    const moduleSnap = await owned(db.collection('educationProgramModules').doc(moduleId), user.uid, 'module');
    if (moduleSnap.data().programId !== programId) throw new HttpError(409, 'module-program-mismatch', 'Module invalide.');
    const lessonId = text(req.body?.lessonId, 160);
    const ref = lessonId ? db.collection('educationProgramLessons').doc(lessonId) : db.collection('educationProgramLessons').doc();
    const current = lessonId ? await owned(ref, user.uid, 'lesson') : null;
    let input;
    try { input = normalizeLessonInput(req.body, current?.data() || {}); } catch (error) { throw new HttpError(400, error.code || 'invalid-lesson', error.message); }
    await ref.set({ ...input, ownerUid: user.uid, programId, moduleId, updatedAt: stamp(), ...(current ? {} : { createdAt: stamp() }) }, { merge: true });
    await audit(user.uid, lessonId ? 'lesson.updated' : 'lesson.created', { programId, moduleId, lessonId: ref.id });
    res.status(200).json({ ok: true, lessonId: ref.id });
  }));

  const archiveResource = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const type = text(req.body?.type, 30);
    const id = text(req.body?.id, 160);
    const collections = { program: 'educationPrograms', module: 'educationProgramModules', lesson: 'educationProgramLessons' };
    if (!collections[type]) throw new HttpError(400, 'invalid-resource-type', 'Type invalide.');
    const ref = db.collection(collections[type]).doc(id);
    const snap = await owned(ref, user.uid, type);
    const update = type === 'program' ? { publicationStatus: 'archived' } : { status: 'archived' };
    await ref.set({ ...update, updatedAt: stamp() }, { merge: true });
    await audit(user.uid, `${type}.archived`, { resourceId: id, programId: type === 'program' ? id : snap.data().programId });
    res.status(200).json({ ok: true });
  }));

  const setProgramStatus = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const programId = text(req.body?.programId, 160);
    const status = text(req.body?.status, 30);
    if (!['draft', 'review', 'published'].includes(status)) throw new HttpError(400, 'invalid-status', 'Statut invalide.');
    const ref = db.collection('educationPrograms').doc(programId);
    const snap = await owned(ref, user.uid, 'program');
    const tree = await programTree(programId, user.uid);
    const checklist = buildPublishChecklist(snap.data(), { modules: tree.modules.length, lessons: tree.lessons.length });
    if (status !== 'draft' && !checklist.complete) throw new HttpError(409, 'program-incomplete', 'Complétez la checklist avant soumission.');
    if (status === 'published') {
      const school = await owned(db.collection('educationSchools').doc(snap.data().schoolId), user.uid, 'school');
      if (school.data().verification?.status !== 'verified') throw new HttpError(403, 'school-verification-required', 'La vérification du profil est requise.');
    }
    const publicCurriculum = tree.modules.map((module) => ({
      title: text(module.title, 160),
      description: text(module.description, 500),
      lessons: tree.lessons.filter((lesson) => lesson.moduleId === module.id).map((lesson) => ({
        title: text(lesson.title, 160),
        type: lesson.type,
        estimatedDurationMinutes: Number(lesson.estimatedDurationMinutes) || 0,
        isFreePreview: lesson.isFreePreview === true
      }))
    }));
    await ref.set({ publicationStatus: status, publishChecklist: checklist, publicCurriculum, updatedAt: stamp(), ...(status === 'published' ? { publishedAt: stamp() } : {}) }, { merge: true });
    await audit(user.uid, `program.${status}`, { programId });
    res.status(200).json({ ok: true, status, checklist });
  }));

  const saveAsset = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const user = await requireBearerUser(req, sstInternals);
    const programId = text(req.body?.programId, 160);
    await owned(db.collection('educationPrograms').doc(programId), user.uid, 'program');
    const path = text(req.body?.path, 500);
    const allowedPrefix = `education-content/${user.uid}/${programId}/`;
    if (!path.startsWith(allowedPrefix)) throw new HttpError(400, 'invalid-asset-path', 'Chemin média invalide.');
    const file = sstInternals.admin.storage().bucket().file(path);
    const [exists] = await file.exists();
    if (!exists) throw new HttpError(404, 'asset-not-found', 'Fichier introuvable.');
    const [meta] = await file.getMetadata();
    const ref = db.collection('educationProgramAssets').doc();
    await ref.set({ ownerUid: user.uid, programId, path, label: text(req.body?.label || meta.name?.split('/').pop(), 160), contentType: meta.contentType || null, size: Number(meta.size) || 0, createdAt: stamp(), updatedAt: stamp() });
    await audit(user.uid, 'asset.created', { programId, assetId: ref.id });
    res.status(200).json({ ok: true, assetId: ref.id });
  }));

  return { getPublisherDashboard, saveSchool, saveProgram, saveModule, saveLesson, archiveResource, setProgramStatus, saveAsset };
}

module.exports = function buildEducationPublisher(sstInternals) {
  const functions = registerEducationPublisherFunctions({ db: sstInternals.db, sstInternals, region: sstInternals.REGION });
  const result = {};
  for (const [name, fn] of Object.entries(functions)) result[`education${name.charAt(0).toUpperCase()}${name.slice(1)}`] = fn;
  return result;
};
