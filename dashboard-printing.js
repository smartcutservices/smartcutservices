import { db } from './firebase-init.js';
import {
  doc,
  getDoc,
  setDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const MODULES = [
  {
    id: 'documents',
    title: 'POD Documents',
    description: 'Configuration des formats PDF, types de papier, quantite et regles de prix pour les documents standards.',
    metric: 'pages / copies',
    defaults: {
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
      pricing: { basePrice: 0, perPagePrice: 0, perCopyPrice: 0 },
      notes: ''
    }
  },
  {
    id: 'photo',
    title: 'Impression Photo',
    description: 'Formats photo, papiers premium et logique de calcul unitaire pour les demandes photo.',
    metric: 'tirages',
    defaults: {
      enabled: true,
      dimensions: [
        { label: '4x6', enabled: true, price: 0 },
        { label: '5x7', enabled: true, price: 0 },
        { label: '8.5x11', enabled: true, price: 0 },
        { label: '11x17', enabled: true, price: 0 },
        { label: '13x19', enabled: true, price: 0 }
      ],
      papers: [
        { label: 'Matte', enabled: true, price: 0 },
        { label: 'Ultra Glossy', enabled: true, price: 0 },
        { label: 'Premium Glossy', enabled: true, price: 0 },
        { label: 'Premium Semiglossy', enabled: true, price: 0 }
      ],
      pricing: { basePrice: 0, perUnitPrice: 0, rushPrice: 0 },
      notes: ''
    }
  },
  {
    id: 'cad',
    title: 'Plans CAD',
    description: 'Formats techniques pour architecture, plans grands formats et regles specifiques de calcul.',
    metric: 'plans',
    defaults: {
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
      papers: [
        { label: 'Papier plan standard', enabled: true, price: 0 }
      ],
      pricing: { basePrice: 0, perSheetPrice: 0, oversizedPrice: 0 },
      notes: ''
    }
  },
  {
    id: 'grand-format',
    title: 'Stickers & Grand Format',
    description: 'Pilotage du flux WhatsApp, prise de brief et estimation manuelle par equipe specialisee.',
    metric: 'devis',
    defaults: {
      enabled: true,
      whatsappNumber: '',
      whatsappMessage: 'Bonjour, je souhaite demander un devis Smart Cut Services pour un sticker ou un format grand format.',
      notes: 'Calcul manuel par pied carre via equipe specialisee.'
    }
  }
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class PrintingDashboard {
  constructor(rootId = 'printing-dashboard-root') {
    this.root = document.getElementById(rootId);
    this.state = {};
    if (!this.root) return;
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.render();
    this.attachEvents();
  }

  async loadSettings() {
    const entries = await Promise.all(MODULES.map(async (module) => {
      const snapshot = await getDoc(doc(db, 'printingSettings', module.id));
      const merged = snapshot.exists()
        ? this.mergeModuleState(module.defaults, snapshot.data())
        : clone(module.defaults);
      return [module.id, merged];
    }));
    this.state = Object.fromEntries(entries);
  }

  mergeModuleState(defaults, data) {
    const base = clone(defaults);
    if (!data || typeof data !== 'object') return base;
    return {
      ...base,
      ...data,
      dimensions: Array.isArray(data.dimensions) ? data.dimensions : base.dimensions,
      papers: Array.isArray(data.papers) ? data.papers : base.papers,
      pricing: { ...(base.pricing || {}), ...(data.pricing || {}) }
    };
  }

  getStats() {
    const activeModules = MODULES.filter((module) => this.state[module.id]?.enabled).length;
    const totalDimensions = MODULES.reduce((total, module) => total + (this.state[module.id]?.dimensions?.length || 0), 0);
    const totalPapers = MODULES.reduce((total, module) => total + (this.state[module.id]?.papers?.length || 0), 0);
    return { activeModules, totalDimensions, totalPapers };
  }

  render() {
    const stats = this.getStats();
    this.root.innerHTML = `
      <section class="hero">
        <small>Pole impression</small>
        <h1>Configuration impression & production</h1>
        <p>Cette couche admin prepare les sous-modules impression proprement avant le parcours client. On y gere les activations, les dimensions, les types de papier, les prix de base et le flux WhatsApp specialise.</p>
      </section>

      <section class="stats">
        <article class="stat-card"><strong>${MODULES.length}</strong><span>Sous-modules relies</span></article>
        <article class="stat-card"><strong>${stats.activeModules}</strong><span>Modules actifs</span></article>
        <article class="stat-card"><strong>${stats.totalDimensions}</strong><span>Formats configures</span></article>
        <article class="stat-card"><strong>${stats.totalPapers}</strong><span>Papiers configures</span></article>
      </section>

      <section class="config-grid">
        ${MODULES.map((module) => this.renderModule(module)).join('')}
      </section>
    `;
  }

  renderModule(module) {
    const state = this.state[module.id] || clone(module.defaults);
    const isManualQuote = module.id === 'grand-format';
    return `
      <article class="panel" data-module="${module.id}">
        <div class="panel-head">
          <div>
            <small>${module.metric}</small>
            <h2>${module.title}</h2>
          </div>
          <div class="status-chip ${state.enabled ? '' : 'off'}">
            <i class="fas ${state.enabled ? 'fa-circle-check' : 'fa-circle-pause'}"></i>
            <span>${state.enabled ? 'Actif' : 'Inactif'}</span>
          </div>
        </div>
        <p>${module.description}</p>

        <div class="stack" style="margin-top:1rem;">
          <label class="toggle">
            <input type="checkbox" data-field="enabled" ${state.enabled ? 'checked' : ''}>
            <span>Module actif</span>
          </label>

          ${isManualQuote ? this.renderGrandFormatFields(module.id, state) : this.renderStructuredFields(module.id, state)}

          <div class="actions">
            <button class="btn-primary" type="button" data-save-module="${module.id}">Enregistrer</button>
            ${!isManualQuote ? `
              <button class="btn-secondary" type="button" data-add-dimension="${module.id}">Ajouter une dimension</button>
              <button class="btn-secondary" type="button" data-add-paper="${module.id}">Ajouter un papier</button>
            ` : ''}
            <button class="btn-secondary" type="button" data-reset-module="${module.id}">Reinitialiser</button>
          </div>
        </div>
      </article>
    `;
  }

  renderStructuredFields(moduleId, state) {
    const pricingEntries = Object.entries(state.pricing || {});
    return `
      <div class="field-grid">
        ${pricingEntries.map(([key, value]) => `
          <label class="field">
            <span>${this.getPricingLabel(key)}</span>
            <input class="input" type="number" step="0.01" min="0" data-pricing-module="${moduleId}" data-pricing-key="${key}" value="${value ?? 0}">
          </label>
        `).join('')}
      </div>

      <div class="option-list">
        <div class="option-title">Dimensions</div>
        ${(state.dimensions || []).map((item, index) => this.renderOptionRow(moduleId, 'dimensions', item, index)).join('')}
      </div>

      <div class="option-list">
        <div class="option-title">Types de papier</div>
        ${(state.papers || []).map((item, index) => this.renderOptionRow(moduleId, 'papers', item, index)).join('')}
      </div>

      <label class="field">
        <span>Note admin</span>
        <textarea class="textarea" data-field="notes">${state.notes || ''}</textarea>
      </label>
    `;
  }

  renderGrandFormatFields(moduleId, state) {
    return `
      <div class="field-grid">
        <label class="field">
          <span>Numero WhatsApp</span>
          <input class="input" data-field="whatsappNumber" value="${state.whatsappNumber || ''}" placeholder="+509...">
        </label>
        <label class="field">
          <span>Canal</span>
          <input class="input" value="WhatsApp / devis manuel" disabled>
        </label>
      </div>
      <label class="field">
        <span>Message WhatsApp par defaut</span>
        <textarea class="textarea" data-field="whatsappMessage">${state.whatsappMessage || ''}</textarea>
      </label>
      <label class="field">
        <span>Note admin</span>
        <textarea class="textarea" data-field="notes">${state.notes || ''}</textarea>
      </label>
      <p class="hint">Le calcul public n'est pas active ici. Ce module reste sur un workflow de brief et devis manuel, comme prevu dans le plan.</p>
    `;
  }

  renderOptionRow(moduleId, listKey, item, index) {
    return `
      <div class="option-row" data-option-row="${moduleId}-${listKey}-${index}">
        <input class="mini-input" data-list-module="${moduleId}" data-list-key="${listKey}" data-list-index="${index}" data-list-field="label" value="${item.label || ''}" placeholder="Label">
        <input class="mini-input" type="number" step="0.01" min="0" data-list-module="${moduleId}" data-list-key="${listKey}" data-list-index="${index}" data-list-field="price" value="${item.price ?? 0}" placeholder="Prix">
        <label class="check">
          <input type="checkbox" data-list-module="${moduleId}" data-list-key="${listKey}" data-list-index="${index}" data-list-field="enabled" ${item.enabled ? 'checked' : ''}>
          <span>Actif</span>
        </label>
        <button class="btn-danger" type="button" data-remove-option="${moduleId}" data-remove-list="${listKey}" data-remove-index="${index}">Retirer</button>
      </div>
    `;
  }

  getPricingLabel(key) {
    const labels = {
      basePrice: 'Prix de base',
      perPagePrice: 'Prix / page',
      perCopyPrice: 'Prix / copie',
      perUnitPrice: 'Prix / tirage',
      rushPrice: 'Supplement urgence',
      perSheetPrice: 'Prix / plan',
      oversizedPrice: 'Supplement grand format'
    };
    return labels[key] || key;
  }

  attachEvents() {
    this.root.querySelectorAll('[data-save-module]').forEach((button) => {
      button.addEventListener('click', async () => {
        await this.saveModule(button.dataset.saveModule);
      });
    });

    this.root.querySelectorAll('[data-reset-module]').forEach((button) => {
      button.addEventListener('click', () => {
        const module = MODULES.find((entry) => entry.id === button.dataset.resetModule);
        if (!module) return;
        this.state[module.id] = clone(module.defaults);
        this.render();
        this.attachEvents();
      });
    });

    this.root.querySelectorAll('[data-add-dimension]').forEach((button) => {
      button.addEventListener('click', () => {
        this.addOption(button.dataset.addDimension, 'dimensions');
      });
    });

    this.root.querySelectorAll('[data-add-paper]').forEach((button) => {
      button.addEventListener('click', () => {
        this.addOption(button.dataset.addPaper, 'papers');
      });
    });

    this.root.querySelectorAll('[data-remove-option]').forEach((button) => {
      button.addEventListener('click', () => {
        this.removeOption(button.dataset.removeOption, button.dataset.removeList, Number.parseInt(button.dataset.removeIndex || '0', 10));
      });
    });
  }

  addOption(moduleId, listKey) {
    const state = this.state[moduleId];
    if (!state) return;
    state[listKey] = Array.isArray(state[listKey]) ? state[listKey] : [];
    state[listKey].push({ label: '', enabled: true, price: 0 });
    this.render();
    this.attachEvents();
  }

  removeOption(moduleId, listKey, index) {
    const state = this.state[moduleId];
    if (!state || !Array.isArray(state[listKey])) return;
    state[listKey].splice(index, 1);
    this.render();
    this.attachEvents();
  }

  collectModuleState(moduleId) {
    const panel = this.root.querySelector(`[data-module="${moduleId}"]`);
    const current = this.state[moduleId];
    if (!panel || !current) return current;

    const nextState = {
      ...clone(current),
      enabled: !!panel.querySelector('[data-field="enabled"]')?.checked
    };

    panel.querySelectorAll('[data-field]').forEach((field) => {
      const key = field.dataset.field;
      if (!key || key === 'enabled') return;
      nextState[key] = field.value;
    });

    panel.querySelectorAll('[data-pricing-module]').forEach((field) => {
      const pricingKey = field.dataset.pricingKey;
      nextState.pricing = nextState.pricing || {};
      nextState.pricing[pricingKey] = Number.parseFloat(field.value || '0') || 0;
    });

    const listMap = { dimensions: [], papers: [] };
    panel.querySelectorAll('[data-list-module]').forEach((field) => {
      const listKey = field.dataset.listKey;
      const index = Number.parseInt(field.dataset.listIndex || '0', 10);
      const itemField = field.dataset.listField;
      if (!listMap[listKey]) return;
      listMap[listKey][index] = listMap[listKey][index] || {};
      listMap[listKey][index][itemField] = itemField === 'enabled'
        ? !!field.checked
        : itemField === 'price'
          ? Number.parseFloat(field.value || '0') || 0
          : field.value;
    });

    if (Array.isArray(current.dimensions)) {
      nextState.dimensions = listMap.dimensions.filter(Boolean);
    }
    if (Array.isArray(current.papers)) {
      nextState.papers = listMap.papers.filter(Boolean);
    }

    return nextState;
  }

  async saveModule(moduleId) {
    const module = MODULES.find((entry) => entry.id === moduleId);
    if (!module) return;
    const nextState = this.collectModuleState(moduleId);
    const payload = {
      ...nextState,
      updatedAt: new Date().toISOString(),
      updatedBy: 'dashboard_admin'
    };
    await setDoc(doc(db, 'printingSettings', moduleId), payload, { merge: true });
    this.state[moduleId] = nextState;
    this.render();
    this.attachEvents();
    this.showToast(`${module.title} enregistre dans Firebase.`);
  }

  showToast(message) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 99999;
      background: #0f9f6e;
      color: #fff;
      padding: 0.9rem 1rem;
      border-radius: 14px;
      box-shadow: 0 18px 40px rgba(0,0,0,0.18);
      font: 600 0.9rem Manrope, sans-serif;
      opacity: 0;
      transform: translateY(12px);
      transition: all .2s ease;
    `;
    document.body.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      setTimeout(() => toast.remove(), 220);
    }, 2200);
  }
}

new PrintingDashboard();
