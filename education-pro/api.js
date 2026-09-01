const BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';

async function call(name, user, { method = 'GET', body, query } = {}) {
  const url = new URL(`${BASE}/education${name}`);
  Object.entries(query || {}).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value); });
  // Avoid an unnecessary CORS preflight on public GET requests. JSON is only
  // needed for mutating calls; authenticated POSTs still send the same header.
  const headers = method === 'GET' ? {} : { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(url, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body || {}), signal: controller.signal });
  } catch (error) {
    throw new Error(error?.name === 'AbortError' ? 'Le serveur met trop de temps à répondre. Réessayez.' : 'Impossible de contacter le serveur. Vérifiez votre connexion.');
  } finally {
    clearTimeout(timeout);
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.ok) throw new Error(payload?.message || 'Action impossible.');
  return payload;
}

export function createEducationApi(user) {
  return {
    dashboard: (programId) => call('GetPublisherDashboard', user, { query: { programId } }),
    saveSchool: (body) => call('SaveSchool', user, { method: 'POST', body }),
    saveProgram: (body) => call('SaveProgram', user, { method: 'POST', body }),
    saveModule: (body) => call('SaveModule', user, { method: 'POST', body }),
    saveLesson: (body) => call('SaveLesson', user, { method: 'POST', body }),
    archive: (type, id) => call('ArchiveResource', user, { method: 'POST', body: { type, id } }),
    setStatus: (programId, status) => call('SetProgramStatus', user, { method: 'POST', body: { programId, status } }),
    saveAsset: (body) => call('SaveAsset', user, { method: 'POST', body })
  };
}

const demoSeed = {
  schools: [{ id: 'school-demo', name: 'Atelier Formation', ownerUid: 'demo', verification: { status: 'verified', label: 'Profil vérifié' }, shortDescription: 'Formations pratiques.' }],
  programs: [{ id: 'program-demo', schoolId: 'school-demo', ownerUid: 'demo', title: 'Lancer son activité', slug: 'lancer-son-activite', shortDescription: 'Une méthode claire pour structurer une offre.', fullDescription: '', categoryId: 'entrepreneuriat', level: 'beginner', modality: 'online', duration: { value: 6, unit: 'hours' }, schedule: '', prerequisites: '', learningOutcomes: ['Définir une offre claire', 'Fixer un prix cohérent'], targetAudience: ['Porteurs de projet'], instructor: { name: 'Marie Joseph', bio: '' }, price: { amount: 2500, currency: 'HTG', isOnRequest: false }, registration: { status: 'open', opensAt: null, closesAt: null }, capacity: { total: 40 }, terms: 'Accès personnel. Demandes étudiées sous 7 jours.', refundPolicy: 'Demande manuelle sous 7 jours.', image: './assets/education/hero-learning-v2.webp', publicationStatus: 'draft' }],
  modules: [{ id: 'module-demo', programId: 'program-demo', title: 'Fondations', description: '', order: 0, status: 'active' }],
  lessons: [{ id: 'lesson-demo', programId: 'program-demo', moduleId: 'module-demo', title: 'Clarifier son objectif', type: 'video', description: '', estimatedDurationMinutes: 18, status: 'ready', isFreePreview: true }],
  assets: [], students: [], analytics: { pageViews: 0, inquiries: 0, enrollments: 0, revenue: 0 }
};

function loadDemo() {
  try { return JSON.parse(localStorage.getItem('smartcut-education-pro-demo')) || structuredClone(demoSeed); } catch (_) { return structuredClone(demoSeed); }
}

function saveDemo(data) { localStorage.setItem('smartcut-education-pro-demo', JSON.stringify(data)); }
function id(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`; }
function checklist(program, modules, lessons) {
  const items = [
    ['identity', Boolean(program.title && program.shortDescription), 'Titre et résumé'], ['image', Boolean(program.image), 'Image de couverture'],
    ['instructor', Boolean(program.instructor?.name), 'Formateur'], ['module', modules.length > 0, 'Un module'], ['lesson', lessons.length > 0, 'Une leçon'],
    ['price', Boolean(program.price?.isOnRequest || Number(program.price?.amount) >= 0), 'Prix'], ['terms', Boolean(program.terms || program.refundPolicy), 'Conditions']
  ].map(([key, complete, label]) => ({ key, complete, label }));
  return { complete: items.every((item) => item.complete), completed: items.filter((item) => item.complete).length, total: items.length, items };
}

export function createDemoApi() {
  let data = loadDemo();
  return {
    async dashboard(programId) {
      const program = data.programs.find((item) => item.id === programId);
      const modules = data.modules.filter((item) => item.programId === programId && item.status !== 'archived');
      const lessons = data.lessons.filter((item) => item.programId === programId && item.status !== 'archived');
      return { ok: true, schools: data.schools, programs: data.programs.filter((item) => item.publicationStatus !== 'archived'), selected: program ? { ...program, modules, lessons, assets: data.assets.filter((item) => item.programId === programId), students: data.students.filter((item) => item.programId === programId), analytics: data.analytics, checklist: checklist(program, modules, lessons) } : null };
    },
    async saveSchool(body) { const schoolId = body.schoolId || id('school'); const current = data.schools.find((item) => item.id === schoolId); if (current) Object.assign(current, body); else data.schools.push({ ...body, id: schoolId, ownerUid: 'demo', verification: { status: 'verified', label: 'Profil vérifié' }, publicationStatus: 'draft' }); saveDemo(data); return { schoolId }; },
    async saveProgram(body) { const programId = body.programId || id('program'); const current = data.programs.find((item) => item.id === programId); if (current) Object.assign(current, body); else data.programs.push({ ...body, id: programId, ownerUid: 'demo', publicationStatus: 'draft' }); saveDemo(data); return { programId }; },
    async saveModule(body) { const moduleId = body.moduleId || id('module'); const current = data.modules.find((item) => item.id === moduleId); if (current) Object.assign(current, body); else data.modules.push({ ...body, id: moduleId, status: 'active' }); saveDemo(data); return { moduleId }; },
    async saveLesson(body) { const lessonId = body.lessonId || id('lesson'); const current = data.lessons.find((item) => item.id === lessonId); if (current) Object.assign(current, body); else data.lessons.push({ ...body, id: lessonId, status: body.status || 'draft' }); saveDemo(data); return { lessonId }; },
    async archive(type, resourceId) { const map = { program: data.programs, module: data.modules, lesson: data.lessons }; const item = map[type]?.find((entry) => entry.id === resourceId); if (item) item[type === 'program' ? 'publicationStatus' : 'status'] = 'archived'; saveDemo(data); return { ok: true }; },
    async setStatus(programId, status) { const item = data.programs.find((entry) => entry.id === programId); if (item) item.publicationStatus = status; saveDemo(data); return { ok: true, status }; },
    async saveAsset(body) { const assetId = id('asset'); data.assets.push({ ...body, id: assetId, size: body.size || 0, contentType: body.contentType || 'application/octet-stream' }); saveDemo(data); return { assetId }; }
  };
}
