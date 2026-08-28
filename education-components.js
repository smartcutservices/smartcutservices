// ============= SMART CUT EDUCATION - COMPOSANTS PARTAGES =============
// Rendu pur de la carte formation et de la carte etablissement : aucune
// dependance a une source de donnees (ni education-data.js, ni Firestore).
// Les pages resolvent l'etablissement/la categorie via education-source.js
// et passent le resultat en parametre — reutilise par le catalogue
// (education.js), la fiche formation et la fiche etablissement.

import {
  escapeHtml,
  getModalityLabel,
  getProgramLocationLabel,
  buildCoursePageUrl,
  buildSchoolPageUrl,
  getInitials
} from './education-utils.js';
import { formatDurationLabel, formatPriceLabel } from './education-normalize.js';

export const CATEGORY_MEDIA = {
  tech: { gradient: 'linear-gradient(160deg, #2b3140, #16181d)', icon: 'fa-laptop-code' },
  gestion: { gradient: 'linear-gradient(160deg, #C93A24, #E4472F)', icon: 'fa-briefcase' },
  langues: { gradient: 'linear-gradient(160deg, #3a4e6b, #232c3b)', icon: 'fa-language' },
  sante: { gradient: 'linear-gradient(160deg, #6b4a3a, #4b3226)', icon: 'fa-briefcase-medical' },
  metiers: { gradient: 'linear-gradient(160deg, #45505f, #2a323d)', icon: 'fa-screwdriver-wrench' },
  arts: { gradient: 'linear-gradient(160deg, #7a3a5c, #4b243a)', icon: 'fa-palette' }
};

const DEFAULT_MEDIA = CATEGORY_MEDIA.tech;

export function getCourseMedia(program) {
  return CATEGORY_MEDIA[program?.categoryId] || DEFAULT_MEDIA;
}

export function renderDemoPill(text = 'Démonstration') {
  return `<span class="edu-demo-pill">${escapeHtml(text)}</span>`;
}

export function renderDemoBanner() {
  return `
    <div class="edu-demo-banner" role="note">
      <i class="fas fa-flask" aria-hidden="true"></i>
      <span>Mode démonstration — ces contenus ne représentent pas encore des partenaires réels.</span>
    </div>
  `;
}

export function renderLoadingBlock(message = 'Chargement…') {
  return `
    <div class="edu-state edu-state--loading" role="status" aria-live="polite">
      <i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

export function renderEmptyBlock(message) {
  return `
    <div class="edu-state edu-state--empty" role="status">
      <i class="fas fa-circle-info" aria-hidden="true"></i>
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

export function renderErrorBlock(message, { retryAttr = 'data-edu-retry' } = {}) {
  return `
    <div class="edu-state edu-state--error" role="alert">
      <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
      <p>${escapeHtml(message)}</p>
      <button type="button" class="edu-btn-primary" ${retryAttr}>Réessayer</button>
    </div>
  `;
}

export function renderCourseCard(program, { schoolName, searchIndex = '' } = {}) {
  const media = getCourseMedia(program);
  const resolvedSchoolName = schoolName || 'Établissement à confirmer';
  const durationLabel = program.duration?.displayLabel || formatDurationLabel(program.duration);
  const priceLabel = program.price?.displayLabel || formatPriceLabel(program.price);

  return `
    <a
      class="edu-course-card"
      href="${escapeHtml(buildCoursePageUrl(program))}"
      data-edu-course
      data-category="${escapeHtml(program.categoryId || '')}"
      data-search="${escapeHtml(searchIndex)}"
    >
      <span class="edu-course-card__media" style="background:${media.gradient}">
        ${program.badge ? `<span class="edu-course-card__badge">${escapeHtml(program.badge)}</span>` : ''}
        <span class="edu-course-card__media-icon"><i class="fas ${media.icon}" aria-hidden="true"></i></span>
      </span>
      <span class="edu-course-card__body">
        <h3 class="edu-course-card__title">${escapeHtml(program.title)}</h3>
        <span class="edu-course-card__meta">
          <span><i class="fas fa-building-columns" aria-hidden="true"></i> ${escapeHtml(resolvedSchoolName)}</span>
          <span><i class="fas fa-location-dot" aria-hidden="true"></i> ${escapeHtml(getProgramLocationLabel(program))}</span>
          <span><i class="fas fa-clock" aria-hidden="true"></i> ${escapeHtml(durationLabel)}</span>
        </span>
        <span class="edu-course-card__footer">
          <span class="edu-course-card__demo-pill">${program.isDemo ? 'Formation de démonstration' : getModalityLabel(program.modality)}</span>
          <span class="edu-course-card__price">${escapeHtml(priceLabel)}</span>
        </span>
      </span>
    </a>
  `;
}

export function renderSchoolCard(school, { courseCount = null } = {}) {
  return `
    <a class="edu-school-card" href="${escapeHtml(buildSchoolPageUrl(school))}">
      <span class="edu-school-card__cover" aria-hidden="true">
        <i class="fas fa-building-columns"></i>
      </span>
      <span class="edu-school-card__content">
        <span class="edu-school-card__head">
          <span class="edu-school-card__mark" aria-hidden="true">${escapeHtml(getInitials(school.name))}</span>
          <span>
            <h3 class="edu-school-card__name">${escapeHtml(school.name)}</h3>
            <span class="edu-school-card__city">${escapeHtml(school.commune || 'Commune à confirmer')}</span>
          </span>
        </span>
        <span class="edu-school-card__domains">
          ${(school.domains || []).map((domain) => `<span class="edu-school-card__domain">${escapeHtml(domain)}</span>`).join('')}
        </span>
        ${courseCount !== null ? `<span class="edu-school-card__count">${courseCount} formation${courseCount === 1 ? '' : 's'}${school.isDemo ? ' de démonstration' : ''}</span>` : ''}
        <span class="edu-school-card__cta">Voir l'établissement <i class="fas fa-arrow-right" aria-hidden="true"></i></span>
      </span>
    </a>
  `;
}
