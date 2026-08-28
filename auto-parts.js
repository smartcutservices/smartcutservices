import { auth, authReadyPromise, storage } from './firebase-init.js';
import { ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-storage.js';

const API_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/autoPartsApi';
const TYPES = [
  ['car', 'Voiture'], ['motorcycle', 'Moto'], ['truck', 'Camion'], ['equipment', 'Équipement']
];

export default class AutoPartsApp {
  constructor(rootId, { view = 'catalog' } = {}) {
    this.root = document.getElementById(rootId);
    this.view = view;
    this.taxonomy = { categories: [], vehicles: [] };
    this.parts = [];
    this.categoryId = '';
    this.searchTerm = '';
    this.loading = false;
    this.vehicle = { type: 'car', make: '', model: '', year: '', engine: '' };
    this.init();
  }

  escape(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  async api(action, { method = 'GET', data = null, params = {} } = {}) {
    const url = new URL(API_URL);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([key, value]) => value !== '' && value != null && url.searchParams.set(key, value));
    const headers = { Accept: 'application/json' };
    if (data) headers['Content-Type'] = 'application/json';
    await authReadyPromise;
    if (auth?.currentUser) headers.Authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 6500);
    let response;
    try {
      response = await fetch(url, { method, headers, signal: controller.signal, body: data ? JSON.stringify({ action, ...data }) : undefined });
    } finally {
      window.clearTimeout(timeoutId);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'request-failed');
    return payload;
  }

  async init() {
    this.render();
    this.bind();
    const needsTaxonomy = ['catalog', 'request'].includes(this.view);
    const taxonomyPromise = needsTaxonomy ? this.api('taxonomy')
      .then((payload) => { this.taxonomy = payload; })
      .catch(() => { this.taxonomy = { categories: [], vehicles: [] }; }) : Promise.resolve();
    const catalogPromise = this.view === 'catalog' ? this.search({ preserveView: true }) : Promise.resolve();
    await Promise.allSettled([taxonomyPromise, catalogPromise]);
    this.render(); this.bind();
    if (this.view === 'requests') await this.openMyRequests();
    if (this.view === 'support') await this.openSupport();
    if (this.view === 'garages') await this.loadGarageDirectory();
  }

  vehicleRows() {
    return (this.taxonomy.vehicles || []).filter((item) => !this.vehicle.type || item.type === this.vehicle.type);
  }

  options(values, selected, placeholder) {
    return `<option value="">${this.escape(placeholder)}</option>${[...new Set(values.filter(Boolean))].sort().map((value) => `<option value="${this.escape(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${this.escape(value)}</option>`).join('')}`;
  }

  render() {
    if (this.view !== 'catalog') { this.renderDedicated(); return; }
    const rows = this.vehicleRows();
    const makes = rows.map((item) => item.make);
    const models = rows.filter((item) => !this.vehicle.make || item.make === this.vehicle.make).map((item) => item.model);
    const years = rows.filter((item) => (!this.vehicle.make || item.make === this.vehicle.make) && (!this.vehicle.model || item.model === this.vehicle.model)).flatMap((item) => item.years || []);
    const engines = rows.filter((item) => (!this.vehicle.make || item.make === this.vehicle.make) && (!this.vehicle.model || item.model === this.vehicle.model)).flatMap((item) => item.engines || []);
    this.root.innerHTML = `
      <section class="ap-hero" aria-labelledby="ap-title">
        <div class="ap-hero-copy">
          <p class="ap-eyebrow">Auto &amp; Parts</p>
          <h1 id="ap-title">La bonne pièce.<br>Sans deviner.</h1>
          <p>Trouvez une pièce compatible auprès de vendeurs vérifiés.</p>
          <div class="ap-hero-actions"><a class="ap-button ap-button--primary" href="#ap-vehicle-title">Trouver ma pièce</a><a class="ap-button ap-button--quiet" href="./auto-parts-request.html">Faire une demande</a></div>
        </div>
        <div class="ap-hero-media"><img src="./assets/auto-parts/hero-auto-parts-v1.png" alt="Véhicule et pièce de freinage automobile" decoding="async" fetchpriority="high"></div>
      </section>
      <section class="ap-finder-wrap" aria-labelledby="ap-vehicle-title">
        <form class="ap-finder" id="apVehicleForm">
          <p class="ap-section-kicker">Vérifier la compatibilité</p>
          <h2 id="ap-vehicle-title">Votre véhicule</h2>
          <div class="ap-field-grid">
            <label class="ap-field"><span>Type</span><select name="type">${TYPES.map(([value, label]) => `<option value="${value}" ${this.vehicle.type === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
            <label class="ap-field"><span>Marque</span><input class="ap-search" name="make" list="apMakes" value="${this.escape(this.vehicle.make)}" placeholder="Ex. Toyota" required></label>
            <label class="ap-field"><span>Modèle</span><input class="ap-search" name="model" list="apModels" value="${this.escape(this.vehicle.model)}" placeholder="Ex. Corolla" required></label>
            <label class="ap-field"><span>Année</span><input class="ap-search" name="year" type="number" min="1900" max="2100" value="${this.escape(this.vehicle.year)}" placeholder="Ex. 2018" required></label>
            <label class="ap-field"><span>Moteur (optionnel)</span><input class="ap-search" name="engine" list="apEngines" value="${this.escape(this.vehicle.engine)}" placeholder="Ex. 1.8L"></label>
            <datalist id="apMakes">${[...new Set(makes)].map((value) => `<option value="${this.escape(value)}"></option>`).join('')}</datalist>
            <datalist id="apModels">${[...new Set(models)].map((value) => `<option value="${this.escape(value)}"></option>`).join('')}</datalist>
            <datalist id="apEngines">${[...new Set(engines)].map((value) => `<option value="${this.escape(value)}"></option>`).join('')}</datalist>
          </div>
          <div class="ap-actions">
            <button class="ap-button ap-button--primary" type="submit">Voir les pièces compatibles</button>
            <button class="ap-button" id="apSaveGarage" type="button">Enregistrer</button>
            <button class="ap-button" id="apOpenGarage" type="button">Mon garage</button>
          </div>
          <div class="ap-status" id="apFinderStatus"></div>
        </form>
      </section>
      <section class="ap-toolbar" aria-labelledby="ap-catalog-title">
        <div class="ap-toolbar-top">
          <div><p class="ap-section-kicker">Catalogue</p><h2 id="ap-catalog-title">Pièces disponibles</h2></div>
          <label><span class="ap-section-kicker">Recherche par nom, OEM ou référence</span><input class="ap-search" id="apSearch" type="search" value="${this.escape(this.searchTerm)}" placeholder="Ex. filtre Toyota, 90915…"></label>
        </div>
        <div class="ap-chips" aria-label="Catégories">
          <button class="ap-chip" type="button" data-category="" aria-pressed="${!this.categoryId}">Toutes</button>
          ${(this.taxonomy.categories || []).map((category) => `<button class="ap-chip" type="button" data-category="${this.escape(category.id)}" aria-pressed="${this.categoryId === category.id}">${this.escape(category.name)}</button>`).join('')}
        </div>
      </section>
      <div class="ap-results-meta"><span id="apResultCount">${this.loading ? 'Recherche…' : `${this.parts.length} résultat(s)`}</span><span>${this.vehicle.make && this.vehicle.model ? `${this.escape(this.vehicle.make)} ${this.escape(this.vehicle.model)} ${this.escape(this.vehicle.year)}` : 'Tous les véhicules'}</span></div>
      <section class="ap-grid" id="apResults">${this.renderParts()}</section>
      <dialog class="ap-dialog" id="apGarageDialog"><div class="ap-dialog-head"><div><p class="ap-section-kicker">Compte client</p><h2>Mon garage</h2></div><button class="ap-dialog-close" type="button" aria-label="Fermer">×</button></div><div id="apGarageList" class="ap-garage-list"><p>Chargement…</p></div></dialog>
      <dialog class="ap-dialog" id="apOffersDialog"><div class="ap-dialog-head"><div><p class="ap-section-kicker">Comparaison</p><h2 id="apOffersTitle">Offres disponibles</h2></div><button class="ap-dialog-close" type="button" aria-label="Fermer">×</button></div><div id="apOffersList" class="ap-garage-list"></div></dialog>
    `;
  }

  renderDedicated() {
    const rows = this.vehicleRows();
    const makes = rows.map((item) => item.make);
    const models = rows.filter((item) => !this.vehicle.make || item.make === this.vehicle.make).map((item) => item.model);
    const page = {
      request: ['Recherche assistée', 'Demander une pièce', 'Décrivez votre besoin. Les vendeurs concernés pourront vous répondre.'],
      requests: ['Suivi', 'Mes demandes', 'Comparez les devis reçus et choisissez l’offre qui vous convient.'],
      support: ['Service après-vente', 'Garanties & retours', 'Ouvrez et suivez un dossier relié à une commande Auto payée.'],
      garages: ['Entretien', 'Garages vérifiés', 'Trouvez un professionnel et réservez une prestation disponible.']
    }[this.view];
    let content = '';
    if (this.view === 'request') content = `
      <div class="ap-dedicated-grid">
        <form class="ap-service-card ap-form-stack" id="apVehicleForm">
          <div class="ap-card-heading"><span>1</span><div><h2>Le véhicule</h2><p>Indiquez les informations essentielles.</p></div></div>
          <div class="ap-field-grid">
            <label class="ap-field"><span>Type</span><select name="type">${TYPES.map(([value,label])=>`<option value="${value}" ${this.vehicle.type===value?'selected':''}>${label}</option>`).join('')}</select></label>
            <label class="ap-field"><span>Marque</span><input class="ap-search" name="make" list="apMakes" value="${this.escape(this.vehicle.make)}" required></label>
            <label class="ap-field"><span>Modèle</span><input class="ap-search" name="model" list="apModels" value="${this.escape(this.vehicle.model)}" required></label>
            <label class="ap-field"><span>Année</span><input class="ap-search" name="year" type="number" min="1900" max="2100" value="${this.escape(this.vehicle.year)}" required></label>
            <label class="ap-field"><span>Moteur (optionnel)</span><input class="ap-search" name="engine" value="${this.escape(this.vehicle.engine)}"></label>
            <label class="ap-field"><span>Catégorie (optionnel)</span><select id="apRequestCategory"><option value="">Toutes</option>${this.taxonomy.categories.map((category)=>`<option value="${this.escape(category.id)}" ${this.categoryId===category.id?'selected':''}>${this.escape(category.name)}</option>`).join('')}</select></label>
          </div><datalist id="apMakes">${[...new Set(makes)].map((value)=>`<option value="${this.escape(value)}"></option>`).join('')}</datalist><datalist id="apModels">${[...new Set(models)].map((value)=>`<option value="${this.escape(value)}"></option>`).join('')}</datalist>
        </form>
        <form id="apRequestForm" class="ap-service-card ap-form-stack">
          <div class="ap-card-heading"><span>2</span><div><h2>La pièce</h2><p>Une description précise accélère les réponses.</p></div></div>
          <label class="ap-field"><span>Pièce recherchée</span><input class="ap-search" name="title" maxlength="180" required></label>
          <label class="ap-field"><span>Description</span><textarea name="description" maxlength="1800" required></textarea></label>
          <div class="ap-field-grid"><label class="ap-field"><span>Référence connue</span><input class="ap-search" name="partNumber" maxlength="100"></label><label class="ap-field"><span>Quantité</span><input class="ap-search" name="quantity" type="number" min="1" max="100" value="1"></label></div>
          <label class="ap-field"><span>Photos ou vidéo</span><input class="ap-search" name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple></label>
          <button class="ap-button ap-button--primary" type="submit">Envoyer la demande</button><div class="ap-status" id="apRequestStatus"></div>
        </form>
      </div>`;
    if (this.view === 'requests') content = `<section class="ap-service-card"><div id="apRequestsList" class="ap-garage-list"><p>Chargement…</p></div></section>`;
    if (this.view === 'support') content = `<div class="ap-support-layout ap-service-card"><form id="apClaimForm" class="ap-dialog-form"><label class="ap-field"><span>Article d’une commande payée</span><select class="ap-search" name="orderItem" id="apClaimOrderItem" required><option value="">Chargement…</option></select></label><label class="ap-field"><span>Motif</span><select class="ap-search" name="issueType" required><option value="warranty">Garantie</option><option value="return">Retour</option><option value="damaged">Produit endommagé</option><option value="wrong_part">Mauvaise pièce</option><option value="other">Autre</option></select></label><label class="ap-field"><span>Description</span><textarea name="description" minlength="10" maxlength="1800" required></textarea></label><label class="ap-field"><span>Preuves</span><input class="ap-search" name="media" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple></label><button class="ap-button ap-button--primary" type="submit">Ouvrir la réclamation</button><div class="ap-status" id="apClaimStatus"></div></form><div id="apClaimsList" class="ap-garage-list"><p>Chargement…</p></div></div>`;
    if (this.view === 'garages') content = `<section class="ap-service-card"><div class="ap-directory-filter"><input class="ap-search" id="apGarageDepartment" placeholder="Département"><input class="ap-search" id="apGarageCommune" placeholder="Commune"><button class="ap-button" id="apFilterGarages" type="button">Rechercher</button></div><div id="apGarageDirectory" class="ap-garage-list"><p>Chargement…</p></div></section>`;
    this.root.innerHTML = `<section class="ap-page-intro"><div><p class="ap-eyebrow">${page[0]}</p><h1>${page[1]}</h1><p>${page[2]}</p></div></section><div class="ap-page-content">${content}</div>`;
  }

  renderParts() {
    if (this.loading) return '<div class="ap-empty"><h3>Recherche en cours…</h3><p>Nous vérifions les références et les offres disponibles.</p></div>';
    if (!this.parts.length) return '<div class="ap-empty"><h3>Aucune pièce disponible</h3><p>Modifiez le véhicule ou la recherche. Seules les pièces publiées avec une offre en stock sont affichées.</p></div>';
    return this.parts.map((part) => {
      const offer = part.offers[0];
      const image = offer.images?.[0] ? `<img src="${this.escape(offer.images[0])}" alt="${this.escape(part.title)}">` : `<svg class="ap-part-placeholder" viewBox="0 0 120 90" aria-hidden="true"><path fill="currentColor" d="M27 12h66l15 20-12 46H24L12 32zm8 12-8 11 8 31h50l8-31-8-11z"/><circle cx="42" cy="44" r="7" fill="#eef1f3"/><circle cx="78" cy="44" r="7" fill="#eef1f3"/></svg>`;
      return `<article class="ap-card">
        <div class="ap-card-media">${image}</div>
        <div class="ap-card-body">
          <span class="ap-card-label">${this.escape(part.brand || part.categoryName || 'Pièce')}</span>
          <h3>${this.escape(part.title)}</h3>
          <p class="ap-part-number">Réf. ${this.escape(part.partNumber)}</p>
          ${this.vehicle.make ? `<p class="ap-fitment ${part.compatibilityStatus === 'verify' ? 'ap-fitment--verify' : ''}">${part.compatibilityStatus === 'verify' ? 'À vérifier · précisez le moteur' : `Compatible avec votre ${this.escape(`${this.vehicle.make} ${this.vehicle.model} ${this.vehicle.year}${this.vehicle.engine ? ` ${this.vehicle.engine}` : ''}`)}`}</p>` : ''}
          <div class="ap-offer">
            <div class="ap-offer-row"><div><div class="ap-price">${new Intl.NumberFormat('fr-HT').format(offer.price)} HTG</div><div class="ap-vendor">${this.escape(offer.vendorName || 'Vendeur vérifié')}</div></div><span class="ap-vendor">Stock ${offer.stock}</span></div>
            <button class="ap-button ap-button--primary ap-add" type="button" data-offer="${this.escape(offer.id)}" data-part="${this.escape(part.id)}">Ajouter au panier</button>${part.offers.length > 1 ? `<button class="ap-button ap-add" type="button" data-compare="${this.escape(part.id)}">Comparer ${part.offers.length} offres</button>` : ''}
          </div>
        </div>
      </article>`;
    }).join('');
  }

  bind() {
    const form = this.root.querySelector('#apVehicleForm');
    form?.querySelectorAll('select, input').forEach((select) => select.addEventListener('change', () => {
      const data = new FormData(form);
      this.vehicle = Object.fromEntries(data.entries());
      this.render(); this.bind();
    }));
    form?.addEventListener('submit', (event) => { event.preventDefault(); if (this.view === 'catalog') this.search(); });
    this.root.querySelector('#apRequestCategory')?.addEventListener('change', (event) => { this.categoryId = event.target.value || ''; });
    this.root.querySelector('#apSearch')?.addEventListener('input', (event) => { this.searchTerm = event.target.value || ''; });
    this.root.querySelector('#apSearch')?.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); this.search(); } });
    this.root.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => { this.categoryId = button.dataset.category || ''; this.search(); }));
    this.root.querySelector('#apSaveGarage')?.addEventListener('click', () => this.saveGarage());
    this.root.querySelector('#apOpenGarage')?.addEventListener('click', () => this.openGarage());
    this.root.querySelectorAll('.ap-dialog-close').forEach((button) => button.addEventListener('click', () => button.closest('dialog')?.close()));
    this.root.querySelector('#apFilterGarages')?.addEventListener('click', () => this.loadGarageDirectory());
    this.root.querySelector('#apRequestForm')?.addEventListener('submit', (event) => this.submitPartRequest(event));
    this.root.querySelector('#apClaimForm')?.addEventListener('submit', (event) => this.submitClaim(event));
    this.root.querySelectorAll('[data-offer]').forEach((button) => button.addEventListener('click', () => this.addToCart(button.dataset.offer, button.dataset.part)));
    this.root.querySelectorAll('[data-compare]').forEach((button) => button.addEventListener('click', () => this.compareOffers(button.dataset.compare)));
  }

  async search({ preserveView = false } = {}) {
    this.loading = true;
    if (!preserveView) { this.render(); this.bind(); }
    try {
      const payload = await this.api('catalog', { params: { ...this.vehicle, categoryId: this.categoryId, q: this.searchTerm } });
      this.parts = payload.parts || [];
    } catch (error) {
      this.parts = [];
      console.error('[AUTO_PARTS] catalog', error);
    } finally { this.loading = false; if (!preserveView) { this.render(); this.bind(); } }
  }

  async saveGarage() {
    const status = this.root.querySelector('#apFinderStatus');
    if (!this.vehicle.make || !this.vehicle.model || !this.vehicle.year) { status.textContent = 'Sélectionnez la marque, le modèle et l’année.'; status.dataset.kind = 'error'; return; }
    try {
      await this.api('saveGarageVehicle', { method: 'POST', data: { vehicle: this.vehicle } });
      status.textContent = 'Véhicule enregistré dans votre garage.'; status.dataset.kind = 'success';
    } catch (error) {
      status.textContent = error.message === 'authentication-required' ? 'Connectez-vous pour utiliser Mon garage.' : 'Impossible d’enregistrer ce véhicule.';
      status.dataset.kind = 'error';
    }
  }

  async openGarage() {
    const dialog = this.root.querySelector('#apGarageDialog');
    const list = this.root.querySelector('#apGarageList');
    dialog?.showModal();
    try {
      const payload = await this.api('listGarage', { method: 'POST' });
      if (!payload.vehicles.length) { list.innerHTML = '<div class="ap-empty"><h3>Garage vide</h3><p>Enregistrez un véhicule depuis le sélecteur.</p></div>'; return; }
      list.innerHTML = payload.vehicles.map((vehicle) => `<article class="ap-garage-item"><button type="button" data-use-garage="${this.escape(vehicle.id)}"><strong>${this.escape(vehicle.nickname || `${vehicle.make} ${vehicle.model}`)}</strong><span>${this.escape(`${vehicle.year} · ${vehicle.engine || vehicle.type}`)}</span></button><button type="button" data-delete-garage="${this.escape(vehicle.id)}" aria-label="Supprimer">×</button></article>`).join('');
      list.querySelectorAll('[data-use-garage]').forEach((button) => button.addEventListener('click', () => {
        const vehicle = payload.vehicles.find((entry) => entry.id === button.dataset.useGarage);
        this.vehicle = { type: vehicle.type, make: vehicle.make, model: vehicle.model, year: String(vehicle.year), engine: vehicle.engine || '' };
        dialog.close(); this.search();
      }));
      list.querySelectorAll('[data-delete-garage]').forEach((button) => button.addEventListener('click', async () => {
        await this.api('deleteGarageVehicle', { method: 'POST', data: { id: button.dataset.deleteGarage } });
        this.openGarage();
      }));
    } catch (error) {
      list.innerHTML = `<div class="ap-empty"><h3>Connexion requise</h3><p>Connectez-vous pour retrouver les véhicules de votre garage.</p></div>`;
    }
  }

  openPartRequest() {
    const dialog = this.root.querySelector('#apRequestDialog');
    if (!auth?.currentUser) {
      const status = dialog.querySelector('#apRequestStatus');
      status.textContent = 'Connectez-vous pour envoyer et suivre une demande.'; status.dataset.kind = 'error';
    }
    dialog?.showModal();
  }

  async uploadRequestMedia(files) {
    await authReadyPromise;
    if (!auth?.currentUser) throw new Error('authentication-required');
    const selected = [...(files || [])].slice(0, 6);
    const allowed = new Set(['image/jpeg','image/png','image/webp','video/mp4','video/webm']);
    if (selected.some((file) => !allowed.has(file.type) || file.size > 25 * 1024 * 1024)) throw new Error('invalid-media');
    return Promise.all(selected.map(async (file) => {
      const safeName = `${Date.now()}-${crypto.randomUUID()}-${file.name.replace(/[^a-z0-9._-]/gi, '-')}`;
      const target = ref(storage, `auto-parts/requests/${auth.currentUser.uid}/${safeName}`);
      await uploadBytes(target, file, { contentType: file.type });
      return getDownloadURL(target);
    }));
  }

  async submitPartRequest(event) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form); const status = form.querySelector('#apRequestStatus');
    if (!this.vehicle.make || !this.vehicle.model || !this.vehicle.year) { status.textContent = 'Sélectionnez d’abord le véhicule concerné.'; status.dataset.kind = 'error'; return; }
    try {
      status.textContent = 'Envoi des fichiers et de la demande…'; status.dataset.kind = '';
      const mediaUrls = await this.uploadRequestMedia(form.elements.media.files);
      const category = this.taxonomy.categories.find((item) => item.id === this.categoryId);
      const result = await this.api('createPartRequest', { method:'POST', data:{ title:data.get('title'), description:data.get('description'), partNumber:data.get('partNumber'), quantity:data.get('quantity'), categoryId:this.categoryId, categoryName:category?.name || '', vehicle:this.vehicle, mediaUrls } });
      status.textContent = result.routedVendorCount ? `Demande envoyée à ${result.routedVendorCount} vendeur(s) pertinent(s).` : 'Demande enregistrée. Smart Cut doit encore identifier les vendeurs pertinents.';
      form.reset();
    } catch (error) { status.textContent = error.message === 'authentication-required' ? 'Connexion requise.' : 'Impossible d’envoyer la demande.'; status.dataset.kind = 'error'; }
  }

  async openMyRequests() {
    const dialog = this.root.querySelector('#apRequestsDialog'); const list = this.root.querySelector('#apRequestsList'); dialog?.showModal();
    try {
      const payload = await this.api('listMyPartRequests', { method:'POST' });
      if (!payload.requests.length) { list.innerHTML='<div class="ap-empty"><h3>Aucune demande</h3><p>Vos demandes de pièces et les devis reçus apparaîtront ici.</p></div>'; return; }
      list.innerHTML = payload.requests.map((request) => `<article class="ap-request-item"><div><strong>${this.escape(request.title)}</strong><span>${this.escape(`${request.vehicle?.make || ''} ${request.vehicle?.model || ''} ${request.vehicle?.year || ''}`)}</span><small>${request.quotes?.length || 0} devis · ${this.escape(request.status)}</small></div>${(request.quotes || []).map((quote) => `<div class="ap-quote"><span>${this.escape(quote.vendorName)} · ${this.escape(quote.condition)}</span><strong>${new Intl.NumberFormat('fr-HT').format(quote.price)} HTG</strong>${request.status === 'open' && quote.status === 'submitted' ? `<button class="ap-button ap-button--primary" data-choose-quote="${this.escape(quote.id)}" data-request="${this.escape(request.id)}">Choisir</button>` : ''}</div>`).join('')}</article>`).join('');
      list.querySelectorAll('[data-choose-quote]').forEach((button) => button.addEventListener('click', () => this.chooseQuote(button.dataset.request, button.dataset.chooseQuote)));
    } catch (_) { list.innerHTML='<div class="ap-empty"><h3>Connexion requise</h3><p>Connectez-vous pour consulter vos demandes.</p></div>'; }
  }

  async openSupport() {
    const dialog=this.root.querySelector('#apSupportDialog');const select=this.root.querySelector('#apClaimOrderItem');const list=this.root.querySelector('#apClaimsList');if(dialog&&!dialog.open)dialog.showModal();
    try{const payload=await this.api('listMyAutoSupport',{method:'POST'});const items=(payload.orders||[]).flatMap((order)=>(order.items||[]).map((item)=>({...item,orderId:order.id})));
      select.innerHTML=`<option value="">Choisir un article</option>${items.map((item)=>`<option value="${this.escape(`${item.orderId}::${item.productId}`)}">${this.escape(item.name)} · commande ${this.escape(item.orderId.slice(0,8))}</option>`).join('')}`;select.disabled=!items.length;
      list.innerHTML=(payload.claims||[]).length?(payload.claims||[]).map((claim)=>`<article class="ap-request-item"><div><strong>${this.escape(claim.productName)}</strong><span>${this.escape(claim.issueType)} · ${this.escape(claim.status)}</span><small>${this.escape(claim.resolutionNote||'Votre dossier est conservé dans l’historique.')}</small></div></article>`).join(''):'<div class="ap-empty"><h3>Aucune réclamation</h3><p>Seuls les articles Auto d’une commande payée peuvent être sélectionnés.</p></div>';
    }catch(_){select.innerHTML='<option value="">Connexion requise</option>';select.disabled=true;list.innerHTML='<div class="ap-empty"><h3>Connexion requise</h3><p>Connectez-vous pour consulter le service après-vente.</p></div>';}
  }

  async uploadClaimMedia(files, claimId) {
    await authReadyPromise;if(!auth?.currentUser)throw new Error('authentication-required');const selected=[...(files||[])].slice(0,6);const allowed=new Set(['image/jpeg','image/png','image/webp','video/mp4','video/webm']);
    if(selected.some((file)=>!allowed.has(file.type)||file.size>25*1024*1024))throw new Error('invalid-media');
    return Promise.all(selected.map(async(file)=>{const safeName=`${Date.now()}-${crypto.randomUUID()}-${file.name.replace(/[^a-z0-9._-]/gi,'-')}`;const target=ref(storage,`auto-parts/claims/${auth.currentUser.uid}__${claimId}/${safeName}`);await uploadBytes(target,file,{contentType:file.type});return target.fullPath;}));
  }

  async submitClaim(event) {
    event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const status=form.querySelector('#apClaimStatus');const [orderId,productId]=String(data.get('orderItem')||'').split('::');
    if(!orderId||!productId){status.textContent='Choisissez un article éligible.';status.dataset.kind='error';return;}
    try{status.textContent='Envoi de la réclamation…';status.dataset.kind='';const claimId=crypto.randomUUID().replace(/-/g,'');const mediaUrls=await this.uploadClaimMedia(form.elements.media.files,claimId);await this.api('createAutoClaim',{method:'POST',data:{claimId,orderId,productId,issueType:data.get('issueType'),description:data.get('description'),mediaUrls}});status.textContent='Réclamation enregistrée.';form.reset();await this.openSupport();}
    catch(error){status.textContent=error.message==='active-claim-exists'?'Une réclamation active existe déjà pour cet article.':error.message==='eligible-order-not-found'?'Cette commande n’est pas éligible.':'Impossible d’ouvrir la réclamation.';status.dataset.kind='error';}
  }

  async chooseQuote(requestId, quoteId) {
    const result = await this.api('choosePartQuote', { method:'POST', data:{ requestId, quoteId } });
    const offer=result.offer;
    document.dispatchEvent(new CustomEvent('addToCart',{detail:{productId:offer.id,name:offer.name,price:offer.price,quantity:1,sku:offer.partNumber,image:offer.image,vendorId:offer.vendorId,vendorName:offer.vendorName,commissionRule:offer.commissionRule,sourceType:'vendor',sourceCollection:'vendorProducts',autoProgramType:'auto_parts',categoryId:offer.categoryId,category:offer.category,stockLimit:offer.stock,selectedOptions:[{label:'Source',value:'Devis Auto & Parts'}]}}));
    this.root.querySelector('#apRequestsDialog')?.close(); document.dispatchEvent(new CustomEvent('openCart'));
  }

  compareOffers(partId) {
    const part=this.parts.find((item)=>item.id===partId); if(!part)return;
    const dialog=this.root.querySelector('#apOffersDialog'); this.root.querySelector('#apOffersTitle').textContent=part.title;
    const list=this.root.querySelector('#apOffersList');
    list.innerHTML=part.offers.map((offer)=>`<article class="ap-offer-compare"><div><strong>${this.escape(offer.vendorName || 'Vendeur vérifié')}</strong><span>${this.escape(offer.condition)} · Stock ${offer.stock}${offer.warranty ? ` · ${this.escape(offer.warranty)}` : ''}</span></div><strong>${new Intl.NumberFormat('fr-HT').format(offer.price)} HTG</strong><button class="ap-button ap-button--primary" data-dialog-offer="${this.escape(offer.id)}">Choisir</button></article>`).join('');
    list.querySelectorAll('[data-dialog-offer]').forEach((button)=>button.addEventListener('click',()=>{dialog.close();this.addToCart(button.dataset.dialogOffer,partId);})); dialog.showModal();
  }

  async openGarageDirectory() {
    this.root.querySelector('#apGaragesDialog')?.showModal();
    await this.loadGarageDirectory();
  }

  async loadGarageDirectory() {
    const list=this.root.querySelector('#apGarageDirectory');
    try {
      const department=this.root.querySelector('#apGarageDepartment')?.value||'';const commune=this.root.querySelector('#apGarageCommune')?.value||'';
      const payload=await this.api('listGarages',{params:{department,commune}});
      if(!payload.garages.length){list.innerHTML='<div class="ap-empty"><h3>Aucun garage disponible</h3><p>Élargissez la zone de recherche.</p></div>';return;}
      list.innerHTML=payload.garages.map((garage)=>`<article class="ap-directory-card"><div><strong>${this.escape(garage.name)}</strong><span>${this.escape(`${garage.commune}, ${garage.department}`)}</span><small>Garage vérifié Smart Cut</small></div>${garage.services?.length?`<form class="ap-booking-form" data-garage="${this.escape(garage.id)}"><select class="ap-search" name="serviceId" required><option value="">Choisir un service</option>${garage.services.map((service)=>`<option value="${this.escape(service.id)}">${this.escape(service.name)} · ${new Intl.NumberFormat('fr-HT').format(service.price)} HTG</option>`).join('')}</select><input class="ap-search" name="startAt" type="datetime-local" required><button class="ap-button ap-button--primary" type="submit">Réserver et payer</button><div class="ap-status"></div></form>`:'<span>Aucun service publié.</span>'}</article>`).join('');
      list.querySelectorAll('.ap-booking-form').forEach((form)=>form.addEventListener('submit',(event)=>this.bookGarage(event)));
    } catch(_){list.innerHTML='<div class="ap-empty"><h3>Service indisponible</h3><p>Impossible de charger les garages pour le moment.</p></div>';}
  }

  async bookGarage(event) {
    event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const status=form.querySelector('.ap-status');
    try{const result=await this.api('createGarageBookingCheckout',{method:'POST',data:{serviceId:data.get('serviceId'),startAt:new Date(data.get('startAt')).toISOString(),vehicle:this.vehicle}});const offer=result.offer;document.dispatchEvent(new CustomEvent('addToCart',{detail:{productId:offer.id,name:offer.name,price:offer.price,quantity:1,vendorId:offer.vendorId,vendorName:offer.vendorName,commissionRule:offer.commissionRule,sourceType:'vendor',sourceCollection:'vendorProducts',autoProgramType:'auto_parts',category:'Garage',stockLimit:1,autoBookingId:offer.autoBookingId,selectedOptions:[{label:'Rendez-vous',value:new Date(offer.startAt).toLocaleString('fr-HT')}]}}));this.root.querySelector('#apGaragesDialog')?.close();document.dispatchEvent(new CustomEvent('openCart'));}
    catch(error){status.textContent=error.message==='outside-garage-availability'?'Ce créneau est hors disponibilité du garage.':error.message==='slot-unavailable'?'Ce créneau vient d’être réservé.':'Connexion requise ou réservation impossible.';status.dataset.kind='error';}
  }

  addToCart(offerId, partId) {
    const part = this.parts.find((item) => item.id === partId);
    const offer = part?.offers.find((item) => item.id === offerId);
    if (!part || !offer) return;
    document.dispatchEvent(new CustomEvent('addToCart', { detail: {
      productId: offer.id, name: part.title, price: offer.price, quantity: 1,
      sku: part.partNumber, image: offer.images?.[0] || '', vendorId: offer.vendorId,
      vendorName: offer.vendorName, commissionRule: offer.commissionRule || null,
      sourceType: 'vendor', sourceCollection: 'vendorProducts', autoProgramType: 'auto_parts', categoryId: part.categoryId,
      category: part.categoryName || 'Pièces auto', deliveryMode: offer.deliveryMode || '',
      deliveryDelay: offer.deliveryDelay || '', stockLimit: offer.stock,
      selectedOptions: [{ label: 'Référence', value: part.partNumber }, ...(this.vehicle.make ? [{ label: 'Véhicule', value: `${this.vehicle.make} ${this.vehicle.model} ${this.vehicle.year}` }] : [])]
    }}));
    document.dispatchEvent(new CustomEvent('openCart'));
  }
}
