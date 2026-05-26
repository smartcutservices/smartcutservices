import { db } from './firebase-init.js';
import { getAuthManager } from './auth.js';
import { VENDOR_DASHBOARD_URL } from './dashboard-links.js';
import {
  doc,
  getDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const FORM_SETTINGS_REF = ['vendorApplicationSettings', 'form'];
const PLAN_SETTINGS_REF = ['vendorPlanSettings', 'main'];

const DEFAULT_FORM_SETTINGS = {
  title: 'Candidature vendeur',
  subtitle: 'Remplissez simplement le formulaire ci-dessous pour demander l ouverture de votre espace vendeur.',
  submitLabel: 'Envoyer ma candidature',
  fields: [
    { id: 'applicantName', type: 'text', label: 'Nom complet', required: true, placeholder: 'Votre nom complet' },
    { id: 'email', type: 'email', label: 'Email', required: true, placeholder: 'nom@exemple.com' },
    { id: 'phone', type: 'tel', label: 'Telephone', required: true, placeholder: '+509...' },
    { id: 'address', type: 'textarea', label: 'Adresse', required: true, placeholder: 'Adresse complete' },
    { id: 'city', type: 'text', label: 'Ville', required: true, placeholder: 'Votre ville' },
    { id: 'identityType', type: 'select', label: 'Identification', required: true, options: ['CIN', 'NIF', 'Licence', 'Passeport'] },
    { id: 'identityNumber', type: 'text', label: 'Numero', required: true, placeholder: 'Numero de la piece choisie' },
    { id: 'shopName', type: 'text', label: 'Nom de la boutique', required: true, placeholder: 'Nom de votre boutique' },
    { id: 'bankName', type: 'select', label: 'Banque', required: true, options: ['UNIBANK', 'SOGEBANK', 'BNC', 'CAPITAL BANK', 'BUH'] },
    { id: 'bankCurrency', type: 'select', label: 'Devise', required: true, options: ['Gourdes', 'USD'] },
    { id: 'bankAccountHolder', type: 'text', label: 'Nom du compte', required: true, placeholder: 'Nom exact du compte' },
    { id: 'bankAccountNumber', type: 'text', label: 'Numero du compte', required: true, placeholder: 'Numero du compte' },
    { id: 'description', type: 'textarea', label: 'Presentation de votre activite', required: true, placeholder: 'Decrivez votre activite, vos produits et votre positionnement.' }
  ]
};

const VENDOR_DELIVERY_MODE = 'Le vendeur gere la livraison';
function mergeRequiredVendorFields(fields = []) {
  return DEFAULT_FORM_SETTINGS.fields.map((field) => ({
    ...field,
    options: Array.isArray(field.options) ? [...field.options] : field.options
  }));
}

const DEFAULT_PLAN_SETTINGS = {
  proPrice: 1750,
  currency: 'HTG',
  payoutDelayDays: 30
};
class VendorApplicationPage {
  constructor(containerId = 'vendor-application-root') {
    this.container = document.getElementById(containerId);
    this.auth = getAuthManager();
    this.user = this.auth.getCurrentUser();
    this.application = null;
    this.clientProfile = null;
    this.formSettings = DEFAULT_FORM_SETTINGS;
    this.planSettings = DEFAULT_PLAN_SETTINGS;
    this.selectedPlan = '';
    this.uniqueId = `vendor_apply_${Math.random().toString(36).slice(2, 9)}`;

    if (!this.container) return;

    document.addEventListener('authChanged', async (event) => {
      this.user = event.detail?.user || null;
      await this.loadData();
      this.render();
      this.attachEvents();
    });

    this.init();
  }

  async init() {
    try {
      await this.loadData();
    } catch (error) {
      console.error('Erreur chargement candidature vendeur:', error);
    }
    this.render();
    this.attachEvents();
  }

  async loadData() {
    await Promise.all([
      this.loadFormSettings(),
      this.loadPlanSettings()
    ]);

    if (!this.user?.uid || !db) {
      this.clientProfile = null;
      this.application = null;
      return;
    }

    const [clientSnap, applicationSnap] = await Promise.all([
      getDoc(doc(db, 'clients', this.user.uid)),
      getDoc(doc(db, 'vendorApplications', this.user.uid))
    ]);

    this.clientProfile = clientSnap.exists() ? clientSnap.data() : null;
    this.application = applicationSnap.exists() ? applicationSnap.data() : null;
  }

  async loadFormSettings() {
    if (!db) {
      this.formSettings = DEFAULT_FORM_SETTINGS;
      return;
    }

    const settingsSnap = await getDoc(doc(db, ...FORM_SETTINGS_REF));
    if (!settingsSnap.exists()) {
      this.formSettings = DEFAULT_FORM_SETTINGS;
      return;
    }

    const data = settingsSnap.data() || {};
    this.formSettings = {
      ...DEFAULT_FORM_SETTINGS,
      ...data,
      fields: mergeRequiredVendorFields(data.fields)
    };
  }

  async loadPlanSettings() {
    if (!db) {
      this.planSettings = DEFAULT_PLAN_SETTINGS;
      return;
    }

    try {
      const snap = await getDoc(doc(db, ...PLAN_SETTINGS_REF));
      this.planSettings = snap.exists()
        ? { ...DEFAULT_PLAN_SETTINGS, ...(snap.data() || {}) }
        : DEFAULT_PLAN_SETTINGS;
    } catch (error) {
      console.warn('Parametres plans vendeurs indisponibles, fallback local utilise:', error);
      this.planSettings = DEFAULT_PLAN_SETTINGS;
    }
  }

  render() {
    const status = String(this.application?.status || '').toLowerCase();
    const isApproved = status === 'approved';
    const statusMap = {
      approved: { label: 'Approuvee', tone: '#14532D', bg: 'rgba(20, 83, 45, 0.12)' },
      rejected: { label: 'Refusee', tone: '#7F1D1D', bg: 'rgba(127, 29, 29, 0.12)' },
      pending: { label: 'En attente', tone: '#92400E', bg: 'rgba(146, 64, 14, 0.12)' }
    };
    const statusMeta = statusMap[status] || statusMap.pending;
    const submittedAt = this.formatDateTime(this.application?.createdAt);
    const reviewedAt = this.formatDateTime(this.application?.reviewedAt);
    const activeAt = this.formatDateTime(this.application?.sellerActivatedAt || this.clientProfile?.sellerActivatedAt || this.clientProfile?.approvedAt);
    const shouldChoosePlan = Boolean(this.user && !this.application && !this.selectedPlan);

    this.container.innerHTML = `
      <section style="max-width:980px;margin:0 auto;padding:1.2rem 1rem 0;">
        <div style="border-radius:2rem;border:1px solid rgba(31,30,28,0.08);background:linear-gradient(180deg,#fffdf9 0%,#f5eee2 100%);box-shadow:0 24px 54px rgba(31,30,28,0.08);overflow:hidden;">
          <div style="padding:clamp(1.5rem,4vw,2.6rem);border-bottom:1px solid rgba(31,30,28,0.08);background:radial-gradient(circle at top right, rgba(198,167,94,0.18), transparent 26%), linear-gradient(135deg, rgba(255,255,255,0.96), rgba(249,243,232,0.96));">
            <span style="display:inline-flex;align-items:center;gap:.55rem;padding:.5rem .9rem;border-radius:999px;background:rgba(198,167,94,0.14);color:#8b6c2f;font-size:.74rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;">Marketplace vendeurs</span>
            <h1 style="margin:1rem 0 0;font-family:'Cormorant Garamond',serif;font-size:clamp(2.3rem,5vw,4rem);line-height:.92;color:#1F1E1C;">${isApproved ? 'Candidature validée' : this.escape(this.formSettings.title || DEFAULT_FORM_SETTINGS.title)}</h1>
            ${isApproved ? '' : `<p style="margin:1rem 0 0;max-width:62ch;color:#6E6557;line-height:1.85;">${this.escape(this.formSettings.subtitle || DEFAULT_FORM_SETTINGS.subtitle)}</p>`}
            ${this.application ? `
              <div style="margin-top:1rem;display:inline-flex;align-items:center;gap:.55rem;padding:.65rem .95rem;border-radius:999px;background:${statusMeta.bg};color:${statusMeta.tone};font-size:.82rem;font-weight:800;">
                <i class="fas fa-circle"></i>
                <span>Statut: ${statusMeta.label}</span>
              </div>
            ` : ''}
            ${this.application ? `
              <div style="margin-top:1rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.75rem;max-width:760px;">
                <div style="border-radius:1rem;border:1px solid rgba(31,30,28,0.08);background:rgba(255,255,255,0.72);padding:.85rem 1rem;">
                  <strong style="display:block;color:#1F1E1C;font-size:.85rem;">Soumise le</strong>
                  <span style="display:block;margin-top:.25rem;color:#6E6557;">${this.escape(submittedAt)}</span>
                </div>
                <div style="border-radius:1rem;border:1px solid rgba(31,30,28,0.08);background:rgba(255,255,255,0.72);padding:.85rem 1rem;">
                  <strong style="display:block;color:#1F1E1C;font-size:.85rem;">Derniere revue</strong>
                  <span style="display:block;margin-top:.25rem;color:#6E6557;">${this.escape(reviewedAt)}</span>
                </div>
                <div style="border-radius:1rem;border:1px solid rgba(31,30,28,0.08);background:rgba(255,255,255,0.72);padding:.85rem 1rem;">
                  <strong style="display:block;color:#1F1E1C;font-size:.85rem;">Actif comme vendeur depuis</strong>
                  <span style="display:block;margin-top:.25rem;color:#6E6557;">${this.escape(activeAt)}</span>
                </div>
              </div>
            ` : ''}
          </div>

          <div style="padding:clamp(1.2rem,4vw,2rem);">
            ${!this.user ? `
              <div style="border-radius:1.25rem;border:1px solid rgba(198,167,94,0.22);background:rgba(198,167,94,0.08);padding:1.15rem 1.2rem;">
                <p style="margin:0;color:#6E6557;line-height:1.8;">Vous devez etre connecte pour remplir ce formulaire.</p>
                <button type="button" id="vendorSignInBtn" style="margin-top:1rem;border:none;border-radius:999px;background:#1F1E1C;color:#F8F5EF;padding:.9rem 1.15rem;font-weight:800;cursor:pointer;">Se connecter</button>
              </div>
            ` : this.application ? `
              <div style="display:grid;gap:1rem;">
                <div style="border-radius:1.25rem;border:1px solid rgba(31,30,28,0.08);background:#fff;padding:1.15rem 1.2rem;">
                  <strong style="display:block;color:#1F1E1C;font-size:1.02rem;">Statut actuel</strong>
                  <p style="margin:.55rem 0 0;color:#6E6557;line-height:1.8;">
                    ${isApproved
                      ? 'Votre demande a ete validee. Votre dashboard vendeur est maintenant disponible pour ajouter vos produits.'
                      : status === 'rejected'
                        ? 'Votre demande a ete refusee pour le moment. Consultez la note admin ci-dessous avant une nouvelle soumission.'
                        : 'Votre demande est en attente de validation. Revenez sur cette page pour suivre son evolution.'}
                  </p>
                </div>

                ${isApproved ? '' : `
                  <div style="display:grid;gap:.85rem;">
                    ${this.renderStatusSummary()}
                  </div>
                `}

                ${this.application?.adminNote ? `
                  <div style="border-radius:1rem;border:1px solid rgba(31,30,28,0.08);background:#fff;padding:1rem 1.05rem;">
                    <strong style="display:block;color:#1F1E1C;margin-bottom:.35rem;">Note admin</strong>
                    <span style="color:#6E6557;line-height:1.75;">${this.escape(this.application.adminNote)}</span>
                  </div>
                ` : ''}

                ${status === 'approved' ? `
                  <div style="display:grid;gap:.9rem;">
                    <div style="border-radius:1rem;border:1px solid rgba(20,83,45,0.14);background:rgba(20,83,45,0.08);padding:1rem 1.05rem;color:#14532D;">
                      <strong style="display:block;margin-bottom:.3rem;">Validation confirmee</strong>
                      <span style="line-height:1.75;">Votre candidature a ete approuvee par l administration. Vous pouvez maintenant acceder a votre dashboard vendeur personnel.</span>
                    </div>
                    <div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;">
                    <a href="${VENDOR_DASHBOARD_URL}" id="vendorDashboardAccessBtn" style="display:inline-flex;align-items:center;gap:.65rem;text-decoration:none;border-radius:999px;background:#1F1E1C;color:#F8F5EF;padding:1rem 1.2rem;font-weight:800;">
                      <i class="fas fa-store"></i>
                      Acceder a mon dashboard
                    </a>
                    </div>
                  </div>
                ` : ''}
              </div>
            ` : shouldChoosePlan ? this.renderPlanSelection() : `
              <form id="vendorApplicationForm" style="display:grid;gap:1rem;">
                ${this.renderSelectedPlanNotice()}
                ${this.renderFields()}
                <div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;padding-top:.5rem;">
                  <button type="submit" style="border:none;border-radius:999px;background:#1F1E1C;color:#F8F5EF;padding:1rem 1.2rem;font-weight:800;cursor:pointer;">
                    ${this.escape(this.formSettings.submitLabel || DEFAULT_FORM_SETTINGS.submitLabel)}
                  </button>
                  <span style="color:#7A746B;font-size:.9rem;">Les candidatures sont relues manuellement par l administration.</span>
                </div>
              </form>
            `}
          </div>
        </div>
      </section>

      <style>
        .${this.uniqueId}-field {
          display:grid;
          gap:.45rem;
        }
        .${this.uniqueId}-label {
          font-size:.9rem;
          color:#6E6557;
        }
        .${this.uniqueId}-input,
        .${this.uniqueId}-select,
        .${this.uniqueId}-textarea {
          width:100%;
          border:1px solid rgba(31,30,28,0.12);
          border-radius:1rem;
          padding:.92rem 1rem;
          background:#fff;
          color:#1F1E1C;
          font:inherit;
        }
        .${this.uniqueId}-textarea {
          min-height:132px;
          resize:vertical;
        }
        .${this.uniqueId}-input:focus,
        .${this.uniqueId}-select:focus,
        .${this.uniqueId}-textarea:focus {
          outline:none;
          border-color:rgba(198,167,94,0.8);
          box-shadow:0 0 0 4px rgba(198,167,94,0.12);
        }
        .${this.uniqueId}-options {
          display:grid;
          gap:.65rem;
        }
        .${this.uniqueId}-option {
          display:flex;
          align-items:flex-start;
          gap:.7rem;
          border:1px solid rgba(31,30,28,0.08);
          border-radius:1rem;
          background:#fff;
          padding:.95rem 1rem;
        }
      </style>
    `;
  }

  renderFields() {
    const fields = this.formSettings.fields.map((field) => this.renderField(field)).join('');
    return fields;
  }

  formatCurrency(value) {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(value) || 0)} ${this.planSettings.currency || 'HTG'}`;
  }

  getPlanMeta(planId) {
    const plan = String(planId || 'basic').toLowerCase();
    if (plan === 'pro') {
      return {
        id: 'pro',
        label: 'PRO',
        price: Number(this.planSettings.proPrice || DEFAULT_PLAN_SETTINGS.proPrice),
        priceLabel: this.formatCurrency(this.planSettings.proPrice || DEFAULT_PLAN_SETTINGS.proPrice),
        paymentRequired: true
      };
    }
    return {
      id: 'basic',
      label: 'BASIC',
      price: 0,
      priceLabel: 'Gratuit',
      paymentRequired: false
    };
  }

  renderSelectedPlanNotice() {
    const plan = this.getPlanMeta(this.selectedPlan);
    return `
      <div style="border-radius:1.1rem;border:1px solid rgba(198,167,94,0.24);background:rgba(198,167,94,0.1);padding:1rem;display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap;">
        <div>
          <strong style="display:block;color:#1F1E1C;">Plan selectionne: ${this.escape(plan.label)}</strong>
          <span style="display:block;margin-top:.25rem;color:#6E6557;">${this.escape(plan.priceLabel)}${plan.paymentRequired ? ' - payable via MonCash / NatCash' : ''}</span>
        </div>
        <button type="button" id="changeVendorPlanBtn" style="border:1px solid rgba(31,30,28,0.14);border-radius:999px;background:#fff;color:#1F1E1C;padding:.75rem 1rem;font-weight:800;cursor:pointer;">Changer de plan</button>
      </div>
    `;
  }

  renderPlanSelection() {
    const pro = this.getPlanMeta('pro');
    return `
      <section style="display:grid;gap:1.2rem;">
        <div style="border-radius:1.35rem;border:1px solid rgba(31,30,28,0.08);background:#fff;padding:1.15rem;">
          <small style="display:block;color:#C6A75E;text-transform:uppercase;letter-spacing:.14em;font-weight:800;margin-bottom:.5rem;">Choisissez votre plan</small>
          <h2 style="margin:0;font-family:'Cormorant Garamond',serif;font-size:2.3rem;line-height:1;color:#1F1E1C;">Vendez avec plus de visibilite</h2>
          <p style="margin:.75rem 0 0;color:#6E6557;line-height:1.8;">Les plans vendeur permettent aux acheteurs de reperer vos produits plus rapidement, d'ameliorer votre position dans les recherches et d'afficher un badge de verification selon votre plan.</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;">
          ${this.renderPlanCard({
            id: 'basic',
            title: 'BASIC',
            price: 'Gratuit',
            subtitle: 'Pour tous les vendeurs',
            highlight: false,
            features: [
              'Mise en ligne de 5 produits',
              'Acces au tableau de bord vendeur',
              'Gestion des commandes',
              'Paiement via MonCash / NatCash / Carte bancaire',
              'Support standard reponse sous 24-48h',
              `Request payment tous les ${Number(this.planSettings.payoutDelayDays || 30)} jours`
            ]
          })}
          ${this.renderPlanCard({
            id: 'pro',
            title: 'PRO',
            price: pro.priceLabel,
            subtitle: 'Pour vendeurs actifs qui veulent plus de visibilite',
            highlight: true,
            features: [
              'Tout du Plan Basic',
              'Mise en ligne illimitee de produits',
              'Badge Vendeur Verifie',
              'Position amelioree dans les recherches',
              'Paiement via MonCash / NatCash / Carte bancaire',
              'Statistiques de ventes avancees',
              'Support prioritaire reponse sous 12h',
              `Request payment tous les ${Number(this.planSettings.payoutDelayDays || 30)} jours`
            ]
          })}
        </div>
      </section>
    `;
  }

  renderPlanCard(plan) {
    return `
      <article style="position:relative;border-radius:1.35rem;border:1px solid ${plan.highlight ? 'rgba(198,167,94,0.5)' : 'rgba(31,30,28,0.08)'};background:${plan.highlight ? 'linear-gradient(180deg,#1F1E1C,#3A3328)' : '#fff'};color:${plan.highlight ? '#F8F5EF' : '#1F1E1C'};padding:1.15rem;box-shadow:${plan.highlight ? '0 22px 44px rgba(31,30,28,0.22)' : '0 14px 34px rgba(31,30,28,0.08)'};display:grid;gap:1rem;">
        ${plan.highlight ? `<span style="position:absolute;top:1rem;right:1rem;border-radius:999px;background:#C6A75E;color:#1F1E1C;padding:.35rem .65rem;font-size:.72rem;font-weight:900;">Recommande</span>` : ''}
        <div>
          <h3 style="margin:0;font-size:1.6rem;font-weight:900;letter-spacing:.04em;">${this.escape(plan.title)}</h3>
          <strong style="display:block;margin-top:.45rem;font-size:1.35rem;">${this.escape(plan.price)}</strong>
          <p style="margin:.45rem 0 0;color:${plan.highlight ? 'rgba(248,245,239,0.78)' : '#6E6557'};line-height:1.6;">${this.escape(plan.subtitle)}</p>
        </div>
        <ul style="margin:0;padding:0;list-style:none;display:grid;gap:.65rem;">
          ${plan.features.map((feature) => `
            <li style="display:flex;gap:.55rem;align-items:flex-start;line-height:1.55;">
              <i class="fas fa-check" style="margin-top:.25rem;color:${plan.highlight ? '#C6A75E' : '#14532D'};"></i>
              <span>${this.escape(feature)}</span>
            </li>
          `).join('')}
        </ul>
        <button type="button" data-select-vendor-plan="${this.escape(plan.id)}" style="border:none;border-radius:999px;background:${plan.highlight ? '#C6A75E' : '#1F1E1C'};color:${plan.highlight ? '#1F1E1C' : '#F8F5EF'};padding:1rem 1.1rem;font-weight:900;cursor:pointer;">
          Choisir ${this.escape(plan.title)}
        </button>
      </article>
    `;
  }

  renderStatusSummary() {
    const responses = this.application?.responses || {};
    const configuredFields = this.formSettings.fields.filter((field) => field.type !== 'checkbox');
    return configuredFields.map((field) => {
      const rawValue = responses[field.id] ?? this.application?.[field.id] ?? '';
      const value = Array.isArray(rawValue) ? rawValue.join(', ') : String(rawValue || '-');
      return `
        <div style="border-radius:1rem;border:1px solid rgba(31,30,28,0.08);background:#fff;padding:1rem 1.05rem;">
          <strong style="display:block;color:#1F1E1C;margin-bottom:.3rem;">${this.escape(field.label || field.id)}</strong>
          <span style="color:#6E6557;line-height:1.75;">${this.escape(value)}</span>
        </div>
      `;
    }).join('');
  }

  formatDateTime(value) {
    if (!value) return '-';
    const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('fr-FR');
  }

  renderField(field) {
    const fieldId = this.escape(field.id);
    const value = this.getFieldValue(field);
    const label = `${this.escape(field.label || field.id)}${field.required ? ' *' : ''}`;

    if (field.type === 'textarea') {
      return `
        <label class="${this.uniqueId}-field">
          <span class="${this.uniqueId}-label">${label}</span>
          <textarea id="${fieldId}" class="${this.uniqueId}-textarea" ${field.required ? 'required' : ''} placeholder="${this.escape(field.placeholder || '')}">${this.escape(value)}</textarea>
        </label>
      `;
    }

    if (field.type === 'select') {
      const options = Array.isArray(field.options) ? field.options : [];
      return `
        <label class="${this.uniqueId}-field">
          <span class="${this.uniqueId}-label">${label}</span>
          <select id="${fieldId}" class="${this.uniqueId}-select" ${field.required ? 'required' : ''}>
            <option value="">Selectionner</option>
            ${options.map((option) => `<option value="${this.escape(option)}" ${String(option) === String(value) ? 'selected' : ''}>${this.escape(option)}</option>`).join('')}
          </select>
        </label>
      `;
    }

    if (field.type === 'radio') {
      const options = Array.isArray(field.options) ? field.options : [];
      return `
        <div class="${this.uniqueId}-field">
          <span class="${this.uniqueId}-label">${label}</span>
          <div class="${this.uniqueId}-options">
            ${options.map((option, index) => `
              <label class="${this.uniqueId}-option">
                <input type="radio" name="${fieldId}" value="${this.escape(option)}" ${String(option) === String(value) ? 'checked' : ''} ${field.required && index === 0 ? 'required' : ''}>
                <span style="color:#1F1E1C;">${this.escape(option)}</span>
              </label>
            `).join('')}
          </div>
        </div>
      `;
    }

    if (field.type === 'checkbox') {
      return `
        <label class="${this.uniqueId}-option" style="margin-top:.2rem;">
          <input id="${fieldId}" type="checkbox" ${value ? 'checked' : ''} ${field.required ? 'required' : ''}>
          <span style="color:#1F1E1C;line-height:1.7;">${this.escape(field.label || field.id)}</span>
        </label>
      `;
    }

    const inputType = ['email', 'tel', 'url', 'number'].includes(field.type) ? field.type : 'text';
    return `
      <label class="${this.uniqueId}-field">
        <span class="${this.uniqueId}-label">${label}</span>
        <input id="${fieldId}" class="${this.uniqueId}-input" type="${inputType}" value="${this.escape(value)}" ${field.required ? 'required' : ''} placeholder="${this.escape(field.placeholder || '')}">
      </label>
    `;
  }

  getFieldValue(field) {
    const responses = this.application?.responses || {};
    const responseValue = responses[field.id];
    if (responseValue !== undefined && responseValue !== null) return responseValue;

    const profile = this.clientProfile || {};
    const user = this.user || {};
    const defaults = {
      applicantName: profile.name || user.displayName || '',
      email: profile.email || user.email || '',
      phone: profile.phone || '',
      city: profile.city || '',
      address: profile.address || '',
      bankCurrency: 'Gourdes'
    };

    return defaults[field.id] ?? '';
  }

  attachEvents() {
    const signInBtn = this.container.querySelector('#vendorSignInBtn');
    if (signInBtn) {
      signInBtn.addEventListener('click', () => this.auth.openAuthModal('login'));
    }

    this.container.querySelectorAll('[data-select-vendor-plan]').forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedPlan = button.dataset.selectVendorPlan || 'basic';
        this.render();
        this.attachEvents();
      });
    });

    this.container.querySelector('#changeVendorPlanBtn')?.addEventListener('click', () => {
      this.selectedPlan = '';
      this.render();
      this.attachEvents();
    });

    const form = this.container.querySelector('#vendorApplicationForm');
    if (form) {
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        await this.submitApplication();
      });
    }

  }

  collectResponses() {
    const responses = {};
    this.formSettings.fields.forEach((field) => {
      if (field.type === 'radio') {
        const checked = this.container.querySelector(`input[name="${field.id}"]:checked`);
        responses[field.id] = checked ? checked.value : '';
        return;
      }

      const el = this.container.querySelector(`#${field.id}`);
      if (!el) {
        responses[field.id] = '';
        return;
      }

      if (field.type === 'checkbox') {
        responses[field.id] = !!el.checked;
        return;
      }

      responses[field.id] = el.value?.trim?.() ?? '';
    });
    return responses;
  }

  validateResponses(responses) {
    const missing = this.formSettings.fields.find((field) => {
      if (!field.required) return false;
      const value = responses[field.id];
      if (field.type === 'checkbox') return value !== true;
      return String(value || '').trim() === '';
    });
    return missing ? missing.label || missing.id : '';
  }

  buildCanonicalPayload(responses) {
    return {
      applicantName: String(responses.applicantName || ''),
      email: String(responses.email || ''),
      phone: String(responses.phone || ''),
      shopName: String(responses.shopName || ''),
      identityType: String(responses.identityType || ''),
      identityNumber: String(responses.identityNumber || ''),
      city: String(responses.city || ''),
      address: String(responses.address || ''),
      category: '',
      deliveryMode: VENDOR_DELIVERY_MODE,
      bankAccountHolder: String(responses.bankAccountHolder || ''),
      bankName: String(responses.bankName || ''),
      bankCurrency: String(responses.bankCurrency || ''),
      bankAccountNumber: String(responses.bankAccountNumber || ''),
      bankSwiftBic: '',
      businessName: '',
      businessNif: '',
      businessAddress: '',
      businessBankAccountHolder: '',
      businessBankName: '',
      businessBankAccountNumber: '',
      socialLink: '',
      description: String(responses.description || ''),
      experience: '',
      agreementAccepted: true
    };
  }

  async submitApplication() {
    if (!this.user?.uid || !db) {
      this.auth.showToast('Vous devez etre connecte pour envoyer une candidature.', 'error');
      return;
    }

    const responses = this.collectResponses();
    responses.deliveryMode = VENDOR_DELIVERY_MODE;
    const missingField = this.validateResponses(responses);
    if (missingField) {
      this.auth.showToast(`Merci de remplir le champ obligatoire: ${missingField}.`, 'error');
      return;
    }
    const deliveryCoverage = { country: 'Haiti', mode: 'per_product', nationwide: false, nationwideFee: 0, zones: [] };

    const canonical = this.buildCanonicalPayload(responses);
    const plan = this.getPlanMeta(this.selectedPlan || 'basic');
    const now = new Date().toISOString();
    const payload = {
      uid: this.user.uid,
      responses,
      formSettingsVersion: this.formSettings.updatedAt || '',
      titleSnapshot: this.formSettings.title || DEFAULT_FORM_SETTINGS.title,
      status: this.application?.status === 'approved' ? 'approved' : 'pending',
      adminNote: this.application?.status === 'approved'
        ? (this.application?.adminNote || 'Candidature deja approuvee.')
        : (this.application?.adminNote || 'Candidature recue et en attente de revue.'),
      createdAt: this.application?.createdAt || now,
      updatedAt: now,
      reviewedAt: this.application?.reviewedAt || '',
      reviewedBy: this.application?.reviewedBy || '',
      sellerActivatedAt: this.application?.sellerActivatedAt || '',
      planId: plan.id,
      planLabel: plan.label,
      planPrice: plan.price,
      planCurrency: this.planSettings.currency || 'HTG',
      planPaymentRequired: plan.paymentRequired,
      planPaymentStatus: plan.paymentRequired ? 'pending' : 'not_required',
      payoutRequestIntervalDays: Number(this.planSettings.payoutDelayDays || 30),
      deliveryCoverage,
      deliveryZones: [],
      ...canonical
    };

    await setDoc(doc(db, 'vendorApplications', this.user.uid), payload, { merge: true });
    this.application = payload;
    this.showSuccessModal();
    this.render();
    this.attachEvents();
  }

  showSuccessModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(4px);
      z-index: 1000002;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    `;

    overlay.innerHTML = `
      <div style="
        width: 100%;
        max-width: 460px;
        background: #F8F5EF;
        color: #1F1E1C;
        border-radius: 1.4rem;
        box-shadow: 0 24px 54px rgba(0,0,0,0.22);
        padding: 1.4rem;
        border: 1px solid rgba(198,167,94,0.22);
      ">
        <div style="width:54px;height:54px;border-radius:999px;background:rgba(20,83,45,0.12);color:#14532D;display:flex;align-items:center;justify-content:center;font-size:1.2rem;">
          <i class="fas fa-check"></i>
        </div>
        <h3 style="margin:1rem 0 0;font-family:'Cormorant Garamond',serif;font-size:2rem;">Demande envoyee</h3>
        <p style="margin:.8rem 0 0;color:#6E6557;line-height:1.8;">
          Votre candidature vendeur a bien ete enregistree. Revenez sur cette page pour voir l etat de votre demande: en attente, refusee ou validee. Une fois approuvee, vous y verrez aussi le bouton d acces a votre dashboard vendeur.
        </p>
        <div style="display:flex;justify-content:flex-end;margin-top:1.2rem;">
          <button type="button" id="vendorApplicationSuccessClose" style="border:none;border-radius:999px;background:#1F1E1C;color:#F8F5EF;padding:.9rem 1.15rem;font-weight:800;cursor:pointer;">
            Compris
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.querySelector('#vendorApplicationSuccessClose')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
  }

  escape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export default VendorApplicationPage;
