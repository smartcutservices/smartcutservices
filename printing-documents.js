import { db } from './firebase-init.js';
import { uploadPdfFile } from './firebase-storage.js';
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
  <rect x="58" y="36" width="124" height="168" rx="18" fill="#FFFFFF" stroke="#FFA41C" stroke-width="8"/>
  <path d="M148 36v38c0 10 8 18 18 18h16" fill="#F6EFE2"/>
  <path d="M148 36l34 34" stroke="#FFA41C" stroke-width="8" stroke-linecap="round"/>
  <path d="M82 108h76M82 136h76M82 164h48" stroke="#0F1111" stroke-opacity=".75" stroke-width="8" stroke-linecap="round"/>
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
    this.deliveryController = new PrintingDeliveryController({
      getContainer: () => this.container,
      escape: (value) => this.escape(value),
      formatPrice: (value) => this.formatPrice(value),
      moduleId: 'documents',
      metricLabel: 'pages imprimees',
      getMetricValue: () => {
        const quote = this.calculateQuote();
        return Number(quote.pageCount || 0) * Number(quote.copies || 1);
      },
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

  getPdfLib() {
    const lib = window.pdfjsLib;
    if (!lib) {
      throw new Error("Le lecteur PDF n'est pas disponible pour le moment.");
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
      <button type="button" class="pdoc-step ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}" data-go-step="${step}">
        <span class="pdoc-step-dot">${isDone ? '<i class="fas fa-check"></i>' : step}</span>
        <span class="pdoc-step-label">${title}</span>
      </button>
      ${step < 3 ? '<span class="pdoc-step-line"></span>' : ''}
    `;
  }

  renderStepOne() {
    return `
      <section class="pdoc-panel">
        <h2>Chargez votre PDF</h2>
        <p class="pdoc-hint">Le nombre de pages est détecté automatiquement pour calculer votre tarif.</p>
        <label class="pdoc-field">
          <span>Fichier PDF</span>
          <div class="pdoc-upload">
            <input id="printingPdfFile" class="pdoc-input" type="file" accept="application/pdf" ${this.config.enabled === false ? 'disabled' : ''}>
            <div id="printingPdfStatus" class="pdoc-upload-status" style="color:${this.fileInfo ? '#0f9f6e' : 'var(--sc-muted)'};">
              ${this.fileInfo ? `${this.escape(this.fileInfo.name)} · ${this.fileInfo.pageCount} page(s)` : 'Choisissez un fichier PDF pour commencer.'}
            </div>
          </div>
        </label>
        <div class="pdoc-actions">
          <button type="button" class="pdoc-btn primary" data-next-step="2" ${!this.getStepValidity(1) || this.config.enabled === false ? 'disabled' : ''}>Continuer</button>
        </div>
      </section>
    `;
  }

  renderStepTwo() {
    const papers = this.getEnabledPapers();
    const dimensions = this.getEnabledDimensions(this.formState.paperLabel);
    return `
      <section class="pdoc-panel">
        <h2>Papier et dimension</h2>
        <p class="pdoc-hint">Chaque type de papier propose sa propre liste de dimensions et son propre tarif par page.</p>
        <div class="pdoc-grid2">
          <label class="pdoc-field">
            <span>Type de papier</span>
            <select id="printingPaper" class="pdoc-input" ${this.config.enabled === false ? 'disabled' : ''}>
              <option value="">Choisir un papier</option>
              ${papers.map((paper) => `<option value="${this.escape(paper.label)}">${this.escape(paper.label)}</option>`).join('')}
            </select>
          </label>
          <label class="pdoc-field">
            <span>Dimension</span>
            <select id="printingDimension" class="pdoc-input" ${this.config.enabled === false ? 'disabled' : ''} ${!this.formState.paperLabel ? 'disabled' : ''}>
              <option value="">Choisir une dimension</option>
              ${dimensions.map((dimension) => `<option value="${this.escape(dimension.label)}">${this.escape(dimension.label)} · ${this.formatPrice(dimension.price || 0)} / page</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="pdoc-grid2">
          <label class="pdoc-field">
            <span>Nombre de copies</span>
            <input id="printingCopies" class="pdoc-input" type="number" min="1" step="1" value="${this.formState.copies || 1}" ${this.config.enabled === false ? 'disabled' : ''}>
          </label>
          <label class="pdoc-field">
            <span>Nom du travail (optionnel)</span>
            <input id="printingJobName" class="pdoc-input" type="text" value="${this.escape(this.formState.jobName || '')}" placeholder="Ex: Brochure, certificats...">
          </label>
        </div>
        <label class="pdoc-field">
          <span>Notes (optionnel)</span>
          <textarea id="printingNotes" class="pdoc-textarea" rows="3" placeholder="Instructions utiles pour l impression.">${this.escape(this.formState.notes || '')}</textarea>
        </label>
        <div class="pdoc-actions">
          <button type="button" class="pdoc-btn ghost" data-prev-step="1">Retour</button>
          <button type="button" class="pdoc-btn primary" data-next-step="3" ${!this.getStepValidity(2) || this.config.enabled === false ? 'disabled' : ''}>Voir mon tarif</button>
        </div>
      </section>
    `;
  }

  renderStepThree(quote) {
    return `
      <section class="pdoc-panel">
        <h2>Votre tarif</h2>
        <div class="pdoc-summary">
          <div class="pdoc-summary-row"><span>Papier</span><strong>${this.escape(quote.paper?.label || '-')}</strong></div>
          <div class="pdoc-summary-row"><span>Dimension</span><strong>${this.escape(quote.dimension?.label || '-')}</strong></div>
          <div class="pdoc-summary-row"><span>Pages PDF</span><strong id="quotePageCount">${quote.pageCount}</strong></div>
          <div class="pdoc-summary-row"><span>Pages imprimées</span><strong id="quotePrintedPages">${quote.pageCount * quote.copies}</strong></div>
          <div class="pdoc-summary-row"><span>Prix par page</span><strong>${this.formatPrice(quote.pricePerPage)}</strong></div>
          <div class="pdoc-summary-row"><span>Prix par copie</span><strong id="quoteUnitPrice">${this.formatPrice(quote.copyTotal)}</strong></div>
          <div class="pdoc-summary-row"><span>Copies</span><strong id="quoteCopies">${quote.copies}</strong></div>
          <div class="pdoc-summary-row"><span>Total impression</span><strong id="quotePrintTotal">${this.formatPrice(quote.totalPrice)}</strong></div>
          <div class="pdoc-summary-row"><span>Frais réception</span><strong id="quoteDeliveryFee">${this.formatPrice(this.deliveryController.getFee())}</strong></div>
          <div class="pdoc-summary-total"><span>Total à payer</span><strong id="quoteTotalPrice">${this.formatPrice(quote.totalPrice + this.deliveryController.getFee())}</strong></div>
        </div>
        ${this.deliveryController.renderSection()}
        ${this.config.notes ? `<div class="pdoc-note">${this.escape(this.config.notes)}</div>` : ''}
        <div class="pdoc-actions">
          <button type="button" class="pdoc-btn ghost" data-prev-step="2">Modifier</button>
          <button type="button" class="pdoc-btn secondary" id="openCartFromPrinting">Ouvrir le panier</button>
          <button type="button" class="pdoc-btn primary" id="submitPrintingOrder" ${this.config.enabled === false ? 'disabled' : ''}>Ajouter au panier</button>
          <span id="printingSubmitStatus" class="pdoc-submit-status"></span>
        </div>
      </section>
    `;
  }

  render() {
    const quote = this.calculateQuote();

    this.container.innerHTML = `
      <style>
        .pdoc-shell{width:100%;max-width:900px;margin:0 auto;padding:0 1rem 3rem;display:grid;gap:1.35rem}
        .pdoc-hero{background:var(--sc-navy);color:#fff;border-radius:var(--sc-radius);padding:1.75rem 1.85rem;display:flex;align-items:center;gap:1.1rem}
        .pdoc-hero-icon{width:50px;height:50px;min-width:50px;border-radius:13px;background:rgba(0,113,133,.35);display:flex;align-items:center;justify-content:center;font-size:1.25rem;color:#7fd4e3}
        .pdoc-hero h1{font-size:clamp(1.35rem,2.6vw,1.7rem);font-weight:800;margin-bottom:.3rem;letter-spacing:-.01em}
        .pdoc-hero p{color:rgba(255,255,255,.72);font-size:.88rem;line-height:1.5;max-width:56ch}
        .pdoc-error-banner{border-radius:var(--sc-radius-sm);background:#fdecea;border:1px solid #f3c6c2;color:#991b1b;padding:.85rem 1rem;font-size:.88rem}

        .pdoc-stepper{display:flex;align-items:center;padding:0 .2rem}
        .pdoc-step{display:flex;align-items:center;gap:.55rem;background:none;border:none;cursor:pointer;padding:.35rem 0}
        .pdoc-step-dot{width:26px;height:26px;min-width:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.74rem;font-weight:800;background:var(--sc-canvas);color:var(--sc-muted);border:1px solid var(--sc-line)}
        .pdoc-step.is-active .pdoc-step-dot{background:#007185;color:#fff;border-color:#007185}
        .pdoc-step.is-done .pdoc-step-dot{background:#0f9f6e;color:#fff;border-color:#0f9f6e}
        .pdoc-step-label{font-size:.8rem;font-weight:700;color:var(--sc-muted)}
        .pdoc-step.is-active .pdoc-step-label{color:var(--sc-ink)}
        .pdoc-step-line{flex:1;height:1px;background:var(--sc-line);margin:0 .6rem}

        .pdoc-panel{background:var(--sc-surface);border:1px solid var(--sc-line);border-radius:var(--sc-radius);padding:1.5rem;display:grid;gap:1rem}
        .pdoc-panel h2{font-size:1.15rem;font-weight:800;color:var(--sc-ink)}
        .pdoc-hint{color:var(--sc-muted);font-size:.85rem;margin-top:-.55rem;line-height:1.5}

        .pdoc-field{display:grid;gap:.4rem}
        .pdoc-field span{font-size:.8rem;font-weight:700;color:var(--sc-muted)}
        .pdoc-input,.pdoc-textarea{width:100%;border:1px solid var(--sc-line);border-radius:var(--sc-radius-sm);padding:.7rem .8rem;font:inherit;font-size:.92rem;background:#fff;color:var(--sc-ink)}
        .pdoc-input:focus,.pdoc-textarea:focus{outline:none;border-color:#007185;box-shadow:0 0 0 3px rgba(0,113,133,.14)}
        .pdoc-textarea{resize:vertical}
        .pdoc-grid2{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}

        .pdoc-upload{border:1.5px dashed #a9d4dc;border-radius:var(--sc-radius-sm);padding:1.1rem;background:#f2fafb;display:grid;gap:.7rem}
        .pdoc-upload-status{font-size:.84rem}

        .pdoc-summary{display:grid;gap:0;border:1px solid var(--sc-line);border-radius:var(--sc-radius-sm);overflow:hidden}
        .pdoc-summary-row{display:flex;justify-content:space-between;gap:1rem;color:var(--sc-muted);font-size:.86rem;padding:.55rem .85rem;border-bottom:1px solid var(--sc-line);background:#fff}
        .pdoc-summary-row strong{color:var(--sc-ink)}
        .pdoc-summary-total{display:flex;justify-content:space-between;font-size:1.1rem;font-weight:800;color:var(--sc-ink);padding:.75rem .85rem;background:var(--sc-canvas)}
        .pdoc-note{border-radius:var(--sc-radius-sm);background:#f2fafb;border:1px solid #cfe8ec;color:#0a5a68;padding:.85rem .95rem;font-size:.86rem;line-height:1.6}

        .pdoc-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center}
        .pdoc-btn{border:none;border-radius:var(--sc-radius-sm);padding:.72rem 1.05rem;font:inherit;font-weight:700;font-size:.88rem;cursor:pointer}
        .pdoc-btn.primary{background:var(--sc-orange);color:#0f1111;border:1px solid var(--sc-orange-border)}
        .pdoc-btn.primary:hover:not(:disabled){background:var(--sc-orange-border)}
        .pdoc-btn.secondary{background:#fff;color:var(--sc-ink);border:1px solid var(--sc-line)}
        .pdoc-btn.ghost{background:transparent;color:var(--sc-muted);border:1px solid var(--sc-line)}
        .pdoc-btn:disabled{opacity:.5;cursor:not-allowed}
        .pdoc-submit-status{font-size:.84rem;color:var(--sc-muted)}
        @media (max-width: 640px) {
          .pdoc-hero{flex-direction:column;text-align:center;padding:1.5rem}
          .pdoc-grid2{grid-template-columns:1fr}
          .pdoc-step-label{display:none}
        }
      </style>

      <section class="pdoc-shell">
        <header class="pdoc-hero">
          <div class="pdoc-hero-icon"><i class="fas fa-file-pdf"></i></div>
          <div>
            <h1>Impression de documents PDF</h1>
            <p>Envoyez votre PDF, choisissez papier et dimension : le tarif se calcule automatiquement selon le nombre de pages.</p>
          </div>
        </header>
        ${this.config.enabled === false ? `<div class="pdoc-error-banner">Le module documents est temporairement indisponible.</div>` : ''}
        <nav class="pdoc-stepper">
          ${this.renderStepChip(1, 'Votre PDF')}
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
    this.deliveryController.bind();
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
      this.render();
      this.attachEvents();
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
    const printTotalEl = this.container.querySelector('#quotePrintTotal');
    const deliveryFeeEl = this.container.querySelector('#quoteDeliveryFee');
    const printedPagesEl = this.container.querySelector('#quotePrintedPages');
    const nextToStepThree = this.container.querySelector('[data-next-step="3"]');

    if (pageCountEl) pageCountEl.textContent = String(quote.pageCount || 0);
    if (unitPriceEl) unitPriceEl.textContent = this.formatPrice(quote.copyTotal);
    if (copiesEl) copiesEl.textContent = String(quote.copies);
    if (printedPagesEl) printedPagesEl.textContent = String((quote.pageCount || 0) * (quote.copies || 1));
    if (printTotalEl) printTotalEl.textContent = this.formatPrice(quote.totalPrice);
    if (deliveryFeeEl) deliveryFeeEl.textContent = this.formatPrice(this.deliveryController.getFee());
    if (totalPriceEl) totalPriceEl.textContent = this.formatPrice(quote.totalPrice + this.deliveryController.getFee());
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
    if (!this.deliveryController.isValid()) {
      if (statusEl) {
        statusEl.textContent = 'Choisissez un point de retrait ou une zone de livraison disponible.';
        statusEl.style.color = '#b91c1c';
      }
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
      const deliveryPayload = this.deliveryController.getCartPayload();
      const deliveryFee = Number(deliveryPayload.fee || 0);
      const payableTotal = quote.totalPrice + deliveryFee;

      document.dispatchEvent(new CustomEvent('addToCart', {
        detail: {
          productId: 'printing-documents',
          name: lineName,
          price: payableTotal,
          quantity: 1,
          sku: `POD-DOC-${Date.now()}`,
          image: PRODUCT_IMAGE,
          sourceType: 'printing',
          deliveryMode: deliveryPayload.method === 'pickup' ? 'Impression - point de retrait' : 'Impression - livraison a domicile',
          deliveryCoverage: { country: 'Haiti', mode: 'printing_prepaid', nationwide: true, nationwideFee: 0, zones: [] },
          productDeliveryCoverage: { country: 'Haiti', mode: 'printing_prepaid', nationwide: true, nationwideFee: 0, zones: [] },
          printingDelivery: deliveryPayload,
          selectedOptions: [
            { label: 'Type de papier', value: paperLabel },
            { label: 'Dimension', value: dimensionLabel },
            { label: 'Pages', value: String(this.fileInfo.pageCount) },
            { label: 'Copies', value: String(quote.copies) },
            { label: 'Prix / page', value: this.formatPrice(quote.pricePerPage) },
            { label: 'Prix par copie', value: this.formatPrice(quote.copyTotal) },
            { label: 'Total impression', value: this.formatPrice(quote.totalPrice) },
            ...this.deliveryController.getSummaryLines(),
            { label: 'Total à payer', value: this.formatPrice(payableTotal) },
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
