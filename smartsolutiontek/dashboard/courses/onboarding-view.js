import { buildCourseSaveBody, checklistSummary } from './course-model.js';

const STEPS = ['Informations', 'Public et objectif', 'Programme initial', 'Apparence', 'Prix', 'Vérification'];

function listValue(value) { return Array.isArray(value) ? value.join('\n') : ''; }

export async function renderOnboarding(container, context) {
  const course = context.state.course;
  const step = context.state.onboardingStep || 0;
  container.innerHTML = `
    <section class="sst-course-onboarding">
      <div class="sst-course-view-heading"><div><span class="sst-app-kicker">Parcours guidé</span><h1>Préparer votre cours</h1><p>Étape ${step + 1} sur ${STEPS.length} — ${STEPS[step]}</p></div><button class="sst-btn sst-btn-secondary" data-close-onboarding>Quitter le guide</button></div>
      <ol class="sst-onboarding-steps">${STEPS.map((label, index) => `<li class="${index === step ? 'active' : ''} ${index < step ? 'done' : ''}"><span>${index + 1}</span><small>${label}</small></li>`).join('')}</ol>
      <div class="sst-course-form-card" data-onboarding-body>${renderStep(step, course, context)}</div>
      <div class="sst-onboarding-actions">
        <button class="sst-btn sst-btn-secondary" data-step-back ${step === 0 ? 'disabled' : ''}><i class="fas fa-arrow-left"></i> Précédent</button>
        <button class="sst-btn sst-btn-primary" data-step-next>${step === STEPS.length - 1 ? 'Terminer' : 'Enregistrer et continuer'} <i class="fas fa-arrow-right"></i></button>
      </div>
    </section>`;

  container.querySelector('[data-close-onboarding]').addEventListener('click', context.onClose);
  container.querySelector('[data-step-back]').addEventListener('click', () => { context.state.onboardingStep = Math.max(0, step - 1); renderOnboarding(container, context); });
  bindStepEvents(container, context, step);
  container.querySelector('[data-step-next]').addEventListener('click', async () => {
    try {
      if ([0, 1, 3, 4].includes(step)) await saveCurrentStep(container, context, step);
      if (step === 2) { context.state.onboardingStep = 3; context.onNavigate('content'); return; }
      if (step === STEPS.length - 1) { context.state.onboardingStep = 0; context.onClose(); return; }
      context.state.onboardingStep = step + 1;
      await renderOnboarding(container, context);
    } catch (error) { context.toast(error.message, 'error'); }
  });

  if (step === 5) {
    try {
      const result = await context.api.checklist(context.organization.id, course.id);
      const summary = checklistSummary(result.checklist);
      const target = container.querySelector('[data-checklist]');
      target.innerHTML = `<div class="sst-checklist-score"><strong>${summary.percentage}%</strong><span>de préparation</span></div>${result.checklist.items.map((item) => `<div class="sst-checklist-item ${item.complete ? 'complete' : ''}"><i class="fas ${item.complete ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i><div><strong>${checklistLabel(item.key)}</strong>${item.complete ? '<small>Terminé</small>' : `<small>${context.escapeHtml(item.reason)}</small>`}</div></div>`).join('')}`;
    } catch (error) { container.querySelector('[data-checklist]').innerHTML = `<div class="sst-error">${context.escapeHtml(error.message)}</div>`; }
  }
}

function renderStep(step, course, context) {
  if (step === 0) return `<div class="sst-course-form-grid">
    <label>Titre du cours *<input class="sst-input" data-field="title" maxlength="140" value="${context.escapeHtml(course.title || '')}"></label>
    <label>Sous-titre<input class="sst-input" data-field="subtitle" maxlength="220" value="${context.escapeHtml(course.subtitle || '')}"></label>
    <label class="wide">Description courte *<textarea class="sst-textarea" data-field="shortDescription" rows="3">${context.escapeHtml(course.shortDescription || course.description || '')}</textarea></label>
    <label class="wide">Description complète<textarea class="sst-textarea" data-field="fullDescription" rows="7">${context.escapeHtml(course.fullDescription || '')}</textarea></label>
    <label>Catégorie<input class="sst-input" data-field="category" value="${context.escapeHtml(course.category || '')}" placeholder="Marketing, informatique…"></label>
    <label>Niveau<select class="sst-select" data-field="level">${[['all','Tous niveaux'],['beginner','Débutant'],['intermediate','Intermédiaire'],['advanced','Avancé']].map(([value,label]) => `<option value="${value}" ${course.level === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label>Langue<input class="sst-input" data-field="language" value="${context.escapeHtml(course.language || 'fr')}"></label>
    <label>Formateur<input class="sst-input" data-field="instructorName" value="${context.escapeHtml(course.instructorName || '')}"></label>
    <label>Slug public<input class="sst-input" data-field="slug" value="${context.escapeHtml(course.slug || '')}" placeholder="mon-cours"></label>
    <label>Durée estimée (minutes)<input class="sst-input" type="number" min="0" data-field="estimatedDurationMinutes" value="${Number(course.estimatedDurationMinutes) || 0}"></label>
  </div>`;
  if (step === 1) return `<div class="sst-course-form-grid single">
    <label>Résultats d’apprentissage <small>Un résultat par ligne.</small><textarea class="sst-textarea" data-field="learningOutcomes" rows="6">${context.escapeHtml(listValue(course.learningOutcomes))}</textarea></label>
    <label>Public cible <small>Un profil par ligne.</small><textarea class="sst-textarea" data-field="targetAudience" rows="5">${context.escapeHtml(listValue(course.targetAudience))}</textarea></label>
    <label>Prérequis <small>Un prérequis par ligne, ou laissez vide.</small><textarea class="sst-textarea" data-field="prerequisites" rows="4">${context.escapeHtml(listValue(course.prerequisites))}</textarea></label>
  </div>`;
  if (step === 2) return `<div class="sst-onboarding-callout"><i class="fas fa-list-check"></i><h2>Construisez un premier programme</h2><p>Ajoutez au moins un module et une leçon. L’éditeur pleine page permet de les ordonner sans glisser-déposer fragile.</p><button class="sst-btn sst-btn-primary" type="button" data-go-content>Ouvrir l’éditeur de contenu</button></div>`;
  if (step === 3) return `<div class="sst-course-form-grid">
    <div class="sst-course-cover-editor wide"><div class="sst-course-cover-preview">${course.coverImage ? `<img src="${context.escapeHtml(course.coverImage)}" alt="Couverture actuelle">` : '<i class="fas fa-image"></i>'}</div><div><strong>Image de couverture</strong><p>JPG, PNG ou WEBP, 8 Mo maximum.</p><input type="file" accept="image/*" data-cover-file><div role="status" data-upload-status></div></div></div>
    <label>Disposition<select class="sst-select" data-field="layout"><option value="minimal" ${course.layout === 'minimal' ? 'selected' : ''}>Minimaliste</option><option value="hero" ${course.layout === 'hero' ? 'selected' : ''}>Image à droite</option><option value="cover" ${course.layout === 'cover' ? 'selected' : ''}>Couverture immersive</option></select></label>
    <label>Couleur principale<input type="color" data-field="primary" value="${context.escapeHtml(course.colors?.primary || '#131921')}"></label>
    <label>Couleur d’accent<input type="color" data-field="accent" value="${context.escapeHtml(course.colors?.buttonColor || course.colors?.accent || '#FFA41C')}"></label>
  </div>`;
  if (step === 4) return `<div class="sst-course-form-grid">
    <label>Type d’accès<select class="sst-select" data-field="pricingType"><option value="free" ${course.pricing?.type === 'free' || Number(course.price) === 0 ? 'selected' : ''}>Gratuit</option><option value="fixed" ${course.pricing?.type !== 'free' && Number(course.price) > 0 ? 'selected' : ''}>Prix fixe</option></select></label>
    <label>Prix HTG<input class="sst-input" type="number" min="0" data-field="price" value="${Number(course.pricing?.amount ?? course.price) || 0}"></label>
    <label>Durée d’accès<select class="sst-select" data-field="accessType"><option value="lifetime" ${course.accessPolicy?.type !== 'limited' ? 'selected' : ''}>Illimitée</option><option value="limited" ${course.accessPolicy?.type === 'limited' ? 'selected' : ''}>Limitée</option></select></label>
    <label>Nombre de jours<input class="sst-input" type="number" min="1" data-field="durationDays" value="${Number(course.accessPolicy?.durationDays) || 30}"></label>
    <label class="wide">Politique de remboursement *<textarea class="sst-textarea" rows="5" data-field="refundPolicy" placeholder="Décrivez les conditions et le processus manuel…">${context.escapeHtml(course.refundPolicy || '')}</textarea></label>
    <p class="sst-info-banner wide"><i class="fas fa-circle-info"></i> Les remboursements sont examinés manuellement. Aucun remboursement automatique n’est simulé.</p>
  </div>`;
  return `<div class="sst-course-checklist" data-checklist><div class="sst-loading">Vérification de la préparation…</div></div>`;
}

function bindStepEvents(container, context, step) {
  container.querySelector('[data-go-content]')?.addEventListener('click', () => context.onNavigate('content'));
  container.querySelector('[data-cover-file]')?.addEventListener('change', async (event) => {
    const file = event.target.files[0]; if (!file) return;
    const status = container.querySelector('[data-upload-status]'); status.textContent = 'Téléversement…';
    try { const result = await context.uploadImageFile(file, `sst-courses/${context.state.course.id}/branding`, { maxSizeMb: 8 }); context.state.course.coverImage = result.url; status.textContent = 'Couverture prête. Enregistrez pour confirmer.'; }
    catch (error) { status.textContent = error.message; }
  });
}

async function saveCurrentStep(container, context, step) {
  const course = context.state.course;
  const read = (name) => container.querySelector(`[data-field="${name}"]`)?.value;
  const values = { ...course, organizationId: context.organization.id, courseId: course.id };
  if (step === 0) Object.assign(values, { title: read('title'), subtitle: read('subtitle'), shortDescription: read('shortDescription'), description: read('shortDescription'), fullDescription: read('fullDescription'), category: read('category'), level: read('level'), language: read('language'), instructorName: read('instructorName'), slug: read('slug'), estimatedDurationMinutes: read('estimatedDurationMinutes') });
  if (step === 1) Object.assign(values, { learningOutcomes: read('learningOutcomes'), targetAudience: read('targetAudience'), prerequisites: read('prerequisites') });
  if (step === 3) Object.assign(values, { coverImage: course.coverImage, layout: read('layout'), colors: { primary: read('primary'), accent: read('accent'), buttonColor: read('accent') } });
  if (step === 4) Object.assign(values, { price: read('pricingType') === 'free' ? 0 : read('price'), accessPolicy: { type: read('accessType'), durationDays: read('accessType') === 'limited' ? Number(read('durationDays')) : null }, refundPolicy: read('refundPolicy') });
  if (!String(values.title || '').trim()) throw new Error('Le titre du cours est requis.');
  context.setSaving('Enregistrement…');
  await context.api.save(buildCourseSaveBody(values));
  Object.assign(course, buildCourseSaveBody(values));
  context.setSaving('Enregistré');
  context.toast('Étape enregistrée.');
}

function checklistLabel(key) {
  return ({ essentialInformation: 'Informations essentielles', coverImage: 'Couverture', module: 'Module', lesson: 'Leçon', pricing: 'Prix', publicPage: 'Page publique', terms: 'Conditions', payment: 'Paiement' })[key] || key;
}
