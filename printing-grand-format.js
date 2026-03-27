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
    this.formState = { type: 'Sticker', width: '', height: '', notes: '' };
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
      type: this.container.querySelector('#grandFormatType')?.value || this.formState.type || 'Grand format',
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
    return `<button type="button" class="quiz-step ${active ? 'is-active' : ''} ${done ? 'is-done' : ''}" data-go-step="${step}"><span class="quiz-step-index">${done ? '<i class="fas fa-check"></i>' : step}</span><span class="quiz-step-copy"><strong>Etape ${step}</strong><small>${title}</small></span></button>`;
  }

  render() {
    const message = `${this.config.whatsappMessage}\n\nType: ${this.formState.type}\nLargeur: ${this.formState.width}\nHauteur: ${this.formState.height}${this.formState.notes ? `\nDetails: ${this.formState.notes}` : ''}`;
    const link = this.buildWhatsAppUrl(message);

    this.container.innerHTML = `
      <style>
        .quiz-shell{width:100%;max-width:1100px;margin:0 auto;padding:1rem 1rem 3rem;display:grid;gap:1rem}
        .quiz-heading{display:grid;gap:.5rem}.quiz-heading small{color:#9b7c38;text-transform:uppercase;letter-spacing:.16em;font-size:.75rem;font-weight:800}.quiz-heading h1{font-family:'Cormorant Garamond',serif;font-size:clamp(2.2rem,5vw,3.8rem);line-height:.92;color:#1F1E1C}.quiz-heading p{color:#6E6557;line-height:1.8;max-width:60ch}
        .quiz-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.85rem}.quiz-step{border:1px solid rgba(31,30,28,.08);border-radius:1.4rem;background:rgba(255,255,255,.92);box-shadow:0 18px 36px rgba(31,30,28,.06);padding:.95rem 1rem;display:flex;gap:.8rem;align-items:center;text-align:left;cursor:pointer}.quiz-step.is-active{border-color:rgba(198,167,94,.35);background:linear-gradient(135deg,rgba(255,255,255,.98),rgba(248,242,230,.94))}.quiz-step.is-done .quiz-step-index{background:#0f9f6e;color:#fff}.quiz-step-index{width:36px;height:36px;min-width:36px;border-radius:999px;display:flex;align-items:center;justify-content:center;background:rgba(198,167,94,.14);color:#9b7c38;font-weight:800}.quiz-step-copy{display:grid;gap:.16rem}.quiz-step-copy strong{font-size:.86rem;color:#6E6557}.quiz-step-copy small{font-size:1rem;color:#1F1E1C;font-weight:800}
        .quiz-panel{border:1px solid rgba(31,30,28,.08);border-radius:1.9rem;background:rgba(255,255,255,.94);box-shadow:0 24px 60px rgba(31,30,28,.08);padding:clamp(1.2rem,3vw,1.8rem);display:grid;gap:1rem}.quiz-head{display:grid;gap:.45rem}.quiz-head small{color:#9b7c38;text-transform:uppercase;letter-spacing:.14em;font-size:.72rem;font-weight:800}.quiz-head h2{font-family:'Cormorant Garamond',serif;font-size:clamp(2rem,4vw,2.9rem);line-height:.94;color:#1F1E1C}.quiz-head p{color:#6E6557;line-height:1.8}
        .quiz-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.quiz-field{display:grid;gap:.5rem}.quiz-field span{font-size:.9rem;color:#6E6557;font-weight:700}.quiz-input,.quiz-textarea{width:100%;border:1px solid rgba(31,30,28,.12);border-radius:1rem;padding:.95rem 1rem;background:#fff;font:inherit}.quiz-textarea{resize:vertical}
        .quiz-summary{display:grid;gap:.8rem;border:1px solid rgba(31,30,28,.08);border-radius:1.35rem;background:linear-gradient(180deg,rgba(255,255,255,.98),rgba(248,242,230,.9));padding:1.1rem}.quiz-summary-row{display:flex;justify-content:space-between;gap:1rem;color:#6E6557}
        .quiz-note{border-radius:1.2rem;background:rgba(198,167,94,.08);border:1px solid rgba(198,167,94,.16);color:#8A7450;padding:1rem 1.1rem;line-height:1.8}.quiz-note.is-error{background:rgba(185,28,28,.08);border-color:rgba(185,28,28,.12);color:#991b1b}
        .quiz-actions{display:flex;flex-wrap:wrap;gap:.8rem;align-items:center}.quiz-btn{border:none;border-radius:999px;padding:.96rem 1.25rem;font:inherit;font-weight:800;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:.65rem}.quiz-btn.primary{background:#1F1E1C;color:#F8F5EF}.quiz-btn.ghost{background:transparent;color:#6E6557;border:1px solid rgba(31,30,28,.1)}.quiz-btn.whatsapp{background:#25D366;color:#fff}.quiz-btn.is-disabled{opacity:.5;pointer-events:none}
        @media (max-width:860px){.quiz-steps,.quiz-grid{grid-template-columns:1fr}}
      </style>
      <section class="quiz-shell">
        <header class="quiz-heading">
          <small>Grand format</small>
          <h1>Decrivez votre projet en quelques etapes et contactez notre equipe.</h1>
          <p>Pour les stickers, bannieres et grands formats, nous vous guidons puis nous preparons votre message WhatsApp avec les informations utiles.</p>
        </header>
        ${this.config.enabled === false ? `<div class="quiz-note is-error">Le module grand format est temporairement indisponible.</div>` : ''}
        <div class="quiz-steps">${this.renderStep(1, 'Votre projet')}${this.renderStep(2, 'Dimensions')}${this.renderStep(3, 'WhatsApp')}</div>
        ${this.currentStep === 1 ? `
          <section class="quiz-panel">
            <div class="quiz-head"><small>Etape 1</small><h2>De quel type de projet s agit-il ?</h2><p>Choisissez le type de demande pour que notre equipe comprenne rapidement votre besoin.</p></div>
            <label class="quiz-field"><span>Type de demande</span><select id="grandFormatType" class="quiz-input"><option value="Sticker" ${this.formState.type === 'Sticker' ? 'selected' : ''}>Sticker</option><option value="Banniere" ${this.formState.type === 'Banniere' ? 'selected' : ''}>Banniere</option><option value="Grand format" ${this.formState.type === 'Grand format' ? 'selected' : ''}>Grand format</option><option value="Autre" ${this.formState.type === 'Autre' ? 'selected' : ''}>Autre</option></select></label>
            <div class="quiz-actions"><button type="button" class="quiz-btn primary" data-next-step="2" ${this.config.enabled === false ? 'disabled' : ''}>Continuer</button></div>
          </section>` : ''}
        ${this.currentStep === 2 ? `
          <section class="quiz-panel">
            <div class="quiz-head"><small>Etape 2</small><h2>Donnez les dimensions de votre projet</h2><p>Indiquez la largeur et la hauteur estimees pour que votre demande soit plus precise.</p></div>
            <div class="quiz-grid">
              <label class="quiz-field"><span>Largeur estimee</span><input id="grandFormatWidth" class="quiz-input" type="text" placeholder="Ex: 4 pieds" value="${this.escape(this.formState.width)}"></label>
              <label class="quiz-field"><span>Hauteur estimee</span><input id="grandFormatHeight" class="quiz-input" type="text" placeholder="Ex: 6 pieds" value="${this.escape(this.formState.height)}"></label>
            </div>
            <div class="quiz-actions"><button type="button" class="quiz-btn ghost" data-prev-step="1">Retour</button><button type="button" class="quiz-btn primary" data-next-step="3" ${!this.getStepValidity(2) || this.config.enabled === false ? 'disabled' : ''}>Continuer</button></div>
          </section>` : ''}
        ${this.currentStep === 3 ? `
          <section class="quiz-panel">
            <div class="quiz-head"><small>Etape 3</small><h2>Ajoutez vos details et contactez-nous</h2><p>Expliquez votre besoin puis envoyez votre demande a notre equipe via WhatsApp pour recevoir un devis.</p></div>
            <label class="quiz-field"><span>Details</span><textarea id="grandFormatNotes" class="quiz-textarea" rows="5" placeholder="Expliquez le support, la finition, la quantite et toute autre precision utile.">${this.escape(this.formState.notes)}</textarea></label>
            <div class="quiz-summary">
              <div class="quiz-summary-row"><span>Type</span><strong>${this.escape(this.formState.type)}</strong></div>
              <div class="quiz-summary-row"><span>Largeur</span><strong>${this.escape(this.formState.width)}</strong></div>
              <div class="quiz-summary-row"><span>Hauteur</span><strong>${this.escape(this.formState.height)}</strong></div>
            </div>
            <div class="quiz-note">${this.escape(this.config.notes || DEFAULT_CONFIG.notes)}</div>
            <div class="quiz-actions"><button type="button" class="quiz-btn ghost" data-prev-step="2">Retour</button><a id="grandFormatWhatsappBtn" href="${link || '#'}" target="_blank" rel="noopener noreferrer" class="quiz-btn whatsapp ${!link ? 'is-disabled' : ''}"><i class="fab fa-whatsapp"></i>Demander un devis sur WhatsApp</a><span id="grandFormatStatus" style="color:${link ? '#0f9f6e' : '#b91c1c'};">${link ? 'Le message WhatsApp est pret.' : 'Ajoutez un numero WhatsApp dans le dashboard Impression.'}</span></div>
          </section>` : ''}
      </section>
    `;
  }

  attachEvents() {
    this.container.querySelectorAll('[data-go-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.goStep))));
    this.container.querySelectorAll('[data-next-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.nextStep))));
    this.container.querySelectorAll('[data-prev-step]').forEach((button) => button.addEventListener('click', () => this.goToStep(Number(button.dataset.prevStep))));
    ['#grandFormatType', '#grandFormatWidth', '#grandFormatHeight', '#grandFormatNotes'].forEach((selector) => {
      this.container.querySelector(selector)?.addEventListener('input', () => this.syncFormState());
      this.container.querySelector(selector)?.addEventListener('change', () => this.syncFormState());
    });
  }
}

export default PrintingGrandFormatPage;
