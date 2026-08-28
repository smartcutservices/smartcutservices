'use strict';

/**
 * Branding/appearance sanitization for a form's public page (Application 1 —
 * inscriptions). Pure logic, no Firestore. Extends the original inline
 * sanitizeColors() that used to live directly in ../forms.js with the wider
 * branding shape the form builder needs (cover image, hero copy, info chips,
 * layout preset, confirmation copy) — deliberately kept to a handful of knobs
 * rather than a full design system, per the product spec ("ne pas donner 50
 * parametres au createur").
 */

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MAX_INFO_CHIPS = 6;
const MAX_CHIP_TEXT_LENGTH = 60;
const MAX_HERO_TITLE_LENGTH = 140;
const MAX_HERO_SUBTITLE_LENGTH = 300;
const MAX_CONFIRMATION_TITLE_LENGTH = 140;
const MAX_CONFIRMATION_MESSAGE_LENGTH = 500;
const LAYOUTS = ['minimal', 'cover', 'hero', 'image'];
const DEFAULT_PRIMARY = '#131921';
const DEFAULT_ACCENT = '#FFA41C';

function sanitizeOptionalString(value, maxLen) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str ? str.slice(0, maxLen) : null;
}

function sanitizeHexColor(value, fallback) {
  const str = typeof value === 'string' ? value.trim() : '';
  return HEX_COLOR_PATTERN.test(str) ? str : fallback;
}

function sanitizeColors(rawColors) {
  return {
    primary: sanitizeHexColor(rawColors?.primary, DEFAULT_PRIMARY),
    accent: sanitizeHexColor(rawColors?.accent, DEFAULT_ACCENT),
    buttonColor: sanitizeHexColor(rawColors?.buttonColor, null),
    backgroundColor: sanitizeHexColor(rawColors?.backgroundColor, null)
  };
}

function sanitizeInfoChips(rawChips) {
  const list = Array.isArray(rawChips) ? rawChips : [];
  return list
    .slice(0, MAX_INFO_CHIPS)
    .map((chip) => ({
      icon: sanitizeOptionalString(chip?.icon, 40),
      text: sanitizeOptionalString(chip?.text, MAX_CHIP_TEXT_LENGTH) || ''
    }))
    .filter((chip) => chip.text);
}

function sanitizeLayout(value) {
  return LAYOUTS.includes(value) ? value : 'minimal';
}

function sanitizeBranding(rawBody) {
  return {
    logoUrl: sanitizeOptionalString(rawBody?.logoUrl, 500),
    coverImageUrl: sanitizeOptionalString(rawBody?.coverImageUrl, 500),
    heroTitle: sanitizeOptionalString(rawBody?.heroTitle, MAX_HERO_TITLE_LENGTH),
    heroSubtitle: sanitizeOptionalString(rawBody?.heroSubtitle, MAX_HERO_SUBTITLE_LENGTH),
    infoChips: sanitizeInfoChips(rawBody?.infoChips),
    colors: sanitizeColors(rawBody?.colors),
    layout: sanitizeLayout(rawBody?.layout),
    confirmation: {
      title: sanitizeOptionalString(rawBody?.confirmation?.title, MAX_CONFIRMATION_TITLE_LENGTH),
      message: sanitizeOptionalString(rawBody?.confirmation?.message, MAX_CONFIRMATION_MESSAGE_LENGTH)
    }
  };
}

module.exports = { sanitizeBranding, sanitizeColors, LAYOUTS };
