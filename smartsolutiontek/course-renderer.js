// Shared rendering module for the Cours app (Application 3) — e-learning premium theme.
// Pure presentation, no Firestore/network. Mirrors field-renderer.js / shop-renderer.js.

import { escapeHtml } from './api.js';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const LESSON_TYPE_ICONS = { video: 'fa-circle-play', text: 'fa-file-lines', pdf: 'fa-file-pdf', file: 'fa-paperclip', audio: 'fa-headphones' };
const LEVEL_LABELS = { beginner: 'Débutant', intermediate: 'Intermédiaire', advanced: 'Avancé', all: 'Tous niveaux' };

function listSection(title, items, icon) {
  if (!Array.isArray(items) || !items.length) return '';
  return `<section class="sst-course-value-section"><h2>${escapeHtml(title)}</h2><ul>${items.map((item) => `<li><i class="fas ${icon}"></i><span>${escapeHtml(item)}</span></li>`).join('')}</ul></section>`;
}

export function renderCourseDetails(course) {
  const duration = Number(course.estimatedDurationMinutes) || 0;
  const facts = [
    course.instructorName ? ['fa-user', 'Formateur', course.instructorName] : null,
    ['fa-signal', 'Niveau', LEVEL_LABELS[course.level] || 'Tous niveaux'],
    duration ? ['fa-clock', 'Durée estimée', `${Math.floor(duration / 60) ? `${Math.floor(duration / 60)} h ` : ''}${duration % 60 ? `${duration % 60} min` : ''}`] : null,
    ['fa-language', 'Langue', String(course.language || 'fr').toUpperCase()]
  ].filter(Boolean);
  const blocks = {
    about: course.fullDescription ? `<section class="sst-course-about"><span>À propos</span><h2>Une formation conçue pour passer à l’action</h2><p>${escapeHtml(course.fullDescription)}</p></section>` : '',
    outcomes: listSection('Ce que vous saurez faire', course.learningOutcomes, 'fa-check'),
    audience: listSection('Cette formation est pour vous si…', course.targetAudience, 'fa-user-check'),
    prerequisites: listSection('Prérequis', course.prerequisites, 'fa-arrow-right'),
    instructor: course.instructorName ? `<section class="sst-course-value-section"><h2>Votre formateur</h2><p>${escapeHtml(course.instructorName)}</p></section>` : ''
  };
  const sections = Array.isArray(course.pageSections) ? course.pageSections : Object.keys(blocks).map((id) => ({ id, visible: true }));
  const ordered = sections.filter((item) => item.visible !== false && blocks[item.id]).map((item) => blocks[item.id]).join('');
  return `<section class="sst-course-facts">${facts.map(([icon, label, value]) => `<div><i class="fas ${icon}"></i><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</section><div class="sst-course-value-grid sst-course-value-grid-ordered">${ordered}</div>`;
}

export function renderOrderedCourseSections(course, modules, offerHtml = '') {
  const duration = Number(course.estimatedDurationMinutes) || 0;
  const facts = [
    course.instructorName ? ['fa-user', 'Formateur', course.instructorName] : null,
    ['fa-signal', 'Niveau', LEVEL_LABELS[course.level] || 'Tous niveaux'],
    duration ? ['fa-clock', 'Durée estimée', `${Math.floor(duration / 60) ? `${Math.floor(duration / 60)} h ` : ''}${duration % 60 ? `${duration % 60} min` : ''}`] : null,
    ['fa-language', 'Langue', String(course.language || 'fr').toUpperCase()]
  ].filter(Boolean);
  const factsHtml = `<section class="sst-course-facts">${facts.map(([icon, label, value]) => `<div><i class="fas ${icon}"></i><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</section>`;
  const blocks = {
    hero: `<div class="sst-course-ordered-hero">${renderCourseHero(course)}<div class="sst-course-public-details">${factsHtml}</div></div>`,
    about: course.fullDescription ? `<section class="sst-course-about"><span>À propos</span><h2>Une formation conçue pour passer à l’action</h2><p>${escapeHtml(course.fullDescription)}</p></section>` : '',
    outcomes: listSection('Ce que vous saurez faire', course.learningOutcomes, 'fa-check'),
    audience: listSection('Cette formation est pour vous si…', course.targetAudience, 'fa-user-check'),
    prerequisites: listSection('Prérequis', course.prerequisites, 'fa-arrow-right'),
    curriculum: `<section class="sst-course-content-panel"><div class="sst-public-section-heading"><span>Programme</span><h2>Ce que vous allez apprendre</h2></div>${renderCurriculum(modules, { enrolled: false })}</section>`,
    instructor: course.instructorName ? `<section class="sst-course-value-section sst-course-instructor"><span>FORMATEUR</span><h2>${escapeHtml(course.instructorName)}</h2><p>Le profil est présenté avec les informations fournies par le créateur.</p></section>` : '',
    offer: offerHtml,
    faq: Array.isArray(course.faqs) && course.faqs.length ? `<section class="sst-course-faq"><span>QUESTIONS FRÉQUENTES</span><h2>Avant de vous inscrire</h2>${course.faqs.map((item) => `<details><summary>${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`).join('')}</section>` : '',
    testimonials: Array.isArray(course.testimonials) && course.testimonials.length ? `<section class="sst-course-testimonials"><span>TÉMOIGNAGES FOURNIS PAR LE CRÉATEUR</span><h2>Retours d’apprenants</h2><div>${course.testimonials.map((item) => `<figure><blockquote>« ${escapeHtml(item.quote)} »</blockquote><figcaption>${escapeHtml(item.author)}</figcaption></figure>`).join('')}</div></section>` : '',
    cta: offerHtml ? `<section class="sst-course-final-cta"><h2>Prêt à commencer ?</h2><p>${escapeHtml(course.shortDescription || course.description || 'Rejoignez la formation et avancez à votre rythme.')}</p><a href="#courseEnroll">Voir l’offre</a></section>` : '',
    legal: course.termsUrl || course.refundPolicy ? `<section class="sst-course-legal"><h2>Informations légales</h2>${course.termsUrl ? `<a href="${escapeHtml(course.termsUrl)}" target="_blank" rel="noopener">Consulter les conditions</a>` : ''}${course.refundPolicy ? `<p>${escapeHtml(course.refundPolicy)}</p>` : ''}</section>` : ''
  };
  const defaults = ['hero','about','outcomes','audience','prerequisites','curriculum','instructor','offer','faq','testimonials','cta','legal'];
  const configured = Array.isArray(course.pageSections) ? course.pageSections : defaults.map((id) => ({ id, visible: true }));
  const sections = configured.filter((item) => item.visible !== false && blocks[item.id]).map((item) => `<div class="sst-course-ordered-section section-${escapeHtml(item.id)}">${blocks[item.id]}</div>`).join('');
  return `<main class="sst-course-ordered-layout">${sections}</main>`;
}

export function renderCourseHero(course) {
  const title = escapeHtml(course.heroTitle || course.title || '');
  const subtitle = course.heroSubtitle || course.description || '';
  const layout = course.layout || 'minimal';

  const content = `<div class="sst-course-hero-content"><span class="sst-public-eyebrow">Formation en ligne</span><h1>${title}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}<div class="sst-course-hero-actions"><a href="#courseEnroll">Rejoindre la formation</a><span><i class="fas fa-clock"></i> Accès à votre rythme</span></div></div>`;
  if ((layout === 'cover' || layout === 'hero') && course.coverImage) {
    const mediaClass = layout === 'cover' ? 'sst-course-hero-cover' : 'sst-course-hero-banner';
    const inner = layout === 'cover'
      ? `<div class="sst-course-hero-scrim"></div>${content}`
      : `${content}<div class="sst-course-hero-media"><img src="${escapeHtml(course.coverImage)}" alt="Aperçu de la formation"></div>`;
    const style = layout === 'cover' ? ` style="background-image:url('${escapeHtml(course.coverImage)}')"` : '';
    return `<header class="sst-course-hero ${mediaClass}"${style}>${inner}</header>`;
  }
  return `<header class="sst-course-hero sst-course-hero-minimal">${content}</header>`;
}

function lessonRow(lesson, options) {
  const locked = !lesson.isFreePreview && !options.enrolled;
  const icon = locked ? 'fa-lock' : (LESSON_TYPE_ICONS[lesson.type] || 'fa-circle-play');
  const done = options.progress && lesson.id && options.progress[lesson.id];
  const showPreviewContent = lesson.isFreePreview && !options.enrolled && lesson.content;
  const previewContent = showPreviewContent
    ? (lesson.type === 'text'
        ? `<div class="sst-course-preview-content">${escapeHtml(lesson.content)}</div>`
        : `<div class="sst-course-preview-content"><a href="${escapeHtml(lesson.content)}" target="_blank" rel="noopener">Voir l'aperçu <i class="fas fa-arrow-up-right-from-square"></i></a></div>`)
    : '';
  return `
    <div class="sst-course-lesson-row ${locked ? 'locked' : ''} ${done ? 'done' : ''}" data-lesson-id="${lesson.id || ''}">
      <div class="sst-course-lesson-main">
        <i class="fas ${done ? 'fa-circle-check' : icon}"></i>
        <span class="sst-course-lesson-title">${escapeHtml(lesson.title)}</span>
        ${lesson.isFreePreview && !options.enrolled ? `<button class="sst-course-preview-badge" data-course-preview="${escapeHtml(lesson.id || '')}">Aperçu gratuit</button>` : ''}
      </div>
      ${previewContent}
    </div>
  `;
}

/**
 * Renders the curriculum accordion. `options.enrolled` unlocks every lesson row visually
 * (the real content gating still only ever happens server-side via getEnrolledCourseContent
 * — this flag only controls whether the lock icon/preview badge is shown).
 */
export function renderCurriculum(modules, options = {}) {
  if (!modules.length) return '<div class="sst-empty">Aucun contenu pour le moment.</div>';
  return `
    <div class="sst-course-curriculum">
      ${modules.map((mod, i) => `
        <div class="sst-course-module ${i === 0 ? 'open' : ''}" data-module-index="${i}">
          <button class="sst-course-module-header" data-toggle-module="${i}">
            <span>${escapeHtml(mod.title)}</span>
            <i class="fas fa-chevron-down"></i>
          </button>
          <div class="sst-course-module-lessons">
            ${(mod.lessons || []).map((l) => lessonRow(l, options)).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

export function applyCourseTheme(rootEl, course) {
  const colors = course.colors || {};
  const primary = HEX_COLOR_PATTERN.test(colors.primary) ? colors.primary : '#131921';
  const accent = HEX_COLOR_PATTERN.test(colors.buttonColor)
    ? colors.buttonColor
    : (HEX_COLOR_PATTERN.test(colors.accent) ? colors.accent : '#FFA41C');
  const background = HEX_COLOR_PATTERN.test(colors.backgroundColor) ? colors.backgroundColor : '#F8FAFC';
  rootEl.style.setProperty('--course-primary', primary);
  rootEl.style.setProperty('--course-accent', accent);
  rootEl.style.setProperty('--course-bg', background);
}
