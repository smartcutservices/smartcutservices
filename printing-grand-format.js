import { db } from './firebase-init.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const DEFAULT_CONFIG = {
  enabled: true,
  whatsappNumber: '',
  whatsappMessage: 'Bonjour, je souhaite demander un devis Smart Cut Services pour un sticker ou un format grand format.',
  notes: 'Calcul manuel par pied carre via equipe specialisee.'
};

class PrintingGrandFormatPage {
  constructor(containerId = 'printing-grand-format-root') {
    this.container = document.getElementById(containerId);
    this.config = { ...DEFAULT_CONFIG };
    this.currentStep = 1;
    this.formState = { type: 'Stickers', width: '', height: '', notes: '' };
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
      const snapshot = await getDoc(doc(db, 'printingSettings', 'grand-format'));
      this.config = snapshot.exists() ? { ...DEFAULT_CONFIG, ...snapshot.data() } : { ...DEFAULT_CONFIG };
    } catch (error) {
      console.error('Erreur chargement grand format:', error);
    }
  }

  escape(value) {
    return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  buildWhatsAppUrl(message) {
    const raw = String(this.config.whatsappNumber || '').replace(/[^\d]/g, '');
    if (!raw) return '';
    return `https://wa.me/${raw}?text=${encodeURIComponent(message)}`;
  }

  syncFormState() {
    this.formState = {
      type: this.container.querySelector('#grandFormatType')?.value || this.formState.type || 'Impression Grand Format',
      width: this.container.querySelector('#grandFormatWidth')?.value || this.formState.width || '',
      height: this.container.querySelector('#grandFormatHeight')?.value || this.formState.height || '',
      notes: this.container.querySelector('#grandFormatNotes')?.value || this.formState.notes || ''
    };
  }

  getStepValidity(step = this.currentStep) {
    if (step === 1) return Boolean(this.formState.type);
    if (step === 2) return Boolean(this.formState.width.trim() && this.formState.height.trim());
    return true;
  }

  goToStep(step) {
    this.syncFormState();
    const nextStep = Math.max(1, Math.min(3, Number(step) || 1));
    if (nextStep > 1 && !this.getStepValidity(1)) return;
    if (nextStep > 2 && !this.getStepValidity(2)) return;
    this.currentStep = nextStep;
    this.render();
    this.attachEvents();
  }

  renderStep(step, title) {
    const active = this.currentStep === step;
    const done = this.currentStep > step || (step < 3 && this.getStepValidity(step));
    return `<button type="button" class="pgf-step ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}" data-go-step="${step}"><span class="pgf-step-dot">${done ? '<i class="fas fa-check"></i>' : step}</span><span class="pgf-step-label">${title}</span></button>${step < 3 ? '<span class="pgf-step-line"></span>' : ''}`;
  }

  render() {
    const message = `${this.config.whatsappMessage}\n\nType: ${this.formState.type}\nLargeur: ${this.formState.width}\nHauteur: ${this.formState.height}${this.formState.notes ? `\nDetails: ${this.formState.notes}` : ''}`;
    const link = this.buildWhatsAppUrl(message);

    this.container.innerHTML = `
      <style>
        .pgf-shell{width:100%;max-width:820px;margin:0 auto;padding:0 1rem 3rem;display:grid;gap:1.35rem}
        .pgf-hero{background:var(--sc-navy);color:#fff;border-radius:var(--sc-radius);padding:2rem 1.9rem;display:flex;align-items:center;gap:1.15rem}
        .pgf-hero-icon{width:54px;height:54px;min-width:54px;border-radius:14px;background:rgba(37,211,102,.2);display:flex;align-items:center;justify-content:center;font-size:1.4rem;color:#25D366}
        .pgf-hero h1{font-size:clamp(1.5rem,3vw,2.05rem);font-weight:800;margin-bottom:.35rem;letter-spacing:-.01em}
        .pgf-hero p{color:rgba(255,255,255,.72);font-size:.9rem;line-height:1.55;max-width:56ch}
        .pgf-error-banner{border-radius:var(--sc-radius-sm);background:#fdecea;border:1px solid #f3c6c2;color:#991b1b;padding:.85rem 1rem;font-size:.88rem}

        .pgf-stepper{display:flex;align-items:center;padding:0 .2rem}
        .pgf-step{display:flex;align-items:center;gap:.55rem;background:none;border:none;cursor:pointer;padding:.35rem 0}
        .pgf-step-dot{width:26px;height:26px;min-width:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.74rem;font-weight:800;background:var(--sc-canvas);color:var(--sc-muted);border:1px solid var(--sc-line)}
        .pgf-step.is-active .pgf-step-dot{background:#25D366;color:#fff;border-color:#25D366}
        .pgf-step.is-done .pgf-step-dot{background:#0f9f6e;color:#fff;border-color:#0f9f6e}
        .pgf-step-label{font-size:.8rem;font-weight:700;color:var(--sc-muted)}
        .pgf-step.is-active .pgf-step-label{color:var(--sc-ink)}
        .pgf-step-line{flex:1;height:1px;background:var(--sc-line);margin:0 .6rem}

        .pgf-panel{background:var(--sc-surface);border:1px solid var(--sc-line);border-radius:var(--sc-radius);padding:1.6rem;display:grid;gap:1.1rem}
        .pgf-panel h2{font-size:1.3rem;font-weight:800;color:var(--sc-ink)}
        .pgf-hint{color:var(--sc-muted);font-size:.87rem;margin-top:-.65rem;line-height:1.55}

        .pgf-field{display:grid;gap:.4rem}
        .pgf-field span{font-size:.8rem;font-weight:700;color:var(--sc-muted)}
        .pgf-input,.pgf-textarea{width:100%;border:1px solid var(--sc-line);border-radius:var(--sc-radius-sm);padding:.75rem .85rem;font:inherit;font-size:.94rem;background:#fff;color:var(--sc-ink)}
        .pgf-input:focus,.pgf-textarea:focus{outline:none;border-color:#25D366;box-shadow:0 0 0 3px rgba(37,211,102,.14)}
        .pgf-textarea{resize:vertical}
        .pgf-grid2{display:grid;grid-template-columns:1fr 1fr;gap:1rem}

        .pgf-summary{display:grid;gap:0;border:1px solid var(--sc-line);border-radius:var(--sc-radius-sm);overflow:hidden}
        .pgf-summary-row{display:flex;justify-content:space-between;gap:1rem;color:var(--sc-muted);font-size:.87rem;padding:.55rem .85rem;border-bottom:1px solid var(--sc-line);background:#fff}
        .pgf-summary-row:last-child{border-bottom:none}
        .pgf-summary-row strong{color:var(--sc-ink)}
        .pgf-note{border-radius:var(--sc-radius-sm);background:#eefaf1;border:1px solid #bfe8c9;color:#0f6b2c;padding:.85rem .95rem;font-size:.86rem;line-height:1.6}

        .pgf-actions{display:flex;flex-wrap:wrap;gap:.65rem;align-items:center}
        .pgf-btn{border:none;border-radius:var(--sc-radius-sm);padding:.78rem 1.1rem;font:inherit;font-weight:700;font-size:.9rem;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:.6rem}
        .pgf-btn.primary{background:var(--sc-orange);color:#0f1111;border:1px solid var(--sc-orange-border)}
        .pgf-btn.ghost{background:transparent;color:var(--sc-muted);border:1px solid var(--sc-line)}
        .pgf-btn.whatsapp{background:#25D366;color:#fff}
        .pgf-btn.whatsapp:hover{background:#1fb958}
        .pgf-btn.is-disabled{opacity:.5;pointer-events:none}
        .pgf-status{font-size:.84rem}
        @media (max-width: 640px) {
          .pgf-hero{flex-direction:column;text-align:center}
          .pgf-grid2{grid-template-columns:1fr}
          .pgf-step-label{display:none}
        }
      </style>
      <section class="pgf-shell">
        <header class="pgf-hero">
          <div class="pgf-hero-icon"><i class="fas fa-expand"></i></div>
          <div>
            <h1>Stickers & grand format</h1>
            <p>Décrivez votre projet en trois étapes et envoyez-le directement à notre équipe sur WhatsApp pour un devis.</p>
          </div>
        </header>
        ${this.config.enabled === false ? `<div class="pgf-error-banner">Le module grand format est temporairement indisponible.</div>` : ''}
        <nav class="pgf-stepper">${this.renderStep(1, 'Votre projet')}${this.renderStep(2, 'Dimensions')}${this.renderStep(3, 'WhatsApp')}</nav>
        ${this.currentStep === 1 ? `
          <section class="pgf-panel">
            <h2>De quel type de projet s'agit-il ?</h2>
            <label class="pgf-field"><span>Type de demande</span><select id="grandFormatType" class="pgf-input"><option value="Stickers" ${this.formState.type === 'Stickers' ? 'selected' : ''}>Stickers</option><option value="Banners" ${this.formState.type === 'Banners' ? 'selected' : ''}>Banners</option><option value="Impression Grand Format" ${this.formState.type === 'Impression Grand Format' ? 'selected' : ''}>Impression Grand Format</option><option value="Autre" ${this.formState.type === 'Autre' ? 'selected' : ''}>Autre</option></select></label>
            <div class="pgf-actions"><button type="button" class="pgf-btn primary" data-next-step="2" ${this.config.enabled === false ? 'disabled' : ''}>Continuer</button></div>
          </section>` : ''}
        ${this.currentStep === 2 ? `
          <section class="pgf-panel">
            <h2>Dimensions estimées</h2>
            <p class="pgf-hint">Une estimation suffit — l'équipe confirmera avec vous.</p>
            <div class="pgf-grid2">
              <label class="pgf-field"><span>Largeur</span><input id="grandFormatWidth" class="pgf-input" type="text" placeholder="Ex: 80 pouces" value="${this.escape(this.formState.width)}"></label>
              <label class="pgf-field"><span>Hauteur</span><input id="grandFormatHeight" class="pgf-input" type="text" placeholder="Ex: 33 pouces" value="${this.escape(this.formState.height)}"></label>
            </div>
            <div class="pgf-actions"><button type="button" class="pgf-btn ghost" data-prev-step="1">Retour</button><button type="button" class="pgf-btn primary" data-next-step="3" ${!this.getStepValidity(2) || this.config.enabled === false ? 'disabled' : ''}>Continuer</button></div>
          </section>` : ''}
        ${this.currentStep === 3 ? `
          <section class="pgf-panel">
            <h2>Détails et envoi</h2>
            <label class="pgf-field"><span>Détails (support, finition, quantité...)</span><textarea id="grandFormatNotes" class="pgf-textarea" rows="4" placeholder="Toute précision utile pour le devis.">${this.escape(this.formState.notes)}</textarea></label>
            <div class="pgf-summary">
              <div class="pgf-summary-row"><span>Type</span><strong>${this.escape(this.formState.type)}</strong></div>
              <div class="pgf-summary-row"><span>Largeur</span><strong>${this.escape(this.formState.width) || '-'}</strong></div>
              <div class="pgf-summary-row"><span>Hauteur</span><strong>${this.escape(this.formState.height) || '-'}</strong></div>
            </div>
            <div class="pgf-note">${this.escape(this.config.notes || DEFAULT_CONFIG.notes)}</div>
            <div class="pgf-actions">
              <button type="button" class="pgf-btn ghost" data-prev-step="2">Retour</button>
              <a id="grandFormatWhatsappBtn" href="${link || '#'}" target="_blank" rel="noopener noreferrer" class="pgf-btn whatsapp ${!link ? 'is-disabled' : ''}"><i class="fab fa-whatsapp"></i>Demander un devis sur WhatsApp</a>
              <span id="grandFormatStatus" class="pgf-status" style="color:${link ? '#0f9f6e' : '#b91c1c'};">${link ? 'Le message WhatsApp est pret.' : 'Ajoutez un numero WhatsApp dans le dashboard Impression.'}</span>
            </div>
          </section>` : ''}
      </section>
    `;
  }

  updateStepActions() {
    const nextToStep3 = this.container.querySelector('[data-next-step="3"]');
    if (nextToStep3) {
      nextToStep3.disabled = !this.getStepValidity(2) || this.config.enabled === false;
    }

    const whatsappBtn = this.container.querySelector('#grandFormatWhatsappBtn');
    const status = this.container.querySelector('#grandFormatStatus');
    if (whatsappBtn && status) {
      const message = `${this.config.whatsappMessage}\n\nType: ${this.formState.type}\nLargeur: ${this.formState.width}\nHauteur: ${this.formState.height}${this.formState.notes ? `\nDetails: ${this.formState.notes}` : ''}`;
      const link = this.buildWhatsAppUrl(message);
      whatsappBtn.href = link || '#';
      whatsappBtn.classList.toggle('is-disabled', !link);
      status.textContent = link ? 'Le message WhatsApp est pret.' : 'Ajoutez un numero WhatsApp dans le dashboard Impression.';
      status.style.color = link ? '#0f9f6e' : '#b91c1c';
    }
  }

  attachEvents() {
    this.container.querySelectorAll('[data-go-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.goStep))));
    this.container.querySelectorAll('[data-next-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.nextStep))));
    this.container.querySelectorAll('[data-prev-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.prevStep))));
    ['#grandFormatType', '#grandFormatWidth', '#grandFormatHeight', '#grandFormatNotes'].forEach((selector) => {
      this.container.querySelector(selector)?.addEventListener('input', () => {
        this.syncFormState();
        this.updateStepActions();
      });
      this.container.querySelector(selector)?.addEventListener('change', () => {
        this.syncFormState();
        this.updateStepActions();
      });
    });
    this.updateStepActions();
  }
}

export default PrintingGrandFormatPage;
