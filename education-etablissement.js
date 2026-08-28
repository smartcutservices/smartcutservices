// ============= SMART CUT EDUCATION - FICHE ETABLISSEMENT =============
// Page publique dynamique. Resolution slug d'abord, id en compatibilite
// (education-etablissement.html?slug=... ou ?id=...), ?demo=1 pour forcer
// les donnees locales de demonstration. Aucun badge "Verifie" n'est jamais
// affiche : le statut de verification vient tel quel de la donnee normalisee
// (unverified par defaut, jamais suppose).

import { getEducationSource, EducationRepositoryError } from './education-source.js';
import { resolveBySlugThenId } from './education-normalize.js';
import { renderCourseCard, renderDemoPill, renderLoadingBlock, renderErrorBlock, renderEmptyBlock } from './education-components.js';
import {
  escapeHtml,
  getInitials,
  buildEducationHomeUrl,
  readIdFromQuery,
  readSlugFromQuery,
  isDemoMode,
  createToastController
} from './education-utils.js';

export default class EducationEtablissementPage {
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
    this.container.innerHTML = `<div class="edu-container edu-detail">${renderLoadingBlock('Chargement de l’établissement…')}</div>`;
  }

  async load() {
    try {
      const school = await resolveBySlugThenId({
        slug: this.slug,
        id: this.id,
        findBySlug: (slug) => this.source.getPublishedSchoolBySlug(slug),
        findById: (id) => this.source.getPublishedSchoolById(id)
      });

      if (!school) {
        this.renderNotFound();
        document.title = 'Établissement introuvable | Smart Cut Education';
        return;
      }

      const courses = await this.source.listPublishedProgramsBySchool(school.id);

      this.school = school;
      this.courses = courses;

      document.title = `${school.name} | Smart Cut Education`;
      this.render();
      this.bindEvents();
    } catch (error) {
      this.renderError(error);
    }
  }

  render() {
    const school = this.school;
    const courses = this.courses;

    this.container.innerHTML = `
      <div class="edu-container edu-detail">
        <nav class="edu-breadcrumb" aria-label="Fil d'Ariane">
          <ol>
            <li><a href="${escapeHtml(buildEducationHomeUrl())}">Smart Cut Education</a></li>
            <li><a href="${escapeHtml(buildEducationHomeUrl('#edu-schools'))}">Établissements</a></li>
            <li aria-current="page">${escapeHtml(school.name)}</li>
          </ol>
        </nav>

        ${school.isDemo ? `
          <div class="edu-preview-banner">
            <i class="fas fa-circle-info" aria-hidden="true"></i>
            <span>Ce profil sert à prévisualiser la future expérience Smart Cut Education. Il ne représente pas encore un établissement partenaire vérifié.</span>
          </div>
        ` : ''}

        <div class="edu-detail-layout">
          <div class="edu-detail-main">
            <div class="edu-school-cover" aria-hidden="true">
              <i class="fas fa-building-columns"></i>
            </div>
            <div class="edu-school-identity">
              <div class="edu-school-identity__mark" aria-hidden="true">${escapeHtml(getInitials(school.name))}</div>
              <div>
                <h1>${escapeHtml(school.name)}</h1>
                <p><i class="fas fa-location-dot" aria-hidden="true"></i> ${escapeHtml(school.commune || 'Commune à confirmer')}</p>
              </div>
            </div>

            <div class="edu-detail-header" style="margin-top:1.25rem;">
              ${renderDemoPill(school.isDemo ? 'Établissement de démonstration' : 'Établissement publié')}
              <p class="edu-detail-lead" style="margin-top:.75rem;">${escapeHtml(school.shortDescription)}</p>
            </div>

            <section class="edu-detail-section" aria-labelledby="edu-school-about-title">
              <h2 id="edu-school-about-title">Présentation</h2>
              <p>${escapeHtml(school.fullDescription)}</p>
            </section>

            <section class="edu-detail-section" aria-labelledby="edu-school-domains-title">
              <h2 id="edu-school-domains-title">Domaines enseignés</h2>
              <div class="edu-school-card__domains">
                ${school.domains.map((domain) => `<span class="edu-school-card__domain">${escapeHtml(domain)}</span>`).join('')}
              </div>
            </section>

            <section class="edu-detail-section" aria-labelledby="edu-school-courses-title">
              <h2 id="edu-school-courses-title">Formations associées</h2>
              ${courses.length
                ? `<div class="edu-rail">${courses.map((course) => renderCourseCard(course, {})).join('')}</div>`
                : renderEmptyBlock('Aucune formation n’est encore associée à cet établissement.')}
            </section>

            <a class="edu-back-link" href="${escapeHtml(buildEducationHomeUrl('#edu-schools'))}">
              <i class="fas fa-arrow-left" aria-hidden="true"></i> Retour aux établissements
            </a>
          </div>

          <aside class="edu-detail-aside">
            <div class="edu-recap-card">
              <dl class="edu-recap-list">
                <div class="edu-recap-row"><dt>Commune</dt><dd>${escapeHtml(school.addressLabel || school.commune || 'À confirmer')}</dd></div>
                <div class="edu-recap-row"><dt>Contact</dt><dd>${escapeHtml(school.publicContact || 'À confirmer')}</dd></div>
                <div class="edu-recap-row"><dt>Formations</dt><dd>${courses.length} formation${courses.length === 1 ? '' : 's'}${school.isDemo ? ' de démonstration' : ''}</dd></div>
              </dl>
              <div class="edu-verification">
                <i class="fas fa-circle-info" aria-hidden="true"></i>
                <span>${escapeHtml(school.verification.label)}</span>
              </div>
              <button type="button" class="edu-recap-cta" data-edu-info-request>
                Demander des informations <i class="fas fa-arrow-right" aria-hidden="true"></i>
              </button>
              <p class="edu-recap-note">${school.isDemo
                ? 'Ce profil de démonstration ne représente pas encore un établissement partenaire réel.'
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
            <li aria-current="page">Établissement introuvable</li>
          </ol>
        </nav>
        <div class="edu-not-found">
          <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
          <h1>Cet établissement est introuvable</h1>
          <p>Le lien utilisé ne correspond à aucun établissement publié actuellement sur Smart Cut Education.</p>
          <a class="edu-btn-primary" href="${escapeHtml(buildEducationHomeUrl())}">Retour à Smart Cut Education</a>
        </div>
      </div>
    `;
  }

  renderError(error) {
    console.error('[education-etablissement] Échec du chargement:', error);
    const message = error instanceof EducationRepositoryError
      ? error.message
      : 'Impossible de charger cet établissement pour le moment.';

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
