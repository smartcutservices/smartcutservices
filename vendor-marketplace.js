import { db } from './firebase-init.js';
import { collection, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { renderPublicServiceNav } from './public-service-nav.js';

class VendorMarketplacePage {
  constructor(containerId = 'vendor-marketplace-root') {
    this.container = document.getElementById(containerId);
    this.products = [];
    this.filteredProducts = [];
    this.vendors = new Map();
    this.searchTerm = '';
    if (!this.container) return;
    this.init();
  }

  async init() {
    await this.loadData();
    this.filteredProducts = [...this.products];
    this.render();
    this.attachEvents();
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
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  formatPrice(value) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency',
      currency: 'HTG',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }

  escape(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  getProductCard(product) {
    const vendor = this.vendors.get(product.vendorId);
    const image = Array.isArray(product.images) && product.images[0]
      ? `<img src="${product.images[0]}" alt="${this.escape(product.name || 'Produit vendeur')}" style="width:100%;height:100%;object-fit:cover;">`
      : '<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#c6a75e;font-weight:800;">VENDEUR</div>';
    return `
      <article style="border:1px solid rgba(31,30,28,0.08);border-radius:1.7rem;background:rgba(255,255,255,0.94);box-shadow:0 18px 40px rgba(31,30,28,0.08);overflow:hidden;display:grid;">
        <div style="position:relative;height:250px;background:linear-gradient(180deg, rgba(198,167,94,0.08), rgba(255,255,255,0.4));">
          ${image}
          <span style="position:absolute;top:1rem;left:1rem;display:inline-flex;align-items:center;gap:.45rem;background:rgba(31,30,28,0.9);color:#F8F5EF;border-radius:999px;padding:.45rem .8rem;font-size:.78rem;font-weight:700;">
            <i class="fas fa-store"></i>
            Vendeur
          </span>
        </div>
        <div style="padding:1.2rem;display:grid;gap:.8rem;">
          <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;">
            <div>
              <h3 style="font-family:'Cormorant Garamond',serif;font-size:1.8rem;line-height:1;">${this.escape(product.name || 'Produit vendeur')}</h3>
              <p style="margin-top:.45rem;color:#6E6557;">${this.escape(vendor?.vendorName || product.vendorName || 'Boutique partenaire')}</p>
            </div>
            <strong style="font-size:1.05rem;color:#1F1E1C;">${this.formatPrice(product.price)}</strong>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:.55rem;">
            ${product.category ? `<span style="display:inline-flex;border-radius:999px;background:rgba(198,167,94,0.14);color:#8A6D2D;padding:.45rem .75rem;font-size:.78rem;font-weight:700;">${this.escape(product.category)}</span>` : ''}
            ${product.deliveryMode ? `<span style="display:inline-flex;border-radius:999px;background:rgba(31,30,28,0.06);color:#5E564C;padding:.45rem .75rem;font-size:.78rem;font-weight:700;">${this.escape(product.deliveryMode)}</span>` : ''}
          </div>
          <p style="color:#6E6557;line-height:1.75;">${this.escape(product.shortDescription || product.longDescription || 'Produit vendeur valide et publie dans la section marketplace Smart Cut Services.')}</p>
          <div style="display:flex;gap:.7rem;flex-wrap:wrap;">
            <button type="button" data-add-vendor-product="${product.id}" style="border:none;border-radius:999px;background:#1F1E1C;color:#F8F5EF;padding:.85rem 1rem;font-weight:800;cursor:pointer;">Ajouter au panier</button>
            <span style="display:inline-flex;align-items:center;color:#6E6557;font-size:.84rem;">Stock: ${Number.isFinite(product.stock) ? product.stock : '-'}</span>
          </div>
        </div>
      </article>
    `;
  }

  render() {
    this.container.innerHTML = `
      <section style="max-width:1280px;margin:0 auto;padding:1rem 1rem 3rem;display:grid;gap:1.25rem;">
        <article style="border:1px solid rgba(31,30,28,0.08);border-radius:2rem;background:linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,242,230,0.94));box-shadow:0 24px 60px rgba(31,30,28,0.08);padding:clamp(1.5rem,4vw,2.6rem);">
          <small style="display:inline-block;color:#C6A75E;text-transform:uppercase;letter-spacing:.16em;font-size:.76rem;font-weight:700;margin-bottom:.8rem;">Marketplace vendeurs</small>
          <h1 style="font-family:'Cormorant Garamond',serif;font-size:clamp(2.7rem,7vw,4.9rem);line-height:.92;margin:0;">Selection vendeurs approuves</h1>
          <p style="margin:1rem 0 0;color:#6E6557;line-height:1.85;max-width:72ch;">Cette section publique reste separee du catalogue principal. Elle affiche uniquement les produits vendeur approuves et publies par l'administration Smart Cut Services.</p>
          <div style="margin-top:1.25rem;display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:1rem;">
            <input id="vendorMarketplaceSearch" type="text" value="${this.escape(this.searchTerm)}" placeholder="Rechercher un produit, une categorie ou une boutique" style="width:100%;border:1px solid rgba(31,30,28,0.12);border-radius:999px;padding:.95rem 1.1rem;background:#fff;font:inherit;">
            <button id="vendorMarketplaceOpenCart" type="button" style="border:1px solid rgba(31,30,28,0.12);border-radius:999px;background:#fff;color:#1F1E1C;padding:.95rem 1.1rem;font-weight:700;cursor:pointer;">Ouvrir le panier</button>
          </div>
        </article>

        ${renderPublicServiceNav('marketplace')}

        ${this.filteredProducts.length === 0 ? `
          <article style="border:1px dashed rgba(198,167,94,0.28);border-radius:1.7rem;background:rgba(255,255,255,0.72);padding:2rem;text-align:center;color:#6E6557;">
            <i class="fas fa-store-slash" style="font-size:1.6rem;color:#C6A75E;margin-bottom:.8rem;"></i>
            <p>Aucun produit vendeur public pour le moment.</p>
          </article>
        ` : `
          <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1.15rem;">
            ${this.filteredProducts.map((product) => this.getProductCard(product)).join('')}
          </section>
        `}
      </section>
    `;
  }

  attachEvents() {
    this.container.querySelector('#vendorMarketplaceSearch')?.addEventListener('input', (event) => {
      const search = String(event.target.value || '').trim().toLowerCase();
      this.searchTerm = event.target.value || '';
      this.filteredProducts = this.products.filter((item) => {
        const vendor = this.vendors.get(item.vendorId);
        const haystack = [
          item.name,
          item.category,
          item.shortDescription,
          item.longDescription,
          item.vendorName,
          vendor?.vendorName,
          vendor?.shopName
        ].join(' ').toLowerCase();
        return !search || haystack.includes(search);
      });
      this.render();
      this.attachEvents();
    });

    this.container.querySelector('#vendorMarketplaceOpenCart')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('openCart'));
    });

    this.container.querySelectorAll('[data-add-vendor-product]').forEach((button) => {
      button.addEventListener('click', () => {
        const product = this.products.find((item) => item.id === button.dataset.addVendorProduct);
        if (!product) return;
        document.dispatchEvent(new CustomEvent('addToCart', {
          detail: {
            productId: product.id,
            name: product.name || 'Produit vendeur',
            price: Number(product.price) || 0,
            quantity: 1,
            sku: product.sku || '',
            image: Array.isArray(product.images) ? (product.images[0] || '') : '',
            vendorId: product.vendorId || '',
            vendorName: product.vendorName || this.vendors.get(product.vendorId)?.vendorName || '',
            commissionRule: product.commissionRule || null,
            sourceType: 'vendor_marketplace',
            category: product.category || '',
            deliveryMode: product.deliveryMode || '',
            stockLimit: Number.isFinite(Number(product.stock)) ? Number(product.stock) : undefined,
            selectedOptions: [
              { label: 'Source', value: 'Marketplace vendeurs' },
              ...(product.category ? [{ label: 'Categorie', value: product.category }] : []),
              ...(product.deliveryMode ? [{ label: 'Livraison', value: product.deliveryMode }] : [])
            ]
          }
        }));
        document.dispatchEvent(new CustomEvent('openCart'));
      });
    });
  }
}

export default VendorMarketplacePage;
