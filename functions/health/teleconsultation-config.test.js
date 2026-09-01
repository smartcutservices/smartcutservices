'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveConsultationSelection, RENDEZVOUS_DURATION_MINUTES, resolveRendezvousSpecialty, publicRendezvousCatalog
} = require('./teleconsultation-config');

// ---------- TELECONSULTATION (unchanged — Essentielle/Avancée per specialty) ----------

test('resolveConsultationSelection still resolves a known specialty/plan pair', () => {
  const result = resolveConsultationSelection('cardiology', 'essential');
  assert.equal(result.price, 3000);
  assert.equal(result.plan.durationMinutes, 10);
});

// ---------- RENDEZ-VOUS (flat price per specialty, always 10 minutes) ----------

test('rendez-vous duration is always 10 minutes', () => {
  assert.equal(RENDEZVOUS_DURATION_MINUTES, 10);
});

test('rendez-vous prices match the flat rate list, distinct from teleconsultation pricing', () => {
  assert.equal(resolveRendezvousSpecialty('general-medicine').price, 1500);
  assert.equal(resolveRendezvousSpecialty('cardiology').price, 3000);
  assert.equal(resolveRendezvousSpecialty('dermatology').price, 2000);
  assert.equal(resolveRendezvousSpecialty('neurosurgery').price, 3500);
});

test('an unknown or unpriced specialty (e.g. ophtalmologie) resolves to null, never a fabricated price', () => {
  assert.equal(resolveRendezvousSpecialty('ophthalmology'), null);
  assert.equal(resolveRendezvousSpecialty('does-not-exist'), null);
});

test('publicRendezvousCatalog exposes every specialty with its own price, no plan tiers', () => {
  const catalog = publicRendezvousCatalog();
  assert.equal(catalog.durationMinutes, 10);
  assert.equal(catalog.currency, 'HTG');
  const cardio = catalog.specialties.find((s) => s.code === 'cardiology');
  assert.equal(cardio.price, 3000);
  assert.equal('prices' in cardio, false); // flat price, not a {essential, advanced} object
});
