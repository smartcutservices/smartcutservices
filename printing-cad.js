import { db } from './firebase-init.js';
import { uploadPdfFile } from './firebase-storage.js';
import { getCartManager } from './cart.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const DEFAULT_CONFIG = {
  enabled: true,
  dimensions: [
    { label: '17x24', enabled: true, price: 0 },
    { label: '24x36', enabled: true, price: 0 },
    { label: '24x24', enabled: true, price: 0 },
    { label: '24x48', enabled: true, price: 0 },
    { label: '36x48', enabled: true, price: 0 },
    { label: '8.5x11', enabled: true, price: 0 },
    { label: '8.5x14', enabled: true, price: 0 },
    { label: '11x17', enabled: true, price: 0 }
  ],
  papers: [{ label: 'Papier plan standard', enabled: true, price: 0 }],
  pricing: { basePrice: 0, perSheetPrice: 0, oversizedPrice: 0 },
  notes: ''
};

class PrintingCadPage {
  constructor(containerId = 'printing-cad-root') {
    this.container = document.getElementById(containerId);
    this.config = { ...DEFAULT_CONFIG };
    this.file = null;
    this.fileInfo = null;
    this.currentStep = 1;
    this.formState = { dimensionLabel: '', paperLabel: '' };
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
      const snapshot = await getDoc(doc(db, 'printingSettings', 'cad'));
      this.config = snapshot.exists() ? {
        ...DEFAULT_CONFIG,
        ...snapshot.data(),
        dimensions: Array.isArray(snapshot.data().dimensions) ? snapshot.data().dimensions : DEFAULT_CONFIG.dimensions,
        papers: Array.isArray(snapshot.data().papers) ? snapshot.data().papers : DEFAULT_CONFIG.papers,
        pricing: { ...DEFAULT_CONFIG.pricing, ...(snapshot.data().pricing || {}) }
      } : { ...DEFAULT_CONFIG };
    } catch (error) {
      console.error('Erreur chargement config CAD:', error);
      this.config = { ...DEFAULT_CONFIG };
    }
  }

  getPdfLib() {
    const lib = window.pdfjsLib;
    if (!lib) throw new Error('Le lecteur PDF n est pas disponible.');
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
    this.getEnabledDimensions().forEach((item) => {
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
    return best;
  }

  getEnabledDimensions() {
    return (this.config.dimensions || []).filter((item) => item?.enabled !== false && item?.label);
  }

  getEnabledPapers() {
    return (this.config.papers || []).filter((item) => item?.enabled !== false && item?.label);
  }

  formatPrice(value) {
    return new Intl.NumberFormat('fr-HT', { style: 'currency', currency: 'HTG', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Number(value) || 0);
  }

  escape(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  getCurrentSelections() {
    return {
      dimensionLabel: this.container.querySelector('#cadDimension')?.value || this.formState.dimensionLabel || '',
      paperLabel: this.container.querySelector('#cadPaper')?.value || this.formState.paperLabel || ''
    };
  }

  syncFormState() {
    this.formState = { ...this.formState, ...this.getCurrentSelections() };
  }

  calculateQuote() {
    const { dimensionLabel, paperLabel } = this.getCurrentSelections();
    const dimension = this.getEnabledDimensions().find((item) => item.label === dimensionLabel);
    const paper = this.getEnabledPapers().find((item) => item.label === paperLabel);
    const pageCount = this.fileInfo?.pageCount || 0;
    const oversized = /24x|36x|48/.test(String(dimensionLabel || ''));
    const pricing = this.config.pricing || {};
    const unitPrice = (Number(pricing.basePrice) || 0) + ((Number(pricing.perSheetPrice) || 0) * pageCount) + (Number(dimension?.price) || 0) + (Number(paper?.price) || 0) + (oversized ? (Number(pricing.oversizedPrice) || 0) : 0);
    return { pageCount, unitPrice, totalPrice: unitPrice, dimension, paper };
  }

  getStepValidity(step = this.currentStep) {
    const { dimensionLabel, paperLabel } = this.getCurrentSelections();
    if (step === 1) return Boolean(this.file);
    if (step === 2) return Boolean(dimensionLabel && paperLabel);
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
    return `<button type="button" class="quiz-step ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}" data-go-step="${step}"><span class="quiz-step-index">${done ? '<i class="fas fa-check"></i>' : step}</span><span class="quiz-step-copy"><strong>Etape ${step}</strong><small>${title}</small></span></button>`;
  }

  render() {
    const dimensions = this.getEnabledDimensions();
    const papers = this.getEnabledPapers();
    const quote = this.calculateQuote();

    this.container.innerHTML = `
      <style>
        .quiz-shell{width:100%;max-width:1100px;margin:0 auto;padding:1rem 1rem 3rem;display:grid;gap:1rem}
        .quiz-heading{display:grid;gap:.5rem}.quiz-heading small{color:#9b7c38;text-transform:uppercase;letter-spacing:.16em;font-size:.75rem;font-weight:800}.quiz-heading h1{font-family:'Cormorant Garamond',serif;font-size:clamp(2.2rem,5vw,3.8rem);line-height:.92;color:#1F1E1C}.quiz-heading p{color:#6E6557;line-height:1.8;max-width:60ch}
        .quiz-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.85rem}.quiz-step{border:1px solid rgba(31,30,28,.08);border-radius:1.4rem;background:rgba(255,255,255,.92);box-shadow:0 18px 36px rgba(31,30,28,.06);padding:.95rem 1rem;display:flex;gap:.8rem;align-items:center;text-align:left;cursor:pointer}.quiz-step.is-active{border-color:rgba(198,167,94,.35);background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(248,242,230,.94))}.quiz-step.is-done .quiz-step-index{background:#0f9f6e;color:#fff}.quiz-step-index{width:36px;height:36px;min-width:36px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:rgba(198,167,94,.14);color:#9b7c38;font-weight:800}.quiz-step-copy{display:grid;gap:.16rem}.quiz-step-copy strong{font-size:.86rem;color:#6E6557}.quiz-step-copy small{font-size:1rem;color:#1F1E1C;font-weight:800}
        .quiz-panel{border:1px solid rgba(31,30,28,.08);border-radius:1.9rem;background:rgba(255,255,255,.94);box-shadow:0 24px 60px rgba(31,30,28,.08);padding:clamp(1.2rem,3vw,1.8rem);display:grid;gap:1rem}.quiz-head{display:grid;gap:.45rem}.quiz-head small{color:#9b7c38;text-transform:uppercase;letter-spacing:.14em;font-size:.72rem;font-weight:800}.quiz-head h2{font-family:'Cormorant Garamond',serif;font-size:clamp(2rem,4vw,2.9rem);line-height:.94;color:#1F1E1C}.quiz-head p{color:#6E6557;line-height:1.8}
        .quiz-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.quiz-field{display:grid;gap:.5rem}.quiz-field span{font-size:.9rem;color:#6E6557;font-weight:700}.quiz-input{width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.95rem 1rem;background:#fff;font:inherit}.quiz-upload{border:1px dashed rgba(198,167,94,.4);border-radius:1.3rem;padding:1rem;background:linear-gradient(180deg,rgba(248,242,230,.7),rgba(255,255,255,.96));display:grid;gap:.85rem}
        .quiz-summary{display:grid;gap:.8rem;border:1px solid rgba(31,30,28,.08);border-radius:1.35rem;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(248,242,230,.9));padding:1.1rem}.quiz-summary-row,.quiz-summary-total{display:flex;justify-content:space-between;gap:1rem;color:#6E6557}.quiz-summary-total{margin-top:.25rem;padding-top:.9rem;border-top:1px solid rgba(31,30,28,.08);color:#1F1E1C;font-size:1.2rem;font-weight:800}
        .quiz-note{border-radius:1.2rem;background:rgba(198,167,94,.08);border:1px solid rgba(198,167,94,.16);color:#8A7450;padding:1rem 1.1rem;line-height:1.8}.quiz-note.is-error{background:rgba(185,28,28,.08);border-color:rgba(185,28,28,.12);color:#991b1b}
        .quiz-actions{display:flex;flex-wrap:wrap;gap:.8rem;align-items:center}.quiz-btn{border:none;border-radius:999px;padding:.96rem 1.25rem;font:inherit;font-weight:800;cursor:pointer}.quiz-btn.primary{background:#1F1E1C;color:#F8F5EF}.quiz-btn.secondary{background:#fff;color:#1F1E1C;border:1px solid rgba(31,30,28,.12)}.quiz-btn.ghost{background:transparent;color:#6E6557;border:1px solid rgba(31,30,28,.1)}
        @media (max-width:860px){.quiz-steps,.quiz-grid{grid-template-columns:1fr}}
      </style>
      <section class="quiz-shell">
        <header class="quiz-heading">
          <small>Plans CAD</small>
          <h1>Chargez votre plan, confirmez le format et voyez votre tarif.</h1>
          <p>Le parcours vous guide et peut meme suggerer la dimension la plus proche a partir de votre PDF.</p>
        </header>
        ${this.config.enabled === false ? `<div class="quiz-note is-error">Le module CAD est temporairement indisponible.</div>` : ''}
        <div class="quiz-steps">${this.renderStep(1, 'Votre plan')}${this.renderStep(2, 'Vos options')}${this.renderStep(3, 'Votre tarif')}</div>
        ${this.currentStep === 1 ? `
          <section class="quiz-panel">
            <div class="quiz-head"><small>Etape 1</small><h2>Chargez votre plan</h2><p>Ajoutez votre PDF pour analyser le plan et proposer automatiquement le format le plus proche.</p></div>
            <label class="quiz-field"><span>Fichier PDF</span><div class="quiz-upload"><input id="cadPdfFile" class="quiz-input" type="file" accept="application/pdf" ${this.config.enabled === false ? 'disabled' : ''}><div id="cadPdfStatus" style="color:${this.fileInfo ? '#0f9f6e' : '#6E6557'};">${this.fileInfo ? `${this.escape(this.fileInfo.name)} · ${this.fileInfo.pageCount} page(s)` : 'Choisissez un plan PDF pour analyse automatique.'}</div></div></label>
            ${this.fileInfo?.suggestedDimension ? `<div class="quiz-note">Dimension suggeree automatiquement : <strong>${this.escape(this.fileInfo.suggestedDimension)}</strong></div>` : ''}
            <div class="quiz-actions"><button type="button" class="quiz-btn primary" data-next-step="2" ${!this.getStepValidity(1) || this.config.enabled === false ? 'disabled' : ''}>Continuer</button></div>
          </section>` : ''}
        ${this.currentStep === 2 ? `
          <section class="quiz-panel">
            <div class="quiz-head"><small>Etape 2</small><h2>Confirmez vos options</h2><p>Choisissez la dimension finale et le papier utilise pour votre impression technique.</p></div>
            <div class="quiz-grid">
              <label class="quiz-field"><span>Dimension</span><select id="cadDimension" class="quiz-input" ${this.config.enabled === false ? 'disabled' : ''}><option value="">Choisir un format</option>${dimensions.map((item) => `<option value="${this.escape(item.label)}" ${this.fileInfo?.suggestedDimension === item.label ? 'selected' : ''}>${this.escape(item.label)} · ${this.formatPrice(item.price || 0)}</option>`).join('')}</select></label>
              <label class="quiz-field"><span>Papier</span><select id="cadPaper" class="quiz-input" ${this.config.enabled === false ? 'disabled' : ''}><option value="">Choisir un papier</option>${papers.map((item) => `<option value="${this.escape(item.label)}">${this.escape(item.label)} · ${this.formatPrice(item.price || 0)}</option>`).join('')}</select></label>
            </div>
            <div class="quiz-actions"><button type="button" class="quiz-btn ghost" data-prev-step="1">Retour</button><button type="button" class="quiz-btn primary" data-next-step="3" ${!this.getStepValidity(2) || this.config.enabled === false ? 'disabled' : ''}>Voir mon tarif</button></div>
          </section>` : ''}
        ${this.currentStep === 3 ? `
          <section class="quiz-panel">
            <div class="quiz-head"><small>Etape 3</small><h2>Votre tarif est pret</h2><p>Verifiez le recapitulatif de votre impression CAD avant de l ajouter au panier.</p></div>
            <div class="quiz-summary">
              <div class="quiz-summary-row"><span>Pages</span><strong id="cadQuotePages">${quote.pageCount}</strong></div>
              <div class="quiz-summary-row"><span>Dimension</span><strong>${this.escape(quote.dimension?.label || '-')}</strong></div>
              <div class="quiz-summary-row"><span>Papier</span><strong>${this.escape(quote.paper?.label || '-')}</strong></div>
              <div class="quiz-summary-total"><span>Total</span><strong id="cadQuoteTotal">${this.formatPrice(quote.totalPrice)}</strong></div>
            </div>
            ${this.config.notes ? `<div class="quiz-note">${this.escape(this.config.notes)}</div>` : ''}
            <div class="quiz-actions"><button type="button" class="quiz-btn ghost" data-prev-step="2">Modifier mes choix</button><button type="button" class="quiz-btn secondary" id="openCartFromCad">Ouvrir le panier</button><button type="button" class="quiz-btn primary" id="submitCadOrder" ${this.config.enabled === false ? 'disabled' : ''}>Ajouter au panier</button><span id="cadSubmitStatus"></span></div>
          </section>` : ''}
      </section>
    `;
    this.restoreFormState();
  }

  restoreFormState() {
    const dimensionSelect = this.container.querySelector('#cadDimension');
    const paperSelect = this.container.querySelector('#cadPaper');
    if (dimensionSelect && this.formState.dimensionLabel) dimensionSelect.value = this.formState.dimensionLabel;
    if (paperSelect && this.formState.paperLabel) paperSelect.value = this.formState.paperLabel;
  }

  attachEvents() {
    this.container.querySelectorAll('[data-go-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.goStep))));
    this.container.querySelectorAll('[data-next-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.nextStep))));
    this.container.querySelectorAll('[data-prev-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.prevStep))));
    this.container.querySelector('#cadPdfFile')?.addEventListener('change', async (event) => {
      await this.handlePdfSelection(event.target.files?.[0]);
    });
    this.container.querySelector('#cadDimension')?.addEventListener('change', () => this.refreshQuote());
    this.container.querySelector('#cadPaper')?.addEventListener('change', () => this.refreshQuote());
    this.container.querySelector('#submitCadOrder')?.addEventListener('click', async () => {
      await this.handleSubmit();
    });
    this.container.querySelector('#openCartFromCad')?.addEventListener('click', () => document.dispatchEvent(new CustomEvent('openCart')));
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
      this.formState.dimensionLabel = analysis.suggestedDimension || this.formState.dimensionLabel || '';
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
    if (nextButton) nextButton.disabled = !this.getStepValidity(2) || this.config.enabled === false;
  }

  async handleSubmit() {
    const statusEl = this.container.querySelector('#cadSubmitStatus');
    this.syncFormState();
    const dimensionLabel = this.container.querySelector('#cadDimension')?.value || this.formState.dimensionLabel || '';
    const paperLabel = this.container.querySelector('#cadPaper')?.value || this.formState.paperLabel || '';
    const quote = this.calculateQuote();
    if (!this.file) {
      if (statusEl) statusEl.textContent = 'Ajoutez un plan PDF valide.';
      return;
    }
    if (!dimensionLabel || !paperLabel) {
      if (statusEl) statusEl.textContent = 'Choisissez une dimension et un papier.';
      return;
    }
    try {
      if (statusEl) statusEl.textContent = 'Upload du plan et ajout au panier...';
      const uploaded = await uploadPdfFile(this.file, 'printing-cad', { maxSizeMb: 25 });
      document.dispatchEvent(new CustomEvent('addToCart', {
        detail: {
          productId: 'printing-cad',
          name: `Impression plan CAD ${dimensionLabel}`,
          price: quote.unitPrice,
          quantity: 1,
          sku: `CAD-${Date.now()}`,
          image: 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22240%22 height=%22240%22 viewBox=%220 0 240 240%22%3E%3Crect width=%22240%22 height=%22240%22 rx=%2236%22 fill=%22%23F2E9DA%22/%3E%3Cpath d=%22M48 180h144M70 148l32-40 22 26 40-48 22 28%22 stroke=%22%231F1E1C%22 stroke-width=%228%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22 fill=%22none%22/%3E%3C/svg%3E',
          selectedOptions: [
            { label: 'Dimension', value: dimensionLabel },
            { label: 'Papier', value: paperLabel },
            { label: 'Pages', value: String(this.fileInfo?.pageCount || 0) },
            { label: 'Dimension detectee', value: this.fileInfo?.suggestedDimension || '-' },
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
