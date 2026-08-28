'use strict';

const PRICING_TYPES = new Set(['FIXED', 'STARTING_AT', 'CUSTOM_QUOTE']);
const PUBLICATION_STATUSES = new Set(['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'SUSPENDED', 'ARCHIVED']);
const REQUEST_STATUSES = new Set(['NEW', 'VIEWED', 'ACCEPTED', 'DECLINED', 'QUOTED', 'CANCELLED', 'EXPIRED']);
const ORDER_STATUSES = new Set(['AWAITING_PAYMENT', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'DELIVERED', 'REVISION_REQUESTED', 'COMPLETED', 'CANCELLED', 'DISPUTED', 'REFUNDED']);

function cleanText(value, max = 500) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function normalizeEmail(value) {
  const email = cleanText(value, 180).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('invalid-email');
  return email;
}

function slugify(value) {
  return cleanText(value, 180).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 90);
}

function asMinor(value, { allowZero = false } = {}) {
  const amount = Number(value);
  if (!Number.isSafeInteger(amount) || amount < (allowZero ? 0 : 1)) throw new Error('invalid-money');
  return amount;
}

function normalizeService(input = {}, previous = {}) {
  const name = cleanText(input.name, 160);
  const pricingType = String(input.pricingType || previous.pricingType || 'FIXED').toUpperCase();
  if (!name) throw new Error('service-name-required');
  if (!PRICING_TYPES.has(pricingType)) throw new Error('invalid-pricing-type');
  const priceMinor = pricingType === 'CUSTOM_QUOTE' ? 0 : asMinor(input.priceMinor ?? previous.priceMinor);
  const deliveryDays = Number(input.deliveryDays ?? previous.deliveryDays ?? 0);
  const revisionsIncluded = Number(input.revisionsIncluded ?? previous.revisionsIncluded ?? 0);
  if (!Number.isInteger(deliveryDays) || deliveryDays < 1 || deliveryDays > 365) throw new Error('invalid-delivery-days');
  if (!Number.isInteger(revisionsIncluded) || revisionsIncluded < 0 || revisionsIncluded > 50) throw new Error('invalid-revisions');
  return {
    name, slug: slugify(input.slug || name), shortDescription: cleanText(input.shortDescription, 220),
    fullDescription: cleanText(input.fullDescription || input.description, 5000), categoryId: cleanText(input.categoryId, 80),
    subcategoryId: cleanText(input.subcategoryId, 80), pricingType, priceMinor, startingPriceMinor: pricingType === 'STARTING_AT' ? priceMinor : 0,
    currency: 'HTG', deliveryDays, revisionsIncluded,
    extraRevisionPriceMinor: asMinor(input.extraRevisionPriceMinor ?? 0, { allowZero: true }),
    serviceArea: cleanText(input.serviceArea || 'REMOTE', 40), deliveryType: cleanText(input.deliveryType || 'DIGITAL', 40),
    requirements: list(input.requirements, 20, 300), deliverables: list(input.deliverables, 20, 300), tags: list(input.tags, 12, 40),
    coverImage: cleanText(input.coverImage, 700), gallery: list(input.gallery, 8, 700),
    terms: cleanText(input.terms, 3000), visibility: previous.visibility || 'PRIVATE',
    publicationStatus: previous.publicationStatus || 'DRAFT', archived: false
  };
}

function list(value, maxItems, maxLength) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\n,]/);
  return [...new Set(source.map((x) => cleanText(x, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function publicationChecklist(service, profile) {
  const missing = [];
  if (profile?.status !== 'ACTIVE' && profile?.status !== 'PENDING_REVIEW') missing.push('profil public');
  if (!service.name) missing.push('titre');
  if (!service.shortDescription || !service.fullDescription) missing.push('description');
  if (!service.categoryId) missing.push('catégorie');
  if (service.pricingType !== 'CUSTOM_QUOTE' && !service.priceMinor) missing.push('prix');
  if (!service.deliveryDays) missing.push('délai');
  if (!service.coverImage) missing.push('image');
  return missing;
}

function canTransitionOrder(from, to, actor) {
  const allowed = {
    AWAITING_PAYMENT: { system: ['PAID'], buyer: ['CANCELLED'] },
    PAID: { provider: ['ACCEPTED'], admin: ['CANCELLED', 'REFUNDED', 'DISPUTED'] },
    ACCEPTED: { provider: ['IN_PROGRESS'], admin: ['DISPUTED'] },
    IN_PROGRESS: { provider: ['DELIVERED'], buyer: ['DISPUTED'], admin: ['DISPUTED'] },
    DELIVERED: { buyer: ['COMPLETED', 'REVISION_REQUESTED', 'DISPUTED'], admin: ['DISPUTED'] },
    REVISION_REQUESTED: { provider: ['IN_PROGRESS', 'DELIVERED'], admin: ['DISPUTED'] },
    DISPUTED: { admin: ['COMPLETED', 'REFUNDED', 'CANCELLED'] }
  };
  return ORDER_STATUSES.has(from) && ORDER_STATUSES.has(to) && (allowed[from]?.[actor] || []).includes(to);
}

function calculateCommission(grossMinor, rule = {}) {
  asMinor(grossMinor);
  const basisPoints = rule.basisPoints;
  if (!Number.isInteger(basisPoints)) throw new Error('commission-unconfigured');
  if (basisPoints < 0 || basisPoints > 10000) throw new Error('invalid-commission');
  let commissionMinor = Math.round(grossMinor * basisPoints / 10000);
  if (Number.isSafeInteger(rule.minimumMinor)) commissionMinor = Math.max(commissionMinor, rule.minimumMinor);
  if (Number.isSafeInteger(rule.maximumMinor) && rule.maximumMinor > 0) commissionMinor = Math.min(commissionMinor, rule.maximumMinor);
  commissionMinor = Math.min(grossMinor, commissionMinor);
  return { grossMinor, commissionMinor, netMinor: grossMinor - commissionMinor, basisPoints };
}

function calculateRefundDebit(grossMinor, providerNetMinor, refundMinor) {
  asMinor(grossMinor); asMinor(providerNetMinor, { allowZero: true }); asMinor(refundMinor);
  if (providerNetMinor > grossMinor || refundMinor > grossMinor) throw new Error('invalid-refund');
  return Math.min(providerNetMinor, Math.round(providerNetMinor * refundMinor / grossMinor));
}

module.exports = { PRICING_TYPES, PUBLICATION_STATUSES, REQUEST_STATUSES, ORDER_STATUSES, cleanText, normalizeEmail, slugify, asMinor, normalizeService, publicationChecklist, canTransitionOrder, calculateCommission, calculateRefundDebit };
