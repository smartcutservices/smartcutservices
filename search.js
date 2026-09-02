// ============= SEARCH COMPONENT - AVEC NOUVELLE STRUCTURE THÈME =============
import { db } from './firebase-init.js';
import { isPublicProductVisible, loadPublicProducts } from './catalog-products.js?v=20260901-1';
import { getFallbackProductImage, getResolvedProductImages, resolveImagePath } from './image-fallbacks.js';
import {
  collection, query, where, getDocs, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { marketplaceApi } from './marketplace-api.js?v=20260901-1';
import theme from './theme-root.js';

const SMARTCUT_SEARCH_HISTORY_KEY = 'smartcut_search_history';
const HEALTH_FN_BASE = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net';
const SEARCH_SOURCE_TTL = 5 * 60 * 1000; // une source n'est retéléchargée qu'une fois par tranche de 5 min

// Recherche tolérante aux accents : "medecin" trouve "médecin".
function scNormalize(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function scTokenize(value) {
  return scNormalize(value).split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
}
// Tous les mots de la requête doivent apparaître dans le texte indexé.
function scMatchesAll(haystack, queryTokens) {
  const normalized = scNormalize(haystack);
  return queryTokens.length > 0 && queryTokens.every((token) => normalized.includes(token));
}

// Cache de session par source : un seul téléchargement, réutilisé pour toutes les
// frappes / recherches suivantes au lieu d'un getDocs de collection entière à chaque fois.
const _searchSourceCache = new Map();
function cachedSearchSource(key, loader) {
  const hit = _searchSourceCache.get(key);
  const now = Date.now();
  if (hit) {
    if (hit.data && now - hit.at < SEARCH_SOURCE_TTL) return Promise.resolve(hit.data);
    if (hit.promise) return hit.promise;
  }
  const promise = Promise.resolve()
    .then(loader)
    .then((data) => { _searchSourceCache.set(key, { at: Date.now(), data }); return data; })
    .catch((error) => { _searchSourceCache.delete(key); throw error; });
  _searchSourceCache.set(key, { at: now, promise });
  return promise;
}

function saveSmartcutSearchTerm(term) {
  const cleanTerm = String(term || '').trim();
  if (cleanTerm.length < 2) return;

  try {
    const current = JSON.parse(localStorage.getItem(SMARTCUT_SEARCH_HISTORY_KEY) || '[]');
    const list = Array.isArray(current) ? current : [];
    const normalized = cleanTerm.toLowerCase();
    const next = [
      cleanTerm,
      ...list.filter((entry) => String(entry || '').trim().toLowerCase() !== normalized)
    ].slice(0, 20);
    localStorage.setItem(SMARTCUT_SEARCH_HISTORY_KEY, JSON.stringify(next));
  } catch (_) {
    // L'historique est un confort pour les recommandations; la recherche doit continuer meme sans stockage.
  }
}

class SearchComponent {
  constructor(options = {}) {
    this.options = {
      containerId: options.containerId || 'sierra-search-root',
      triggerSelector: options.triggerSelector || '.search-trigger, #desktopSearchIcon, #mobileSearchIcon',
      minChars: options.minChars || 2,
      maxResults: options.maxResults || 10,
      productsPerCategory: options.productsPerCategory || 5,
      presentationsPerPage: options.presentationsPerPage || 5,
      imageBasePath: options.imageBasePath || './',
      ...options
    };
    
    this.uniqueId = 'search_' + Math.random().toString(36).substr(2, 9);
    this.modal = null;
    this.isOpen = false;
    this.searchTimeout = null;
    this.currentResults = {
      products: [],
      presentations: [],
      health: [],
      services: [],
      formations: []
    };
    
    this.theme = theme;
    this.boundTriggerClickHandler = null;
    
    // S'abonner aux changements de thème
    this.unsubscribeTheme = this.theme.subscribe((newTheme) => {
      if (this.modal) {
        this.applyThemeStyles();
      }
    });
    
    this.init();
  }

  formatPriceHTG(value) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency',
      currency: 'HTG',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  }
  
  applyThemeStyles() {
    const colors = this.theme.getColors();
    const fonts = this.theme.getFonts();
    
    // Couleurs selon la nouvelle structure
    const titleColor = colors?.text?.title || '#0F1111';
    const subtitleColor = colors?.text?.subtitle || '#565959';
    const bodyColor = colors?.text?.body || '#4A4A4A';
    const buttonTextColor = colors?.text?.button || '#FFFFFF';
    const buttonBgColor = colors?.background?.button || '#FFA41C';
    const bgGeneralColor = colors?.background?.general || '#EAEDED';
    const bgCardColor = colors?.background?.card || '#FFFFFF';
    const iconStandard = colors?.icon?.standard || '#565959';
    const iconHover = colors?.icon?.hover || '#FFA41C';
    
    const primaryFont = fonts?.primary || "'Amazon Ember', Arial, sans-serif";
    const secondaryFont = fonts?.secondary || "'Amazon Ember', sans-serif";
    
    // Appliquer les styles CSS
    const styleEl = document.createElement('style');
    styleEl.textContent = `
      .search-overlay-${this.uniqueId} {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        z-index: 999999;
        display: none;
        opacity: 0;
        transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }
      
      .search-container-${this.uniqueId} {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 1000000;
        background: ${bgGeneralColor};
        transform: translateY(-100%);
        transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
      }
      
      .search-container-${this.uniqueId}.visible {
        transform: translateY(0);
      }
      
      @media (min-width: 768px) {
        .search-container-${this.uniqueId} {
          top: 20%;
          left: 50%;
          right: auto;
          transform: translate(-50%, -30%) scale(0.95);
          width: 90%;
          max-width: 800px;
          border-radius: 1rem;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          opacity: 0;
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .search-container-${this.uniqueId}.visible {
          transform: translate(-50%, 0) scale(1);
          opacity: 1;
        }
      }
      
      .search-header-${this.uniqueId} {
        padding: 1rem;
        border-bottom: 1px solid ${iconStandard}20;
        background: ${bgGeneralColor};
      }
      
      @media (min-width: 768px) {
        .search-header-${this.uniqueId} {
          padding: 1.5rem;
          border-radius: 1rem 1rem 0 0;
        }
      }
      
      .search-input-wrapper-${this.uniqueId} {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        background: ${bgCardColor};
        border: 2px solid ${iconStandard}20;
        border-radius: 3rem;
        padding: 0.25rem 0.25rem 0.25rem 1.5rem;
        transition: all 0.2s ease;
      }
      
      .search-input-wrapper-${this.uniqueId}:focus-within {
        border-color: ${iconHover};
        box-shadow: 0 0 0 4px ${iconHover}20;
      }
      
      .search-input-${this.uniqueId} {
        flex: 1;
        border: none;
        padding: 0.75rem 0;
        font-size: 1rem;
        background: transparent;
        outline: none;
        font-family: ${secondaryFont};
        color: ${titleColor};
      }
      
      .search-input-${this.uniqueId}::placeholder {
        color: ${subtitleColor};
        opacity: 0.6;
      }
      
      .search-clear-${this.uniqueId} {
        background: none;
        border: none;
        color: ${iconStandard};
        cursor: pointer;
        padding: 0.5rem;
        border-radius: 50%;
        display: none;
        transition: all 0.2s;
      }
      
      .search-clear-${this.uniqueId}:hover {
        color: ${iconHover};
        background: ${iconHover}20;
      }
      
      .search-close-${this.uniqueId} {
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: ${bgCardColor};
        border: 1px solid ${iconStandard}20;
        color: ${iconStandard};
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }
      
      .search-close-${this.uniqueId}:hover {
        background: ${iconHover}20;
        color: ${iconHover};
        transform: rotate(90deg);
      }
      
      .search-content-${this.uniqueId} {
        padding: 1rem;
        max-height: 70vh;
        overflow-y: auto;
        -webkit-overflow-scrolling: touch;
      }
      
      @media (min-width: 768px) {
        .search-content-${this.uniqueId} {
          padding: 1.5rem;
          max-height: 60vh;
        }
      }
      
      .search-section-${this.uniqueId} {
        margin-bottom: 2rem;
        animation: fadeIn 0.3s ease;
      }
      
      .search-section-title-${this.uniqueId} {
        font-family: ${primaryFont};
        font-size: 1.2rem;
        color: ${titleColor};
        margin-bottom: 1rem;
        padding-bottom: 0.5rem;
        border-bottom: 2px solid ${iconHover};
        display: inline-block;
      }
      
      .search-grid-${this.uniqueId} {
        display: grid;
        grid-template-columns: 1fr;
        gap: 1rem;
      }
      
      @media (min-width: 480px) {
        .search-grid-${this.uniqueId} {
          grid-template-columns: repeat(2, 1fr);
        }
      }
      
      @media (min-width: 1024px) {
        .search-grid-${this.uniqueId} {
          grid-template-columns: repeat(3, 1fr);
        }
      }
      
      .search-card-${this.uniqueId} {
        display: flex;
        gap: 1rem;
        padding: 1rem;
        background: ${bgCardColor};
        border: 1px solid ${iconStandard}20;
        border-radius: 0.75rem;
        cursor: pointer;
        transition: all 0.2s ease;
        animation: cardAppear 0.3s ease;
        animation-fill-mode: both;
      }
      
      .search-card-${this.uniqueId}:hover {
        transform: translateY(-2px);
        box-shadow: 0 10px 20px -10px rgba(0, 0, 0, 0.2);
        border-color: ${iconHover};
      }
      
      @keyframes cardAppear {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      
      .search-card-${this.uniqueId}:nth-child(1) { animation-delay: 0.05s; }
      .search-card-${this.uniqueId}:nth-child(2) { animation-delay: 0.1s; }
      .search-card-${this.uniqueId}:nth-child(3) { animation-delay: 0.15s; }
      .search-card-${this.uniqueId}:nth-child(4) { animation-delay: 0.2s; }
      .search-card-${this.uniqueId}:nth-child(5) { animation-delay: 0.25s; }
      
      .search-card-image-${this.uniqueId} {
        width: 70px;
        height: 70px;
        border-radius: 0.5rem;
        overflow: hidden;
        background: ${bgGeneralColor};
        flex-shrink: 0;
      }
      
      .search-card-image-${this.uniqueId} img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      .search-card-image-${this.uniqueId} i {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
        color: ${iconHover};
      }
      
      .search-card-content-${this.uniqueId} {
        flex: 1;
        min-width: 0;
      }
      
      .search-card-title-${this.uniqueId} {
        font-weight: 600;
        margin-bottom: 0.25rem;
        color: ${titleColor};
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-family: ${primaryFont};
      }
      
      .search-card-subtitle-${this.uniqueId} {
        font-size: 0.8rem;
        color: ${subtitleColor};
        margin-bottom: 0.25rem;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        font-family: ${secondaryFont};
      }
      
      .search-card-price-${this.uniqueId} {
        font-weight: 600;
        color: ${iconHover};
        font-size: 0.9rem;
      }
      
      .search-card-oldprice-${this.uniqueId} {
        font-size: 0.8rem;
        color: ${subtitleColor};
        text-decoration: line-through;
        margin-left: 0.5rem;
      }
      
      .search-card-badge-${this.uniqueId} {
        display: inline-block;
        padding: 0.15rem 0.5rem;
        background: ${iconHover}20;
        border-radius: 2rem;
        font-size: 0.7rem;
        color: ${iconHover};
        margin-top: 0.25rem;
        font-family: ${secondaryFont};
      }
      
      .search-empty-${this.uniqueId} {
        text-align: center;
        padding: 3rem 1rem;
        color: ${subtitleColor};
        animation: fadeIn 0.3s ease;
        font-family: ${secondaryFont};
      }
      
      .search-empty-${this.uniqueId} i {
        font-size: 3rem;
        margin-bottom: 1rem;
        color: ${iconStandard};
        opacity: 0.5;
      }
      
      .search-loading-${this.uniqueId} {
        text-align: center;
        padding: 3rem 1rem;
        color: ${subtitleColor};
      }
      
      .search-loading-spinner-${this.uniqueId} {
        display: inline-block;
        width: 40px;
        height: 40px;
        border: 3px solid ${iconHover}20;
        border-top-color: ${iconHover};
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      
      .search-content-${this.uniqueId}::-webkit-scrollbar {
        width: 6px;
      }
      
      .search-content-${this.uniqueId}::-webkit-scrollbar-track {
        background: ${iconHover}20;
        border-radius: 3px;
      }
      
      .search-content-${this.uniqueId}::-webkit-scrollbar-thumb {
        background: ${iconHover};
        border-radius: 3px;
      }
      
      .search-suggestions-${this.uniqueId} {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid ${iconStandard}20;
      }
      
      .search-suggestion-${this.uniqueId} {
        padding: 0.4rem 1rem;
        background: ${bgCardColor};
        border: 1px solid ${iconStandard}20;
        border-radius: 2rem;
        font-size: 0.85rem;
        color: ${subtitleColor};
        cursor: pointer;
        transition: all 0.2s;
        font-family: ${secondaryFont};
      }
      
      .search-suggestion-${this.uniqueId}:hover {
        background: ${iconHover};
        color: ${buttonTextColor};
        border-color: ${iconHover};
      }
    `;
    
    // Remplacer l'ancien style
    const oldStyle = document.getElementById(`search-styles-${this.uniqueId}`);
    if (oldStyle) oldStyle.remove();
    
    styleEl.id = `search-styles-${this.uniqueId}`;
    document.head.appendChild(styleEl);
  }
  
  init() {
    this.render();
    this.attachEvents();
  }
  
  render() {
    this.applyThemeStyles();
    
    // Créer le modal de recherche
    const modal = document.createElement('div');
    modal.className = `search-overlay-${this.uniqueId}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Recherche dans le catalogue');
    modal.innerHTML = `
      <div class="search-container-${this.uniqueId}">
        <div class="search-header-${this.uniqueId}">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div class="search-input-wrapper-${this.uniqueId}" style="flex: 1;">
              <i class="fas fa-search"></i>
              <input type="search"
                     class="search-input-${this.uniqueId}" 
                     placeholder="Rechercher un produit, un article..."
                     aria-label="Rechercher un produit ou un article"
                     id="searchInput-${this.uniqueId}"
                     autocomplete="off">
              <button type="button" class="search-clear-${this.uniqueId}" id="searchClear-${this.uniqueId}" aria-label="Effacer la recherche">
                <i class="fas fa-times-circle"></i>
              </button>
            </div>
            <button type="button" class="search-close-${this.uniqueId}" id="searchClose-${this.uniqueId}" aria-label="Fermer la recherche">
              <i class="fas fa-times"></i>
            </button>
          </div>
          
          <div class="search-suggestions-${this.uniqueId}">
            <button type="button" class="search-suggestion-${this.uniqueId}" data-suggest="nouveautés">Nouveautés</button>
            <button type="button" class="search-suggestion-${this.uniqueId}" data-suggest="promotions">Promotions</button>
            <button type="button" class="search-suggestion-${this.uniqueId}" data-suggest="collection">Collection</button>
            <button type="button" class="search-suggestion-${this.uniqueId}" data-suggest="édition limitée">Édition limitée</button>
          </div>
        </div>
        
        <div class="search-content-${this.uniqueId}" id="searchContent-${this.uniqueId}">
          <div class="search-empty-${this.uniqueId}">
            <i class="fas fa-search"></i>
            <p>Que souhaitez-vous trouver ?</p>
            <p style="font-size: 0.9rem; margin-top: 0.5rem;">Tapez au moins 2 caractères</p>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    this.modal = modal;
  }
  
  attachEvents() {
    const overlay = this.modal;
    const closeBtn = this.modal.querySelector(`#searchClose-${this.uniqueId}`);
    const input = this.modal.querySelector(`#searchInput-${this.uniqueId}`);
    const clearBtn = this.modal.querySelector(`#searchClear-${this.uniqueId}`);
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        this.close();
      }
    });
    
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
    
    if (input) {
      input.addEventListener('input', (e) => {
        const query = e.target.value.trim();
        
        if (clearBtn) {
          clearBtn.style.display = query ? 'flex' : 'none';
        }
        
        clearTimeout(this.searchTimeout);
        this.searchTimeout = setTimeout(() => {
          this.performSearch(query);
        }, 300);
      });
      
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          this.close();
        }
      });
    }
    
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (input) {
          input.value = '';
          input.focus();
          clearBtn.style.display = 'none';
          this.performSearch('');
        }
      });
    }
    
    this.modal.querySelectorAll(`.search-suggestion-${this.uniqueId}`).forEach(sugg => {
      sugg.addEventListener('click', () => {
        if (input) {
          input.value = sugg.dataset.suggest;
          input.focus();
          clearBtn.style.display = 'flex';
          this.performSearch(sugg.dataset.suggest);
        }
      });
    });
    
    this.setupGlobalTriggerHandler();
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        this.close();
      }
    });
    
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.open();
      }
    });
  }

  setupGlobalTriggerHandler() {
    if (this.boundTriggerClickHandler) return;

    // Event delegation: fonctionne même si le header est rerendu plus tard.
    this.boundTriggerClickHandler = (e) => {
      const trigger = e.target.closest(this.options.triggerSelector);
      if (!trigger) return;
      e.preventDefault();
      e.stopPropagation();
      this.open();
    };

    document.addEventListener('click', this.boundTriggerClickHandler);
  }
  
  open() {
    if (this.isOpen) return;
    
    this.isOpen = true;
    const overlay = this.modal;
    const container = this.modal.querySelector(`.search-container-${this.uniqueId}`);
    
    overlay.style.display = 'block';
    
    setTimeout(() => {
      overlay.style.opacity = '1';
      container.classList.add('visible');
      
      const input = this.modal.querySelector(`#searchInput-${this.uniqueId}`);
      if (input) {
        setTimeout(() => input.focus(), 100);
      }
    }, 50);
    
    document.body.style.overflow = 'hidden';
  }
  
  close() {
    if (!this.isOpen) return;
    
    this.isOpen = false;
    const overlay = this.modal;
    const container = this.modal.querySelector(`.search-container-${this.uniqueId}`);
    
    overlay.style.opacity = '0';
    container.classList.remove('visible');
    
    setTimeout(() => {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
      
      const input = this.modal.querySelector(`#searchInput-${this.uniqueId}`);
      const clearBtn = this.modal.querySelector(`#searchClear-${this.uniqueId}`);
      if (input) input.value = '';
      if (clearBtn) clearBtn.style.display = 'none';
      
      const content = this.modal.querySelector(`#searchContent-${this.uniqueId}`);
      if (content) {
        content.innerHTML = `
          <div class="search-empty-${this.uniqueId}">
            <i class="fas fa-search"></i>
            <p>Que souhaitez-vous trouver ?</p>
            <p style="font-size: 0.9rem; margin-top: 0.5rem;">Tapez au moins 2 caractères</p>
          </div>
        `;
      }
    }, 300);
  }
  
  async performSearch(searchTerm) {
    const contentDiv = this.modal.querySelector(`#searchContent-${this.uniqueId}`);
    
    if (!searchTerm || searchTerm.length < this.options.minChars) {
      contentDiv.innerHTML = `
        <div class="search-empty-${this.uniqueId}">
          <i class="fas fa-search"></i>
          <p>Tapez au moins ${this.options.minChars} caractères</p>
        </div>
      `;
      return;
    }
    
    contentDiv.innerHTML = `
      <div class="search-loading-${this.uniqueId}">
        <div class="search-loading-spinner-${this.uniqueId}"></div>
        <p style="margin-top: 1rem;">Recherche en cours...</p>
      </div>
    `;
    
    try {
      saveSmartcutSearchTerm(searchTerm);
      const searchLower = searchTerm.toLowerCase();
      
      const [products, presentations, health, services, formations] = await Promise.all([
        this.searchProducts(searchTerm),
        this.searchPresentations(searchTerm),
        this.searchHealth(searchTerm),
        this.searchServices(searchTerm),
        this.searchFormations(searchTerm)
      ]);

      this.currentResults = { products, presentations, health, services, formations };
      this.renderResults(contentDiv, searchTerm);
      
    } catch (error) {
      console.error('❌ Erreur recherche:', error);
      contentDiv.innerHTML = `
        <div class="search-empty-${this.uniqueId}">
          <i class="fas fa-exclamation-triangle" style="color: #7F1D1D;"></i>
          <p>La recherche n'a pas abouti. Vérifiez votre connexion et réessayez.</p>
        </div>
      `;
    }
  }
  
  async searchProducts(searchTerm) {
    const tokens = scTokenize(searchTerm);
    if (!tokens.length) return [];

    let products = [];
    try {
      // Un seul chargement (produits + vendeurs, visibilité déjà appliquée), mis en cache
      // pour toute la session au lieu d'un getDocs de collection entière à chaque frappe.
      products = await cachedSearchSource('products', () => loadPublicProducts({ maxPerCollection: 500 }));
    } catch (error) {
      console.warn('⚠️ Chargement du catalogue pour la recherche impossible:', error);
      return [];
    }

    return products
      .filter((product) => isPublicProductVisible(product) && scMatchesAll(
        [product.name, product.shortDescription, product.description, product.sku,
         product.categoryName, product.vendorName, product.shopName]
          .filter(Boolean).join(' '),
        tokens
      ))
      .sort((a, b) => this.getSearchPriority(b) - this.getSearchPriority(a)
        || String(a.name || '').localeCompare(String(b.name || '')))
      .slice(0, this.options.maxResults);
  }

  isProVendorProduct(product = {}) {
    const planId = String(product.planId || '').toLowerCase();
    const planLabel = String(product.planLabel || '').toLowerCase();
    return String(product.sourceCollection || '') === 'vendorProducts'
      && Boolean(product.vendorVerified || planId === 'pro' || planLabel.includes('pro'));
  }

  getSearchPriority(product = {}) {
    return this.isProVendorProduct(product) ? 10 : 0;
  }
  
  async searchPresentations(searchTerm) {
    const tokens = scTokenize(searchTerm);
    if (!tokens.length) return [];

    let entries = [];
    try {
      entries = await cachedSearchSource('presentations', async () => {
        const collectionsToTry = ['presentations', 'articles'];
        const merged = [];
        const seen = new Set();
        for (const collectionName of collectionsToTry) {
          try {
            const snapshot = await getDocs(query(collection(db, collectionName), limit(300)));
            snapshot.forEach((docSnap) => {
              const entry = { id: docSnap.id, ...docSnap.data() };
              entry.articleId = entry.articleId || entry.id;
              const key = `${collectionName}:${entry.articleId}`;
              if (!seen.has(key)) { seen.add(key); merged.push(entry); }
            });
          } catch (error) {
            console.warn(`⚠️ Source articles ignorée (${collectionName}):`, error);
          }
        }
        return merged;
      });
    } catch (error) {
      console.warn('⚠️ Chargement des articles pour la recherche impossible:', error);
      return [];
    }

    return entries
      .filter((entry) => scMatchesAll(
        [entry.title, entry.subtitle, entry.content].filter(Boolean).join(' '),
        tokens
      ))
      .slice(0, this.options.presentationsPerPage);
  }

  async searchHealth(searchTerm) {
    const tokens = scTokenize(searchTerm);
    if (!tokens.length) return [];

    let data;
    try {
      data = await cachedSearchSource('health', async () => {
        const get = async (fn, key) => {
          try {
            const response = await fetch(`${HEALTH_FN_BASE}/${fn}`);
            const payload = await response.json().catch(() => ({}));
            return Array.isArray(payload?.[key]) ? payload[key] : [];
          } catch (_) {
            return [];
          }
        };
        const [doctors, laboratories, exams] = await Promise.all([
          get('healthListDoctors', 'doctors'),
          get('healthListLaboratories', 'laboratories'),
          get('healthListLabExams', 'exams')
        ]);
        return { doctors, laboratories, exams };
      });
    } catch (_) {
      return [];
    }

    const rows = [];
    (data.doctors || []).forEach((d) => {
      if (scMatchesAll([d.name, d.specialty, d.facility, d.commune, d.department].filter(Boolean).join(' '), tokens)) {
        rows.push({ kind: 'doctor', id: d.id, title: d.name || 'Médecin',
          subtitle: [d.specialty, d.commune].filter(Boolean).join(' · '), href: './health-medecins.html' });
      }
    });
    (data.laboratories || []).forEach((l) => {
      if (scMatchesAll([l.name, l.commune, l.department, l.address].filter(Boolean).join(' '), tokens)) {
        rows.push({ kind: 'lab', id: l.id, title: l.name || 'Laboratoire',
          subtitle: [l.commune, l.department].filter(Boolean).join(' · '), href: './health-laboratoires.html' });
      }
    });
    (data.exams || []).forEach((e) => {
      if (scMatchesAll([e.name, e.description, e.specimen].filter(Boolean).join(' '), tokens)) {
        rows.push({ kind: 'exam', id: e.id, title: e.name || 'Examen',
          subtitle: e.description ? String(e.description).slice(0, 60) : 'Examen de laboratoire',
          href: './health-laboratoires.html' });
      }
    });
    return rows.slice(0, this.options.maxResults);
  }

  async searchServices(searchTerm) {
    const tokens = scTokenize(searchTerm);
    if (!tokens.length) return [];

    let services = [];
    try {
      services = await cachedSearchSource('services', async () => {
        const response = await marketplaceApi('PublicServices', { query: { limit: 60 } });
        return Array.isArray(response?.services) ? response.services : [];
      });
    } catch (_) {
      return [];
    }

    return services
      .filter((s) => scMatchesAll(
        [s.name, s.title, s.summary, s.shortDescription, s.description, s.categoryId].filter(Boolean).join(' '),
        tokens
      ))
      .slice(0, this.options.maxResults)
      .map((s) => ({
        icon: 'fa-briefcase',
        badge: 'Service',
        title: s.name || s.title || 'Service professionnel',
        subtitle: String(s.summary || s.shortDescription || s.description || 'Prestation professionnelle vérifiée').slice(0, 60),
        href: s.slug ? `./service.html?slug=${encodeURIComponent(s.slug)}` : './services.html'
      }));
  }

  async searchFormations(searchTerm) {
    const tokens = scTokenize(searchTerm);
    if (!tokens.length) return [];

    let programs = [];
    try {
      programs = await cachedSearchSource('formations', async () => {
        const mod = await import('./education-repository.js?v=20260901-1');
        const list = await mod.listPublishedPrograms({ limit: 200 });
        return Array.isArray(list) ? list : [];
      });
    } catch (_) {
      return [];
    }

    return programs
      .filter((p) => scMatchesAll(
        [p.title, p.shortDescription, p.fullDescription, p.level, p.commune, p.department].filter(Boolean).join(' '),
        tokens
      ))
      .slice(0, this.options.maxResults)
      .map((p) => ({
        icon: 'fa-graduation-cap',
        badge: 'Formation',
        title: p.title || 'Formation',
        subtitle: String(p.shortDescription || [p.level, p.commune].filter(Boolean).join(' · ') || 'Formation professionnelle').slice(0, 60),
        href: p.slug ? `./education-programme.html?slug=${encodeURIComponent(p.slug)}` : `./education-programme.html?id=${encodeURIComponent(p.id || '')}`
      }));
  }
  
  getImagePath(filename) {
    return resolveImagePath(filename, this.options.imageBasePath);
  }
  
  renderResults(container, searchTerm) {
    const { products, presentations, health, services, formations } = this.currentResults;
    const healthRows = Array.isArray(health) ? health : [];
    const serviceRows = Array.isArray(services) ? services : [];
    const formationRows = Array.isArray(formations) ? formations : [];
    const totalResults = products.length + presentations.length + healthRows.length
      + serviceRows.length + formationRows.length;
    
    if (totalResults === 0) {
      container.innerHTML = `
        <div class="search-empty-${this.uniqueId}">
          <i class="fas fa-search"></i>
          <p>Aucun résultat pour « ${String(searchTerm).replace(/[<>]/g, '')} ». Essayez un autre mot ou vérifiez l'orthographe.</p>
        </div>
      `;
      return;
    }
    
    let html = '';
    
    if (products.length > 0) {
      html += `
        <div class="search-section-${this.uniqueId}">
          <h3 class="search-section-title-${this.uniqueId}">
            Produits (${products.length})
          </h3>
          <div class="search-grid-${this.uniqueId}">
            ${products.map(product => this.renderProductCard(product)).join('')}
          </div>
        </div>
      `;
    }
    
    if (healthRows.length > 0) {
      html += `
        <div class="search-section-${this.uniqueId}">
          <h3 class="search-section-title-${this.uniqueId}">
            Santé (${healthRows.length})
          </h3>
          <div class="search-grid-${this.uniqueId}">
            ${healthRows.map(row => this.renderHealthCard(row)).join('')}
          </div>
        </div>
      `;
    }

    if (serviceRows.length > 0) {
      html += `
        <div class="search-section-${this.uniqueId}">
          <h3 class="search-section-title-${this.uniqueId}">
            Services professionnels (${serviceRows.length})
          </h3>
          <div class="search-grid-${this.uniqueId}">
            ${serviceRows.map(row => this.renderLinkCard(row)).join('')}
          </div>
        </div>
      `;
    }

    if (formationRows.length > 0) {
      html += `
        <div class="search-section-${this.uniqueId}">
          <h3 class="search-section-title-${this.uniqueId}">
            Formations (${formationRows.length})
          </h3>
          <div class="search-grid-${this.uniqueId}">
            ${formationRows.map(row => this.renderLinkCard(row)).join('')}
          </div>
        </div>
      `;
    }

    if (presentations.length > 0) {
      html += `
        <div class="search-section-${this.uniqueId}">
          <h3 class="search-section-title-${this.uniqueId}">
            Articles (${presentations.length})
          </h3>
          <div class="search-grid-${this.uniqueId}">
            ${presentations.map(presentation => this.renderPresentationCard(presentation)).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = html;
    this.attachResultClickEvents();
  }
  
  renderProductCard(product) {
    const productImages = getResolvedProductImages(product, this.options.imageBasePath);
    const imageUrl = productImages[0] || getFallbackProductImage(product, this.options.imageBasePath);
    const fallbackImage = getFallbackProductImage(product, this.options.imageBasePath);
    
    const productPrice = this.formatPriceHTG(product.price || 0);
    const oldPrice = product.comparePrice ? this.formatPriceHTG(product.comparePrice) : null;
    const isProVendorProduct = this.isProVendorProduct(product);

    return `
      <div class="search-card-${this.uniqueId}" data-type="product" data-id="${product.id}">
        <div class="search-card-image-${this.uniqueId}">
          ${imageUrl ? 
            `<img src="${imageUrl}" alt="${product.name || ''}" onerror="this.onerror=null;this.src='${fallbackImage}';">` : 
            '<i class="fas fa-image"></i>'
          }
        </div>
        <div class="search-card-content-${this.uniqueId}">
          <div class="search-card-title-${this.uniqueId}">${product.name || 'Produit sans nom'}</div>
          ${product.shortDescription ? `<div class="search-card-subtitle-${this.uniqueId}">${product.shortDescription.substring(0, 60)}${product.shortDescription.length > 60 ? '...' : ''}</div>` : ''}
          <div>
            <span class="search-card-price-${this.uniqueId}">${productPrice}</span>
            ${oldPrice ? `<span class="search-card-oldprice-${this.uniqueId}">${oldPrice}</span>` : ''}
          </div>
          <span class="search-card-badge-${this.uniqueId}">${isProVendorProduct ? 'Store verifie' : 'Produit'}</span>
        </div>
      </div>
    `;
  }
  
  renderPresentationCard(presentation) {
    const imageUrl = presentation.image ? this.getImagePath(presentation.image) : '';
    
    return `
      <div class="search-card-${this.uniqueId}" data-type="presentation" data-id="${presentation.id}" data-article-id="${presentation.articleId || ''}">
        <div class="search-card-image-${this.uniqueId}">
          ${imageUrl ? 
            `<img src="${imageUrl}" alt="${presentation.title || ''}" onerror="this.src=''; this.parentElement.innerHTML='<i class=\'fas fa-image\'></i>';">` : 
            '<i class="fas fa-image"></i>'
          }
        </div>
        <div class="search-card-content-${this.uniqueId}">
          <div class="search-card-title-${this.uniqueId}">${presentation.title || 'Article sans titre'}</div>
          ${presentation.subtitle ? `<div class="search-card-subtitle-${this.uniqueId}">${presentation.subtitle.substring(0, 60)}${presentation.subtitle.length > 60 ? '...' : ''}</div>` : ''}
          <span class="search-card-badge-${this.uniqueId}">Article</span>
        </div>
      </div>
    `;
  }
  
  renderHealthCard(row) {
    const icons = { doctor: 'fa-user-doctor', lab: 'fa-flask-vial', exam: 'fa-vial' };
    const badges = { doctor: 'Médecin', lab: 'Laboratoire', exam: 'Examen' };
    return this.renderLinkCard({
      icon: icons[row.kind] || 'fa-heart-pulse',
      badge: badges[row.kind] || 'Santé',
      title: row.title,
      subtitle: row.subtitle,
      href: row.href
    });
  }

  renderLinkCard(row) {
    const safe = (v) => String(v || '').replace(/[<>]/g, '');
    return `
      <div class="search-card-${this.uniqueId}" data-type="link" data-href="${safe(row.href)}">
        <div class="search-card-image-${this.uniqueId}">
          <i class="fas ${row.icon || 'fa-arrow-right'}"></i>
        </div>
        <div class="search-card-content-${this.uniqueId}">
          <div class="search-card-title-${this.uniqueId}">${safe(row.title)}</div>
          ${row.subtitle ? `<div class="search-card-subtitle-${this.uniqueId}">${safe(row.subtitle)}</div>` : ''}
          <span class="search-card-badge-${this.uniqueId}">${safe(row.badge || 'Lien')}</span>
        </div>
      </div>
    `;
  }

  attachResultClickEvents() {
    const cards = this.modal.querySelectorAll(`.search-card-${this.uniqueId}`);
    
    cards.forEach(card => {
      card.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        
        const type = card.dataset.type;
        const id = card.dataset.id;
        const articleId = card.dataset.articleId;
        
        
        this.close();
        
        if (type === 'product') {
          try {
            const module = await import('./product-modal.js?v=20260901-1');
            const ProductModal = module.default;
            
            new ProductModal({
              productId: id,
              imageBasePath: this.options.imageBasePath
            });
          } catch (error) {
            console.error('❌ Erreur ouverture produit:', error);
          }
        } else if (type === 'presentation' && articleId) {
          const event = new CustomEvent('openArticle', {
            detail: { articleId: articleId }
          });
          document.dispatchEvent(event);
        } else if ((type === 'health' || type === 'link') && card.dataset.href) {
          window.location.href = card.dataset.href;
        }
      });
    });
  }
  
  static openSearch() {
    if (window.__searchInstance) {
      window.__searchInstance.open();
    }
  }
  
  static closeSearch() {
    if (window.__searchInstance) {
      window.__searchInstance.close();
    }
  }
  
  destroy() {
    if (this.unsubscribeTheme) {
      this.unsubscribeTheme();
    }
    if (this.boundTriggerClickHandler) {
      document.removeEventListener('click', this.boundTriggerClickHandler);
      this.boundTriggerClickHandler = null;
    }
  }
}

let searchInstance = null;

export function getSearchManager(options = {}) {
  if (!searchInstance) {
    searchInstance = new SearchComponent(options);
    window.__searchInstance = searchInstance;
  }
  return searchInstance;
}

export default SearchComponent;
