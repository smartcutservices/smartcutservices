'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSlugFormatValid, isReservedSlug, isSlugAllowed } = require('./slug');

test('accepts a normal lowercase-hyphen slug', () => {
  assert.equal(isSlugFormatValid('mon-super-formulaire'), true);
});

test('rejects uppercase letters', () => {
  assert.equal(isSlugFormatValid('Mon-Formulaire'), false);
});

test('rejects spaces and special characters', () => {
  assert.equal(isSlugFormatValid('mon formulaire!'), false);
});

test('rejects leading or trailing hyphen', () => {
  assert.equal(isSlugFormatValid('-formulaire'), false);
  assert.equal(isSlugFormatValid('formulaire-'), false);
});

test('rejects too short slugs', () => {
  assert.equal(isSlugFormatValid('ab'), false);
});

test('rejects too long slugs', () => {
  assert.equal(isSlugFormatValid('a'.repeat(49)), false);
});

test('flags reserved slugs like admin/checkout/moncash', () => {
  assert.equal(isReservedSlug('admin'), true);
  assert.equal(isReservedSlug('checkout'), true);
  assert.equal(isReservedSlug('moncash'), true);
  assert.equal(isReservedSlug('mon-super-formulaire'), false);
});

test('reserved check is case-insensitive', () => {
  assert.equal(isReservedSlug('ADMIN'), true);
});

test('isSlugAllowed combines both checks', () => {
  assert.equal(isSlugAllowed('mon-super-formulaire'), true);
  assert.equal(isSlugAllowed('admin'), false);
  assert.equal(isSlugAllowed('Not Valid!'), false);
});
