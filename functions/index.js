const admin = require('firebase-admin');
const crypto = require('crypto');
const logger = require('firebase-functions/logger');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { reserveStockValue } = require('./auto-parts/core');
const {
  DEFAULT_COMMISSION_RATE: DEFAULT_JWETPRO_COMMISSION_RATE,
  calculateTicketAmounts,
  normalizeRate: normalizeJwetproRate,
  normalizeTicketStatus,
  signPayload: signJwetproPayload,
  verifySignedRequest: verifyJwetproSignedRequest
} = require('./jwetpro-ticket-core');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const PROJECT_ID = 'smartcutservices-9ce54';
const REGION = process.env.FUNCTION_REGION || 'us-central1';
const SITE_BASE_URL = normalizeBaseUrl(process.env.PUBLIC_SITE_URL || 'https://smartcutservices.com');
// Base pour résoudre les images produit stockées en chemin relatif (beaucoup
// d'images vivent dans le dépôt GitHub servi par GitHub Pages, pas dans Firebase
// Storage). On les résout donc contre le site public lui-même.
const REPO_CDN_BASE_URL = normalizeBaseUrl(
  process.env.PRODUCT_ASSET_CDN_BASE || SITE_BASE_URL
);
const MONCASH_API_BASE = normalizeBaseUrl(
  process.env.MONCASH_API_BASE || 'https://moncashbutton.digicelgroup.com/Api'
);
const MONCASH_GATEWAY_BASE = normalizeBaseUrl(
  process.env.MONCASH_GATEWAY_BASE || 'https://moncashbutton.digicelgroup.com/Moncash-middleware'
);
const MONCASH_CURRENCY = process.env.MONCASH_CURRENCY || 'HTG';
const DEFAULT_RETURN_URL = `${SITE_BASE_URL}/moncash/return`;
const DEFAULT_ALERT_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/moncashAlert`;
const VENDOR_SERVICE_FEES_COLLECTION = 'vendorServiceFees';
const VENDOR_SERVICE_FEE_INTERVAL_DAYS = 30;
const VENDOR_PLAN_SETTINGS_COLLECTION = 'vendorPlanSettings';
const VENDOR_PLAN_SETTINGS_DOC = 'main';
const VENDOR_PLAN_BONUSES_COLLECTION = 'vendorPlanBonuses';
const DEFAULT_VENDOR_PRO_PLAN_PRICE = 1750;
const JWETPRO_TICKETS_COLLECTION = 'jwetproTicketCatalog';
const JWETPRO_ORDERS_COLLECTION = 'jwetproTicketOrders';
const JWETPRO_SETTINGS_COLLECTION = 'jwetproTicketSettings';
const JWETPRO_SETTINGS_DOC = 'main';
const JWETPRO_EVENTS_COLLECTION = 'jwetproIntegrationEvents';
const JWETPRO_RETURN_BASE_URL = normalizeBaseUrl(process.env.JWETPRO_RETURN_BASE_URL || 'https://jwetpro.com');
const JWETPRO_CONFIRM_PAYMENT_URL = process.env.JWETPRO_CONFIRM_PAYMENT_URL ||
  'https://us-central1-mopyonlakay.cloudfunctions.net/confirmChampionshipTicketPayment';
const SITE_COMMENTS_COLLECTION = 'siteComments';
const SITE_COMMENT_RATE_LIMITS_COLLECTION = 'siteCommentRateLimits';
const SITE_COMMENT_MIN_INTERVAL_MS = 15000;

const MONCASH_CLIENT_ID = defineSecret('MONCASH_CLIENT_ID');
const MONCASH_CLIENT_SECRET = defineSecret('MONCASH_CLIENT_SECRET');
const MONCASH_SECRET_API_KEY = defineSecret('MONCASH_SECRET_API_KEY');
const MONCASH_BUSINESS_KEY = defineSecret('MONCASH_BUSINESS_KEY');
const JWETPRO_INTEGRATION_SECRET = defineSecret('JWETPRO_INTEGRATION_SECRET');

let tokenCache = {
  accessToken: '',
  expiresAt: 0
};

const CONFIRMED_ORDER_STATUSES = new Set(['approved', 'paid']);

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function sanitizeText(value, maxLength = 240) {
  return String(value || '').trim().slice(0, maxLength);
}

function getSafeMoncashPublicError(error) {
  const rawMessage = String(error?.message || error?.payload?.message || error?.payload?.error || '').trim();
  const lowerMessage = rawMessage.toLowerCase();
  const technicalMarkers = [
    'jpa entitymanager',
    'jdbcconnectionexception',
    'jdbc connection',
    'hibernate',
    'org.hibernate',
    'nested exception',
    'stack trace',
    'exception:'
  ];

  if (!rawMessage || technicalMarkers.some((marker) => lowerMessage.includes(marker))) {
    return {
      status: 503,
      error: 'moncash-temporarily-unavailable',
      message: 'MonCash est temporairement indisponible. Votre paiement n a pas ete lance. Veuillez reessayer dans quelques minutes.'
    };
  }

  if (rawMessage.length > 180) {
    return {
      status: 500,
      error: 'server-error',
      message: 'Impossible de demarrer le paiement MonCash pour le moment. Veuillez reessayer dans quelques minutes.'
    };
  }

  return {
    status: Number(error?.status || 500) >= 500 ? 500 : 400,
    error: Number(error?.status || 500) >= 500 ? 'server-error' : 'moncash-request-failed',
    message: rawMessage
  };
}

function sanitizePath(value = '') {
  const text = sanitizeText(value, 320);
  if (!text) return '/';
  return text.startsWith('/') ? text : `/${text}`;
}

function sanitizeAnalyticsEventName(value = '') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_:-]/g, '_');
  return normalized || 'page_view';
}

function parseLanguageRegion(value = '') {
  const match = String(value || '').trim().match(/-([A-Za-z]{2})$/);
  return match ? match[1].toUpperCase() : '';
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const fallback = String(req.ip || req.connection?.remoteAddress || '').trim();
  return forwarded || fallback;
}

function hashValue(value = '') {
  const text = String(value || '').trim();
  if (!text) return '';
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 24);
}

function detectBrowserFromUserAgent(userAgent = '') {
  const ua = String(userAgent || '');
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera';
  if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return 'Safari';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/MSIE|Trident\//i.test(ua)) return 'Internet Explorer';
  return 'Autre';
}

function detectOsFromUserAgent(userAgent = '') {
  const ua = String(userAgent || '');
  if (/Windows/i.test(ua)) return 'Windows';
  if (/Android/i.test(ua)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Autre';
}

function detectDeviceType({ userAgent = '', viewport = '' } = {}) {
  const ua = String(userAgent || '');
  const width = Number(String(viewport || '').split('x')[0]) || 0;
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod/i.test(ua)) return width >= 768 ? 'tablet' : 'mobile';
  return 'desktop';
}

function inferTrafficSource(referrer = '', source = '') {
  const directSource = String(source || '').trim().toLowerCase();
  if (directSource) return directSource;

  const ref = String(referrer || '').trim();
  if (!ref) return 'direct';

  try {
    const host = new URL(ref).hostname.toLowerCase();
    if (host.includes('google')) return 'google';
    if (host.includes('facebook') || host.includes('fb.')) return 'facebook';
    if (host.includes('instagram')) return 'instagram';
    if (host.includes('whatsapp')) return 'whatsapp';
    if (host.includes('tiktok')) return 'tiktok';
    if (host.includes('youtube')) return 'youtube';
    if (host.includes('bing')) return 'bing';
    if (host.includes('mail')) return 'email';
    return host.replace(/^www\./, '');
  } catch (_) {
    return 'referral';
  }
}

function createAnalyticsBuckets(days = 30) {
  const buckets = [];
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    timeZone: 'America/Port-au-Prince'
  });

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - index);
    const key = date.toISOString().slice(0, 10);
    buckets.push({
      key,
      label: formatter.format(date).replace('.', ''),
      pageViews: 0,
      uniqueVisitors: 0,
      _sessions: new Set()
    });
  }

  return buckets;
}

function incrementCounter(map, key, payloadFactory = null) {
  const normalizedKey = String(key || '').trim() || 'inconnu';
  if (!map.has(normalizedKey)) {
    map.set(normalizedKey, payloadFactory ? payloadFactory() : { label: normalizedKey, value: 0 });
  }
  map.get(normalizedKey).value += 1;
}

function finalizeCounterMap(map, { limit = 8 } = {}) {
  return Array.from(map.values())
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function applyCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function handleOptions(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

function sendJson(res, status, body) {
  applyCors(res);
  res.status(status).json(body);
}

async function verifyBearerUser(req) {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice(7).trim();
  if (!token) return null;

  return admin.auth().verifyIdToken(token);
}

async function getVendorProfile(uid) {
  if (!uid) return null;

  const vendorSnap = await db.collection('vendors').doc(uid).get();
  if (vendorSnap.exists) {
    return { id: vendorSnap.id, ...(vendorSnap.data() || {}) };
  }

  const clientSnap = await db.collection('clients').doc(uid).get();
  if (clientSnap.exists) {
    return { id: clientSnap.id, ...(clientSnap.data() || {}) };
  }

  return null;
}

async function isAdminUser(uid) {
  if (!uid) return false;
  const clientSnap = await db.collection('clients').doc(uid).get();
  if (!clientSnap.exists) return false;
  return String(clientSnap.data()?.role || '').toLowerCase() === 'admin';
}

const SMART_MANAGEMENT_ROLE_ALIASES = {
  cashier: 'caissier',
  caissiere: 'caissier',
  caissière: 'caissier',
  stock: 'stock_manager',
  responsable_stock: 'stock_manager',
  inventory_manager: 'stock_manager',
  readonly: 'lecture_seule',
  read_only: 'lecture_seule',
  viewer: 'lecture_seule',
};

const SMART_MANAGEMENT_ROLES = new Set([
  'admin',
  'manager',
  'caissier',
  'stock_manager',
  'responsable_ecommerce',
  'lecture_seule',
]);

function normalizeSmartManagementRole(role = '') {
  const normalized = String(role || '').trim().toLowerCase();
  return SMART_MANAGEMENT_ROLE_ALIASES[normalized] || normalized;
}

async function getSmartManagementAccess(uid) {
  if (!uid) return { allowed: false, role: '' };
  const clientSnap = await db.collection('clients').doc(uid).get();
  if (!clientSnap.exists) return { allowed: false, role: '' };
  const data = clientSnap.data() || {};
  const role = normalizeSmartManagementRole(data.role || '');
  const isAdmin = role === 'admin';
  const allowed = isAdmin || data.smartManagementAccess === true || data.dashboardAccess === true || SMART_MANAGEMENT_ROLES.has(role);
  return { allowed, role, isAdmin };
}

function isPosStockAdjustment(body = {}, lines = []) {
  const marker = [
    body.reason,
    body.note,
    body.reference,
    body.source,
    ...lines.flatMap((line) => [line.reason, line.note])
  ].map((value) => String(value || '').toLowerCase()).join(' ');
  const allLinesAreSaleDeductions = lines.length > 0 && lines.every((line) => (
    Number.isInteger(line.quantity)
      && line.quantity < 0
      && (line.countedQuantity === null || line.countedQuantity === undefined)
  ));
  return allLinesAreSaleDeductions && (
    marker.includes('vente pos')
      || marker.includes('vente en magasin')
      || marker.includes('smart-caisse')
  );
}

async function canRunSmartStockOperation(uid, operationType, body = {}, lines = []) {
  const access = await getSmartManagementAccess(uid);
  if (!access.allowed) return false;
  if (access.isAdmin || access.role === 'manager' || access.role === 'stock_manager') return true;
  if (access.role === 'caissier') {
    return operationType === 'ADJUSTMENT' && isPosStockAdjustment(body, lines);
  }
  return false;
}

async function canRunSmartTransferOperation(uid) {
  const access = await getSmartManagementAccess(uid);
  return access.allowed && ['admin', 'manager', 'stock_manager'].includes(access.role);
}

async function deleteDocumentRefs(refs = []) {
  const uniqueRefs = new Map();
  refs.forEach((ref) => {
    if (ref?.path) uniqueRefs.set(ref.path, ref);
  });

  const values = Array.from(uniqueRefs.values());
  for (let index = 0; index < values.length; index += 450) {
    const batch = db.batch();
    values.slice(index, index + 450).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }

  return values.length;
}

async function collectVendorLinkedProductRefs(vendorId) {
  const fields = ['vendorId', 'uid', 'sellerUid', 'ownerUid'];
  const snapshots = await Promise.all(fields.map((field) => (
    db.collection('vendorProducts').where(field, '==', vendorId).get().catch((error) => {
      logger.warn('deleteClientAccount vendorProducts lookup failed', {
        vendorId,
        field,
        message: error?.message || ''
      });
      return null;
    })
  )));

  return snapshots
    .filter(Boolean)
    .flatMap((snapshot) => snapshot.docs.map((item) => item.ref));
}

async function deleteLinkedVendorAccount(vendorId) {
  if (!vendorId) {
    return { vendorDeleted: false, vendorApplicationDeleted: false, vendorProductsDeleted: 0 };
  }

  const vendorRef = db.collection('vendors').doc(vendorId);
  const applicationRef = db.collection('vendorApplications').doc(vendorId);
  const [vendorSnap, applicationSnap, productRefs] = await Promise.all([
    vendorRef.get(),
    applicationRef.get(),
    collectVendorLinkedProductRefs(vendorId)
  ]);

  await deleteDocumentRefs([
    ...(vendorSnap.exists ? [vendorRef] : []),
    ...(applicationSnap.exists ? [applicationRef] : []),
    ...productRefs
  ]);

  return {
    vendorDeleted: vendorSnap.exists,
    vendorApplicationDeleted: applicationSnap.exists,
    vendorProductsDeleted: new Set(productRefs.map((ref) => ref.path)).size
  };
}

const SMART_STOCK_BALANCES_COLLECTION = 'smartManagementStockBalances';
const SMART_STOCK_MOVEMENTS_COLLECTION = 'smartManagementStockMovements';
const SMART_STOCK_OPERATIONS_COLLECTION = 'smartManagementStockOperations';
const SMART_STOCK_TRANSFERS_COLLECTION = 'smartManagementStockTransfers';

function smartStockSafeId(value = '') {
  return String(value || 'none').trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'none';
}

function smartStockBalanceId({ locationId = '', productId = '', variantId = '' } = {}) {
  return [
    smartStockSafeId(locationId),
    smartStockSafeId(productId),
    smartStockSafeId(variantId || 'simple')
  ].join('__');
}

function getAdminTimestamp() {
  return admin.firestore.FieldValue.serverTimestamp();
}

function normalizeStockQuantity(value, { integer = true } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number)) return NaN;
  return integer ? Math.trunc(number) : number;
}

function extractSmartProductVariants(product = {}) {
  const source = Array.isArray(product.variants) ? product.variants
    : Array.isArray(product.variations) ? product.variations
      : [];
  return source.map((variant, index) => ({
    id: String(variant.id || variant.variantId || variant.sku || `variant-${index + 1}`),
    label: sanitizeText(variant.label || variant.name || variant.title || variant.optionLabel || `Variante ${index + 1}`, 180),
    sku: sanitizeText(variant.sku || '', 120).toUpperCase(),
    barcode: sanitizeText(variant.barcode || variant.codebarre || '', 120),
    purchasePrice: Math.max(0, toNumber(variant.purchasePrice || variant.costPrice || variant.buyingPrice)),
    salePrice: Math.max(0, toNumber(variant.salePrice || variant.price || variant.specificPrice || variant.prix)),
    status: String(variant.status || '').toLowerCase() === 'inactive' || variant.active === false ? 'inactive' : 'active'
  }));
}

function normalizeStockLine(raw = {}) {
  return {
    productId: sanitizeText(raw.productId, 160),
    variantId: sanitizeText(raw.variantId || '', 160),
    locationId: sanitizeText(raw.locationId, 160),
    quantity: normalizeStockQuantity(raw.quantity),
    countedQuantity: raw.countedQuantity === undefined || raw.countedQuantity === '' ? null : normalizeStockQuantity(raw.countedQuantity),
    unitCost: Math.max(0, toNumber(raw.unitCost)),
    lowStockThreshold: Math.max(0, normalizeStockQuantity(raw.lowStockThreshold || 5)),
    reason: sanitizeText(raw.reason || '', 180),
    note: sanitizeText(raw.note || '', 800),
    oldGlobalStockObserved: raw.oldGlobalStockObserved === undefined ? null : normalizeStockQuantity(raw.oldGlobalStockObserved),
    confirmDifference: raw.confirmDifference === true,
  };
}

function buildStockMovementPatch({ operationType, reference, line, locationSnap, productSnap, variant, beforePhysical, beforeReserved, afterPhysical, unitCost, actorUid, note, reason }) {
  const product = productSnap.data() || {};
  const location = locationSnap.data() || {};
  const variation = afterPhysical - beforePhysical;
  const salePrice = variant ? Math.max(0, toNumber(variant.salePrice)) : Math.max(0, toNumber(product.salePrice || product.price || product.basePrice || product.prix));
  const purchasePrice = Math.max(0, toNumber(unitCost || (variant ? variant.purchasePrice : product.purchasePrice || product.costPrice || product.buyingPrice)));
  return {
    type: operationType,
    reference,
    productId: line.productId,
    productName: sanitizeText(product.name || product.title || 'Produit', 220),
    variantId: line.variantId || '',
    variantLabel: variant?.label || '',
    locationId: line.locationId,
    locationName: sanitizeText(location.name || location.code || 'Emplacement', 220),
    sku: sanitizeText(variant?.sku || product.sku || '', 140),
    barcode: sanitizeText(variant?.barcode || product.barcode || product.codebarre || '', 140),
    categoryId: sanitizeText(product.categoryId || product.categorySlug || '', 140),
    categoryName: sanitizeText(product.categoryName || product.category || product.categoryLabel || '', 180),
    beforePhysicalQty: beforePhysical,
    beforeReservedQty: beforeReserved,
    beforeAvailableQty: beforePhysical - beforeReserved,
    quantityChange: variation,
    afterPhysicalQty: afterPhysical,
    afterReservedQty: beforeReserved,
    afterAvailableQty: afterPhysical - beforeReserved,
    reason: reason || sanitizeText(line.reason || operationType, 180),
    note: note || line.note || '',
    businessReference: reference,
    unitCost: purchasePrice,
    salePrice,
    actorUid,
    createdAt: getAdminTimestamp()
  };
}

function buildStockBalancePatch({ line, locationSnap, productSnap, variant, afterPhysical, beforeReserved, unitCost, operationType, actorUid }) {
  const product = productSnap.data() || {};
  const location = locationSnap.data() || {};
  const salePrice = variant ? Math.max(0, toNumber(variant.salePrice)) : Math.max(0, toNumber(product.salePrice || product.price || product.basePrice || product.prix));
  const purchasePrice = Math.max(0, toNumber(unitCost || (variant ? variant.purchasePrice : product.purchasePrice || product.costPrice || product.buyingPrice)));
  const thresholdSource = line.lowStockThreshold !== undefined && line.lowStockThreshold !== null && line.lowStockThreshold !== ''
    ? line.lowStockThreshold
    : product.lowStockThreshold !== undefined && product.lowStockThreshold !== null && product.lowStockThreshold !== ''
      ? product.lowStockThreshold
      : 5;
  const threshold = Math.max(0, normalizeStockQuantity(thresholdSource));
  const availableQty = afterPhysical - beforeReserved;
  const calculatedStatus = afterPhysical <= 0 || availableQty <= 0 ? 'out_of_stock'
    : availableQty <= threshold ? 'low_stock'
      : 'available';
  return {
    locationId: line.locationId,
    locationName: sanitizeText(location.name || location.code || 'Emplacement', 220),
    productId: line.productId,
    productName: sanitizeText(product.name || product.title || 'Produit', 220),
    variantId: line.variantId || '',
    variantLabel: variant?.label || '',
    sku: sanitizeText(variant?.sku || product.sku || '', 140),
    barcode: sanitizeText(variant?.barcode || product.barcode || product.codebarre || '', 140),
    categoryId: sanitizeText(product.categoryId || product.categorySlug || '', 140),
    categoryName: sanitizeText(product.categoryName || product.category || product.categoryLabel || '', 180),
    productType: line.variantId ? 'variants' : 'simple',
    image: sanitizeText(variant?.image || product.image || product.imageUrl || (Array.isArray(product.images) ? product.images[0] : ''), 800),
    physicalQty: afterPhysical,
    reservedQty: beforeReserved,
    availableQty,
    lowStockThreshold: threshold,
    status: calculatedStatus,
    productStatus: String(product.status || '').toLowerCase() === 'inactive' || product.active === false ? 'inactive' : 'active',
    unitCost: purchasePrice,
    salePrice,
    stockValueAtCost: purchasePrice * afterPhysical,
    stockValueAtSale: salePrice * afterPhysical,
    initialized: true,
    lastMovementType: operationType,
    updatedAt: getAdminTimestamp(),
    updatedBy: actorUid
  };
}

function makeSmartTransferNumber() {
  const year = new Date().getFullYear();
  const stamp = Date.now().toString(36).toUpperCase();
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TRF-${year}-${stamp}-${suffix}`;
}

function normalizeStockTransferLine(raw = {}, index = 0) {
  return {
    lineId: sanitizeText(raw.lineId || `line-${index + 1}`, 80),
    productId: sanitizeText(raw.productId, 160),
    variantId: sanitizeText(raw.variantId || '', 160),
    quantity: normalizeStockQuantity(raw.quantity),
    receivedQty: normalizeStockQuantity(raw.receivedQty || 0),
    discrepancyQty: normalizeStockQuantity(raw.discrepancyQty || 0),
    unitCost: Math.max(0, toNumber(raw.unitCost)),
    lowStockThreshold: Math.max(0, normalizeStockQuantity(raw.lowStockThreshold || 5)),
    note: sanitizeText(raw.note || '', 800)
  };
}

function buildTransferHistoryEvent({ type, fromStatus, toStatus, uid, note }) {
  return {
    type,
    fromStatus: fromStatus || '',
    toStatus: toStatus || '',
    uid,
    note: sanitizeText(note || '', 800),
    at: admin.firestore.Timestamp.now()
  };
}

function getTransferLineKey(line = {}) {
  return `${line.productId}|${line.variantId || 'simple'}`;
}

function getTransferRemainingQty(line = {}) {
  return Math.max(
    0,
    normalizeStockQuantity(line.shippedQty || 0)
      - normalizeStockQuantity(line.receivedQty || 0)
      - normalizeStockQuantity(line.closedDiscrepancyQty || 0)
  );
}

async function executeSmartTransferOperation({ decodedUser, body }) {
  const canManageTransfer = await canRunSmartTransferOperation(decodedUser.uid);
  if (!canManageTransfer) {
    return { status: 403, body: { ok: false, error: 'smart-management-access-denied' } };
  }

  const action = sanitizeText(body.action || body.transferAction || '', 80).toLowerCase();
  const idempotencyKey = sanitizeText(body.idempotencyKey, 180);
  const transferId = sanitizeText(body.transferId, 180);
  const note = sanitizeText(body.note || '', 900);

  if (!idempotencyKey) {
    return { status: 400, body: { ok: false, error: 'missing-idempotency-key' } };
  }
  if (!['create_draft', 'submit', 'approve', 'reject', 'cancel', 'ship', 'receive'].includes(action)) {
    return { status: 400, body: { ok: false, error: 'invalid-transfer-action' } };
  }

  const operationRef = db.collection(SMART_STOCK_OPERATIONS_COLLECTION).doc(idempotencyKey);
  const operationResult = { transferId: '', movementIds: [] };

  await db.runTransaction(async (transaction) => {
    const operationSnap = await transaction.get(operationRef);
    if (operationSnap.exists) {
      const data = operationSnap.data() || {};
      if (data.status === 'completed') {
        operationResult.transferId = data.transferId || transferId || '';
        operationResult.movementIds = Array.isArray(data.movementIds) ? data.movementIds : [];
        return;
      }
      throw new Error('Operation deja en cours ou incomplete.');
    }

    const now = getAdminTimestamp();

    if (action === 'create_draft') {
      const sourceLocationId = sanitizeText(body.sourceLocationId, 160);
      const destinationLocationId = sanitizeText(body.destinationLocationId, 160);
      const reason = sanitizeText(body.reason || 'Transfert interne', 220);
      const lines = Array.isArray(body.lines) ? body.lines.map(normalizeStockTransferLine) : [];
      if (!sourceLocationId || !destinationLocationId) throw new Error('Source et destination obligatoires.');
      if (sourceLocationId === destinationLocationId) throw new Error('La source et la destination doivent etre differentes.');
      if (!lines.length) throw new Error('Ajoutez au moins une ligne.');

      const sourceRef = db.collection('smartManagementLocations').doc(sourceLocationId);
      const destinationRef = db.collection('smartManagementLocations').doc(destinationLocationId);
      const [sourceSnap, destinationSnap] = await Promise.all([
        transaction.get(sourceRef),
        transaction.get(destinationRef)
      ]);
      if (!sourceSnap.exists || String(sourceSnap.data()?.status || 'active') !== 'active') throw new Error('Emplacement source introuvable ou inactif.');
      if (!destinationSnap.exists || String(destinationSnap.data()?.status || 'active') !== 'active') throw new Error('Emplacement destination introuvable ou inactif.');

      const prepared = [];
      const seen = new Set();
      for (let index = 0; index < lines.length; index += 1) {
        const line = { ...lines[index], lineId: lines[index].lineId || `line-${index + 1}` };
        const key = getTransferLineKey(line);
        if (!line.productId) throw new Error('Produit obligatoire sur chaque ligne.');
        if (seen.has(key)) throw new Error('Lignes dupliquees: fusionnez les quantites avant validation.');
        seen.add(key);
        if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error('Chaque quantite doit etre entiere et positive.');

        const productRef = db.collection('products').doc(line.productId);
        const sourceBalanceRef = db.collection(SMART_STOCK_BALANCES_COLLECTION).doc(smartStockBalanceId({
          locationId: sourceLocationId,
          productId: line.productId,
          variantId: line.variantId
        }));
        const [productSnap, sourceBalanceSnap] = await Promise.all([
          transaction.get(productRef),
          transaction.get(sourceBalanceRef)
        ]);
        if (!productSnap.exists) throw new Error('Produit introuvable.');
        const product = productSnap.data() || {};
        if (String(product.status || '').toLowerCase() === 'inactive' || product.active === false) throw new Error('Produit inactif: transfert refuse.');
        const variants = extractSmartProductVariants(product);
        const hasVariants = variants.length || product.productType === 'variants';
        const variant = line.variantId ? variants.find((item) => item.id === line.variantId) : null;
        if (hasVariants && !line.variantId) throw new Error('Ce produit utilise des variantes: choisissez une variante.');
        if (line.variantId && !variant) throw new Error('Variante invalide pour ce produit.');
        if (variant && variant.status === 'inactive') throw new Error('Variante inactive: transfert refuse.');
        const sourceBalance = sourceBalanceSnap.exists ? sourceBalanceSnap.data() || {} : {};
        const available = normalizeStockQuantity(sourceBalance.availableQty || 0);
        if (line.quantity > available) throw new Error(`Stock disponible insuffisant pour ${product.name || product.title || 'Produit'}.`);

        prepared.push({ line, productSnap, variant, sourceBalanceSnap, sourceBalanceRef });
      }

      const transferRef = db.collection(SMART_STOCK_TRANSFERS_COLLECTION).doc();
      const source = sourceSnap.data() || {};
      const destination = destinationSnap.data() || {};
      const transferNumber = makeSmartTransferNumber();
      const transferLines = prepared.map((entry) => {
        const product = entry.productSnap.data() || {};
        return {
          lineId: entry.line.lineId,
          productId: entry.line.productId,
          productName: sanitizeText(product.name || product.title || 'Produit', 220),
          variantId: entry.line.variantId || '',
          variantLabel: entry.variant?.label || '',
          sku: sanitizeText(entry.variant?.sku || product.sku || '', 140),
          barcode: sanitizeText(entry.variant?.barcode || product.barcode || product.codebarre || '', 140),
          requestedQty: entry.line.quantity,
          shippedQty: 0,
          receivedQty: 0,
          discrepancyQty: 0,
          closedDiscrepancyQty: 0,
          unitCost: entry.line.unitCost,
          lowStockThreshold: entry.line.lowStockThreshold,
          note: entry.line.note || ''
        };
      });
      transaction.set(transferRef, {
        transferNumber,
        reference: transferNumber,
        status: 'draft',
        sourceLocationId,
        sourceLocationName: sanitizeText(source.name || source.code || 'Source', 220),
        destinationLocationId,
        destinationLocationName: sanitizeText(destination.name || destination.code || 'Destination', 220),
        expectedShipDate: sanitizeText(body.expectedShipDate || '', 40),
        expectedReceiveDate: sanitizeText(body.expectedReceiveDate || '', 40),
        reason,
        note,
        lines: transferLines,
        lineCount: transferLines.length,
        requestedQty: transferLines.reduce((sum, line) => sum + line.requestedQty, 0),
        shippedQty: 0,
        receivedQty: 0,
        inTransitQty: 0,
        createdBy: decodedUser.uid,
        updatedBy: decodedUser.uid,
        history: [buildTransferHistoryEvent({ type: 'creation', fromStatus: '', toStatus: 'draft', uid: decodedUser.uid, note })],
        createdAt: now,
        updatedAt: now
      });
      transaction.set(operationRef, {
        idempotencyKey,
        operationType: 'TRANSFER',
        action,
        transferId: transferRef.id,
        transferNumber,
        status: 'completed',
        movementIds: [],
        actorUid: decodedUser.uid,
        createdAt: now,
        updatedAt: now
      });
      operationResult.transferId = transferRef.id;
      return;
    }

    if (!transferId) throw new Error('transferId obligatoire.');
    const transferRef = db.collection(SMART_STOCK_TRANSFERS_COLLECTION).doc(transferId);
    const transferSnap = await transaction.get(transferRef);
    if (!transferSnap.exists) throw new Error('Transfert introuvable.');
    const transfer = transferSnap.data() || {};
    const currentStatus = String(transfer.status || 'draft');
    const lines = Array.isArray(transfer.lines) ? transfer.lines : [];
    const sourceRef = db.collection('smartManagementLocations').doc(transfer.sourceLocationId);
    const destinationRef = db.collection('smartManagementLocations').doc(transfer.destinationLocationId);
    const [sourceSnap, destinationSnap] = await Promise.all([
      transaction.get(sourceRef),
      transaction.get(destinationRef)
    ]);
    if (!sourceSnap.exists || !destinationSnap.exists) throw new Error('Emplacement source ou destination introuvable.');

    const transitionPatch = {
      updatedAt: now,
      updatedBy: decodedUser.uid
    };
    const movementIds = [];

    if (action === 'submit') {
      if (currentStatus !== 'draft') throw new Error('Seul un brouillon peut etre soumis.');
      if (!lines.length) throw new Error('Transfert sans ligne.');
      transitionPatch.status = 'pending_approval';
      transitionPatch.submittedBy = decodedUser.uid;
      transitionPatch.submittedAt = now;
      transitionPatch.history = admin.firestore.FieldValue.arrayUnion(buildTransferHistoryEvent({ type: 'submission', fromStatus: currentStatus, toStatus: 'pending_approval', uid: decodedUser.uid, note }));
    } else if (action === 'approve') {
      if (currentStatus !== 'pending_approval') throw new Error('Seul un transfert en attente peut etre approuve.');
      transitionPatch.status = 'approved';
      transitionPatch.approvedBy = decodedUser.uid;
      transitionPatch.approvedAt = now;
      transitionPatch.history = admin.firestore.FieldValue.arrayUnion(buildTransferHistoryEvent({ type: 'approval', fromStatus: currentStatus, toStatus: 'approved', uid: decodedUser.uid, note }));
    } else if (action === 'reject') {
      if (currentStatus !== 'pending_approval') throw new Error('Seul un transfert en attente peut etre refuse.');
      if (!note) throw new Error('Une justification est obligatoire pour refuser.');
      transitionPatch.status = 'rejected';
      transitionPatch.rejectedBy = decodedUser.uid;
      transitionPatch.rejectedAt = now;
      transitionPatch.rejectionNote = note;
      transitionPatch.history = admin.firestore.FieldValue.arrayUnion(buildTransferHistoryEvent({ type: 'rejection', fromStatus: currentStatus, toStatus: 'rejected', uid: decodedUser.uid, note }));
    } else if (action === 'cancel') {
      if (!['draft', 'approved'].includes(currentStatus)) throw new Error('Ce statut ne peut pas etre annule directement.');
      if (!note) throw new Error('Une justification est obligatoire pour annuler.');
      transitionPatch.status = 'cancelled';
      transitionPatch.cancelledBy = decodedUser.uid;
      transitionPatch.cancelledAt = now;
      transitionPatch.cancellationNote = note;
      transitionPatch.history = admin.firestore.FieldValue.arrayUnion(buildTransferHistoryEvent({ type: 'cancellation', fromStatus: currentStatus, toStatus: 'cancelled', uid: decodedUser.uid, note }));
    } else if (action === 'ship') {
      if (currentStatus !== 'approved') throw new Error('Seul un transfert approuve peut etre expedie.');
      const prepared = [];
      for (const line of lines) {
        const sourceLine = {
          productId: line.productId,
          variantId: line.variantId || '',
          locationId: transfer.sourceLocationId,
          quantity: normalizeStockQuantity(line.requestedQty),
          unitCost: line.unitCost,
          lowStockThreshold: line.lowStockThreshold,
          note: line.note || ''
        };
        const productRef = db.collection('products').doc(sourceLine.productId);
        const balanceRef = db.collection(SMART_STOCK_BALANCES_COLLECTION).doc(smartStockBalanceId(sourceLine));
        const [productSnap, balanceSnap] = await Promise.all([
          transaction.get(productRef),
          transaction.get(balanceRef)
        ]);
        if (!productSnap.exists) throw new Error('Produit introuvable pendant expedition.');
        if (!balanceSnap.exists) throw new Error('Stock source introuvable pendant expedition.');
        const product = productSnap.data() || {};
        const variant = sourceLine.variantId ? extractSmartProductVariants(product).find((item) => item.id === sourceLine.variantId) : null;
        const balance = balanceSnap.data() || {};
        const available = normalizeStockQuantity(balance.availableQty || 0);
        if (sourceLine.quantity > available) throw new Error(`Stock insuffisant pour expedier ${product.name || product.title || 'Produit'}.`);
        prepared.push({ line, sourceLine, productSnap, balanceSnap, balanceRef, variant });
      }
      const nextLines = lines.map((line) => ({ ...line, shippedQty: normalizeStockQuantity(line.requestedQty) }));
      prepared.forEach((entry) => {
        const current = entry.balanceSnap.data() || {};
        const beforePhysical = normalizeStockQuantity(current.physicalQty || 0);
        const beforeReserved = Math.max(0, normalizeStockQuantity(current.reservedQty || 0));
        const afterPhysical = beforePhysical - entry.sourceLine.quantity;
        if (afterPhysical < 0 || afterPhysical - beforeReserved < 0) throw new Error('Expedition refusee: stock source negatif.');
        const movementRef = db.collection(SMART_STOCK_MOVEMENTS_COLLECTION).doc();
        transaction.set(entry.balanceRef, {
          ...buildStockBalancePatch({
            line: entry.sourceLine,
            locationSnap: sourceSnap,
            productSnap: entry.productSnap,
            variant: entry.variant,
            afterPhysical,
            beforeReserved,
            unitCost: entry.sourceLine.unitCost,
            operationType: 'TRANSFER_OUT',
            actorUid: decodedUser.uid
          }),
          createdAt: current.createdAt || now
        }, { merge: true });
        transaction.set(movementRef, {
          ...buildStockMovementPatch({
            operationType: 'TRANSFER_OUT',
            reference: transfer.transferNumber || transfer.reference || transferId,
            line: entry.sourceLine,
            locationSnap: sourceSnap,
            productSnap: entry.productSnap,
            variant: entry.variant,
            beforePhysical,
            beforeReserved,
            afterPhysical,
            unitCost: entry.sourceLine.unitCost,
            actorUid: decodedUser.uid,
            note,
            reason: 'Transfert expedie'
          }),
          transferId,
          transferNumber: transfer.transferNumber || transfer.reference || '',
          idempotencyKey,
          operationCreatedAt: now
        });
        movementIds.push(movementRef.id);
      });
      transitionPatch.status = 'in_transit';
      transitionPatch.lines = nextLines;
      transitionPatch.shippedQty = nextLines.reduce((sum, line) => sum + normalizeStockQuantity(line.shippedQty || 0), 0);
      transitionPatch.inTransitQty = transitionPatch.shippedQty - normalizeStockQuantity(transfer.receivedQty || 0);
      transitionPatch.shippedBy = decodedUser.uid;
      transitionPatch.shippedAt = now;
      transitionPatch.history = admin.firestore.FieldValue.arrayUnion(buildTransferHistoryEvent({ type: 'shipping', fromStatus: currentStatus, toStatus: 'in_transit', uid: decodedUser.uid, note }));
    } else if (action === 'receive') {
      if (!['in_transit', 'partially_received'].includes(currentStatus)) throw new Error('Ce transfert ne peut pas etre recu maintenant.');
      const receiveLines = Array.isArray(body.receiveLines) ? body.receiveLines : [];
      const prepared = [];
      const nextLines = lines.map((line) => ({ ...line }));
      let totalReceivedNow = 0;
      let totalDiscrepancyNow = 0;
      for (const raw of receiveLines) {
        const lineId = sanitizeText(raw.lineId, 80);
        const index = nextLines.findIndex((line) => line.lineId === lineId);
        if (index < 0) throw new Error('Ligne de reception invalide.');
        const receivedNow = normalizeStockQuantity(raw.receivedQty || 0);
        const discrepancyNow = normalizeStockQuantity(raw.discrepancyQty || 0);
        if (receivedNow < 0 || discrepancyNow < 0) throw new Error('Reception invalide: quantite negative.');
        if (receivedNow === 0 && discrepancyNow === 0) continue;
        const remaining = getTransferRemainingQty(nextLines[index]);
        if (receivedNow + discrepancyNow > remaining) throw new Error('Reception superieure au restant.');
        const line = nextLines[index];
        const destinationLine = {
          productId: line.productId,
          variantId: line.variantId || '',
          locationId: transfer.destinationLocationId,
          quantity: receivedNow,
          unitCost: line.unitCost,
          lowStockThreshold: line.lowStockThreshold,
          note: sanitizeText(raw.note || '', 800)
        };
        if (receivedNow > 0) {
          const productRef = db.collection('products').doc(destinationLine.productId);
          const balanceRef = db.collection(SMART_STOCK_BALANCES_COLLECTION).doc(smartStockBalanceId(destinationLine));
          const [productSnap, balanceSnap] = await Promise.all([
            transaction.get(productRef),
            transaction.get(balanceRef)
          ]);
          if (!productSnap.exists) throw new Error('Produit introuvable pendant reception.');
          const product = productSnap.data() || {};
          const variant = destinationLine.variantId ? extractSmartProductVariants(product).find((item) => item.id === destinationLine.variantId) : null;
          prepared.push({ index, receivedNow, discrepancyNow, destinationLine, productSnap, balanceSnap, balanceRef, variant });
        } else {
          prepared.push({ index, receivedNow, discrepancyNow, destinationLine, productSnap: null, balanceSnap: null, balanceRef: null, variant: null });
        }
        totalReceivedNow += receivedNow;
        totalDiscrepancyNow += discrepancyNow;
      }
      if (totalReceivedNow + totalDiscrepancyNow <= 0) throw new Error('Indiquez au moins une quantite traitee.');

      prepared.forEach((entry) => {
        nextLines[entry.index].receivedQty = normalizeStockQuantity(nextLines[entry.index].receivedQty || 0) + entry.receivedNow;
        nextLines[entry.index].discrepancyQty = normalizeStockQuantity(nextLines[entry.index].discrepancyQty || 0) + entry.discrepancyNow;
        if (entry.receivedNow <= 0) return;
        const current = entry.balanceSnap?.exists ? entry.balanceSnap.data() || {} : {};
        const beforePhysical = normalizeStockQuantity(current.physicalQty || 0);
        const beforeReserved = Math.max(0, normalizeStockQuantity(current.reservedQty || 0));
        const afterPhysical = beforePhysical + entry.receivedNow;
        const movementRef = db.collection(SMART_STOCK_MOVEMENTS_COLLECTION).doc();
        transaction.set(entry.balanceRef, {
          ...buildStockBalancePatch({
            line: entry.destinationLine,
            locationSnap: destinationSnap,
            productSnap: entry.productSnap,
            variant: entry.variant,
            afterPhysical,
            beforeReserved,
            unitCost: entry.destinationLine.unitCost,
            operationType: 'TRANSFER_IN',
            actorUid: decodedUser.uid
          }),
          createdAt: current.createdAt || now
        }, { merge: true });
        transaction.set(movementRef, {
          ...buildStockMovementPatch({
            operationType: 'TRANSFER_IN',
            reference: transfer.transferNumber || transfer.reference || transferId,
            line: entry.destinationLine,
            locationSnap: destinationSnap,
            productSnap: entry.productSnap,
            variant: entry.variant,
            beforePhysical,
            beforeReserved,
            afterPhysical,
            unitCost: entry.destinationLine.unitCost,
            actorUid: decodedUser.uid,
            note,
            reason: 'Transfert recu'
          }),
          transferId,
          transferNumber: transfer.transferNumber || transfer.reference || '',
          idempotencyKey,
          operationCreatedAt: now
        });
        movementIds.push(movementRef.id);
      });
      const shippedQty = nextLines.reduce((sum, line) => sum + normalizeStockQuantity(line.shippedQty || 0), 0);
      const receivedQty = nextLines.reduce((sum, line) => sum + normalizeStockQuantity(line.receivedQty || 0), 0);
      const discrepancyQty = nextLines.reduce((sum, line) => sum + normalizeStockQuantity(line.discrepancyQty || 0), 0);
      const inTransitQty = Math.max(0, shippedQty - receivedQty - discrepancyQty);
      const nextStatus = inTransitQty <= 0 ? 'received' : 'partially_received';
      transitionPatch.status = nextStatus;
      transitionPatch.lines = nextLines;
      transitionPatch.receivedQty = receivedQty;
      transitionPatch.discrepancyQty = discrepancyQty;
      transitionPatch.inTransitQty = inTransitQty;
      transitionPatch.receivedBy = decodedUser.uid;
      transitionPatch.receivedAt = now;
      transitionPatch.history = admin.firestore.FieldValue.arrayUnion(buildTransferHistoryEvent({ type: nextStatus === 'received' ? 'full_reception' : 'partial_reception', fromStatus: currentStatus, toStatus: nextStatus, uid: decodedUser.uid, note }));
    }

    transaction.update(transferRef, transitionPatch);
    transaction.set(operationRef, {
      idempotencyKey,
      operationType: 'TRANSFER',
      action,
      transferId,
      transferNumber: transfer.transferNumber || transfer.reference || '',
      status: 'completed',
      movementIds,
      actorUid: decodedUser.uid,
      createdAt: now,
      updatedAt: now
    });
    operationResult.transferId = transferId;
    operationResult.movementIds = movementIds;
  });

  return { status: 200, body: { ok: true, transferId: operationResult.transferId, movementIds: operationResult.movementIds, idempotencyKey } };
}

async function executeSmartStockOperation({ decodedUser, body }) {
  const operationType = sanitizeText(body.operationType, 60).toUpperCase();
  const idempotencyKey = sanitizeText(body.idempotencyKey, 180);
  const reference = sanitizeText(body.reference || `${operationType}-${Date.now()}`, 180);
  const note = sanitizeText(body.note || '', 900);
  const reason = sanitizeText(body.reason || '', 180);
  const supplier = sanitizeText(body.supplier || '', 220);
  const lines = Array.isArray(body.lines) ? body.lines.map(normalizeStockLine) : [normalizeStockLine(body)];

  if (operationType === 'TRANSFER') {
    return executeSmartTransferOperation({ decodedUser, body });
  }

  const canManageStock = await canRunSmartStockOperation(decodedUser.uid, operationType, body, lines);
  if (!canManageStock) {
    return { status: 403, body: { ok: false, error: 'smart-management-access-denied' } };
  }

  if (!['INITIAL_STOCK', 'RECEIPT', 'ADJUSTMENT'].includes(operationType)) {
    return { status: 400, body: { ok: false, error: 'invalid-operation-type' } };
  }
  if (!idempotencyKey) {
    return { status: 400, body: { ok: false, error: 'missing-idempotency-key' } };
  }
  if (!lines.length) {
    return { status: 400, body: { ok: false, error: 'missing-lines' } };
  }

  const operationRef = db.collection(SMART_STOCK_OPERATIONS_COLLECTION).doc(idempotencyKey);
  const movementIds = [];

  await db.runTransaction(async (transaction) => {
    const operationSnap = await transaction.get(operationRef);
    if (operationSnap.exists) {
      const data = operationSnap.data() || {};
      if (data.status === 'completed') {
        movementIds.push(...(Array.isArray(data.movementIds) ? data.movementIds : []));
        return;
      }
      throw new Error('Operation deja en cours ou incomplete.');
    }

    const prepared = [];
    const seen = new Set();
    for (const line of lines) {
      if (!line.productId || !line.locationId) throw new Error('Produit et emplacement obligatoires.');
      const key = `${line.locationId}|${line.productId}|${line.variantId || 'simple'}`;
      if (seen.has(key)) throw new Error('Lignes dupliquees: fusionnez les quantites avant validation.');
      seen.add(key);
      if (operationType === 'RECEIPT' && (!Number.isInteger(line.quantity) || line.quantity <= 0)) throw new Error('La reception exige une quantite positive.');
      if (operationType === 'INITIAL_STOCK' && (!Number.isInteger(line.quantity) || line.quantity < 0)) throw new Error('Le stock initial doit etre superieur ou egal a zero.');
      if (operationType === 'ADJUSTMENT') {
        const hasDelta = Number.isInteger(line.quantity) && line.quantity !== 0;
        const hasCount = Number.isInteger(line.countedQuantity) && line.countedQuantity >= 0;
        if (!hasDelta && !hasCount) throw new Error('Ajustement invalide: indiquez une variation ou une quantite comptee.');
        if (line.reason === 'Autre' && !line.note) throw new Error('Une justification est obligatoire pour le motif Autre.');
      }

      const locationRef = db.collection('smartManagementLocations').doc(line.locationId);
      const productRef = db.collection('products').doc(line.productId);
      const balanceRef = db.collection(SMART_STOCK_BALANCES_COLLECTION).doc(smartStockBalanceId(line));
      const [locationSnap, productSnap, balanceSnap] = await Promise.all([
        transaction.get(locationRef),
        transaction.get(productRef),
        transaction.get(balanceRef)
      ]);
      if (!locationSnap.exists || String(locationSnap.data()?.status || 'active') !== 'active') throw new Error('Emplacement introuvable ou inactif.');
      if (!productSnap.exists) throw new Error('Produit introuvable.');
      const product = productSnap.data() || {};
      const productInactive = String(product.status || '').toLowerCase() === 'inactive' || product.active === false;
      if (productInactive && operationType !== 'ADJUSTMENT') throw new Error('Produit inactif: operation non autorisee.');
      const variants = extractSmartProductVariants(product);
      const hasVariants = variants.length || product.productType === 'variants';
      const variant = line.variantId ? variants.find((item) => item.id === line.variantId) : null;
      if (hasVariants && !line.variantId) throw new Error('Ce produit utilise des variantes: choisissez une variante.');
      if (line.variantId && !variant) throw new Error('Variante invalide pour ce produit.');
      if (variant && variant.status === 'inactive' && operationType !== 'ADJUSTMENT') throw new Error('Variante inactive: operation non autorisee.');

      prepared.push({ line, locationSnap, productSnap, balanceSnap, balanceRef, variant });
    }

    const now = getAdminTimestamp();
    const writtenMovements = [];
    prepared.forEach((entry) => {
      const current = entry.balanceSnap.exists ? entry.balanceSnap.data() || {} : {};
      const legacyPhysicalQty = !entry.balanceSnap.exists && operationType === 'ADJUSTMENT'
        && Number.isInteger(entry.line.oldGlobalStockObserved) && entry.line.oldGlobalStockObserved >= 0
        ? entry.line.oldGlobalStockObserved
        : 0;
      const beforePhysical = normalizeStockQuantity(entry.balanceSnap.exists ? current.physicalQty || 0 : legacyPhysicalQty);
      const beforeReserved = Math.max(0, normalizeStockQuantity(current.reservedQty || 0));
      let afterPhysical = beforePhysical;
      let movementType = operationType;

      if (operationType === 'INITIAL_STOCK') {
        if (current.initialized === true) throw new Error('Cette reference est deja initialisee dans cet emplacement.');
        afterPhysical = entry.line.quantity;
      } else if (operationType === 'RECEIPT') {
        afterPhysical = beforePhysical + entry.line.quantity;
      } else if (operationType === 'ADJUSTMENT') {
        afterPhysical = Number.isInteger(entry.line.countedQuantity)
          ? entry.line.countedQuantity
          : beforePhysical + entry.line.quantity;
        movementType = afterPhysical >= beforePhysical ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT';
      }

      if (afterPhysical < 0) throw new Error('Operation refusee: quantite physique negative.');
      if (afterPhysical - beforeReserved < 0) throw new Error('Operation refusee: quantite disponible incoherente.');

      const movementRef = db.collection(SMART_STOCK_MOVEMENTS_COLLECTION).doc();
      const movementPatch = buildStockMovementPatch({
        operationType: movementType,
        reference,
        line: entry.line,
        locationSnap: entry.locationSnap,
        productSnap: entry.productSnap,
        variant: entry.variant,
        beforePhysical,
        beforeReserved,
        afterPhysical,
        unitCost: entry.line.unitCost,
        actorUid: decodedUser.uid,
        note,
        reason
      });
      transaction.set(entry.balanceRef, {
        ...buildStockBalancePatch({
          line: entry.line,
          locationSnap: entry.locationSnap,
          productSnap: entry.productSnap,
          variant: entry.variant,
          afterPhysical,
          beforeReserved,
          unitCost: entry.line.unitCost,
          operationType: movementType,
          actorUid: decodedUser.uid
        }),
        createdAt: current.createdAt || now,
        initializedAt: current.initializedAt || (operationType === 'INITIAL_STOCK' ? now : null),
        oldGlobalStockObserved: operationType === 'INITIAL_STOCK' ? entry.line.oldGlobalStockObserved : current.oldGlobalStockObserved ?? entry.line.oldGlobalStockObserved ?? null,
        initializationReference: current.initializationReference || (operationType === 'INITIAL_STOCK' ? reference : '')
      }, { merge: true });
      transaction.set(movementRef, {
        ...movementPatch,
        supplier,
        idempotencyKey,
        operationCreatedAt: now
      });
      if (operationType === 'ADJUSTMENT' && entry.line.reason === 'Vente en magasin') {
        const productData = entry.productSnap.data() || {};
        const quantityChange = afterPhysical - beforePhysical;
        const productPatch = { updatedAt: now };
        const variantsField = Array.isArray(productData.variants) ? 'variants'
          : Array.isArray(productData.variations) ? 'variations'
            : '';

        if (entry.line.variantId && variantsField) {
          productPatch[variantsField] = productData[variantsField].map((variant, index) => {
            const variantId = String(variant.id || variant.variantId || variant.sku || `variant-${index + 1}`);
            if (variantId !== entry.line.variantId) return variant;
            const currentVariantStock = normalizeStockQuantity(
              variant.stock ?? variant.totalStock ?? variant.quantity ?? variant.qty ?? beforePhysical
            );
            const nextVariantStock = Math.max(0, currentVariantStock + quantityChange);
            return {
              ...variant,
              stock: nextVariantStock,
              totalStock: variant.totalStock !== undefined ? nextVariantStock : variant.totalStock,
              quantity: variant.quantity !== undefined ? nextVariantStock : variant.quantity,
              qty: variant.qty !== undefined ? nextVariantStock : variant.qty
            };
          });
        }

        const currentGlobalStock = normalizeStockQuantity(
          productData.stock ?? productData.totalStock ?? productData.quantity ?? productData.qty ?? beforePhysical
        );
        if (Number.isFinite(currentGlobalStock)) {
          const nextGlobalStock = Math.max(0, currentGlobalStock + quantityChange);
          productPatch.stock = nextGlobalStock;
          if (productData.totalStock !== undefined) productPatch.totalStock = nextGlobalStock;
          if (productData.quantity !== undefined) productPatch.quantity = nextGlobalStock;
          if (productData.qty !== undefined) productPatch.qty = nextGlobalStock;
        }

        transaction.update(entry.productSnap.ref, productPatch);
      }
      writtenMovements.push(movementRef.id);
    });

    transaction.set(operationRef, {
      idempotencyKey,
      operationType,
      reference,
      status: 'completed',
      movementIds: writtenMovements,
      lineCount: prepared.length,
      actorUid: decodedUser.uid,
      supplier,
      note,
      createdAt: now,
      updatedAt: now
    });
    movementIds.push(...writtenMovements);
  });

  return { status: 200, body: { ok: true, movementIds, idempotencyKey } };
}

function isApprovedVendorProfile(profile) {
  if (!profile) return false;
  const role = String(profile.role || '').toLowerCase();
  const status = String(profile.status || profile.vendorStatus || '').toLowerCase();
  return role === 'vendor' && ['active', 'approved'].includes(status || 'active');
}

function normalizeOrderStatus(order = {}) {
  return String(order?.paymentStatus || order?.status || '').trim().toLowerCase();
}

function isConfirmedOrder(order = {}) {
  return CONFIRMED_ORDER_STATUSES.has(normalizeOrderStatus(order));
}

function toDateMs(value) {
  if (!value) return 0;

  if (typeof value?.toDate === 'function') {
    return value.toDate().getTime();
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMonthKey(value) {
  const date = value ? new Date(value) : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function addDaysIso(value, days = 30) {
  const base = value ? new Date(value) : new Date();
  const date = Number.isNaN(base.getTime()) ? new Date() : base;
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString();
}

function addMonthsIso(value, months = 1) {
  const base = value ? new Date(value) : new Date();
  const date = Number.isNaN(base.getTime()) ? new Date() : base;
  date.setMonth(date.getMonth() + Number(months || 1));
  return date.toISOString();
}

function normalizeBonusDurationDays(source = {}) {
  const rawDays = Number(source.durationDays || source.bonusDurationDays || source.offerDurationDays || 0);
  if ([30, 90, 180].includes(rawDays)) return rawDays;
  const rawMonths = Number(source.durationMonths || source.bonusDurationMonths || source.offerDurationMonths || 0);
  if (rawMonths === 1) return 30;
  if (rawMonths === 3) return 90;
  if (rawMonths === 6) return 180;
  const startMs = toDateMs(source.startAt || source.bonusStartAt || source.offerStartAt || source.startDate);
  const endMs = toDateMs(source.endAt || source.bonusEndAt || source.offerEndAt || source.endDate);
  if (startMs && endMs && endMs > startMs) {
    const diffDays = Math.round((endMs - startMs) / (24 * 60 * 60 * 1000));
    if (diffDays >= 150) return 180;
    if (diffDays >= 60) return 90;
    return 30;
  }
  return 30;
}

function bonusDurationMonthsLabel(days = 30) {
  const normalizedDays = normalizeBonusDurationDays({ durationDays: days });
  return normalizedDays === 180 ? 6 : normalizedDays === 90 ? 3 : 1;
}

function normalizeVendorServicePaymentMethod(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('nat')) return 'natcash';
  if (normalized.includes('card') || normalized.includes('carte')) return 'card';
  return 'moncash';
}

function getVendorServiceFeeAmount(vendor = {}) {
  const configured = toNumber(vendor?.monthlyServiceFee || vendor?.serviceFeeAmount);
  if (configured > 0) return configured;
  const planPrice = toNumber(vendor?.planPrice);
  const planId = String(vendor?.planId || '').trim().toLowerCase();
  const planPaymentRequired = Boolean(vendor?.planPaymentRequired);
  if ((planPaymentRequired || planId === 'pro') && planPrice > 0) return planPrice;
  return 0;
}

async function getVendorPlanSettings() {
  try {
    const snap = await db.collection(VENDOR_PLAN_SETTINGS_COLLECTION).doc(VENDOR_PLAN_SETTINGS_DOC).get();
    return snap.exists ? snap.data() || {} : {};
  } catch (error) {
    logger.warn('Vendor plan settings unavailable, fallback used', { message: error?.message || String(error) });
    return {};
  }
}

function getVendorProPlanMeta(settings = {}) {
  const price = toNumber(settings?.proPrice || settings?.proPlanPrice || DEFAULT_VENDOR_PRO_PLAN_PRICE) || DEFAULT_VENDOR_PRO_PLAN_PRICE;
  return {
    id: 'pro',
    label: 'PRO',
    price,
    currency: String(settings?.currency || MONCASH_CURRENCY || 'HTG').trim() || 'HTG',
    cycleDays: VENDOR_SERVICE_FEE_INTERVAL_DAYS
  };
}

function normalizeVendorPlanBonusStatus(offer = {}, nowMs = Date.now()) {
  if (offer.enabled === false || offer.active === false || String(offer.status || '').toLowerCase() === 'disabled') {
    return 'disabled';
  }
  const startMs = toDateMs(offer.startAt || offer.startDate || offer.startsAt);
  const endMs = toDateMs(offer.endAt || offer.endDate || offer.expiresAt);
  if (startMs && startMs > nowMs) return 'scheduled';
  if (endMs && endMs <= nowMs) return 'expired';
  return 'active';
}

function getFirstActivationBonusSettings(settings = {}, proPlan = {}) {
  const source = settings.firstActivationBonus || settings.firstActivationBonusOffer || {};
  const enabled = source.enabled === true || source.active === true || settings.firstActivationBonusEnabled === true;
  const amount = Math.max(0, toNumber(source.amount ?? source.promoPrice ?? source.price ?? settings.firstActivationBonusAmount));
  const durationDays = normalizeBonusDurationDays({
    ...source,
    durationDays: source.durationDays || settings.firstActivationBonusDurationDays,
    durationMonths: source.durationMonths || settings.firstActivationBonusDurationMonths
  });
  if (!enabled || amount <= 0) return null;

  return {
    id: 'global-first-activation',
    type: 'global_first_activation',
    label: 'Offre premiere activation Plan Pro',
    amount,
    normalAmount: proPlan.price,
    currency: proPlan.currency,
    durationDays,
    durationMonths: bonusDurationMonthsLabel(durationDays),
    enabled: true
  };
}

async function vendorHasEverPaidPro(vendorId = '', vendor = {}) {
  const normalizedVendorId = String(vendorId || '').trim();
  if (!normalizedVendorId) return true;

  if (vendor.firstActivationBonusUsedAt || vendor.firstActivationBonusFeeId) return true;
  if (isVendorProPlan(vendor) && vendor.serviceFeeLastPaidAt) return true;

  const snap = await db.collection(VENDOR_SERVICE_FEES_COLLECTION).where('vendorId', '==', normalizedVendorId).get();
  return snap.docs.some((docSnap) => {
    const data = docSnap.data() || {};
    const status = String(data.status || '').toLowerCase();
    const planId = String(data.planId || '').toLowerCase();
    const planLabel = String(data.planLabel || '').toLowerCase();
    return status === 'paid' && (planId === 'pro' || planLabel.includes('pro'));
  });
}

function buildVendorPlanOfferPayload(offer = {}, nowIso = new Date().toISOString(), options = {}) {
  if (!offer) return null;
  const durationDays = normalizeBonusDurationDays(offer);
  const durationMonths = bonusDurationMonthsLabel(durationDays);
  const deferActivation = options.deferActivation === true;
  const startAt = deferActivation ? '' : (offer.startAt || nowIso);
  const endAt = deferActivation ? '' : (offer.endAt || offer.endDate || addDaysIso(startAt, durationDays));
  return {
    offerId: offer.id || '',
    offerType: offer.type || '',
    offerLabel: offer.label || '',
    offerAmount: Math.max(0, toNumber(offer.amount)),
    offerNormalAmount: Math.max(0, toNumber(offer.normalAmount)),
    offerCurrency: offer.currency || MONCASH_CURRENCY,
    offerDurationDays: durationDays,
    offerDurationMonths: durationMonths,
    offerStartAt: startAt,
    offerEndAt: endAt,
    offerAppliedAt: nowIso
  };
}

function getStoredVendorBonusOffer(vendor = {}, proPlan = {}, nowMs = Date.now()) {
  const type = String(vendor.serviceFeeBonusType || '').trim();
  const endAt = vendor.serviceFeeBonusEndAt || '';
  const endMs = toDateMs(endAt);
  const amount = Math.max(0, toNumber(vendor.serviceFeeBonusAmount));
  if (!type || !endMs || endMs <= nowMs || amount <= 0) return null;

  const durationDays = normalizeBonusDurationDays({
    durationDays: vendor.serviceFeeBonusDurationDays,
    durationMonths: vendor.serviceFeeBonusDurationMonths
  });
  return {
    id: vendor.serviceFeeBonusId || type,
    type,
    label: vendor.serviceFeeBonusLabel || (type === 'special_vendor' ? 'Bonification speciale Plan Pro' : 'Offre premiere activation Plan Pro'),
    amount,
    normalAmount: Math.max(0, toNumber(vendor.serviceFeeBonusNormalAmount || proPlan.price)),
    currency: vendor.planCurrency || proPlan.currency,
    durationDays,
    durationMonths: bonusDurationMonthsLabel(durationDays),
    startAt: vendor.serviceFeeBonusStartAt || '',
    endAt,
    status: 'active'
  };
}

async function getActiveVendorSpecialBonus(vendorId = '', proPlan = {}, nowMs = Date.now()) {
  const normalizedVendorId = String(vendorId || '').trim();
  if (!normalizedVendorId) return null;

  const snap = await db.collection(VENDOR_PLAN_BONUSES_COLLECTION).where('vendorId', '==', normalizedVendorId).get();
  const activeOffers = snap.docs
    .map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
    .filter((offer) => normalizeVendorPlanBonusStatus(offer, nowMs) === 'active')
    .sort((a, b) => toDateMs(a.endAt || a.endDate) - toDateMs(b.endAt || b.endDate));

  const offer = activeOffers[0];
  if (!offer) return null;
  const amount = Math.max(0, toNumber(offer.amount || offer.promoPrice || offer.price));
  if (amount <= 0) return null;

  return {
    id: offer.id,
    type: 'special_vendor',
    label: offer.label || 'Bonification speciale Plan Pro',
    amount,
    normalAmount: proPlan.price,
    currency: offer.currency || proPlan.currency,
    durationDays: normalizeBonusDurationDays(offer),
    durationMonths: bonusDurationMonthsLabel(normalizeBonusDurationDays(offer)),
    startAt: '',
    endAt: '',
    status: 'active'
  };
}

async function resolveVendorProOffer({ vendorId = '', vendor = {}, settings = {}, proPlan = {}, nowIso = new Date().toISOString() } = {}) {
  const nowMs = toDateMs(nowIso) || Date.now();
  const specialOffer = await getActiveVendorSpecialBonus(vendorId, proPlan, nowMs);
  if (specialOffer) return specialOffer;

  const storedOffer = getStoredVendorBonusOffer(vendor, proPlan, nowMs);
  if (storedOffer) return storedOffer;

  const globalOffer = getFirstActivationBonusSettings(settings, proPlan);
  if (!globalOffer) return null;

  const alreadyUsed = await vendorHasEverPaidPro(vendorId, vendor);
  if (alreadyUsed) return null;
  return globalOffer;
}

function isVendorProPlan(vendor = {}) {
  const planId = String(vendor?.planId || '').trim().toLowerCase();
  const planLabel = String(vendor?.planLabel || '').trim().toLowerCase();
  return planId === 'pro' || planLabel.includes('pro');
}

function isVendorServiceFeeVendor(vendor = {}) {
  return getVendorServiceFeeAmount(vendor) > 0;
}

async function updateVendorProductsServiceStatus(vendorId = '', status = 'active', extraPatch = {}) {
  const normalizedVendorId = String(vendorId || '').trim();
  if (!normalizedVendorId) return;

  const snap = await db
    .collection('vendorProducts')
    .where('vendorId', '==', normalizedVendorId)
    .get();

  if (snap.empty) return;

  const now = new Date().toISOString();
  const batches = [];
  let batch = db.batch();
  let count = 0;

  snap.docs.forEach((docSnap) => {
    batch.set(docSnap.ref, {
      vendorServiceFeeStatus: status,
      vendorServiceFeeUpdatedAt: now,
      ...extraPatch,
      updatedAt: now
    }, { merge: true });
    count += 1;
    if (count === 450) {
      batches.push(batch.commit());
      batch = db.batch();
      count = 0;
    }
  });

  if (count > 0) batches.push(batch.commit());
  await Promise.all(batches);
}

function createMonthBuckets(months = 6) {
  const formatter = new Intl.DateTimeFormat('fr-FR', {
    month: 'short',
    year: '2-digit',
    timeZone: 'America/Port-au-Prince'
  });
  const now = new Date();
  const buckets = [];

  for (let index = months - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    buckets.push({
      key: toMonthKey(date),
      label: formatter.format(date).replace('.', ''),
      amount: 0,
      orders: 0
    });
  }

  return buckets;
}

function getRelevantVendorItems(order = {}, vendorUid = '', vendorProductIds = new Set()) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.filter((item) => {
    const itemVendorId = String(item?.vendorId || '').trim();
    const productId = String(item?.productId || '').trim();
    return itemVendorId === vendorUid || (productId && vendorProductIds.has(productId));
  });
}

function buildReturnPageUrl({ sessionId = '', orderId = '', transactionId = '', status = '' } = {}) {
  const url = new URL(DEFAULT_RETURN_URL);
  if (sessionId) url.searchParams.set('session_id', String(sessionId).trim());
  if (orderId) url.searchParams.set('orderId', String(orderId).trim());
  if (transactionId) url.searchParams.set('transactionId', String(transactionId).trim());
  if (status) url.searchParams.set('status', String(status).trim());
  return url.toString();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateText(value, maxLength = 220) {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function buildProductPageAbsoluteUrl(productId = '') {
  const url = new URL('/product.html', `${SITE_BASE_URL}/`);
  if (productId) url.searchParams.set('product', String(productId).trim());
  return url.toString();
}

function extractSharedProductId(req) {
  const fromQuery = String(req.query.product || req.query.id || '').trim();
  if (fromQuery) return fromQuery;

  const path = String(req.path || req.originalUrl || '').split('?')[0];
  const segments = path.split('/').filter(Boolean);
  const pIndex = segments.findIndex((segment) => segment === 'p');
  if (pIndex >= 0 && segments[pIndex + 1]) {
    return decodeURIComponent(String(segments[pIndex + 1] || '').trim());
  }

  return '';
}

async function findPublicProductDocument(productId = '', preferredCollection = '') {
  const trimmedId = String(productId || '').trim();
  if (!trimmedId) return null;

  const collections = preferredCollection
    ? [preferredCollection, ...(preferredCollection === 'vendorProducts' ? ['products'] : ['vendorProducts'])]
    : ['products', 'vendorProducts'];

  for (const collectionName of collections) {
    const snap = await db.collection(collectionName).doc(trimmedId).get();
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const status = String(data.status || '').toLowerCase();
    const isVisible = status ? status === 'active' : data.active !== false;
    if (!isVisible) continue;
    return {
      id: snap.id,
      sourceCollection: collectionName,
      ...data
    };
  }

  return null;
}

function getPrimaryProductImage(product = {}) {
  const normalizeImageUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
    const normalizedPath = raw.replace(/^\.?\//, '');
    if (!normalizedPath) return '';
    return new URL(`/${normalizedPath}`, `${REPO_CDN_BASE_URL}/`).toString();
  };

  if (Array.isArray(product.images) && product.images[0]) {
    return normalizeImageUrl(product.images[0]);
  }

  if (Array.isArray(product.variations)) {
    for (const variation of product.variations) {
      if (Array.isArray(variation?.images) && variation.images[0]) {
        return normalizeImageUrl(variation.images[0]);
      }
      if (variation?.image) {
        return normalizeImageUrl(variation.image);
      }
    }
  }

  return normalizeImageUrl('/logo.png');
}

function buildProductShareHtml(product = {}, productUrl = '') {
  const title = truncateText(product.name || 'Produit Smart Cut Services', 90);
  const description = truncateText(
    product.shortDescription || product.longDescription || product.description || 'Découvrez ce produit sur Smart Cut Services.',
    200
  );
  const imageUrl = getPrimaryProductImage(product);
  const price = Number.isFinite(Number(product.price)) ? `${Number(product.price)} HTG` : '';
  const category = truncateText(product.category || product.categoryName || '', 60);
  const vendorName = truncateText(product.vendorName || product.shopName || '', 60);
  const subtitleParts = [category, vendorName, price].filter(Boolean);
  const subtitle = subtitleParts.join(' • ');
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeImageUrl = escapeHtml(imageUrl);
  const safeProductUrl = escapeHtml(productUrl);
  const safeSubtitle = escapeHtml(subtitle);

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle} | Smart Cut Services</title>
  <meta name="description" content="${safeDescription}">
  <link rel="canonical" href="${safeProductUrl}">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="Smart Cut Services">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:url" content="${safeProductUrl}">
  <meta property="og:image" content="${safeImageUrl}">
  <meta property="og:image:secure_url" content="${safeImageUrl}">
  <meta property="og:image:alt" content="${safeTitle}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDescription}">
  <meta name="twitter:image" content="${safeImageUrl}">
  <script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    description,
    image: imageUrl ? [imageUrl] : undefined,
    category: category || undefined,
    brand: { '@type': 'Brand', name: vendorName || 'Smart Cut Services' },
    ...(Number.isFinite(Number(product.price)) && Number(product.price) > 0 ? {
      offers: {
        '@type': 'Offer',
        price: String(Number(product.price)),
        priceCurrency: 'HTG',
        availability: 'https://schema.org/InStock',
        url: productUrl,
      },
    } : {}),
  }).replace(/</g, '\\u003c')}</script>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: linear-gradient(180deg, #fbf7ef 0%, #f2ebde 100%);
      color: #1f1e1c;
      font-family: Arial, sans-serif;
      padding: 1.5rem;
    }
    .card {
      width: min(100%, 560px);
      background: rgba(255,255,255,0.92);
      border: 1px solid rgba(198,167,94,0.18);
      border-radius: 24px;
      padding: 1.5rem;
      box-shadow: 0 18px 42px rgba(31,30,28,0.08);
    }
    .media {
      width: 100%;
      aspect-ratio: 1.2;
      object-fit: cover;
      border-radius: 18px;
      background: #fff;
      border: 1px solid rgba(198,167,94,0.14);
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: .45rem;
      padding: .45rem .8rem;
      border-radius: 999px;
      background: rgba(198,167,94,0.12);
      color: #8a6e2f;
      font-size: .78rem;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      margin-bottom: 1rem;
    }
    h1 {
      margin: 1rem 0 .6rem;
      font-size: clamp(1.7rem, 4vw, 2.5rem);
      line-height: 1.05;
    }
    p {
      margin: 0;
      color: #5f5a52;
      line-height: 1.7;
    }
    .meta {
      margin-top: .9rem;
      color: #8b7e6b;
      font-size: .92rem;
    }
    .cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-top: 1.2rem;
      padding: .9rem 1.2rem;
      border-radius: 999px;
      background: #1f1e1c;
      color: #fff;
      text-decoration: none;
      font-weight: 700;
    }
  </style>
  <script>
    /* Redirection des humains uniquement : les robots d'aperçu (WhatsApp, Facebook)
       n'exécutent pas le JS et lisent donc les balises Open Graph ci-dessus. */
    setTimeout(function () { window.location.replace(${JSON.stringify(productUrl)}); }, 900);
  </script>
</head>
<body>
  <noscript><meta http-equiv="refresh" content="1;url=${safeProductUrl}"></noscript>
  <main class="card">
    <div class="eyebrow">Smart Cut Services</div>
    <img class="media" src="${safeImageUrl}" alt="${safeTitle}">
    <h1>${safeTitle}</h1>
    <p>${safeDescription}</p>
    ${safeSubtitle ? `<div class="meta">${safeSubtitle}</div>` : ''}
    <a class="cta" href="${safeProductUrl}">Voir le produit</a>
  </main>
</body>
</html>`;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeDeliveryZoneList(zones = []) {
  return Array.isArray(zones)
    ? zones
        .map((zone) => ({
          country: String(zone?.country || 'Haiti').trim() || 'Haiti',
          department: String(zone?.department || '').trim(),
          commune: String(zone?.commune || '').trim(),
          fee: Math.max(0, toNumber(zone?.fee)),
          deliveryDelay: String(zone?.deliveryDelay || zone?.delay || '').trim()
        }))
        .filter((zone) => zone.country && zone.department && zone.commune)
    : [];
}

function normalizeItems(items) {
  return Array.isArray(items)
    ? items.map((item) => {
        const quantity = Math.max(1, toNumber(item?.quantity) || 1);
        const price = Math.max(0, toNumber(item?.price));
        const productDeliveryZones = normalizeDeliveryZoneList(
          Array.isArray(item?.productDeliveryZones) && item.productDeliveryZones.length
            ? item.productDeliveryZones
            : item?.deliveryZones
        );
        const vendorDeliveryZones = normalizeDeliveryZoneList(
          Array.isArray(item?.vendorDeliveryZones) && item.vendorDeliveryZones.length
            ? item.vendorDeliveryZones
            : productDeliveryZones
        );
        return {
          productId: item?.productId || '',
          name: item?.name || 'Produit',
          price,
          quantity,
          sku: item?.sku || '',
          image: item?.image || '',
          selectedOptions: Array.isArray(item?.selectedOptions) ? item.selectedOptions : [],
          vendorId: item?.vendorId || '',
          vendorName: item?.vendorName || '',
          commissionRule: item?.commissionRule || null,
          sourceType: item?.sourceType || '',
          sourceCollection: item?.sourceCollection || '',
          categoryId: item?.categoryId || '',
          category: item?.category || '',
          deliveryMode: item?.deliveryMode || '',
          weightGrams: Math.max(0, toNumber(item?.weightGrams ?? item?.weight)),
          productDeliveryCoverage: item?.productDeliveryCoverage || item?.deliveryCoverage || null,
          productDeliveryZones,
          vendorDeliveryCoverage: item?.vendorDeliveryCoverage || item?.productDeliveryCoverage || item?.deliveryCoverage || null,
          vendorDeliveryZones,
          isDigitalProduct: Boolean(item?.isDigitalProduct),
          digitalDownloadLink: String(item?.digitalDownloadLink || '').trim(),
          deliveryDelay: String(item?.deliveryDelay || '').trim()
          ,autoBookingId: String(item?.autoBookingId || '').trim()
          ,autoProgramType: String(item?.autoProgramType || '').trim()
        };
      })
    : [];
}

function normalizeDeliveryModeValue(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function vendorHandlesDeliveryMode(value = '') {
  const normalized = normalizeDeliveryModeValue(value);
  if (!normalized) return false;
  return normalized.includes('vendeur') || normalized.includes('seller');
}

function smartCutHandlesDeliveryMode(value = '') {
  const normalized = normalizeDeliveryModeValue(value);
  if (!normalized) return false;
  return normalized.includes('smart cut') || normalized.includes('smartcut');
}

function sanitizeCommissionRule(rule, fallbackCategory = '') {
  if (!rule || typeof rule !== 'object') return null;
  const categoryRate = Number(rule?.categoryRate ?? rule?.rate);
  if (!Number.isFinite(categoryRate)) return null;
  return {
    ...rule,
    category: String(rule?.category || fallbackCategory || '').trim(),
    categoryRate,
    rate: Number.isFinite(Number(rule?.rate)) ? Number(rule.rate) : categoryRate
  };
}

async function enrichMarketplaceItems(items = []) {
  const normalizedItems = normalizeItems(items);
  if (!normalizedItems.length) return [];

  return Promise.all(normalizedItems.map(async (item) => {
    const itemVendorId = String(item?.vendorId || '').trim();
    const isVendorItem = itemVendorId || String(item?.sourceType || '').toLowerCase().includes('vendor');
    const productId = String(item?.productId || '').trim();

    try {
      if (!productId) {
        return {
          ...item,
          sourceCollection: isVendorItem ? 'vendorProducts' : 'products',
          sourceType: isVendorItem ? 'vendor' : (item?.sourceType || 'smartcut'),
          commissionRule: sanitizeCommissionRule(item?.commissionRule, item?.category || '')
        };
      }

      const collectionName = isVendorItem ? 'vendorProducts' : 'products';
      const productSnap = await db.collection(collectionName).doc(productId).get();
      if (!productSnap.exists) {
        return {
          ...item,
          sourceCollection: collectionName,
          sourceType: isVendorItem ? 'vendor' : 'smartcut',
          commissionRule: sanitizeCommissionRule(item?.commissionRule, item?.category || '')
        };
      }

      const productData = productSnap.data() || {};
      const selectedVariationIndex = getSelectedVariationIndex(item);
      const selectedVariation = Number.isInteger(selectedVariationIndex) && Array.isArray(productData?.variations)
        ? productData.variations[selectedVariationIndex] || null
        : null;
      const trustedPriceCandidate = selectedVariation?.price ?? productData?.price;
      const trustedPrice = Number(trustedPriceCandidate);
      const trustedStockCandidate = selectedVariation?.stock ?? productData?.stock;
      const trustedStock = Number(trustedStockCandidate);
      const resolvedCategory = String(item?.category || productData?.category || productData?.categoryName || '').trim();
      const productDeliveryCoverage = item?.productDeliveryCoverage || item?.deliveryCoverage || productData?.deliveryCoverage || productData?.productDeliveryCoverage || null;
      const productDeliveryZones = normalizeDeliveryZoneList(
        Array.isArray(item?.productDeliveryZones) && item.productDeliveryZones.length
          ? item.productDeliveryZones
          : Array.isArray(item?.deliveryZones) && item.deliveryZones.length
            ? item.deliveryZones
            : Array.isArray(productData?.deliveryZones) && productData.deliveryZones.length
              ? productData.deliveryZones
              : productData?.productDeliveryZones
      );
      return {
        ...item,
        price: Number.isFinite(trustedPrice) ? Math.max(0, trustedPrice) : 0,
        name: item?.name || productData?.name || 'Produit vendeur',
        sku: item?.sku || productData?.sku || '',
        image: item?.image || (Array.isArray(productData?.images) ? productData.images[0] || '' : ''),
        vendorId: itemVendorId || String(productData?.vendorId || '').trim(),
        vendorName: item?.vendorName || String(productData?.vendorName || productData?.shopName || '').trim(),
        commissionRule: sanitizeCommissionRule(item?.commissionRule || productData?.commissionRule, resolvedCategory),
        sourceCollection: collectionName,
        sourceType: isVendorItem ? 'vendor' : 'smartcut',
        categoryId: String(item?.categoryId || productData?.categoryId || '').trim(),
        category: resolvedCategory,
        deliveryMode: String(item?.deliveryMode || productData?.deliveryMode || '').trim(),
        weightGrams: Math.max(0, toNumber(item?.weightGrams ?? item?.weight ?? productData?.weightGrams ?? productData?.weight)),
        productDeliveryCoverage,
        productDeliveryZones,
        vendorDeliveryCoverage: item?.vendorDeliveryCoverage || productDeliveryCoverage || productData?.vendorDeliveryCoverage || null,
        vendorDeliveryZones: normalizeDeliveryZoneList(
          Array.isArray(item?.vendorDeliveryZones) && item.vendorDeliveryZones.length
            ? item.vendorDeliveryZones
            : productDeliveryZones
        ),
        isDigitalProduct: Boolean(item?.isDigitalProduct || productData?.isDigitalProduct),
        digitalDownloadLink: String(item?.digitalDownloadLink || productData?.digitalDownloadLink || '').trim(),
        deliveryDelay: String(item?.deliveryDelay || productData?.deliveryDelay || (productData?.isDigitalProduct ? 'Instantanee' : '')).trim()
        ,catalogStatus: String(productData?.status || productData?.publicationStatus || '').trim().toLowerCase()
        ,stockLimit: Number.isFinite(trustedStock) ? Math.max(0, trustedStock) : null
        ,serverValidated: true
      };
    } catch (error) {
      logger.warn('Unable to enrich vendor marketplace item', {
        productId,
        message: error?.message || ''
      });
      return {
        ...item,
        sourceCollection: isVendorItem ? 'vendorProducts' : 'products',
        sourceType: isVendorItem ? 'vendor' : 'smartcut',
        commissionRule: sanitizeCommissionRule(item?.commissionRule, item?.category || '')
      };
    }
  }));
}

async function validateAutoBookingItems(items = [], clientUid = '') {
  const bookingItems = items.filter((item) => String(item?.autoBookingId || '').trim());
  if (!bookingItems.length) return { ok: true };
  const snapshots = await Promise.all(bookingItems.map((item) => db.collection('autoGarageBookings').doc(String(item.autoBookingId).trim()).get()));
  for (let index = 0; index < bookingItems.length; index += 1) {
    const item = bookingItems[index];
    const snap = snapshots[index];
    const booking = snap.data() || {};
    if (!snap.exists || booking.customerUid !== clientUid || booking.status !== 'held' || Date.parse(booking.holdExpiresAt || '') <= Date.now()) {
      return { ok: false, error: 'garage-booking-unavailable', productId: item.productId || '' };
    }
    if (booking.offerId && booking.offerId !== item.productId) {
      return { ok: false, error: 'garage-booking-offer-mismatch', productId: item.productId || '' };
    }
  }
  return { ok: true };
}

async function validateAndAttachAutoBookings(transaction, items = [], clientUid = '', paymentSessionId = '', orderId = '') {
  const entries = [];
  for (const item of items.filter((entry) => String(entry?.autoBookingId || '').trim())) {
    const ref = db.collection('autoGarageBookings').doc(String(item.autoBookingId).trim());
    entries.push({ item, ref, snap: await transaction.get(ref) });
  }
  for (const { item, ref, snap } of entries) {
    const booking = snap.data() || {};
    if (!snap.exists || booking.customerUid !== clientUid || booking.status !== 'held' || Date.parse(booking.holdExpiresAt || '') <= Date.now()) {
      throw new Error('garage-booking-unavailable');
    }
    if ((booking.offerId && booking.offerId !== item.productId) || (booking.paymentSessionId && booking.paymentSessionId !== paymentSessionId)) {
      throw new Error('garage-booking-already-in-checkout');
    }
  }
  return entries.map(({ ref }) => ({ ref, patch: { paymentSessionId, paymentOrderId: orderId, updatedAt: new Date().toISOString() } }));
}

async function readAutoBookingsForRelease(transaction, items = [], paymentSessionId = '') {
  const entries = [];
  for (const item of items.filter((entry) => String(entry?.autoBookingId || '').trim())) {
    const ref = db.collection('autoGarageBookings').doc(String(item.autoBookingId).trim());
    const snap = await transaction.get(ref);
    if (snap.exists && snap.data()?.status === 'held' && snap.data()?.paymentSessionId === paymentSessionId) entries.push({ ref, snap });
  }
  return entries;
}

function validateServerMarketplaceItems(items = []) {
  for (const item of items) {
    if (!item?.productId || item?.serverValidated !== true) {
      return { ok: false, error: 'product-not-found', productId: item?.productId || '' };
    }
    const isVendorItem = item?.sourceType === 'vendor' || Boolean(item?.vendorId);
    if (isVendorItem && item?.catalogStatus !== 'active') {
      return { ok: false, error: 'product-not-available', productId: item.productId };
    }
    if (!Number.isFinite(Number(item?.price)) || Number(item.price) <= 0) {
      return { ok: false, error: 'invalid-product-price', productId: item.productId };
    }
    if (!isDigitalOrderItem(item) && Number.isFinite(Number(item?.stockLimit)) && Number(item.stockLimit) < Number(item.quantity || 1)) {
      return { ok: false, error: 'insufficient-stock', productId: item.productId, available: Number(item.stockLimit) };
    }
  }
  return { ok: true };
}

function getCommissionRate(rule = null) {
  const rate = Number(rule?.categoryRate ?? rule?.rate);
  return Number.isFinite(rate) ? Math.max(0, rate) : 0;
}

function buildVendorItemMetrics(item = {}) {
  const quantity = Math.max(1, Number(item?.quantity || 1));
  const unitPrice = Number(item?.price || 0);
  const productGrossAmount = unitPrice * quantity;
  const commissionRate = getCommissionRate(item?.commissionRule);
  const productCommissionAmount = productGrossAmount * (commissionRate / 100);
  const productNetAmount = Math.max(0, productGrossAmount - productCommissionAmount);

  return {
    ...item,
    quantity,
    unitPrice,
    productGrossAmount,
    grossAmount: productGrossAmount,
    commissionRate,
    productCommissionAmount,
    productNetAmount,
    commissionBaseAmount: productGrossAmount,
    commissionAmount: productCommissionAmount,
    deliveryAmount: 0,
    vendorNetAmount: productNetAmount
  };
}

function getOrderDeliveryAmount(order = {}) {
  return Math.max(0, toNumber(order?.delivery?.totalFee ?? order?.delivery?.shippingAmount));
}

function isDigitalOrderItem(item = {}) {
  return Boolean(item?.isDigitalProduct) ||
    String(item?.deliveryCoverage?.mode || item?.productDeliveryCoverage?.mode || '').toLowerCase() === 'digital' ||
    String(item?.deliveryMode || '').toLowerCase().includes('digital');
}

function findProductDeliveryZoneForAddress(item = {}, delivery = {}) {
  if (isDigitalOrderItem(item)) return null;

  const country = String(delivery?.country || 'Haiti').trim() || 'Haiti';
  const department = String(delivery?.department || '').trim();
  const commune = String(delivery?.commune || '').trim();
  const coverage = item?.productDeliveryCoverage || item?.deliveryCoverage || item?.vendorDeliveryCoverage || {};
  const coverageZones = normalizeDeliveryZoneList(coverage?.zones);
  const zones = coverageZones.length
    ? coverageZones
    : normalizeDeliveryZoneList(
        Array.isArray(item?.productDeliveryZones) && item.productDeliveryZones.length
          ? item.productDeliveryZones
          : Array.isArray(item?.deliveryZones) && item.deliveryZones.length
            ? item.deliveryZones
            : item?.vendorDeliveryZones
      );

  if (coverage?.nationwide && String(coverage?.country || 'Haiti').trim() === country) {
    return {
      country,
      department,
      commune,
      fee: Math.max(0, toNumber(coverage?.nationwideFee)),
      deliveryDelay: String(coverage?.deliveryDelay || '').trim()
    };
  }

  return zones.find((zone) => (
    String(zone.country || 'Haiti').trim() === country &&
    String(zone.department || '').trim() === department &&
    String(zone.commune || '').trim() === commune
  )) || null;
}

function findVendorDeliveryZoneForAddress(item = {}, delivery = {}) {
  if (!item?.vendorId) return null;
  return findProductDeliveryZoneForAddress(item, delivery);
}

function buildServerProductDeliveryDetails(items = [], delivery = {}) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => !isDigitalOrderItem(item))
    .map((item) => {
      const quantity = Math.max(1, toNumber(item?.quantity) || 1);
      const vendorId = String(item?.vendorId || '').trim();
      const ownerType = vendorId ? 'vendor' : 'smartcut';
      const zone = findProductDeliveryZoneForAddress(item, delivery);
      if (!zone) {
        return {
          ok: false,
          ownerType,
          vendorId,
          vendorName: vendorId ? String(item?.vendorName || '').trim() : 'Smart Cut Services',
          productId: String(item?.productId || '').trim(),
          productName: String(item?.name || 'Produit').trim(),
          quantity,
          deliveryDelay: String(item?.deliveryDelay || '').trim(),
          zone: null,
          fee: 0,
          unitFee: 0
        };
      }

      const unitFee = Math.max(0, toNumber(zone?.fee));
      return {
        ok: true,
        ownerType,
        vendorId,
        vendorName: vendorId ? String(item?.vendorName || '').trim() : 'Smart Cut Services',
        productId: String(item?.productId || '').trim(),
        productName: String(item?.name || 'Produit').trim(),
        quantity,
        deliveryDelay: String(zone?.deliveryDelay || zone?.delay || item?.deliveryDelay || '').trim(),
        zone,
        fee: unitFee * quantity,
        unitFee
      };
    });
}

function buildServerVendorDeliveryDetails(items = [], delivery = {}) {
  return buildServerProductDeliveryDetails(items, delivery)
    .filter((entry) => entry.ownerType === 'vendor');
}

function validateHomeDeliveryPayload(items = [], delivery = {}) {
  const normalizedDelivery = delivery && typeof delivery === 'object' ? { ...delivery } : {};
  normalizedDelivery.method = 'home';
  normalizedDelivery.country = String(normalizedDelivery.country || 'Haiti').trim() || 'Haiti';
  normalizedDelivery.department = String(normalizedDelivery.department || '').trim();
  normalizedDelivery.commune = String(normalizedDelivery.commune || '').trim();
  normalizedDelivery.address = String(normalizedDelivery.address || '').trim();
  normalizedDelivery.pickupPoint = null;
  normalizedDelivery.meetupZone = null;
  normalizedDelivery.meetupProposal = '';

  if (!normalizedDelivery.address || !normalizedDelivery.department || !normalizedDelivery.commune) {
    return {
      ok: false,
      error: 'missing-delivery-address',
      message: 'Adresse, departement et commune de livraison requis.'
    };
  }

  const productDetails = buildServerProductDeliveryDetails(items, normalizedDelivery);
  const unavailable = productDetails.find((entry) => !entry.ok);
  if (unavailable) {
    return {
      ok: false,
      error: 'product-delivery-unavailable',
      message: `${unavailable.productName} ne peut pas etre livre dans cette commune.`,
      unavailable
    };
  }

  const sanitizedProductDetails = productDetails.map(({ ok, ...entry }) => entry);
  const vendorDetails = sanitizedProductDetails.filter((entry) => entry.ownerType === 'vendor');
  const smartCutDetails = sanitizedProductDetails.filter((entry) => entry.ownerType === 'smartcut');
  const productDeliveryFee = productDetails.reduce((sum, entry) => sum + Math.max(0, toNumber(entry.fee)), 0);
  const vendorDeliveryFee = vendorDetails.reduce((sum, entry) => sum + Math.max(0, toNumber(entry.fee)), 0);
  const smartCutDeliveryFee = smartCutDetails.reduce((sum, entry) => sum + Math.max(0, toNumber(entry.fee)), 0);
  const weightFee = Math.max(0, toNumber(normalizedDelivery.weightFee));
  const requestedTotal = Math.max(0, toNumber(normalizedDelivery.totalFee ?? normalizedDelivery.shippingAmount));
  normalizedDelivery.productDeliveryDetails = sanitizedProductDetails;
  normalizedDelivery.vendorDeliveryDetails = vendorDetails;
  normalizedDelivery.smartCutDeliveryDetails = smartCutDetails;
  normalizedDelivery.productDeliveryFee = productDeliveryFee;
  normalizedDelivery.vendorDeliveryFee = vendorDeliveryFee;
  normalizedDelivery.smartCutDeliveryFee = smartCutDeliveryFee;
  normalizedDelivery.totalFee = Math.max(requestedTotal, productDeliveryFee + weightFee);
  normalizedDelivery.shippingAmount = normalizedDelivery.totalFee;
  return {
    ok: true,
    delivery: normalizedDelivery
  };
}

function getVendorDeliveryDetailsForOrder(order = {}, vendorUid = '', relevantItems = []) {
  const normalizedVendorId = String(vendorUid || '').trim();
  const relevantProductIds = new Set(
    (Array.isArray(relevantItems) ? relevantItems : [])
      .map((item) => String(item?.productId || '').trim())
      .filter(Boolean)
  );
  const vendorDetails = Array.isArray(order?.delivery?.vendorDeliveryDetails)
    ? order.delivery.vendorDeliveryDetails
    : [];
  const productDetails = Array.isArray(order?.delivery?.productDeliveryDetails)
    ? order.delivery.productDeliveryDetails.filter((entry) => String(entry?.ownerType || '').trim().toLowerCase() === 'vendor')
    : [];
  const details = vendorDetails.length ? vendorDetails : productDetails;

  return details.filter((entry) => (
    String(entry?.vendorId || '').trim() === normalizedVendorId ||
    (relevantProductIds.size > 0 && relevantProductIds.has(String(entry?.productId || '').trim()))
  ));
}

function getVendorDeliveryAmount(order = {}, vendorUid = '', relevantItems = []) {
  const details = getVendorDeliveryDetailsForOrder(order, vendorUid, relevantItems);
  if (details.length) {
    return details.reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.fee)), 0);
  }

  const storedVendorFee = toNumber(order?.delivery?.vendorDeliveryFee ?? order?.delivery?.vendorDeliveryAmount);
  if (storedVendorFee > 0) return storedVendorFee;

  return isVendorExclusiveOrder(order, vendorUid) ? getOrderDeliveryAmount(order) : 0;
}

function isVendorExclusiveOrder(order = {}, vendorUid = '') {
  const normalizedVendorId = String(vendorUid || '').trim();
  const items = Array.isArray(order?.items) ? order.items : [];
  if (!normalizedVendorId || !items.length) return false;

  return items.every((item) => String(item?.vendorId || '').trim() === normalizedVendorId);
}

function getRelevantVendorOrderContext(order = {}, vendorUid = '', vendorProductIds = new Set(), refPath = '') {
  let relevantItems = getRelevantVendorItems(order, vendorUid, vendorProductIds).map(buildVendorItemMetrics);
  if (!relevantItems.length) return null;

  const normalizedVendorUid = String(vendorUid || '').trim();
  const vendorFulfillment = order?.vendorFulfillments && typeof order.vendorFulfillments === 'object'
    ? order.vendorFulfillments[normalizedVendorUid] || null
    : null;
  const deliveryModes = relevantItems.map((item) => String(item?.deliveryMode || '').trim()).filter(Boolean);
  const hasVendorItems = relevantItems.some((item) => String(item?.vendorId || '').trim() === normalizedVendorUid);
  const vendorManagedDelivery =
    (hasVendorItems || deliveryModes.some((mode) => vendorHandlesDeliveryMode(mode))) &&
    !deliveryModes.some((mode) => smartCutHandlesDeliveryMode(mode));
  const vendorDeliveryDetails = vendorManagedDelivery
    ? getVendorDeliveryDetailsForOrder(order, vendorUid, relevantItems)
    : [];
  const deliveryAmount = vendorManagedDelivery
    ? getVendorDeliveryAmount(order, vendorUid, relevantItems)
    : 0;
  const deliveryMatches = relevantItems.map((item) => {
    const itemProductId = String(item?.productId || '').trim();
    const itemName = String(item?.name || 'Produit').trim();
    return vendorManagedDelivery
      ? vendorDeliveryDetails.find((entry) => (
          (itemProductId && String(entry?.productId || '').trim() === itemProductId) ||
          String(entry?.productName || '').trim() === itemName
        ))
      : null;
  });
  const knownDeliveryAmount = deliveryMatches.reduce((sum, entry) => {
    return sum + Math.max(0, toNumber(entry?.fee));
  }, 0);
  const unresolvedDeliveryItems = relevantItems.filter((item, index) => !deliveryMatches[index]);
  const unresolvedDeliveryGross = unresolvedDeliveryItems.reduce((sum, item) => {
    return sum + Math.max(0, toNumber(item.productGrossAmount));
  }, 0);
  const remainingDeliveryAmount = Math.max(0, deliveryAmount - knownDeliveryAmount);
  relevantItems = relevantItems.map((item, index) => {
    const matchingDelivery = deliveryMatches[index];
    const fallbackDeliveryShare = vendorManagedDelivery && !matchingDelivery && remainingDeliveryAmount > 0
      ? (unresolvedDeliveryGross > 0
          ? remainingDeliveryAmount * (Math.max(0, toNumber(item.productGrossAmount)) / unresolvedDeliveryGross)
          : remainingDeliveryAmount / Math.max(1, unresolvedDeliveryItems.length))
      : 0;
    const itemDeliveryAmount = Math.max(0, toNumber(matchingDelivery?.fee) || fallbackDeliveryShare);
    const productGross = Math.max(0, toNumber(item.productGrossAmount));
    const commissionBaseAmount = productGross;
    const commissionAmount = commissionBaseAmount * (Number(item.commissionRate || 0) / 100);
    return {
      ...item,
      deliveryAmount: itemDeliveryAmount,
      commissionBaseAmount,
      grossAmount: productGross + itemDeliveryAmount,
      commissionAmount,
      vendorNetAmount: Math.max(0, productGross - commissionAmount + itemDeliveryAmount)
    };
  });
  const productGrossAmount = relevantItems.reduce((sum, item) => sum + item.productGrossAmount, 0);
  const commissionAmount = relevantItems.reduce((sum, item) => sum + item.commissionAmount, 0);
  const productNetAmount = relevantItems.reduce((sum, item) => sum + item.productNetAmount, 0);
  const grossAmount = productGrossAmount + deliveryAmount;
  const vendorNetAmount = Math.max(0, productGrossAmount - commissionAmount + deliveryAmount);
  const vendorDelivery = vendorManagedDelivery && order?.delivery && typeof order.delivery === 'object'
    ? {
        ...order.delivery,
        vendorDeliveryDetails,
        totalFee: deliveryAmount,
        shippingAmount: deliveryAmount,
        vendorDeliveryFee: deliveryAmount,
        pickupPoint: null,
        meetupZone: null,
        meetupProposal: ''
      }
    : null;

  return {
    refPath,
    orderId: String(order?.id || '').trim(),
    uniqueCode: String(order?.uniqueCode || order?.id || '').trim(),
    status: normalizeOrderStatus(order),
    fulfillmentStatus: String(vendorFulfillment?.status || order?.fulfillmentStatus || 'ordered').trim(),
    vendorFulfillment: vendorFulfillment || null,
    paymentStatus: String(order?.paymentStatus || order?.status || '').trim(),
    createdAt: order?.createdAt || '',
    updatedAt: order?.updatedAt || '',
    paidAt: order?.paidAt || '',
    vendorManagedDelivery,
    deliveryModeLabel: deliveryModes[0] || '',
    items: relevantItems,
    productGrossAmount,
    deliveryAmount,
    grossAmount,
    commissionAmount,
    productNetAmount,
    vendorNetAmount,
    itemCount: relevantItems.reduce((sum, item) => sum + item.quantity, 0),
    customer: vendorManagedDelivery
      ? {
          name: String(order?.customerName || '').trim(),
          email: String(order?.customerEmail || '').trim(),
          phone: String(order?.customerPhone || '').trim(),
          address: String(order?.customerAddress || '').trim(),
          city: String(order?.customerCity || '').trim()
        }
      : {
          name: '',
          email: '',
          phone: '',
          address: '',
          city: ''
        },
    delivery: vendorDelivery
  };
}

function buildVendorOrderNotifications(order = {}, sessionId = '') {
  const items = Array.isArray(order?.items) ? order.items : [];
  const grouped = new Map();

  items.forEach((item) => {
    const vendorId = String(item?.vendorId || '').trim();
    if (!vendorId) return;

    const current = grouped.get(vendorId) || {
      vendorId,
      vendorName: String(item?.vendorName || '').trim(),
      itemCount: 0
    };

    current.itemCount += Math.max(1, Number(item?.quantity || 1));
    if (!current.vendorName && item?.vendorName) {
      current.vendorName = String(item.vendorName).trim();
    }

    grouped.set(vendorId, current);
  });

  const dashboardUrl = new URL('/DvendorProducts.html', `${SITE_BASE_URL}/`).toString();

  return Array.from(grouped.values()).map((entry) => {
    const itemLabel = entry.itemCount > 1 ? `${entry.itemCount} articles` : '1 article';
    const uniqueCode = String(order?.uniqueCode || order?.id || '').trim();
    return {
      id: `vendor-order-${String(sessionId || order?.paymentSessionId || order?.id || entry.vendorId).trim()}-${entry.vendorId}`,
      title: 'Nouvelle commande vendeur',
      body: uniqueCode
        ? `La commande ${uniqueCode} contient ${itemLabel} pour votre boutique.`
        : `Une nouvelle commande contient ${itemLabel} pour votre boutique.`,
      type: 'vendor-order',
      target: 'user',
      targetUid: entry.vendorId,
      url: dashboardUrl,
      createdBy: 'payment_system',
      createdAt: new Date().toISOString()
    };
  });
}

function isSmartCutOrderItem(item = {}) {
  const vendorId = String(item?.vendorId || '').trim();
  const ownerType = String(item?.ownerType || '').trim().toLowerCase();
  const sourceType = String(item?.sourceType || '').trim().toLowerCase();
  if (vendorId || ownerType === 'vendor' || sourceType === 'vendor') return false;
  return true;
}

function buildSmartCutOrderNotification(order = {}, sessionId = '') {
  const items = Array.isArray(order?.items) ? order.items : [];
  const smartCutItemCount = items
    .filter(isSmartCutOrderItem)
    .reduce((sum, item) => sum + Math.max(1, Number(item?.quantity || 1)), 0);

  if (!smartCutItemCount) return null;

  const itemLabel = smartCutItemCount > 1 ? `${smartCutItemCount} articles` : '1 article';
  const uniqueCode = String(order?.uniqueCode || order?.id || '').trim();
  const orderKey = String(sessionId || order?.paymentSessionId || order?.id || uniqueCode || Date.now()).trim();
  const dashboardUrl = new URL('/dashboard-orders.html', 'https://smartcutservices.github.io/dashboard-/').toString();

  return {
    id: `smartcut-order-${orderKey}`,
    title: 'Nouvelle commande Smart Cut',
    body: uniqueCode
      ? `La commande ${uniqueCode} contient ${itemLabel} Smart Cut.`
      : `Une nouvelle commande contient ${itemLabel} Smart Cut.`,
    type: 'smartcut-order',
    target: 'admin',
    targetUid: null,
    url: dashboardUrl,
    createdBy: 'payment_system',
    createdAt: new Date().toISOString()
  };
}

function createPayoutReportNumber(seed = '') {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const suffix = createUniqueCode(seed).replace('SCS-', '');
  return `DEC-${y}${m}${d}-${suffix}`;
}

const VENDOR_PAYOUT_REQUEST_COOLDOWN_DAYS = 30;

function buildVendorPayoutProfile(profile = {}) {
  const fullName = String(
    profile?.applicantName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ') ||
    profile?.displayName ||
    profile?.name ||
    ''
  ).trim();

  return {
    vendorName: String(profile?.vendorName || profile?.shopName || 'Vendeur').trim(),
    shopName: String(profile?.shopName || profile?.vendorName || '').trim(),
    fullName,
    firstName: String(profile?.firstName || '').trim(),
    lastName: String(profile?.lastName || '').trim(),
    gender: String(profile?.gender || profile?.sexe || '').trim(),
    phone: String(profile?.phone || profile?.telephone || '').trim(),
    address: String(profile?.address || '').trim(),
    city: String(profile?.city || '').trim(),
    email: String(profile?.email || '').trim()
  };
}

function normalizePayoutStatus(status = '') {
  return String(status || '').trim().toLowerCase();
}

function isPaidVendorPayout(payout = {}) {
  return normalizePayoutStatus(payout?.status) === 'paid';
}

function isOpenVendorPayoutRequest(payout = {}) {
  return ['requested', 'pending', 'approved'].includes(normalizePayoutStatus(payout?.status));
}

function getVendorPayoutEventMs(payout = {}) {
  return toDateMs(
    payout?.paidAt ||
    payout?.requestedAt ||
    payout?.reviewedAt ||
    payout?.updatedAt ||
    payout?.createdAt
  );
}

function getPayoutPeriodBounds(orders = []) {
  const validMs = orders
    .map((order) => toDateMs(order?.createdAt))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);

  if (!validMs.length) {
    return { periodStart: '', periodEnd: '' };
  }

  return {
    periodStart: new Date(validMs[0]).toISOString(),
    periodEnd: new Date(validMs[validMs.length - 1]).toISOString()
  };
}

function mapVendorPayoutSummary(id, payout = {}) {
  return {
    id,
    reportNumber: String(payout?.reportNumber || '').trim(),
    status: normalizePayoutStatus(payout?.status),
    productGrossAmount: Math.max(0, toNumber(payout?.productGrossAmount)),
    deliveryAmount: Math.max(0, toNumber(payout?.deliveryAmount)),
    grossAmount: Math.max(0, toNumber(payout?.grossAmount)),
    commissionAmount: Math.max(0, toNumber(payout?.commissionAmount)),
    netAmount: Math.max(0, toNumber(payout?.netAmount)),
    orderCount: Math.max(0, toNumber(payout?.orderCount)),
    itemCount: Math.max(0, toNumber(payout?.itemCount)),
    requestedAt: payout?.requestedAt || '',
    reviewedAt: payout?.reviewedAt || '',
    paidAt: payout?.paidAt || '',
    createdAt: payout?.createdAt || '',
    updatedAt: payout?.updatedAt || '',
    periodStart: payout?.periodStart || '',
    periodEnd: payout?.periodEnd || '',
    vendorId: String(payout?.vendorId || '').trim(),
    vendorName: String(payout?.vendorName || '').trim(),
    shopName: String(payout?.shopName || '').trim(),
    fullName: String(payout?.fullName || '').trim(),
    firstName: String(payout?.firstName || '').trim(),
    lastName: String(payout?.lastName || '').trim(),
    gender: String(payout?.gender || '').trim(),
    phone: String(payout?.phone || '').trim(),
    address: String(payout?.address || '').trim(),
    email: String(payout?.email || '').trim(),
    coveredOrderIds: Array.isArray(payout?.coveredOrderIds) ? payout.coveredOrderIds : [],
    coveredOrderRefs: Array.isArray(payout?.coveredOrderRefs) ? payout.coveredOrderRefs : [],
    coveredVendorRefs: Array.isArray(payout?.coveredVendorRefs) ? payout.coveredVendorRefs : []
  };
}

function createVendorCoveredRef(refPath = '', vendorId = '') {
  const normalizedPath = String(refPath || '').trim();
  const normalizedVendorId = String(vendorId || '').trim();
  if (!normalizedPath) return '';
  if (!normalizedVendorId) return normalizedPath;
  return `${normalizedPath}::${normalizedVendorId}`;
}

function buildVendorPayoutDateRange(body = {}) {
  const dateFromMs = toDateMs(body?.dateFrom || body?.fromDate || '');
  const dateToMs = toDateMs(body?.dateTo || body?.toDate || '');
  return {
    dateFromMs,
    dateToMs
  };
}

function isWithinVendorPayoutRange(createdAtMs, dateFromMs, dateToMs) {
  if (dateFromMs > 0 && createdAtMs < dateFromMs) return false;
  if (dateToMs > 0 && createdAtMs > dateToMs) return false;
  return true;
}

function collectVendorOutstandingOrders({ ordersSnap, vendorId, vendorProductIds, settledVendorRefs, dateFromMs = 0, dateToMs = 0 }) {
  const outstandingOrders = [];
  let productGrossAmount = 0;
  let deliveryAmount = 0;
  let grossAmount = 0;
  let commissionAmount = 0;
  let netAmount = 0;
  let itemCount = 0;

  ordersSnap.docs.forEach((snap) => {
    const order = { id: snap.id, ...(snap.data() || {}) };
    const vendorRef = createVendorCoveredRef(snap.ref.path, vendorId);
    if (!isConfirmedOrder(order) || settledVendorRefs.has(vendorRef) || settledVendorRefs.has(snap.ref.path)) return;

    const context = getRelevantVendorOrderContext(order, vendorId, vendorProductIds, snap.ref.path);
    if (!context) return;

    const createdAtMs = toDateMs(context.paidAt || context.updatedAt || context.createdAt);
    if (!isWithinVendorPayoutRange(createdAtMs, dateFromMs, dateToMs)) return;

    productGrossAmount += context.productGrossAmount;
    deliveryAmount += context.deliveryAmount;
    grossAmount += context.grossAmount;
    commissionAmount += context.commissionAmount;
    netAmount += context.vendorNetAmount;
    itemCount += context.itemCount;

    outstandingOrders.push({
      refPath: snap.ref.path,
      vendorRef,
      orderId: snap.id,
      uniqueCode: context.uniqueCode,
      createdAt: context.paidAt || context.updatedAt || context.createdAt || '',
      productGrossAmount: context.productGrossAmount,
      deliveryAmount: context.deliveryAmount,
      grossAmount: context.grossAmount,
      commissionAmount: context.commissionAmount,
      netAmount: context.vendorNetAmount,
      itemCount: context.itemCount
    });
  });

  return {
    outstandingOrders,
    productGrossAmount,
    deliveryAmount,
    grossAmount,
    commissionAmount,
    netAmount,
    itemCount,
    ...getPayoutPeriodBounds(outstandingOrders)
  };
}

function buildOrderTotals(items, delivery) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shippingAmount = Math.max(0, toNumber(delivery?.totalFee || delivery?.shippingAmount));
  const weightFee = Math.max(0, toNumber(delivery?.weightFee));
  return {
    subtotal,
    shippingAmount,
    weightFee,
    total: subtotal + shippingAmount
  };
}

function normalizePromoCode(value = '') {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function normalizePromoLookupValue(value = '') {
  return normalizePromoCode(value).replace(/[^A-Z0-9]/g, '');
}

function normalizeCategoryToken(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '');
}

function buildPromoUsageId(promoId = '', clientKey = '') {
  return `${String(promoId || '').trim()}__${String(clientKey || '').trim()}`.replace(/[^A-Za-z0-9_-]/g, '_');
}

function isAffiliatePromoCode(promo = {}) {
  return Boolean(
    promo?.affiliateEnabled === true ||
    promo?.affiliateMemberId ||
    promo?.affiliateMemberName ||
    promo?.affiliatePhone
  );
}

function normalizeAffiliateMemberId(value = '') {
  return sanitizeText(value, 80).toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9_-]/g, '');
}

function normalizeAffiliateMemberStatus(value = '') {
  return String(value || '').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active';
}

function normalizeAffiliateSex(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['m', 'male', 'masculin', 'homme'].includes(normalized)) return 'Masculin';
  if (['f', 'female', 'feminin', 'feminin', 'femme'].includes(normalized)) return 'Feminin';
  if (['other', 'autre'].includes(normalized)) return 'Autre';
  return sanitizeText(value, 32);
}

function buildAffiliateMemberDocId(promoCode = '') {
  return normalizePromoCode(promoCode);
}

function buildAffiliateEarningId(promoUsageId = '') {
  return String(promoUsageId || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
}

function createAffiliatePayoutReportNumber(seed = '') {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const suffix = createUniqueCode(seed).replace('SCS-', '');
  return `AFF-${y}${m}${d}-${suffix}`;
}

function buildAffiliateMemberSnapshot(member = {}) {
  const firstName = String(member?.firstName || '').trim();
  const lastName = String(member?.lastName || '').trim();
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  return {
    memberId: String(member?.memberId || '').trim(),
    firstName,
    lastName,
    fullName: fullName || String(member?.fullName || '').trim() || 'Membre affiliation',
    sex: String(member?.sex || '').trim(),
    phone: String(member?.phone || '').trim(),
    promoCode: String(member?.promoCode || '').trim(),
    status: normalizeAffiliateMemberStatus(member?.status)
  };
}

function normalizeAffiliatePayoutStatus(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['paid', 'completed', 'complete'].includes(normalized)) return 'paid';
  return 'paid';
}

function getAffiliatePayoutEventMs(payout = {}) {
  return toDateMs(
    payout?.paidAt ||
    payout?.updatedAt ||
    payout?.createdAt
  );
}

function mapAffiliatePayoutSummary(id, payout = {}) {
  return {
    id,
    reportNumber: String(payout?.reportNumber || '').trim(),
    status: normalizeAffiliatePayoutStatus(payout?.status),
    promoCode: String(payout?.promoCode || '').trim(),
    memberId: String(payout?.memberId || '').trim(),
    firstName: String(payout?.firstName || '').trim(),
    lastName: String(payout?.lastName || '').trim(),
    fullName: String(payout?.fullName || '').trim(),
    sex: String(payout?.sex || '').trim(),
    phone: String(payout?.phone || '').trim(),
    affiliateRate: Math.max(0, toNumber(payout?.affiliateRate)),
    ratesUsed: Array.isArray(payout?.ratesUsed) ? payout.ratesUsed.map((value) => Math.max(0, toNumber(value))).filter((value) => value > 0) : [],
    eligibleSubtotalAmount: Math.max(0, toNumber(payout?.eligibleSubtotalAmount)),
    discountAmount: Math.max(0, toNumber(payout?.discountAmount)),
    amount: Math.max(0, toNumber(payout?.amount ?? payout?.netAmount)),
    usageCount: Math.max(0, toNumber(payout?.usageCount)),
    periodStart: String(payout?.periodStart || '').trim(),
    periodEnd: String(payout?.periodEnd || '').trim(),
    paidAt: String(payout?.paidAt || '').trim(),
    createdAt: String(payout?.createdAt || '').trim(),
    updatedAt: String(payout?.updatedAt || '').trim(),
    orderIds: Array.isArray(payout?.orderIds) ? payout.orderIds.map((value) => String(value || '').trim()).filter(Boolean) : [],
    earningIds: Array.isArray(payout?.earningIds) ? payout.earningIds.map((value) => String(value || '').trim()).filter(Boolean) : [],
    paidBy: String(payout?.paidBy || '').trim()
  };
}

async function resolvePromoCategoryNames(categoryIds = []) {
  const uniqueIds = Array.from(new Set((Array.isArray(categoryIds) ? categoryIds : []).map((value) => String(value || '').trim()).filter(Boolean)));
  if (!uniqueIds.length) return [];

  const docs = await Promise.all(
    uniqueIds.map(async (categoryId) => {
      try {
        const snap = await db.collection('categories_list').doc(categoryId).get();
        if (!snap.exists) return '';
        return String(snap.data()?.name || '').trim();
      } catch (_) {
        return '';
      }
    })
  );

  return Array.from(new Set(docs.filter(Boolean)));
}

function isPromoActive(promo = {}, now = Date.now()) {
  if (promo?.active === false) return false;
  const startAt = toDateMs(promo?.startAt || promo?.startsAt || promo?.validFrom || '');
  const endAt = toDateMs(promo?.endAt || promo?.endsAt || promo?.validUntil || '');
  if (startAt && now < startAt) return false;
  if (endAt && now > endAt) return false;
  return true;
}

function normalizePromoType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['amount', 'fixed', 'montant'].includes(normalized)) return 'amount';
  if (['fixed_price', 'prix', 'price'].includes(normalized)) return 'fixed_price';
  return 'percentage';
}

function isSmartCutCartItem(item = {}) {
  const sourceCollection = String(item?.sourceCollection || '').trim().toLowerCase();
  const sourceType = String(item?.sourceType || '').trim().toLowerCase();
  const vendorId = String(item?.vendorId || '').trim();
  return !vendorId && sourceCollection !== 'vendorproducts' && !sourceType.includes('vendor');
}

function getPromoEligibleItems(items = [], promo = {}) {
  const allowedCategoryIds = Array.isArray(promo?.categoryIds)
    ? promo.categoryIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const allowedCategoryNames = Array.isArray(promo?.categoryNames)
    ? promo.categoryNames.map((value) => normalizeCategoryToken(value)).filter(Boolean)
    : [];

  return items.filter((item) => {
    if (!isSmartCutCartItem(item)) return false;
    if (!allowedCategoryIds.length && !allowedCategoryNames.length) return true;
    const itemCategoryId = String(item?.categoryId || '').trim();
    const itemCategoryName = normalizeCategoryToken(item?.category || item?.categoryName || '');
    if (Boolean(itemCategoryId) && allowedCategoryIds.includes(itemCategoryId)) return true;
    if (itemCategoryName && allowedCategoryNames.includes(itemCategoryName)) return true;
    return false;
  });
}

function calculatePromoDiscount(promo = {}, eligibleSubtotal = 0) {
  const subtotal = Math.max(0, toNumber(eligibleSubtotal));
  const value = Math.max(0, toNumber(promo?.value ?? promo?.amount ?? promo?.rate));
  const type = normalizePromoType(promo?.type);
  if (subtotal <= 0 || value <= 0) return 0;

  if (type === 'amount') {
    return Math.min(subtotal, value);
  }

  if (type === 'fixed_price') {
    return Math.max(0, Math.min(subtotal, subtotal - value));
  }

  return Math.min(subtotal, subtotal * (Math.min(value, 100) / 100));
}

async function findPromoByCode(code = '') {
  const normalizedCode = normalizePromoCode(code);
  if (!normalizedCode) return null;
  const normalizedLookup = normalizePromoLookupValue(code);

  const directSnap = await db.collection('promoCodes').doc(normalizedCode).get();
  if (directSnap.exists) {
    return { id: directSnap.id, ref: directSnap.ref, data: directSnap.data() || {} };
  }

  const snap = await db
    .collection('promoCodes')
    .where('code', '==', normalizedCode)
    .limit(1)
    .get();

  if (!snap.empty) {
    const docSnap = snap.docs[0];
    return { id: docSnap.id, ref: docSnap.ref, data: docSnap.data() || {} };
  }

  const fallbackSnap = await db.collection('promoCodes').get();
  const fallbackDoc = fallbackSnap.docs.find((docSnap) => {
    const data = docSnap.data() || {};
    return (
      normalizePromoLookupValue(docSnap.id) === normalizedLookup ||
      normalizePromoLookupValue(data.code || '') === normalizedLookup
    );
  });

  if (!fallbackDoc) return null;
  return { id: fallbackDoc.id, ref: fallbackDoc.ref, data: fallbackDoc.data() || {} };
}

async function previewPromoForCart({ code = '', clientId = '', clientUid = '', items = [] } = {}) {
  const normalizedCode = normalizePromoCode(code);
  logger.info('PROMO_DEBUG preview:start', {
    code,
    normalizedCode,
    clientId: String(clientId || '').trim(),
    clientUid: String(clientUid || '').trim(),
    itemCount: Array.isArray(items) ? items.length : 0,
    items: (Array.isArray(items) ? items : []).map((item) => ({
      productId: String(item?.productId || '').trim(),
      name: String(item?.name || '').trim(),
      categoryId: String(item?.categoryId || '').trim(),
      category: String(item?.category || '').trim(),
      sourceType: String(item?.sourceType || '').trim(),
      sourceCollection: String(item?.sourceCollection || '').trim(),
      vendorId: String(item?.vendorId || '').trim(),
      quantity: Math.max(1, toNumber(item?.quantity) || 1),
      price: Math.max(0, toNumber(item?.price))
    }))
  });
  if (!normalizedCode) {
    logger.warn('PROMO_DEBUG preview:missing-code');
    throw new Error('Veuillez saisir un code promo.');
  }

  const promoRecord = await findPromoByCode(normalizedCode);
  if (!promoRecord) {
    logger.warn('PROMO_DEBUG preview:not-found', { normalizedCode });
    throw new Error('Code promo invalide.');
  }

  const promo = promoRecord.data || {};
  logger.info('PROMO_DEBUG preview:promo-found', {
    promoId: promoRecord.id,
    promoCode: String(promo?.code || '').trim(),
    promoActive: promo?.active !== false,
    categoryIds: Array.isArray(promo?.categoryIds) ? promo.categoryIds : [],
    startAt: promo?.startAt || '',
    endAt: promo?.endAt || ''
  });
  if (!isPromoActive(promo)) {
    logger.warn('PROMO_DEBUG preview:inactive', {
      promoId: promoRecord.id,
      startAt: promo?.startAt || '',
      endAt: promo?.endAt || '',
      now: new Date().toISOString()
    });
    throw new Error('Ce code promo n est pas actif pour le moment.');
  }

  const clientKey = String(clientUid || clientId || '').trim();
  if (!clientKey) {
    logger.warn('PROMO_DEBUG preview:missing-client-key');
    throw new Error('Client manquant pour verifier ce code promo.');
  }

  const affiliatePromo = isAffiliatePromoCode(promo);
  const usageRef = db.collection('promoCodeUsages').doc(buildPromoUsageId(promoRecord.id, clientKey));
  const usageSnap = await usageRef.get();
  if (usageSnap.exists && !affiliatePromo) {
    logger.warn('PROMO_DEBUG preview:already-used', {
      promoId: promoRecord.id,
      clientKey
    });
    throw new Error('Ce code promo a deja ete utilise avec ce compte.');
  }

  const eligibleItems = getPromoEligibleItems(items, promo);
  const eligibleSubtotal = eligibleItems.reduce((sum, item) => sum + (toNumber(item?.price) * Math.max(1, toNumber(item?.quantity) || 1)), 0);
  logger.info('PROMO_DEBUG preview:eligibility', {
    promoId: promoRecord.id,
    allowedCategoryIds: Array.isArray(promo?.categoryIds) ? promo.categoryIds : [],
    eligibleItemCount: eligibleItems.length,
    eligibleSubtotal,
    eligibleItems: eligibleItems.map((item) => ({
      productId: String(item?.productId || '').trim(),
      name: String(item?.name || '').trim(),
      categoryId: String(item?.categoryId || '').trim(),
      vendorId: String(item?.vendorId || '').trim(),
      sourceType: String(item?.sourceType || '').trim(),
      sourceCollection: String(item?.sourceCollection || '').trim()
    }))
  });
  if (eligibleSubtotal <= 0) {
    logger.warn('PROMO_DEBUG preview:no-eligible-items', {
      promoId: promoRecord.id,
      allowedCategoryIds: Array.isArray(promo?.categoryIds) ? promo.categoryIds : []
    });
    throw new Error('Ce code promo ne s applique a aucun produit Smart Cut valide dans votre panier.');
  }

  const discountAmount = calculatePromoDiscount(promo, eligibleSubtotal);
  if (discountAmount <= 0) {
    logger.warn('PROMO_DEBUG preview:zero-discount', {
      promoId: promoRecord.id,
      eligibleSubtotal,
      type: normalizePromoType(promo?.type),
      value: Math.max(0, toNumber(promo?.value ?? promo?.amount ?? promo?.rate))
    });
    throw new Error('Ce code promo ne peut pas etre applique a ce panier.');
  }

  logger.info('PROMO_DEBUG preview:success', {
    promoId: promoRecord.id,
    normalizedCode,
    eligibleSubtotal,
    discountAmount
  });
  return {
    promoId: promoRecord.id,
    code: normalizedCode,
    label: String(promo?.label || promo?.name || 'Code promo').trim(),
    type: normalizePromoType(promo?.type),
    value: Math.max(0, toNumber(promo?.value ?? promo?.amount ?? promo?.rate)),
    categoryIds: Array.isArray(promo?.categoryIds) ? promo.categoryIds.map((value) => String(value || '').trim()).filter(Boolean) : [],
    affiliateEnabled: affiliatePromo,
    affiliateMemberId: String(promo?.affiliateMemberId || '').trim(),
    affiliateMemberName: String(promo?.affiliateMemberName || '').trim(),
    affiliatePhone: String(promo?.affiliatePhone || '').trim(),
    eligibleSubtotal,
    discountAmount: Math.min(eligibleSubtotal, discountAmount),
    discountedSubtotal: Math.max(0, eligibleSubtotal - discountAmount),
    clientKey
  };
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const raw = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString('utf-8')
    : typeof req.body === 'string'
      ? req.body
      : '';

  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (_) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
}

function createSessionId() {
  return db.collection('paymentSessions').doc().id;
}

function createUniqueCode(seed = '') {
  const normalized = String(seed || '').replace(/[^A-Za-z0-9]/g, '');
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) % 100000000;
  }

  if (!hash) {
    hash = Math.floor(Math.random() * 100000000);
  }

  return `SCS-${String(hash).padStart(8, '0')}`;
}

function safeSecretValue(secretParam) {
  try {
    return String(secretParam.value() || '').trim();
  } catch (_) {
    return '';
  }
}

function getJwetproIntegrationSecret() {
  const secret = safeSecretValue(JWETPRO_INTEGRATION_SECRET);
  if (!secret) throw new Error('JWETPRO_INTEGRATION_SECRET is not configured');
  return secret;
}

function buildJwetproSignedHeaders(body, eventId = crypto.randomUUID()) {
  const timestamp = Date.now();
  return {
    'Content-Type': 'application/json',
    'X-Jwetpro-Timestamp': String(timestamp),
    'X-Jwetpro-Event-Id': eventId,
    'X-Jwetpro-Signature': signJwetproPayload(getJwetproIntegrationSecret(), {
      timestamp,
      eventId,
      body
    })
  };
}

function requireJwetproSignature(req, body) {
  return verifyJwetproSignedRequest(getJwetproIntegrationSecret(), req.headers || {}, body);
}

async function getJwetproSettings() {
  const snapshot = await db.collection(JWETPRO_SETTINGS_COLLECTION).doc(JWETPRO_SETTINGS_DOC).get();
  const data = snapshot.exists ? snapshot.data() || {} : {};
  return {
    enabled: data.enabled === true,
    globalCommissionRate: normalizeJwetproRate(data.globalCommissionRate, DEFAULT_JWETPRO_COMMISSION_RATE),
    specialRates: data.specialRates && typeof data.specialRates === 'object' ? data.specialRates : {}
  };
}

async function notifyJwetproPayment(orderRef, orderData, details, source) {
  const current = (await orderRef.get()).data() || orderData || {};
  if (current.jwetproCallbackStatus === 'confirmed') return { ok: true, repeated: true };
  const callbackBody = {
    eventType: 'ticket.payment.confirmed',
    intentId: String(current.intentId || orderRef.id),
    reservationId: String(current.reservationId || ''),
    championshipId: String(current.championshipId || ''),
    playerUid: String(current.playerUid || ''),
    playerEmail: String(current.playerEmail || ''),
    amount: Number(current.grossAmount || current.amount || 0),
    currency: String(current.currency || MONCASH_CURRENCY),
    smartCutOrderId: orderRef.id,
    transactionId: String(details?.transactionId || current.providerTransactionId || ''),
    confirmedAt: new Date().toISOString()
  };
  const eventId = `ticket-payment-${orderRef.id}`;
  try {
    const response = await fetch(JWETPRO_CONFIRM_PAYMENT_URL, {
      method: 'POST',
      headers: buildJwetproSignedHeaders(callbackBody, eventId),
      body: JSON.stringify(callbackBody)
    });
    const responseText = await response.text();
    if (!response.ok) throw new Error(`JwetPro webhook HTTP ${response.status}: ${responseText.slice(0, 300)}`);
    const callbackResult = (() => { try { return JSON.parse(responseText); } catch (_) { return {}; } })();
    await orderRef.set({
      jwetproCallbackStatus: 'confirmed',
      jwetproCallbackAt: new Date().toISOString(),
      jwetproCallbackSource: source || '',
      jwetproCallbackError: '',
      jwetproRegistrationStatus: sanitizeText(callbackResult.status, 40),
      ...(callbackResult.status === 'credited' ? { payoutStatus: 'credit_pending', creditStatus: 'available' } : {})
    }, { merge: true });
    return { ok: true, status: callbackResult.status || 'paid' };
  } catch (error) {
    await orderRef.set({
      jwetproCallbackStatus: 'failed',
      jwetproCallbackError: String(error?.message || error).slice(0, 500),
      jwetproCallbackAttemptedAt: new Date().toISOString()
    }, { merge: true });
    logger.error('JWETPRO payment callback failed', { orderId: orderRef.id, message: error?.message || '' });
    return { ok: false, error: error?.message || 'callback-failed' };
  }
}

function buildBasicAuthHeader(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();

  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch (_) {
    payload = { raw: rawText };
  }

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function buildMoncashPublicKey() {
  const rawKey = safeSecretValue(MONCASH_SECRET_API_KEY).replace(/\\n/g, '\n').trim();
  if (!rawKey) {
    throw new Error('MonCash secret API key is not configured');
  }

  const compactBody = rawKey.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s+/g, '');
  const pemBody = compactBody.match(/.{1,64}/g)?.join('\n') || compactBody;
  const candidates = rawKey.includes('BEGIN')
    ? [rawKey]
    : [
        `-----BEGIN PUBLIC KEY-----\n${pemBody}\n-----END PUBLIC KEY-----`,
        `-----BEGIN RSA PUBLIC KEY-----\n${pemBody}\n-----END RSA PUBLIC KEY-----`
      ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      return crypto.createPublicKey(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Unable to parse MonCash secret API key');
}

function encryptMoncashMiddlewareValue(value) {
  const publicKey = buildMoncashPublicKey();
  const keySizeBytes = Math.ceil(Number(publicKey.asymmetricKeyDetails?.modulusLength || 2048) / 8);
  const valueBuffer = Buffer.from(String(value || ''), 'utf8');

  if (valueBuffer.length > keySizeBytes) {
    throw new Error('MonCash encrypted value is too long for the configured key');
  }

  const padded = Buffer.alloc(keySizeBytes);
  valueBuffer.copy(padded, keySizeBytes - valueBuffer.length);

  return crypto.publicEncrypt({
    key: publicKey,
    padding: crypto.constants.RSA_NO_PADDING
  }, padded).toString('base64');
}

async function getMoncashAccessToken() {
  if (tokenCache.accessToken && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }

  const clientId = safeSecretValue(MONCASH_CLIENT_ID);
  const clientSecret = safeSecretValue(MONCASH_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    throw new Error('MonCash credentials are not configured');
  }

  const authBody = 'scope=read,write&grant_type=client_credentials';
  let payload;

  try {
    payload = await fetchJson(`${MONCASH_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: buildBasicAuthHeader(clientId, clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: authBody
    });
  } catch (error) {
    const status = Number(error?.status || 0);
    if (status !== 401 && status !== 403) {
      throw error;
    }

    logger.warn('MonCash OAuth with Authorization header failed, retrying with form credentials', {
      status,
      message: error?.message || ''
    });

    payload = await fetchJson(`${MONCASH_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        scope: 'read,write',
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      }).toString()
    });
  }

  const accessToken = String(payload?.access_token || '').trim();
  if (!accessToken) {
    throw new Error('Unable to obtain MonCash access token');
  }

  const expiresIn = Math.max(10, toNumber(payload?.expires_in) || 60);
  tokenCache = {
    accessToken,
    expiresAt: Date.now() + Math.max(5, expiresIn - 5) * 1000
  };

  return accessToken;
}

async function createMoncashApiRedirect(orderId, amount) {
  const accessToken = await getMoncashAccessToken();
  const payload = await fetchJson(`${MONCASH_API_BASE}/v1/CreatePayment`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount: Math.round(toNumber(amount)),
      orderId
    })
  });

  const paymentToken = String(payload?.payment_token?.token || '').trim();
  if (!paymentToken) {
    const error = new Error('MonCash did not return a payment token');
    error.payload = payload;
    throw error;
  }

  return {
    paymentToken,
    checkoutUrl: `${MONCASH_GATEWAY_BASE}/Payment/Redirect?token=${encodeURIComponent(paymentToken)}`,
    providerMode: 'api',
    providerResponse: payload
  };
}

async function createMoncashMiddlewareRedirect(orderId, amount) {
  const businessKey = safeSecretValue(MONCASH_BUSINESS_KEY);
  if (!businessKey) {
    throw new Error('MonCash business key is not configured');
  }

  const encryptedOrderId = encryptMoncashMiddlewareValue(orderId);
  const encryptedAmount = encryptMoncashMiddlewareValue(Math.round(toNumber(amount)));
  const endpoint = `${MONCASH_GATEWAY_BASE}/Checkout/Rest/${encodeURIComponent(businessKey)}`;
  const payload = await fetchJson(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      amount: encryptedAmount,
      orderId: encryptedOrderId
    }).toString()
  });

  const token = String(payload?.token || payload?.payment_token?.token || payload?.paymentToken || '').trim();
  const redirectPath = String(payload?.redirect || payload?.path || payload?.paymentUrl || payload?.url || '').trim();
  const checkoutUrl = redirectPath
    ? (redirectPath.startsWith('http') ? redirectPath : `${MONCASH_GATEWAY_BASE}${redirectPath.startsWith('/') ? '' : '/'}${redirectPath}`)
    : (token ? `${MONCASH_GATEWAY_BASE}/Checkout/Payment/Redirect/${encodeURIComponent(token)}` : '');

  if (!checkoutUrl) {
    const error = new Error('MonCash middleware did not return a checkout URL');
    error.payload = payload;
    throw error;
  }

  return {
    paymentToken: token,
    checkoutUrl,
    providerMode: 'middleware',
    providerResponse: {
      ...payload,
      encryptedOrderId,
      encryptedAmount
    }
  };
}

async function createMoncashRedirect(orderId, amount) {
  try {
    return await createMoncashApiRedirect(orderId, amount);
  } catch (apiError) {
    logger.warn('MONCASH_CREATE_DEBUG api:create-payment-failed:fallback-middleware', {
      message: apiError?.message || '',
      status: apiError?.status || null,
      payload: apiError?.payload || null
    });
    return createMoncashMiddlewareRedirect(orderId, amount);
  }
}

async function retrieveMoncashPayment({ orderId = '', transactionId = '' } = {}) {
  const accessToken = await getMoncashAccessToken();
  const hasTransactionId = Boolean(String(transactionId || '').trim());
  const endpoint = hasTransactionId ? '/v1/RetrieveTransactionPayment' : '/v1/RetrieveOrderPayment';
  const body = hasTransactionId
    ? { transactionId: String(transactionId || '').trim() }
    : { orderId: String(orderId || '').trim() };

  const payload = await fetchJson(`${MONCASH_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const payment = payload?.payment || {};
  const message = String(payment?.message || '').trim().toLowerCase();
  const resolvedOrderId = String(payment?.reference || orderId || '').trim();
  const resolvedTransactionId = String(payment?.transaction_id || payment?.transactionId || transactionId || '').trim();

  return {
    ok: payload?.status === 200 && (message === '' || message === 'successful' || message === 'success'),
    orderId: resolvedOrderId,
    transactionId: resolvedTransactionId,
    amount: toNumber(payment?.cost ?? payment?.amount),
    payer: String(payment?.payer || '').trim(),
    message: String(payment?.message || '').trim(),
    providerResponse: payload
  };
}

async function retrieveMoncashMiddlewarePayment({ encryptedTransactionId = '', encryptedOrderId = '' } = {}) {
  const businessKey = safeSecretValue(MONCASH_BUSINESS_KEY);
  if (!businessKey) {
    throw new Error('MonCash business key is not configured');
  }

  const hasEncryptedTransactionId = Boolean(String(encryptedTransactionId || '').trim());
  const endpoint = hasEncryptedTransactionId
    ? `${MONCASH_GATEWAY_BASE}/Checkout/${encodeURIComponent(businessKey)}/Payment/Transaction/`
    : `${MONCASH_GATEWAY_BASE}/Checkout/${encodeURIComponent(businessKey)}/Payment/Order/`;

  const params = new URLSearchParams();
  if (hasEncryptedTransactionId) {
    params.set('transactionId', String(encryptedTransactionId || '').trim());
  } else {
    params.set('orderId', String(encryptedOrderId || '').trim());
  }

  const payload = await fetchJson(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  return {
    ok: Boolean(payload?.success && payload?.payment_status),
    orderId: String(payload?.reference || '').trim(),
    transactionId: String(payload?.transNumber || '').trim(),
    amount: toNumber(payload?.cost),
    payer: String(payload?.payer || '').trim(),
    message: String(payload?.payment_msg || payload?.msg || '').trim(),
    providerResponse: payload
  };
}

async function updateOrderState(clientId, orderId, payload) {
  if (!clientId || !orderId) return;
  const orderRef = db.collection('clients').doc(clientId).collection('orders').doc(orderId);
  await orderRef.set(payload, { merge: true });
}

async function getOrderRecord(clientId, orderId) {
  if (!clientId || !orderId) return null;
  const snap = await db.collection('clients').doc(clientId).collection('orders').doc(orderId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ref: snap.ref, data: snap.data() || {} };
}

function getProductCollectionName(item) {
  if (item?.sourceType === 'vendor' || item?.vendorId) {
    return 'vendorProducts';
  }
  return 'products';
}

function getSelectedVariationIndex(item) {
  const options = Array.isArray(item?.selectedOptions) ? item.selectedOptions : [];
  const match = options.find((opt) => Number.isInteger(Number(opt?.variationIndex)));
  return match ? Number(match.variationIndex) : null;
}

function getSelectedSizeValue(item) {
  const options = Array.isArray(item?.selectedOptions) ? item.selectedOptions : [];
  const match = options.find((opt) => {
    const key = String(opt?.type || opt?.name || opt?.key || '').toLowerCase();
    return key === 'size' || key === 'taille';
  });
  return match ? String(match.value || match.val || match.option || '').trim() : '';
}

async function decrementInventoryForItems(transaction, items = []) {
  const inventoryEntries = [];

  for (const item of items) {
    const productId = String(item?.productId || '').trim();
    if (!productId) continue;

    const quantity = Math.max(1, toNumber(item?.quantity) || 1);
    const collectionName = getProductCollectionName(item);
    const productRef = db.collection(collectionName).doc(productId);
    const productSnap = await transaction.get(productRef);
    inventoryEntries.push({ item, quantity, productRef, productSnap });
  }

  for (const entry of inventoryEntries) {
    const { item, quantity, productRef, productSnap } = entry;
    if (!productSnap.exists) continue;

    const productData = productSnap.data() || {};
    if (isDigitalOrderItem(item) || productData?.isDigitalProduct) {
      continue;
    }
    const patch = {};
    let touched = false;

    if (productData.stock !== null && productData.stock !== undefined && Number.isFinite(Number(productData.stock))) {
      const currentStock = Number(productData.stock);
      patch.stock = reserveStockValue(currentStock, quantity);
      touched = true;
    }

    const variationIndex = getSelectedVariationIndex(item);
    if (Number.isInteger(variationIndex) && Array.isArray(productData.variations) && productData.variations[variationIndex]) {
      const variations = productData.variations.map((variation) => ({ ...variation }));
      const variation = { ...variations[variationIndex] };
      if (variation.stock !== null && variation.stock !== undefined && Number.isFinite(Number(variation.stock))) {
        const currentVariationStock = Number(variation.stock);
        variation.stock = reserveStockValue(currentVariationStock, quantity);
        variations[variationIndex] = variation;
        patch.variations = variations;
        touched = true;
      }
    }

    const sizeValue = getSelectedSizeValue(item);
    if (sizeValue && Array.isArray(productData.sizes)) {
      let sizeTouched = false;
      const sizes = productData.sizes.map((size) => {
        if (String(size?.size || '') !== sizeValue) return size;
        if (size?.quantity === null || size?.quantity === undefined || !Number.isFinite(Number(size.quantity))) return size;
        const currentQty = Number(size.quantity);
        sizeTouched = true;
        return {
          ...size,
          quantity: reserveStockValue(currentQty, quantity)
        };
      });

      if (sizeTouched) {
        patch.sizes = sizes;
        touched = true;
      }
    }

    if (touched) {
      transaction.set(productRef, patch, { merge: true });
    }
  }
}

async function restoreInventoryForItems(transaction, items = []) {
  const inventoryEntries = [];
  for (const item of items) {
    if (isDigitalOrderItem(item)) continue;
    const productId = String(item?.productId || '').trim();
    if (!productId) continue;
    const quantity = Math.max(1, toNumber(item?.quantity) || 1);
    const productRef = db.collection(getProductCollectionName(item)).doc(productId);
    const snap = await transaction.get(productRef);
    inventoryEntries.push({ item, quantity, productRef, snap });
  }
  for (const { item, quantity, productRef, snap } of inventoryEntries) {
    if (!snap.exists) continue;
    const data = snap.data() || {};
    const patch = {};
    if (data.stock !== null && data.stock !== undefined && Number.isFinite(Number(data.stock))) {
      patch.stock = Number(data.stock) + quantity;
    }
    const variationIndex = getSelectedVariationIndex(item);
    if (Number.isInteger(variationIndex) && Array.isArray(data.variations) && data.variations[variationIndex]) {
      const variations = data.variations.map((variation) => ({ ...variation }));
      if (variations[variationIndex].stock !== null && variations[variationIndex].stock !== undefined && Number.isFinite(Number(variations[variationIndex].stock))) {
        variations[variationIndex].stock = Number(variations[variationIndex].stock) + quantity;
        patch.variations = variations;
      }
    }
    const sizeValue = getSelectedSizeValue(item);
    if (sizeValue && Array.isArray(data.sizes)) {
      let touched = false;
      patch.sizes = data.sizes.map((size) => {
        if (String(size?.size || '') !== sizeValue || !Number.isFinite(Number(size?.quantity))) return size;
        touched = true;
        return { ...size, quantity: Number(size.quantity) + quantity };
      });
      if (!touched) delete patch.sizes;
    }
    if (Object.keys(patch).length) transaction.set(productRef, patch, { merge: true });
  }
}

async function findSessionBySessionId(sessionId) {
  if (!sessionId) return null;
  const snap = await db.collection('paymentSessions').doc(sessionId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ref: snap.ref, data: snap.data() || {} };
}

async function findSessionByOrderId(orderId) {
  if (!orderId) return null;
  const snap = await db
    .collection('paymentSessions')
    .where('orderId', '==', orderId)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, ref: docSnap.ref, data: docSnap.data() || {} };
}

async function findSessionByTransactionId(transactionId) {
  if (!transactionId) return null;
  const snap = await db
    .collection('paymentSessions')
    .where('providerTransactionId', '==', transactionId)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, ref: docSnap.ref, data: docSnap.data() || {} };
}

async function findVendorServiceFeeById(feeId = '') {
  const id = String(feeId || '').trim();
  if (!id) return null;
  const snap = await db.collection(VENDOR_SERVICE_FEES_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ref: snap.ref, data: snap.data() || {} };
}

async function findLatestVendorServiceFee(vendorId = '', status = '') {
  const normalizedVendorId = String(vendorId || '').trim();
  if (!normalizedVendorId) return null;

  let ref = db
    .collection(VENDOR_SERVICE_FEES_COLLECTION)
    .where('vendorId', '==', normalizedVendorId);

  if (status) {
    ref = ref.where('status', '==', String(status || '').trim());
  }

  const snap = await ref.get();
  if (snap.empty) return null;

  const docs = snap.docs
    .map((docSnap) => ({ id: docSnap.id, ref: docSnap.ref, data: docSnap.data() || {} }))
    .sort((a, b) => toDateMs(b.data?.createdAt || b.data?.requestedAt || b.data?.paidAt) - toDateMs(a.data?.createdAt || a.data?.requestedAt || a.data?.paidAt));

  return docs[0] || null;
}

async function findLatestOpenVendorServiceFee(vendorId = '') {
  const normalizedVendorId = String(vendorId || '').trim();
  if (!normalizedVendorId) return null;

  const snap = await db
    .collection(VENDOR_SERVICE_FEES_COLLECTION)
    .where('vendorId', '==', normalizedVendorId)
    .get();

  if (snap.empty) return null;
  const openStatuses = new Set(['pending', 'payment_pending', 'payment_initiated', 'redirect_ready', 'payment_failed']);
  const docs = snap.docs
    .map((docSnap) => ({ id: docSnap.id, ref: docSnap.ref, data: docSnap.data() || {} }))
    .filter((item) => openStatuses.has(String(item.data?.status || '').trim().toLowerCase()))
    .sort((a, b) => toDateMs(b.data?.createdAt || b.data?.requestedAt || b.data?.updatedAt) - toDateMs(a.data?.createdAt || a.data?.requestedAt || a.data?.updatedAt));

  return docs[0] || null;
}

async function createVendorServiceFeeRequest({ vendorId = '', vendor = {}, amount = 0, normalAmount = 0, currency = '', requestedBy = '', reason = 'renewal', planId = '', planLabel = '', offer = null } = {}) {
  const normalizedVendorId = String(vendorId || '').trim();
  const feeAmount = Math.max(0, toNumber(amount || getVendorServiceFeeAmount(vendor)));
  if (!normalizedVendorId || feeAmount <= 0) return null;

  const now = new Date().toISOString();
  const feeRef = db.collection(VENDOR_SERVICE_FEES_COLLECTION).doc();
  const offerPayload = buildVendorPlanOfferPayload(offer, now, { deferActivation: true });
  const referenceAmount = Math.max(0, toNumber(normalAmount || offerPayload?.offerNormalAmount || feeAmount));
  const fee = {
    vendorId: normalizedVendorId,
    vendorName: vendor.vendorName || vendor.shopName || 'Store vendeur',
    shopName: vendor.shopName || vendor.vendorName || '',
    email: vendor.email || '',
    amount: feeAmount,
    normalAmount: referenceAmount,
    referenceAmount,
    currency: currency || vendor.planCurrency || MONCASH_CURRENCY,
    status: 'pending',
    cycleDays: VENDOR_SERVICE_FEE_INTERVAL_DAYS,
    requestedAt: now,
    createdAt: now,
    updatedAt: now,
    requestedBy,
    requestSource: reason,
    paymentMethod: '',
    paymentProvider: '',
    paidAt: '',
    nextDueAt: '',
    planId: planId || vendor.planId || '',
    planLabel: planLabel || vendor.planLabel || '',
    ...(offerPayload ? {
      bonusType: offerPayload.offerType,
      bonusId: offerPayload.offerId,
      bonusLabel: offerPayload.offerLabel,
      bonusAmount: offerPayload.offerAmount,
      bonusNormalAmount: offerPayload.offerNormalAmount,
      bonusCurrency: offerPayload.offerCurrency,
      bonusDurationDays: offerPayload.offerDurationDays,
      bonusDurationMonths: offerPayload.offerDurationMonths,
      bonusStartAt: offerPayload.offerStartAt,
      bonusEndAt: offerPayload.offerEndAt,
      bonusAppliedAt: offerPayload.offerAppliedAt
    } : {})
  };

  await Promise.all([
    feeRef.set(fee, { merge: true }),
    db.collection('vendors').doc(normalizedVendorId).set({
      serviceFeeStatus: 'pending',
      serviceFeeCurrentId: feeRef.id,
      serviceFeeAmount: feeAmount,
      serviceFeeNormalAmount: referenceAmount,
      serviceFeeRequestedAt: now,
      updatedAt: now
    }, { merge: true }),
    db.collection('clients').doc(normalizedVendorId).set({
      uid: normalizedVendorId,
      role: 'vendor',
      serviceFeeStatus: 'pending',
      serviceFeeCurrentId: feeRef.id,
      updatedAt: now
    }, { merge: true })
  ]);

  return { id: feeRef.id, ref: feeRef, data: fee };
}

async function activateVendorAfterServiceFee({ vendorId = '', feeId = '', method = '', paidAt = '', provider = '', providerDetails = null } = {}) {
  const normalizedVendorId = String(vendorId || '').trim();
  const normalizedFeeId = String(feeId || '').trim();
  if (!normalizedVendorId || !normalizedFeeId) return null;

  const feeRef = db.collection(VENDOR_SERVICE_FEES_COLLECTION).doc(normalizedFeeId);
  const vendorRef = db.collection('vendors').doc(normalizedVendorId);
  const clientRef = db.collection('clients').doc(normalizedVendorId);
  const feeSnap = await feeRef.get();
  const feeData = feeSnap.exists ? feeSnap.data() || {} : {};
  const now = paidAt || new Date().toISOString();
  const cycleDays = Math.max(1, toNumber(feeData?.cycleDays) || VENDOR_SERVICE_FEE_INTERVAL_DAYS);
  const nextDueAt = addDaysIso(now, cycleDays);
  const paidPlanId = String(feeData?.planId || '').trim().toLowerCase();
  const paidPlanLabel = String(feeData?.planLabel || '').trim();
  const planUpgrade = paidPlanId === 'pro' || paidPlanLabel.toLowerCase().includes('pro');
  const normalPlanPrice = Math.max(0, toNumber(feeData?.normalAmount || feeData?.referenceAmount || feeData?.bonusNormalAmount || feeData?.amount));
  const bonusType = String(feeData?.bonusType || '').trim();
  const bonusPatch = bonusType
    ? {
        serviceFeeBonusType: bonusType,
        serviceFeeBonusId: feeData?.bonusId || '',
        serviceFeeBonusLabel: feeData?.bonusLabel || '',
        serviceFeeBonusAmount: Math.max(0, toNumber(feeData?.bonusAmount || feeData?.amount)),
        serviceFeeBonusNormalAmount: normalPlanPrice,
        serviceFeeBonusDurationDays: normalizeBonusDurationDays(feeData),
        serviceFeeBonusDurationMonths: bonusDurationMonthsLabel(normalizeBonusDurationDays(feeData)),
        serviceFeeBonusStartAt: feeData?.bonusStartAt || now,
        serviceFeeBonusEndAt: feeData?.bonusEndAt || addDaysIso(feeData?.bonusStartAt || now, normalizeBonusDurationDays(feeData))
      }
    : {
        serviceFeeBonusType: '',
        serviceFeeBonusId: '',
        serviceFeeBonusLabel: '',
        serviceFeeBonusAmount: 0,
        serviceFeeBonusNormalAmount: 0,
        serviceFeeBonusDurationDays: 0,
        serviceFeeBonusDurationMonths: 0,
        serviceFeeBonusStartAt: '',
        serviceFeeBonusEndAt: ''
      };
  const planUpdate = planUpgrade
    ? {
        planId: 'pro',
        planLabel: paidPlanLabel || 'PRO',
        planPrice: normalPlanPrice,
        planCurrency: feeData?.currency || MONCASH_CURRENCY,
        planPaymentRequired: true,
        vendorVerified: true
      }
    : {};
  const firstActivationPatch = bonusType === 'global_first_activation'
    ? {
        firstActivationBonusUsedAt: now,
        firstActivationBonusFeeId: normalizedFeeId
      }
    : {};
  const consumedSpecialBonusRef = bonusType === 'special_vendor' && feeData?.bonusId
    ? db.collection(VENDOR_PLAN_BONUSES_COLLECTION).doc(String(feeData.bonusId))
    : null;

  await db.runTransaction(async (transaction) => {
    transaction.set(feeRef, {
      status: 'paid',
      paidAt: now,
      nextDueAt,
      paidPeriodStartAt: now,
      paidPeriodEndAt: nextDueAt,
      bonusPaid: Boolean(bonusType),
      paymentMethod: normalizeVendorServicePaymentMethod(method),
      paymentProvider: provider || normalizeVendorServicePaymentMethod(method),
      providerDetails: providerDetails || null,
      updatedAt: now
    }, { merge: true });

    transaction.set(vendorRef, {
      ...planUpdate,
      ...bonusPatch,
      ...firstActivationPatch,
      status: 'active',
      vendorStatus: 'active',
      serviceFeeStatus: 'paid',
      serviceFeeCurrentId: normalizedFeeId,
      serviceFeeAmount: normalPlanPrice,
      serviceFeeLastPaidAt: now,
      serviceFeeNextDueAt: nextDueAt,
      serviceFeePaidPeriodStartAt: now,
      serviceFeePaidPeriodEndAt: nextDueAt,
      serviceFeePaymentMethod: normalizeVendorServicePaymentMethod(method),
      updatedAt: now
    }, { merge: true });

    transaction.set(clientRef, {
      ...planUpdate,
      ...bonusPatch,
      ...firstActivationPatch,
      role: 'vendor',
      vendorStatus: 'active',
      serviceFeeStatus: 'paid',
      serviceFeeCurrentId: normalizedFeeId,
      serviceFeeAmount: normalPlanPrice,
      serviceFeeLastPaidAt: now,
      serviceFeeNextDueAt: nextDueAt,
      serviceFeePaidPeriodStartAt: now,
      serviceFeePaidPeriodEndAt: nextDueAt,
      updatedAt: now
    }, { merge: true });

    if (consumedSpecialBonusRef) {
      transaction.set(consumedSpecialBonusRef, {
        enabled: false,
        status: 'consumed',
        consumedAt: now,
        consumedFeeId: normalizedFeeId,
        updatedAt: now
      }, { merge: true });
    }
  });

  await updateVendorProductsServiceStatus(normalizedVendorId, 'active', planUpgrade ? {
    planId: 'pro',
    planLabel: paidPlanLabel || 'PRO',
    vendorVerified: true,
    serviceFeeNextDueAt: nextDueAt
  } : {});

  return {
    feeId: normalizedFeeId,
    vendorId: normalizedVendorId,
    paidAt: now,
    nextDueAt
  };
}

async function downgradeExpiredVendorProToBasic({ vendorId = '', vendor = {}, nextDueAt = '' } = {}) {
  const normalizedVendorId = String(vendorId || '').trim();
  if (!normalizedVendorId || !isVendorProPlan(vendor)) return null;
  const dueMs = toDateMs(nextDueAt || vendor.serviceFeeNextDueAt || '');
  if (!dueMs || dueMs > Date.now()) return null;

  const now = new Date().toISOString();
  const patch = {
    planId: 'basic',
    planLabel: 'BASIC',
    planPaymentRequired: false,
    vendorVerified: false,
    serviceFeeStatus: 'basic_limited',
    serviceFeeCurrentId: '',
    updatedAt: now
  };

  await Promise.all([
    db.collection('vendors').doc(normalizedVendorId).set(patch, { merge: true }),
    db.collection('clients').doc(normalizedVendorId).set({
      ...patch,
      uid: normalizedVendorId,
      role: 'vendor'
    }, { merge: true }),
    updateVendorProductsServiceStatus(normalizedVendorId, 'basic_limited', {
      planId: 'basic',
      planLabel: 'BASIC',
      vendorVerified: false
    })
  ]);

  return {
    vendorId: normalizedVendorId,
    downgradedAt: now,
    reason: 'pro-expired-basic-limit'
  };
}

async function syncVendorServiceFeePayment({ session, details, source = '' }) {
  const now = new Date().toISOString();
  const paymentStatus = derivePaymentStatus(details);
  const sessionData = session?.data || {};
  const feeId = String(sessionData.feeId || sessionData.vendorServiceFeeId || '').trim();
  const vendorId = String(sessionData.vendorId || '').trim();

  if (!session || !feeId || !vendorId) {
    return {
      sessionId: session?.id || '',
      orderId: details?.orderId || '',
      paymentStatus,
      updated: false
    };
  }

  const sessionPatch = {
    status: paymentStatus,
    providerOrderId: details.orderId || sessionData.orderId || '',
    providerTransactionId: details.transactionId || null,
    payer: details.payer || null,
    providerMessage: details.message || '',
    providerResponse: details.providerResponse || null,
    updatedAt: now
  };

  if (paymentStatus === 'paid') {
    await activateVendorAfterServiceFee({
      vendorId,
      feeId,
      method: 'moncash',
      paidAt: now,
      provider: 'moncash',
      providerDetails: {
        orderId: details.orderId || sessionData.orderId || '',
        transactionId: details.transactionId || null,
        payer: details.payer || null,
        source,
        raw: details.providerResponse || null
      }
    });
    sessionPatch.paidAt = now;
  } else {
    const fee = await findVendorServiceFeeById(feeId);
    await Promise.all([
      session.ref.set(sessionPatch, { merge: true }),
      fee?.ref?.set({
        status: paymentStatus === 'failed' ? 'payment_failed' : 'payment_pending',
        paymentMethod: 'moncash',
        paymentProvider: 'moncash',
        providerDetails: {
          orderId: details.orderId || sessionData.orderId || '',
          transactionId: details.transactionId || null,
          payer: details.payer || null,
          source,
          raw: details.providerResponse || null
        },
        updatedAt: now
      }, { merge: true })
    ]);
  }

  await session.ref.set(sessionPatch, { merge: true });

  return {
    sessionId: session.id,
    orderId: details.orderId || sessionData.orderId || '',
    paymentStatus,
    updated: true,
    paymentType: 'vendor_service_fee',
    feeId,
    vendorId
  };
}

async function syncJwetproTicketPayment({ session, details, source = '' }) {
  const paymentStatus = derivePaymentStatus(details);
  const sessionData = session?.data || {};
  const intentId = String(sessionData.intentId || '').trim();
  if (!session || !intentId) {
    return { sessionId: session?.id || '', paymentStatus, updated: false, paymentType: 'jwetpro_ticket' };
  }

  const orderRef = db.collection(JWETPRO_ORDERS_COLLECTION).doc(intentId);
  const now = new Date().toISOString();
  let orderData = {};
  await db.runTransaction(async (transaction) => {
    const freshSession = await transaction.get(session.ref);
    const freshOrder = await transaction.get(orderRef);
    const freshSessionData = freshSession.data() || {};
    orderData = freshOrder.data() || {};
    const alreadyPaid = String(orderData.status || '').toLowerCase() === 'paid';
    const patch = {
      status: paymentStatus,
      providerOrderId: details?.orderId || freshSessionData.orderId || '',
      providerTransactionId: details?.transactionId || null,
      providerMessage: details?.message || '',
      providerResponse: details?.providerResponse || null,
      updatedAt: now
    };
    if (paymentStatus === 'paid') {
      const amounts = alreadyPaid
        ? {
            grossAmount: Number(orderData.grossAmount || orderData.amount || 0),
            commissionRate: Number(orderData.commissionRate || 0),
            commissionAmount: Number(orderData.commissionAmount || 0),
            netAmount: Number(orderData.netAmount || 0)
          }
        : calculateTicketAmounts(orderData.amount, orderData.commissionRate);
      Object.assign(patch, amounts, { paidAt: orderData.paidAt || now, payoutStatus: orderData.payoutStatus || 'upcoming' });
    }
    transaction.set(session.ref, patch, { merge: true });
    transaction.set(orderRef, patch, { merge: true });
  });

  let callback = null;
  if (paymentStatus === 'paid') {
    callback = await notifyJwetproPayment(orderRef, orderData, details, source);
  }
  return {
    sessionId: session.id,
    orderId: sessionData.orderId || details?.orderId || '',
    intentId,
    paymentStatus,
    paymentType: 'jwetpro_ticket',
    callback,
    updated: true
  };
}

function derivePaymentStatus(details) {
  if (details?.ok) return 'paid';

  const message = String(details?.message || '').toLowerCase();
  if (message.includes('pending') || message.includes('processing')) {
    return 'pending';
  }

  return 'failed';
}

async function syncMoncashPayment({ session, details, source = '' }) {
  const now = new Date().toISOString();
  const paymentStatus = derivePaymentStatus(details);
  const sessionData = session?.data || {};
  if (String(sessionData.paymentType || '').trim() === 'vendor_service_fee') {
    return syncVendorServiceFeePayment({ session, details, source });
  }
  if (String(sessionData.paymentType || '').trim() === 'jwetpro_ticket') {
    return syncJwetproTicketPayment({ session, details, source });
  }
  const clientId = sessionData.clientId || '';
  const orderId = sessionData.orderId || details.orderId || '';

  if (!session || !clientId || !orderId) {
    return {
      sessionId: session?.id || '',
      orderId,
      paymentStatus,
      updated: false
    };
  }

  const orderPatch = {
    status: paymentStatus === 'paid' ? 'paid' : paymentStatus,
    paymentStatus,
    paymentProvider: 'moncash',
    updatedAt: now,
    moncash: {
      orderId: details.orderId || orderId,
      transactionId: details.transactionId || null,
      payer: details.payer || null,
      message: details.message || '',
      source,
      raw: details.providerResponse || null
    }
  };

  if (paymentStatus === 'paid') {
    orderPatch.paidAt = now;
    orderPatch.fulfillmentStatus = 'ordered';
    orderPatch.stockReservationStatus = 'consumed';
    orderPatch.receiptAvailable = true;
    orderPatch.receiptReadyAt = now;
  }

  if (paymentStatus === 'paid') {
    await db.runTransaction(async (transaction) => {
      const freshSessionSnap = await transaction.get(session.ref);
      const freshSessionData = freshSessionSnap.data() || {};
      const orderRef = db.collection('clients').doc(clientId).collection('orders').doc(orderId);
      const orderSnap = await transaction.get(orderRef);
      const orderData = orderSnap.data() || {};
      const alreadyApplied = Boolean(freshSessionData.inventoryAppliedAt || freshSessionData.inventoryReservedAt) || String(freshSessionData.status || '').toLowerCase() === 'paid';
      const vendorNotifications = !alreadyApplied ? buildVendorOrderNotifications(orderData, session.id) : [];
      const smartCutNotification = !alreadyApplied ? buildSmartCutOrderNotification(orderData, session.id) : null;
      const promoCode = freshSessionData.promoCode && typeof freshSessionData.promoCode === 'object'
        ? freshSessionData.promoCode
        : orderData?.promoCode && typeof orderData.promoCode === 'object'
          ? orderData.promoCode
          : null;
      const clientPromoKey = String(sessionData.clientUid || clientId || '').trim();
      const affiliatePromo = isAffiliatePromoCode(promoCode || {});
      const promoUsageClientKey = affiliatePromo
        ? [clientPromoKey, orderId || session.id || Date.now()].filter(Boolean).join('__')
        : clientPromoKey;
      const promoUsageId = promoCode?.promoId && promoUsageClientKey
        ? buildPromoUsageId(promoCode.promoId, promoUsageClientKey)
        : '';
      const promoUsageRef = promoUsageId ? db.collection('promoCodeUsages').doc(promoUsageId) : null;
      const affiliateMemberDocId = buildAffiliateMemberDocId(promoCode?.code || '');
      const affiliateMemberRef = affiliateMemberDocId ? db.collection('affiliateMembers').doc(affiliateMemberDocId) : null;
      const affiliateEarningRef = promoUsageId ? db.collection('affiliateEarnings').doc(buildAffiliateEarningId(promoUsageId)) : null;
      const shouldRecordPromoUsage = Boolean(
        promoUsageRef &&
        promoCode?.applied &&
        promoCode?.discountAmount > 0 &&
        !freshSessionData.promoUsageRecordedAt
      );
      const existingUsageSnap = shouldRecordPromoUsage
        ? await transaction.get(promoUsageRef)
        : null;
      const shouldCheckAffiliate = Boolean(
        shouldRecordPromoUsage &&
        existingUsageSnap &&
        !existingUsageSnap.exists &&
        affiliateMemberRef &&
        affiliateEarningRef
      );
      const affiliateMemberSnap = shouldCheckAffiliate
        ? await transaction.get(affiliateMemberRef)
        : null;
      const existingAffiliateEarningSnap = shouldCheckAffiliate
        ? await transaction.get(affiliateEarningRef)
        : null;
      const bookingEntries = [];
      for (const item of orderData.items || []) {
        const bookingId = String(item?.autoBookingId || '').trim();
        if (!bookingId) continue;
        const bookingRef = db.collection('autoGarageBookings').doc(bookingId);
        bookingEntries.push({ ref: bookingRef, snap: await transaction.get(bookingRef) });
      }

      if (!alreadyApplied) {
        await decrementInventoryForItems(transaction, orderData.items || []);
      }

      if (shouldRecordPromoUsage) {
        if (!existingUsageSnap.exists) {
          transaction.set(promoUsageRef, {
            promoId: promoCode.promoId,
            code: String(promoCode.code || '').trim(),
            clientId,
            clientUid: sessionData.clientUid || '',
            orderId,
            sessionId: session.id,
            eligibleSubtotal: Math.max(0, toNumber(promoCode.eligibleSubtotal)),
            discountAmount: Math.max(0, toNumber(promoCode.discountAmount)),
            discountedSubtotal: Math.max(0, toNumber(promoCode.discountedSubtotal)),
            usedAt: now
          }, { merge: true });

          if (promoCode.promoId) {
            const promoRef = db.collection('promoCodes').doc(String(promoCode.promoId).trim());
            transaction.set(promoRef, {
              usageCount: admin.firestore.FieldValue.increment(1),
              lastUsedAt: now,
              updatedAt: now
            }, { merge: true });
          }

          if (affiliateMemberRef && affiliateEarningRef) {
            if (affiliateMemberSnap.exists) {
              const affiliateMember = affiliateMemberSnap.data() || {};
              const affiliateStatus = normalizeAffiliateMemberStatus(affiliateMember?.status);
              const affiliateRate = Math.max(
                0,
                toNumber(affiliateMember?.affiliateRate || promoCode?.value)
              );
              const eligibleSubtotal = Math.max(0, toNumber(promoCode?.eligibleSubtotal));
              const discountAmount = Math.max(0, toNumber(promoCode?.discountAmount));
              const promoType = normalizePromoType(promoCode?.type);

              if (affiliateStatus === 'active' && promoType === 'percentage' && affiliateRate > 0 && eligibleSubtotal > 0) {
                if (!existingAffiliateEarningSnap.exists) {
                  const affiliateSnapshot = buildAffiliateMemberSnapshot({
                    ...affiliateMember,
                    promoCode: String(promoCode.code || '').trim()
                  });
                  const affiliateAmount = Math.max(0, eligibleSubtotal * (affiliateRate / 100));

                  transaction.set(affiliateEarningRef, {
                    memberRef: affiliateMemberRef.path,
                    promoId: String(promoCode.promoId || '').trim(),
                    promoCode: affiliateSnapshot.promoCode,
                    memberId: affiliateSnapshot.memberId,
                    firstName: affiliateSnapshot.firstName,
                    lastName: affiliateSnapshot.lastName,
                    fullName: affiliateSnapshot.fullName,
                    sex: affiliateSnapshot.sex,
                    phone: affiliateSnapshot.phone,
                    clientId,
                    clientUid: sessionData.clientUid || '',
                    orderId,
                    sessionId: session.id,
                    affiliateRate,
                    eligibleSubtotal,
                    discountAmount,
                    amount: affiliateAmount,
                    status: 'pending',
                    createdAt: now,
                    updatedAt: now,
                    paidAt: '',
                    payoutId: ''
                  }, { merge: true });

                  transaction.set(affiliateMemberRef, {
                    promoCode: affiliateSnapshot.promoCode,
                    affiliateRate,
                    lastUsedAt: now,
                    lastOrderId: orderId,
                    totalUses: admin.firestore.FieldValue.increment(1),
                    pendingAmount: admin.firestore.FieldValue.increment(affiliateAmount),
                    updatedAt: now
                  }, { merge: true });
                }
              }
            }
          }
        }
      }

      transaction.set(session.ref, {
        status: paymentStatus,
        providerOrderId: details.orderId || orderId,
        providerTransactionId: details.transactionId || null,
        payer: details.payer || null,
        providerMessage: details.message || '',
        providerResponse: details.providerResponse || null,
        updatedAt: now,
        paidAt: now,
        inventoryAppliedAt: freshSessionData.inventoryAppliedAt || (freshSessionData.inventoryReservedAt ? now : (alreadyApplied ? null : now)),
        promoUsageRecordedAt: shouldRecordPromoUsage ? now : freshSessionData.promoUsageRecordedAt || null
      }, { merge: true });

      transaction.set(orderRef, orderPatch, { merge: true });
      bookingEntries.forEach(({ ref, snap }) => {
        if (snap.exists && snap.data()?.customerUid === String(sessionData.clientUid || clientId) && snap.data()?.status === 'held' && (!snap.data()?.paymentSessionId || snap.data()?.paymentSessionId === session.id)) {
          transaction.set(ref, { status: 'confirmed', paymentOrderId: orderId, confirmedAt: now, updatedAt: now }, { merge: true });
        }
      });

      vendorNotifications.forEach((notification) => {
        const notificationRef = db.collection('notificationBroadcasts').doc(notification.id);
        transaction.set(notificationRef, notification, { merge: true });
      });

      if (smartCutNotification) {
        const smartCutNotificationRef = db.collection('notificationBroadcasts').doc(smartCutNotification.id);
        transaction.set(smartCutNotificationRef, smartCutNotification, { merge: true });
      }
    });
  } else {
    if (paymentStatus === 'failed' && sessionData.inventoryReservedAt && !sessionData.inventoryReleasedAt) {
      await db.runTransaction(async (transaction) => {
        const freshSession = await transaction.get(session.ref);
        const freshData = freshSession.data() || {};
        if (freshData.inventoryReservedAt && !freshData.inventoryReleasedAt && String(freshData.status || '').toLowerCase() !== 'paid') {
          const orderRef = db.collection('clients').doc(clientId).collection('orders').doc(orderId);
          const orderSnap = await transaction.get(orderRef);
          const orderItems = orderSnap.data()?.items || [];
          const bookingEntries = await readAutoBookingsForRelease(transaction, orderItems, session.id);
          await restoreInventoryForItems(transaction, orderItems);
          bookingEntries.forEach(({ ref }) => transaction.set(ref, { paymentSessionId: admin.firestore.FieldValue.delete(), paymentOrderId: admin.firestore.FieldValue.delete(), updatedAt: now }, { merge: true }));
          transaction.set(session.ref, { inventoryReleasedAt: now }, { merge: true });
          transaction.set(orderRef, { stockReservationStatus: 'released' }, { merge: true });
        }
      });
    }
    await Promise.all([
      session.ref.set({ status: paymentStatus, providerOrderId: details.orderId || orderId, providerTransactionId: details.transactionId || null, payer: details.payer || null, providerMessage: details.message || '', providerResponse: details.providerResponse || null, updatedAt: now, paidAt: sessionData.paidAt || null }, { merge: true }),
      updateOrderState(clientId, orderId, orderPatch)
    ]);
  }

  return {
    sessionId: session.id,
    orderId,
    paymentStatus,
    updated: true
  };
}

async function resolveAndSyncPayment({ sessionId = '', orderId = '', transactionId = '', source = '' } = {}) {
  let session = null;

  if (sessionId) {
    session = await findSessionBySessionId(sessionId);
  }
  if (!session && transactionId) {
    session = await findSessionByTransactionId(transactionId);
  }
  if (!session && orderId) {
    session = await findSessionByOrderId(orderId);
  }

  const resolvedOrderId = orderId || session?.data?.orderId || '';
  let details;
  try {
    details = await retrieveMoncashPayment({
      orderId: resolvedOrderId,
      transactionId
    });
  } catch (error) {
    if (!transactionId) throw error;
    details = await retrieveMoncashMiddlewarePayment({
      encryptedTransactionId: transactionId
    });
  }

  if (!session && details.orderId) {
    session = await findSessionByOrderId(details.orderId);
  }
  if (!session && details.transactionId) {
    session = await findSessionByTransactionId(details.transactionId);
  }

  const syncResult = await syncMoncashPayment({ session, details, source });
  return {
    session,
    details,
    syncResult
  };
}

function buildStatusResponse({ session, details, syncResult, fallbackSessionId = '', order = null }) {
  const sessionData = session?.data || {};
  const orderData = order?.data || {};
  const paymentType = String(sessionData.paymentType || syncResult?.paymentType || '').trim();
  return {
    ok: true,
    sessionId: session?.id || fallbackSessionId || '',
    status: syncResult?.paymentStatus || sessionData.status || derivePaymentStatus(details),
    amount: details?.amount || sessionData.amount || 0,
    currency: sessionData.currency || MONCASH_CURRENCY,
    orderId: details?.orderId || sessionData.orderId || '',
    paymentType,
    intentId: sessionData.intentId || syncResult?.intentId || '',
    externalReturnUrl: sessionData.externalReturnUrl || '',
    feeId: sessionData.feeId || syncResult?.feeId || '',
    vendorId: sessionData.vendorId || syncResult?.vendorId || '',
    transactionId: details?.transactionId || sessionData.providerTransactionId || '',
    uniqueCode: orderData.uniqueCode || sessionData.uniqueCode || '',
    orderStatus: syncResult?.paymentStatus === 'paid' ? 'paid' : (sessionData.status || ''),
    paymentStatus: syncResult?.paymentStatus || sessionData.status || '',
    order: order ? { id: order.id, ...orderData } : null
  };
}

exports.syncJwetproTicket = onRequest(
  { region: REGION, secrets: [JWETPRO_INTEGRATION_SECRET] },
  async (req, res) => {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
    const body = parseBody(req);
    const verification = requireJwetproSignature(req, body);
    if (!verification.ok) return sendJson(res, 401, { ok: false, error: verification.error });
    const championshipId = sanitizeText(body.championshipId, 150);
    if (!championshipId) return sendJson(res, 400, { ok: false, error: 'missing-championship-id' });
    const eventRef = db.collection(JWETPRO_EVENTS_COLLECTION).doc(verification.eventId);
    const ticketRef = db.collection(JWETPRO_TICKETS_COLLECTION).doc(championshipId);
    const now = new Date().toISOString();
    const reservationExpiresAt = new Date(Date.now() + 20 * 60 * 1000).toISOString();
    await db.runTransaction(async (transaction) => {
      const eventSnapshot = await transaction.get(eventRef);
      if (eventSnapshot.exists) return;
      transaction.set(ticketRef, {
        championshipId,
        name: sanitizeText(body.name, 180),
        description: sanitizeText(body.description, 1200),
        imageUrl: sanitizeText(body.imageUrl, 1500),
        price: Math.max(0, Number(body.price) || 0),
        currency: sanitizeText(body.currency || 'HTG', 12),
        capacity: Math.max(0, Math.floor(Number(body.capacity) || 0)),
        paidCount: Math.max(0, Math.floor(Number(body.paidCount) || 0)),
        reservedCount: Math.max(0, Math.floor(Number(body.reservedCount) || 0)),
        registrationDeadline: sanitizeText(body.registrationDeadline, 80),
        championshipStartsAt: sanitizeText(body.championshipStartsAt, 80),
        championshipEndsAt: sanitizeText(body.championshipEndsAt, 80),
        jwetproUrl: sanitizeText(body.jwetproUrl, 1500),
        status: normalizeTicketStatus(body.status),
        visible: normalizeTicketStatus(body.status) === 'registration-open',
        testMode: body.testMode === true,
        sourceUpdatedAt: sanitizeText(body.updatedAt, 80),
        syncedAt: now
      }, { merge: true });
      transaction.set(eventRef, { type: 'ticket.sync', championshipId, processedAt: now });
    });
    if (normalizeTicketStatus(body.status) === 'cancelled') {
      const affected = await db.collection(JWETPRO_ORDERS_COLLECTION).where('championshipId', '==', championshipId).get();
      const batch = db.batch();
      affected.docs.forEach((item) => {
        if (item.data()?.status === 'paid' && item.data()?.payoutStatus !== 'paid') batch.set(item.ref, { payoutStatus: 'credit_pending', creditStatus: 'available', updatedAt: now }, { merge: true });
      });
      if (!affected.empty) await batch.commit();
    }
    return sendJson(res, 200, { ok: true, championshipId });
  }
);

exports.syncJwetproCreditUsage = onRequest(
  { region: REGION, secrets: [JWETPRO_INTEGRATION_SECRET] },
  async (req, res) => {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
    const body = parseBody(req);
    const verification = requireJwetproSignature(req, body);
    if (!verification.ok) return sendJson(res, 401, { ok: false, error: verification.error });
    const targetChampionshipId = sanitizeText(body.targetChampionshipId, 150);
    const allocations = Array.isArray(body.allocations) ? body.allocations : [];
    if (!targetChampionshipId || !allocations.length) return sendJson(res, 400, { ok: false, error: 'invalid-credit-usage' });
    const eventRef = db.collection(JWETPRO_EVENTS_COLLECTION).doc(verification.eventId);
    await db.runTransaction(async (transaction) => {
      const event = await transaction.get(eventRef);
      if (event.exists) return;
      const allocationEntries = allocations
        .map((allocation) => ({
          allocation,
          sourceIntentId: sanitizeText(allocation?.sourceIntentId, 150)
        }))
        .filter((entry) => entry.sourceIntentId)
        .map((entry) => ({
          ...entry,
          orderRef: db.collection(JWETPRO_ORDERS_COLLECTION).doc(entry.sourceIntentId)
        }));
      const orders = await Promise.all(allocationEntries.map((entry) => transaction.get(entry.orderRef)));
      orders.forEach((order, index) => {
        if (!order.exists || order.data()?.status !== 'paid') return;
        const { allocation, sourceIntentId, orderRef } = allocationEntries[index];
        const usedAmount = Math.max(0, Number(allocation.amount) || 0);
        if (!usedAmount || order.data()?.creditStatus === 'used') return;
        const rate = Number(order.data()?.commissionRate || 0);
        const amounts = calculateTicketAmounts(usedAmount, rate);
        const allocationRef = db.collection('jwetproTicketCreditAllocations').doc(`${sourceIntentId}__${sanitizeText(body.targetIntentId, 150)}`);
        transaction.set(allocationRef, { sourceIntentId, targetIntentId: sanitizeText(body.targetIntentId, 150), targetChampionshipId, playerUid: sanitizeText(body.playerUid, 150), ...amounts, status: 'upcoming', createdAt: new Date().toISOString() }, { merge: true });
        transaction.set(orderRef, { creditStatus: 'used', creditUsedForIntentId: sanitizeText(body.targetIntentId, 150), creditUsedAt: new Date().toISOString() }, { merge: true });
      });
      transaction.set(eventRef, { type: 'credit.used', targetChampionshipId, processedAt: new Date().toISOString() });
    });
    return sendJson(res, 200, { ok: true });
  }
);

exports.listJwetproTickets = onRequest({ region: REGION }, async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
  const snapshot = await db.collection(JWETPRO_TICKETS_COLLECTION).where('visible', '==', true).limit(100).get();
  const includeTest = String(req.query?.includeTest || '') === '1';
  const now = Date.now();
  const staleTickets = [];
  const tickets = snapshot.docs
    .map((item) => ({ ref: item.ref, id: item.id, ...item.data() }))
    .filter((ticket) => {
      const deadlineMs = Date.parse(String(ticket.registrationDeadline || ''));
      const isExpired = Number.isFinite(deadlineMs) && deadlineMs <= now;
      const isOpen = ticket.status === 'registration-open' && ticket.visible !== false && !isExpired;
      if (!isOpen) staleTickets.push(ticket.ref);
      return isOpen && (includeTest || ticket.testMode !== true);
    })
    .map(({ ref, ...ticket }) => ticket);

  // Keep historical ticket data for reporting, but remove stale entries from the public catalogue.
  if (staleTickets.length) {
    const batch = db.batch();
    staleTickets.forEach((ref) => batch.set(ref, {
      visible: false,
      publicClosedAt: new Date(now).toISOString()
    }, { merge: true }));
    await batch.commit();
  }
  return sendJson(res, 200, { ok: true, tickets });
});

exports.createJwetproTicketPayment = onRequest(
  { region: REGION, secrets: [MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY, JWETPRO_INTEGRATION_SECRET] },
  async (req, res) => {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
    const body = parseBody(req);
    const verification = requireJwetproSignature(req, body);
    if (!verification.ok) return sendJson(res, 401, { ok: false, error: verification.error });
    const requestedReturnBaseUrl = normalizeBaseUrl(body.returnBaseUrl || '');
    const isLocalTestReturn = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestedReturnBaseUrl);
    const settings = await getJwetproSettings();
    if (!settings.enabled && !isLocalTestReturn) {
      return sendJson(res, 503, { ok: false, error: 'jwetpro-tickets-disabled' });
    }
    const intentId = sanitizeText(body.intentId, 150);
    const championshipId = sanitizeText(body.championshipId, 150);
    const playerUid = sanitizeText(body.playerUid, 150);
    if (!intentId || !championshipId || !playerUid) {
      return sendJson(res, 400, { ok: false, error: 'invalid-ticket-intent' });
    }
    const ticketRef = db.collection(JWETPRO_TICKETS_COLLECTION).doc(championshipId);
    const ticketSnapshot = await ticketRef.get();
    if (!ticketSnapshot.exists) return sendJson(res, 404, { ok: false, error: 'ticket-not-found' });
    const ticket = ticketSnapshot.data() || {};
    if (ticket.testMode === true && !isLocalTestReturn) {
      return sendJson(res, 403, { ok: false, error: 'test-ticket-local-only' });
    }
    if (ticket.status !== 'registration-open') return sendJson(res, 409, { ok: false, error: 'registration-closed' });
    const registrationDeadlineMs = Date.parse(String(ticket.registrationDeadline || ''));
    if (Number.isFinite(registrationDeadlineMs) && registrationDeadlineMs <= Date.now()) {
      return sendJson(res, 409, { ok: false, error: 'registration-deadline-passed' });
    }
    const signedAmount = Math.max(0, Number(body.amount) || 0);
    if (!signedAmount || Math.abs(signedAmount - Number(ticket.price || 0)) > 0.01) {
      return sendJson(res, 409, { ok: false, error: 'ticket-price-changed', currentPrice: ticket.price || 0 });
    }
    const orderRef = db.collection(JWETPRO_ORDERS_COLLECTION).doc(intentId);
    const existing = await orderRef.get();
    if (existing.exists) {
      const data = existing.data() || {};
      if (data.checkoutUrl && data.status !== 'failed') {
        return sendJson(res, 200, { ok: true, repeated: true, intentId, sessionId: data.sessionId, checkoutUrl: data.checkoutUrl });
      }
    }
    const specialRate = settings.specialRates?.[championshipId];
    const commissionRate = normalizeJwetproRate(specialRate, settings.globalCommissionRate);
    const sessionId = createSessionId();
    const providerOrderId = db.collection('paymentSessions').doc().id;
    const sessionRef = db.collection('paymentSessions').doc(sessionId);
    const returnBaseUrl = isLocalTestReturn ? requestedReturnBaseUrl : JWETPRO_RETURN_BASE_URL;
    const externalReturnUrl = `${returnBaseUrl}/registration-return.html?intent=${encodeURIComponent(intentId)}`;
    const now = new Date().toISOString();
    const baseData = {
      paymentType: 'jwetpro_ticket',
      intentId,
      reservationId: sanitizeText(body.reservationId, 150),
      championshipId,
      payoutChampionshipId: championshipId,
      championshipName: sanitizeText(ticket.name || body.championshipName, 180),
      playerUid,
      playerEmail: sanitizeText(body.playerEmail, 320),
      playerName: sanitizeText(body.playerName, 180),
      orderId: providerOrderId,
      amount: signedAmount,
      grossAmount: signedAmount,
      commissionRate,
      currency: ticket.currency || MONCASH_CURRENCY,
      status: 'initiated',
      externalReturnUrl,
      createdAt: now,
      updatedAt: now
    };
    try {
      await Promise.all([sessionRef.set({ identifier: sessionId, provider: 'moncash', ...baseData }), orderRef.set({ sessionId, ...baseData })]);
      const redirect = await createMoncashRedirect(providerOrderId, signedAmount);
      const redirectPatch = { status: 'redirect_ready', checkoutUrl: redirect.checkoutUrl, paymentToken: redirect.paymentToken, providerMode: redirect.providerMode, updatedAt: new Date().toISOString() };
      await Promise.all([sessionRef.set(redirectPatch, { merge: true }), orderRef.set(redirectPatch, { merge: true })]);
      return sendJson(res, 200, { ok: true, intentId, sessionId, checkoutUrl: redirect.checkoutUrl, returnUrl: externalReturnUrl });
    } catch (error) {
      await Promise.all([sessionRef.set({ status: 'server_error', errorMessage: error?.message || '', updatedAt: now }, { merge: true }), orderRef.set({ status: 'server_error', errorMessage: error?.message || '', updatedAt: now }, { merge: true })]);
      const publicError = getSafeMoncashPublicError(error);
      return sendJson(res, publicError.status, { ok: false, error: publicError.error, message: publicError.message });
    }
  }
);

exports.getJwetproTicketAdminData = onRequest({ region: REGION }, async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
  const user = await verifyBearerUser(req);
  if (!user || !(await isAdminUser(user.uid))) return sendJson(res, 403, { ok: false, error: 'admin-required' });
  const [ticketsSnapshot, ordersSnapshot, payoutsSnapshot, creditAllocationsSnapshot, settings] = await Promise.all([
    db.collection(JWETPRO_TICKETS_COLLECTION).limit(250).get(),
    db.collection(JWETPRO_ORDERS_COLLECTION).limit(1000).get(),
    db.collection('jwetproTicketPayouts').limit(250).get(),
    db.collection('jwetproTicketCreditAllocations').limit(500).get(),
    getJwetproSettings()
  ]);
  return sendJson(res, 200, {
    ok: true,
    settings,
    tickets: ticketsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    orders: ordersSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    payouts: payoutsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() })),
    credits: creditAllocationsSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
  });
});

exports.manageJwetproTickets = onRequest({ region: REGION }, async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
  const user = await verifyBearerUser(req);
  if (!user || !(await isAdminUser(user.uid))) return sendJson(res, 403, { ok: false, error: 'admin-required' });
  const body = parseBody(req);
  const action = sanitizeText(body.action, 60);
  const now = new Date().toISOString();
  if (action === 'save-settings') {
    const specialRates = {};
    Object.entries(body.specialRates && typeof body.specialRates === 'object' ? body.specialRates : {}).forEach(([key, value]) => {
      specialRates[sanitizeText(key, 150)] = normalizeJwetproRate(value);
    });
    const data = { enabled: body.enabled === true, globalCommissionRate: normalizeJwetproRate(body.globalCommissionRate), specialRates, updatedAt: now, updatedBy: user.uid };
    await db.collection(JWETPRO_SETTINGS_COLLECTION).doc(JWETPRO_SETTINGS_DOC).set(data, { merge: true });
    return sendJson(res, 200, { ok: true, settings: data });
  }
  if (action === 'create-payout') {
    const championshipId = sanitizeText(body.championshipId, 150);
    const payoutRef = db.collection('jwetproTicketPayouts').doc();
    let totals = { grossAmount: 0, commissionAmount: 0, netAmount: 0 };
    try {
      await db.runTransaction(async (transaction) => {
        const ticketRef = db.collection(JWETPRO_TICKETS_COLLECTION).doc(championshipId);
        const paidOrdersQuery = db.collection(JWETPRO_ORDERS_COLLECTION).where('payoutChampionshipId', '==', championshipId).where('status', '==', 'paid');
        const creditAllocationsQuery = db.collection('jwetproTicketCreditAllocations').where('targetChampionshipId', '==', championshipId).where('status', '==', 'upcoming');
        const [ticketSnapshot, paidOrders, creditAllocations] = await Promise.all([
          transaction.get(ticketRef),
          transaction.get(paidOrdersQuery),
          transaction.get(creditAllocationsQuery)
        ]);
        if (!ticketSnapshot.exists || ticketSnapshot.data()?.status !== 'completed') {
          throw new Error('championship-not-completed');
        }
        const eligible = paidOrders.docs.filter((item) => {
          const payoutStatus = String(item.data()?.payoutStatus || 'upcoming');
          return payoutStatus !== 'paid' && payoutStatus !== 'credit_pending';
        });
        if (!eligible.length && creditAllocations.empty) throw new Error('nothing-to-payout');
        totals = [...eligible, ...creditAllocations.docs].reduce((acc, item) => {
          acc.grossAmount += Number(item.data()?.grossAmount || 0);
          acc.commissionAmount += Number(item.data()?.commissionAmount || 0);
          acc.netAmount += Number(item.data()?.netAmount || 0);
          return acc;
        }, { grossAmount: 0, commissionAmount: 0, netAmount: 0 });
        eligible.forEach((item) => transaction.set(item.ref, { payoutStatus: 'paid', payoutId: payoutRef.id, paidOutAt: now }, { merge: true }));
        creditAllocations.docs.forEach((item) => transaction.set(item.ref, { status: 'paid', payoutId: payoutRef.id, paidOutAt: now }, { merge: true }));
        transaction.set(payoutRef, { championshipId, ...totals, orderCount: eligible.length, creditAllocationCount: creditAllocations.size, method: sanitizeText(body.method || 'manuel', 60), reference: sanitizeText(body.reference, 180), createdAt: now, createdBy: user.uid });
      });
    } catch (error) {
      if (['championship-not-completed', 'nothing-to-payout'].includes(error?.message)) {
        return sendJson(res, 409, { ok: false, error: error.message });
      }
      logger.error('JWETPRO payout transaction failed', { championshipId, message: error?.message || '' });
      return sendJson(res, 500, { ok: false, error: 'payout-failed' });
    }
    return sendJson(res, 200, { ok: true, payoutId: payoutRef.id, ...totals });
  }
  return sendJson(res, 400, { ok: false, error: 'unsupported-action' });
});

exports.createMoncashPayment = onRequest(
  { region: REGION, secrets: [MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY] },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    const clientId = safeSecretValue(MONCASH_CLIENT_ID);
    const clientSecret = safeSecretValue(MONCASH_CLIENT_SECRET);
    if (!clientId || !clientSecret) {
      sendJson(res, 500, { ok: false, error: 'missing-moncash-credentials' });
      return;
    }

    const body = parseBody(req);
    const localClientId = String(body.clientId || '').trim();
    const clientUid = String(body.clientUid || '').trim();
    const customerName = String(body.customerName || '').trim();
    const customerFirstName = String(body.customerFirstName || '').trim();
    const customerLastName = String(body.customerLastName || '').trim();
    const customerEmail = String(body.customerEmail || '').trim();
    const customerPhone = String(body.customerPhone || '').trim();
    const customerAddress = String(body.customerAddress || '').trim();
    const customerCity = String(body.customerCity || '').trim();
    const delivery = body.delivery && typeof body.delivery === 'object' ? body.delivery : null;
    const requestedPromo = body.promo && typeof body.promo === 'object' ? body.promo : null;

    let authenticatedClient = null;
    try {
      authenticatedClient = await verifyBearerUser(req);
    } catch (error) {
      logger.warn('MONCASH_CREATE_DEBUG request:invalid-auth', { message: error?.message || '' });
    }
    if (!authenticatedClient?.uid || authenticatedClient.uid !== clientUid || authenticatedClient.uid !== localClientId) {
      sendJson(res, 403, { ok: false, error: 'client-identity-mismatch' });
      return;
    }
    const items = await enrichMarketplaceItems(body.items);

    logger.info('MONCASH_CREATE_DEBUG request:start', {
      clientId: localClientId,
      clientUid,
      itemCount: items.length,
      hasCustomerName: Boolean(customerName),
      hasCustomerEmail: Boolean(customerEmail),
      deliveryDepartment: delivery?.department || '',
      deliveryCommune: delivery?.commune || '',
      hasPromo: Boolean(requestedPromo?.code)
    });

    if (!localClientId) {
      logger.warn('MONCASH_CREATE_DEBUG request:missing-client-id');
      sendJson(res, 400, { ok: false, error: 'missing-client-id' });
      return;
    }

    if (!customerName || !customerEmail) {
      logger.warn('MONCASH_CREATE_DEBUG request:missing-customer-identity', {
        hasCustomerName: Boolean(customerName),
        hasCustomerEmail: Boolean(customerEmail)
      });
      sendJson(res, 400, { ok: false, error: 'missing-customer-identity' });
      return;
    }

    if (items.length === 0) {
      logger.warn('MONCASH_CREATE_DEBUG request:missing-items');
      sendJson(res, 400, { ok: false, error: 'missing-items' });
      return;
    }

    const itemValidation = validateServerMarketplaceItems(items);
    if (!itemValidation.ok) {
      logger.warn('MONCASH_CREATE_DEBUG request:item-invalid', itemValidation);
      sendJson(res, 409, { ok: false, ...itemValidation });
      return;
    }

    const autoBookingValidation = await validateAutoBookingItems(items, clientUid);
    if (!autoBookingValidation.ok) {
      logger.warn('MONCASH_CREATE_DEBUG request:auto-booking-invalid', autoBookingValidation);
      sendJson(res, 409, autoBookingValidation);
      return;
    }

    const deliveryValidation = validateHomeDeliveryPayload(items, delivery);
    if (!deliveryValidation.ok) {
      logger.warn('MONCASH_CREATE_DEBUG request:delivery-invalid', {
        error: deliveryValidation.error,
        message: deliveryValidation.message,
        unavailable: deliveryValidation.unavailable || null
      });
      sendJson(res, 400, {
        ok: false,
        error: deliveryValidation.error,
        message: deliveryValidation.message,
        unavailable: deliveryValidation.unavailable || null
      });
      return;
    }

    const resolvedDelivery = deliveryValidation.delivery;
    const totals = buildOrderTotals(items, resolvedDelivery);
    let promoSummary = null;
    if (requestedPromo?.code) {
      promoSummary = await previewPromoForCart({
        code: requestedPromo.code,
        clientId: localClientId,
        clientUid,
        items
      });
    }
    const discountAmount = Math.max(0, Number(promoSummary?.discountAmount || 0));
    const finalTotal = Math.max(0, totals.total - discountAmount);
    if (finalTotal <= 0) {
      logger.warn('MONCASH_CREATE_DEBUG request:invalid-total', {
        subtotal: totals.subtotal,
        shippingAmount: totals.shippingAmount,
        discountAmount,
        finalTotal
      });
      sendJson(res, 400, { ok: false, error: 'invalid-total' });
      return;
    }

    const sessionId = createSessionId();
    const orderRef = db.collection('clients').doc(localClientId).collection('orders').doc();
    const orderId = orderRef.id;
    const sessionRef = db.collection('paymentSessions').doc(sessionId);
    const now = new Date().toISOString();
    const uniqueCode = createUniqueCode(sessionId);

    const orderDraft = {
      clientId: localClientId,
      clientUid,
      amount: finalTotal,
      subtotal: totals.subtotal,
      discountAmount,
      shippingAmount: totals.shippingAmount,
      weightFee: totals.weightFee,
      currency: MONCASH_CURRENCY,
      items,
      delivery: resolvedDelivery,
      promoCode: promoSummary ? {
        promoId: promoSummary.promoId,
        code: promoSummary.code,
        label: promoSummary.label,
        type: promoSummary.type,
        value: promoSummary.value,
        categoryIds: promoSummary.categoryIds,
        affiliateEnabled: Boolean(promoSummary.affiliateEnabled),
        affiliateMemberId: promoSummary.affiliateMemberId || '',
        affiliateMemberName: promoSummary.affiliateMemberName || '',
        affiliatePhone: promoSummary.affiliatePhone || '',
        eligibleSubtotal: promoSummary.eligibleSubtotal,
        discountAmount: promoSummary.discountAmount,
        applied: true
      } : null,
      status: 'payment_initiated',
      paymentStatus: 'initiated',
      fulfillmentStatus: 'awaiting_payment',
      paymentProvider: 'moncash',
      paymentSessionId: sessionId,
      uniqueCode,
      methodId: String(body.methodId || ''),
      methodName: String(body.methodName || 'MonCash'),
      customerName,
      customerFirstName,
      customerLastName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerCity,
      moncash: {
        orderId
      },
      createdAt: now,
      updatedAt: now
    };

    const sessionData = {
      identifier: sessionId,
      clientId: localClientId,
      clientUid,
      orderId,
      provider: 'moncash',
      status: 'initiated',
      amount: finalTotal,
      subtotal: totals.subtotal,
      discountAmount,
      shippingAmount: totals.shippingAmount,
      weightFee: totals.weightFee,
      currency: MONCASH_CURRENCY,
      customerName,
      customerFirstName,
      customerLastName,
      customerEmail,
      customerPhone,
      delivery: resolvedDelivery,
      promoCode: promoSummary ? {
        promoId: promoSummary.promoId,
        code: promoSummary.code,
        label: promoSummary.label,
        type: promoSummary.type,
        value: promoSummary.value,
        categoryIds: promoSummary.categoryIds,
        affiliateEnabled: Boolean(promoSummary.affiliateEnabled),
        affiliateMemberId: promoSummary.affiliateMemberId || '',
        affiliateMemberName: promoSummary.affiliateMemberName || '',
        affiliatePhone: promoSummary.affiliatePhone || '',
        eligibleSubtotal: promoSummary.eligibleSubtotal,
        discountAmount: promoSummary.discountAmount,
        applied: true
      } : null,
      returnUrl: DEFAULT_RETURN_URL,
      alertUrl: DEFAULT_ALERT_URL,
      uniqueCode,
      createdAt: now,
      updatedAt: now
    };

    let inventoryReserved = false;
    try {
      await db.runTransaction(async (transaction) => {
        const bookingAttachments = await validateAndAttachAutoBookings(transaction, items, clientUid, sessionId, orderId);
        await decrementInventoryForItems(transaction, items);
        bookingAttachments.forEach(({ ref, patch }) => transaction.set(ref, patch, { merge: true }));
        transaction.set(orderRef, { ...orderDraft, stockReservationStatus: 'reserved' }, { merge: true });
        transaction.set(sessionRef, { ...sessionData, inventoryReservedAt: now, inventoryReservationExpiresAt: reservationExpiresAt }, { merge: true });
      });
      inventoryReserved = true;

      logger.info('MONCASH_CREATE_DEBUG redirect:start', {
        sessionId,
        orderId,
        amount: finalTotal
      });

      const redirect = await createMoncashRedirect(orderId, finalTotal);

      await Promise.all([
        sessionRef.set(
          {
            status: 'redirect_ready',
            paymentToken: redirect.paymentToken,
            checkoutUrl: redirect.checkoutUrl,
            providerMode: redirect.providerMode || 'api',
            providerResponse: redirect.providerResponse,
            updatedAt: new Date().toISOString()
          },
          { merge: true }
        ),
        updateOrderState(localClientId, orderId, {
          status: 'awaiting_payment',
          paymentStatus: 'redirect_ready',
          moncashCheckoutUrl: redirect.checkoutUrl,
          moncashProviderMode: redirect.providerMode || 'api',
          updatedAt: new Date().toISOString()
        })
      ]);

      logger.info('MONCASH_CREATE_DEBUG redirect:ready', {
        sessionId,
        orderId,
        hasCheckoutUrl: Boolean(redirect.checkoutUrl),
        providerMode: redirect.providerMode || 'api'
      });

      sendJson(res, 200, {
        ok: true,
        sessionId,
        orderId,
        discountAmount,
        checkoutUrl: redirect.checkoutUrl,
        returnUrl: DEFAULT_RETURN_URL,
        alertUrl: DEFAULT_ALERT_URL
      });
    } catch (error) {
      logger.error('MonCash create payment failed', error);
      const bookingConflict = ['garage-booking-unavailable', 'garage-booking-already-in-checkout'].includes(error?.message);
      const publicError = bookingConflict
        ? { status: 409, error: error.message, message: 'Ce rendez-vous n’est plus disponible. Choisissez un autre créneau.' }
        : getSafeMoncashPublicError(error);
      logger.warn('MONCASH_CREATE_DEBUG redirect:error', {
        status: publicError.status,
        publicError: publicError.error,
        publicMessage: publicError.message,
        rawMessage: error?.message || '',
        payload: error?.payload || null
      });

      if (inventoryReserved) {
        try {
          await db.runTransaction(async (transaction) => {
            const freshSession = await transaction.get(sessionRef);
            const freshData = freshSession.data() || {};
            if (freshData.inventoryReservedAt && !freshData.inventoryReleasedAt && String(freshData.status || '').toLowerCase() !== 'paid') {
              const bookingEntries = await readAutoBookingsForRelease(transaction, items, sessionId);
              await restoreInventoryForItems(transaction, items);
              bookingEntries.forEach(({ ref }) => transaction.set(ref, { paymentSessionId: admin.firestore.FieldValue.delete(), paymentOrderId: admin.firestore.FieldValue.delete(), updatedAt: new Date().toISOString() }, { merge: true }));
              transaction.set(sessionRef, { inventoryReleasedAt: new Date().toISOString() }, { merge: true });
              transaction.set(orderRef, { stockReservationStatus: 'released' }, { merge: true });
            }
          });
        } catch (releaseError) {
          logger.error('Unable to release failed payment stock reservation', releaseError);
        }
      }
      await Promise.all([
        sessionRef.set(
          {
            status: 'server_error',
            errorMessage: error?.message || 'Unknown error',
            errorDetails: error?.payload || null,
            updatedAt: new Date().toISOString()
          },
          { merge: true }
        ),
        updateOrderState(localClientId, orderId, {
          status: 'payment_error',
          paymentStatus: 'server_error',
          updatedAt: new Date().toISOString()
        })
      ]);

      sendJson(res, publicError.status, {
        ok: false,
        error: publicError.error,
        message: publicError.message
      });
    }
  }
);

exports.requestVendorServiceFee = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const user = await verifyBearerUser(req);
      if (!user || !(await isAdminUser(user.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-required' });
        return;
      }

      const body = parseBody(req);
      const vendorId = String(body.vendorId || '').trim();
      if (!vendorId) {
        sendJson(res, 400, { ok: false, error: 'missing-vendor-id' });
        return;
      }

      const vendorSnap = await db.collection('vendors').doc(vendorId).get();
      if (!vendorSnap.exists) {
        sendJson(res, 404, { ok: false, error: 'vendor-not-found' });
        return;
      }

      const vendor = { id: vendorSnap.id, ...(vendorSnap.data() || {}) };
      const planSettings = await getVendorPlanSettings();
      const proPlan = getVendorProPlanMeta(planSettings);
      const now = new Date().toISOString();
      const applicableOffer = await resolveVendorProOffer({
        vendorId,
        vendor,
        settings: planSettings,
        proPlan,
        nowIso: now
      });
      const amount = Math.max(0, toNumber(applicableOffer?.amount || getVendorServiceFeeAmount(vendor) || proPlan.price));
      if (amount <= 0) {
        sendJson(res, 400, { ok: false, error: 'vendor-has-no-monthly-subscription' });
        return;
      }

      const latestPaid = await findLatestVendorServiceFee(vendorId, 'paid');
      const nextDueMs = toDateMs(latestPaid?.data?.nextDueAt || vendor?.serviceFeeNextDueAt || '');
      if (latestPaid && nextDueMs > Date.now()) {
        sendJson(res, 200, {
          ok: true,
          alreadyPaid: true,
          message: 'Ce store a deja paye son cycle courant.',
          fee: { id: latestPaid.id, ...latestPaid.data }
        });
        return;
      }

      const activePending = await findLatestOpenVendorServiceFee(vendorId);
      if (activePending) {
        sendJson(res, 200, {
          ok: true,
          alreadyRequested: true,
          fee: { id: activePending.id, ...activePending.data }
        });
        return;
      }

      const pending = await createVendorServiceFeeRequest({
        vendorId,
        vendor,
        amount,
        normalAmount: proPlan.price,
        currency: proPlan.currency,
        requestedBy: user.uid,
        reason: 'admin_service_fee_request',
        planId: 'pro',
        planLabel: 'PRO',
        offer: applicableOffer
      });

      await updateVendorProductsServiceStatus(vendorId, 'suspended');

      sendJson(res, 200, {
        ok: true,
        fee: pending ? { id: pending.id, ...pending.data } : null
      });
    } catch (error) {
      logger.error('requestVendorServiceFee failed', error);
      sendJson(res, 500, { ok: false, error: 'server-error', message: error?.message || 'Erreur serveur.' });
    }
  }
);

exports.getVendorServiceFeeStatus = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const user = await verifyBearerUser(req);
      if (!user?.uid) {
        sendJson(res, 401, { ok: false, error: 'auth-required' });
        return;
      }

      const vendor = await getVendorProfile(user.uid);
      if (!vendor || String(vendor.role || '').toLowerCase() !== 'vendor') {
        sendJson(res, 403, { ok: false, error: 'vendor-required' });
        return;
      }

      let pending;
      let paid;
      let planSettings;
      [pending, paid, planSettings] = await Promise.all([
        findLatestOpenVendorServiceFee(user.uid),
        findLatestVendorServiceFee(user.uid, 'paid'),
        getVendorPlanSettings()
      ]);
      const proPlan = getVendorProPlanMeta(planSettings);
      const applicableOffer = await resolveVendorProOffer({
        vendorId: user.uid,
        vendor,
        settings: planSettings,
        proPlan
      });
      if (pending) {
        const now = new Date().toISOString();
        const offerPatch = buildVendorPlanOfferPayload(applicableOffer, now, { deferActivation: true });
        const expectedAmount = Math.max(0, toNumber(applicableOffer?.amount || proPlan.price));
        const pendingAmount = toNumber(pending.data?.amount);
        const pendingPlanId = String(pending.data?.planId || '').trim().toLowerCase();
        const pendingOfferId = String(pending.data?.bonusId || '').trim();
        const expectedOfferId = String(offerPatch?.offerId || '').trim();
        const hasPrematureBonusDates = Boolean(pending.data?.bonusStartAt || pending.data?.bonusEndAt);
        const needsPendingSync = pendingPlanId === 'pro'
          && (pendingAmount !== expectedAmount || pendingOfferId !== expectedOfferId || hasPrematureBonusDates);
        if (needsPendingSync) {
          const patch = {
            amount: expectedAmount,
            normalAmount: proPlan.price,
            referenceAmount: proPlan.price,
            currency: proPlan.currency,
            requestSource: 'vendor_pro_upgrade',
            updatedAt: now,
            ...(offerPatch ? {
              bonusType: offerPatch.offerType,
              bonusId: offerPatch.offerId,
              bonusLabel: offerPatch.offerLabel,
              bonusAmount: offerPatch.offerAmount,
              bonusNormalAmount: offerPatch.offerNormalAmount,
              bonusCurrency: offerPatch.offerCurrency,
              bonusDurationDays: offerPatch.offerDurationDays,
              bonusDurationMonths: offerPatch.offerDurationMonths,
              bonusStartAt: offerPatch.offerStartAt,
              bonusEndAt: offerPatch.offerEndAt,
              bonusAppliedAt: offerPatch.offerAppliedAt,
              cycleDays: VENDOR_SERVICE_FEE_INTERVAL_DAYS
            } : {
              bonusType: '',
              bonusId: '',
              bonusLabel: '',
              bonusAmount: 0,
              bonusNormalAmount: 0,
              bonusCurrency: '',
              bonusDurationDays: 0,
              bonusDurationMonths: 0,
              bonusStartAt: '',
              bonusEndAt: '',
              bonusAppliedAt: '',
              cycleDays: VENDOR_SERVICE_FEE_INTERVAL_DAYS
            })
          };
          await pending.ref.set(patch, { merge: true });
          pending = {
            ...pending,
            data: {
              ...pending.data,
              ...patch
            }
          };
        }
      }
      let responseVendor = { ...vendor };
      let isPro = isVendorProPlan(responseVendor);
      const nextDueAt = paid?.data?.nextDueAt || vendor.serviceFeeNextDueAt || '';
      const nextDueMs = toDateMs(nextDueAt);
      const expiredPro = isPro && (!nextDueAt || nextDueMs <= Date.now());
      const downgrade = expiredPro
        ? await downgradeExpiredVendorProToBasic({ vendorId: user.uid, vendor: responseVendor, nextDueAt })
        : null;
      if (downgrade) {
        responseVendor = {
          ...responseVendor,
          planId: 'basic',
          planLabel: 'BASIC',
          planPaymentRequired: false,
          vendorVerified: false,
          serviceFeeStatus: 'basic_limited'
        };
        isPro = false;
      }
      const paymentDue = Boolean(pending) || expiredPro;

      sendJson(res, 200, {
        ok: true,
        vendor: {
          vendorId: user.uid,
          vendorName: responseVendor.vendorName || responseVendor.shopName || '',
          status: responseVendor.status || responseVendor.vendorStatus || '',
          planId: responseVendor.planId || 'basic',
          planLabel: responseVendor.planLabel || (isPro ? 'PRO' : 'BASIC'),
          planPrice: toNumber(responseVendor.planPrice),
          planCurrency: responseVendor.planCurrency || proPlan.currency,
          planPaymentRequired: Boolean(responseVendor.planPaymentRequired),
          serviceFeeStatus: responseVendor.serviceFeeStatus || '',
          serviceFeeAmount: getVendorServiceFeeAmount(responseVendor),
          serviceFeeNextDueAt: nextDueAt
        },
        proPlan,
        applicableOffer,
        isPro,
        canUpgradeToPro: !isPro,
        paymentDue,
        downgradedToBasic: Boolean(downgrade),
        currentFee: pending ? { id: pending.id, ...pending.data } : null,
        lastPayment: paid ? { id: paid.id, ...paid.data } : null
      });
    } catch (error) {
      logger.error('getVendorServiceFeeStatus failed', error);
      sendJson(res, 500, { ok: false, error: 'server-error', message: error?.message || 'Erreur serveur.' });
    }
  }
);

exports.startVendorServiceFeePayment = onRequest(
  { region: REGION, secrets: [MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY] },
  async (req, res) => {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const user = await verifyBearerUser(req);
      if (!user?.uid) {
        sendJson(res, 401, { ok: false, error: 'auth-required' });
        return;
      }

      const vendor = await getVendorProfile(user.uid);
      if (!vendor || String(vendor.role || '').toLowerCase() !== 'vendor') {
        sendJson(res, 403, { ok: false, error: 'vendor-required' });
        return;
      }

      const body = parseBody(req);
      const method = normalizeVendorServicePaymentMethod(body.method || 'moncash');
      const action = String(body.action || body.intent || '').trim().toLowerCase();
      const planSettings = await getVendorPlanSettings();
      const proPlan = getVendorProPlanMeta(planSettings);
      const isPro = isVendorProPlan(vendor);
      const wantsProUpgrade = action === 'upgrade_pro' || action === 'upgrade-pro' || !isPro;
      const now = new Date().toISOString();
      const applicableOffer = await resolveVendorProOffer({
        vendorId: user.uid,
        vendor,
        settings: planSettings,
        proPlan,
        nowIso: now
      });
      const proPayableAmount = Math.max(0, toNumber(applicableOffer?.amount || proPlan.price));
      let pending = await findLatestOpenVendorServiceFee(user.uid);
      if (pending && wantsProUpgrade) {
        const pendingAmount = toNumber(pending.data?.amount);
        const pendingPlanId = String(pending.data?.planId || '').trim().toLowerCase();
        const pendingOfferId = String(pending.data?.bonusId || '').trim();
        const offerPatch = buildVendorPlanOfferPayload(applicableOffer, now, { deferActivation: true });
        const hasPrematureBonusDates = Boolean(pending.data?.bonusStartAt || pending.data?.bonusEndAt);
        const needsUpgradeSync = pendingAmount !== proPayableAmount
          || pendingPlanId !== 'pro'
          || pendingOfferId !== String(offerPatch?.offerId || '').trim()
          || hasPrematureBonusDates;
        if (needsUpgradeSync) {
          const patch = {
            amount: proPayableAmount,
            normalAmount: proPlan.price,
            referenceAmount: proPlan.price,
            currency: proPlan.currency,
            requestSource: 'vendor_pro_upgrade',
            planId: 'pro',
            planLabel: 'PRO',
            updatedAt: now,
            ...(offerPatch ? {
              bonusType: offerPatch.offerType,
              bonusId: offerPatch.offerId,
              bonusLabel: offerPatch.offerLabel,
              bonusAmount: offerPatch.offerAmount,
              bonusNormalAmount: offerPatch.offerNormalAmount,
              bonusCurrency: offerPatch.offerCurrency,
              bonusDurationDays: offerPatch.offerDurationDays,
              bonusDurationMonths: offerPatch.offerDurationMonths,
              bonusStartAt: offerPatch.offerStartAt,
              bonusEndAt: offerPatch.offerEndAt,
              bonusAppliedAt: offerPatch.offerAppliedAt,
              cycleDays: VENDOR_SERVICE_FEE_INTERVAL_DAYS
            } : {
              bonusType: '',
              bonusId: '',
              bonusLabel: '',
              bonusAmount: 0,
              bonusNormalAmount: 0,
              bonusCurrency: '',
              bonusDurationDays: 0,
              bonusDurationMonths: 0,
              bonusStartAt: '',
              bonusEndAt: '',
              bonusAppliedAt: '',
              cycleDays: VENDOR_SERVICE_FEE_INTERVAL_DAYS
            })
          };
          await pending.ref.set(patch, { merge: true });
          pending = {
            ...pending,
            data: {
              ...pending.data,
              ...patch
            }
          };
        }
      }
      if (!pending) {
        const latestPaid = await findLatestVendorServiceFee(user.uid, 'paid');
        const nextDueAt = latestPaid?.data?.nextDueAt || vendor.serviceFeeNextDueAt || '';
        const nextDueMs = toDateMs(nextDueAt);
        const proRenewalDue = isPro && (!nextDueAt || nextDueMs <= Date.now());

        if (!wantsProUpgrade && !proRenewalDue) {
          sendJson(res, 400, {
            ok: false,
            error: 'service-fee-not-due',
            message: nextDueAt
              ? `Aucun paiement requis avant ${nextDueAt}.`
              : 'Aucun frais mensuel en attente pour ce store.'
          });
          return;
        }

        pending = await createVendorServiceFeeRequest({
          vendorId: user.uid,
          vendor,
          amount: wantsProUpgrade ? proPayableAmount : (applicableOffer?.amount || getVendorServiceFeeAmount(vendor) || proPlan.price),
          normalAmount: proPlan.price,
          currency: proPlan.currency,
          requestedBy: user.uid,
          reason: wantsProUpgrade ? 'vendor_pro_upgrade' : 'vendor_pro_renewal',
          planId: 'pro',
          planLabel: 'PRO',
          offer: applicableOffer
        });

        if (!pending) {
          sendJson(res, 400, { ok: false, error: 'unable-to-create-service-fee', message: 'Impossible de preparer le paiement Plan Pro.' });
          return;
        }
      }

      const amount = Math.max(0, toNumber(pending.data?.amount || getVendorServiceFeeAmount(vendor)));
      if (amount <= 0) {
        sendJson(res, 400, { ok: false, error: 'invalid-service-fee-amount' });
        return;
      }

      if (method !== 'moncash') {
        await pending.ref.set({
          status: 'payment_pending',
          paymentMethod: method,
          paymentProvider: method,
          paymentRequestedAt: now,
          updatedAt: now
        }, { merge: true });

        sendJson(res, 200, {
          ok: true,
          status: 'payment_pending',
          method,
          fee: { id: pending.id, ...pending.data, status: 'payment_pending', paymentMethod: method }
        });
        return;
      }

      const clientId = safeSecretValue(MONCASH_CLIENT_ID);
      const clientSecret = safeSecretValue(MONCASH_CLIENT_SECRET);
      if (!clientId || !clientSecret) {
        sendJson(res, 500, { ok: false, error: 'missing-moncash-credentials' });
        return;
      }

      const sessionId = createSessionId();
      const providerOrderId = `VSF-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
      const sessionRef = db.collection('paymentSessions').doc(sessionId);
      const sessionData = {
        identifier: sessionId,
        paymentType: 'vendor_service_fee',
        feeId: pending.id,
        vendorId: user.uid,
        vendorName: vendor.vendorName || vendor.shopName || '',
        orderId: providerOrderId,
        provider: 'moncash',
        status: 'initiated',
        amount,
        currency: pending.data?.currency || MONCASH_CURRENCY,
        normalAmount: pending.data?.normalAmount || pending.data?.referenceAmount || proPlan.price,
        bonusType: pending.data?.bonusType || '',
        bonusId: pending.data?.bonusId || '',
        bonusLabel: pending.data?.bonusLabel || '',
        bonusDurationDays: pending.data?.bonusDurationDays || 0,
        bonusEndAt: pending.data?.bonusEndAt || '',
        returnUrl: DEFAULT_RETURN_URL,
        alertUrl: DEFAULT_ALERT_URL,
        uniqueCode: providerOrderId,
        createdAt: now,
        updatedAt: now
      };

      await Promise.all([
        sessionRef.set(sessionData, { merge: true }),
        pending.ref.set({
          status: 'payment_initiated',
          paymentMethod: 'moncash',
          paymentProvider: 'moncash',
          paymentSessionId: sessionId,
          providerOrderId,
          updatedAt: now
        }, { merge: true })
      ]);

      const redirect = await createMoncashRedirect(providerOrderId, amount);
      await Promise.all([
        sessionRef.set({
          status: 'redirect_ready',
          paymentToken: redirect.paymentToken,
          checkoutUrl: redirect.checkoutUrl,
          providerMode: redirect.providerMode || 'api',
          providerResponse: redirect.providerResponse,
          updatedAt: new Date().toISOString()
        }, { merge: true }),
        pending.ref.set({
          status: 'redirect_ready',
          checkoutUrl: redirect.checkoutUrl,
          providerMode: redirect.providerMode || 'api',
          updatedAt: new Date().toISOString()
        }, { merge: true })
      ]);

      sendJson(res, 200, {
        ok: true,
        sessionId,
        orderId: providerOrderId,
        checkoutUrl: redirect.checkoutUrl,
        returnUrl: DEFAULT_RETURN_URL,
        alertUrl: DEFAULT_ALERT_URL,
        amount,
        normalAmount: pending.data?.normalAmount || pending.data?.referenceAmount || proPlan.price,
        applicableOffer
      });
    } catch (error) {
      logger.error('startVendorServiceFeePayment failed', error);
      const publicError = getSafeMoncashPublicError(error);
      sendJson(res, publicError.status, { ok: false, error: publicError.error, message: publicError.message });
    }
  }
);

exports.previewPromoCode = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const body = parseBody(req);
      const items = await enrichMarketplaceItems(body.items);
      logger.info('PROMO_DEBUG endpoint:request', {
        code: body.code || '',
        clientId: body.clientId || '',
        clientUid: body.clientUid || '',
        itemCount: Array.isArray(items) ? items.length : 0
      });
      const preview = await previewPromoForCart({
        code: body.code,
        clientId: body.clientId,
        clientUid: body.clientUid,
        items
      });

      sendJson(res, 200, {
        ok: true,
        ...preview,
        message: 'Code promo applique uniquement aux produits Smart Cut eligibles.'
      });
    } catch (error) {
      logger.error('PROMO_DEBUG endpoint:error', {
        message: error?.message || 'unknown-error',
        stack: error?.stack || ''
      });
      sendJson(res, 400, {
        ok: false,
        error: 'promo-preview-failed',
        message: error?.message || 'Impossible de verifier ce code promo.'
      });
    }
  }
);

exports.listPromoCodes = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid || !(await isAdminUser(decodedUser.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-access-denied' });
        return;
      }

      const snapshot = await db.collection('promoCodes').orderBy('updatedAt', 'desc').limit(200).get();
      logger.info('PROMO_ADMIN_DEBUG list:success', {
        adminUid: decodedUser.uid,
        count: snapshot.size,
        ids: snapshot.docs.map((entry) => entry.id),
        promos: snapshot.docs.map((entry) => {
          const data = entry.data() || {};
          return {
            id: entry.id,
            code: data.code || '',
            label: data.label || data.name || '',
            updatedAt: data.updatedAt || '',
            createdAt: data.createdAt || '',
            active: data.active !== false
          };
        })
      });
      sendJson(res, 200, {
        ok: true,
        promos: snapshot.docs.map((entry) => ({ id: entry.id, ...(entry.data() || {}) }))
      });
    } catch (error) {
      logger.error('PROMO_ADMIN list:error', {
        message: error?.message || 'unknown-error',
        stack: error?.stack || ''
      });
      sendJson(res, 500, { ok: false, error: 'promo-list-failed', message: 'Impossible de charger les codes promo.' });
    }
  }
);

exports.savePromoCode = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid || !(await isAdminUser(decodedUser.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-access-denied' });
        return;
      }

      const body = parseBody(req);
      const code = normalizePromoCode(body?.code);
      const label = sanitizeText(body?.label || body?.name || '', 160);
      const type = normalizePromoType(body?.type);
      const value = Math.max(0, toNumber(body?.value ?? body?.amount ?? body?.rate));
      const startAt = String(body?.startAt || '').trim();
      const endAt = String(body?.endAt || '').trim();
      const categoryIds = Array.from(new Set((Array.isArray(body?.categoryIds) ? body.categoryIds : []).map((value) => String(value || '').trim()).filter(Boolean)));
      const now = new Date().toISOString();
      const previousId = normalizePromoCode(body?.previousCode || body?.currentPromoId || '');
      logger.info('PROMO_ADMIN_DEBUG save:start', {
        adminUid: decodedUser.uid,
        previousId,
        code,
        label,
        type,
        value,
        startAt,
        endAt,
        categoryIds,
        active: body?.active !== false
      });

      if (!code) {
        sendJson(res, 400, { ok: false, error: 'missing-code', message: 'Le code promo est requis.' });
        return;
      }
      if (!label) {
        sendJson(res, 400, { ok: false, error: 'missing-label', message: 'Le libelle du code promo est requis.' });
        return;
      }
      if (!Number.isFinite(value) || value <= 0) {
        sendJson(res, 400, { ok: false, error: 'invalid-value', message: 'La valeur de la remise doit etre superieure a 0.' });
        return;
      }
      if (startAt && endAt && toDateMs(endAt) <= toDateMs(startAt)) {
        sendJson(res, 400, { ok: false, error: 'invalid-range', message: 'La date de fin doit etre apres la date de debut.' });
        return;
      }

      const targetRef = db.collection('promoCodes').doc(code);
      const targetSnap = await targetRef.get();
      if (targetSnap.exists && code !== previousId) {
        logger.warn('PROMO_ADMIN_DEBUG save:duplicate-doc-id', {
          adminUid: decodedUser.uid,
          previousId,
          code
        });
        sendJson(res, 400, { ok: false, error: 'duplicate-code', message: 'Ce code promo existe deja.' });
        return;
      }

      const duplicateSnapshot = await db.collection('promoCodes').where('code', '==', code).limit(5).get();
      const duplicate = duplicateSnapshot.docs.find((entry) => entry.id !== previousId && entry.id !== code);
      if (duplicate) {
        logger.warn('PROMO_ADMIN_DEBUG save:duplicate-field', {
          adminUid: decodedUser.uid,
          previousId,
          code,
          duplicateId: duplicate.id
        });
        sendJson(res, 400, { ok: false, error: 'duplicate-code', message: 'Ce code promo existe deja.' });
        return;
      }

      const existingData = targetSnap.exists ? (targetSnap.data() || {}) : {};
      const categoryNames = await resolvePromoCategoryNames(categoryIds);
      const payload = {
        code,
        label,
        name: label,
        type,
        value,
        active: body?.active !== false,
        startAt,
        endAt,
        description: sanitizeText(body?.description || '', 500),
        categoryIds,
        categoryNames,
        usageCount: Number(existingData?.usageCount || 0),
        createdAt: existingData?.createdAt || now,
        updatedAt: now
      };

      await targetRef.set(payload, { merge: true });
      const savedSnap = await targetRef.get();

      if (previousId && previousId !== code) {
        await db.collection('promoCodes').doc(previousId).delete().catch(() => null);
      }

      logger.info('PROMO_ADMIN_DEBUG save:success', {
        adminUid: decodedUser.uid,
        previousId,
        code,
        existsAfterSave: savedSnap.exists,
        savedData: savedSnap.exists ? (savedSnap.data() || {}) : null
      });

      sendJson(res, 200, { ok: true, promo: { id: code, ...payload } });
    } catch (error) {
      logger.error('PROMO_ADMIN save:error', {
        message: error?.message || 'unknown-error',
        stack: error?.stack || ''
      });
      sendJson(res, 500, { ok: false, error: 'promo-save-failed', message: 'Impossible d enregistrer ce code promo.' });
    }
  }
);

exports.deletePromoCode = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (!['POST', 'DELETE'].includes(req.method)) {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid || !(await isAdminUser(decodedUser.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-access-denied' });
        return;
      }

      const body = parseBody(req);
      const code = normalizePromoCode(body?.code || req.query.code || '');
      if (!code) {
        sendJson(res, 400, { ok: false, error: 'missing-code', message: 'Le code promo est requis.' });
        return;
      }

      logger.info('PROMO_ADMIN_DEBUG delete:start', {
        adminUid: decodedUser.uid,
        code
      });
      await db.collection('promoCodes').doc(code).delete();
      logger.info('PROMO_ADMIN_DEBUG delete:success', {
        adminUid: decodedUser.uid,
        code
      });
      sendJson(res, 200, { ok: true, code });
    } catch (error) {
      logger.error('PROMO_ADMIN delete:error', {
        message: error?.message || 'unknown-error',
        stack: error?.stack || ''
      });
      sendJson(res, 500, { ok: false, error: 'promo-delete-failed', message: 'Impossible de supprimer ce code promo.' });
    }
  }
);

exports.getAffiliateDashboardData = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid || !(await isAdminUser(decodedUser.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-access-denied' });
        return;
      }

      const [membersSnap, earningsSnap, payoutsSnap] = await Promise.all([
        db.collection('affiliateMembers').get(),
        db.collection('affiliateEarnings').get(),
        db.collection('affiliatePayouts').get()
      ]);

      const memberMetrics = new Map();
      membersSnap.docs.forEach((snap) => {
        const data = snap.data() || {};
        memberMetrics.set(snap.id, {
          id: snap.id,
          ...buildAffiliateMemberSnapshot({ ...data, promoCode: snap.id }),
          affiliateRate: Math.max(0, toNumber(data?.affiliateRate)),
          promoId: String(data?.promoId || '').trim(),
          promoLabel: String(data?.promoLabel || '').trim(),
          promoType: normalizePromoType(data?.promoType),
          status: normalizeAffiliateMemberStatus(data?.status),
          createdAt: String(data?.createdAt || '').trim(),
          updatedAt: String(data?.updatedAt || '').trim(),
          lastUsedAt: String(data?.lastUsedAt || '').trim(),
          lastPaidAt: String(data?.lastPaidAt || '').trim(),
          pendingAmount: 0,
          pendingUses: 0,
          totalEarnedAmount: 0,
          totalPaidAmount: 0,
          totalUses: 0,
          nextSuggestedPayoutAt: ''
        });
      });

      const earnings = earningsSnap.docs.map((snap) => {
        const data = snap.data() || {};
        const promoCode = String(data?.promoCode || '').trim();
        return {
          id: snap.id,
          promoCode,
          memberId: String(data?.memberId || '').trim(),
          firstName: String(data?.firstName || '').trim(),
          lastName: String(data?.lastName || '').trim(),
          fullName: String(data?.fullName || '').trim(),
          sex: String(data?.sex || '').trim(),
          phone: String(data?.phone || '').trim(),
          clientId: String(data?.clientId || '').trim(),
          clientUid: String(data?.clientUid || '').trim(),
          orderId: String(data?.orderId || '').trim(),
          sessionId: String(data?.sessionId || '').trim(),
          promoId: String(data?.promoId || '').trim(),
          affiliateRate: Math.max(0, toNumber(data?.affiliateRate)),
          eligibleSubtotal: Math.max(0, toNumber(data?.eligibleSubtotal)),
          discountAmount: Math.max(0, toNumber(data?.discountAmount)),
          amount: Math.max(0, toNumber(data?.amount)),
          status: String(data?.status || 'pending').trim().toLowerCase() === 'paid' ? 'paid' : 'pending',
          createdAt: String(data?.createdAt || '').trim(),
          updatedAt: String(data?.updatedAt || '').trim(),
          paidAt: String(data?.paidAt || '').trim(),
          payoutId: String(data?.payoutId || '').trim()
        };
      }).sort((a, b) => toDateMs(b.createdAt) - toDateMs(a.createdAt));

      earnings.forEach((earning) => {
        const metrics = memberMetrics.get(earning.promoCode);
        if (!metrics) return;
        metrics.totalEarnedAmount += earning.amount;
        metrics.totalUses += 1;
        if (earning.status === 'paid') {
          metrics.totalPaidAmount += earning.amount;
        } else {
          metrics.pendingAmount += earning.amount;
          metrics.pendingUses += 1;
        }
        if (!metrics.lastUsedAt || toDateMs(earning.createdAt) > toDateMs(metrics.lastUsedAt)) {
          metrics.lastUsedAt = earning.createdAt;
        }
      });

      const payouts = payoutsSnap.docs
        .map((snap) => mapAffiliatePayoutSummary(snap.id, snap.data() || {}))
        .sort((a, b) => getAffiliatePayoutEventMs(b) - getAffiliatePayoutEventMs(a));

      payouts.forEach((payout) => {
        const metrics = memberMetrics.get(payout.promoCode);
        if (!metrics) return;
        if (!metrics.lastPaidAt || toDateMs(payout.paidAt) > toDateMs(metrics.lastPaidAt)) {
          metrics.lastPaidAt = payout.paidAt;
        }
      });

      const members = Array.from(memberMetrics.values())
        .map((member) => {
          const nextSuggestedPayoutAt = member.lastPaidAt
            ? new Date(toDateMs(member.lastPaidAt) + (30 * 24 * 60 * 60 * 1000)).toISOString()
            : '';
          return {
            ...member,
            pendingAmount: Math.max(0, member.pendingAmount),
            totalEarnedAmount: Math.max(0, member.totalEarnedAmount),
            totalPaidAmount: Math.max(0, member.totalPaidAmount),
            nextSuggestedPayoutAt
          };
        })
        .sort((a, b) => {
          const pendingDiff = b.pendingAmount - a.pendingAmount;
          if (pendingDiff !== 0) return pendingDiff;
          return toDateMs(b.updatedAt || b.createdAt) - toDateMs(a.updatedAt || a.createdAt);
        });

      sendJson(res, 200, {
        ok: true,
        members,
        earnings: earnings.slice(0, 300),
        payouts: payouts.slice(0, 200)
      });
    } catch (error) {
      logger.error('AFFILIATE_ADMIN list:error', {
        message: error?.message || 'unknown-error',
        stack: error?.stack || ''
      });
      sendJson(res, 500, { ok: false, error: 'affiliate-dashboard-failed', message: 'Impossible de charger le module affiliation.' });
    }
  }
);

exports.saveAffiliateMember = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid || !(await isAdminUser(decodedUser.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-access-denied' });
        return;
      }

      const body = parseBody(req);
      const promoCode = buildAffiliateMemberDocId(body?.promoCode);
      const previousPromoCode = buildAffiliateMemberDocId(body?.previousPromoCode || body?.currentPromoId || '');
      const memberId = normalizeAffiliateMemberId(body?.memberId);
      const firstName = sanitizeText(body?.firstName, 120);
      const lastName = sanitizeText(body?.lastName, 120);
      const sex = normalizeAffiliateSex(body?.sex);
      const phone = sanitizeText(body?.phone, 40);
      const status = normalizeAffiliateMemberStatus(body?.status);
      const now = new Date().toISOString();

      if (!promoCode) {
        sendJson(res, 400, { ok: false, error: 'missing-promo-code', message: 'Le code promo du membre est requis.' });
        return;
      }
      if (!memberId) {
        sendJson(res, 400, { ok: false, error: 'missing-member-id', message: 'L ID membre est requis.' });
        return;
      }
      if (!firstName || !lastName) {
        sendJson(res, 400, { ok: false, error: 'missing-member-name', message: 'Le nom et le prenom du membre sont requis.' });
        return;
      }

      const promoRef = db.collection('promoCodes').doc(promoCode);
      const promoSnap = await promoRef.get();
      if (!promoSnap.exists) {
        sendJson(res, 400, { ok: false, error: 'promo-not-found', message: 'Le code promo associe a ce membre est introuvable.' });
        return;
      }

      const promoData = promoSnap.data() || {};
      const promoType = normalizePromoType(promoData?.type);
      const affiliateRate = Math.max(0, toNumber(promoData?.value ?? promoData?.amount ?? promoData?.rate));
      if (promoType !== 'percentage' || affiliateRate <= 0) {
        sendJson(res, 400, { ok: false, error: 'invalid-affiliate-promo', message: 'Le code promo affiliation doit etre un pourcentage actif et superieur a 0.' });
        return;
      }

      const duplicateMemberSnap = await db.collection('affiliateMembers').where('memberId', '==', memberId).limit(5).get();
      const duplicateMember = duplicateMemberSnap.docs.find((entry) => entry.id !== promoCode && entry.id !== previousPromoCode);
      if (duplicateMember) {
        sendJson(res, 400, { ok: false, error: 'duplicate-member-id', message: 'Cet ID membre est deja utilise.' });
        return;
      }

      const targetRef = db.collection('affiliateMembers').doc(promoCode);
      const targetSnap = await targetRef.get();
      if (targetSnap.exists && promoCode !== previousPromoCode) {
        sendJson(res, 400, { ok: false, error: 'duplicate-promo-code', message: 'Ce code promo est deja rattache a un autre membre.' });
        return;
      }

      const existingData = targetSnap.exists ? (targetSnap.data() || {}) : {};
      const payload = {
        promoCode,
        memberId,
        firstName,
        lastName,
        sex,
        phone,
        status,
        promoId: String(promoData?.code || promoCode).trim(),
        promoLabel: sanitizeText(promoData?.label || promoData?.name || 'Code promo', 160),
        promoType,
        affiliateRate,
        createdAt: existingData?.createdAt || now,
        updatedAt: now,
        lastUsedAt: existingData?.lastUsedAt || '',
        lastPaidAt: existingData?.lastPaidAt || '',
        pendingAmount: Math.max(0, toNumber(existingData?.pendingAmount)),
        totalUses: Math.max(0, toNumber(existingData?.totalUses))
      };

      await targetRef.set(payload, { merge: true });
      await promoRef.set({
        affiliateEnabled: true,
        affiliateMemberId: memberId,
        affiliateMemberName: `${firstName} ${lastName}`.trim(),
        affiliatePhone: phone,
        updatedAt: now
      }, { merge: true });

      if (previousPromoCode && previousPromoCode !== promoCode) {
        const previousEarningsSnap = await db.collection('affiliateEarnings').where('promoCode', '==', previousPromoCode).get();
        if (!previousEarningsSnap.empty) {
          const batch = db.batch();
          previousEarningsSnap.docs.forEach((entry) => {
            batch.set(entry.ref, {
              promoCode,
              memberId,
              firstName,
              lastName,
              fullName: `${firstName} ${lastName}`.trim(),
              sex,
              phone,
              affiliateRate,
              updatedAt: now
            }, { merge: true });
          });
          await batch.commit();
        }

        await db.collection('affiliateMembers').doc(previousPromoCode).delete().catch(() => null);
        await db.collection('promoCodes').doc(previousPromoCode).set({
          affiliateEnabled: false,
          affiliateMemberId: '',
          affiliateMemberName: '',
          affiliatePhone: '',
          updatedAt: now
        }, { merge: true }).catch(() => null);
      }

      sendJson(res, 200, {
        ok: true,
        member: {
          id: promoCode,
          ...buildAffiliateMemberSnapshot(payload),
          affiliateRate,
          promoId: payload.promoId,
          promoLabel: payload.promoLabel,
          promoType,
          createdAt: payload.createdAt,
          updatedAt: payload.updatedAt,
          status
        }
      });
    } catch (error) {
      logger.error('AFFILIATE_ADMIN save:error', {
        message: error?.message || 'unknown-error',
        stack: error?.stack || ''
      });
      sendJson(res, 500, { ok: false, error: 'affiliate-save-failed', message: 'Impossible d enregistrer ce membre affiliation.' });
    }
  }
);

exports.deleteAffiliateMember = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (!['POST', 'DELETE'].includes(req.method)) {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid || !(await isAdminUser(decodedUser.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-access-denied' });
        return;
      }

      const body = parseBody(req);
      const promoCode = buildAffiliateMemberDocId(body?.promoCode || req.query.promoCode || '');
      if (!promoCode) {
        sendJson(res, 400, { ok: false, error: 'missing-promo-code', message: 'Le code promo du membre est requis.' });
        return;
      }

      await db.collection('affiliateMembers').doc(promoCode).delete();
      await db.collection('promoCodes').doc(promoCode).set({
        affiliateEnabled: false,
        affiliateMemberId: '',
        affiliateMemberName: '',
        affiliatePhone: '',
        updatedAt: new Date().toISOString()
      }, { merge: true }).catch(() => null);

      sendJson(res, 200, { ok: true, promoCode });
    } catch (error) {
      logger.error('AFFILIATE_ADMIN delete:error', {
        message: error?.message || 'unknown-error',
        stack: error?.stack || ''
      });
      sendJson(res, 500, { ok: false, error: 'affiliate-delete-failed', message: 'Impossible de supprimer ce membre affiliation.' });
    }
  }
);

exports.createAffiliatePayout = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid || !(await isAdminUser(decodedUser.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-access-denied' });
        return;
      }

      const body = parseBody(req);
      const promoCode = buildAffiliateMemberDocId(body?.promoCode);
      const rawDateFrom = String(body?.dateFrom || body?.fromDate || '').trim();
      const rawDateTo = String(body?.dateTo || body?.toDate || '').trim();
      const dateFromMs = rawDateFrom
        ? toDateMs(rawDateFrom.includes('T') ? rawDateFrom : `${rawDateFrom}T00:00:00.000Z`)
        : 0;
      const dateToMs = rawDateTo
        ? toDateMs(rawDateTo.includes('T') ? rawDateTo : `${rawDateTo}T23:59:59.999Z`)
        : 0;

      if (!promoCode) {
        sendJson(res, 400, { ok: false, error: 'missing-promo-code', message: 'Le code promo du membre est requis.' });
        return;
      }

      const memberRef = db.collection('affiliateMembers').doc(promoCode);
      const memberSnap = await memberRef.get();
      if (!memberSnap.exists) {
        sendJson(res, 404, { ok: false, error: 'affiliate-member-not-found', message: 'Le membre affiliation est introuvable.' });
        return;
      }

      const memberData = memberSnap.data() || {};
      const memberSnapshot = buildAffiliateMemberSnapshot({ ...memberData, promoCode });
      const earningsSnap = await db.collection('affiliateEarnings').where('promoCode', '==', promoCode).get();
      const pendingEarnings = earningsSnap.docs
        .map((snap) => ({ id: snap.id, ...(snap.data() || {}) }))
        .filter((entry) => String(entry?.status || 'pending').trim().toLowerCase() !== 'paid')
        .filter((entry) => {
          const createdAtMs = toDateMs(entry?.createdAt);
          if (dateFromMs && createdAtMs < dateFromMs) return false;
          if (dateToMs && createdAtMs > dateToMs) return false;
          return true;
        })
        .sort((a, b) => toDateMs(a?.createdAt) - toDateMs(b?.createdAt));

      if (!pendingEarnings.length) {
        sendJson(res, 400, {
          ok: false,
          error: 'no-affiliate-balance',
          message: 'Aucun gain affiliation en attente pour cette periode.'
        });
        return;
      }

      const now = new Date().toISOString();
      const amount = pendingEarnings.reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.amount)), 0);
      const eligibleSubtotalAmount = pendingEarnings.reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.eligibleSubtotal)), 0);
      const discountAmount = pendingEarnings.reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.discountAmount)), 0);
      const ratesUsed = Array.from(new Set(pendingEarnings.map((entry) => Math.max(0, toNumber(entry?.affiliateRate))).filter((value) => value > 0)));
      const allRemainingPendingAmount = earningsSnap.docs
        .map((snap) => ({ id: snap.id, ...(snap.data() || {}) }))
        .filter((entry) => String(entry?.status || 'pending').trim().toLowerCase() !== 'paid')
        .filter((entry) => !pendingEarnings.some((selected) => selected.id === entry.id))
        .reduce((sum, entry) => sum + Math.max(0, toNumber(entry?.amount)), 0);

      const payoutRef = db.collection('affiliatePayouts').doc();
      const payout = {
        promoCode,
        ...memberSnapshot,
        reportNumber: createAffiliatePayoutReportNumber(payoutRef.id),
        affiliateRate: ratesUsed.length === 1 ? ratesUsed[0] : Math.max(0, toNumber(memberData?.affiliateRate)),
        ratesUsed,
        eligibleSubtotalAmount,
        discountAmount,
        amount,
        usageCount: pendingEarnings.length,
        earningIds: pendingEarnings.map((entry) => entry.id),
        orderIds: Array.from(new Set(pendingEarnings.map((entry) => String(entry?.orderId || '').trim()).filter(Boolean))),
        periodStart: pendingEarnings[0]?.createdAt || now,
        periodEnd: pendingEarnings[pendingEarnings.length - 1]?.createdAt || now,
        paidAt: now,
        createdAt: now,
        updatedAt: now,
        paidBy: decodedUser.uid,
        status: 'paid'
      };

      const batch = db.batch();
      batch.set(payoutRef, payout, { merge: true });
      pendingEarnings.forEach((entry) => {
        batch.set(db.collection('affiliateEarnings').doc(entry.id), {
          status: 'paid',
          paidAt: now,
          updatedAt: now,
          payoutId: payoutRef.id
        }, { merge: true });
      });
      batch.set(memberRef, {
        pendingAmount: Math.max(0, allRemainingPendingAmount),
        lastPaidAt: now,
        updatedAt: now
      }, { merge: true });
      await batch.commit();

      sendJson(res, 200, {
        ok: true,
        payout: {
          id: payoutRef.id,
          ...payout
        }
      });
    } catch (error) {
      logger.error('AFFILIATE_ADMIN payout:error', {
        message: error?.message || 'unknown-error',
        stack: error?.stack || ''
      });
      sendJson(res, 500, { ok: false, error: 'affiliate-payout-failed', message: 'Impossible de payer ce membre affiliation.' });
    }
  }
);

exports.moncashAlert = onRequest(
  { region: REGION, secrets: [MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY, JWETPRO_INTEGRATION_SECRET] },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (!['GET', 'POST'].includes(req.method)) {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    const body = parseBody(req);
    const sessionId = String(body.session_id || body.sessionId || req.query.session_id || req.query.sessionId || '').trim();
    const orderId = String(
      body.orderId || body.order_id || body.reference || req.query.orderId || req.query.order_id || req.query.reference || ''
    ).trim();
    const transactionId = String(
      body.transactionId || body.transaction_id || req.query.transactionId || req.query.transaction_id || ''
    ).trim();

    if (!sessionId && !orderId && !transactionId) {
      sendJson(res, 400, { ok: false, error: 'missing-payment-reference' });
      return;
    }

    // Les intents du module Facturation utilisent le meme compte MonCash et le
    // meme alert URL marchand. Route-les vers leur verificateur dedie avant le
    // flux e-commerce historique; la confirmation y est idempotente et revalide
    // toujours la transaction aupres de MonCash.
    if (orderId) {
      try {
        const billingIntent = await db.collection('billingPaymentIntents').doc(orderId).get();
        if (billingIntent.exists) {
          const callbackUrl = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/billingPaymentCallback`;
          const callbackResponse = await fetch(callbackUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId, transactionId })
          });
          const callbackBody = await callbackResponse.json().catch(() => ({ ok: callbackResponse.ok }));
          if (req.method === 'GET') {
            res.redirect(302, buildReturnPageUrl({ orderId, transactionId, status: callbackResponse.ok ? '' : 'failed' }));
            return;
          }
          sendJson(res, callbackResponse.ok ? 200 : 409, callbackBody);
          return;
        }
      } catch (billingError) {
        logger.error('Billing MonCash alert routing failed', billingError);
        if (req.method === 'POST') {
          sendJson(res, 500, { ok: false, error: 'billing-sync-failed' });
          return;
        }
      }
    }

      try {
        const result = await resolveAndSyncPayment({
          sessionId,
          orderId,
          transactionId,
          source: 'alert'
        });
        const clientId = result.session?.data?.clientId || '';
        const resolvedOrderId = result.syncResult?.orderId || result.details?.orderId || result.session?.data?.orderId || '';
        const order = await getOrderRecord(clientId, resolvedOrderId);

        const responseBody = buildStatusResponse({
          session: result.session,
          details: result.details,
          syncResult: result.syncResult,
          fallbackSessionId: sessionId,
          order
        });

        if (req.method === 'GET') {
          res.redirect(302, buildReturnPageUrl({
            sessionId: responseBody.sessionId,
            orderId: responseBody.orderId,
            transactionId: responseBody.transactionId,
            status: responseBody.status === 'failed' ? 'failed' : ''
          }));
          return;
        }

        sendJson(res, 200, responseBody);
      } catch (error) {
      logger.error('MonCash alert sync failed', error);
      if (req.method === 'GET') {
        res.redirect(302, buildReturnPageUrl({
          sessionId,
          orderId,
          transactionId,
          status: 'failed'
        }));
        return;
      }
      sendJson(res, 500, {
        ok: false,
        error: 'sync-failed',
        message: error?.message || 'Unable to synchronize MonCash payment'
      });
    }
  }
);

exports.getMoncashPaymentStatus = onRequest(
  { region: REGION, secrets: [MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY, JWETPRO_INTEGRATION_SECRET] },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    const sessionId = String(req.query.session_id || req.query.sessionId || '').trim();
    const orderId = String(req.query.order_id || req.query.orderId || req.query.reference || '').trim();
    const transactionId = String(req.query.transaction_id || req.query.transactionId || '').trim();

    if (!sessionId && !orderId && !transactionId) {
      sendJson(res, 400, { ok: false, error: 'missing-payment-reference' });
      return;
    }

    try {
      let session = null;
      if (sessionId) session = await findSessionBySessionId(sessionId);
      if (!session && transactionId) session = await findSessionByTransactionId(transactionId);
      if (!session && orderId) session = await findSessionByOrderId(orderId);

      const currentStatus = String(session?.data?.status || '').toLowerCase();
      const shouldRefreshFromProvider = Boolean(orderId || transactionId) || currentStatus !== 'paid';

        if (shouldRefreshFromProvider) {
          const result = await resolveAndSyncPayment({
            sessionId,
            orderId,
            transactionId,
            source: 'status'
          });
          const clientId = result.session?.data?.clientId || '';
          const resolvedOrderId = result.syncResult?.orderId || result.details?.orderId || result.session?.data?.orderId || '';
          const order = await getOrderRecord(clientId, resolvedOrderId);

          sendJson(res, 200, buildStatusResponse({
            session: result.session,
            details: result.details,
            syncResult: result.syncResult,
            fallbackSessionId: sessionId,
            order
          }));
          return;
        }

        const clientId = session?.data?.clientId || '';
        const order = await getOrderRecord(clientId, session?.data?.orderId || orderId);
        sendJson(res, 200, {
          ok: true,
          sessionId: session?.id || sessionId,
          status: session?.data?.status || 'pending',
          amount: session?.data?.amount || 0,
          currency: session?.data?.currency || MONCASH_CURRENCY,
          orderId: session?.data?.orderId || orderId,
          transactionId: session?.data?.providerTransactionId || transactionId,
          uniqueCode: order?.data?.uniqueCode || session?.data?.uniqueCode || '',
          orderStatus: session?.data?.status || '',
          paymentStatus: session?.data?.status || '',
          order: order ? { id: order.id, ...order.data } : null
        });
    } catch (error) {
      logger.error('MonCash status lookup failed', error);
      sendJson(res, 500, {
        ok: false,
        error: 'status-lookup-failed',
        message: error?.message || 'Unable to retrieve MonCash payment status'
      });
    }
  }
);

exports.createVendorDashboardAccess = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      const vendorProfile = await getVendorProfile(decodedUser.uid);
      if (!isApprovedVendorProfile(vendorProfile)) {
        sendJson(res, 403, { ok: false, error: 'vendor-access-denied' });
        return;
      }

      const customToken = await admin.auth().createCustomToken(decodedUser.uid, {
        role: 'vendor',
        vendorDashboard: true
      });

      const dashboardUrl = new URL('https://smartcutservices.github.io/dashboard-/DvendorProducts.html');
      dashboardUrl.searchParams.set('access_token', customToken);

      sendJson(res, 200, {
        ok: true,
        uid: decodedUser.uid,
        dashboardUrl: dashboardUrl.toString()
      });
    } catch (error) {
      logger.error('Vendor dashboard access bootstrap failed', error);
      sendJson(res, 500, {
        ok: false,
        error: 'vendor-dashboard-bootstrap-failed',
        message: error?.message || 'Unable to prepare vendor dashboard access'
      });
    }
  }
);

exports.getVendorDashboardAnalytics = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      const vendorProfile = await getVendorProfile(decodedUser.uid);
      if (!isApprovedVendorProfile(vendorProfile)) {
        sendJson(res, 403, { ok: false, error: 'vendor-access-denied' });
        return;
      }

      const vendorProductsSnap = await db.collection('vendorProducts').where('vendorId', '==', decodedUser.uid).get();
      const vendorProductIds = new Set(vendorProductsSnap.docs.map((item) => item.id));
      const payoutsSnap = await db.collection('vendorPayouts').where('vendorId', '==', decodedUser.uid).get();
      const settledVendorRefs = new Set();
      let settledNetAmount = 0;
      const payoutSummaries = [];
      let lastBlockingRequestMs = 0;
      let activeRequest = null;

      payoutsSnap.docs.forEach((snap) => {
        const payout = snap.data() || {};
        const summary = mapVendorPayoutSummary(snap.id, payout);
        payoutSummaries.push(summary);

        if (isPaidVendorPayout(summary)) {
          settledNetAmount += summary.netAmount;
          const coveredRefs = summary.coveredVendorRefs.length ? summary.coveredVendorRefs : summary.coveredOrderRefs;
          coveredRefs.forEach((refPath) => {
            const normalized = String(refPath || '').trim();
            if (normalized) settledVendorRefs.add(normalized);
          });
        }

        if (isOpenVendorPayoutRequest(summary) && !activeRequest) {
          activeRequest = summary;
        }

        const eventMs = getVendorPayoutEventMs(summary);
        if (eventMs > lastBlockingRequestMs && ['requested', 'pending', 'approved', 'paid'].includes(summary.status)) {
          lastBlockingRequestMs = eventMs;
        }
      });

      payoutSummaries.sort((a, b) => getVendorPayoutEventMs(b) - getVendorPayoutEventMs(a));
      activeRequest = payoutSummaries.find((entry) => isOpenVendorPayoutRequest(entry)) || null;

      const ordersSnap = await db.collectionGroup('orders').get();
      const monthBuckets = createMonthBuckets(6);
      const monthMap = new Map(monthBuckets.map((bucket) => [bucket.key, bucket]));
      const statusBreakdown = {
        confirmed: 0,
        pending: 0,
        review: 0,
        cancelled: 0
      };
      const topProducts = new Map();
      const recentOrders = [];

      let totalOrders = 0;
      let productGrossAmount = 0;
      let deliveryAmount = 0;
      let grossAmount = 0;
      let commissionAmount = 0;
      let vendorNetAmount = 0;
      let pendingPayoutAmount = 0;
      let itemCount = 0;

      ordersSnap.docs.forEach((snap) => {
        const order = snap.data() || {};
        const orderContext = getRelevantVendorOrderContext(order, decodedUser.uid, vendorProductIds, snap.ref.path);
        if (!orderContext) return;

        const status = normalizeOrderStatus(order);
        if (isConfirmedOrder(order)) {
          statusBreakdown.confirmed += 1;
        } else if (['awaiting_payment', 'redirect_ready', 'initiated', 'pending'].includes(status)) {
          statusBreakdown.pending += 1;
        } else if (['pending_review', 'review', 'processing'].includes(status)) {
          statusBreakdown.review += 1;
        } else {
          statusBreakdown.cancelled += 1;
        }

        if (!isConfirmedOrder(order)) return;

        totalOrders += 1;
        const createdAtMs = toDateMs(order?.paidAt || order?.updatedAt || order?.createdAt);
        const bucket = monthMap.get(toMonthKey(createdAtMs));

        orderContext.items.forEach((item) => {
          const productId = String(item?.productId || '').trim() || String(item?.sku || '').trim() || `product-${topProducts.size + 1}`;
          const existingProduct = topProducts.get(productId) || {
            productId,
            name: String(item?.name || 'Produit vendeur').trim(),
            quantity: 0,
            amount: 0
          };
          existingProduct.quantity += item.quantity;
          existingProduct.amount += item.grossAmount;
          topProducts.set(productId, existingProduct);
        });

        productGrossAmount += orderContext.productGrossAmount;
        deliveryAmount += orderContext.deliveryAmount;
        grossAmount += orderContext.grossAmount;
        commissionAmount += orderContext.commissionAmount;
        vendorNetAmount += orderContext.vendorNetAmount;
        itemCount += orderContext.itemCount;
        const vendorRef = createVendorCoveredRef(snap.ref.path, decodedUser.uid);
        if (!settledVendorRefs.has(vendorRef) && !settledVendorRefs.has(snap.ref.path)) {
          pendingPayoutAmount += orderContext.vendorNetAmount;
        }

        if (bucket) {
          bucket.amount += orderContext.grossAmount;
          bucket.orders += 1;
        }

        recentOrders.push({
          id: snap.id,
          uniqueCode: order?.uniqueCode || '',
          customerName: order?.customerName || '',
          createdAt: order?.paidAt || order?.updatedAt || order?.createdAt || '',
          productGrossAmount: orderContext.productGrossAmount,
          deliveryAmount: orderContext.deliveryAmount,
          amount: orderContext.grossAmount,
          items: orderContext.itemCount,
          status,
          vendorManagedDelivery: orderContext.vendorManagedDelivery
        });
      });

      const averageTicket = totalOrders > 0 ? grossAmount / totalOrders : 0;
      const topSellingProducts = Array.from(topProducts.values())
        .sort((a, b) => b.amount - a.amount || b.quantity - a.quantity)
        .slice(0, 5);

      recentOrders.sort((a, b) => toDateMs(b.createdAt) - toDateMs(a.createdAt));
      const nextRequestAtMs = lastBlockingRequestMs > 0
        ? lastBlockingRequestMs + (VENDOR_PAYOUT_REQUEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
        : 0;
      const canRequestPayout = !activeRequest && pendingPayoutAmount > 0 && (!nextRequestAtMs || Date.now() >= nextRequestAtMs);

      sendJson(res, 200, {
        ok: true,
        analytics: {
          totalOrders,
          itemCount,
          productGrossAmount,
          deliveryAmount,
          grossAmount,
          commissionAmount,
          vendorNetAmount,
          settledNetAmount,
          pendingPayoutAmount,
          averageTicket,
          timeline: monthBuckets,
          statusBreakdown,
          topProducts: topSellingProducts,
          recentOrders: recentOrders.slice(0, 6),
          payoutHistory: payoutSummaries.slice(0, 12),
          activePayoutRequest: activeRequest,
          paidPayoutsCount: payoutSummaries.filter((entry) => entry.status === 'paid').length,
          canRequestPayout,
          nextRequestAt: nextRequestAtMs ? new Date(nextRequestAtMs).toISOString() : '',
          cooldownDays: VENDOR_PAYOUT_REQUEST_COOLDOWN_DAYS
        }
      });
    } catch (error) {
      logger.error('Vendor analytics failed', error);
      sendJson(res, 500, {
        ok: false,
        error: 'vendor-analytics-failed',
        message: error?.message || 'Unable to load vendor analytics'
      });
    }
  }
);

exports.requestVendorPayout = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      const vendorProfile = await getVendorProfile(decodedUser.uid);
      if (!isApprovedVendorProfile(vendorProfile)) {
        sendJson(res, 403, { ok: false, error: 'vendor-access-denied' });
        return;
      }

      const payoutsSnap = await db.collection('vendorPayouts').where('vendorId', '==', decodedUser.uid).get();
      let latestBlockingRequestMs = 0;
      let openRequest = null;
      const settledVendorRefs = new Set();

      payoutsSnap.docs.forEach((snap) => {
        const summary = mapVendorPayoutSummary(snap.id, snap.data() || {});
        if (isPaidVendorPayout(summary)) {
          const coveredRefs = summary.coveredVendorRefs.length ? summary.coveredVendorRefs : summary.coveredOrderRefs;
          coveredRefs.forEach((refPath) => {
            const normalized = String(refPath || '').trim();
            if (normalized) settledVendorRefs.add(normalized);
          });
        }
        if (isOpenVendorPayoutRequest(summary) && !openRequest) {
          openRequest = summary;
        }
        const eventMs = getVendorPayoutEventMs(summary);
        if (eventMs > latestBlockingRequestMs && ['requested', 'pending', 'approved', 'paid'].includes(summary.status)) {
          latestBlockingRequestMs = eventMs;
        }
      });

      if (openRequest) {
        sendJson(res, 400, {
          ok: false,
          error: 'open-payout-request',
          message: 'Une demande de decaissement est deja en cours pour ce vendeur.',
          request: openRequest
        });
        return;
      }

      const nextRequestAtMs = latestBlockingRequestMs + (VENDOR_PAYOUT_REQUEST_COOLDOWN_DAYS * 24 * 60 * 60 * 1000);
      if (latestBlockingRequestMs > 0 && Date.now() < nextRequestAtMs) {
        sendJson(res, 400, {
          ok: false,
          error: 'payout-request-cooldown',
          message: 'Une nouvelle demande de decaissement est possible apres le delai de 30 jours.',
          nextRequestAt: new Date(nextRequestAtMs).toISOString()
        });
        return;
      }

      const vendorProductsSnap = await db.collection('vendorProducts').where('vendorId', '==', decodedUser.uid).get();
      const vendorProductIds = new Set(vendorProductsSnap.docs.map((item) => item.id));
      const ordersSnap = await db.collectionGroup('orders').get();
      const payoutMetrics = collectVendorOutstandingOrders({
        ordersSnap,
        vendorId: decodedUser.uid,
        vendorProductIds,
        settledVendorRefs
      });

      if (!payoutMetrics.outstandingOrders.length || payoutMetrics.netAmount <= 0) {
        sendJson(res, 400, {
          ok: false,
          error: 'no-outstanding-balance',
          message: 'Aucun solde vendeur disponible pour un decaissement.'
        });
        return;
      }

      const payoutIdentity = buildVendorPayoutProfile(vendorProfile);
      const payoutRef = db.collection('vendorPayouts').doc();
      const now = new Date().toISOString();
      const requestPayload = {
        vendorId: decodedUser.uid,
        ...payoutIdentity,
        reportNumber: createPayoutReportNumber(payoutRef.id),
        productGrossAmount: payoutMetrics.productGrossAmount,
        deliveryAmount: payoutMetrics.deliveryAmount,
        grossAmount: payoutMetrics.grossAmount,
        commissionAmount: payoutMetrics.commissionAmount,
        netAmount: payoutMetrics.netAmount,
        itemCount: payoutMetrics.itemCount,
        orderCount: payoutMetrics.outstandingOrders.length,
        coveredOrderRefs: [],
        coveredVendorRefs: [],
        coveredOrderIds: [],
        coveredOrders: [],
        availableOrderRefs: payoutMetrics.outstandingOrders.map((item) => item.refPath),
        availableVendorRefs: payoutMetrics.outstandingOrders.map((item) => item.vendorRef),
        availableOrderIds: payoutMetrics.outstandingOrders.map((item) => item.orderId),
        availableOrders: payoutMetrics.outstandingOrders,
        periodStart: payoutMetrics.periodStart,
        periodEnd: payoutMetrics.periodEnd,
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
        requestedBy: decodedUser.uid,
        status: 'requested',
        cooldownDays: VENDOR_PAYOUT_REQUEST_COOLDOWN_DAYS
      };

      await payoutRef.set(requestPayload, { merge: true });

      sendJson(res, 200, {
        ok: true,
        request: {
          id: payoutRef.id,
          ...requestPayload
        }
      });
    } catch (error) {
      logger.error('Vendor payout request failed', error);
      sendJson(res, 500, {
        ok: false,
        error: 'vendor-payout-request-failed',
        message: error?.message || 'Unable to create vendor payout request'
      });
    }
  }
);

exports.getVendorDashboardOrders = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      const vendorProfile = await getVendorProfile(decodedUser.uid);
      if (!isApprovedVendorProfile(vendorProfile)) {
        sendJson(res, 403, { ok: false, error: 'vendor-access-denied' });
        return;
      }

      const vendorProductsSnap = await db.collection('vendorProducts').where('vendorId', '==', decodedUser.uid).get();
      const vendorProductIds = new Set(vendorProductsSnap.docs.map((item) => item.id));
      const ordersSnap = await db.collectionGroup('orders').get();
      const orders = [];

      ordersSnap.docs.forEach((snap) => {
        const order = { id: snap.id, ...(snap.data() || {}) };
        const context = getRelevantVendorOrderContext(order, decodedUser.uid, vendorProductIds, snap.ref.path);
        if (!context) return;

        orders.push({
          id: snap.id,
          refPath: snap.ref.path,
          uniqueCode: context.uniqueCode,
          createdAt: context.paidAt || context.updatedAt || context.createdAt || '',
          paymentStatus: context.paymentStatus,
          fulfillmentStatus: context.fulfillmentStatus,
          productGrossAmount: context.productGrossAmount,
          deliveryAmount: context.deliveryAmount,
          grossAmount: context.grossAmount,
          commissionAmount: context.commissionAmount,
          vendorNetAmount: context.vendorNetAmount,
          itemCount: context.itemCount,
          vendorManagedDelivery: context.vendorManagedDelivery,
          deliveryModeLabel: context.deliveryModeLabel,
          customer: context.customer,
          delivery: context.delivery,
          items: context.items,
          downloadableReceipt: context.vendorManagedDelivery && isConfirmedOrder(order)
        });
      });

      orders.sort((a, b) => toDateMs(b.createdAt) - toDateMs(a.createdAt));

      sendJson(res, 200, {
        ok: true,
        orders
      });
    } catch (error) {
      logger.error('Vendor orders failed', error);
      sendJson(res, 500, {
        ok: false,
        error: 'vendor-orders-failed',
        message: error?.message || 'Unable to load vendor orders'
      });
    }
  }
);

exports.updateVendorOrderFulfillment = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid) {
        sendJson(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      const vendorProfile = await getVendorProfile(decodedUser.uid);
      if (!isApprovedVendorProfile(vendorProfile)) {
        sendJson(res, 403, { ok: false, error: 'vendor-access-denied' });
        return;
      }

      const body = parseBody(req);
      const orderId = String(body?.orderId || '').trim();
      const refPath = String(body?.refPath || '').trim();
      const requestedStatus = String(body?.fulfillmentStatus || 'delivered').trim().toLowerCase();
      const allowedStatuses = new Set(['ordered', 'shipped', 'in_delivery', 'delivered']);

      if (!orderId && !refPath) {
        sendJson(res, 400, { ok: false, error: 'missing-order-reference' });
        return;
      }

      if (!allowedStatuses.has(requestedStatus)) {
        sendJson(res, 400, { ok: false, error: 'invalid-fulfillment-status' });
        return;
      }

      const vendorProductsSnap = await db.collection('vendorProducts').where('vendorId', '==', decodedUser.uid).get();
      const vendorProductIds = new Set(vendorProductsSnap.docs.map((item) => item.id));

      let orderSnap = null;
      if (refPath) {
        const candidate = await db.doc(refPath).get();
        if (candidate.exists) orderSnap = candidate;
      }

      if (!orderSnap && orderId) {
        const ordersSnap = await db.collectionGroup('orders').get();
        orderSnap = ordersSnap.docs.find((snap) => snap.id === orderId) || null;
      }

      if (!orderSnap || !orderSnap.exists) {
        sendJson(res, 404, { ok: false, error: 'order-not-found' });
        return;
      }

      const order = { id: orderSnap.id, ...(orderSnap.data() || {}) };
      const context = getRelevantVendorOrderContext(order, decodedUser.uid, vendorProductIds, orderSnap.ref.path);
      if (!context) {
        sendJson(res, 403, { ok: false, error: 'vendor-order-access-denied' });
        return;
      }

      if (!context.vendorManagedDelivery) {
        sendJson(res, 403, { ok: false, error: 'delivery-not-managed-by-vendor' });
        return;
      }

      const now = new Date().toISOString();
      const vendorFulfillmentEntry = {
        vendorId: decodedUser.uid,
        status: requestedStatus,
        updatedAt: now,
        updatedBy: decodedUser.uid,
        itemCount: context.itemCount,
        deliveryAmount: context.deliveryAmount,
        orderId: orderSnap.id
      };
      const fulfillmentPatch = {
        vendorFulfillments: {
          [decodedUser.uid]: vendorFulfillmentEntry
        },
        vendorFulfillmentUpdatedAt: now,
        updatedAt: now
      };

      if (isVendorExclusiveOrder(order, decodedUser.uid)) {
        fulfillmentPatch.fulfillmentStatus = requestedStatus;
        fulfillmentPatch.fulfillmentUpdatedAt = now;
      }

      await orderSnap.ref.set(fulfillmentPatch, { merge: true });

      sendJson(res, 200, {
        ok: true,
        orderId: orderSnap.id,
        refPath: orderSnap.ref.path,
        fulfillmentStatus: requestedStatus,
        vendorFulfillment: vendorFulfillmentEntry,
        updatedAt: now
      });
    } catch (error) {
      logger.error('Vendor order fulfillment update failed', error);
      sendJson(res, 500, {
        ok: false,
        error: 'vendor-order-fulfillment-update-failed',
        message: error?.message || 'Unable to update vendor order fulfillment'
      });
    }
  }
);

exports.createVendorPayout = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid || !(await isAdminUser(decodedUser.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-access-denied' });
        return;
      }

      const body = parseBody(req);
      const vendorId = String(body?.vendorId || '').trim();
      const requestId = String(body?.requestId || '').trim();
      if (!vendorId) {
        sendJson(res, 400, { ok: false, error: 'missing-vendor-id' });
        return;
      }

      const vendorProfile = await getVendorProfile(vendorId);
      if (!isApprovedVendorProfile(vendorProfile)) {
        sendJson(res, 404, { ok: false, error: 'vendor-not-found' });
        return;
      }

      const vendorProductsSnap = await db.collection('vendorProducts').where('vendorId', '==', vendorId).get();
      const vendorProductIds = new Set(vendorProductsSnap.docs.map((item) => item.id));
      const payoutsSnap = await db.collection('vendorPayouts').where('vendorId', '==', vendorId).get();
      const settledVendorRefs = new Set();
      payoutsSnap.docs.forEach((snap) => {
        const payout = mapVendorPayoutSummary(snap.id, snap.data() || {});
        if (!isPaidVendorPayout(payout)) return;
        const coveredRefs = payout.coveredVendorRefs.length ? payout.coveredVendorRefs : payout.coveredOrderRefs;
        coveredRefs.forEach((refPath) => {
          const normalized = String(refPath || '').trim();
          if (normalized) settledVendorRefs.add(normalized);
        });
      });

      let existingRequest = null;
      if (requestId) {
        const requestSnap = await db.collection('vendorPayouts').doc(requestId).get();
        if (!requestSnap.exists) {
          sendJson(res, 404, { ok: false, error: 'payout-request-not-found' });
          return;
        }
        existingRequest = { id: requestSnap.id, ...(requestSnap.data() || {}) };
        if (String(existingRequest?.vendorId || '').trim() !== vendorId) {
          sendJson(res, 400, { ok: false, error: 'vendor-request-mismatch' });
          return;
        }
        if (isPaidVendorPayout(existingRequest)) {
          sendJson(res, 400, { ok: false, error: 'payout-request-already-paid' });
          return;
        }
      }

      const ordersSnap = await db.collectionGroup('orders').get();
      const { dateFromMs, dateToMs } = buildVendorPayoutDateRange(body);
      const payoutMetrics = collectVendorOutstandingOrders({
        ordersSnap,
        vendorId,
        vendorProductIds,
        settledVendorRefs,
        dateFromMs,
        dateToMs
      });

      if (!payoutMetrics.outstandingOrders.length || payoutMetrics.netAmount <= 0) {
        sendJson(res, 400, {
          ok: false,
          error: 'no-outstanding-balance',
          message: 'Aucun solde vendeur disponible pour un decaissement.'
        });
        return;
      }

      const now = new Date().toISOString();
      const payoutIdentity = buildVendorPayoutProfile(vendorProfile);
      const payoutRef = requestId
        ? db.collection('vendorPayouts').doc(requestId)
        : db.collection('vendorPayouts').doc();
      const payout = {
        vendorId,
        ...payoutIdentity,
        reportNumber: String(existingRequest?.reportNumber || '').trim() || createPayoutReportNumber(payoutRef.id),
        productGrossAmount: payoutMetrics.productGrossAmount,
        deliveryAmount: payoutMetrics.deliveryAmount,
        grossAmount: payoutMetrics.grossAmount,
        commissionAmount: payoutMetrics.commissionAmount,
        netAmount: payoutMetrics.netAmount,
        itemCount: payoutMetrics.itemCount,
        orderCount: payoutMetrics.outstandingOrders.length,
        coveredOrderRefs: payoutMetrics.outstandingOrders.map((item) => item.refPath),
        coveredVendorRefs: payoutMetrics.outstandingOrders.map((item) => item.vendorRef),
        coveredOrderIds: payoutMetrics.outstandingOrders.map((item) => item.orderId),
        coveredOrders: payoutMetrics.outstandingOrders,
        availableOrderRefs: [],
        availableVendorRefs: [],
        availableOrderIds: [],
        availableOrders: [],
        periodStart: payoutMetrics.periodStart,
        periodEnd: payoutMetrics.periodEnd,
        status: 'paid',
        requestedAt: existingRequest?.requestedAt || now,
        reviewedAt: now,
        paidAt: now,
        createdAt: existingRequest?.createdAt || now,
        updatedAt: now,
        createdBy: existingRequest?.createdBy || decodedUser.uid,
        requestedBy: existingRequest?.requestedBy || '',
        approvedBy: decodedUser.uid
      };

      await payoutRef.set(payout, { merge: true });

      sendJson(res, 200, {
        ok: true,
        payout: {
          id: payoutRef.id,
          ...payout
        }
      });
    } catch (error) {
      logger.error('Vendor payout failed', error);
      sendJson(res, 500, {
        ok: false,
        error: 'vendor-payout-failed',
        message: error?.message || 'Unable to create vendor payout'
      });
    }
  }
);

async function executeSmartCaisseSale({ decodedUser, body = {} }) {
  const access = await getSmartManagementAccess(decodedUser.uid);
  if (!access.allowed || !['admin', 'manager', 'caissier'].includes(access.role)) {
    return { status: 403, body: { ok: false, error: 'smart-management-access-denied' } };
  }

  const idempotencyKey = sanitizeText(body.idempotencyKey, 180);
  const reference = sanitizeText(body.reference || `CAISSE-${Date.now()}`, 180);
  const reason = sanitizeText(body.reason || 'Vente en magasin', 180);
  const note = sanitizeText(body.note || '', 900);
  const rawItems = Array.isArray(body.items) ? body.items : [];
  const items = rawItems.map((item) => ({
    productId: sanitizeText(item?.productId, 160),
    variantId: sanitizeText(item?.variantId || '', 160),
    sourceType: sanitizeText(item?.sourceType || '', 80),
    vendorId: sanitizeText(item?.vendorId || '', 160),
    quantity: normalizeStockQuantity(item?.quantity),
    unitCost: Math.max(0, toNumber(item?.unitCost))
  }));

  if (!idempotencyKey) return { status: 400, body: { ok: false, error: 'missing-idempotency-key' } };
  if (!items.length || items.some((item) => !item.productId || !Number.isInteger(item.quantity) || item.quantity <= 0)) {
    return { status: 400, body: { ok: false, error: 'invalid-sale-items', message: 'Les articles de la vente sont invalides.' } };
  }

  const operationRef = db.collection(SMART_STOCK_OPERATIONS_COLLECTION).doc(idempotencyKey);
  const movementIds = [];

  await db.runTransaction(async (transaction) => {
    const operationSnap = await transaction.get(operationRef);
    if (operationSnap.exists) {
      const operation = operationSnap.data() || {};
      if (operation.status === 'completed') {
        movementIds.push(...(Array.isArray(operation.movementIds) ? operation.movementIds : []));
        return;
      }
      throw new Error('Cette vente est deja en cours ou incomplete.');
    }

    const seen = new Set();
    const prepared = [];
    for (const item of items) {
      const key = `${item.sourceType || 'smart-cut'}|${item.vendorId}|${item.productId}|${item.variantId || 'simple'}`;
      if (seen.has(key)) throw new Error('Articles dupliques dans la vente.');
      seen.add(key);

      const collectionName = getProductCollectionName(item);
      const productRef = db.collection(collectionName).doc(item.productId);
      const productSnap = await transaction.get(productRef);
      if (!productSnap.exists) throw new Error('Produit introuvable.');
      const product = productSnap.data() || {};
      if (String(product.status || '').toLowerCase() === 'inactive' || product.active === false) {
        throw new Error('Produit inactif: vente refusee.');
      }
      if (product.isDigitalProduct === true || product.productType === 'digital') continue;

      const stockField = ['stock', 'totalStock', 'quantity', 'qty'].find((field) => (
        product[field] !== undefined && product[field] !== null && product[field] !== ''
      ));
      const currentStock = stockField ? normalizeStockQuantity(product[stockField]) : NaN;

      const variantsField = Array.isArray(product.variants) ? 'variants' : Array.isArray(product.variations) ? 'variations' : '';
      const variants = variantsField ? product[variantsField] : [];
      let variantIndex = -1;
      if (item.variantId) {
        variantIndex = variants.findIndex((variant, index) => (
          String(variant?.id || variant?.variantId || variant?.sku || `variant-${index + 1}`) === item.variantId
        ));
        if (variantIndex < 0) throw new Error('Variante invalide pour ce produit.');
      } else if (variants.length) {
        throw new Error('Variante obligatoire pour ce produit.');
      }

      const selectedVariant = variantIndex >= 0 ? variants[variantIndex] : null;
      const variantStockField = selectedVariant
        ? ['stock', 'totalStock', 'quantity', 'qty'].find((field) => (
          selectedVariant[field] !== undefined && selectedVariant[field] !== null && selectedVariant[field] !== ''
        ))
        : '';
      const currentVariantStock = variantStockField ? normalizeStockQuantity(selectedVariant[variantStockField]) : NaN;
      if (!Number.isInteger(currentStock) && !Number.isInteger(currentVariantStock)) {
        throw new Error(`Stock introuvable pour ${product.name || product.title || 'ce produit'}.`);
      }
      if (Number.isInteger(currentStock) && currentStock < item.quantity) {
        throw new Error(`Stock insuffisant pour ${product.name || product.title || 'ce produit'}.`);
      }
      if (Number.isInteger(currentVariantStock) && currentVariantStock < item.quantity) {
        throw new Error(`Stock insuffisant pour ${product.name || product.title || 'ce produit'}.`);
      }

      prepared.push({ item, productRef, product, stockField, currentStock, variantsField, variants, variantIndex, variantStockField, currentVariantStock });
    }

    for (const entry of prepared) {
      const { item, productRef, product, stockField, currentStock, variantsField, variants, variantIndex, variantStockField, currentVariantStock } = entry;
      const nextStock = Number.isInteger(currentStock) ? currentStock - item.quantity : null;
      const nextVariantStock = Number.isInteger(currentVariantStock) ? currentVariantStock - item.quantity : null;
      const movementBefore = Number.isInteger(currentStock) ? currentStock : currentVariantStock;
      const movementAfter = Number.isInteger(nextStock) ? nextStock : nextVariantStock;
      const patch = { updatedAt: getAdminTimestamp() };
      if (stockField && Number.isInteger(nextStock)) patch[stockField] = nextStock;
      if (variantsField && variantIndex >= 0 && variantStockField) {
        const nextVariants = variants.map((variant) => ({ ...variant }));
        const variant = { ...nextVariants[variantIndex] };
        variant[variantStockField] = Math.max(0, nextVariantStock);
        nextVariants[variantIndex] = variant;
        patch[variantsField] = nextVariants;
      }
      transaction.update(productRef, patch);

      const movementRef = db.collection(SMART_STOCK_MOVEMENTS_COLLECTION).doc();
      transaction.set(movementRef, {
        type: 'POS_SALE',
        reference,
        productId: item.productId,
        productName: sanitizeText(product.name || product.title || 'Produit', 220),
        variantId: item.variantId || '',
        locationId: '',
        locationName: 'Caisse globale',
        beforePhysicalQty: movementBefore,
        beforeAvailableQty: movementBefore,
        quantityChange: -item.quantity,
        afterPhysicalQty: movementAfter,
        afterAvailableQty: movementAfter,
        reason,
        note,
        businessReference: reference,
        unitCost: item.unitCost,
        salePrice: Math.max(0, toNumber(product.salePrice || product.price || product.basePrice || product.prix)),
        actorUid: decodedUser.uid,
        createdAt: getAdminTimestamp()
      });
      movementIds.push(movementRef.id);
    }

    transaction.set(operationRef, {
      idempotencyKey,
      operationType: 'POS_SALE_GLOBAL',
      reference,
      status: 'completed',
      movementIds,
      lineCount: prepared.length,
      actorUid: decodedUser.uid,
      reason,
      note,
      createdAt: getAdminTimestamp(),
      updatedAt: getAdminTimestamp()
    });
  });

  return { status: 200, body: { ok: true, movementIds, idempotencyKey } };
}

exports.smartCaisseSale = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }
    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid) {
        sendJson(res, 401, { ok: false, error: 'auth-required' });
        return;
      }
      const result = await executeSmartCaisseSale({ decodedUser, body: req.body || {} });
      sendJson(res, result.status, result.body);
    } catch (error) {
      logger.error('smartCaisseSale failed', { message: error?.message || String(error), stack: error?.stack || '' });
      sendJson(res, 400, { ok: false, error: 'smart-caisse-sale-failed', message: error?.message || 'Vente impossible.' });
    }
  }
);

exports.updateSmartManagementUserPassword = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid || !(await isAdminUser(decodedUser.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-required', message: 'Accès administrateur requis.' });
        return;
      }

      const uid = sanitizeText(req.body?.uid, 128);
      const password = String(req.body?.password || '');
      if (!uid || password.length < 6 || password.length > 128) {
        sendJson(res, 400, { ok: false, error: 'invalid-password', message: 'Le mot de passe doit contenir entre 6 et 128 caractères.' });
        return;
      }

      const smartUserRef = db.collection('smartManagementUsers').doc(uid);
      const smartUserSnap = await smartUserRef.get();
      if (!smartUserSnap.exists) {
        sendJson(res, 404, { ok: false, error: 'smart-management-user-not-found', message: 'Utilisateur Smart Management introuvable.' });
        return;
      }

      await admin.auth().updateUser(uid, { password });
      await smartUserRef.set({
        passwordUpdatedAt: getAdminTimestamp(),
        passwordUpdatedBy: decodedUser.uid,
        updatedAt: getAdminTimestamp(),
      }, { merge: true });

      sendJson(res, 200, { ok: true });
    } catch (error) {
      logger.error('updateSmartManagementUserPassword failed', {
        message: error?.message || String(error),
        stack: error?.stack || ''
      });
      sendJson(res, 400, { ok: false, error: 'smart-management-password-update-failed', message: 'Impossible de modifier le mot de passe.' });
    }
  }
);

exports.smartManagementStockOperation = onRequest(
  { region: REGION, cors: true },
  async (req, res) => {
    if (handleOptions(req, res)) return;
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid) {
        sendJson(res, 401, { ok: false, error: 'auth-required' });
        return;
      }
      const result = await executeSmartStockOperation({
        decodedUser,
        body: req.body || {}
      });
      sendJson(res, result.status, result.body);
    } catch (error) {
      logger.error('smartManagementStockOperation failed', {
        message: error?.message || String(error),
        stack: error?.stack || ''
      });
      sendJson(res, 400, {
        ok: false,
        error: 'stock-operation-failed',
        message: error?.message || 'Operation de stock impossible.'
      });
    }
  }
);

function buildWebsiteAnalyticsResponse({ sessions = [], events = [], days = 30 } = {}) {
  const safeDays = clampNumber(days, 7, 90, 30);
  const timeline = createAnalyticsBuckets(safeDays);
  const bucketMap = new Map(timeline.map((entry) => [entry.key, entry]));
  const pageMap = new Map();
  const sourceMap = new Map();
  const deviceMap = new Map();
  const browserMap = new Map();
  const osMap = new Map();
  const languageMap = new Map();
  const timeZoneMap = new Map();
  const eventMap = new Map();

  const nowMs = Date.now();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTodayMs = startOfToday.getTime();

  sessions.forEach((session) => {
    incrementCounter(sourceMap, session.source, () => ({
      label: session.source || 'direct',
      value: 0
    }));
    incrementCounter(deviceMap, session.deviceType, () => ({
      label: session.deviceType || 'desktop',
      value: 0
    }));
    incrementCounter(browserMap, session.browser, () => ({
      label: session.browser || 'Autre',
      value: 0
    }));
    incrementCounter(osMap, session.os, () => ({
      label: session.os || 'Autre',
      value: 0
    }));
    incrementCounter(languageMap, session.language, () => ({
      label: session.language || 'Inconnue',
      value: 0
    }));
    incrementCounter(timeZoneMap, session.timeZone, () => ({
      label: session.timeZone || 'Inconnu',
      value: 0
    }));
  });

  let pageViews = 0;
  events.forEach((event) => {
    incrementCounter(eventMap, event.eventName, () => ({
      label: event.eventName || 'event',
      value: 0
    }));

    const bucketKey = new Date(event.createdAtMs || 0).toISOString().slice(0, 10);
    const bucket = bucketMap.get(bucketKey);
    if (bucket && event.eventName === 'page_view') {
      bucket.pageViews += 1;
      if (event.sessionId) bucket._sessions.add(event.sessionId);
    }

    if (event.eventName !== 'page_view') return;
    pageViews += 1;

    const pagePath = sanitizePath(event.pagePath || '/');
    if (!pageMap.has(pagePath)) {
      pageMap.set(pagePath, {
        path: pagePath,
        title: sanitizeText(event.pageTitle || pagePath, 120) || pagePath,
        value: 0
      });
    }
    pageMap.get(pagePath).value += 1;
  });

  const uniqueVisitors = sessions.length;
  const activeToday = sessions.filter((session) => Number(session.lastSeenAtMs || 0) >= startOfTodayMs).length;
  const newVisitors = sessions.filter((session) => Number(session.firstSeenAtMs || 0) >= (nowMs - safeDays * 86400000)).length;

  const finalizedTimeline = timeline.map((entry) => ({
    key: entry.key,
    label: entry.label,
    pageViews: entry.pageViews,
    uniqueVisitors: entry._sessions.size
  }));

  const recentSessions = sessions
    .slice()
    .sort((a, b) => Number(b.lastSeenAtMs || 0) - Number(a.lastSeenAtMs || 0))
    .slice(0, 20)
    .map((session) => ({
      sessionId: session.sessionId,
      firstSeenAt: session.firstSeenAt || '',
      lastSeenAt: session.lastSeenAt || '',
      pageViews: Number(session.pageViews || 0),
      landingPath: session.landingPath || '/',
      landingTitle: session.landingTitle || '',
      source: session.source || 'direct',
      deviceType: session.deviceType || 'desktop',
      browser: session.browser || 'Autre',
      os: session.os || 'Autre',
      language: session.language || '',
      timeZone: session.timeZone || '',
      regionHint: session.regionHint || ''
    }));

  return {
    summary: {
      uniqueVisitors,
      newVisitors,
      activeToday,
      pageViews,
      averagePagesPerSession: uniqueVisitors ? Number((pageViews / uniqueVisitors).toFixed(2)) : 0,
      checkoutStarts: eventMap.get('begin_checkout')?.value || 0,
      cartAdds: eventMap.get('add_to_cart')?.value || 0
    },
    timeline: finalizedTimeline,
    topPages: Array.from(pageMap.values()).sort((a, b) => b.value - a.value).slice(0, 10),
    sources: finalizeCounterMap(sourceMap),
    devices: finalizeCounterMap(deviceMap),
    browsers: finalizeCounterMap(browserMap),
    operatingSystems: finalizeCounterMap(osMap),
    languages: finalizeCounterMap(languageMap),
    timeZones: finalizeCounterMap(timeZoneMap),
    events: finalizeCounterMap(eventMap, { limit: 12 }),
    recentSessions
  };
}

exports.trackWebsiteVisit = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const body = parseBody(req);
      const now = new Date();
      const nowMs = now.getTime();
      const userAgent = sanitizeText(req.headers['user-agent'] || body.userAgent || '', 400);
      const sessionId = sanitizeText(body.sessionId || '', 120);
      const visitorId = sanitizeText(body.visitorId || '', 120);

      if (!sessionId || !visitorId) {
        sendJson(res, 400, { ok: false, error: 'missing-session' });
        return;
      }

      const eventName = sanitizeAnalyticsEventName(body.eventName || 'page_view');
      const pagePath = sanitizePath(body.pagePath || '/');
      const pageTitle = sanitizeText(body.pageTitle || pagePath, 160);
      const referrer = sanitizeText(body.referrer || req.headers.referer || '', 320);
      const language = sanitizeText(body.language || req.headers['accept-language'] || '', 64);
      const timeZone = sanitizeText(body.timeZone || '', 80);
      const source = inferTrafficSource(referrer, body.source || '');
      const deviceType = sanitizeText(body.deviceType || detectDeviceType({ userAgent, viewport: body.viewport }), 32);
      const browser = sanitizeText(body.browser || detectBrowserFromUserAgent(userAgent), 64);
      const os = sanitizeText(body.os || detectOsFromUserAgent(userAgent), 64);
      const viewport = sanitizeText(body.viewport || '', 40);
      const screen = sanitizeText(body.screen || '', 40);
      const regionHint = sanitizeText(body.regionHint || parseLanguageRegion(language), 12);
      const ipHash = hashValue(getClientIp(req));

      const sessionRef = db.collection('websiteAnalyticsSessions').doc(sessionId);
      const sessionSnap = await sessionRef.get();
      const existing = sessionSnap.exists ? (sessionSnap.data() || {}) : {};
      const pageViews = Number(existing.pageViews || 0) + (eventName === 'page_view' ? 1 : 0);

      await sessionRef.set({
        sessionId,
        visitorId,
        firstSeenAt: existing.firstSeenAt || now.toISOString(),
        firstSeenAtMs: Number(existing.firstSeenAtMs || nowMs),
        lastSeenAt: now.toISOString(),
        lastSeenAtMs: nowMs,
        landingPath: existing.landingPath || pagePath,
        landingTitle: existing.landingTitle || pageTitle,
        latestPath: pagePath,
        latestTitle: pageTitle,
        source,
        deviceType,
        browser,
        os,
        language,
        regionHint,
        timeZone,
        viewport,
        screen,
        referrer: existing.referrer || referrer,
        pageViews,
        ipHash
      }, { merge: true });

      await db.collection('websiteAnalyticsEvents').add({
        sessionId,
        visitorId,
        eventName,
        pagePath,
        pageTitle,
        referrer,
        source,
        deviceType,
        browser,
        os,
        language,
        regionHint,
        timeZone,
        viewport,
        screen,
        ipHash,
        createdAt: now.toISOString(),
        createdAtMs: nowMs
      });

      sendJson(res, 200, {
        ok: true,
        tracked: eventName,
        sessionId
      });
    } catch (error) {
      logger.error('Website analytics tracking failed', error);
      sendJson(res, 500, {
        ok: false,
        error: 'analytics-track-failed',
        message: error?.message || 'Unable to track website visit'
      });
    }
  }
);

exports.deleteClientAccount = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid || !(await isAdminUser(decodedUser.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-access-denied' });
        return;
      }

      const body = parseBody(req);
      const clientId = sanitizeText(body?.clientId || body?.uid || '', 160);
      if (!clientId) {
        sendJson(res, 400, { ok: false, error: 'missing-client-id', message: 'Client introuvable.' });
        return;
      }

      if (clientId === decodedUser.uid) {
        sendJson(res, 400, { ok: false, error: 'cannot-delete-self', message: 'Un admin ne peut pas supprimer son propre compte ici.' });
        return;
      }

      const clientRef = db.collection('clients').doc(clientId);
      const clientSnap = await clientRef.get();
      if (!clientSnap.exists) {
        sendJson(res, 404, { ok: false, error: 'client-not-found', message: 'Client introuvable.' });
        return;
      }

      const clientData = clientSnap.data() || {};
      if (String(clientData.role || '').toLowerCase() === 'admin') {
        sendJson(res, 400, { ok: false, error: 'admin-client-protected', message: 'Ce compte admin est protege.' });
        return;
      }

      const wasVendorAccount = String(clientData.role || clientData.vendorStatus || '').toLowerCase() === 'vendor'
        || String(clientData.vendorStatus || '').trim() !== ''
        || Boolean(clientData.vendorId);

      let authDeleted = false;
      try {
        await admin.auth().deleteUser(clientId);
        authDeleted = true;
      } catch (authError) {
        if (authError?.code !== 'auth/user-not-found') {
          logger.error('deleteClientAccount auth delete failed', {
            clientId,
            code: authError?.code || '',
            message: authError?.message || ''
          });
          sendJson(res, 500, {
            ok: false,
            error: 'auth-delete-failed',
            message: 'Impossible de supprimer le compte Auth du client. Les donnees Firestore n ont pas ete supprimees.'
          });
          return;
        }
      }

      const vendorCleanup = await deleteLinkedVendorAccount(clientId);

      if (typeof db.recursiveDelete === 'function') {
        await db.recursiveDelete(clientRef);
      } else {
        const ordersSnap = await clientRef.collection('orders').get();
        await Promise.all(ordersSnap.docs.map((snap) => snap.ref.delete()));
        await clientRef.delete();
      }

      sendJson(res, 200, {
        ok: true,
        clientId,
        firestoreDeleted: true,
        authDeleted,
        wasVendorAccount,
        vendorCleanup,
        deletedBy: decodedUser.uid,
        deletedAt: new Date().toISOString()
      });
    } catch (error) {
      logger.error('deleteClientAccount failed', error);
      sendJson(res, 500, {
        ok: false,
        error: 'client-delete-failed',
        message: error?.message || 'Impossible de supprimer ce client.'
      });
    }
  }
);

exports.getWebsiteAnalytics = onRequest(
  { region: REGION },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    try {
      const decodedUser = await verifyBearerUser(req);
      if (!decodedUser?.uid || !(await isAdminUser(decodedUser.uid))) {
        sendJson(res, 403, { ok: false, error: 'admin-access-denied' });
        return;
      }

      const days = clampNumber(req.query.days, 7, 90, 30);
      const cutoffMs = Date.now() - (days * 86400000);

      const [sessionsSnap, eventsSnap] = await Promise.all([
        db.collection('websiteAnalyticsSessions').where('lastSeenAtMs', '>=', cutoffMs).get(),
        db.collection('websiteAnalyticsEvents').where('createdAtMs', '>=', cutoffMs).get()
      ]);

      const sessions = sessionsSnap.docs.map((item) => ({ id: item.id, ...(item.data() || {}) }));
      const events = eventsSnap.docs.map((item) => ({ id: item.id, ...(item.data() || {}) }));
      const analytics = buildWebsiteAnalyticsResponse({ sessions, events, days });

      sendJson(res, 200, {
        ok: true,
        rangeDays: days,
        analytics
      });
    } catch (error) {
      logger.error('Website analytics failed', error);
      sendJson(res, 500, {
        ok: false,
        error: 'website-analytics-failed',
        message: error?.message || 'Unable to load website analytics'
      });
    }
  }
);

exports.listSiteComments = onRequest({ region: REGION }, async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' });

  try {
    const requestedLimit = clampNumber(req.query?.limit, 1, 100, 30);
    const snapshot = await db.collection(SITE_COMMENTS_COLLECTION)
      .orderBy('createdAt', 'desc')
      .limit(requestedLimit)
      .get();
    const comments = snapshot.docs
      .map((item) => ({ id: item.id, ...(item.data() || {}) }))
      .filter((comment) => comment.status === 'published' && String(comment.text || '').trim())
      .map((comment) => ({
        id: comment.id,
        text: sanitizeText(comment.text, 500),
        source: comment.source || 'homepage',
        createdAt: comment.createdAt?.toDate?.()?.toISOString?.() || null
      }));
    return sendJson(res, 200, { ok: true, comments });
  } catch (error) {
    logger.error('List site comments failed', error);
    return sendJson(res, 500, { ok: false, error: 'comments-load-failed' });
  }
});

exports.submitSiteComment = onRequest({ region: REGION }, async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' });

  try {
    const body = parseBody(req);
    const text = sanitizeText(body.text, 500);
    if (text.length < 2) {
      return sendJson(res, 400, { ok: false, error: 'comment-too-short' });
    }

    const now = Date.now();
    const clientKey = hashValue(`${getClientIp(req)}|${String(req.headers['user-agent'] || '').slice(0, 160)}`) || 'anonymous';
    const rateLimitRef = db.collection(SITE_COMMENT_RATE_LIMITS_COLLECTION).doc(clientKey);
    const commentRef = db.collection(SITE_COMMENTS_COLLECTION).doc();

    await db.runTransaction(async (transaction) => {
      const rateLimitSnapshot = await transaction.get(rateLimitRef);
      const lastSubmittedAtMs = Number(rateLimitSnapshot.data()?.lastSubmittedAtMs || 0);
      if (lastSubmittedAtMs && now - lastSubmittedAtMs < SITE_COMMENT_MIN_INTERVAL_MS) {
        const error = new Error('comment-rate-limited');
        error.code = 'comment-rate-limited';
        throw error;
      }
      transaction.set(commentRef, {
        text,
        type: 'user',
        status: 'published',
        source: 'homepage',
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      transaction.set(rateLimitRef, {
        lastSubmittedAtMs: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });

    return sendJson(res, 201, { ok: true, id: commentRef.id });
  } catch (error) {
    if (error?.code === 'comment-rate-limited') {
      return sendJson(res, 429, {
        ok: false,
        error: 'comment-rate-limited',
        message: 'Veuillez patienter quelques secondes avant d’envoyer un autre message.'
      });
    }
    logger.error('Submit site comment failed', error);
    return sendJson(res, 500, { ok: false, error: 'comment-save-failed' });
  }
});

exports.deleteSiteComment = onRequest({ region: REGION }, async (req, res) => {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' });

  try {
    const user = await verifyBearerUser(req);
    if (!user || !(await isAdminUser(user.uid))) {
      return sendJson(res, 403, { ok: false, error: 'admin-required' });
    }
    const commentId = sanitizeText(parseBody(req).commentId, 160);
    if (!commentId || commentId.includes('/')) {
      return sendJson(res, 400, { ok: false, error: 'invalid-comment-id' });
    }
    await db.collection(SITE_COMMENTS_COLLECTION).doc(commentId).delete();
    return sendJson(res, 200, { ok: true, id: commentId });
  } catch (error) {
    logger.error('Delete site comment failed', error);
    return sendJson(res, 500, { ok: false, error: 'comment-delete-failed' });
  }
});

exports.productSharePage = onRequest(
  { region: REGION },
  async (req, res) => {
    try {
      const productId = extractSharedProductId(req);
      const preferredCollection = String(req.query.source || '').trim();
      const productUrl = buildProductPageAbsoluteUrl(productId);

      if (!productId) {
        res.set('Cache-Control', 'public, max-age=300');
        res.status(302).redirect(productUrl);
        return;
      }

      const product = await findPublicProductDocument(productId, preferredCollection);
      if (!product) {
        res.set('Cache-Control', 'public, max-age=300');
        res.status(302).redirect(productUrl);
        return;
      }

      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'public, max-age=600');
      res.status(200).send(buildProductShareHtml(product, productUrl));
    } catch (error) {
      logger.error('productSharePage failed', error);
      const fallbackUrl = buildProductPageAbsoluteUrl(extractSharedProductId(req));
      res.set('Cache-Control', 'public, max-age=120');
      res.status(302).redirect(fallbackUrl);
    }
  }
);

// Libere automatiquement les stocks reserves lorsque le client abandonne le
// paiement MonCash. La transaction et les marqueurs rendent l'operation idempotente.
exports.releaseExpiredInventoryReservations = onSchedule(
  { region: REGION, schedule: 'every 15 minutes', timeZone: 'America/Port-au-Prince' },
  async () => {
    const now = new Date().toISOString();
    const snapshot = await db.collection('paymentSessions')
      .where('inventoryReservationExpiresAt', '<=', now)
      .limit(100)
      .get();
    for (const sessionDoc of snapshot.docs) {
      try {
        await db.runTransaction(async (transaction) => {
          const fresh = await transaction.get(sessionDoc.ref);
          const session = fresh.data() || {};
          const status = String(session.status || '').toLowerCase();
          if (!session.inventoryReservedAt || session.inventoryReleasedAt || status === 'paid') return;
          const clientId = String(session.clientId || '').trim();
          const orderId = String(session.orderId || '').trim();
          if (!clientId || !orderId) return;
          const orderRef = db.collection('clients').doc(clientId).collection('orders').doc(orderId);
          const orderSnap = await transaction.get(orderRef);
          const orderItems = orderSnap.data()?.items || [];
          const bookingEntries = await readAutoBookingsForRelease(transaction, orderItems, sessionDoc.id);
          await restoreInventoryForItems(transaction, orderItems);
          bookingEntries.forEach(({ ref }) => transaction.set(ref, { paymentSessionId: admin.firestore.FieldValue.delete(), paymentOrderId: admin.firestore.FieldValue.delete(), updatedAt: now }, { merge: true }));
          transaction.set(sessionDoc.ref, { inventoryReleasedAt: now, status: status === 'failed' ? status : 'expired', updatedAt: now }, { merge: true });
          transaction.set(orderRef, { stockReservationStatus: 'released', status: status === 'failed' ? status : 'expired', updatedAt: now }, { merge: true });
        });
      } catch (error) {
        logger.error('Expired inventory reservation release failed', { sessionId: sessionDoc.id, message: error?.message || '' });
      }
    }
  }
);

// ============================================================
// SmartSolutionTek shared-core internals exposed for reuse.
// Additive only — does not change behavior of anything above.
// See ARCHITECTURE_SMARTSOLUTIONTEK.md §3 and §6.
// ============================================================
const __sstInternals = {
  admin,
  db,
  REGION,
  verifyBearerUser,
  isAdminUser,
  getVendorProfile,
  createMoncashRedirect,
  retrieveMoncashPayment,
  MONCASH_CLIENT_ID,
  MONCASH_CLIENT_SECRET,
  MONCASH_SECRET_API_KEY,
  MONCASH_BUSINESS_KEY
};

// Mount all SmartSolutionTek Cloud Functions (see functions/smartsolutiontek/index.js).
// Additive only: every export below is sst-prefixed and cannot collide with anything above.
// __sstInternals is intentionally kept OFF module.exports: the Cloud Functions deploy-time
// loader recursively walks every exported object looking for grouped/nested trigger
// definitions, and recursing into `admin`/`db` (deeply circular SDK internals) overflowed
// the stack. Passing it as a plain local avoids that walk entirely.
Object.assign(exports, require('./smartsolutiontek')(__sstInternals));

// SmartCut Facturation: proformas, MonCash entrant, ledger et retraits manuels.
// Chaque export est explicitement prefixe afin de rester additif au backend existant.
const __billingFunctions = require('./invoicing')(__sstInternals);
for (const [name, fn] of Object.entries(__billingFunctions)) {
  exports[`billing${name.charAt(0).toUpperCase()}${name.slice(1)}`] = fn;
}

// SmartCut Services marketplace. Additive: the existing invoicing exports stay unchanged.
const __marketplaceFunctions = require('./marketplace')(__sstInternals);
for (const [name, fn] of Object.entries(__marketplaceFunctions)) {
  exports[`marketplace${name.charAt(0).toUpperCase()}${name.slice(1)}`] = fn;
}

// Smart Cut Health (pharmacie, medecins, laboratoires) — Phase 1: Pharmacie.
// Chaque export est deja prefixe health* dans functions/health/index.js.
Object.assign(exports, require('./health')(__sstInternals));

// Smart Cut Auto & Parts — catalogue de pieces, compatibilite vehicule et garage client.
Object.assign(exports, require('./auto-parts')(__sstInternals));

// Smart Cut Education — espace professionnel et publication sécurisée.
Object.assign(exports, require('./education/publisher')(__sstInternals));
Object.assign(exports, require('./education/tutors')(__sstInternals));
