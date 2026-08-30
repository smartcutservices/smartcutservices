// seo-meta.js — pose / met à jour les balises SEO et partage social côté client.
//
// À quoi ça sert vraiment :
//  - titre d'onglet, favoris et historique corrects par page ;
//  - canonical ;
//  - JSON-LD (Google exécute le JS et l'indexe -> rich results).
//
// Limite connue : les robots WhatsApp / Facebook lisent le HTML BRUT sans JS.
// Pour l'aperçu de partage des pages produit, utiliser le lien servi par la
// Cloud Function `productSharePage` (voir product-links.js -> buildProductShareUrl),
// qui rend déjà les balises Open Graph côté serveur.

const SITE_NAME = 'Smart Cut Services';
const ORIGIN = `${location.protocol}//${location.host}`;
const DEFAULT_IMAGE = `${ORIGIN}/logo.png`;

function abs(url) {
  if (!url) return '';
  try { return new URL(url, location.href).href; } catch (_) { return ''; }
}

function upsertMeta(attr, key, content) {
  if (content == null || content === '') return;
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', String(content));
}

function upsertLink(rel, href) {
  if (!href) return;
  let el = document.head.querySelector(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', rel);
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

/**
 * @param {object} o
 * @param {string} [o.title]        Titre nu (le nom du site est ajouté).
 * @param {string} [o.description]
 * @param {string} [o.canonical]    URL absolue ; défaut = URL courante sans hash.
 * @param {string} [o.image]        URL (relative acceptée) ; défaut = logo.
 * @param {'website'|'article'|'product'|'profile'} [o.type]
 * @param {object} [o.jsonLd]       Objet JSON-LD (sera injecté tel quel).
 * @param {string} [o.siteName]
 */
export function applySeoMeta(o = {}) {
  const siteName = o.siteName || SITE_NAME;
  const url = o.canonical || location.href.split('#')[0];
  const image = o.image ? abs(o.image) : DEFAULT_IMAGE;
  const description = String(o.description || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const type = o.type || 'website';
  const fullTitle = o.title ? `${o.title} · ${siteName}` : siteName;

  if (o.title) document.title = fullTitle;
  upsertMeta('name', 'description', description);
  upsertLink('canonical', url);

  upsertMeta('property', 'og:site_name', siteName);
  upsertMeta('property', 'og:locale', 'fr_FR');
  upsertMeta('property', 'og:type', type);
  upsertMeta('property', 'og:title', o.title || siteName);
  upsertMeta('property', 'og:description', description);
  upsertMeta('property', 'og:url', url);
  upsertMeta('property', 'og:image', image);

  upsertMeta('name', 'twitter:card', 'summary_large_image');
  upsertMeta('name', 'twitter:title', o.title || siteName);
  upsertMeta('name', 'twitter:description', description);
  upsertMeta('name', 'twitter:image', image);

  if (o.jsonLd) {
    let s = document.getElementById('seo-jsonld');
    if (!s) {
      s = document.createElement('script');
      s.type = 'application/ld+json';
      s.id = 'seo-jsonld';
      document.head.appendChild(s);
    }
    s.textContent = JSON.stringify(o.jsonLd).replace(/</g, '\\u003c');
  }
}
