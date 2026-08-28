'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { timeToMinutes } = require('./services');

test('timeToMinutes: parses HH:MM into minutes since midnight', () => {
  assert.equal(timeToMinutes('00:00'), 0);
  assert.equal(timeToMinutes('09:30'), 570);
  assert.equal(timeToMinutes('23:59'), 1439);
});

test('timeToMinutes: returns null for malformed input', () => {
  assert.equal(timeToMinutes(''), null);
  assert.equal(timeToMinutes(undefined), null);
  assert.equal(timeToMinutes('not-a-time'), null);
});

test('timeToMinutes: a valid slot-generation range produces the expected count of slots', () => {
  // Mirrors the loop in getAvailableSlots: 09:00-12:00 with 30-minute slots -> 6 slots.
  const startMinutes = timeToMinutes('09:00');
  const endMinutes = timeToMinutes('12:00');
  const slotDurationMinutes = 30;
  let count = 0;
  for (let m = startMinutes; m + slotDurationMinutes <= endMinutes; m += slotDurationMinutes) count += 1;
  assert.equal(count, 6);
});
