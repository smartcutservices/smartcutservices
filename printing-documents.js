import { db } from './firebase-init.js';
import { uploadPdfFile } from './firebase-storage.js';
import { getCartManager } from './cart.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const DEFAULT_CONFIG = {
  enabled: true,
  dimensions: [
    { label: '8.5x11', enabled: true, price: 0 },
    { label: '8.5x14', enabled: true, price: 0 },
    { label: '11x17', enabled: true, price: 0 },
    { label: '12x18', enabled: true, price: 0 }
  ],
  papers: [
    { label: 'Bond', enabled: true, price: 0 },
    { label: 'Glossy', enabled: true, price: 0 },
    { label: 'Bristol Glossy', enabled: true, price: 0 },
    { label: 'Autocollant', enabled: true, price: 0 }
  ],
  pricing: {
    basePrice: 0,
    perPagePrice: 0,
    perCopyPrice: 0
  },
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
  return {
    ...DEFAULT_CONFIG,
    ...data,
    dimensions: Array.isArray(data.dimensions) ? data.dimensions : DEFAULT_CONFIG.dimensions,
    papers: Array.isArray(data.papers) ? data.papers : DEFAULT_CONFIG.papers,
    pricing: {
      ...DEFAULT_CONFIG.pricing,
      ...(data.pricing || {})
    }
  };
}

class PrintingDocumentsPage {
  constructor(containerId = 'printing-documents-root') {
    this.container = document.getElementById(containerId);
    this.config = { ...DEFAULT_CONFIG };
    this.file = null;
    this.fileInfo = null;
    this.isBusy = false;
    this.currentStep = 1;
    this.formState = {
      dimensionLabel: '',
      paperLabel: '',
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
      this.config = snapshot.exists() ? mergeConfig(snapshot.data()) : { ...DEFAULT_CONFIG };
    } catch (error) {
      console.error('Erreur chargement config impression documents:', error);
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  getEnabledDimensions() {
    return (this.config.dimensions || []).filter((item) => item?.enabled !== false && item?.label);
  }

  getEnabledPapers() {
    return (this.config.papers || []).filter((item) => item?.enabled !== false && item?.label);
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
    return {
      pageCount: pdf.numPages || 0
    };
  }

  getCurrentSelections() {
    return {
      dimensionLabel: this.container.querySelector('#printingDimension')?.value || this.formState.dimensionLabel || '',
      paperLabel: this.container.querySelector('#printingPaper')?.value || this.formState.paperLabel || '',
      copies: Math.max(1, Number.parseInt(this.container.querySelector('#printingCopies')?.value || String(this.formState.copies || 1), 10) || 1)
    };
  }

  syncFormState() {
    const selections = this.getCurrentSelections();
    this.formState = {
      ...this.formState,
      ...selections,
      jobName: this.container.querySelector('#printingJobName')?.value || this.formState.jobName || '',
      notes: this.container.querySelector('#printingNotes')?.value || this.formState.notes || ''
    };
  }

  calculateQuote() {
    const { dimensionLabel, paperLabel, copies } = this.getCurrentSelections();
    const pageCount = this.fileInfo?.pageCount || 0;
    const dimension = this.getEnabledDimensions().find((item) => item.label === dimensionLabel);
    const paper = this.getEnabledPapers().find((item) => item.label === paperLabel);
    const pricing = this.config.pricing || {};
    const unitPrice =
      (Number(pricing.basePrice) || 0) +
      ((Number(pricing.perPagePrice) || 0) * pageCount) +
      (Number(pricing.perCopyPrice) || 0) +
      (Number(dimension?.price) || 0) +
      (Number(paper?.price) || 0);

    return {
      dimension,
      paper,
      copies,
      pageCount,
      unitPrice,
      totalPrice: unitPrice * copies
    };
  }

  getStepValidity(step = this.currentStep) {
    const { dimensionLabel, paperLabel, copies } = this.getCurrentSelections();
    if (step === 1) return Boolean(this.file && this.fileInfo?.pageCount);
    if (step === 2) return Boolean(dimensionLabel && paperLabel && copies >= 1);
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
          <h2>Chargez votre document</h2>
          <p>Ajoutez votre fichier PDF pour que nous puissions lire automatiquement le nombre de pages.</p>
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

  renderStepTwo(dimensions, papers) {
    return `
      <section class="printing-quiz-panel">
        <div class="printing-quiz-panel-head">
          <small>Etape 2</small>
          <h2>Choisissez vos options</h2>
          <p>Selectionnez le format, le papier et le nombre de copies qui correspondent a votre impression.</p>
        </div>
        <div class="printing-quiz-grid">
          <label class="printing-quiz-field">
            <span>Dimension</span>
            <select id="printingDimension" class="printing-quiz-input" ${this.config.enabled === false ? 'disabled' : ''}>
              <option value="">Choisir un format</option>
              ${dimensions.map((item) => `<option value="${this.escape(item.label)}">${this.escape(item.label)} · ${this.formatPrice(item.price || 0)}</option>`).join('')}
            </select>
          </label>
          <label class="printing-quiz-field">
            <span>Papier</span>
            <select id="printingPaper" class="printing-quiz-input" ${this.config.enabled === false ? 'disabled' : ''}>
              <option value="">Choisir un papier</option>
              ${papers.map((item) => `<option value="${this.escape(item.label)}">${this.escape(item.label)} · ${this.formatPrice(item.price || 0)}</option>`).join('')}
            </select>
          </label>
        </div>
        <div class="printing-quiz-grid">
          <label class="printing-quiz-field">
            <span>Nombre de copies</span>
            <input id="printingCopies" class="printing-quiz-input" type="number" min="1" step="1" value="1" ${this.config.enabled === false ? 'disabled' : ''}>
          </label>
          <label class="printing-quiz-field">
            <span>Nom de la commande</span>
            <input id="printingJobName" class="printing-quiz-input" type="text" placeholder="Ex: Contrat, dossier client..." ${this.config.enabled === false ? 'disabled' : ''}>
          </label>
        </div>
        <label class="printing-quiz-field">
          <span>Instruction supplementaire</span>
          <textarea id="printingNotes" class="printing-quiz-textarea" rows="4" placeholder="Ajoutez une note utile si necessaire." ${this.config.enabled === false ? 'disabled' : ''}></textarea>
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
          <p>Voici le recapitulatif de votre impression avant de l ajouter au panier.</p>
        </div>

        <div class="printing-quiz-summary">
          <div class="printing-quiz-summary-row"><span>Pages detectees</span><strong id="quotePageCount">${quote.pageCount || 0}</strong></div>
          <div class="printing-quiz-summary-row"><span>Dimension</span><strong>${this.escape(quote.dimension?.label || '-')}</strong></div>
          <div class="printing-quiz-summary-row"><span>Papier</span><strong>${this.escape(quote.paper?.label || '-')}</strong></div>
          <div class="printing-quiz-summary-row"><span>Prix unitaire</span><strong id="quoteUnitPrice">${this.formatPrice(quote.unitPrice)}</strong></div>
          <div class="printing-quiz-summary-row"><span>Copies</span><strong id="quoteCopies">${quote.copies}</strong></div>
          <div class="printing-quiz-summary-total"><span>Total</span><strong id="quoteTotalPrice">${this.formatPrice(quote.totalPrice)}</strong></div>
        </div>

        <div class="printing-quiz-note">
          ${this.config.notes ? this.escape(this.config.notes) : 'Votre tarif se calcule automatiquement selon votre document, votre papier et votre nombre de copies.'}
        </div>

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
    const dimensions = this.getEnabledDimensions();
    const papers = this.getEnabledPapers();
    const quote = this.calculateQuote();

    this.container.innerHTML = `
      <style>
        .printing-quiz-shell {
          width: 100%;
          max-width: 1100px;
          margin: 0 auto;
          padding: 1rem 1rem 3rem;
          display: grid;
          gap: 1rem;
        }
        .printing-quiz-topbar {
          display: grid;
          gap: 1rem;
        }
        .printing-quiz-heading {
          display: grid;
          gap: .5rem;
          padding: 1.4rem 1.45rem 0;
        }
        .printing-quiz-heading small {
          color: #9b7c38;
          text-transform: uppercase;
          letter-spacing: .16em;
          font-size: .75rem;
          font-weight: 800;
        }
        .printing-quiz-heading h1 {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(2.2rem, 5vw, 3.8rem);
          line-height: .92;
          color: #1F1E1C;
        }
        .printing-quiz-heading p {
          color: #6E6557;
          line-height: 1.8;
          max-width: 60ch;
        }
        .printing-quiz-steps {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: .85rem;
        }
        .printing-quiz-step {
          border: 1px solid rgba(31, 30, 28, 0.08);
          border-radius: 1.4rem;
          background: rgba(255, 255, 255, 0.92);
          box-shadow: 0 18px 36px rgba(31, 30, 28, 0.06);
          padding: .95rem 1rem;
          display: flex;
          gap: .8rem;
          align-items: center;
          text-align: left;
          cursor: pointer;
          transition: transform .2s ease, border-color .2s ease, box-shadow .2s ease;
        }
        .printing-quiz-step.is-active {
          border-color: rgba(198, 167, 94, 0.35);
          box-shadow: 0 20px 40px rgba(31, 30, 28, 0.08);
          background: linear-gradient(135deg, rgba(255,255,255,0.98), rgba(248,242,230,0.94));
        }
        .printing-quiz-step.is-done .printing-quiz-step-index {
          background: #0f9f6e;
          color: #fff;
        }
        .printing-quiz-step-index {
          width: 36px;
          height: 36px;
          min-width: 36px;
          border-radius: 999px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(198, 167, 94, 0.14);
          color: #9b7c38;
          font-weight: 800;
        }
        .printing-quiz-step-copy {
          display: grid;
          gap: .16rem;
        }
        .printing-quiz-step-copy strong {
          font-size: .86rem;
          color: #6E6557;
        }
        .printing-quiz-step-copy small {
          font-size: 1rem;
          color: #1F1E1C;
          font-weight: 800;
        }
        .printing-quiz-panel {
          border: 1px solid rgba(31, 30, 28, 0.08);
          border-radius: 1.9rem;
          background: rgba(255, 255, 255, 0.94);
          box-shadow: 0 24px 60px rgba(31, 30, 28, 0.08);
          padding: clamp(1.2rem, 3vw, 1.8rem);
          display: grid;
          gap: 1.1rem;
        }
        .printing-quiz-panel-head {
          display: grid;
          gap: .45rem;
        }
        .printing-quiz-panel-head small {
          color: #9b7c38;
          text-transform: uppercase;
          letter-spacing: .14em;
          font-size: .72rem;
          font-weight: 800;
        }
        .printing-quiz-panel-head h2 {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(2rem, 4vw, 2.9rem);
          line-height: .94;
          color: #1F1E1C;
        }
        .printing-quiz-panel-head p {
          color: #6E6557;
          line-height: 1.8;
          max-width: 58ch;
        }
        .printing-quiz-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1rem;
        }
        .printing-quiz-field {
          display: grid;
          gap: .5rem;
        }
        .printing-quiz-field span {
          font-size: .9rem;
          color: #6E6557;
          font-weight: 700;
        }
        .printing-quiz-input,
        .printing-quiz-textarea {
          width: 100%;
          border: 1px solid rgba(31, 30, 28, 0.12);
          border-radius: 1rem;
          padding: .95rem 1rem;
          background: #fff;
          font: inherit;
        }
        .printing-quiz-textarea {
          resize: vertical;
        }
        .printing-quiz-upload {
          border: 1px dashed rgba(198, 167, 94, 0.4);
          border-radius: 1.3rem;
          padding: 1rem;
          background: linear-gradient(180deg, rgba(248,242,230,0.7), rgba(255,255,255,0.96));
          display: grid;
          gap: .85rem;
        }
        .printing-quiz-upload-status,
        .printing-quiz-submit-status {
          font-size: .92rem;
          line-height: 1.7;
        }
        .printing-quiz-summary {
          display: grid;
          gap: .8rem;
          border: 1px solid rgba(31, 30, 28, 0.08);
          border-radius: 1.35rem;
          background: linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,242,230,0.9));
          padding: 1.1rem;
        }
        .printing-quiz-summary-row,
        .printing-quiz-summary-total {
          display: flex;
          justify-content: space-between;
          gap: 1rem;
          color: #6E6557;
        }
        .printing-quiz-summary-total {
          margin-top: .25rem;
          padding-top: .9rem;
          border-top: 1px solid rgba(31, 30, 28, 0.08);
          color: #1F1E1C;
          font-size: 1.2rem;
          font-weight: 800;
        }
        .printing-quiz-note {
          border-radius: 1.2rem;
          background: rgba(198, 167, 94, 0.08);
          border: 1px solid rgba(198, 167, 94, 0.16);
          color: #8A7450;
          padding: 1rem 1.1rem;
          line-height: 1.8;
        }
        .printing-quiz-actions {
          display: flex;
          flex-wrap: wrap;
          gap: .8rem;
          align-items: center;
        }
        .printing-quiz-btn {
          border: none;
          border-radius: 999px;
          padding: .96rem 1.25rem;
          font: inherit;
          font-weight: 800;
          cursor: pointer;
        }
        .printing-quiz-btn.primary {
          background: #1F1E1C;
          color: #F8F5EF;
          box-shadow: 0 14px 28px rgba(31, 30, 28, 0.18);
        }
        .printing-quiz-btn.secondary {
          background: #fff;
          color: #1F1E1C;
          border: 1px solid rgba(31, 30, 28, 0.12);
        }
        .printing-quiz-btn.ghost {
          background: transparent;
          color: #6E6557;
          border: 1px solid rgba(31, 30, 28, 0.1);
        }
        .printing-quiz-btn:disabled,
        .printing-quiz-step:disabled {
          opacity: .5;
          cursor: not-allowed;
        }
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
            <p>Suivez les etapes, faites vos choix et decouvrez votre tarif final avant d ajouter votre impression au panier.</p>
          </div>
          ${this.config.enabled === false ? `<div class="printing-quiz-note" style="background:rgba(185,28,28,0.08);border-color:rgba(185,28,28,0.12);color:#991b1b;">Le module documents est temporairement indisponible.</div>` : ''}
          <div class="printing-quiz-steps">
            ${this.renderStepChip(1, 'Votre PDF')}
            ${this.renderStepChip(2, 'Vos options')}
            ${this.renderStepChip(3, 'Votre tarif')}
          </div>
        </header>

        ${this.currentStep === 1 ? this.renderStepOne() : ''}
        ${this.currentStep === 2 ? this.renderStepTwo(dimensions, papers) : ''}
        ${this.currentStep === 3 ? this.renderStepThree(quote) : ''}
      </section>
    `;

    this.restoreFormState();
  }

  restoreFormState() {
    const current = this.formState;
    const dimensionSelect = this.container.querySelector('#printingDimension');
    const paperSelect = this.container.querySelector('#printingPaper');
    const copiesInput = this.container.querySelector('#printingCopies');
    const jobInput = this.container.querySelector('#printingJobName');
    const notesInput = this.container.querySelector('#printingNotes');
    const fileStatus = this.container.querySelector('#printingPdfStatus');

    if (dimensionSelect && current.dimensionLabel) dimensionSelect.value = current.dimensionLabel;
    if (paperSelect && current.paperLabel) paperSelect.value = current.paperLabel;
    if (copiesInput) copiesInput.value = String(current.copies || 1);
    if (jobInput) jobInput.value = current.jobName || '';
    if (notesInput) notesInput.value = current.notes || '';
    if (fileStatus && this.fileInfo) {
      fileStatus.textContent = `${this.fileInfo.name} · ${this.fileInfo.pageCount} page(s)`;
      fileStatus.style.color = '#0f9f6e';
    }
  }

  attachEvents() {
    const fileInput = this.container.querySelector('#printingPdfFile');
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

    fileInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      await this.handlePdfSelection(file);
    });

    this.container.querySelector('#printingDimension')?.addEventListener('change', refreshQuote);
    this.container.querySelector('#printingPaper')?.addEventListener('change', refreshQuote);
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
      if (this.getStepValidity(1)) {
        const nextButton = this.container.querySelector('[data-next-step="2"]');
        if (nextButton) nextButton.disabled = false;
      }
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
    if (unitPriceEl) unitPriceEl.textContent = this.formatPrice(quote.unitPrice);
    if (copiesEl) copiesEl.textContent = String(quote.copies);
    if (totalPriceEl) totalPriceEl.textContent = this.formatPrice(quote.totalPrice);
    if (nextToStepThree) nextToStepThree.disabled = !this.getStepValidity(2) || this.config.enabled === false;
  }

  async handleSubmit() {
    if (this.isBusy || this.config.enabled === false) return;

    const statusEl = this.container.querySelector('#printingSubmitStatus');
    this.syncFormState();
    const dimensionLabel = this.container.querySelector('#printingDimension')?.value || this.formState.dimensionLabel || '';
    const paperLabel = this.container.querySelector('#printingPaper')?.value || this.formState.paperLabel || '';
    const jobName = this.container.querySelector('#printingJobName')?.value?.trim() || this.formState.jobName?.trim() || '';
    const notes = this.container.querySelector('#printingNotes')?.value?.trim() || this.formState.notes?.trim() || '';
    const quote = this.calculateQuote();

    if (!this.file || !this.fileInfo?.pageCount) {
      if (statusEl) statusEl.textContent = 'Ajoutez un fichier PDF valide avant de continuer.';
      return;
    }
    if (!dimensionLabel || !paperLabel) {
      if (statusEl) statusEl.textContent = 'Choisissez une dimension et un papier.';
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

      const uploaded = await uploadPdfFile(this.file, 'printing-documents', {
        maxSizeMb: 20
      });

      const unitPrice = quote.unitPrice;
      const lineName = jobName
        ? `Impression PDF - ${jobName}`
        : `Impression PDF ${dimensionLabel}`;

      document.dispatchEvent(new CustomEvent('addToCart', {
        detail: {
          productId: 'printing-documents',
          name: lineName,
          price: unitPrice,
          quantity: quote.copies,
          sku: `POD-DOC-${Date.now()}`,
          image: PRODUCT_IMAGE,
          selectedOptions: [
            { label: 'Dimension', value: dimensionLabel },
            { label: 'Papier', value: paperLabel },
            { label: 'Pages', value: String(this.fileInfo.pageCount) },
            { label: 'Copies', value: String(quote.copies) },
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
