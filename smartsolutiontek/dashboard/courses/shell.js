import { courseStatusLabel } from './course-model.js';

export const COURSE_SECTIONS = [
  ['overview', 'Vue d’ensemble', 'fa-chart-line'],
  ['content', 'Contenu', 'fa-list-check'],
  ['appearance', 'Apparence du site', 'fa-palette'],
  ['sales', 'Prix et vente', 'fa-tag'],
  ['students', 'Apprenants', 'fa-users'],
  ['analytics', 'Analyses', 'fa-chart-column'],
  ['settings', 'Paramètres', 'fa-gear']
];

export function renderCourseShell(container, state, escapeHtml) {
  const course = state.course;
  container.innerHTML = `
    <div class="sst-course-studio">
      <header class="sst-course-studio-header">
        <button class="sst-course-mobile-menu" data-course-menu aria-label="Afficher la navigation"><i class="fas fa-bars"></i></button>
        <button class="sst-course-back" data-course-back><i class="fas fa-arrow-left"></i><span>Tous les cours</span></button>
        <div class="sst-course-studio-title">
          <strong>${escapeHtml(course.title || 'Cours sans titre')}</strong>
          <span class="sst-badge ${escapeHtml(course.status || 'draft')}">${escapeHtml(courseStatusLabel(course.status))}</span>
        </div>
        <div class="sst-course-save-state" role="status"><i class="fas fa-cloud-check"></i><span>${escapeHtml(state.saveLabel || 'Enregistré')}</span></div>
        <div class="sst-course-header-actions">
          <a class="sst-btn sst-btn-secondary" href="./page.html?app=courses&courseId=${encodeURIComponent(course.id)}&org=${encodeURIComponent(state.organization.id)}" target="_blank" rel="noopener"><i class="fas fa-eye"></i><span>Aperçu</span></a>
          <button class="sst-btn sst-btn-primary" data-course-publish><i class="fas fa-rocket"></i><span>${course.status === 'published' ? 'Publié' : 'Publier'}</span></button>
        </div>
      </header>
      <div class="sst-course-studio-layout">
        <aside class="sst-course-studio-sidebar ${state.menuOpen ? 'open' : ''}" aria-label="Navigation du cours">
          <div class="sst-course-sidebar-org"><small>Organisation</small><strong>${escapeHtml(state.organization.name)}</strong></div>
          <nav>${COURSE_SECTIONS.map(([id, label, icon]) => `<button class="${state.section === id ? 'active' : ''}" data-course-section="${id}"><i class="fas ${icon}"></i><span>${label}</span></button>`).join('')}</nav>
          <a href="./dashboard.html?org=${encodeURIComponent(state.organization.id)}"><i class="fas fa-grid-2"></i> Dashboard général</a>
        </aside>
        <main class="sst-course-studio-main" id="courseStudioView"><div class="sst-loading">Chargement…</div></main>
      </div>
    </div>`;
}
