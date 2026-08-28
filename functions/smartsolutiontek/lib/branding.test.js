'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeBranding } = require('./branding');

test('defaults every key when given an empty body', () => {
  const branding = sanitizeBranding({});
  assert.equal(branding.logoUrl, null);
  assert.equal(branding.coverImageUrl, null);
  assert.equal(branding.heroTitle, null);
  assert.deepEqual(branding.infoChips, []);
  assert.deepEqual(branding.colors, { primary: '#131921', accent: '#FFA41C', buttonColor: null, backgroundColor: null });
  assert.equal(branding.layout, 'minimal');
  assert.deepEqual(branding.confirmation, { title: null, message: null });
});

test('accepts valid hex colors and rejects malformed ones', () => {
  const valid = sanitizeBranding({ colors: { primary: '#111111', accent: '#ABCDEF', buttonColor: '#00FF00' } });
  assert.equal(valid.colors.primary, '#111111');
  assert.equal(valid.colors.accent, '#ABCDEF');
  assert.equal(valid.colors.buttonColor, '#00FF00');

  const invalid = sanitizeBranding({ colors: { primary: 'not-a-color', accent: 'red' } });
  assert.equal(invalid.colors.primary, '#131921');
  assert.equal(invalid.colors.accent, '#FFA41C');
});

test('caps infoChips at 6 entries and drops empty text', () => {
  const chips = Array.from({ length: 10 }, (_, i) => ({ text: `Chip ${i}` }));
  const result = sanitizeBranding({ infoChips: chips });
  assert.equal(result.infoChips.length, 6);
  assert.equal(result.infoChips[0].text, 'Chip 0');

  const withEmpty = sanitizeBranding({ infoChips: [{ text: '' }, { text: 'Valid' }] });
  assert.deepEqual(withEmpty.infoChips, [{ icon: null, text: 'Valid' }]);
});

test('whitelists layout to the 3 allowed presets', () => {
  assert.equal(sanitizeBranding({ layout: 'cover' }).layout, 'cover');
  assert.equal(sanitizeBranding({ layout: 'hero' }).layout, 'hero');
  assert.equal(sanitizeBranding({ layout: 'something-else' }).layout, 'minimal');
});

test('truncates overly long hero and confirmation text instead of rejecting', () => {
  const result = sanitizeBranding({
    heroTitle: 'a'.repeat(500),
    confirmation: { message: 'b'.repeat(1000) }
  });
  assert.equal(result.heroTitle.length, 140);
  assert.equal(result.confirmation.message.length, 500);
});
