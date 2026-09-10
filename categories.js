import { db } from './firebase-init.js';
import { collection, query, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { loadPublicProducts } from './catalog-products.js';

const TAXONOMY_URLS = ['./product-taxonomy.json', './auto-parts-taxonomy.json', './digital-download-taxonomy.json'];

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
    this.availableCategoryIds = new Set();
    this.availableCategoryNames = new Set();
    this.productFallbackItems = [];
    this.taxonomyDepartments = [];
    this.productsLoaded = false;
    this.categoryObserver = null;
    this.isPointerDown = false;
    this.pointerStartX = 0;
    this.scrollStartLeft = 0;

    this.init();
  }

  init() {
    this.renderBase();
    this.bindCarouselEvents();
    // The category rail is part of the first viewport on the homepage.
    // Start its data request immediately instead of waiting for an observer tick.
    this.loadData();
    this.bindMenuOpenEvents();
  }

  deferDataLoad() {
    const load = () => this.loadData();
    if (!('IntersectionObserver' in window)) {
      load();
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      load();
    }, { rootMargin: '250px 0px' });
    observer.observe(this.container);
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
          font-family: 'Amazon Ember', Arial, sans-serif;
          font-size: clamp(1.6rem, 3vw, 2.2rem);
          color: #0F1111;
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
          overflow-y: hidden;
          /* Autorise le navigateur à transmettre un geste vertical à la
             page même lorsque le doigt commence sur une carte. */
          touch-action: pan-x pan-y !important;
          overscroll-behavior-x: contain;
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

        .categories-row .category-card,
        .categories-row .category-card * {
          touch-action: pan-x pan-y !important;
        }

        /* Priorité supérieure au style de compatibilité injecté par la page :
           un rail horizontal doit aussi laisser passer le geste vertical. */
        #sierra-home-categories-root .categories-row {
          touch-action: pan-x pan-y !important;
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
        }

        @media (hover: hover) and (pointer: fine) {
          .categories-nav-buttons {
            display: inline-flex;
          }

          .categories-scroll-hint {
            display: none;
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

        .categories-row .department-card {
          flex-basis: min(190px, 57vw);
          border: 1px solid rgba(20, 33, 41, 0.09);
          border-radius: 14px;
          box-shadow: none;
        }

        .department-card .category-image-container {
          aspect-ratio: 16 / 9;
        }

        .department-card .category-name {
          padding: 0.7rem 0.8rem 0.8rem;
          text-align: left;
          font-size: 0.86rem;
          font-weight: 700;
          letter-spacing: 0;
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
      // Ne jamais bloquer le scroll vertical de la page au-dessus du rail.
      // Le défilement horizontal reste disponible avec un geste horizontal
      // ou Shift + molette.
      if (!event.shiftKey && Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      if (Math.abs(event.deltaX) > 0) {
        event.preventDefault();
        this.grid.scrollLeft += event.deltaX;
      } else if (event.shiftKey) {
        event.preventDefault();
        this.grid.scrollLeft += event.deltaY;
      }
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

  async loadData() {
    const categoriesRef = collection(db, this.collectionName);

    try {
      // The homepage only needs a current snapshot. Keeping two realtime
      // listeners open was consuming significant data on every visit.
      const [categoriesSnapshot, publicProducts, ...taxonomyResponses] = await Promise.all([
        getDocs(query(categoriesRef)),
        loadPublicProducts({ maxPerCollection: 200 }),
        ...TAXONOMY_URLS.map((url) => fetch(url, { cache: 'no-store' }).catch(() => null))
      ]);

      this.rawCategories = categoriesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));

      this.firstProductImageByCategoryId.clear();
      this.availableCategoryIds.clear();
      this.availableCategoryNames.clear();
      this.productFallbackItems = [];

      const taxonomy = [];
      for (const response of taxonomyResponses) {
        const data = response?.ok ? await response.json().catch(() => null) : null;
        if (data?.id) taxonomy.push(data);
        if (Array.isArray(data?.departments)) taxonomy.push(...data.departments);
      }
      this.taxonomyDepartments = [...new Map(taxonomy.filter((item) => item?.id).map((item) => [String(item.id), item])).values()];

      publicProducts.forEach((data) => {
        const firstImage = this.getFirstProductImage(data);
        const categoryId = String(data?.categoryId || data?.category || '').trim();
        const categoryName = String(data?.categoryName || data?.category || '').trim().toLowerCase();
        if (firstImage) this.productFallbackItems.push({ id: data?.id || '', name: data?.name || 'Produit populaire', image: firstImage, product: true });
        if (categoryId) this.availableCategoryIds.add(categoryId);
        if (categoryName) this.availableCategoryNames.add(categoryName);
        if (!firstImage) return;

        if (categoryId && !this.firstProductImageByCategoryId.has(categoryId)) {
          this.firstProductImageByCategoryId.set(categoryId, firstImage);
        }
      });

      this.productsLoaded = true;
      this.buildItems();
    } catch (error) {
      console.error('Erreur Firebase categories:', error);
      if (this.grid) this.grid.innerHTML = '<p>Impossible de charger les catégories pour le moment.</p>';
    }
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
    const path = /^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('./') || trimmed.startsWith('/')
      ? trimmed
      : `./${trimmed}`;
    const optimizedImages = {
      './TI0055.png': './TI0055.webp',
      '/TI0055.png': './TI0055.webp',
      './electrique.png': './electrique.webp',
      '/electrique.png': './electrique.webp',
      './PC007.png': './PC007.webp',
      '/PC007.png': './PC007.webp',
      './vetements.jpg': './vetements.webp',
      '/vetements.jpg': './vetements.webp',
      './22a.jpg': './22a.webp',
      '/22a.jpg': './22a.webp',
      './assets/auto-parts/hero-auto-parts-v1.png': './assets/auto-parts/hero-auto-parts-v1.webp',
      './assets/education/hero-learning-v2.png': './assets/education/hero-learning-v2.webp',
      './assets/health/home-health-visual-v2.png': './assets/health/home-health-visual-v2.webp'
    };
    let localPath = path;
    try {
      localPath = new URL(path, window.location.origin).pathname;
    } catch (_) {}
    const optimizedByFilename = {
      'ti0055.png': './TI0055.webp',
      'electrique.png': './electrique.webp',
      'pc007.png': './PC007.webp',
      'vetements.jpg': './vetements.webp',
      '22a.jpg': './22a.webp',
      'pe001.jpg': './PE001.webp',
      'autres001.webp': './Autres001.webp',
      'am001.jpg': './AM001.webp',
      't3b.jpg': './t3b.webp',
      'medical (54).png': './medical (54).webp',
      'hero-auto-parts-v1.png': './assets/auto-parts/hero-auto-parts-v1.webp',
      'hero-learning-v2.png': './assets/education/hero-learning-v2.webp',
      'home-health-visual-v2.png': './assets/health/home-health-visual-v2.webp'
    };
    const sourceKey = decodeURIComponent(`${path} ${localPath}`).toLowerCase();
    const optimizedMatch = Object.entries(optimizedByFilename)
      .find(([filename]) => sourceKey.includes(filename));
    return optimizedImages[path] || optimizedImages[localPath] || optimizedMatch?.[1] || path;
  }

  buildItems() {
    this.items = [];
    if (!this.productsLoaded) {
      if (this.grid) this.grid.innerHTML = '<p aria-live="polite">Chargement des catégories…</p>';
      return;
    }

    const savedById = new Map(this.rawCategories.map((item) => [String(item.id), item]));
    this.items = this.taxonomyDepartments.map((department) => {
      const id = String(department.id || '').trim();
      const saved = savedById.get(id) || {};
      return {
        id,
        name: saved.name || department.label || department.name || id,
        image: this.resolveImagePath(saved.image || department.image || department.imageUrl || ''),
        department: true
      };
    }).filter((item) => item.id && item.name);

    // Keep the older category rail functional until every taxonomy document is present.
    if (!this.items.length) {
      this.items = this.rawCategories.map((category) => ({
        id: category.id,
        name: category.name || '',
        image: this.resolveImagePath(category.image || this.firstProductImageByCategoryId.get(category.id) || '')
      })).filter((item) => item.name);
    }

    this.renderCategories();
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

  renderCategories() {
    this.grid.innerHTML = '';
    this.disconnectCategoryObserver();

    if (this.items.length === 0) {
      this.grid.innerHTML = '<p>Aucune categorie trouvee</p>';
      return;
    }

    if (this.options.groupedCards && this.options.layout === 'carousel') {
      for (let i = 0; i < this.items.length && i < 12; i += 3) {
        this.grid.appendChild(this.createGroupedCategoryCard(this.items.slice(i, i + 3), i / 3));
      }
      this.setupCategoryScrollAnimation();
      this.updateCarouselButtons();
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
    card.className = `category-card scroll-hidden ${item.department ? 'department-card' : ''}`;
    card.style.transitionDelay = `${Math.min(index * 110, 660)}ms`;
    card.dataset.categoryName = item.name;
    card.dataset.categoryId = item.id;
    if (item.ecosystem) card.dataset.ecosystem = 'true';

    const imageHtml = item.image
      ? `<img src="${item.image}" class="category-image" loading="${index === 0 ? 'eager' : 'lazy'}" fetchpriority="${index === 0 ? 'high' : 'low'}" decoding="async" width="768" height="512" alt="${item.name}" onerror="this.remove();">`
      : `<div class="category-image" style="display:flex;align-items:center;justify-content:center;background:#f4f4f4;color:#9b9b9b;"><i class="fas fa-image"></i></div>`;

    card.innerHTML = `
      <div class="category-image-container">
        ${imageHtml}
        <div class="category-overlay"></div>
      </div>
      <div class="category-name">${item.name}${item.ecosystem && item.description ? `<small class="ecosystem-description">${item.description}</small>` : ''}</div>
    `;

    card.addEventListener('click', () => item.department
      ? this.redirectToCatalogue({ departmentId: item.id })
      : (item.ecosystem ? window.location.assign(item.href) : this.redirectToCatalogue({ categoryName: item.name })));

    return card;
  }

  createGroupedCategoryCard(items, index) {
    const card = document.createElement('div');
    card.className = 'category-card category-card--grouped scroll-hidden';
    card.style.transitionDelay = `${Math.min(index * 110, 660)}ms`;
    const image = (item, imageIndex) => item.image
      ? `<img src="${item.image}" class="category-image" loading="${index === 0 && imageIndex === 0 ? 'eager' : 'lazy'}" fetchpriority="${index === 0 && imageIndex === 0 ? 'high' : 'low'}" decoding="async" width="768" height="512" alt="${item.name}">`
      : '<div class="category-image category-image--empty"><i class="fas fa-image"></i></div>';
    const href = (item) => item.ecosystem
      ? item.href
      : item.product
        ? `./product.html?product=${encodeURIComponent(item.id)}`
        : `./catalogue.html?category=${encodeURIComponent(item.name)}`;
    const linkImage = (item, imageIndex) => `<a class="category-group-link" href="${href(item)}" aria-label="Voir ${item.name}">${image(item, imageIndex)}</a>`;
    const names = items.map((item) => item.name).filter(Boolean).join(' · ');
    card.innerHTML = `
      <div class="category-group-main">${linkImage(items[0], 0)}</div>
      ${items.length > 1 ? `<div class="category-group-subgrid">${items.slice(1).map((item, imageIndex) => `<div>${linkImage(item, imageIndex + 1)}<span>${item.name}</span></div>`).join('')}</div>` : ''}
      <div class="category-group-title" title="${names}">${names}</div>
    `;
    card.querySelectorAll('.category-group-link').forEach((link) => link.addEventListener('click', (event) => event.stopPropagation()));
    card.addEventListener('click', () => {
      const item = items[0];
      if (item.ecosystem) window.location.assign(item.href);
      else if (item.product) window.location.assign(`./product.html?product=${encodeURIComponent(item.id)}`);
      else this.redirectToCatalogue({ categoryName: item.name });
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

  redirectToCatalogue({ departmentId, categoryId, categoryName, columnId, lineId, openFilters = false } = {}) {
    const params = new URLSearchParams();
    if (departmentId) params.set('department', departmentId);
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
