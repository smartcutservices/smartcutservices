'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { requireBearerUser, requireOrgRole, withErrorHandling, HttpError } = require('./auth');
const { registerResourceResolver } = require('./payments');
const { sanitizeColors, LAYOUTS } = require('./lib/branding');

function sanitizeOptionalString(value, maxLen) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str ? str.slice(0, maxLen) : null;
}

// Older products were saved as drafts even when their parent shop was already
// public. The dashboard has no explicit "save as draft" action, so these legacy
// records must be treated as visible until the owner explicitly suspends them.
function isPublicShopProduct(product = {}) {
  const status = String(product.status || '').trim();
  return !status || status === 'draft' || status === 'published';
}

/**
 * Application 2 — Mini-boutiques. Mirrors the exact same pattern as forms.js
 * (see ARCHITECTURE_SMARTSOLUTIONTEK.md §5: every application is a resource +
 * a public page + the shared paymentIntents flow). See DATA_MODEL.md §4 for the
 * planned schema this implements.
 */

const MAX_VARIANTS = 30;
const MAX_TAGS = 12;
const MAX_IMAGES = 8;
const MAX_ZONES = 20;
const VALID_ORDER_STATUSES = ['preparing', 'ready_for_pickup', 'shipped', 'delivered', 'cancelled'];
const VALID_CATALOG_STATUSES = ['draft', 'published', 'suspended', 'archived'];
const VALID_PRODUCT_STATUSES = ['draft', 'published', 'suspended', 'archived'];

function sanitizeVariants(variants) {
  if (!Array.isArray(variants)) return [];
  return variants.slice(0, MAX_VARIANTS).map((variant, index) => {
    const name = String(variant?.name || '').trim();
    if (!name) throw new HttpError(400, 'variant-name-required', 'Chaque variante doit avoir un nom.');
    const priceDelta = Number(variant?.priceDelta) || 0;
    const stock = Number.isFinite(Number(variant?.stock)) ? Math.max(0, Number(variant.stock)) : null;
    return {
      id: String(variant?.id || `variant_${index}`).trim(),
      name,
      priceDelta,
      stock,
      sku: sanitizeOptionalString(variant?.sku, 60)
    };
  });
}

function sanitizeDimensions(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const length = Number(raw.length);
  const width = Number(raw.width);
  const height = Number(raw.height);
  if (![length, width, height].every((n) => Number.isFinite(n) && n >= 0)) return null;
  return { length, width, height };
}

function sanitizeTags(rawTags) {
  if (!Array.isArray(rawTags)) return [];
  const seen = new Set();
  const tags = [];
  for (const raw of rawTags) {
    const tag = String(raw || '').trim().slice(0, 30);
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase());
      tags.push(tag);
      if (tags.length >= MAX_TAGS) break;
    }
  }
  return tags;
}

function sanitizeImagesAlt(rawAlt, imageCount) {
  const list = Array.isArray(rawAlt) ? rawAlt : [];
  return Array.from({ length: imageCount }, (_, i) => sanitizeOptionalString(list[i], 200) || '');
}

// ---------- Delivery (server-authoritative — never trust client-declared fees) ----------

function sanitizeDeliveryZones(rawZones) {
  if (!Array.isArray(rawZones)) return [];
  return rawZones.slice(0, MAX_ZONES).map((zone, index) => ({
    id: String(zone?.id || `zone_${index}`).trim().slice(0, 60) || `zone_${index}`,
    name: sanitizeOptionalString(zone?.name, 80) || '',
    fee: Math.max(0, Number(zone?.fee) || 0),
    etaLabel: sanitizeOptionalString(zone?.etaLabel, 60)
  })).filter((zone) => zone.name);
}

/**
 * Legacy shops (created before this delivery model existed) never saved a
 * `delivery` object. Defaulting deliveryEnabled to false for those means the
 * checkout falls back to pickup-only until the owner explicitly configures
 * delivery zones from the new Livraison panel — a safe migration, since the
 * previous behaviour (accepting any client-declared fee) was never trustworthy
 * enough to carry forward automatically.
 */
function sanitizeDelivery(raw) {
  const deliveryEnabled = raw?.deliveryEnabled === true;
  return {
    pickupEnabled: raw?.pickupEnabled !== false,
    pickupAddress: sanitizeOptionalString(raw?.pickupAddress, 300),
    pickupHours: sanitizeOptionalString(raw?.pickupHours, 200),
    deliveryEnabled,
    zones: deliveryEnabled ? sanitizeDeliveryZones(raw?.zones) : [],
    freeDeliveryThreshold: Number.isFinite(Number(raw?.freeDeliveryThreshold)) && Number(raw.freeDeliveryThreshold) > 0
      ? Number(raw.freeDeliveryThreshold) : null,
    minOrderAmount: Number.isFinite(Number(raw?.minOrderAmount)) && Number(raw.minOrderAmount) > 0
      ? Number(raw.minOrderAmount) : 0,
    instructions: sanitizeOptionalString(raw?.instructions, 400),
    phoneRequired: raw?.phoneRequired === true
  };
}

function defaultDelivery() {
  return sanitizeDelivery({ pickupEnabled: true, deliveryEnabled: false });
}

/**
 * The single source of truth for "how much does delivery cost, and is the
 * requested method even available". Called only from the server (createShopOrder).
 * Throws HttpError on anything invalid so the caller doesn't need to re-check.
 */
function resolveFulfillment(catalog, { deliveryMethod, deliveryZoneId, subtotal }) {
  const delivery = catalog.delivery || defaultDelivery();

  if (deliveryMethod === 'pickup') {
    if (!delivery.pickupEnabled) {
      throw new HttpError(400, 'pickup-unavailable', 'Le retrait sur place n est pas propose par cette boutique.');
    }
    if (subtotal < Number(delivery.minOrderAmount || 0)) {
      throw new HttpError(400, 'below-minimum-order', `Commande minimum : ${delivery.minOrderAmount} HTG.`);
    }
    return { deliveryFee: 0, deliveryZoneId: null, deliveryZoneName: null };
  }

  if (deliveryMethod === 'delivery') {
    if (!delivery.deliveryEnabled) {
      throw new HttpError(400, 'delivery-unavailable', 'La livraison n est pas proposee par cette boutique.');
    }
    const zone = (delivery.zones || []).find((z) => z.id === deliveryZoneId);
    if (!zone) throw new HttpError(400, 'invalid-delivery-zone', 'Zone de livraison invalide.');
    if (subtotal < Number(delivery.minOrderAmount || 0)) {
      throw new HttpError(400, 'below-minimum-order', `Commande minimum : ${delivery.minOrderAmount} HTG.`);
    }
    const freeThreshold = delivery.freeDeliveryThreshold;
    const fee = freeThreshold !== null && subtotal >= freeThreshold ? 0 : zone.fee;
    return { deliveryFee: fee, deliveryZoneId: zone.id, deliveryZoneName: zone.name };
  }

  throw new HttpError(400, 'invalid-delivery-method', 'deliveryMethod doit etre delivery ou pickup.');
}

// ---------- SEO / sections / legal (additive, all optional) ----------

const DEFAULT_SECTIONS = ['hero', 'featured', 'collection', 'trust', 'delivery', 'contact'];

function sanitizeSections(raw) {
  const allowed = new Set(DEFAULT_SECTIONS);
  const order = Array.isArray(raw?.order)
    ? raw.order.filter((id) => allowed.has(id))
    : [];
  DEFAULT_SECTIONS.forEach((id) => { if (!order.includes(id)) order.push(id); });
  const visibility = {};
  DEFAULT_SECTIONS.forEach((id) => { visibility[id] = raw?.visibility?.[id] !== false; });
  return {
    order,
    visibility,
    announcement: sanitizeOptionalString(raw?.announcement, 140)
  };
}

function sanitizeSeo(raw) {
  return {
    pageTitle: sanitizeOptionalString(raw?.pageTitle, 70),
    description: sanitizeOptionalString(raw?.description, 160),
    shareImageUrl: sanitizeOptionalString(raw?.shareImageUrl, 500)
  };
}

function sanitizeSocialLinks(raw) {
  const fields = ['instagram', 'facebook', 'tiktok', 'whatsapp'];
  const out = {};
  fields.forEach((key) => { out[key] = sanitizeOptionalString(raw?.[key], 200); });
  return out;
}

function sanitizeLegal(raw) {
  return {
    deliveryPolicy: sanitizeOptionalString(raw?.deliveryPolicy, 2000),
    returnPolicy: sanitizeOptionalString(raw?.returnPolicy, 2000),
    terms: sanitizeOptionalString(raw?.terms, 2000)
  };
}

const FONT_CHOICES = ['system', 'serif', 'mono'];
const BUTTON_STYLES = ['pill', 'rounded', 'square'];
const CARD_STYLES = ['flat', 'bordered', 'shadow'];
const DENSITIES = ['compact', 'normal', 'spacious'];

function sanitizeDesign(raw) {
  return {
    colors: sanitizeColors(raw?.colors),
    textColor: /^#[0-9a-fA-F]{6}$/.test(raw?.textColor || '') ? raw.textColor : null,
    font: FONT_CHOICES.includes(raw?.font) ? raw.font : 'system',
    radius: Number.isFinite(Number(raw?.radius)) ? Math.min(24, Math.max(0, Number(raw.radius))) : 12,
    density: DENSITIES.includes(raw?.density) ? raw.density : 'normal',
    buttonStyle: BUTTON_STYLES.includes(raw?.buttonStyle) ? raw.buttonStyle : 'pill',
    cardStyle: CARD_STYLES.includes(raw?.cardStyle) ? raw.cardStyle : 'flat'
  };
}

function registerShopFunctions({ db, sstInternals, region }) {
  /** POST { organizationId, catalogId?, name, description, logoUrl?, bannerUrl?, contactInfo? } */
  const saveShopCatalog = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'name-required', 'Nom de la boutique requis.');

    const catalogId = String(req.body?.catalogId || '').trim();
    const catalogRef = catalogId ? db.collection('shopCatalogs').doc(catalogId) : db.collection('shopCatalogs').doc();
    if (catalogId) {
      const existing = await catalogRef.get();
      if (existing.exists && existing.data().organizationId !== organizationId) {
        throw new HttpError(403, 'not-owner', 'Cette boutique appartient a une autre organisation.');
      }
    }

    await catalogRef.set({
      organizationId,
      name,
      description: String(req.body?.description || '').trim(),
      logoUrl: req.body?.logoUrl || null,
      bannerUrl: req.body?.bannerUrl || null,
      contactInfo: {
        phone: String(req.body?.contactInfo?.phone || '').trim(),
        email: String(req.body?.contactInfo?.email || '').trim()
      },
      heroTitle: sanitizeOptionalString(req.body?.heroTitle, 140),
      heroSubtitle: sanitizeOptionalString(req.body?.heroSubtitle, 300),
      heroAlign: ['left', 'center'].includes(req.body?.heroAlign) ? req.body.heroAlign : 'left',
      heroHeight: ['compact', 'normal', 'immersive'].includes(req.body?.heroHeight) ? req.body.heroHeight : 'normal',
      colors: sanitizeColors(req.body?.colors),
      design: sanitizeDesign(req.body?.design),
      layout: LAYOUTS.includes(req.body?.layout) ? req.body.layout : 'minimal',
      sections: sanitizeSections(req.body?.sections),
      delivery: sanitizeDelivery(req.body?.delivery),
      seo: sanitizeSeo(req.body?.seo),
      socialLinks: sanitizeSocialLinks(req.body?.socialLinks),
      legal: sanitizeLegal(req.body?.legal),
      closedTemporarily: req.body?.closedTemporarily === true,
      closedMessage: sanitizeOptionalString(req.body?.closedMessage, 200),
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
      ...(catalogId ? {} : {
        status: 'draft',
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      })
    }, { merge: true });

    res.status(200).json({ ok: true, catalogId: catalogRef.id });
  }));

  /** POST { organizationId, catalogId, status } */
  const setCatalogStatus = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const status = String(req.body?.status || '').trim();
    if (!VALID_CATALOG_STATUSES.includes(status)) {
      throw new HttpError(400, 'invalid-status', 'Statut invalide.');
    }
    const catalogId = String(req.body?.catalogId || '').trim();
    const catalogRef = db.collection('shopCatalogs').doc(catalogId);
    const catalogSnap = await catalogRef.get();
    if (!catalogSnap.exists || catalogSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'catalog-not-found', 'Boutique introuvable.');
    }
    if (status === 'published') {
      const catalog = catalogSnap.data();
      if (!String(catalog.name || '').trim()) throw new HttpError(400, 'name-required', 'Nom de la boutique requis avant publication.');
      const productsSnap = await db.collection('shopProducts')
        .where('catalogId', '==', catalogId).where('status', '==', 'published').limit(1).get();
      if (productsSnap.empty) {
        throw new HttpError(400, 'no-published-products', 'Publiez au moins un produit avant de publier la boutique.');
      }
    }
    await catalogRef.set({ status, updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.status(200).json({ ok: true });
  }));

  /** POST { organizationId, catalogId } — deletes unused shops, archives shops with orders. */
  const deleteShopCatalog = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const catalogId = String(req.body?.catalogId || '').trim();
    const catalogRef = db.collection('shopCatalogs').doc(catalogId);
    const catalogSnap = await catalogRef.get();
    if (!catalogSnap.exists || catalogSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'catalog-not-found', 'Boutique introuvable.');
    }

    const ordersSnap = await db.collection('shopOrders').where('catalogId', '==', catalogId).limit(1).get();
    if (!ordersSnap.empty) {
      await catalogRef.set({
        status: 'archived',
        archivedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      res.status(200).json({ ok: true, deleted: false, archived: true });
      return;
    }

    const productsSnap = await db.collection('shopProducts').where('catalogId', '==', catalogId).get();
    for (let index = 0; index < productsSnap.docs.length; index += 400) {
      const batch = db.batch();
      productsSnap.docs.slice(index, index + 400).forEach((productDoc) => batch.delete(productDoc.ref));
      await batch.commit();
    }
    await catalogRef.delete();
    res.status(200).json({ ok: true, deleted: true, archived: false });
  }));

  /**
   * POST { organizationId, catalogId, productId?, name, description, images?, type,
   *        price, comparePrice?, stock?, variants? }
   */
  const saveShopProduct = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const catalogId = String(req.body?.catalogId || '').trim();
    const catalogSnap = await db.collection('shopCatalogs').doc(catalogId).get();
    if (!catalogSnap.exists || catalogSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'catalog-not-found', 'Boutique introuvable.');
    }

    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'name-required', 'Nom du produit requis.');
    const type = String(req.body?.type || 'physical').trim();
    if (!['physical', 'digital'].includes(type)) throw new HttpError(400, 'invalid-type', 'type doit etre physical ou digital.');
    const price = Number(req.body?.price);
    if (!Number.isFinite(price) || price <= 0) throw new HttpError(400, 'invalid-price', 'Prix invalide.');
    const comparePrice = Number.isFinite(Number(req.body?.comparePrice)) ? Number(req.body.comparePrice) : null;
    const stock = type === 'digital'
      ? null
      : (Number.isFinite(Number(req.body?.stock)) ? Math.max(0, Number(req.body.stock)) : 0);
    const variants = sanitizeVariants(req.body?.variants);
    const images = Array.isArray(req.body?.images) ? req.body.images.filter((url) => typeof url === 'string').slice(0, MAX_IMAGES) : [];
    const category = sanitizeOptionalString(req.body?.category, 60);
    const requestedStatus = String(req.body?.status || '').trim();
    if (requestedStatus && !VALID_PRODUCT_STATUSES.includes(requestedStatus)) {
      throw new HttpError(400, 'invalid-status', 'Statut du produit invalide.');
    }

    const productId = String(req.body?.productId || '').trim();
    const productRef = productId ? db.collection('shopProducts').doc(productId) : db.collection('shopProducts').doc();
    let existingProduct = null;
    if (productId) {
      const existing = await productRef.get();
      existingProduct = existing.exists ? existing.data() : null;
      if (existingProduct && (existingProduct.organizationId !== organizationId || existingProduct.catalogId !== catalogId)) {
        throw new HttpError(403, 'not-owner', 'Ce produit appartient a une autre organisation.');
      }
    }

    const existingStatus = String(existingProduct?.status || '').trim();
    const effectiveStatus = requestedStatus
      || (['suspended', 'archived'].includes(existingStatus)
        ? existingStatus
        : (catalogSnap.data().status === 'published' ? 'published' : (existingStatus || 'draft')));

    await productRef.set({
      organizationId,
      catalogId,
      name,
      shortDescription: sanitizeOptionalString(req.body?.shortDescription, 160),
      description: String(req.body?.description || '').trim(),
      images,
      imagesAlt: sanitizeImagesAlt(req.body?.imagesAlt, images.length),
      category,
      tags: sanitizeTags(req.body?.tags),
      type,
      price,
      comparePrice,
      sku: sanitizeOptionalString(req.body?.sku, 60),
      stock,
      lowStockThreshold: type === 'digital' ? null : (Number.isFinite(Number(req.body?.lowStockThreshold)) ? Math.max(0, Number(req.body.lowStockThreshold)) : null),
      weightGrams: type === 'digital' ? null : (Number.isFinite(Number(req.body?.weightGrams)) ? Math.max(0, Number(req.body.weightGrams)) : null),
      dimensions: type === 'digital' ? null : sanitizeDimensions(req.body?.dimensions),
      digitalFileUrl: type === 'digital' ? sanitizeOptionalString(req.body?.digitalFileUrl, 500) : null,
      featured: req.body?.featured === true,
      variants,
      status: effectiveStatus,
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
      ...(productId ? {} : {
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      })
    }, { merge: true });

    res.status(200).json({ ok: true, productId: productRef.id });
  }));

  /** POST { organizationId, catalogId, productId, status } */
  const setShopProductStatus = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const status = String(req.body?.status || '').trim();
    if (!VALID_PRODUCT_STATUSES.includes(status)) {
      throw new HttpError(400, 'invalid-status', 'Statut invalide.');
    }
    const catalogId = String(req.body?.catalogId || '').trim();
    const productId = String(req.body?.productId || '').trim();
    const productRef = db.collection('shopProducts').doc(productId);
    const productSnap = await productRef.get();
    if (!productSnap.exists || productSnap.data().organizationId !== organizationId || productSnap.data().catalogId !== catalogId) {
      throw new HttpError(404, 'product-not-found', 'Produit introuvable.');
    }
    await productRef.set({ status, updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.status(200).json({ ok: true });
  }));

  /** POST { organizationId, catalogId, productId } — preserves products referenced by an order. */
  const deleteShopProduct = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const catalogId = String(req.body?.catalogId || '').trim();
    const productId = String(req.body?.productId || '').trim();
    const productRef = db.collection('shopProducts').doc(productId);
    const productSnap = await productRef.get();
    if (!productSnap.exists || productSnap.data().organizationId !== organizationId || productSnap.data().catalogId !== catalogId) {
      throw new HttpError(404, 'product-not-found', 'Produit introuvable.');
    }

    const ordersSnap = await db.collection('shopOrders').where('catalogId', '==', catalogId).get();
    const isReferenced = ordersSnap.docs.some((orderDoc) => (
      Array.isArray(orderDoc.data().items) && orderDoc.data().items.some((item) => item.productId === productId)
    ));
    if (isReferenced) {
      await productRef.set({
        status: 'archived',
        archivedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      res.status(200).json({ ok: true, deleted: false, archived: true });
      return;
    }

    await productRef.delete();
    res.status(200).json({ ok: true, deleted: true, archived: false });
  }));

  /** GET ?catalogId=... — public catalog + products not explicitly hidden, no cost/internal fields. */
  const getPublicShop = onRequest({ region }, withErrorHandling(async (req, res) => {
    const catalogId = String(req.query?.catalogId || '').trim();
    const catalogSnap = await db.collection('shopCatalogs').doc(catalogId).get();
    if (!catalogSnap.exists || catalogSnap.data().status !== 'published') {
      throw new HttpError(404, 'catalog-not-found', 'Boutique introuvable ou non publiee.');
    }
    const catalog = catalogSnap.data();

    const productsSnap = await db.collection('shopProducts')
      .where('catalogId', '==', catalogId)
      .get();

    const products = productsSnap.docs.filter((doc) => isPublicShopProduct(doc.data())).map((doc) => {
      const p = doc.data();
      return {
        id: doc.id,
        name: p.name,
        shortDescription: p.shortDescription || null,
        description: p.description,
        images: p.images,
        imagesAlt: p.imagesAlt || [],
        category: p.category || null,
        tags: p.tags || [],
        type: p.type,
        price: p.price,
        comparePrice: p.comparePrice,
        sku: p.sku || null,
        stock: p.type === 'digital' ? null : Number(p.stock || 0),
        lowStockThreshold: p.lowStockThreshold ?? null,
        featured: p.featured === true,
        createdAt: p.createdAt || null,
        inStock: p.type === 'digital' ? true : Number(p.stock || 0) > 0,
        variants: (p.variants || []).map((v) => ({
          id: v.id, name: v.name, priceDelta: v.priceDelta,
          inStock: v.stock === null ? true : Number(v.stock || 0) > 0
        }))
      };
    });

    res.status(200).json({
      ok: true,
      catalog: {
        id: catalogSnap.id,
        organizationId: catalog.organizationId,
        name: catalog.name,
        description: catalog.description,
        logoUrl: catalog.logoUrl,
        bannerUrl: catalog.bannerUrl,
        contactInfo: catalog.contactInfo,
        heroTitle: catalog.heroTitle || null,
        heroSubtitle: catalog.heroSubtitle || null,
        heroAlign: catalog.heroAlign || 'left',
        heroHeight: catalog.heroHeight || 'normal',
        colors: catalog.colors || null,
        design: catalog.design || null,
        layout: catalog.layout || 'minimal',
        sections: catalog.sections || null,
        delivery: catalog.delivery || defaultDelivery(),
        seo: catalog.seo || null,
        socialLinks: catalog.socialLinks || null,
        legal: catalog.legal || null,
        closedTemporarily: catalog.closedTemporarily === true,
        closedMessage: catalog.closedMessage || null
      },
      products
    });
  }));

  /**
   * Public checkout. Recomputes every line total AND the delivery fee server-side —
   * price/quantity/zone are the only client inputs trusted to select *what*, never
   * *how much* (same principle as the existing marketplace's enrichMarketplaceItems,
   * see ARCHITECTURE_SMARTSOLUTIONTEK.md §1.1, and the Nourriture app's zone model).
   * POST { organizationId, catalogId, items: [{productId, variantId?, quantity}],
   *        customerEmail, customerName, customerPhone?, deliveryMethod, deliveryZoneId?, deliveryAddress? }
   */
  const createShopOrder = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');

    const organizationId = String(req.body?.organizationId || '').trim();
    const catalogId = String(req.body?.catalogId || '').trim();
    const catalogSnap = await db.collection('shopCatalogs').doc(catalogId).get();
    if (!catalogSnap.exists || catalogSnap.data().status !== 'published') {
      throw new HttpError(404, 'catalog-not-found', 'Boutique introuvable ou non publiee.');
    }
    const catalog = catalogSnap.data();

    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rawItems.length) throw new HttpError(400, 'empty-cart', 'Le panier est vide.');

    const customerEmail = String(req.body?.customerEmail || '').trim();
    if (!customerEmail) throw new HttpError(400, 'customer-email-required', 'Email requis.');
    const deliveryMethod = String(req.body?.deliveryMethod || 'pickup').trim();
    if (!['delivery', 'pickup'].includes(deliveryMethod)) {
      throw new HttpError(400, 'invalid-delivery-method', 'deliveryMethod doit etre delivery ou pickup.');
    }
    if (deliveryMethod === 'delivery' && !String(req.body?.deliveryAddress || '').trim()) {
      throw new HttpError(400, 'delivery-address-required', 'Adresse de livraison requise.');
    }
    if ((catalog.delivery || defaultDelivery()).phoneRequired && !String(req.body?.customerPhone || '').trim()) {
      throw new HttpError(400, 'phone-required', 'Numero de telephone requis.');
    }

    const items = [];
    let subtotal = 0;
    for (const rawItem of rawItems) {
      const productId = String(rawItem?.productId || '').trim();
      const quantity = Math.max(1, Math.floor(Number(rawItem?.quantity) || 1));
      const productSnap = await db.collection('shopProducts').doc(productId).get();
      if (!productSnap.exists || productSnap.data().catalogId !== catalogId || !isPublicShopProduct(productSnap.data())) {
        throw new HttpError(400, 'invalid-product', `Produit invalide ou non disponible: ${productId}`);
      }
      const product = productSnap.data();

      let unitPrice = Number(product.price);
      let variantName = null;
      const variantId = String(rawItem?.variantId || '').trim();
      if (variantId) {
        const variant = (product.variants || []).find((v) => v.id === variantId);
        if (!variant) throw new HttpError(400, 'invalid-variant', `Variante invalide: ${variantId}`);
        unitPrice += Number(variant.priceDelta || 0);
        variantName = variant.name;
        if (variant.stock !== null && Number(variant.stock) < quantity) {
          throw new HttpError(409, 'out-of-stock', `Stock insuffisant pour ${product.name} (${variant.name}).`);
        }
      } else if (product.type === 'physical' && Number(product.stock || 0) < quantity) {
        throw new HttpError(409, 'out-of-stock', `Stock insuffisant pour ${product.name}.`);
      }

      subtotal += unitPrice * quantity;
      items.push({ productId, variantId: variantId || null, name: product.name, variantName, unitPrice, quantity });
    }
    subtotal = Math.round(subtotal * 100) / 100;

    const { deliveryFee, deliveryZoneId, deliveryZoneName } = resolveFulfillment(catalog, {
      deliveryMethod,
      deliveryZoneId: String(req.body?.deliveryZoneId || '').trim(),
      subtotal
    });
    const amountDue = Math.round((subtotal + deliveryFee) * 100) / 100;

    const orderRef = db.collection('shopOrders').doc();
    await orderRef.set({
      organizationId,
      catalogId,
      items,
      subtotal,
      deliveryFee,
      deliveryZoneId,
      deliveryZoneName,
      amountDue,
      customerEmail,
      customerName: String(req.body?.customerName || '').trim(),
      customerPhone: sanitizeOptionalString(req.body?.customerPhone, 40),
      deliveryMethod,
      deliveryAddress: deliveryMethod === 'delivery' ? String(req.body?.deliveryAddress || '').trim() : null,
      status: 'pending_payment',
      statusHistory: [{ status: 'pending_payment', at: sstInternals.admin.firestore.Timestamp.now() }],
      internalNotes: '',
      trackingNumber: null,
      paymentIntentId: null,
      createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({ ok: true, orderId: orderRef.id, amountDue, subtotal, deliveryFee });
  }));

  /** Creator dashboard: list orders for an organization's shop. */
  const listShopOrders = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.query?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);

    const snap = await db.collection('shopOrders').where('organizationId', '==', organizationId).get();
    res.status(200).json({ ok: true, orders: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })) });
  }));

  /** Creator updates fulfillment status (post-payment only), optional tracking number and internal note. */
  const updateShopOrderStatus = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);

    const status = String(req.body?.status || '').trim();
    if (!VALID_ORDER_STATUSES.includes(status)) {
      throw new HttpError(400, 'invalid-status', 'Statut invalide.');
    }
    const orderId = String(req.body?.orderId || '').trim();
    const orderRef = db.collection('shopOrders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists || orderSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'order-not-found', 'Commande introuvable.');
    }
    const order = orderSnap.data();
    if (order.status === 'pending_payment') {
      throw new HttpError(409, 'not-paid-yet', 'Cette commande n est pas encore payee.');
    }
    if (status === 'ready_for_pickup' && order.deliveryMethod !== 'pickup') {
      throw new HttpError(400, 'not-pickup-order', 'Cette commande est une livraison, pas un retrait.');
    }

    const trackingNumber = req.body?.trackingNumber !== undefined
      ? sanitizeOptionalString(req.body.trackingNumber, 100)
      : (order.trackingNumber || null);
    const internalNotes = req.body?.internalNotes !== undefined
      ? sanitizeOptionalString(req.body.internalNotes, 2000) || ''
      : (order.internalNotes || '');

    await orderRef.set({
      status,
      trackingNumber,
      internalNotes,
      statusHistory: [...(order.statusHistory || []), { status, at: sstInternals.admin.firestore.Timestamp.now() }],
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    res.status(200).json({ ok: true });
  }));

  // Wire this application into the shared payment-intent flow.
  registerResourceResolver('shop_order', {
    applicationId: 'shops',
    collection: (firestore) => firestore.collection('shopOrders'),
    computeAmount: (order) => Number(order.amountDue || 0),
    onConfirmed: async (firestore, intent, sstInternalsRef) => {
      const orderRef = firestore.doc(intent.resourceRef);
      await firestore.runTransaction(async (tx) => {
        const orderSnap = await tx.get(orderRef);
        if (!orderSnap.exists) return;
        const order = orderSnap.data();

        // Decrement stock now (payment confirmed), each product/variant re-read inside the
        // transaction. If stock is no longer sufficient (raced by another confirmed order),
        // the order is flagged for manual review rather than silently oversold.
        let stockConflict = false;
        for (const item of order.items) {
          const productRef = firestore.collection('shopProducts').doc(item.productId);
          const productSnap = await tx.get(productRef);
          if (!productSnap.exists) continue;
          const product = productSnap.data();

          if (item.variantId) {
            const variants = product.variants || [];
            const idx = variants.findIndex((v) => v.id === item.variantId);
            if (idx >= 0 && variants[idx].stock !== null) {
              if (variants[idx].stock < item.quantity) { stockConflict = true; continue; }
              variants[idx] = { ...variants[idx], stock: variants[idx].stock - item.quantity };
              tx.set(productRef, { variants }, { merge: true });
            }
          } else if (product.type === 'physical') {
            if (Number(product.stock || 0) < item.quantity) { stockConflict = true; continue; }
            tx.set(productRef, { stock: Number(product.stock || 0) - item.quantity }, { merge: true });
          }
        }

        const newStatus = stockConflict ? 'confirmed_stock_conflict' : 'confirmed';
        tx.set(orderRef, {
          status: newStatus,
          statusHistory: [...(order.statusHistory || []), { status: newStatus, at: sstInternalsRef.admin.firestore.Timestamp.now() }],
          updatedAt: sstInternalsRef.admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      });
    }
  });

  return {
    saveShopCatalog, setCatalogStatus, deleteShopCatalog,
    saveShopProduct, setShopProductStatus, deleteShopProduct,
    getPublicShop, createShopOrder, listShopOrders, updateShopOrderStatus
  };
}

module.exports = {
  registerShopFunctions,
  // Exported for unit tests (functions/smartsolutiontek/shops.test.js) — pure, no Firestore.
  isPublicShopProduct, sanitizeVariants, sanitizeDeliveryZones, sanitizeDelivery,
  defaultDelivery, resolveFulfillment, sanitizeTags, sanitizeDimensions, sanitizeImagesAlt,
  sanitizeSections, sanitizeSeo, sanitizeSocialLinks, sanitizeLegal, sanitizeDesign,
  VALID_ORDER_STATUSES, VALID_CATALOG_STATUSES, VALID_PRODUCT_STATUSES, DEFAULT_SECTIONS
};
