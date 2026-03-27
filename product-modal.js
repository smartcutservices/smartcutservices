// ============= PRODUCT MODAL COMPONENT =============
import { db } from './firebase-init.js';
import { findPublicProductById, loadPublicProducts } from './catalog-products.js';
import { getLikeManager } from './like.js';
import { getFallbackProductImage, getResolvedProductImages, resolveImagePath } from './image-fallbacks.js';
import { buildProductPageUrl } from './product-links.js';
import { 
  doc, getDoc, collection, query, getDocs, limit 
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class ProductModal {
  constructor(options = {}) {
    this.options = {
      productId: null,
      collectionName: 'products',
      imageBasePath: './',
      onClose: null,
      onAddToCart: null,
      ...options
    };
    
    this.product = null;
    this.relatedProducts = [];
    this.selectedOptions = new Map();
    this.currentImageIndex = 0;
    this.currentVariationIndex = 0;
    this.selectedQuantity = 1;
    this.variationQuantities = new Map();
    this.likeManager = getLikeManager();
    this.onLikesUpdated = () => this.syncLikeButton();
    this.isFullscreen = false;
    this.uniqueId = 'modal_' + Math.random().toString(36).substr(2, 9);
    this.historyStateId = `product_modal_${this.uniqueId}`;
    this.modalHistoryActive = false;
    this.fullscreenHistoryActive = false;
    this.isClosing = false;
    this.handlePopState = () => {
      if (!this.modalElement) return;

      if (this.isFullscreen && this.fullscreenHistoryActive) {
        this.fullscreenHistoryActive = false;
        this.closeFullscreen(false);
        return;
      }

      this.modalHistoryActive = false;
      this.performClose();
    };
    this.handleKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (this.isFullscreen) {
        this.closeFullscreen();
        return;
      }
      this.close();
    };
    
    this.init();
  }
  
  async init() {
    if (!this.options.productId) {
      console.error('❌ ProductModal: ID produit requis');
      return;
    }
    
    await this.loadProduct();
    await this.loadRelatedProducts();
    this.render();
    this.attachEvents();
    this.loadFromLocalStorage();
    this.animateIn();
    this.setupHistoryState();
    
    // Bloquer le scroll du body
    document.body.style.overflow = 'hidden';
  }
  
  async loadProduct() {
    try {
      if (this.options.collectionName === 'products') {
        this.product = await findPublicProductById(this.options.productId);
        if (!this.product) {
          console.error('âŒ Produit non trouvÃ©');
        }
        return;
      }

      const docRef = doc(db, this.options.collectionName, this.options.productId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        this.product = {
          id: docSnap.id,
          ...docSnap.data()
        };
      } else {
        console.error('❌ Produit non trouvé');
      }
    } catch (error) {
      console.error('❌ Erreur chargement produit:', error);
    }
  }
  
  async loadRelatedProducts() {
    try {
      const products = this.options.collectionName === 'products'
        ? await loadPublicProducts({ maxPerCollection: 30 })
        : (await getDocs(query(
            collection(db, this.options.collectionName),
            limit(30)
          ))).docs
        .map(doc => ({
          id: doc.id,
          ...doc.data()
        }))
        .filter(p => p.id !== this.options.productId)
        .filter(p => this.isProductVisible(p));
      
      if (this.product?.categoryId) {
        const sameCategory = products.filter(p => p.categoryId === this.product.categoryId);
        const others = products.filter(p => p.categoryId !== this.product.categoryId);
        this.relatedProducts = [...sameCategory, ...others].slice(0, 6);
      } else {
        this.relatedProducts = products.slice(0, 6);
      }
    } catch (error) {
      console.error('❌ Erreur chargement produits liés:', error);
    }
  }
  
  isProductVisible(product) {
    if (typeof product?.status === 'string') return product.status === 'active';
    if (typeof product?.active === 'boolean') return product.active !== false;
    return true;
  }
  
  getImagePath(filename) {
    return resolveImagePath(filename, this.options.imageBasePath);
  }
  
  formatPrice(price) {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency', 
      currency: 'HTG',
      minimumFractionDigits: 2
    }).format(price || 0);
  }
  
  toNumber(value, fallback = 0) {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  }
  
  getVariationEffectivePrice(variation, product = this.product) {
    const variationPrice = this.toNumber(variation?.price, NaN);
    if (Number.isFinite(variationPrice) && variationPrice > 0) return variationPrice;
    return this.toNumber(product?.price, 0);
  }
  
  getProductImages(product = this.product) {
    return getResolvedProductImages(product, this.options.imageBasePath);
  }
  
  getProductPrimaryImage(product = this.product) {
    const images = this.getProductImages(product);
    return images[0] || '';
  }
  
  getProductDisplayPrice(product = this.product) {
    const variations = Array.isArray(product?.variations) ? product.variations : [];
    if (variations.length === 0) {
      const price = this.toNumber(product?.price, 0);
      return { text: this.formatPrice(price), value: price };
    }
    
    const prices = variations.map(v => this.getVariationEffectivePrice(v, product));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min === max) return { text: this.formatPrice(min), value: min };
    return { text: `${this.formatPrice(min)} - ${this.formatPrice(max)}`, value: min };
  }
  
  getCurrentDisplayImages() {
    return this.getProductImages(this.product);
  }

  getProductShareUrl() {
    const path = buildProductPageUrl(this.product?.id || this.options.productId || '');
    return new URL(path, window.location.href).toString();
  }

  getProductPageUrl(productId = this.product?.id || this.options.productId || '') {
    return buildProductPageUrl(productId);
  }

  navigateToProduct(productId) {
    if (!productId) return;
    window.location.href = this.getProductPageUrl(productId);
  }

  getProductShareText() {
    const productName = this.product?.name || 'Produit Smart Cut Services';
    return `Decouvrez ce produit : ${productName}`;
  }
  
  getVariationLabel(variation) {
    const parts = [];
    if (variation?.color) parts.push(variation.color);
    if (variation?.size) parts.push(variation.size);
    if (variation?.volume) parts.push(variation.volume);
    if (Array.isArray(variation?.customOptions)) {
      variation.customOptions.forEach(opt => {
        if (opt?.name && opt?.value) parts.push(`${opt.name}: ${opt.value}`);
      });
    }
    return parts.join(' • ') || variation?.sku || 'Variation';
  }

  toStockLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return Infinity;
    return Math.max(0, Math.floor(parsed));
  }

  getCartItems() {
    try {
      const cart = JSON.parse(localStorage.getItem('veltrixa_cart') || '[]');
      return Array.isArray(cart) ? cart : [];
    } catch (error) {
      console.warn('⚠️ Impossible de lire le panier local:', error);
      return [];
    }
  }

  getSelectedSizeValue() {
    const selectedSize = this.selectedOptions.get('size');
    return selectedSize?.value || null;
  }

  getSelectedSizeStockLimit() {
    const sizeValue = this.getSelectedSizeValue();
    if (!sizeValue || !Array.isArray(this.product?.sizes)) return Infinity;
    const sizeData = this.product.sizes.find((size) => String(size?.size || '') === String(sizeValue));
    if (!sizeData) return Infinity;
    return this.toStockLimit(sizeData?.quantity);
  }

  getVariationStockLimit(variationIndex) {
    const variation = this.product?.variations?.[variationIndex];
    return this.toStockLimit(variation?.stock);
  }

  getBaseStockLimit() {
    const sizeLimit = this.getSelectedSizeStockLimit();
    const productLimit = this.toStockLimit(this.product?.stock);
    return Math.min(sizeLimit, productLimit);
  }

  getCartQuantityForVariation(variationIndex) {
    return this.getCartItems().reduce((total, item) => {
      if (item?.productId !== this.product?.id) return total;
      const options = Array.isArray(item?.selectedOptions) ? item.selectedOptions : [];
      const hasVariation = options.some((opt) => Number(opt?.variationIndex) === Number(variationIndex));
      if (!hasVariation) return total;
      return total + (Number(item?.quantity) || 0);
    }, 0);
  }

  getCartQuantityForBaseSelection() {
    const selectedSize = this.getSelectedSizeValue();
    return this.getCartItems().reduce((total, item) => {
      if (item?.productId !== this.product?.id) return total;
      const options = Array.isArray(item?.selectedOptions) ? item.selectedOptions : [];
      const hasVariation = options.some((opt) => {
        const value = opt?.variationIndex;
        if (value === '' || value === null || value === undefined) return false;
        return Number.isInteger(Number(value));
      });
      if (hasVariation) return total;
      if (selectedSize) {
        const sameSize = options.some((opt) => opt?.type === 'size' && String(opt?.value || '') === String(selectedSize));
        if (!sameSize) return total;
      }
      return total + (Number(item?.quantity) || 0);
    }, 0);
  }

  getAvailableVariationQuantity(variationIndex) {
    const limit = this.getVariationStockLimit(variationIndex);
    if (!Number.isFinite(limit)) return Infinity;
    return Math.max(0, limit - this.getCartQuantityForVariation(variationIndex));
  }

  getAvailableBaseQuantity() {
    const limit = this.getBaseStockLimit();
    if (!Number.isFinite(limit)) return Infinity;
    return Math.max(0, limit - this.getCartQuantityForBaseSelection());
  }

  getCurrentSelectionWeight(variationData = null) {
    const variationWeight = Number(variationData?.weightGrams ?? variationData?.weight);
    if (Number.isFinite(variationWeight) && variationWeight > 0) {
      return variationWeight;
    }
    const productWeight = Number(this.product?.weightGrams ?? this.product?.weight);
    if (Number.isFinite(productWeight) && productWeight > 0) {
      return productWeight;
    }
    return 0;
  }
  
  render() {
    if (!this.product) {
      this.renderError();
      return;
    }
    
    const images = this.getProductImages(this.product);
    const mainImage = images[this.currentImageIndex] || '';
    
    // Créer l'overlay du modal avec z-index ultra élevé
    const modalHTML = `
     <div class="product-modal-overlay-${this.uniqueId}" style="
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100vw;
  height: 100vh;
  background: rgb(255, 255, 255);
  backdrop-filter: blur(5px);
  z-index: 999999;
  display: flex;
  align-items: stretch;
  justify-content: stretch;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  margin: 0;
  box-sizing: border-box;
">
        <div class="product-modal-container-${this.uniqueId}" style="
          background: #F5F1E8;
          
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          width: 100%;
          min-height: 100vh;
          overflow: visible;
          position: relative;
          display: flex;
          flex-direction: column;
          animation: modalSlideIn 0.3s ease;
        ">
          
          <!-- Header mobile -->
          <div class="md:hidden flex justify-between items-center gap-3 p-4 border-b border-secondary/20" style="flex-shrink: 0;">
            <button class="back-modal-btn" type="button" style="display: inline-flex; align-items: center; gap: 0.4rem; border: none; background: transparent; color: #1F1E1C; cursor: pointer; font-weight: 600;">
              <i class="fas fa-arrow-left"></i>
              <span>Retour</span>
            </button>
            <h2 class="font-primary text-lg truncate" style="font-family: 'Cormorant Garamond', serif; flex: 1; text-align: center;">${this.product.name || 'Produit'}</h2>
            <button class="close-modal-btn" type="button" style="width: 40px; height: 40px; border-radius: 50%; background: rgba(31, 30, 28, 0.1); display: flex; align-items: center; justify-content: center; border: none; cursor: pointer; flex-shrink: 0;">
              <i class="fas fa-times" style="font-size: 1.25rem;"></i>
            </button>
          </div>
          
          <!-- Close button desktop -->
          <button class="close-modal-btn hidden md:flex" style="
            position: absolute;
            top: 1rem;
            right: 1rem;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: rgba(31, 30, 28, 0.1);
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 20;
            transition: background 0.2s;
          " onmouseover="this.style.background='rgba(31, 30, 28, 0.2)'" onmouseout="this.style.background='rgba(31, 30, 28, 0.1)'">
            <i class="fas fa-times" style="font-size: 1.25rem;"></i>
          </button>
          
          <div class="product-modal-main-scroll" style="flex: 1 1 auto; overflow-y: auto; min-height: 0; -webkit-overflow-scrolling: touch;">
            <!-- Version Desktop (flex row) -->
            <div class="hidden md:flex" style="min-height: calc(100vh - 1px); align-items: flex-start;">
              <!-- Partie Gauche - Images -->
              <div style="width: 50%; padding: 1.5rem; border-right: 1px solid rgba(198, 167, 94, 0.2); overflow: visible; align-self: stretch;">
                <div class="product-images-desktop-root">
                  ${this.renderDesktopImages()}
                </div>
              </div>
              
              <!-- Partie Droite - Infos -->
              <div style="width: 50%; padding: 1.5rem; overflow: visible; align-self: stretch;">
                ${this.renderProductInfo()}
                ${this.renderRelatedProducts()}
              </div>
            </div>
            
            <!-- Version Mobile (flex column) -->
            <div class="md:hidden">
              <!-- Images en haut -->
              <div style="padding: 0.85rem 0.85rem 0;">
                <div style="
                  height: min(48vh, 400px);
                  min-height: 240px;
                  position: relative;
                  border-radius: 1.25rem;
                  overflow: hidden;
                  background: #FFFFFF;
                  box-shadow: 0 12px 26px rgba(31, 30, 28, 0.08);
                  border: 1px solid rgba(198, 167, 94, 0.14);
                ">
                  <div class="product-images-mobile-root">
                    ${this.renderMobileImages()}
                  </div>
                </div>
              </div>
              
              <!-- Infos en bas -->
              <div style="padding: 0 0.85rem 1.4rem;">
                <div style="
                  margin-top: 0.8rem;
                  padding: 1.15rem 1rem 1.5rem;
                  background: rgba(255, 255, 255, 0.94);
                  border-radius: 1.25rem;
                  box-shadow: 0 14px 30px rgba(31, 30, 28, 0.08);
                  border: 1px solid rgba(198, 167, 94, 0.16);
                ">
                  ${this.renderProductInfo()}
                  ${this.renderRelatedProducts()}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Fullscreen Image Viewer avec z-index encore plus élevé -->
      <div class="fullscreen-viewer-${this.uniqueId}" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.95);
        z-index: 1000000;
        display: none;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        margin: 0;
        padding: 0;
      ">
        <button class="close-fullscreen-btn" style="
          position: absolute;
          top: 1rem;
          right: 1rem;
          color: white;
          background: none;
          border: none;
          font-size: 2rem;
          cursor: pointer;
          z-index: 10;
          width: 50px;
          height: 50px;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <i class="fas fa-times"></i>
        </button>
        <div style="position: relative; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;">
          <img src="" alt="" class="fullscreen-img" style="max-width: 95%; max-height: 95%; object-fit: contain;">
          <button class="fullscreen-prev" style="
            position: absolute;
            left: 1rem;
            color: white;
            background: none;
            border: none;
            font-size: 3rem;
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.2s;
          " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">
            <i class="fas fa-chevron-left"></i>
          </button>
          <button class="fullscreen-next" style="
            position: absolute;
            right: 1rem;
            color: white;
            background: none;
            border: none;
            font-size: 3rem;
            cursor: pointer;
            opacity: 0.5;
            transition: opacity 0.2s;
          " onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.5'">
            <i class="fas fa-chevron-right"></i>
          </button>
          <div class="fullscreen-counter" style="
            position: absolute;
            bottom: 1rem;
            color: white;
            background: rgba(0,0,0,0.5);
            padding: 0.25rem 1rem;
            border-radius: 2rem;
            font-size: 0.875rem;
          ">
            ${this.currentImageIndex + 1}/${images.length}
          </div>
        </div>
      </div>
      
      <style>
        @keyframes modalSlideIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        
        /* Styles pour les options */
        .option-item {
          transition: all 0.2s ease;
          cursor: pointer;
          border: 2px solid transparent;
        }
        
        .option-item.selected {
          border-color: #C6A75E !important;
          background: rgba(198, 167, 94, 0.1) !important;
        }
        
        /* Scrollbar personnalisée */
        .product-modal-container-${this.uniqueId} ::-webkit-scrollbar {
          width: 6px;
        }
        
        .product-modal-container-${this.uniqueId} ::-webkit-scrollbar-track {
          background: rgba(0,0,0,0.05);
        }
        
        .product-modal-container-${this.uniqueId} ::-webkit-scrollbar-thumb {
          background: #C6A75E;
          border-radius: 3px;
        }
        
        /* Grille d'images desktop */
        .desktop-image-grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 1rem;
        }
        
        .desktop-image-item {
          aspect-ratio: 1;
          cursor: pointer;
          overflow: hidden;
          border-radius: 0.5rem;
          transition: all 0.3s;
        }
        
        .desktop-image-item:hover {
          transform: scale(1.02);
          box-shadow: 0 10px 20px rgba(0,0,0,0.1);
        }
        
        .desktop-image-item img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }
        
        /* Carousel mobile */
        .mobile-image-carousel {
          height: 100%;
          position: relative;
        }
        
        .mobile-image-container {
          height: 100%;
          display: flex;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
        }
        
        .mobile-image-container::-webkit-scrollbar {
          display: none;
        }
        
        .mobile-image-slide {
          flex: 0 0 100%;
          scroll-snap-align: start;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        
        .mobile-image-slide img {
          width: 100%;
          height: 100%;
          object-fit: contain;
        }
        
        .mobile-nav-btn {
          position: absolute;
          top: 50%;
          transform: translateY(-50%);
          width: 40px;
          height: 40px;
          background: rgba(255,255,255,0.8);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }
        
        .mobile-nav-btn:hover {
          background: white;
        }
        
        .mobile-nav-btn.left {
          left: 10px;
        }
        
        .mobile-nav-btn.right {
          right: 10px;
        }
        
        /* Carousel produits liés */
        .related-products-carousel {
          display: flex;
          gap: 1rem;
          overflow-x: auto;
          scroll-snap-type: x mandatory;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: thin;
          padding-bottom: 0.5rem;
        }
        
        .related-products-carousel .product-card {
          flex: 0 0 200px;
          scroll-snap-align: start;
          cursor: pointer;
        }

        .related-products-carousel .related-product-media {
          aspect-ratio: 1;
          background: #FFFFFF;
          border-radius: 0.5rem;
          overflow: hidden;
          margin-bottom: 0.5rem;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.35rem;
        }

        .related-products-carousel .related-product-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.3s;
        }
        
        @media (min-width: 768px) {
          .related-products-carousel .product-card {
            flex: 0 0 180px;
          }
        }

        @media (max-width: 767px) {
          .related-products-carousel .product-card {
            flex: 0 0 165px;
          }

          .related-products-carousel .related-product-image {
            object-fit: contain;
          }
        }
        
        .product-card:hover {
          transform: translateY(-2px);
        }
        
        .product-card:hover .related-product-image {
          transform: scale(1.1);
        }
        
        /* Line clamp */
        .line-clamp-2 {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        
        /* Animation de pulsation pour le bouton */
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
        
        .add-to-cart-btn {
          animation: pulse 2s infinite;
        }
        
        /* Empêcher le scroll du body */
        body.modal-open {
          overflow: hidden !important;
        }
      </style>
    `;
    
    // Ajouter au body
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    this.modalElement = document.querySelector(`.product-modal-overlay-${this.uniqueId}`);
    this.fullscreenViewer = document.querySelector(`.fullscreen-viewer-${this.uniqueId}`);
    
    // Ajouter la classe modal-open au body
    document.body.classList.add('modal-open');
  }
  
  renderDesktopImages() {
    const images = this.getCurrentDisplayImages();
    if (images.length === 0) {
      return '<div style="text-align: center; padding: 2rem; color: #8B7E6B;">Aucune image</div>';
    }
    
    return `
      <div class="desktop-image-grid">
        ${images.map((img, index) => `
          <div class="desktop-image-item" data-index="${index}">
            <img src="${this.getImagePath(img)}" alt="" loading="lazy" onerror="this.onerror=null;this.style.display='none';this.parentNode.innerHTML='<div style=&quot;height:100%;display:flex;align-items:center;justify-content:center;color:#8B7E6B;&quot;>Image indisponible</div>';">
          </div>
        `).join('')}
      </div>
    `;
  }
  
  renderMobileImages() {
    const images = this.getCurrentDisplayImages();
    if (images.length === 0) {
      return '<div style="height:100%;display:flex;align-items:center;justify-content:center;color:#8B7E6B;">Aucune image</div>';
    }
    
    return `
      <div class="mobile-image-carousel">
        <div class="mobile-image-container">
          ${images.map((img, index) => `
            <div class="mobile-image-slide" data-index="${index}">
              <img src="${this.getImagePath(img)}" alt="" loading="lazy" onerror="this.onerror=null;this.style.display='none';this.parentNode.innerHTML='<div style=&quot;height:100%;display:flex;align-items:center;justify-content:center;color:#8B7E6B;&quot;>Image indisponible</div>';">
            </div>
          `).join('')}
        </div>
        
        ${images.length > 1 ? `
          <button class="mobile-nav-btn left">
            <i class="fas fa-chevron-left"></i>
          </button>
          <button class="mobile-nav-btn right">
            <i class="fas fa-chevron-right"></i>
          </button>
          <div class="mobile-image-counter" style="position: absolute; bottom: 1rem; left: 50%; transform: translateX(-50%); background: rgba(0,0,0,0.5); color: white; padding: 0.25rem 1rem; border-radius: 2rem; font-size: 0.875rem;">
            ${this.currentImageIndex + 1}/${images.length}
          </div>
        ` : ''}
      </div>
    `;
  }
  
  refreshDisplayedImages() {
    this.currentImageIndex = 0;
    
    const desktopRoot = this.modalElement?.querySelector('.product-images-desktop-root');
    if (desktopRoot) {
      desktopRoot.innerHTML = this.renderDesktopImages();
    }
    
    const mobileRoot = this.modalElement?.querySelector('.product-images-mobile-root');
    if (mobileRoot) {
      mobileRoot.innerHTML = this.renderMobileImages();
    }
    
    this.bindImageInteractionEvents();
    this.bindMobileNavigationEvents();
  }

  setupHistoryState() {
    if (typeof window === 'undefined' || !window.history?.pushState) return;
    window.history.pushState(
      {
        ...(window.history.state || {}),
        productModalOpen: true,
        productModalId: this.historyStateId
      },
      '',
      window.location.href
    );
    this.modalHistoryActive = true;
    window.addEventListener('popstate', this.handlePopState);
  }

  refreshAddToCartButtons() {
    const remainingBase = this.getAvailableBaseQuantity();
    const hasStockInVariations = Array.isArray(this.product?.variations) && this.product.variations.some((_, index) => {
      const available = this.getAvailableVariationQuantity(index);
      return !Number.isFinite(available) || available > 0;
    });
    const shouldDisable = Array.isArray(this.product?.variations) && this.product.variations.length > 0
      ? !hasStockInVariations
      : Number.isFinite(remainingBase) && remainingBase <= 0;

    this.modalElement?.querySelectorAll('.add-to-cart-btn').forEach((btn) => {
      btn.disabled = shouldDisable;
      btn.style.opacity = shouldDisable ? '0.6' : '1';
      btn.style.cursor = shouldDisable ? 'not-allowed' : 'pointer';
    });
  }

  updateVariationQuantityUI(variationIndex) {
    if (!this.modalElement) return;

    const maxAllowed = this.getAvailableVariationQuantity(variationIndex);
    let qty = this.variationQuantities.get(variationIndex) || 0;
    if (Number.isFinite(maxAllowed) && qty > maxAllowed) {
      qty = maxAllowed;
      if (qty <= 0) this.variationQuantities.delete(variationIndex);
      else this.variationQuantities.set(variationIndex, qty);
    }

    const safeQty = this.variationQuantities.get(variationIndex) || 0;
    const canIncrease = !Number.isFinite(maxAllowed) || safeQty < maxAllowed;
    const variation = this.product?.variations?.[variationIndex];
    const stockLabel = Number.isFinite(this.getVariationStockLimit(variationIndex))
      ? `${variation?.stock ?? 0} en stock`
      : 'Stock disponible';
    const availabilityLabel = Number.isFinite(maxAllowed)
      ? (maxAllowed > 0 ? ` • ${maxAllowed} restant(s) avant blocage` : ' • Stock atteint')
      : '';

    this.modalElement.querySelectorAll(`.variation-qty[data-variation-index="${variationIndex}"]`).forEach((el) => {
      el.textContent = String(safeQty);
    });
    this.modalElement.querySelectorAll(`.variation-item[data-variation-index="${variationIndex}"]`).forEach((el) => {
      el.style.borderColor = safeQty > 0 ? '#C6A75E' : 'transparent';
      el.style.opacity = Number.isFinite(maxAllowed) && maxAllowed <= 0 && safeQty <= 0 ? '0.72' : '1';
    });
    this.modalElement.querySelectorAll(`.variation-stock-meta[data-variation-index="${variationIndex}"]`).forEach((el) => {
      el.textContent = `${this.formatPrice(this.getVariationEffectivePrice(variation, this.product))} • ${stockLabel}${availabilityLabel}`;
    });
    this.modalElement.querySelectorAll(`.variation-qty-inc[data-variation-index="${variationIndex}"]`).forEach((btn) => {
      btn.disabled = !canIncrease;
      btn.style.opacity = canIncrease ? '1' : '0.45';
      btn.style.cursor = canIncrease ? 'pointer' : 'not-allowed';
    });
    this.modalElement.querySelectorAll(`.variation-qty-dec[data-variation-index="${variationIndex}"]`).forEach((btn) => {
      const canDecrease = safeQty > 0;
      btn.disabled = !canDecrease;
      btn.style.opacity = canDecrease ? '1' : '0.45';
      btn.style.cursor = canDecrease ? 'pointer' : 'not-allowed';
    });
  }

  updateStandardQuantityUI() {
    if (!this.modalElement) return;

    const available = this.getAvailableBaseQuantity();
    if (this.selectedQuantity <= 0 && (!Number.isFinite(available) || available > 0)) {
      this.selectedQuantity = 1;
    }
    if (Number.isFinite(available) && this.selectedQuantity > available) {
      this.selectedQuantity = available;
    }

    const maxValue = Number.isFinite(available) ? available : 999;
    const canIncrease = !Number.isFinite(available) || this.selectedQuantity < available;

    this.modalElement.querySelectorAll('.qty-input').forEach((input) => {
      input.value = String(this.selectedQuantity);
      input.max = String(maxValue);
    });
    this.modalElement.querySelectorAll('.qty-increase-btn').forEach((btn) => {
      btn.disabled = !canIncrease;
      btn.style.opacity = canIncrease ? '1' : '0.45';
      btn.style.cursor = canIncrease ? 'pointer' : 'not-allowed';
    });
    this.modalElement.querySelectorAll('.qty-decrease-btn').forEach((btn) => {
      const canDecrease = this.selectedQuantity > 0;
      btn.disabled = !canDecrease;
      btn.style.opacity = canDecrease ? '1' : '0.45';
      btn.style.cursor = canDecrease ? 'pointer' : 'not-allowed';
    });
    this.modalElement.querySelectorAll('.qty-stock-note').forEach((el) => {
      if (!Number.isFinite(this.getBaseStockLimit())) {
        el.textContent = '';
        return;
      }
      el.textContent = available > 0
        ? `${available} unité(s) encore disponible(s) avant blocage`
        : 'Stock déjà atteint dans le panier';
    });
  }

  normalizeSelectedQuantities() {
    if (Array.isArray(this.product?.variations) && this.product.variations.length > 0) {
      this.product.variations.forEach((_, variationIndex) => {
        this.updateVariationQuantityUI(Number(variationIndex));
      });
    } else {
      this.updateStandardQuantityUI();
    }
    this.refreshAddToCartButtons();
  }
  
  bindImageInteractionEvents() {
    this.modalElement?.querySelectorAll('.desktop-image-item').forEach(item => {
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.index, 10);
        this.openFullscreen(index);
      });
    });
    
    this.modalElement?.querySelectorAll('.mobile-image-slide').forEach(slide => {
      slide.addEventListener('click', () => {
        const index = parseInt(slide.dataset.index, 10);
        this.openFullscreen(index);
      });
    });
  }
  
  bindMobileNavigationEvents() {
    const mobileContainer = this.modalElement?.querySelector('.mobile-image-container');
    const leftBtn = this.modalElement?.querySelector('.mobile-nav-btn.left');
    const rightBtn = this.modalElement?.querySelector('.mobile-nav-btn.right');
    
    if (mobileContainer && leftBtn && rightBtn) {
      leftBtn.addEventListener('click', () => {
        mobileContainer.scrollBy({ left: -mobileContainer.clientWidth, behavior: 'smooth' });
      });
      
      rightBtn.addEventListener('click', () => {
        mobileContainer.scrollBy({ left: mobileContainer.clientWidth, behavior: 'smooth' });
      });
      
      mobileContainer.addEventListener('scroll', () => {
        const index = Math.round(mobileContainer.scrollLeft / mobileContainer.clientWidth);
        const counter = this.modalElement.querySelector('.mobile-image-counter');
        if (counter) {
          counter.textContent = `${index + 1}/${this.getCurrentDisplayImages().length || 1}`;
        }
      });
    }
  }
  
  renderProductInfo() {
    const product = this.product;
    const displayPrice = this.getProductDisplayPrice(product);
    const variationsCount = Array.isArray(product.variations) ? product.variations.length : 0;
    
    return `
      <div style="display: flex; flex-direction: column; gap: 1.5rem;">
        <!-- Nom -->
        <h1 style="font-family: 'Cormorant Garamond', serif; font-size: 2rem; color: #1F1E1C; margin: 0;">
          ${product.name || 'Produit sans nom'}
        </h1>
        
        <!-- Description courte -->
        <p style="color: #8B7E6B; margin: 0;">
          ${product.shortDescription || ''}
        </p>
        
        <!-- Prix -->
        <div style="display: flex; align-items: baseline; gap: 1rem;">
          <span class="product-current-price" style="font-size: 2rem; font-weight: bold; color: #1F1E1C;">
            ${displayPrice.text}
          </span>
          ${product.comparePrice && variationsCount <= 1 ? `
            <span class="product-compare-price" style="font-size: 1.25rem; color: #8B7E6B; text-decoration: line-through;">
              ${this.formatPrice(product.comparePrice)}
            </span>
          ` : ''}
        </div>
        
        ${variationsCount > 0 ? `
          <div style="font-size: 0.9rem; color: #8B7E6B;">
            ${variationsCount} variation(s) disponible(s)
          </div>
        ` : ''}
        
        <!-- Options disponibles -->
        ${this.renderOptions()}

        ${variationsCount > 0 ? '' : `
          <!-- Quantité -->
          <div style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 1rem;
            padding: 0.75rem;
            border: 1px solid rgba(198, 167, 94, 0.25);
            border-radius: 0.75rem;
            background: white;
          ">
            <span style="font-weight: 500; color: #1F1E1C;">Quantité</span>
            <div style="display: flex; align-items: center; gap: 0.5rem;">
              <button type="button" class="qty-decrease-btn" style="
                width: 32px;
                height: 32px;
                border: 1px solid rgba(198, 167, 94, 0.4);
                background: #F5F1E8;
                border-radius: 50%;
                cursor: pointer;
              "><i class="fas fa-minus"></i></button>
              <input type="number" class="qty-input" min="0" max="999" value="${this.selectedQuantity}" style="
                width: 64px;
                text-align: center;
                border: 1px solid rgba(198, 167, 94, 0.35);
                border-radius: 0.5rem;
                padding: 0.35rem;
              ">
              <button type="button" class="qty-increase-btn" style="
                width: 32px;
                height: 32px;
                border: 1px solid rgba(198, 167, 94, 0.4);
                background: #F5F1E8;
                border-radius: 50%;
                cursor: pointer;
              "><i class="fas fa-plus"></i></button>
            </div>
          </div>
          <div class="qty-stock-note" style="font-size: 0.8rem; color: #8B7E6B; margin-top: -0.65rem;"></div>
        `}

        <button class="toggle-like-btn" style="
          width: 100%;
          background: white;
          color: #1F1E1C;
          padding: 0.85rem 1rem;
          border: 1px solid rgba(198, 167, 94, 0.35);
          border-radius: 0.5rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          font-size: 0.95rem;
          font-weight: 500;
          transition: all 0.2s;
        ">
          <i class="${this.likeManager?.isLiked(this.product?.id) ? 'fas' : 'far'} fa-heart" style="color:${this.likeManager?.isLiked(this.product?.id) ? '#DC2626' : '#8B7E6B'};"></i>
          <span>${this.likeManager?.isLiked(this.product?.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}</span>
        </button>

        <button class="share-product-btn" style="
          width: 100%;
          background: #F8F5EF;
          color: #1F1E1C;
          padding: 0.85rem 1rem;
          border: 1px solid rgba(198, 167, 94, 0.35);
          border-radius: 0.5rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.55rem;
          font-size: 0.95rem;
          font-weight: 600;
          transition: all 0.2s;
        ">
          <i class="fas fa-share-alt" style="color: #C6A75E;"></i>
          <span>Partager ce produit</span>
        </button>
        <div class="share-product-feedback" style="display:none; margin-top:-0.9rem; font-size:0.82rem; color:#8B7E6B; text-align:center;"></div>
        
        <!-- Bouton Ajouter au panier -->
        <button class="add-to-cart-btn" style="
          width: 100%;
          background: #1F1E1C;
          color: #F5F1E8;
          padding: 1rem;
          border: 1px solid #C6A75E;
          border-radius: 0.5rem;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 0.5rem;
          font-size: 1.125rem;
          font-weight: 500;
          transition: all 0.3s;
          border: none;
        ">
          <i class="fas fa-shopping-cart"></i>
          <span>Ajouter au panier</span>
        </button>
        
        <!-- Description longue -->
        <div style="padding-top: 1rem; border-top: 1px solid rgba(198, 167, 94, 0.2);">
          <h3 style="font-weight: 500; margin-bottom: 0.5rem;">Description</h3>
          <div style="color: #8B7E6B; white-space: pre-line;">
            ${product.longDescription || 'Aucune description disponible.'}
          </div>
        </div>
      </div>
    `;
  }
  
  renderOptions() {
    const options = [];
    
    // Variations (nouvelle structure Dproducts)
    if (Array.isArray(this.product.variations) && this.product.variations.length > 0) {
      options.push(`
        <div class="option-group">
          <h4 style="font-weight: 500; margin-bottom: 0.5rem;">Variations disponibles</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${this.product.variations.map((variation, index) => {
              const label = this.getVariationLabel(variation);
              const image = Array.isArray(variation?.images) ? variation.images[0] || '' : '';
              const price = this.getVariationEffectivePrice(variation, this.product);
              const qty = this.variationQuantities.get(index) || 0;
              return `
                <div class="variation-item"
                     data-type="variation"
                     data-value="${label}"
                     data-variation-index="${index}"
                     data-sku="${variation?.sku || ''}"
                     data-price="${price}"
                     data-image="${image}"
                     style="border: 2px solid ${qty > 0 ? '#C6A75E' : 'transparent'}; border-radius: 0.5rem; padding: 0.5rem; display: flex; flex-direction: column; align-items: stretch; gap: 0.4rem; cursor: pointer; background: white; min-width: 170px;">
                  ${image ? `
                    <div style="width: 100%; aspect-ratio: 1 / 1; border-radius: 0.4rem; overflow: hidden; border: 1px solid rgba(198, 167, 94, 0.25); background: #F5F1E8; display: flex; align-items: center; justify-content: center; padding: 0.3rem;">
                      <img src="${this.getImagePath(image)}" alt="${label}" style="width: 100%; height: 100%; object-fit: contain;" onerror="this.style.display='none'; this.parentElement.innerHTML='<div style=\\'width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:#8B7E6B;\\'><i class=\\'fas fa-image\\'></i></div>';">
                    </div>
                  ` : ''}
                  <span style="font-size: 0.8rem; font-weight: 600; color: #1F1E1C;">${label}</span>
                  <span class="variation-stock-meta" data-variation-index="${index}" style="font-size: 0.75rem; color: #8B7E6B;">${this.formatPrice(price)}${variation?.stock !== undefined ? ` • Stock: ${variation.stock}` : ''}</span>
                  <div style="display:flex; align-items:center; gap:0.4rem; margin-top:0.25rem;">
                    <button type="button" class="variation-qty-dec" data-variation-index="${index}" style="width:26px; height:26px; border:1px solid rgba(198,167,94,0.4); background:#F5F1E8; border-radius:50%; cursor:pointer;">
                      <i class="fas fa-minus" style="font-size:0.7rem;"></i>
                    </button>
                    <span class="variation-qty" data-variation-index="${index}" style="min-width:22px; text-align:center; font-size:0.85rem; font-weight:600;">${qty}</span>
                    <button type="button" class="variation-qty-inc" data-variation-index="${index}" style="width:26px; height:26px; border:1px solid rgba(198,167,94,0.4); background:#F5F1E8; border-radius:50%; cursor:pointer;">
                      <i class="fas fa-plus" style="font-size:0.7rem;"></i>
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `);
    }
    
    // Couleurs
    if (this.product.colors && this.product.colors.length > 0) {
      options.push(`
        <div class="option-group">
          <h4 style="font-weight: 500; margin-bottom: 0.5rem;">Couleurs disponibles</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${this.product.colors.map((color, index) => `
              <div class="option-item" 
                   data-type="color" 
                   data-value="${color.name}"
                   data-image="${color.image || ''}"
                   style="border: 2px solid transparent; border-radius: 0.5rem; padding: 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer;">
                ${color.image ? `
                  <div style="width: 48px; height: 48px; border-radius: 50%; overflow: hidden; border: 2px solid rgba(198, 167, 94, 0.2);">
                    <img src="${this.getImagePath(color.image)}" alt="" style="width: 100%; height: 100%; object-fit: cover;">
                  </div>
                ` : `
                  <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(198, 167, 94, 0.2); display: flex; align-items: center; justify-content: center;">
                    <span style="font-size: 0.875rem;">${color.name?.charAt(0)}</span>
                  </div>
                `}
                <span style="font-size: 0.75rem;">${color.name}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `);
    }
    
    // Tailles
    if (this.product.sizes && this.product.sizes.length > 0) {
      options.push(`
        <div class="option-group">
          <h4 style="font-weight: 500; margin-bottom: 0.5rem;">Tailles disponibles</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${this.product.sizes.map((size, index) => `
              <div class="option-item" 
                   data-type="size" 
                   data-value="${size.size}"
                   data-quantity="${size.quantity || 0}"
                   data-image="${size.image || ''}"
                   style="border: 2px solid transparent; border-radius: 0.5rem; padding: 0.5rem 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer; background: white;">
                <span style="font-weight: 500;">${size.size}</span>
                <span style="font-size: 0.75rem; color: #8B7E6B;">${size.quantity || 0} dispo</span>
              </div>
            `).join('')}
          </div>
        </div>
      `);
    }
    
    // Options personnalisées
    if (this.product.customOptions && this.product.customOptions.length > 0) {
      this.product.customOptions.forEach(option => {
        options.push(`
          <div class="option-group">
            <h4 style="font-weight: 500; margin-bottom: 0.5rem;">${option.name}</h4>
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
              ${option.values.map(value => `
                <div class="option-item" 
                     data-type="custom" 
                     data-option="${option.name}"
                     data-value="${value.value}"
                     data-image="${value.image || ''}"
                     style="border: 2px solid transparent; border-radius: 0.5rem; padding: 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer;">
                  ${value.image ? `
                    <div style="width: 48px; height: 48px; border-radius: 0.5rem; overflow: hidden; border: 2px solid rgba(198, 167, 94, 0.2);">
                      <img src="${this.getImagePath(value.image)}" alt="" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>
                  ` : ''}
                  <span style="font-size: 0.75rem;">${value.value}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `);
      });
    }
    
    // Mettre carré
    if (this.product.squareOption === 'yes' && this.product.squareOptions?.length > 0) {
      options.push(`
        <div class="option-group">
          <h4 style="font-weight: 500; margin-bottom: 0.5rem;">Options mettre carré</h4>
          <div style="display: flex; flex-wrap: wrap; gap: 0.5rem;">
            ${this.product.squareOptions.map(opt => `
              <div class="option-item" 
                   data-type="square" 
                   data-value="${opt.value}"
                   data-image="${opt.image || ''}"
                   style="border: 2px solid transparent; border-radius: 0.5rem; padding: 0.5rem; display: flex; flex-direction: column; align-items: center; gap: 0.25rem; cursor: pointer;">
                ${opt.image ? `
                  <div style="width: 48px; height: 48px; border-radius: 0.5rem; overflow: hidden; border: 2px solid rgba(198, 167, 94, 0.2);">
                    <img src="${this.getImagePath(opt.image)}" alt="" style="width: 100%; height: 100%; object-fit: cover;">
                  </div>
                ` : ''}
                <span style="font-size: 0.75rem;">${opt.value}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `);
    }
    
    return options.length > 0 ? `
      <div style="display: flex; flex-direction: column; gap: 1rem; padding-top: 1rem; border-top: 1px solid rgba(198, 167, 94, 0.2);">
        ${options.join('')}
      </div>
    ` : '';
  }
  
  renderRelatedProducts() {
    if (this.relatedProducts.length === 0) return '';
    
    return `
      <div style="margin-top: 2rem; padding-top: 1.5rem; border-top: 1px solid rgba(198, 167, 94, 0.2);">
        <h3 style="font-family: 'Cormorant Garamond', serif; font-size: 1.5rem; margin-bottom: 1rem;">Vous aimerez aussi</h3>
        <div class="related-products-carousel">
          ${this.relatedProducts.map(product => `
            <div class="product-card" data-product-id="${product.id}" style="cursor: pointer; transition: transform 0.2s;">
              <div class="related-product-media">
                <img src="${this.getImagePath(this.getProductPrimaryImage(product))}" 
                     alt="" 
                     class="related-product-image"
                     loading="lazy"
                     onerror="this.onerror=null;this.style.display='none';this.parentNode.innerHTML='<div style=&quot;height:100%;display:flex;align-items:center;justify-content:center;color:#8B7E6B;&quot;><i class=&quot;fas fa-image&quot;></i></div>';">
              </div>
              <h4 style="font-weight: 500; font-size: 0.875rem; margin: 0 0 0.25rem 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${product.name || ''}</h4>
              <div style="display: flex; align-items: baseline; gap: 0.5rem;">
                <span style="font-weight: bold;">${this.getProductDisplayPrice(product).text}</span>
                ${product.comparePrice ? `
                  <span style="font-size: 0.75rem; color: #8B7E6B; text-decoration: line-through;">${this.formatPrice(product.comparePrice)}</span>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  renderError() {
    const errorHTML = `
      <div class="product-modal-overlay-${this.uniqueId}" style="
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(5px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
      ">
        <div style="
          background: #F5F1E8;
          border-radius: 1.5rem;
          padding: 2rem;
          max-width: 400px;
          text-align: center;
        ">
          <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #7F1D1D; margin-bottom: 1rem;"></i>
          <h3 style="font-family: 'Cormorant Garamond', serif; font-size: 1.5rem; margin-bottom: 0.5rem;">Produit non trouvé</h3>
          <p style="color: #8B7E6B; margin-bottom: 1.5rem;">Le produit que vous recherchez n'existe pas ou a été supprimé.</p>
          <button class="close-modal-btn" style="
            background: #1F1E1C;
            color: #F5F1E8;
            padding: 0.75rem 2rem;
            border: none;
            border-radius: 0.5rem;
            cursor: pointer;
            font-size: 1rem;
          " onmouseover="this.style.background='#C6A75E'; this.style.color='#1F1E1C'" onmouseout="this.style.background='#1F1E1C'; this.style.color='#F5F1E8'">
            Fermer
          </button>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', errorHTML);
    this.modalElement = document.querySelector(`.product-modal-overlay-${this.uniqueId}`);
    document.body.classList.add('modal-open');
  }
  
  attachEvents() {
    const mainScrollArea = this.modalElement.querySelector('.product-modal-main-scroll');

    // Fermeture du modal
    const closeButtons = this.modalElement.querySelectorAll('.close-modal-btn');
    closeButtons.forEach(btn => {
      btn.addEventListener('click', () => this.close());
    });

    const backButtons = this.modalElement.querySelectorAll('.back-modal-btn');
    backButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.isFullscreen) {
          this.closeFullscreen();
          return;
        }
        this.close();
      });
    });

    const shareButtons = this.modalElement.querySelectorAll('.share-product-btn');
    shareButtons.forEach((btn) => {
      btn.addEventListener('click', () => this.shareProduct());
    });
    
    // Clic sur l'overlay pour fermer
    this.modalElement.addEventListener('click', (e) => {
      if (e.target === this.modalElement) {
        this.close();
      }
    });

    if (mainScrollArea && !this.options.pageMode) {
      this.modalElement.addEventListener('wheel', (e) => {
        const isHorizontalScroller = e.target.closest('.mobile-image-container, .related-products-carousel');
        if (isHorizontalScroller || this.isFullscreen) return;

        const deltaY = Number(e.deltaY) || 0;
        if (deltaY === 0) return;

        mainScrollArea.scrollTop += deltaY;
        e.preventDefault();
      }, { passive: false });
    }
    
    this.bindImageInteractionEvents();
    this.bindMobileNavigationEvents();
    
    // Sélection des options
    this.modalElement.querySelectorAll('.option-item').forEach(item => {
      item.addEventListener('click', () => {
        const type = item.dataset.type;
        if (type === 'variation') return;
        const group = item.closest('.option-group');
        
        // Désélectionner les autres dans le même groupe
        if (group) {
          group.querySelectorAll('.option-item').forEach(opt => {
            opt.classList.remove('selected');
            opt.style.borderColor = 'transparent';
          });
        }
        
        // Sélectionner l'option cliquée
        item.classList.add('selected');
        item.style.borderColor = '#C6A75E';
        
        // Sauvegarder la sélection
        const value = {
          type: type,
          value: item.dataset.value,
          image: item.dataset.image,
          link: item.dataset.link,
          variationIndex: item.dataset.variationIndex
        };
        
        if (type === 'custom') {
          const optionName = item.dataset.option;
          this.selectedOptions.set(`custom_${optionName}`, value);
        } else {
          this.selectedOptions.set(type, value);
        }
        
        this.normalizeSelectedQuantities();
        this.saveToLocalStorage();
      });
    });

    // Sélection visuelle et preview pour variations (multi-quantités)
    this.modalElement.querySelectorAll('.variation-item').forEach((item) => {
      item.addEventListener('click', () => {
        const idx = parseInt(item.dataset.variationIndex, 10);
        if (!Number.isInteger(idx)) return;
        this.currentVariationIndex = idx;
        const variation = this.product?.variations?.[idx];
        const priceEl = this.modalElement.querySelector('.product-current-price');
        if (priceEl && variation) {
          priceEl.textContent = this.formatPrice(this.getVariationEffectivePrice(variation, this.product));
        }
        this.refreshDisplayedImages();
        this.updateVariationQuantityUI(idx);
        this.refreshAddToCartButtons();
        this.saveToLocalStorage();
      });
    });

    this.modalElement.querySelectorAll('.variation-qty-inc').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.variationIndex, 10);
        if (!Number.isInteger(idx)) return;
        const maxAllowed = this.getAvailableVariationQuantity(idx);
        const next = Number.isFinite(maxAllowed)
          ? Math.min(maxAllowed, (this.variationQuantities.get(idx) || 0) + 1)
          : Math.min(999, (this.variationQuantities.get(idx) || 0) + 1);
        if (next <= 0) this.variationQuantities.delete(idx);
        else this.variationQuantities.set(idx, next);
        this.currentVariationIndex = idx;
        this.updateVariationQuantityUI(idx);
        this.refreshAddToCartButtons();
        this.saveToLocalStorage();
      });
    });

    this.modalElement.querySelectorAll('.variation-qty-dec').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.variationIndex, 10);
        if (!Number.isInteger(idx)) return;
        const next = Math.max(0, (this.variationQuantities.get(idx) || 0) - 1);
        if (next === 0) this.variationQuantities.delete(idx);
        else this.variationQuantities.set(idx, next);
        this.updateVariationQuantityUI(idx);
        this.refreshAddToCartButtons();
        this.saveToLocalStorage();
      });
    });
    
    // Fullscreen events
    const fullscreenImg = this.fullscreenViewer?.querySelector('.fullscreen-img');
    const closeFullscreen = this.fullscreenViewer?.querySelector('.close-fullscreen-btn');
    const prevBtn = this.fullscreenViewer?.querySelector('.fullscreen-prev');
    const nextBtn = this.fullscreenViewer?.querySelector('.fullscreen-next');
    
    if (closeFullscreen) {
      closeFullscreen.addEventListener('click', () => this.closeFullscreen());
    }
    
    if (prevBtn) {
      prevBtn.addEventListener('click', () => this.navigateFullscreen('prev'));
    }
    
    if (nextBtn) {
      nextBtn.addEventListener('click', () => this.navigateFullscreen('next'));
    }
    
    // Ajouter au panier
    const addToCartBtns = this.modalElement.querySelectorAll('.add-to-cart-btn');
    if (addToCartBtns.length > 0) {
      let addLock = false;
      let lastTap = 0;
      addToCartBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const now = Date.now();
          if (addLock || now - lastTap < 250) return;
          lastTap = now;
          addLock = true;
          this.addToCart();
          setTimeout(() => { addLock = false; }, 300);
        });
      });
    }

    const likeBtns = this.modalElement.querySelectorAll('.toggle-like-btn');
    if (likeBtns.length > 0) {
      const handleLike = async () => {
        const priceText = this.getProductDisplayPrice(this.product)?.text || '';
        const image = this.getImagePath(this.getProductPrimaryImage(this.product));
        const result = await this.likeManager.toggleLike(this.product?.id, {
          name: this.product?.name || 'Produit',
          image,
          price: priceText
        });
        if (!result?.ok && result?.reason === 'auth_required') {
          return;
        }
        this.syncLikeButton();
      };
      likeBtns.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handleLike();
        });
      });
    }

    document.addEventListener('likesUpdated', this.onLikesUpdated);

    const qtyInputs = this.modalElement.querySelectorAll('.qty-input');
    const qtyDecreaseBtns = this.modalElement.querySelectorAll('.qty-decrease-btn');
    const qtyIncreaseBtns = this.modalElement.querySelectorAll('.qty-increase-btn');

    qtyDecreaseBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.selectedQuantity = Math.max(0, Number(this.selectedQuantity || 0) - 1);
        this.updateStandardQuantityUI();
        this.refreshAddToCartButtons();
        this.saveToLocalStorage();
      });
    });
    qtyIncreaseBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        const available = this.getAvailableBaseQuantity();
        const next = Number(this.selectedQuantity || 0) + 1;
        this.selectedQuantity = Number.isFinite(available) ? Math.min(available, next) : Math.min(999, next);
        this.updateStandardQuantityUI();
        this.refreshAddToCartButtons();
        this.saveToLocalStorage();
      });
    });
    qtyInputs.forEach((input) => {
      input.addEventListener('input', () => {
        const parsed = parseInt(input.value, 10);
        const available = this.getAvailableBaseQuantity();
        const normalized = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
        this.selectedQuantity = Number.isFinite(available) ? Math.min(available, normalized) : Math.min(999, normalized);
        this.updateStandardQuantityUI();
        this.refreshAddToCartButtons();
        this.saveToLocalStorage();
      });
      input.addEventListener('blur', () => {
        this.updateStandardQuantityUI();
      });
    });
    
    // Produits liés
    this.modalElement.querySelectorAll('.product-card').forEach(card => {
      card.addEventListener('click', () => {
        const productId = card.dataset.productId;
        if (productId) {
          this.navigateToProduct(productId);
        }
      });
    });
    
    // Touche Echap pour fermer
    document.addEventListener('keydown', this.handleKeyDown);
    this.normalizeSelectedQuantities();
  }

  updateShareFeedback(message, isError = false) {
    this.modalElement?.querySelectorAll('.share-product-feedback').forEach((el) => {
      el.textContent = message;
      el.style.display = message ? 'block' : 'none';
      el.style.color = isError ? '#B42318' : '#8B7E6B';
    });
  }

  async shareProduct() {
    const shareUrl = this.getProductShareUrl();
    const shareTitle = this.product?.name || 'Produit Smart Cut Services';
    const shareText = this.getProductShareText();

    try {
      if (navigator.share) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          url: shareUrl
        });
        this.updateShareFeedback('Lien de partage pret.');
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        this.updateShareFeedback('Lien du produit copie.');
        return;
      }

      const textArea = document.createElement('textarea');
      textArea.value = shareUrl;
      textArea.setAttribute('readonly', '');
      textArea.style.position = 'absolute';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      this.updateShareFeedback('Lien du produit copie.');
    } catch (error) {
      console.error('❌ Erreur partage produit:', error);
      this.updateShareFeedback('Impossible de partager ce produit pour le moment.', true);
    }
  }
  
  openFullscreen(index) {
    this.isFullscreen = true;
    this.fullscreenIndex = index;
    const images = this.getCurrentDisplayImages();
    const img = this.fullscreenViewer.querySelector('.fullscreen-img');
    const counter = this.fullscreenViewer.querySelector('.fullscreen-counter');
    
    img.onerror = () => {
      img.onerror = null;
      img.style.display = 'none';
    };
    img.src = this.getImagePath(images[index]);
    img.style.display = '';
    counter.textContent = `${index + 1}/${images.length}`;
    
    this.fullscreenViewer.style.display = 'flex';

    if (!this.fullscreenHistoryActive && typeof window !== 'undefined' && window.history?.pushState) {
      window.history.pushState(
        {
          ...(window.history.state || {}),
          productModalOpen: true,
          productModalId: this.historyStateId,
          productModalFullscreen: true
        },
        '',
        window.location.href
      );
      this.fullscreenHistoryActive = true;
    }
    
    // Désactiver le scroll du body (déjà fait mais on renforce)
    document.body.style.overflow = 'hidden';
  }
  
  closeFullscreen(syncHistory = true) {
    if (syncHistory && this.fullscreenHistoryActive && typeof window !== 'undefined' && window.history) {
      window.history.back();
      return;
    }
    this.isFullscreen = false;
    this.fullscreenHistoryActive = false;
    this.fullscreenViewer.style.display = 'none';
  }
  
  navigateFullscreen(direction) {
    const images = this.getCurrentDisplayImages();
    const fallbackImage = getFallbackProductImage(this.product, this.options.imageBasePath);
    if (direction === 'prev') {
      this.fullscreenIndex = (this.fullscreenIndex - 1 + images.length) % images.length;
    } else {
      this.fullscreenIndex = (this.fullscreenIndex + 1) % images.length;
    }
    
    const img = this.fullscreenViewer.querySelector('.fullscreen-img');
    const counter = this.fullscreenViewer.querySelector('.fullscreen-counter');
    
    img.onerror = () => {
      img.onerror = null;
      img.src = fallbackImage;
    };
    img.src = this.getImagePath(images[this.fullscreenIndex]);
    counter.textContent = `${this.fullscreenIndex + 1}/${images.length}`;
  }
  
  saveToLocalStorage() {
    if (!this.product?.id) return;
    const key = `veltrixa_modal_selection_${this.product.id}`;
    const payload = {
      selectedOptions: Array.from(this.selectedOptions.entries()),
      selectedQuantity: Math.max(0, Number(this.selectedQuantity) || 0),
      variationQuantities: Array.from(this.variationQuantities.entries()),
      currentVariationIndex: Number(this.currentVariationIndex) || 0,
      updatedAt: Date.now()
    };
    localStorage.setItem(key, JSON.stringify(payload));
  }
  
  loadFromLocalStorage() {
    if (!this.product?.id) return;
    const key = `veltrixa_modal_selection_${this.product.id}`;
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    if (!saved) return;

    (Array.isArray(saved.selectedOptions) ? saved.selectedOptions : []).forEach(([k, v]) => {
      this.selectedOptions.set(k, v);
    });
    this.selectedQuantity = Math.max(1, Number(saved.selectedQuantity) || 1);
    this.variationQuantities = new Map(
      (Array.isArray(saved.variationQuantities) ? saved.variationQuantities : [])
        .map(([idx, qty]) => [Number(idx), Math.max(0, Number(qty) || 0)])
        .filter(([idx, qty]) => Number.isInteger(idx) && qty > 0)
    );

    setTimeout(() => {
      (Array.isArray(saved.selectedOptions) ? saved.selectedOptions : []).forEach(([keyName, value]) => {
        const selector = `[data-type="${keyName.split('_')[0]}"][data-value="${value?.value}"]`;
        const option = this.modalElement.querySelector(selector);
        if (option) {
          option.classList.add('selected');
          option.style.borderColor = '#C6A75E';
        }
      });

      const variation = this.selectedOptions.get('variation');
      const variationIndex = Number(variation?.variationIndex);
      if (Number.isInteger(variationIndex)) {
        this.currentVariationIndex = variationIndex;
        const variationData = this.product?.variations?.[variationIndex];
        const priceEl = this.modalElement.querySelector('.product-current-price');
        if (priceEl && variationData) {
          priceEl.textContent = this.formatPrice(this.getVariationEffectivePrice(variationData, this.product));
        }
        this.refreshDisplayedImages();
      }

      this.normalizeSelectedQuantities();
      this.saveToLocalStorage();
    }, 100);
  }
  
 addToCart() {
  // Récupérer l'instance du panier
  import('./cart.js').then(({ getCartManager }) => {
    const cart = getCartManager();
    
    // Collecter les images des options sélectionnées
    const selectedOptionsWithImages = Array.from(this.selectedOptions.entries())
      .filter(([key]) => key !== 'variation')
      .map(([key, value]) => {
      return {
        type: key,
        value: value.value || value,
        image: value.image || '', // Image de l'option
        link: value.link || '',
        variationIndex: value.variationIndex
      };
    });
    
    let entries = Array.from(this.variationQuantities.entries())
      .map(([idx, qty]) => [Number(idx), Math.max(0, Number(qty) || 0)])
      .filter(([idx, qty]) => Number.isInteger(idx) && qty > 0);

    let hasAddedItem = false;

    if (Array.isArray(this.product?.variations) && this.product.variations.length > 0) {
      if (entries.length === 0) {
        const fallbackIdx = Number.isInteger(this.currentVariationIndex) ? this.currentVariationIndex : 0;
        const available = this.getAvailableVariationQuantity(fallbackIdx);
        const fallbackQty = Number.isFinite(available)
          ? Math.min(available, Math.max(1, Number(this.selectedQuantity) || 1))
          : Math.max(1, Number(this.selectedQuantity) || 1);
        if (fallbackQty > 0) {
          entries = [[fallbackIdx, fallbackQty]];
        }
      }
      if (entries.length === 0) {
        return;
      }
      entries.forEach(([variationIndex, quantity]) => {
        const variationData = this.product?.variations?.[variationIndex];
        if (!variationData) return;
        const available = this.getAvailableVariationQuantity(variationIndex);
        const safeQuantity = Number.isFinite(available) ? Math.min(available, quantity) : quantity;
        if (safeQuantity <= 0) {
          return;
        }
        const finalPrice = this.getVariationEffectivePrice(variationData, this.product);
        const finalImage = variationData?.images?.[0] || this.getProductPrimaryImage(this.product);
        const finalSku = variationData?.sku || this.product.sku || '';
        const variationLabel = this.getVariationLabel(variationData);
        const stockLimit = this.getVariationStockLimit(variationIndex);

        const item = {
          productId: this.product.id,
          sku: finalSku,
          name: this.product.name,
          price: finalPrice,
          image: finalImage,
          stockLimit: Number.isFinite(stockLimit) ? stockLimit : null,
          weightGrams: this.getCurrentSelectionWeight(variationData),
          selectedOptions: [
            ...selectedOptionsWithImages,
            {
              type: 'variation',
              value: variationLabel,
              image: finalImage,
              variationIndex
            }
          ],
          quantity: safeQuantity,
          timestamp: Date.now()
        };

        if (cart && typeof cart.addItem === 'function') {
          cart.addItem(item);
        } else {
          const event = new CustomEvent('addToCart', { detail: item });
          document.dispatchEvent(event);
        }
        hasAddedItem = true;
      });
    } else {
      const variationData = this.product?.variations?.[this.currentVariationIndex] || null;
      const finalPrice = this.getVariationEffectivePrice(variationData, this.product);
      const finalImage = variationData?.images?.[0] || this.getProductPrimaryImage(this.product);
      const finalSku = variationData?.sku || this.product.sku || '';
      const available = this.getAvailableBaseQuantity();
      const quantity = Math.max(1, Number(this.selectedQuantity) || 1);
      const safeQuantity = Number.isFinite(available) ? Math.min(available, quantity) : quantity;
      if (safeQuantity <= 0) {
        return;
      }
      const stockLimit = this.getBaseStockLimit();
      const item = {
        productId: this.product.id,
        sku: finalSku,
        name: this.product.name,
        price: finalPrice,
        image: finalImage,
        stockLimit: Number.isFinite(stockLimit) ? stockLimit : null,
        weightGrams: this.getCurrentSelectionWeight(variationData),
        selectedOptions: selectedOptionsWithImages,
        quantity: safeQuantity,
        timestamp: Date.now()
      };
      if (cart && typeof cart.addItem === 'function') {
        cart.addItem(item);
      } else {
        const event = new CustomEvent('addToCart', { detail: item });
        document.dispatchEvent(event);
      }
      hasAddedItem = true;
    }

    if (!hasAddedItem) return;

    this.selectedQuantity = 1;
    this.variationQuantities.clear();
    this.normalizeSelectedQuantities();
    this.saveToLocalStorage();
    
    // Animation de confirmation
    const btns = this.modalElement.querySelectorAll('.add-to-cart-btn');
    btns.forEach((btn) => {
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i> Ajouté !';
      btn.style.background = '#2E5D3A';
      btn.style.color = 'white';
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.background = '#1F1E1C';
        btn.style.color = '#F5F1E8';
      }, 2000);
    });
  });
}
  
  getCartCount() {
    const cart = JSON.parse(localStorage.getItem('veltrixa_cart') || '[]');
    return cart.reduce((total, item) => total + (item.quantity || 1), 0);
  }

  syncLikeButton() {
    if (!this.modalElement || !this.product?.id || !this.likeManager) return;
    const liked = this.likeManager.isLiked(this.product.id);
    this.modalElement.querySelectorAll('.toggle-like-btn').forEach((btn) => {
      const icon = btn.querySelector('i');
      const label = btn.querySelector('span');
      if (icon) {
        icon.className = `${liked ? 'fas' : 'far'} fa-heart`;
        icon.style.color = liked ? '#DC2626' : '#8B7E6B';
      }
      if (label) {
        label.textContent = liked ? 'Retirer des favoris' : 'Ajouter aux favoris';
      }
    });
  }
  
  animateIn() {
    if (typeof anime !== 'undefined') {
      anime({
        targets: `.product-modal-container-${this.uniqueId}`,
        scale: [0.9, 1],
        opacity: [0, 1],
        duration: 300,
        easing: 'easeOutQuad'
      });
    }
  }
  
  animateOut() {
    return new Promise(resolve => {
      if (typeof anime !== 'undefined') {
        anime({
          targets: `.product-modal-overlay-${this.uniqueId}`,
          opacity: [1, 0],
          duration: 200,
          easing: 'easeInQuad',
          complete: resolve
        });
      } else {
        resolve();
      }
    });
  }
  
  async performClose() {
    if (this.isClosing) return;
    this.isClosing = true;

    await this.animateOut();
    document.removeEventListener('likesUpdated', this.onLikesUpdated);
    document.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('popstate', this.handlePopState);
    this.modalElement?.remove();
    this.fullscreenViewer?.remove();
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';
    
    if (this.options.onClose) {
      this.options.onClose();
    }
  }

  async close() {
    if (this.isClosing) return;
    if (this.isFullscreen) {
      this.closeFullscreen();
      return;
    }
    if (this.modalHistoryActive && typeof window !== 'undefined' && window.history) {
      window.history.back();
      return;
    }
    await this.performClose();
  }
}

export default ProductModal;
