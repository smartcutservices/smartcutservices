import { auth, db } from './firebase-init.js?v=20260523-5';
import { sendPasswordResetEmail, updateProfile } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { doc, getDoc, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { getAuthManager } from './auth.js?v=20260523-5';
import { getCartManager } from './cart.js?v=20260523-5';
import { getLikeManager } from './like.js';
import { VENDOR_DASHBOARD_URL } from './dashboard-links.js';

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

class ProfilePanel {
  constructor() {
    this.modal = null;
    this.uniqueId = 'profile_' + Math.random().toString(36).slice(2, 11);
    this.authManager = getAuthManager();
    this.cartManager = getCartManager();
    this.likeManager = getLikeManager();
    this.isBootstrapping = false;
    this.activeView = 'account';
    this.profileClient = null;
    this.isEditingPersonalInfo = false;
    this.additionalAddressForms = 0;
    this.vendorAccess = {
      uid: '',
      checked: false,
      approved: false,
      shopName: ''
    };
    this.preloadPromise = null;
    this.openedAt = 0;
    this.handleStateChange = () => {
      if (this.modal) this.render();
    };

    document.addEventListener('authChanged', this.handleStateChange);
    document.addEventListener('ordersUpdated', this.handleStateChange);
    document.addEventListener('likesUpdated', this.handleStateChange);
  }

  getThemeColors() {
    return this.cartManager.getThemeColors();
  }

  getThemeFonts() {
    return this.cartManager.getThemeFonts();
  }

  getStoredGuestId() {
    try {
      return localStorage.getItem(this.cartManager.getGuestStorageKey()) || '';
    } catch (error) {
      return '';
    }
  }

  async ensureGuestOrdersLoaded() {
    if (this.authManager.isAuthenticated()) return;

    const guestId = this.getStoredGuestId();
    if (!guestId) return;

    if (!this.cartManager.guestClient || this.cartManager.guestClient.id !== guestId) {
      this.cartManager.guestClient = this.cartManager.createGuestClientPayload(guestId);
    }

    this.cartManager.currentClient = this.cartManager.guestClient;
    this.cartManager.loadHiddenOrders();

    if (!this.cartManager.ordersListener || !this.cartManager.orders.length) {
      await this.cartManager.loadCustomerOrders(guestId);
    }
  }

  async ensureAuthenticatedOrdersLoaded() {
    if (!this.authManager.isAuthenticated()) return;

    const user = this.authManager.getCurrentUser();
    if (!user?.uid) return;

    if (!this.cartManager.currentClient || this.cartManager.currentClient.id !== user.uid) {
      await this.cartManager.loadOrCreateClient(user);
    }

    if (!this.cartManager.currentClient?.id) return;

    if (!this.cartManager.ordersListener || !this.cartManager.orders.length) {
      await this.cartManager.loadCustomerOrders(this.cartManager.currentClient.id);
    }
  }

  async ensureProfileClientLoaded() {
    console.info('[PROFILE_DEBUG] ensureProfileClientLoaded:start', {
      version: '20260523-5',
      isAuthenticated: this.authManager.isAuthenticated(),
      authReady: this.authManager.isAuthReady,
      authUid: this.authManager.getCurrentUser()?.uid || null,
      firebaseUid: auth?.currentUser?.uid || null
    });
    if (!this.authManager.isAuthenticated()) {
      this.profileClient = null;
      console.info('[PROFILE_DEBUG] ensureProfileClientLoaded:skip-not-authenticated');
      return;
    }

    const user = this.authManager.getCurrentUser();
    if (!user?.uid || !db) return;

    try {
      const clientSnap = await getDoc(doc(db, 'clients', user.uid));
      console.info('[PROFILE_DEBUG] ensureProfileClientLoaded:snapshot', {
        uid: user.uid,
        exists: clientSnap.exists()
      });
      if (clientSnap.exists()) {
        this.profileClient = { id: user.uid, ...(clientSnap.data() || {}) };
        this.cartManager.currentClient = {
          ...(this.cartManager.currentClient || {}),
          ...this.profileClient
        };
      }
    } catch (error) {
      console.error('Erreur chargement informations personnelles:', error);
      console.info('[PROFILE_DEBUG] ensureProfileClientLoaded:error', {
        code: error?.code || null,
        message: error?.message || String(error)
      });
    }
  }

  inferVendorAccessFromClient() {
    const client = this.cartManager.currentClient || {};
    const role = String(client?.role || client?.accountType || '').toLowerCase();
    const vendorStatus = String(client?.vendorStatus || client?.status || '').toLowerCase();
    const approved = role === 'vendor' || vendorStatus === 'approved' || client?.isVendorApproved === true;
    return {
      approved,
      shopName: String(client?.shopName || client?.vendorName || '').trim()
    };
  }

  async ensureVendorAccessLoaded() {
    if (!this.authManager.isAuthenticated()) {
      this.vendorAccess = { uid: '', checked: false, approved: false, shopName: '' };
      return;
    }

    const user = this.authManager.getCurrentUser();
    if (!user?.uid) return;
    if (this.vendorAccess.checked && this.vendorAccess.uid === user.uid) return;

    const inferred = this.inferVendorAccessFromClient();
    if (inferred.approved) {
      this.vendorAccess = {
        uid: user.uid,
        checked: true,
        approved: true,
        shopName: inferred.shopName
      };
      return;
    }

    try {
      const vendorSnap = await getDoc(doc(db, 'vendorApplications', user.uid));
      const data = vendorSnap.exists() ? (vendorSnap.data() || {}) : {};
      this.vendorAccess = {
        uid: user.uid,
        checked: true,
        approved: String(data?.status || '').toLowerCase() === 'approved',
        shopName: String(data?.shopName || inferred.shopName || '').trim()
      };
    } catch (error) {
      console.error('Erreur chargement acces vendeur profil:', error);
      this.vendorAccess = {
        uid: user.uid,
        checked: true,
        approved: inferred.approved,
        shopName: inferred.shopName
      };
    }
  }

  async preloadPanelData() {
    this.isBootstrapping = true;
    console.info('[PROFILE_DEBUG] preload:start', {
      version: '20260523-5',
      authReady: this.authManager.isAuthReady,
      authUid: this.authManager.getCurrentUser()?.uid || null,
      firebaseUid: auth?.currentUser?.uid || null
    });
    if (this.modal) this.render();

    try {
      if (typeof this.authManager.waitForAuthReady === 'function') {
        await this.authManager.waitForAuthReady();
      }
      console.info('[PROFILE_DEBUG] preload:after-auth-ready', {
        authReady: this.authManager.isAuthReady,
        isAuthenticated: this.authManager.isAuthenticated(),
        authUid: this.authManager.getCurrentUser()?.uid || null,
        firebaseUid: auth?.currentUser?.uid || null
      });
      await Promise.all([
        this.ensureAuthenticatedOrdersLoaded(),
        this.ensureGuestOrdersLoaded(),
        this.ensureVendorAccessLoaded(),
        this.ensureProfileClientLoaded()
      ]);
    } finally {
      this.isBootstrapping = false;
      console.info('[PROFILE_DEBUG] preload:done', {
        isAuthenticated: this.authManager.isAuthenticated(),
        orders: this.cartManager.orders.length,
        hasProfileClient: Boolean(this.profileClient?.id)
      });
      if (this.modal) this.render();
    }
  }

  prime() {
    if (this.preloadPromise) return this.preloadPromise;
    this.preloadPromise = this.preloadPanelData()
      .catch((error) => {
        this.preloadPromise = null;
        throw error;
      })
      .then((result) => {
        this.preloadPromise = null;
        return result;
      });
    return this.preloadPromise;
  }

  async open() {
    if (this.modal) return;

    this.activeView = 'account';
    this.openedAt = Date.now();
    this.isBootstrapping = true;
    console.info('[PROFILE_DEBUG] open', {
      version: '20260523-5',
      authReady: this.authManager.isAuthReady,
      isAuthenticated: this.authManager.isAuthenticated(),
      authUid: this.authManager.getCurrentUser()?.uid || null,
      firebaseUid: auth?.currentUser?.uid || null
    });
    this.modal = document.createElement('div');
    this.modal.className = `profile-panel-${this.uniqueId}`;
    this.render();
    document.body.appendChild(this.modal);

    this.prime().catch((error) => {
      console.error('Erreur chargement panneau profil:', error);
    });

    setTimeout(() => {
      const overlay = this.modal?.querySelector('.profile-overlay');
      const container = this.modal?.querySelector('.profile-container');
      if (overlay) overlay.style.opacity = '1';
      if (container) {
        container.style.opacity = '1';
        container.style.transform = 'translateX(0)';
      }
    }, 40);

    document.body.style.overflow = 'hidden';
  }

  close() {
    if (!this.modal) return;

    const overlay = this.modal.querySelector('.profile-overlay');
    const container = this.modal.querySelector('.profile-container');

    if (overlay) overlay.style.opacity = '0';
    if (container) {
      container.style.opacity = '0';
      container.style.transform = 'translateX(100%)';
    }

    setTimeout(() => {
      this.modal?.remove();
      this.modal = null;
      document.body.style.overflow = '';
    }, 280);
  }

  getVisibleOrders() {
    return this.cartManager.orders.filter((order) => !this.cartManager.isOrderHidden(order.id));
  }

  getUserLabel(user) {
    return user?.displayName || user?.email || 'Mon profil';
  }

  getPersonalInfoRows(user) {
    const client = this.profileClient || this.cartManager.currentClient || {};
    const addressParts = [
      client.address,
      client.commune,
      client.department,
      client.country
    ].filter(Boolean);
    const defaultAddress = Array.isArray(client.addresses)
      ? client.addresses.find((address) => address.id === client.defaultDeliveryAddressId) || client.addresses.find((address) => address.isDelivery) || client.addresses[0]
      : null;
    const savedAddressParts = defaultAddress
      ? [defaultAddress.address, defaultAddress.commune, defaultAddress.department, defaultAddress.country || 'Haiti'].filter(Boolean)
      : [];

    return [
      { label: 'Username', value: user?.displayName || client.name || `${client.firstName || ''} ${client.lastName || ''}`.trim() || '-' },
      { label: 'Nom', value: client.lastName || '-' },
      { label: 'Prenom', value: client.firstName || '-' },
      { label: 'Date de naissance', value: client.birthDate || '-' },
      { label: 'Email', value: user?.email || client.email || '-' },
      { label: 'Telephone', value: client.phone || '-' },
      { label: 'Adresse principale', value: savedAddressParts.join(', ') || addressParts.join(', ') || '-' },
      { label: 'Nombre d adresses sauvegardées', value: Array.isArray(client.addresses) ? String(client.addresses.length) : '0' }
    ];
  }

  getDefaultAddress(client) {
    return Array.isArray(client?.addresses)
      ? client.addresses.find((address) => address.id === client.defaultDeliveryAddressId) || client.addresses.find((address) => address.isDelivery) || client.addresses[0] || null
      : null;
  }

  renderDepartmentOptions(selected = '') {
    return '<option value="">Choisir...</option>' + Object.keys(HAITI_DEPARTMENTS)
      .map((department) => `<option value="${this.escape(department)}" ${department === selected ? 'selected' : ''}>${this.escape(department)}</option>`)
      .join('');
  }

  renderCommuneOptions(department = '', selected = '') {
    const communes = HAITI_DEPARTMENTS[department] || [];
    return '<option value="">Choisir...</option>' + communes
      .map((commune) => `<option value="${this.escape(commune)}" ${commune === selected ? 'selected' : ''}>${this.escape(commune)}</option>`)
      .join('');
  }

  renderEditPersonalInfoForm(colors, fonts, user) {
    const client = this.profileClient || this.cartManager.currentClient || {};
    const fullName = user?.displayName || client.name || `${client.firstName || ''} ${client.lastName || ''}`.trim();
    const defaultAddress = this.getDefaultAddress(client) || {};
    const savedAddresses = Array.isArray(client.addresses) ? client.addresses : [];
    const secondaryAddresses = savedAddresses.filter((address) => address && address !== defaultAddress);
    const otherAddressesCount = secondaryAddresses.length;
    return `
      <form class="profile-personal-form" style="display:grid;gap:0.85rem;">
        <div style="border-radius:1.15rem;border:1px solid ${colors.background.button}22;background:${colors.background.card};padding:1rem;">
          <h3 style="margin:0;font-family:${fonts.primary};font-size:1.35rem;color:${colors.text.title};">Modifier mes informations</h3>
          <p style="margin:0.4rem 0 0;color:${colors.text.body};line-height:1.6;font-size:0.9rem;">Vos modifications seront sauvegardées sur votre compte.</p>
        </div>

        ${this.renderProfileInput('Username', 'profileEditUsername', fullName, colors)}
        ${this.renderProfileInput('Nom', 'profileEditLastName', client.lastName || '', colors)}
        ${this.renderProfileInput('Prenom', 'profileEditFirstName', client.firstName || '', colors)}
        ${this.renderProfileInput('Date de naissance', 'profileEditBirthDate', client.birthDate || '', colors, 'date')}
        ${this.renderProfileInput('Telephone', 'profileEditPhone', client.phone || '', colors, 'tel')}
        ${this.renderProfileInput('Adresse principale', 'profileEditAddress', defaultAddress.address || client.address || '', colors)}

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;">
          <label style="display:grid;gap:0.35rem;">
            <span style="color:${colors.text.body};font-size:0.82rem;font-weight:800;">Departement</span>
            <select id="profileEditDepartment" style="${this.profileFieldStyle(colors)}">
              ${this.renderDepartmentOptions(defaultAddress.department || client.department || '')}
            </select>
          </label>
          <label style="display:grid;gap:0.35rem;">
            <span style="color:${colors.text.body};font-size:0.82rem;font-weight:800;">Commune</span>
            <select id="profileEditCommune" style="${this.profileFieldStyle(colors)}">
              ${this.renderCommuneOptions(defaultAddress.department || client.department || '', defaultAddress.commune || client.commune || '')}
            </select>
          </label>
        </div>

        <div style="border-radius:1.15rem;border:1px solid ${colors.background.button}22;background:${colors.background.card};padding:1rem;display:grid;gap:0.85rem;">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;">
            <div>
              <h4 style="margin:0;color:${colors.text.title};font-size:1rem;">Adresses supplementaires</h4>
              <p style="margin:0.35rem 0 0;color:${colors.text.body};font-size:0.85rem;line-height:1.55;">
                ${otherAddressesCount > 0 ? `${otherAddressesCount} autre(s) adresse(s) déjà sauvegardée(s).` : 'Ajoutez une autre adresse sans remplacer votre adresse principale.'}
              </p>
            </div>
            <button type="button" class="profile-add-address-btn" style="border:1px solid ${colors.background.button}44;border-radius:999px;background:${colors.background.card};color:${colors.text.title};padding:0.75rem 0.9rem;font-weight:800;cursor:pointer;display:flex;align-items:center;gap:0.45rem;">
              <i class="fas fa-plus"></i>
              Ajouter une adresse
            </button>
          </div>
          <div class="profile-extra-addresses" style="display:grid;gap:0.8rem;">
            ${secondaryAddresses.map((address, index) => this.renderSavedAddressForm(address, index, colors)).join('')}
            ${Array.from({ length: this.additionalAddressForms }, (_, index) => this.renderExtraAddressForm(index, colors)).join('')}
          </div>
        </div>

        <div style="display:flex;gap:0.65rem;flex-wrap:wrap;">
          <button type="submit" style="border:none;border-radius:999px;background:${colors.background.button};color:${colors.text.button};padding:0.9rem 1rem;font-weight:800;cursor:pointer;">
            Enregistrer
          </button>
          <button type="button" class="profile-cancel-edit-btn" style="border:1px solid ${colors.background.button}44;border-radius:999px;background:${colors.background.card};color:${colors.text.title};padding:0.9rem 1rem;font-weight:800;cursor:pointer;">
            Annuler
          </button>
        </div>
      </form>
    `;
  }

  renderSavedAddressForm(address, index, colors) {
    return `
      <div data-saved-address-index="${index}" data-saved-address-id="${this.escape(address.id || '')}" style="border:1px solid ${colors.background.button}26;border-radius:1rem;padding:0.9rem;display:grid;gap:0.75rem;background:${colors.background.card};">
        <strong style="color:${colors.text.title};font-size:0.92rem;">Adresse sauvegardée ${index + 1}</strong>
        ${this.renderProfileInput('Adresse', `profileSavedAddress_${index}`, address.address || '', colors)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;">
          <label style="display:grid;gap:0.35rem;">
            <span style="color:${colors.text.body};font-size:0.82rem;font-weight:800;">Departement</span>
            <select id="profileSavedDepartment_${index}" class="profile-saved-department" data-saved-address-department="${index}" style="${this.profileFieldStyle(colors)}">
              ${this.renderDepartmentOptions(address.department || '')}
            </select>
          </label>
          <label style="display:grid;gap:0.35rem;">
            <span style="color:${colors.text.body};font-size:0.82rem;font-weight:800;">Commune</span>
            <select id="profileSavedCommune_${index}" data-saved-address-commune="${index}" style="${this.profileFieldStyle(colors)}">
              ${this.renderCommuneOptions(address.department || '', address.commune || '')}
            </select>
          </label>
        </div>
      </div>
    `;
  }

  renderExtraAddressForm(index, colors) {
    return `
      <div data-extra-address-index="${index}" style="border:1px dashed ${colors.background.button}44;border-radius:1rem;padding:0.9rem;display:grid;gap:0.75rem;background:${colors.background.button}08;">
        <strong style="color:${colors.text.title};font-size:0.92rem;">Nouvelle adresse ${index + 1}</strong>
        ${this.renderProfileInput('Adresse', `profileExtraAddress_${index}`, '', colors)}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.7rem;">
          <label style="display:grid;gap:0.35rem;">
            <span style="color:${colors.text.body};font-size:0.82rem;font-weight:800;">Departement</span>
            <select id="profileExtraDepartment_${index}" class="profile-extra-department" data-extra-address-department="${index}" style="${this.profileFieldStyle(colors)}">
              ${this.renderDepartmentOptions('')}
            </select>
          </label>
          <label style="display:grid;gap:0.35rem;">
            <span style="color:${colors.text.body};font-size:0.82rem;font-weight:800;">Commune</span>
            <select id="profileExtraCommune_${index}" data-extra-address-commune="${index}" style="${this.profileFieldStyle(colors)}">
              ${this.renderCommuneOptions('', '')}
            </select>
          </label>
        </div>
      </div>
    `;
  }

  renderProfileInput(label, id, value, colors, type = 'text') {
    return `
      <label style="display:grid;gap:0.35rem;">
        <span style="color:${colors.text.body};font-size:0.82rem;font-weight:800;">${this.escape(label)}</span>
        <input id="${id}" type="${type}" value="${this.escape(value)}" style="${this.profileFieldStyle(colors)}">
      </label>
    `;
  }

  profileFieldStyle(colors) {
    return `width:100%;border:1px solid ${colors.background.button}33;border-radius:0.9rem;background:${colors.background.card};color:${colors.text.title};padding:0.85rem 0.95rem;font:inherit;`;
  }

  renderPersonalInfoView(colors, fonts, user) {
    if (this.isEditingPersonalInfo) {
      return this.renderEditPersonalInfoForm(colors, fonts, user);
    }
    const rows = this.getPersonalInfoRows(user);
    return `
      <section style="display:grid;gap:1rem;">
        <div style="
          border-radius:1.15rem;
          border:1px solid ${colors.background.button}22;
          background:${colors.background.card};
          padding:1rem;
        ">
          <div style="
            width:3rem;
            height:3rem;
            border-radius:999px;
            background:${colors.background.button}18;
            color:${colors.icon.hover};
            display:flex;
            align-items:center;
            justify-content:center;
            margin-bottom:0.8rem;
          ">
            <i class="fas fa-id-card"></i>
          </div>
          <h3 style="margin:0;font-family:${fonts.primary};font-size:1.45rem;color:${colors.text.title};">Informations personnelles</h3>
          <p style="margin:0.45rem 0 0;color:${colors.text.body};line-height:1.6;font-size:0.9rem;">
            Retrouvez ici les informations associées a votre compte Smart Cut Services.
          </p>
        </div>

        <div style="display:grid;gap:0.7rem;">
          ${rows.map((row) => `
            <div style="
              display:grid;
              gap:0.25rem;
              border-radius:0.95rem;
              border:1px solid ${colors.background.button}18;
              background:${colors.background.card};
              padding:0.9rem 1rem;
            ">
              <span style="color:${colors.text.body};font-size:0.78rem;font-weight:800;text-transform:uppercase;letter-spacing:0.08em;">${this.escape(row.label)}</span>
              <strong style="color:${colors.text.title};font-size:0.98rem;line-height:1.45;word-break:break-word;">${this.escape(row.value)}</strong>
            </div>
          `).join('')}
        </div>

        <button class="profile-change-password-btn" style="
          border:none;
          border-radius:999px;
          background:${colors.background.button};
          color:${colors.text.button};
          padding:0.95rem 1rem;
          font-weight:800;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:0.55rem;
        ">
          <i class="fas fa-key"></i>
          Changer mon mot de passe
        </button>

        <button class="profile-edit-info-btn" style="
          border:1px solid ${colors.background.button}33;
          border-radius:999px;
          background:${colors.background.card};
          color:${colors.text.title};
          padding:0.95rem 1rem;
          font-weight:800;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
          gap:0.55rem;
        ">
          <i class="fas fa-pen"></i>
          Modifier mes informations
        </button>
      </section>
    `;
  }

  escape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async savePersonalInfo() {
    const user = this.authManager.getCurrentUser();
    if (!user?.uid || !db) return;

    const username = this.modal.querySelector('#profileEditUsername')?.value?.trim() || '';
    const lastName = this.modal.querySelector('#profileEditLastName')?.value?.trim() || '';
    const firstName = this.modal.querySelector('#profileEditFirstName')?.value?.trim() || '';
    const birthDate = this.modal.querySelector('#profileEditBirthDate')?.value?.trim() || '';
    const phone = this.modal.querySelector('#profileEditPhone')?.value?.trim() || '';
    const addressText = this.modal.querySelector('#profileEditAddress')?.value?.trim() || '';
    const department = this.modal.querySelector('#profileEditDepartment')?.value?.trim() || '';
    const commune = this.modal.querySelector('#profileEditCommune')?.value?.trim() || '';

    if (!username || !lastName || !firstName || !birthDate || !phone || !addressText || !department || !commune) {
      this.authManager.showToast('Merci de remplir tous les champs obligatoires.', 'error');
      return;
    }

    const currentClient = this.profileClient || this.cartManager.currentClient || {};
    const currentAddresses = Array.isArray(currentClient.addresses) ? currentClient.addresses : [];
    const currentDefaultAddress = this.getDefaultAddress(currentClient);
    const secondaryAddresses = currentAddresses.filter((address) => address && address !== currentDefaultAddress);
    const savedAddressUpdates = Array.from(this.modal.querySelectorAll('[data-saved-address-index]')).map((node) => {
      const index = Number(node.dataset.savedAddressIndex);
      const original = secondaryAddresses[index] || {};
      const savedAddress = this.modal.querySelector(`#profileSavedAddress_${index}`)?.value?.trim() || '';
      const savedDepartment = this.modal.querySelector(`#profileSavedDepartment_${index}`)?.value?.trim() || '';
      const savedCommune = this.modal.querySelector(`#profileSavedCommune_${index}`)?.value?.trim() || '';
      return {
        original,
        id: original.id || node.dataset.savedAddressId || `addr_saved_${index}`,
        address: savedAddress,
        department: savedDepartment,
        commune: savedCommune
      };
    });

    if (savedAddressUpdates.some((address) => !address.address || !address.department || !address.commune)) {
      this.authManager.showToast('Merci de compléter chaque adresse sauvegardée.', 'error');
      return;
    }

    const extraAddresses = Array.from(this.modal.querySelectorAll('[data-extra-address-index]')).map((node) => {
      const index = node.dataset.extraAddressIndex;
      const extraAddress = this.modal.querySelector(`#profileExtraAddress_${index}`)?.value?.trim() || '';
      const extraDepartment = this.modal.querySelector(`#profileExtraDepartment_${index}`)?.value?.trim() || '';
      const extraCommune = this.modal.querySelector(`#profileExtraCommune_${index}`)?.value?.trim() || '';
      const hasAnyValue = Boolean(extraAddress || extraDepartment || extraCommune);
      return {
        hasAnyValue,
        address: extraAddress,
        department: extraDepartment,
        commune: extraCommune
      };
    }).filter((item) => item.hasAnyValue);

    if (extraAddresses.some((address) => !address.address || !address.department || !address.commune)) {
      this.authManager.showToast('Merci de compléter chaque nouvelle adresse ajoutée.', 'error');
      return;
    }

    const addressId = currentDefaultAddress?.id || 'addr_' + Date.now().toString(36);
    const now = new Date().toISOString();
    const updatedAddress = {
      ...(currentDefaultAddress || {}),
      id: addressId,
      label: currentDefaultAddress?.label || 'Adresse principale',
      address: addressText,
      country: 'Haiti',
      department,
      commune,
      isDelivery: currentDefaultAddress?.isDelivery !== false,
      updatedAt: now,
      createdAt: currentDefaultAddress?.createdAt || now
    };
    const addresses = currentAddresses.length
      ? currentAddresses.map((address) => (address === currentDefaultAddress || address.id === addressId) ? updatedAddress : address)
      : [updatedAddress];
    if (!addresses.some((address) => address.id === addressId)) addresses.unshift(updatedAddress);
    savedAddressUpdates.forEach((update) => {
      const updatedSavedAddress = {
        ...(update.original || {}),
        id: update.id,
        label: update.original?.label || 'Adresse sauvegardée',
        address: update.address,
        country: 'Haiti',
        department: update.department,
        commune: update.commune,
        isDelivery: Boolean(update.original?.isDelivery),
        createdAt: update.original?.createdAt || now,
        updatedAt: now
      };
      const addressIndex = addresses.findIndex((address) => address === update.original || address.id === update.id);
      if (addressIndex >= 0) {
        addresses[addressIndex] = updatedSavedAddress;
      } else {
        addresses.push(updatedSavedAddress);
      }
    });
    extraAddresses.forEach((extraAddress, index) => {
      addresses.push({
        id: `addr_${Date.now().toString(36)}_${index}`,
        label: `Adresse ${addresses.length + 1}`,
        address: extraAddress.address,
        country: 'Haiti',
        department: extraAddress.department,
        commune: extraAddress.commune,
        isDelivery: false,
        createdAt: now,
        updatedAt: now
      });
    });

    const payload = {
      firstName,
      lastName,
      name: `${firstName || ''} ${lastName || ''}`.trim(),
      username,
      displayName: username,
      birthDate,
      phone,
      address: addressText,
      country: 'Haiti',
      department,
      commune,
      city: commune,
      addresses,
      defaultDeliveryAddressId: currentClient.defaultDeliveryAddressId || addressId,
      updatedAt: now
    };

    await setDoc(doc(db, 'clients', user.uid), payload, { merge: true });
    if (auth?.currentUser && username !== auth.currentUser.displayName) {
      await updateProfile(auth.currentUser, { displayName: username });
    }
    this.profileClient = { id: user.uid, ...currentClient, ...payload };
    this.cartManager.currentClient = {
      ...(this.cartManager.currentClient || {}),
      ...this.profileClient
    };
    this.isEditingPersonalInfo = false;
    this.additionalAddressForms = 0;
    this.authManager.showToast('Informations personnelles mises à jour.', 'success');
    this.render();
  }

  showPasswordResetSentModal(email) {
    const colors = this.getThemeColors();
    const fonts = this.getThemeFonts();
    const overlay = document.createElement('div');
    overlay.className = 'password-reset-sent-overlay';
    overlay.style.cssText = `
      position:fixed;
      inset:0;
      z-index:1000002;
      background:rgba(0,0,0,0.55);
      backdrop-filter:blur(6px);
      display:flex;
      align-items:center;
      justify-content:center;
      padding:1rem;
    `;

    overlay.innerHTML = `
      <div style="
        width:100%;
        max-width:420px;
        border-radius:1.35rem;
        background:${colors.background.general};
        color:${colors.text.title};
        box-shadow:0 24px 60px rgba(0,0,0,0.24);
        padding:1.25rem;
        border:1px solid ${colors.background.button}33;
        text-align:center;
      ">
        <div style="
          width:4rem;
          height:4rem;
          border-radius:999px;
          margin:0 auto 0.95rem;
          display:flex;
          align-items:center;
          justify-content:center;
          background:${colors.background.button}18;
          color:${colors.icon.hover};
          font-size:1.5rem;
        ">
          <i class="fas fa-envelope-circle-check"></i>
        </div>
        <h3 style="margin:0;font-family:${fonts.primary};font-size:1.75rem;line-height:1;color:${colors.text.title};">Lien envoyé</h3>
        <p style="margin:0.8rem 0 0;color:${colors.text.body};line-height:1.65;">
          Un lien pour changer votre mot de passe a été envoyé à:
        </p>
        <strong style="display:block;margin:0.65rem 0;color:${colors.text.title};word-break:break-word;">${this.escape(email)}</strong>
        <div style="
          margin-top:0.85rem;
          border-radius:1rem;
          background:${colors.background.button}12;
          border:1px solid ${colors.background.button}22;
          padding:0.85rem;
          color:${colors.text.body};
          line-height:1.55;
          font-size:0.9rem;
        ">
          Si vous ne le voyez pas dans votre boîte de réception, vérifiez aussi vos spams ou courriers indésirables.
        </div>
        <button type="button" class="password-reset-sent-close" style="
          margin-top:1rem;
          width:100%;
          border:none;
          border-radius:999px;
          background:${colors.background.button};
          color:${colors.text.button};
          padding:0.95rem 1rem;
          font-weight:800;
          cursor:pointer;
        ">
          Compris
        </button>
      </div>
    `;

    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('.password-reset-sent-close')?.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
  }

  updateSectionVisibility(sectionName) {
    if (!this.modal) return;

    if (sectionName === 'orders') {
      const content = this.modal.querySelector('.orders-content');
      const icon = this.modal.querySelector('.orders-header .fa-chevron-down');
      if (content) {
        content.style.display = this.cartManager.ordersVisible ? 'block' : 'none';
      }
      if (icon) {
        icon.style.transform = this.cartManager.ordersVisible ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    }

    if (sectionName === 'likes') {
      const content = this.modal.querySelector('.likes-content');
      const icon = this.modal.querySelector('.likes-header .fa-chevron-down');
      if (content) {
        content.style.display = this.cartManager.likesVisible ? 'block' : 'none';
      }
      if (icon) {
        icon.style.transform = this.cartManager.likesVisible ? 'rotate(180deg)' : 'rotate(0deg)';
      }
    }
  }

  renderSummaryCards(colors) {
    const likes = this.likeManager.getLikedProducts();
    const orders = this.getVisibleOrders();
    const paidOrders = orders.filter((order) => ['approved', 'paid'].includes(order.status));

    const cards = [
      {
        label: 'Favoris',
        value: likes.length,
        icon: 'fa-heart',
        accent: '#DC2626'
      },
      {
        label: 'Commandes',
        value: orders.length,
        icon: 'fa-receipt',
        accent: colors.icon.hover
      },
      {
        label: 'Confirmées',
        value: paidOrders.length,
        icon: 'fa-circle-check',
        accent: '#10B981'
      }
    ];

    return `
      <div style="
        display:grid;
        grid-template-columns:repeat(3, minmax(0, 1fr));
        gap:0.65rem;
        margin-bottom:1.2rem;
      ">
        ${cards.map((card) => `
          <div style="
            background:${colors.background.card};
            border:1px solid ${colors.background.button}22;
            border-radius:1rem;
            padding:0.85rem;
            min-width:0;
          ">
            <div style="
              width:2rem;
              height:2rem;
              border-radius:999px;
              display:flex;
              align-items:center;
              justify-content:center;
              background:${card.accent}18;
              color:${card.accent};
              margin-bottom:0.5rem;
            ">
              <i class="fas ${card.icon}"></i>
            </div>
            <div style="font-size:1.05rem;font-weight:800;color:${colors.text.title};">${card.value}</div>
            <div style="font-size:0.74rem;color:${colors.text.body};">${card.label}</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  renderVendorQuickAccess(colors) {
    if (!this.vendorAccess?.approved) return '';

    const shopName = this.vendorAccess.shopName || 'Votre boutique';
    return `
      <a class="profile-vendor-dashboard-btn" href="${VENDOR_DASHBOARD_URL}" style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:0.9rem;
        padding:1rem 1.05rem;
        border-radius:1rem;
        text-decoration:none;
        background:linear-gradient(135deg, ${colors.background.button}, ${colors.icon.hover});
        color:${colors.text.button};
        box-shadow:0 18px 34px rgba(31,30,28,0.12);
        margin-bottom:1rem;
      ">
        <div style="min-width:0;">
          <div style="font-size:0.75rem;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;opacity:0.88;">Dashboard vendeur</div>
          <div style="font-size:1rem;font-weight:800;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${shopName}</div>
        </div>
        <span style="
          width:2.4rem;
          height:2.4rem;
          min-width:2.4rem;
          border-radius:999px;
          background:rgba(255,255,255,0.18);
          display:flex;
          align-items:center;
          justify-content:center;
        ">
          <i class="fas fa-store"></i>
        </span>
      </a>
    `;
  }

  renderLoggedOutState(colors) {
    const guestOrders = this.getVisibleOrders();
    return `
      <div style="
        padding:1.1rem;
        border-radius:1rem;
        background:${colors.background.card};
        border:1px solid ${colors.background.button}22;
        margin-bottom:1rem;
      ">
        <div style="
          width:3.5rem;
          height:3.5rem;
          border-radius:999px;
          display:flex;
          align-items:center;
          justify-content:center;
          background:${colors.background.button}18;
          color:${colors.icon.hover};
          margin-bottom:0.85rem;
        ">
          <i class="fas fa-user" style="font-size:1.35rem;"></i>
        </div>
        <h3 style="margin:0 0 0.35rem;font-size:1.2rem;color:${colors.text.title};">Connectez-vous</h3>
        <p style="margin:0 0 1rem;color:${colors.text.body};line-height:1.6;">
          Retrouvez vos favoris, votre historique et vos commandes. En invité, vous pouvez déjà revoir vos commandes passées sur cet appareil.
        </p>
        <div style="display:flex;flex-wrap:wrap;gap:0.65rem;">
          <button class="profile-login-btn" style="
            border:none;
            border-radius:999px;
            background:${colors.background.button};
            color:${colors.text.button};
            padding:0.85rem 1rem;
            font-weight:700;
            cursor:pointer;
          ">Se connecter / S'inscrire</button>
        </div>
      </div>

      <div style="
        display:grid;
        gap:0.8rem;
      ">
        <div style="
          border-radius:0.95rem;
          border:1px solid ${colors.background.button}22;
          background:${colors.background.card};
          padding:0.9rem;
          color:${colors.text.body};
          line-height:1.55;
        ">
          <strong style="color:${colors.text.title};display:block;margin-bottom:0.3rem;">Ce que vous trouverez ici</strong>
          Favoris, historique de commandes, téléchargement des reçus PDF et accès rapide à votre compte.
        </div>
        ${guestOrders.length > 0 ? `
          <div style="
            border-radius:0.95rem;
            border:1px solid ${colors.background.button}22;
            background:${colors.background.card};
            padding:0.9rem;
            color:${colors.text.body};
            line-height:1.55;
          ">
            <strong style="color:${colors.text.title};display:block;margin-bottom:0.3rem;">Commandes invité</strong>
            Vos commandes passées sans connexion restent visibles ici sur cet appareil.
          </div>
        ` : ''}
      </div>
      ${guestOrders.length > 0 ? `
        <div style="margin-top:1.2rem;">
          ${this.cartManager.renderOrdersSection(colors, this.getThemeFonts())}
        </div>
      ` : ''}
    `;
  }

  render() {
    if (!this.modal) return;

    const colors = this.getThemeColors();
    const fonts = this.getThemeFonts();
    const user = this.authManager.getCurrentUser();
    const isAuthenticated = this.authManager.isAuthenticated();
    const isAuthResolving = this.isBootstrapping && !this.authManager.isAuthReady;
    const isPersonalView = isAuthenticated && this.activeView === 'personal';
    const isMounted = document.body.contains(this.modal);

    this.modal.innerHTML = `
      <div class="profile-overlay" style="
        position:fixed;
        inset:0;
        background:rgba(0,0,0,0.5);
        backdrop-filter:blur(5px);
        z-index:999998;
        opacity:${isMounted ? '1' : '0'};
        transition:opacity 0.28s ease;
      "></div>

      <aside class="profile-container" style="
        position:fixed;
        top:0;
        right:0;
        width:100%;
        max-width:450px;
        height:100vh;
        background:${colors.background.general};
        z-index:999999;
        box-shadow:-10px 0 30px rgba(0,0,0,0.1);
        transform:${isMounted ? 'translateX(0)' : 'translateX(100%)'};
        opacity:${isMounted ? '1' : '0'};
        transition:transform 0.28s ease, opacity 0.28s ease;
        display:flex;
        flex-direction:column;
      ">
        <div style="
          padding:1.35rem 1.5rem 1.15rem;
          border-bottom:1px solid ${colors.background.button}22;
          background:${colors.background.general};
          flex-shrink:0;
        ">
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;">
            <div style="min-width:0;">
              ${isPersonalView ? `
                <button class="profile-back-account-btn" style="
                  border:none;
                  background:transparent;
                  color:${colors.text.body};
                  padding:0 0 0.7rem;
                  display:inline-flex;
                  align-items:center;
                  gap:0.45rem;
                  cursor:pointer;
                  font-weight:800;
                ">
                  <i class="fas fa-arrow-left"></i>
                  Retour
                </button>
              ` : ''}
              <div style="
                display:inline-flex;
                align-items:center;
                gap:0.45rem;
                color:${colors.icon.hover};
                font-size:0.76rem;
                font-weight:800;
                letter-spacing:0.08em;
                text-transform:uppercase;
                margin-bottom:0.35rem;
              ">
                <i class="fas fa-user-circle"></i>
                Espace profil
              </div>
              <h2 style="
                margin:0;
                font-family:${fonts.primary};
                font-size:1.7rem;
                color:${colors.text.title};
                line-height:1;
              ">${isPersonalView ? 'Informations personnelles' : isAuthResolving ? 'Chargement du profil' : isAuthenticated ? this.getUserLabel(user) : (this.getVisibleOrders().length > 0 ? 'Profil invité' : 'Mon compte')}</h2>
              <p style="margin:0.45rem 0 0;color:${colors.text.body};font-size:0.86rem;line-height:1.45;">
                ${isPersonalView ? 'Vos informations de compte' : isAuthResolving ? 'Vérification de votre session en cours...' : isAuthenticated ? (user?.email || 'Compte connecté') : (this.getVisibleOrders().length > 0 ? 'Historique invité disponible sur cet appareil' : 'Connexion, favoris, commandes et historique')}
              </p>
            </div>

            <div style="display:flex;align-items:center;gap:0.55rem;flex-shrink:0;">
              ${isAuthenticated ? `
                <button class="profile-logout-btn" style="
                  border:1px solid ${colors.background.button};
                  background:transparent;
                  color:${colors.text.body};
                  padding:0.45rem 0.8rem;
                  border-radius:999px;
                  cursor:pointer;
                  font-size:0.78rem;
                  font-weight:700;
                ">Déconnexion</button>
              ` : ''}
              <button class="close-profile-btn" style="
                border:none;
                background:${colors.background.card};
                color:${colors.text.body};
                width:40px;
                height:40px;
                border-radius:999px;
                cursor:pointer;
                display:flex;
                align-items:center;
                justify-content:center;
              ">
                <i class="fas fa-times"></i>
              </button>
            </div>
          </div>
        </div>

        <div style="flex:1;overflow-y:auto;padding:1.25rem 1.5rem 1.5rem;">
          ${isAuthResolving ? `
            <div style="
              border:1px solid ${colors.background.button}22;
              border-radius:1rem;
              background:${colors.background.card};
              padding:1rem;
              color:${colors.text.body};
              line-height:1.5;
            ">
              <strong style="display:block;color:${colors.text.title};margin-bottom:0.35rem;">Session en cours de vérification</strong>
              Votre compte est en cours de restauration. Le profil apparaîtra automatiquement.
            </div>
          ` : isPersonalView ? this.renderPersonalInfoView(colors, fonts, user) : isAuthenticated ? `
            ${this.renderVendorQuickAccess(colors)}
            ${this.isBootstrapping ? `
              <div style="
                margin-bottom:1rem;
                border-radius:1rem;
                border:1px solid ${colors.background.button}22;
                background:${colors.background.card};
                padding:0.9rem 1rem;
                color:${colors.text.body};
              ">
                Chargement de votre profil, commandes et favoris...
              </div>
            ` : ''}
            ${this.renderSummaryCards(colors)}
            <button class="profile-personal-info-btn" style="
              width:100%;
              border:1px solid ${colors.background.button}22;
              border-radius:1rem;
              background:${colors.background.card};
              color:${colors.text.title};
              padding:0.95rem 1rem;
              margin-bottom:1rem;
              cursor:pointer;
              display:flex;
              align-items:center;
              justify-content:space-between;
              gap:0.8rem;
              font-weight:800;
            ">
              <span style="display:flex;align-items:center;gap:0.6rem;">
                <i class="fas fa-id-card" style="color:${colors.icon.hover};"></i>
                Informations personnelles
              </span>
              <i class="fas fa-chevron-right" style="color:${colors.text.body};"></i>
            </button>
            ${this.cartManager.renderLikedSection(colors, fonts)}
            ${this.cartManager.renderOrdersSection(colors, fonts)}
          ` : this.renderLoggedOutState(colors)}
        </div>
      </aside>
    `;

    this.attachEvents();
  }

  attachEvents() {
    if (!this.modal) return;

    const closeBtn = this.modal.querySelector('.close-profile-btn');
    const overlay = this.modal.querySelector('.profile-overlay');
    const loginBtn = this.modal.querySelector('.profile-login-btn');
    const logoutBtn = this.modal.querySelector('.profile-logout-btn');
    const personalInfoBtn = this.modal.querySelector('.profile-personal-info-btn');
    const backAccountBtn = this.modal.querySelector('.profile-back-account-btn');
    const changePasswordBtn = this.modal.querySelector('.profile-change-password-btn');
    const editInfoBtn = this.modal.querySelector('.profile-edit-info-btn');
    const cancelEditBtn = this.modal.querySelector('.profile-cancel-edit-btn');
    const addAddressBtn = this.modal.querySelector('.profile-add-address-btn');
    const personalForm = this.modal.querySelector('.profile-personal-form');
    const departmentSelect = this.modal.querySelector('#profileEditDepartment');
    const communeSelect = this.modal.querySelector('#profileEditCommune');
    const ordersHeader = this.modal.querySelector('.orders-header');
    const likesHeader = this.modal.querySelector('.likes-header');

    closeBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      this.close();
    });

    overlay?.addEventListener('click', (event) => {
      if (Date.now() - this.openedAt < 350) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.target === overlay) this.close();
    });

    loginBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      console.info('[PROFILE_DEBUG] login-click', {
        version: '20260523-5',
        authReady: this.authManager.isAuthReady,
        isAuthenticated: this.authManager.isAuthenticated(),
        authUid: this.authManager.getCurrentUser()?.uid || null,
        firebaseUid: auth?.currentUser?.uid || null
      });
      this.close();
      window.setTimeout(() => {
        console.info('[PROFILE_DEBUG] opening-auth-after-profile-close', {
          version: '20260523-5',
          authReady: this.authManager.isAuthReady,
          isAuthenticated: this.authManager.isAuthenticated(),
          authUid: this.authManager.getCurrentUser()?.uid || null,
          firebaseUid: auth?.currentUser?.uid || null
        });
        this.authManager.openAuthModal('login');
      }, 160);
    });

    logoutBtn?.addEventListener('click', async (event) => {
      event.preventDefault();
      await this.authManager.logout();
      this.activeView = 'account';
      this.render();
    });

    personalInfoBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      this.activeView = 'personal';
      this.isEditingPersonalInfo = false;
      this.render();
      this.ensureProfileClientLoaded().then(() => {
        if (this.modal && this.activeView === 'personal') this.render();
      });
    });

    backAccountBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      this.activeView = 'account';
      this.isEditingPersonalInfo = false;
      this.render();
    });

    editInfoBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      this.isEditingPersonalInfo = true;
      this.additionalAddressForms = 0;
      this.render();
    });

    cancelEditBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      this.isEditingPersonalInfo = false;
      this.additionalAddressForms = 0;
      this.render();
    });

    addAddressBtn?.addEventListener('click', (event) => {
      event.preventDefault();
      this.additionalAddressForms += 1;
      this.render();
    });

    departmentSelect?.addEventListener('change', () => {
      if (communeSelect) {
        communeSelect.innerHTML = this.renderCommuneOptions(departmentSelect.value);
      }
    });

    this.modal.querySelectorAll('.profile-extra-department').forEach((select) => {
      select.addEventListener('change', () => {
        const index = select.dataset.extraAddressDepartment;
        const extraCommune = this.modal.querySelector(`[data-extra-address-commune="${index}"]`);
        if (extraCommune) extraCommune.innerHTML = this.renderCommuneOptions(select.value);
      });
    });

    this.modal.querySelectorAll('.profile-saved-department').forEach((select) => {
      select.addEventListener('change', () => {
        const index = select.dataset.savedAddressDepartment;
        const savedCommune = this.modal.querySelector(`[data-saved-address-commune="${index}"]`);
        if (savedCommune) savedCommune.innerHTML = this.renderCommuneOptions(select.value);
      });
    });

    personalForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await this.savePersonalInfo();
      } catch (error) {
        console.error('Erreur sauvegarde informations personnelles:', error);
        this.authManager.showToast('Impossible de sauvegarder vos informations.', 'error');
      }
    });

    changePasswordBtn?.addEventListener('click', async (event) => {
      event.preventDefault();
      const email = this.authManager.getCurrentUser()?.email || this.cartManager.currentClient?.email || '';
      if (!email) {
        this.authManager.showToast('Email introuvable pour ce compte.', 'error');
        return;
      }
      try {
        await sendPasswordResetEmail(auth, email);
        this.showPasswordResetSentModal(email);
      } catch (error) {
        console.error('Erreur changement mot de passe:', error);
        this.authManager.showToast('Impossible d envoyer l email de changement de mot de passe.', 'error');
      }
    });

    ordersHeader?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cartManager.ordersVisible = !this.cartManager.ordersVisible;
      this.updateSectionVisibility('orders');
    });

    likesHeader?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.cartManager.likesVisible = !this.cartManager.likesVisible;
      this.updateSectionVisibility('likes');
    });

    this.modal.querySelectorAll('.liked-product-open').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const productId = button.dataset.productId;
        this.close();
        this.cartManager.openLikedProduct(productId);
      });
    });

    this.modal.querySelectorAll('.liked-product-remove').forEach((button) => {
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        const productId = button.dataset.productId;
        if (!productId) return;
        await this.likeManager.toggleLike(productId);
      });
    });

    this.modal.querySelectorAll('.download-pdf-btn').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const orderId = button.dataset.orderId;
        this.cartManager.downloadOrderPdf(orderId);
      });
    });

    this.modal.querySelectorAll('.hide-order-btn').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.preventDefault();
        const orderId = button.dataset.orderId;
        this.cartManager.hideOrderFromClient(orderId);
        this.render();
      });
    });
  }
}

let profilePanelInstance = null;

export function getProfilePanel() {
  if (!profilePanelInstance) {
    profilePanelInstance = new ProfilePanel();
  }
  return profilePanelInstance;
}

export default ProfilePanel;



