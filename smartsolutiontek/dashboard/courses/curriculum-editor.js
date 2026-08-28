import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { openDialog, openPromptDialog } from '../shared/dialog.js';
import { openLessonEditor } from './lesson-editor.js';

export async function renderCurriculumEditor(container, context) {
  container.innerHTML = `<section class="sst-curriculum-page"><div class="sst-course-view-heading"><div><span class="sst-app-kicker">Contenu</span><h1>Programme du cours</h1><p>Structurez les modules et les leçons. Utilisez Monter et Descendre pour un ordre accessible.</p></div><button class="sst-btn sst-btn-primary" data-add-module><i class="fas fa-plus"></i> Ajouter un module</button></div><div data-curriculum><div class="sst-loading">Chargement du programme…</div></div></section>`;
  const load = async () => {
    const [moduleSnapshot, lessonSnapshot] = await Promise.all([
      getDocs(query(collection(context.db, 'courseModules'), where('organizationId', '==', context.organization.id), where('courseId', '==', context.state.course.id))),
      getDocs(query(collection(context.db, 'lessons'), where('organizationId', '==', context.organization.id), where('courseId', '==', context.state.course.id)))
    ]);
    const modules = moduleSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => item.status !== 'archived').sort((a,b) => a.order - b.order);
    const lessons = lessonSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => item.status !== 'archived');
    renderTree(container.querySelector('[data-curriculum]'), modules, lessons, context, load);
    return { modules, lessons };
  };
  container.querySelector('[data-add-module]').addEventListener('click', async () => {
    const title = await openPromptDialog({ title: 'Nouveau module', label: 'Titre du module' }); if (!title) return;
    try { await context.api.saveModule({ organizationId: context.organization.id, courseId: context.state.course.id, title, order: Date.now() }); context.toast('Module ajouté.'); await load(); }
    catch (error) { context.toast(error.message, 'error'); }
  });
  try { await load(); } catch (error) { container.querySelector('[data-curriculum]').innerHTML = `<div class="sst-error">${context.escapeHtml(error.message)}</div>`; }
}

function renderTree(root, modules, lessons, context, reload) {
  if (!modules.length) { root.innerHTML = '<div class="sst-course-empty-state"><i class="fas fa-list-check"></i><h3>Aucun module</h3><p>Ajoutez un premier module pour commencer votre programme.</p></div>'; return; }
  root.innerHTML = `<div class="sst-curriculum-list">${modules.map((module, moduleIndex) => {
    const items = lessons.filter((lesson) => lesson.moduleId === module.id).sort((a,b) => a.order - b.order);
    return `<article class="sst-curriculum-module">
      <header><div class="sst-module-number">${moduleIndex + 1}</div><div><small>Module</small><h2>${context.escapeHtml(module.title)}</h2><span>${items.length} leçon${items.length === 1 ? '' : 's'}</span></div><div class="sst-module-actions"><button data-module-up="${module.id}" ${moduleIndex === 0 ? 'disabled' : ''} aria-label="Monter le module"><i class="fas fa-arrow-up"></i></button><button data-module-down="${module.id}" ${moduleIndex === modules.length - 1 ? 'disabled' : ''} aria-label="Descendre le module"><i class="fas fa-arrow-down"></i></button><button data-module-rename="${module.id}" aria-label="Renommer"><i class="fas fa-pen"></i></button><button data-module-duplicate="${module.id}" aria-label="Dupliquer"><i class="fas fa-copy"></i></button><button class="danger" data-module-delete="${module.id}" aria-label="Supprimer"><i class="fas fa-trash"></i></button></div></header>
      <div class="sst-curriculum-lessons">${items.map((lesson, index) => lessonRow(lesson, index, items.length, module, context)).join('') || '<div class="sst-course-empty-inline">Aucune leçon dans ce module.</div>'}</div>
      <button class="sst-add-lesson" data-add-lesson="${module.id}"><i class="fas fa-plus"></i> Ajouter une leçon</button>
    </article>`;
  }).join('')}</div>`;

  root.querySelectorAll('[data-add-lesson]').forEach((button) => button.addEventListener('click', () => openLessonEditor({ ...context, onSaved: reload }, { moduleId: button.dataset.addLesson, modules }).catch((error) => context.toast(error.message, 'error'))));
  root.querySelectorAll('[data-edit-lesson]').forEach((button) => button.addEventListener('click', () => openLessonEditor({ ...context, onSaved: reload }, { moduleId: button.dataset.moduleId, lessonId: button.dataset.editLesson, modules }).catch((error) => context.toast(error.message, 'error'))));
  root.querySelectorAll('[data-duplicate-lesson]').forEach((button) => button.addEventListener('click', () => openLessonEditor({ ...context, onSaved: reload }, { moduleId: button.dataset.moduleId, lessonId: button.dataset.duplicateLesson, modules, duplicate: true }).catch((error) => context.toast(error.message, 'error'))));
  root.querySelectorAll('[data-delete-lesson]').forEach((button) => button.addEventListener('click', async () => {
    if (!await openDialog({ title: 'Supprimer cette leçon ?', message: 'Si des apprenants possèdent déjà le cours, la leçon sera archivée afin de préserver leur historique.', confirmLabel: 'Supprimer ou archiver', danger: true })) return;
    try { await context.api.deleteLesson({ organizationId: context.organization.id, lessonId: button.dataset.deleteLesson }); context.toast('Leçon supprimée ou archivée.'); await reload(); } catch (error) { context.toast(error.message, 'error'); }
  }));
  root.querySelectorAll('[data-module-rename]').forEach((button) => button.addEventListener('click', async () => {
    const module = modules.find((item) => item.id === button.dataset.moduleRename); const title = await openPromptDialog({ title: 'Renommer le module', label: 'Titre', value: module.title }); if (!title) return;
    await context.api.saveModule({ organizationId: context.organization.id, courseId: context.state.course.id, moduleId: module.id, title, order: module.order }); await reload();
  }));
  root.querySelectorAll('[data-module-delete]').forEach((button) => button.addEventListener('click', async () => {
    if (!await openDialog({ title: 'Supprimer ce module ?', message: 'Toutes ses leçons seront supprimées ou archivées avec lui. L’historique apprenant sera préservé.', confirmLabel: 'Supprimer ou archiver', danger: true })) return;
    try { await context.api.deleteModule({ organizationId: context.organization.id, moduleId: button.dataset.moduleDelete }); context.toast('Module supprimé ou archivé.'); await reload(); } catch (error) { context.toast(error.message, 'error'); }
  }));
  root.querySelectorAll('[data-module-up],[data-module-down]').forEach((button) => button.addEventListener('click', () => reorderModule(button, modules, context, reload)));
  root.querySelectorAll('[data-lesson-up],[data-lesson-down]').forEach((button) => button.addEventListener('click', () => reorderLesson(button, lessons, context, reload)));
  root.querySelectorAll('[data-module-duplicate]').forEach((button) => button.addEventListener('click', async () => {
    const source = modules.find((item) => item.id === button.dataset.moduleDuplicate);
    try { const result = await context.api.saveModule({ organizationId: context.organization.id, courseId: context.state.course.id, title: `${source.title} — copie`, order: Date.now() }); const sourceLessons = lessons.filter((item) => item.moduleId === source.id); for (const lesson of sourceLessons) await context.api.saveLesson({ ...lesson, organizationId: context.organization.id, moduleId: result.moduleId, lessonId: undefined, title: lesson.title, contentRef: lesson.contentRef || '', order: lesson.order }); context.toast('Module dupliqué.'); await reload(); } catch (error) { context.toast(error.message, 'error'); }
  }));
}

function lessonRow(lesson, index, count, module, context) {
  return `<div class="sst-curriculum-lesson"><span class="sst-lesson-type"><i class="fas ${typeIcon(lesson.type)}"></i></span><div><strong>${context.escapeHtml(lesson.title)}</strong><small>${context.escapeHtml(lesson.type)} · ${Number(lesson.estimatedDurationMinutes) || 0} min ${lesson.isFreePreview ? '· aperçu gratuit' : ''}</small></div><span class="sst-badge ${context.escapeHtml(lesson.status || 'published')}">${context.escapeHtml(lesson.status || 'publiée')}</span><div class="sst-lesson-actions"><button data-lesson-up="${lesson.id}" data-module-id="${module.id}" ${index === 0 ? 'disabled' : ''} aria-label="Monter"><i class="fas fa-arrow-up"></i></button><button data-lesson-down="${lesson.id}" data-module-id="${module.id}" ${index === count - 1 ? 'disabled' : ''} aria-label="Descendre"><i class="fas fa-arrow-down"></i></button><button data-edit-lesson="${lesson.id}" data-module-id="${module.id}" aria-label="Modifier"><i class="fas fa-pen"></i></button><button data-duplicate-lesson="${lesson.id}" data-module-id="${module.id}" aria-label="Dupliquer"><i class="fas fa-copy"></i></button><button class="danger" data-delete-lesson="${lesson.id}" aria-label="Supprimer"><i class="fas fa-trash"></i></button></div></div>`;
}

async function reorderModule(button, modules, context, reload) {
  const id = button.dataset.moduleUp || button.dataset.moduleDown; const index = modules.findIndex((item) => item.id === id); const target = index + (button.dataset.moduleUp ? -1 : 1); if (target < 0 || target >= modules.length) return;
  const a = modules[index], b = modules[target]; await Promise.all([context.api.saveModule({ organizationId: context.organization.id, courseId: context.state.course.id, moduleId: a.id, title: a.title, order: b.order }), context.api.saveModule({ organizationId: context.organization.id, courseId: context.state.course.id, moduleId: b.id, title: b.title, order: a.order })]); await reload();
}

async function reorderLesson(button, lessons, context, reload) {
  const id = button.dataset.lessonUp || button.dataset.lessonDown; const group = lessons.filter((item) => item.moduleId === button.dataset.moduleId).sort((a,b) => a.order - b.order); const index = group.findIndex((item) => item.id === id); const target = index + (button.dataset.lessonUp ? -1 : 1); if (target < 0 || target >= group.length) return;
  const a = group[index], b = group[target]; const payload = (item, order) => ({ ...item, organizationId: context.organization.id, moduleId: item.moduleId, lessonId: item.id, contentRef: item.contentRef || '', order }); await Promise.all([context.api.saveLesson(payload(a, b.order)), context.api.saveLesson(payload(b, a.order))]); await reload();
}

function typeIcon(type) { return ({ video: 'fa-circle-play', text: 'fa-file-lines', pdf: 'fa-file-pdf', file: 'fa-paperclip', audio: 'fa-headphones' })[type] || 'fa-file'; }
