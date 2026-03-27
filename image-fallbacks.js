const DEFAULT_PRODUCT_IMAGES = [
  'produit1img1.png',
  'produit1image2.png',
  'produit1image3.png',
  'produit1image4.png'
];

const PRODUCT_FALLBACK_RULES = [
  { keywords: ['montre', 'watch', 'horloge'], images: ['montre1.png', 'montre2.png', 'montre4.png', 'suise1.png'] },
  { keywords: ['sac', 'bag', 'purse', 'handbag'], images: ['sac1.png', 'sac2.png', 'sac3.png', 'sac4.png'] },
  { keywords: ['colier', 'collier', 'necklace', 'bijou', 'jewel', 'lune'], images: ['colier.jpg', 'colierargent.jpg', 'colieror.webp', 'colierlune.jpg'] },
  { keywords: ['chaussure', 'shoe', 'mocassin', 'talon', 'sandale'], images: ['mocassin.jpg', 'mocassin2.png', 'talon1.png', 'chossure.webp'] },
  { keywords: ['bracelet', 'ring', 'bague', 'accessoire'], images: ['or.jpeg', 'bijoux.jpg', 'produit1.png'] }
];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function resolveImagePath(filename, basePath = './') {
  if (!filename) return '';
  const value = String(filename).trim();
  if (!value) return '';
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  return `${basePath}${value.split('/').pop()}`;
}

function getKeywordPool(product = {}) {
  return normalizeText([
    product?.name,
    product?.categoryName,
    product?.category,
    product?.type,
    product?.shortDescription,
    product?.description,
    ...(Array.isArray(product?.colors) ? product.colors.map((color) => color?.name || color) : [])
  ].join(' '));
}

export function getFallbackProductImages(product = {}, basePath = './') {
  const pool = getKeywordPool(product);
  const matchedRule = PRODUCT_FALLBACK_RULES.find((rule) =>
    rule.keywords.some((keyword) => pool.includes(normalizeText(keyword)))
  );
  const images = matchedRule?.images?.length ? matchedRule.images : DEFAULT_PRODUCT_IMAGES;
  return images.map((image) => resolveImagePath(image, basePath));
}

function collectImageCandidates(product = {}) {
  const directImages = Array.isArray(product?.images) ? product.images : [];
  const variationImages = Array.isArray(product?.variations)
    ? product.variations.flatMap((variation) => Array.isArray(variation?.images) ? variation.images : [])
    : [];

  return [
    ...directImages,
    ...variationImages,
    product?.image,
    product?.imageUrl,
    product?.thumbnail
  ].filter((value) => typeof value === 'string' && value.trim() !== '');
}

export function getResolvedProductImages(product = {}, basePath = './') {
  const seen = new Set();
  const resolved = collectImageCandidates(product)
    .map((image) => resolveImagePath(image, basePath))
    .filter((image) => {
      if (!image || seen.has(image)) return false;
      seen.add(image);
      return true;
    });

  return resolved;
}

export function getFallbackProductImage(product = {}, basePath = './', index = 0) {
  const images = getFallbackProductImages(product, basePath);
  return images[index] || images[0] || '';
}
