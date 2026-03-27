import { db } from './firebase-init.js';
import { buildVendorSalesSummary, loadAllOrdersWithClients } from './vendor-analytics.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const FORM_SETTINGS_REF = ['vendorApplicationSettings', 'form'];
const DEFAULT_FORM_SETTINGS = {
  title: 'Candidature vendeur',
  subtitle: 'Remplissez simplement le formulaire ci-dessous pour demander l ouverture de votre espace vendeur.',
  submitLabel: 'Envoyer ma candidature',
  fields: [
    { id: 'applicantName', type: 'text', label: 'Nom complet', required: true, placeholder: 'Votre nom complet' },
    { id: 'email', type: 'email', label: 'Email', required: true, placeholder: 'nom@exemple.com' },
    { id: 'phone', type: 'tel', label: 'Telephone', required: true, placeholder: '+509...' },
    { id: 'shopName', type: 'text', label: 'Nom de boutique', required: true, placeholder: 'Nom de votre boutique' },
    { id: 'city', type: 'text', label: 'Ville', required: true, placeholder: 'Votre ville' },
    { id: 'address', type: 'textarea', label: 'Adresse', required: true, placeholder: 'Adresse complete' },
    { id: 'category', type: 'select', label: 'Categorie principale', required: true, options: ['Mode', 'Accessoires', 'Maison & deco', 'Impression', 'Electronique', 'Beaute', 'Autre'] },
    { id: 'deliveryMode', type: 'radio', label: 'Gestion livraison', required: true, options: ['Le vendeur gere la livraison', 'Smart Cut gere la livraison', 'A definir'] },
    { id: 'socialLink', type: 'url', label: 'Reseau social ou site web', required: false, placeholder: 'https://...' },
    { id: 'description', type: 'textarea', label: 'Presentation de votre activite', required: true, placeholder: 'Decrivez votre activite, vos produits et votre positionnement.' },
    { id: 'agreementAccepted', type: 'checkbox', label: 'Je confirme que les informations envoyees sont exactes et j accepte la revue manuelle de ma candidature.', required: true }
  ]
};

class VendorsDashboard {
  constructor() {
    this.root = document.getElementById('vendors-dashboard-root');
    if (!this.root) return;
    this.applications = [];
    this.vendorProducts = [];
    this.commissionRules = [];
    this.vendors = [];
    this.vendorSalesSummaries = [];
    this.formSettings = DEFAULT_FORM_SETTINGS;
    this.activeSection = 'applications';
    this.init();
  }

  async init() {
    await this.loadData();
    this.render();
    this.attachEvents();
  }

  async loadData() {
    const [applicationSnapshot, productSnapshot, commissionSnapshot, vendorSnapshot, ordersData, formSettingsSnap] = await Promise.all([
      getDocs(query(collection(db, 'vendorApplications'), orderBy('updatedAt', 'desc'))),
      getDocs(query(collection(db, 'vendorProducts'), orderBy('updatedAt', 'desc'))),
      getDocs(collection(db, 'vendorCommissionRules')),
      getDocs(query(collection(db, 'vendors'), orderBy('updatedAt', 'desc'))),
      loadAllOrdersWithClients(),
      getDoc(doc(db, ...FORM_SETTINGS_REF))
    ]);
    this.applications = applicationSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    this.vendorProducts = productSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
    this.commissionRules = commissionSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => item.active !== false)
      .sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')));
    this.vendors = vendorSnapshot.docs
      .map((item) => ({ id: item.id, ...item.data() }))
      .filter((item) => item.status === 'active');
    this.formSettings = formSettingsSnap.exists()
      ? {
          ...DEFAULT_FORM_SETTINGS,
          ...formSettingsSnap.data(),
          fields: Array.isArray(formSettingsSnap.data()?.fields) && formSettingsSnap.data().fields.length
            ? formSettingsSnap.data().fields
            : DEFAULT_FORM_SETTINGS.fields
        }
      : DEFAULT_FORM_SETTINGS;
    this.vendorSalesSummaries = this.vendors.map((vendor) => buildVendorSalesSummary({
      vendorId: vendor.id,
      vendorName: vendor.vendorName || vendor.shopName || 'Vendeur',
      orders: ordersData.orders,
      vendorProductIds: new Set(this.vendorProducts.filter((item) => item.vendorId === vendor.id).map((item) => item.id))
    })).sort((a, b) => b.vendorNetAmount - a.vendorNetAmount);
  }

  normalizeCategory(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  getCategoryCommissionRule(category) {
    const normalized = this.normalizeCategory(category);
    return this.commissionRules.find((item) => this.normalizeCategory(item.category) === normalized) || null;
  }

  getCounts() {
    return {
      total: this.applications.length,
      pending: this.applications.filter((item) => item.status === 'pending' || !item.status).length,
      approved: this.applications.filter((item) => item.status === 'approved').length,
      rejected: this.applications.filter((item) => item.status === 'rejected').length,
      productPending: this.vendorProducts.filter((item) => item.status === 'pending_review' || !item.status).length,
      productActive: this.vendorProducts.filter((item) => item.status === 'active').length,
      productRejected: this.vendorProducts.filter((item) => item.status === 'rejected').length
    };
  }

  statusMeta(status) {
    switch (String(status || '').toLowerCase()) {
      case 'approved':
        return { label: 'Approuve', color: '#14532D', bg: 'rgba(20, 83, 45, 0.12)' };
      case 'rejected':
        return { label: 'Refuse', color: '#7F1D1D', bg: 'rgba(127, 29, 29, 0.12)' };
      default:
        return { label: 'En attente', color: '#92400E', bg: 'rgba(146, 64, 14, 0.12)' };
    }
  }

  productStatusMeta(status) {
    switch (String(status || '').toLowerCase()) {
      case 'active':
        return { label: 'Actif', color: '#14532D', bg: 'rgba(20, 83, 45, 0.12)' };
      case 'rejected':
        return { label: 'Refuse', color: '#7F1D1D', bg: 'rgba(127, 29, 29, 0.12)' };
      default:
        return { label: 'En revue', color: '#92400E', bg: 'rgba(146, 64, 14, 0.12)' };
    }
  }

  render() {
    const counts = this.getCounts();
    this.root.innerHTML = `
      <section class="hero">
        <small>Marketplace</small>
        <h1>Vendeurs & gouvernance</h1>
        <p>Centralisez ici les candidatures vendeurs, la validation admin et la preparation de la marketplace Smart Cut Services.</p>
      </section>

      <section class="stats">
        ${this.renderStat('Demandes', counts.total, 'fa-user-plus')}
        ${this.renderStat('En attente', counts.pending, 'fa-hourglass-half')}
        ${this.renderStat('Approuvees', counts.approved, 'fa-circle-check')}
        ${this.renderStat('Refusees', counts.rejected, 'fa-ban')}
        ${this.renderStat('Produits en revue', counts.productPending, 'fa-box-open')}
        ${this.renderStat('Produits actifs', counts.productActive, 'fa-store')}
        ${this.renderStat('Produits refuses', counts.productRejected, 'fa-circle-xmark')}
      </section>

      <section class="vendors-workspace">
        <aside class="vendors-sections-nav">
          ${this.renderSectionNav()}
        </aside>

        <div class="vendors-sections-content">
          <section class="panel vendors-section-panel ${this.activeSection === 'applications' ? 'is-active' : ''}" data-section-panel="applications">
            <div class="panel-head">
              <div>
                <small>Candidatures</small>
                <h2>Demandes recues</h2>
              </div>
            </div>
            ${this.applications.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-inbox"></i>
                <p>Aucune candidature vendeur pour le moment.</p>
              </div>
            ` : `
              <div class="applications">
                ${this.applications.map((item) => this.renderApplication(item)).join('')}
              </div>
            `}
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'form' ? 'is-active' : ''}" data-section-panel="form">
            <div class="panel-head">
              <div>
                <small>Formulaire vendeur</small>
                <h2>Configuration des champs</h2>
              </div>
            </div>
            <p>Cette section pilote directement la page publique de candidature. Vous pouvez changer les noms de champs, leur type, ajouter des options, en ajouter ou en supprimer.</p>
            ${this.renderFormBuilder()}
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'products' ? 'is-active' : ''}" data-section-panel="products">
            <div class="panel-head">
              <div>
                <small>Catalogue vendeur</small>
                <h2>Revue des produits vendeur</h2>
              </div>
            </div>
            <p>Les vendeurs peuvent maintenant soumettre leurs produits depuis leur back-office separe. Ici, l'admin controle la revue, la commission et le statut avant toute ouverture publique.</p>
            ${this.vendorProducts.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-box-open"></i>
                <p>Aucun produit vendeur soumis pour le moment.</p>
              </div>
            ` : `
              <div class="applications" style="margin-top:1.2rem;">
                ${this.vendorProducts.map((item) => this.renderProductReview(item)).join('')}
              </div>
            `}
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'commissions' ? 'is-active' : ''}" data-section-panel="commissions">
            <div class="panel-head">
              <div>
                <small>Commissions</small>
                <h2>Regles par categorie</h2>
              </div>
            </div>
            <p>Ces regles servent de source simple par categorie. Si un produit n'a pas de commission saisie manuellement, l'approbation reprend automatiquement le taux de sa categorie.</p>
            <div class="applications" style="margin-top:1.2rem;">
              ${this.renderCommissionRules()}
            </div>
            <div class="actions">
              <button type="button" data-add-commission-rule>Ajouter une categorie</button>
              <button type="button" data-save-commission-rules class="approve">Enregistrer les regles</button>
            </div>
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'performance' ? 'is-active' : ''}" data-section-panel="performance">
            <div class="panel-head">
              <div>
                <small>Revenus marketplace</small>
                <h2>Performance vendeurs</h2>
              </div>
            </div>
            <p>Cette vue admin expose les ventes estimees par vendeur a partir des commandes existantes, avec brut, commission et net sans payout automatique.</p>
            ${this.vendorSalesSummaries.length === 0 ? `
              <div class="empty-state">
                <i class="fas fa-chart-line"></i>
                <p>Aucune vente vendeur exploitable pour le moment.</p>
              </div>
            ` : `
              <div class="applications" style="margin-top:1.2rem;">
                ${this.vendorSalesSummaries.map((item) => this.renderVendorSalesSummary(item)).join('')}
              </div>
            `}
          </section>

          <section class="panel vendors-section-panel ${this.activeSection === 'overview' ? 'is-active' : ''}" data-section-panel="overview">
            <div class="panel-head">
              <div>
                <small>Vue d'ensemble</small>
                <h2>Organisation du module vendeurs</h2>
              </div>
            </div>
            <p>Le module vendeurs est maintenant separe en espaces distincts pour garder une gestion plus propre et plus claire.</p>
            <div class="roadmap">
              ${this.renderRoadmap('1', 'Candidatures', 'Toutes les demandes recues apparaissent dans une section separee avec statut et donnees detaillees.')}
              ${this.renderRoadmap('2', 'Formulaire', 'La structure du formulaire public se pilote a part, avec ajout, suppression et edition de champs.')}
              ${this.renderRoadmap('3', 'Produits', 'Les produits vendeurs soumis sont geres dans leur propre espace de revue admin.')}
              ${this.renderRoadmap('4', 'Commissions', 'Les taux par categorie sont modifies dans une section dediee.')}
              ${this.renderRoadmap('5', 'Performance', 'Les ventes et revenus vendeur restent visibles dans un espace separe pour l analyse.')}
            </div>
          </section>
        </div>
      </section>
    `;
  }

  renderSectionNav() {
    const sections = [
      { id: 'overview', icon: 'fa-compass', label: 'Vue globale', meta: 'Structure du module' },
      { id: 'applications', icon: 'fa-user-plus', label: 'Candidatures', meta: `${this.applications.length} demande(s)` },
      { id: 'form', icon: 'fa-pen-ruler', label: 'Formulaire', meta: `${this.formSettings.fields.length} champ(s)` },
      { id: 'products', icon: 'fa-box-open', label: 'Produits', meta: `${this.vendorProducts.length} soumission(s)` },
      { id: 'commissions', icon: 'fa-percent', label: 'Commissions', meta: `${this.commissionRules.length} regle(s)` },
      { id: 'performance', icon: 'fa-chart-line', label: 'Performance', meta: `${this.vendorSalesSummaries.length} vendeur(s)` }
    ];

    return sections.map((section) => `
      <button type="button" class="vendors-section-link ${this.activeSection === section.id ? 'active' : ''}" data-section-link="${section.id}">
        <i class="fas ${section.icon}"></i>
        <span>
          <strong>${section.label}</strong>
          <small>${section.meta}</small>
        </span>
      </button>
    `).join('');
  }

  renderStat(label, value, icon) {
    return `<div class="stat-card"><i class="fas ${icon}"></i><div><strong>${value}</strong><span>${label}</span></div></div>`;
  }

  renderApplication(item) {
    const meta = this.statusMeta(item.status);
    const responseEntries = this.getReadableApplicationFields(item);
    return `
      <div class="application-card">
        <div class="application-top">
          <div>
            <h3>${item.shopName || 'Boutique sans nom'}</h3>
            <p>${item.applicantName || 'Sans nom'} · ${item.category || 'Categorie non definie'}</p>
          </div>
          <div class="badge" style="color:${meta.color}; background:${meta.bg};">${meta.label}</div>
        </div>

        <div class="application-grid">
          ${responseEntries.map((entry) => `<div><strong>${this.escape(entry.label)}</strong><span>${this.escape(entry.value)}</span></div>`).join('')}
        </div>
        ${item.adminNote ? `<div class="application-copy admin-note"><strong>Note admin</strong><p>${item.adminNote}</p></div>` : ''}

        <div class="actions">
          <button type="button" data-action="pending" data-id="${item.id}">Mettre en attente</button>
          <button type="button" data-action="approved" data-id="${item.id}" class="approve">Approuver</button>
          <button type="button" data-action="rejected" data-id="${item.id}" class="reject">Refuser</button>
        </div>
      </div>
    `;
  }

  renderRoadmap(index, title, description) {
    return `<div class="roadmap-item"><div class="roadmap-index">${index}</div><div><strong>${title}</strong><span>${description}</span></div></div>`;
  }

  formatPrice(value) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency',
      currency: 'HTG',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }

  renderCommissionRules() {
    const rules = this.commissionRules.length > 0
      ? this.commissionRules
      : [{ id: `new-${Date.now()}`, category: '', rate: '' }];

    return rules.map((rule, index) => `
      <div class="application-card" data-commission-row="${index}">
        <div class="application-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));align-items:end;">
          <div>
            <strong>Categorie</strong>
            <input data-commission-field="category" data-commission-index="${index}" value="${rule.category || ''}" placeholder="Ex: Mode" style="width:100%;margin-top:.45rem;border:1px solid rgba(198,167,94,0.18);background:rgba(255,255,255,0.04);color:#f6f1e8;border-radius:14px;padding:.85rem .95rem;font:inherit;">
          </div>
          <div>
            <strong>Taux %</strong>
            <input type="number" min="0" max="100" step="0.01" data-commission-field="rate" data-commission-index="${index}" value="${rule.rate ?? ''}" placeholder="10" style="width:100%;margin-top:.45rem;border:1px solid rgba(198,167,94,0.18);background:rgba(255,255,255,0.04);color:#f6f1e8;border-radius:14px;padding:.85rem .95rem;font:inherit;">
          </div>
          <label class="check" style="align-self:center;">
            <input type="checkbox" data-commission-field="active" data-commission-index="${index}" ${rule.active !== false ? 'checked' : ''}>
            <span>Active</span>
          </label>
        </div>
      </div>
    `).join('');
  }

  getReadableApplicationFields(item) {
    const responses = item.responses || {};
    const configured = this.formSettings.fields.map((field) => {
      let value = responses[field.id];
      if (value === undefined || value === null || value === '') {
        value = item[field.id] ?? item[this.mapLegacyKey(field.id)] ?? '';
      }
      if (field.type === 'checkbox') {
        value = value === true ? 'Oui' : 'Non';
      }
      return {
        label: field.label || field.id,
        value: String(value || '-')
      };
    });
    return configured;
  }

  mapLegacyKey(id) {
    const map = {
      applicantName: 'applicantName',
      email: 'email',
      phone: 'phone',
      shopName: 'shopName',
      city: 'city',
      address: 'address',
      category: 'category',
      deliveryMode: 'deliveryMode',
      socialLink: 'socialLink',
      description: 'description',
      experience: 'experience',
      agreementAccepted: 'agreementAccepted'
    };
    return map[id] || id;
  }

  renderFormBuilder() {
    return `
      <div class="applications" style="margin-top:1.2rem;">
        <div class="application-card">
          <div class="application-grid" style="grid-template-columns:1fr 1fr;">
            <div>
              <strong>Titre</strong>
              <input id="vendorFormTitle" value="${this.escape(this.formSettings.title || DEFAULT_FORM_SETTINGS.title)}" style="${this.adminInputStyle()}">
            </div>
            <div>
              <strong>Bouton envoyer</strong>
              <input id="vendorFormSubmitLabel" value="${this.escape(this.formSettings.submitLabel || DEFAULT_FORM_SETTINGS.submitLabel)}" style="${this.adminInputStyle()}">
            </div>
          </div>
          <div class="application-copy">
            <strong>Sous-titre</strong>
            <textarea id="vendorFormSubtitle" rows="3" style="${this.adminInputStyle(true)}">${this.escape(this.formSettings.subtitle || DEFAULT_FORM_SETTINGS.subtitle)}</textarea>
          </div>
        </div>
        ${this.formSettings.fields.map((field, index) => this.renderFieldBuilder(field, index)).join('')}
      </div>
      <div class="actions">
        <button type="button" data-add-form-field>Ajouter un champ</button>
        <button type="button" data-save-form-settings class="approve">Enregistrer le formulaire</button>
      </div>
    `;
  }

  renderFieldBuilder(field, index) {
    const optionString = Array.isArray(field.options) ? field.options.join(' | ') : '';
    return `
      <div class="application-card" data-form-field-row="${index}">
        <div class="application-grid" style="grid-template-columns:repeat(3,minmax(0,1fr));align-items:end;">
          <div>
            <strong>Nom du champ</strong>
            <input data-form-field="label" data-form-index="${index}" value="${this.escape(field.label || '')}" style="${this.adminInputStyle()}">
          </div>
          <div>
            <strong>Identifiant</strong>
            <input data-form-field="id" data-form-index="${index}" value="${this.escape(field.id || '')}" style="${this.adminInputStyle()}">
          </div>
          <div>
            <strong>Type</strong>
            <select data-form-field="type" data-form-index="${index}" style="${this.adminInputStyle()}">
              ${['text', 'email', 'tel', 'url', 'number', 'textarea', 'select', 'radio', 'checkbox'].map((type) => `<option value="${type}" ${field.type === type ? 'selected' : ''}>${type}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="application-grid" style="grid-template-columns:1fr auto auto;">
          <div>
            <strong>Placeholder</strong>
            <input data-form-field="placeholder" data-form-index="${index}" value="${this.escape(field.placeholder || '')}" style="${this.adminInputStyle()}">
          </div>
          <label class="check" style="align-self:center;">
            <input type="checkbox" data-form-field="required" data-form-index="${index}" ${field.required ? 'checked' : ''}>
            <span>Obligatoire</span>
          </label>
          <button type="button" data-remove-form-field="${index}" class="reject">Supprimer</button>
        </div>
        ${(field.type === 'select' || field.type === 'radio') ? `
          <div class="application-copy">
            <strong>Options</strong>
            <input data-form-field="options" data-form-index="${index}" value="${this.escape(optionString)}" placeholder="Option 1 | Option 2 | Option 3" style="${this.adminInputStyle()}">
          </div>
        ` : ''}
      </div>
    `;
  }

  adminInputStyle(isTextarea = false) {
    return `width:100%;margin-top:.45rem;border:1px solid rgba(198,167,94,0.18);background:rgba(255,255,255,0.04);color:#f6f1e8;border-radius:14px;padding:.85rem .95rem;font:inherit;${isTextarea ? 'min-height:100px;resize:vertical;' : ''}`;
  }

  renderProductReview(item) {
    const meta = this.productStatusMeta(item.status);
    const image = Array.isArray(item.images) && item.images[0] ? `<img src="${item.images[0]}" alt="${item.name || 'Produit vendeur'}" style="width:74px;height:74px;border-radius:18px;object-fit:cover;border:1px solid rgba(255,255,255,0.08);">` : '<div style="width:74px;height:74px;border-radius:18px;background:rgba(198,167,94,0.1);display:flex;align-items:center;justify-content:center;color:#c6a75e;font-weight:800;">IMG</div>';
    const commissionValue = item.commissionRule?.categoryRate ?? item.commissionRule?.rate ?? '';
    return `
      <div class="application-card">
        <div style="display:grid;grid-template-columns:auto 1fr;gap:1rem;align-items:start;">
          ${image}
          <div>
            <div class="application-top">
              <div>
                <h3>${item.name || 'Produit vendeur'}</h3>
                <p>${item.vendorName || 'Vendeur'} · ${item.category || 'Categorie non definie'}</p>
              </div>
              <div class="badge" style="color:${meta.color}; background:${meta.bg};">${meta.label}</div>
            </div>
            <div class="application-grid">
              <div><strong>Prix</strong><span>${item.price ? `${item.price} HTG` : '-'}</span></div>
              <div><strong>Stock</strong><span>${Number.isFinite(item.stock) ? item.stock : '-'}</span></div>
              <div><strong>Livraison</strong><span>${item.deliveryMode || '-'}</span></div>
              <div><strong>Commission</strong><span>${commissionValue !== '' ? `${commissionValue}%` : 'A definir'}</span></div>
            </div>
            ${item.shortDescription ? `<div class="application-copy"><strong>Description</strong><p>${item.shortDescription}</p></div>` : ''}
            ${item.adminReviewNote ? `<div class="application-copy admin-note"><strong>Note admin produit</strong><p>${item.adminReviewNote}</p></div>` : ''}
            <div class="actions" style="align-items:center;">
              <label style="display:flex;align-items:center;gap:.55rem;color:rgba(246,241,232,0.75);font-size:.85rem;">
                <span>Commission %</span>
                <input id="productCommission-${item.id}" type="number" min="0" max="100" step="0.01" value="${commissionValue}" style="width:92px;border:1px solid rgba(198,167,94,0.18);background:rgba(255,255,255,0.04);color:#f6f1e8;border-radius:999px;padding:.65rem .9rem;font:inherit;">
              </label>
              <button type="button" data-product-action="pending_review" data-product-id="${item.id}">Repasser en revue</button>
              <button type="button" data-product-action="active" data-product-id="${item.id}" class="approve">Approuver</button>
              <button type="button" data-product-action="rejected" data-product-id="${item.id}" class="reject">Refuser</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderVendorSalesSummary(summary) {
    return `
      <div class="application-card">
        <div class="application-top">
          <div>
            <h3>${summary.vendorName || 'Vendeur'}</h3>
            <p>${summary.totalOrders} commande(s) · ${summary.itemCount} article(s)</p>
          </div>
          <div class="badge" style="color:#14532D; background:rgba(20, 83, 45, 0.12);">Net ${this.formatPrice(summary.vendorNetAmount)}</div>
        </div>
        <div class="application-grid">
          <div><strong>Brut</strong><span>${this.formatPrice(summary.grossAmount)}</span></div>
          <div><strong>Commission</strong><span>${this.formatPrice(summary.commissionAmount)}</span></div>
          <div><strong>Net vendeur</strong><span>${this.formatPrice(summary.vendorNetAmount)}</span></div>
          <div><strong>Commandes</strong><span>${summary.totalOrders}</span></div>
        </div>
      </div>
    `;
  }

  attachEvents() {
    this.root.querySelectorAll('[data-action][data-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.updateStatus(button.dataset.id, button.dataset.action);
      });
    });

    this.root.querySelectorAll('[data-section-link]').forEach((button) => {
      button.addEventListener('click', () => {
        this.activeSection = button.dataset.sectionLink;
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-product-action][data-product-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.updateProductStatus(button.dataset.productId, button.dataset.productAction);
      });
    });

    this.root.querySelector('[data-add-commission-rule]')?.addEventListener('click', () => {
      this.commissionRules.push({ id: `new-${Date.now()}`, category: '', rate: '', active: true });
      this.render();
      this.attachEvents();
    });

    this.root.querySelector('[data-save-commission-rules]')?.addEventListener('click', async () => {
      await this.saveCommissionRules();
    });

    this.root.querySelector('[data-add-form-field]')?.addEventListener('click', () => {
      this.formSettings.fields.push({
        id: `field_${Date.now()}`,
        type: 'text',
        label: 'Nouveau champ',
        required: false,
        placeholder: ''
      });
      this.render();
      this.attachEvents();
    });

    this.root.querySelectorAll('[data-remove-form-field]').forEach((button) => {
      button.addEventListener('click', () => {
        this.formSettings.fields.splice(Number(button.dataset.removeFormField), 1);
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelector('[data-save-form-settings]')?.addEventListener('click', async () => {
      await this.saveFormSettings();
    });
  }

  async updateStatus(id, status) {
    const current = this.applications.find((item) => item.id === id);
    if (!current) return;

    const now = new Date().toISOString();
    const payload = {
      ...current,
      status,
      updatedAt: now,
      reviewedAt: now,
      reviewedBy: 'dashboard_admin',
      adminNote:
        status === 'approved'
          ? 'Candidature approuvee. Le profil vendeur peut passer a la phase suivante.'
          : status === 'rejected'
            ? 'Candidature refusee. Revoir les informations avant re-soumission.'
            : 'Candidature remise en attente de revue.',
      sellerActivatedAt: status === 'approved' ? (current.sellerActivatedAt || now) : ''
    };

    await setDoc(doc(db, 'vendorApplications', id), payload, { merge: true });

    if (status === 'approved') {
      const vendorProfile = {
        uid: current.uid || id,
        applicationId: id,
        vendorId: current.uid || id,
        vendorName: current.shopName || current.applicantName || 'Vendeur',
        shopName: current.shopName || '',
        applicantName: current.applicantName || '',
        email: current.email || '',
        phone: current.phone || '',
        city: current.city || '',
        address: current.address || '',
        category: current.category || '',
        deliveryMode: current.deliveryMode || '',
        status: 'active',
        role: 'vendor',
        commissionRule: current.commissionRule || null,
        createdAt: current.createdAt || now,
        updatedAt: now,
        approvedAt: now,
        approvedBy: 'dashboard_admin'
      };

      await setDoc(doc(db, 'vendors', vendorProfile.vendorId), vendorProfile, { merge: true });
      await setDoc(doc(db, 'clients', vendorProfile.vendorId), {
        uid: vendorProfile.vendorId,
        role: 'vendor',
        vendorStatus: 'active',
        vendorId: vendorProfile.vendorId,
        vendorName: vendorProfile.vendorName,
        updatedAt: now
      }, { merge: true });
    } else if (status === 'rejected') {
      await setDoc(doc(db, 'clients', current.uid || id), {
        uid: current.uid || id,
        vendorStatus: 'rejected',
        updatedAt: now
      }, { merge: true });
    }

    await this.loadData();
    this.render();
    this.attachEvents();
  }

  async updateProductStatus(id, status) {
    const current = this.vendorProducts.find((item) => item.id === id);
    if (!current) return;

    const now = new Date().toISOString();
    const commissionInput = document.getElementById(`productCommission-${id}`);
    const commissionRate = Number.parseFloat(commissionInput?.value || '');
    const categoryRule = this.getCategoryCommissionRule(current.category);
    const normalizedCommission = Number.isFinite(commissionRate)
      ? {
          category: current.category || '',
          categoryRate: commissionRate,
          updatedAt: now,
          updatedBy: 'dashboard_admin'
        }
      : (current.commissionRule || (
          categoryRule
            ? {
                category: categoryRule.category || current.category || '',
                categoryRate: Number(categoryRule.rate) || 0,
                source: 'vendorCommissionRules',
                updatedAt: now,
                updatedBy: 'dashboard_admin'
              }
            : null
        ));

    const adminReviewNote =
      status === 'active'
        ? 'Produit vendeur approuve pour la suite du workflow marketplace.'
        : status === 'rejected'
          ? 'Produit vendeur refuse. Une correction vendeur est necessaire avant nouvelle revue.'
          : 'Produit replace en revue admin.';

    await setDoc(doc(db, 'vendorProducts', id), {
      status,
      commissionRule: normalizedCommission,
      adminReviewNote,
      reviewedAt: now,
      reviewedBy: 'dashboard_admin',
      publishedAt: status === 'active' ? (current.publishedAt || now) : '',
      updatedAt: now
    }, { merge: true });

    await this.loadData();
    this.render();
    this.attachEvents();
  }

  async saveCommissionRules() {
    const rows = Array.from(this.root.querySelectorAll('[data-commission-row]'));
    const now = new Date().toISOString();
    const nextRules = rows.map((_, index) => {
      const category = this.root.querySelector(`[data-commission-field="category"][data-commission-index="${index}"]`)?.value?.trim() || '';
      const rate = Number.parseFloat(this.root.querySelector(`[data-commission-field="rate"][data-commission-index="${index}"]`)?.value || '');
      const active = !!this.root.querySelector(`[data-commission-field="active"][data-commission-index="${index}"]`)?.checked;
      if (!category) return null;
      return {
        id: this.normalizeCategory(category) || `commission-${index}`,
        category,
        rate: Number.isFinite(rate) ? rate : 0,
        active,
        updatedAt: now,
        updatedBy: 'dashboard_admin'
      };
    }).filter(Boolean);

    await Promise.all(nextRules.map((rule) => setDoc(doc(db, 'vendorCommissionRules', rule.id), rule, { merge: true })));
    await this.loadData();
    this.render();
    this.attachEvents();
  }

  collectFormSettings() {
    const title = this.root.querySelector('#vendorFormTitle')?.value?.trim() || DEFAULT_FORM_SETTINGS.title;
    const subtitle = this.root.querySelector('#vendorFormSubtitle')?.value?.trim() || DEFAULT_FORM_SETTINGS.subtitle;
    const submitLabel = this.root.querySelector('#vendorFormSubmitLabel')?.value?.trim() || DEFAULT_FORM_SETTINGS.submitLabel;

    const rows = Array.from(this.root.querySelectorAll('[data-form-field-row]'));
    const fields = rows.map((_, index) => {
      const type = this.root.querySelector(`[data-form-field="type"][data-form-index="${index}"]`)?.value || 'text';
      const rawOptions = this.root.querySelector(`[data-form-field="options"][data-form-index="${index}"]`)?.value || '';
      return {
        id: this.root.querySelector(`[data-form-field="id"][data-form-index="${index}"]`)?.value?.trim() || `field_${index}`,
        label: this.root.querySelector(`[data-form-field="label"][data-form-index="${index}"]`)?.value?.trim() || `Champ ${index + 1}`,
        type,
        placeholder: this.root.querySelector(`[data-form-field="placeholder"][data-form-index="${index}"]`)?.value?.trim() || '',
        required: !!this.root.querySelector(`[data-form-field="required"][data-form-index="${index}"]`)?.checked,
        options: (type === 'select' || type === 'radio')
          ? rawOptions.split('|').map((item) => item.trim()).filter(Boolean)
          : []
      };
    }).filter((field) => field.id);

    return { title, subtitle, submitLabel, fields };
  }

  async saveFormSettings() {
    const nextSettings = this.collectFormSettings();
    if (!nextSettings.fields.length) return;

    await setDoc(doc(db, ...FORM_SETTINGS_REF), {
      ...nextSettings,
      updatedAt: new Date().toISOString(),
      updatedBy: 'dashboard_admin'
    }, { merge: true });

    this.formSettings = nextSettings;
    await this.loadData();
    this.render();
    this.attachEvents();
  }

  escape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export default VendorsDashboard;
