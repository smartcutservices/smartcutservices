import { db } from './firebase-init.js';
import { getAuthManager } from './auth.js';
import { uploadImageFile } from './firebase-storage.js';
import { buildVendorSalesSummary, loadAllOrdersWithClients } from './vendor-analytics.js';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  updateDoc,
  where
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class VendorPortalPage {
  constructor(rootId = 'vendor-portal-root') {
    this.root = document.getElementById(rootId);
    this.auth = getAuthManager();
    this.user = this.auth.getCurrentUser();
    this.vendor = null;
    this.products = [];
    this.salesSummary = null;
    this.editingProductId = null;
    this.activeSection = 'overview';
    if (!this.root) return;

    document.addEventListener('authChanged', async (event) => {
      this.user = event.detail?.user || null;
      await this.loadData();
      this.render();
    });

    this.init();
  }

  async init() {
    await this.loadData();
    this.render();
  }

  async loadData() {
    this.vendor = null;
    this.products = [];
    this.salesSummary = null;
    if (!this.user?.uid) return;

    const vendorSnap = await getDoc(doc(db, 'vendors', this.user.uid));
    if (!vendorSnap.exists()) return;

    this.vendor = vendorSnap.data();
    const productSnap = await getDocs(query(collection(db, 'vendorProducts'), where('vendorId', '==', this.user.uid)));
    this.products = productSnap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));

    const { orders } = await loadAllOrdersWithClients();
    this.salesSummary = buildVendorSalesSummary({
      vendorId: this.user.uid,
      vendorName: this.vendor.vendorName || this.vendor.shopName || 'Vendeur',
      orders,
      vendorProductIds: new Set(this.products.map((item) => item.id))
    });
  }

  showToast(message, type = 'success') {
    const color = type === 'error' ? '#dc2626' : '#0f9f6e';
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 99999;
      background: ${color};
      color: #fff;
      padding: 0.9rem 1rem;
      border-radius: 14px;
      box-shadow: 0 18px 40px rgba(0,0,0,0.18);
      font: 600 0.9rem Manrope, sans-serif;
      opacity: 0;
      transform: translateY(12px);
      transition: all .2s ease;
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      setTimeout(() => toast.remove(), 220);
    }, 2200);
  }

  formatPrice(value) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency',
      currency: 'HTG',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }

  getStatusLabel(status) {
    const labels = {
      draft: 'Brouillon',
      pending_review: 'En revue',
      active: 'Actif',
      rejected: 'Refuse'
    };
    return labels[status] || 'Brouillon';
  }

  getProductCard(product) {
    const image = Array.isArray(product.images) && product.images[0] ? product.images[0] : '';
    const note = product.adminReviewNote || '';
    const commission = product.commissionRule?.categoryRate ?? product.commissionRule?.rate;
    return `
      <div class="item">
        <div style="display:grid;grid-template-columns:56px 1fr auto;gap:.8rem;align-items:start;">
          <div style="width:56px;height:56px;border-radius:16px;overflow:hidden;background:#f4efe6;border:1px solid rgba(31,30,28,.08);display:flex;align-items:center;justify-content:center;">
            ${image ? `<img src="${image}" alt="${product.name || 'Produit'}" style="width:100%;height:100%;object-fit:cover;">` : '<span style="color:#c6a75e;font-weight:700;">IMG</span>'}
          </div>
          <div>
            <strong>${product.name || 'Produit'}</strong>
            <p>${product.price ? `${product.price} HTG` : 'Prix non defini'}</p>
            <p>${product.shortDescription || 'Aucune description courte.'}</p>
            <span class="badge">${this.getStatusLabel(product.status)}</span>
            ${commission !== undefined && commission !== null && commission !== '' ? `<p style="margin-top:.5rem;">Commission: ${commission}%</p>` : ''}
            ${note ? `<p style="margin-top:.5rem;color:#8b2c2c;">${note}</p>` : ''}
          </div>
          <button type="button" data-edit-product="${product.id}" style="border:1px solid rgba(31,30,28,.08);background:#fff;border-radius:999px;padding:.55rem .8rem;cursor:pointer;font:inherit;font-weight:700;">Modifier</button>
        </div>
      </div>
    `;
  }

  getProductInitialValue(product, field, fallback = '') {
    return product?.[field] ?? fallback;
  }

  renderSidebar() {
    const sections = [
      { id: 'overview', label: 'Vue globale', meta: 'Etat du dashboard', icon: 'fa-compass' },
      { id: 'products', label: 'Mes produits', meta: `${this.products.length} produit(s)`, icon: 'fa-box-open' },
      { id: 'product-form', label: this.editingProductId ? 'Modifier produit' : 'Ajouter produit', meta: this.editingProductId ? 'Edition en cours' : 'Nouveau produit', icon: 'fa-square-plus' },
      { id: 'sales', label: 'Mes ventes', meta: `${this.salesSummary?.totalOrders || 0} commande(s)`, icon: 'fa-chart-line' },
      { id: 'profile', label: 'Mon profil', meta: this.vendor?.category || 'Informations vendeur', icon: 'fa-user-gear' }
    ];

    return sections.map((section) => `
      <button type="button" class="vendor-section-link ${this.activeSection === section.id ? 'active' : ''}" data-vendor-section="${section.id}">
        <i class="fas ${section.icon}"></i>
        <span>
          <strong>${section.label}</strong>
          <small>${section.meta}</small>
        </span>
      </button>
    `).join('');
  }

  renderOverviewPanel() {
    return `
      <section class="panel vendor-section-panel ${this.activeSection === 'overview' ? 'is-active' : ''}" data-vendor-panel="overview">
        <div class="panel-head">
          <div>
            <small>Vue globale</small>
            <h2>Dashboard vendeur</h2>
          </div>
        </div>
        <p>Ce dashboard est maintenant separe par usage pour eviter de tout gerer d un seul coup.</p>
        <section class="stats vendor-stats-grid">
          <article class="stat"><span>Statut vendeur</span><strong>${this.vendor.status || 'active'}</strong></article>
          <article class="stat"><span>Produits vendeur</span><strong>${this.products.length}</strong></article>
          <article class="stat"><span>Categorie</span><strong>${this.vendor.category || '-'}</strong></article>
          <article class="stat"><span>Commandes vendeur</span><strong>${this.salesSummary?.totalOrders || 0}</strong></article>
          <article class="stat"><span>Brut estime</span><strong>${this.formatPrice(this.salesSummary?.grossAmount || 0)}</strong></article>
          <article class="stat"><span>Net estime</span><strong>${this.formatPrice(this.salesSummary?.vendorNetAmount || 0)}</strong></article>
        </section>
        <div class="vendor-quick-actions">
          <button type="button" data-vendor-section="product-form">Ajouter un produit</button>
          <button type="button" data-vendor-section="products">Voir mes produits</button>
          <button type="button" data-vendor-section="sales">Voir mes ventes</button>
        </div>
      </section>
    `;
  }

  renderProductsPanel() {
    return `
      <section class="panel vendor-section-panel ${this.activeSection === 'products' ? 'is-active' : ''}" data-vendor-panel="products">
        <div class="panel-head">
          <div>
            <small>Catalogue vendeur</small>
            <h2>Mes produits</h2>
          </div>
        </div>
        <p>Retrouvez ici vos produits, leur statut de revue admin et les notes eventuelles avant publication.</p>
        ${this.products.length === 0 ? '<p class="empty">Aucun produit vendeur publie pour le moment. Commence par creer ton premier produit pour l envoyer en revue admin.</p>' : `
          <div class="list">
            ${this.products.map((product) => this.getProductCard(product)).join('')}
          </div>
        `}
      </section>
    `;
  }

  renderSalesPanel() {
    return `
      <section class="panel vendor-section-panel ${this.activeSection === 'sales' ? 'is-active' : ''}" data-vendor-panel="sales">
        <div class="panel-head">
          <div>
            <small>Ventes & revenus</small>
            <h2>Mes ventes</h2>
          </div>
        </div>
        <section class="grid vendor-sales-grid">
          <article class="panel vendor-subpanel">
            <h2>Revenus vendeur</h2>
            <div class="list">
              <div class="item"><strong>Montant brut</strong><p>${this.formatPrice(this.salesSummary?.grossAmount || 0)}</p></div>
              <div class="item"><strong>Commission plateforme</strong><p>${this.formatPrice(this.salesSummary?.commissionAmount || 0)}</p></div>
              <div class="item"><strong>Revenu net estime</strong><p>${this.formatPrice(this.salesSummary?.vendorNetAmount || 0)}</p></div>
            </div>
          </article>
          <article class="panel vendor-subpanel">
            <h2>Commandes recentes</h2>
            ${this.renderRecentOrders()}
          </article>
        </section>
      </section>
    `;
  }

  renderProfilePanel() {
    return `
      <section class="panel vendor-section-panel ${this.activeSection === 'profile' ? 'is-active' : ''}" data-vendor-panel="profile">
        <div class="panel-head">
          <div>
            <small>Profil vendeur</small>
            <h2>Mes informations</h2>
          </div>
        </div>
        <p>Ce bloc regroupe les informations principales de votre boutique et de votre mode de livraison.</p>
        <div class="list">
          <div class="item"><strong>Boutique</strong><p>${this.vendor.shopName || '-'}</p></div>
          <div class="item"><strong>Nom vendeur</strong><p>${this.vendor.vendorName || this.vendor.applicantName || '-'}</p></div>
          <div class="item"><strong>Email</strong><p>${this.vendor.email || '-'}</p></div>
          <div class="item"><strong>Telephone</strong><p>${this.vendor.phone || '-'}</p></div>
          <div class="item"><strong>Livraison</strong><p>${this.vendor.deliveryMode || '-'}</p></div>
          <div class="item"><strong>Adresse</strong><p>${this.vendor.address || '-'}</p></div>
        </div>
      </section>
    `;
  }

  renderProductFormPanel(editingProduct) {
    return `
      <section class="panel vendor-section-panel ${this.activeSection === 'product-form' ? 'is-active' : ''}" data-vendor-panel="product-form">
        <div class="panel-head">
          <div>
            <small>Edition catalogue</small>
            <h2>${this.editingProductId ? 'Modifier un produit vendeur' : 'Ajouter un produit au catalogue'}</h2>
          </div>
        </div>
        <p>Chaque produit vendeur est sauvegarde separement avec \`vendorId\`, \`vendorName\`, \`createdBy\`, \`status\` et \`commissionRule\`. Par defaut, un produit part en \`pending_review\` pour validation admin.</p>
        <form id="vendorProductForm" class="vendor-product-form" style="display:grid;gap:1rem;margin-top:1rem;">
          <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;">
            <label style="display:grid;gap:.45rem;">
              <span>Nom du produit *</span>
              <input id="vendorProductName" required value="${this.getProductInitialValue(editingProduct, 'name')}" style="width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.9rem 1rem;background:#fff;">
            </label>
            <label style="display:grid;gap:.45rem;">
              <span>Prix HTG *</span>
              <input id="vendorProductPrice" type="number" min="0" step="0.01" required value="${this.getProductInitialValue(editingProduct, 'price', '')}" style="width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.9rem 1rem;background:#fff;">
            </label>
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;">
            <label style="display:grid;gap:.45rem;">
              <span>Stock</span>
              <input id="vendorProductStock" type="number" min="0" step="1" value="${this.getProductInitialValue(editingProduct, 'stock', 0)}" style="width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.9rem 1rem;background:#fff;">
            </label>
            <label style="display:grid;gap:.45rem;">
              <span>Categorie</span>
              <input id="vendorProductCategory" value="${this.getProductInitialValue(editingProduct, 'category', this.vendor.category || '')}" style="width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.9rem 1rem;background:#fff;">
            </label>
            <label style="display:grid;gap:.45rem;">
              <span>Livraison</span>
              <input id="vendorProductDelivery" value="${this.getProductInitialValue(editingProduct, 'deliveryMode', this.vendor.deliveryMode || '')}" style="width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.9rem 1rem;background:#fff;">
            </label>
          </div>
          <label style="display:grid;gap:.45rem;">
            <span>Description courte</span>
            <input id="vendorProductShortDescription" value="${this.getProductInitialValue(editingProduct, 'shortDescription')}" style="width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.9rem 1rem;background:#fff;">
          </label>
          <label style="display:grid;gap:.45rem;">
            <span>Description longue</span>
            <textarea id="vendorProductLongDescription" rows="5" style="width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.9rem 1rem;background:#fff;">${this.getProductInitialValue(editingProduct, 'longDescription')}</textarea>
          </label>
          <div style="display:grid;grid-template-columns:1fr auto;gap:1rem;align-items:end;">
            <label style="display:grid;gap:.45rem;">
              <span>Image principale</span>
              <input id="vendorProductImage" value="${Array.isArray(editingProduct?.images) ? (editingProduct.images[0] || '') : ''}" placeholder="URL Firebase Storage" style="width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.9rem 1rem;background:#fff;">
            </label>
            <div style="display:flex;gap:.7rem;align-items:center;">
              <input id="vendorProductImageFile" type="file" accept="image/*" style="display:none;">
              <button id="vendorProductUploadBtn" type="button" style="border:1px solid rgba(31,30,28,.12);background:#fff;border-radius:999px;padding:.8rem 1rem;cursor:pointer;font:inherit;font-weight:700;">Uploader image</button>
            </div>
          </div>
          <div style="display:flex;gap:.75rem;flex-wrap:wrap;align-items:center;">
            <button type="submit" style="border:none;border-radius:999px;background:#1F1E1C;color:#F8F5EF;padding:.95rem 1.2rem;font-weight:800;cursor:pointer;">${this.editingProductId ? 'Mettre a jour le produit' : 'Envoyer en revue admin'}</button>
            ${this.editingProductId ? '<button id="vendorProductResetBtn" type="button" style="border:1px solid rgba(31,30,28,.12);background:#fff;border-radius:999px;padding:.95rem 1.2rem;cursor:pointer;font:inherit;font-weight:700;">Nouveau produit</button>' : ''}
          </div>
        </form>
      </section>
    `;
  }

  renderRecentOrders() {
    const orders = this.salesSummary?.recentOrders || [];
    if (orders.length === 0) {
      return '<p class="empty">Aucune commande vendeur enregistree pour le moment.</p>';
    }

    return `
      <div class="list">
        ${orders.map((order) => `
          <div class="item">
            <strong>${order.uniqueCode}</strong>
            <p>${order.clientName || 'Client'} · ${new Date(order.createdAt).toLocaleString('fr-FR')}</p>
            <p>Brut: ${this.formatPrice(order.grossAmount)} · Commission: ${this.formatPrice(order.commissionAmount)} · Net: ${this.formatPrice(order.vendorNetAmount)}</p>
          </div>
        `).join('')}
      </div>
    `;
  }

  render() {
    if (!this.user) {
      this.root.innerHTML = `
        <section class="vendor-dashboard-lock">
          <div class="vendor-dashboard-lock-card">
            <span class="vendor-dashboard-lock-badge"><i class="fas fa-store"></i> Dashboard vendeur</span>
            <h1>Connexion requise</h1>
            <p>Connectez-vous avec votre compte vendeur approuve pour acceder a votre dashboard personnel.</p>
          </div>
        </section>
        ${this.renderSharedStyles()}
      `;
      return;
    }

    if (!this.vendor) {
      this.root.innerHTML = `
        <section class="vendor-dashboard-lock">
          <div class="vendor-dashboard-lock-card">
            <span class="vendor-dashboard-lock-badge"><i class="fas fa-store"></i> Dashboard vendeur</span>
            <h1>Acces non disponible</h1>
            <p>Votre compte n'a pas encore de profil vendeur actif. La candidature et la validation admin restent necessaires avant l'ouverture complete de votre dashboard vendeur.</p>
          </div>
        </section>
        ${this.renderSharedStyles()}
      `;
      return;
    }

    const editingProduct = this.products.find((p) => p.id === this.editingProductId) || null;

    this.root.innerHTML = `
      <section class="vendor-app-container">
        <aside class="vendor-sidebar" id="vendorSidebar">
          <div class="vendor-sidebar-inner">
            <div class="vendor-sidebar-head">
              <small>Dashboard vendeur</small>
              <h1>${this.vendor.vendorName || this.vendor.shopName || 'Espace vendeur'}</h1>
              <p>Ajoutez vos produits, suivez vos ventes et gerez votre boutique avec le meme langage visuel que le dashboard principal.</p>
            </div>
            <nav class="vendor-sidebar-nav vendor-dashboard-nav">
              ${this.renderSidebar()}
            </nav>
            <div class="vendor-sidebar-foot">
              <a href="./vendor-marketplace.html">
                <i class="fas fa-store"></i>
                <span>Voir la marketplace</span>
              </a>
            </div>
          </div>
        </aside>

        <div class="vendor-main-content">
          <div class="vendor-topbar">
            <button type="button" class="vendor-menu-toggle" id="vendorMenuToggle">
              <i class="fas fa-bars"></i>
            </button>
            <div>
              <h2 id="vendorPageTitle">${this.getActiveSectionTitle()}</h2>
              <p id="vendorPageDescription">${this.getActiveSectionDescription()}</p>
            </div>
            <div class="vendor-topbar-actions">
              <div class="vendor-status-chip">
                <i class="fas fa-circle"></i>
                <span>Vendeur ${this.vendor.status || 'active'}</span>
              </div>
              <div class="vendor-status-chip">
                <i class="fas fa-bag-shopping"></i>
                <span>${this.products.length} produit(s)</span>
              </div>
            </div>
          </div>

          <div class="vendor-workspace-shell">
            <div class="vendor-workspace-head">
              <div class="vendor-workspace-meta">
                <small>Smart Cut Services</small>
                <h2>${this.getActiveSectionTitle()}</h2>
                <p>${this.getActiveSectionDescription()}</p>
              </div>
              <div class="vendor-workspace-actions">
                <button type="button" class="vendor-primary-action" data-vendor-section="product-form">
                  <i class="fas fa-plus"></i>
                  <span>Ajouter un produit</span>
                </button>
              </div>
            </div>
            <div class="vendor-workspace-body">
              ${this.renderOverviewPanel()}
              ${this.renderProductsPanel()}
              ${this.renderProductFormPanel(editingProduct)}
              ${this.renderSalesPanel()}
              ${this.renderProfilePanel()}
            </div>
          </div>
        </div>
      </section>
      ${this.renderSharedStyles()}
    `;

    this.attachEvents();
  }

  getActiveSectionTitle() {
    const map = {
      overview: 'Vue globale',
      products: 'Mes produits',
      'product-form': this.editingProductId ? 'Modifier un produit' : 'Ajouter un produit',
      sales: 'Mes ventes',
      profile: 'Mon profil'
    };
    return map[this.activeSection] || 'Dashboard vendeur';
  }

  getActiveSectionDescription() {
    const map = {
      overview: 'Pilotage rapide de votre espace vendeur et de vos indicateurs.',
      products: 'Tous vos produits vendeur et leur statut de revue admin.',
      'product-form': 'Ajout et edition de produit dans un espace dedie.',
      sales: 'Suivi du brut, de la commission plateforme et du net estime.',
      profile: 'Informations principales de votre boutique et de votre livraison.'
    };
    return map[this.activeSection] || 'Gestion vendeur';
  }

  renderSharedStyles() {
    return `
      <style>
        :root {
          --primary: #0A0A0A;
          --primary-light: #1A1A1A;
          --secondary: #C6A75E;
          --secondary-light: #D4B67C;
          --background: #F8F9FA;
          --surface: #FFFFFF;
          --text-primary: #1E293B;
          --text-secondary: #64748B;
          --text-tertiary: #94A3B8;
          --border: #E2E8F0;
          --success: #10B981;
          --warning: #F59E0B;
          --danger: #EF4444;
          --info: #3B82F6;
        }

        body {
          margin: 0;
          background: var(--background);
          color: var(--text-primary);
          font-family: 'Inter', 'Manrope', sans-serif;
        }

        .vendor-dashboard-lock {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 2rem;
        }

        .vendor-dashboard-lock-card {
          width: min(100%, 560px);
          border: 1px solid var(--border);
          background: var(--surface);
          border-radius: 24px;
          padding: 2.5rem;
          box-shadow: 0 20px 45px rgba(15, 23, 42, 0.08);
          text-align: center;
        }

        .vendor-dashboard-lock-card h1 {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(2.2rem, 5vw, 3.5rem);
          font-weight: 600;
          margin-bottom: 0.75rem;
        }

        .vendor-dashboard-lock-card p {
          color: var(--text-secondary);
          line-height: 1.7;
          font-size: 0.98rem;
        }

        .vendor-dashboard-lock-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.55rem;
          border: 1px solid rgba(198, 167, 94, 0.28);
          color: var(--secondary);
          background: rgba(198, 167, 94, 0.12);
          border-radius: 999px;
          padding: 0.65rem 1rem;
          margin-bottom: 1.25rem;
          font-size: 0.82rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          font-weight: 700;
        }

        .vendor-app-container {
          display: flex;
          min-height: 100vh;
        }

        .vendor-sidebar {
          width: 280px;
          background: var(--surface);
          border-right: 1px solid var(--border);
          position: fixed;
          height: 100vh;
          overflow-y: auto;
          z-index: 50;
          transition: transform .3s ease;
        }

        .vendor-sidebar-inner {
          display: flex;
          flex-direction: column;
          height: 100%;
        }

        .vendor-sidebar-head {
          padding: 1.5rem;
          border-bottom: 1px solid var(--border);
        }

        .vendor-sidebar-head small,
        .panel-head small {
          display: inline-block;
          margin-bottom: 0.55rem;
          font-size: 0.72rem;
          letter-spacing: 0.18em;
          text-transform: uppercase;
          color: var(--secondary);
          font-weight: 700;
        }

        .vendor-sidebar-head h1,
        .vendor-workspace-meta h2,
        .panel h2 {
          font-family: 'Cormorant Garamond', serif;
          font-weight: 600;
        }

        .vendor-sidebar-head h1 {
          font-size: 2rem;
          line-height: 0.95;
          margin-bottom: 0.55rem;
          color: var(--text-primary);
        }

        .vendor-sidebar-head p,
        .vendor-workspace-meta p,
        .panel p {
          color: var(--text-secondary);
          font-size: 0.92rem;
          line-height: 1.65;
        }

        .vendor-sidebar-nav {
          flex: 1;
          overflow: auto;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.45rem;
        }

        .vendor-section-link {
          width: 100%;
          border: 1px solid transparent;
          background: transparent;
          color: var(--text-primary);
          border-radius: 18px;
          padding: 0.9rem 1rem;
          display: flex;
          align-items: center;
          gap: 0.9rem;
          cursor: pointer;
          text-align: left;
          transition: 180ms ease;
          font: inherit;
        }

        .vendor-section-link:hover {
          background: var(--background);
          border-color: var(--border);
          transform: translateX(2px);
        }

        .vendor-section-link.active {
          background: rgba(198, 167, 94, 0.12);
          border-color: rgba(198, 167, 94, 0.28);
        }

        .vendor-section-link i {
          width: 18px;
          text-align: center;
          color: var(--secondary);
          font-size: 0.95rem;
          flex: 0 0 auto;
        }

        .vendor-section-link strong {
          display: block;
          font-size: 0.94rem;
          font-weight: 700;
        }

        .vendor-section-link small {
          display: block;
          color: var(--text-secondary);
          font-size: 0.76rem;
          margin-top: 0.15rem;
        }

        .vendor-sidebar-foot {
          padding: 1rem 1.2rem 1.2rem;
          border-top: 1px solid var(--border);
        }

        .vendor-sidebar-foot a {
          display: inline-flex;
          align-items: center;
          gap: 0.6rem;
          text-decoration: none;
          color: var(--text-primary);
          border: 1px solid var(--border);
          border-radius: 999px;
          padding: 0.8rem 1rem;
          background: var(--surface);
          font-size: 0.86rem;
          transition: 180ms ease;
        }

        .vendor-sidebar-foot a:hover {
          background: var(--background);
        }

        .vendor-main-content {
          min-width: 0;
          flex: 1;
          margin-left: 280px;
          min-height: 100vh;
        }

        .vendor-topbar {
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          padding: 1rem 2rem;
          position: sticky;
          top: 0;
          z-index: 40;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }

        .vendor-menu-toggle {
          display: none;
          border: none;
          background: transparent;
          color: var(--text-primary);
          font-size: 1.2rem;
          cursor: pointer;
        }

        .vendor-topbar h2 {
          margin: 0;
          font-size: 1.15rem;
          color: var(--text-primary);
        }

        .vendor-topbar p {
          margin: .25rem 0 0;
          color: var(--text-secondary);
          font-size: .9rem;
        }

        .vendor-topbar-actions,
        .vendor-workspace-actions {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .vendor-status-chip {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          border: 1px solid var(--border);
          background: var(--surface);
          border-radius: 999px;
          padding: 0.72rem 0.9rem;
          color: var(--text-secondary);
          font-size: 0.82rem;
        }

        .vendor-status-chip i {
          color: var(--secondary);
        }

        .vendor-workspace-shell {
          padding: 1.5rem 2rem 2rem;
          display: grid;
          gap: 1.5rem;
        }

        .vendor-workspace-head {
          background: var(--surface);
          border-radius: 1rem;
          border: 1px solid var(--border);
          padding: 1.5rem;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
        }

        .vendor-workspace-meta h2 {
          font-size: 2rem;
          line-height: 1;
          color: var(--text-primary);
          margin: .35rem 0 0;
        }

        .vendor-primary-action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.625rem 1.25rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          transition: all 0.2s;
          cursor: pointer;
          border: none;
          background: var(--primary);
          color: white;
        }

        .vendor-primary-action:hover {
          background: var(--primary-light);
        }

        .vendor-workspace-body {
          display: grid;
          gap: 1.5rem;
        }

        .vendor-section-panel {
          display: none;
          background: var(--surface);
          border-radius: 1rem;
          border: 1px solid var(--border);
          overflow: hidden;
          padding: 1.5rem;
        }

        .vendor-section-panel.is-active {
          display: block;
        }

        .panel-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 1rem;
          margin-bottom: .8rem;
        }

        .panel h2 {
          margin: .45rem 0 0;
          font-size: 2rem;
          color: var(--text-primary);
        }

        .vendor-stats-grid,
        .vendor-sales-grid {
          margin-top: 1rem;
          display: grid;
          gap: 1rem;
        }

        .vendor-stats-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .vendor-sales-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .stat,
        .item,
        .vendor-subpanel {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 1rem;
        }

        .stat {
          padding: 1.15rem 1.2rem;
          box-shadow: 0 1px 3px rgba(0,0,0,0.05);
        }

        .stat span {
          display: block;
          color: var(--text-secondary);
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.12em;
          margin-bottom: .45rem;
        }

        .stat strong {
          color: var(--text-primary);
          font-size: 1.35rem;
        }

        .vendor-subpanel {
          padding: 1rem;
        }

        .list {
          display:grid;
          gap:.8rem;
          margin-top:1rem;
        }

        .item {
          padding: 1rem;
          color: var(--text-primary);
        }

        .item p,
        .empty {
          color: var(--text-secondary);
        }

        .badge {
          display:inline-flex;
          padding:.4rem .7rem;
          border-radius:999px;
          background: rgba(198,167,94,0.1);
          color: var(--secondary);
          font-weight:700;
          font-size:.8rem;
        }

        .vendor-quick-actions {
          display: flex;
          gap: .75rem;
          flex-wrap: wrap;
          margin-top: 1rem;
        }

        .vendor-quick-actions button,
        #vendorProductUploadBtn,
        #vendorProductResetBtn,
        .vendor-product-form button[type="submit"] {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          padding: 0.625rem 1.25rem;
          border-radius: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          border: none;
        }

        #vendorProductUploadBtn,
        #vendorProductResetBtn {
          background: var(--surface);
          color: var(--text-primary);
          border: 1px solid var(--border);
        }

        .vendor-quick-actions button,
        .vendor-product-form button[type="submit"] {
          background: var(--primary);
          color: white;
        }

        .vendor-product-form input,
        .vendor-product-form textarea {
          width:100%;
          border:1px solid var(--border);
          border-radius:1rem;
          padding:.9rem 1rem;
          background: var(--surface);
          color: var(--text-primary);
          font: inherit;
        }

        .vendor-product-form input::placeholder,
        .vendor-product-form textarea::placeholder {
          color: var(--text-tertiary);
        }

        .vendor-product-form textarea {
          resize: vertical;
        }

        @media (max-width: 1024px) {
          .vendor-sidebar {
            transform: translateX(-100%);
          }
          .vendor-sidebar.open {
            transform: translateX(0);
          }
          .vendor-main-content {
            margin-left: 0 !important;
          }
          .vendor-menu-toggle {
            display: inline-flex;
          }
        }

        @media (max-width: 860px) {
          .vendor-topbar,
          .vendor-workspace-head,
          .vendor-stats-grid,
          .vendor-sales-grid,
          .vendor-product-form > div[style*="repeat(2"],
          .vendor-product-form > div[style*="repeat(3"],
          .vendor-product-form > div[style*="1fr auto"] {
            grid-template-columns: 1fr !important;
          }

          .vendor-topbar,
          .vendor-workspace-head {
            display: grid;
          }

          .vendor-workspace-shell {
            padding: 1rem;
          }
        }

        @media (max-width: 640px) {
          .vendor-topbar {
            padding: 1rem;
          }
        }
      </style>
    `;
  }

  attachEvents() {
    if (!this.vendor || !this.user) return;

    this.root.querySelectorAll('[data-vendor-section]').forEach((button) => {
      button.addEventListener('click', () => {
        this.activeSection = button.dataset.vendorSection;
        this.render();
      });
    });

    this.root.querySelectorAll('[data-edit-product]').forEach((button) => {
      button.addEventListener('click', () => {
        this.editingProductId = button.dataset.editProduct;
        this.activeSection = 'product-form';
        this.render();
      });
    });

    const uploadBtn = document.getElementById('vendorProductUploadBtn');
    const fileInput = document.getElementById('vendorProductImageFile');
    const imageInput = document.getElementById('vendorProductImage');
    uploadBtn?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Upload...';
        const uploaded = await uploadImageFile(file, 'vendors');
        imageInput.value = uploaded.url;
        this.showToast('Image produit uployee vers Firebase Storage');
      } catch (error) {
        this.showToast(error.message || 'Upload image impossible', 'error');
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Uploader image';
        fileInput.value = '';
      }
    });

    const form = document.getElementById('vendorProductForm');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      await this.saveProduct();
    });

    document.getElementById('vendorProductResetBtn')?.addEventListener('click', () => {
      this.editingProductId = null;
      this.activeSection = 'product-form';
      this.render();
    });
  }

  async saveProduct() {
    const existing = this.products.find((product) => product.id === this.editingProductId) || null;
    const name = document.getElementById('vendorProductName')?.value?.trim() || '';
    const price = parseFloat(document.getElementById('vendorProductPrice')?.value || '0') || 0;
    const stock = parseInt(document.getElementById('vendorProductStock')?.value || '0', 10) || 0;
    const category = document.getElementById('vendorProductCategory')?.value?.trim() || this.vendor.category || '';
    const deliveryMode = document.getElementById('vendorProductDelivery')?.value?.trim() || this.vendor.deliveryMode || '';
    const shortDescription = document.getElementById('vendorProductShortDescription')?.value?.trim() || '';
    const longDescription = document.getElementById('vendorProductLongDescription')?.value?.trim() || '';
    const image = document.getElementById('vendorProductImage')?.value?.trim() || '';

    if (!name) {
      this.showToast('Le nom du produit est requis.', 'error');
      return;
    }

    const now = new Date().toISOString();
    const payload = {
      vendorId: this.user.uid,
      vendorName: this.vendor.vendorName || this.vendor.shopName || 'Vendeur',
      createdBy: 'vendor_portal',
      commissionRule: this.vendor.commissionRule || null,
      name,
      price,
      stock,
      category,
      deliveryMode,
      shortDescription,
      longDescription,
      images: image ? [image] : [],
      status: 'pending_review',
      adminReviewNote: existing
        ? 'Produit mis a jour par le vendeur. Une nouvelle revue admin est necessaire.'
        : 'Produit soumis par le vendeur et en attente de revue admin.',
      submittedAt: now,
      updatedAt: now
    };

    try {
      if (existing?.id) {
        await updateDoc(doc(db, 'vendorProducts', existing.id), payload);
        this.showToast('Produit vendeur mis a jour.');
      } else {
        await addDoc(collection(db, 'vendorProducts'), {
          ...payload,
          createdAt: now
        });
        this.showToast('Produit vendeur envoye en revue admin.');
      }

      this.editingProductId = null;
      this.activeSection = 'products';
      await this.loadData();
      this.render();
    } catch (error) {
      console.error('Erreur sauvegarde produit vendeur:', error);
      this.showToast('Impossible d enregistrer le produit.', 'error');
    }
  }
}

new VendorPortalPage();
