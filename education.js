// ============= SMART CUT EDUCATION - CATALOGUE =============
// Page d'accueil Education : hero, categories, formations et etablissements.
// Les donnees viennent de education-source.js (Firestore normalement,
// education-data.js uniquement en mode demonstration explicite ?demo=1).
// Etape prototype : aucune admission, aucun paiement, aucun dashboard.

import { getEducationSource } from './education-source.js';
import { EDUCATION_TAXONOMY } from './education-taxonomy.js';
import {
  renderCourseCard,
  renderSchoolCard,
  renderDemoBanner,
  renderLoadingBlock,
  renderEmptyBlock,
  renderErrorBlock
} from './education-components.js';
import {
  escapeHtml,
  normalizeSearchText,
  createToastController,
  isDemoMode,
  getProgramLocationLabel,
  getModalityLabel
} from './education-utils.js';

export default class SmartCutEducation {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.demoMode = isDemoMode();
    this.source = getEducationSource();

    this.activeCategory = new URLSearchParams(window.location.search).get('category') || 'all';
    this.searchTerm = '';
    this.categories = [];
    this.schools = [];
    this.programs = [];
    this.schoolNameById = new Map();
    this.categoryLabelById = new Map();
    this.toast = null;

    this.render();
    this.bindStaticEvents();
    this.loadAll();
  }

  render() {
    const coursesLead = this.demoMode
      ? 'Un aperçu des formations disponibles bientôt sur Smart Academi. Données de démonstration.'
      : 'Découvrez les formations publiées par nos établissements partenaires.';
    const schoolsLead = this.demoMode
      ? 'Quelques établissements présentés à titre d\'exemple. Données de démonstration.'
      : 'Découvrez les établissements partenaires de Smart Academi.';
    const categoryItems = EDUCATION_TAXONOMY.map((category) => `
      <a class="edu-category-menu__item" href="./education.html?category=${encodeURIComponent(category.id)}${this.demoMode ? '&demo=1' : ''}">
        <span class="edu-category-menu__icon"><i class="fas fa-book-open" aria-hidden="true"></i></span>
        <span class="edu-category-menu__copy">
          <strong>${escapeHtml(category.name)}</strong>
          <small>${escapeHtml(category.subcategories.slice(0, 3).join(' · '))}</small>
        </span>
        <i class="fas fa-arrow-right edu-category-menu__arrow" aria-hidden="true"></i>
      </a>
    `).join('');

    this.container.innerHTML = `
      ${this.demoMode ? renderDemoBanner() : ''}

      <section class="edu-hero" id="edu-hero" aria-labelledby="edu-hero-title">
        <div class="edu-container edu-hero-inner">
          <div class="edu-hero-copy">
            <h1 class="edu-hero-title" id="edu-hero-title">Trouvez votre formation.</h1>

            <form class="edu-hero-search" role="search" data-edu-search-form>
              <label class="sr-only" for="edu-search-input">Que voulez-vous apprendre ?</label>
              <input id="edu-search-input" type="search" placeholder="Que voulez-vous apprendre ?" autocomplete="off" data-edu-search-input>
              <button type="submit" aria-label="Rechercher">
                <i class="fas fa-search" aria-hidden="true"></i>
              </button>
            </form>

            <div class="edu-hero-actions">
              <a class="edu-btn-primary" href="#edu-courses">
                Explorer les formations <i class="fas fa-arrow-right" aria-hidden="true"></i>
              </a>
            </div>
          </div>

          <div class="edu-hero-visual">
            <picture>
              <source srcset="./assets/education/hero-learning-v2.webp" type="image/webp">
              <img
                class="edu-hero-visual-img"
                src="./assets/education/hero-learning-v2.png"
                alt="Jeune femme étudiant avec un ordinateur portable et un cahier"
                width="1448"
                height="1086"
                loading="eager"
                fetchpriority="high"
                decoding="async"
              >
            </picture>
          </div>
        </div>
      </section>

      <section class="edu-category-menu" aria-label="Catégories de formations">
        <div class="edu-container">
          <button class="edu-category-menu__trigger" type="button" aria-expanded="false" aria-controls="edu-category-panel" data-edu-category-trigger>
            <span><i class="fas fa-layer-group" aria-hidden="true"></i> Explorer les catégories</span>
            <span class="edu-category-menu__trigger-meta">${EDUCATION_TAXONOMY.length} domaines <i class="fas fa-chevron-down" aria-hidden="true"></i></span>
          </button>
          <div class="edu-category-menu__panel" id="edu-category-panel" role="region" aria-label="Domaines de formation" data-edu-category-panel>
            <div class="edu-category-menu__head">
              <strong>Choisissez un domaine</strong>
              <span>Formations, métiers et compétences</span>
            </div>
            <div class="edu-category-menu__grid">${categoryItems}</div>
          </div>
        </div>
      </section>

      <section class="edu-section edu-section--alt" id="edu-courses" aria-labelledby="edu-courses-title">
        <div class="edu-container">
          <div class="edu-section-head">
            <span class="edu-section-eyebrow">À explorer</span>
            <h2 class="edu-section-title" id="edu-courses-title">Formations populaires</h2>
            <p class="edu-section-lead" data-edu-courses-lead>${escapeHtml(coursesLead)}</p>
          </div>
          <div class="edu-filter-status" role="status" aria-live="polite" data-edu-filter-status></div>
          <div class="edu-rail" data-edu-course-rail>${renderLoadingBlock('Chargement des formations…')}</div>
        </div>
      </section>

      <section class="edu-section" id="edu-schools" aria-labelledby="edu-schools-title">
        <div class="edu-container">
          <div class="edu-section-head">
            <span class="edu-section-eyebrow">Où se former</span>
            <h2 class="edu-section-title" id="edu-schools-title">Établissements à découvrir</h2>
            <p class="edu-section-lead" data-edu-schools-lead>${escapeHtml(schoolsLead)}</p>
          </div>
          <div class="edu-rail edu-rail--schools" data-edu-schools-rail>${renderLoadingBlock('Chargement des établissements…')}</div>
          ${this.demoMode ? `
            <p class="edu-establishments-note">
              <i class="fas fa-circle-info" aria-hidden="true"></i>
              Établissements de démonstration — un aperçu de la future expérience Smart Academi.
            </p>
          ` : ''}
        </div>
      </section>

      <section class="edu-tutor" id="edu-tutor" aria-labelledby="edu-tutor-title">
        <div class="edu-container">
          <div class="edu-tutor-inner">
            <div class="edu-tutor-copy">
              <h2 id="edu-tutor-title">Trouver un tuteur</h2>
              <p>Bientôt, mettez-vous en relation avec des tuteurs près de chez vous pour un accompagnement personnalisé.</p>
            </div>
            <a class="edu-tutor-cta" href="./education-tuteurs.html">
              Trouver un tuteur <i class="fas fa-arrow-right" aria-hidden="true"></i>
            </a>
          </div>
        </div>
      </section>

    `;

    this.toast = createToastController(this.container);
  }

  bindStaticEvents() {
    const searchForm = this.container.querySelector('[data-edu-search-form]');
    const searchInput = this.container.querySelector('[data-edu-search-input]');
    searchForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.searchTerm = normalizeSearchText(searchInput?.value || '');
      this.applyFilters();
      this.container.querySelector('#edu-courses')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    searchInput?.addEventListener('input', () => {
      this.searchTerm = normalizeSearchText(searchInput.value || '');
      this.applyFilters();
    });

    const categoryMenu = this.container.querySelector('.edu-category-menu');
    const categoryTrigger = this.container.querySelector('[data-edu-category-trigger]');
    const categoryPanel = this.container.querySelector('[data-edu-category-panel]');
    const closeCategories = () => {
      categoryMenu?.classList.remove('is-open');
      categoryTrigger?.setAttribute('aria-expanded', 'false');
    };
    categoryTrigger?.addEventListener('click', () => {
      const isOpen = categoryMenu.classList.toggle('is-open');
      categoryTrigger.setAttribute('aria-expanded', String(isOpen));
    });
    categoryPanel?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeCategories));
    document.addEventListener('click', (event) => {
      if (categoryMenu && !categoryMenu.contains(event.target)) closeCategories();
    });
    categoryTrigger?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeCategories();
    });

    this.container.querySelectorAll('[data-edu-coming-soon]').forEach((button) => {
      button.addEventListener('click', () => {
        this.toast?.show('Cette fonctionnalité arrive bientôt.');
      });
    });

  }

  setActiveCategory(categoryId) {
    this.activeCategory = categoryId;
    this.container.querySelectorAll('[data-edu-category]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.eduCategory === categoryId);
    });
    this.applyFilters();
  }

  async loadAll() {
    try {
      const [categories, schools, programs] = await Promise.all([
        this.source.listPublishedCategories(),
        this.source.listPublishedSchools(),
        this.source.listPublishedPrograms()
      ]);

      // Keep category suggestions useful before the administrator has seeded
      // every taxonomy entry in Firestore; configured records always win.
      const configured = new Map(categories.map((category) => [category.id, category]));
      EDUCATION_TAXONOMY.forEach((category) => {
        if (!configured.has(category.id)) configured.set(category.id, {
          ...category,
          description: category.subcategories.slice(0, 4).join(' · '),
          icon: 'fa-book-open',
          image: null
        });
      });
      this.categories = [...configured.values()].sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
      this.schools = schools;
      this.programs = programs;
      this.schoolNameById = new Map(schools.map((school) => [school.id, school.name]));
      this.categoryLabelById = new Map(this.categories.map((category) => [category.id, category.name]));

      if (this.activeCategory !== 'all' && !this.categoryLabelById.has(this.activeCategory)) {
        this.activeCategory = 'all';
      }

      this.renderCourses();
      this.renderSchools();
      this.applyFilters();
    } catch (error) {
      this.renderLoadError(error);
    }
  }

  buildSearchIndex(program) {
    const schoolName = this.schoolNameById.get(program.schoolId) || '';
    const categoryLabel = this.categoryLabelById.get(program.categoryId) || '';
    const parts = [
      program.title,
      schoolName,
      program.commune,
      getProgramLocationLabel(program),
      categoryLabel,
      getModalityLabel(program.modality)
    ];
    return normalizeSearchText(parts.filter(Boolean).join(' '));
  }

  renderCourses() {
    const rail = this.container.querySelector('[data-edu-course-rail]');
    if (!rail) return;

    if (!this.programs.length) {
      rail.innerHTML = renderEmptyBlock(
        this.demoMode
          ? 'Aucune formation de démonstration disponible pour le moment.'
          : 'Les premières formations seront bientôt disponibles.'
      );
      return;
    }

    rail.innerHTML = this.programs.map((program) => renderCourseCard(program, {
      schoolName: this.schoolNameById.get(program.schoolId),
      searchIndex: this.buildSearchIndex(program)
    })).join('');
  }

  renderSchools() {
    const rail = this.container.querySelector('[data-edu-schools-rail]');
    if (!rail) return;

    if (!this.schools.length) {
      rail.innerHTML = renderEmptyBlock(
        this.demoMode
          ? 'Aucun établissement de démonstration disponible pour le moment.'
          : 'Les premiers établissements seront bientôt disponibles.'
      );
      return;
    }

    const courseCountBySchool = new Map();
    this.programs.forEach((program) => {
      courseCountBySchool.set(program.schoolId, (courseCountBySchool.get(program.schoolId) || 0) + 1);
    });

    rail.innerHTML = this.schools.map((school) => renderSchoolCard(school, {
      courseCount: courseCountBySchool.get(school.id) || 0
    })).join('');
  }

  renderLoadError(error) {
    console.error('[education] Échec du chargement du catalogue:', error);
    const message = error?.message || 'Impossible de charger les données pour le moment.';
    const courseRail = this.container.querySelector('[data-edu-course-rail]');
    const schoolRail = this.container.querySelector('[data-edu-schools-rail]');
    if (courseRail) courseRail.innerHTML = renderErrorBlock(message);
    if (schoolRail) schoolRail.innerHTML = renderErrorBlock(message);
    this.container.querySelectorAll('[data-edu-retry]').forEach((button) => {
      button.addEventListener('click', () => {
        const rail = button.closest('[data-edu-course-rail], [data-edu-schools-rail]');
        if (rail) rail.innerHTML = renderLoadingBlock('Nouvelle tentative…');
        this.loadAll();
      });
    });
  }

  applyFilters() {
    const cards = this.container.querySelectorAll('[data-edu-course]');
    let visibleCount = 0;

    cards.forEach((card) => {
      const matchesCategory = this.activeCategory === 'all' || card.dataset.category === this.activeCategory;
      const matchesSearch = !this.searchTerm || card.dataset.search.includes(this.searchTerm);
      const visible = matchesCategory && matchesSearch;
      card.style.display = visible ? '' : 'none';
      if (visible) visibleCount += 1;
    });

    const rail = this.container.querySelector('[data-edu-course-rail]');
    let emptyNote = rail?.querySelector('.edu-empty-note');
    if (cards.length && !visibleCount) {
      if (!emptyNote && rail) {
        emptyNote = document.createElement('p');
        emptyNote.className = 'edu-empty-note';
        emptyNote.textContent = 'Aucune formation ne correspond à votre recherche pour le moment.';
        rail.appendChild(emptyNote);
      }
    } else {
      emptyNote?.remove();
    }

    this.updateFilterStatus(visibleCount, cards.length);
  }

  updateFilterStatus(visibleCount, totalCount) {
    const status = this.container.querySelector('[data-edu-filter-status]');
    if (!status) return;

    const hasActiveFilter = this.activeCategory !== 'all' || Boolean(this.searchTerm);
    if (!hasActiveFilter || !totalCount) {
      status.innerHTML = '';
      return;
    }

    const label = visibleCount === 0
      ? 'Aucune formation trouvée'
      : `${visibleCount} formation${visibleCount > 1 ? 's' : ''} trouvée${visibleCount > 1 ? 's' : ''}`;

    status.innerHTML = `
      <span>${escapeHtml(label)}</span>
      <button type="button" class="edu-filter-reset" data-edu-reset-filters>Réinitialiser</button>
    `;

    status.querySelector('[data-edu-reset-filters]')?.addEventListener('click', () => this.resetFilters());
  }

  resetFilters() {
    this.activeCategory = 'all';
    this.searchTerm = '';
    const searchInput = this.container.querySelector('[data-edu-search-input]');
    if (searchInput) searchInput.value = '';
    this.container.querySelectorAll('[data-edu-category]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.eduCategory === 'all');
    });
    this.applyFilters();
  }

  destroy() {
    this.subnavObserver?.disconnect();
    this.toast?.destroy();
  }
}
