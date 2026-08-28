// ============= SMART CUT EDUCATION - UTILITAIRES PARTAGES =============
// Echappement HTML, normalisation de recherche, construction d'URL (slug
// prioritaire, id en compatibilite, propagation du mode demonstration) et
// petit controleur de toast honnete ("bientot disponible"), reutilises par
// le catalogue et les fiches formation / etablissement. La normalisation
// des entites (categorie/etablissement/formation) vit dans
// education-normalize.js, importee par les sources de donnees, pas ici.

const MODALITY_LABELS = {
  in_person: 'Présentiel',
  online: 'En ligne',
  hybrid: 'Hybride'
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Normalise pour une recherche insensible aux accents et a la casse.
const COMBINING_DIACRITICS = new RegExp('[̀-ͯ]', 'g');

export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .trim();
}

export function getInitials(name = '') {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('') || 'SC';
}

export function getModalityLabel(modality) {
  return MODALITY_LABELS[modality] || 'Modalité à confirmer';
}

// Commune affichee sur une carte/fiche formation : "En ligne" prime sur la
// commune si la formation est entierement a distance.
export function getProgramLocationLabel(program) {
  if (!program) return 'À confirmer';
  if (program.modality === 'online') return 'En ligne';
  return program.commune || 'Commune à confirmer';
}

// Vrai si la page courante est en mode demonstration explicite (?demo=1).
// Voir education-source.js : seul ce mode charge education-data.js.
export function isDemoMode() {
  try {
    const params = new URLSearchParams(window.location.search);
    const value = params.get('demo');
    return value === '1' || value === 'true';
  } catch (_) {
    return false;
  }
}

// Lien vers le catalogue (accueil Education ou une ancre), en propageant le
// mode demonstration en cours — utilise par les fils d'Ariane et les liens
// "Retour" des fiches formation/etablissement.
export function buildEducationHomeUrl(hash = '') {
  const params = new URLSearchParams();
  if (isDemoMode()) params.set('demo', '1');
  const queryString = params.toString();
  return `./education.html${queryString ? `?${queryString}` : ''}${hash}`;
}

function buildEntityUrl(basePath, entity) {
  const isObject = entity && typeof entity === 'object';
  const slug = isObject ? entity.slug : null;
  const id = isObject ? entity.id : entity;

  const params = new URLSearchParams();
  if (slug) params.set('slug', slug);
  else if (id) params.set('id', id);
  if (isDemoMode()) params.set('demo', '1');

  const queryString = params.toString();
  return `${basePath}${queryString ? `?${queryString}` : ''}`;
}

// Accepte un programme/etablissement normalise ({id, slug, ...}) ou un id brut.
// Priorise toujours le slug ; propage le mode demonstration en cours.
export function buildCoursePageUrl(program) {
  return buildEntityUrl('./education-programme.html', program);
}

export function buildSchoolPageUrl(school) {
  return buildEntityUrl('./education-etablissement.html', school);
}

// Lit un identifiant/slug de query string sans jamais le reinjecter dans le
// DOM : il ne sert qu'a une comparaison "===" ou a une requete Firestore
// parametree, jamais a de la concatenation HTML.
export function readIdFromQuery(paramName = 'id') {
  const params = new URLSearchParams(window.location.search);
  return (params.get(paramName) || '').trim();
}

export function readSlugFromQuery(paramName = 'slug') {
  const params = new URLSearchParams(window.location.search);
  return (params.get(paramName) || '').trim();
}

// Petit toast honnete partage par les CTA non encore developpes
// (tuteurs, demandes d'information sur les fiches formation/etablissement).
export function createToastController(root) {
  const toast = document.createElement('div');
  toast.className = 'edu-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  root.appendChild(toast);

  let timer = null;

  return {
    show(message) {
      toast.textContent = message;
      toast.classList.add('is-visible');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        toast.classList.remove('is-visible');
      }, 2400);
    },
    destroy() {
      window.clearTimeout(timer);
      toast.remove();
    }
  };
}
