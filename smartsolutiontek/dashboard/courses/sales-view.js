import { buildCourseSaveBody } from './course-model.js';

export function renderSalesView(container, context) {
  const course = context.state.course;
  container.innerHTML = `<section><div class="sst-course-view-heading"><div><span class="sst-app-kicker">Prix et vente</span><h1>Configurer l’offre</h1><p>Le prix et les conditions affichés deviennent la référence du paiement serveur.</p></div><button class="sst-btn sst-btn-primary" data-save-sales>Enregistrer</button></div>
    <div class="sst-course-form-card"><div class="sst-course-form-grid">
      <label>Type d’accès<select class="sst-select" data-sales="type"><option value="free" ${course.pricing?.type === 'free' || Number(course.price) === 0 ? 'selected' : ''}>Cours gratuit</option><option value="fixed" ${course.pricing?.type !== 'free' && Number(course.price) > 0 ? 'selected' : ''}>Prix fixe</option></select></label>
      <label>Prix en HTG<input class="sst-input" type="number" min="0" data-sales="price" value="${Number(course.pricing?.amount ?? course.price) || 0}"></label>
      <label>Accès<select class="sst-select" data-sales="access"><option value="lifetime" ${course.accessPolicy?.type !== 'limited' ? 'selected' : ''}>Illimité</option><option value="limited" ${course.accessPolicy?.type === 'limited' ? 'selected' : ''}>Durée limitée</option></select></label>
      <label>Durée en jours<input class="sst-input" type="number" min="1" max="3650" data-sales="days" value="${Number(course.accessPolicy?.durationDays) || 30}"></label>
      <label>Ouverture des inscriptions<input class="sst-input" type="datetime-local" data-sales="opensAt" value="${dateTimeLocal(course.enrollmentPolicy?.opensAt)}"></label>
      <label>Fermeture des inscriptions<input class="sst-input" type="datetime-local" data-sales="closesAt" value="${dateTimeLocal(course.enrollmentPolicy?.closesAt)}"></label>
      <label>Limite d’inscriptions<input class="sst-input" type="number" min="1" max="1000000" data-sales="capacity" value="${Number(course.enrollmentPolicy?.capacity) || ''}" placeholder="Illimitée"></label>
      <label class="wide">Politique de remboursement<textarea class="sst-textarea" rows="6" data-sales="refund">${context.escapeHtml(course.refundPolicy || '')}</textarea></label>
    </div>
    <div class="sst-finance-explanation"><div><span>Prix affiché</span><strong data-price-preview></strong></div><div><span>Commission</span><strong>Calculée selon la règle active</strong></div><div><span>Revenu net</span><strong>Visible après inscription confirmée</strong></div></div>
    <p class="sst-info-banner"><i class="fas fa-hand-holding-dollar"></i> Les demandes de remboursement seront examinées manuellement. Aucun paiement fractionné ou remboursement automatique n’est annoncé.</p></div>
  </section>`;
  const refresh = () => { const free = container.querySelector('[data-sales="type"]').value === 'free'; const amount = free ? 0 : Number(container.querySelector('[data-sales="price"]').value) || 0; container.querySelector('[data-price-preview]').textContent = free ? 'Gratuit' : context.formatCurrency(amount); };
  container.querySelectorAll('[data-sales]').forEach((input) => input.addEventListener('input', refresh)); refresh();
  container.querySelector('[data-save-sales]').addEventListener('click', async () => {
    const free = container.querySelector('[data-sales="type"]').value === 'free'; const amount = free ? 0 : Number(container.querySelector('[data-sales="price"]').value);
    if (!free && (!Number.isFinite(amount) || amount <= 0)) { context.toast('Ajoutez un prix fixe valide.', 'error'); return; }
    const access = container.querySelector('[data-sales="access"]').value;
    const opensAt = container.querySelector('[data-sales="opensAt"]').value; const closesAt = container.querySelector('[data-sales="closesAt"]').value;
    if (opensAt && closesAt && new Date(opensAt) >= new Date(closesAt)) { context.toast('La fermeture doit être postérieure à l’ouverture.', 'error'); return; }
    const values = { ...course, organizationId: context.organization.id, courseId: course.id, price: amount, accessPolicy: { type: access, durationDays: access === 'limited' ? Number(container.querySelector('[data-sales="days"]').value) : null }, enrollmentPolicy: { opensAt: opensAt ? new Date(opensAt).toISOString() : null, closesAt: closesAt ? new Date(closesAt).toISOString() : null, capacity: Number(container.querySelector('[data-sales="capacity"]').value) || null }, refundPolicy: container.querySelector('[data-sales="refund"]').value };
    try { context.setSaving('Enregistrement…'); const payload = buildCourseSaveBody(values); await context.api.save(payload); Object.assign(course, payload); context.setSaving('Enregistré'); context.toast('Offre enregistrée.'); }
    catch (error) { context.setSaving('Erreur'); context.toast(error.message, 'error'); }
  });
}

function dateTimeLocal(value) { if (!value) return ''; const date = new Date(value); if (Number.isNaN(date.getTime())) return ''; const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return local.toISOString().slice(0,16); }
