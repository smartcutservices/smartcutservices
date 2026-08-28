'use strict';

const VEHICLE_TYPES = new Set(['car', 'motorcycle', 'truck', 'equipment']);
const CONDITION_TYPES = new Set(['new', 'used', 'refurbished']);

function cleanText(value, maxLength = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function cleanList(value, maxItems = 40, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((entry) => cleanText(entry, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function normalizeVehicle(value = {}) {
  const type = cleanText(value.type, 30).toLowerCase();
  const year = Number.parseInt(value.year, 10);
  return {
    type: VEHICLE_TYPES.has(type) ? type : 'car',
    make: cleanText(value.make, 80),
    model: cleanText(value.model, 100),
    year: Number.isInteger(year) && year >= 1900 && year <= 2100 ? year : null,
    engine: cleanText(value.engine, 100),
    trim: cleanText(value.trim, 100)
  };
}

function normalizeFitment(value = {}) {
  const vehicle = normalizeVehicle(value);
  const from = Number.parseInt(value.yearFrom ?? vehicle.year, 10);
  const to = Number.parseInt(value.yearTo ?? vehicle.year, 10);
  return {
    type: vehicle.type,
    make: vehicle.make,
    model: vehicle.model,
    yearFrom: Number.isInteger(from) ? Math.max(1900, Math.min(2100, from)) : null,
    yearTo: Number.isInteger(to) ? Math.max(1900, Math.min(2100, to)) : null,
    engines: cleanList(value.engines?.length ? value.engines : [vehicle.engine], 30, 100),
    trims: cleanList(value.trims?.length ? value.trims : [vehicle.trim], 30, 100),
    notes: cleanText(value.notes, 300)
  };
}

function fitmentMatchesVehicle(fitment = {}, rawVehicle = {}) {
  const vehicle = normalizeVehicle(rawVehicle);
  const normalized = normalizeFitment(fitment);
  if (normalized.type !== vehicle.type) return false;
  if (normalized.make && normalized.make.toLowerCase() !== vehicle.make.toLowerCase()) return false;
  if (normalized.model && normalized.model.toLowerCase() !== vehicle.model.toLowerCase()) return false;
  if (vehicle.year && normalized.yearFrom && vehicle.year < normalized.yearFrom) return false;
  if (vehicle.year && normalized.yearTo && vehicle.year > normalized.yearTo) return false;
  if (vehicle.engine && normalized.engines.length && !normalized.engines.some((engine) => engine.toLowerCase() === vehicle.engine.toLowerCase())) return false;
  if (vehicle.trim && normalized.trims.length && !normalized.trims.some((trim) => trim.toLowerCase() === vehicle.trim.toLowerCase())) return false;
  return true;
}

function normalizePart(value = {}) {
  const title = cleanText(value.title || value.name, 180);
  const partNumber = cleanText(value.partNumber, 100).toUpperCase();
  const oemNumbers = cleanList(value.oemNumbers, 30, 100).map((number) => number.toUpperCase());
  const categoryId = cleanText(value.categoryId, 100);
  if (!title || !partNumber || !categoryId) throw new Error('invalid-part');
  return {
    title,
    normalizedTitle: title.toLowerCase(),
    partNumber,
    oemNumbers,
    brand: cleanText(value.brand, 100),
    categoryId,
    categoryName: cleanText(value.categoryName, 120),
    description: cleanText(value.description, 1500),
    fitments: (Array.isArray(value.fitments) ? value.fitments : []).map(normalizeFitment).slice(0, 100),
    keywords: cleanList(value.keywords, 40, 80).map((keyword) => keyword.toLowerCase()),
    publicationStatus: value.publicationStatus === 'published' ? 'published' : 'draft'
  };
}

function normalizePartNumber(value) {
  return cleanText(value, 100).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function selectRelevantAutoVendors(applications = [], category = '', limit = 30) {
  const categoryKey = cleanText(category, 100).toLowerCase();
  if (!categoryKey) return [];
  return applications.filter((application) => application?.status === 'approved' &&
    (application.specialties || []).some((value) => {
      const specialty = cleanText(value, 80).toLowerCase();
      return specialty && (categoryKey.includes(specialty) || specialty.includes(categoryKey));
    })).slice(0, limit);
}

function normalizeOffer(value = {}) {
  const price = Number(value.price);
  const stock = Number.parseInt(value.stock, 10);
  const condition = cleanText(value.condition, 30).toLowerCase();
  const canonicalPartId = cleanText(value.canonicalPartId, 160);
  if (!canonicalPartId || !Number.isFinite(price) || price <= 0 || !Number.isInteger(stock) || stock < 0) {
    throw new Error('invalid-offer');
  }
  return {
    canonicalPartId,
    price: Math.round(price * 100) / 100,
    stock,
    condition: CONDITION_TYPES.has(condition) ? condition : 'new',
    sku: cleanText(value.sku, 100),
    warranty: cleanText(value.warranty, 180),
    deliveryMode: cleanText(value.deliveryMode, 80),
    deliveryDelay: cleanText(value.deliveryDelay, 100),
    images: cleanList(value.images, 8, 1200),
    status: value.status === 'active' ? 'active' : cleanText(value.status, 30) || 'draft'
  };
}

function buildSearchTokens(part = {}) {
  return cleanList([
    part.title,
    part.partNumber,
    part.brand,
    part.categoryName,
    ...(part.oemNumbers || []),
    ...(part.keywords || [])
  ].flatMap((value) => cleanText(value, 180).toLowerCase().split(/[^a-z0-9à-ÿ]+/i)), 80, 80);
}

function reserveStockValue(currentValue, quantity) {
  const current = Number(currentValue);
  const requested = Number(quantity);
  if (!Number.isFinite(current) || !Number.isInteger(requested) || requested < 1 || current < requested) {
    throw new Error('insufficient-stock');
  }
  return current - requested;
}

module.exports = {
  VEHICLE_TYPES,
  cleanText,
  cleanList,
  normalizeVehicle,
  normalizeFitment,
  fitmentMatchesVehicle,
  normalizePart,
  normalizePartNumber,
  normalizeOffer,
  buildSearchTokens,
  selectRelevantAutoVendors
  ,reserveStockValue
};
