import { marketplaceApi, money, escapeHtml as esc } from './marketplace-api.js?v=20260826-1';

const grid = document.getElementById('servicesGrid');
const form = document.getElementById('filters');
const count = document.getElementById('servicesCount');
const clearButton = document.getElementById('clearFilters');
const categoryLabels = {
  design: 'Graphisme',
  development: 'Développement',
  marketing: 'Marketing',
  writing: 'Rédaction & traduction',
  video: 'Vidéo'
};

function serviceCard(service, provider) {
  const price = service.pricingType === 'CUSTOM_QUOTE'
    ? 'Sur devis'
    : service.pricingType === 'STARTING_AT'
      ? `Dès ${money(service.priceMinor)}`
      : money(service.priceMinor);
  const image = service.coverImage || './logo.png';
  const category = categoryLabels[service.categoryId] || service.categoryId || 'Service professionnel';
  const href = `./service.html?slug=${encodeURIComponent(service.slug)}`;
  const deliveryDays = Math.max(1, Number(service.deliveryDays) || 1);

  return `
    <article class="service-card">
      <a href="${href}" aria-label="Voir ${esc(service.name)}">
        <img src="${esc(image)}" alt="" width="640" height="360" loading="lazy">
      </a>
      <div class="service-card-body">
        <span class="service-category">${esc(category)}</span>
        <h2><a href="${href}">${esc(service.name)}</a></h2>
        <span class="provider">${esc(provider?.businessName || 'Prestataire Smart Cut')}</span>
        <div class="service-meta">
          <div><span class="service-price-label">Tarif</span><strong>${esc(price)}</strong></div>
          <div class="service-delay"><span class="service-delay-label">Livraison</span>${deliveryDays} jour${deliveryDays > 1 ? 's' : ''}</div>
        </div>
        <a class="service-card-link" href="${href}">Voir le service <span aria-hidden="true">→</span></a>
      </div>
    </article>`;
}

function showLoading() {
  grid.setAttribute('aria-busy', 'true');
  count.textContent = 'Recherche en cours…';
  grid.innerHTML = Array.from({ length: 6 }, () => '<div class="services-skeleton" aria-hidden="true"></div>').join('');
}

function hasActiveFilters() {
  const values = Object.fromEntries(new FormData(form));
  return Object.entries(values).some(([key, value]) => value && !(key === 'sort' && value === 'recent'));
}

async function load() {
  showLoading();
  clearButton.hidden = !hasActiveFilters();

  try {
    const query = Object.fromEntries(new FormData(form));
    query.maxPriceMinor = query.maxPrice ? Math.round(Number(query.maxPrice) * 100) : '';
    delete query.maxPrice;
    const response = await marketplaceApi('PublicServices', { query: { ...query, limit: 24 } });
    const services = Array.isArray(response.services) ? response.services : [];

    grid.removeAttribute('aria-busy');
    count.textContent = `${services.length} service${services.length > 1 ? 's' : ''}`;
    grid.innerHTML = services.length
      ? services.map(service => serviceCard(service, response.providers?.[service.ownerUid])).join('')
      : '<div class="empty"><h2>Aucun service trouvé</h2><p>Modifiez les filtres ou réinitialisez votre recherche.</p></div>';
  } catch (error) {
    grid.removeAttribute('aria-busy');
    count.textContent = 'Chargement impossible';
    grid.innerHTML = `<div class="error-state"><h2>Services indisponibles</h2><p>${esc(error.message)}</p><button class="button" id="retry" type="button">Réessayer</button></div>`;
    document.getElementById('retry')?.addEventListener('click', load);
  }
}

let searchTimer;
form.addEventListener('submit', event => {
  event.preventDefault();
  clearTimeout(searchTimer);
  load();
});
form.querySelector('input[type="search"]')?.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(load, 350);
});
for (const field of form.querySelectorAll('select')) field.addEventListener('change', load);
clearButton.addEventListener('click', () => {
  form.reset();
  form.querySelector('input[type="search"]')?.focus();
  load();
});

load();
