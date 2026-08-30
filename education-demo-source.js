// ============= SMART CUT EDUCATION - SOURCE DE DEMONSTRATION =============
// Implemente exactement la même API async que education-repository.js
// (voir ce fichier pour le contrat), mais a partir des donnees locales de
// education-data.js au lieu de Firestore. Utilisee uniquement quand
// isDemoMode() est vrai (?demo=1) — jamais melangee au catalogue normal.
// Passe par les MÊMES fonctions de normalisation que la vraie source, afin
// que les composants de rendu n'aient jamais a savoir d'ou vient la donnee.

import { RAW_CATEGORIES, RAW_SCHOOLS, RAW_PROGRAMS } from './education-data.js';
import { normalizeCategory, normalizeProgram, normalizeSchool, isPublished, isArchived } from './education-normalize.js?v=20260829-16';

const CATEGORIES = RAW_CATEGORIES.map((raw) => normalizeCategory(raw, raw.id)).filter((item) => item.isActive);
const SCHOOLS = RAW_SCHOOLS.map((raw) => normalizeSchool(raw, raw.id)).filter((item) => isPublished(item) && !isArchived(item));
const PROGRAMS = RAW_PROGRAMS.map((raw) => normalizeProgram(raw, raw.id)).filter((item) => isPublished(item) && !isArchived(item));

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : value;
}

export async function listPublishedCategories() {
  return CATEGORIES.map(clone).sort((a, b) => a.order - b.order);
}

export async function listPublishedPrograms(filters = {}) {
  return PROGRAMS
    .filter((program) => !filters.categoryId || program.categoryId === filters.categoryId)
    .filter((program) => !filters.schoolId || program.schoolId === filters.schoolId)
    .filter((program) => !filters.commune || program.commune === filters.commune)
    .filter((program) => !filters.modality || program.modality === filters.modality)
    .map(clone);
}

export async function listPublishedSchools(filters = {}) {
  return SCHOOLS
    .filter((school) => !filters.commune || school.commune === filters.commune)
    .map(clone);
}

export async function getPublishedProgramById(id) {
  const found = PROGRAMS.find((program) => program.id === String(id || ''));
  return found ? clone(found) : null;
}

export async function getPublishedProgramBySlug(slug) {
  const found = PROGRAMS.find((program) => program.slug === String(slug || ''));
  return found ? clone(found) : null;
}

export async function getPublishedSchoolById(id) {
  const found = SCHOOLS.find((school) => school.id === String(id || ''));
  return found ? clone(found) : null;
}

export async function getPublishedSchoolBySlug(slug) {
  const found = SCHOOLS.find((school) => school.slug === String(slug || ''));
  return found ? clone(found) : null;
}

export async function listPublishedProgramsBySchool(schoolId) {
  return PROGRAMS.filter((program) => program.schoolId === schoolId).map(clone);
}

export async function listRelatedPublishedPrograms(program, { limit = 4 } = {}) {
  if (!program?.categoryId) return [];
  return PROGRAMS
    .filter((item) => item.categoryId === program.categoryId && item.id !== program.id)
    .slice(0, limit)
    .map(clone);
}
