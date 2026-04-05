import { db } from './firebase-init.js';
import { uploadPdfFile } from './firebase-storage.js';
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

const DOCUMENT_DIMENSIONS = [
  { label: '8.5x11', enabled: true, price: 15 },
  { label: '8.5x14', enabled: true, price: 17 },
  { label: '11x17', enabled: true, price: 28 },
  { label: '13x19', enabled: true, price: 47 }
];

function buildPaper(label) {
  return {
    label,
    enabled: true,
    dimensions: DOCUMENT_DIMENSIONS.map((dimension) => ({ ...dimension }))
  };
}

const DEFAULT_CONFIG = {
  enabled: true,
  papers: [
    buildPaper('Bond'),
    buildPaper('Glossy'),
    buildPaper('Bristol Glossy'),
    buildPaper('Autocollant')
  ],
  notes: ''
};

const PRODUCT_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <rect width="240" height="240" rx="36" fill="#F2E9DA"/>
  <rect x="58" y="36" width="124" height="168" rx="18" fill="#FFFFFF" stroke="#C6A75E" stroke-width="8"/>
  <path d="M148 36v38c0 10 8 18 18 18h16" fill="#F6EFE2"/>
  <path d="M148 36l34 34" stroke="#C6A75E" stroke-width="8" stroke-linecap="round"/>
  <path d="M82 108h76M82 136h76M82 164h48" stroke="#1F1E1C" stroke-opacity=".75" stroke-width="8" stroke-linecap="round"/>
</svg>
`)}`;

function mergeConfig(data = {}) {
  return normalizePrintingConfig(DEFAULT_CONFIG, data);
}

class PrintingDocumentsPage {
  constructor(containerId = 'printing-documents-root') {
    this.container = document.getElementById(containerId);
    this.config = mergeConfig();
    this.file = null;
    this.fileInfo = null;
    this.isBusy = false;
    this.currentStep = 1;
    this.formState = {
      paperLabel: '',
      dimensionLabel: '',
      copies: 1,
      jobName: '',
      notes: ''
    };
    this.cart = getCartManager({ imageBasePath: './' });
    if (!this.container) return;
    this.init();
  }

  async init() {
    await this.loadConfig();
    this.render();
    this.attachEvents();
  }

  async loadConfig() {
    try {
      const snapshot = await getDoc(doc(db, 'printingSettings', 'documents'));
      this.config = snapshot.exists() ? mergeConfig(snapshot.data()) : mergeConfig();
    } catch (error) {
      console.error('Erreur chargement config impression documents:', error);
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

  getPdfLib() {
    const lib = window.pdfjsLib;
    if (!lib) {
      throw new Error('Le lecteur PDF n est pas disponible pour le moment.');
    }
    if (!lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    return lib;
  }

  async analyzePdf(file) {
    const pdfjsLib = this.getPdfLib();
    const bytes = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
    return { pageCount: pdf.numPages || 0 };
  }

  getCurrentSelections() {
    return {
      paperLabel: this.container.querySelector('#printingPaper')?.value || this.formState.paperLabel || '',
      dimensionLabel: this.container.querySelector('#printingDimension')?.value || this.formState.dimensionLabel || '',
      copies: Math.max(1, Number.parseInt(this.container.querySelector('#printingCopies')?.value || String(this.formState.copies || 1), 10) || 1)
    };
  }

  syncFormState() {
    this.formState = {
      ...this.formState,
      ...this.getCurrentSelections(),
      jobName: this.container.querySelector('#printingJobName')?.value || this.formState.jobName || '',
      notes: this.container.querySelector('#printingNotes')?.value || this.formState.notes || ''
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
    const pageCount = this.fileInfo?.pageCount || 0;
    const paper = findPaperByLabel(this.config.papers || [], paperLabel);
    const dimension = findDimensionByLabel(this.config.papers || [], paperLabel, dimensionLabel);
    const pricePerPage = Number(dimension?.price) || 0;
    const copyTotal = pricePerPage * pageCount;
    return {
      paper,
      dimension,
      copies,
      pageCount,
      pricePerPage,
      copyTotal,
      totalPrice: copyTotal * copies
    };
  }

  getStepValidity(step = this.currentStep) {
    const { paperLabel, dimensionLabel, copies } = this.getCurrentSelections();
    if (step === 1) return Boolean(this.file && this.fileInfo?.pageCount);
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
    const isActive = this.currentStep === step;
    const isDone = this.currentStep > step || (step < 3 && this.getStepValidity(step));
    return `
      <button type="button" class="printing-quiz-step ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}" data-go-step="${step}">
        <span class="printing-quiz-step-index">${isDone ? '<i class="fas fa-check"></i>' : step}</span>
        <span class="printing-quiz-step-copy">
          <strong>Etape ${step}</strong>
          <small>${title}</small>
        </span>
      </button>
    `;
  }

  renderStepOne() {
    return `
      <section class="printing-quiz-panel">
        <div class="printing-quiz-panel-head">
          <small>Etape 1</small>
          <h2>Chargez votre fichier PDF</h2>
          <p>Le site lira automatiquement le nombre de pages du PDF pour calculer votre tarif final.</p>
        </div>
        <label class="printing-quiz-field">
          <span>Fichier PDF</span>
          <div class="printing-quiz-upload">
            <input id="printingPdfFile" class="printing-quiz-input" type="file" accept="application/pdf" ${this.config.enabled === false ? 'disabled' : ''}>
            <div id="printingPdfStatus" class="printing-quiz-upload-status" style="color:${this.fileInfo ? '#0f9f6e' : '#6E6557'};">
              ${this.fileInfo ? `${this.escape(this.fileInfo.name)} · ${this.fileInfo.pageCount} page(s)` : 'Choisissez un fichier PDF pour commencer.'}
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
          <h2>Choisissez votre papier et votre dimension</h2>
          <p>Chaque type de papier propose sa propre liste de dimensions et son propre tarif par page.</p>
        </div>
        <div class="printing-quiz-grid">
          <label class="printing-quiz-field">
            <span>Type de papier</span>
            <select id="printingPaper" class="printing-quiz-input" ${this.config.enabled === false ? 'disabled' : ''}>
              <option value="">Choisir un papier</option>
              ${papers.map((paper) => `<option value="${this.escape(paper.label)}">${this.escape(paper.label)}</option>`).join('')}
            </select>
          </label>
          <label class="printing-quiz-field">
            <span>Dimension</span>
            <select id="printingDimension" class="printing-quiz-input" ${this.config.enabled === false ? 'disabled' : ''} ${!this.formState.paperLabel ? 'disabled' : ''}>
              <option value="">Choisir une dimension</option>
              ${dimensions.map((dimension) => `<option value="${this.escape(dimension.label)}">${this.escape(dimension.label)} · ${this.formatPrice(dimension.price || 0)} / page</option>`).join('')}
            </select>
          </label>
        </div>
        <label class="printing-quiz-field">
          <span>Nombre de copies</span>
          <input id="printingCopies" class="printing-quiz-input" type="number" min="1" step="1" value="${this.formState.copies || 1}" ${this.config.enabled === false ? 'disabled' : ''}>
        </label>
        <label class="printing-quiz-field">
          <span>Nom du travail</span>
          <input id="printingJobName" class="printing-quiz-input" type="text" value="${this.escape(this.formState.jobName || '')}" placeholder="Ex: Brochure, certificats, etc.">
        </label>
        <label class="printing-quiz-field">
          <span>Notes</span>
          <textarea id="printingNotes" class="printing-quiz-textarea" rows="4" placeholder="Instructions utiles pour l impression.">${this.escape(this.formState.notes || '')}</textarea>
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
          <p>Le total est calcule a partir du nombre de pages du PDF, de la dimension choisie et du nombre de copies.</p>
        </div>
        <div class="printing-quiz-summary">
          <div class="printing-quiz-summary-row"><span>Papier</span><strong>${this.escape(quote.paper?.label || '-')}</strong></div>
          <div class="printing-quiz-summary-row"><span>Dimension</span><strong>${this.escape(quote.dimension?.label || '-')}</strong></div>
          <div class="printing-quiz-summary-row"><span>Pages PDF</span><strong id="quotePageCount">${quote.pageCount}</strong></div>
          <div class="printing-quiz-summary-row"><span>Prix par page</span><strong>${this.formatPrice(quote.pricePerPage)}</strong></div>
          <div class="printing-quiz-summary-row"><span>Prix par copie</span><strong id="quoteUnitPrice">${this.formatPrice(quote.copyTotal)}</strong></div>
          <div class="printing-quiz-summary-row"><span>Copies</span><strong id="quoteCopies">${quote.copies}</strong></div>
          <div class="printing-quiz-summary-total"><span>Total</span><strong id="quoteTotalPrice">${this.formatPrice(quote.totalPrice)}</strong></div>
        </div>
        ${this.config.notes ? `<div class="printing-quiz-note">${this.escape(this.config.notes)}</div>` : ''}
        <div class="printing-quiz-actions">
          <button type="button" class="printing-quiz-btn ghost" data-prev-step="2">Modifier mes choix</button>
          <button type="button" class="printing-quiz-btn secondary" id="openCartFromPrinting">Ouvrir le panier</button>
          <button type="button" class="printing-quiz-btn primary" id="submitPrintingOrder" ${this.config.enabled === false ? 'disabled' : ''}>Ajouter au panier</button>
          <span id="printingSubmitStatus" class="printing-quiz-submit-status"></span>
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
        .printing-quiz-input,.printing-quiz-textarea{width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.95rem 1rem;background:#fff;font:inherit}
        .printing-quiz-textarea{resize:vertical}
        .printing-quiz-upload{border:1px dashed rgba(198,167,94,.4);border-radius:1.3rem;padding:1rem;background:linear-gradient(180deg,rgba(248,242,230,.7),rgba(255,255,255,.96));display:grid;gap:.85rem}
        .printing-quiz-summary{display:grid;gap:.8rem;border:1px solid rgba(31,30,28,.08);border-radius:1.35rem;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(248,242,230,.9));padding:1.1rem}
        .printing-quiz-summary-row,.printing-quiz-summary-total{display:flex;justify-content:space-between;gap:1rem;color:#6E6557}
        .printing-quiz-summary-total{margin-top:.25rem;padding-top:.9rem;border-top:1px solid rgba(31,30,28,.08);color:#1F1E1C;font-size:1.2rem;font-weight:800}
        .printing-quiz-note{border-radius:1.2rem;background:rgba(198,167,94,.08);border:1px solid rgba(198,167,94,.16);color:#8A7450;padding:1rem 1.1rem;line-height:1.8}
        .printing-quiz-actions{display:flex;flex-wrap:wrap;gap:.8rem;align-items:center}
        .printing-quiz-btn{border:none;border-radius:999px;padding:.96rem 1.25rem;font:inherit;font-weight:800;cursor:pointer}
        .printing-quiz-btn.primary{background:#1F1E1C;color:#F8F5EF;box-shadow:0 14px 28px rgba(31,30,28,.18)}
        .printing-quiz-btn.secondary{background:#fff;color:#1F1E1C;border:1px solid rgba(31,30,28,.12)}
        .printing-quiz-btn.ghost{background:transparent;color:#6E6557;border:1px solid rgba(31,30,28,.1)}
        .printing-quiz-btn:disabled,.printing-quiz-step:disabled{opacity:.5;cursor:not-allowed}
        @media (max-width: 860px) {
          .printing-quiz-steps,
          .printing-quiz-grid {
            grid-template-columns: 1fr;
          }
        }
      </style>

      <section class="printing-quiz-shell">
        <header class="printing-quiz-topbar">
          <div class="printing-quiz-heading">
            <small>Print on demand</small>
            <h1>Impression documents PDF</h1>
            <p>Choisissez d abord le type de papier, puis la dimension disponible pour ce papier. Le prix se calcule automatiquement sur le nombre de pages du PDF.</p>
          </div>
          ${this.config.enabled === false ? `<div class="printing-quiz-note" style="background:rgba(185,28,28,0.08);border-color:rgba(185,28,28,0.12);color:#991b1b;">Le module documents est temporairement indisponible.</div>` : ''}
          <div class="printing-quiz-steps">
            ${this.renderStepChip(1, 'Votre PDF')}
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
    const current = this.formState;
    const paperSelect = this.container.querySelector('#printingPaper');
    const dimensionSelect = this.container.querySelector('#printingDimension');
    const copiesInput = this.container.querySelector('#printingCopies');
    const jobInput = this.container.querySelector('#printingJobName');
    const notesInput = this.container.querySelector('#printingNotes');
    const fileStatus = this.container.querySelector('#printingPdfStatus');

    if (paperSelect && current.paperLabel) paperSelect.value = current.paperLabel;
    if (dimensionSelect && current.dimensionLabel) dimensionSelect.value = current.dimensionLabel;
    if (copiesInput) copiesInput.value = String(current.copies || 1);
    if (jobInput) jobInput.value = current.jobName || '';
    if (notesInput) notesInput.value = current.notes || '';
    if (fileStatus && this.fileInfo) {
      fileStatus.textContent = `${this.fileInfo.name} · ${this.fileInfo.pageCount} page(s)`;
      fileStatus.style.color = '#0f9f6e';
    }
  }

  attachEvents() {
    const refreshQuote = () => {
      this.syncFormState();
      this.refreshQuote();
    };

    this.container.querySelectorAll('[data-go-step]').forEach((button) => {
      button.addEventListener('click', () => this.goToStep(Number(button.dataset.goStep)));
    });
    this.container.querySelectorAll('[data-next-step]').forEach((button) => {
      button.addEventListener('click', () => this.goToStep(Number(button.dataset.nextStep)));
    });
    this.container.querySelectorAll('[data-prev-step]').forEach((button) => {
      button.addEventListener('click', () => this.goToStep(Number(button.dataset.prevStep)));
    });

    this.container.querySelector('#printingPdfFile')?.addEventListener('change', async (event) => {
      await this.handlePdfSelection(event.target.files?.[0]);
    });

    this.container.querySelector('#printingPaper')?.addEventListener('change', () => {
      this.syncFormState();
      this.formState.dimensionLabel = '';
      this.ensureValidSelections();
      this.render();
      this.attachEvents();
      this.refreshQuote();
    });
    this.container.querySelector('#printingDimension')?.addEventListener('change', refreshQuote);
    this.container.querySelector('#printingCopies')?.addEventListener('input', refreshQuote);
    this.container.querySelector('#printingJobName')?.addEventListener('input', (event) => {
      this.formState.jobName = event.target.value;
    });
    this.container.querySelector('#printingNotes')?.addEventListener('input', (event) => {
      this.formState.notes = event.target.value;
    });
    this.container.querySelector('#submitPrintingOrder')?.addEventListener('click', async () => {
      await this.handleSubmit();
    });
    this.container.querySelector('#openCartFromPrinting')?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('openCart'));
    });
  }

  async handlePdfSelection(file) {
    const statusEl = this.container.querySelector('#printingPdfStatus');
    this.file = null;
    this.fileInfo = null;

    if (!file) {
      if (statusEl) {
        statusEl.textContent = 'Choisissez un fichier PDF pour commencer.';
        statusEl.style.color = '#6E6557';
      }
      this.refreshQuote();
      return;
    }

    try {
      if (statusEl) {
        statusEl.textContent = 'Analyse du PDF en cours...';
        statusEl.style.color = '#6E6557';
      }
      const analysis = await this.analyzePdf(file);
      this.file = file;
      this.fileInfo = {
        name: file.name,
        size: file.size,
        pageCount: analysis.pageCount
      };
      if (statusEl) {
        statusEl.textContent = `${file.name} · ${analysis.pageCount} page(s) detectee(s)`;
        statusEl.style.color = '#0f9f6e';
      }
      this.refreshQuote();
    } catch (error) {
      console.error('Erreur analyse PDF:', error);
      if (statusEl) {
        statusEl.textContent = error.message || 'Impossible de lire ce PDF.';
        statusEl.style.color = '#b91c1c';
      }
    }
  }

  refreshQuote() {
    this.syncFormState();
    const quote = this.calculateQuote();
    const pageCountEl = this.container.querySelector('#quotePageCount');
    const unitPriceEl = this.container.querySelector('#quoteUnitPrice');
    const copiesEl = this.container.querySelector('#quoteCopies');
    const totalPriceEl = this.container.querySelector('#quoteTotalPrice');
    const nextToStepThree = this.container.querySelector('[data-next-step="3"]');

    if (pageCountEl) pageCountEl.textContent = String(quote.pageCount || 0);
    if (unitPriceEl) unitPriceEl.textContent = this.formatPrice(quote.copyTotal);
    if (copiesEl) copiesEl.textContent = String(quote.copies);
    if (totalPriceEl) totalPriceEl.textContent = this.formatPrice(quote.totalPrice);
    if (nextToStepThree) nextToStepThree.disabled = !this.getStepValidity(2) || this.config.enabled === false;
  }

  async handleSubmit() {
    if (this.isBusy || this.config.enabled === false) return;

    const statusEl = this.container.querySelector('#printingSubmitStatus');
    this.syncFormState();
    const paperLabel = this.formState.paperLabel || '';
    const dimensionLabel = this.formState.dimensionLabel || '';
    const jobName = this.formState.jobName?.trim() || '';
    const notes = this.formState.notes?.trim() || '';
    const quote = this.calculateQuote();

    if (!this.file || !this.fileInfo?.pageCount) {
      if (statusEl) statusEl.textContent = 'Ajoutez un fichier PDF valide avant de continuer.';
      return;
    }
    if (!paperLabel || !dimensionLabel) {
      if (statusEl) statusEl.textContent = 'Choisissez un type de papier et une dimension.';
      return;
    }
    if (quote.copies < 1) {
      if (statusEl) statusEl.textContent = 'Le nombre de copies doit etre superieur a zero.';
      return;
    }

    try {
      this.isBusy = true;
      if (statusEl) {
        statusEl.textContent = 'Upload du PDF et ajout au panier...';
        statusEl.style.color = '#6E6557';
      }

      const uploaded = await uploadPdfFile(this.file, 'printing-documents', { maxSizeMb: 20 });
      const lineName = jobName ? `Impression PDF - ${jobName}` : `Impression PDF ${dimensionLabel}`;

      document.dispatchEvent(new CustomEvent('addToCart', {
        detail: {
          productId: 'printing-documents',
          name: lineName,
          price: quote.totalPrice,
          quantity: 1,
          sku: `POD-DOC-${Date.now()}`,
          image: PRODUCT_IMAGE,
          selectedOptions: [
            { label: 'Type de papier', value: paperLabel },
            { label: 'Dimension', value: dimensionLabel },
            { label: 'Pages', value: String(this.fileInfo.pageCount) },
            { label: 'Copies', value: String(quote.copies) },
            { label: 'Prix / page', value: this.formatPrice(quote.pricePerPage) },
            { label: 'Prix par copie', value: this.formatPrice(quote.copyTotal) },
            { label: 'Total impression', value: this.formatPrice(quote.totalPrice) },
            { label: 'Fichier', value: this.file.name },
            { label: 'URL fichier', value: uploaded.url },
            { label: 'Chemin storage', value: uploaded.path },
            ...(notes ? [{ label: 'Notes', value: notes }] : [])
          ]
        }
      }));

      if (statusEl) {
        statusEl.textContent = 'Votre document a ete ajoute au panier.';
        statusEl.style.color = '#0f9f6e';
      }

      document.dispatchEvent(new CustomEvent('openCart'));
    } catch (error) {
      console.error('Erreur ajout impression documents:', error);
      if (statusEl) {
        statusEl.textContent = error.message || 'Impossible d ajouter ce document au panier.';
        statusEl.style.color = '#b91c1c';
      }
    } finally {
      this.isBusy = false;
    }
  }
}

export default PrintingDocumentsPage;
