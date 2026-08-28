'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeFields, validateAnswerForField, FIELD_TYPES, DEFAULT_COUNTRIES } = require('./fieldTypes');

function field(overrides) {
  return { id: 'f1', type: 'text', label: 'Test', required: false, order: 0, ...overrides };
}

test('FIELD_TYPES includes all 18 registered types', () => {
  assert.equal(FIELD_TYPES.length, 18);
  for (const t of ['text', 'email', 'phone', 'file', 'consent', 'sectionTitle', 'divider', 'country']) {
    assert.ok(FIELD_TYPES.includes(t), `missing type ${t}`);
  }
});

test('sanitizeFields rejects an unknown type', () => {
  assert.throws(() => sanitizeFields([{ type: 'bogus', label: 'X' }]), /invalid-field-type|Type de champ invalide/);
});

test('sanitizeFields requires a label for non-structural types', () => {
  assert.throws(() => sanitizeFields([{ type: 'text', label: '' }]));
});

test('sanitizeFields assigns order from array position, ignoring client-supplied order', () => {
  const fields = sanitizeFields([
    { type: 'text', label: 'B', order: 99 },
    { type: 'text', label: 'A', order: 0 }
  ]);
  assert.equal(fields[0].label, 'B');
  assert.equal(fields[0].order, 0);
  assert.equal(fields[1].order, 1);
});

test('sanitizeFields forces consent fields to always be required', () => {
  const [consent] = sanitizeFields([{ type: 'consent', label: 'CGU', text: "J'accepte", required: false }]);
  assert.equal(consent.required, true);
});

test('sanitizeFields structural types use title/text instead of label', () => {
  const [section] = sanitizeFields([{ type: 'sectionTitle', title: 'Informations', description: 'Section 1' }]);
  assert.equal(section.title, 'Informations');
  assert.equal(section.label, undefined);

  assert.throws(() => sanitizeFields([{ type: 'sectionTitle', title: '' }]));
});

test('structural fields never produce an answer', () => {
  const result = validateAnswerForField(field({ type: 'divider' }), 'anything');
  assert.equal(result, undefined);
});

test('required field throws when empty, returns undefined when optional and empty', () => {
  assert.throws(() => validateAnswerForField(field({ required: true }), ''), /est requis/);
  assert.equal(validateAnswerForField(field({ required: false }), ''), undefined);
});

test('text field enforces maxLength (configured, capped by hard limit)', () => {
  const short = field({ maxLength: 5 });
  assert.throws(() => validateAnswerForField(short, '123456'));
  assert.equal(validateAnswerForField(short, '12345'), '12345');

  const noLimit = field({});
  assert.equal(validateAnswerForField(noLimit, 'a'.repeat(300)).length, 300);
  assert.throws(() => validateAnswerForField(noLimit, 'a'.repeat(301)));
});

test('email field validates format and lowercases', () => {
  const f = field({ type: 'email', required: true });
  assert.throws(() => validateAnswerForField(f, 'not-an-email'), /Email invalide/);
  assert.equal(validateAnswerForField(f, 'User@Example.com'), 'user@example.com');
});

test('phone field requires at least 7 digits and an allowed character set', () => {
  const f = field({ type: 'phone' });
  assert.throws(() => validateAnswerForField(f, '123'), /Telephone invalide/);
  assert.throws(() => validateAnswerForField(f, 'call-me-maybe'), /Telephone invalide/);
  assert.equal(validateAnswerForField(f, '+509 1234 5678'), '+509 1234 5678');
});

test('number field enforces min/max bounds', () => {
  const f = field({ type: 'number', min: 1, max: 10 });
  assert.throws(() => validateAnswerForField(f, 0), /superieur ou egal/);
  assert.throws(() => validateAnswerForField(f, 11), /inferieur ou egal/);
  assert.equal(validateAnswerForField(f, 5), 5);
});

test('date field enforces minDate/maxDate and normalizes to ISO', () => {
  const f = field({ type: 'date', minDate: '2026-01-01', maxDate: '2026-12-31' });
  assert.throws(() => validateAnswerForField(f, '2025-01-01'), /trop ancienne/);
  assert.throws(() => validateAnswerForField(f, 'not-a-date'), /Date invalide/);
  assert.equal(typeof validateAnswerForField(f, '2026-06-15'), 'string');
});

test('select/radio only accept configured options unless allowOther', () => {
  const strict = field({ type: 'select', options: ['A', 'B'] });
  assert.throws(() => validateAnswerForField(strict, 'C'), /Option invalide/);
  assert.equal(validateAnswerForField(strict, 'A'), 'A');

  const loose = field({ type: 'radio', options: ['A', 'B'], allowOther: true });
  assert.equal(validateAnswerForField(loose, 'Something else'), 'Something else');
});

test('multiselect validates every item and caps array length', () => {
  const f = field({ type: 'multiselect', options: ['A', 'B', 'C'] });
  assert.deepEqual(validateAnswerForField(f, ['A', 'C']), ['A', 'C']);
  assert.throws(() => validateAnswerForField(f, ['A', 'X']), /Option invalide/);
  assert.throws(() => validateAnswerForField(f, 'not-an-array'), /doit etre une liste/);
});

test('checkbox/consent must be exactly true when required', () => {
  const f = field({ type: 'checkbox', required: true });
  assert.throws(() => validateAnswerForField(f, false), /est requis/);
  assert.equal(validateAnswerForField(f, true), true);
  assert.equal(validateAnswerForField(field({ type: 'checkbox', required: false }), false), false);
});

test('country field only accepts a DEFAULT_COUNTRIES match, by name or code', () => {
  const f = field({ type: 'country' });
  assert.equal(validateAnswerForField(f, 'Haiti'), 'Haiti');
  assert.equal(validateAnswerForField(f, 'ht'), 'Haiti');
  assert.throws(() => validateAnswerForField(f, 'Narnia'), /Pays invalide/);
  assert.ok(DEFAULT_COUNTRIES.some((c) => c.code === 'HT'));
});

test('file field only accepts a URL scoped to the given formSchemaId storage path', () => {
  const f = field({ type: 'file', required: true });
  const goodUrl = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/sst-form-uploads%2Fform123%2Fabc.pdf?alt=media';
  assert.equal(validateAnswerForField(f, goodUrl, { formSchemaId: 'form123' }), goodUrl);

  const wrongForm = 'https://firebasestorage.googleapis.com/v0/b/bucket/o/sst-form-uploads%2Fother-form%2Fabc.pdf?alt=media';
  assert.throws(() => validateAnswerForField(f, wrongForm, { formSchemaId: 'form123' }), /Fichier invalide/);

  assert.throws(() => validateAnswerForField(f, 'not-a-url', { formSchemaId: 'form123' }), /Fichier invalide/);
});
