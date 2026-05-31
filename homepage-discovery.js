import { db } from './firebase-init.js';
import { loadPublicProducts } from './catalog-products.js';
import { getResolvedProductImages, getFallbackProductImage } from './image-fallbacks.js';
import { buildProductPageUrl } from './product-links.js';
import { getProductPricing, getProductStoreMeta } from './product-display-utils.js';
import { formatPriceDual, loadCurrencySettings } from './currency-utils.js';
import {
  collection,
  getDocs,
  limit,
  query
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const SEARCH_HISTORY_KEYS = [
  'smartcut_search_history',
  'smartcut_recent_searches',
  'sierra_search_history'
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function shuffle(items = []) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function getBasePrice(product = {}) {
  const prices = [];
  const direct = Number(product.price ?? product.basePrice ?? product.currentPrice ?? 0);
  if (Number.isFinite(direct) && direct > 0) prices.push(direct);

  if (Array.isArray(product.variations)) {
    product.variations.forEach((variation) => {
      const value = Number(variation?.specificPrice ?? variation?.price ?? variation?.basePrice ?? 0);
      if (Number.isFinite(value) && value > 0) prices.push(value);
    });
  }

  return prices.length ? Math.min(...prices) : 0;
}

function getProductImage(product, basePath) {
  return getResolvedProductImages(product, basePath)[0] || getFallbackProductImage(product, basePath);
}

function isSmartCutProduct(product = {}) {
  return !getProductStoreMeta(product).isVendorStore;
}

function isProVendorProduct(product = {}) {
  const planId = normalizeText(product.planId || product.vendorPlanId || product.servicePlanId);
  const planLabel = normalizeText(product.planLabel || product.vendorPlanLabel || product.servicePlanLabel);
  return Boolean(product.vendorVerified || product.isVerifiedVendor || planId === 'pro' || planLabel.includes('pro'));
}

function getProductVendorId(product = {}) {
  return String(product.vendorId || product.storeId || product.sellerId || '').trim();
}

function getProductScoreKey(product = {}) {
  return String(product.id || product.productId || '').trim();
}

function getProductSalesScore(product = {}, salesByProduct = new Map()) {
  const productId = getProductScoreKey(product);
  const orderScore = productId ? Number(salesByProduct.get(productId) || 0) : 0;
  const localScore = Number(
    product.salesCount ??
    product.totalSold ??
    product.soldCount ??
    product.quantitySold ??
    product.ordersCount ??
    0
  );
  return Math.max(orderScore, Number.isFinite(localScore) ? localScore : 0);
}

function productSearchPool(product = {}) {
  return normalizeText([
    product.name,
    product.sku,
    product.category,
    product.categoryName,
    product.shortDescription,
    product.description,
    product.vendorName,
    product.shopName
  ].join(' '));
}

function collectStrings(value, target) {
  if (!value) return;
  if (typeof value === 'string') {
    if (value.trim().length >= 2) target.push(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, target));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach((item) => collectStrings(item, target));
  }
}

function readSearchTerms() {
  const terms = [];
  try {
    for (const key of SEARCH_HISTORY_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      try {
        collectStrings(JSON.parse(raw), terms);
      } catch (_) {
        collectStrings(raw, terms);
      }
    }
  } catch (_) {
    return [];
  }

  return [...new Set(terms.map(normalizeText).filter(Boolean))].slice(0, 10);
}

function scoreRecommendedProduct(product, terms) {
  if (!terms.length) return 0;
  const pool = productSearchPool(product);
  return terms.reduce((score, term, index) => {
    if (!term || !pool.includes(term)) return score;
    return score + Math.max(1, 12 - index);
  }, 0);
}

function getOrderVendorIds(order = {}) {
  const ids = [];
  if (order.vendorId) ids.push(String(order.vendorId));

  const candidates = [
    order.items,
    order.products,
    order.cartItems,
    order.vendorItems
  ].filter(Array.isArray);

  candidates.flat().forEach((item) => {
    if (item?.vendorId) ids.push(String(item.vendorId));
    if (item?.storeId) ids.push(String(item.storeId));
  });

  return ids;
}

function getOrderProductSales(order = {}) {
  const entries = [];
  const candidates = [
    order.items,
    order.products,
    order.cartItems,
    order.vendorItems
  ].filter(Array.isArray);

  candidates.flat().forEach((item) => {
    const productId = String(item?.productId || item?.id || item?.product?.id || '').trim();
    if (!productId) return;
    const quantity = Math.max(1, Number(item?.quantity || item?.qty || 1) || 1);
    entries.push({ productId, quantity });
  });

  return entries;
}

function isPaidLikeOrder(order = {}) {
  const status = normalizeText(order.paymentStatus || order.status || order.orderStatus);
  if (!status) return true;
  return ['paid', 'approved', 'confirmed', 'completed', 'livre', 'livree', 'delivered'].some((value) => status.includes(value));
}

export default class HomepageDiscovery {
  constructor(rootId, options = {}) {
    this.root = document.getElementById(rootId);
    this.options = {
      imageBasePath: options.imageBasePath || './',
      maxProducts: options.maxProducts || 10,
      maxVendors: options.maxVendors || 6
    };

    if (!this.root) return;
    this.renderShell();
    this.load();
  }

  renderShell() {
    this.root.innerHTML = `
      <section class="home-discovery" aria-label="Sections produits">
        <div class="home-discovery__section" data-section="sponsored">
          <div class="home-discovery__heading">
            <h2>Sponsored</h2>
          </div>
          <div class="home-discovery__rail" data-sponsored-list>${this.renderSkeletonCards(4)}</div>
        </div>
        <div class="home-discovery__section" data-section="recommended">
          <div class="home-discovery__heading">
            <h2>Produits recommandés</h2>
          </div>
          <div class="home-discovery__rail" data-recommended-list>${this.renderSkeletonCards(4)}</div>
        </div>
        <div class="home-discovery__section home-discovery__section--vendors" data-section="vendors">
          <div class="home-discovery__heading">
            <h2>Top vendeurs</h2>
          </div>
          <div class="home-discovery__vendors" data-vendors-list>${this.renderSkeletonCards(4)}</div>
        </div>
      </section>
      <style>${this.styles()}</style>
    `;
  }

  async load() {
    try {
      await loadCurrencySettings();
      const [products, vendorInsights] = await Promise.all([
        loadPublicProducts({ maxPerCollection: 160 }),
        this.loadVendorProductInsights()
      ]);

      const activeProducts = products.filter((product) => getBasePrice(product) > 0);
      this.renderSponsored(activeProducts);
      this.renderRecommended(activeProducts);
      this.renderTopVendorProducts(activeProducts, vendorInsights);
    } catch (error) {
      console.error('Erreur chargement sections homepage:', error);
      this.root.querySelector('.home-discovery')?.classList.add('home-discovery--error');
      this.root.querySelector('[data-sponsored-list]').innerHTML = this.renderEmpty('Impossible de charger les produits sponsorisés.');
      this.root.querySelector('[data-recommended-list]').innerHTML = this.renderEmpty('Impossible de charger les recommandations.');
      this.root.querySelector('[data-vendors-list]').innerHTML = this.renderEmpty('Impossible de charger les produits vendeurs.');
    }
  }

  renderSponsored(products) {
    const sponsored = products.filter((product) => isSmartCutProduct(product) || isProVendorProduct(product));
    const selected = shuffle(sponsored.length ? sponsored : products).slice(0, this.options.maxProducts);
    this.root.querySelector('[data-sponsored-list]').innerHTML = selected.length
      ? selected.map((product) => this.renderProductCard(product)).join('')
      : this.renderEmpty('Aucun produit sponsorisé disponible.');
  }

  renderRecommended(products) {
    const terms = readSearchTerms();
    const scored = products
      .map((product) => ({ product, score: scoreRecommendedProduct(product, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.product);

    const selected = (scored.length ? scored : shuffle(products)).slice(0, this.options.maxProducts);
    this.root.querySelector('[data-recommended-list]').innerHTML = selected.length
      ? selected.map((product) => this.renderProductCard(product)).join('')
      : this.renderEmpty('Aucun produit disponible pour le moment.');
  }

  async loadVendorProductInsights() {
    const proVendorIds = new Set();
    const salesByProduct = new Map();

    try {
      const snapshot = await getDocs(query(collection(db, 'vendors'), limit(100)));
      snapshot.docs.forEach((docSnap) => {
        const vendor = { id: docSnap.id, ...docSnap.data() };
        const status = normalizeText(vendor.status || vendor.vendorStatus || 'active');
        const isActive = !status || ['active', 'approved'].some((value) => status.includes(value));
        if (!isActive) return;

        const planId = normalizeText(vendor.planId || vendor.servicePlanId || vendor.subscriptionPlan);
        const planLabel = normalizeText(vendor.planLabel || vendor.servicePlanLabel || vendor.subscriptionLabel);
        if (vendor.vendorVerified || vendor.isVerifiedVendor || planId === 'pro' || planLabel.includes('pro')) {
          proVendorIds.add(String(vendor.id));
        }
      });
    } catch (error) {
      console.warn('Lecture plans vendeurs ignoree:', error);
    }

    try {
      const ordersSnapshot = await getDocs(query(collection(db, 'orders'), limit(300)));
      ordersSnapshot.docs.forEach((docSnap) => {
        const order = docSnap.data() || {};
        if (!isPaidLikeOrder(order)) return;
        getOrderProductSales(order).forEach(({ productId, quantity }) => {
          salesByProduct.set(productId, (salesByProduct.get(productId) || 0) + quantity);
        });
      });
    } catch (error) {
      console.warn('Lecture commandes top produits vendeurs ignoree:', error);
    }

    return { proVendorIds, salesByProduct };
  }

  renderTopVendorProducts(products, insights = {}) {
    const salesByProduct = insights.salesByProduct || new Map();
    const proVendorIds = insights.proVendorIds || new Set();
    const vendorProducts = products
      .filter((product) => getProductStoreMeta(product).isVendorStore)
      .map((product) => ({
        ...product,
        vendorVerified: Boolean(product.vendorVerified || product.isVerifiedVendor || proVendorIds.has(getProductVendorId(product))),
        salesScore: getProductSalesScore(product, salesByProduct)
      }));

    const sorted = vendorProducts.sort((a, b) => b.salesScore - a.salesScore);
    const bestProducts = sorted.some((product) => product.salesScore > 0)
      ? sorted.filter((product) => product.salesScore > 0)
      : shuffle(sorted);
    const selected = bestProducts.slice(0, this.options.maxProducts);

    this.root.querySelector('[data-vendors-list]').innerHTML = selected.length
      ? selected.map((product) => this.renderProductCard(product)).join('')
      : this.renderEmpty('Aucun produit vendeur disponible pour le moment.');
  }

  renderProductCard(product) {
    const store = getProductStoreMeta(product);
    const image = getProductImage(product, this.options.imageBasePath);
    const pricing = getProductPricing(product, getBasePrice(product), { comparePrice: product.comparePrice });
    const price = formatPriceDual(pricing.currentPrice);
    const comparePrice = pricing.comparePrice ? formatPriceDual(pricing.comparePrice) : '';
    const url = buildProductPageUrl(product.id);
    const storeLabel = isSmartCutProduct(product) ? 'Smart Cut Services' : store.storeName;
    const isVerifiedVendor = !isSmartCutProduct(product) && isProVendorProduct(product);

    return `
      <a class="home-discovery-card" href="${escapeHtml(url)}">
        <div class="home-discovery-card__image">
          <img src="${escapeHtml(image)}" alt="${escapeHtml(product.name || 'Produit')}">
        </div>
        <div class="home-discovery-card__body">
          <h3>${escapeHtml(product.name || 'Produit')}</h3>
          <p class="home-discovery-card__store">
            <i class="fas fa-store"></i>${escapeHtml(storeLabel)}
            ${isVerifiedVendor ? '<span class="home-discovery-card__verified"><i class="fas fa-check-circle"></i> Vérifié</span>' : ''}
          </p>
          ${product.shortDescription ? `<p class="home-discovery-card__desc">${escapeHtml(product.shortDescription)}</p>` : '<p class="home-discovery-card__desc"></p>'}
          <div class="home-discovery-card__footer">
            <strong>${escapeHtml(price)}</strong>
            ${comparePrice ? `<span>${escapeHtml(comparePrice)}</span>` : ''}
          </div>
        </div>
      </a>
    `;
  }

  renderVendorCard(vendor) {
    const name = vendor.shopName || vendor.vendorName || vendor.storeName || vendor.businessName || 'Boutique partenaire';
    const category = vendor.category || vendor.businessCategory || 'Marketplace';
    const city = vendor.city || vendor.commune || vendor.department || 'Haiti';
    const initials = normalizeText(name).split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('') || 'SC';
    const params = new URLSearchParams({ vendor: String(vendor.id) });

    return `
      <a class="home-vendor-card" href="./vendor-marketplace.html?${params.toString()}">
        <div class="home-vendor-card__mark">${escapeHtml(initials)}</div>
        <div>
          <h3>${escapeHtml(name)}</h3>
          <p>${escapeHtml(category)} · ${escapeHtml(city)}</p>
          <span>${Number(vendor.salesScore || 0) > 0 ? `${Number(vendor.salesScore)} vente(s)` : 'Store actif'}</span>
        </div>
      </a>
    `;
  }

  renderSkeletonCards(count) {
    return Array.from({ length: count }, () => `
      <div class="home-discovery-card home-discovery-card--skeleton">
        <div class="home-discovery-card__image"></div>
        <div class="home-discovery-card__body">
          <span></span><strong></strong><em></em>
        </div>
      </div>
    `).join('');
  }

  renderSkeletonVendors(count) {
    return Array.from({ length: count }, () => `
      <div class="home-vendor-card home-vendor-card--skeleton">
        <div class="home-vendor-card__mark"></div>
        <div><strong></strong><span></span></div>
      </div>
    `).join('');
  }

  renderEmpty(message) {
    return `<div class="home-discovery-empty">${escapeHtml(message)}</div>`;
  }

  styles() {
    return `
      .home-discovery {
        width: 100%;
        max-width: 1400px;
        margin: 0 auto;
        padding: 0 1rem;
      }

      .home-discovery__section {
        margin-bottom: 2.6rem;
      }

      .home-discovery__section:last-child {
        margin-bottom: 0;
      }

      .home-discovery__heading {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 1.2rem;
      }

      .home-discovery__heading h2 {
        margin: 0;
        font-family: "Cormorant Garamond", serif;
        font-size: 1.875rem;
        line-height: 1.15;
        color: #1f1e1c;
      }

      .home-discovery__rail,
      .home-discovery__vendors {
        display: grid;
        gap: 1.2rem;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .home-discovery-card {
        overflow: hidden;
        border-radius: 18px;
        background: #ffffff;
        color: #1f1e1c;
        text-decoration: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
        transition: transform 0.22s ease, box-shadow 0.22s ease;
      }

      .home-discovery-card:hover {
        transform: translateY(-8px);
        box-shadow: 0 20px 35px rgba(0, 0, 0, 0.12);
      }

      .home-discovery-card__image {
        aspect-ratio: 1 / 1;
        background: #eee8dc;
      }

      .home-discovery-card__image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .home-discovery-card__body {
        padding: 1rem;
      }

      .home-discovery-card h3 {
        min-height: 3.05rem;
        margin: 0 0 0.35rem;
        color: #1f1e1c;
        font-size: 1.125rem;
        font-weight: 500;
        line-height: 1.35;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .home-discovery-card__store {
        display: block;
        margin: 0 0 0.5rem;
        color: rgba(122, 116, 107, 0.9);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .home-discovery-card__store i {
        margin-right: 0.25rem;
        font-size: 0.72rem;
      }

      .home-discovery-card__verified {
        display: inline-flex;
        align-items: center;
        gap: 0.2rem;
        margin-left: 0.35rem;
        border-radius: 999px;
        padding: 0.15rem 0.4rem;
        background: rgba(16, 185, 129, 0.12);
        color: #047857;
        font-size: 0.68rem;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: none;
        vertical-align: middle;
      }

      .home-discovery-card__verified i {
        margin-right: 0;
        color: #059669;
      }

      .home-discovery-card__desc {
        min-height: 2.5rem;
        margin: 0 0 0.65rem;
        color: #7a746b;
        font-size: 0.875rem;
        line-height: 1.45;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .home-discovery-card__footer {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 0.5rem;
      }

      .home-discovery-card__footer strong {
        color: #1f1e1c;
        font-size: 1.25rem;
      }

      .home-discovery-card__footer span {
        color: #8b7e6b;
        font-size: 0.9rem;
        text-decoration: line-through;
      }

      .home-vendor-card {
        display: flex;
        align-items: center;
        gap: 0.8rem;
        min-height: 92px;
        border: 1px solid rgba(31, 30, 28, 0.08);
        border-radius: 18px;
        padding: 0.9rem;
        background: #ffffff;
        color: #1f1e1c;
        text-decoration: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
        transition: transform 0.22s ease, box-shadow 0.22s ease;
      }

      .home-vendor-card:hover {
        transform: translateY(-8px);
        box-shadow: 0 20px 35px rgba(0, 0, 0, 0.12);
      }

      .home-vendor-card__mark {
        display: grid;
        place-items: center;
        flex: 0 0 54px;
        width: 54px;
        height: 54px;
        border-radius: 18px;
        background: #1f1e1c;
        color: #f5f1e8;
        font-family: "Cormorant Garamond", serif;
        font-size: 1.25rem;
        font-weight: 800;
      }

      .home-vendor-card h3 {
        margin: 0 0 0.2rem;
        font-weight: 800;
      }

      .home-vendor-card p {
        margin: 0 0 0.4rem;
        color: #6f695f;
        font-size: 0.86rem;
      }

      .home-vendor-card span {
        color: #9b7a28;
        font-size: 0.75rem;
        font-weight: 800;
      }

      .home-discovery-empty {
        grid-column: 1 / -1;
        border: 1px dashed rgba(31, 30, 28, 0.16);
        border-radius: 18px;
        padding: 1rem;
        color: #6f695f;
        background: rgba(255, 255, 255, 0.55);
      }

      .home-discovery-card--skeleton,
      .home-vendor-card--skeleton {
        min-height: 170px;
        background: linear-gradient(90deg, rgba(255,255,255,0.55), rgba(245,241,232,0.9), rgba(255,255,255,0.55));
        background-size: 220% 100%;
        animation: homeDiscoveryPulse 1.4s ease infinite;
      }

      .home-vendor-card--skeleton {
        min-height: 92px;
      }

      .home-discovery-card--skeleton .home-discovery-card__body > *,
      .home-vendor-card--skeleton strong,
      .home-vendor-card--skeleton span {
        display: block;
        height: 0.75rem;
        border-radius: 999px;
        background: rgba(31,30,28,0.08);
        margin: 0.5rem 0;
      }

      @keyframes homeDiscoveryPulse {
        0% { background-position: 0% 50%; }
        100% { background-position: 220% 50%; }
      }

      @media (min-width: 640px) {
        .home-discovery__rail,
        .home-discovery__vendors {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }
      }

      @media (min-width: 768px) {
        .home-discovery__heading h2 {
          font-size: 2.25rem;
        }
      }

      @media (min-width: 1024px) {
        .home-discovery__rail,
        .home-discovery__vendors {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }

      @media (min-width: 1440px) {
        .home-discovery__rail,
        .home-discovery__vendors {
          grid-template-columns: repeat(5, minmax(0, 1fr));
        }
      }

      @media (max-width: 520px) {
        .home-discovery-card__body {
          padding: 0.85rem;
        }

        .home-discovery-card h3 {
          font-size: 1rem;
        }

        .home-discovery__vendors {
          grid-template-columns: 1fr;
        }
      }
    `;
  }
}
