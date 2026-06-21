import { getProductStoreMeta } from './product-display-utils.js';

const SITE_BASE_URL = 'https://smartcutservices.com';

export function buildProductPageUrl(productId) {
  const params = new URLSearchParams();
  if (productId) params.set('product', productId);
  return `./product.html${params.toString() ? `?${params.toString()}` : ''}`;
}

export function buildProductShareUrl(productId, sourceCollection = '') {
  const url = new URL('/p/', SITE_BASE_URL);
  if (productId) url.searchParams.set('product', String(productId).trim());
  if (sourceCollection) url.searchParams.set('source', sourceCollection);
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
