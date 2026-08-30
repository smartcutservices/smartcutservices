// ============= SMART CUT EDUCATION - FICHE FORMATION =============
// Page publique dynamique. Resolution slug d'abord, id en compatibilite
// (education-programme.html?slug=... ou ?id=...), ?demo=1 pour forcer les
// donnees locales de demonstration. Aucune admission, aucun paiement,
// aucune ecriture Firestore a ce stade.

import { getEducationSource, EducationRepositoryError } from './education-source.js?v=20260829-16';
import { resolveBySlugThenId } from './education-normalize.js?v=20260829-16';
import { renderCourseCard, renderDemoPill, getCourseMedia, renderLoadingBlock, renderErrorBlock } from './education-components.js';
import {
  escapeHtml,
  getModalityLabel,
  getProgramLocationLabel,
  buildSchoolPageUrl,
  buildEducationHomeUrl,
  readIdFromQuery,
  readSlugFromQuery,
  isDemoMode,
  createToastController
} from './education-utils.js';

export default class EducationProgrammePage {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.demoMode = isDemoMode();
    this.source = getEducationSource();
    this.slug = readSlugFromQuery();
    this.id = readIdFromQuery();

    this.renderLoading();
    this.load();
  }

  renderLoading() {
    this.container.innerHTML = `<div class="edu-container edu-detail">${renderLoadingBlock('Chargement de la formation…')}</div>`;
  }

  async load() {
    try {
      const program = await resolveBySlugThenId({
        slug: this.slug,
        id: this.id,
        findBySlug: (slug) => this.source.getPublishedProgramBySlug(slug),
        findById: (id) => this.source.getPublishedProgramById(id)
      });

      if (!program) {
        this.renderNotFound();
        document.title = 'Formation introuvable | Smart Cut Education';
        return;
      }

      const [school, related, categories] = await Promise.all([
        program.schoolId ? this.source.getPublishedSchoolById(program.schoolId) : Promise.resolve(null),
        this.source.listRelatedPublishedPrograms(program, { limit: 4 }),
        this.source.listPublishedCategories()
      ]);

      this.program = program;
      this.school = school;
      this.related = related;
      this.category = categories.find((cat) => cat.id === program.categoryId) || null;

      document.title = `${program.title} | Smart Cut Education`;
      this.render();
      this.bindEvents();
    } catch (error) {
      this.renderError(error);
    }
  }

  render() {
    const program = this.program;
    const school = this.school;
    const media = getCourseMedia(program);

    this.container.innerHTML = `
      <div class="edu-container edu-detail">
        <nav class="edu-breadcrumb" aria-label="Fil d'Ariane">
          <ol>
            <li><a href="${escapeHtml(buildEducationHomeUrl())}">Smart Cut Education</a></li>
            <li><a href="${escapeHtml(buildEducationHomeUrl('#edu-courses'))}">Formations</a></li>
            <li aria-current="page">${escapeHtml(program.title)}</li>
          </ol>
        </nav>

        <div class="edu-detail-layout">
          <div class="edu-detail-main">
            <div class="edu-detail-header">
              ${renderDemoPill(program.isDemo ? 'Formation de démonstration' : 'Formation publiée')}
              <h1 class="edu-detail-title">${escapeHtml(program.title)}</h1>
              <p class="edu-detail-link-line">
                <i class="fas fa-building-columns" aria-hidden="true"></i>
                ${school
                  ? `<a href="${escapeHtml(buildSchoolPageUrl(school))}">${escapeHtml(school.name)}</a>`
                  : '<span>Établissement à confirmer</span>'}
              </p>
              <p class="edu-detail-lead">${escapeHtml(program.shortDescription)}</p>
            </div>

            <div class="edu-detail-visual" style="background:${media.gradient}">
              <i class="fas ${media.icon}" aria-hidden="true"></i>
            </div>

            <section class="edu-detail-section" aria-labelledby="edu-about-title">
              <h2 id="edu-about-title">À propos de cette formation</h2>
              <p>${escapeHtml(program.fullDescription)}</p>
            </section>

            ${program.learningOutcomes.length ? `
              <section class="edu-detail-section" aria-labelledby="edu-outcomes-title">
                <h2 id="edu-outcomes-title">Ce que vous apprendrez</h2>
                <ul>${program.learningOutcomes.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
              </section>
            ` : ''}

            ${program.targetAudience.length ? `
              <section class="edu-detail-section" aria-labelledby="edu-audience-title">
                <h2 id="edu-audience-title">Pour qui ?</h2>
                <ul>${program.targetAudience.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
              </section>
            ` : ''}

            ${program.instructor.name ? `
              <section class="edu-detail-section" aria-labelledby="edu-instructor-title">
                <h2 id="edu-instructor-title">Formateur</h2>
                <h3>${escapeHtml(program.instructor.name)}</h3>
                ${program.instructor.bio ? `<p>${escapeHtml(program.instructor.bio)}</p>` : ''}
              </section>
            ` : ''}

            ${program.publicCurriculum.length ? `
              <section class="edu-detail-section" aria-labelledby="edu-curriculum-title">
                <h2 id="edu-curriculum-title">Programme</h2>
                ${program.publicCurriculum.map((module) => `
                  <div class="edu-curriculum-module">
                    <h3>${escapeHtml(module.title)}</h3>
                    ${module.description ? `<p>${escapeHtml(module.description)}</p>` : ''}
                    <ul>${module.lessons.map((lesson) => `<li>${escapeHtml(lesson.title)}${lesson.estimatedDurationMinutes ? ` · ${lesson.estimatedDurationMinutes} min` : ''}${lesson.isFreePreview ? ' · Aperçu' : ''}</li>`).join('')}</ul>
                  </div>
                `).join('')}
              </section>
            ` : ''}

            <section class="edu-detail-section" aria-labelledby="edu-prereq-title">
              <h2 id="edu-prereq-title">Prérequis</h2>
              <p>${escapeHtml(program.prerequisites || 'À confirmer')}</p>
            </section>

            ${this.related.length ? `
              <section class="edu-detail-section" aria-labelledby="edu-related-title">
                <h2 id="edu-related-title">Autres formations en ${escapeHtml(this.category?.name || 'ce domaine')}</h2>
                <div class="edu-rail">${this.related.map((item) => renderCourseCard(item, {})).join('')}</div>
              </section>
            ` : ''}

            <a class="edu-back-link" href="${escapeHtml(buildEducationHomeUrl('#edu-courses'))}">
              <i class="fas fa-arrow-left" aria-hidden="true"></i> Retour aux formations
            </a>
          </div>

          <aside class="edu-detail-aside">
            <div class="edu-recap-card">
              <dl class="edu-recap-list">
                <div class="edu-recap-row"><dt>Domaine</dt><dd>${escapeHtml(this.category?.name || 'À confirmer')}</dd></div>
                <div class="edu-recap-row"><dt>Niveau</dt><dd>${escapeHtml(program.level || 'À confirmer')}</dd></div>
                <div class="edu-recap-row"><dt>Durée</dt><dd>${escapeHtml(program.duration.displayLabel)}</dd></div>
                <div class="edu-recap-row"><dt>Modalité</dt><dd>${escapeHtml(getModalityLabel(program.modality))}</dd></div>
                <div class="edu-recap-row"><dt>Lieu</dt><dd>${escapeHtml(getProgramLocationLabel(program))}</dd></div>
                <div class="edu-recap-row"><dt>Horaire</dt><dd>${escapeHtml(program.schedule || 'À confirmer')}</dd></div>
                <div class="edu-recap-row"><dt>Prix</dt><dd>${escapeHtml(program.price.displayLabel)}</dd></div>
                <div class="edu-recap-row"><dt>Inscriptions</dt><dd>${escapeHtml(program.registration.displayLabel)}</dd></div>
                <div class="edu-recap-row"><dt>Disponibilité</dt><dd>${escapeHtml(program.capacity.displayLabel)}</dd></div>
              </dl>
              <button type="button" class="edu-recap-cta" data-edu-info-request>
                Demander des informations <i class="fas fa-arrow-right" aria-hidden="true"></i>
              </button>
              <p class="edu-recap-note">${program.isDemo
                ? 'Formation de démonstration : ces informations servent à prévisualiser la future expérience Smart Cut Education.'
                : 'Les demandes d’information ne sont pas encore ouvertes.'}</p>
            </div>
          </aside>
        </div>
      </div>
    `;
  }

  renderNotFound() {
    this.container.innerHTML = `
      <div class="edu-container edu-detail">
        <nav class="edu-breadcrumb" aria-label="Fil d'Ariane">
          <ol>
            <li><a href="${escapeHtml(buildEducationHomeUrl())}">Smart Cut Education</a></li>
            <li aria-current="page">Formation introuvable</li>
          </ol>
        </nav>
        <div class="edu-not-found">
          <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
          <h1>Cette formation est introuvable</h1>
          <p>Le lien utilisé ne correspond à aucune formation publiée actuellement sur Smart Cut Education.</p>
          <a class="edu-btn-primary" href="${escapeHtml(buildEducationHomeUrl())}">Retour à Smart Cut Education</a>
        </div>
      </div>
    `;
  }

  renderError(error) {
    console.error('[education-programme] Échec du chargement:', error);
    const message = error instanceof EducationRepositoryError
      ? error.message
      : 'Impossible de charger cette formation pour le moment.';

    this.container.innerHTML = `
      <div class="edu-container edu-detail">
        <nav class="edu-breadcrumb" aria-label="Fil d'Ariane">
          <ol>
            <li><a href="${escapeHtml(buildEducationHomeUrl())}">Smart Cut Education</a></li>
            <li aria-current="page">Erreur de chargement</li>
          </ol>
        </nav>
        ${renderErrorBlock(message)}
      </div>
    `;
    this.container.querySelector('[data-edu-retry]')?.addEventListener('click', () => {
      this.renderLoading();
      this.load();
    });
  }

  bindEvents() {
    this.toast = createToastController(this.container);
    this.container.querySelector('[data-edu-info-request]')?.addEventListener('click', () => {
      this.toast?.show('Les demandes d’information seront disponibles dans une prochaine étape.');
    });
  }

  destroy() {
    this.toast?.destroy();
  }
}
