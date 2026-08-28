import { openDialog } from '../shared/dialog.js';

export function renderSettingsView(container, context) {
  const course = context.state.course;
  container.innerHTML = `<section><div class="sst-course-view-heading"><div><span class="sst-app-kicker">Paramètres</span><h1>Paramètres du cours</h1><p>Gérez les informations générales et les actions sensibles.</p></div></div>
    <div class="sst-course-panel"><h2>Informations et publication</h2><p>Utilisez le parcours guidé pour modifier l’identité, le public, le slug et les conditions.</p><button class="sst-btn sst-btn-secondary" data-open-onboarding>Ouvrir le parcours guidé</button></div>
    <div class="sst-course-panel"><h2>Équipe et permissions</h2><p><strong>Propriétaire :</strong> équipe, finance, publication et paramètres sensibles. <strong>Gestionnaire :</strong> cours, apprenants, publication et analyses. <strong>Collaborateur :</strong> contenu et lecture des apprenants, sans finance.</p><a class="sst-btn sst-btn-secondary" href="./dashboard.html?tab=settings">Gérer l’organisation</a></div>
    <div class="sst-course-panel"><h2>Lien public</h2><div class="sst-public-link-row"><code>${location.origin}/smartsolutiontek/page.html?app=courses&amp;courseId=${context.escapeHtml(course.id)}&amp;org=${context.escapeHtml(context.organization.id)}</code><button class="sst-btn sst-btn-secondary" data-copy-link>Copier</button></div></div>
    <div class="sst-course-panel"><div class="sst-course-panel-heading"><h2>Journal d’audit</h2><button data-load-audit>Charger</button></div><div data-audit-log class="sst-course-empty-inline">Chargez les 50 dernières actions sensibles enregistrées pour ce cours.</div></div>
    <div class="sst-course-panel sst-danger-zone"><h2>Zone sensible</h2><p>Une suppression devient un archivage dès qu’un historique d’inscription existe.</p><button class="sst-btn sst-btn-danger" data-delete-course>Supprimer ou archiver le cours</button></div>
  </section>`;
  container.querySelector('[data-open-onboarding]').addEventListener('click', context.onOnboarding);
  container.querySelector('[data-copy-link]').addEventListener('click', async () => { await navigator.clipboard.writeText(`${location.origin}/smartsolutiontek/page.html?app=courses&courseId=${course.id}&org=${context.organization.id}`); context.toast('Lien copié.'); });
  container.querySelector('[data-load-audit]').addEventListener('click', async () => {
    const target = container.querySelector('[data-audit-log]'); target.innerHTML = '<div class="sst-loading">Chargement…</div>';
    try { const result = await context.api.auditLog(context.organization.id, course.id); target.innerHTML = result.logs.length ? `<div class="sst-audit-list">${result.logs.map((item) => `<div><i class="fas fa-clock-rotate-left"></i><span><strong>${context.escapeHtml(auditLabel(item.action))}</strong><small>${context.escapeHtml(formatAuditDate(item.createdAt))}</small></span></div>`).join('')}</div>` : 'Aucune action sensible enregistrée.'; } catch (error) { target.innerHTML = `<div class="sst-error">${context.escapeHtml(error.message)}</div>`; }
  });
  container.querySelector('[data-delete-course]').addEventListener('click', async () => {
    if (!await openDialog({ title: 'Supprimer ou archiver ce cours ?', message: 'Cette action peut rendre le cours indisponible. L’historique financier et apprenant sera conservé si nécessaire.', confirmLabel: 'Continuer', danger: true })) return;
    try { await context.api.remove({ organizationId: context.organization.id, courseId: course.id }); context.toast('Cours supprimé ou archivé.'); context.onBack(); } catch (error) { context.toast(error.message, 'error'); }
  });
}

function auditLabel(action) { return ({ 'course.created': 'Cours créé', 'course.published': 'Cours publié', 'course.status_changed': 'Statut du cours modifié', 'course.price_changed': 'Prix du cours modifié', 'course.archived': 'Cours archivé', 'course.deleted': 'Cours supprimé', 'module.archived': 'Module archivé', 'module.deleted': 'Module supprimé', 'lesson.archived': 'Leçon archivée', 'lesson.deleted': 'Leçon supprimée', 'enrollment.suspend': 'Accès apprenant suspendu', 'enrollment.restore': 'Accès apprenant rétabli', 'enrollment.extend': 'Accès apprenant prolongé', 'enrollment.note': 'Note interne modifiée' })[action] || action; }
function formatAuditDate(value) { const date = value?.toDate?.() || (value?._seconds ? new Date(value._seconds * 1000) : null); return date && !Number.isNaN(date.getTime()) ? date.toLocaleString('fr-FR') : 'Date serveur'; }
