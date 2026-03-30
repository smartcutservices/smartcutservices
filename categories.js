import { db } from './firebase-init.js';
import { collection, query, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class CategoriesDisplay {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error('Container categories introuvable');
      return;
    }

    this.options = {
      layout: 'grid',
      sectionTitle: 'Nos categories',
      scrollHint: true,
      ...options
    };

    this.collectionName = 'categories_list';
    this.items = [];
    this.rawCategories = [];
    this.firstProductImageByCategoryId = new Map();
    this.categoryObserver = null;
    this.isPointerDown = false;
    this.pointerStartX = 0;
    this.scrollStartLeft = 0;

    this.init();
  }

  init() {
    this.renderBase();
    this.bindCarouselEvents();
    this.loadData();
    this.bindMenuOpenEvents();
  }

  bindMenuOpenEvents() {
    document.addEventListener('openCategorySectionFromMenu', (event) => {
      this.redirectToCatalogue(event?.detail || {});
    });
  }

  renderBase() {
    this.container.innerHTML = `
      <div class="categories-wrapper-${this.options.layout}">
        ${this.options.layout === 'carousel' ? `
          <div class="categories-head">
            <h2>${this.options.sectionTitle}</h2>
            <div class="categories-head-actions">
              ${this.options.scrollHint ? `
                <div class="categories-scroll-hint">
                  <span>Faites glisser</span>
                  <i class="fas fa-arrow-right"></i>
                </div>
              ` : ''}
              <div class="categories-nav-buttons">
                <button type="button" class="categories-nav-btn categories-nav-btn-left" aria-label="Voir les categories precedentes">
                  <i class="fas fa-chevron-left"></i>
                </button>
                <button type="button" class="categories-nav-btn categories-nav-btn-right" aria-label="Voir les categories suivantes">
                  <i class="fas fa-chevron-right"></i>
                </button>
              </div>
            </div>
          </div>
        ` : ''}
        <div class="${this.options.layout === 'carousel' ? 'categories-row' : 'categories-grid'}"></div>
      </div>
    `;

    this.grid = this.container.querySelector(this.options.layout === 'carousel' ? '.categories-row' : '.categories-grid');
    this.leftButton = this.container.querySelector('.categories-nav-btn-left');
    this.rightButton = this.container.querySelector('.categories-nav-btn-right');

    if (!document.getElementById('ultra-categories-style')) {
      const style = document.createElement('style');
      style.id = 'ultra-categories-style';
      style.textContent = `
        .categories-wrapper-grid,
        .categories-wrapper-carousel {
          max-width: 1400px;
          margin: auto;
          padding: 0 1rem;
        }

        .categories-grid {
          display: grid;
          gap: 1.2rem;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .categories-wrapper-carousel .categories-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 1rem;
          margin-bottom: 1rem;
          flex-wrap: wrap;
        }

        .categories-wrapper-carousel .categories-head h2 {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(1.6rem, 3vw, 2.2rem);
          color: #1F1E1C;
          margin: 0;
        }

        .categories-head-actions {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-left: auto;
        }

        .categories-scroll-hint {
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
          color: #7A746B;
          font-size: 0.88rem;
        }

        .categories-scroll-hint i {
          animation: categoriesHintPulse 1s infinite;
        }

        .categories-nav-buttons {
          display: none;
          align-items: center;
          gap: 0.55rem;
        }

        .categories-nav-btn {
          width: 2.6rem;
          height: 2.6rem;
          border: none;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: rgba(31, 30, 28, 0.88);
          color: #fff;
          cursor: pointer;
          transition: transform 0.2s ease, opacity 0.2s ease, background 0.2s ease;
          box-shadow: 0 10px 24px rgba(31, 30, 28, 0.16);
        }

        .categories-nav-btn:hover {
          transform: translateY(-1px);
          background: #7c3e3e;
        }

        .categories-nav-btn:disabled {
          opacity: 0.35;
          cursor: not-allowed;
          transform: none;
          background: rgba(31, 30, 28, 0.88);
        }

        .categories-row {
          display: flex;
          gap: 1rem;
          overflow-x: auto;
          padding-bottom: 0.35rem;
          scrollbar-width: none;
          -ms-overflow-style: none;
          scroll-behavior: smooth;
          cursor: grab;
        }

        .categories-row::-webkit-scrollbar {
          display: none;
        }

        .categories-row.is-dragging {
          cursor: grabbing;
          user-select: none;
          scroll-behavior: auto;
        }

        @media (min-width: 640px) {
          .categories-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }
        }

        @media (min-width: 1024px) {
          .categories-grid {
            grid-template-columns: repeat(4, minmax(0, 1fr));
          }

          .categories-nav-buttons {
            display: inline-flex;
          }
        }

        @media (min-width: 1440px) {
          .categories-grid {
            grid-template-columns: repeat(5, minmax(0, 1fr));
          }
        }

        .category-card {
          background: white;
          border-radius: 18px;
          overflow: hidden;
          cursor: pointer;
          transition:
            opacity 0.8s cubic-bezier(0.22, 1, 0.36, 1),
            transform 0.8s cubic-bezier(0.22, 1, 0.36, 1),
            box-shadow 0.4s ease;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
        }

        .categories-row .category-card {
          flex: 0 0 min(230px, 70vw);
        }

        .category-card.scroll-hidden {
          opacity: 0;
          transform: translateY(28px) scale(0.98);
        }

        .category-card.scroll-visible {
          opacity: 1;
          transform: translateY(0) scale(1);
        }

        .category-card:hover {
          transform: translateY(-8px);
          box-shadow: 0 20px 35px rgba(0, 0, 0, 0.12);
        }

        .category-image-container {
          width: 100%;
          aspect-ratio: 1 / 1;
          overflow: hidden;
          position: relative;
        }

        .category-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.6s ease;
        }

        .category-card:hover .category-image {
          transform: scale(1.08);
        }

        .category-overlay {
          position: absolute;
          inset: 0;
          background: linear-gradient(to top, rgba(0, 0, 0, 0.4), transparent);
          opacity: 0;
          transition: opacity 0.4s ease;
        }

        .category-card:hover .category-overlay {
          opacity: 1;
        }

        .category-name {
          padding: 1rem;
          text-align: center;
          font-size: 1rem;
          font-weight: 500;
          letter-spacing: 0.5px;
          color: #111;
          background: white;
        }

        @keyframes categoriesHintPulse {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(5px); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  bindCarouselEvents() {
    if (this.options.layout !== 'carousel' || !this.grid) return;

    this.leftButton?.addEventListener('click', () => this.scrollRowBy(-1));
    this.rightButton?.addEventListener('click', () => this.scrollRowBy(1));

    this.grid.addEventListener('scroll', () => this.updateCarouselButtons(), { passive: true });

    this.grid.addEventListener('wheel', (event) => {
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      event.preventDefault();
      this.grid.scrollLeft += event.deltaY;
    }, { passive: false });

    this.grid.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      this.isPointerDown = true;
      this.pointerStartX = event.pageX;
      this.scrollStartLeft = this.grid.scrollLeft;
      this.grid.classList.add('is-dragging');
    });

    window.addEventListener('mouseup', () => this.releasePointerDrag());
    this.grid.addEventListener('mouseleave', () => this.releasePointerDrag());
    this.grid.addEventListener('mousemove', (event) => {
      if (!this.isPointerDown) return;
      event.preventDefault();
      const delta = event.pageX - this.pointerStartX;
      this.grid.scrollLeft = this.scrollStartLeft - delta;
    });

    window.addEventListener('resize', () => this.updateCarouselButtons());
  }

  releasePointerDrag() {
    if (!this.isPointerDown || !this.grid) return;
    this.isPointerDown = false;
    this.grid.classList.remove('is-dragging');
  }

  scrollRowBy(direction = 1) {
    if (!this.grid) return;
    const amount = Math.max(this.grid.clientWidth * 0.82, 260);
    this.grid.scrollBy({
      left: amount * direction,
      behavior: 'smooth'
    });
  }

  updateCarouselButtons() {
    if (this.options.layout !== 'carousel' || !this.grid) return;

    const maxScrollLeft = Math.max(this.grid.scrollWidth - this.grid.clientWidth, 0);
    if (this.leftButton) {
      this.leftButton.disabled = this.grid.scrollLeft <= 4;
    }
    if (this.rightButton) {
      this.rightButton.disabled = this.grid.scrollLeft >= maxScrollLeft - 4;
    }
  }

  loadData() {
    const categoriesRef = collection(db, this.collectionName);
    const productsRef = collection(db, 'products');

    onSnapshot(query(categoriesRef), (snapshot) => {
      this.rawCategories = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));
      this.buildItems();
    }, (error) => {
      console.error('Erreur Firebase categories :', error);
    });

    onSnapshot(query(productsRef), (snapshot) => {
      this.firstProductImageByCategoryId.clear();

      snapshot.forEach((doc) => {
        const data = doc.data();
        const firstImage = this.getFirstProductImage(data);
        if (!firstImage) return;

        if (data?.categoryId && !this.firstProductImageByCategoryId.has(data.categoryId)) {
          this.firstProductImageByCategoryId.set(data.categoryId, firstImage);
        }
      });

      this.buildItems();
    }, (error) => {
      console.error('Erreur Firebase produits :', error);
    });
  }

  getFirstProductImage(productData) {
    if (!Array.isArray(productData?.images)) return '';
    const firstValid = productData.images.find((img) => typeof img === 'string' && img.trim() !== '');
    return firstValid || '';
  }

  resolveImagePath(imageValue) {
    if (typeof imageValue !== 'string') return '';
    const trimmed = imageValue.trim();
    if (!trimmed) return '';
    if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('./') || trimmed.startsWith('/')) {
      return trimmed;
    }
    return `./${trimmed}`;
  }

  buildItems() {
    this.items = [];

    this.rawCategories.forEach((category) => {
      const categoryName = category?.name || '';
      if (!categoryName) return;

      const imageFromCategory = this.resolveImagePath(category?.image || '');
      const imageFromProducts = this.resolveImagePath(this.firstProductImageByCategoryId.get(category.id) || '');

      this.items.push({
        id: category.id,
        name: categoryName,
        image: imageFromCategory || imageFromProducts
      });
    });

    this.renderCategories();
  }

  renderCategories() {
    this.grid.innerHTML = '';
    this.disconnectCategoryObserver();

    if (this.items.length === 0) {
      this.grid.innerHTML = '<p>Aucune categorie trouvee</p>';
      return;
    }

    this.items.forEach((item, index) => {
      this.grid.appendChild(this.createCategoryCard(item, index));
    });

    this.setupCategoryScrollAnimation();
    this.updateCarouselButtons();
  }

  createCategoryCard(item, index) {
    const card = document.createElement('div');
    card.className = 'category-card scroll-hidden';
    card.style.transitionDelay = `${Math.min(index * 110, 660)}ms`;
    card.dataset.categoryName = item.name;
    card.dataset.categoryId = item.id;

    const imageHtml = item.image
      ? `<img src="${item.image}" class="category-image" loading="lazy" onerror="this.remove();">`
      : `<div class="category-image" style="display:flex;align-items:center;justify-content:center;background:#f4f4f4;color:#9b9b9b;"><i class="fas fa-image"></i></div>`;

    card.innerHTML = `
      <div class="category-image-container">
        ${imageHtml}
        <div class="category-overlay"></div>
      </div>
      <div class="category-name">${item.name}</div>
    `;

    card.addEventListener('click', () => {
      this.redirectToCatalogue({ categoryName: item.name });
    });

    return card;
  }

  disconnectCategoryObserver() {
    if (this.categoryObserver) {
      this.categoryObserver.disconnect();
      this.categoryObserver = null;
    }
  }

  setupCategoryScrollAnimation() {
    const cards = this.grid.querySelectorAll('.category-card');
    if (!cards.length) return;

    const revealCard = (card) => {
      card.classList.remove('scroll-hidden');
      card.classList.add('scroll-visible');
    };

    if (!('IntersectionObserver' in window)) {
      cards.forEach(revealCard);
      return;
    }

    this.categoryObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        revealCard(entry.target);
        this.categoryObserver.unobserve(entry.target);
      });
    }, {
      threshold: 0.18,
      rootMargin: '0px 0px -8% 0px'
    });

    cards.forEach((card) => this.categoryObserver.observe(card));
  }

  redirectToCatalogue({ categoryId, categoryName, columnId, lineId, openFilters = false } = {}) {
    const params = new URLSearchParams();
    const resolvedCategory = categoryName || categoryId || '';

    if (resolvedCategory) {
      params.set('category', resolvedCategory);
    }

    if (categoryId && columnId && lineId) {
      params.set('line', `${categoryId}::${columnId}::${lineId}`);
    }

    if (openFilters === true) {
      params.set('filters', 'open');
    }

    window.location.href = `./catalogue.html${params.toString() ? `?${params.toString()}` : ''}`;
  }

  destroy() {
    this.disconnectCategoryObserver();
  }
}

export default CategoriesDisplay;
window.CategoriesDisplay = CategoriesDisplay;
