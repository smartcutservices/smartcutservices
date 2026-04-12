import { getProductStoreMeta } from './product-display-utils.js';

export function buildProductPageUrl(productId) {
  const params = new URLSearchParams();
  if (productId) params.set('product', productId);
  return `./product.html${params.toString() ? `?${params.toString()}` : ''}`;
}

export function buildProductShareUrl(productId, sourceCollection = '') {
  const url = new URL('https://us-central1-smartcutservices-9ce54.cloudfunctions.net/productSharePage');
  if (productId) url.searchParams.set('product', productId);
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
