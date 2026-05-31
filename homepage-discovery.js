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

function buildVendorFallbackFromProducts(products = []) {
  const vendors = new Map();
  products.forEach((product) => {
    const store = getProductStoreMeta(product);
    if (!store.isVendorStore) return;
    const vendorId = String(product.vendorId || product.storeId || '').trim();
    if (!vendorId) return;

    const current = vendors.get(vendorId) || {
      id: vendorId,
      shopName: store.storeName,
      category: product.categoryName || product.category || 'Marketplace',
      city: product.vendorCity || product.city || product.department || 'Haïti',
      salesScore: 0
    };

    current.salesScore += Number(product.salesCount || product.totalSold || product.soldCount || 0) || 1;
    vendors.set(vendorId, current);
  });

  return shuffle(Array.from(vendors.values()).sort((a, b) => b.salesScore - a.salesScore).slice(0, 18));
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
      <section class="home-discovery" aria-label="Découverte produits et vendeurs">
        <div class="home-discovery__halo"></div>
        <div class="home-discovery__section" data-section="sponsored">
          <div class="home-discovery__heading">
            <span class="home-discovery__eyebrow">Visibilité premium</span>
            <h2>Sponsored</h2>
            <p>Produits Smart Cut et vendeurs Pro mis en avant de façon aléatoire.</p>
          </div>
          <div class="home-discovery__rail" data-sponsored-list>${this.renderSkeletonCards(4)}</div>
        </div>
        <div class="home-discovery__section" data-section="recommended">
          <div class="home-discovery__heading">
            <span class="home-discovery__eyebrow">Pour vous</span>
            <h2>Produits recommandés</h2>
            <p>Inspirés par vos recherches récentes, avec un fallback catalogue si aucun historique n existe.</p>
          </div>
          <div class="home-discovery__rail" data-recommended-list>${this.renderSkeletonCards(4)}</div>
        </div>
        <div class="home-discovery__section home-discovery__section--vendors" data-section="vendors">
          <div class="home-discovery__heading">
            <span class="home-discovery__eyebrow">Stores actifs</span>
            <h2>Top vendeurs</h2>
            <p>Boutiques avec le plus d activité, affichées avec une rotation aléatoire.</p>
          </div>
          <div class="home-discovery__vendors" data-vendors-list>${this.renderSkeletonVendors(4)}</div>
        </div>
      </section>
      <style>${this.styles()}</style>
    `;
  }

  async load() {
    try {
      await loadCurrencySettings();
      const [products, vendors] = await Promise.all([
        loadPublicProducts({ maxPerCollection: 160 }),
        this.loadTopVendors()
      ]);

      const activeProducts = products.filter((product) => getBasePrice(product) > 0);
      this.renderSponsored(activeProducts);
      this.renderRecommended(activeProducts);
      this.renderVendors(vendors.length ? vendors : buildVendorFallbackFromProducts(activeProducts).slice(0, this.options.maxVendors));
    } catch (error) {
      console.error('Erreur chargement sections homepage:', error);
      this.root.querySelector('.home-discovery')?.classList.add('home-discovery--error');
      this.root.querySelector('[data-sponsored-list]').innerHTML = this.renderEmpty('Impossible de charger les produits sponsorisés.');
      this.root.querySelector('[data-recommended-list]').innerHTML = this.renderEmpty('Impossible de charger les recommandations.');
      this.root.querySelector('[data-vendors-list]').innerHTML = this.renderEmpty('Impossible de charger les vendeurs.');
    }
  }

  renderSponsored(products) {
    const sponsored = products.filter((product) => isSmartCutProduct(product) || isProVendorProduct(product));
    const selected = shuffle(sponsored.length ? sponsored : products).slice(0, this.options.maxProducts);
    this.root.querySelector('[data-sponsored-list]').innerHTML = selected.length
      ? selected.map((product) => this.renderProductCard(product, 'Sponsored')).join('')
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
      ? selected.map((product) => this.renderProductCard(product, scored.length ? 'Recommandé' : 'Découverte')).join('')
      : this.renderEmpty('Aucun produit disponible pour le moment.');
  }

  async loadTopVendors() {
    let vendors = [];
    try {
      const snapshot = await getDocs(query(collection(db, 'vendors'), limit(100)));
      vendors = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((vendor) => {
          const status = normalizeText(vendor.status || vendor.vendorStatus || 'active');
          return !status || ['active', 'approved'].some((value) => status.includes(value));
        });
    } catch (error) {
      console.warn('Top vendeurs indisponibles, fallback vide:', error);
      return [];
    }

    const salesByVendor = new Map();
    vendors.forEach((vendor) => {
      const fallbackScore = Number(vendor.salesCount || vendor.totalSales || vendor.ordersCount || vendor.completedOrders || 0);
      salesByVendor.set(String(vendor.id), Number.isFinite(fallbackScore) ? fallbackScore : 0);
    });

    try {
      const ordersSnapshot = await getDocs(query(collection(db, 'orders'), limit(300)));
      ordersSnapshot.docs.forEach((docSnap) => {
        const order = docSnap.data() || {};
        if (!isPaidLikeOrder(order)) return;
        getOrderVendorIds(order).forEach((vendorId) => {
          salesByVendor.set(vendorId, (salesByVendor.get(vendorId) || 0) + 1);
        });
      });
    } catch (error) {
      console.warn('Lecture commandes top vendeurs ignoree:', error);
    }

    return shuffle(
      vendors
        .map((vendor) => ({ ...vendor, salesScore: salesByVendor.get(String(vendor.id)) || 0 }))
        .sort((a, b) => b.salesScore - a.salesScore)
        .slice(0, 18)
    ).slice(0, this.options.maxVendors);
  }

  renderVendors(vendors) {
    this.root.querySelector('[data-vendors-list]').innerHTML = vendors.length
      ? vendors.map((vendor) => this.renderVendorCard(vendor)).join('')
      : this.renderEmpty('Aucun vendeur actif disponible pour le moment.');
  }

  renderProductCard(product, badge) {
    const store = getProductStoreMeta(product);
    const image = getProductImage(product, this.options.imageBasePath);
    const pricing = getProductPricing(product, getBasePrice(product), { comparePrice: product.comparePrice });
    const price = formatPriceDual(pricing.currentPrice);
    const url = buildProductPageUrl(product.id);
    const storeLabel = isSmartCutProduct(product) ? 'Smart Cut' : store.storeName;

    return `
      <a class="home-discovery-card" href="${escapeHtml(url)}">
        <span class="home-discovery-card__badge">${escapeHtml(badge)}</span>
        <div class="home-discovery-card__image">
          <img src="${escapeHtml(image)}" alt="${escapeHtml(product.name || 'Produit')}">
        </div>
        <div class="home-discovery-card__body">
          <p class="home-discovery-card__store">${escapeHtml(storeLabel)}</p>
          <h3>${escapeHtml(product.name || 'Produit')}</h3>
          <div class="home-discovery-card__footer">
            <strong>${escapeHtml(price)}</strong>
            ${pricing.hasDiscount ? '<span>Promo</span>' : '<span>Voir</span>'}
          </div>
        </div>
      </a>
    `;
  }

  renderVendorCard(vendor) {
    const name = vendor.shopName || vendor.vendorName || vendor.storeName || vendor.businessName || 'Boutique partenaire';
    const category = vendor.category || vendor.businessCategory || 'Marketplace';
    const city = vendor.city || vendor.commune || vendor.department || 'Haïti';
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
        position: relative;
        width: min(1180px, calc(100vw - 1.5rem));
        margin: 0 auto;
        padding: clamp(1rem, 2vw, 1.5rem);
        border: 1px solid rgba(198, 167, 94, 0.18);
        border-radius: 32px;
        background:
          radial-gradient(circle at top left, rgba(198, 167, 94, 0.18), transparent 32%),
          linear-gradient(135deg, rgba(255,255,255,0.92), rgba(245,241,232,0.78));
        box-shadow: 0 22px 70px rgba(31, 30, 28, 0.08);
        overflow: hidden;
      }

      .home-discovery__halo {
        position: absolute;
        inset: auto -18% -25% auto;
        width: 36rem;
        height: 36rem;
        border-radius: 999px;
        background: rgba(198, 167, 94, 0.12);
        filter: blur(22px);
        pointer-events: none;
      }

      .home-discovery__section {
        position: relative;
        display: grid;
        grid-template-columns: minmax(180px, 260px) minmax(0, 1fr);
        gap: clamp(1rem, 2vw, 1.5rem);
        align-items: start;
        padding: clamp(1rem, 2.2vw, 1.8rem) 0;
        border-bottom: 1px solid rgba(31, 30, 28, 0.08);
      }

      .home-discovery__section:last-child {
        border-bottom: 0;
        padding-bottom: 0.5rem;
      }

      .home-discovery__heading h2 {
        margin: 0.2rem 0 0.45rem;
        font-family: "Cormorant Garamond", serif;
        font-size: clamp(2rem, 4vw, 3.15rem);
        line-height: 0.95;
        color: #1f1e1c;
      }

      .home-discovery__heading p {
        max-width: 18rem;
        color: #6f695f;
        font-size: 0.92rem;
        line-height: 1.65;
      }

      .home-discovery__eyebrow {
        display: inline-flex;
        width: fit-content;
        border-radius: 999px;
        padding: 0.35rem 0.65rem;
        background: rgba(198, 167, 94, 0.14);
        color: #9b7a28;
        font-size: 0.68rem;
        font-weight: 800;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }

      .home-discovery__rail {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 0.85rem;
      }

      .home-discovery-card {
        position: relative;
        min-height: 100%;
        overflow: hidden;
        border: 1px solid rgba(31, 30, 28, 0.08);
        border-radius: 24px;
        background: rgba(255, 255, 255, 0.78);
        color: #1f1e1c;
        text-decoration: none;
        box-shadow: 0 14px 38px rgba(31, 30, 28, 0.07);
        transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
      }

      .home-discovery-card:hover {
        transform: translateY(-4px);
        border-color: rgba(198, 167, 94, 0.38);
        box-shadow: 0 18px 46px rgba(31, 30, 28, 0.12);
      }

      .home-discovery-card__badge {
        position: absolute;
        z-index: 2;
        top: 0.65rem;
        left: 0.65rem;
        border-radius: 999px;
        padding: 0.3rem 0.55rem;
        background: rgba(31, 30, 28, 0.82);
        color: #fff;
        font-size: 0.68rem;
        font-weight: 700;
      }

      .home-discovery-card__image {
        aspect-ratio: 1 / 0.86;
        background: #eee8dc;
      }

      .home-discovery-card__image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .home-discovery-card__body {
        padding: 0.85rem;
      }

      .home-discovery-card__store {
        margin: 0 0 0.3rem;
        color: #9b7a28;
        font-size: 0.68rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .home-discovery-card h3 {
        min-height: 2.75rem;
        margin: 0;
        color: #1f1e1c;
        font-size: 0.95rem;
        line-height: 1.35;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .home-discovery-card__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.65rem;
        margin-top: 0.9rem;
      }

      .home-discovery-card__footer strong {
        font-size: 1rem;
      }

      .home-discovery-card__footer span {
        border-radius: 999px;
        padding: 0.25rem 0.55rem;
        background: #f5f1e8;
        color: #6f695f;
        font-size: 0.72rem;
        font-weight: 700;
      }

      .home-discovery__vendors {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 0.85rem;
      }

      .home-vendor-card {
        display: flex;
        align-items: center;
        gap: 0.8rem;
        min-height: 92px;
        border: 1px solid rgba(31, 30, 28, 0.08);
        border-radius: 24px;
        padding: 0.9rem;
        background: rgba(255, 255, 255, 0.78);
        color: #1f1e1c;
        text-decoration: none;
        box-shadow: 0 14px 38px rgba(31, 30, 28, 0.06);
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
        border-radius: 22px;
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

      @media (max-width: 980px) {
        .home-discovery__section {
          grid-template-columns: 1fr;
        }

        .home-discovery__heading p {
          max-width: 100%;
        }

        .home-discovery__rail {
          display: flex;
          overflow-x: auto;
          padding-bottom: 0.35rem;
          scroll-snap-type: x mandatory;
        }

        .home-discovery-card {
          min-width: min(74vw, 260px);
          scroll-snap-align: start;
        }

        .home-discovery__vendors {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 520px) {
        .home-discovery {
          width: min(100vw - 1rem, 1180px);
          border-radius: 24px;
        }

        .home-discovery__heading h2 {
          font-size: 2.1rem;
        }
      }
    `;
  }
}
