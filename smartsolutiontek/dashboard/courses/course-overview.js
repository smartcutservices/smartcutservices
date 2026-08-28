import { checklistSummary, courseStatusLabel } from './course-model.js';

export async function renderCourseOverview(container, context) {
  container.innerHTML = `<section><div class="sst-course-view-heading"><div><span class="sst-app-kicker">Vue d’ensemble</span><h1>${context.escapeHtml(context.state.course.title)}</h1><p>Suivez la préparation, les inscriptions et les revenus réellement enregistrés.</p></div><button class="sst-btn sst-btn-secondary" data-onboarding><i class="fas fa-list-check"></i> Checklist de lancement</button></div><div class="sst-loading">Calcul des indicateurs…</div></section>`;
  container.querySelector('[data-onboarding]').addEventListener('click', context.onOnboarding);
  try {
    const { overview } = await context.api.overview(context.organization.id, context.state.course.id);
    const summary = checklistSummary(overview.checklist);
    container.innerHTML = `<section class="sst-course-overview">
      <div class="sst-course-view-heading"><div><span class="sst-app-kicker">Vue d’ensemble</span><h1>${context.escapeHtml(context.state.course.title)}</h1><p>Suivez la préparation, les inscriptions et les revenus réellement enregistrés.</p></div><button class="sst-btn sst-btn-secondary" data-onboarding><i class="fas fa-list-check"></i> Checklist de lancement</button></div>
      <div class="sst-course-launch-card"><div><span>Préparation du cours</span><strong>${summary.percentage}%</strong></div><progress max="100" value="${summary.percentage}">${summary.percentage}%</progress>${summary.missing.length ? `<ul>${summary.missing.slice(0, 3).map((reason) => `<li>${context.escapeHtml(reason)}</li>`).join('')}</ul>` : '<p class="sst-success-inline"><i class="fas fa-circle-check"></i> Prêt pour publication.</p>'}</div>
      <div class="sst-course-stat-grid">
        ${stat('Statut', courseStatusLabel(overview.status), 'fa-circle-info')}
        ${stat('Apprenants', overview.studentCount, 'fa-users')}
        ${stat('Revenu brut', context.formatCurrency(overview.grossRevenue), 'fa-coins')}
        ${stat('Net estimé', context.formatCurrency(overview.estimatedNetRevenue), 'fa-wallet')}
        ${stat('Progression moyenne', overview.averageProgress === null ? 'Aucune donnée' : `${overview.averageProgress}%`, 'fa-chart-line')}
        ${stat('Leçons', overview.lessonCount, 'fa-circle-play')}
      </div>
      <div class="sst-course-overview-columns">
        <article class="sst-course-panel"><div class="sst-course-panel-heading"><h2>Inscriptions récentes</h2><button data-go-students>Voir les apprenants</button></div>${overview.recentEnrollments.length ? `<div class="sst-activity-list">${overview.recentEnrollments.map((item) => `<div><span class="sst-avatar">${context.escapeHtml((item.studentName || item.studentEmail || '?').slice(0,1).toUpperCase())}</span><div><strong>${context.escapeHtml(item.studentName || 'Apprenant')}</strong><small>${context.escapeHtml(item.studentEmail)} · ${item.completionPercentage}%</small></div></div>`).join('')}</div>` : '<div class="sst-course-empty-inline">Aucune inscription confirmée pour le moment.</div>'}</article>
        <article class="sst-course-panel"><h2>Accès rapides</h2><div class="sst-quick-actions"><button data-go-content><i class="fas fa-list-check"></i><span>Modifier le programme</span></button><button data-go-appearance><i class="fas fa-eye"></i><span>Aperçu du site</span></button><a href="./page.html?app=courses&courseId=${encodeURIComponent(context.state.course.id)}&org=${encodeURIComponent(context.organization.id)}" target="_blank" rel="noopener"><i class="fas fa-arrow-up-right-from-square"></i><span>Ouvrir le lien public</span></a></div></article>
      </div>
      <details class="sst-metric-definitions"><summary>Définition des indicateurs</summary>${Object.values(overview.definitions).map((definition) => `<p>${context.escapeHtml(definition)}</p>`).join('')}</details>
    </section>`;
    container.querySelector('[data-onboarding]').addEventListener('click', context.onOnboarding);
    container.querySelector('[data-go-content]').addEventListener('click', () => context.onNavigate('content'));
    container.querySelector('[data-go-appearance]').addEventListener('click', () => context.onNavigate('appearance'));
    container.querySelector('[data-go-students]').addEventListener('click', () => context.onNavigate('students'));
  } catch (error) { container.innerHTML = `<div class="sst-error">${context.escapeHtml(error.message)}</div>`; }
}

function stat(label, value, icon) {
  return `<article class="sst-course-stat"><span><i class="fas ${icon}"></i>${label}</span><strong>${value}</strong></article>`;
}
