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
  homeZones: []
};

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

export function normalizePrintingDeliverySettings(data = {}) {
  const source = data && typeof data === 'object' ? data : {};
  return {
    pickupPoints: (Array.isArray(source.pickupPoints) && source.pickupPoints.length ? source.pickupPoints : DEFAULT_SETTINGS.pickupPoints)
      .map(normalizePoint)
      .filter((point) => point.name && point.address && point.isActive),
    homeZones: (Array.isArray(source.homeZones) ? source.homeZones : [])
      .map(normalizeZone)
      .filter((zone) => zone.country && zone.department && zone.commune && zone.isActive)
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
  constructor({ getContainer, escape, formatPrice, onChange } = {}) {
    this.getContainer = getContainer;
    this.escape = typeof escape === 'function' ? escape : (value) => String(value || '');
    this.formatPrice = typeof formatPrice === 'function' ? formatPrice : (value) => `${Number(value || 0)} HTG`;
    this.onChange = typeof onChange === 'function' ? onChange : () => {};
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

  getFee() {
    if (this.state.method !== 'home') return 0;
    return Number(this.findHomeZone()?.fee || 0);
  }

  isValid() {
    if (this.state.method === 'pickup') return Boolean(this.getSelectedPickupPoint());
    return Boolean(this.state.address && this.state.department && this.state.commune && this.findHomeZone());
  }

  getSelectedPickupPoint() {
    return this.getPickupPoints().find((point) => point.id === this.state.pickupPointId) || null;
  }

  getSummaryLines() {
    if (this.state.method === 'pickup') {
      const point = this.getSelectedPickupPoint();
      return [
        { label: 'Reception', value: 'Point de retrait' },
        { label: 'Point', value: point?.name || '-' },
        { label: 'Adresse retrait', value: point?.address || '-' },
        { label: 'Telephone point', value: point?.phone || '-' },
        { label: 'Frais reception', value: this.formatPrice(0) }
      ];
    }
    const zone = this.findHomeZone();
    return [
      { label: 'Reception', value: 'Livraison a domicile' },
      { label: 'Adresse', value: this.state.address || '-' },
      { label: 'Zone', value: `${this.state.department || '-'} / ${this.state.commune || '-'}` },
      { label: 'Delai livraison', value: zone?.delay || '-' },
      { label: 'Frais reception', value: this.formatPrice(this.getFee()) }
    ];
  }

  getCartPayload() {
    return {
      method: this.state.method,
      fee: this.getFee(),
      pickupPoint: this.state.method === 'pickup' ? this.getSelectedPickupPoint() : null,
      homeZone: this.state.method === 'home' ? this.findHomeZone() : null,
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
    const homeZone = this.findHomeZone();
    const homeAvailable = Boolean(homeZone);
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
          <strong style="display:block;color:#1F1E1C;font-size:1.05rem;">Reception de votre impression</strong>
          <p style="margin:.25rem 0 0;color:#6E6557;line-height:1.65;">Choisissez comment vous voulez recevoir votre travail d impression.</p>
        </div>
        <div class="printing-delivery-methods">
          <button type="button" class="printing-delivery-method ${this.state.method === 'pickup' ? 'is-active' : ''}" data-printing-delivery-method="pickup">Point de retrait gratuit</button>
          <button type="button" class="printing-delivery-method ${this.state.method === 'home' ? 'is-active' : ''}" data-printing-delivery-method="home">Livraison a domicile</button>
        </div>
        ${this.state.method === 'pickup' ? `
          <label class="printing-delivery-field">
            <span>Point de retrait</span>
            <select class="printing-delivery-input" data-printing-delivery-field="pickupPointId">
              ${pickupPoints.map((point) => `<option value="${this.escape(point.id)}" ${point.id === this.state.pickupPointId ? 'selected' : ''}>${this.escape(point.name)} - ${this.escape(point.address)}</option>`).join('')}
            </select>
          </label>
          <div class="printing-delivery-hint">Point de retrait gratuit. Vous passerez recuperer votre impression apres confirmation.</div>
        ` : `
          ${savedAddresses.length ? `
            <label class="printing-delivery-field">
              <span>Adresse enregistree</span>
              <select class="printing-delivery-input" data-printing-delivery-field="savedAddressId">
                <option value="">Choisir une adresse</option>
                ${savedAddresses.map((address) => `<option value="${this.escape(address.id)}" ${address.id === this.state.savedAddressId ? 'selected' : ''}>${this.escape(getAddressLabel(address))}</option>`).join('')}
              </select>
            </label>
          ` : `<div class="printing-delivery-hint">Aucune adresse sauvegardee trouvee. Vous pouvez saisir l adresse de livraison ici.</div>`}
          <div class="printing-delivery-grid">
            <label class="printing-delivery-field"><span>Adresse</span><input class="printing-delivery-input" data-printing-delivery-field="address" value="${this.escape(this.state.address)}" placeholder="Adresse complete"></label>
            <label class="printing-delivery-field"><span>Telephone</span><input class="printing-delivery-input" data-printing-delivery-field="phone" value="${this.escape(this.state.phone)}" placeholder="+509..."></label>
            <label class="printing-delivery-field"><span>Departement</span><input class="printing-delivery-input" data-printing-delivery-field="department" value="${this.escape(this.state.department)}" placeholder="Ex: Ouest"></label>
            <label class="printing-delivery-field"><span>Commune</span><input class="printing-delivery-input" data-printing-delivery-field="commune" value="${this.escape(this.state.commune)}" placeholder="Ex: Delmas"></label>
          </div>
          <div class="printing-delivery-hint ${homeAvailable ? '' : 'error'}">
            ${homeAvailable
              ? `Livraison disponible: ${this.formatPrice(homeZone.fee)}${homeZone.delay ? ` - Delai: ${this.escape(homeZone.delay)}` : ''}`
              : 'Livraison domicile indisponible pour cette zone. Choisissez un point de retrait ou contactez Smart Cut.'}
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
      if (key === 'address' || key === 'department' || key === 'commune') this.state.savedAddressId = '';
    }
    if (rerender || key === 'department' || key === 'commune' || key === 'savedAddressId') this.onChange();
  }
}
