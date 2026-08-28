import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { createCourseApi } from './course-api.js';
import { buildCourseSaveBody } from './course-model.js';
import { mountCourseList } from './course-list.js';
import { renderCourseShell } from './shell.js';
import { renderOnboarding } from './onboarding-view.js';
import { renderCourseOverview } from './course-overview.js';
import { renderCurriculumEditor } from './curriculum-editor.js';
import { renderSiteBuilder } from './site-builder.js';
import { renderSalesView } from './sales-view.js';
import { renderStudentsView } from './students-view.js';
import { renderAnalyticsView } from './analytics-view.js';
import { renderSettingsView } from './settings-view.js';
import { openDialog } from '../shared/dialog.js';

export function mountCourseStudio(container, dependencies) {
  let unsubscribe = null;
  let disposed = false;
  const api = createCourseApi(dependencies.callSst, dependencies.getCurrentUser);
  const state = { organization: dependencies.organization, course: null, section: 'overview', menuOpen: false, onboarding: false, onboardingStep: 0, saveLabel: 'Enregistré' };
  const params = new URLSearchParams(location.search);
  const initialCourseId = params.get('course');
  const initialSection = params.get('section');

  const baseContext = () => ({ ...dependencies, api, state, organization: dependencies.organization,
    onBack: showList, onOnboarding: () => { state.onboarding = true; renderWorkspace(); },
    onClose: () => { state.onboarding = false; renderWorkspace(); }, onNavigate: navigate,
    setSaving: (label) => { state.saveLabel = label; const target = container.querySelector('.sst-course-save-state span'); if (target) target.textContent = label; }
  });

  async function showList() {
    state.course = null; state.onboarding = false; updateUrl();
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    unsubscribe = mountCourseList(container, { ...baseContext(), onCreate: renderCreateCourse, onOpen: openCourse });
  }

  function renderCreateCourse() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    container.innerHTML = `<section class="sst-create-course-page"><button class="sst-course-back" data-cancel-create><i class="fas fa-arrow-left"></i> Tous les cours</button><div class="sst-create-course-card"><span class="sst-app-kicker">Étape 1 sur 6</span><h1>Créer une nouvelle formation</h1><p>Commencez par une promesse claire. Vous compléterez ensuite le public, le programme, l’apparence et le prix.</p><form data-create-course><label>Titre du cours *<input class="sst-input" name="title" maxlength="140" required placeholder="Ex. Maîtriser la comptabilité pour PME"></label><label>Sous-titre<input class="sst-input" name="subtitle" maxlength="220" placeholder="Une phrase qui précise le résultat"></label><label>Description courte *<textarea class="sst-textarea" name="description" rows="4" required placeholder="Expliquez la valeur du cours en quelques phrases."></textarea></label><div><button type="button" class="sst-btn sst-btn-secondary" data-cancel-create>Annuler</button><button class="sst-btn sst-btn-primary">Créer et continuer</button></div></form></div></section>`;
    container.querySelectorAll('[data-cancel-create]').forEach((button) => button.addEventListener('click', showList));
    container.querySelector('[data-create-course]').addEventListener('submit', async (event) => {
      event.preventDefault(); const form = new FormData(event.currentTarget); const title = String(form.get('title') || '').trim(); const description = String(form.get('description') || '').trim(); if (!title || !description) return;
      const submit = event.currentTarget.querySelector('button[type="submit"]'); submit.disabled = true; submit.textContent = 'Création…';
      try { const result = await api.save(buildCourseSaveBody({ organizationId: dependencies.organization.id, title, subtitle: form.get('subtitle'), description, shortDescription: description, price: 0, language: 'fr', level: 'all' })); await openCourse(result.courseId, true); dependencies.toast('Cours créé.'); }
      catch (error) { submit.disabled = false; submit.textContent = 'Créer et continuer'; dependencies.toast(error.message, 'error'); }
    });
  }

  async function openCourse(courseId, startOnboarding = false) {
    try {
      const snapshot = await getDoc(doc(dependencies.db, 'courses', courseId));
      if (!snapshot.exists() || snapshot.data().organizationId !== dependencies.organization.id) throw new Error('Cours introuvable.');
      state.course = { id: snapshot.id, ...snapshot.data() }; state.section = initialSection || 'overview'; state.onboarding = startOnboarding; state.onboardingStep = 0; updateUrl(); await renderWorkspace();
    } catch (error) { dependencies.toast(error.message, 'error'); showList(); }
  }

  async function renderWorkspace() {
    if (disposed || !state.course) return;
    renderCourseShell(container, state, dependencies.escapeHtml);
    container.querySelector('[data-course-back]').addEventListener('click', showList);
    container.querySelector('[data-course-menu]').addEventListener('click', () => { state.menuOpen = !state.menuOpen; container.querySelector('.sst-course-studio-sidebar').classList.toggle('open', state.menuOpen); });
    container.querySelectorAll('[data-course-section]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.courseSection)));
    container.querySelector('[data-course-publish]').addEventListener('click', togglePublish);
    const view = container.querySelector('#courseStudioView'); const context = baseContext();
    if (state.onboarding) return renderOnboarding(view, context);
    const renderers = { overview: renderCourseOverview, content: renderCurriculumEditor, appearance: renderSiteBuilder, sales: renderSalesView, students: renderStudentsView, analytics: renderAnalyticsView, settings: renderSettingsView };
    await (renderers[state.section] || renderCourseOverview)(view, context);
  }

  function navigate(section) { state.section = section; state.menuOpen = false; state.onboarding = false; updateUrl(); renderWorkspace(); }

  async function togglePublish() {
    if (state.course.status === 'published') {
      if (!await openDialog({ title: 'Dépublier le cours ?', message: 'La page publique et les nouveaux achats seront suspendus. Les apprenants confirmés conserveront leur accès.', confirmLabel: 'Dépublier', danger: true })) return;
      try { await api.setStatus({ organizationId: dependencies.organization.id, courseId: state.course.id, status: 'suspended' }); state.course.status = 'suspended'; dependencies.toast('Cours dépublié.'); renderWorkspace(); } catch (error) { dependencies.toast(error.message, 'error'); }
      return;
    }
    try {
      const { checklist } = await api.checklist(dependencies.organization.id, state.course.id);
      const missing = checklist.items.filter((item) => !item.complete);
      if (missing.length) { await openDialog({ title: 'Cours incomplet', message: missing.map((item) => item.reason).join(' '), confirmLabel: 'Revoir la checklist', cancelLabel: 'Fermer' }); state.onboarding = true; state.onboardingStep = 5; return renderWorkspace(); }
      await api.publishPage({ organizationId: dependencies.organization.id, applicationId: 'courses', slug: state.course.slug, title: state.course.title, description: state.course.shortDescription || state.course.description || '', resourcePath: `courses/${state.course.id}` });
      await api.setStatus({ organizationId: dependencies.organization.id, courseId: state.course.id, status: 'published' });
      state.course.status = 'published'; dependencies.toast('Cours publié.'); renderWorkspace();
    } catch (error) { dependencies.toast(error.message, 'error'); }
  }

  function updateUrl() {
    const url = new URL(location.href); if (state.course) { url.searchParams.set('course', state.course.id); url.searchParams.set('section', state.section); } else { url.searchParams.delete('course'); url.searchParams.delete('section'); } history.replaceState({}, '', url);
  }

  if (initialCourseId) openCourse(initialCourseId); else showList();
  return () => { disposed = true; if (unsubscribe) unsubscribe(); };
}
