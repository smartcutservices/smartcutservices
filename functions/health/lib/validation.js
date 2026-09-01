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

// Nouvelle (PAID) -> Acceptée (ACCEPTED) -> En préparation (PREPARING) -> Prête (READY)
// -> Remise/Livrée (DELIVERED, via DELIVERING for an in-transit delivery) -> Terminée
// (COMPLETED). REFUNDED is a distinct terminal state from CANCELLED: a pharmacy
// always *requests* "CANCELLED" (the same action button either way), but the caller
// (healthUpdateOrderFulfillment) stores REFUNDED instead whenever payment had already
// been captured (order.status was already past PAYMENT_PENDING) — see its own comment.
const ORDER_FULFILLMENT_STATUSES = ['PAYMENT_PENDING', 'PAID', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERING', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED'];

const ORDER_TRANSITIONS = {
  PAYMENT_PENDING: ['PAID', 'CANCELLED'],
  PAID: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERING', 'DELIVERED'],
  DELIVERING: ['DELIVERED'],
  DELIVERED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: []
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

// Reference lists for the pharmacy product form — kept here (not hardcoded twice in
// the frontend) so the catalog UI and the server validation always agree. The server
// never rejects a form/class outside these lists (a pharmacist's own wording for a
// niche product is still accepted as free text) — they exist to populate a clean
// dropdown, not to gate what can be sold.
const PHARMACEUTICAL_FORMS = [
  'Comprimé', 'Gélule/Capsule', 'Sirop', 'Solution buvable', 'Suspension buvable',
  'Poudre/Granulés', 'Solution injectable', 'Suspension injectable', 'Perfusion',
  'Crème', 'Pommade', 'Gel', 'Lotion', 'Collyre (gouttes ophtalmiques)',
  'Gouttes auriculaires', 'Gouttes nasales', 'Spray nasal', 'Aérosol/Inhalateur',
  'Suppositoire', 'Ovule vaginal', 'Patch transdermique', 'Solution pour bain de bouche',
  'Shampooing médicamenteux', 'Savon médicamenteux'
];

const THERAPEUTIC_CLASSES = [
  'Analgésiques / Antalgiques', 'Anti-inflammatoires non stéroïdiens (AINS)', 'Corticostéroïdes',
  'Antibiotiques', 'Antiviraux', 'Antifongiques / Antimycotiques', 'Antiparasitaires', 'Antipaludiques',
  'Antihypertenseurs', 'Diurétiques', 'Antiangineux', 'Antiarythmiques', 'Cardiotoniques',
  'Hypolipémiants', 'Anticoagulants', 'Antiagrégants plaquettaires', 'Antifibrinolytiques / Hémostatiques',
  'Antidiabétiques', 'Insulines', 'Hormones thyroïdiennes', 'Antithyroïdiens', 'Contraceptifs hormonaux',
  'Œstrogènes / Progestatifs', 'Androgènes', 'Antihistaminiques', 'Bronchodilatateurs', 'Antiasthmatiques',
  'Antitussifs', 'Expectorants / Mucolytiques', 'Décongestionnants', 'Antiulcéreux', 'Antiacides',
  'Antispasmodiques digestifs', 'Antiémétiques', 'Antidiarrhéiques', 'Laxatifs', 'Prokinétiques',
  'Anticonvulsivants', 'Antiépileptiques', 'Antidépresseurs', 'Anxiolytiques', 'Hypnotiques / Sédatifs',
  'Antipsychotiques / Neuroleptiques', 'Thymorégulateurs', 'Antiparkinsoniens', 'Antimigraineux',
  'Myorelaxants', 'Anesthésiques locaux', 'Anesthésiques généraux', 'Antiseptiques / Désinfectants',
  'Dermocorticoïdes', 'Anti-acnéiques', 'Émollients / Hydratants dermatologiques', 'Antiglaucomateux',
  'Mydriatiques / Cycloplégiques', 'Antiallergiques ophtalmiques', 'Antibiotiques ophtalmiques',
  'Médicaments ORL', 'Antigoutteux', 'Médicaments de l’ostéoporose', 'Vitamines',
  'Minéraux / Oligoéléments', 'Antianémiques', 'Solutions de réhydratation', 'Solutés de perfusion',
  'Immunosuppresseurs', 'Immunomodulateurs', 'Antinéoplasiques / Anticancéreux', 'Vaccins',
  'Immunoglobulines', 'Utérotoniques', 'Tocolytiques', 'Médicaments de l’hypertrophie bénigne de la prostate',
  'Médicaments de la dysfonction érectile', 'Anticholinergiques urinaires', 'Antidotes'
];

const MAX_PRODUCT_IMAGES = 6;

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

  const images = Array.isArray(raw.images)
    ? raw.images.map((url) => sanitizeText(url, 500)).filter(Boolean).slice(0, MAX_PRODUCT_IMAGES)
    : [];

  return {
    name,
    dci: sanitizeText(raw.dci, 180),
    dosage: sanitizeText(raw.dosage, 60),
    pharmaceuticalForm: sanitizeText(raw.pharmaceuticalForm, 60),
    therapeuticClass: sanitizeText(raw.therapeuticClass, 120),
    therapeuticSubclass: sanitizeText(raw.therapeuticSubclass, 120),
    activeIngredients: sanitizeText(raw.activeIngredients, 300),
    presentation: sanitizeText(raw.presentation, 200),
    manufacturer: sanitizeText(raw.manufacturer, 120),
    images,
    price,
    stock,
    prescriptionRequired: raw.prescriptionRequired === true,
    coldChainRequired: raw.coldChainRequired === true,
    active: raw.active !== false,
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

// ---------- Availability slots: no double-booking, no back-to-back overload ----------
//
// A provider (doctor/laboratory/imaging center) can never have two overlapping slots,
// and two consecutive slots must leave at least MIN_GAP_MINUTES between the end of one
// and the start of the next — this is what actually enforces "un rendez-vous ne peut
// commencer que 30 minutes après le précédent" from the spec. Pure function: takes the
// candidate range and the provider's other slots (already fetched from Firestore by the
// caller), returns whether publishing the candidate is allowed.

const MIN_SLOT_GAP_MINUTES = 30;

function slotConflictsWithExisting(candidateStartsAt, candidateEndsAt, existingSlots, gapMinutes = MIN_SLOT_GAP_MINUTES) {
  const start = new Date(candidateStartsAt).getTime();
  const end = new Date(candidateEndsAt).getTime();
  const gapMs = Math.max(0, gapMinutes) * 60_000;
  return (existingSlots || []).some((slot) => {
    const slotStart = new Date(slot.startsAt).getTime();
    const slotEnd = new Date(slot.endsAt).getTime();
    if (![slotStart, slotEnd].every(Number.isFinite)) return false;
    // Two ranges conflict if they overlap OR sit closer together than the required gap —
    // equivalent to padding each existing slot by `gapMinutes` on both sides before
    // testing for overlap with the candidate.
    return start < slotEnd + gapMs && end > slotStart - gapMs;
  });
}

// ---------- Teleconsultation session messaging: per-patient media caps ----------
//
// The plan the appointment was booked under caps how many photos/voice notes the
// PATIENT may send during a session (see teleconsultation-config.js — essential:1/1,
// advanced:5/3). The doctor's own messages never count against this cap. Pure
// function: given the patient's existing message docs for this appointment and the
// plan limits, says whether one more of `kind` is still allowed.
function canSendSessionMedia(existingPatientMessages, kind, limits) {
  const cap = kind === 'photo' ? Number(limits?.maxPhotos) : Number(limits?.maxVoiceMessages);
  if (!Number.isFinite(cap)) return false;
  const used = (existingPatientMessages || []).filter((message) => message.kind === kind).length;
  return used < cap;
}

const SESSION_MESSAGE_KINDS = ['text', 'photo', 'voice'];
const MAX_SESSION_TEXT_LENGTH = 2000;

function sanitizeSessionMessageText(value) {
  return sanitizeText(value, MAX_SESSION_TEXT_LENGTH);
}

// ---------- No-show handling ----------
//
// If the patient never joins within NO_SHOW_MINUTES of the session actually starting
// (DOCTOR_ACCEPTED -> IN_PROGRESS, i.e. the doctor is present), the session auto-closes:
// the professional is credited 0, the patient wallet is credited 0, Smart Cut Health
// keeps the full amount already paid — no ledger entry is created for anyone.
const NO_SHOW_GRACE_MINUTES = 5;

function isPastNoShowDeadline(sessionStartedAtIso, now = new Date()) {
  const startedAt = new Date(sessionStartedAtIso).getTime();
  if (!Number.isFinite(startedAt)) return false;
  return now.getTime() - startedAt >= NO_SHOW_GRACE_MINUTES * 60_000;
}

// ---------- Health professional payout cooldown ----------
//
// Distinct from the generic "one open request at a time" rule already enforced by
// functions/smartsolutiontek/payouts.js: Smart Cut Health additionally allows only one
// PAID payout per rolling 30-day window per professional.
const PAYOUT_COOLDOWN_DAYS = 30;

function isWithinPayoutCooldown(lastPaidAtIso, now = new Date()) {
  if (!lastPaidAtIso) return false;
  const lastPaidAt = new Date(lastPaidAtIso).getTime();
  if (!Number.isFinite(lastPaidAt)) return false;
  return now.getTime() - lastPaidAt < PAYOUT_COOLDOWN_DAYS * 24 * 60 * 60_000;
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
  sanitizeText,
  PHARMACEUTICAL_FORMS,
  THERAPEUTIC_CLASSES,
  MAX_PRODUCT_IMAGES,
  MIN_SLOT_GAP_MINUTES,
  slotConflictsWithExisting,
  SESSION_MESSAGE_KINDS,
  MAX_SESSION_TEXT_LENGTH,
  sanitizeSessionMessageText,
  canSendSessionMedia,
  NO_SHOW_GRACE_MINUTES,
  isPastNoShowDeadline,
  PAYOUT_COOLDOWN_DAYS,
  isWithinPayoutCooldown
};
