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
  // Les images produit Firebase ont maintenant un chemin WebP dédié. Les
  // anciens documents peuvent encore contenir une URL terminant par .png/.jpg;
  // on la réécrit côté client pour éviter de continuer à télécharger l'ancien
  // format, sans toucher aux URLs d'autres ressources.
  if (/^https?:/i.test(value)) {
    if (/\/o\/products(?:%2F|\/)/i.test(value)) {
      return value.replace(/\.(jpe?g|png)(?=[?#]|$)/i, '.webp');
    }
    return value;
  }
  if (/^(data:|blob:)/i.test(value)) return value;
  const hasPath = /[\\/]/.test(value);
  const sourcePath = value.replaceAll('\\', '/');
  const basename = sourcePath.split('/').pop();
  const extension = basename.match(/\.(jpe?g|png)$/i);
  // Les assets statiques migrés possèdent désormais un voisin WebP. Les URLs
  // distantes et les formats non concernés restent inchangés.
  const optimizedPath = extension
    ? `${sourcePath.slice(0, -extension[0].length)}.webp`
    : sourcePath;
  // Les références contenant déjà un dossier (par exemple assets/foo.png)
  // doivent conserver ce dossier. Les noms simples utilisent imageBasePath.
  return hasPath ? optimizedPath : `${basePath}${optimizedPath}`;
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
