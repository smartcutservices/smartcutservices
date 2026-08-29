// Préférence d'ordre des liens de navigation.
//
// Objectif : dans une rangée de navlinks, le dernier lien ouvert par
// l'utilisateur repasse en tête au chargement suivant. L'ordre est mémorisé
// dans localStorage (par clé fournie), donc conservé d'une page à l'autre et
// d'une session à l'autre. Aucun impact si localStorage est indisponible.
//
// Usage :
//   import { applyNavPreference } from './nav-preference.js';
//   applyNavPreference(document.querySelector('.desktop-nav-items'), {
//     key: 'sc:navOrder:main:v1',
//     linkSelector: 'a.desktop-nav-action',
//   });
//
// Plusieurs conteneurs peuvent partager la même clé (ex. rangée desktop +
// rangée mobile) : un clic dans l'un se reflète dans l'autre au prochain rendu.

const MAX_TRACKED = 40;

function readOrder(key) {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(raw) ? raw.filter((value) => typeof value === 'string') : [];
  } catch (_) {
    return [];
  }
}

function writeOrder(key, hrefs) {
  try {
    window.localStorage.setItem(key, JSON.stringify(hrefs.slice(0, MAX_TRACKED)));
  } catch (_) {
    /* localStorage indisponible : la préférence n'est pas mémorisée, sans erreur. */
  }
}

export function rememberNavClick(key, href) {
  if (!key || !href) return;
  writeOrder(key, [href, ...readOrder(key).filter((item) => item !== href)]);
}

export function applyNavPreference(container, { key, linkSelector } = {}) {
  if (!container || !key || !linkSelector) return;

  reorder(container, key, linkSelector);

  // Un seul écouteur délégué : mémorise le lien cliqué avant la navigation.
  container.addEventListener('click', (event) => {
    const link = event.target.closest(linkSelector);
    if (link && container.contains(link)) {
      rememberNavClick(key, link.getAttribute('href'));
    }
  });
}

function reorder(container, key, linkSelector) {
  const links = Array.from(container.querySelectorAll(linkSelector));
  if (links.length < 2) return;

  const order = readOrder(key);
  if (!order.length) return;

  const rankOf = (link) => {
    const index = order.indexOf(link.getAttribute('href'));
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };

  const sorted = links
    .map((link, position) => ({ link, position, rank: rankOf(link) }))
    .sort((a, b) => (a.rank - b.rank) || (a.position - b.position))
    .map((entry) => entry.link);

  if (!sorted.some((link, position) => link !== links[position])) return;

  // Réinsère les liens triés à l'emplacement exact du premier lien, sans
  // déplacer les éventuels éléments frères (bouton « Catégories », etc.).
  const marker = document.createComment('nav-preference');
  links[0].parentNode.insertBefore(marker, links[0]);
  const fragment = document.createDocumentFragment();
  sorted.forEach((link) => fragment.appendChild(link));
  marker.parentNode.insertBefore(fragment, marker);
  marker.remove();
}
