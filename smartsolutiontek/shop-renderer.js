// Shared rendering module for the Boutique app (Application 2) — e-commerce visual theme.
// Pure presentation, no Firestore/network — imported identically by page.html (real storefront)
// and dashboard.html (creator workspace live preview), so the two never drift. Mirrors the
// pattern established by field-renderer.js for the Formulaires app.
//
// Section order/visibility, delivery info, and design tokens all come from the catalog object
// returned by GetPublicShop — the exact same shape the workspace edits in memory before saving,
// which is what keeps "what the creator sees" and "what a visitor sees" identical.

import { escapeHtml, formatCurrency } from './api.js';

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const FONT_STACKS = {
  system: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
  serif: `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif`,
  mono: `"SF Mono", "Roboto Mono", Menlo, Consolas, monospace`
};

function productImage(product, index = 0) {
  const url = Array.isArray(product.images) && product.images[index];
  const alt = Array.isArray(product.imagesAlt) && product.imagesAlt[index] ? product.imagesAlt[index] : product.name;
  return url
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy">`
    : `<div class="sst-shop-noimage"><i class="fas fa-image"></i></div>`;
}

function stockBadge(product) {
  if (!product.inStock) return `<span class="sst-shop-stock-badge out">Rupture de stock</span>`;
  if (product.type !== 'digital' && Number.isFinite(product.lowStockThreshold) && product.lowStockThreshold !== null
    && Number.isFinite(product.stock) && product.stock !== null && product.stock <= product.lowStockThreshold) {
    return `<span class="sst-shop-stock-badge low">Stock limité</span>`;
  }
  return '';
}

function safeExternalUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch (_) {
    return '';
  }
}

// ---------- Theme application ----------

/** Applies every design token from `catalog.design` (+ legacy `catalog.colors`) as CSS custom
 * properties and a handful of modifier classes on `rootEl`. Called identically by the workspace
 * preview and the public page, so a color/radius/density change looks the same in both places. */
export function applyShopTheme(rootEl, catalog) {
  const design = catalog.design || {};
  const colors = design.colors || catalog.colors || {};
  const primary = HEX_COLOR_PATTERN.test(colors.primary) ? colors.primary : '#0F172A';
  const accent = HEX_COLOR_PATTERN.test(colors.buttonColor) ? colors.buttonColor
    : (HEX_COLOR_PATTERN.test(colors.accent) ? colors.accent : '#F59E0B');
  const background = HEX_COLOR_PATTERN.test(colors.backgroundColor) ? colors.backgroundColor : '#F8FAFC';
  const text = HEX_COLOR_PATTERN.test(design.textColor) ? design.textColor : null;
  const onPrimary = (contrastRatio(primary, '#FFFFFF') || 0) >= (contrastRatio(primary, '#111827') || 0) ? '#FFFFFF' : '#111827';
  const onAccent = (contrastRatio(accent, '#FFFFFF') || 0) >= (contrastRatio(accent, '#111827') || 0) ? '#FFFFFF' : '#111827';

  rootEl.style.setProperty('--shop-primary', primary);
  rootEl.style.setProperty('--shop-accent', accent);
  rootEl.style.setProperty('--shop-bg', background);
  rootEl.style.setProperty('--shop-on-primary', onPrimary);
  rootEl.style.setProperty('--shop-on-accent', onAccent);
  if (text) rootEl.style.setProperty('--shop-text', text);
  rootEl.style.setProperty('--shop-font', FONT_STACKS[design.font] || FONT_STACKS.system);
  rootEl.style.setProperty('--shop-radius', `${Number.isFinite(design.radius) ? design.radius : 12}px`);

  rootEl.classList.remove('shop-density-compact', 'shop-density-spacious', 'shop-btn-rounded', 'shop-btn-square', 'shop-card-bordered', 'shop-card-shadow');
  if (design.density === 'compact') rootEl.classList.add('shop-density-compact');
  if (design.density === 'spacious') rootEl.classList.add('shop-density-spacious');
  if (design.buttonStyle === 'rounded') rootEl.classList.add('shop-btn-rounded');
  if (design.buttonStyle === 'square') rootEl.classList.add('shop-btn-square');
  if (design.cardStyle === 'bordered') rootEl.classList.add('shop-card-bordered');
  if (design.cardStyle === 'shadow') rootEl.classList.add('shop-card-shadow');
}

// A handful of professional presets the workspace can offer as one-click starting points —
// still just ordinary `design` objects, so nothing about applying them is special-cased.
export const DESIGN_PRESETS = [
  { id: 'monochrome', label: 'Monochrome', design: { colors: { primary: '#111111', accent: '#111111', buttonColor: '#111111', backgroundColor: '#FAFAFA' }, font: 'system', radius: 4, density: 'normal', buttonStyle: 'square', cardStyle: 'bordered' } },
  { id: 'warm', label: 'Chaleureux', design: { colors: { primary: '#2B1B12', accent: '#C2410C', buttonColor: '#C2410C', backgroundColor: '#FBF6F1' }, font: 'serif', radius: 14, density: 'spacious', buttonStyle: 'pill', cardStyle: 'flat' } },
  { id: 'modern', label: 'Moderne', design: { colors: { primary: '#0F172A', accent: '#0071E3', buttonColor: '#0071E3', backgroundColor: '#F5F5F7' }, font: 'system', radius: 12, density: 'normal', buttonStyle: 'rounded', cardStyle: 'shadow' } },
  { id: 'bold', label: 'Affirmé', design: { colors: { primary: '#000000', accent: '#DC2626', buttonColor: '#DC2626', backgroundColor: '#FFFFFF' }, font: 'mono', radius: 0, density: 'compact', buttonStyle: 'square', cardStyle: 'bordered' } }
];

/** WCAG-ish sanity check used by the workspace to warn about low-contrast combinations —
 * relative luminance contrast ratio between a hex color and white/black text. */
export function contrastRatio(hex1, hex2) {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  if (!HEX_COLOR_PATTERN.test(hex1) || !HEX_COLOR_PATTERN.test(hex2)) return null;
  const l1 = lum(hex1) + 0.05;
  const l2 = lum(hex2) + 0.05;
  return Math.round((Math.max(l1, l2) / Math.min(l1, l2)) * 100) / 100;
}

// ---------- Chrome (nav / announcement / hero) ----------

export function renderAnnouncementBar(catalog) {
  const sections = catalog.sections;
  if (!sections || sections.visibility?.hero === false) { /* no-op guard, announcement is independent */ }
  const text = catalog.sections?.announcement;
  if (!text) return '';
  return `<div class="sst-shop-announcement">${escapeHtml(text)}</div>`;
}

export function renderClosedBanner(catalog) {
  if (!catalog.closedTemporarily) return '';
  return `<div class="sst-shop-closed-banner"><i class="fas fa-circle-pause" aria-hidden="true"></i> ${escapeHtml(catalog.closedMessage || 'Cette boutique est temporairement fermée.')}</div>`;
}

export function renderShopNav(catalog, cartCount = 0) {
  const logo = catalog.logoUrl
    ? `<img src="${escapeHtml(catalog.logoUrl)}" alt="">`
    : `<span>${escapeHtml((catalog.name || 'B').trim().charAt(0).toUpperCase())}</span>`;
  const hasContact = Boolean(catalog.contactInfo?.phone || catalog.contactInfo?.email);
  return `
    <nav class="sst-shop-nav" aria-label="Navigation principale">
      <div class="sst-shop-nav-inner">
        <a class="sst-shop-nav-brand" href="#" aria-label="Accueil de ${escapeHtml(catalog.name || 'la boutique')}">
          <span class="sst-shop-nav-logo">${logo}</span>
          <span class="sst-shop-nav-identity"><strong>${escapeHtml(catalog.name || 'Boutique')}</strong><small>Boutique en ligne</small></span>
        </a>
        <div class="sst-shop-nav-links">
          <a href="#">Accueil</a>
          <a href="#shopProducts">Produits</a>
          ${hasContact ? '<a href="#shopContact">Contact</a>' : ''}
        </div>
        <div class="sst-shop-nav-actions">
          <a class="sst-shop-nav-search" id="shopNavSearch" href="#shopProducts" aria-label="Rechercher un produit"><i class="fas fa-magnifying-glass" aria-hidden="true"></i></a>
          <button class="sst-shop-cart-fab" id="shopCartFab" type="button" aria-label="Ouvrir le panier (${cartCount} article${cartCount > 1 ? 's' : ''})">
            <i class="fas fa-bag-shopping" aria-hidden="true"></i><span>Panier</span><b id="shopCartCount">${cartCount}</b>
          </button>
        </div>
      </div>
    </nav>
  `;
}

export function renderShopHero(catalog) {
  const title = escapeHtml(catalog.heroTitle || catalog.name || '');
  const subtitle = catalog.heroSubtitle || catalog.description || '';
  const logo = catalog.logoUrl ? `<img class="sst-shop-logo" src="${escapeHtml(catalog.logoUrl)}" alt="Logo">` : '';
  const layout = catalog.layout || 'minimal';
  const align = catalog.heroAlign === 'center' ? ' sst-shop-hero-center' : '';
  const height = catalog.heroHeight && catalog.heroHeight !== 'normal' ? ` sst-shop-hero-${catalog.heroHeight}` : '';
  const cta = catalog.sections?.visibility?.collection !== false
    ? `<a class="sst-shop-hero-cta" href="#shopProducts">Voir la collection</a>` : '';

  if (layout === 'image') {
    if (!catalog.bannerUrl) return '';
    return `<header class="sst-shop-hero sst-shop-hero-image-only${height}"><img src="${escapeHtml(catalog.bannerUrl)}" alt="Bannière de ${escapeHtml(catalog.name || 'la boutique')}"></header>`;
  }
  if (layout === 'cover' && catalog.bannerUrl) {
    return `
      <header class="sst-shop-hero sst-shop-hero-cover${align}${height}" style="background-image:url('${escapeHtml(catalog.bannerUrl)}')">
        <div class="sst-shop-hero-scrim"></div>
        <div class="sst-shop-hero-content">${logo}<h1>${title}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}${cta}</div>
      </header>
    `;
  }
  if (layout === 'hero' && catalog.bannerUrl) {
    return `
      <header class="sst-shop-hero sst-shop-hero-banner${align}${height}">
        <div class="sst-shop-hero-media"><img src="${escapeHtml(catalog.bannerUrl)}" alt=""></div>
        <div class="sst-shop-hero-content">${logo}<h1>${title}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}${cta}</div>
      </header>
    `;
  }
  return `<header class="sst-shop-hero sst-shop-hero-minimal${align}${height}">${logo}<h1>${title}</h1>${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ''}${cta}</header>`;
}

// ---------- Collection (search / sort / filter / grid) ----------

export function renderSearchSortBar(searchTerm, sort) {
  const sortOptions = [
    ['relevance', 'Pertinence'],
    ['newest', 'Nouveautés'],
    ['price_asc', 'Prix croissant'],
    ['price_desc', 'Prix décroissant']
  ];
  return `
    <div class="sst-shop-toolbar">
      <div class="sst-shop-search"><i class="fas fa-magnifying-glass" aria-hidden="true"></i>
        <input type="search" id="shopSearchInput" placeholder="Rechercher un produit" value="${escapeHtml(searchTerm || '')}" aria-label="Rechercher un produit">
      </div>
      <select class="sst-shop-sort" id="shopSortSelect" aria-label="Trier les produits">
        ${sortOptions.map(([value, label]) => `<option value="${value}" ${sort === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </div>
  `;
}

export function renderCategoryTabs(products, activeCategory) {
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];
  if (!categories.length) return '';
  return `
    <div class="sst-shop-categories">
      <button class="sst-shop-cat-tab ${!activeCategory ? 'active' : ''}" data-shop-cat="">Tout</button>
      ${categories.map((c) => `<button class="sst-shop-cat-tab ${activeCategory === c ? 'active' : ''}" data-shop-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
    </div>
  `;
}

export function filterAndSortProducts(products, { activeCategory, searchTerm, sort } = {}) {
  let list = activeCategory ? products.filter((p) => p.category === activeCategory) : products.slice();
  const term = (searchTerm || '').trim().toLowerCase();
  if (term) {
    list = list.filter((p) => (p.name || '').toLowerCase().includes(term)
      || (p.category || '').toLowerCase().includes(term)
      || (p.tags || []).some((t) => t.toLowerCase().includes(term)));
  }
  if (sort === 'price_asc') list = list.slice().sort((a, b) => a.price - b.price);
  else if (sort === 'price_desc') list = list.slice().sort((a, b) => b.price - a.price);
  else if (sort === 'newest') list = list.slice().sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return list;
}

export function renderProductCard(product) {
  const priceHtml = product.comparePrice && product.comparePrice > product.price
    ? `<span class="sst-shop-price">${formatCurrency(product.price)}</span> <span class="sst-shop-compare-price">${formatCurrency(product.comparePrice)}</span>`
    : `<span class="sst-shop-price">${formatCurrency(product.price)}</span>`;
  return `
    <article class="sst-shop-product-card" data-product-id="${product.id}">
      ${product.featured ? '<span class="sst-shop-featured-ribbon">Vedette</span>' : ''}
      <div class="sst-shop-product-image">${productImage(product)}${stockBadge(product)}</div>
      <div class="sst-shop-product-body">
        ${product.category ? `<span class="sst-shop-product-category">${escapeHtml(product.category)}</span>` : ''}
        <h3 class="sst-shop-product-name">${escapeHtml(product.name)}</h3>
        <div class="sst-shop-product-price">${priceHtml}</div>
        <button class="sst-shop-btn-add" data-open-product="${product.id}" ${!product.inStock ? 'disabled' : ''}>
          ${product.inStock ? 'Découvrir' : 'Rupture de stock'}${product.inStock ? '<i class="fas fa-arrow-right" aria-hidden="true"></i>' : ''}
        </button>
      </div>
    </article>
  `;
}

export function renderProductGrid(products, activeCategory, opts = {}) {
  const filtered = filterAndSortProducts(products, { activeCategory, ...opts });
  if (!products.length) {
    return `<div class="sst-shop-empty-state"><i class="fas fa-store" aria-hidden="true"></i><strong>Aucun produit pour le moment.</strong><span>Cette boutique prépare sa collection — revenez bientôt.</span></div>`;
  }
  if (!filtered.length) {
    return `<div class="sst-shop-empty-state"><i class="fas fa-magnifying-glass" aria-hidden="true"></i><strong>Aucun résultat.</strong><span>Essayez une autre recherche ou catégorie.</span></div>`;
  }
  return `<div class="sst-shop-grid">${filtered.map(renderProductCard).join('')}</div>`;
}

export function renderFeaturedRow(products) {
  const featured = products.filter((p) => p.featured && p.inStock !== false);
  if (!featured.length) return '';
  return `
    <section class="sst-shop-featured-section">
      <header class="sst-shop-collection-heading"><div><span>Sélection</span><h2>Produits vedettes</h2></div></header>
      <div class="sst-shop-grid sst-shop-grid-featured">${featured.slice(0, 6).map(renderProductCard).join('')}</div>
    </section>
  `;
}

// ---------- Trust / delivery / contact sections ----------

export function renderTrustSection(catalog) {
  const items = [
    { icon: 'fa-shield-halved', text: 'Paiement sécurisé' },
    catalog.delivery?.pickupEnabled ? { icon: 'fa-store', text: 'Retrait disponible' } : null,
    catalog.delivery?.deliveryEnabled ? { icon: 'fa-truck', text: 'Livraison disponible' } : null,
    catalog.contactInfo?.phone || catalog.contactInfo?.email ? { icon: 'fa-headset', text: 'Support client réactif' } : null
  ].filter(Boolean);
  if (!items.length) return '';
  return `
    <section class="sst-shop-trust-section">
      ${items.map((item) => `<div class="sst-shop-trust-item"><i class="fas ${item.icon}" aria-hidden="true"></i><span>${escapeHtml(item.text)}</span></div>`).join('')}
    </section>
  `;
}

export function renderDeliverySection(catalog) {
  const delivery = catalog.delivery;
  if (!delivery || (!delivery.pickupEnabled && !delivery.deliveryEnabled)) return '';
  return `
    <section class="sst-shop-delivery-section">
      <header class="sst-public-section-heading"><span>Pratique</span><h2>Livraison &amp; retrait</h2></header>
      <div class="sst-shop-delivery-grid">
        ${delivery.pickupEnabled ? `
          <div class="sst-shop-delivery-card">
            <i class="fas fa-store" aria-hidden="true"></i>
            <h3>Retrait sur place</h3>
            ${delivery.pickupAddress ? `<p>${escapeHtml(delivery.pickupAddress)}</p>` : ''}
            ${delivery.pickupHours ? `<p class="sst-hint">${escapeHtml(delivery.pickupHours)}</p>` : ''}
          </div>` : ''}
        ${delivery.deliveryEnabled ? `
          <div class="sst-shop-delivery-card">
            <i class="fas fa-truck" aria-hidden="true"></i>
            <h3>Livraison</h3>
            <ul>${(delivery.zones || []).map((z) => `<li>${escapeHtml(z.name)} — ${formatCurrency(z.fee)}${z.etaLabel ? ` · ${escapeHtml(z.etaLabel)}` : ''}</li>`).join('')}</ul>
            ${delivery.freeDeliveryThreshold ? `<p class="sst-hint">Gratuite dès ${formatCurrency(delivery.freeDeliveryThreshold)} d'achat.</p>` : ''}
          </div>` : ''}
      </div>
      ${delivery.minOrderAmount ? `<p class="sst-hint">Commande minimum : ${formatCurrency(delivery.minOrderAmount)}</p>` : ''}
      ${delivery.instructions ? `<p class="sst-hint">${escapeHtml(delivery.instructions)}</p>` : ''}
    </section>
  `;
}

export function renderContactSection(catalog) {
  const phone = catalog.contactInfo?.phone;
  const email = catalog.contactInfo?.email;
  const social = catalog.socialLinks || {};
  const socialLinks = Object.entries({ instagram: 'fa-instagram', facebook: 'fa-facebook', tiktok: 'fa-tiktok', whatsapp: 'fa-whatsapp' })
    .filter(([key]) => social[key])
    .map(([key, icon]) => `<a href="${escapeHtml(social[key])}" target="_blank" rel="noopener" aria-label="${key}"><i class="fa-brands ${icon}" aria-hidden="true"></i></a>`)
    .join('');
  if (!phone && !email && !socialLinks) return '';
  return `
    <section class="sst-shop-contact-section" id="shopContact">
      <header class="sst-public-section-heading"><span>Contact</span><h2>Une question ?</h2></header>
      <div class="sst-shop-contact-row">
        ${phone ? `<a href="tel:${escapeHtml(phone)}"><i class="fas fa-phone" aria-hidden="true"></i> ${escapeHtml(phone)}</a>` : ''}
        ${email ? `<a href="mailto:${escapeHtml(email)}"><i class="fas fa-envelope" aria-hidden="true"></i> ${escapeHtml(email)}</a>` : ''}
      </div>
      ${socialLinks ? `<div class="sst-shop-social-row">${socialLinks}</div>` : ''}
    </section>
  `;
}

export function renderShopFooter(catalog) {
  const legal = catalog.legal || {};
  const legalLinks = [
    legal.deliveryPolicy ? { key: 'delivery', label: 'Politique de livraison' } : null,
    legal.returnPolicy ? { key: 'returns', label: 'Politique de retour' } : null,
    legal.terms ? { key: 'terms', label: 'Conditions de vente' } : null
  ].filter(Boolean);
  const logo = catalog.logoUrl
    ? `<img class="sst-shop-footer-logo" src="${escapeHtml(catalog.logoUrl)}" alt="${escapeHtml(catalog.name || 'Boutique')}">`
    : `<span class="sst-shop-footer-mark" aria-hidden="true">${escapeHtml((catalog.name || 'B').trim().charAt(0).toUpperCase())}</span>`;
  const social = catalog.socialLinks || {};
  const socialLinks = Object.entries({ instagram: 'fa-instagram', facebook: 'fa-facebook', tiktok: 'fa-tiktok', whatsapp: 'fa-whatsapp' })
    .map(([key, icon]) => ({ key, icon, url: safeExternalUrl(social[key]) }))
    .filter((item) => item.url)
    .map(({ key, icon, url }) => `<a class="sst-shop-footer-social" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${key}"><i class="fa-brands ${icon}" aria-hidden="true"></i></a>`)
    .join('');
  return `
    <footer class="sst-shop-footer">
      <div class="sst-shop-footer-main">
        <div class="sst-shop-footer-brand">
          <a href="#" class="sst-shop-footer-brand-link" aria-label="Retour à l’accueil de ${escapeHtml(catalog.name || 'la boutique')}">${logo}<span><strong>${escapeHtml(catalog.name || 'Boutique')}</strong><small>Boutique en ligne</small></span></a>
          ${catalog.description ? `<p>${escapeHtml(catalog.description)}</p>` : '<p>Une sélection pensée pour vous.</p>'}
          ${socialLinks ? `<div class="sst-shop-footer-socials">${socialLinks}</div>` : ''}
        </div>
        <div class="sst-shop-footer-column"><h3>Boutique</h3><a href="#shopProducts">Produits</a><a href="#shopContact">Contact</a><a href="#shopProducts">Rechercher</a></div>
        <div class="sst-shop-footer-column"><h3>Nous joindre</h3>
          ${catalog.contactInfo?.phone ? `<a href="tel:${escapeHtml(catalog.contactInfo.phone)}">${escapeHtml(catalog.contactInfo.phone)}</a>` : '<span>À votre écoute</span>'}
          ${catalog.contactInfo?.email ? `<a href="mailto:${escapeHtml(catalog.contactInfo.email)}">${escapeHtml(catalog.contactInfo.email)}</a>` : ''}
        </div>
      </div>
      <div class="sst-shop-footer-bottom"><span>© ${new Date().getFullYear()} ${escapeHtml(catalog.name || 'Boutique')}</span><span class="sst-shop-footer-legal">${legalLinks.length ? legalLinks.map((l) => `<button type="button" data-shop-legal="${l.key}">${l.label}</button>`).join('') : ''}</span><span>Propulsé par SmartSolutionTek</span></div>
    </footer>
  `;
}

/** Orchestrates the section order the creator chose (`catalog.sections.order`) into one HTML
 * string for <main>. Sections absent from the visibility map, or with nothing to show, render
 * as ''. The hero itself is rendered separately (always first, right after the nav). */
export function renderSectionsInOrder(catalog, products, collectionOpts = {}) {
  const visibility = catalog.sections?.visibility || {};
  const order = catalog.sections?.order || ['hero', 'featured', 'collection', 'trust', 'delivery', 'contact'];
  const renderers = {
    featured: () => (visibility.featured !== false ? renderFeaturedRow(products) : ''),
    collection: () => (visibility.collection !== false ? `
      <main class="sst-shop-page" id="shopProducts">
        <header class="sst-shop-collection-heading">
          <div><span>Collection</span><h2>Nos produits</h2></div>
          <p>${products.length} produit${products.length > 1 ? 's' : ''}</p>
        </header>
        ${renderSearchSortBar(collectionOpts.searchTerm, collectionOpts.sort)}
        <div id="shopCategoryTabs">${renderCategoryTabs(products, collectionOpts.activeCategory)}</div>
        <div id="shopProductGrid">${renderProductGrid(products, collectionOpts.activeCategory, collectionOpts)}</div>
      </main>
    ` : ''),
    trust: () => (visibility.trust !== false ? renderTrustSection(catalog) : ''),
    delivery: () => (visibility.delivery !== false ? renderDeliverySection(catalog) : ''),
    contact: () => (visibility.contact !== false ? renderContactSection(catalog) : '')
  };
  return order.filter((id) => id !== 'hero').map((id) => (renderers[id] ? renderers[id]() : '')).join('');
}

// ---------- Product detail ----------

export function renderProductDetail(product) {
  const images = Array.isArray(product.images) && product.images.length ? product.images : [null];
  const gallery = images.map((url, i) => url
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml((product.imagesAlt && product.imagesAlt[i]) || product.name)}" class="${i === 0 ? 'active' : ''}" data-gallery-index="${i}">`
    : `<div class="sst-shop-noimage" data-gallery-index="${i}"><i class="fas fa-image"></i></div>`
  ).join('');
  const thumbs = images.length > 1
    ? `<div class="sst-shop-thumbs">${images.map((url, i) => `<button class="sst-shop-thumb ${i === 0 ? 'active' : ''}" data-thumb-index="${i}">${url ? `<img src="${escapeHtml(url)}" alt="">` : '<i class="fas fa-image"></i>'}</button>`).join('')}</div>`
    : '';
  const variantPicker = product.variants && product.variants.length
    ? `
      <div class="sst-shop-field">
        <label class="sst-shop-label">Variante</label>
        <select class="sst-shop-select" id="shopVariantSelect">
          ${product.variants.map((v) => `<option value="${v.id}" ${!v.inStock ? 'disabled' : ''}>${escapeHtml(v.name)}${v.priceDelta ? ` (+${formatCurrency(v.priceDelta)})` : ''}${!v.inStock ? ' - rupture' : ''}</option>`).join('')}
        </select>
      </div>
    `
    : '';
  return `
    <div class="sst-shop-detail">
      <button class="sst-shop-detail-close" type="button" data-close-shop-product aria-label="Fermer"><i class="fas fa-xmark"></i></button>
      <div class="sst-shop-gallery">
        <div class="sst-shop-gallery-main">${gallery}</div>
        ${thumbs}
      </div>
      <div class="sst-shop-detail-info">
        ${product.category ? `<span class="sst-shop-detail-kicker">${escapeHtml(product.category)}</span>` : ''}
        <h2>${escapeHtml(product.name)}</h2>
        <div class="sst-shop-price">${formatCurrency(product.price)}${product.comparePrice && product.comparePrice > product.price ? ` <span class="sst-shop-compare-price">${formatCurrency(product.comparePrice)}</span>` : ''}</div>
        ${stockBadge(product)}
        ${product.shortDescription ? `<p class="sst-shop-description sst-shop-short-description">${escapeHtml(product.shortDescription)}</p>` : ''}
        ${product.description ? `<p class="sst-shop-description">${escapeHtml(product.description)}</p>` : ''}
        ${variantPicker}
        <div class="sst-shop-field">
          <label class="sst-shop-label">Quantite</label>
          <div class="sst-shop-qty-stepper">
            <button type="button" id="shopQtyMinus" aria-label="Diminuer la quantité">-</button>
            <input type="number" id="shopQtyInput" value="1" min="1" aria-label="Quantité">
            <button type="button" id="shopQtyPlus" aria-label="Augmenter la quantité">+</button>
          </div>
        </div>
        <button class="sst-shop-btn-add sst-shop-btn-large" id="shopAddToCartBtn" ${!product.inStock ? 'disabled' : ''}>
          ${product.inStock ? 'Ajouter au panier' : 'Rupture de stock'}
        </button>
      </div>
    </div>
  `;
}

export function renderRelatedProducts(product, allProducts) {
  const related = allProducts
    .filter((p) => p.id !== product.id && p.inStock !== false && (p.category === product.category || !product.category))
    .slice(0, 4);
  if (!related.length) return '';
  return `
    <section class="sst-shop-related-section">
      <header class="sst-public-section-heading"><span>Vous aimerez aussi</span><h2>Produits similaires</h2></header>
      <div class="sst-shop-grid">${related.map(renderProductCard).join('')}</div>
    </section>
  `;
}
