// ============= CART COMPONENT - GESTIONNAIRE DE PANIER AVEC THÃˆME =============
import { auth, authReadyPromise, db } from './firebase-init.js?v=20260523-6';
import { getAuthManager } from './auth.js?v=20260523-6';
import { getLikeManager } from './like.js';
import theme from './theme-root.js';
import { resolveMediaUrl } from './media-utils.js';
import { downloadOrderPdfReceipt } from './order-pdf.js';
import { signInAnonymously } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import { 
  collection, query, getDocs, orderBy, onSnapshot, doc, updateDoc, getDoc, setDoc, addDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class CartManager {
  constructor(options = {}) {
    this.options = {
      storageKey: 'veltrixa_cart',
      currency: 'HTG',
      imageBasePath: './',
      ...options
    };
    
    this.cart = [];
    this.orders = [];
    this.uniqueId = 'cart_' + Math.random().toString(36).substr(2, 9);
    this.modal = null;
    this.updateTimeout = null;
    this.ordersListener = null;
    this.countdownIntervals = new Map();
    this.auth = null;
    this.currentClient = null;
    this.isInitialized = false;
    this.ordersVisible = false;
    this.pdfConfig = null;
    this.theme = theme;
    this.hiddenOrderIds = new Set();
    this.likeManager = null;
    this.likesVisible = true;
    this.likedPreviewModal = null;
    this.guestClient = null;
    this.preloadPromise = null;
    this.modalOpenedAt = 0;
    
    
    // S'abonner aux changements de thÃ¨me
    this.unsubscribeTheme = this.theme.subscribe((newTheme) => {
      if (this.modal) {
        this.renderCartModal();
      }
    });
    
    try {
      this.auth = getAuthManager({
        onAuthChange: (user) => this.handleAuthChange(user)
      });
    } catch (error) {
      console.error('âŒ Erreur initialisation auth:', error);
    }

    try {
      this.likeManager = getLikeManager();
      document.addEventListener('likesUpdated', () => {
        if (this.modal) this.renderCartModal();
      });
    } catch (error) {
      console.error('âŒ Erreur initialisation LikeManager:', error);
    }
    
    this.loadCart();
    this.loadPdfConfig();
    this.setupEventListeners();
    
    this.isInitialized = true;
  }
  
  // Obtenir les couleurs du thÃ¨me
  getThemeColors() {
    const colors = this.theme.getColors();
    return {
      text: {
        title: colors?.text?.title || '#1F1E1C',
        subtitle: colors?.text?.subtitle || '#7A746B',
        body: colors?.text?.body || '#4A4A4A',
        button: colors?.text?.button || '#FFFFFF'
      },
      background: {
        general: colors?.background?.general || '#FFFFFF',
        card: colors?.background?.card || '#F5F5F5',
        button: colors?.background?.button || '#C6A75E'
      },
      icon: {
        standard: colors?.icon?.standard || '#1F1E1C',
        hover: colors?.icon?.hover || '#C6A75E'
      }
    };
  }
  
  // Obtenir les polices du thÃ¨me
  getThemeFonts() {
    const fonts = this.theme.getFonts();
    const typography = this.theme.getTypography();
    return {
      primary: typography?.family || fonts?.primary || "'Cormorant Garamond', serif",
      secondary: fonts?.secondary || "'Manrope', sans-serif"
    };
  }

  getGuestStorageKey() {
    return 'smartcut_guest_client_id';
  }

  createGuestClientPayload(guestId) {
    const now = new Date().toISOString();
    return {
      id: guestId,
      uid: guestId,
      name: 'Client invité',
      email: '',
      phone: '',
      address: '',
      city: '',
      role: 'guest',
      isGuest: true,
      createdAt: now,
      updatedAt: now
    };
  }

  async getOrCreateGuestClient() {
    if (this.guestClient?.id) return this.guestClient;

    await authReadyPromise.catch(() => {});

    const signedUser = this.auth?.getCurrentUser?.() || auth?.currentUser || null;
    if (signedUser?.uid && !signedUser.isAnonymous) {
      console.warn('[CART] Session invite ignoree: utilisateur connecte detecte', {
        uid: signedUser.uid,
        email: signedUser.email || null
      });
      if (!this.currentClient || this.currentClient.id !== signedUser.uid) {
        await this.loadOrCreateClient(signedUser);
      }
      return this.currentClient;
    }

    let guestUser = signedUser?.isAnonymous ? signedUser : null;
    if (!guestUser?.uid) {
      const credential = await signInAnonymously(auth);
      guestUser = credential?.user || auth?.currentUser || null;
    }

    if (!guestUser?.uid) {
      throw new Error('Impossible d\'initialiser la session invite');
    }

    const guestId = guestUser.uid;
    const clientRef = doc(db, 'clients', guestId);
    const snapshot = await getDoc(clientRef);
    const payload = this.createGuestClientPayload(guestId);

    if (!snapshot.exists()) {
      await setDoc(clientRef, payload, { merge: true });
      this.guestClient = payload;
    } else {
      const existing = snapshot.data() || {};
      const mergedPayload = {
        ...payload,
        ...existing,
        id: guestId,
        uid: guestId,
        role: existing.role || 'guest',
        isGuest: existing.isGuest ?? true,
        updatedAt: payload.updatedAt
      };
      await setDoc(clientRef, mergedPayload, { merge: true });
      this.guestClient = mergedPayload;
    }

    localStorage.setItem(this.getGuestStorageKey(), guestId);
    console.info('[CART] Session invite resolue', {
      guestId,
      isAnonymous: Boolean(guestUser?.isAnonymous)
    });
    return this.guestClient;
  }

  showCheckoutChoice() {
    const existing = document.querySelector('.checkout-choice-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'checkout-choice-overlay';
    overlay.style.cssText = `
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.42);
      backdrop-filter: blur(8px);
      z-index: 1000002;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    `;

    overlay.innerHTML = `
      <div style="
        width:min(100%, 480px);
        background:#F5F1E8;
        border-radius:1.5rem;
        border:1px solid rgba(198,167,94,0.2);
        box-shadow:0 25px 50px rgba(0,0,0,0.18);
        padding:1.4rem;
        display:grid;
        gap:1rem;
      ">
        <div style="display:flex;justify-content:space-between;gap:1rem;align-items:start;">
          <div>
            <div style="color:#C6A75E;font-size:.76rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;">Commande</div>
            <h3 style="font-family:'Cormorant Garamond',serif;font-size:2rem;line-height:.95;color:#1F1E1C;margin-top:.35rem;">Comment voulez-vous continuer ?</h3>
          </div>
          <button class="close-choice" style="background:none;border:none;font-size:1.2rem;color:#8B7E6B;cursor:pointer;">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <p style="color:#6E6557;line-height:1.8;">Vous pouvez vous connecter pour retrouver vos commandes plus tard, ou continuer comme invité pour commander immédiatement.</p>
        <div style="display:grid;gap:.75rem;">
          <button class="choice-login" style="border:none;border-radius:999px;background:#1F1E1C;color:#F5F1E8;padding:1rem 1.2rem;font-weight:800;cursor:pointer;">Se connecter / S'inscrire</button>
          <button class="choice-guest" style="border:1px solid rgba(31,30,28,0.12);border-radius:999px;background:#fff;color:#1F1E1C;padding:1rem 1.2rem;font-weight:800;cursor:pointer;">Continuer comme invité</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('.close-choice')?.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });
    overlay.querySelector('.choice-login')?.addEventListener('click', () => {
      close();
      this.closeCartModal();
      this.auth?.openAuthModal?.('login');
    });
    overlay.querySelector('.choice-guest')?.addEventListener('click', async () => {
      close();
      this.closeCartModal();
      await this.openCheckout({ cart: this.cart, total: this.getTotalPrice(), mode: 'guest' });
    });
  }
  
  async loadPdfConfig() {
    try {
      const snapshot = await getDocs(collection(db, 'pdfConfig'));
      if (!snapshot.empty) {
        this.pdfConfig = snapshot.docs[0].data();
      } else {
        this.pdfConfig = {
      companyName: 'Smart Cut Services',
          companyLogo: '',
          companyAddress: '',
          companyPhone: '',
          companyEmail: '',
          thankYouMessage: 'Merci pour votre confiance !',
          primaryColor: '#C6A75E',
          showQrCode: true
        };
      }
    } catch (error) {
      console.error('âŒ Erreur chargement config PDF:', error);
    }
  }
  
  loadCart() {
    try {
      const savedCart = localStorage.getItem(this.options.storageKey);
      this.cart = savedCart ? JSON.parse(savedCart) : [];
    } catch (error) {
      console.error('âŒ Erreur chargement panier:', error);
      this.cart = [];
    }
  }
  
  async handleAuthChange(user) {
    console.info('[CART] handleAuthChange', {
      version: '20260523-6',
      isAuthenticated: Boolean(user),
      uid: user?.uid || null,
      isAnonymous: Boolean(user?.isAnonymous),
      authManagerReady: this.auth?.isAuthReady ?? null,
      authManagerUid: this.auth?.getCurrentUser?.()?.uid || null,
      firebaseUid: auth?.currentUser?.uid || null,
      currentClientId: this.currentClient?.id || null,
      ordersListenerActive: Boolean(this.ordersListener)
    });
    
    if (user) {
      await this.loadOrCreateClient(user);
      if (this.currentClient) {
        console.info('[CART] Client pret apres auth', {
          clientId: this.currentClient.id,
          email: this.currentClient.email || null
        });
        this.loadCustomerOrders(this.currentClient.id);
      }
    } else {
      console.info('[CART] handleAuthChange:null-user cleanup', {
        authManagerReady: this.auth?.isAuthReady ?? null,
        firebaseUid: auth?.currentUser?.uid || null,
        hadCurrentClient: Boolean(this.currentClient?.id),
        ordersBeforeCleanup: this.orders.length
      });
      if (this.ordersListener) {
        this.ordersListener();
        this.ordersListener = null;
      }
      
      for (const interval of this.countdownIntervals.values()) {
        clearInterval(interval);
      }
      this.countdownIntervals.clear();
      
      this.orders = [];
      this.currentClient = null;
      this.ordersVisible = false;
      this.hiddenOrderIds = new Set();
      
      if (this.modal) {
        this.renderCartModal();
      }
    }
  }
  
  async loadOrCreateClient(user) {
    if (!db) {
      console.error('âŒ Base de donnÃ©es non initialisÃ©e');
      return;
    }
    
    try {
      console.info('[CART] loadOrCreateClient:start', {
        uid: user?.uid || null,
        email: user?.email || null
      });
      const clientRef = doc(db, 'clients', user.uid);
      const snapshot = await getDoc(clientRef);
      const now = new Date().toISOString();
      console.info('[CART] loadOrCreateClient:snapshot', {
        uid: user.uid,
        exists: snapshot.exists()
      });

      if (!snapshot.exists()) {
        const clientData = {
          uid: user.uid,
          name: user.displayName || '',
          email: user.email || '',
          phone: '',
          address: '',
          city: '',
          role: user.isAnonymous ? 'guest' : 'client',
          isGuest: Boolean(user.isAnonymous),
          createdAt: now,
          updatedAt: now
        };

        await setDoc(clientRef, clientData, { merge: true });
        this.currentClient = { id: user.uid, ...clientData };
        console.info('[CART] Client cree en base', {
          clientId: this.currentClient.id,
          email: this.currentClient.email || null
        });
      } else {
        const existing = snapshot.data() || {};
        const mergedData = {
          ...existing,
          uid: user.uid,
          name: existing.name || user.displayName || '',
          email: existing.email || user.email || '',
          phone: existing.phone || '',
          address: existing.address || '',
          city: existing.city || '',
          role: existing.role || (user.isAnonymous ? 'guest' : 'client'),
          isGuest: existing.isGuest ?? Boolean(user.isAnonymous),
          createdAt: existing.createdAt || now,
          updatedAt: now
        };

        await setDoc(clientRef, mergedData, { merge: true });
        this.currentClient = { id: user.uid, ...mergedData };
        console.info('[CART] Client charge depuis base', {
          clientId: this.currentClient.id,
          email: this.currentClient.email || null
        });
      }

      this.loadHiddenOrders();
      
      const event = new CustomEvent('clientReady', { 
        detail: { client: this.currentClient }
      });
      document.dispatchEvent(event);
      
    } catch (error) {
      console.error('âŒ Erreur lors de la gestion du client:', error);
      this.currentClient = {
        id: user.uid,
        uid: user.uid,
        name: user.displayName || '',
        email: user.email || '',
        phone: '',
        address: '',
        city: ''
      };
      const event = new CustomEvent('clientReady', {
        detail: { client: this.currentClient }
      });
      document.dispatchEvent(event);
      console.info('[CART] Fallback client local active', {
        clientId: this.currentClient.id,
        uid: this.currentClient.uid,
        email: this.currentClient.email || null
      });
    }
  }
  
  async loadCustomerOrders(clientId) {
    if (!db || !clientId) {
      console.error('âŒ DB ou clientId manquant');
      return;
    }
    
    try {
      
      if (this.ordersListener) {
        this.ordersListener();
      }
      
      const ordersRef = collection(db, 'clients', clientId, 'orders');
      const q = query(ordersRef, orderBy('createdAt', 'desc'));
      
      this.ordersListener = onSnapshot(q, (snapshot) => {
        this.orders = snapshot.docs.map(doc => {
          const data = doc.data() || {};
          const fallbackExpiresAt = data.expiresAt || (
            data.createdAt
              ? new Date(this.getDateMs(data.createdAt) + (12 * 60 * 60 * 1000)).toISOString()
              : null
          );
          return {
            id: doc.id,
            ...data,
            expiresAt: fallbackExpiresAt,
            timeLeft: this.calculateTimeLeft(fallbackExpiresAt)
          };
        });
        
        
        this.orders.forEach(order => {
          if (order.status === 'pending' || order.status === 'review') {
            this.startOrderCountdown(order.id, order.expiresAt);
          }
        });
        
        this.emitOrdersUpdate();
        
        if (this.modal) {
          this.renderCartModal();
        }
      }, (error) => {
        console.error('âŒ Erreur listener commandes:', error);
      });
      
    } catch (error) {
      console.error('âŒ Erreur chargement commandes:', error);
    }
  }

  warmUpClientContext() {
    if (this.preloadPromise) return this.preloadPromise;

    this.preloadPromise = (async () => {
      if (typeof this.auth?.waitForAuthReady === 'function') {
        await this.auth.waitForAuthReady();
      } else {
        await authReadyPromise.catch(() => {});
      }

      if (this.auth?.isAuthenticated?.()) {
        const user = this.auth?.getCurrentUser?.();
        if (user && !this.currentClient) {
          await this.loadOrCreateClient(user);
        }
        if (this.currentClient?.id && !this.ordersListener) {
          await this.loadCustomerOrders(this.currentClient.id);
        }
      } else {
        const guestId = this.guestClient?.id || this.getStoredGuestId?.();
        if (guestId) {
          if (!this.guestClient || this.guestClient.id !== guestId) {
            this.guestClient = this.createGuestClientPayload(guestId);
          }
          this.currentClient = this.guestClient;
          this.loadHiddenOrders();
          if (!this.ordersListener && !this.orders.length) {
            await this.loadCustomerOrders(guestId);
          }
        }
      }
    })()
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
  
  calculateTimeLeft(expiresAt) {
    const expiry = this.getDateMs(expiresAt);
    if (!expiry) return 0;
    const now = Date.now();
    const diff = expiry - now;
    return Number.isFinite(diff) && diff > 0 ? diff : 0;
  }

  getDateMs(value) {
    if (!value) return 0;

    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    if (value instanceof Date) {
      const ms = value.getTime();
      return Number.isFinite(ms) ? ms : 0;
    }

    if (typeof value?.toDate === 'function') {
      const ms = value.toDate().getTime();
      return Number.isFinite(ms) ? ms : 0;
    }

    if (typeof value === 'object' && Number.isFinite(value.seconds)) {
      const nanos = Number.isFinite(value.nanoseconds) ? value.nanoseconds : 0;
      return (value.seconds * 1000) + Math.floor(nanos / 1e6);
    }

    return 0;
  }
  
  formatTimeLeft(ms) {
    if (ms <= 0) return 'Expiré';

    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    const hh = String(hours).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  
  startOrderCountdown(orderId, expiresAt) {
    if (this.countdownIntervals.has(orderId)) {
      clearInterval(this.countdownIntervals.get(orderId));
    }
    
    const interval = setInterval(() => {
      const order = this.orders.find(o => o.id === orderId);
      if (!order) {
        clearInterval(interval);
        this.countdownIntervals.delete(orderId);
        return;
      }
      
      const timeLeft = this.calculateTimeLeft(order.expiresAt || expiresAt);
      
      if (timeLeft <= 0) {
        clearInterval(interval);
        this.countdownIntervals.delete(orderId);
        order.status = 'expired';
        order.timeLeft = 0;
        
        this.updateOrderStatus(orderId, 'expired');
      } else {
        order.timeLeft = timeLeft;
      }
      
      if (this.modal) {
        const timerElement = this.modal.querySelector(`.order-timer-${orderId}`);
        if (timerElement) {
          timerElement.textContent = this.formatTimeLeft(timeLeft);
          
          if (timeLeft < 5 * 60 * 1000) {
            timerElement.style.color = '#EF4444';
          } else if (timeLeft < 30 * 60 * 1000) {
            timerElement.style.color = '#F59E0B';
          } else {
            timerElement.style.color = '#10B981';
          }
        }
      }
    }, 1000);
    
    this.countdownIntervals.set(orderId, interval);
  }
  
  async updateOrderStatus(orderId, status) {
    if (!this.currentClient) return;
    
    try {
      const orderRef = doc(db, 'clients', this.currentClient.id, 'orders', orderId);
      await updateDoc(orderRef, {
        status,
        updatedAt: new Date().toISOString()
      });
    } catch (error) {
      console.error('âŒ Erreur mise Ã  jour statut:', error);
    }
  }
  
  generateUniqueCode() {
    return `SCS-${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
  }
  
  emitOrdersUpdate() {
    const event = new CustomEvent('ordersUpdated', { 
      detail: {
        orders: this.orders,
        count: this.orders.length,
        pending: this.orders.filter(o => o.status === 'pending').length,
        review: this.orders.filter(o => o.status === 'review').length,
        approved: this.orders.filter(o => o.status === 'approved' || o.status === 'paid').length,
        rejected: this.orders.filter(o => o.status === 'rejected').length
      }
    });
    document.dispatchEvent(event);
  }

  getHiddenOrdersKey() {
    const clientId = this.currentClient?.id || 'guest';
    return `veltrixa_hidden_orders_${clientId}`;
  }

  loadHiddenOrders() {
    try {
      const raw = localStorage.getItem(this.getHiddenOrdersKey());
      const list = raw ? JSON.parse(raw) : [];
      this.hiddenOrderIds = new Set(Array.isArray(list) ? list.map(String) : []);
    } catch (error) {
      console.error('âŒ Erreur chargement commandes masquÃ©es:', error);
      this.hiddenOrderIds = new Set();
    }
  }

  saveHiddenOrders() {
    try {
      localStorage.setItem(this.getHiddenOrdersKey(), JSON.stringify(Array.from(this.hiddenOrderIds)));
    } catch (error) {
      console.error('âŒ Erreur sauvegarde commandes masquÃ©es:', error);
    }
  }

  isOrderHidden(orderId) {
    return this.hiddenOrderIds.has(String(orderId));
  }

  hideOrderFromClient(orderId) {
    const order = this.orders.find((o) => o.id === orderId);
    if (!order || (!['approved', 'paid', 'rejected'].includes(order.status))) {
      this.showNotification('Seules les commandes approuvées ou rejetées peuvent être masquées', 'error');
      return;
    }

    const warningMessage = ['approved', 'paid'].includes(order.status)
      ? (
        'Attention: si vous supprimez cette commande sans télécharger le PDF, vous pouvez perdre le colis.\n\n' +
        'Téléchargez d abord le reçu PDF avec votre code de retrait.\n\n' +
        'Voulez-vous masquer cette commande sur votre site ?'
      )
      : 'Voulez-vous masquer cette commande rejetée sur votre site ?';
    const warning = confirm(warningMessage);
    if (!warning) return;

    this.hiddenOrderIds.add(String(orderId));
    this.saveHiddenOrders();
    this.showNotification('Commande masquée sur votre site (non supprimée en base)', 'success');

    if (this.modal) {
      this.renderCartModal();
    }
  }
  
  saveCart() {
    try {
      localStorage.setItem(this.options.storageKey, JSON.stringify(this.cart));
      this.emitUpdate();
    } catch (error) {
      console.error('âŒ Erreur sauvegarde panier:', error);
    }
  }
  
  emitUpdate() {
    if (this.updateTimeout) {
      cancelAnimationFrame(this.updateTimeout);
    }
    
    this.updateTimeout = requestAnimationFrame(() => {
      const count = this.getTotalItems();
      const total = this.getTotalPrice();
      console.info('[CART] Emission cartUpdated', {
        items: this.cart.length,
        count,
        total
      });
      const event = new CustomEvent('cartUpdated', { 
        detail: {
          cart: this.cart,
          count,
          total
        }
      });
      document.dispatchEvent(event);
      this.updateTimeout = null;
    });
  }
  
  setupEventListeners() {
    document.addEventListener('addToCart', (e) => {
      this.addItem(e.detail);
    });
    
    document.addEventListener('openCart', () => {
      this.openCartModal();
    });
    
    document.addEventListener('openCheckout', (e) => {
      this.openCheckout(e.detail);
    });

    document.addEventListener('checkoutCartSynced', (e) => {
      if (!Array.isArray(e?.detail?.cart)) return;
      this.cart = e.detail.cart;
      if (this.modal) {
        this.renderCartModal();
      }
      this.emitUpdate();
    });

    document.addEventListener('orderSaved', (e) => {
      const order = e?.detail?.order;
      const clientId = e?.detail?.clientId;
      if (!order || !clientId) return;
      if (this.currentClient?.id && clientId === this.currentClient.id) {
        if (!this.orders.find(o => o.uniqueCode === order.uniqueCode)) {
          this.orders.unshift({ id: e?.detail?.id || order.id || `local_${Date.now()}`, ...order });
        }
        this.loadCustomerOrders(this.currentClient.id);
        if (this.modal) {
          this.renderCartModal();
        }
      }
    });
  }
  
  async openCheckout(cartData) {
    let checkoutClient = null;
    const isGuestMode = cartData?.mode === 'guest';
    console.info('[CART] openCheckout:start', {
      mode: cartData?.mode || 'authenticated',
      cartItems: (cartData?.cart || this.cart || []).length,
      currentClientId: this.currentClient?.id || null,
      isAuthenticated: Boolean(this.auth?.isAuthenticated?.())
    });

    if (isGuestMode) {
      checkoutClient = await this.getOrCreateGuestClient();
    } else {
      if (!this.auth || !this.auth.isAuthenticated()) {
        console.warn('[CART] openCheckout: auth requise, ouverture du choix checkout');
        this.showCheckoutChoice();
        return;
      }

      const user = this.auth?.getCurrentUser?.();
      if (!this.currentClient && user) {
        console.info('[CART] openCheckout: loadOrCreateClient avant checkout', { uid: user.uid });
        await this.loadOrCreateClient(user);
      }
      checkoutClient = this.currentClient;
    }

    if (!checkoutClient) {
      console.error('[CART] openCheckout: aucun client resolu', {
        mode: cartData?.mode || 'authenticated',
        currentClient: this.currentClient || null
      });
      this.showNotification('Impossible de charger le client. Réessayez.');
      return;
    }
    console.info('[CART] openCheckout: client resolu', {
      clientId: checkoutClient.id || null,
      uid: checkoutClient.uid || null,
      email: checkoutClient.email || null
    });
    
    try {
      const module = await import('./checkout.js?v=20260525-1');
      const CheckoutModal = module.default;
      
      if (this.modal) {
        this.closeCartModal();
      }
      
      
      new CheckoutModal({
        cart: cartData?.cart || this.cart,
        client: checkoutClient,
        onClose: () => {
        },
        onSuccess: async (orderData) => {

          this.cart = [];
          this.saveCart();
          
          this.showNotification('Commande soumise avec succès !');
          if (window.veltrixaNotificationCenter?.promptOrderNotificationChoice) {
            setTimeout(() => {
              window.veltrixaNotificationCenter.promptOrderNotificationChoice();
            }, 300);
          }
        }
      });
    } catch (error) {
      console.error('âŒ Erreur ouverture checkout:', error);
    }
  }
  
  async saveOrder(orderData) {
    if (!this.currentClient || !this.auth) {
      console.error('âŒ Client ou auth non disponible');
      return;
    }
    
    try {
      const user = this.auth.getCurrentUser();
      if (!user) {
        console.error('âŒ Utilisateur non connectÃ©');
        return;
      }
      
      const normalizedItems = this.cart.map(item => ({
        productId: item?.productId || '',
        name: item?.name || 'Produit',
        price: Number(item?.price) || 0,
        quantity: Number(item?.quantity) || 1,
        sku: item?.sku || '',
        image: item?.image || '',
        selectedOptions: Array.isArray(item?.selectedOptions) ? item.selectedOptions : [],
        vendorId: item?.vendorId || '',
        vendorName: item?.vendorName || '',
        weightGrams: Math.max(0, Number(item?.weightGrams || item?.weight || 0)),
        productDeliveryCoverage: item?.productDeliveryCoverage || item?.deliveryCoverage || null,
        productDeliveryZones: Array.isArray(item?.productDeliveryZones) ? item.productDeliveryZones : (Array.isArray(item?.deliveryZones) ? item.deliveryZones : []),
        vendorDeliveryCoverage: item?.vendorDeliveryCoverage || null,
        vendorDeliveryZones: Array.isArray(item?.vendorDeliveryZones) ? item.vendorDeliveryZones : [],
        commissionRule: item?.commissionRule || null,
        sourceType: item?.sourceType || '',
        category: item?.category || '',
        deliveryMode: item?.deliveryMode || '',
        isDigitalProduct: Boolean(item?.isDigitalProduct),
        digitalDownloadLink: item?.digitalDownloadLink || '',
        deliveryDelay: item?.deliveryDelay || ''
      }));
      const computedAmount = normalizedItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const customerFirstName = String(this.currentClient.firstName || '').trim();
      const customerLastName = String(this.currentClient.lastName || '').trim();
      const customerFullName = `${customerFirstName} ${customerLastName}`.trim()
        || this.currentClient.name
        || orderData.customerName
        || '';

      const order = {
        clientId: this.currentClient.id,
        clientUid: user.uid,
        customerFirstName,
        customerLastName,
        customerName: customerFullName,
        customerUsername: this.currentClient.username || this.currentClient.displayName || user.displayName || '',
        customerEmail: this.currentClient.email || orderData.customerEmail || '',
        customerPhone: orderData.customerPhone || this.currentClient.phone || '',
        customerAddress: orderData.customerAddress || this.currentClient.address || '',
        customerCity: orderData.customerCity || this.currentClient.city || '',
        amount: Number(orderData.amount) || computedAmount,
        methodId: orderData.methodId || '',
        methodName: orderData.methodName || '',
        items: normalizedItems,
        status: 'pending',
        fulfillmentStatus: 'ordered',
        uniqueCode: this.generateUniqueCode(),
        extractedText: orderData.extractedText || '',
        proofName: orderData.proofName || '',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        fulfillmentUpdatedAt: new Date().toISOString()
      };
      
      
      const ordersRef = collection(db, 'clients', this.currentClient.id, 'orders');
      const docRef = await addDoc(ordersRef, order);
      
      const event = new CustomEvent('orderCreated', { detail: { id: docRef.id, ...order } });
      document.dispatchEvent(event);
      
      return docRef.id;
      
    } catch (error) {
      console.error('âŒ Erreur sauvegarde commande:', error);
      throw error;
    }
  }
  
  hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : { r: 198, g: 167, b: 94 };
  }
  
  async generateOrderPdf(orderId) {
    try {
      const order = this.orders.find(o => o.id === orderId);
      if (!order) {
        this.showNotification('Commande non trouvée', 'error');
        return;
      }
      
      if (!['approved', 'paid'].includes(order.status)) {
        this.showNotification('Cette commande n\'est pas encore approuvée', 'warning');
        return;
      }
      
      if (typeof window.jspdf === 'undefined') {
        this.showNotification('Bibliothèque PDF non chargée', 'error');
        return;
      }
      
      this.showNotification('Génération du PDF en cours...', 'info');
      
      this.showNotification('Generation du PDF en cours...', 'info');
      await downloadOrderPdfReceipt(
        {
          ...order,
          items: this.getOrderItems(order),
          amount: this.getOrderAmount(order)
        },
        {
          companyName: this.pdfConfig?.companyName || 'Smart Cut Services',
          companyAddress: this.pdfConfig?.companyAddress || 'smartcutservices.com',
          thankYouMessage: this.pdfConfig?.thankYouMessage || 'Merci pour votre confiance !',
          primaryColor: this.hexToRgb(this.getThemeColors().background.button || '#C6A75E')
        }
      );
      this.showNotification('PDF telecharge avec succes !', 'success');
      setTimeout(() => {
        this.showNotification('Conservez ce PDF precieusement : il contient votre code unique.', 'warning');
      }, 1000);
      return;

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF();
      const orderItems = this.getOrderItems(order);
      const formatItemOptions = (item) => {
        const opts = item?.selectedOptions;
        if (!Array.isArray(opts) || opts.length === 0) return '-';
        return opts.map((opt) => {
          if (typeof opt === 'string') return opt;
          if (opt && typeof opt === 'object') {
            const key = opt.name || opt.label || opt.key || opt.type || 'Option';
            const val = opt.value || opt.val || opt.option || '';
            return val ? `${key}: ${val}` : key;
          }
          return String(opt);
        }).join(' | ');
      };
      
      const colors = this.getThemeColors();
      const primaryColor = colors.background.button || '#C6A75E';
      const rgb = this.hexToRgb(primaryColor);
      
      doc.setFillColor(rgb.r, rgb.g, rgb.b);
      doc.rect(0, 0, doc.internal.pageSize.width, 40, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(20);
      doc.setFont('helvetica', 'bold');
      doc.text(this.pdfConfig?.companyName || 'Smart Cut Services', 20, 25);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(this.pdfConfig?.companyAddress || '', 20, 35);
      
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text('RECU DE PAIEMENT', 20, 60);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Date: ${new Date(order.createdAt).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      })}`, 20, 70);
      
      doc.setDrawColor(rgb.r, rgb.g, rgb.b);
      doc.setLineWidth(0.5);
      doc.roundedRect(20, 80, 170, 15, 3, 3, 'S');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(order.uniqueCode || 'N/A', 105, 90, { align: 'center' });
      
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Informations client', 20, 110);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Nom: ${order.customerName || this.currentClient?.name || 'N/A'}`, 20, 120);
      doc.text(`Email: ${order.customerEmail || this.currentClient?.email || '-'}`, 20, 130);
      doc.text(`Telephone: ${order.customerPhone || this.currentClient?.phone || '-'}`, 20, 140);
      doc.text(`Adresse: ${order.customerAddress || this.currentClient?.address || '-'}`, 20, 150);
      doc.text(`Ville: ${order.customerCity || this.currentClient?.city || '-'}`, 20, 160);

      const delivery = order.delivery || null;
      if (delivery) {
        const deliveryLabel = 'Livraison a domicile';
        const deliveryTarget =
          delivery.homeZone?.city ||
          delivery.homeZone?.zone ||
          delivery.commune ||
          delivery.department ||
          delivery.address ||
          '';

        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.text('Livraison', 20, 174);

        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Methode: ${deliveryLabel}`, 20, 184);
        if (deliveryTarget) {
          doc.text(`Zone/Point: ${deliveryTarget}`.slice(0, 110), 20, 192);
        }
        if (delivery.address) {
          doc.text(`Adresse: ${delivery.address}`.slice(0, 110), 20, 200);
        }
        if (delivery.phone || delivery.whatsapp) {
          const contact = [delivery.phone ? `Tel: ${delivery.phone}` : '', delivery.whatsapp ? `WA: ${delivery.whatsapp}` : ''].filter(Boolean).join(' | ');
          doc.text(contact.slice(0, 110), 20, 208);
        }
        if (delivery.meetupProposal) {
          doc.text(`Proposition: ${delivery.meetupProposal}`.slice(0, 110), 20, 216);
        }
        if (Number(delivery.totalFee || 0) > 0) {
          doc.text(`Frais livraison: ${this.formatPrice(delivery.totalFee)}`, 20, 224);
        }
      }
      
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Paiement', 20, delivery ? 236 : 176);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Methode: ${order.methodName || 'N/A'}`, 20, delivery ? 246 : 186);
      
      doc.setFontSize(14);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(rgb.r, rgb.g, rgb.b);
      doc.text(`Montant: ${this.formatPrice(this.getOrderAmount(order))}`, 20, delivery ? 260 : 200);

      let y = delivery ? 272 : 212;
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('Produits commandes', 20, y);
      y += 7;

      if (orderItems.length === 0) {
        doc.setFontSize(9);
        doc.setFont('helvetica', 'normal');
        doc.text('Aucun detail produit enregistre.', 20, y);
        y += 6;
      } else {
        orderItems.forEach((item, index) => {
          if (y > 262) {
            doc.addPage();
            y = 20;
          }

          const qty = Number(item?.quantity) || 1;
          const unitPrice = Number(item?.price) || 0;
          const lineTotal = qty * unitPrice;
          const itemName = String(item?.name || 'Produit').slice(0, 70);
          const productId = item?.productId ? ` | ID: ${item.productId}` : '';
          const sku = item?.sku ? ` | SKU: ${item.sku}` : '';
          const options = formatItemOptions(item);

          doc.setFontSize(9);
          doc.setFont('helvetica', 'bold');
          doc.text(`${index + 1}. ${itemName}`, 20, y);
          y += 4.5;

          doc.setFont('helvetica', 'normal');
          doc.text(
            `Qte: ${qty} | PU: ${this.formatPrice(unitPrice)} | Total: ${this.formatPrice(lineTotal)}${productId}${sku}`.slice(0, 110),
            24,
            y
          );
          y += 4.2;

          if (options && options !== '-') {
            doc.text(`Options: ${options}`.slice(0, 110), 24, y);
            y += 4.2;
          }
          y += 1.8;
        });
      }

      if (y > 252) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Preuve de paiement', 20, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.text(`Nom sur la preuve: ${order.proofName || '-'}`, 20, y);
      y += 5;
      y += 8;

      doc.setTextColor(100, 100, 100);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.text(this.pdfConfig?.thankYouMessage || 'Merci pour votre confiance !', 20, Math.min(y, 270));
      
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text('Ce document est un recu officiel de paiement.', 20, 280);
      doc.text(`Code de verification: ${order.uniqueCode || 'N/A'}`, 20, 285);
      
      doc.save(`recu-${order.uniqueCode || order.id}.pdf`);
      
      this.showNotification('PDF téléchargé avec succès !', 'success');
      
      setTimeout(() => {
        this.showNotification('Conservez ce PDF précieusement - il contient votre code unique !', 'warning');
      }, 1000);
      
    } catch (error) {
      console.error('âŒ Erreur gÃ©nÃ©ration PDF:', error);
      this.showNotification('Erreur lors de la génération du PDF', 'error');
    }
  }
  
  async downloadOrderPdf(orderId) {
    try {
      const order = this.orders.find(o => o.id === orderId);
      if (!order) {
        this.showNotification('Commande non trouvée', 'error');
        return;
      }
      
      if (!['approved', 'paid'].includes(order.status)) {
        this.showNotification('Cette commande n\'est pas encore approuvée', 'warning');
        return;
      }
      
      const confirmDownload = confirm(
        'IMPORTANT\n\n' +
        'Ce PDF contient un code unique qui vous permettra de récupérer votre commande.\n\n' +
        'Conservez-le précieusement.\n' +
        'Il sera demandé lors du retrait/livraison.\n' +
        'Ne le partagez pas avec des inconnus.\n\n' +
        'Voulez-vous télécharger votre reçu ?'
      );
      
      if (!confirmDownload) return;
      
      await this.generateOrderPdf(orderId);
      
    } catch (error) {
      console.error('âŒ Erreur tÃ©lÃ©chargement PDF:', error);
      this.showNotification('Erreur lors du téléchargement', 'error');
    }
  }
  
  getImagePath(filename) {
    return resolveMediaUrl(filename, this.options.imageBasePath);
  }

  getOptionsSignature(options) {
    if (!Array.isArray(options) || options.length === 0) return '';
    return options
      .map((opt) => {
        if (typeof opt === 'string') return `s:${opt}`;
        if (opt && typeof opt === 'object') {
          const type = String(opt.type || opt.name || opt.key || '');
          const value = String(opt.value || opt.val || opt.option || '');
          const variationIndex = String(opt.variationIndex ?? '');
          return `o:${type}:${value}:${variationIndex}`;
        }
        return `x:${String(opt)}`;
      })
      .sort()
      .join('|');
  }

  getCartItemKey(item) {
    const productId = String(item?.productId || '');
    const signature = this.getOptionsSignature(item?.selectedOptions);
    return `${productId}::${signature}`;
  }

  getItemStockLimit(item) {
    if (item?.isDigitalProduct) return Infinity;
    const parsed = Number(item?.stockLimit);
    if (!Number.isFinite(parsed) || parsed < 0) return Infinity;
    return Math.max(0, Math.floor(parsed));
  }
  
  addItem(item) {
    if (!item || !item.productId) {
      console.error('âŒ Article invalide', item);
      return;
    }
    
    item = {
      ...item,
      sourceType: String(item?.sourceType || (item?.vendorId ? 'vendor' : 'smartcut')).trim(),
      sourceCollection: String(item?.sourceCollection || (item?.vendorId ? 'vendorProducts' : 'products')).trim(),
      categoryId: String(item?.categoryId || '').trim(),
      category: String(item?.category || '').trim(),
      productDeliveryCoverage: item?.productDeliveryCoverage || item?.deliveryCoverage || null,
      productDeliveryZones: Array.isArray(item?.productDeliveryZones)
        ? item.productDeliveryZones
        : (Array.isArray(item?.deliveryZones) ? item.deliveryZones : []),
      vendorDeliveryCoverage: item?.vendorDeliveryCoverage || item?.productDeliveryCoverage || item?.deliveryCoverage || null,
      vendorDeliveryZones: Array.isArray(item?.vendorDeliveryZones)
        ? item.vendorDeliveryZones
        : (Array.isArray(item?.productDeliveryZones)
          ? item.productDeliveryZones
          : (Array.isArray(item?.deliveryZones) ? item.deliveryZones : [])),
      isDigitalProduct: Boolean(item?.isDigitalProduct),
      digitalDownloadLink: String(item?.digitalDownloadLink || '').trim(),
      deliveryDelay: String(item?.deliveryDelay || '').trim()
    };

    const itemKey = this.getCartItemKey(item);
    const existingIndex = this.cart.findIndex(cartItem => this.getCartItemKey(cartItem) === itemKey);
    const incomingQty = Math.max(0, Number(item.quantity) || 1);
    const stockLimit = this.getItemStockLimit(item);
    
    if (existingIndex >= 0) {
      const currentQty = Math.max(0, Number(this.cart[existingIndex].quantity) || 0);
      const nextQty = Number.isFinite(stockLimit)
        ? Math.min(stockLimit, currentQty + incomingQty)
        : currentQty + incomingQty;

      if (nextQty <= currentQty) {
        this.showNotification(`Stock maximum atteint pour ${this.cart[existingIndex].name}`, 'warning');
        return;
      }

      this.cart[existingIndex].quantity = nextQty;
      this.cart[existingIndex].stockLimit = Number.isFinite(stockLimit) ? stockLimit : this.cart[existingIndex].stockLimit;
      if (item.weightGrams && !this.cart[existingIndex].weightGrams) {
        this.cart[existingIndex].weightGrams = item.weightGrams;
      }
      if (!this.cart[existingIndex].sourceCollection && item.sourceCollection) {
        this.cart[existingIndex].sourceCollection = item.sourceCollection;
      }
      if (!this.cart[existingIndex].sourceType && item.sourceType) {
        this.cart[existingIndex].sourceType = item.sourceType;
      }
      if (!this.cart[existingIndex].categoryId && item.categoryId) {
        this.cart[existingIndex].categoryId = item.categoryId;
      }
      if (!this.cart[existingIndex].category && item.category) {
        this.cart[existingIndex].category = item.category;
      }
      if (!this.cart[existingIndex].productDeliveryCoverage && item.productDeliveryCoverage) {
        this.cart[existingIndex].productDeliveryCoverage = item.productDeliveryCoverage;
      }
      if ((!this.cart[existingIndex].productDeliveryZones || !this.cart[existingIndex].productDeliveryZones.length) && item.productDeliveryZones?.length) {
        this.cart[existingIndex].productDeliveryZones = item.productDeliveryZones;
      }
      if (!this.cart[existingIndex].vendorDeliveryCoverage && item.vendorDeliveryCoverage) {
        this.cart[existingIndex].vendorDeliveryCoverage = item.vendorDeliveryCoverage;
      }
      if ((!this.cart[existingIndex].vendorDeliveryZones || !this.cart[existingIndex].vendorDeliveryZones.length) && item.vendorDeliveryZones?.length) {
        this.cart[existingIndex].vendorDeliveryZones = item.vendorDeliveryZones;
      }
      this.showNotification(
        nextQty < currentQty + incomingQty
          ? `Stock limité à ${nextQty} pour ${this.cart[existingIndex].name}`
          : `Quantité mise à jour: ${this.cart[existingIndex].name}`
      );
    } else {
      const initialQty = Number.isFinite(stockLimit) ? Math.min(stockLimit, incomingQty) : incomingQty;
      if (initialQty <= 0) {
        this.showNotification(`Stock indisponible pour ${item.name || 'ce produit'}`, 'warning');
        return;
      }
      this.cart.push({
        ...item,
        quantity: initialQty,
        addedAt: Date.now()
      });
      this.showNotification(
        initialQty < incomingQty
          ? `${item.name || 'Produit'} limité à ${initialQty} unité(s)`
          : `${item.name || 'Produit'} ajouté au panier`
      );
    }
    
    this.saveCart();
  }
  
  removeItem(index) {
    if (index >= 0 && index < this.cart.length) {
      const item = this.cart[index];
      this.cart.splice(index, 1);
      this.saveCart();
      this.showNotification(`${item.name || 'Article'} supprimé du panier`, 'info');
      if (this.modal) {
        this.renderCartModal();
      }
    }
  }
  
  updateQuantity(index, quantity) {
    if (index >= 0 && index < this.cart.length) {
      if (quantity <= 0) {
        this.removeItem(index);
      } else {
        const stockLimit = this.getItemStockLimit(this.cart[index]);
        const safeQuantity = Number.isFinite(stockLimit)
          ? Math.min(stockLimit, quantity)
          : quantity;
        if (safeQuantity < quantity) {
          this.showNotification(`Stock maximum atteint pour ${this.cart[index].name}`, 'warning');
        }
        this.cart[index].quantity = safeQuantity;
        this.saveCart();
        if (this.modal) {
          this.renderCartModal();
        }
      }
    }
  }
  
  clearCart() {
    if (this.cart.length === 0) return;
    
    if (confirm('Vider le panier ?')) {
      this.cart = [];
      this.saveCart();
      this.showNotification('Panier vidé', 'info');
      if (this.modal) {
        this.renderCartModal();
      }
    }
  }
  
  getTotalItems() {
    return this.cart.reduce((total, item) => total + (item.quantity || 1), 0);
  }
  
  getTotalPrice() {
    return this.cart.reduce((total, item) => total + ((item.price || 0) * (item.quantity || 1)), 0);
  }

  getOrderAmount(order) {
    const amount = Number(order?.amount);
    if (Number.isFinite(amount) && amount > 0) return amount;
    const items = this.getOrderItems(order);
    return items.reduce((sum, item) => {
      const price = Number(item?.price) || 0;
      const quantity = Number(item?.quantity) || 1;
      return sum + (price * quantity);
    }, 0);
  }

  getOrderItems(order) {
    if (!order || typeof order !== 'object') return [];
    const source = Array.isArray(order.items)
      ? order.items
      : Array.isArray(order.cart)
        ? order.cart
        : Array.isArray(order.products)
          ? order.products
          : [];

    return source.map((item) => ({
      productId: item?.productId || item?.id || '',
      name: item?.name || item?.productName || item?.title || 'Produit',
      price: Number(item?.price ?? item?.unitPrice ?? item?.amount) || 0,
      quantity: Number(item?.quantity ?? item?.qty ?? item?.qte) || 1,
      sku: item?.sku || item?.reference || '',
      image: item?.image || item?.imageUrl || '',
        vendorId: item?.vendorId || '',
        vendorName: item?.vendorName || '',
        weightGrams: Math.max(0, Number(item?.weightGrams || item?.weight || 0)),
        productDeliveryCoverage: item?.productDeliveryCoverage || item?.deliveryCoverage || null,
        productDeliveryZones: Array.isArray(item?.productDeliveryZones)
          ? item.productDeliveryZones
          : (Array.isArray(item?.deliveryZones) ? item.deliveryZones : []),
        vendorDeliveryCoverage: item?.vendorDeliveryCoverage || null,
        vendorDeliveryZones: Array.isArray(item?.vendorDeliveryZones) ? item.vendorDeliveryZones : [],
        commissionRule: item?.commissionRule || null,
      sourceType: item?.sourceType || '',
      category: item?.category || '',
      deliveryMode: item?.deliveryMode || '',
      isDigitalProduct: Boolean(item?.isDigitalProduct),
      digitalDownloadLink: item?.digitalDownloadLink || '',
      deliveryDelay: item?.deliveryDelay || '',
      selectedOptions: Array.isArray(item?.selectedOptions)
        ? item.selectedOptions
        : Array.isArray(item?.options)
          ? item.options
          : []
    }));
  }

  escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  
  formatPrice(price) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency', 
      currency: this.options.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(price || 0);
  }

  normalizeSelectedOptionLabel(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  isCustomerVisibleOption(option) {
    if (!option || typeof option === 'string') return true;
    const label = this.normalizeSelectedOptionLabel(option?.label || option?.name || option?.key || option?.type || '');
    return !['url fichier', 'lien fichier', 'chemin storage', 'storage path'].includes(label);
  }

  getCustomerVisibleOptions(options) {
    return (Array.isArray(options) ? options : []).filter((option) => this.isCustomerVisibleOption(option));
  }
  
  getStatusText(status) {
    const texts = {
      pending: 'En attente',
        review: 'En examen',
        paid: 'Paiement confirmé',
      approved: 'Approuvé',
      rejected: 'Rejeté',
      expired: 'Expiré'
    };
    return texts[status] || status;
  }
  
  getStatusColor(status) {
    const colors = {
      pending: '#F59E0B',
        review: '#3B82F6',
        paid: '#10B981',
      approved: '#10B981',
      rejected: '#EF4444',
      expired: '#6B7280'
    };
    return colors[status] || '#6B7280';
  }

  getFulfillmentStatusText(status) {
    const texts = {
      ordered: 'Commandé',
      shipped: 'Expédié',
      in_delivery: 'En cours de livraison',
      delivered: 'Livré'
    };
    return texts[status] || texts.ordered;
  }

  getFulfillmentStatusColor(status) {
    const colors = {
      ordered: '#C6A75E',
      shipped: '#3B82F6',
      in_delivery: '#F59E0B',
      delivered: '#10B981'
    };
    return colors[status] || colors.ordered;
  }

  getFulfillmentSteps() {
    return [
      { key: 'ordered', label: 'Commandé' },
      { key: 'shipped', label: 'Expédié' },
      { key: 'in_delivery', label: 'En cours de livraison' },
      { key: 'delivered', label: 'Livré' }
    ];
  }

  getNormalizedFulfillmentStatus(order) {
    return order?.fulfillmentStatus || 'ordered';
  }

  renderFulfillmentTracker(order, colors) {
    if (order.status === 'rejected' || order.status === 'expired') {
      return '';
    }

    const currentStatus = this.getNormalizedFulfillmentStatus(order);
    const steps = this.getFulfillmentSteps();
    const currentIndex = Math.max(steps.findIndex((step) => step.key === currentStatus), 0);
    const progressColor = this.getFulfillmentStatusColor(currentStatus);

    return `
      <div style="
        margin-top: 0.75rem;
        padding: 0.85rem;
        background: linear-gradient(180deg, ${colors.background.button}10, rgba(255,255,255,0.75));
        border: 1px solid ${colors.background.button}1F;
        border-radius: 0.75rem;
      ">
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.65rem;
        ">
          <span style="
            font-size: 0.75rem;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: ${colors.text.body};
          ">Suivi de commande</span>
          <span style="
            font-size: 0.78rem;
            font-weight: 600;
            color: ${progressColor};
          ">${this.getFulfillmentStatusText(currentStatus)}</span>
        </div>

        <div style="
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0.5rem;
          align-items: start;
        ">
          ${steps.map((step, index) => {
            const isDone = index <= currentIndex;
            const isCurrent = index === currentIndex;
            return `
              <div style="position: relative; text-align: center;">
                <div style="
                  height: 4px;
                  border-radius: 999px;
                  margin-bottom: 0.55rem;
                  background: ${index === 0 ? 'transparent' : (isDone ? progressColor : 'rgba(111, 103, 92, 0.16)')};
                  opacity: ${index === 0 ? '0' : '1'};
                "></div>
                <div style="
                  width: 0.9rem;
                  height: 0.9rem;
                  border-radius: 50%;
                  margin: -0.98rem auto 0.45rem;
                  border: 2px solid ${isDone ? progressColor : 'rgba(111, 103, 92, 0.22)'};
                  background: ${isDone ? progressColor : '#fff'};
                  box-shadow: ${isCurrent ? `0 0 0 4px ${progressColor}20` : 'none'};
                "></div>
                <span style="
                  display: block;
                  font-size: 0.72rem;
                  line-height: 1.35;
                  color: ${isCurrent ? colors.text.title : colors.text.body};
                  font-weight: ${isCurrent ? '700' : '500'};
                ">${step.label}</span>
              </div>
            `;
          }).join('')}
        </div>

        <p style="
          margin: 0.75rem 0 0;
          font-size: 0.78rem;
          color: ${colors.text.body};
          line-height: 1.5;
        ">
          ${['approved', 'paid'].includes(order.status)
            ? 'Paiement confirmé. Votre commande avance maintenant selon le suivi de livraison.'
            : order.status === 'pending' || order.status === 'review'
              ? 'Votre commande est bien enregistree. Le suivi de livraison se mettra a jour apres validation.'
              : 'Suivi disponible pour cette commande.'}
        </p>
      </div>
    `;
  }
  
  showNotification(message, type = 'success') {
    const existing = document.querySelector(`.cart-notification-${this.uniqueId}`);
    if (existing) {
      existing.remove();
    }

    const normalizedMessage = String(message || '')
      .replace(/^[^\p{L}\p{N}]+/u, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 110);

    const palette = {
      success: { accent: '#C6A75E', border: 'rgba(198, 167, 94, 0.32)' },
      warning: { accent: '#C88A2B', border: 'rgba(200, 138, 43, 0.28)' },
      error: { accent: '#B14B4B', border: 'rgba(177, 75, 75, 0.28)' },
      info: { accent: '#6F675C', border: 'rgba(111, 103, 92, 0.24)' }
    };

    const theme = palette[type] || palette.info;
    const notification = document.createElement('div');
    notification.className = `cart-notification-${this.uniqueId}`;
    notification.style.cssText = `
      position: fixed;
      left: 1rem;
      bottom: 1rem;
      width: min(320px, calc(100vw - 2rem));
      background: rgba(245, 241, 232, 0.98);
      color: #1F1E1C;
      border: 1px solid ${theme.border};
      border-left: 4px solid ${theme.accent};
      border-radius: 18px;
      box-shadow: 0 18px 40px rgba(0, 0, 0, 0.12);
      z-index: 999995;
      transform: translateY(24px);
      opacity: 0;
      transition: transform 0.22s ease, opacity 0.22s ease;
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 0.9rem 1rem;
      pointer-events: none;
      backdrop-filter: blur(10px);
    `;

    const icons = {
      success: 'fa-bag-shopping',
      warning: 'fa-circle-exclamation',
      error: 'fa-circle-xmark',
      info: 'fa-circle-info'
    };

    notification.innerHTML = `
      <div style="width: 2rem; height: 2rem; flex: 0 0 2rem; border-radius: 999px; background: ${theme.accent}16; color: ${theme.accent}; display: flex; align-items: center; justify-content: center; margin-top: 0.05rem;">
        <i class="fas ${icons[type] || 'fa-circle-info'}"></i>
      </div>
      <div style="min-width: 0; flex: 1;">
        <div style="font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: ${theme.accent}; font-weight: 800; margin-bottom: 0.22rem;">Panier</div>
        <div style="font-size: 0.92rem; line-height: 1.45; color: #1F1E1C; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
          ${normalizedMessage}
        </div>
      </div>
    `;

    document.body.appendChild(notification);

    requestAnimationFrame(() => {
      notification.style.transform = 'translateY(0)';
      notification.style.opacity = '1';
    });

    setTimeout(() => {
      notification.style.transform = 'translateY(16px)';
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 220);
    }, 2200);
  }
  
  toggleOrdersVisibility() {
    this.ordersVisible = !this.ordersVisible;
    if (this.modal) {
      this.renderCartModal();
    }
  }
  
  openCartModal() {
    if (this.modal) {
      return;
    }

    this.warmUpClientContext().catch((error) => {
      console.error('âŒ Erreur prechargement panier:', error);
    });
    
    this.modalOpenedAt = Date.now();
    this.modal = document.createElement('div');
    this.modal.className = `cart-modal-${this.uniqueId}`;
    this.renderCartModal();
    document.body.appendChild(this.modal);
    
    setTimeout(() => {
      const overlay = this.modal.querySelector('.cart-overlay');
      const container = this.modal.querySelector('.cart-container');
      if (overlay) overlay.style.opacity = '1';
      if (container) {
        container.style.opacity = '1';
        container.style.transform = 'translateX(0)';
      }
    }, 50);
    
    document.body.style.overflow = 'hidden';
  }
  
  closeCartModal() {
    if (!this.modal) return;
    
    const overlay = this.modal.querySelector('.cart-overlay');
    const container = this.modal.querySelector('.cart-container');
    
    if (overlay) overlay.style.opacity = '0';
    if (container) {
      container.style.opacity = '0';
      container.style.transform = 'translateX(100%)';
    }
    
    setTimeout(() => {
      if (this.modal) {
        this.modal.remove();
        this.modal = null;
      }
      document.body.style.overflow = '';
    }, 300);
  }
  
  renderCartModal() {
    if (!this.modal) return;
    
    const colors = this.getThemeColors();
    const fonts = this.getThemeFonts();
    
    const totalPrice = this.getTotalPrice();
    
    this.modal.innerHTML = `
      <div class="cart-overlay" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(5px);
        z-index: 999998;
        opacity: 0;
        transition: opacity 0.3s ease;
        cursor: pointer;
      "></div>
      
      <div class="cart-container" style="
        position: fixed;
        top: 0;
        right: 0;
        width: 100%;
        max-width: 450px;
        height: 100vh;
        background: ${colors.background.general};
        z-index: 999999;
        box-shadow: -10px 0 30px rgba(0, 0, 0, 0.1);
        transform: translateX(100%);
        opacity: 0;
        transition: transform 0.3s ease, opacity 0.3s ease;
        display: flex;
        flex-direction: column;
      ">
        <div style="
          padding: 1.5rem;
          border-bottom: 1px solid rgba(198, 167, 94, 0.2);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-shrink: 0;
          background: ${colors.background.general};
        ">
          <h2 style="
            font-family: ${fonts.primary};
            font-size: 1.5rem;
            color: ${colors.text.title};
            margin: 0;
            display: flex;
            align-items: center;
            gap: 0.65rem;
          ">
            <i class="fas fa-shopping-bag" style="color: ${colors.icon.hover};"></i>
            <span>Panier</span>
          </h2>
          
          <button class="close-cart-btn" style="
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: ${colors.text.body};
            transition: all 0.2s;
            padding: 0.5rem;
            width: 40px;
            height: 40px;
            display: flex;
            align-items: center;
            justify-content: center;
            border-radius: 50%;
          " onmouseover="this.style.background='${colors.icon.hover}20'; this.style.color='${colors.icon.hover}'" onmouseout="this.style.background='transparent'; this.style.color='${colors.text.body}'">
            <i class="fas fa-times"></i>
          </button>
        </div>
        
        <div style="flex: 1; overflow-y: auto; padding: 1.5rem;">
          ${this.renderCartSection(colors, fonts)}
        </div>
        
        ${this.cart.length > 0 ? `
          <div style="
            padding: 1.5rem;
            border-top: 1px solid rgba(198, 167, 94, 0.2);
            flex-shrink: 0;
            background: ${colors.background.general};
          ">
            <div style="
              display: flex;
              justify-content: space-between;
              margin-bottom: 1rem;
              font-size: 1.1rem;
              color: ${colors.text.title};
            ">
              <span>Sous-total</span>
              <span style="font-weight: bold;">${this.formatPrice(totalPrice)}</span>
            </div>
            
            <button class="checkout-btn" style="
              width: 100%;
              background: ${colors.background.button};
              color: ${colors.text.button};
              border: 1px solid ${colors.background.button};
              padding: 1rem;
              border-radius: 0.5rem;
              font-size: 1rem;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.3s;
              margin-bottom: 0.5rem;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 0.5rem;
            " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
              <i class="fas fa-lock"></i>
              Procéder au paiement
            </button>
            
            <button class="continue-shopping-btn" style="
              width: 100%;
              background: transparent;
              color: ${colors.text.body};
              border: 1px solid ${colors.text.body};
              padding: 0.75rem;
              border-radius: 0.5rem;
              font-size: 0.9rem;
              cursor: pointer;
              transition: all 0.3s;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 0.5rem;
            " onmouseover="this.style.background='${colors.text.body}'; this.style.color='${colors.background.general}'" onmouseout="this.style.background='transparent'; this.style.color='${colors.text.body}'">
              <i class="fas fa-arrow-left"></i>
              Continuer mes achats
            </button>
          </div>
        ` : ''}
      </div>
    `;
    
    this.attachModalEvents();
    
    setTimeout(() => {
      const overlay = this.modal.querySelector('.cart-overlay');
      const container = this.modal.querySelector('.cart-container');
      if (overlay) overlay.style.opacity = '1';
      if (container) {
        container.style.opacity = '1';
        container.style.transform = 'translateX(0)';
      }
    }, 50);
  }

  renderLikedSection(colors, fonts) {
    const items = this.likeManager ? this.likeManager.getLikedProducts() : [];
    return `
      <div style="margin-bottom: 1.2rem;">
        <div class="likes-header" style="
          display:flex;
          justify-content:space-between;
          align-items:center;
          cursor:pointer;
          margin-bottom:0.7rem;
        ">
          <h3 style="
            margin:0;
            font-size:1.05rem;
            font-weight:600;
            color:${colors.text.title};
            display:flex;
            align-items:center;
            gap:0.4rem;
          ">
            <i class="fas fa-heart" style="color:#DC2626;"></i>
            Favoris (${items.length})
          </h3>
          <i class="fas fa-chevron-down" style="color:${colors.text.body}; transform:${this.likesVisible ? 'rotate(180deg)' : 'rotate(0)'}; transition:transform 0.2s;"></i>
        </div>

        <div class="likes-content" style="display:${this.likesVisible ? 'block' : 'none'};">
          ${items.length === 0 ? `
            <div style="
              padding:0.9rem;
              border-radius:0.7rem;
              background:${colors.background.card};
              border:1px solid ${colors.background.button}22;
              color:${colors.text.body};
              font-size:0.88rem;
              text-align:center;
            ">Aucun produit liké pour le moment.</div>
          ` : `
            <div style="display:flex; flex-direction:column; gap:0.55rem;">
              ${items.map((item) => `
                <div style="
                  display:grid;
                  grid-template-columns:48px 1fr auto;
                  gap:0.55rem;
                  align-items:center;
                  background:${colors.background.card};
                  border:1px solid ${colors.background.button}22;
                  border-radius:0.65rem;
                  padding:0.45rem;
                ">
                  <div class="liked-product-open" data-product-id="${item.productId}" style="
                    width:48px;height:48px;border-radius:0.5rem;overflow:hidden;background:white;cursor:pointer;display:flex;align-items:center;justify-content:center;
                  ">
                    ${item.image ? `<img src="${this.getImagePath(item.image)}" alt="${item.name || 'Produit'}" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none'; this.parentNode.innerHTML='<i class=\\'fas fa-image\\' style=\\'color:${colors.text.body};\\'></i>'">` : `<i class="fas fa-image" style="color:${colors.text.body};"></i>`}
                  </div>
                  <button class="liked-product-open" data-product-id="${item.productId}" style="
                    border:none;background:transparent;text-align:left;cursor:pointer;padding:0;min-width:0;
                  ">
                    <p style="margin:0;font-size:0.86rem;font-weight:600;color:${colors.text.title};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.name || 'Produit'}</p>
                    <p style="margin:0.1rem 0 0;font-size:0.75rem;color:${colors.text.body};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${item.price || ''}</p>
                  </button>
                  <button class="liked-product-remove" data-product-id="${item.productId}" style="
                    border:none;background:transparent;color:#DC2626;cursor:pointer;width:30px;height:30px;border-radius:50%;
                  " title="Retirer des favoris">
                    <i class="fas fa-heart-broken"></i>
                  </button>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </div>
    `;
  }

  openLikedProduct(productId) {
    if (!productId) return;
    this.closeCartModal();
    import('./product-modal.js?v=20260525-5')
      .then((module) => {
        const ProductModal = module.default;
        if (this.likedPreviewModal) {
          this.likedPreviewModal.close().catch(() => {});
          this.likedPreviewModal = null;
        }
        this.likedPreviewModal = new ProductModal({
          productId,
          collectionName: 'products',
          imageBasePath: './',
          onClose: () => {
            this.likedPreviewModal = null;
            document.body.style.overflow = '';
          }
        });
      })
      .catch((error) => {
        console.error('âŒ Erreur ouverture produit likÃ©:', error);
      });
  }
  
  renderLoginPrompt(colors, fonts) {
    return `
      <div style="
        text-align: center;
        padding: 2rem;
        background: ${colors.background.card};
        border-radius: 1rem;
        margin-bottom: 1.5rem;
        border: 1px solid ${colors.background.button}20;
      ">
        <div style="
          width: 80px;
          height: 80px;
          background: ${colors.icon.hover}20;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1rem;
        ">
          <i class="fas fa-user-circle" style="font-size: 2.5rem; color: ${colors.icon.hover};"></i>
        </div>
        <h3 style="font-size: 1.2rem; margin-bottom: 0.5rem; color: ${colors.text.title};">Connectez-vous</h3>
        <p style="color: ${colors.text.body}; margin-bottom: 1.5rem;">
          Connectez-vous pour retrouver vos commandes, ou continuez comme invité pour commander tout de suite.
        </p>
        <div style="display:flex;flex-wrap:wrap;justify-content:center;gap:0.75rem;">
          <button class="login-btn" style="
            background: ${colors.background.button};
            color: ${colors.text.button};
            border: 1px solid ${colors.background.button};
            padding: 0.75rem 1.4rem;
            border-radius: 0.5rem;
            cursor: pointer;
            font-size: 1rem;
            transition: all 0.3s;
          " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
            Se connecter / S'inscrire
          </button>
          <button class="guest-checkout-btn" style="
            background: transparent;
            color: ${colors.text.title};
            border: 1px solid ${colors.background.button}60;
            padding: 0.75rem 1.4rem;
            border-radius: 0.5rem;
            cursor: pointer;
            font-size: 1rem;
            transition: all 0.3s;
          ">
            Continuer comme invité
          </button>
        </div>
      </div>
    `;
  }
  
  renderOrdersSection(colors, fonts) {
    const visibleOrders = this.orders.filter((o) => !this.isOrderHidden(o.id));

    if (visibleOrders.length === 0) {
      return `
        <div style="margin-bottom: 1.5rem;">
          <div style="
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
            cursor: pointer;
          " class="orders-header">
            <h3 style="
              font-size: 1.1rem;
              font-weight: 600;
              display: flex;
              align-items: center;
              gap: 0.5rem;
              color: ${colors.text.title};
            ">
              <i class="fas fa-history" style="color: ${colors.icon.hover};"></i>
              Mes commandes
            </h3>
            <i class="fas fa-chevron-down" style="color: ${colors.text.body}; transition: transform 0.3s;"></i>
          </div>
          
          <div class="orders-content" style="display: ${this.ordersVisible ? 'block' : 'none'};">
            <div style="
              text-align: center;
              padding: 2rem;
              background: ${colors.background.card};
              border-radius: 1rem;
              color: ${colors.text.body};
              border: 1px solid ${colors.background.button}20;
            ">
              <i class="fas fa-inbox" style="font-size: 2rem; margin-bottom: 0.5rem; opacity: 0.5; color: ${colors.icon.hover};"></i>
              <p>Aucune commande pour le moment</p>
            </div>
          </div>
        </div>
      `;
    }
    
    const pending = visibleOrders.filter(o => o.status === 'pending').length;
    
    return `
      <div style="margin-bottom: 1.5rem;">
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1rem;
          cursor: pointer;
        " class="orders-header">
          <h3 style="
            font-size: 1.1rem;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            color: ${colors.text.title};
          ">
            <i class="fas fa-history" style="color: ${colors.icon.hover};"></i>
            Mes commandes (${visibleOrders.length})
          </h3>
          
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            ${pending > 0 ? `<span style="
              padding: 0.25rem 0.5rem;
              background: #F59E0B20;
              color: #F59E0B;
              border-radius: 2rem;
              font-size: 0.7rem;
            ">${pending} en attente</span>` : ''}
            <i class="fas fa-chevron-down" style="color: ${colors.text.body}; transition: transform 0.3s; transform: ${this.ordersVisible ? 'rotate(180deg)' : 'rotate(0)'};"></i>
          </div>
        </div>
        
        <div class="orders-content" style="display: ${this.ordersVisible ? 'block' : 'none'};">
          <div style="display: flex; flex-direction: column; gap: 1rem;">
            ${visibleOrders.map(order => this.renderOrderItem(order, colors, fonts)).join('')}
          </div>
        </div>
      </div>
    `;
  }
  
  renderOrderItem(order, colors, fonts) {
    const statusColor = this.getStatusColor(order.status);
    const statusText = this.getStatusText(order.status);
    const timeLeft = (Number.isFinite(order.timeLeft) && order.timeLeft > 0)
      ? order.timeLeft
      : this.calculateTimeLeft(order.expiresAt);
    const orderItems = this.getOrderItems(order);
    const downloadableItems = orderItems.filter((item) => item.isDigitalProduct && item.digitalDownloadLink);
    
    return `
      <div style="
        background: ${colors.background.card};
        border-radius: 0.75rem;
        padding: 1rem;
        border: 1px solid ${colors.background.button}20;
        transition: all 0.2s;
      ">
        <div style="
          display: flex;
          justify-content: space-between;
          align-items: start;
          margin-bottom: 0.5rem;
        ">
          <div>
            <span style="
              font-weight: 600;
              font-size: 1rem;
              color: ${colors.text.title};
            ">${this.formatPrice(this.getOrderAmount(order))}</span>
            <span style="
              display: inline-block;
              margin-left: 0.5rem;
              padding: 0.2rem 0.5rem;
              border-radius: 2rem;
              font-size: 0.7rem;
              background: ${statusColor}20;
              color: ${statusColor};
            ">${statusText}</span>
          </div>
          <span style="font-size: 0.8rem; color: ${colors.text.body};">
            ${new Date(order.createdAt).toLocaleDateString('fr-FR')}
          </span>
        </div>
        
        <div style="
          display: flex;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
          font-size: 0.85rem;
          color: ${colors.text.body};
        ">
          <span>${order.methodName || 'Paiement mobile'}</span>
          <span>•</span>
          <span>Code: ${order.uniqueCode || order.id || 'N/A'}</span>
        </div>

        ${this.renderFulfillmentTracker(order, colors)}

        ${(['approved', 'paid'].includes(order.status) && downloadableItems.length) ? `
          <div style="
            margin-top: 0.75rem;
            padding: 0.75rem;
            background: #10B98110;
            border: 1px solid #10B98122;
            border-radius: 0.75rem;
            color: ${colors.text.body};
            display: grid;
            gap: 0.55rem;
          ">
            <strong style="color:#047857;display:flex;align-items:center;gap:.45rem;">
              <i class="fas fa-bolt"></i>
              Articles digitaux disponibles
            </strong>
            ${downloadableItems.map((item) => `
              <a href="${this.escapeHtml(item.digitalDownloadLink)}" target="_blank" rel="noopener noreferrer" style="display:flex;align-items:center;justify-content:space-between;gap:.75rem;color:#047857;text-decoration:none;background:#fff;border-radius:.65rem;padding:.55rem .7rem;">
                <span>${this.escapeHtml(item.name || 'Telechargement')}</span>
                <i class="fas fa-download"></i>
              </a>
            `).join('')}
          </div>
        ` : ''}
        
        ${(order.status === 'pending' || order.status === 'review') && timeLeft > 0 ? `
          <div style="
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-top: 0.5rem;
            padding: 0.5rem;
            background: ${colors.background.button}10;
            border-radius: 0.5rem;
          ">
            <i class="fas fa-clock" style="color: ${timeLeft < 5 * 60 * 1000 ? '#EF4444' : '#F59E0B'};"></i>
            <span style="flex: 1; font-size: 0.85rem; color: ${colors.text.body};">Temps restant</span>
            <span class="order-timer-${order.id}" style="
              font-family: monospace;
              font-weight: 600;
              font-size: 0.9rem;
              color: ${timeLeft < 5 * 60 * 1000 ? '#EF4444' : '#F59E0B'};
            ">${this.formatTimeLeft(timeLeft)}</span>
          </div>
        ` : ''}
        
        ${(['approved', 'paid', 'rejected'].includes(order.status)) ? `
          <div style="display:flex; justify-content:flex-end; margin-top:0.5rem;">
            <button class="hide-order-btn" data-order-id="${order.id}" title="Masquer cette commande" style="
              background: transparent;
              color: #92400E;
              border: 1px solid #92400E33;
              padding: 0.4rem 0.6rem;
              border-radius: 2rem;
              font-size: 0.8rem;
              cursor: pointer;
              transition: all 0.2s;
              display: flex;
              align-items: center;
              gap: 0.3rem;
            " onmouseover="this.style.background='#92400E10'" onmouseout="this.style.background='transparent'">
              <i class="fas fa-trash"></i>
              Masquer
            </button>
          </div>
        ` : ''}

        ${(['approved', 'paid'].includes(order.status)) ? `
          <div style="
            margin-top: 0.5rem;
            padding: 0.5rem;
            background: #10B98110;
            border-radius: 0.5rem;
            color: #10B981;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          ">
            <i class="fas fa-check-circle"></i>
            <span style="flex: 1;">Paiement confirmé</span>
            <button class="download-pdf-btn" data-order-id="${order.id}" style="
              background: #10B981;
              color: white;
              border: none;
              padding: 0.4rem 0.8rem;
              border-radius: 2rem;
              font-size: 0.7rem;
              cursor: pointer;
              transition: all 0.2s;
              display: flex;
              align-items: center;
              gap: 0.3rem;
            " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
              <i class="fas fa-file-pdf"></i>
              Télécharger le reçu
            </button>
          </div>
          
          <div style="
            margin-top: 0.5rem;
            padding: 0.5rem;
            background: #FEF3C7;
            border-radius: 0.5rem;
            color: #92400E;
            font-size: 0.7rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          ">
            <i class="fas fa-exclamation-triangle" style="color: #F59E0B;"></i>
            <span>Ce PDF contient votre code unique de retrait. Conservez-le précieusement !</span>
          </div>
        ` : ''}
        
        ${order.status === 'rejected' ? `
          <div style="
            margin-top: 0.5rem;
            padding: 0.5rem;
            background: #EF444410;
            border-radius: 0.5rem;
            color: #EF4444;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          ">
            <i class="fas fa-times-circle"></i>
            <span>Paiement rejeté</span>
          </div>
        ` : ''}
        
        ${order.status === 'expired' ? `
          <div style="
            margin-top: 0.5rem;
            padding: 0.5rem;
            background: #6B728010;
            border-radius: 0.5rem;
            color: #6B7280;
            font-size: 0.85rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
          ">
            <i class="fas fa-clock"></i>
            <span>Demande expirée</span>
          </div>
        ` : ''}
      </div>
    `;
  }
  
  renderCartSection(colors, fonts) {
    if (this.cart.length === 0) {
      return this.renderEmptyCart(colors, fonts);
    }
    
    return `
      <div>
        <h3 style="
          font-size: 1.1rem;
          font-weight: 600;
          margin-bottom: 1rem;
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: ${colors.text.title};
        ">
          <i class="fas fa-shopping-cart" style="color: ${colors.icon.hover};"></i>
          Mon panier (${this.getTotalItems()})
        </h3>
        
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          ${this.renderCartItems(colors, fonts)}
        </div>
      </div>
    `;
  }
  
  renderEmptyCart(colors, fonts) {
    return `
      <div style="
        text-align: center;
        padding: 2rem;
        background: ${colors.background.card};
        border-radius: 1rem;
        border: 1px solid ${colors.background.button}20;
      ">
        <div style="
          width: 80px;
          height: 80px;
          background: ${colors.icon.hover}20;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 1rem;
        ">
          <i class="fas fa-shopping-bag" style="font-size: 2rem; color: ${colors.icon.hover}; opacity: 0.5;"></i>
        </div>
        <p style="color: ${colors.text.body};">Votre panier est vide</p>
        <button class="continue-shopping-btn" style="
          background: ${colors.background.button};
          color: ${colors.text.button};
          border: 1px solid ${colors.background.button};
          padding: 0.5rem 1.5rem;
          border-radius: 0.5rem;
          cursor: pointer;
          font-size: 0.9rem;
          margin-top: 1rem;
        " onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'">
          Découvrir les produits
        </button>
      </div>
    `;
  }
  
  renderCartItems(colors, fonts) {
    return this.cart.map((item, index) => {
      const itemTotal = (item.price || 0) * (item.quantity || 1);
      const options = this.getCustomerVisibleOptions(item.selectedOptions || []);
      const imagePath = this.getImagePath(item.image || '');
      
      return `
        <div class="cart-item" data-index="${index}" style="
          display: flex;
          gap: 1rem;
          padding: 1rem 0;
          border-bottom: 1px solid rgba(198, 167, 94, 0.1);
          position: relative;
        ">
          <div style="
            width: 70px;
            height: 70px;
            background: ${colors.background.card};
            border-radius: 0.5rem;
            overflow: hidden;
            flex-shrink: 0;
            border: 1px solid rgba(198, 167, 94, 0.2);
          ">
            <img src="${imagePath}" alt="${item.name || 'Produit'}" style="
              width: 100%;
              height: 100%;
              object-fit: cover;
            " onerror="this.src=''; this.parentElement.innerHTML='<div style=\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:${colors.text.body};\'><i class=\'fas fa-image\'></i></div>'">
          </div>
          
          <div style="flex: 1;">
            <div style="
              display: flex;
              justify-content: space-between;
              align-items: start;
              margin-bottom: 0.25rem;
            ">
              <div>
                <h4 style="
                  font-weight: 500;
                  margin: 0;
                  font-size: 0.95rem;
                  color: ${colors.text.title};
                ">${item.name || 'Produit'}</h4>
                ${item.sku ? `
                  <span style="
                    font-size: 0.65rem;
                    color: ${colors.text.body};
                    display: block;
                  ">SKU: ${item.sku}</span>
                ` : ''}
              </div>
              <button class="remove-item" style="
                background: none;
                border: none;
                color: #7F1D1D;
                cursor: pointer;
                padding: 0.25rem;
                opacity: 0.5;
                transition: opacity 0.2s;
                font-size: 0.9rem;
              " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">
                <i class="fas fa-trash-alt"></i>
              </button>
            </div>
            
            ${options.length > 0 ? `
              <div style="
                margin: 0.25rem 0;
                display: flex;
                flex-wrap: wrap;
                gap: 0.25rem;
              ">
                ${options.map(opt => {
                  const displayValue = opt.value || opt;
                  return `
                    <span style="
                      display: inline-flex;
                      align-items: center;
                      gap: 0.25rem;
                      background: ${colors.icon.hover}20;
                      padding: 0.1rem 0.4rem;
                      border-radius: 2rem;
                      font-size: 0.65rem;
                      color: ${colors.text.body};
                    ">
                      <span>${displayValue}</span>
                    </span>
                  `;
                }).join('')}
              </div>
            ` : ''}
            
            <div style="
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-top: 0.5rem;
            ">
              <span style="font-weight: 600; color: ${colors.text.title}; font-size: 0.95rem;">
                ${this.formatPrice(itemTotal)}
              </span>
              
              <div style="
                display: flex;
                align-items: center;
                gap: 0.5rem;
                background: white;
                border-radius: 2rem;
                padding: 0.1rem;
                border: 1px solid rgba(198, 167, 94, 0.3);
              ">
                <button class="decrease-qty" style="
                  width: 26px;
                  height: 26px;
                  border: none;
                  background: transparent;
                  border-radius: 50%;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 0.7rem;
                  color: ${colors.text.title};
                  transition: all 0.2s;
                " onmouseover="this.style.background='${colors.icon.hover}'; this.style.color='${colors.text.button}'" onmouseout="this.style.background='transparent'; this.style.color='${colors.text.title}'">
                  <i class="fas fa-minus"></i>
                </button>
                
                <span style="min-width: 25px; text-align: center; font-weight: 500; font-size: 0.85rem; color: ${colors.text.title};">${item.quantity}</span>
                
                <button class="increase-qty" style="
                  width: 26px;
                  height: 26px;
                  border: none;
                  background: transparent;
                  border-radius: 50%;
                  cursor: pointer;
                  display: flex;
                  align-items: center;
                  justify-content: center;
                  font-size: 0.7rem;
                  color: ${colors.text.title};
                  transition: all 0.2s;
                " onmouseover="this.style.background='${colors.icon.hover}'; this.style.color='${colors.text.button}'" onmouseout="this.style.background='transparent'; this.style.color='${colors.text.title}'">
                  <i class="fas fa-plus"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
  
  attachModalEvents() {
    if (!this.modal) return;
    
    const closeBtn = this.modal.querySelector('.close-cart-btn');
    const overlay = this.modal.querySelector('.cart-overlay');
    const loginBtns = this.modal.querySelectorAll('.login-btn');
    const guestCheckoutBtns = this.modal.querySelectorAll('.guest-checkout-btn');
    const logoutBtn = this.modal.querySelector('.logout-btn');
    const downloadPdfBtns = this.modal.querySelectorAll('.download-pdf-btn');
    const hideOrderBtns = this.modal.querySelectorAll('.hide-order-btn');
    const ordersHeader = this.modal.querySelector('.orders-header');
    const likesHeader = this.modal.querySelector('.likes-header');
    const toggleLikesBtn = this.modal.querySelector('.toggle-likes-btn');
    
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeCartModal();
      });
    }
    
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        if (Date.now() - this.modalOpenedAt < 350) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        if (e.target === overlay) {
          this.closeCartModal();
        }
      });
    }
    
    if (ordersHeader) {
      ordersHeader.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleOrdersVisibility();
      });
    }

    if (likesHeader) {
      likesHeader.addEventListener('click', (e) => {
        e.stopPropagation();
        this.likesVisible = !this.likesVisible;
        this.renderCartModal();
      });
    }

    if (toggleLikesBtn) {
      toggleLikesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.likesVisible = !this.likesVisible;
        this.renderCartModal();
      });
    }
    
    loginBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeCartModal();
        if (this.auth) {
          this.auth.openAuthModal('login');
        }
      });
    });

    guestCheckoutBtns.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        this.closeCartModal();
        await this.openCheckout({
          cart: this.cart,
          total: this.getTotalPrice(),
          mode: 'guest'
        });
      });
    });
    
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.auth) {
          this.auth.logout();
        }
      });
    }
    
    downloadPdfBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const orderId = btn.dataset.orderId;
        this.downloadOrderPdf(orderId);
      });
    });

    hideOrderBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const orderId = btn.dataset.orderId;
        this.hideOrderFromClient(orderId);
      });
    });
    
    this.modal.querySelectorAll('.continue-shopping-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.closeCartModal();
      });
    });
    
    this.modal.querySelectorAll('.decrease-qty').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemRow = e.target.closest('.cart-item');
        if (!itemRow) return;
        const index = parseInt(itemRow.dataset.index);
        if (!isNaN(index) && this.cart[index]) {
          const currentQty = this.cart[index].quantity || 1;
          this.updateQuantity(index, currentQty - 1);
        }
      });
    });
    
    this.modal.querySelectorAll('.increase-qty').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemRow = e.target.closest('.cart-item');
        if (!itemRow) return;
        const index = parseInt(itemRow.dataset.index);
        if (!isNaN(index) && this.cart[index]) {
          const currentQty = this.cart[index].quantity || 1;
          this.updateQuantity(index, currentQty + 1);
        }
      });
    });
    
    this.modal.querySelectorAll('.remove-item').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemRow = e.target.closest('.cart-item');
        if (!itemRow) return;
        const index = parseInt(itemRow.dataset.index);
        if (!isNaN(index) && this.cart[index]) {
          this.removeItem(index);
        }
      });
    });

    this.modal.querySelectorAll('.liked-product-open').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const productId = btn.dataset.productId;
        this.openLikedProduct(productId);
      });
    });

    this.modal.querySelectorAll('.liked-product-remove').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const productId = btn.dataset.productId;
        if (!productId || !this.likeManager) return;
        await this.likeManager.toggleLike(productId);
      });
    });
    
    const checkoutBtn = this.modal.querySelector('.checkout-btn');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        if (!this.auth || !this.auth.isAuthenticated()) {
          this.showCheckoutChoice();
          return;
        }
        
        this.closeCartModal();
        
        const event = new CustomEvent('openCheckout', { 
          detail: { 
            cart: this.cart, 
            total: this.getTotalPrice() 
          }
        });
        document.dispatchEvent(event);
      });
    }
  }
  
  getSummary() {
    return {
      items: this.cart.length,
      totalItems: this.getTotalItems(),
      subtotal: this.getTotalPrice(),
      formattedSubtotal: this.formatPrice(this.getTotalPrice())
    };
  }
  
  isInCart(productId, options = null) {
    const targetKey = this.getCartItemKey({ productId, selectedOptions: options || [] });
    return this.cart.some(item => this.getCartItemKey(item) === targetKey);
  }
  
  getItemQuantity(productId, options = null) {
    const targetKey = this.getCartItemKey({ productId, selectedOptions: options || [] });
    const item = this.cart.find(item => this.getCartItemKey(item) === targetKey);
    return item ? item.quantity : 0;
  }
  
  destroy() {
    for (const interval of this.countdownIntervals.values()) {
      clearInterval(interval);
    }
    this.countdownIntervals.clear();
    
    if (this.ordersListener) {
      this.ordersListener();
    }
    
    if (this.unsubscribeTheme) {
      this.unsubscribeTheme();
    }
  }
}

let cartInstance = null;

export function getCartManager(options = {}) {
  if (!cartInstance) {
    cartInstance = new CartManager(options);
  }
  return cartInstance;
}

export default CartManager;




