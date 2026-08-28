'use strict';

/**
 * Pure business logic for Smart Cut Health — Phase 1 (Pharmacy). No Firestore/Admin
 * SDK dependency here so it can be unit-tested without the emulator, same principle
 * as functions/smartsolutiontek/lib/*.js. Cloud Functions in ../index.js call into
 * this module for anything that isn't a direct read/write, and never let a client
 * supply a price, a status, or a search index directly — everything here recomputes
 * or validates from trusted server-side inputs.
 */

const PRESCRIPTION_STATUSES = [
  'RECEIVED', 'UNDER_REVIEW', 'VALIDATED', 'PRICE_CONFIRMED', 'PAYMENT_PENDING',
  'PAID', 'PREPARING', 'READY', 'DELIVERING', 'DELIVERED',
  'NEEDS_CLARIFICATION', 'REJECTED', 'CANCELLED'
];

// Allowed next-status set per current status. A transition not listed here is refused —
// this is the single source of truth the Cloud Functions check before any status write,
// so a prescription can never skip steps (e.g. RECEIVED straight to PAID) regardless of
// what a client requests.
const PRESCRIPTION_TRANSITIONS = {
  RECEIVED: ['UNDER_REVIEW', 'REJECTED', 'CANCELLED'],
  UNDER_REVIEW: ['VALIDATED', 'NEEDS_CLARIFICATION', 'REJECTED', 'CANCELLED'],
  NEEDS_CLARIFICATION: ['UNDER_REVIEW', 'CANCELLED'],
  VALIDATED: ['PRICE_CONFIRMED', 'CANCELLED'],
  PRICE_CONFIRMED: ['PAYMENT_PENDING', 'CANCELLED'],
  PAYMENT_PENDING: ['PAID', 'CANCELLED'],
  PAID: ['PREPARING'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERING', 'DELIVERED'],
  DELIVERING: ['DELIVERED'],
  DELIVERED: [],
  REJECTED: [],
  CANCELLED: []
};

const ORDER_FULFILLMENT_STATUSES = ['PAYMENT_PENDING', 'PAID', 'PREPARING', 'READY', 'DELIVERING', 'DELIVERED', 'CANCELLED'];

const ORDER_TRANSITIONS = {
  PAYMENT_PENDING: ['PAID', 'CANCELLED'],
  PAID: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERING', 'DELIVERED'],
  DELIVERING: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: []
};

function canTransitionPrescription(fromStatus, toStatus) {
  const allowed = PRESCRIPTION_TRANSITIONS[String(fromStatus || '')];
  return Array.isArray(allowed) && allowed.includes(String(toStatus || ''));
}

function canTransitionOrder(fromStatus, toStatus) {
  const allowed = ORDER_TRANSITIONS[String(fromStatus || '')];
  return Array.isArray(allowed) && allowed.includes(String(toStatus || ''));
}

/** User-facing French label for a prescription status — never show the raw enum to a patient. */
const PRESCRIPTION_STATUS_LABELS = {
  RECEIVED: 'Ordonnance reçue',
  UNDER_REVIEW: 'En cours de vérification',
  VALIDATED: "Vérifiée — en attente d'offres",
  PRICE_CONFIRMED: 'Prix confirmé',
  PAYMENT_PENDING: 'En attente de paiement',
  PAID: 'Payée',
  PREPARING: 'En préparation',
  READY: 'Prête',
  DELIVERING: 'En livraison',
  DELIVERED: 'Livrée',
  NEEDS_CLARIFICATION: 'Précision demandée',
  REJECTED: 'Non traitée',
  CANCELLED: 'Annulée'
};

function prescriptionStatusLabel(status) {
  return PRESCRIPTION_STATUS_LABELS[String(status || '')] || 'Statut inconnu';
}

/**
 * Computes an offer's total strictly from the pharmacy's own catalog prices — the
 * `items` a pharmacy submits (which productId, which quantity, available or not) are
 * trusted, but never a price on the item itself. `catalog` is a Map<productId, {price}>
 * built by the caller from a fresh Firestore read of that pharmacy's own products.
 * Throws if an item references a product not in the catalog (can't happen honestly —
 * either a stale id or an attempt to reference another pharmacy's product).
 */
function computeOfferTotal(items, catalog) {
  if (!Array.isArray(items) || !items.length) {
    throw new Error('at-least-one-item-required');
  }
  const lines = items.map((item) => {
    const productId = String(item?.productId || '').trim();
    const qty = Math.max(0, Math.floor(Number(item?.qty) || 0));
    const available = item?.available !== false;
    if (!productId) throw new Error('invalid-item-product-id');
    if (available && qty < 1) throw new Error('available-item-quantity-required');
    const product = catalog.get(productId);
    if (!product) throw new Error(`unknown-product:${productId}`);
    const unitPrice = Math.max(0, Number(product.price) || 0);
    const lineTotal = available ? unitPrice * qty : 0;
    return { productId, name: product.name || '', qty, available, unitPrice, lineTotal };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  const allAvailable = lines.every((line) => line.available);
  return { lines, subtotal, allAvailable };
}

const MAX_TEXT_LENGTH = 200;

function sanitizeText(value, maxLen = MAX_TEXT_LENGTH) {
  return String(value ?? '').trim().slice(0, maxLen);
}

/**
 * Validates and normalizes a medicine listing payload before it's written to
 * healthPharmacyProducts. Throws {code, message} on the first invalid field, in the
 * same shape functions/smartsolutiontek/lib/fieldTypes.js uses (caught by the Cloud
 * Function and turned into an HttpError). `pharmacyId` is never read from the payload
 * here — the caller (Cloud Function) always sets it from the verified auth token.
 */
function sanitizeMedicinePayload(raw = {}) {
  const name = sanitizeText(raw.name, 180);
  if (!name) throw { code: 'name-required', message: 'Le nom du médicament est requis.' };

  const price = Number(raw.price);
  if (!Number.isFinite(price) || price < 0) {
    throw { code: 'invalid-price', message: 'Le prix doit être un nombre positif.' };
  }

  const stock = Math.floor(Number(raw.stock));
  if (!Number.isFinite(stock) || stock < 0) {
    throw { code: 'invalid-stock', message: 'Le stock doit être un entier positif ou nul.' };
  }

  return {
    name,
    dci: sanitizeText(raw.dci, 180),
    dosage: sanitizeText(raw.dosage, 60),
    pharmaceuticalForm: sanitizeText(raw.pharmaceuticalForm, 60),
    manufacturer: sanitizeText(raw.manufacturer, 120),
    price,
    stock,
    prescriptionRequired: raw.prescriptionRequired === true,
    coldChainRequired: raw.coldChainRequired === true,
    notes: sanitizeText(raw.notes, 500)
  };
}

/**
 * Turns a medicine name into a set of lowercase, accent-stripped tokens for a basic
 * Firestore array-contains search (Firestore has no native full-text search). Applied
 * identically at write time (indexing) and read time (query) by the Cloud Functions —
 * never trust a client-submitted token list.
 */
function tokenizeSearchName(name) {
  const normalized = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip accents (combining diacritical marks)
    .replace(/[^a-z0-9\s]/g, ' ');
  const tokens = normalized.split(/\s+/).filter((token) => token.length >= 2);
  return Array.from(new Set(tokens)).slice(0, 20);
}

module.exports = {
  PRESCRIPTION_STATUSES,
  PRESCRIPTION_TRANSITIONS,
  ORDER_FULFILLMENT_STATUSES,
  ORDER_TRANSITIONS,
  canTransitionPrescription,
  canTransitionOrder,
  prescriptionStatusLabel,
  computeOfferTotal,
  sanitizeMedicinePayload,
  tokenizeSearchName,
  sanitizeText
};
