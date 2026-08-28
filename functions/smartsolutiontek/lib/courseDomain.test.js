'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeEmail, sanitizeLessonText, normalizeSlug, normalizePricing,
  normalizeCourseInput, normalizePageSections, buildPublishChecklist, calculateProgress,
  calculateAccessExpiration, hasActiveEnrollmentAccess, hasPermission
} = require('./courseDomain');

test('normalizes email without using email as proof of identity', () => {
  assert.equal(normalizeEmail('  Student@Example.COM '), 'student@example.com');
  assert.equal(normalizeEmail('not-an-email'), null);
});

test('sanitizes lesson text by removing executable markup', () => {
  assert.equal(sanitizeLessonText('Bonjour <script>alert(1)</script><b>monde</b>'), 'Bonjour alert(1)monde');
});

test('normalizes an accented title into a stable slug', () => {
  assert.equal(normalizeSlug('  Créer son entreprise ! '), 'creer-son-entreprise');
});

test('supports free and fixed HTG pricing while preserving the legacy price field', () => {
  assert.deepEqual(normalizePricing({ type: 'free' }, 900), { type: 'free', amount: 0, currency: 'HTG' });
  assert.equal(normalizeCourseInput({ title: 'Cours', price: 1250 }).price, 1250);
  assert.throws(() => normalizePricing({ type: 'fixed', amount: 0 }), /Prix invalide/);
});

test('publication checklist explains every incomplete item', () => {
  const checklist = buildPublishChecklist({ title: 'Cours', description: 'Intro', price: 500, slug: 'cours' }, { modules: 0, lessons: 0 }, false);
  assert.equal(checklist.complete, false);
  assert.ok(checklist.items.filter((item) => !item.complete).every((item) => item.reason));
});

test('progress ignores duplicate and foreign lesson ids', () => {
  assert.deepEqual(calculateProgress(['a', 'b', 'c'], ['a', 'a', 'foreign']), {
    completedLessonIds: ['a'], completedLessons: 1, totalLessons: 3, completionPercentage: 33
  });
});

test('formal role permissions keep staff out of finance and publication', () => {
  assert.equal(hasPermission('creator_owner', 'team:write'), true);
  assert.equal(hasPermission('creator_manager', 'course:publish'), true);
  assert.equal(hasPermission('creator_staff', 'finance:read'), false);
});

test('safe public sections preserve creator order, visibility and fill missing defaults', () => {
  const sections = normalizePageSections([{ id: 'curriculum', visible: false }, { id: 'hero', visible: true }, { id: 'unknown', visible: true }]);
  assert.deepEqual(sections.slice(0, 2), [{ id: 'curriculum', visible: false }, { id: 'hero', visible: true }]);
  assert.equal(sections.some((item) => item.id === 'unknown'), false);
  assert.equal(sections.some((item) => item.id === 'offer'), true);
});

test('course normalization preserves legacy fields while adding access, SEO and safe sections', () => {
  const course = normalizeCourseInput({ title: 'Cours compatible', price: 500, seo: { pageTitle: 'Titre SEO' }, accessPolicy: { type: 'limited', durationDays: 30 } });
  assert.equal(course.price, 500);
  assert.equal(course.accessPolicy.durationDays, 30);
  assert.equal(course.seo.pageTitle, 'Titre SEO');
  assert.ok(course.pageSections.length >= 8);
});

test('limited access expires server-side while lifetime access remains valid', () => {
  const start = Date.UTC(2026, 0, 1);
  const expiry = calculateAccessExpiration({ type: 'limited', durationDays: 30 }, start);
  assert.equal(expiry.toISOString(), '2026-01-31T00:00:00.000Z');
  assert.equal(hasActiveEnrollmentAccess({ status: 'confirmed', accessExpiresAt: expiry }, start + 1000), true);
  assert.equal(hasActiveEnrollmentAccess({ status: 'confirmed', accessExpiresAt: expiry }, expiry.getTime()), false);
  assert.equal(hasActiveEnrollmentAccess({ status: 'confirmed', accessExpiresAt: null }, start), true);
  assert.equal(hasActiveEnrollmentAccess({ status: 'pending_payment' }, start), false);
});

test('course normalization validates enrollment windows, capacity and manual public content', () => {
  const course = normalizeCourseInput({ title: 'Cours ventes', price: 1000, enrollmentPolicy: { opensAt: '2026-01-01T00:00:00Z', closesAt: '2026-02-01T00:00:00Z', capacity: 25 }, faqs: [{ question: 'Puis-je commencer plus tard ?', answer: 'Oui.' }, { question: '', answer: 'Ignorée' }], testimonials: [{ author: 'Jean', quote: 'Une méthode utile.' }, { author: '', quote: 'Ignoré' }] });
  assert.equal(course.enrollmentPolicy.capacity, 25);
  assert.equal(course.enrollmentPolicy.opensAt, '2026-01-01T00:00:00.000Z');
  assert.equal(course.faqs.length, 1);
  assert.deepEqual(course.testimonials, [{ author: 'Jean', quote: 'Une méthode utile.' }]);
  assert.equal(course.pageSections.some((item) => item.id === 'testimonials'), true);
});
