function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundPrice(value) {
  return Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100;
}

function toTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function normalizeDiscountType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (['percentage', 'percent', 'pourcentage', '%'].includes(raw)) return 'percentage';
  if (['amount', 'fixed', 'fixed_amount', 'montant'].includes(raw)) return 'amount';
  if (['fixed_price', 'price', 'prix'].includes(raw)) return 'fixed_price';
  return 'percentage';
}

export function getProductDiscountConfig(product = {}) {
  const raw = product?.discount && typeof product.discount === 'object' ? product.discount : {};
  const value = toNumber(
    raw.value ?? raw.amount ?? raw.rate ?? product?.discountValue ?? product?.discountPercent,
    0
  );

  return {
    enabled: Boolean(raw.enabled ?? product?.discountEnabled ?? value > 0),
    type: normalizeDiscountType(raw.type ?? product?.discountType),
    value,
    startAt: String(raw.startAt ?? raw.startsAt ?? product?.discountStartAt ?? '').trim(),
    endAt: String(raw.endAt ?? raw.endsAt ?? product?.discountEndAt ?? '').trim()
  };
}

export function isProductDiscountActive(product = {}, now = Date.now()) {
  const discount = getProductDiscountConfig(product);
  if (!discount.enabled || discount.value <= 0) return false;

  const startAt = toTimestamp(discount.startAt);
  const endAt = toTimestamp(discount.endAt);

  if (startAt && now < startAt) return false;
  if (endAt && now > endAt) return false;
  return true;
}

export function getProductPricing(product = {}, basePrice = 0, options = {}) {
  const price = Math.max(0, roundPrice(basePrice));
  const fallbackComparePrice = Math.max(0, roundPrice(options.comparePrice ?? product?.comparePrice));

  if (isProductDiscountActive(product)) {
    const discount = getProductDiscountConfig(product);
    let discountedPrice = price;

    if (discount.type === 'percentage') {
      discountedPrice = price * (1 - Math.min(Math.max(discount.value, 0), 100) / 100);
    } else if (discount.type === 'amount') {
      discountedPrice = price - Math.max(discount.value, 0);
    } else if (discount.type === 'fixed_price') {
      discountedPrice = discount.value;
    }

    discountedPrice = Math.max(0, roundPrice(discountedPrice));

    if (discountedPrice < price) {
      return {
        currentPrice: discountedPrice,
        comparePrice: price,
        hasDiscount: true,
        isScheduledDiscount: true
      };
    }
  }

  if (fallbackComparePrice > price) {
    return {
      currentPrice: price,
      comparePrice: fallbackComparePrice,
      hasDiscount: true,
      isScheduledDiscount: false
    };
  }

  return {
    currentPrice: price,
    comparePrice: 0,
    hasDiscount: false,
    isScheduledDiscount: false
  };
}

export function getProductPriceRange(product = {}, prices = []) {
  const validPrices = prices
    .map((value) => Math.max(0, roundPrice(value)))
    .filter((value) => Number.isFinite(value));

  if (validPrices.length === 0) {
    return {
      minPrice: 0,
      maxPrice: 0,
      minComparePrice: 0,
      maxComparePrice: 0,
      hasDiscount: false
    };
  }

  const pricings = validPrices.map((value) => getProductPricing(product, value, { comparePrice: 0 }));
  const currentPrices = pricings.map((entry) => entry.currentPrice);
  const comparePrices = pricings.map((entry) => entry.comparePrice).filter((value) => value > 0);

  return {
    minPrice: Math.min(...currentPrices),
    maxPrice: Math.max(...currentPrices),
    minComparePrice: comparePrices.length ? Math.min(...comparePrices) : 0,
    maxComparePrice: comparePrices.length ? Math.max(...comparePrices) : 0,
    hasDiscount: pricings.some((entry) => entry.hasDiscount)
  };
}

export function getProductStoreMeta(product = {}) {
  const vendorId = String(product?.vendorId || '').trim();
  const vendorName = String(product?.shopName || product?.vendorName || '').trim();
  const sourceCollection = String(product?.sourceCollection || '').trim().toLowerCase();
  const sourceType = String(product?.sourceType || '').trim().toLowerCase();
  const isVendorStore = Boolean(
    vendorId ||
    sourceCollection === 'vendorproducts' ||
    sourceType.includes('vendor')
  );

  if (isVendorStore) {
    const params = new URLSearchParams();
    if (vendorId) params.set('vendor', vendorId);
    return {
      isVendorStore: true,
      storeName: vendorName || 'Boutique partenaire',
      url: `./vendor-marketplace.html${params.toString() ? `?${params.toString()}` : ''}`
    };
  }

  const params = new URLSearchParams();
  if (product?.categoryId) params.set('categoryId', String(product.categoryId));
  const categoryName = String(product?.category || product?.categoryName || '').trim();
  if (categoryName) params.set('categoryName', categoryName);

  return {
    isVendorStore: false,
    storeName: 'Smart Cut Services',
    url: `./catalogue.html${params.toString() ? `?${params.toString()}` : ''}`
  };
}
