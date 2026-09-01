import { getProductStoreMeta } from './product-display-utils.js';

const SITE_BASE_URL = 'https://smartcutservices.com';
// Le site public est sur GitHub Pages (statique, aucun rendu serveur). L'aperçu de
// partage (titre + image produit pour WhatsApp / Facebook) est rendu par la Cloud
// Function `productSharePage` (Gen 2 / Cloud Run), qui redirige ensuite la personne
// vers product.html. Ce sous-domaine est mappé sur le service Cloud Run de la fonction
// (mapping de domaine Cloud Run). Repli : si le mapping n'est pas encore actif,
// remplacer par
//   https://us-central1-smartcutservices-9ce54.cloudfunctions.net/productSharePage
const SHARE_BASE_URL = 'https://share.smartcutservices.com';

export function buildProductPageUrl(productId) {
  const params = new URLSearchParams();
  if (productId) params.set('product', productId);
  return `./product.html${params.toString() ? `?${params.toString()}` : ''}`;
}

// Lien de partage « propre » : https://smartcutservices.com/p/<id>
// Firebase Hosting réécrit /p/** vers la Cloud Function productSharePage, qui rend
// l'aperçu Open Graph (titre + image du produit) pour WhatsApp / Facebook puis
// redirige la personne vers product.html.
// `variantKey` (optionnel) : SKU ou index de la variante à mettre en avant dans
// l'aperçu de partage (son image + son prix). La fonction productSharePage le
// résout par SKU puis par index.
export function buildProductShareUrl(productId, sourceCollection = '', variantKey = '') {
  const id = String(productId || '').trim();
  const base = SHARE_BASE_URL.replace(/\/+$/, '');
  // Sous-domaine dédié -> chemin lisible /p/<id>.
  // Repli fonction brute (.../productSharePage) -> forme ?product=<id>.
  const url = /\/productSharePage$/.test(base)
    ? new URL(`${base}?product=${encodeURIComponent(id)}`)
    : new URL(`${base}/p/${encodeURIComponent(id)}`);
  if (sourceCollection) url.searchParams.set('source', sourceCollection);
  const variant = String(variantKey ?? '').trim();
  if (variant) url.searchParams.set('variant', variant);
  return url.toString();
}

export function redirectToProductPage(productId) {
  if (!productId) return;
  window.location.href = buildProductPageUrl(productId);
}

export function buildProductStoreUrl(product) {
  return getProductStoreMeta(product).url;
}

export function redirectToProductStore(product) {
  const { url } = getProductStoreMeta(product);
  if (!url) return;
  window.location.href = url;
}
