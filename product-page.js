import ProductModal from './product-modal.js?v=20260901-1';
import { applySeoMeta } from './seo-meta.js?v=20260901-1';

class ProductPage extends ProductModal {
  constructor(containerId, options = {}) {
    const container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    if (!container) {
      throw new Error(`Container produit introuvable: ${containerId}`);
    }

    super({
      ...options,
      renderTarget: container,
      pageMode: true
    });
  }

  async init() {
    if (!this.options.productId) {
      this.renderError();
      return;
    }

    await this.loadProduct();
    await this.loadRelatedProducts();
    this.render();
    this.attachEvents();
    this.loadFromLocalStorage();
  }

  render() {
    if (!this.product) {
      this.renderError();
      return;
    }

    const target = this.options.renderTarget;
    if (!target) return;

    const images = this.getProductImages(this.product);
    const mobileActionLabel = Array.isArray(this.product?.variations) && this.product.variations.length
      ? 'Choisir et ajouter'
      : 'Ajouter au panier';
    const mobilePrice = this.getProductDisplayPrice(this.product).text;

    target.innerHTML = `
      <section class="product-page-shell-${this.uniqueId} ${images.length > 1 ? 'has-multiple-images' : 'has-single-image'}" data-image-count="${images.length}" style="
        width: 100%;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(198, 167, 94, 0.12), transparent 26%),
          linear-gradient(180deg, #FBF7EF 0%, #F2EBDE 100%);
        color: #0F1111;
      ">
        <div class="product-page-frame" style="max-width: 1180px; margin: 0 auto; padding: 0.75rem 1rem 2.5rem;">
          <div class="product-page-topline" style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 0.65rem; flex-wrap: wrap;">
            <button class="back-modal-btn" type="button" style="
              display: inline-flex;
              align-items: center;
              gap: 0.55rem;
              border: 1px solid rgba(31, 30, 28, 0.12);
              background: rgba(255, 255, 255, 0.84);
              color: #0F1111;
              border-radius: 999px;
              padding: 0.62rem 0.85rem;
              cursor: pointer;
              font: inherit;
              font-weight: 700;
              box-shadow: 0 12px 28px rgba(31, 30, 28, 0.06);
            ">
              <i class="fas fa-arrow-left"></i>
              <span>Retour au catalogue</span>
            </button>
            <div style="display: flex; align-items: center; gap: 0.55rem; color: #7A746B; font-size: 0.92rem;">
              <span>${this.product?.categoryName || 'Produit'}</span>
            </div>
          </div>

          <div class="product-modal-main-scroll" style="display: block;">
            <div class="hidden md:flex product-page-desktop-layout" style="align-items: flex-start; gap: 0; border-radius: 1rem; overflow: hidden; background: rgba(255, 255, 255, 0.72); border: 1px solid rgba(198, 167, 94, 0.16); box-shadow: 0 12px 32px rgba(31, 30, 28, 0.07);">
              <div class="product-page-desktop-gallery ${images.length > 1 ? 'is-scrollable' : 'is-single'}" style="width: 50%; padding: 1rem; border-right: 1px solid rgba(198, 167, 94, 0.14);">
                <div class="product-images-desktop-root">
                  ${this.renderDesktopImages()}
                </div>
              </div>
              <div class="product-page-desktop-info" style="width: 50%; padding: 1.15rem 1.25rem 1.4rem;">
                ${this.renderProductInfo()}
                ${this.renderRelatedProducts()}
              </div>
            </div>

            <div class="md:hidden">
              <div class="product-page-mobile-card" style="
                position: relative;
                border-radius: 0.9rem;
                overflow: hidden;
                background: rgba(255, 255, 255, 0.88);
                box-shadow: 0 20px 46px rgba(31, 30, 28, 0.08);
                border: 1px solid rgba(198, 167, 94, 0.16);
              ">
                <div style="padding: 0.6rem;">
                  <div class="product-page-mobile-gallery" style="
                    height: min(42vh, 340px);
                    min-height: 220px;
                    position: relative;
                    border-radius: 0.7rem;
                    overflow: hidden;
                    background: #FFFFFF;
                    border: 1px solid rgba(198, 167, 94, 0.14);
                  ">
                    <div class="product-images-mobile-root">
                      ${this.renderMobileImages()}
                    </div>
                  </div>
                </div>
                <div style="padding: 0 0.6rem 0.7rem;">
                  <div class="product-page-mobile-info" style="
                    background: rgba(255, 255, 255, 0.96);
                    border-radius: 0.7rem;
                    border: 1px solid rgba(198, 167, 94, 0.14);
                    padding: 0.85rem;
                  ">
                    ${this.renderProductInfo()}
                    ${this.renderRelatedProducts()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="product-page-mobile-buybar" aria-label="Achat rapide">
          <div>
            <span>Votre article</span>
            <strong>${mobilePrice}</strong>
          </div>
          <button type="button" class="product-page-buybar-action">
            <i class="fas fa-shopping-bag" aria-hidden="true"></i>
            ${mobileActionLabel}
          </button>
        </div>

        <div class="fullscreen-viewer-${this.uniqueId}" style="
          position: fixed;
          inset: 0;
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
          <button class="close-fullscreen-btn" type="button" aria-label="Fermer l'image agrandie" style="
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
            <button class="fullscreen-prev" type="button" aria-label="Image précédente" style="
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
            <button class="fullscreen-next" type="button" aria-label="Image suivante" style="
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
              ${images.length > 0 ? `${this.currentImageIndex + 1}/${images.length}` : '0/0'}
            </div>
          </div>
        </div>

        <style>
          .product-page-shell-${this.uniqueId} ::-webkit-scrollbar {
            width: 6px;
            height: 6px;
          }

          .product-page-shell-${this.uniqueId} ::-webkit-scrollbar-track {
            background: rgba(0, 0, 0, 0.05);
          }

          .product-page-shell-${this.uniqueId} ::-webkit-scrollbar-thumb {
            background: #FFA41C;
            border-radius: 999px;
          }

          .desktop-image-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 0.65rem;
          }

          .desktop-image-item {
            aspect-ratio: 1;
            cursor: pointer;
            overflow: hidden;
            border-radius: 0.5rem;
            transition: all 0.3s;
            background: #FFFFFF;
            box-shadow: 0 12px 28px rgba(31, 30, 28, 0.06);
          }

          .desktop-image-item:hover {
            transform: translateY(-2px) scale(1.01);
            box-shadow: 0 18px 34px rgba(31, 30, 28, 0.1);
          }

          .desktop-image-item img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

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
            width: 44px;
            height: 44px;
            background: rgba(255,255,255,0.9);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            cursor: pointer;
            transition: all 0.2s;
            border: none;
          }

          .mobile-nav-btn.left { left: 10px; }
          .mobile-nav-btn.right { right: 10px; }

          .related-products-carousel {
            display: flex;
            gap: 0.7rem;
            overflow-x: auto;
            scroll-snap-type: x mandatory;
            -webkit-overflow-scrolling: touch;
            scrollbar-width: thin;
            padding-bottom: 0.5rem;
          }

          .related-products-carousel .product-card {
            flex: 0 0 160px;
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

          .product-card:hover .related-product-image {
            transform: scale(1.06);
          }

          .line-clamp-2 {
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }

          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }

          .add-to-cart-btn { animation: none; }

          .product-page-shell-${this.uniqueId} .product-info-stack {
            gap: 1rem !important;
          }

          .product-page-shell-${this.uniqueId} .product-page-frame.product-page-frame {
            max-width: 1180px !important;
            box-sizing: border-box;
          }

          .product-page-shell-${this.uniqueId} h1 {
            font-size: clamp(1.25rem, 2vw, 1.65rem) !important;
            line-height: 1.2 !important;
          }

          .product-page-shell-${this.uniqueId} .product-current-price {
            font-size: 1.55rem !important;
          }

          .product-page-shell-${this.uniqueId} .product-options-stack {
            gap: .75rem !important;
            padding-top: .75rem !important;
          }

          .product-page-shell-${this.uniqueId} .variation-scroll-row {
            display: flex !important;
            flex-wrap: nowrap !important;
            gap: .65rem !important;
            overflow-x: auto !important;
            overflow-y: hidden;
            padding: .1rem .1rem .55rem;
            scroll-snap-type: x proximity;
            scrollbar-width: thin;
            -webkit-overflow-scrolling: touch;
          }

          .product-page-shell-${this.uniqueId} .variation-scroll-row .variation-item {
            flex: 0 0 138px !important;
            min-width: 138px !important;
            padding: .45rem !important;
            scroll-snap-align: start;
          }

          .product-page-shell-${this.uniqueId} .variation-scroll-row .variation-qty-inc,
          .product-page-shell-${this.uniqueId} .variation-scroll-row .variation-qty-dec {
            width: 34px !important;
            height: 34px !important;
          }

          .product-page-shell-${this.uniqueId} .product-related-section {
            margin-top: 1.25rem !important;
            padding-top: 1rem !important;
          }

          .product-page-shell-${this.uniqueId} .product-related-section > h3 {
            margin-bottom: .75rem !important;
            font-size: 1.15rem !important;
          }

          .product-page-shell-${this.uniqueId} .product-trust-item {
            min-height: 48px !important;
            padding: .5rem !important;
            font-size: .7rem !important;
          }

          .product-page-shell-${this.uniqueId} .toggle-like-btn,
          .product-page-shell-${this.uniqueId} .share-product-btn,
          .product-page-shell-${this.uniqueId} .add-to-cart-btn {
            min-height: 42px !important;
            padding: .68rem .85rem !important;
            font-size: .9rem !important;
          }

          .product-page-mobile-buybar { display: none; }

          @media (max-width: 767px) {
            .product-page-frame { padding: .5rem .45rem 1.5rem !important; }
            .product-page-topline { margin-bottom: .45rem !important; padding-inline: .2rem; }
            .product-page-shell-${this.uniqueId} { padding-bottom: 84px; }
            .product-page-shell-${this.uniqueId} .product-info-stack { gap: .8rem !important; }
            .product-page-shell-${this.uniqueId} .variation-scroll-row .variation-item {
              flex-basis: 124px !important;
              min-width: 124px !important;
            }
            .product-page-mobile-buybar {
              position: fixed;
              z-index: 900;
              left: .65rem;
              right: .65rem;
              bottom: max(.65rem, env(safe-area-inset-bottom));
              display: grid;
              grid-template-columns: auto 1fr;
              align-items: center;
              gap: .8rem;
              padding: .65rem;
              border: 1px solid rgba(198, 167, 94, .32);
              border-radius: 16px;
              background: rgba(255, 255, 255, .94);
              box-shadow: 0 18px 45px rgba(31, 30, 28, .2);
              backdrop-filter: blur(16px);
            }
            .product-page-mobile-buybar > div { padding-left: .25rem; }
            .product-page-mobile-buybar span {
              display: block;
              color: #7a746b;
              font-size: .68rem;
              font-weight: 700;
              text-transform: uppercase;
            }
            .product-page-mobile-buybar strong {
              display: block;
              color: #0f1111;
              font-size: 1rem;
              white-space: nowrap;
            }
            .product-page-buybar-action {
              min-height: 50px;
              display: inline-flex;
              align-items: center;
              justify-content: center;
              gap: .5rem;
              border: 0;
              border-radius: 11px;
              padding: .7rem .9rem;
              background: #0f1111;
              color: #fff;
              font-size: .84rem;
              font-weight: 800;
            }
          }
        </style>
      </section>
    `;

    this.modalElement = target.querySelector(`.product-page-shell-${this.uniqueId}`);
    this.fullscreenViewer = target.querySelector(`.fullscreen-viewer-${this.uniqueId}`);

    this.applySeo();
  }

  applySeo() {
    const p = this.product;
    if (!p) return;
    const images = this.getProductImages(p).map((src) => {
      try { return new URL(src, location.href).href; } catch (_) { return null; }
    }).filter(Boolean);
    const price = Number(p.price);
    const description = String(p.longDescription || p.shortDescription || p.description
      || `${p.name || 'Produit'} — disponible sur Smart Cut Services.`).replace(/\s+/g, ' ').trim();
    applySeoMeta({
      title: p.name || 'Produit',
      description,
      image: images[0] || '',
      type: 'product',
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: p.name || 'Produit',
        description: description.slice(0, 500),
        image: images.slice(0, 6),
        category: p.categoryName || p.category || undefined,
        sku: p.sku || p.id || undefined,
        brand: { '@type': 'Brand', name: p.vendorName || p.shopName || 'Smart Cut Services' },
        ...(Number.isFinite(price) && price > 0 ? {
          offers: {
            '@type': 'Offer',
            price: String(price),
            priceCurrency: 'HTG',
            availability: 'https://schema.org/InStock',
            url: location.href.split('#')[0],
          },
        } : {}),
      },
    });
  }

  attachEvents() {
    super.attachEvents();
    const quickBuy = this.modalElement?.querySelector('.product-page-buybar-action');
    quickBuy?.addEventListener('click', () => {
      const addButton = this.modalElement?.querySelector('.add-to-cart-btn');
      if (!addButton) return;
      if (addButton.disabled) {
        this.modalElement?.querySelector('.option-group')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      addButton.click();
    });
  }

  renderError() {
    const target = this.options.renderTarget;
    if (!target) return;

    target.innerHTML = `
      <section style="min-height: 60vh; display: flex; align-items: center; justify-content: center; padding: 2rem 1rem;">
        <div style="
          max-width: 520px;
          width: 100%;
          background: rgba(255,255,255,0.92);
          border: 1px solid rgba(198,167,94,0.16);
          border-radius: 1.5rem;
          padding: 2rem;
          text-align: center;
          box-shadow: 0 18px 48px rgba(31,30,28,0.08);
        ">
          <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: #7F1D1D; margin-bottom: 1rem;"></i>
          <h2 style="font-family: 'Amazon Ember', Arial, sans-serif; font-size: 2rem; margin-bottom: 0.65rem;">Produit non trouvé</h2>
          <p style="color: #7A746B; margin-bottom: 1.4rem;">Le produit que vous recherchez n'est pas disponible ou a été supprimé.</p>
          <a href="./catalogue.html" style="
            display: inline-flex;
            align-items: center;
            gap: 0.55rem;
            text-decoration: none;
            background: #0F1111;
            color: #EAEDED;
            border-radius: 999px;
            padding: 0.85rem 1.2rem;
            font-weight: 700;
          ">
            <i class="fas fa-arrow-left"></i>
            <span>Retour au catalogue</span>
          </a>
        </div>
      </section>
    `;

    this.modalElement = target.firstElementChild;
    this.fullscreenViewer = null;
  }

  async animateOut() {
    return Promise.resolve();
  }

  async close() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = './catalogue.html';
  }

  async performClose() {
    await this.close();
  }
}

export default ProductPage;

