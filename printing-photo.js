import { db } from './firebase-init.js';
import { uploadImageFile } from './firebase-storage.js';
import { getCartManager } from './cart.js';
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
import { PrintingDeliveryController } from './printing-delivery-utils.js';

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
    this.file = null;
    this.fileInfo = null;
    this.isBusy = false;
    this.currentStep = 1;
    this.formState = {
      paperLabel: '',
      dimensionLabel: '',
      copies: 1
    };
    this.cart = getCartManager({ imageBasePath: './' });
    this.deliveryController = new PrintingDeliveryController({
      getContainer: () => this.container,
      escape: (value) => this.escape(value),
      formatPrice: (value) => this.formatPrice(value),
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
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency',
      currency: 'HTG',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
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
      paperLabel: this.container.querySelector('#photoPaper')?.value || this.formState.paperLabel || '',
      dimensionLabel: this.container.querySelector('#photoDimension')?.value || this.formState.dimensionLabel || '',
      copies: Math.max(1, Number.parseInt(this.container.querySelector('#photoCopies')?.value || String(this.formState.copies || 1), 10) || 1)
    };
  }

  syncFormState() {
    this.formState = {
      ...this.formState,
      ...this.getCurrentSelections()
    };
  }

  ensureValidSelections() {
    this.formState.paperLabel = ensureValidPaperSelection(this.config.papers || [], this.formState.paperLabel);
    this.formState.dimensionLabel = ensureValidDimensionSelection(
      this.config.papers || [],
      this.formState.paperLabel,
      this.formState.dimensionLabel
    );
  }

  calculateQuote() {
    const { paperLabel, dimensionLabel, copies } = this.getCurrentSelections();
    const imageCount = this.fileInfo?.imageCount || 0;
    const paper = findPaperByLabel(this.config.papers || [], paperLabel);
    const dimension = findDimensionByLabel(this.config.papers || [], paperLabel, dimensionLabel);
    const pricePerImage = Number(dimension?.price) || 0;
    const printUnitPrice = pricePerImage * imageCount;

    return {
      paper,
      dimension,
      copies,
      imageCount,
      pricePerImage,
      printUnitPrice,
      totalPrice: printUnitPrice * copies
    };
  }

  getStepValidity(step = this.currentStep) {
    const { paperLabel, dimensionLabel, copies } = this.getCurrentSelections();
    if (step === 1) return Boolean(this.file && this.fileInfo?.imageCount);
    if (step === 2) return Boolean(paperLabel && dimensionLabel && copies >= 1);
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
          <h2>Chargez votre image</h2>
          <p>Choisissez l image que vous souhaitez imprimer. Le tarif se calcule ensuite selon la dimension et le nombre de tirages.</p>
        </div>
        <label class="printing-quiz-field">
          <span>Fichier image</span>
          <div class="printing-quiz-upload">
            <input id="photoImageFile" class="printing-quiz-input" type="file" accept="image/*" ${this.config.enabled === false ? 'disabled' : ''}>
            <div id="photoFileStatus" class="printing-quiz-upload-status" style="color:${this.fileInfo ? '#0f9f6e' : '#6E6557'};">
              ${this.fileInfo ? `${this.escape(this.fileInfo.name)} - ${this.fileInfo.imageCount} image` : 'Choisissez une image JPG, PNG, WEBP ou GIF pour commencer.'}
            </div>
          </div>
        </label>
        <div class="printing-quiz-actions">
          <button type="button" class="printing-quiz-btn primary" data-next-step="2" ${!this.getStepValidity(1) || this.config.enabled === false ? 'disabled' : ''}>Continuer</button>
        </div>
      </section>
    `;
  }

  renderStepTwo() {
    const papers = this.getEnabledPapers();
    const dimensions = this.getEnabledDimensions(this.formState.paperLabel);
    return `
      <section class="printing-quiz-panel">
        <div class="printing-quiz-panel-head">
          <small>Etape 2</small>
          <h2>Choisissez vos options</h2>
          <p>Choisissez le type de papier, puis la dimension disponible pour ce papier, et enfin le nombre de tirages.</p>
        </div>
        <div class="printing-quiz-grid">
          <label class="printing-quiz-field">
            <span>Type de papier</span>
            <select id="photoPaper" class="printing-quiz-input" ${this.config.enabled === false ? 'disabled' : ''}>
              <option value="">Choisir un papier</option>
              ${papers.map((paper) => `<option value="${this.escape(paper.label)}">${this.escape(paper.label)}</option>`).join('')}
            </select>
          </label>
          <label class="printing-quiz-field">
            <span>Dimension</span>
            <select id="photoDimension" class="printing-quiz-input" ${this.config.enabled === false ? 'disabled' : ''} ${!this.formState.paperLabel ? 'disabled' : ''}>
              <option value="">Choisir une dimension</option>
              ${dimensions.map((dimension) => `<option value="${this.escape(dimension.label)}">${this.escape(dimension.label)} - ${this.formatPrice(dimension.price || 0)} / image</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="printing-quiz-field">
          <span>Nombre de tirages</span>
          <input id="photoCopies" class="printing-quiz-input" type="number" min="1" step="1" value="${this.formState.copies || 1}" ${this.config.enabled === false ? 'disabled' : ''}>
        </label>
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
          <h2>Votre tarif est pret</h2>
          <p>Le total se base sur le prix de la dimension choisie, votre image et le nombre de tirages.</p>
        </div>
        <div class="printing-quiz-summary">
          <div class="printing-quiz-summary-row"><span>Papier</span><strong>${this.escape(quote.paper?.label || '-')}</strong></div>
          <div class="printing-quiz-summary-row"><span>Dimension</span><strong>${this.escape(quote.dimension?.label || '-')}</strong></div>
          <div class="printing-quiz-summary-row"><span>Images</span><strong>${quote.imageCount}</strong></div>
          <div class="printing-quiz-summary-row"><span>Prix par image</span><strong>${this.formatPrice(quote.pricePerImage)}</strong></div>
          <div class="printing-quiz-summary-row"><span>Prix par tirage</span><strong id="photoQuoteUnit">${this.formatPrice(quote.printUnitPrice)}</strong></div>
          <div class="printing-quiz-summary-row"><span>Tirages</span><strong id="photoQuoteCopies">${quote.copies}</strong></div>
          <div class="printing-quiz-summary-row"><span>Total impression</span><strong id="photoPrintTotal">${this.formatPrice(quote.totalPrice)}</strong></div>
          <div class="printing-quiz-summary-row"><span>Frais reception</span><strong id="photoDeliveryFee">${this.formatPrice(this.deliveryController.getFee())}</strong></div>
          <div class="printing-quiz-summary-total"><span>Total a payer</span><strong id="photoQuoteTotal">${this.formatPrice(quote.totalPrice + this.deliveryController.getFee())}</strong></div>
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
        .printing-quiz-btn:disabled,.printing-quiz-step:disabled{opacity:.5;cursor:not-allowed}
        @media (max-width:860px){.printing-quiz-steps,.printing-quiz-grid{grid-template-columns:1fr}}
      </style>
      <section class="printing-quiz-shell">
        <header class="printing-quiz-topbar">
          <div class="printing-quiz-heading">
            <small>Impression photo</small>
            <h1>Commandez vos tirages photo a partir d une image</h1>
            <p>Choisissez votre image, puis le papier, la dimension et le nombre de tirages. Le prix final suit automatiquement vos choix.</p>
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
    const paperSelect = this.container.querySelector('#photoPaper');
    const dimensionSelect = this.container.querySelector('#photoDimension');
    const copiesInput = this.container.querySelector('#photoCopies');
    const fileStatus = this.container.querySelector('#photoFileStatus');
    if (paperSelect && this.formState.paperLabel) paperSelect.value = this.formState.paperLabel;
    if (dimensionSelect && this.formState.dimensionLabel) dimensionSelect.value = this.formState.dimensionLabel;
    if (copiesInput) copiesInput.value = String(this.formState.copies || 1);
    if (fileStatus && this.fileInfo) {
      fileStatus.textContent = `${this.fileInfo.name} - ${this.fileInfo.imageCount} image`;
      fileStatus.style.color = '#0f9f6e';
    }
  }

  attachEvents() {
    this.container.querySelectorAll('[data-go-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.goStep))));
    this.container.querySelectorAll('[data-next-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.nextStep))));
    this.container.querySelectorAll('[data-prev-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.prevStep))));
    this.container.querySelector('#photoImageFile')?.addEventListener('change', async (event) => {
      await this.handleImageSelection(event.target.files?.[0]);
    });
    this.container.querySelector('#photoPaper')?.addEventListener('change', () => {
      this.syncFormState();
      this.formState.dimensionLabel = '';
      this.ensureValidSelections();
      this.render();
      this.attachEvents();
      this.refreshQuote();
    });
    this.container.querySelector('#photoDimension')?.addEventListener('change', () => this.refreshQuote());
    this.container.querySelector('#photoCopies')?.addEventListener('input', () => this.refreshQuote());
    this.container.querySelector('#submitPhotoOrder')?.addEventListener('click', async () => {
      await this.handleSubmit();
    });
    this.container.querySelector('#openCartFromPhoto')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('openCart')));
    this.deliveryController.bind();
  }

  async handleImageSelection(file) {
    const statusEl = this.container.querySelector('#photoFileStatus');
    this.file = null;
    this.fileInfo = null;

    if (!file) {
      if (statusEl) {
        statusEl.textContent = 'Choisissez une image pour commencer.';
        statusEl.style.color = '#6E6557';
      }
      return;
    }

    try {
      if (statusEl) {
        statusEl.textContent = 'Preparation de l image...';
        statusEl.style.color = '#6E6557';
      }
      this.file = file;
      this.fileInfo = {
        name: file.name,
        imageCount: 1,
        type: file.type || 'image/*'
      };
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

  refreshQuote() {
    this.syncFormState();
    const quote = this.calculateQuote();
    const copiesEl = this.container.querySelector('#photoQuoteCopies');
    const unitEl = this.container.querySelector('#photoQuoteUnit');
    const totalEl = this.container.querySelector('#photoQuoteTotal');
    const printTotalEl = this.container.querySelector('#photoPrintTotal');
    const deliveryFeeEl = this.container.querySelector('#photoDeliveryFee');
    const nextButton = this.container.querySelector('[data-next-step="3"]');
    if (copiesEl) copiesEl.textContent = String(quote.copies);
    if (unitEl) unitEl.textContent = this.formatPrice(quote.printUnitPrice);
    if (printTotalEl) printTotalEl.textContent = this.formatPrice(quote.totalPrice);
    if (deliveryFeeEl) deliveryFeeEl.textContent = this.formatPrice(this.deliveryController.getFee());
    if (totalEl) totalEl.textContent = this.formatPrice(quote.totalPrice + this.deliveryController.getFee());
    if (nextButton) nextButton.disabled = !this.getStepValidity(2) || this.config.enabled === false;
  }

  async handleSubmit() {
    const statusEl = this.container.querySelector('#photoSubmitStatus');
    this.syncFormState();
    const paperLabel = this.formState.paperLabel || '';
    const dimensionLabel = this.formState.dimensionLabel || '';
    const quote = this.calculateQuote();

    if (!this.file || !this.fileInfo?.imageCount) {
      if (statusEl) statusEl.textContent = 'Ajoutez une image valide.';
      return;
    }
    if (!paperLabel || !dimensionLabel) {
      if (statusEl) statusEl.textContent = 'Choisissez une dimension et un papier.';
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
      if (statusEl) statusEl.textContent = 'Upload image et ajout au panier...';
      const uploaded = await uploadImageFile(this.file, 'printing-photo', { maxSizeMb: 20 });
      const deliveryPayload = this.deliveryController.getCartPayload();
      const deliveryFee = Number(deliveryPayload.fee || 0);
      const payableTotal = quote.totalPrice + deliveryFee;
      document.dispatchEvent(new CustomEvent('addToCart', {
        detail: {
          productId: 'printing-photo',
          name: `Impression photo ${dimensionLabel}`,
          price: payableTotal,
          quantity: 1,
          sku: `PHOTO-${Date.now()}`,
          image: PRODUCT_IMAGE,
          sourceType: 'printing',
          deliveryMode: deliveryPayload.method === 'pickup' ? 'Impression - point de retrait' : 'Impression - livraison a domicile',
          deliveryCoverage: { country: 'Haiti', mode: 'printing_prepaid', nationwide: true, nationwideFee: 0, zones: [] },
          productDeliveryCoverage: { country: 'Haiti', mode: 'printing_prepaid', nationwide: true, nationwideFee: 0, zones: [] },
          printingDelivery: deliveryPayload,
          selectedOptions: [
            { label: 'Type de papier', value: paperLabel },
            { label: 'Dimension', value: dimensionLabel },
            { label: 'Images', value: String(this.fileInfo.imageCount) },
            { label: 'Tirages', value: String(quote.copies) },
            { label: 'Prix / image', value: this.formatPrice(quote.pricePerImage) },
            { label: 'Prix par tirage', value: this.formatPrice(quote.printUnitPrice) },
            { label: 'Total impression', value: this.formatPrice(quote.totalPrice) },
            ...this.deliveryController.getSummaryLines(),
            { label: 'Total a payer', value: this.formatPrice(payableTotal) },
            { label: 'Fichier', value: this.file.name },
            { label: 'URL fichier', value: uploaded.url },
            { label: 'Chemin storage', value: uploaded.path }
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
