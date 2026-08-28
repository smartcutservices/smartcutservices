'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSlug,
  isSlugFormatValid,
  toIsoStringOrNull,
  formatDurationLabel,
  formatPriceLabel,
  formatRegistrationLabel,
  formatCapacityLabel,
  isPublished,
  isArchived,
  normalizeCategory,
  normalizeProgram,
  normalizeSchool,
  resolveBySlugThenId
} = require('./normalize');

// ---------- normalizeSlug ----------

test('normalizeSlug strips accents and lowercases', () => {
  assert.equal(normalizeSlug('Institut NumériTech'), 'institut-numeritech');
});

test('normalizeSlug collapses punctuation and spaces into single hyphens', () => {
  assert.equal(normalizeSlug('  École  Langues + Plus!! '), 'ecole-langues-plus');
});

test('normalizeSlug trims leading/trailing hyphens', () => {
  assert.equal(normalizeSlug('--Cap-Haïtien--'), 'cap-haitien');
});

test('normalizeSlug on empty/nullish input returns empty string', () => {
  assert.equal(normalizeSlug(''), '');
  assert.equal(normalizeSlug(null), '');
  assert.equal(normalizeSlug(undefined), '');
});

test('isSlugFormatValid accepts a clean slug and rejects malformed ones', () => {
  assert.equal(isSlugFormatValid('institut-numeritech'), true);
  assert.equal(isSlugFormatValid('Has-Upper'), false);
  assert.equal(isSlugFormatValid('has space'), false);
  assert.equal(isSlugFormatValid('ab'), false);
  assert.equal(isSlugFormatValid(''), false);
});

// ---------- toIsoStringOrNull ----------

test('toIsoStringOrNull returns null for null/undefined', () => {
  assert.equal(toIsoStringOrNull(null), null);
  assert.equal(toIsoStringOrNull(undefined), null);
});

test('toIsoStringOrNull converts a Firestore-Timestamp-like object via toDate()', () => {
  const fakeTimestamp = { toDate: () => new Date('2026-01-15T10:00:00.000Z') };
  assert.equal(toIsoStringOrNull(fakeTimestamp), '2026-01-15T10:00:00.000Z');
});

test('toIsoStringOrNull converts a Date instance', () => {
  assert.equal(toIsoStringOrNull(new Date('2026-01-15T10:00:00.000Z')), '2026-01-15T10:00:00.000Z');
});

test('toIsoStringOrNull converts a valid ISO string and rejects an invalid one', () => {
  assert.equal(toIsoStringOrNull('2026-01-15T10:00:00.000Z'), '2026-01-15T10:00:00.000Z');
  assert.equal(toIsoStringOrNull('not-a-date'), null);
});

// ---------- format*Label ----------

test('formatDurationLabel prefers an explicit displayLabel', () => {
  assert.equal(formatDurationLabel({ value: 8, unit: 'weeks', displayLabel: '8 semaines (soir)' }), '8 semaines (soir)');
});

test('formatDurationLabel derives a pluralized French label from value+unit', () => {
  assert.equal(formatDurationLabel({ value: 1, unit: 'weeks' }), '1 semaine');
  assert.equal(formatDurationLabel({ value: 8, unit: 'weeks' }), '8 semaines');
  assert.equal(formatDurationLabel({ value: 3, unit: 'months' }), '3 mois');
});

test('formatDurationLabel with no value returns an honest placeholder, never invents a number', () => {
  assert.equal(formatDurationLabel({ value: null, unit: 'weeks' }), 'Durée à confirmer');
  assert.equal(formatDurationLabel({}), 'Durée à confirmer');
});

test('formatPriceLabel handles on-request, known amount and unknown amount', () => {
  assert.equal(formatPriceLabel({ isOnRequest: true }), 'Prix sur demande');
  assert.equal(formatPriceLabel({ amount: 3500, currency: 'HTG' }), '3 500 HTG');
  assert.equal(formatPriceLabel({ amount: null }), 'Prix à confirmer');
});

test('formatRegistrationLabel maps known statuses and falls back honestly', () => {
  assert.equal(formatRegistrationLabel({ status: 'open' }), 'Inscriptions ouvertes');
  assert.equal(formatRegistrationLabel({ status: 'on_request' }), 'Sur demande');
  assert.equal(formatRegistrationLabel({ status: null }), 'À confirmer');
});

test('formatCapacityLabel never invents a number when total/available are null', () => {
  assert.equal(formatCapacityLabel({ total: null, available: null }), 'Places à confirmer');
  assert.equal(formatCapacityLabel({ total: 20, available: null }), '20 places au total');
  assert.equal(formatCapacityLabel({ total: 20, available: 1 }), '1 place disponible');
  assert.equal(formatCapacityLabel({ displayLabel: 'Places bientôt disponibles' }), 'Places bientôt disponibles');
});

// ---------- publication status ----------

test('isPublished / isArchived read publicationStatus literally', () => {
  assert.equal(isPublished({ publicationStatus: 'published' }), true);
  assert.equal(isPublished({ publicationStatus: 'draft' }), false);
  assert.equal(isArchived({ publicationStatus: 'archived' }), true);
  assert.equal(isArchived({ publicationStatus: 'published' }), false);
});

// ---------- normalize* ----------

test('normalizeCategory fills defaults for missing fields', () => {
  const category = normalizeCategory({ name: 'Langues' }, 'cat-1');
  assert.equal(category.id, 'cat-1');
  assert.equal(category.slug, 'langues');
  assert.equal(category.isActive, true);
  assert.equal(category.order, 0);
});

test('normalizeProgram derives display labels and preserves null numeric fields as null', () => {
  const program = normalizeProgram({
    title: 'Anglais professionnel',
    categoryId: 'langues',
    schoolId: 'demo-school-3',
    modality: 'hybride', // invalid value on purpose
    duration: { value: 10, unit: 'weeks' },
    price: { amount: 2800, currency: 'HTG' },
    registration: { status: 'open' },
    capacity: {},
    learningOutcomes: ['Présenter une offre'],
    targetAudience: ['Entrepreneurs'],
    instructor: { name: 'Marie', bio: 'Formatrice.' },
    publicCurriculum: [{ title: 'Bases', lessons: [{ title: 'Introduction', estimatedDurationMinutes: 12, isFreePreview: true }] }],
    seo: { title: 'Cours anglais', description: 'Apprendre vite.' }
  }, 'prog-1');

  assert.equal(program.slug, 'anglais-professionnel');
  assert.equal(program.modality, null, 'invalid enum values must not be trusted through');
  assert.equal(program.duration.displayLabel, '10 semaines');
  assert.equal(program.price.displayLabel, '2 800 HTG');
  assert.equal(program.registration.displayLabel, 'Inscriptions ouvertes');
  assert.equal(program.capacity.total, null);
  assert.equal(program.capacity.available, null);
  assert.equal(program.capacity.displayLabel, 'Places à confirmer');
  assert.equal(program.publicationStatus, 'draft', 'missing publicationStatus must never default to published');
  assert.deepEqual(program.learningOutcomes, ['Présenter une offre']);
  assert.deepEqual(program.targetAudience, ['Entrepreneurs']);
  assert.equal(program.instructor.name, 'Marie');
  assert.equal(program.seo.title, 'Cours anglais');
  assert.equal(program.publicCurriculum[0].lessons[0].isFreePreview, true);
});

test('normalizeSchool defaults verification to unverified and never trusts an unknown status', () => {
  const school = normalizeSchool({ name: 'Institut NumériTech', verification: { status: 'verified_by_owner_lol' } }, 'sch-1');
  assert.equal(school.verification.status, 'unverified');
  assert.equal(school.slug, 'institut-numeritech');
});

test('normalizeSchool preserves a genuinely verified status when explicitly set', () => {
  const school = normalizeSchool({ name: 'Institut NumériTech', verification: { status: 'verified', label: 'Vérifié par Smart Cut' } }, 'sch-1');
  assert.equal(school.verification.status, 'verified');
  assert.equal(school.verification.label, 'Vérifié par Smart Cut');
});

// ---------- resolveBySlugThenId ----------

test('resolveBySlugThenId resolves by slug when it matches', async () => {
  const result = await resolveBySlugThenId({
    slug: 'anglais-professionnel',
    id: 'demo-course-3',
    findBySlug: async (slug) => (slug === 'anglais-professionnel' ? { id: 'demo-course-3', via: 'slug' } : null),
    findById: async () => { throw new Error('should not be called when slug resolves'); }
  });
  assert.deepEqual(result, { id: 'demo-course-3', via: 'slug' });
});

test('resolveBySlugThenId falls back to id when slug does not resolve', async () => {
  const result = await resolveBySlugThenId({
    slug: 'typo-slug',
    id: 'demo-course-3',
    findBySlug: async () => null,
    findById: async (id) => (id === 'demo-course-3' ? { id: 'demo-course-3', via: 'id' } : null)
  });
  assert.deepEqual(result, { id: 'demo-course-3', via: 'id' });
});

test('resolveBySlugThenId uses id directly when no slug is given (legacy links)', async () => {
  const result = await resolveBySlugThenId({
    slug: '',
    id: 'demo-course-1',
    findBySlug: async () => { throw new Error('should not be called without a slug'); },
    findById: async (id) => (id === 'demo-course-1' ? { id: 'demo-course-1' } : null)
  });
  assert.deepEqual(result, { id: 'demo-course-1' });
});

test('resolveBySlugThenId returns null when neither slug nor id resolve', async () => {
  const result = await resolveBySlugThenId({
    slug: 'does-not-exist',
    id: 'does-not-exist-either',
    findBySlug: async () => null,
    findById: async () => null
  });
  assert.equal(result, null);
});

test('resolveBySlugThenId returns null when neither slug nor id are provided', async () => {
  const result = await resolveBySlugThenId({ slug: '', id: '', findBySlug: async () => null, findById: async () => null });
  assert.equal(result, null);
});
