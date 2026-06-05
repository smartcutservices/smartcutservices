import { db } from './firebase-init.js';
import { uploadImageFile } from './firebase-storage.js';
import { getCartManager } from './cart.js?v=20260531-13';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import {
  normalizePrintingConfig,
  getEnabledPapers,
  getEnabledDimensionsForPaper,
  findPaperByLabel,
  findDimensionByLabel,
  ensureValidPaperSelection,
  ensureValidDimensionSelection
} from './printing-config-utils.js';
import { PrintingDeliveryController } from './printing-delivery-utils.js?v=20260604-1';
import { formatPriceDual, loadCurrencySettings } from './currency-utils.js';

const PHOTO_DIMENSIONS = [
  { label: '4x5', enabled: true, price: 15 },
  { label: '5x7', enabled: true, price: 17 },
  { label: '8x10', enabled: true, price: 28 },
  { label: '8.5x11', enabled: true, price: 47 },
  { label: '11x17', enabled: true, price: 110 },
  { label: '13x19', enabled: true, price: 89 }
];

function buildPaper(label) {
  return {
    label,
    enabled: true,
    dimensions: PHOTO_DIMENSIONS.map((dimension) => ({ ...dimension }))
  };
}

const DEFAULT_CONFIG = {
  enabled: true,
  papers: [
    buildPaper('Glossy'),
    buildPaper('Matte'),
    buildPaper('Premium Glossy')
  ],
  notes: ''
};

const PRODUCT_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <rect width="240" height="240" rx="36" fill="#F2E9DA"/>
  <rect x="42" y="52" width="156" height="136" rx="18" fill="#FFFFFF" stroke="#C6A75E" stroke-width="8"/>
  <circle cx="92" cy="102" r="18" fill="#F6EFE2"/>
  <path d="M66 166l34-30 24 20 26-24 24 34" fill="none" stroke="#1F1E1C" stroke-opacity=".78" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`)}`;

function mergeConfig(data = {}) {
  return normalizePrintingConfig(DEFAULT_CONFIG, data);
}

class PrintingPhotoPage {
  constructor(containerId = 'printing-photo-root') {
    this.container = document.getElementById(containerId);
    this.config = mergeConfig();
    this.photos = [];
    this.isBusy = false;
    this.currentStep = 1;
    this.formState = {
      defaultCopies: 1
    };
    this.cart = getCartManager({ imageBasePath: './' });
    this.deliveryController = new PrintingDeliveryController({
      getContainer: () => this.container,
      escape: (value) => this.escape(value),
      formatPrice: (value) => this.formatPrice(value),
      moduleId: 'photo',
      metricLabel: 'tirages',
      getMetricValue: () => this.calculateQuote().totalCopies,
      onChange: () => {
        this.render();
        this.attachEvents();
        this.refreshQuote();
      }
    });
    if (!this.container) return;
    this.init();
  }

  async init() {
    await loadCurrencySettings();
    await this.loadConfig();
    await this.deliveryController.init();
    this.render();
    this.attachEvents();
  }

  async loadConfig() {
    try {
      const snapshot = await getDoc(doc(db, 'printingSettings', 'photo'));
      this.config = snapshot.exists() ? mergeConfig(snapshot.data()) : mergeConfig();
    } catch (error) {
      console.error('Erreur chargement config photo:', error);
      this.config = mergeConfig();
    }
  }

  getEnabledPapers() {
    return getEnabledPapers(this.config.papers || []);
  }

  getEnabledDimensions(paperLabel = '') {
    return getEnabledDimensionsForPaper(this.config.papers || [], paperLabel);
  }

  formatPrice(value) {
    return formatPriceDual(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  escape(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  getCurrentSelections() {
    return {
      defaultCopies: Math.max(1, Number.parseInt(this.container.querySelector('#photoDefaultCopies')?.value || String(this.formState.defaultCopies || 1), 10) || 1)
    };
  }

  syncFormState() {
    this.formState = {
      ...this.formState,
      ...this.getCurrentSelections()
    };
  }

  ensureValidSelections() {
    this.photos = this.photos.map((photo) => ({
      ...photo,
      paperLabel: ensureValidPaperSelection(this.config.papers || [], photo.paperLabel),
      dimensionLabel: ensureValidDimensionSelection(this.config.papers || [], photo.paperLabel, photo.dimensionLabel)
    }));
  }

  calculateQuote() {
    const lines = this.photos.map((photo) => {
      const paper = findPaperByLabel(this.config.papers || [], photo.paperLabel);
      const dimension = findDimensionByLabel(this.config.papers || [], photo.paperLabel, photo.dimensionLabel);
      const pricePerPrint = Number(dimension?.price) || 0;
      const copies = Math.max(1, Number(photo.copies || this.formState.defaultCopies || 1) || 1);
      return {
        ...photo,
        paper,
        dimension,
        pricePerPrint,
        copies,
        total: pricePerPrint * copies
      };
    });
    const totalPrice = lines.reduce((total, line) => total + line.total, 0);
    const totalCopies = lines.reduce((total, line) => total + line.copies, 0);

    return {
      lines,
      imageCount: this.photos.length,
      totalCopies,
      totalPrice
    };
  }

  getStepValidity(step = this.currentStep) {
    if (step === 1) return this.photos.length > 0;
    if (step === 2) {
      return this.photos.length > 0
        && this.photos.every((photo) => photo.paperLabel && photo.dimensionLabel && Number(photo.copies || 0) >= 1);
    }
    return this.getStepValidity(1) && this.getStepValidity(2);
  }

  goToStep(step) {
    const nextStep = Math.max(1, Math.min(3, Number(step) || 1));
    if (nextStep > 1 && !this.getStepValidity(1)) return;
    if (nextStep > 2 && !this.getStepValidity(2)) return;
    this.currentStep = nextStep;
    this.render();
    this.attachEvents();
    this.refreshQuote();
  }

  renderStepChip(step, title) {
    const active = this.currentStep === step;
    const done = this.currentStep > step || (step < 3 && this.getStepValidity(step));
    return `
      <button type="button" class="printing-quiz-step ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}" data-go-step="${step}">
        <span class="printing-quiz-step-index">${done ? '<i class="fas fa-check"></i>' : step}</span>
        <span class="printing-quiz-step-copy"><strong>Etape ${step}</strong><small>${title}</small></span>
      </button>
    `;
  }

  renderStepOne() {
    return `
      <section class="printing-quiz-panel">
        <div class="printing-quiz-panel-head">
          <small>Etape 1</small>
          <h2>Chargez vos photos</h2>
          <p>Ajoutez une ou plusieurs photos. Vous pourrez choisir une dimension pour chaque photo a l etape suivante.</p>
        </div>
        <label class="printing-quiz-field">
          <span>Fichiers image</span>
          <div class="printing-quiz-upload">
            <input id="photoImageFile" class="printing-quiz-input" type="file" accept="image/*" multiple ${this.config.enabled === false ? 'disabled' : ''}>
            <div id="photoFileStatus" class="printing-quiz-upload-status" style="color:${this.photos.length ? '#0f9f6e' : '#6E6557'};">
              ${this.photos.length ? `${this.photos.length} photo(s) ajoutee(s).` : 'Choisissez des images JPG, PNG, WEBP ou GIF pour commencer.'}
            </div>
          </div>
        </label>
        ${this.photos.length ? `
          <div class="photo-list">
            ${this.photos.map((photo, index) => `
              <article class="photo-card">
                <div>
                  <strong>${index + 1}. ${this.escape(photo.name)}</strong>
                  <small>${this.escape(photo.type || 'image')}</small>
                </div>
                <button type="button" class="printing-quiz-btn ghost small" data-remove-photo="${this.escape(photo.id)}">
                  <i class="fas fa-trash"></i>
                  Retirer
                </button>
              </article>
            `).join('')}
          </div>
        ` : ''}
        <div class="printing-quiz-actions">
          <button type="button" class="printing-quiz-btn primary" data-next-step="2" ${!this.getStepValidity(1) || this.config.enabled === false ? 'disabled' : ''}>Continuer</button>
        </div>
      </section>
    `;
  }

  renderStepTwo() {
    const papers = this.getEnabledPapers();
    return `
      <section class="printing-quiz-panel">
        <div class="printing-quiz-panel-head">
          <small>Etape 2</small>
          <h2>Choisissez vos options</h2>
          <p>Chaque photo peut avoir son propre type de papier, son format et son nombre de tirages.</p>
        </div>
        <div class="printing-quiz-grid">
          <label class="printing-quiz-field">
            <span>Tirages par defaut</span>
            <input id="photoDefaultCopies" class="printing-quiz-input" type="number" min="1" step="1" value="${this.formState.defaultCopies || 1}" ${this.config.enabled === false ? 'disabled' : ''}>
          </label>
          <div class="printing-quiz-note">Choisissez le papier et le format directement sur chaque photo. Les prix se recalculent automatiquement.</div>
        </div>
        <div class="photo-options-list">
          ${this.photos.map((photo, index) => {
            const dimensions = this.getEnabledDimensions(photo.paperLabel);
            return `
            <article class="photo-option-card" data-photo-option-row="${this.escape(photo.id)}">
              <div class="photo-option-title">
                <strong>${index + 1}. ${this.escape(photo.name)}</strong>
                <small>Choix independant: papier, format et tirages.</small>
              </div>
              <label class="printing-quiz-field">
                <span>Type de papier</span>
                <select class="printing-quiz-input" data-photo-paper="${this.escape(photo.id)}" ${this.config.enabled === false ? 'disabled' : ''}>
                  <option value="">Choisir un papier</option>
                  ${papers.map((paper) => `<option value="${this.escape(paper.label)}" ${photo.paperLabel === paper.label ? 'selected' : ''}>${this.escape(paper.label)}</option>`).join('')}
                </select>
              </label>
              <label class="printing-quiz-field">
                <span>Format</span>
                <select class="printing-quiz-input" data-photo-dimension="${this.escape(photo.id)}" ${this.config.enabled === false ? 'disabled' : ''} ${!photo.paperLabel ? 'disabled' : ''}>
                  <option value="">Choisir un format</option>
                  ${dimensions.map((dimension) => `<option value="${this.escape(dimension.label)}" ${photo.dimensionLabel === dimension.label ? 'selected' : ''}>${this.escape(dimension.label)} - ${this.formatPrice(dimension.price || 0)} / tirage</option>`).join('')}
                </select>
              </label>
              <label class="printing-quiz-field">
                <span>Nombre de tirages</span>
                <input class="printing-quiz-input" type="number" min="1" step="1" data-photo-copies="${this.escape(photo.id)}" value="${photo.copies || this.formState.defaultCopies || 1}" ${this.config.enabled === false ? 'disabled' : ''}>
              </label>
            </article>
          `;
          }).join('')}
        </div>
        <div class="printing-quiz-actions">
          <button type="button" class="printing-quiz-btn ghost" data-prev-step="1">Retour</button>
          <button type="button" class="printing-quiz-btn primary" data-next-step="3" ${!this.getStepValidity(2) || this.config.enabled === false ? 'disabled' : ''}>Voir mon tarif</button>
        </div>
      </section>
    `;
  }

  renderStepThree(quote) {
    return `
      <section class="printing-quiz-panel">
        <div class="printing-quiz-panel-head">
          <small>Etape 3</small>
          <h2>Votre tarif est prêt</h2>
          <p>Le total se base sur le prix de la dimension choisie, votre image et le nombre de tirages.</p>
        </div>
        <div class="printing-quiz-summary">
          <div class="printing-quiz-summary-row"><span>Images</span><strong>${quote.imageCount}</strong></div>
          <div class="printing-quiz-summary-row"><span>Tirages</span><strong id="photoQuoteCopies">${quote.totalCopies}</strong></div>
          <div class="photo-summary-list" id="photoQuoteLines">
            ${quote.lines.map((line, index) => `
              <div class="photo-summary-line">
                <span>${index + 1}. ${this.escape(line.name)} - ${this.escape(line.paper?.label || '-')} - ${this.escape(line.dimension?.label || '-')} - ${line.copies} tirage(s)</span>
                <strong>${this.formatPrice(line.total)}</strong>
              </div>
            `).join('')}
          </div>
          <div class="printing-quiz-summary-row"><span>Total impression</span><strong id="photoPrintTotal">${this.formatPrice(quote.totalPrice)}</strong></div>
          <div class="printing-quiz-summary-row"><span>Frais reception</span><strong id="photoDeliveryFee">${this.formatPrice(this.deliveryController.getFee())}</strong></div>
          <div class="printing-quiz-summary-total"><span>Total à payer</span><strong id="photoQuoteTotal">${this.formatPrice(quote.totalPrice + this.deliveryController.getFee())}</strong></div>
        </div>
        ${this.deliveryController.renderSection()}
        ${this.config.notes ? `<div class="printing-quiz-note">${this.escape(this.config.notes)}</div>` : ''}
        <div class="printing-quiz-actions">
          <button type="button" class="printing-quiz-btn ghost" data-prev-step="2">Modifier mes choix</button>
          <button type="button" class="printing-quiz-btn secondary" id="openCartFromPhoto">Ouvrir le panier</button>
          <button type="button" class="printing-quiz-btn primary" id="submitPhotoOrder" ${this.config.enabled === false ? 'disabled' : ''}>Ajouter au panier</button>
          <span id="photoSubmitStatus" class="printing-quiz-submit-status"></span>
        </div>
      </section>
    `;
  }

  render() {
    const quote = this.calculateQuote();

    this.container.innerHTML = `
      <style>
        .printing-quiz-shell{width:100%;max-width:1100px;margin:0 auto;padding:1rem 1rem 3rem;display:grid;gap:1rem}
        .printing-quiz-heading{display:grid;gap:.5rem;padding:.4rem 0 0}
        .printing-quiz-heading small{color:#9b7c38;text-transform:uppercase;letter-spacing:.16em;font-size:.75rem;font-weight:800}
        .printing-quiz-heading h1{font-family:'Cormorant Garamond',serif;font-size:clamp(2.2rem,5vw,3.8rem);line-height:.92;color:#1F1E1C}
        .printing-quiz-heading p{color:#6E6557;line-height:1.8;max-width:60ch}
        .printing-quiz-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.85rem}
        .printing-quiz-step{border:1px solid rgba(31,30,28,.08);border-radius:1.4rem;background:rgba(255,255,255,.92);box-shadow:0 18px 36px rgba(31,30,28,.06);padding:.95rem 1rem;display:flex;gap:.8rem;align-items:center;text-align:left;cursor:pointer}
        .printing-quiz-step.is-active{border-color:rgba(198,167,94,.35);box-shadow:0 20px 40px rgba(31,30,28,.08);background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(248,242,230,.94))}
        .printing-quiz-step.is-done .printing-quiz-step-index{background:#0f9f6e;color:#fff}
        .printing-quiz-step-index{width:36px;height:36px;min-width:36px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:rgba(198,167,94,.14);color:#9b7c38;font-weight:800}
        .printing-quiz-step-copy{display:grid;gap:.16rem}
        .printing-quiz-step-copy strong{font-size:.86rem;color:#6E6557}
        .printing-quiz-step-copy small{font-size:1rem;color:#1F1E1C;font-weight:800}
        .printing-quiz-panel{border:1px solid rgba(31,30,28,.08);border-radius:1.9rem;background:rgba(255,255,255,.94);box-shadow:0 24px 60px rgba(31,30,28,.08);padding:clamp(1.2rem,3vw,1.8rem);display:grid;gap:1.1rem}
        .printing-quiz-panel-head{display:grid;gap:.45rem}
        .printing-quiz-panel-head small{color:#9b7c38;text-transform:uppercase;letter-spacing:.14em;font-size:.72rem;font-weight:800}
        .printing-quiz-panel-head h2{font-family:'Cormorant Garamond',serif;font-size:clamp(2rem,4vw,2.9rem);line-height:.94;color:#1F1E1C}
        .printing-quiz-panel-head p{color:#6E6557;line-height:1.8;max-width:58ch}
        .printing-quiz-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}
        .printing-quiz-field{display:grid;gap:.5rem}
        .printing-quiz-input{width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.95rem 1rem;background:#fff;font:inherit}
        .printing-quiz-upload{border:1px dashed rgba(198,167,94,.4);border-radius:1.3rem;padding:1rem;background:linear-gradient(180deg,rgba(248,242,230,.7),rgba(255,255,255,.96));display:grid;gap:.85rem}
        .photo-list,.photo-options-list,.photo-summary-list{display:grid;gap:.75rem}
        .photo-card,.photo-option-card{border:1px solid rgba(31,30,28,.08);border-radius:1.15rem;background:rgba(255,255,255,.82);padding:.95rem;display:grid;gap:.85rem}
        .photo-card{grid-template-columns:1fr auto;align-items:center}
        .photo-card strong,.photo-option-title strong{color:#1F1E1C}
        .photo-card small,.photo-option-title small{display:block;color:#6E6557;margin-top:.2rem}
        .photo-option-card{grid-template-columns:1.25fr 1fr 1fr .75fr;align-items:end}
        .photo-summary-line{display:flex;justify-content:space-between;gap:1rem;padding:.75rem .8rem;border-radius:1rem;background:rgba(255,255,255,.74);color:#6E6557}
        .printing-quiz-summary{display:grid;gap:.8rem;border:1px solid rgba(31,30,28,.08);border-radius:1.35rem;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(248,242,230,.9));padding:1.1rem}
        .printing-quiz-summary-row,.printing-quiz-summary-total{display:flex;justify-content:space-between;gap:1rem;color:#6E6557}
        .printing-quiz-summary-total{margin-top:.25rem;padding-top:.9rem;border-top:1px solid rgba(31,30,28,.08);color:#1F1E1C;font-size:1.2rem;font-weight:800}
        .printing-quiz-note{border-radius:1.2rem;background:rgba(198,167,94,.08);border:1px solid rgba(198,167,94,.16);color:#8A7450;padding:1rem 1.1rem;line-height:1.8}
        .printing-quiz-note.is-error{background:rgba(185,28,28,.08);border-color:rgba(185,28,28,.12);color:#991b1b}
        .printing-quiz-actions{display:flex;flex-wrap:wrap;gap:.8rem;align-items:center}
        .printing-quiz-btn{border:none;border-radius:999px;padding:.96rem 1.25rem;font:inherit;font-weight:800;cursor:pointer}
        .printing-quiz-btn.primary{background:#1F1E1C;color:#F8F5EF;box-shadow:0 14px 28px rgba(31,30,28,.18)}
        .printing-quiz-btn.secondary{background:#fff;color:#1F1E1C;border:1px solid rgba(31,30,28,.12)}
        .printing-quiz-btn.ghost{background:transparent;color:#6E6557;border:1px solid rgba(31,30,28,.1)}
        .printing-quiz-btn.small{padding:.65rem .8rem;font-size:.85rem}
        .printing-quiz-btn:disabled,.printing-quiz-step:disabled{opacity:.5;cursor:not-allowed}
        @media (max-width:860px){.printing-quiz-steps,.printing-quiz-grid,.photo-option-card,.photo-card{grid-template-columns:1fr}}
      </style>
      <section class="printing-quiz-shell">
        <header class="printing-quiz-topbar">
          <div class="printing-quiz-heading">
            <small>Impression photo</small>
            <h1>Commandez plusieurs tirages photo</h1>
            <p>Ajoutez vos photos, choisissez une dimension pour chacune, puis validez votre reception. Le prix final suit automatiquement vos choix.</p>
          </div>
          ${this.config.enabled === false ? `<div class="printing-quiz-note is-error">Le module photo est temporairement indisponible.</div>` : ''}
          <div class="printing-quiz-steps">
            ${this.renderStepChip(1, 'Votre image')}
            ${this.renderStepChip(2, 'Vos options')}
            ${this.renderStepChip(3, 'Votre tarif')}
          </div>
        </header>
        ${this.currentStep === 1 ? this.renderStepOne() : ''}
        ${this.currentStep === 2 ? this.renderStepTwo() : ''}
        ${this.currentStep === 3 ? this.renderStepThree(quote) : ''}
      </section>
    `;

    this.restoreFormState();
  }

  restoreFormState() {
    const copiesInput = this.container.querySelector('#photoDefaultCopies');
    const fileStatus = this.container.querySelector('#photoFileStatus');
    if (copiesInput) copiesInput.value = String(this.formState.defaultCopies || 1);
    if (fileStatus && this.photos.length) {
      fileStatus.textContent = `${this.photos.length} photo(s) ajoutee(s).`;
      fileStatus.style.color = '#0f9f6e';
    }
  }

  attachEvents() {
    this.container.querySelectorAll('[data-go-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.goStep))));
    this.container.querySelectorAll('[data-next-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.nextStep))));
    this.container.querySelectorAll('[data-prev-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.prevStep))));
    this.container.querySelector('#photoImageFile')?.addEventListener('change', async (event) => {
      await this.handleImageSelection(event.target.files);
      event.target.value = '';
    });
    this.container.querySelectorAll('[data-remove-photo]').forEach((button) => {
      button.addEventListener('click', () => this.removePhoto(button.dataset.removePhoto));
    });
    this.container.querySelector('#photoDefaultCopies')?.addEventListener('input', () => {
      this.syncFormState();
      this.photos = this.photos.map((photo) => ({
        ...photo,
        copies: Number(photo.copies || 0) >= 1 ? photo.copies : this.formState.defaultCopies
      }));
      this.refreshQuote();
    });
    this.container.querySelectorAll('[data-photo-paper]').forEach((field) => {
      field.addEventListener('change', () => {
        this.photos = this.photos.map((photo) => (
          photo.id === field.dataset.photoPaper
            ? { ...photo, paperLabel: field.value, dimensionLabel: '' }
            : photo
        ));
        this.render();
        this.attachEvents();
        this.refreshQuote();
      });
    });
    this.container.querySelectorAll('[data-photo-dimension]').forEach((field) => {
      field.addEventListener('change', () => {
        this.updatePhotoField(field.dataset.photoDimension, 'dimensionLabel', field.value);
      });
    });
    this.container.querySelectorAll('[data-photo-copies]').forEach((field) => {
      field.addEventListener('input', () => {
        this.updatePhotoField(field.dataset.photoCopies, 'copies', Math.max(1, Number.parseInt(field.value || '1', 10) || 1));
      });
    });
    this.container.querySelector('#submitPhotoOrder')?.addEventListener('click', async () => {
      await this.handleSubmit();
    });
    this.container.querySelector('#openCartFromPhoto')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('openCart')));
    this.deliveryController.bind();
  }

  async handleImageSelection(fileList) {
    const statusEl = this.container.querySelector('#photoFileStatus');
    const files = Array.from(fileList || []);

    if (!files.length) {
      if (statusEl) {
        statusEl.textContent = 'Choisissez au moins une image pour commencer.';
        statusEl.style.color = '#6E6557';
      }
      return;
    }

    try {
      if (statusEl) {
        statusEl.textContent = 'Preparation des photos...';
        statusEl.style.color = '#6E6557';
      }
      const nextPhotos = files.map((file) => ({
        id: `photo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        file,
        name: file.name,
        type: file.type || 'image/*',
        paperLabel: '',
        dimensionLabel: '',
        copies: this.formState.defaultCopies || 1
      }));
      this.photos = [...this.photos, ...nextPhotos];
      this.render();
      this.attachEvents();
    } catch (error) {
      console.error('Erreur lecture image photo:', error);
      if (statusEl) {
        statusEl.textContent = error.message || 'Impossible de lire cette image.';
        statusEl.style.color = '#b91c1c';
      }
    }
  }

  removePhoto(photoId) {
    this.photos = this.photos.filter((photo) => photo.id !== photoId);
    this.render();
    this.attachEvents();
    this.refreshQuote();
  }

  updatePhotoField(photoId, field, value) {
    this.photos = this.photos.map((photo) => (
      photo.id === photoId ? { ...photo, [field]: value } : photo
    ));
    this.refreshQuote();
  }

  refreshQuote() {
    this.syncFormState();
    const quote = this.calculateQuote();
    const copiesEl = this.container.querySelector('#photoQuoteCopies');
    const totalEl = this.container.querySelector('#photoQuoteTotal');
    const printTotalEl = this.container.querySelector('#photoPrintTotal');
    const deliveryFeeEl = this.container.querySelector('#photoDeliveryFee');
    const nextButton = this.container.querySelector('[data-next-step="3"]');
    const quoteLinesEl = this.container.querySelector('#photoQuoteLines');
    if (copiesEl) copiesEl.textContent = String(quote.totalCopies);
    if (quoteLinesEl) {
      quoteLinesEl.innerHTML = quote.lines.map((line, index) => `
        <div class="photo-summary-line">
          <span>${index + 1}. ${this.escape(line.name)} - ${this.escape(line.paper?.label || '-')} - ${this.escape(line.dimension?.label || '-')} - ${line.copies} tirage(s)</span>
          <strong>${this.formatPrice(line.total)}</strong>
        </div>
      `).join('');
    }
    if (printTotalEl) printTotalEl.textContent = this.formatPrice(quote.totalPrice);
    if (deliveryFeeEl) deliveryFeeEl.textContent = this.formatPrice(this.deliveryController.getFee());
    if (totalEl) totalEl.textContent = this.formatPrice(quote.totalPrice + this.deliveryController.getFee());
    if (nextButton) nextButton.disabled = !this.getStepValidity(2) || this.config.enabled === false;
  }

  async handleSubmit() {
    const statusEl = this.container.querySelector('#photoSubmitStatus');
    this.syncFormState();
    const quote = this.calculateQuote();

    if (!this.photos.length) {
      if (statusEl) statusEl.textContent = 'Ajoutez au moins une photo valide.';
      return;
    }
    if (!this.photos.every((photo) => photo.paperLabel && photo.dimensionLabel && Number(photo.copies || 0) >= 1)) {
      if (statusEl) statusEl.textContent = 'Choisissez un papier, une dimension et un nombre de tirages pour chaque photo.';
      return;
    }
    if (!this.deliveryController.isValid()) {
      if (statusEl) {
        statusEl.textContent = 'Choisissez un point de retrait ou une zone de livraison disponible.';
        statusEl.style.color = '#b91c1c';
      }
      return;
    }

    try {
      this.isBusy = true;
      if (statusEl) statusEl.textContent = 'Upload des photos et ajout au panier...';
      const uploadedPhotos = await Promise.all(this.photos.map(async (photo, index) => {
        const uploaded = await uploadImageFile(photo.file, 'printing-photo', { maxSizeMb: 20 });
        const line = quote.lines[index];
        return {
          name: photo.name,
          url: uploaded.url,
          path: uploaded.path,
          paper: line?.paper?.label || photo.paperLabel,
          dimension: line?.dimension?.label || photo.dimensionLabel,
          copies: line?.copies || photo.copies || 1,
          unitPrice: line?.pricePerPrint || 0,
          total: line?.total || 0
        };
      }));
      const deliveryPayload = this.deliveryController.getCartPayload();
      const deliveryFee = Number(deliveryPayload.fee || 0);
      const payableTotal = quote.totalPrice + deliveryFee;
      const summaryLines = uploadedPhotos.flatMap((photo, index) => ([
        { label: `Photo ${index + 1}`, value: photo.name },
        { label: `Photo ${index + 1} type de papier`, value: photo.paper },
        { label: `Photo ${index + 1} dimension`, value: photo.dimension },
        { label: `Photo ${index + 1} tirages`, value: String(photo.copies) },
        { label: `Photo ${index + 1} total`, value: this.formatPrice(photo.total) },
        { label: `Photo ${index + 1} URL fichier`, value: photo.url },
        { label: `Photo ${index + 1} Chemin storage`, value: photo.path }
      ]));
      document.dispatchEvent(new CustomEvent('addToCart', {
        detail: {
          productId: 'printing-photo',
          name: `Impression photo (${uploadedPhotos.length} photo${uploadedPhotos.length > 1 ? 's' : ''})`,
          price: payableTotal,
          quantity: 1,
          sku: `PHOTO-${Date.now()}`,
          image: PRODUCT_IMAGE,
          sourceType: 'printing',
          deliveryMode: deliveryPayload.method === 'pickup' ? 'Impression - point de retrait' : 'Impression - livraison a domicile',
          deliveryCoverage: { country: 'Haiti', mode: 'printing_prepaid', nationwide: true, nationwideFee: 0, zones: [] },
          productDeliveryCoverage: { country: 'Haiti', mode: 'printing_prepaid', nationwide: true, nationwideFee: 0, zones: [] },
          printingDelivery: deliveryPayload,
          printingFiles: uploadedPhotos.map((photo) => ({
            fileName: photo.name,
            fileUrl: photo.url,
            storagePath: photo.path,
            paper: photo.paper,
            dimension: photo.dimension,
            copies: photo.copies
          })),
          selectedOptions: [
            { label: 'Photos', value: String(uploadedPhotos.length) },
            { label: 'Tirages total', value: String(quote.totalCopies) },
            { label: 'Total impression', value: this.formatPrice(quote.totalPrice) },
            ...summaryLines,
            ...this.deliveryController.getSummaryLines(),
            { label: 'Total à payer', value: this.formatPrice(payableTotal) },
            { label: 'Fichier', value: uploadedPhotos[0]?.name || '' },
            { label: 'URL fichier', value: uploadedPhotos[0]?.url || '' },
            { label: 'Chemin storage', value: uploadedPhotos[0]?.path || '' }
          ]
        }
      }));
      if (statusEl) {
        statusEl.textContent = 'Votre demande photo a ete ajoutee au panier.';
        statusEl.style.color = '#0f9f6e';
      }
      document.dispatchEvent(new CustomEvent('openCart'));
    } catch (error) {
      console.error('Erreur impression photo:', error);
      if (statusEl) {
        statusEl.textContent = error.message || 'Impossible d ajouter cette demande photo au panier.';
        statusEl.style.color = '#b91c1c';
      }
    } finally {
      this.isBusy = false;
    }
  }
}

export default PrintingPhotoPage;
