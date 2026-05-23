// ============= CHECKOUT COMPONENT - MODAL DE PAIEMENT =============
import { db } from './firebase-init.js';
import { collection, doc, getDoc, getDocs, setDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

function normalizeSelectedOptionLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isCustomerVisibleOption(option) {
  if (!option || typeof option === 'string') return true;
  const label = normalizeSelectedOptionLabel(option?.label || option?.name || option?.key || option?.type || '');
  return !['url fichier', 'lien fichier', 'chemin storage', 'storage path'].includes(label);
}

function getCustomerVisibleOptions(options) {
  return (Array.isArray(options) ? options : []).filter(isCustomerVisibleOption);
}

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

class CheckoutModal {
  constructor(options = {}) {
    this.options = {
      onClose: null,
      onSuccess: null,
      currency: 'HTG',
      imageBasePath: './',
      shippingCost: 5.90,
      freeShippingThreshold: 50,
      cart: [],
      client: null,
      ...options
    };
    
    this.cart = this.options.cart || [];
    this.client = this.options.client;
    this.subtotal = 0;
    this.discountAmount = 0;
    this.shipping = 0;
    this.total = 0;
    this.appliedPromo = null;
    this.uniqueId = 'checkout_' + Math.random().toString(36).substr(2, 9);
    this.modal = null;
    this.paymentModal = null;
    this.deliverySettings = null;
    this.deliveryData = {
      homeZones: [],
      pickupPoints: [],
      meetupZones: [],
      weightRules: []
    };
    this.selectedDelivery = {
      method: null,
      home: {
        savedAddressId: '',
        zoneId: '',
        address: '',
        country: 'Haiti',
        department: '',
        commune: '',
        phone: '',
        whatsapp: ''
      },
      pickup: {
        pointId: ''
      },
      meetup: {
        zoneId: '',
        proposal: '',
        phone: '',
        whatsapp: ''
      }
    };
    this.deliveryFees = {
      base: 0,
      weightExtra: 0,
      total: 0
    };
    
    if (!this.client) {
      console.error('❌ Checkout: Aucun client fourni');
    }
    
    this.calculateTotals();
    this.render();
    this.attachEvents();
    this.animateIn();
    this.initDelivery();
    
    // Bloquer le scroll du body
    document.body.style.overflow = 'hidden';
  }
  
  calculateTotals() {
    this.subtotal = this.cart.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
    this.discountAmount = Math.max(0, Number(this.appliedPromo?.discountAmount || 0));
    this.shipping = Number(this.shipping) || 0;
    this.total = Math.max(0, this.subtotal - this.discountAmount) + this.shipping;
  }
  
  getImagePath(filename) {
    if (!filename) return '';
    if (filename.startsWith('http')) return filename;
    const cleanName = filename.split('/').pop();
    return `${this.options.imageBasePath}${cleanName}`;
  }
  
  formatPrice(price) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency', 
      currency: this.options.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price || 0);
  }

  getSavedDeliveryAddresses() {
    const addresses = Array.isArray(this.client?.addresses) ? this.client.addresses : [];
    return addresses.filter((address) => (
      address
      && address.address
      && address.country
      && address.department
      && address.commune
    ));
  }

  getDefaultDeliveryAddress() {
    const addresses = this.getSavedDeliveryAddresses();
    if (!addresses.length) return null;
    return addresses.find((address) => address.id === this.client?.defaultDeliveryAddressId)
      || addresses.find((address) => address.isDelivery)
      || addresses[0];
  }

  formatSavedAddress(address) {
    if (!address) return '';
    return [address.address, address.commune, address.department, address.country || 'Haiti']
      .filter(Boolean)
      .join(', ');
  }

  hasVendorItems() {
    return this.cart.some((item) => String(item?.vendorId || '').trim() !== '');
  }

  hasSmartCutItems() {
    return this.cart.some((item) => !String(item?.vendorId || '').trim());
  }

  getVendorDeliveryGroups() {
    return this.cart.map((item, index) => {
      const vendorId = String(item?.vendorId || '').trim();
      if (!vendorId) return null;
      const productCoverage = item.productDeliveryCoverage || item.deliveryCoverage || item.vendorDeliveryCoverage || null;
      const productZones = Array.isArray(item.productDeliveryZones)
        ? item.productDeliveryZones
        : (Array.isArray(item.deliveryZones)
          ? item.deliveryZones
          : (Array.isArray(item.vendorDeliveryZones) ? item.vendorDeliveryZones : []));
      return {
        cartIndex: index,
        productId: item.productId || '',
        productName: item.name || 'Produit',
        quantity: Math.max(1, Number(item.quantity) || 1),
        vendorId,
        vendorName: item.vendorName || 'Vendeur',
        coverage: productCoverage,
        zones: productZones
      };
    }).filter(Boolean);
  }

  findVendorDeliveryZone(group) {
    const department = String(this.selectedDelivery.home.department || '').trim();
    const commune = String(this.selectedDelivery.home.commune || '').trim();
    const coverage = group.coverage || {};
    const zones = Array.isArray(coverage.zones) && coverage.zones.length ? coverage.zones : group.zones;
    if (coverage.nationwide && zones.length === 0) {
      return { country: 'Haiti', department: 'Tout Haiti', commune: 'Tout Haiti', fee: Number(coverage.nationwideFee || 0), nationwide: true };
    }
    return (Array.isArray(zones) ? zones : []).find((zone) => (
      String(zone.country || 'Haiti') === 'Haiti'
      && String(zone.department || '').trim() === department
      && String(zone.commune || '').trim() === commune
    )) || null;
  }

  getVendorDeliveryFee() {
    if (this.selectedDelivery.method !== 'home') return 0;
    return this.getVendorDeliveryGroups().reduce((sum, group) => {
      const zone = this.findVendorDeliveryZone(group);
      return sum + (Number(zone?.fee || 0) * Math.max(1, Number(group.quantity) || 1));
    }, 0);
  }

  getCartItemDeliveryZone(item) {
    if (!String(item?.vendorId || '').trim()) return null;
    const group = this.getVendorDeliveryGroups().find((entry) => (
      entry.productId === item.productId
      && entry.productName === (item.name || 'Produit')
    ));
    return group ? this.findVendorDeliveryZone(group) : null;
  }

  getCartItemDeliveryLabel(item) {
    if (!String(item?.vendorId || '').trim()) return '';
    const department = String(this.selectedDelivery.home.department || '').trim();
    const commune = String(this.selectedDelivery.home.commune || '').trim();
    if (!department || !commune) return 'Livraison calculee apres choix de votre adresse.';
    const zone = this.getCartItemDeliveryZone(item);
    if (!zone) return `Livraison indisponible a ${commune}.`;
    const qty = Math.max(1, Number(item.quantity) || 1);
    const fee = Number(zone.fee || 0) * qty;
    return `Livraison ${commune}: ${this.formatPrice(fee)}`;
  }

  escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  escapeAttribute(value) {
    return this.escapeHtml(value);
  }
  
  render() {
    this.modal = document.createElement('div');
    this.modal.className = `checkout-modal-${this.uniqueId}`;
    this.modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
      z-index: 1000000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
      opacity: 0;
      transition: opacity 0.3s ease;
    `;
    
    this.modal.innerHTML = `
      <div class="checkout-container-${this.uniqueId}" style="
        background: #F5F1E8;
        border-radius: 1.5rem;
        width: 100%;
        max-width: 900px;
        max-height: 90vh;
        overflow-y: auto;
        box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        transform: scale(0.95);
        transition: transform 0.3s ease;
        position: relative;
      ">
        <!-- Header avec bouton fermeture -->
        <div style="
          position: sticky;
          top: 0;
          background: #F5F1E8;
          border-bottom: 1px solid rgba(198, 167, 94, 0.2);
          padding: 1.5rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 10;
          border-radius: 1.5rem 1.5rem 0 0;
        ">
          <h2 style="
            font-family: 'Cormorant Garamond', serif;
            font-size: 1.8rem;
            color: #1F1E1C;
            margin: 0;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          ">
            <i class="fas fa-lock" style="color: #C6A75E; font-size: 1.2rem;"></i>
            Paiement sécurisé
          </h2>
          <button class="close-checkout" style="
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: #8B7E6B;
            transition: all 0.2s;
            padding: 0.5rem;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
          " onmouseover="this.style.background='rgba(198,167,94,0.1)'; this.style.color='#C6A75E'" onmouseout="this.style.background='transparent'; this.style.color='#8B7E6B'">
            <i class="fas fa-times"></i>
          </button>
        </div>
        
        <!-- Informations client -->
        <div style="padding: 1rem 1.5rem; background: #C6A75E10; border-bottom: 1px solid rgba(198, 167, 94, 0.2);">
          <div style="display: flex; align-items: center; gap: 0.5rem; color: #1F1E1C;">
            <i class="fas fa-user-circle"></i>
            <span style="font-weight: 500;">${this.client?.name || 'Client'}</span>
            <span style="color: #8B7E6B;">(${this.client?.email || 'Email non renseigné'})</span>
          </div>
        </div>
        
        <!-- Contenu principal -->
        <div style="padding: 1.5rem;">
          ${this.cart.length === 0 ? this.renderEmptyCart() : this.renderCheckoutContent()}
        </div>
      </div>
      
      <style>
        @keyframes checkoutSlideIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        
        .checkout-container-${this.uniqueId} {
          animation: checkoutSlideIn 0.3s ease forwards;
        }
        
        /* Scrollbar personnalisée */
        .checkout-container-${this.uniqueId}::-webkit-scrollbar {
          width: 6px;
        }
        
        .checkout-container-${this.uniqueId}::-webkit-scrollbar-track {
          background: rgba(198, 167, 94, 0.1);
          border-radius: 3px;
        }
        
        .checkout-container-${this.uniqueId}::-webkit-scrollbar-thumb {
          background: #C6A75E;
          border-radius: 3px;
        }
        
        /* Styles pour le tableau responsive */
        .checkout-table {
          width: 100%;
          border-collapse: collapse;
        }
        
        .checkout-table th {
          text-align: left;
          padding: 0.75rem;
          font-weight: 500;
          color: #8B7E6B;
          font-size: 0.85rem;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          border-bottom: 2px solid rgba(198, 167, 94, 0.2);
        }
        
        .checkout-table td {
          padding: 1rem 0.75rem;
          border-bottom: 1px solid rgba(198, 167, 94, 0.1);
          vertical-align: top;
        }
        
        .checkout-table tr:last-child td {
          border-bottom: none;
        }
        
        /* Version mobile : carte produit */
        @media (max-width: 640px) {
          .checkout-table thead {
            display: none;
          }
          
          .checkout-table tr {
            display: block;
            margin-bottom: 1.5rem;
            border: 1px solid rgba(198, 167, 94, 0.2);
            border-radius: 0.75rem;
            padding: 1rem;
          }
          
          .checkout-table td {
            display: block;
            padding: 0.5rem 0;
            border-bottom: none;
          }
          
          .checkout-table td::before {
            content: attr(data-label);
            display: inline-block;
            width: 100px;
            font-weight: 500;
            color: #8B7E6B;
            font-size: 0.85rem;
          }
          
          .mobile-product-row {
            display: flex;
            gap: 1rem;
            align-items: start;
          }
        }
      </style>
    `;
    
    document.body.appendChild(this.modal);
  }
  
  renderEmptyCart() {
    return `
      <div style="
        text-align: center;
        padding: 3rem 1rem;
      ">
        <div style="
          width: 120px;
          height: 120px;
          background: rgba(198, 167, 94, 0.1);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1.5rem;
        ">
          <i class="fas fa-shopping-bag" style="font-size: 3rem; color: #C6A75E; opacity: 0.5;"></i>
        </div>
        <h3 style="
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.5rem;
          color: #1F1E1C;
          margin-bottom: 0.5rem;
        ">Votre panier est vide</h3>
        <p style="color: #8B7E6B; margin-bottom: 2rem;">
          Ajoutez des produits pour procéder au paiement
        </p>
        <button class="close-checkout" style="
          background: #1F1E1C;
          color: #F5F1E8;
          border: 1px solid #C6A75E;
          padding: 0.75rem 2rem;
          border-radius: 0.5rem;
          cursor: pointer;
          font-size: 1rem;
          transition: all 0.3s;
        " onmouseover="this.style.background='#C6A75E'; this.style.color='#1F1E1C'" onmouseout="this.style.background='#1F1E1C'; this.style.color='#F5F1E8'">
          Retour aux achats
        </button>
      </div>
    `;
  }
  
  renderCheckoutContent() {
    const baseFee = Number(this.deliveryFees.base || 0);
    const weightFee = Number(this.deliveryFees.weightExtra || 0);
    const baseDisplay = baseFee === 0 && weightFee === 0 ? 'Gratuite' : this.formatPrice(baseFee);
    return `
      <!-- Version Desktop (tableau) -->
      <div class="hidden sm:block">
        <table class="checkout-table">
          <thead>
            <tr>
              <th>Produit</th>
              <th>Options</th>
              <th>Prix unit.</th>
              <th>Quantité</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            ${this.cart.map((item, index) => this.renderDesktopRow(item, index)).join('')}
          </tbody>
        </table>
      </div>
      
      <!-- Version Mobile (cartes) -->
      <div class="sm:hidden space-y-4">
        ${this.cart.map((item, index) => this.renderMobileCard(item, index)).join('')}
      </div>
      
      <!-- Livraison -->
      ${this.renderDeliverySection()}
      
      <!-- Résumé et paiement -->
      <div style="
        margin-top: 2rem;
        padding-top: 1.5rem;
        border-top: 2px solid rgba(198, 167, 94, 0.2);
      ">
        <!-- Code promo (optionnel) -->
        <div style="
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1.5rem;
        ">
          <input type="text" class="promo-code" placeholder="Code promo" style="
            flex: 1;
            padding: 0.75rem;
            border: 1px solid rgba(198, 167, 94, 0.3);
            border-radius: 0.5rem;
            background: white;
            font-size: 0.95rem;
          ">
          <button class="apply-promo" style="
            background: transparent;
            color: #1F1E1C;
            border: 1px solid #C6A75E;
            padding: 0.75rem 1.5rem;
            border-radius: 0.5rem;
            cursor: pointer;
            transition: all 0.3s;
            font-weight: 500;
          " onmouseover="this.style.background='#C6A75E'; this.style.color='#1F1E1C'" onmouseout="this.style.background='transparent'; this.style.color='#1F1E1C'">
            Appliquer
          </button>
        </div>
        <div style="
          margin: -0.8rem 0 1rem;
          color: #8B7E6B;
          font-size: 0.85rem;
          line-height: 1.55;
        ">
          Les codes promo Smart Cut Services s appliquent uniquement aux produits Smart Cut eligibles de votre panier.
        </div>
        <div class="promo-feedback" style="
          display: ${this.appliedPromo ? 'block' : 'none'};
          margin: -0.8rem 0 1.2rem;
          color: #2E5D3A;
          font-size: 0.9rem;
          line-height: 1.5;
        ">${this.appliedPromo ? this.escapeHtml(this.buildPromoFeedback()) : ''}</div>
        
        <!-- Totaux -->
        <div style="
          max-width: 400px;
          margin-left: auto;
        ">
          <div style="
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.75rem;
            font-size: 1rem;
          ">
            <span style="color: #8B7E6B;">Sous-total</span>
            <span style="font-weight: 500;">${this.formatPrice(this.subtotal)}</span>
          </div>

          <div class="promo-discount-row" style="
            display: ${this.discountAmount > 0 ? 'flex' : 'none'};
            justify-content: space-between;
            margin-bottom: 0.75rem;
            font-size: 1rem;
          ">
            <span style="color: #2E5D3A;">Code promo</span>
            <span style="font-weight: 600; color: #2E5D3A;">- ${this.formatPrice(this.discountAmount)}</span>
          </div>
          
          <div style="
            display: flex;
            justify-content: space-between;
            margin-bottom: 0.75rem;
            font-size: 1rem;
          ">
            <span style="color: #8B7E6B; display: flex; align-items: center; gap: 0.25rem;">
              <i class="fas fa-truck"></i>
              Livraison
            </span>
            <span data-shipping-amount style="font-weight: 500;">
              ${baseDisplay}
            </span>
          </div>
          
          <div data-weight-row style="
            display: ${weightFee > 0 ? 'flex' : 'none'};
            justify-content: space-between;
            margin-bottom: 0.75rem;
            font-size: 0.95rem;
          ">
            <span style="color: #8B7E6B;">Supplément poids</span>
            <span data-weight-fee style="font-weight: 500;">${weightFee > 0 ? this.formatPrice(weightFee) : this.formatPrice(0)}</span>
          </div>
          
          <div style="
            display: flex;
            justify-content: space-between;
            margin-top: 1rem;
            padding-top: 1rem;
            border-top: 2px solid #C6A75E;
            font-size: 1.25rem;
            font-weight: bold;
          ">
            <span>Total TTC</span>
            <span data-total-amount style="color: #1F1E1C;">${this.formatPrice(this.total)}</span>
          </div>
        </div>
        
        <!-- Bouton paiement -->
        <button class="pay-now-btn" style="
          width: 100%;
          background: #1F1E1C;
          color: #F5F1E8;
          border: 2px solid #C6A75E;
          padding: 1.25rem;
          border-radius: 0.75rem;
          font-size: 1.2rem;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          margin-top: 2rem;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
        " onmouseover="this.style.background='#C6A75E'; this.style.color='#1F1E1C'" onmouseout="this.style.background='#1F1E1C'; this.style.color='#F5F1E8'">
          <i class="fas fa-lock"></i>
          Payer ${this.formatPrice(this.total)}
        </button>
      </div>
    `;
  }

  renderDeliverySection() {
    const methods = this.getAvailableDeliveryMethods();
    const methodOptions = methods.length > 0
      ? methods.map(m => this.renderDeliveryMethodRadio(m)).join('')
      : `<div style="color:#8B7E6B;font-size:0.9rem;">Aucune méthode de livraison disponible pour le moment.</div>`;
    const savedAddresses = this.getSavedDeliveryAddresses();
    const defaultAddress = this.getDefaultDeliveryAddress();
    const savedAddressOptions = savedAddresses.map((address) => `
      <option value="${this.escapeAttribute(address.id || '')}" ${address.id === defaultAddress?.id ? 'selected' : ''}>
        ${this.escapeHtml(this.formatSavedAddress(address))}
      </option>
    `).join('');
    
    return `
      <div class="delivery-section-${this.uniqueId}" style="
        margin-top: 1.5rem;
        padding: 1.25rem;
        background: rgba(198, 167, 94, 0.08);
        border: 1px solid rgba(198, 167, 94, 0.2);
        border-radius: 1rem;
      ">
        <h3 style="
          font-family: 'Cormorant Garamond', serif;
          font-size: 1.35rem;
          margin-bottom: 0.75rem;
          color: #1F1E1C;
        ">
          Choisir une méthode de livraison
        </h3>
        <div class="delivery-methods" style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-bottom:1rem;">
          ${methodOptions}
        </div>
        
        <div class="delivery-panels">
          <div class="delivery-panel" data-delivery-panel="home" style="display:none;">
            <div style="display:grid;gap:0.75rem;">
              ${savedAddresses.length ? `
                <div>
                  <label style="font-size:0.9rem;color:#8B7E6B;">Adresse enregistree</label>
                  <select class="delivery-saved-address" style="
                    width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
                  ">
                    <option value="">Ajouter une nouvelle adresse</option>
                    ${savedAddressOptions}
                  </select>
                </div>
              ` : ''}
              <label style="font-size:0.9rem;color:#8B7E6B;">Ville / Zone</label>
              <select class="delivery-home-zone" style="
                padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
              ">
                ${this.renderSelectOptions(this.deliveryData.homeZones, 'Aucune zone disponible')}
              </select>
              
              <label style="font-size:0.9rem;color:#8B7E6B;">Adresse</label>
              <input type="text" class="delivery-home-address" placeholder="Adresse complète" style="
                padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
              ">

              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                <div>
                  <label style="font-size:0.9rem;color:#8B7E6B;">Departement</label>
                  <select class="delivery-home-department" style="width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;">
                    ${this.renderDepartmentOptions(this.selectedDelivery.home.department)}
                  </select>
                </div>
                <div>
                  <label style="font-size:0.9rem;color:#8B7E6B;">Commune</label>
                  <select class="delivery-home-commune" style="width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;">
                    ${this.renderCommuneOptions(this.selectedDelivery.home.department, this.selectedDelivery.home.commune)}
                  </select>
                </div>
              </div>
              
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
                <div>
                  <label style="font-size:0.9rem;color:#8B7E6B;">Téléphone</label>
                  <input type="text" class="delivery-home-phone" placeholder="Ex: 37 00 00 00" style="
                    width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
                  ">
                </div>
                <div>
                  <label style="font-size:0.9rem;color:#8B7E6B;">WhatsApp</label>
                  <input type="text" class="delivery-home-whatsapp" placeholder="Ex: 37 00 00 00" style="
                    width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
                  ">
                </div>
              </div>
            </div>
          </div>
          
          <div class="delivery-panel" data-delivery-panel="pickup" style="display:none;">
            <label style="font-size:0.9rem;color:#8B7E6B;">Point de retrait</label>
            <select class="delivery-pickup-point" style="
              width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
            ">
              ${this.renderSelectOptions(this.deliveryData.pickupPoints, 'Aucun point disponible')}
            </select>
            <div class="pickup-details" style="margin-top:0.75rem;font-size:0.9rem;color:#8B7E6B;"></div>
          </div>
          
          <div class="delivery-panel" data-delivery-panel="meetup" style="display:none;">
            <label style="font-size:0.9rem;color:#8B7E6B;">Zone de rencontre</label>
            <select class="delivery-meetup-zone" style="
              width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
            ">
              ${this.renderSelectOptions(this.deliveryData.meetupZones, 'Aucune zone disponible')}
            </select>
            
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;margin-top:0.75rem;">
              <div>
                <label style="font-size:0.9rem;color:#8B7E6B;">Téléphone</label>
                <input type="text" class="delivery-meetup-phone" placeholder="Ex: 37 00 00 00" style="
                  width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
                ">
              </div>
              <div>
                <label style="font-size:0.9rem;color:#8B7E6B;">WhatsApp</label>
                <input type="text" class="delivery-meetup-whatsapp" placeholder="Ex: 37 00 00 00" style="
                  width:100%;padding:0.75rem;border:1px solid rgba(198,167,94,0.3);border-radius:0.5rem;background:white;
                ">
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  getAvailableDeliveryMethods() {
    const defaults = { home: true, pickup: true, meetup: true };
    const settings = this.deliverySettings?.methodsVisible || defaults;
    const methods = [];
    if (settings.home) methods.push({ key: 'home', label: 'A domicile', icon: 'fa-house' });
    if (!this.hasVendorItems() && settings.pickup) methods.push({ key: 'pickup', label: 'Retrait en point de vente', icon: 'fa-store' });
    if (!this.hasVendorItems() && settings.meetup) methods.push({ key: 'meetup', label: 'Par rencontre', icon: 'fa-people-arrows' });
    return methods;
  }

  renderDeliveryMethodRadio(method) {
    const id = `${this.uniqueId}_delivery_${method.key}`;
    return `
      <label for="${id}" style="
        display:flex;align-items:center;gap:0.5rem;
        padding:0.6rem 0.9rem;border:1px solid rgba(198,167,94,0.3);
        border-radius:999px;background:white;cursor:pointer;font-size:0.9rem;color:#1F1E1C;
      ">
        <input type="radio" id="${id}" name="delivery_method_${this.uniqueId}" value="${method.key}" style="accent-color:#C6A75E;">
        <i class="fas ${method.icon}" style="color:#C6A75E;"></i>
        ${method.label}
      </label>
    `;
  }

  renderSelectOptions(items, emptyLabel) {
    if (!items || items.length === 0) {
      return `<option value="">${emptyLabel}</option>`;
    }
    const options = items.map(item => {
      const label = item.displayLabel || item.label || item.name || item.zone || item.city || 'Option';
      const fee = Number(item.fee || 0);
      const feeText = fee > 0 ? ` • ${this.formatPrice(fee)}` : '';
      return `<option value="${item.id}">${label}${feeText}</option>`;
    });
    return `<option value="">Sélectionner...</option>${options.join('')}`;
  }

  renderDepartmentOptions(selected = '') {
    return '<option value="">Choisir un departement...</option>' + Object.keys(HAITI_DEPARTMENTS)
      .map((department) => `<option value="${department}" ${department === selected ? 'selected' : ''}>${department}</option>`)
      .join('');
  }

  renderCommuneOptions(department = '', selected = '') {
    const communes = HAITI_DEPARTMENTS[department] || [];
    return '<option value="">Choisir une commune...</option>' + communes
      .map((commune) => `<option value="${commune}" ${commune === selected ? 'selected' : ''}>${commune}</option>`)
      .join('');
  }
  
  renderDesktopRow(item, index) {
    const options = getCustomerVisibleOptions(item.selectedOptions || []);
    const imagePath = this.getImagePath(item.image || '');
    const itemTotal = (item.price || 0) * (item.quantity || 1);
    const deliveryLabel = this.getCartItemDeliveryLabel(item);
    
    return `
      <tr data-index="${index}">
        <td style="min-width: 200px;">
          <div style="display: flex; gap: 1rem; align-items: center;">
            <div style="
              width: 60px;
              height: 60px;
              background: #F5F1E8;
              border-radius: 0.5rem;
              overflow: hidden;
              border: 1px solid rgba(198, 167, 94, 0.2);
            ">
              <img src="${imagePath}" alt="${item.name}" style="
                width: 100%;
                height: 100%;
                object-fit: cover;
              " onerror="this.src=''; this.parentElement.innerHTML='<div style=\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#8B7E6B;\'><i class=\'fas fa-image\'></i></div>'">
            </div>
            <div>
              <div style="font-weight: 500;">${item.name || 'Produit'}</div>
              ${item.sku ? `<div style="font-size: 0.7rem; color: #8B7E6B;">SKU: ${item.sku}</div>` : ''}
              ${deliveryLabel ? `<div data-item-delivery-label="${index}" style="font-size:0.74rem;color:${deliveryLabel.includes('indisponible') ? '#B91C1C' : '#2E5D3A'};margin-top:.25rem;">${deliveryLabel}</div>` : ''}
            </div>
          </div>
        </td>
        
        <td>
          ${options.length > 0 ? options.map(opt => `
            <div style="
              display: inline-flex;
              align-items: center;
              gap: 0.25rem;
              background: rgba(198, 167, 94, 0.1);
              padding: 0.2rem 0.5rem;
              border-radius: 2rem;
              font-size: 0.8rem;
              margin-right: 0.25rem;
              margin-bottom: 0.25rem;
            ">
              ${opt.image ? `
                <img src="${this.getImagePath(opt.image)}" 
                     style="width: 16px; height: 16px; border-radius: 50%; object-fit: cover;"
                     onerror="this.style.display='none'">
              ` : ''}
              <span>${opt.value}</span>
            </div>
          `).join('') : '-'}
        </td>
        
        <td>${this.formatPrice(item.price || 0)}</td>
        
        <td>
          <span style="min-width: 30px; text-align: center;">${item.quantity}</span>
        </td>
        
        <td style="font-weight: 600;">${this.formatPrice(itemTotal)}</td>
      </tr>
    `;
  }
  
  renderMobileCard(item, index) {
    const options = getCustomerVisibleOptions(item.selectedOptions || []);
    const imagePath = this.getImagePath(item.image || '');
    const itemTotal = (item.price || 0) * (item.quantity || 1);
    const deliveryLabel = this.getCartItemDeliveryLabel(item);
    
    return `
      <div class="checkout-mobile-item" data-index="${index}" style="
        background: white;
        border-radius: 1rem;
        padding: 1rem;
        border: 1px solid rgba(198, 167, 94, 0.2);
      ">
        <div class="mobile-product-row">
          <div style="
            width: 80px;
            height: 80px;
            background: #F5F1E8;
            border-radius: 0.5rem;
            overflow: hidden;
            border: 1px solid rgba(198, 167, 94, 0.2);
          ">
            <img src="${imagePath}" alt="${item.name}" style="
              width: 100%;
              height: 100%;
              object-fit: cover;
            " onerror="this.src=''; this.parentElement.innerHTML='<div style=\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#8B7E6B;\'><i class=\'fas fa-image\'></i></div>'">
          </div>
          
          <div style="flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
              <div>
                <div style="font-weight: 600; margin-bottom: 0.25rem;">${item.name || 'Produit'}</div>
                ${item.sku ? `<div style="font-size: 0.7rem; color: #8B7E6B;">SKU: ${item.sku}</div>` : ''}
                ${deliveryLabel ? `<div data-item-delivery-label="${index}" style="font-size:0.74rem;color:${deliveryLabel.includes('indisponible') ? '#B91C1C' : '#2E5D3A'};margin-top:.25rem;">${deliveryLabel}</div>` : ''}
              </div>
            </div>
            
            ${options.length > 0 ? `
              <div style="
                display: flex;
                flex-wrap: wrap;
                gap: 0.25rem;
                margin: 0.5rem 0;
              ">
                ${options.map(opt => `
                  <span style="
                    display: inline-flex;
                    align-items: center;
                    gap: 0.25rem;
                    background: rgba(198, 167, 94, 0.1);
                    padding: 0.2rem 0.5rem;
                    border-radius: 2rem;
                    font-size: 0.75rem;
                  ">
                    ${opt.image ? `
                      <img src="${this.getImagePath(opt.image)}" 
                           style="width: 14px; height: 14px; border-radius: 50%; object-fit: cover;"
                           onerror="this.style.display='none'">
                    ` : ''}
                    <span>${opt.value}</span>
                  </span>
                `).join('')}
              </div>
            ` : ''}
            
            <div style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-top: 0.5rem;
            ">
              <div style="font-weight: bold;">${this.formatPrice(itemTotal)}</div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <span style="font-size: 0.9rem;">x${item.quantity}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async initDelivery() {
    try {
      await this.loadDeliverySettings();
      await this.loadDeliveryData();
      this.refreshDeliverySection();
      this.setDefaultDeliveryMethod();
      this.updateDeliveryCosts();
      this.updateTotalsUI();
    } catch (error) {
      console.error('❌ Erreur chargement livraison:', error);
    }
  }

  async loadDeliverySettings() {
    try {
      const settingsRef = doc(db, 'deliverySettings', 'main');
      const snapshot = await getDoc(settingsRef);
      if (snapshot.exists()) {
        this.deliverySettings = snapshot.data();
      } else {
        this.deliverySettings = {
          methodsVisible: { home: true, pickup: true, meetup: true },
          allowMeetupProposal: false
        };
      }
      this.deliverySettings.allowMeetupProposal = false;
    } catch (error) {
      console.error('❌ Erreur paramètres livraison:', error);
      this.deliverySettings = {
        methodsVisible: { home: true, pickup: true, meetup: true },
        allowMeetupProposal: false
      };
    }
  }

  async loadDeliveryData() {
    const loadCollection = async (name) => {
      try {
        const snapshot = await getDocs(collection(db, name));
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (error) {
        console.error(`❌ Erreur chargement ${name}:`, error);
        return [];
      }
    };
    
    const [homeZones, pickupPoints, meetupZones, weightRules] = await Promise.all([
      loadCollection('deliveryHomeZones'),
      loadCollection('deliveryPickupPoints'),
      loadCollection('deliveryMeetupZones'),
      loadCollection('deliveryWeightRules')
    ]);
    
    this.deliveryData.homeZones = homeZones
      .filter(zone => zone.isActive !== false)
      .map(zone => ({
        ...zone,
        displayLabel: zone.zone ? `${zone.city} - ${zone.zone}` : zone.city || zone.name
      }));
    this.deliveryData.pickupPoints = pickupPoints
      .filter(point => point.isActive !== false)
      .map(point => ({
        ...point,
        displayLabel: point.name || point.title || 'Point de retrait'
      }));
    this.deliveryData.meetupZones = meetupZones
      .filter(zone => zone.isActive !== false)
      .map(zone => ({
        ...zone,
        displayLabel: zone.zone || zone.name || 'Zone de rencontre'
      }));
    this.deliveryData.weightRules = weightRules
      .filter(rule => rule.isActive !== false)
      .map(rule => ({
        ...rule,
        minGrams: Number(rule.minGrams || 0),
        maxGrams: Number(rule.maxGrams || 0),
        fee: Number(rule.fee || 0)
      }))
      .sort((a, b) => a.minGrams - b.minGrams);
  }

  refreshDeliverySection() {
    const section = this.modal.querySelector('.delivery-section-' + this.uniqueId);
    if (!section) return;
    section.outerHTML = this.renderDeliverySection();
    this.bindDeliveryEvents();
    this.updateDeliveryPanels();
    this.updatePickupDetails();
    this.updateMeetupProposalVisibility();
  }

  setDefaultDeliveryMethod() {
    const methods = this.getAvailableDeliveryMethods();
    if (!methods.length) {
      this.selectedDelivery.method = null;
      return;
    }
    if (this.selectedDelivery.method && methods.find(m => m.key === this.selectedDelivery.method)) {
      return;
    }
    this.selectedDelivery.method = methods[0].key;
    const defaultRadio = this.modal.querySelector(`input[name="delivery_method_${this.uniqueId}"][value="${this.selectedDelivery.method}"]`);
    if (defaultRadio) {
      defaultRadio.checked = true;
    }
    this.updateDeliveryPanels();
  }

  applySavedDeliveryAddress(addressId) {
    const savedAddress = this.getSavedDeliveryAddresses().find((address) => address.id === addressId);
    this.selectedDelivery.home.savedAddressId = addressId || '';
    if (!savedAddress) return;

    this.selectedDelivery.home.address = savedAddress.address || '';
    this.selectedDelivery.home.country = savedAddress.country || 'Haiti';
    this.selectedDelivery.home.department = savedAddress.department || '';
    this.selectedDelivery.home.commune = savedAddress.commune || '';
    this.selectedDelivery.home.phone = this.client?.phone || this.selectedDelivery.home.phone || '';
    this.selectedDelivery.home.whatsapp = this.selectedDelivery.home.whatsapp || this.selectedDelivery.home.phone || '';

    const addressInput = this.modal.querySelector('.delivery-home-address');
    const departmentSelect = this.modal.querySelector('.delivery-home-department');
    const communeSelect = this.modal.querySelector('.delivery-home-commune');
    const phoneInput = this.modal.querySelector('.delivery-home-phone');
    const whatsappInput = this.modal.querySelector('.delivery-home-whatsapp');
    if (addressInput) addressInput.value = this.selectedDelivery.home.address;
    if (departmentSelect) departmentSelect.value = this.selectedDelivery.home.department;
    if (communeSelect) {
      communeSelect.innerHTML = this.renderCommuneOptions(this.selectedDelivery.home.department, this.selectedDelivery.home.commune);
      communeSelect.value = this.selectedDelivery.home.commune;
    }
    if (phoneInput) phoneInput.value = this.selectedDelivery.home.phone;
    if (whatsappInput) whatsappInput.value = this.selectedDelivery.home.whatsapp;
  }

  bindDeliveryEvents() {
    const methodRadios = this.modal.querySelectorAll(`input[name="delivery_method_${this.uniqueId}"]`);
    methodRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        this.selectedDelivery.method = radio.value;
        this.updateDeliveryPanels();
        this.updateDeliveryCosts();
        this.updateTotalsUI();
      });
    });
    
    const homeSelect = this.modal.querySelector('.delivery-home-zone');
    if (homeSelect) {
      homeSelect.addEventListener('change', () => {
        this.selectedDelivery.home.zoneId = homeSelect.value;
        this.updateDeliveryCosts();
        this.updateTotalsUI();
      });
    }

    const savedAddressSelect = this.modal.querySelector('.delivery-saved-address');
    if (savedAddressSelect) {
      if (savedAddressSelect.value && !this.selectedDelivery.home.savedAddressId) {
        this.applySavedDeliveryAddress(savedAddressSelect.value);
      }
      savedAddressSelect.addEventListener('change', () => {
        this.applySavedDeliveryAddress(savedAddressSelect.value);
      });
    }
    
    const pickupSelect = this.modal.querySelector('.delivery-pickup-point');
    if (pickupSelect) {
      pickupSelect.addEventListener('change', () => {
        this.selectedDelivery.pickup.pointId = pickupSelect.value;
        this.updatePickupDetails();
        this.updateDeliveryCosts();
        this.updateTotalsUI();
      });
    }
    
    const meetupSelect = this.modal.querySelector('.delivery-meetup-zone');
    if (meetupSelect) {
      meetupSelect.addEventListener('change', () => {
        this.selectedDelivery.meetup.zoneId = meetupSelect.value;
        this.updateDeliveryCosts();
        this.updateTotalsUI();
      });
    }
    
    const addressInput = this.modal.querySelector('.delivery-home-address');
    if (addressInput) {
      addressInput.addEventListener('input', () => {
        this.selectedDelivery.home.address = addressInput.value;
        this.selectedDelivery.home.savedAddressId = '';
      });
    }

    const departmentSelect = this.modal.querySelector('.delivery-home-department');
    const communeSelect = this.modal.querySelector('.delivery-home-commune');
    if (departmentSelect && communeSelect) {
      departmentSelect.addEventListener('change', () => {
        this.selectedDelivery.home.department = departmentSelect.value;
        this.selectedDelivery.home.commune = '';
        this.selectedDelivery.home.savedAddressId = '';
        communeSelect.innerHTML = this.renderCommuneOptions(departmentSelect.value);
      });
      communeSelect.addEventListener('change', () => {
        this.selectedDelivery.home.commune = communeSelect.value;
        this.selectedDelivery.home.savedAddressId = '';
      });
    }
    
    const homePhone = this.modal.querySelector('.delivery-home-phone');
    if (homePhone) {
      homePhone.addEventListener('input', () => {
        this.selectedDelivery.home.phone = homePhone.value;
      });
    }
    
    const homeWhatsapp = this.modal.querySelector('.delivery-home-whatsapp');
    if (homeWhatsapp) {
      homeWhatsapp.addEventListener('input', () => {
        this.selectedDelivery.home.whatsapp = homeWhatsapp.value;
      });
    }
    
    const meetupPhone = this.modal.querySelector('.delivery-meetup-phone');
    if (meetupPhone) {
      meetupPhone.addEventListener('input', () => {
        this.selectedDelivery.meetup.phone = meetupPhone.value;
      });
    }
    
    const meetupWhatsapp = this.modal.querySelector('.delivery-meetup-whatsapp');
    if (meetupWhatsapp) {
      meetupWhatsapp.addEventListener('input', () => {
        this.selectedDelivery.meetup.whatsapp = meetupWhatsapp.value;
      });
    }
    
    this.selectedDelivery.meetup.proposal = '';
  }

  updateDeliveryPanels() {
    const panels = this.modal.querySelectorAll('.delivery-panel');
    panels.forEach(panel => {
      const panelType = panel.getAttribute('data-delivery-panel');
      panel.style.display = panelType === this.selectedDelivery.method ? 'block' : 'none';
    });
    this.updateMeetupProposalVisibility();
  }

  updatePickupDetails() {
    const details = this.modal.querySelector('.pickup-details');
    if (!details) return;
    const point = this.deliveryData.pickupPoints.find(p => p.id === this.selectedDelivery.pickup.pointId);
    if (!point) {
      details.textContent = '';
      return;
    }
    const phone = point.phone ? ` • Tél: ${point.phone}` : '';
    const whatsapp = point.whatsapp ? ` • WhatsApp: ${point.whatsapp}` : '';
    details.textContent = `${point.address || ''}${phone}${whatsapp}`;
  }

  updateMeetupProposalVisibility() {
    const wrapper = this.modal.querySelector('.meetup-proposal-wrapper');
    if (!wrapper) return;
    wrapper.style.display = 'none';
  }

  updateDeliveryCosts() {
    let baseFee = 0;
    if (this.selectedDelivery.method === 'home') {
      const zone = this.deliveryData.homeZones.find(z => z.id === this.selectedDelivery.home.zoneId);
      baseFee = (this.hasSmartCutItems() ? Number(zone?.fee || 0) : 0) + this.getVendorDeliveryFee();
    } else if (this.selectedDelivery.method === 'pickup') {
      baseFee = 0;
    } else if (this.selectedDelivery.method === 'meetup') {
      const zone = this.deliveryData.meetupZones.find(z => z.id === this.selectedDelivery.meetup.zoneId);
      baseFee = Number(zone?.fee || 0);
    }
    
    const weightGrams = this.getCartWeight();
    const weightFee = this.getCartWeightFee();
    
    this.deliveryFees = {
      base: baseFee,
      weightExtra: weightFee,
      total: baseFee + weightFee
    };
    this.shipping = this.deliveryFees.total;
    this.calculateTotals();
    this.refreshCartDeliveryLabels();
  }

  refreshCartDeliveryLabels() {
    if (!this.modal) return;
    this.cart.forEach((item, index) => {
      const label = this.getCartItemDeliveryLabel(item);
      this.modal.querySelectorAll(`[data-item-delivery-label="${index}"]`).forEach((node) => {
        node.textContent = label;
        node.style.color = label.includes('indisponible') ? '#B91C1C' : '#2E5D3A';
      });
    });
  }

  getCartWeight() {
    return this.cart.reduce((sum, item) => {
      const weight = Number(item?.weightGrams || item?.weight || 0);
      return sum + (weight * (item.quantity || 1));
    }, 0);
  }

  getWeightFee(weightGrams) {
    if (!this.deliveryData.weightRules || this.deliveryData.weightRules.length === 0) return 0;
    const rule = this.deliveryData.weightRules.find(r => weightGrams >= r.minGrams && weightGrams <= r.maxGrams);
    return Number(rule?.fee || 0);
  }

  getCartWeightFee() {
    if (!Array.isArray(this.cart) || !this.cart.length) return 0;
    return this.cart.reduce((sum, item) => {
      const unitWeight = Number(item?.weightGrams || item?.weight || 0);
      const qty = Math.max(1, Number(item?.quantity) || 1);
      if (!Number.isFinite(unitWeight) || unitWeight <= 0) return sum;
      return sum + (this.getWeightFee(unitWeight) * qty);
    }, 0);
  }

  updateTotalsUI() {
    this.refreshPromoUI();
  }

  isValidPhone(value) {
    const digits = String(value || '').replace(/\D/g, '');
    return digits.length >= 8 && digits.length <= 15;
  }

  validateDelivery() {
    if (!this.selectedDelivery.method) {
      this.showMessage('Veuillez choisir une méthode de livraison', 'error');
      return false;
    }
    
    if (this.selectedDelivery.method === 'home') {
      if (this.hasSmartCutItems() && !this.selectedDelivery.home.zoneId) {
        this.showMessage('Veuillez sélectionner une ville ou zone', 'error');
        return false;
      }
      if (!this.selectedDelivery.home.address?.trim()) {
        this.showMessage('Veuillez saisir votre adresse', 'error');
        return false;
      }
      if (!this.selectedDelivery.home.department || !this.selectedDelivery.home.commune) {
        this.showMessage('Veuillez choisir votre departement et votre commune', 'error');
        return false;
      }
      const unavailableVendor = this.getVendorDeliveryGroups().find((group) => !this.findVendorDeliveryZone(group));
      if (unavailableVendor) {
        this.showMessage(`${unavailableVendor.productName} ne peut pas etre livre dans cette commune.`, 'error');
        return false;
      }
      if (!this.isValidPhone(this.selectedDelivery.home.phone)) {
        this.showMessage('Numéro de téléphone invalide', 'error');
        return false;
      }
      if (!this.isValidPhone(this.selectedDelivery.home.whatsapp)) {
        this.showMessage('Numéro WhatsApp invalide', 'error');
        return false;
      }
    }
    
    if (this.selectedDelivery.method === 'pickup') {
      if (!this.selectedDelivery.pickup.pointId) {
        this.showMessage('Veuillez sélectionner un point de retrait', 'error');
        return false;
      }
    }
    
    if (this.selectedDelivery.method === 'meetup') {
      if (!this.selectedDelivery.meetup.zoneId) {
        this.showMessage('Veuillez sélectionner une zone de rencontre', 'error');
        return false;
      }
      if (!this.isValidPhone(this.selectedDelivery.meetup.phone)) {
        this.showMessage('Numéro de téléphone invalide', 'error');
        return false;
      }
      if (!this.isValidPhone(this.selectedDelivery.meetup.whatsapp)) {
        this.showMessage('Numéro WhatsApp invalide', 'error');
        return false;
      }
    }
    
    return true;
  }

  async saveCheckoutDeliveryAddress() {
    if (this.selectedDelivery.method !== 'home' || this.selectedDelivery.home.savedAddressId) return;
    if (!this.client?.id || !db) return;

    const addressText = String(this.selectedDelivery.home.address || '').trim();
    if (!addressText) return;

    const existingAddresses = this.getSavedDeliveryAddresses();
    const alreadySaved = existingAddresses.some((address) => (
      String(address.address || '').trim().toLowerCase() === addressText.toLowerCase()
      && String(address.commune || '').trim().toLowerCase() === String(this.selectedDelivery.home.commune || '').trim().toLowerCase()
      && String(address.department || '').trim().toLowerCase() === String(this.selectedDelivery.home.department || '').trim().toLowerCase()
    ));
    if (alreadySaved) return;

    const newAddress = {
      id: 'addr_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      label: 'Adresse de livraison',
      address: addressText,
      country: this.selectedDelivery.home.country || 'Haiti',
      department: this.selectedDelivery.home.department || '',
      commune: this.selectedDelivery.home.commune || '',
      isDelivery: true,
      createdAt: new Date().toISOString()
    };
    const addresses = existingAddresses.concat(newAddress);
    this.client.addresses = addresses;
    this.client.defaultDeliveryAddressId = this.client.defaultDeliveryAddressId || newAddress.id;
    this.selectedDelivery.home.savedAddressId = newAddress.id;

    await setDoc(doc(db, 'clients', this.client.id), {
      addresses,
      defaultDeliveryAddressId: this.client.defaultDeliveryAddressId,
      address: newAddress.address,
      country: newAddress.country,
      department: newAddress.department,
      commune: newAddress.commune,
      city: newAddress.commune,
      updatedAt: new Date().toISOString()
    }, { merge: true });
  }
  
  getDeliveryPayload() {
    const homeZone = this.deliveryData.homeZones.find(z => z.id === this.selectedDelivery.home.zoneId);
    const pickupPoint = this.deliveryData.pickupPoints.find(p => p.id === this.selectedDelivery.pickup.pointId);
    const meetupZone = this.deliveryData.meetupZones.find(z => z.id === this.selectedDelivery.meetup.zoneId);
    const vendorDeliveryDetails = this.getVendorDeliveryGroups().map((group) => {
      const zone = this.findVendorDeliveryZone(group);
      return {
        vendorId: group.vendorId,
        vendorName: group.vendorName,
        productId: group.productId,
        productName: group.productName,
        quantity: group.quantity,
        zone: zone || null,
        fee: Number(zone?.fee || 0) * Math.max(1, Number(group.quantity) || 1),
        unitFee: Number(zone?.fee || 0)
      };
    });
    return {
      method: this.selectedDelivery.method,
      address: this.selectedDelivery.home.address || '',
      savedAddressId: this.selectedDelivery.home.savedAddressId || '',
      country: this.selectedDelivery.home.country || 'Haiti',
      department: this.selectedDelivery.home.department || '',
      commune: this.selectedDelivery.home.commune || '',
      phone: this.selectedDelivery.method === 'home' ? (this.selectedDelivery.home.phone || '') : (this.selectedDelivery.meetup.phone || ''),
      whatsapp: this.selectedDelivery.method === 'home' ? (this.selectedDelivery.home.whatsapp || '') : (this.selectedDelivery.meetup.whatsapp || ''),
      meetupProposal: this.selectedDelivery.meetup.proposal || '',
      homeZone: homeZone || null,
      pickupPoint: pickupPoint || null,
      meetupZone: meetupZone || null,
      vendorDeliveryDetails,
      weightGrams: this.getCartWeight(),
      baseFee: this.deliveryFees.base,
      weightFee: this.deliveryFees.weightExtra,
      totalFee: this.deliveryFees.total
    };
  }
  
  attachEvents() {
    const closeBtn = this.modal.querySelector('.close-checkout');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) {
        this.close();
      }
    });
    
    const applyPromo = this.modal.querySelector('.apply-promo');
    const promoInput = this.modal.querySelector('.promo-code');
    
    if (applyPromo && promoInput) {
      applyPromo.addEventListener('click', () => this.applyPromoCode(promoInput.value));
      promoInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          this.applyPromoCode(promoInput.value);
        }
      });
    }
    
    const payBtn = this.modal.querySelector('.pay-now-btn');
    if (payBtn) {
      payBtn.addEventListener('click', () => this.openPaymentModal());
    }
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });

    this.bindDeliveryEvents();
  }
  
  applyDiscount(percentage) {
    const discount = this.subtotal * percentage;
    this.subtotal -= discount;
    this.calculateTotals();
    
    const totalsDiv = this.modal.querySelector('[style*="max-width: 400px"]');
    if (totalsDiv) {
      const newTotals = `
        <div style="
          display: flex;
          justify-content: space-between;
          margin-bottom: 0.75rem;
          font-size: 1rem;
          color: #2E5D3A;
        ">
          <span>Réduction (10%)</span>
          <span>-${this.formatPrice(discount)}</span>
        </div>
        ${totalsDiv.innerHTML}
      `;
      totalsDiv.innerHTML = newTotals;
    }
  }
  
  showMessage(message, type = 'success') {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${type === 'success' ? '#2E5D3A' : '#7F1D1D'};
      color: white;
      padding: 1rem 2rem;
      border-radius: 50px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      z-index: 1000001;
      animation: slideInRight 0.3s ease;
      font-size: 0.95rem;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOutRight 0.3s ease';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  buildPromoFeedback() {
    if (!this.appliedPromo) return '';
    return `${this.appliedPromo.code || ''} - ${this.appliedPromo.label || 'Reduction appliquee'} (${this.formatPrice(this.appliedPromo.discountAmount || 0)})`;
  }

  refreshPromoUI() {
    this.calculateTotals();

    const feedback = this.modal?.querySelector('.promo-feedback');
    if (feedback) {
      feedback.style.display = this.appliedPromo ? 'block' : 'none';
      feedback.innerHTML = this.appliedPromo ? this.escapeHtml(this.buildPromoFeedback()) : '';
    }

    const discountRow = this.modal?.querySelector('.promo-discount-row');
    if (discountRow) {
      discountRow.style.display = this.discountAmount > 0 ? 'flex' : 'none';
      const amountEl = discountRow.querySelector('span:last-child');
      if (amountEl) amountEl.textContent = `- ${this.formatPrice(this.discountAmount)}`;
    }

    const totalEl = this.modal?.querySelector('[data-total-amount]');
    if (totalEl) totalEl.textContent = this.formatPrice(this.total);

    const shippingEl = this.modal?.querySelector('[data-shipping-amount]');
    if (shippingEl) {
      const baseFee = Number(this.deliveryFees.base || 0);
      const weightFee = Number(this.deliveryFees.weightExtra || 0);
      shippingEl.textContent = baseFee === 0 && weightFee === 0 ? 'Gratuite' : this.formatPrice(baseFee);
    }

    const weightRow = this.modal?.querySelector('[data-weight-row]');
    const weightFeeEl = this.modal?.querySelector('[data-weight-fee]');
    if (weightRow) weightRow.style.display = Number(this.deliveryFees.weightExtra || 0) > 0 ? 'flex' : 'none';
    if (weightFeeEl) weightFeeEl.textContent = this.formatPrice(Number(this.deliveryFees.weightExtra || 0));

    const payBtn = this.modal?.querySelector('.pay-now-btn');
    if (payBtn) {
      payBtn.innerHTML = `
        <i class="fas fa-lock" style="margin-right: 0.5rem;"></i>
        Payer ${this.formatPrice(this.total)}
      `;
    }
  }

  async applyPromoCode(code) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    console.log('[PROMO_DEBUG][CHECKOUT] apply:start', {
      enteredCode: code,
      normalizedCode,
      clientId: this.client?.id || '',
      clientUid: this.client?.uid || '',
      cartCount: Array.isArray(this.cart) ? this.cart.length : 0,
      cart: (Array.isArray(this.cart) ? this.cart : []).map((item) => ({
        productId: item?.productId || '',
        name: item?.name || '',
        price: Number(item?.price || 0),
        quantity: Number(item?.quantity || 0),
        categoryId: item?.categoryId || '',
        category: item?.category || '',
        sourceType: item?.sourceType || '',
        sourceCollection: item?.sourceCollection || '',
        vendorId: item?.vendorId || ''
      }))
    });

    if (!normalizedCode) {
      this.appliedPromo = null;
      this.refreshPromoUI();
      console.log('[PROMO_DEBUG][CHECKOUT] apply:cleared');
      this.showMessage('Code promo retire', 'success');
      return;
    }

    const applyBtn = this.modal?.querySelector('.apply-promo');
    if (applyBtn) {
      applyBtn.disabled = true;
      applyBtn.textContent = 'Verification...';
    }

    try {
      const { previewPromoCode } = await import('./promo-client.js?v=20260520-1');
      const response = await previewPromoCode({
        code: normalizedCode,
        clientId: this.client?.id || '',
        clientUid: this.client?.uid || '',
        items: this.cart
      });
      console.log('[PROMO_DEBUG][CHECKOUT] apply:success', response);

      this.appliedPromo = {
        code: response.code || normalizedCode,
        promoId: response.promoId || '',
        label: response.label || 'Reduction appliquee',
        discountAmount: Number(response.discountAmount || 0),
        discountedSubtotal: Number(response.discountedSubtotal || 0),
        eligibleSubtotal: Number(response.eligibleSubtotal || 0),
        type: response.type || '',
        value: Number(response.value || 0),
        categoryIds: Array.isArray(response.categoryIds) ? response.categoryIds : [],
        affiliateEnabled: Boolean(response.affiliateEnabled),
        affiliateMemberId: response.affiliateMemberId || '',
        affiliateMemberName: response.affiliateMemberName || '',
        affiliatePhone: response.affiliatePhone || ''
      };
      this.refreshPromoUI();
      this.showMessage(response.message || 'Code promo applique', 'success');
    } catch (error) {
      console.error('[PROMO_DEBUG][CHECKOUT] apply:error', {
        message: error?.message || '',
        stack: error?.stack || ''
      });
      this.appliedPromo = null;
      this.refreshPromoUI();
      this.showMessage(error?.message || 'Code promo invalide', 'error');
    } finally {
      if (applyBtn) {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Appliquer';
      }
    }
  }
  
  async openPaymentModal() {
    try {
      if (!this.client || !this.client.id) {
        this.showMessage('Client non disponible. Veuillez vous reconnecter.', 'error');
        return;
      }
      if (!this.validateDelivery()) {
        return;
      }
      await this.saveCheckoutDeliveryAddress();
      const module = await import('./payment.js?v=20260520-1');
      const PaymentModal = module.default;
      
      await this.close();
      
      this.paymentModal = new PaymentModal({
        amount: this.total,
        client: this.client,
        cart: this.cart,
        delivery: this.getDeliveryPayload(),
        promo: this.appliedPromo,
        onClose: () => {
          this.paymentModal = null;
        },
        onSuccess: (orderData) => {
          
          localStorage.removeItem('veltrixa_cart');
          
          const event = new CustomEvent('cartUpdated', { detail: { count: 0 } });
          document.dispatchEvent(event);
          
          if (this.options.onSuccess) {
            this.options.onSuccess(orderData);
          }
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur ouverture payment modal:', error);
      this.showMessage('Erreur lors de l\'ouverture du paiement', 'error');
    }
  }
  
  animateIn() {
    setTimeout(() => {
      this.modal.style.opacity = '1';
    }, 50);
  }
  
  animateOut() {
    return new Promise(resolve => {
      this.modal.style.opacity = '0';
      const container = this.modal.querySelector('.checkout-container-' + this.uniqueId);
      if (container) {
        container.style.transform = 'scale(0.95)';
      }
      setTimeout(resolve, 300);
    });
  }
  
  async close() {
    await this.animateOut();
    this.modal.remove();
    document.body.style.overflow = '';
    
    if (this.options.onClose) {
      this.options.onClose();
    }
  }
}

export default CheckoutModal;
