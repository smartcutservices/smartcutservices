// Catalogue central des produits personnalisables du Studio de personnalisation.
// Un seul endroit a modifier pour ajouter un produit, changer un prix ou brancher
// un vrai modele 3D : le moteur (personalization-editor.js / personalization-3d.js /
// personalization.js) ne connait jamais un produit "en dur", il lit uniquement cette liste.
//
// Tous les prix sont en HTG (meme convention que le reste du site, voir currency-utils.js).
// Ce sont des valeurs de depart CLAIREMENT REMPLACABLES par l'equipe commerciale -
// aucune regle de prix existante n'est modifiee ici, ce sont de nouveaux produits.

// Le t-shirt utilise maintenant un vrai modele GLB. Pour ajouter d'autres produits,
// deposez un fichier glTF binaire (.glb) avec:
//  - une UV map couvrant la zone imprimable de chaque face (recto/verso ou wrap)
//  - un materiau nomme correspondant a `model3d.materialName` (ou laissez vide pour
//    que le moteur applique la texture au premier materiau trouve)
// puis renseignez `model3d.url` avec le chemin du fichier (ex: './assets/models/tshirt.glb').
// Si `model3d.url` reste null, personalization-3d.js utilise uniquement un objet
// procedural de secours pour que le studio reste utilisable.

const TSHIRT_ZONE_FRONT = { x: 0.27, y: 0.18, width: 0.46, height: 0.56, label: 'Grand recto' };
const TSHIRT_ZONE_BACK = { x: 0.27, y: 0.17, width: 0.46, height: 0.58, label: 'Grand dos' };
const MUG_ZONE_WRAP = { x: 0.08, y: 0.20, width: 0.84, height: 0.58, label: 'Impression enveloppante' };

const withProductionMetadata = (area) => ({
  safeArea: { ...area.bounds },
  bleedInches: 0.125,
  recommendedDpi: 150,
  texture: { channel: area.face, mode: area.face === 'wrap' ? 'cylindrical' : 'decal' },
  cameraPreset: area.face,
  ...area
});

const TSHIRT_PRINT_AREAS = [
  { id: 'front-center', face: 'front', label: 'Centre poitrine', shortLabel: 'Centre', bounds: { x: .34, y: .27, width: .32, height: .36 }, physicalWidthInches: 11, physicalHeightInches: 13, priceDelta: 0 },
  { id: 'front-left-chest', face: 'front', label: 'Cœur gauche', shortLabel: 'Cœur', bounds: { x: .36, y: .25, width: .15, height: .17 }, physicalWidthInches: 4, physicalHeightInches: 4.5, priceDelta: 0 },
  { id: 'front-right-chest', face: 'front', label: 'Poitrine droite', shortLabel: 'Droite', bounds: { x: .49, y: .25, width: .15, height: .17 }, physicalWidthInches: 4, physicalHeightInches: 4.5, priceDelta: 0 },
  { id: 'front-large', face: 'front', label: 'Grand recto', shortLabel: 'Grand recto', bounds: TSHIRT_ZONE_FRONT, physicalWidthInches: 13, physicalHeightInches: 16, priceDelta: 250 },
  { id: 'back-upper', face: 'back', label: 'Haut du dos', shortLabel: 'Haut du dos', bounds: { x: .35, y: .22, width: .30, height: .20 }, physicalWidthInches: 10, physicalHeightInches: 6, priceDelta: 250 },
  { id: 'back-large', face: 'back', label: 'Grand dos', shortLabel: 'Grand dos', bounds: TSHIRT_ZONE_BACK, physicalWidthInches: 13, physicalHeightInches: 16, priceDelta: 450 }
].map(withProductionMetadata);

const MUG_PRINT_AREAS = [
  { id: 'mug-front', face: 'wrap', label: 'Face principale', shortLabel: 'Face', bounds: { x: .12, y: .24, width: .32, height: .50 }, physicalWidthInches: 3.4, physicalHeightInches: 3.2, priceDelta: 0 },
  { id: 'mug-back', face: 'wrap', label: 'Face opposée', shortLabel: 'Dos', bounds: { x: .56, y: .24, width: .32, height: .50 }, physicalWidthInches: 3.4, physicalHeightInches: 3.2, priceDelta: 0 },
  { id: 'mug-wrap', face: 'wrap', label: 'Tout autour', shortLabel: 'Enveloppante', bounds: MUG_ZONE_WRAP, physicalWidthInches: 8.5, physicalHeightInches: 3.2, priceDelta: 250 }
].map(withProductionMetadata);

export const PERSONALIZATION_PRODUCTS = [
  {
    id: 'tshirt-classic',
    name: 'T-shirt personnalise',
    category: 'tshirt',
    // Masqué du parcours public tant que l'impression textile n'est pas disponible.
    active: false,
    description: 'T-shirt 100% coton, impression recto et/ou verso.',
    thumbnail: 'data:image/svg+xml;utf8,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
        <rect width="160" height="160" rx="20" fill="#F2E9DA"/>
        <path d="M55 30 L40 45 L50 58 L58 52 L58 128 L102 128 L102 52 L110 58 L120 45 L105 30 L95 38 Q80 46 65 38 Z" fill="#FFFFFF" stroke="#0F1111" stroke-width="4" stroke-linejoin="round"/>
      </svg>
    `),
    model3d: {
      url: './assets/models/shirt-realistic.glb',
      materialName: '',
      placeholderShape: 'tshirt'
    },
    canvasSize: 1600,
    printDpiTarget: 150,
    faces: ['front', 'back'],
    printAreas: TSHIRT_PRINT_AREAS,
    zones: {
      front: TSHIRT_ZONE_FRONT,
      back: TSHIRT_ZONE_BACK
    },
    colors: [
      { id: 'white', label: 'Blanc', hex: '#ffffff' },
      { id: 'black', label: 'Noir', hex: '#0f1111' },
      { id: 'navy', label: 'Bleu marine', hex: '#1c2b4a' },
      { id: 'red', label: 'Rouge', hex: '#b3211e' },
      { id: 'ash', label: 'Gris chine', hex: '#b7b3ab' }
    ],
    sizes: [
      { id: 'S', label: 'S', priceDelta: 0 },
      { id: 'M', label: 'M', priceDelta: 0 },
      { id: 'L', label: 'L', priceDelta: 0 },
      { id: 'XL', label: 'XL', priceDelta: 150 },
      { id: 'XXL', label: 'XXL', priceDelta: 300 }
    ],
    quantity: { min: 1, max: 100, step: 1, default: 1 },
    pricing: {
      basePrice: 1800,
      extraFacePrice: 450,
      currency: 'HTG'
    }
  },
  {
    id: 'mug-classic',
    name: 'Tasse personnalisee',
    category: 'mug',
    // La tasse est le premier support disponible dans le parcours public.
    active: true,
    description: 'Tasse ceramique 11oz, impression sur toute la zone enveloppante.',
    thumbnail: 'data:image/svg+xml;utf8,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
        <rect width="160" height="160" rx="20" fill="#F2E9DA"/>
        <rect x="42" y="52" width="62" height="66" rx="8" fill="#FFFFFF" stroke="#0F1111" stroke-width="4"/>
        <path d="M104 64c14 0 22 8 22 20s-8 20-22 20" fill="none" stroke="#0F1111" stroke-width="4"/>
      </svg>
    `),
    model3d: {
      url: null, // PLACEHOLDER: ex. './assets/models/mug.glb'
      materialName: '',
      placeholderShape: 'mug'
    },
    canvasSize: 2000,
    printDpiTarget: 150,
    faces: ['wrap'],
    printAreas: MUG_PRINT_AREAS,
    zones: {
      wrap: MUG_ZONE_WRAP
    },
    colors: [
      { id: 'white', label: 'Blanc', hex: '#ffffff' },
      { id: 'black', label: 'Noir', hex: '#171a1f' },
      { id: 'navy', label: 'Bleu marine', hex: '#1c2b4a' },
      { id: 'red', label: 'Rouge', hex: '#b3211e' },
      { id: 'sand', label: 'Sable', hex: '#c7b9a5' }
    ],
    sizes: [
      { id: 'one-size', label: '11oz', priceDelta: 0 }
    ],
    quantity: { min: 1, max: 200, step: 1, default: 1 },
    pricing: {
      basePrice: 1200,
      extraFacePrice: 0,
      currency: 'HTG'
    }
  },
  {
    id: 'tumbler-classic',
    name: 'Tumbler personnalise',
    category: 'tumbler',
    active: true,
    description: 'Tumbler isotherme, impression enveloppante et format nomade.',
    thumbnail: 'data:image/svg+xml;utf8,' + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
        <rect width="160" height="160" rx="20" fill="#F2E9DA"/>
        <path d="M55 38h50l-5 92H60z" fill="#FFFFFF" stroke="#0F1111" stroke-width="4"/>
        <rect x="50" y="28" width="60" height="14" rx="5" fill="#1C2B4A" stroke="#0F1111" stroke-width="4"/>
        <path d="M70 22h20v10H70z" fill="#FFFFFF" stroke="#0F1111" stroke-width="4"/>
      </svg>
    `),
    model3d: { url: null, materialName: '', placeholderShape: 'tumbler' },
    canvasSize: 2000,
    printDpiTarget: 150,
    faces: ['wrap'],
    printAreas: [
      { id: 'tumbler-wrap', face: 'wrap', label: 'Tout autour', shortLabel: 'Enveloppante', bounds: { x: .10, y: .18, width: .80, height: .64 }, physicalWidthInches: 8.5, physicalHeightInches: 5.2, priceDelta: 0 }
    ].map(withProductionMetadata),
    zones: { wrap: { x: .10, y: .18, width: .80, height: .64, label: 'Impression enveloppante' } },
    colors: [
      { id: 'black', label: 'Noir mat', hex: '#171a1f' },
      { id: 'white', label: 'Blanc', hex: '#ffffff' },
      { id: 'navy', label: 'Bleu marine', hex: '#1c2b4a' },
      { id: 'red', label: 'Rouge', hex: '#b3211e' },
      { id: 'sand', label: 'Sable', hex: '#c7b9a5' }
    ],
    sizes: [{ id: '20oz', label: '20 oz', priceDelta: 0 }],
    quantity: { min: 1, max: 200, step: 1, default: 1 },
    pricing: { basePrice: 1800, extraFacePrice: 0, currency: 'HTG' }
  }
];

export function getActivePersonalizationProducts() {
  return PERSONALIZATION_PRODUCTS.filter((product) => product.active !== false);
}

export function getPersonalizationProduct(productId) {
  return PERSONALIZATION_PRODUCTS.find((product) => product.id === productId) || null;
}

export function getProductFaces(product) {
  return Array.isArray(product?.faces) ? product.faces : [];
}

export function getProductZone(product, face) {
  return product?.zones?.[face] || null;
}

export function getProductPrintAreas(product, face = null) {
  const configured = Array.isArray(product?.printAreas) ? product.printAreas : [];
  const normalized = configured.length
    ? configured
    : (product?.faces || []).map((item) => ({
      id: `${item}-default`, face: item, label: product?.zones?.[item]?.label || item,
      shortLabel: product?.zones?.[item]?.label || item, bounds: product?.zones?.[item], priceDelta: 0
    }));
  return face ? normalized.filter((area) => area.face === face) : normalized;
}

export function getProductPrintArea(product, areaId) {
  return getProductPrintAreas(product).find((area) => area.id === areaId) || getProductPrintAreas(product)[0] || null;
}

export function getProductColor(product, colorId) {
  return (product?.colors || []).find((color) => color.id === colorId) || product?.colors?.[0] || null;
}

export function getProductSize(product, sizeId) {
  return (product?.sizes || []).find((size) => size.id === sizeId) || product?.sizes?.[0] || null;
}

// facesUsed: liste des faces qui contiennent au moins un calque (ex: ['front'] ou ['front','back'])
export function computePersonalizationPrice({ product, sizeId, quantity = 1, facesUsed = [], areasUsed = [] }) {
  if (!product) return { unitPrice: 0, totalPrice: 0, breakdown: [] };

  const size = getProductSize(product, sizeId);
  const qty = Math.max(Number(product.quantity?.min) || 1, Math.min(Number(quantity) || 1, Number(product.quantity?.max) || 999));
  const usedFaceCount = Math.max(1, facesUsed.filter(Boolean).length);
  const extraFaces = Math.max(0, usedFaceCount - 1);

  const base = Number(product.pricing?.basePrice) || 0;
  const sizeDelta = Number(size?.priceDelta) || 0;
  const facesDelta = extraFaces * (Number(product.pricing?.extraFacePrice) || 0);
  const selectedAreas = getProductPrintAreas(product).filter((area) => areasUsed.includes(area.id));
  const areasDelta = selectedAreas.reduce((sum, area) => sum + (Number(area.priceDelta) || 0), 0);

  const unitPrice = base + sizeDelta + facesDelta + areasDelta;
  const totalPrice = unitPrice * qty;

  return {
    unitPrice,
    totalPrice,
    quantity: qty,
    breakdown: [
      { label: 'Prix de base', value: base },
      { label: 'Supplement taille', value: sizeDelta },
      { label: 'Supplément faces supplémentaires', value: facesDelta },
      { label: 'Emplacements premium', value: areasDelta }
    ]
  };
}
