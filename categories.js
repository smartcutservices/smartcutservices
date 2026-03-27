import { db } from './firebase-init.js';
import { collection, query, onSnapshot } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

class CategoriesDisplay {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error('Container categories introuvable');
      return;
    }

    this.collectionName = 'categories_list';
    this.items = [];
    this.rawCategories = [];
    this.firstProductImageByCategoryId = new Map();
    this.categoryObserver = null;

    this.init();
  }

  init() {
    this.renderBase();
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
      <div class="categories-wrapper">
        <div class="categories-grid"></div>
      </div>
    `;

    this.grid = this.container.querySelector('.categories-grid');

    if (!document.getElementById('ultra-categories-style')) {
      const style = document.createElement('style');
      style.id = 'ultra-categories-style';
      style.textContent = `
        .categories-wrapper {
          max-width: 1400px;
          margin: auto;
          padding: 1.5rem;
        }

        .categories-grid {
          display: grid;
          gap: 1.2rem;
          grid-template-columns: repeat(2, 1fr);
        }

        @media (min-width: 640px) {
          .categories-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }

        @media (min-width: 1024px) {
          .categories-grid {
            grid-template-columns: repeat(4, 1fr);
          }
        }

        @media (min-width: 1440px) {
          .categories-grid {
            grid-template-columns: repeat(5, 1fr);
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
      `;
      document.head.appendChild(style);
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
