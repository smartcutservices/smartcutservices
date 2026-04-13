import { getProductStoreMeta } from './product-display-utils.js';

const SITE_BASE_URL = 'https://smartcutservices.com';

export function buildProductPageUrl(productId) {
  const params = new URLSearchParams();
  if (productId) params.set('product', productId);
  return `./product.html${params.toString() ? `?${params.toString()}` : ''}`;
}

export function buildProductShareUrl(productId, sourceCollection = '') {
  const cleanProductId = String(productId || '').trim();
  const path = cleanProductId ? `/p/${encodeURIComponent(cleanProductId)}` : '/p';
  const url = new URL(path, `${SITE_BASE_URL}/`);
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
