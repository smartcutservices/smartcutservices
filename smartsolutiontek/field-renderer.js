// Shared field-rendering module for the SmartSolutionTek form builder (Application 1).
// Pure presentation — no Firestore/auth/network dependency — imported identically by
// page.html (the real public page) and dashboard.html (the builder's live preview),
// so the two can never visually drift from each other. Network calls (submit, file
// upload) stay in the importing page; this module only produces markup and reads it
// back via collectAnswers().

import { escapeHtml, formatCurrency } from './api.js';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const STRUCTURAL_TYPES = new Set(['sectionTitle', 'sectionText', 'divider']);

// Used only when a field's own `options` are absent (e.g. a fresh builder preview
// before the form has ever been saved) — the real public page always gets a full
// server-populated list from GetPublicForm.
const PREVIEW_COUNTRIES = ['Haiti', 'Etats-Unis', 'Canada', 'France', 'Republique Dominicaine'];

function sortedFields(form) {
  return Array.isArray(form?.fields) ? [...form.fields].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
}

function fieldWrapper(field, innerHtml, { skipLabel = false } = {}) {
  const label = skipLabel
    ? ''
    : `<label class="sst-form-label" for="field_${field.id}">${escapeHtml(field.label)}${field.required ? ' <span class="sst-form-required">*</span>' : ''}</label>`;
  const description = field.description ? `<p class="sst-form-field-desc">${escapeHtml(field.description)}</p>` : '';
  return `<div class="sst-form-field" data-field-id="${field.id}" data-field-type="${field.type}">${label}${description}${innerHtml}</div>`;
}

function renderBasicInput(field, type) {
  const placeholder = field.placeholder ? escapeHtml(field.placeholder) : '';
  return `<input class="sst-form-input" type="${type}" id="field_${field.id}" placeholder="${placeholder}" ${field.required ? 'required' : ''}>`;
}

function renderTextarea(field) {
  const placeholder = field.placeholder ? escapeHtml(field.placeholder) : '';
  return `<textarea class="sst-form-input sst-form-textarea" id="field_${field.id}" rows="4" placeholder="${placeholder}" ${field.required ? 'required' : ''}></textarea>`;
}

function renderNumber(field) {
  const min = Number.isFinite(field.min) ? ` min="${field.min}"` : '';
  const max = Number.isFinite(field.max) ? ` max="${field.max}"` : '';
  return `<input class="sst-form-input" type="number" id="field_${field.id}"${min}${max} ${field.required ? 'required' : ''}>`;
}

function renderDate(field) {
  const min = field.minDate ? ` min="${String(field.minDate).slice(0, 10)}"` : '';
  const max = field.maxDate ? ` max="${String(field.maxDate).slice(0, 10)}"` : '';
  return `<input class="sst-form-input" type="date" id="field_${field.id}"${min}${max} ${field.required ? 'required' : ''}>`;
}

function renderSelect(field, { countryFallback = false } = {}) {
  const options = Array.isArray(field.options) && field.options.length
    ? field.options
    : (countryFallback ? PREVIEW_COUNTRIES : []);
  const opts = options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('');
  const otherOpt = field.allowOther ? '<option value="__other__">Autre...</option>' : '';
  const otherInput = field.allowOther
    ? `<input class="sst-form-input sst-form-other-input" id="field_${field.id}__other" placeholder="Precisez">`
    : '';
  return `<select class="sst-form-input" id="field_${field.id}" ${field.required ? 'required' : ''}><option value="">Choisir...</option>${opts}${otherOpt}</select>${otherInput}`;
}

function renderRadioGroup(field) {
  const opts = (field.options || []).map((o) => `
    <label class="sst-form-radio-option"><input type="radio" name="field_${field.id}" value="${escapeHtml(o)}" ${field.required ? 'required' : ''}><span>${escapeHtml(o)}</span></label>
  `).join('');
  const other = field.allowOther ? `
    <label class="sst-form-radio-option"><input type="radio" name="field_${field.id}" value="__other__"><span>Autre...</span></label>
    <input class="sst-form-input sst-form-other-input" id="field_${field.id}__other" placeholder="Precisez">
  ` : '';
  return `<div class="sst-form-radio-group" id="field_${field.id}">${opts}${other}</div>`;
}

function renderCheckboxGroup(field) {
  const opts = (field.options || []).map((o) => `
    <label class="sst-form-checkbox-option"><input type="checkbox" name="field_${field.id}" value="${escapeHtml(o)}"><span>${escapeHtml(o)}</span></label>
  `).join('');
  return `<div class="sst-form-checkbox-group" id="field_${field.id}">${opts}</div>`;
}

function renderCheckboxSingle(field) {
  return `<label class="sst-form-checkbox-single"><input type="checkbox" id="field_${field.id}" ${field.required ? 'required' : ''}><span>${escapeHtml(field.label)}</span></label>`;
}

function renderConsent(field) {
  const link = field.linkUrl ? ` <a href="${escapeHtml(field.linkUrl)}" target="_blank" rel="noopener">En savoir plus</a>` : '';
  return `<label class="sst-form-checkbox-single"><input type="checkbox" id="field_${field.id}" required><span>${escapeHtml(field.text || field.label)}${link}</span></label>`;
}

function renderFile(field) {
  const accept = field.accept
    ? ` accept="${escapeHtml(field.accept)}"`
    : (field.fileKind === 'image' ? ' accept="image/*"' : ' accept="image/*,application/pdf"');
  return `
    <div class="sst-form-dropzone" id="dropzone_${field.id}">
      <input type="file" id="field_${field.id}" class="sst-form-file-input"${accept} ${field.required ? 'required' : ''}>
      <div class="sst-form-dropzone-hint"><i class="fas fa-cloud-arrow-up"></i> Cliquez pour choisir un fichier (max ${field.maxSizeMB || 10} Mo)</div>
      <div class="sst-form-dropzone-status" id="status_${field.id}"></div>
    </div>
  `;
}

function renderSectionTitle(field) {
  const description = field.description ? `<p>${escapeHtml(field.description)}</p>` : '';
  return `<div class="sst-form-section-title"><h3>${escapeHtml(field.title)}</h3>${description}</div>`;
}

function renderSectionText(field) {
  return `<div class="sst-form-section-text"><p>${escapeHtml(field.text)}</p></div>`;
}

/** Renders one field (or structural block) to an HTML string. */
export function renderField(field) {
  switch (field.type) {
    case 'sectionTitle': return renderSectionTitle(field);
    case 'sectionText': return renderSectionText(field);
    case 'divider': return '<hr class="sst-form-divider">';
    case 'checkbox': return fieldWrapper(field, renderCheckboxSingle(field), { skipLabel: true });
    case 'consent': return fieldWrapper(field, renderConsent(field), { skipLabel: true });
    case 'textarea':
    case 'address': return fieldWrapper(field, renderTextarea(field));
    case 'select': return fieldWrapper(field, renderSelect(field));
    case 'country': return fieldWrapper(field, renderSelect(field, { countryFallback: true }));
    case 'radio': return fieldWrapper(field, renderRadioGroup(field));
    case 'multiselect': return fieldWrapper(field, renderCheckboxGroup(field));
    case 'file': return fieldWrapper(field, renderFile(field));
    case 'number': return fieldWrapper(field, renderNumber(field));
    case 'date': return fieldWrapper(field, renderDate(field));
    case 'email': return fieldWrapper(field, renderBasicInput(field, 'email'));
    case 'phone': return fieldWrapper(field, renderBasicInput(field, 'tel'));
    case 'city': return fieldWrapper(field, renderBasicInput(field, 'text'));
    case 'text':
    default: return fieldWrapper(field, renderBasicInput(field, 'text'));
  }
}

/** Renders the hero/header block, switching on form.layout ('minimal'|'cover'|'hero'). */
export function renderHero(form) {
  const layout = form.layout || 'minimal';
  const title = escapeHtml(form.heroTitle || form.title || '');
  const subtitle = form.heroSubtitle || form.description || '';
  const chips = Array.isArray(form.infoChips) && form.infoChips.length
    ? `<div class="sst-info-chips">${form.infoChips.map((c) => `<span class="sst-info-chip">${c.icon ? `<i class="fas fa-${escapeHtml(c.icon)}"></i> ` : ''}${escapeHtml(c.text)}</span>`).join('')}</div>`
    : '';
  const subtitleHtml = subtitle ? `<p>${escapeHtml(subtitle)}</p>` : '';
  const initial = (form.title || '?').trim().charAt(0).toUpperCase();
  const badge = form.logoUrl
    ? `<img class="sst-hero-badge sst-hero-badge-logo" src="${escapeHtml(form.logoUrl)}" alt="Logo">`
    : `<div class="sst-hero-badge sst-hero-badge-fallback">${escapeHtml(initial)}</div>`;

  if (layout === 'image' && form.coverImageUrl) {
    return `
      <header class="sst-public-hero-image-only" style="background-image:url('${escapeHtml(form.coverImageUrl)}')" role="img" aria-label="${title}"></header>
    `;
  }

  if (layout === 'cover' && form.coverImageUrl) {
    return `
      <header class="sst-public-hero-cover" style="background-image:url('${escapeHtml(form.coverImageUrl)}')">
        <div class="sst-public-hero-scrim"></div>
        <div class="sst-public-hero-cover-content">${badge}<h1>${title}</h1>${subtitleHtml}${chips}</div>
      </header>
    `;
  }

  if (layout === 'hero') {
    const media = form.coverImageUrl ? `<div class="sst-public-hero-media"><img src="${escapeHtml(form.coverImageUrl)}" alt=""></div>` : '';
    return `
      <header class="sst-public-hero-large">
        ${media}
        <div class="sst-hero-band"><div class="sst-hero-band-accent"></div>${badge}<h1>${title}</h1>${subtitleHtml}${chips}</div>
      </header>
    `;
  }

  return `
    <header class="sst-public-hero-minimal">
      <div class="sst-hero-band"><div class="sst-hero-band-accent"></div>${badge}<h1>${title}</h1>${subtitleHtml}${chips}</div>
    </header>
  `;
}

/** Renders the `<form>` element: every field in order, price line, submit button. */
export function renderFieldsForm(form) {
  const fields = sortedFields(form);
  const isPaid = form.pricingType === 'fixed' && Number(form.price) > 0;
  const priceLine = isPaid ? `<p class="sst-form-price">Total a payer : <strong>${formatCurrency(form.price)}</strong></p>` : '';
  const buttonLabel = isPaid ? 'Continuer vers le paiement' : "S'inscrire";
  const closedNotice = form.isOpen === false ? '<div class="sst-error">Les inscriptions ne sont pas ouvertes actuellement.</div>' : '';
  const spotsNotice = Number.isFinite(form.spotsLeft) ? `<p class="sst-form-spots">${form.spotsLeft} place(s) restante(s)</p>` : '';

  return `
    ${closedNotice}
    ${spotsNotice}
    <form id="sstPublicForm" class="sst-form" novalidate>
      ${fields.map(renderField).join('')}
      ${priceLine}
      <button type="submit" class="sst-form-submit" id="sstSubmitBtn" ${form.isOpen === false ? 'disabled' : ''}>${escapeHtml(buttonLabel)}</button>
      <div id="sstFormResult" class="sst-form-result"></div>
    </form>
  `;
}

/** Full post-submission confirmation screen — replaces the form entirely, never a toast. */
export function renderConfirmation(form) {
  const title = form.confirmation?.title || 'Inscription confirmee !';
  const message = form.confirmation?.message || 'Merci, nous avons bien recu votre inscription.';
  return `
    <div class="sst-confirmation">
      <div class="sst-confirmation-icon"><i class="fas fa-circle-check"></i></div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

/**
 * Reads the DOM back into an { answers } map, using the exact same #field_${id}
 * (or name="field_${id}" for radio/checkbox groups) convention the renderers above
 * generated — the single source of truth for that id scheme, so the collector can
 * never drift from the markup like the original hardcoded-extra-input bug did.
 */
export function collectAnswers(fields, containerEl) {
  const answers = {};
  for (const field of fields) {
    if (STRUCTURAL_TYPES.has(field.type)) continue;
    const id = field.id;

    if (field.type === 'radio') {
      const checked = containerEl.querySelector(`input[name="field_${id}"]:checked`);
      let value = checked ? checked.value : '';
      if (value === '__other__') value = containerEl.querySelector(`#field_${id}__other`)?.value.trim() || '';
      answers[id] = value;
    } else if (field.type === 'multiselect') {
      answers[id] = Array.from(containerEl.querySelectorAll(`input[name="field_${id}"]:checked`)).map((el) => el.value);
    } else if (field.type === 'checkbox' || field.type === 'consent') {
      answers[id] = containerEl.querySelector(`#field_${id}`)?.checked || false;
    } else if (field.type === 'file') {
      answers[id] = containerEl.querySelector(`#field_${id}`)?.dataset.uploadedUrl || '';
    } else if (field.type === 'select' || field.type === 'country') {
      const el = containerEl.querySelector(`#field_${id}`);
      let value = el ? el.value : '';
      if (value === '__other__') value = containerEl.querySelector(`#field_${id}__other`)?.value.trim() || '';
      answers[id] = value;
    } else {
      answers[id] = containerEl.querySelector(`#field_${id}`)?.value || '';
    }
  }
  return answers;
}

function computeContrastTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#0F1111' : '#FFFFFF';
}

/** Applies the form's branding colors as CSS custom properties on a container, scoped
 * so they never leak into or override the dashboard's own --primary/--secondary tokens. */
export function applyFormTheme(rootEl, form) {
  const colors = form.colors || {};
  const primary = HEX_COLOR_PATTERN.test(colors.primary) ? colors.primary : '#18181B';
  const button = HEX_COLOR_PATTERN.test(colors.buttonColor)
    ? colors.buttonColor
    : (HEX_COLOR_PATTERN.test(colors.accent) ? colors.accent : '#4F46E5');
  const background = HEX_COLOR_PATTERN.test(colors.backgroundColor) ? colors.backgroundColor : '#ffffff';
  rootEl.style.setProperty('--form-primary', primary);
  rootEl.style.setProperty('--form-button', button);
  rootEl.style.setProperty('--form-button-text', computeContrastTextColor(button));
  rootEl.style.setProperty('--form-bg', background);
}
