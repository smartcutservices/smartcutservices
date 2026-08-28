'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeProgramInput, normalizeLessonInput, buildPublishChecklist, slug } = require('./publisher-domain');

test('normalise un cours professionnel complet', () => {
  const value = normalizeProgramInput({ title: 'Créer & vendre', price: { amount: 2500 }, modality: 'hybrid', learningOutcomes: ['Vendre une offre'] });
  assert.equal(value.slug, 'creer-vendre');
  assert.equal(value.price.amount, 2500);
  assert.equal(value.modality, 'hybrid');
});

test('assainit le texte des leçons', () => {
  const value = normalizeLessonInput({ title: 'Intro', type: 'text', content: '<script>x</script><b>Bonjour</b>' });
  assert.equal(value.content, 'xBonjour');
});

test('checklist refuse une publication incomplète', () => {
  const checklist = buildPublishChecklist({ title: 'Cours', shortDescription: 'Résumé', price: { amount: 0 } }, { modules: 0, lessons: 0 });
  assert.equal(checklist.complete, false);
  assert.ok(checklist.items.some((item) => item.key === 'lesson' && !item.complete));
});

test('génère un slug stable', () => assert.equal(slug(' Formation Réussie ! '), 'formation-reussie'));
