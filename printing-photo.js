import { db } from './firebase-init.js';
import { uploadImageFile } from './firebase-storage.js';
import { getCartManager } from './cart.js?v=20260831-4';
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
import { PrintingDeliveryController } from './printing-delivery-utils.js?v=20260831-4';
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
  <rect x="42" y="52" width="156" height="136" rx="18" fill="#FFFFFF" stroke="#FFA41C" stroke-width="8"/>
  <circle cx="92" cy="102" r="18" fill="#F6EFE2"/>
  <path d="M66 166l34-30 24 20 26-24 24 34" fill="none" stroke="#0F1111" stroke-opacity=".78" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
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
      <button type="button" class="pphoto-step ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}" data-go-step="${step}">
        <span class="pphoto-step-dot">${done ? '<i class="fas fa-check"></i>' : step}</span>
        <span class="pphoto-step-label">${title}</span>
      </button>
      ${step < 3 ? '<span class="pphoto-step-line"></span>' : ''}
    `;
  }

  renderStepOne() {
    return `
      <section class="pphoto-panel">
        <h2>Chargez vos photos</h2>
        <p class="pphoto-hint">Ajoutez une ou plusieurs images. Chacune pourra avoir son propre format à l'étape suivante.</p>
        <label class="pphoto-field">
          <span>Fichiers image</span>
          <div class="pphoto-upload">
            <input id="photoImageFile" class="pphoto-input" type="file" accept="image/*" multiple ${this.config.enabled === false ? 'disabled' : ''}>
            <div id="photoFileStatus" class="pphoto-upload-status" style="color:${this.photos.length ? '#0f9f6e' : 'var(--sc-muted)'};">
              ${this.photos.length ? `${this.photos.length} photo(s) ajoutée(s).` : 'JPG, PNG, WEBP ou GIF.'}
            </div>
          </div>
        </label>
        ${this.photos.length ? `
          <div class="photo-grid">
            ${this.photos.map((photo, index) => `
              <article class="photo-thumb-card">
                <div class="photo-thumb-media"><img src="${this.escape(photo.previewUrl)}" alt="${this.escape(photo.name)}"></div>
                <div class="photo-thumb-body">
                  <strong>${index + 1}. ${this.escape(photo.name)}</strong>
                  <button type="button" class="pphoto-btn ghost small" data-remove-photo="${this.escape(photo.id)}">
                    <i class="fas fa-trash"></i> Retirer
                  </button>
                </div>
              </article>
            `).join('')}
          </div>
        ` : ''}
        <div class="pphoto-actions">
          <button type="button" class="pphoto-btn primary" data-next-step="2" ${!this.getStepValidity(1) || this.config.enabled === false ? 'disabled' : ''}>Continuer</button>
        </div>
      </section>
    `;
  }

  renderStepTwo() {
    const papers = this.getEnabledPapers();
    return `
      <section class="pphoto-panel">
        <h2>Papier, format et tirages</h2>
        <p class="pphoto-hint">Chaque photo peut avoir son propre papier, son format et son nombre de tirages.</p>
        <label class="pphoto-field">
          <span>Tirages par défaut</span>
          <input id="photoDefaultCopies" class="pphoto-input" style="max-width:180px;" type="number" min="1" step="1" value="${this.formState.defaultCopies || 1}" ${this.config.enabled === false ? 'disabled' : ''}>
        </label>
        <div class="photo-options-list">
          ${this.photos.map((photo, index) => {
            const dimensions = this.getEnabledDimensions(photo.paperLabel);
            return `
            <article class="photo-option-card" data-photo-option-row="${this.escape(photo.id)}">
              <div class="photo-option-media"><img src="${this.escape(photo.previewUrl)}" alt="${this.escape(photo.name)}"></div>
              <div class="photo-option-fields">
                <strong class="photo-option-name">${index + 1}. ${this.escape(photo.name)}</strong>
                <div class="photo-option-grid">
                  <label class="pphoto-field">
                    <span>Type de papier</span>
                    <select class="pphoto-input" data-photo-paper="${this.escape(photo.id)}" ${this.config.enabled === false ? 'disabled' : ''}>
                      <option value="">Choisir</option>
                      ${papers.map((paper) => `<option value="${this.escape(paper.label)}" ${photo.paperLabel === paper.label ? 'selected' : ''}>${this.escape(paper.label)}</option>`).join('')}
                    </select>
                  </label>
                  <label class="pphoto-field">
                    <span>Format</span>
                    <select class="pphoto-input" data-photo-dimension="${this.escape(photo.id)}" ${this.config.enabled === false ? 'disabled' : ''} ${!photo.paperLabel ? 'disabled' : ''}>
                      <option value="">Choisir</option>
                      ${dimensions.map((dimension) => `<option value="${this.escape(dimension.label)}" ${photo.dimensionLabel === dimension.label ? 'selected' : ''}>${this.escape(dimension.label)} - ${this.formatPrice(dimension.price || 0)}</option>`).join('')}
                    </select>
                  </label>
                  <label class="pphoto-field">
                    <span>Tirages</span>
                    <input class="pphoto-input" type="number" min="1" step="1" data-photo-copies="${this.escape(photo.id)}" value="${photo.copies || this.formState.defaultCopies || 1}" ${this.config.enabled === false ? 'disabled' : ''}>
                  </label>
                </div>
              </div>
            </article>
          `;
          }).join('')}
        </div>
        <div class="pphoto-actions">
          <button type="button" class="pphoto-btn ghost" data-prev-step="1">Retour</button>
          <button type="button" class="pphoto-btn primary" data-next-step="3" ${!this.getStepValidity(2) || this.config.enabled === false ? 'disabled' : ''}>Voir mon tarif</button>
        </div>
      </section>
    `;
  }

  renderStepThree(quote) {
    return `
      <section class="pphoto-panel">
        <h2>Votre tarif</h2>
        <div class="pphoto-summary">
          <div class="pphoto-summary-row"><span>Images</span><strong>${quote.imageCount}</strong></div>
          <div class="pphoto-summary-row"><span>Tirages</span><strong id="photoQuoteCopies">${quote.totalCopies}</strong></div>
        </div>
        <div class="photo-summary-list" id="photoQuoteLines">
          ${quote.lines.map((line, index) => `
            <div class="photo-summary-line">
              <span>${index + 1}. ${this.escape(line.name)} · ${this.escape(line.paper?.label || '-')} · ${this.escape(line.dimension?.label || '-')} · ${line.copies}x</span>
              <strong>${this.formatPrice(line.total)}</strong>
            </div>
          `).join('')}
        </div>
        <div class="pphoto-summary">
          <div class="pphoto-summary-row"><span>Total impression</span><strong id="photoPrintTotal">${this.formatPrice(quote.totalPrice)}</strong></div>
          <div class="pphoto-summary-row"><span>Frais réception</span><strong id="photoDeliveryFee">${this.formatPrice(this.deliveryController.getFee())}</strong></div>
          <div class="pphoto-summary-total"><span>Total à payer</span><strong id="photoQuoteTotal">${this.formatPrice(quote.totalPrice + this.deliveryController.getFee())}</strong></div>
        </div>
        ${this.deliveryController.renderSection()}
        ${this.config.notes ? `<div class="pphoto-note">${this.escape(this.config.notes)}</div>` : ''}
        <div class="pphoto-actions">
          <button type="button" class="pphoto-btn ghost" data-prev-step="2">Modifier</button>
          <button type="button" class="pphoto-btn secondary" id="openCartFromPhoto">Ouvrir le panier</button>
          <button type="button" class="pphoto-btn primary" id="submitPhotoOrder" ${this.config.enabled === false ? 'disabled' : ''}>Ajouter au panier</button>
          <span id="photoSubmitStatus" class="pphoto-submit-status"></span>
        </div>
      </section>
    `;
  }

  render() {
    const quote = this.calculateQuote();

    this.container.innerHTML = `
      <style>
        .pphoto-shell{width:100%;max-width:940px;margin:0 auto;padding:0 1rem 3rem;display:grid;gap:1.35rem}
        .pphoto-hero{background:var(--sc-navy);color:#fff;border-radius:var(--sc-radius);padding:1.75rem 1.85rem;display:flex;align-items:center;gap:1.1rem}
        .pphoto-hero-icon{width:50px;height:50px;min-width:50px;border-radius:13px;background:rgba(232,96,76,.28);display:flex;align-items:center;justify-content:center;font-size:1.25rem;color:#f2a99c}
        .pphoto-hero h1{font-size:clamp(1.35rem,2.6vw,1.7rem);font-weight:800;margin-bottom:.3rem;letter-spacing:-.01em}
        .pphoto-hero p{color:rgba(255,255,255,.72);font-size:.88rem;line-height:1.5;max-width:56ch}
        .pphoto-error-banner{border-radius:var(--sc-radius-sm);background:#fdecea;border:1px solid #f3c6c2;color:#991b1b;padding:.85rem 1rem;font-size:.88rem}

        .pphoto-stepper{display:flex;align-items:center;padding:0 .2rem}
        .pphoto-step{display:flex;align-items:center;gap:.55rem;background:none;border:none;cursor:pointer;padding:.35rem 0}
        .pphoto-step-dot{width:26px;height:26px;min-width:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.74rem;font-weight:800;background:var(--sc-canvas);color:var(--sc-muted);border:1px solid var(--sc-line)}
        .pphoto-step.is-active .pphoto-step-dot{background:#E8604C;color:#fff;border-color:#E8604C}
        .pphoto-step.is-done .pphoto-step-dot{background:#0f9f6e;color:#fff;border-color:#0f9f6e}
        .pphoto-step-label{font-size:.8rem;font-weight:700;color:var(--sc-muted)}
        .pphoto-step.is-active .pphoto-step-label{color:var(--sc-ink)}
        .pphoto-step-line{flex:1;height:1px;background:var(--sc-line);margin:0 .6rem}

        .pphoto-panel{background:var(--sc-surface);border:1px solid var(--sc-line);border-radius:var(--sc-radius);padding:1.5rem;display:grid;gap:1rem}
        .pphoto-panel h2{font-size:1.15rem;font-weight:800;color:var(--sc-ink)}
        .pphoto-hint{color:var(--sc-muted);font-size:.85rem;margin-top:-.55rem;line-height:1.5}

        .pphoto-field{display:grid;gap:.4rem}
        .pphoto-field span{font-size:.78rem;font-weight:700;color:var(--sc-muted)}
        .pphoto-input{width:100%;border:1px solid var(--sc-line);border-radius:var(--sc-radius-sm);padding:.65rem .75rem;font:inherit;font-size:.88rem;background:#fff;color:var(--sc-ink)}
        .pphoto-input:focus{outline:none;border-color:#E8604C;box-shadow:0 0 0 3px rgba(232,96,76,.14)}

        .pphoto-upload{border:1.5px dashed #f0c0b6;border-radius:var(--sc-radius-sm);padding:1.1rem;background:#fdf3f1;display:grid;gap:.7rem}
        .pphoto-upload-status{font-size:.84rem}

        .photo-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:.75rem}
        .photo-thumb-card{border:1px solid var(--sc-line);border-radius:var(--sc-radius-sm);overflow:hidden;background:#fff}
        .photo-thumb-media{aspect-ratio:1/1;background:var(--sc-canvas)}
        .photo-thumb-media img{width:100%;height:100%;object-fit:cover;display:block}
        .photo-thumb-body{padding:.55rem .6rem;display:grid;gap:.4rem}
        .photo-thumb-body strong{font-size:.78rem;color:var(--sc-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

        .photo-options-list{display:grid;gap:.75rem}
        .photo-option-card{border:1px solid var(--sc-line);border-radius:var(--sc-radius-sm);background:#fff;padding:.85rem;display:flex;gap:.9rem}
        .photo-option-media{width:64px;height:64px;min-width:64px;border-radius:var(--sc-radius-sm);overflow:hidden;background:var(--sc-canvas)}
        .photo-option-media img{width:100%;height:100%;object-fit:cover;display:block}
        .photo-option-fields{flex:1;min-width:0;display:grid;gap:.6rem}
        .photo-option-name{font-size:.86rem;color:var(--sc-ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .photo-option-grid{display:grid;grid-template-columns:1fr 1fr .7fr;gap:.6rem}

        .photo-summary-list{display:grid;gap:.4rem}
        .photo-summary-line{display:flex;justify-content:space-between;gap:1rem;padding:.5rem .7rem;border-radius:var(--sc-radius-sm);background:var(--sc-canvas);color:var(--sc-muted);font-size:.84rem}
        .photo-summary-line strong{color:var(--sc-ink)}

        .pphoto-summary{display:grid;gap:0;border:1px solid var(--sc-line);border-radius:var(--sc-radius-sm);overflow:hidden}
        .pphoto-summary-row{display:flex;justify-content:space-between;gap:1rem;color:var(--sc-muted);font-size:.86rem;padding:.55rem .85rem;border-bottom:1px solid var(--sc-line);background:#fff}
        .pphoto-summary-row strong{color:var(--sc-ink)}
        .pphoto-summary-total{display:flex;justify-content:space-between;font-size:1.1rem;font-weight:800;color:var(--sc-ink);padding:.75rem .85rem;background:var(--sc-canvas)}
        .pphoto-note{border-radius:var(--sc-radius-sm);background:#fdf3f1;border:1px solid #f0c0b6;color:#9c3b26;padding:.85rem .95rem;font-size:.86rem;line-height:1.6}

        .pphoto-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center}
        .pphoto-btn{border:none;border-radius:var(--sc-radius-sm);padding:.72rem 1.05rem;font:inherit;font-weight:700;font-size:.88rem;cursor:pointer}
        .pphoto-btn.primary{background:var(--sc-orange);color:#0f1111;border:1px solid var(--sc-orange-border)}
        .pphoto-btn.primary:hover:not(:disabled){background:var(--sc-orange-border)}
        .pphoto-btn.secondary{background:#fff;color:var(--sc-ink);border:1px solid var(--sc-line)}
        .pphoto-btn.ghost{background:transparent;color:var(--sc-muted);border:1px solid var(--sc-line)}
        .pphoto-btn.small{padding:.45rem .65rem;font-size:.78rem}
        .pphoto-btn:disabled{opacity:.5;cursor:not-allowed}
        .pphoto-submit-status{font-size:.84rem;color:var(--sc-muted)}
        @media (max-width: 640px) {
          .pphoto-hero{flex-direction:column;text-align:center;padding:1.5rem}
          .pphoto-step-label{display:none}
          .photo-option-card{flex-direction:column}
          .photo-option-media{width:100%;height:120px}
          .photo-option-grid{grid-template-columns:1fr}
        }
      </style>
      <section class="pphoto-shell">
        <header class="pphoto-hero">
          <div class="pphoto-hero-icon"><i class="fas fa-images"></i></div>
          <div>
            <h1>Impression photo</h1>
            <p>Ajoutez vos photos, choisissez papier et format pour chacune : le prix suit automatiquement vos choix.</p>
          </div>
        </header>
        ${this.config.enabled === false ? `<div class="pphoto-error-banner">Le module photo est temporairement indisponible.</div>` : ''}
        <nav class="pphoto-stepper">
          ${this.renderStepChip(1, 'Vos photos')}
          ${this.renderStepChip(2, 'Vos options')}
          ${this.renderStepChip(3, 'Votre tarif')}
        </nav>
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
        previewUrl: URL.createObjectURL(file),
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
    const removed = this.photos.find((photo) => photo.id === photoId);
    if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
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
