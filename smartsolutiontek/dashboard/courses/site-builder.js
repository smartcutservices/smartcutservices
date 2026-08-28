import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { renderOrderedCourseSections, applyCourseTheme } from '../../course-renderer.js';
import { buildCourseSaveBody } from './course-model.js';

export async function renderSiteBuilder(container, context) {
  const course = context.state.course;
  const [modulesSnap, lessonsSnap] = await Promise.all([
    getDocs(query(collection(context.db, 'courseModules'), where('courseId', '==', course.id))),
    getDocs(query(collection(context.db, 'lessons'), where('courseId', '==', course.id)))
  ]);
  const modules = modulesSnap.docs.map((doc) => ({ id: doc.id, ...doc.data(), lessons: [] })).filter((item) => item.status !== 'archived').sort((a,b) => a.order - b.order);
  const lessons = lessonsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })).filter((item) => item.status !== 'archived');
  modules.forEach((module) => { module.lessons = lessons.filter((lesson) => lesson.moduleId === module.id).sort((a,b) => a.order - b.order); });
  const sectionLabels = { hero: 'Hero', about: 'Présentation', outcomes: 'Résultats', audience: 'Public cible', prerequisites: 'Prérequis', curriculum: 'Programme', instructor: 'Formateur', offer: 'Offre et prix', faq: 'FAQ', testimonials: 'Témoignages manuels', cta: 'Appel à l’action', legal: 'Informations légales' };
  const defaultSections = Object.keys(sectionLabels).map((id) => ({ id, visible: true }));
  const initialSections = Array.isArray(course.pageSections) ? course.pageSections : defaultSections;
  container.innerHTML = `<section class="sst-site-builder-page">
    <div class="sst-course-view-heading"><div><span class="sst-app-kicker">Apparence du site</span><h1>Personnaliser la page publique</h1><p>La personnalisation reste contenue dans votre site. Le Studio conserve l’identité SmartSolutionTek.</p></div><button class="sst-btn sst-btn-primary" data-save-appearance>Enregistrer</button></div>
    <div class="sst-site-builder-layout">
      <aside class="sst-site-builder-controls">
        <label>Titre du hero<input class="sst-input" data-appearance="heroTitle" value="${context.escapeHtml(course.heroTitle || course.title || '')}"></label>
        <label>Sous-titre<textarea class="sst-textarea" rows="4" data-appearance="heroSubtitle">${context.escapeHtml(course.heroSubtitle || course.subtitle || course.shortDescription || '')}</textarea></label>
        <label>Disposition<select class="sst-select" data-appearance="layout"><option value="minimal" ${course.layout === 'minimal' ? 'selected' : ''}>Minimaliste</option><option value="hero" ${course.layout === 'hero' ? 'selected' : ''}>Image à droite</option><option value="cover" ${course.layout === 'cover' ? 'selected' : ''}>Couverture immersive</option></select></label>
        <div class="sst-color-fields"><label>Bleu principal<input type="color" data-appearance="primary" value="${context.escapeHtml(course.colors?.primary || '#131921')}"></label><label>Accent<input type="color" data-appearance="accent" value="${context.escapeHtml(course.colors?.buttonColor || course.colors?.accent || '#FFA41C')}"></label></div>
        <label>Slug public<input class="sst-input" data-appearance="slug" value="${context.escapeHtml(course.slug || '')}" maxlength="48"></label>
        <label>Titre SEO<input class="sst-input" data-appearance="seoTitle" value="${context.escapeHtml(course.seo?.pageTitle || '')}" maxlength="70"></label>
        <label>Description SEO<textarea class="sst-textarea" rows="3" data-appearance="seoDescription" maxlength="160">${context.escapeHtml(course.seo?.description || '')}</textarea></label>
        <label>FAQ manuelle <small>Une question et sa réponse par ligne, séparées par |</small><textarea class="sst-textarea" rows="5" data-appearance="faqs">${context.escapeHtml((course.faqs || []).map((item) => `${item.question} | ${item.answer}`).join('\n'))}</textarea></label>
        <label>Témoignages manuels <small>Nom | témoignage. Publiez uniquement des retours authentiques avec autorisation.</small><textarea class="sst-textarea" rows="5" data-appearance="testimonials">${context.escapeHtml((course.testimonials || []).map((item) => `${item.author} | ${item.quote}`).join('\n'))}</textarea></label>
        <div><strong>Sections</strong><p class="sst-builder-help">Affichez, masquez ou réordonnez les blocs contrôlés.</p><div class="sst-section-order" data-section-order>${initialSections.map((item, index) => `<div data-section-id="${context.escapeHtml(item.id)}"><label class="sst-checkbox-row"><input type="checkbox" ${item.visible !== false ? 'checked' : ''}><span>${context.escapeHtml(sectionLabels[item.id] || item.id)}</span></label><span><button type="button" data-section-move="up" ${index === 0 ? 'disabled' : ''} aria-label="Monter"><i class="fas fa-arrow-up"></i></button><button type="button" data-section-move="down" ${index === initialSections.length - 1 ? 'disabled' : ''} aria-label="Descendre"><i class="fas fa-arrow-down"></i></button></span></div>`).join('')}</div></div>
        <p class="sst-info-banner"><i class="fas fa-universal-access"></i> Choisissez un accent lisible. Les contrôles conservent des contrastes et mises en page sûrs.</p>
      </aside>
      <div class="sst-site-preview-area">
        <div class="sst-site-preview-toolbar"><strong>Aperçu</strong><div><button class="active" data-device="desktop" aria-label="Bureau"><i class="fas fa-desktop"></i></button><button data-device="mobile" aria-label="Mobile"><i class="fas fa-mobile-screen"></i></button></div></div>
        <div class="sst-site-preview-frame" data-preview-frame></div>
      </div>
    </div>
  </section>`;
  const draft = { ...course, pageSections: initialSections.map((item) => ({ ...item })) };
  const updateDraft = () => {
    const read = (name) => container.querySelector(`[data-appearance="${name}"]`).value;
    draft.pageSections = [...container.querySelectorAll('[data-section-id]')].map((row) => ({ id: row.dataset.sectionId, visible: row.querySelector('input').checked }));
    const faqs = read('faqs').split(/\r?\n/).map((line) => { const separator = line.indexOf('|'); return separator > 0 ? { question: line.slice(0, separator).trim(), answer: line.slice(separator + 1).trim() } : null; }).filter((item) => item?.question && item?.answer);
    const testimonials = read('testimonials').split(/\r?\n/).map((line) => { const separator = line.indexOf('|'); return separator > 0 ? { author: line.slice(0, separator).trim(), quote: line.slice(separator + 1).trim() } : null; }).filter((item) => item?.author && item?.quote);
    Object.assign(draft, { heroTitle: read('heroTitle'), heroSubtitle: read('heroSubtitle'), layout: read('layout'), slug: read('slug'), faqs, testimonials, seo: { pageTitle: read('seoTitle'), description: read('seoDescription') }, colors: { primary: read('primary'), accent: read('accent'), buttonColor: read('accent') } });
    renderPreview(container.querySelector('[data-preview-frame]'), draft, modules);
  };
  container.querySelectorAll('[data-appearance]').forEach((input) => input.addEventListener('input', updateDraft));
  container.querySelectorAll('[data-device]').forEach((button) => button.addEventListener('click', () => { container.querySelectorAll('[data-device]').forEach((item) => item.classList.toggle('active', item === button)); container.querySelector('[data-preview-frame]').classList.toggle('mobile', button.dataset.device === 'mobile'); }));
  container.querySelector('[data-section-order]').addEventListener('click', (event) => { const button = event.target.closest('[data-section-move]'); if (!button) return; const row = button.closest('[data-section-id]'); const sibling = button.dataset.sectionMove === 'up' ? row.previousElementSibling : row.nextElementSibling; if (sibling) row.parentElement.insertBefore(button.dataset.sectionMove === 'up' ? row : sibling, button.dataset.sectionMove === 'up' ? sibling : row); updateSectionButtons(container); updateDraft(); });
  container.querySelector('[data-section-order]').addEventListener('change', updateDraft);
  container.querySelector('[data-save-appearance]').addEventListener('click', async () => {
    try { context.setSaving('Enregistrement…'); await context.api.save(buildCourseSaveBody({ ...course, ...draft, organizationId: context.organization.id, courseId: course.id })); Object.assign(course, draft); context.setSaving('Enregistré'); context.toast('Apparence enregistrée.'); }
    catch (error) { context.setSaving('Erreur'); context.toast(error.message, 'error'); }
  });
  updateDraft();
}

function renderPreview(frame, course, modules) {
  const offer = `<aside class="sst-public-checkout-card" id="courseEnroll"><span class="sst-public-checkout-eyebrow">Accès complet</span><div class="sst-public-checkout-price">${course.pricing?.type === 'free' || Number(course.price) === 0 ? 'Gratuit' : `${Number(course.pricing?.amount ?? course.price).toLocaleString('fr-FR')} HTG`}</div><button class="sst-btn sst-btn-primary">S’inscrire maintenant</button></aside>`;
  frame.innerHTML = `<div class="sst-course-shell sst-builder-preview">${renderOrderedCourseSections(course, modules, offer)}<footer class="sst-public-minimal-footer">Propulsé par SmartSolutionTek</footer></div>`;
  applyCourseTheme(frame, course);
}

function updateSectionButtons(container) {
  const rows = [...container.querySelectorAll('[data-section-id]')];
  rows.forEach((row, index) => { row.querySelector('[data-section-move="up"]').disabled = index === 0; row.querySelector('[data-section-move="down"]').disabled = index === rows.length - 1; });
}
