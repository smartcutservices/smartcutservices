'use strict';

/**
 * Slug validation for public pages. Pure logic, no Firestore — the uniqueness check
 * against other organizations' slugs happens server-side in ../pages.js, inside a
 * transaction (see SECURITY_MODEL.md §4).
 */

const RESERVED_SLUGS = new Set([
  'admin', 'api', 'app', 'www', 'smartcut', 'smartsolutiontek', 'dashboard', 'login',
  'signup', 'checkout', 'payment', 'moncash', 'jwetpro', 'support', 'help', 'about',
  'legal', 'terms', 'privacy', 'assets', 'static', 'root', 'system', 'null', 'undefined'
]);

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 48;

function isSlugFormatValid(slug) {
  if (typeof slug !== 'string') return false;
  const trimmed = slug.trim();
  if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) return false;
  return SLUG_PATTERN.test(trimmed);
}

function isReservedSlug(slug) {
  if (typeof slug !== 'string') return true;
  return RESERVED_SLUGS.has(slug.trim().toLowerCase());
}

/** Combines format + reserved-word checks. Uniqueness-against-Firestore is a separate step. */
function isSlugAllowed(slug) {
  return isSlugFormatValid(slug) && !isReservedSlug(slug);
}

module.exports = { RESERVED_SLUGS, isSlugFormatValid, isReservedSlug, isSlugAllowed };
