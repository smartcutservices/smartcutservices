'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isPublicShopProduct, sanitizeVariants, sanitizeDeliveryZones, sanitizeDelivery,
  defaultDelivery, resolveFulfillment, sanitizeTags, sanitizeDimensions, sanitizeImagesAlt
} = require('./shops');

function assertThrowsCode(fn, expectedCode) {
  assert.throws(fn, (error) => error.code === expectedCode);
}

// ---------- isPublicShopProduct ----------

test('isPublicShopProduct: legacy product with no status is public', () => {
  assert.equal(isPublicShopProduct({}), true);
});
test('isPublicShopProduct: draft and published are public, suspended/archived are not', () => {
  assert.equal(isPublicShopProduct({ status: 'draft' }), true);
  assert.equal(isPublicShopProduct({ status: 'published' }), true);
  assert.equal(isPublicShopProduct({ status: 'suspended' }), false);
  assert.equal(isPublicShopProduct({ status: 'archived' }), false);
});

// ---------- sanitizeVariants ----------

test('sanitizeVariants: throws when a variant has no name', () => {
  assertThrowsCode(() => sanitizeVariants([{ name: '' }]), 'variant-name-required');
});
test('sanitizeVariants: coerces priceDelta and clamps negative stock to 0', () => {
  const result = sanitizeVariants([{ name: 'Rouge', priceDelta: '25', stock: -3 }]);
  assert.equal(result[0].priceDelta, 25);
  assert.equal(result[0].stock, 0);
});
test('sanitizeVariants: null stock means unlimited (unset) stock tracking', () => {
  const result = sanitizeVariants([{ name: 'Taille unique' }]);
  assert.equal(result[0].stock, null);
});
test('sanitizeVariants: non-array input yields empty array', () => {
  assert.deepEqual(sanitizeVariants(null), []);
});

// ---------- sanitizeDeliveryZones ----------

test('sanitizeDeliveryZones: drops zones without a name', () => {
  const result = sanitizeDeliveryZones([{ name: '', fee: 100 }, { name: 'Centre-ville', fee: 250 }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Centre-ville');
  assert.equal(result[0].fee, 250);
});
test('sanitizeDeliveryZones: negative fee is clamped to 0', () => {
  const result = sanitizeDeliveryZones([{ name: 'Zone A', fee: -50 }]);
  assert.equal(result[0].fee, 0);
});

// ---------- sanitizeDelivery / defaultDelivery ----------

test('defaultDelivery: pickup enabled, delivery disabled (safe migration default)', () => {
  const delivery = defaultDelivery();
  assert.equal(delivery.pickupEnabled, true);
  assert.equal(delivery.deliveryEnabled, false);
  assert.deepEqual(delivery.zones, []);
});
test('sanitizeDelivery: zones are dropped entirely when deliveryEnabled is false', () => {
  const delivery = sanitizeDelivery({ deliveryEnabled: false, zones: [{ name: 'Zone A', fee: 100 }] });
  assert.deepEqual(delivery.zones, []);
});
test('sanitizeDelivery: keeps valid zones when deliveryEnabled is true', () => {
  const delivery = sanitizeDelivery({ deliveryEnabled: true, zones: [{ name: 'Zone A', fee: 100 }] });
  assert.equal(delivery.zones.length, 1);
});

// ---------- resolveFulfillment (the security-critical function) ----------

test('resolveFulfillment: pickup on a legacy shop (no delivery config) succeeds with zero fee', () => {
  const result = resolveFulfillment({}, { deliveryMethod: 'pickup', subtotal: 500 });
  assert.equal(result.deliveryFee, 0);
});
test('resolveFulfillment: delivery on a legacy shop (no delivery config) is rejected', () => {
  assertThrowsCode(
    () => resolveFulfillment({}, { deliveryMethod: 'delivery', deliveryZoneId: 'zone_0', subtotal: 500 }),
    'delivery-unavailable'
  );
});
test('resolveFulfillment: delivery fee always comes from the server-side zone, never the client', () => {
  const catalog = { delivery: sanitizeDelivery({ deliveryEnabled: true, zones: [{ id: 'zone_0', name: 'Centre-ville', fee: 300 }] }) };
  const result = resolveFulfillment(catalog, { deliveryMethod: 'delivery', deliveryZoneId: 'zone_0', subtotal: 1000 });
  assert.equal(result.deliveryFee, 300);
  assert.equal(result.deliveryZoneName, 'Centre-ville');
});
test('resolveFulfillment: unknown zone id is rejected even if a fee is implied elsewhere', () => {
  const catalog = { delivery: sanitizeDelivery({ deliveryEnabled: true, zones: [{ id: 'zone_0', name: 'Centre-ville', fee: 300 }] }) };
  assertThrowsCode(
    () => resolveFulfillment(catalog, { deliveryMethod: 'delivery', deliveryZoneId: 'does-not-exist', subtotal: 1000 }),
    'invalid-delivery-zone'
  );
});
test('resolveFulfillment: free delivery threshold zeroes the fee once subtotal reaches it', () => {
  const catalog = {
    delivery: sanitizeDelivery({
      deliveryEnabled: true,
      zones: [{ id: 'zone_0', name: 'Centre-ville', fee: 300 }],
      freeDeliveryThreshold: 1000
    })
  };
  const below = resolveFulfillment(catalog, { deliveryMethod: 'delivery', deliveryZoneId: 'zone_0', subtotal: 999 });
  assert.equal(below.deliveryFee, 300);
  const above = resolveFulfillment(catalog, { deliveryMethod: 'delivery', deliveryZoneId: 'zone_0', subtotal: 1000 });
  assert.equal(above.deliveryFee, 0);
});
test('resolveFulfillment: below minimum order amount is rejected for both methods', () => {
  const catalog = { delivery: sanitizeDelivery({ pickupEnabled: true, minOrderAmount: 500 }) };
  assertThrowsCode(
    () => resolveFulfillment(catalog, { deliveryMethod: 'pickup', subtotal: 100 }),
    'below-minimum-order'
  );
});
test('resolveFulfillment: pickup rejected when the shop disabled pickup', () => {
  const catalog = { delivery: sanitizeDelivery({ pickupEnabled: false, deliveryEnabled: true, zones: [{ name: 'Z', fee: 0 }] }) };
  assertThrowsCode(
    () => resolveFulfillment(catalog, { deliveryMethod: 'pickup', subtotal: 100 }),
    'pickup-unavailable'
  );
});
test('resolveFulfillment: invalid method string is rejected', () => {
  assertThrowsCode(
    () => resolveFulfillment({}, { deliveryMethod: 'teleport', subtotal: 100 }),
    'invalid-delivery-method'
  );
});

// ---------- sanitizeTags / sanitizeDimensions / sanitizeImagesAlt ----------

test('sanitizeTags: dedupes case-insensitively and caps at 12', () => {
  const result = sanitizeTags(['Bio', 'bio', 'Local', ...Array.from({ length: 15 }, (_, i) => `tag${i}`)]);
  assert.equal(result.filter((t) => t.toLowerCase() === 'bio').length, 1);
  assert.ok(result.length <= 12);
});
test('sanitizeDimensions: rejects partial or negative dimensions', () => {
  assert.equal(sanitizeDimensions({ length: 10, width: 5 }), null);
  assert.equal(sanitizeDimensions({ length: -1, width: 5, height: 5 }), null);
  assert.deepEqual(sanitizeDimensions({ length: 10, width: 5, height: 2 }), { length: 10, width: 5, height: 2 });
});
test('sanitizeImagesAlt: pads/truncates to match the image count', () => {
  const result = sanitizeImagesAlt(['Vue de face'], 3);
  assert.equal(result.length, 3);
  assert.equal(result[0], 'Vue de face');
  assert.equal(result[1], '');
});
