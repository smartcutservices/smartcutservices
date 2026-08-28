import { collection, onSnapshot, query, where } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { courseStatusLabel } from './course-model.js';
import { openDialog } from '../shared/dialog.js';

export function mountCourseList(container, context) {
  container.innerHTML = `
    <section class="sst-course-list-page">
      <div class="sst-course-list-heading">
        <div><span class="sst-app-kicker">Studio créateur</span><h2>Vos cours</h2><p>Créez, structurez et publiez vos formations depuis un espace dédié.</p></div>
        <button class="sst-btn sst-btn-primary" data-new-course><i class="fas fa-plus"></i> Nouveau cours</button>
      </div>
      <div class="sst-course-list-grid" data-course-list><div class="sst-loading">Chargement des cours…</div></div>
    </section>`;
  container.querySelector('[data-new-course]').addEventListener('click', context.onCreate);
  const q = query(collection(context.db, 'courses'), where('organizationId', '==', context.organization.id));
  return onSnapshot(q, (snapshot) => {
    const courses = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((course) => course.status !== 'archived');
    const list = container.querySelector('[data-course-list]');
    if (!courses.length) {
      list.innerHTML = `<div class="sst-course-empty-state"><i class="fas fa-graduation-cap"></i><h3>Créez votre première formation</h3><p>Commencez par son titre, son public et son objectif. Vous pourrez compléter chaque étape avant publication.</p><button class="sst-btn sst-btn-primary" data-empty-create>Créer un cours</button></div>`;
      list.querySelector('[data-empty-create]').addEventListener('click', context.onCreate);
      return;
    }
    list.innerHTML = courses.map((course) => {
      const price = course.pricing?.type === 'free' || Number(course.price) === 0 ? 'Gratuit' : context.formatCurrency(course.pricing?.amount ?? course.price);
      const completion = course.publishChecklist?.totalCount ? Math.round((course.publishChecklist.completedCount / course.publishChecklist.totalCount) * 100) : null;
      return `<article class="sst-course-card">
        <div class="sst-course-card-cover">${course.coverImage ? `<img src="${context.escapeHtml(course.coverImage)}" alt="">` : '<i class="fas fa-graduation-cap"></i>'}</div>
        <div class="sst-course-card-body">
          <div class="sst-course-card-meta"><span class="sst-badge ${context.escapeHtml(course.status || 'draft')}">${context.escapeHtml(courseStatusLabel(course.status))}</span><span>${price}</span></div>
          <h3>${context.escapeHtml(course.title)}</h3>
          <p>${context.escapeHtml(course.shortDescription || course.description || 'Ajoutez une description pour présenter la valeur du cours.')}</p>
          ${completion === null ? '' : `<progress class="sst-course-mini-progress" max="100" value="${completion}">${completion}%</progress><small>Configuration ${completion}%</small>`}
          <div class="sst-course-card-actions"><button class="sst-btn sst-btn-primary" data-open-course="${course.id}">Ouvrir le Studio</button><button class="sst-builder-icon-btn danger" data-delete-course="${course.id}" aria-label="Archiver ${context.escapeHtml(course.title)}"><i class="fas fa-trash"></i></button></div>
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-open-course]').forEach((button) => button.addEventListener('click', () => context.onOpen(button.dataset.openCourse)));
    list.querySelectorAll('[data-delete-course]').forEach((button) => button.addEventListener('click', async () => {
      const course = courses.find((item) => item.id === button.dataset.deleteCourse);
      const approved = await openDialog({ title: 'Supprimer ou archiver le cours ?', message: `« ${context.escapeHtml(course?.title || 'Ce cours')} » sera archivé si des apprenants y sont déjà inscrits.`, confirmLabel: 'Continuer', danger: true });
      if (!approved) return;
      try { await context.api.remove({ organizationId: context.organization.id, courseId: button.dataset.deleteCourse }); context.toast('Cours supprimé ou archivé.'); }
      catch (error) { context.toast(error.message, 'error'); }
    }));
  }, (error) => {
    container.querySelector('[data-course-list]').innerHTML = `<div class="sst-error">${context.escapeHtml(error.message)}</div>`;
  });
}
