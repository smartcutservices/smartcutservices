import ProductModal from './product-modal.js';

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

    target.innerHTML = `
      <section class="product-page-shell-${this.uniqueId}" style="
        width: 100%;
        min-height: 100vh;
        background:
          radial-gradient(circle at top left, rgba(198, 167, 94, 0.12), transparent 26%),
          linear-gradient(180deg, #FBF7EF 0%, #F2EBDE 100%);
        color: #1F1E1C;
      ">
        <div style="max-width: 1440px; margin: 0 auto; padding: 1.2rem 1rem 3rem;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; flex-wrap: wrap;">
            <button class="back-modal-btn" type="button" style="
              display: inline-flex;
              align-items: center;
              gap: 0.55rem;
              border: 1px solid rgba(31, 30, 28, 0.12);
              background: rgba(255, 255, 255, 0.84);
              color: #1F1E1C;
              border-radius: 999px;
              padding: 0.8rem 1.05rem;
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
            <div class="hidden md:flex" style="align-items: flex-start; gap: 0; border-radius: 1.8rem; overflow: hidden; background: rgba(255, 255, 255, 0.72); border: 1px solid rgba(198, 167, 94, 0.16); box-shadow: 0 26px 60px rgba(31, 30, 28, 0.08);">
              <div style="width: 52%; padding: 1.75rem; border-right: 1px solid rgba(198, 167, 94, 0.14);">
                <div class="product-images-desktop-root">
                  ${this.renderDesktopImages()}
                </div>
              </div>
              <div style="width: 48%; padding: 1.75rem 1.75rem 2rem;">
                ${this.renderProductInfo()}
                ${this.renderRelatedProducts()}
              </div>
            </div>

            <div class="md:hidden">
              <div style="
                position: relative;
                border-radius: 1.4rem;
                overflow: hidden;
                background: rgba(255, 255, 255, 0.88);
                box-shadow: 0 20px 46px rgba(31, 30, 28, 0.08);
                border: 1px solid rgba(198, 167, 94, 0.16);
              ">
                <div style="padding: 0.9rem;">
                  <div style="
                    height: min(48vh, 420px);
                    min-height: 250px;
                    position: relative;
                    border-radius: 1.1rem;
                    overflow: hidden;
                    background: #FFFFFF;
                    border: 1px solid rgba(198, 167, 94, 0.14);
                  ">
                    <div class="product-images-mobile-root">
                      ${this.renderMobileImages()}
                    </div>
                  </div>
                </div>
                <div style="padding: 0 0.9rem 1.2rem;">
                  <div style="
                    background: rgba(255, 255, 255, 0.96);
                    border-radius: 1.2rem;
                    border: 1px solid rgba(198, 167, 94, 0.14);
                    padding: 1rem 0.95rem 1.3rem;
                  ">
                    ${this.renderProductInfo()}
                    ${this.renderRelatedProducts()}
                  </div>
                </div>
              </div>
            </div>
          </div>
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
            background: #C6A75E;
            border-radius: 999px;
          }

          .desktop-image-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 1rem;
          }

          .desktop-image-item {
            aspect-ratio: 1;
            cursor: pointer;
            overflow: hidden;
            border-radius: 0.75rem;
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
            width: 40px;
            height: 40px;
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

          .add-to-cart-btn {
            animation: pulse 2s infinite;
          }
        </style>
      </section>
    `;

    this.modalElement = target.querySelector(`.product-page-shell-${this.uniqueId}`);
    this.fullscreenViewer = target.querySelector(`.fullscreen-viewer-${this.uniqueId}`);
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
          <h2 style="font-family: 'Cormorant Garamond', serif; font-size: 2rem; margin-bottom: 0.65rem;">Produit non trouvé</h2>
          <p style="color: #7A746B; margin-bottom: 1.4rem;">Le produit que vous recherchez n'est pas disponible ou a été supprimé.</p>
          <a href="./catalogue.html" style="
            display: inline-flex;
            align-items: center;
            gap: 0.55rem;
            text-decoration: none;
            background: #1F1E1C;
            color: #F5F1E8;
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
