import { db } from './firebase-init.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { getProductPricing } from './product-display-utils.js';
import { buildProductPageUrl } from './product-links.js';
import { formatPriceDual, loadCurrencySettings } from './currency-utils.js';
import { getAuthManager } from './auth.js';

class VendorMarketplacePage {
  constructor(containerId = 'vendor-marketplace-root') {
    this.container = document.getElementById(containerId);
    this.products = [];
    this.filteredProducts = [];
    this.vendors = new Map();
    this.selectedVendorId = new URLSearchParams(window.location.search).get('vendor') || '';
    if (!this.container) return;
    this.init();
  }

  async init() {
    await loadCurrencySettings();
    this.authManager = getAuthManager();
    await this.authManager.waitForAuthReady?.();
    if (!this.authManager.isAuthenticated?.()) {
      this.renderAuthRequired();
      this.container.querySelector('[data-vendor-login]')?.addEventListener('click', () => this.authManager.openAuthModal?.('login'));
      document.addEventListener('authChanged', () => {
        if (this.authManager.isAuthenticated?.()) this.init();
      }, { once: true });
      return;
    }
    await this.loadData();
    this.filteredProducts = [...this.products];
    this.render();
    this.attachEvents();
  }

  renderAuthRequired() {
    this.container.innerHTML = `<section class="vendor-store vendor-store--auth-required"><article class="vendor-store__auth-card"><span class="vendor-store__auth-icon"><i class="fas fa-lock"></i></span><h1>Connectez-vous pour accéder à cette boutique</h1><p>Créez un compte Smart Cut Services ou connectez-vous pour découvrir les produits des vendeurs et les ajouter à votre panier.</p><button type="button" data-vendor-login>Se connecter ou s’inscrire</button><a href="./index.html">Retour à l’accueil</a></article></section>`;
  }

  async loadData() {
    const [productSnapshot, vendorSnapshot] = await Promise.all([
      getDocs(query(collection(db, 'vendorProducts'), where('status', '==', 'active'))),
      getDocs(query(collection(db, 'vendors'), where('status', '==', 'active')))
    ]);

    this.vendors = new Map(vendorSnapshot.docs.map((entry) => [entry.id, { id: entry.id, ...entry.data() }]));
    this.products = productSnapshot.docs
      .map((entry) => ({ id: entry.id, ...entry.data() }))
      .filter((item) => this.vendors.has(item.vendorId))
      .sort((a, b) => this.getProPriority(b) - this.getProPriority(a) || String(a.name || '').localeCompare(String(b.name || '')));

    if (this.selectedVendorId) {
      this.products = this.products.filter((item) => String(item.vendorId) === String(this.selectedVendorId));
    }
  }

  formatPrice(value) {
    return formatPriceDual(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  escape(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  isProVendor(product = {}) {
    const vendor = this.vendors.get(product.vendorId);
    const planId = String(product.planId || vendor?.planId || '').toLowerCase();
    const planLabel = String(product.planLabel || vendor?.planLabel || '').toLowerCase();
    return Boolean(product.vendorVerified || vendor?.vendorVerified || planId === 'pro' || planLabel.includes('pro'));
  }

  getProPriority(product = {}) {
    return this.isProVendor(product) ? 1 : 0;
  }

  getProductCard(product) {
    const pricing = getProductPricing(product, product.price || 0);
    const isPro = this.isProVendor(product);
    const image = Array.isArray(product.images) && product.images[0]
      ? `<img src="${product.images[0]}" alt="${this.escape(product.name || 'Produit vendeur')}" style="width:100%;height:100%;object-fit:cover;">`
      : '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#ffa41c;font-weight:800;">VENDEUR</div>';
    return `
      <article class="vendor-store-product" data-open-vendor-product="${this.escape(product.id)}" tabindex="0" role="link" aria-label="Voir ${this.escape(product.name || 'ce produit')}">
        <div class="vendor-store-product__media">
          ${image}
          ${isPro ? `
            <span class="vendor-store-product__verified" aria-label="Boutique vérifiée" title="Boutique vérifiée">
              <i class="fas fa-check" aria-hidden="true"></i>
            </span>
          ` : ''}
        </div>
        <div class="vendor-store-product__body">
          <h3>${this.escape(product.name || 'Produit vendeur')}</h3>
          <div class="vendor-store-product__purchase">
            <div class="vendor-store-product__price">
              <strong>${this.formatPrice(pricing.currentPrice)}</strong>
              ${pricing.comparePrice ? `<span>${this.formatPrice(pricing.comparePrice)}</span>` : ''}
            </div>
            <button type="button" data-add-vendor-product="${product.id}" aria-label="Ajouter ${this.escape(product.name || 'ce produit')} au panier">
              <i class="fas fa-bag-shopping" aria-hidden="true"></i> Ajouter
            </button>
          </div>
        </div>
      </article>
    `;
  }

  render() {
    const selectedVendor = this.selectedVendorId ? this.vendors.get(this.selectedVendorId) : null;
    const hasVendorFilter = Boolean(this.selectedVendorId);
    const pageTitle = selectedVendor
      ? this.escape(selectedVendor.shopName || selectedVendor.vendorName || 'Boutique vendeur')
      : (hasVendorFilter ? 'Boutique indisponible' : 'Produits des vendeurs');
    const productCount = this.filteredProducts.length;
    const productCountLabel = `${productCount} produit${productCount > 1 ? 's' : ''}`;

    this.container.innerHTML = `
      <style>
        .vendor-store { max-width:1280px; margin:0 auto; padding:.45rem 1rem 3rem; }
        .vendor-store__head { display:flex; align-items:end; justify-content:space-between; gap:1rem; padding:1.2rem 0; border-bottom:1px solid rgba(31,30,28,.12); }
        .vendor-store__identity { display:flex; align-items:center; gap:.9rem; }
        .vendor-store__mark { display:grid; place-items:center; width:48px; height:48px; flex:0 0 48px; border-radius:12px; background:#131921; color:#ffa41c; font-size:1.1rem; }
        .vendor-store__head h1 { margin:0; color:#131921; font-size:clamp(1.55rem,3vw,2.25rem); line-height:1.1; letter-spacing:-.025em; }
        .vendor-store__count { flex:0 0 auto; color:#6e6557; font-size:.85rem; font-weight:700; }
        .vendor-store__grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:1rem; padding-top:1.25rem; }
        .vendor-store-product { overflow:hidden; display:grid; align-content:start; border:1px solid rgba(31,30,28,.1); border-radius:14px; background:#fff; box-shadow:0 5px 18px rgba(31,30,28,.06); transition:transform .2s ease,box-shadow .2s ease; }
        .vendor-store-product:hover { transform:translateY(-2px); box-shadow:0 10px 26px rgba(31,30,28,.1); }
        .vendor-store-product__media { position:relative; aspect-ratio:1/1; overflow:hidden; background:#f4f1eb; }
        .vendor-store-product__verified { position:absolute; top:.7rem; right:.7rem; display:grid; place-items:center; width:28px; height:28px; border-radius:50%; background:#131921; color:#ffa41c; font-size:.7rem; box-shadow:0 4px 12px rgba(0,0,0,.16); }
        .vendor-store-product__body { display:grid; gap:.85rem; padding:1rem; }
        .vendor-store-product__body h3 { margin:0; min-height:2.5em; color:#1f1e1c; font-size:.98rem; line-height:1.25; }
        .vendor-store-product__purchase { display:flex; align-items:center; justify-content:space-between; gap:.75rem; }
        .vendor-store-product__price { display:grid; gap:.1rem; }
        .vendor-store-product__price strong { color:#0f1111; font-size:.98rem; }
        .vendor-store-product__price span { color:#777; font-size:.72rem; text-decoration:line-through; }
        .vendor-store-product__purchase button { display:inline-flex; align-items:center; justify-content:center; gap:.4rem; min-height:38px; border:0; border-radius:8px; padding:0 .8rem; background:#131921; color:#fff; font:inherit; font-size:.8rem; font-weight:800; cursor:pointer; }
        .vendor-store__empty { margin-top:1.25rem; padding:2rem 1rem; border:1px dashed rgba(31,30,28,.16); border-radius:12px; background:rgba(255,255,255,.72); color:#6e6557; text-align:center; }
        .vendor-store__empty i { display:block; margin-bottom:.65rem; color:#ffa41c; font-size:1.35rem; }
        .vendor-store--auth-required { min-height:calc(100vh - 170px); display:grid; place-items:center; }
        .vendor-store__auth-card { width:min(100%,560px); padding:2.5rem 2rem; border:1px solid #e5d4b3; border-radius:18px; background:linear-gradient(145deg,#fffaf0,#fff); box-shadow:0 18px 42px rgba(31,30,28,.1); text-align:center; }
        .vendor-store__auth-icon { display:grid; place-items:center; width:58px; height:58px; margin:0 auto 1.1rem; border-radius:50%; background:#fff0d2; color:#d8890b; font-size:1.35rem; }
        .vendor-store__auth-card h1 { margin:0; color:#131921; font-size:clamp(1.35rem,3vw,1.9rem); line-height:1.2; }
        .vendor-store__auth-card p { margin: .8rem auto 1.3rem; max-width:450px; color:#687581; line-height:1.55; }
        .vendor-store__auth-card button,.vendor-store__auth-card a { display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:0 1rem; border-radius:9px; font:inherit; font-weight:800; text-decoration:none; }
        .vendor-store__auth-card button { border:0; background:#131921; color:#fff; cursor:pointer; }
        .vendor-store__auth-card a { margin-left:.5rem; border:1px solid #e1d4bd; color:#8a5f17; background:#fff; }
        @media (max-width:600px) {
          .vendor-store { padding-inline:.75rem; }
          .vendor-store__head { align-items:flex-start; padding-top:.65rem; }
          .vendor-store__mark { width:42px; height:42px; flex-basis:42px; }
          .vendor-store__count { padding-top:.25rem; }
          .vendor-store__grid { grid-template-columns:repeat(2,minmax(0,1fr)); gap:.65rem; }
          .vendor-store-product { border-radius:10px; }
          .vendor-store-product__body { gap:.65rem; padding:.75rem; }
          .vendor-store-product__body h3 { font-size:.86rem; }
          .vendor-store-product__purchase { align-items:stretch; flex-direction:column; }
          .vendor-store-product__purchase button { width:100%; }
          .vendor-store__auth-card { padding:2rem 1.1rem; }
          .vendor-store__auth-card a { margin:.55rem 0 0; }
          .vendor-store__auth-card button,.vendor-store__auth-card a { width:100%; }
        }
      </style>
      <section class="vendor-store">
        <header class="vendor-store__head">
          <div class="vendor-store__identity">
            <span class="vendor-store__mark" aria-hidden="true"><i class="fas fa-store"></i></span>
            <div>
              <h1>${pageTitle}</h1>
            </div>
          </div>
          ${!hasVendorFilter || selectedVendor ? `<span class="vendor-store__count">${productCountLabel}</span>` : ''}
        </header>

        ${this.filteredProducts.length === 0 ? `
          <article class="vendor-store__empty">
            <i class="fas fa-store-slash" aria-hidden="true"></i>
            <p>${hasVendorFilter ? 'Aucun produit disponible dans cette boutique.' : 'Aucun produit vendeur disponible pour le moment.'}</p>
          </article>
        ` : `
          <section class="vendor-store__grid" aria-label="Produits de la boutique">
            ${this.filteredProducts.map((product) => this.getProductCard(product)).join('')}
          </section>
        `}
      </section>
    `;
  }

  attachEvents() {
    this.container.querySelectorAll('[data-open-vendor-product]').forEach((card) => {
      const open = () => { if (card.dataset.openVendorProduct) window.location.href = buildProductPageUrl(card.dataset.openVendorProduct); };
      card.addEventListener('click', (event) => {
        if (event.target.closest('[data-add-vendor-product]')) return;
        open();
      });
      card.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('[data-add-vendor-product]')) {
          event.preventDefault();
          open();
        }
      });
    });
    this.container.querySelectorAll('[data-add-vendor-product]').forEach((button) => {
      button.addEventListener('click', () => {
        const product = this.products.find((item) => item.id === button.dataset.addVendorProduct);
        if (!product) return;
        const pricing = getProductPricing(product, product.price || 0);
        document.dispatchEvent(new CustomEvent('addToCart', {
          detail: {
            productId: product.id,
            name: product.name || 'Produit vendeur',
            price: pricing.currentPrice || 0,
            quantity: 1,
            sku: product.sku || '',
            image: Array.isArray(product.images) ? (product.images[0] || '') : '',
            vendorId: product.vendorId || '',
            vendorName: product.vendorName || this.vendors.get(product.vendorId)?.vendorName || '',
            productDeliveryCoverage: product.deliveryCoverage || product.productDeliveryCoverage || null,
            productDeliveryZones: Array.isArray(product.deliveryZones) ? product.deliveryZones : (product.productDeliveryZones || []),
            vendorDeliveryCoverage: product.deliveryCoverage || product.productDeliveryCoverage || this.vendors.get(product.vendorId)?.deliveryCoverage || null,
            vendorDeliveryZones: Array.isArray(product.deliveryZones) ? product.deliveryZones : (product.productDeliveryZones || this.vendors.get(product.vendorId)?.deliveryZones || []),
            commissionRule: product.commissionRule || null,
            sourceType: 'vendor_marketplace',
            sourceCollection: 'vendorProducts',
            category: product.category || '',
            deliveryMode: product.deliveryMode || '',
            isDigitalProduct: Boolean(product.isDigitalProduct),
            digitalDownloadLink: product.digitalDownloadLink || '',
            deliveryDelay: product.deliveryDelay || '',
            stockLimit: Number.isFinite(Number(product.stock)) ? Number(product.stock) : undefined,
            selectedOptions: [
              { label: 'Source', value: 'Marketplace vendeurs' },
              ...(product.category ? [{ label: 'Categorie', value: product.category }] : []),
              ...(product.deliveryMode ? [{ label: 'Livraison', value: product.deliveryMode }] : []),
              ...(product.isDigitalProduct ? [{ label: 'Type', value: 'Article digital' }] : []),
              ...(product.deliveryDelay ? [{ label: 'Delai', value: product.deliveryDelay }] : [])
            ]
          }
        }));
      });
    });
  }
}

export default VendorMarketplacePage;
