import { auth, googleProvider, authReadyPromise } from '../../firebase-init.js';
import { signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { callSst, escapeHtml } from '../api.js';
import { openPromptDialog } from '../dashboard/shared/dialog.js';

const root = document.getElementById('learnerApp');
let library = [];
let courseContent = null;
let activeCourse = null;
let activeLesson = null;

function shell(content, options = {}) {
  return `<div class="sst-learner-shell">
    <header class="sst-learner-header"><a href="./learn.html"><i class="fas fa-graduation-cap"></i> SmartSolutionTek</a><div><span>${escapeHtml(auth.currentUser?.email || '')}</span>${auth.currentUser ? '<button data-profile>Profil</button><button data-signout>Déconnexion</button>' : ''}</div></header>
    ${options.reader ? content : `<main class="sst-learner-main">${content}</main>`}
  </div>`;
}

function bindHeader() {
  root.querySelector('[data-signout]')?.addEventListener('click', async () => { await signOut(auth); await boot(); });
  root.querySelector('[data-profile]')?.addEventListener('click', renderProfile);
}

function renderProfile() {
  const user = auth.currentUser;
  root.innerHTML = shell(`<section class="sst-learner-profile"><a href="./learn.html"><i class="fas fa-arrow-left"></i> Mes cours</a><span>PARAMÈTRES DU PROFIL</span><h1>Mon profil</h1><div class="sst-course-panel"><dl><div><dt>Nom</dt><dd>${escapeHtml(user?.displayName || 'Non renseigné')}</dd></div><div><dt>Email du compte</dt><dd>${escapeHtml(user?.email || 'Non disponible')}</dd></div></dl><p class="sst-info-banner"><i class="fas fa-shield-halved"></i> L’identité du compte est gérée par Firebase Authentication. SmartSolutionTek ne permet pas de remplacer l’UID depuis le navigateur.</p></div></section>`);
  bindHeader();
}

function renderSignedOut() {
  root.innerHTML = shell(`<section class="sst-learner-welcome"><span>ESPACE APPRENANT</span><h1>Vos formations, au même endroit.</h1><p>Connectez-vous avec le compte utilisé lors de votre inscription.</p><button class="sst-btn sst-btn-primary" data-login><i class="fab fa-google"></i> Continuer avec Google</button></section>`);
  root.querySelector('[data-login]').addEventListener('click', async () => {
    try { await signInWithPopup(auth, googleProvider); await loadLibrary(); } catch (error) { if (error?.code !== 'auth/popup-closed-by-user') renderError('Connexion impossible. Réessayez.'); }
  });
}

function renderError(message) {
  root.innerHTML = shell(`<main class="sst-learner-main"><div class="sst-error">${escapeHtml(message)}</div><a class="sst-btn sst-btn-secondary" href="./learn.html">Réessayer</a></main>`);
  bindHeader();
}

function accessLabel(item) {
  if (!item.hasAccess) return item.status === 'confirmed' ? 'Accès expiré' : 'Paiement en attente';
  if (!item.accessExpiresAt) return 'Accès permanent';
  const date = item.accessExpiresAt?.seconds ? new Date(item.accessExpiresAt.seconds * 1000) : new Date(item.accessExpiresAt);
  return `Accès jusqu’au ${date.toLocaleDateString('fr-FR')}`;
}

function renderLibrary() {
  const cards = library.length ? library.map((item) => `<article class="sst-learner-card">
    <div class="sst-learner-card-cover">${item.coverImage ? `<img src="${escapeHtml(item.coverImage)}" alt="">` : '<i class="fas fa-book-open"></i>'}</div>
    <div><span class="sst-badge ${item.hasAccess ? 'published' : 'draft'}">${escapeHtml(accessLabel(item))}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.subtitle || 'Formation en ligne')}</p><progress max="100" value="${Number(item.completionPercentage) || 0}"></progress><small>${Number(item.completionPercentage) || 0}% terminé</small><button class="sst-btn sst-btn-primary" data-open-course="${escapeHtml(item.courseId)}" ${item.hasAccess ? '' : 'disabled'}>${item.completionPercentage ? 'Continuer' : 'Commencer'}</button></div>
  </article>`).join('') : '<div class="sst-course-empty-state"><i class="fas fa-book-open"></i><h3>Aucune formation confirmée</h3><p>Après une inscription gratuite ou un paiement confirmé, votre cours apparaîtra ici.</p></div>';
  root.innerHTML = shell(`<header class="sst-learner-heading"><span>MA BIBLIOTHÈQUE</span><h1>Mes formations</h1><p>Reprenez exactement là où vous vous êtes arrêté.</p></header><section class="sst-learner-grid">${cards}</section>`);
  bindHeader();
  root.querySelectorAll('[data-open-course]').forEach((button) => button.addEventListener('click', () => openCourse(button.dataset.openCourse)));
}

async function loadLibrary() {
  root.innerHTML = '<div class="sst-loading">Chargement de votre bibliothèque…</div>';
  try {
    const result = await callSst('GetMyCourseLibrary', { auth: auth.currentUser });
    library = result.courses || [];
    renderLibrary();
  } catch (error) { renderError(error.message); }
}

function lessonList() {
  return (courseContent.modules || []).flatMap((module) => (module.lessons || []).map((lesson) => ({ ...lesson, moduleTitle: module.title })));
}

async function openCourse(courseId) {
  activeCourse = library.find((item) => item.courseId === courseId);
  root.innerHTML = '<div class="sst-loading">Ouverture du cours…</div>';
  try {
    courseContent = await callSst('GetEnrolledCourseContent', { query: { courseId }, auth: auth.currentUser });
    const lessons = lessonList();
    activeLesson = lessons.find((item) => item.id === activeCourse.lastLessonId) || lessons[0] || null;
    renderCourseDetail();
  } catch (error) { renderError(error.message); }
}

function renderCourseDetail() {
  const lessons = lessonList();
  const progress = Number(activeCourse.completionPercentage) || 0;
  const refundStatus = activeCourse.refundRequest?.status;
  const refundBlock = Number(activeCourse.amountDue) > 0 ? `<div class="sst-course-panel sst-learner-refund"><h2>Remboursement</h2>${activeCourse.refundPolicy ? `<p>${escapeHtml(activeCourse.refundPolicy)}</p>` : '<p>Les demandes sont étudiées manuellement selon les conditions de vente du créateur.</p>'}${refundStatus ? `<span class="sst-badge ${refundStatus === 'approved' ? 'published' : 'draft'}">Demande : ${escapeHtml(refundStatus === 'requested' ? 'en cours d’étude' : refundStatus)}</span>` : '<button class="sst-btn sst-btn-secondary" data-request-refund>Demander un remboursement</button>'}<small>Aucun remboursement n’est exécuté automatiquement depuis cette page.</small></div>` : '';
  root.innerHTML = shell(`<section class="sst-learner-detail"><a href="./learn.html"><i class="fas fa-arrow-left"></i> Mes cours</a><div class="sst-learner-detail-hero"><div><span>VOTRE FORMATION</span><h1>${escapeHtml(activeCourse.title)}</h1><p>${escapeHtml(activeCourse.subtitle || '')}</p><progress max="100" value="${progress}"></progress><small>${progress}% terminé · ${lessons.length} leçon${lessons.length === 1 ? '' : 's'}</small><button class="sst-btn sst-btn-primary" data-start-reader>${progress ? 'Continuer la formation' : 'Commencer la formation'}</button></div>${activeCourse.coverImage ? `<img src="${escapeHtml(activeCourse.coverImage)}" alt="">` : '<div class="sst-learner-detail-cover"><i class="fas fa-book-open"></i></div>'}</div><div class="sst-course-panel"><h2>Programme</h2>${(courseContent.modules || []).map((module) => `<div class="sst-learner-detail-module"><strong>${escapeHtml(module.title)}</strong><span>${(module.lessons || []).length} leçon${(module.lessons || []).length === 1 ? '' : 's'}</span></div>`).join('') || '<div class="sst-empty">Aucune leçon publiée.</div>'}</div>${refundBlock}</section>`);
  bindHeader();
  root.querySelector('[data-start-reader]')?.addEventListener('click', renderReader);
  root.querySelector('[data-request-refund]')?.addEventListener('click', async () => {
    const reason = await openPromptDialog({ title: 'Demander un remboursement', label: 'Expliquez brièvement votre demande', confirmLabel: 'Envoyer la demande' });
    if (!reason) return;
    const button = root.querySelector('[data-request-refund]');
    button.disabled = true;
    try {
      const result = await callSst('RequestCourseRefund', { method: 'POST', auth: auth.currentUser, body: { enrollmentId: activeCourse.enrollmentId, reason } });
      activeCourse.refundRequest = { id: result.requestId, status: result.status };
      renderCourseDetail();
    } catch (error) {
      button.disabled = false;
      button.insertAdjacentHTML('afterend', `<div class="sst-error">${escapeHtml(error.message)}</div>`);
    }
  });
}

async function lessonMedia(lesson) {
  if (lesson.type === 'text') return lesson.content ? `<div class="sst-learner-text">${escapeHtml(lesson.content)}</div>` : '<div class="sst-empty">Cette leçon ne contient pas encore de texte.</div>';
  if (!lesson.contentAvailable) return '<div class="sst-empty">Le média de cette leçon n’est pas encore disponible.</div>';
  try {
    const access = await callSst('GetLessonMediaAccess', { query: { courseId: activeCourse.courseId, lessonId: lesson.id }, auth: auth.currentUser });
    const url = escapeHtml(access.url);
    if (lesson.type === 'video') return `<video class="sst-learner-video" controls controlsList="nodownload" src="${url}"></video>`;
    if (lesson.type === 'audio') return `<audio class="sst-learner-audio" controls controlsList="nodownload" src="${url}"></audio>`;
    return `<div class="sst-learner-file"><i class="fas fa-file-arrow-down"></i><p>Ce document est disponible via un lien privé de courte durée.</p><a class="sst-btn sst-btn-secondary" href="${url}" target="_blank" rel="noopener">${lesson.allowDownload ? 'Ouvrir ou télécharger' : 'Ouvrir le document'}</a></div>`;
  } catch (error) { return `<div class="sst-error">${escapeHtml(error.message)}</div>`; }
}

async function renderReader() {
  const lessons = lessonList();
  const currentIndex = Math.max(0, lessons.findIndex((item) => item.id === activeLesson?.id));
  const progress = courseContent.progress || {};
  const media = activeLesson ? await lessonMedia(activeLesson) : '<div class="sst-empty">Aucune leçon publiée.</div>';
  const sidebar = (courseContent.modules || []).map((module) => `<section><h3>${escapeHtml(module.title)}</h3>${(module.lessons || []).map((lesson) => `<button class="${lesson.id === activeLesson?.id ? 'active' : ''}" data-lesson="${escapeHtml(lesson.id)}"><i class="fas ${progress[lesson.id] ? 'fa-circle-check' : 'fa-circle'}"></i><span>${escapeHtml(lesson.title)}</span></button>`).join('')}</section>`).join('');
  const content = `<div class="sst-learner-reader"><aside class="sst-learner-reader-sidebar"><a href="./learn.html"><i class="fas fa-arrow-left"></i> Bibliothèque</a><h2>${escapeHtml(activeCourse.title)}</h2>${sidebar}</aside><main class="sst-learner-reader-main"><header><button data-reader-menu aria-label="Programme"><i class="fas fa-bars"></i></button><div><span>${escapeHtml(activeLesson?.moduleTitle || '')}</span><h1>${escapeHtml(activeLesson?.title || 'Cours')}</h1></div></header><article>${activeLesson?.description ? `<p class="sst-learner-lesson-description">${escapeHtml(activeLesson.description)}</p>` : ''}${media}</article><footer><button class="sst-btn sst-btn-secondary" data-prev ${currentIndex <= 0 ? 'disabled' : ''}>Leçon précédente</button>${activeLesson ? `<button class="sst-btn sst-btn-primary" data-complete>${progress[activeLesson.id] ? 'Marquer comme non terminée' : 'Marquer comme terminée'}</button>` : ''}<button class="sst-btn sst-btn-secondary" data-next ${currentIndex >= lessons.length - 1 ? 'disabled' : ''}>Leçon suivante</button></footer></main></div>`;
  root.innerHTML = shell(content, { reader: true });
  bindHeader();
  root.querySelectorAll('[data-lesson]').forEach((button) => button.addEventListener('click', async () => { activeLesson = lessons.find((item) => item.id === button.dataset.lesson); await renderReader(); }));
  root.querySelector('[data-prev]')?.addEventListener('click', async () => { activeLesson = lessons[currentIndex - 1]; await renderReader(); });
  root.querySelector('[data-next]')?.addEventListener('click', async () => { activeLesson = lessons[currentIndex + 1]; await renderReader(); });
  root.querySelector('[data-reader-menu]')?.addEventListener('click', () => root.querySelector('.sst-learner-reader-sidebar').classList.toggle('open'));
  root.querySelector('[data-complete]')?.addEventListener('click', async () => {
    const completed = !progress[activeLesson.id];
    try { await callSst('UpdateLessonProgress', { method: 'POST', auth: auth.currentUser, body: { courseId: activeCourse.courseId, lessonId: activeLesson.id, completed } }); courseContent.progress[activeLesson.id] = completed; await renderReader(); } catch (error) { renderError(error.message); }
  });
}

async function boot() {
  await authReadyPromise;
  if (!auth.currentUser) { renderSignedOut(); return; }
  await loadLibrary();
}

boot();
