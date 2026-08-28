import { marketplaceApi, money, escapeHtml as esc } from './marketplace-api.js';
import { loadPublicProducts } from './catalog-products.js?v=20260711-1';
import { getResolvedProductImages, getFallbackProductImage } from './image-fallbacks.js';
import { buildProductPageUrl } from './product-links.js';
import { formatPriceDual } from './currency-utils.js';

const SERVICE_ONLY_THRESHOLD = 6;
const CAROUSEL_TARGET = 8;

function productImage(product) {
  return getResolvedProductImages(product, './')[0] || getFallbackProductImage(product, './');
}

function productPrice(product) {
  const variationPrice = Array.isArray(product.variations)
    ? product.variations.map((variation) => Number(variation?.price)).find((price) => Number.isFinite(price) && price > 0)
    : 0;
  return formatPriceDual(variationPrice || Number(product.price) || 0);
}

function serviceCard(service) {
  const price = service.pricingType === 'CUSTOM_QUOTE' ? 'Sur devis' : money(service.priceMinor);
  return `<a class="services-carousel-card" href="./service.html?slug=${encodeURIComponent(service.slug)}" aria-label="Voir le service ${esc(service.name)}">
    <span class="services-carousel-media"><img src="${esc(service.coverImage || './logo.png')}" alt="" width="640" height="480" loading="lazy"></span>
    <span class="services-carousel-body"><strong>${esc(service.name)}</strong><small>${esc(service.shortDescription || 'Service professionnel proposé sur Smart Cut.')}</small><span class="services-carousel-price">${esc(price)}</span></span>
  </a>`;
}

function productCard(product) {
  return `<a class="services-carousel-card" href="${esc(buildProductPageUrl(product.id))}" aria-label="Voir le produit ${esc(product.name || 'Produit')}">
    <span class="services-carousel-media"><img src="${esc(productImage(product))}" alt="" width="640" height="480" loading="lazy"></span>
    <span class="services-carousel-body"><strong>${esc(product.name || 'Produit Smart Cut')}</strong><small>${esc(product.shortDescription || product.categoryName || product.category || 'Disponible sur Smart Cut Services.')}</small><span class="services-carousel-price">${esc(productPrice(product))}</span></span>
  </a>`;
}

function attachCarouselControls(root) {
  const carousel = root.querySelector('.services-carousel-track');
  if (!carousel) return;
  const buttons = [...root.querySelectorAll('[data-services-scroll]')];
  const updateButtons = () => {
    const maxScroll = Math.max(0, carousel.scrollWidth - carousel.clientWidth);
    buttons.forEach((button) => {
      button.hidden = maxScroll < 2;
      button.disabled = button.dataset.servicesScroll === 'next'
        ? carousel.scrollLeft >= maxScroll - 2
        : carousel.scrollLeft <= 2;
    });
  };
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const direction = button.dataset.servicesScroll === 'next' ? 1 : -1;
      carousel.scrollBy({ left: direction * Math.max(260, carousel.clientWidth * .78), behavior: 'smooth' });
    });
  });
  carousel.addEventListener('scroll', updateButtons, { passive: true });
  new ResizeObserver(updateButtons).observe(carousel);
  updateButtons();
}

export async function initServicesTeaser(options = {}) {
  const root = options.container || document.getElementById('sierra-services-teaser-root');
  if (!root) return;
  root.hidden = true;

  try {
    const response = await marketplaceApi('PublicServices', { query: { limit: 12 } });
    const services = Array.isArray(response.services) ? response.services.slice(0, 12) : [];
    if (!services.length) {
      root.replaceChildren();
      return;
    }

    let products = [];
    if (services.length < SERVICE_ONLY_THRESHOLD) {
      products = await loadPublicProducts({ maxPerCollection: 24 }).catch(() => []);
      products = products.slice(0, Math.max(0, CAROUSEL_TARGET - services.length));
    }

    const cards = [...services.map(serviceCard), ...products.map(productCard)].join('');
    root.innerHTML = `<section class="services-teaser" aria-label="Services professionnels">
      <div class="services-teaser-inner">
        <div class="services-teaser-head">
          <p class="services-teaser-label">Services professionnels</p>
          <div class="services-teaser-actions"><a class="services-teaser-button" href="./logiciel proformat/">Proposer un service</a><a class="services-teaser-button primary" href="./services.html">Voir tous les services</a></div>
        </div>
        <div class="services-carousel-shell">
          <button class="services-carousel-arrow previous" type="button" data-services-scroll="previous" aria-label="Voir les cartes précédentes">‹</button>
          <div class="services-carousel-track" aria-label="Offres de services et produits complémentaires">${cards}</div>
          <button class="services-carousel-arrow next" type="button" data-services-scroll="next" aria-label="Voir les cartes suivantes">›</button>
        </div>
      </div>
    </section>`;
    attachCarouselControls(root);
    root.hidden = false;
  } catch (error) {
    console.error('Impossible de charger les services de la page d’accueil.', error);
    root.replaceChildren();
  }
}

export default class ServicesTeaser {
  constructor(rootId, options = {}) {
    initServicesTeaser({ ...options, container: document.getElementById(rootId) });
  }
}
