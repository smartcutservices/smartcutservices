// Shared rendering module for the Nourriture app (Application 5) — restaurant-menu theme.
// Pure presentation, no Firestore/network. Mirrors field-renderer.js / shop-renderer.js.

import { escapeHtml, formatCurrency } from './api.js';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function itemImage(item) {
  return item.photoUrl
    ? `<img src="${escapeHtml(item.photoUrl)}" alt="${escapeHtml(item.name)}" loading="lazy">`
    : `<div class="sst-food-noimage"><i class="fas fa-utensils"></i></div>`;
}

export function renderMenuHero(menu) {
  const title = escapeHtml(menu.heroTitle || menu.name || '');
  const subtitle = menu.heroSubtitle || menu.description || '';
  const logo = menu.logoUrl ? `<img class="sst-food-logo" src="${escapeHtml(menu.logoUrl)}" alt="Logo">` : '';
  const closedBadge = menu.isOpen === false ? '<span class="sst-food-closed-badge">Ferme actuellement</span>' : '';
  const layout = menu.layout || 'minimal';

  if (layout === 'cover' && menu.coverImageUrl) {
    return `
      <header class="sst-food-hero sst-food-hero-cover" style="background-image:url('${escapeHtml(menu.coverImageUrl)}')">
        <div class="sst-food-hero-scrim"></div>
        <div class="sst-food-hero-content">${logo}<h1>${title}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}${closedBadge}</div>
      </header>
    `;
  }
  if (layout === 'hero' && menu.coverImageUrl) {
    return `
      <header class="sst-food-hero sst-food-hero-banner">
        <div class="sst-food-hero-content">${logo}<span class="sst-public-eyebrow">Cuisine & artisanat</span><h1>${title}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}${closedBadge}<a href="#foodGrid">Découvrir la carte</a></div>
        <div class="sst-food-hero-media"><img src="${escapeHtml(menu.coverImageUrl)}" alt="Aperçu de la carte"></div>
      </header>
    `;
  }
  return `<header class="sst-food-hero sst-food-hero-minimal"><div class="sst-food-hero-content">${logo}<span class="sst-public-eyebrow">Cuisine & artisanat</span><h1>${title}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}${closedBadge}<a href="#foodGrid">Découvrir la carte</a></div></header>`;
}

export function renderMenuTabs(items, activeCategory) {
  const categories = [...new Set(items.map((i) => i.category).filter(Boolean))];
  if (!categories.length) return '';
  return `
    <div class="sst-food-tabs">
      <button class="sst-food-tab ${!activeCategory ? 'active' : ''}" data-food-cat="">Tout</button>
      ${categories.map((c) => `<button class="sst-food-tab ${activeCategory === c ? 'active' : ''}" data-food-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
    </div>
  `;
}

export function renderMenuItemCard(item) {
  return `
    <div class="sst-food-item-card" data-item-id="${item.id}">
      <div class="sst-food-item-image">${itemImage(item)}</div>
      <div class="sst-food-item-body">
        <div class="sst-food-item-name">${escapeHtml(item.name)}</div>
        ${item.description ? `<div class="sst-food-item-desc">${escapeHtml(item.description)}</div>` : ''}
        <div class="sst-food-item-footer">
          <span class="sst-food-item-price">${formatCurrency(item.price)}</span>
          <button class="sst-food-btn-add" data-open-item="${item.id}">Ajouter</button>
        </div>
      </div>
    </div>
  `;
}

export function renderMenuGrid(items, activeCategory) {
  const filtered = activeCategory ? items.filter((i) => i.category === activeCategory) : items;
  if (!filtered.length) return '<div class="sst-empty">Aucun plat disponible.</div>';
  return `<div class="sst-food-grid">${filtered.map(renderMenuItemCard).join('')}</div>`;
}

/**
 * Renders the option-selection form for one item before it can be added to the cart.
 * Each option is a single-choice radio group — the backend (createFoodOrder in food.js)
 * only ever reads one selection per option even though the schema has a `multiple` flag,
 * so the UI stays honest about what actually works rather than offering a control that
 * silently wouldn't do anything server-side.
 */
export function renderItemOptionsForm(item) {
  const options = Array.isArray(item.options) ? item.options : [];
  if (!options.length) return '<p class="sst-food-no-options">Aucune option pour ce plat.</p>';
  return options.map((opt) => `
    <div class="sst-food-option-group">
      <div class="sst-food-option-title">${escapeHtml(opt.name)}${opt.required ? ' <span class="sst-form-required">*</span>' : ''}</div>
      ${opt.choices.map((c) => `
        <label class="sst-food-option-choice">
          <input type="radio" name="opt_${opt.id}" value="${escapeHtml(c.label)}">
          <span>${escapeHtml(c.label)}</span>
          ${c.priceDelta ? `<span class="sst-food-option-price">+${formatCurrency(c.priceDelta)}</span>` : ''}
        </label>
      `).join('')}
    </div>
  `).join('');
}

/** Reads the options form back into the { optionId, choiceLabel }[] shape the backend expects. */
export function collectSelectedOptions(item, containerEl) {
  const options = Array.isArray(item.options) ? item.options : [];
  const selections = [];
  for (const opt of options) {
    const checked = containerEl.querySelector(`input[name="opt_${opt.id}"]:checked`);
    if (checked) selections.push({ optionId: opt.id, choiceLabel: checked.value });
  }
  return selections;
}

/** Validates every required option has a selection; returns an array of missing option names. */
export function validateRequiredOptions(item, containerEl) {
  const missing = [];
  for (const opt of item.options || []) {
    if (!opt.required) continue;
    const checked = containerEl.querySelector(`input[name="opt_${opt.id}"]:checked`);
    if (!checked) missing.push(opt.name);
  }
  return missing;
}

export function applyFoodTheme(rootEl, menu) {
  const colors = menu.colors || {};
  const primary = HEX_COLOR_PATTERN.test(colors.primary) ? colors.primary : '#7C2D12';
  const accent = HEX_COLOR_PATTERN.test(colors.buttonColor)
    ? colors.buttonColor
    : (HEX_COLOR_PATTERN.test(colors.accent) ? colors.accent : '#EA580C');
  const background = HEX_COLOR_PATTERN.test(colors.backgroundColor) ? colors.backgroundColor : '#FFFBF5';
  rootEl.style.setProperty('--food-primary', primary);
  rootEl.style.setProperty('--food-accent', accent);
  rootEl.style.setProperty('--food-bg', background);
}
