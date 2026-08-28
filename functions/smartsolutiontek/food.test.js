'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isMenuOpenNow, sanitizeOptions } = require('./food');

// Reference: 2026-08-21 is a Friday (dayOfWeek 5).
function friday(hh, mm) {
  const d = new Date(2026, 7, 21, hh, mm); // month is 0-indexed: 7 = August
  return d;
}

test('isMenuOpenNow: open with no hours configured (always open)', () => {
  assert.equal(isMenuOpenNow([], friday(3, 0)), true);
  assert.equal(isMenuOpenNow(undefined, friday(3, 0)), true);
});

test('isMenuOpenNow: within a configured window on the right day', () => {
  const hours = [{ dayOfWeek: 5, startTime: '09:00', endTime: '18:00' }];
  assert.equal(isMenuOpenNow(hours, friday(12, 0)), true);
});

test('isMenuOpenNow: outside the configured window', () => {
  const hours = [{ dayOfWeek: 5, startTime: '09:00', endTime: '18:00' }];
  assert.equal(isMenuOpenNow(hours, friday(20, 0)), false);
  assert.equal(isMenuOpenNow(hours, friday(7, 0)), false);
});

test('isMenuOpenNow: wrong day of week is closed even during the time window', () => {
  const hours = [{ dayOfWeek: 6, startTime: '09:00', endTime: '18:00' }]; // Saturday only
  assert.equal(isMenuOpenNow(hours, friday(12, 0)), false);
});

test('isMenuOpenNow: boundaries are inclusive', () => {
  const hours = [{ dayOfWeek: 5, startTime: '09:00', endTime: '18:00' }];
  assert.equal(isMenuOpenNow(hours, friday(9, 0)), true);
  assert.equal(isMenuOpenNow(hours, friday(18, 0)), true);
});

test('isMenuOpenNow: multiple windows, matches any', () => {
  const hours = [
    { dayOfWeek: 5, startTime: '09:00', endTime: '12:00' },
    { dayOfWeek: 5, startTime: '14:00', endTime: '18:00' }
  ];
  assert.equal(isMenuOpenNow(hours, friday(13, 0)), false); // lunch break
  assert.equal(isMenuOpenNow(hours, friday(15, 0)), true);
});

test('sanitizeOptions: drops options without a name', () => {
  const result = sanitizeOptions([{ name: '', choices: [{ label: 'x' }] }, { name: 'Taille', choices: [{ label: 'M' }] }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Taille');
});

test('sanitizeOptions: drops choices without a label and computes numeric priceDelta', () => {
  const result = sanitizeOptions([{ name: 'Supplement', choices: [{ label: 'Fromage', priceDelta: '50' }, { label: '' }] }]);
  assert.equal(result[0].choices.length, 1);
  assert.equal(result[0].choices[0].priceDelta, 50);
});

test('sanitizeOptions: handles non-array input gracefully', () => {
  assert.deepEqual(sanitizeOptions(null), []);
  assert.deepEqual(sanitizeOptions(undefined), []);
});
