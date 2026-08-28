import { getEducationSource } from './education-source.js';
import {
  renderCourseCard,
  renderSchoolCard,
  renderDemoBanner,
  renderLoadingBlock,
  renderEmptyBlock,
  renderErrorBlock
} from './education-components.js';
import { escapeHtml, normalizeSearchText, isDemoMode } from './education-utils.js';

const PAGE_CONFIG = {
  formations: {
    eyebrow: 'Catalogue',
    title: 'Toutes les formations',
    lead: 'Explorez les programmes publiés par les établissements partenaires.',
    placeholder: 'Rechercher une formation',
    icon: 'fa-graduation-cap'
  },
  etablissements: {
    eyebrow: 'Annuaire',
    title: 'Les établissements',
    lead: 'Découvrez les écoles et centres de formation disponibles sur Smart Cut Education.',
    placeholder: 'Rechercher un établissement',
    icon: 'fa-building-columns'
  },
  tuteurs: {
    eyebrow: 'Accompagnement',
    title: 'Trouver un tuteur',
    lead: 'Un espace dédié à l’accompagnement individuel et aux besoins spécifiques.',
    icon: 'fa-user-group'
  }
};

export default class EducationDirectoryPage {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    this.view = options.view || this.container.dataset.educationView || 'formations';
    this.config = PAGE_CONFIG[this.view] || PAGE_CONFIG.formations;
    this.source = getEducationSource();
    this.demoMode = isDemoMode();
    this.items = [];
    this.schools = [];
    this.renderShell();
    if (this.view !== 'tuteurs') this.load();
  }

  renderShell() {
    const search = this.view === 'tuteurs' ? '' : `
      <label class="edu-directory-search">
        <span class="sr-only">${escapeHtml(this.config.placeholder)}</span>
        <i class="fas fa-search" aria-hidden="true"></i>
        <input type="search" placeholder="${escapeHtml(this.config.placeholder)}" autocomplete="off" data-directory-search>
      </label>
    `;

    this.container.innerHTML = `
      ${this.demoMode ? renderDemoBanner() : ''}
      <section class="edu-directory-hero">
        <div class="edu-container edu-directory-hero__inner">
          <a class="edu-directory-back" href="./education.html${this.demoMode ? '?demo=1' : ''}">
            <i class="fas fa-arrow-left" aria-hidden="true"></i> Accueil Education
          </a>
          <span class="edu-directory-hero__icon" aria-hidden="true"><i class="fas ${this.config.icon}"></i></span>
          <span class="edu-section-eyebrow">${escapeHtml(this.config.eyebrow)}</span>
          <h1>${escapeHtml(this.config.title)}</h1>
          <p>${escapeHtml(this.config.lead)}</p>
          ${search}
        </div>
      </section>
      <section class="edu-directory-content">
        <div class="edu-container">
          <div class="edu-directory-status" role="status" aria-live="polite" data-directory-status></div>
          <div class="edu-directory-grid" data-directory-grid>
            ${this.view === 'tuteurs'
              ? this.renderTutorsPlaceholder()
              : renderLoadingBlock(this.view === 'formations' ? 'Chargement des formations…' : 'Chargement des établissements…')}
          </div>
        </div>
      </section>
    `;

    this.container.querySelector('[data-directory-search]')?.addEventListener('input', (event) => {
      this.applySearch(event.target.value);
    });
  }

  renderTutorsPlaceholder() {
    return `
      <article class="edu-tutors-placeholder">
        <span aria-hidden="true"><i class="fas fa-user-clock"></i></span>
        <h2>Annuaire des tuteurs en préparation</h2>
        <p>Les profils seront affichés ici dès leur validation.</p>
        <a href="./education-formations.html${this.demoMode ? '?demo=1' : ''}" class="edu-btn-primary">Voir les formations</a>
      </article>
    `;
  }

  async load() {
    try {
      if (this.view === 'formations') {
        const [programs, schools] = await Promise.all([
          this.source.listPublishedPrograms(),
          this.source.listPublishedSchools()
        ]);
        this.items = programs;
        this.schools = schools;
      } else {
        const [schools, programs] = await Promise.all([
          this.source.listPublishedSchools(),
          this.source.listPublishedPrograms()
        ]);
        this.items = schools;
        this.programs = programs;
      }
      this.renderItems();
    } catch (error) {
      this.renderError(error);
    }
  }

  renderItems() {
    const grid = this.container.querySelector('[data-directory-grid]');
    if (!grid) return;
    if (!this.items.length) {
      grid.innerHTML = renderEmptyBlock(this.view === 'formations'
        ? 'Aucune formation publiée pour le moment.'
        : 'Aucun établissement publié pour le moment.');
      this.updateStatus(0, 0);
      return;
    }

    if (this.view === 'formations') {
      const schoolNames = new Map(this.schools.map((school) => [school.id, school.name]));
      grid.innerHTML = this.items.map((program) => {
        const schoolName = schoolNames.get(program.schoolId) || '';
        const search = normalizeSearchText([program.title, program.commune, schoolName].join(' '));
        return `<div data-directory-item data-search="${escapeHtml(search)}">${renderCourseCard(program, { schoolName })}</div>`;
      }).join('');
    } else {
      const countBySchool = new Map();
      (this.programs || []).forEach((program) => countBySchool.set(program.schoolId, (countBySchool.get(program.schoolId) || 0) + 1));
      grid.innerHTML = this.items.map((school) => {
        const search = normalizeSearchText([school.name, school.commune, ...(school.domains || [])].join(' '));
        return `<div data-directory-item data-search="${escapeHtml(search)}">${renderSchoolCard(school, { courseCount: countBySchool.get(school.id) || 0 })}</div>`;
      }).join('');
    }
    this.updateStatus(this.items.length, this.items.length);
  }

  applySearch(value) {
    const query = normalizeSearchText(value);
    const elements = [...this.container.querySelectorAll('[data-directory-item]')];
    let visible = 0;
    elements.forEach((element) => {
      const match = !query || String(element.dataset.search || '').includes(query);
      element.hidden = !match;
      if (match) visible += 1;
    });
    this.updateStatus(visible, elements.length, Boolean(query));
  }

  updateStatus(visible, total, filtered = false) {
    const status = this.container.querySelector('[data-directory-status]');
    if (!status) return;
    const label = this.view === 'formations' ? 'formation' : 'établissement';
    status.textContent = filtered
      ? `${visible} ${label}${visible > 1 ? 's' : ''} trouvé${visible > 1 ? 's' : ''}`
      : `${total} ${label}${total > 1 ? 's' : ''}`;
  }

  renderError(error) {
    const grid = this.container.querySelector('[data-directory-grid]');
    if (!grid) return;
    grid.innerHTML = renderErrorBlock(error?.message || 'Impossible de charger les données pour le moment.');
    grid.querySelector('[data-edu-retry]')?.addEventListener('click', () => {
      grid.innerHTML = renderLoadingBlock('Nouvelle tentative…');
      this.load();
    });
  }
}
