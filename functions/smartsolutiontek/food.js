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

/** Application 5 — Nourriture et produits artisanaux. Same shared pattern as the other 4 apps. */

function isMenuOpenNow(openingHours, now = new Date()) {
  if (!Array.isArray(openingHours) || !openingHours.length) return true; // no hours configured = always open
  const dayOfWeek = now.getDay();
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  return openingHours.some((slot) => {
    if (slot.dayOfWeek !== dayOfWeek) return false;
    const [sh, sm] = String(slot.startTime || '').split(':').map(Number);
    const [eh, em] = String(slot.endTime || '').split(':').map(Number);
    if (![sh, sm, eh, em].every(Number.isFinite)) return false;
    const startMinutes = sh * 60 + sm;
    const endMinutes = eh * 60 + em;
    return minutesNow >= startMinutes && minutesNow <= endMinutes;
  });
}

function sanitizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options.map((opt, index) => ({
    id: String(opt?.id || `opt_${index}`).trim(),
    name: String(opt?.name || '').trim(),
    required: Boolean(opt?.required),
    multiple: Boolean(opt?.multiple),
    choices: Array.isArray(opt?.choices) ? opt.choices.map((c) => ({
      label: String(c?.label || '').trim(),
      priceDelta: Number(c?.priceDelta) || 0
    })).filter((c) => c.label) : []
  })).filter((opt) => opt.name);
}

function registerFoodFunctions({ db, sstInternals, region }) {
  /** POST { organizationId, menuId?, name, description, openingHours?, deliveryZones?, pickupAvailable?, minOrderAmount? } */
  const saveMenu = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'name-required', 'Nom requis.');

    const menuId = String(req.body?.menuId || '').trim();
    const menuRef = menuId ? db.collection('menus').doc(menuId) : db.collection('menus').doc();
    if (menuId) {
      const existing = await menuRef.get();
      if (existing.exists && existing.data().organizationId !== organizationId) {
        throw new HttpError(403, 'not-owner', 'Ce menu appartient a une autre organisation.');
      }
    }

    const deliveryZones = Array.isArray(req.body?.deliveryZones)
      ? req.body.deliveryZones.map((z) => ({ name: String(z?.name || '').trim(), fee: Number(z?.fee) || 0 })).filter((z) => z.name)
      : [];
    const openingHours = Array.isArray(req.body?.openingHours)
      ? req.body.openingHours.filter((h) => Number.isInteger(h?.dayOfWeek) && h?.startTime && h?.endTime)
      : [];

    await menuRef.set({
      organizationId, name,
      description: String(req.body?.description || '').trim(),
      openingHours, deliveryZones,
      pickupAvailable: req.body?.pickupAvailable !== false,
      minOrderAmount: Number.isFinite(Number(req.body?.minOrderAmount)) ? Math.max(0, Number(req.body.minOrderAmount)) : 0,
      logoUrl: req.body?.logoUrl || null,
      coverImageUrl: req.body?.coverImageUrl || null,
      heroTitle: sanitizeOptionalString(req.body?.heroTitle, 140),
      heroSubtitle: sanitizeOptionalString(req.body?.heroSubtitle, 300),
      colors: sanitizeColors(req.body?.colors),
      layout: LAYOUTS.includes(req.body?.layout) ? req.body.layout : 'minimal',
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
      ...(menuId ? {} : {
        status: 'draft',
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      })
    }, { merge: true });

    res.status(200).json({ ok: true, menuId: menuRef.id });
  }));

  /** POST { organizationId, menuId, status } */
  const setMenuStatus = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const status = String(req.body?.status || '').trim();
    if (!['draft', 'published', 'suspended', 'archived'].includes(status)) throw new HttpError(400, 'invalid-status', 'Statut invalide.');
    const menuId = String(req.body?.menuId || '').trim();
    const menuRef = db.collection('menus').doc(menuId);
    const menuSnap = await menuRef.get();
    if (!menuSnap.exists || menuSnap.data().organizationId !== organizationId) throw new HttpError(404, 'menu-not-found', 'Menu introuvable.');

    await menuRef.set({ status, updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.status(200).json({ ok: true });
  }));

  /** Deletes an unused menu, or archives it when order history exists. */
  const deleteMenu = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);
    const menuId = String(req.body?.menuId || '').trim();
    const menuRef = db.collection('menus').doc(menuId);
    const menuSnap = await menuRef.get();
    if (!menuSnap.exists || menuSnap.data().organizationId !== organizationId) throw new HttpError(404, 'menu-not-found', 'Menu introuvable.');
    const orders = await db.collection('foodOrders').where('menuId', '==', menuId).limit(1).get();
    if (!orders.empty) {
      await menuRef.set({ status: 'archived', updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      res.status(200).json({ ok: true, archived: true });
      return;
    }
    const items = await db.collection('menuItems').where('menuId', '==', menuId).get();
    const batch = db.batch();
    items.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(menuRef);
    await batch.commit();
    res.status(200).json({ ok: true, archived: false });
  }));

  /** POST { organizationId, menuId, itemId?, name, description, price, category, options? } */
  const saveMenuItem = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const menuId = String(req.body?.menuId || '').trim();
    const menuSnap = await db.collection('menus').doc(menuId).get();
    if (!menuSnap.exists || menuSnap.data().organizationId !== organizationId) throw new HttpError(404, 'menu-not-found', 'Menu introuvable.');

    const name = String(req.body?.name || '').trim();
    if (!name) throw new HttpError(400, 'name-required', 'Nom du plat requis.');
    const price = Number(req.body?.price);
    if (!Number.isFinite(price) || price <= 0) throw new HttpError(400, 'invalid-price', 'Prix invalide.');

    const itemId = String(req.body?.itemId || '').trim();
    const itemRef = itemId ? db.collection('menuItems').doc(itemId) : db.collection('menuItems').doc();
    if (itemId) {
      const existing = await itemRef.get();
      if (existing.exists && existing.data().organizationId !== organizationId) {
        throw new HttpError(403, 'not-owner', 'Ce plat appartient a une autre organisation.');
      }
    }

    await itemRef.set({
      organizationId, menuId, name,
      description: String(req.body?.description || '').trim(),
      price, category: String(req.body?.category || '').trim(),
      photoUrl: req.body?.photoUrl || null,
      options: sanitizeOptions(req.body?.options),
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
      ...(itemId ? {} : {
        status: 'published',
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      })
    }, { merge: true });

    res.status(200).json({ ok: true, itemId: itemRef.id });
  }));

  /** GET ?menuId=... — public. */
  const getPublicMenu = onRequest({ region }, withErrorHandling(async (req, res) => {
    const menuId = String(req.query?.menuId || '').trim();
    const menuSnap = await db.collection('menus').doc(menuId).get();
    if (!menuSnap.exists || menuSnap.data().status !== 'published') throw new HttpError(404, 'menu-not-found', 'Menu introuvable ou non publie.');
    const menu = menuSnap.data();

    const itemsSnap = await db.collection('menuItems').where('menuId', '==', menuId).where('status', '==', 'published').get();

    res.status(200).json({
      ok: true,
      menu: {
        id: menuSnap.id, organizationId: menu.organizationId, name: menu.name, description: menu.description,
        deliveryZones: menu.deliveryZones, pickupAvailable: menu.pickupAvailable,
        minOrderAmount: menu.minOrderAmount, isOpen: isMenuOpenNow(menu.openingHours),
        logoUrl: menu.logoUrl || null, coverImageUrl: menu.coverImageUrl || null,
        heroTitle: menu.heroTitle || null, heroSubtitle: menu.heroSubtitle || null,
        colors: menu.colors || null, layout: menu.layout || 'minimal'
      },
      items: itemsSnap.docs.map((d) => { const i = d.data(); return { id: d.id, name: i.name, description: i.description, price: i.price, category: i.category, photoUrl: i.photoUrl || null, options: i.options }; })
    });
  }));

  /**
   * Public. POST { organizationId, menuId, items: [{itemId, quantity, selectedOptions?}],
   *        customerEmail, customerName, fulfillmentMethod, deliveryZone?, deliveryAddress?, desiredTime? }
   * Every line total (including selected option price deltas) is recomputed from the
   * real menuItems documents — never trusted from the client, same principle as shops.js.
   */
  const createFoodOrder = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const organizationId = String(req.body?.organizationId || '').trim();
    const menuId = String(req.body?.menuId || '').trim();
    const menuSnap = await db.collection('menus').doc(menuId).get();
    if (!menuSnap.exists || menuSnap.data().status !== 'published' || menuSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'menu-not-found', 'Menu introuvable ou non publie.');
    }
    const menu = menuSnap.data();
    if (!isMenuOpenNow(menu.openingHours)) throw new HttpError(400, 'menu-closed', 'Ce commerce est actuellement ferme.');

    const fulfillmentMethod = String(req.body?.fulfillmentMethod || 'pickup').trim();
    if (!['delivery', 'pickup'].includes(fulfillmentMethod)) throw new HttpError(400, 'invalid-fulfillment-method', 'fulfillmentMethod doit etre delivery ou pickup.');
    if (fulfillmentMethod === 'pickup' && !menu.pickupAvailable) throw new HttpError(400, 'pickup-unavailable', 'Le retrait sur place n est pas propose par ce commerce.');

    let deliveryFee = 0;
    let deliveryZoneName = null;
    if (fulfillmentMethod === 'delivery') {
      const requestedZone = String(req.body?.deliveryZone || '').trim();
      const zone = (menu.deliveryZones || []).find((z) => z.name === requestedZone);
      if (!zone) throw new HttpError(400, 'invalid-delivery-zone', 'Zone de livraison invalide.');
      deliveryFee = zone.fee;
      deliveryZoneName = zone.name;
      if (!String(req.body?.deliveryAddress || '').trim()) throw new HttpError(400, 'delivery-address-required', 'Adresse de livraison requise.');
    }

    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!rawItems.length) throw new HttpError(400, 'empty-cart', 'Le panier est vide.');

    const items = [];
    let subtotal = 0;
    for (const rawItem of rawItems) {
      const itemId = String(rawItem?.itemId || '').trim();
      const quantity = Math.max(1, Math.floor(Number(rawItem?.quantity) || 1));
      const itemSnap = await db.collection('menuItems').doc(itemId).get();
      if (!itemSnap.exists || itemSnap.data().menuId !== menuId || itemSnap.data().status !== 'published') {
        throw new HttpError(400, 'invalid-item', `Plat invalide: ${itemId}`);
      }
      const menuItem = itemSnap.data();

      let unitPrice = Number(menuItem.price);
      const selectedOptions = [];
      const rawSelections = Array.isArray(rawItem?.selectedOptions) ? rawItem.selectedOptions : [];
      for (const option of menuItem.options || []) {
        const selection = rawSelections.find((s) => s?.optionId === option.id);
        if (option.required && !selection) throw new HttpError(400, 'missing-required-option', `Option requise manquante: ${option.name}`);
        if (selection) {
          const choice = option.choices.find((c) => c.label === selection.choiceLabel);
          if (!choice) throw new HttpError(400, 'invalid-option-choice', `Choix invalide pour ${option.name}`);
          unitPrice += choice.priceDelta;
          selectedOptions.push({ optionId: option.id, optionName: option.name, choiceLabel: choice.label, priceDelta: choice.priceDelta });
        }
      }

      subtotal += unitPrice * quantity;
      items.push({ itemId, name: menuItem.name, unitPrice, quantity, selectedOptions });
    }

    if (subtotal < Number(menu.minOrderAmount || 0)) {
      throw new HttpError(400, 'below-minimum-order', `Commande minimum: ${menu.minOrderAmount} HTG.`);
    }

    const amountDue = Math.round((subtotal + deliveryFee) * 100) / 100;
    const orderRef = db.collection('foodOrders').doc();
    await orderRef.set({
      organizationId, menuId, items,
      subtotal: Math.round(subtotal * 100) / 100, deliveryFee, amountDue,
      customerEmail: String(req.body?.customerEmail || '').trim(),
      customerName: String(req.body?.customerName || '').trim(),
      fulfillmentMethod, deliveryZone: deliveryZoneName,
      deliveryAddress: fulfillmentMethod === 'delivery' ? String(req.body?.deliveryAddress || '').trim() : null,
      desiredTime: req.body?.desiredTime || null,
      status: 'pending_payment', paymentIntentId: null,
      createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({ ok: true, orderId: orderRef.id, amountDue });
  }));

  /** Dashboard: list orders for an organization's menu. */
  const listFoodOrders = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.query?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);

    const snap = await db.collection('foodOrders').where('organizationId', '==', organizationId).get();
    res.status(200).json({ ok: true, orders: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  }));

  /** POST { organizationId, orderId, status } — preparing/ready/delivered/cancelled, paid orders only. */
  const updateFoodOrderStatus = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);

    const status = String(req.body?.status || '').trim();
    if (!['preparing', 'ready', 'delivered', 'cancelled'].includes(status)) throw new HttpError(400, 'invalid-status', 'Statut invalide.');
    const orderId = String(req.body?.orderId || '').trim();
    const orderRef = db.collection('foodOrders').doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists || orderSnap.data().organizationId !== organizationId) throw new HttpError(404, 'order-not-found', 'Commande introuvable.');
    if (orderSnap.data().status === 'pending_payment') throw new HttpError(409, 'not-paid-yet', 'Cette commande n est pas encore payee.');

    await orderRef.set({ status, updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.status(200).json({ ok: true });
  }));

  registerResourceResolver('food_order', {
    applicationId: 'food',
    collection: (firestore) => firestore.collection('foodOrders'),
    computeAmount: (order) => Number(order.amountDue || 0),
    onConfirmed: async (firestore, intent, sstInternalsRef) => {
      await firestore.doc(intent.resourceRef).set({
        status: 'confirmed',
        updatedAt: sstInternalsRef.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  });

  return { saveMenu, setMenuStatus, deleteMenu, saveMenuItem, getPublicMenu, createFoodOrder, listFoodOrders, updateFoodOrderStatus };
}

module.exports = { registerFoodFunctions, isMenuOpenNow, sanitizeOptions };
