export async function renderAnalyticsView(container, context) {
  container.innerHTML = '<div class="sst-loading">Calcul des analyses…</div>';
  try {
    const [{ overview }, { analytics }] = await Promise.all([context.api.overview(context.organization.id, context.state.course.id), context.api.analytics(context.organization.id, context.state.course.id)]);
    container.innerHTML = `<section class="sst-analytics-page"><div class="sst-course-view-heading"><div><span class="sst-app-kicker">Analyses</span><h1>Indicateurs disponibles</h1><p>Aucune métrique n’est inventée. Les conversions non instrumentées restent explicitement indisponibles.</p></div></div>
      <div class="sst-course-stat-grid">${card('Inscriptions', overview.studentCount, 'Inscriptions confirmées')}${card('Revenu brut', context.formatCurrency(overview.grossRevenue), overview.definitions.grossRevenue)}${card('Net estimé', context.formatCurrency(overview.estimatedNetRevenue), overview.definitions.estimatedNetRevenue)}${card('Progression moyenne', overview.averageProgress === null ? '—' : `${overview.averageProgress}%`, overview.definitions.averageProgress)}</div>
      <article class="sst-course-panel"><h2>Entonnoir de conversion</h2><div class="sst-unavailable-metrics">${metric('Vues de page', analytics.pageViews)}${metric('Clics sur le CTA', analytics.ctaClicks)}${metric('Débuts de checkout', analytics.checkoutStarts)}${metric('Paiements réussis', analytics.successfulPayments)}${metric('Taux de conversion', analytics.conversionRate === null ? 'Aucune vue' : `${analytics.conversionRate}%`)}${metric('Taux d’achèvement', analytics.completionRate === null ? 'Aucune inscription' : `${analytics.completionRate}%`)}</div><p class="sst-info-banner"><i class="fas fa-shield-halved"></i> Mesure interne minimale, sans tracker tiers ni stockage d’adresse IP. Les vues sont dédupliquées par session et minute.</p></article>
      <article class="sst-course-panel"><h2>Abandon par leçon</h2><div class="sst-course-empty-inline">Non calculé : le lecteur enregistre la progression finale, mais pas une télémétrie seconde par seconde susceptible de multiplier les écritures.</div></article>
    </section>`;
  } catch (error) { container.innerHTML = `<div class="sst-error">${context.escapeHtml(error.message)}</div>`; }
}
function card(label, value, definition) { return `<article class="sst-course-stat"><span>${label}</span><strong>${value}</strong><small>${definition}</small></article>`; }
function metric(label, value) { return `<div><span>${label}</span><strong>${value}</strong></div>`; }
