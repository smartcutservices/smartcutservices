import { db } from './firebase-init.js';
import { getAuthManager } from './auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const DEFAULT_SETTINGS = {
  pickupPoints: [
    {
      id: 'smart-cut-main',
      name: 'Smart Cut Services',
      address: 'Adresse Smart Cut Services',
      phone: '',
      isActive: true
    }
  ],
  homeZones: [],
  moduleRules: {
    documents: [],
    cad: [],
    photo: []
  }
};

const HAITI_DEPARTMENTS = {
  'Artibonite': ['Dessalines', 'Desdunes', 'Ennery', 'Gonaives', 'Gros-Morne', 'L Estere', 'Marmelade', 'Saint-Marc', 'Verrettes'],
  'Centre': ['Belladere', 'Cerca-Carvajal', 'Cerca-la-Source', 'Hinche', 'Lascahobas', 'Mirebalais', 'Saut-d Eau'],
  'Grand Anse': ['Anse-d Hainault', 'Beaumont', 'Chambellan', 'Dame-Marie', 'Jeremie', 'Moron'],
  'Nippes': ['Anse-a-Veau', 'Baraderes', 'Fond-des-Negres', 'Miragoane', 'Petite-Riviere-de-Nippes'],
  'Nord': ['Acul-du-Nord', 'Bahon', 'Borgne', 'Cap-Haitien', 'Grande-Riviere-du-Nord', 'Limonade', 'Milot', 'Pignon', 'Plaine-du-Nord', 'Port-Margot', 'Quartier-Morin', 'Ranquitte', 'Saint-Raphael'],
  'Nord-Est': ['Caracol', 'Ferrier', 'Fort-Liberte', 'Mombin-Crochu', 'Mont-Organise', 'Ouanaminthe', 'Perches', 'Sainte-Suzanne', 'Trou-du-Nord', 'Vallieres'],
  'Nord-Ouest': ['Anse-a-Foleur', 'Baie-de-Henne', 'Bombardopolis', 'Jean-Rabel', 'La Tortue', 'Mole-Saint-Nicolas', 'Port-de-Paix', 'Saint-Louis-du-Nord'],
  'Ouest': ['Arcahaie', 'Cabaret', 'Carrefour', 'Cite Soleil', 'Cornillon', 'Croix-des-Bouquets', 'Delmas', 'Fond-Verrettes', 'Ganthier', 'Gressier', 'Kenscoff', 'Leogane', 'Petion-Ville', 'Petit-Goave', 'Port-au-Prince', 'Tabarre'],
  'Sud': ['Aquin', 'Camp-Perrin', 'Cavaillon', 'Chantal', 'Chardonniere', 'Coteaux', 'Ile-a-Vache', 'Les Anglais', 'Les Cayes', 'Maniche', 'Port-a-Piment', 'Roche-a-Bateau', 'Saint-Jean-du-Sud', 'Tiburon', 'Torbeck'],
  'Sud-Est': ['Anse-a-Pitres', 'Bainet', 'Belle-Anse', 'Cayes-Jacmel', 'Cote-de-Fer', 'Grand-Gosier', 'Jacmel', 'La Vallee-de-Jacmel', 'Marigot', 'Thiotte']
};

const MODULE_RULE_CONFIG = {
  documents: { usesRange: true },
  cad: { usesRange: false },
  photo: { usesRange: false }
};

const MODULE_IDS = Object.keys(MODULE_RULE_CONFIG);

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizePoint(point = {}, index = 0) {
  return {
    id: normalizeText(point.id) || `pickup_${index}`,
    name: normalizeText(point.name || point.label),
    address: normalizeText(point.address),
    phone: normalizeText(point.phone),
    isActive: point.isActive !== false
  };
}

function normalizeZone(zone = {}, index = 0) {
  return {
    id: normalizeText(zone.id) || `home_${index}`,
    country: normalizeText(zone.country) || 'Haiti',
    department: normalizeText(zone.department),
    commune: normalizeText(zone.commune),
    fee: Number(zone.fee || 0),
    delay: normalizeText(zone.delay || zone.deliveryDelay),
    isActive: zone.isActive !== false
  };
}

function normalizeModuleRule(rule = {}, index = 0, moduleId = '') {
  const usesRange = MODULE_RULE_CONFIG[moduleId]?.usesRange !== false;
  const min = Number(rule.min ?? rule.rangeMin ?? 0);
  const max = Number(rule.max ?? rule.rangeMax ?? 0);
  return {
    id: normalizeText(rule.id) || `rule_${index}`,
    country: normalizeText(rule.country) || 'Haiti',
    department: normalizeText(rule.department),
    commune: normalizeText(rule.commune),
    rangeId: usesRange ? normalizeText(rule.rangeId) : '',
    label: usesRange ? normalizeText(rule.label || rule.rangeLabel) : '',
    min: usesRange && Number.isFinite(min) ? min : 1,
    max: usesRange && Number.isFinite(max) ? max : 999999,
    fee: Number(rule.fee || 0),
    delay: normalizeText(rule.delay || rule.deliveryDelay),
    isActive: rule.isActive !== false
  };
}

function normalizeModuleRules(moduleRules = {}) {
  const source = moduleRules && typeof moduleRules === 'object' ? moduleRules : {};
  return MODULE_IDS.reduce((acc, moduleId) => {
    const usesRange = MODULE_RULE_CONFIG[moduleId]?.usesRange !== false;
    acc[moduleId] = (Array.isArray(source[moduleId]) ? source[moduleId] : [])
      .map((rule, index) => normalizeModuleRule(rule, index, moduleId))
      .filter((rule) => (
        rule.country
        && rule.department
        && rule.commune
        && rule.isActive
        && (!usesRange || (rule.min >= 1 && rule.max >= rule.min))
      ));
    return acc;
  }, {});
}

export function normalizePrintingDeliverySettings(data = {}) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    pickupPoints: (Array.isArray(source.pickupPoints) && source.pickupPoints.length ? source.pickupPoints : DEFAULT_SETTINGS.pickupPoints)
      .map(normalizePoint)
      .filter((point) => point.name && point.address && point.isActive),
    homeZones: (Array.isArray(source.homeZones) ? source.homeZones : [])
      .map(normalizeZone)
      .filter((zone) => zone.country && zone.department && zone.commune && zone.isActive),
    moduleRules: normalizeModuleRules(source.moduleRules || DEFAULT_SETTINGS.moduleRules)
  };
}

export async function loadPrintingDeliverySettings() {
  try {
    const snap = await getDoc(doc(db, 'printingDeliverySettings', 'main'));
    return normalizePrintingDeliverySettings(snap.exists() ? snap.data() : DEFAULT_SETTINGS);
  } catch (error) {
    console.warn('Parametres livraison impression indisponibles:', error);
    return normalizePrintingDeliverySettings(DEFAULT_SETTINGS);
  }
}

function getAddressLabel(address = {}) {
  return [
    address.address,
    address.commune,
    address.department
  ].map(normalizeText).filter(Boolean).join(', ');
}

export class PrintingDeliveryController {
  constructor({ getContainer, escape, formatPrice, onChange, moduleId = '', getMetricValue, metricLabel = 'quantite' } = {}) {
    this.getContainer = getContainer;
    this.escape = typeof escape === 'function' ? escape : (value) => String(value || '');
    this.formatPrice = typeof formatPrice === 'function' ? formatPrice : (value) => `${Number(value || 0)} HTG`;
    this.onChange = typeof onChange === 'function' ? onChange : () => {};
    this.moduleId = MODULE_IDS.includes(moduleId) ? moduleId : '';
    this.getMetricValue = typeof getMetricValue === 'function' ? getMetricValue : () => 0;
    this.metricLabel = metricLabel;
    this.settings = normalizePrintingDeliverySettings(DEFAULT_SETTINGS);
    this.client = null;
    this.state = {
      method: 'pickup',
      pickupPointId: '',
      savedAddressId: '',
      address: '',
      country: 'Haiti',
      department: '',
      commune: '',
      phone: ''
    };
  }

  async init() {
    this.settings = await loadPrintingDeliverySettings();
    await this.loadClientProfile();
    this.ensureDefaults();
  }

  async loadClientProfile() {
    try {
      const auth = getAuthManager();
      if (typeof auth.waitForAuthReady === 'function') await auth.waitForAuthReady();
      const user = auth.getCurrentUser?.();
      if (!user?.uid || user.isAnonymous) return;
      const snap = await getDoc(doc(db, 'clients', user.uid));
      this.client = snap.exists() ? { id: snap.id, ...snap.data() } : null;
    } catch (error) {
      console.warn('Profil client impression indisponible:', error);
      this.client = null;
    }
  }

  getPickupPoints() {
    return this.settings.pickupPoints || [];
  }

  getSavedAddresses() {
    const addresses = Array.isArray(this.client?.addresses) ? this.client.addresses : [];
    return addresses.filter((address) => address?.address && address?.department && address?.commune);
  }

  getDefaultAddress() {
    const addresses = this.getSavedAddresses();
    return addresses.find((address) => address.id === this.client?.defaultDeliveryAddressId)
      || addresses.find((address) => address.isDelivery)
      || addresses[0]
      || null;
  }

  ensureDefaults() {
    const pickup = this.getPickupPoints()[0];
    if (!this.state.pickupPointId && pickup) this.state.pickupPointId = pickup.id;
    const address = this.getDefaultAddress();
    if (!this.state.savedAddressId && address?.id) {
      this.applyAddress(address.id);
    }
  }

  applyAddress(addressId) {
    const address = this.getSavedAddresses().find((entry) => entry.id === addressId);
    this.state.savedAddressId = addressId || '';
    if (!address) return;
    this.state.address = address.address || '';
    this.state.country = address.country || 'Haiti';
    this.state.department = address.department || '';
    this.state.commune = address.commune || '';
    this.state.phone = this.client?.phone || this.state.phone || '';
  }

  findHomeZone() {
    const country = normalizeText(this.state.country) || 'Haiti';
    const department = normalizeText(this.state.department);
    const commune = normalizeText(this.state.commune);
    return (this.settings.homeZones || []).find((zone) => (
      normalizeText(zone.country || 'Haiti') === country
      && normalizeText(zone.department) === department
      && normalizeText(zone.commune) === commune
    )) || null;
  }

  getDepartmentOptions(selected = '') {
    return '<option value="">Choisir un departement</option>' + Object.keys(HAITI_DEPARTMENTS)
      .map((department) => `<option value="${this.escape(department)}" ${department === selected ? 'selected' : ''}>${this.escape(department)}</option>`)
      .join('');
  }

  getCommuneOptions(department = '', selected = '') {
    const communes = HAITI_DEPARTMENTS[department] || [];
    return '<option value="">Choisir une commune</option>' + communes
      .map((commune) => `<option value="${this.escape(commune)}" ${commune === selected ? 'selected' : ''}>${this.escape(commune)}</option>`)
      .join('');
  }

  getMetricQuantity() {
    const value = Number(this.getMetricValue?.() || 0);
    return Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;
  }

  getModuleRules() {
    if (!this.moduleId) return [];
    return Array.isArray(this.settings.moduleRules?.[this.moduleId]) ? this.settings.moduleRules[this.moduleId] : [];
  }

  hasModuleRules() {
    return this.getModuleRules().length > 0;
  }

  findModuleRule() {
    const country = normalizeText(this.state.country) || 'Haiti';
    const department = normalizeText(this.state.department);
    const commune = normalizeText(this.state.commune);
    const metric = this.getMetricQuantity();
    if (!this.moduleId || !department || !commune || metric < 1) return null;
    const usesRange = MODULE_RULE_CONFIG[this.moduleId]?.usesRange !== false;

    return this.getModuleRules().find((rule) => (
      normalizeText(rule.country || 'Haiti') === country
      && normalizeText(rule.department) === department
      && normalizeText(rule.commune) === commune
      && (!usesRange || (metric >= Number(rule.min || 0) && metric <= Number(rule.max || 0)))
    )) || null;
  }

  getFee() {
    if (this.state.method !== 'home') return 0;
    const moduleRule = this.findModuleRule();
    if (moduleRule) return Number(moduleRule.fee || 0);
    return Number(this.findHomeZone()?.fee || 0);
  }

  isValid() {
    if (this.state.method === 'pickup') return Boolean(this.getSelectedPickupPoint());
    const hasAddressZone = Boolean(this.state.address && this.state.department && this.state.commune);
    if (!hasAddressZone) return false;
    return this.hasModuleRules() ? Boolean(this.findModuleRule()) : true;
  }

  getSelectedPickupPoint() {
    return this.getPickupPoints().find((point) => point.id === this.state.pickupPointId) || null;
  }

  getSummaryLines() {
    if (this.state.method === 'pickup') {
      const point = this.getSelectedPickupPoint();
      return [
        { label: 'Réception', value: 'Point de retrait' },
        { label: 'Point', value: point?.name || '-' },
        { label: 'Adresse retrait', value: point?.address || '-' },
        { label: 'Téléphone point', value: point?.phone || '-' },
        { label: 'Frais de réception', value: this.formatPrice(0) }
      ];
    }
    const zone = this.findHomeZone();
    const moduleRule = this.findModuleRule();
    const lines = [
      { label: 'Réception', value: 'Livraison à domicile' },
      { label: 'Adresse', value: this.state.address || '-' },
      { label: 'Zone', value: `${this.state.department || '-'} / ${this.state.commune || '-'}` },
      { label: 'Délai livraison', value: moduleRule?.delay || zone?.delay || '-' },
      { label: 'Frais de réception', value: this.formatPrice(this.getFee()) }
    ];
    if (moduleRule?.label) {
      lines.splice(3, 0, { label: 'Intervalle', value: moduleRule.label });
    }
    return lines;
  }

  getCartPayload() {
    const moduleRule = this.state.method === 'home' ? this.findModuleRule() : null;
    return {
      method: this.state.method,
      fee: this.getFee(),
      pickupPoint: this.state.method === 'pickup' ? this.getSelectedPickupPoint() : null,
      homeZone: this.state.method === 'home' ? this.findHomeZone() : null,
      moduleRule,
      moduleId: this.moduleId || '',
      metricQuantity: this.getMetricQuantity(),
      metricLabel: this.metricLabel,
      address: this.state.method === 'home' ? {
        address: this.state.address,
        country: this.state.country || 'Haiti',
        department: this.state.department,
        commune: this.state.commune,
        phone: this.state.phone
      } : null
    };
  }

  renderSection() {
    const pickupPoints = this.getPickupPoints();
    const savedAddresses = this.getSavedAddresses();
    const homeZone = this.findHomeZone() || {};
    const addressZoneSelected = Boolean(this.state.department && this.state.commune);
    const moduleRule = this.findModuleRule();
    const moduleRulesRequired = this.hasModuleRules();
    const moduleRuleAvailable = moduleRulesRequired ? Boolean(moduleRule) : Boolean(homeZone.department || homeZone.commune);
    const fee = this.getFee();
    const hasSavedAddresses = savedAddresses.length > 0;
    return `
      <section class="printing-delivery-card">
        <style>
          .printing-delivery-card{border:1px solid rgba(31,30,28,.08);border-radius:1.35rem;background:#fffdf9;padding:1rem;display:grid;gap:.9rem}
          .printing-delivery-methods{display:flex;gap:.7rem;flex-wrap:wrap}
          .printing-delivery-method{border:1px solid rgba(31,30,28,.1);border-radius:999px;background:#fff;padding:.75rem 1rem;font-weight:800;color:#1F1E1C;cursor:pointer}
          .printing-delivery-method.is-active{background:#1F1E1C;color:#F8F5EF}
          .printing-delivery-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}
          .printing-delivery-field{display:grid;gap:.35rem;color:#6E6557;font-size:.9rem}
          .printing-delivery-input{width:100%;border:1px solid rgba(31,30,28,.12);border-radius:.9rem;background:#fff;padding:.78rem .85rem;font:inherit}
          .printing-delivery-hint{border-radius:1rem;padding:.8rem .9rem;background:rgba(198,167,94,.1);color:#7A5D24;line-height:1.55}
          .printing-delivery-hint.error{background:rgba(185,28,28,.08);color:#991b1b}
          @media(max-width:780px){.printing-delivery-grid{grid-template-columns:1fr}}
        </style>
        <div>
          <strong style="display:block;color:#1F1E1C;font-size:1.05rem;">Réception de votre impression</strong>
          <p style="margin:.25rem 0 0;color:#6E6557;line-height:1.65;">Choisissez comment vous voulez recevoir votre travail d'impression.</p>
        </div>
        <div class="printing-delivery-methods">
          <button type="button" class="printing-delivery-method ${this.state.method === 'pickup' ? 'is-active' : ''}" data-printing-delivery-method="pickup">Point de retrait gratuit</button>
          <button type="button" class="printing-delivery-method ${this.state.method === 'home' ? 'is-active' : ''}" data-printing-delivery-method="home">Livraison à domicile</button>
        </div>
        ${this.state.method === 'pickup' ? `
          <label class="printing-delivery-field">
            <span>Point de retrait</span>
            <select class="printing-delivery-input" data-printing-delivery-field="pickupPointId">
              ${pickupPoints.map((point) => `<option value="${this.escape(point.id)}" ${point.id === this.state.pickupPointId ? 'selected' : ''}>${this.escape(point.name)} - ${this.escape(point.address)}</option>`).join('')}
            </select>
          </label>
          <div class="printing-delivery-hint">Point de retrait gratuit. Vous passerez récupérer votre impression après confirmation.</div>
        ` : `
          ${hasSavedAddresses ? `
            <label class="printing-delivery-field">
              <span>Adresse enregistrée</span>
              <select class="printing-delivery-input" data-printing-delivery-field="savedAddressId">
                <option value="">Choisir une adresse</option>
                ${savedAddresses.map((address) => `<option value="${this.escape(address.id)}" ${address.id === this.state.savedAddressId ? 'selected' : ''}>${this.escape(getAddressLabel(address))}</option>`).join('')}
              </select>
            </label>
          ` : `<div class="printing-delivery-hint">Aucune adresse sauvegardée trouvée. Vous pouvez saisir l'adresse de livraison ici.</div>`}
          <div class="printing-delivery-grid">
            ${hasSavedAddresses ? '' : `<label class="printing-delivery-field"><span>Adresse</span><input class="printing-delivery-input" data-printing-delivery-field="address" value="${this.escape(this.state.address)}" placeholder="Adresse complète"></label>`}
            <label class="printing-delivery-field"><span>Téléphone</span><input class="printing-delivery-input" data-printing-delivery-field="phone" value="${this.escape(this.state.phone)}" placeholder="+509..."></label>
            ${hasSavedAddresses ? '' : `
              <label class="printing-delivery-field">
                <span>Département</span>
                <select class="printing-delivery-input" data-printing-delivery-field="department">
                  ${this.getDepartmentOptions(this.state.department)}
                </select>
              </label>
              <label class="printing-delivery-field">
                <span>Commune</span>
                <select class="printing-delivery-input" data-printing-delivery-field="commune" ${this.state.department ? '' : 'disabled'}>
                  ${this.getCommuneOptions(this.state.department, this.state.commune)}
                </select>
              </label>
            `}
          </div>
          <div class="printing-delivery-hint ${addressZoneSelected && moduleRuleAvailable ? '' : 'error'}">
            ${addressZoneSelected && moduleRuleAvailable
              ? `Livraison disponible: ${this.formatPrice(fee)}${moduleRule?.label ? ` - Intervalle: ${this.escape(moduleRule.label)}` : ''}${(moduleRule?.delay || homeZone.delay) ? ` - Délai: ${this.escape(moduleRule?.delay || homeZone.delay)}` : ''}`
              : addressZoneSelected
                ? `Livraison à domicile disponible dans cette zone, mais aucun prix n'est configuré pour ${this.escape(this.metricLabel)} ${this.getMetricQuantity()}.`
                : 'Livraison à domicile indisponible pour cette zone. Choisissez un point de retrait ou contactez Smart Cut.'}
          </div>
        `}
      </section>
    `;
  }

  bind() {
    const container = this.getContainer?.();
    if (!container) return;
    container.querySelectorAll('[data-printing-delivery-method]').forEach((button) => {
      button.addEventListener('click', () => {
        this.state.method = button.dataset.printingDeliveryMethod || 'pickup';
        this.onChange();
      });
    });
    container.querySelectorAll('[data-printing-delivery-field]').forEach((field) => {
      field.addEventListener('change', () => this.handleField(field));
      field.addEventListener('input', () => this.handleField(field, false));
    });
  }

  handleField(field, rerender = true) {
    const key = field.dataset.printingDeliveryField;
    if (!key) return;
    if (key === 'savedAddressId') {
      this.applyAddress(field.value);
    } else {
      this.state[key] = field.value;
      if (key === 'department') this.state.commune = '';
      if (key === 'address' || key === 'department' || key === 'commune') this.state.savedAddressId = '';
    }
    if (rerender || key === 'department' || key === 'commune' || key === 'savedAddressId') this.onChange();
  }
}
