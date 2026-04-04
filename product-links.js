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
