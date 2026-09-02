import { db } from './firebase-init.js';
import { uploadPdfFile } from './firebase-storage.js';
import { getCartManager } from './cart.js?v=20260901-1';
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
import { PrintingDeliveryController } from './printing-delivery-utils.js?v=20260901-1';
import { formatPriceDual, loadCurrencySettings } from './currency-utils.js';

const CAD_DIMENSIONS = [
  { label: '8.5x11', enabled: true, price: 15 },
  { label: '8.5x14', enabled: true, price: 17 },
  { label: '11x17', enabled: true, price: 28 },
  { label: '13x19', enabled: true, price: 47 },
  { label: '24x36', enabled: true, price: 110 },
  { label: '24x24', enabled: true, price: 89 }
];

function buildPaper(label) {
  return {
    label,
    enabled: true,
    dimensions: CAD_DIMENSIONS.map((dimension) => ({ ...dimension }))
  };
}

const DEFAULT_CONFIG = {
  enabled: true,
  papers: [buildPaper('Bond')],
  notes: ''
};

const PRODUCT_IMAGE = 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22240%22 height=%22240%22 viewBox=%220 0 240 240%22%3E%3Crect width=%22240%22 height=%22240%22 rx=%2236%22 fill=%22%23F2E9DA%22/%3E%3Cpath d=%22M48 180h144M70 148l32-40 22 26 40-48 22 28%22 stroke=%22%231F1E1C%22 stroke-width=%228%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 fill=%22none%22/%3E%3C/svg%3E';

function mergeConfig(data = {}) {
  return normalizePrintingConfig(DEFAULT_CONFIG, data);
}

class PrintingCadPage {
  constructor(containerId = 'printing-cad-root') {
    this.container = document.getElementById(containerId);
    this.config = mergeConfig();
    this.file = null;
    this.fileInfo = null;
    this.currentStep = 1;
    this.formState = { paperLabel: '', dimensionLabel: '', copies: 1 };
    this.cart = getCartManager({ imageBasePath: './' });
    this.deliveryController = new PrintingDeliveryController({
      getContainer: () => this.container,
      escape: (value) => this.escape(value),
      formatPrice: (value) => this.formatPrice(value),
      moduleId: 'cad',
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
      const snapshot = await getDoc(doc(db, 'printingSettings', 'cad'));
      this.config = snapshot.exists() ? mergeConfig(snapshot.data()) : mergeConfig();
    } catch (error) {
      console.error('Erreur chargement config CAD:', error);
      this.config = mergeConfig();
    }
  }

  getPdfLib() {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error("Le lecteur PDF n'est pas disponible.");
    if (!lib.GlobalWorkerOptions.workerSrc) {
      lib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    return lib;
  }

  async analyzePdf(file) {
    const lib = this.getPdfLib();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const firstPage = await pdf.getPage(1);
    const viewport = firstPage.getViewport({ scale: 1 });
    const widthInches = viewport.width / 72;
    const heightInches = viewport.height / 72;
    return {
      pageCount: pdf.numPages || 0,
      suggestedDimension: this.findClosestDimension(widthInches, heightInches)
    };
  }

  findClosestDimension(widthInches, heightInches) {
    const targetA = Math.min(widthInches, heightInches);
    const targetB = Math.max(widthInches, heightInches);
    let best = '';
    let bestDelta = Infinity;

    this.getEnabledPapers().forEach((paper) => {
      this.getEnabledDimensions(paper.label).forEach((item) => {
        const [a, b] = String(item.label).split('x').map((value) => Number.parseFloat(value));
        if (!Number.isFinite(a) || !Number.isFinite(b)) return;
        const low = Math.min(a, b);
        const high = Math.max(a, b);
        const delta = Math.abs(targetA - low) + Math.abs(targetB - high);
        if (delta < bestDelta) {
          bestDelta = delta;
          best = item.label;
        }
      });
    });

    return best;
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
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  getCurrentSelections() {
    return {
      paperLabel: this.container.querySelector('#cadPaper')?.value || this.formState.paperLabel || '',
      dimensionLabel: this.container.querySelector('#cadDimension')?.value || this.formState.dimensionLabel || '',
      copies: Math.max(1, Number.parseInt(this.container.querySelector('#cadCopies')?.value || String(this.formState.copies || 1), 10) || 1)
    };
  }

  syncFormState() {
    this.formState = { ...this.formState, ...this.getCurrentSelections() };
  }

  ensureValidSelections() {
    this.formState.paperLabel = ensureValidPaperSelection(this.config.papers || [], this.formState.paperLabel);
    this.formState.dimensionLabel = ensureValidDimensionSelection(
      this.config.papers || [],
      this.formState.paperLabel,
      this.formState.dimensionLabel,
      this.fileInfo?.suggestedDimension || ''
    );
  }

  calculateQuote() {
    const { paperLabel, dimensionLabel, copies } = this.getCurrentSelections();
    const pageCount = this.fileInfo?.pageCount || 0;
    const paper = findPaperByLabel(this.config.papers || [], paperLabel);
    const dimension = findDimensionByLabel(this.config.papers || [], paperLabel, dimensionLabel);
    const pricePerPage = Number(dimension?.price) || 0;
    const printUnitPrice = pricePerPage * pageCount;
    return {
      pageCount,
      copies,
      paper,
      dimension,
      pricePerPage,
      printUnitPrice,
      totalPrice: printUnitPrice * copies
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

  renderStep(step, title) {
    const active = this.currentStep === step;
    const done = this.currentStep > step || (step < 3 && this.getStepValidity(step));
    return `<button type="button" class="pcad-step ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}" data-go-step="${step}"><span class="pcad-step-dot">${done ? '<i class="fas fa-check"></i>' : step}</span><span class="pcad-step-label">${title}</span></button>${step < 3 ? '<span class="pcad-step-line"></span>' : ''}`;
  }

  render() {
    const papers = this.getEnabledPapers();
    const dimensions = this.getEnabledDimensions(this.formState.paperLabel);
    const quote = this.calculateQuote();

    this.container.innerHTML = `
      <style>
        .pcad-shell{width:100%;max-width:900px;margin:0 auto;padding:0 1rem 3rem;display:grid;gap:1.35rem}
        .pcad-hero{position:relative;overflow:hidden;background:var(--sc-navy);color:#fff;border-radius:var(--sc-radius);padding:1.75rem 1.85rem;display:flex;align-items:center;gap:1.1rem}
        .pcad-hero::before{content:'';position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:22px 22px;pointer-events:none}
        .pcad-hero-icon{position:relative;z-index:1;width:50px;height:50px;min-width:50px;border-radius:13px;background:rgba(69,83,107,.5);display:flex;align-items:center;justify-content:center;font-size:1.25rem;color:#a9c4e8}
        .pcad-hero h1{position:relative;z-index:1;font-size:clamp(1.35rem,2.6vw,1.7rem);font-weight:800;margin-bottom:.3rem;letter-spacing:-.01em}
        .pcad-hero p{position:relative;z-index:1;color:rgba(255,255,255,.72);font-size:.88rem;line-height:1.5;max-width:56ch}
        .pcad-error-banner{border-radius:var(--sc-radius-sm);background:#fdecea;border:1px solid #f3c6c2;color:#991b1b;padding:.85rem 1rem;font-size:.88rem}

        .pcad-stepper{display:flex;align-items:center;padding:0 .2rem}
        .pcad-step{display:flex;align-items:center;gap:.55rem;background:none;border:none;cursor:pointer;padding:.35rem 0}
        .pcad-step-dot{width:26px;height:26px;min-width:26px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:.74rem;font-weight:800;background:var(--sc-canvas);color:var(--sc-muted);border:1px solid var(--sc-line)}
        .pcad-step.is-active .pcad-step-dot{background:#45536B;color:#fff;border-color:#45536B}
        .pcad-step.is-done .pcad-step-dot{background:#0f9f6e;color:#fff;border-color:#0f9f6e}
        .pcad-step-label{font-size:.8rem;font-weight:700;color:var(--sc-muted)}
        .pcad-step.is-active .pcad-step-label{color:var(--sc-ink)}
        .pcad-step-line{flex:1;height:1px;background:var(--sc-line);margin:0 .6rem}

        .pcad-panel{background:var(--sc-surface);border:1px solid var(--sc-line);border-radius:var(--sc-radius);padding:1.5rem;display:grid;gap:1rem}
        .pcad-panel h2{font-size:1.15rem;font-weight:800;color:var(--sc-ink)}
        .pcad-hint{color:var(--sc-muted);font-size:.85rem;margin-top:-.55rem;line-height:1.5}

        .pcad-field{display:grid;gap:.4rem}
        .pcad-field span{font-size:.8rem;font-weight:700;color:var(--sc-muted);text-transform:uppercase;letter-spacing:.03em}
        .pcad-input{width:100%;border:1px solid var(--sc-line);border-radius:var(--sc-radius-sm);padding:.7rem .8rem;font:inherit;font-size:.92rem;background:#fff;color:var(--sc-ink)}
        .pcad-input:focus{outline:none;border-color:#45536B;box-shadow:0 0 0 3px rgba(69,83,107,.14)}
        .pcad-grid2{display:grid;grid-template-columns:1fr 1fr;gap:.9rem}
        .pcad-upload{border:1.5px dashed #b9c3d2;border-radius:var(--sc-radius-sm);padding:1.1rem;background:#f4f6f9;display:grid;gap:.7rem}
        .pcad-suggest{border-radius:var(--sc-radius-sm);background:#f4f6f9;border:1px solid #dbe1ea;color:#3c4a63;padding:.75rem .9rem;font-size:.86rem}
        .pcad-suggest strong{font-variant-numeric:tabular-nums}

        .pcad-summary{display:grid;gap:0;border:1px solid var(--sc-line);border-radius:var(--sc-radius-sm);overflow:hidden;font-variant-numeric:tabular-nums}
        .pcad-summary-row{display:flex;justify-content:space-between;gap:1rem;color:var(--sc-muted);font-size:.86rem;padding:.55rem .85rem;border-bottom:1px solid var(--sc-line);background:#fff}
        .pcad-summary-row strong{color:var(--sc-ink)}
        .pcad-summary-total{display:flex;justify-content:space-between;font-size:1.1rem;font-weight:800;color:var(--sc-ink);padding:.75rem .85rem;background:var(--sc-canvas)}
        .pcad-note{border-radius:var(--sc-radius-sm);background:#f4f6f9;border:1px solid #dbe1ea;color:#3c4a63;padding:.85rem .95rem;font-size:.86rem;line-height:1.6}

        .pcad-actions{display:flex;flex-wrap:wrap;gap:.6rem;align-items:center}
        .pcad-btn{border:none;border-radius:var(--sc-radius-sm);padding:.72rem 1.05rem;font:inherit;font-weight:700;font-size:.88rem;cursor:pointer}
        .pcad-btn.primary{background:var(--sc-orange);color:#0f1111;border:1px solid var(--sc-orange-border)}
        .pcad-btn.primary:hover:not(:disabled){background:var(--sc-orange-border)}
        .pcad-btn.secondary{background:#fff;color:var(--sc-ink);border:1px solid var(--sc-line)}
        .pcad-btn.ghost{background:transparent;color:var(--sc-muted);border:1px solid var(--sc-line)}
        .pcad-btn:disabled{opacity:.5;cursor:not-allowed}
        @media (max-width: 640px) {
          .pcad-hero{flex-direction:column;text-align:center;padding:1.5rem}
          .pcad-grid2{grid-template-columns:1fr}
          .pcad-step-label{display:none}
        }
      </style>
      <section class="pcad-shell">
        <header class="pcad-hero">
          <div class="pcad-hero-icon"><i class="fas fa-drafting-compass"></i></div>
          <div>
            <h1>Plans CAD & architecture</h1>
            <p>Envoyez votre plan PDF : le format le plus proche est suggéré automatiquement, et le tarif suit le nombre de pages.</p>
          </div>
        </header>
        ${this.config.enabled === false ? `<div class="pcad-error-banner">Le module CAD est temporairement indisponible.</div>` : ''}
        <nav class="pcad-stepper">${this.renderStep(1, 'Votre plan')}${this.renderStep(2, 'Vos options')}${this.renderStep(3, 'Votre tarif')}</nav>
        ${this.currentStep === 1 ? `
          <section class="pcad-panel">
            <h2>Chargez votre plan PDF</h2>
            <p class="pcad-hint">Le format le plus proche du plan est suggéré automatiquement.</p>
            <label class="pcad-field"><span>Fichier PDF</span><div class="pcad-upload"><input id="cadPdfFile" class="pcad-input" type="file" accept="application/pdf" ${this.config.enabled === false ? 'disabled' : ''}><div id="cadPdfStatus" style="color:${this.fileInfo ? '#0f9f6e' : 'var(--sc-muted)'};font-size:.84rem;">${this.fileInfo ? `${this.escape(this.fileInfo.name)} · ${this.fileInfo.pageCount} page(s)` : 'Choisissez un plan PDF pour analyse automatique.'}</div></div></label>
            ${this.fileInfo?.suggestedDimension ? `<div class="pcad-suggest">Format suggéré : <strong>${this.escape(this.fileInfo.suggestedDimension)}</strong></div>` : ''}
            <div class="pcad-actions"><button type="button" class="pcad-btn primary" data-next-step="2" ${!this.getStepValidity(1) || this.config.enabled === false ? 'disabled' : ''}>Continuer</button></div>
          </section>` : ''}
        ${this.currentStep === 2 ? `
          <section class="pcad-panel">
            <h2>Papier et dimension</h2>
            <p class="pcad-hint">Choisissez d'abord le papier, puis la dimension disponible pour ce papier.</p>
            <div class="pcad-grid2">
              <label class="pcad-field"><span>Papier</span><select id="cadPaper" class="pcad-input" ${this.config.enabled === false ? 'disabled' : ''}><option value="">Choisir un papier</option>${papers.map((paper) => `<option value="${this.escape(paper.label)}">${this.escape(paper.label)}</option>`).join('')}</select></label>
              <label class="pcad-field"><span>Dimension</span><select id="cadDimension" class="pcad-input" ${this.config.enabled === false ? 'disabled' : ''} ${!this.formState.paperLabel ? 'disabled' : ''}><option value="">Choisir un format</option>${dimensions.map((item) => `<option value="${this.escape(item.label)}">${this.escape(item.label)} · ${this.formatPrice(item.price || 0)} / page</option>`).join('')}</select></label>
            </div>
            <label class="pcad-field" style="max-width:220px;"><span>Nombre d'impressions</span><input id="cadCopies" class="pcad-input" type="number" min="1" step="1" value="${this.formState.copies || 1}" ${this.config.enabled === false ? 'disabled' : ''}></label>
            <div class="pcad-actions"><button type="button" class="pcad-btn ghost" data-prev-step="1">Retour</button><button type="button" class="pcad-btn primary" data-next-step="3" ${!this.getStepValidity(2) || this.config.enabled === false ? 'disabled' : ''}>Voir mon tarif</button></div>
          </section>` : ''}
        ${this.currentStep === 3 ? `
          <section class="pcad-panel">
            <h2>Votre tarif</h2>
            <div class="pcad-summary">
              <div class="pcad-summary-row"><span>Pages</span><strong id="cadQuotePages">${quote.pageCount}</strong></div>
              <div class="pcad-summary-row"><span>Pages imprimées</span><strong id="cadQuotePrintedPages">${quote.pageCount * quote.copies}</strong></div>
              <div class="pcad-summary-row"><span>Papier</span><strong>${this.escape(quote.paper?.label || '-')}</strong></div>
              <div class="pcad-summary-row"><span>Dimension</span><strong>${this.escape(quote.dimension?.label || '-')}</strong></div>
              <div class="pcad-summary-row"><span>Prix par page</span><strong>${this.formatPrice(quote.pricePerPage)}</strong></div>
              <div class="pcad-summary-row"><span>Prix par impression</span><strong id="cadQuoteUnitPrice">${this.formatPrice(quote.printUnitPrice)}</strong></div>
              <div class="pcad-summary-row"><span>Nombre d'impressions</span><strong id="cadQuoteCopies">${quote.copies}</strong></div>
              <div class="pcad-summary-row"><span>Total impression</span><strong id="cadPrintTotal">${this.formatPrice(quote.totalPrice)}</strong></div>
              <div class="pcad-summary-row"><span>Frais réception</span><strong id="cadDeliveryFee">${this.formatPrice(this.deliveryController.getFee())}</strong></div>
              <div class="pcad-summary-total"><span>Total à payer</span><strong id="cadQuoteTotal">${this.formatPrice(quote.totalPrice + this.deliveryController.getFee())}</strong></div>
            </div>
            ${this.deliveryController.renderSection()}
            ${this.config.notes ? `<div class="pcad-note">${this.escape(this.config.notes)}</div>` : ''}
            <div class="pcad-actions"><button type="button" class="pcad-btn ghost" data-prev-step="2">Modifier</button><button type="button" class="pcad-btn secondary" id="openCartFromCad">Ouvrir le panier</button><button type="button" class="pcad-btn primary" id="submitCadOrder" ${this.config.enabled === false ? 'disabled' : ''}>Ajouter au panier</button><span id="cadSubmitStatus" style="font-size:.84rem;color:var(--sc-muted);"></span></div>
          </section>` : ''}
      </section>
    `;
    this.restoreFormState();
  }

  restoreFormState() {
    const paperSelect = this.container.querySelector('#cadPaper');
    const dimensionSelect = this.container.querySelector('#cadDimension');
    const copiesInput = this.container.querySelector('#cadCopies');
    if (paperSelect && this.formState.paperLabel) paperSelect.value = this.formState.paperLabel;
    if (dimensionSelect && this.formState.dimensionLabel) dimensionSelect.value = this.formState.dimensionLabel;
    if (copiesInput) copiesInput.value = String(this.formState.copies || 1);
  }

  attachEvents() {
    this.container.querySelectorAll('[data-go-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.goStep))));
    this.container.querySelectorAll('[data-next-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.nextStep))));
    this.container.querySelectorAll('[data-prev-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.prevStep))));
    this.container.querySelector('#cadPdfFile')?.addEventListener('change', async (event) => {
      await this.handlePdfSelection(event.target.files?.[0]);
    });
    this.container.querySelector('#cadPaper')?.addEventListener('change', () => {
      this.syncFormState();
      this.formState.dimensionLabel = '';
      this.ensureValidSelections();
      this.render();
      this.attachEvents();
      this.refreshQuote();
    });
    this.container.querySelector('#cadDimension')?.addEventListener('change', () => this.refreshQuote());
    this.container.querySelector('#cadCopies')?.addEventListener('input', () => this.refreshQuote());
    this.container.querySelector('#submitCadOrder')?.addEventListener('click', async () => {
      await this.handleSubmit();
    });
    this.container.querySelector('#openCartFromCad')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('openCart')));
    this.deliveryController.bind();
  }

  async handlePdfSelection(file) {
    const statusEl = this.container.querySelector('#cadPdfStatus');
    this.file = null;
    this.fileInfo = null;
    if (!file) {
      if (statusEl) statusEl.textContent = 'Choisissez un plan PDF pour analyse automatique.';
      return;
    }
    try {
      const analysis = await this.analyzePdf(file);
      this.file = file;
      this.fileInfo = { name: file.name, ...analysis };
      this.formState.dimensionLabel = analysis.suggestedDimension || '';
      this.render();
      this.attachEvents();
    } catch (error) {
      console.error('Erreur analyse CAD:', error);
      if (statusEl) statusEl.textContent = error.message || 'Impossible de lire ce plan.';
    }
  }

  refreshQuote() {
    this.syncFormState();
    const nextButton = this.container.querySelector('[data-next-step="3"]');
    const totalEl = this.container.querySelector('#cadQuoteTotal');
    const pagesEl = this.container.querySelector('#cadQuotePages');
    const copiesEl = this.container.querySelector('#cadQuoteCopies');
    const unitPriceEl = this.container.querySelector('#cadQuoteUnitPrice');
    const printTotalEl = this.container.querySelector('#cadPrintTotal');
    const deliveryFeeEl = this.container.querySelector('#cadDeliveryFee');
    const printedPagesEl = this.container.querySelector('#cadQuotePrintedPages');
    const quote = this.calculateQuote();
    if (nextButton) nextButton.disabled = !this.getStepValidity(2) || this.config.enabled === false;
    if (printTotalEl) printTotalEl.textContent = this.formatPrice(quote.totalPrice);
    if (deliveryFeeEl) deliveryFeeEl.textContent = this.formatPrice(this.deliveryController.getFee());
    if (totalEl) totalEl.textContent = this.formatPrice(quote.totalPrice + this.deliveryController.getFee());
    if (pagesEl) pagesEl.textContent = String(quote.pageCount || 0);
    if (printedPagesEl) printedPagesEl.textContent = String((quote.pageCount || 0) * (quote.copies || 1));
    if (copiesEl) copiesEl.textContent = String(quote.copies || 1);
    if (unitPriceEl) unitPriceEl.textContent = this.formatPrice(quote.printUnitPrice || 0);
  }

  async handleSubmit() {
    const statusEl = this.container.querySelector('#cadSubmitStatus');
    this.syncFormState();
    const paperLabel = this.formState.paperLabel || '';
    const dimensionLabel = this.formState.dimensionLabel || '';
    const copies = Math.max(1, Number.parseInt(String(this.formState.copies || 1), 10) || 1);
    const quote = this.calculateQuote();
    if (!this.file || !this.fileInfo?.pageCount) {
      if (statusEl) statusEl.textContent = 'Ajoutez un plan PDF valide.';
      return;
    }
    if (!paperLabel || !dimensionLabel || copies < 1) {
      if (statusEl) statusEl.textContent = 'Choisissez une dimension, un papier et un nombre d impressions valide.';
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
      if (statusEl) statusEl.textContent = 'Upload du plan et ajout au panier...';
      const uploaded = await uploadPdfFile(this.file, 'printing-cad', { maxSizeMb: 25 });
      const deliveryPayload = this.deliveryController.getCartPayload();
      const deliveryFee = Number(deliveryPayload.fee || 0);
      const payableTotal = quote.totalPrice + deliveryFee;
      document.dispatchEvent(new CustomEvent('addToCart', {
        detail: {
          productId: 'printing-cad',
          name: `Impression plan CAD ${dimensionLabel}`,
          price: payableTotal,
          quantity: 1,
          sku: `CAD-${Date.now()}`,
          image: PRODUCT_IMAGE,
          sourceType: 'printing',
          deliveryMode: deliveryPayload.method === 'pickup' ? 'Impression - point de retrait' : 'Impression - livraison a domicile',
          deliveryCoverage: { country: 'Haiti', mode: 'printing_prepaid', nationwide: true, nationwideFee: 0, zones: [] },
          productDeliveryCoverage: { country: 'Haiti', mode: 'printing_prepaid', nationwide: true, nationwideFee: 0, zones: [] },
          printingDelivery: deliveryPayload,
          selectedOptions: [
            { label: 'Type de papier', value: paperLabel },
            { label: 'Dimension', value: dimensionLabel },
            { label: 'Pages', value: String(this.fileInfo?.pageCount || 0) },
            { label: 'Prix / page', value: this.formatPrice(quote.pricePerPage) },
            { label: 'Prix par impression', value: this.formatPrice(quote.printUnitPrice) },
            { label: 'Nombre d impressions', value: String(copies) },
            { label: 'Total impression', value: this.formatPrice(quote.totalPrice) },
            ...this.deliveryController.getSummaryLines(),
            { label: 'Total à payer', value: this.formatPrice(payableTotal) },
            { label: 'Dimension détectée', value: this.fileInfo?.suggestedDimension || '-' },
            { label: 'Fichier', value: this.file.name },
            { label: 'URL fichier', value: uploaded.url },
            { label: 'Chemin storage', value: uploaded.path }
          ]
        }
      }));
      if (statusEl) { statusEl.textContent = 'Votre plan a ete ajoute au panier.'; statusEl.style.color = '#0f9f6e'; }
      document.dispatchEvent(new CustomEvent('openCart'));
    } catch (error) {
      console.error('Erreur impression CAD:', error);
      if (statusEl) { statusEl.textContent = error.message || 'Impossible d ajouter ce plan au panier.'; statusEl.style.color = '#b91c1c'; }
    }
  }
}

export default PrintingCadPage;
