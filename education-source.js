// ============= SMART CUT EDUCATION - SELECTION DE SOURCE =============
// Point d'entree unique utilise par les pages : choisit entre les donnees
// locales de demonstration (education-demo-source.js, ?demo=1) et Firestore
// (education-repository.js) selon isDemoMode(). Les deux modules exposent
// exactement la meme API async — les pages n'ont jamais besoin de savoir
// laquelle est active, hormis pour afficher le bandeau de mode demonstration.

import { isDemoMode } from './education-utils.js';
import * as demoSource from './education-demo-source.js?v=20260901-1';
import * as repository from './education-repository.js?v=20260901-1';

export { EducationRepositoryError } from './education-repository.js?v=20260901-1';

export function getEducationSource() {
  return isDemoMode() ? demoSource : repository;
}
