// Studio de personnalisation - controleur principal.
// Assemble: personalization-config.js (catalogue produits), personalization-editor.js
// (moteur de calques 2D), personalization-3d.js (rendu 3D / fallback 2D),
// personalization-storage.js (upload + controle qualite), personalization-illustrations.js
// (bibliotheque integree) et reutilise le panier / la livraison impression existants.

import { getCartManager } from './cart.js?v=20260829-16';
import { PrintingDeliveryController } from './printing-delivery-utils.js?v=20260829-16';
import { formatPriceDual, loadCurrencySettings } from './currency-utils.js';
import {
  getActivePersonalizationProducts,
  getPersonalizationProduct,
  getProductColor,
  getProductSize,
  getProductPrintAreas,
  getProductPrintArea,
  computePersonalizationPrice
} from './personalization-config.js?v=20260829-16';
import { PersonalizationEditor, FONT_OPTIONS } from './personalization-editor.js';
import { ILLUSTRATION_LIBRARY } from './personalization-illustrations.js';
import {
  validateImportedImage,
  assessImageQuality,
  uploadOriginalImage,
  uploadPrintFile,
  uploadPreviewImage,
  generateDesignId
} from './personalization-storage.js';

const FACE_LABELS = { front: 'Recto', back: 'Verso', wrap: 'Surface' };
const QUALITY_LABELS = {
  excellente: { label: 'Excellente qualite', className: 'is-good' },
  acceptable: { label: 'Qualite acceptable', className: 'is-mid' },
  insuffisante: { label: 'Resolution insuffisante', className: 'is-bad' },
  inconnue: { label: 'Qualite inconnue', className: 'is-mid' }
};

class PersonalizationStudio {
  constructor(containerId = 'personalization-root') {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.products = getActivePersonalizationProducts();
    this.product = this.products[0] || null;
    this.colorId = this.product?.colors?.[0]?.id || '';
    this.sizeId = this.product?.sizes?.[0]?.id || '';
    this.quantity = this.product?.quantity?.default || 1;
    this.designId = generateDesignId();
    this.mobileStep = 1;
    this.activeTool = 'image';
    this.viewMode = 'preview';
    this.finalPreview = false;
    this.isSubmitting = false;
    this.submitStatus = null;

    this.editor = new PersonalizationEditor({ product: this.product });
    this.editor.addEventListener('change', (event) => this._onEditorChange(event));

    this.cart = getCartManager({ imageBasePath: './' });
    this.deliveryController = new PrintingDeliveryController({
      getContainer: () => this.container.querySelector('#pzDeliveryContainer'),
      escape: (value) => this.escape(value),
      formatPrice: (value) => this.formatPrice(value),
      moduleId: 'personalization',
      metricLabel: 'article(s)',
      getMetricValue: () => this.quantity,
      onChange: () => { this._renderDelivery(); this._renderBottomBar(); }
    });

    this.viewer = null;
    this.init();
  }

  async init() {
    await loadCurrencySettings();
    await this.deliveryController.init();
    ILLUSTRATION_LIBRARY.forEach((item) => this.editor.registerIllustrationSource(item.id, item.svg));
    const restoredFromCart = await this._restoreCartEdit();
    if (!restoredFromCart) await this._restoreDraft();
    this.editor.setBackgroundColor(this.getColor()?.hex || '#ffffff');
    this.renderShell();
    this.attachStaticEvents();
    await this._mountViewer();
    this._renderAll();
  }

  // ---------- helpers ----------

  escape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  formatPrice(value) {
    return formatPriceDual(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  _openDraftDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { resolve(null); return; }
      const request = indexedDB.open('smartcut-personalization', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async _restoreCartEdit() {
    try {
      const raw = sessionStorage.getItem('smartcut-personalization-edit');
      if (!raw) return false;
      sessionStorage.removeItem('smartcut-personalization-edit');
      const payload = JSON.parse(raw);
      const config = payload?.personalizationConfig;
      const product = getPersonalizationProduct(config?.productId);
      if (!product || !config?.layers) return false;
      this.product = product;
      this.colorId = getProductColor(product, config.colorId)?.id || product.colors?.[0]?.id || '';
      this.sizeId = getProductSize(product, config.sizeId)?.id || product.sizes?.[0]?.id || '';
      this.quantity = Math.max(product.quantity?.min || 1, Math.min(Number(config.quantity) || 1, product.quantity?.max || 999));
      this.designId = payload.designId || this.designId;
      this.editCartIndex = Number.isInteger(payload.cartIndex) ? payload.cartIndex : null;
      this.editor.setProduct(product);
      await this.editor.restore({
        layers: Object.values(config.layers).flat(),
        currentFace: config.currentFace || product.faces?.[0],
        currentAreaId: config.currentAreaId || config.areasUsed?.[0]
      });
      return true;
    } catch (error) {
      console.warn('[personalization] restauration panier impossible', error);
      return false;
    }
  }

  async _saveDraft(showFeedback = false) {
    try {
      const db = await this._openDraftDb();
      if (!db) return;
      const payload = {
        version: 2,
        savedAt: Date.now(),
        productId: this.product?.id,
        colorId: this.colorId,
        sizeId: this.sizeId,
        quantity: this.quantity,
        editor: this.editor.exportDraft()
      };
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('drafts', 'readwrite');
        transaction.objectStore('drafts').put(payload, 'active');
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      db.close();
      const state = this.container?.querySelector('#pzSaveState');
      if (state) state.textContent = showFeedback ? 'Création enregistrée' : 'Enregistré automatiquement';
    } catch (error) {
      console.warn('[personalization] sauvegarde locale indisponible', error);
      const state = this.container?.querySelector('#pzSaveState');
      if (state && showFeedback) state.textContent = 'Sauvegarde impossible';
    }
  }

  async _restoreDraft() {
    try {
      const db = await this._openDraftDb();
      if (!db) return;
      const payload = await new Promise((resolve, reject) => {
        const transaction = db.transaction('drafts', 'readonly');
        const request = transaction.objectStore('drafts').get('active');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      db.close();
      if (!payload?.productId || !payload.editor) return;
      const product = getPersonalizationProduct(payload.productId);
      if (!product) return;
      this.product = product;
      this.colorId = getProductColor(product, payload.colorId)?.id || product.colors?.[0]?.id || '';
      this.sizeId = getProductSize(product, payload.sizeId)?.id || product.sizes?.[0]?.id || '';
      this.quantity = Math.max(product.quantity?.min || 1, Math.min(Number(payload.quantity) || 1, product.quantity?.max || 999));
      this.editor.setProduct(product);
      await this.editor.restore(payload.editor);
    } catch (error) {
      console.warn('[personalization] restauration locale indisponible', error);
    }
  }

  _queueAutosave() {
    clearTimeout(this._autosaveTimer);
    const state = this.container?.querySelector('#pzSaveState');
    if (state) state.textContent = 'Modifications non enregistrées';
    this._autosaveTimer = setTimeout(() => this._saveDraft(false), 700);
  }

  getColor() { return getProductColor(this.product, this.colorId); }
  getSize() { return getProductSize(this.product, this.sizeId); }
  getFaceLabel(face) {
    if (face === 'wrap') return this.product?.category === 'tumbler' ? 'Tumbler' : 'Tasse';
    return FACE_LABELS[face] || face || '';
  }

  getFacesUsed() {
    const withContent = this.editor.facesWithContent();
    return (this.product?.faces || []).filter((face) => withContent.includes(face));
  }

  getAreasUsed() { return this.editor.areasWithContent(); }
  getCurrentArea() { return getProductPrintArea(this.product, this.editor.getAreaId()); }

  getPriceQuote() {
    const facesUsed = this.getFacesUsed();
    return computePersonalizationPrice({
      product: this.product,
      sizeId: this.sizeId,
      quantity: this.quantity,
      facesUsed: facesUsed.length ? facesUsed : [this.product?.faces?.[0]],
      areasUsed: this.getAreasUsed()
    });
  }

  // ---------- structure statique ----------

  renderShell() {
    this.container.innerHTML = `
      <div class="pz-app">
        <header class="pz-workbar">
          <div class="pz-workbar-main">
            <a class="pz-studio-brand" href="./index.html" aria-label="Retour à l'accueil Smart Cut Services">
              <img src="./logo.png" alt="Smart Cut Services">
              <span>Smart Cut</span>
            </a>
            <a class="pz-icon-action" href="./printing-hub.html" aria-label="Retour à l'imprimerie"><i class="fas fa-arrow-left" aria-hidden="true"></i></a>
            <div><span>Studio d'impression</span><strong id="pzWorkbarTitle">${this.escape(this.product?.name || '')}</strong></div>
          </div>
          <div class="pz-workbar-actions">
            <span class="pz-save-state" id="pzSaveState">Création locale</span>
            <button type="button" class="pz-icon-action" id="pzUndoBtn" aria-label="Annuler" title="Annuler"><i class="fas fa-rotate-left" aria-hidden="true"></i></button>
            <button type="button" class="pz-icon-action" id="pzRedoBtn" aria-label="Rétablir" title="Rétablir"><i class="fas fa-rotate-right" aria-hidden="true"></i></button>
            <button type="button" class="pz-btn ghost compact" id="pzSaveBtn">Enregistrer</button>
            <button type="button" class="pz-btn primary compact" id="pzFinalPreviewBtn">Aperçu final</button>
          </div>
        </header>

        <nav class="pz-mobile-steps" aria-label="Etapes de personnalisation">
          <button type="button" class="pz-mobile-step" data-mobile-step="1"><span>1</span>Produit</button>
          <button type="button" class="pz-mobile-step" data-mobile-step="2"><span>2</span>Personnaliser</button>
          <button type="button" class="pz-mobile-step" data-mobile-step="3"><span>3</span>Commander</button>
        </nav>

        <section class="pz-col pz-col-left" data-pz-step="1" aria-label="Choix du produit">
          <div id="pzLeftContent"></div>
        </section>

        <section class="pz-col pz-col-center" data-pz-step="2" aria-label="Apercu et edition">
          <div class="pz-center-inner">
            <div class="pz-viewer-head">
              <div>
                <span id="pzActiveAreaKicker">Emplacement</span>
                <h2 id="pzProductTitle"></h2>
              </div>
              <div class="pz-view-switch" role="group" aria-label="Mode d'affichage">
                <button type="button" data-view-mode="preview" class="is-active">Aperçu 3D</button>
                <button type="button" data-view-mode="edit">Placement précis</button>
              </div>
            </div>
            <div class="pz-view-surface is-active" data-view-surface="preview">
              <div class="pz-viewer" id="pzViewer" role="img" aria-label="Aperçu 3D du produit personnalisé"></div>
              <div class="pz-camera-presets" role="group" aria-label="Angles de prévisualisation">
                <button type="button" data-camera-view="front">Recto</button>
                <button type="button" data-camera-view="back">Verso</button>
                <button type="button" data-camera-view="left">Profil gauche</button>
                <button type="button" data-camera-view="right">Profil droit</button>
              </div>
              <p class="pz-viewer-help"><i class="fas fa-arrows-rotate" aria-hidden="true"></i> Glissez pour tourner · pincez ou utilisez la molette pour zoomer</p>
            </div>
            <div class="pz-edit-stage-wrap pz-view-surface" data-view-surface="edit">
              <div class="pz-edit-stage-head">
                <strong id="pzEditStageLabel">Zone d'edition</strong>
                <div class="pz-edit-stage-actions">
                  <button type="button" class="pz-mini-btn" id="pzCenterLayerBtn"><i class="fas fa-crosshairs" aria-hidden="true"></i> Centrer</button>
                  <button type="button" class="pz-mini-btn danger" id="pzResetFaceBtn"><i class="fas fa-trash" aria-hidden="true"></i> Vider la zone</button>
                </div>
              </div>
              <div class="pz-edit-stage" id="pzEditStage"></div>
              <div class="pz-bounds-warning" id="pzBoundsWarning" hidden>
                <i class="fas fa-triangle-exclamation" aria-hidden="true"></i>
                Un ou plusieurs elements depassent la zone imprimable et pourraient etre coupes a l'impression.
              </div>
            </div>
          </div>
        </section>

        <section class="pz-col pz-col-right" data-pz-step="2" aria-label="Outils de personnalisation">
          <div class="pz-tool-tabs" role="tablist" aria-label="Outils">
            <button type="button" class="pz-tool-tab" data-tool="image" role="tab"><i class="fas fa-image" aria-hidden="true"></i> Image</button>
            <button type="button" class="pz-tool-tab" data-tool="text" role="tab"><i class="fas fa-font" aria-hidden="true"></i> Texte</button>
            <button type="button" class="pz-tool-tab" data-tool="layers" role="tab"><i class="fas fa-layer-group" aria-hidden="true"></i> Calques</button>
          </div>
          <div id="pzToolPanel" class="pz-tool-panel"></div>
        </section>

        <section class="pz-col pz-col-bottom" data-pz-step="3" aria-label="Prix et commande">
          <div id="pzBottomBar"></div>
        </section>
      </div>
    `;
  }

  attachStaticEvents() {
    this.container.querySelectorAll('[data-mobile-step]').forEach((btn) => {
      btn.addEventListener('click', () => this._setMobileStep(Number(btn.dataset.mobileStep)));
    });
    this.container.querySelectorAll('[data-tool]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTool = btn.dataset.tool;
        this._renderToolTabs();
        this._renderToolPanel();
      });
    });
    this.container.querySelector('#pzCenterLayerBtn')?.addEventListener('click', () => {
      const layer = this.editor.getSelectedLayer();
      if (layer) this.editor.centerLayer(layer.id);
    });
    this.container.querySelector('#pzResetFaceBtn')?.addEventListener('click', () => {
      if (window.confirm('Effacer tous les éléments de cet emplacement ?')) {
        this.editor.resetArea(this.editor.getAreaId());
      }
    });
    this.container.querySelector('#pzUndoBtn')?.addEventListener('click', () => this.editor.undo());
    this.container.querySelector('#pzRedoBtn')?.addEventListener('click', () => this.editor.redo());
    this.container.querySelector('#pzSaveBtn')?.addEventListener('click', () => this._saveDraft(true));
    this.container.querySelector('#pzFinalPreviewBtn')?.addEventListener('click', () => this._toggleFinalPreview());
    this.container.querySelectorAll('[data-camera-view]').forEach((button) => {
      button.addEventListener('click', () => this.viewer?.focusFace?.(button.dataset.cameraView));
    });
    this.container.querySelectorAll('[data-view-mode]').forEach((button) => {
      button.addEventListener('click', () => this._setViewMode(button.dataset.viewMode));
    });
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.finalPreview) this._toggleFinalPreview(false);
    });
  }

  _setViewMode(mode) {
    this.viewMode = mode === 'edit' ? 'edit' : 'preview';
    this.container.querySelectorAll('[data-view-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.viewMode === this.viewMode));
    this.container.querySelectorAll('[data-view-surface]').forEach((surface) => surface.classList.toggle('is-active', surface.dataset.viewSurface === this.viewMode));
    if (this.viewMode === 'edit') this._renderEditStage();
  }

  _toggleFinalPreview(force) {
    this.finalPreview = typeof force === 'boolean' ? force : !this.finalPreview;
    this._setViewMode('preview');
    this.container.querySelector('.pz-app')?.classList.toggle('is-final-preview', this.finalPreview);
    const button = this.container.querySelector('#pzFinalPreviewBtn');
    if (button) button.textContent = this.finalPreview ? 'Quitter l’aperçu' : 'Aperçu final';
    this.viewer?.focusFace?.(this.editor.getFace());
  }

  _setMobileStep(step) {
    this.mobileStep = step;
    this.container.querySelectorAll('[data-mobile-step]').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.mobileStep) === step);
    });
    this.container.querySelectorAll('[data-pz-step]').forEach((section) => {
      section.classList.toggle('is-active-step', Number(section.dataset.pzStep) === step);
    });
  }

  // ---------- rendu dynamique ----------

  _renderAll() {
    this._renderLeftColumn();
    this._renderToolTabs();
    this._renderToolPanel();
    this._renderBottomBar();
    this._renderDelivery();
    this._renderEditStage();
    this._updateViewerHead();
    this._setMobileStep(this.mobileStep);
    this._setViewMode(this.viewMode);
  }

  _updateViewerHead() {
    const title = this.container.querySelector('#pzProductTitle');
    const area = this.getCurrentArea();
    if (title) title.textContent = area?.label || this.product?.name || '';
    const workbarTitle = this.container.querySelector('#pzWorkbarTitle');
    if (workbarTitle) workbarTitle.textContent = this.product?.name || '';
    const kicker = this.container.querySelector('#pzActiveAreaKicker');
    if (kicker) kicker.textContent = `${this.getFaceLabel(this.editor.getFace())} · emplacement actif`;
    const label = this.container.querySelector('#pzEditStageLabel');
    if (label) label.textContent = area?.label || 'Zone d’édition';
    const undo = this.container.querySelector('#pzUndoBtn');
    const redo = this.container.querySelector('#pzRedoBtn');
    if (undo) undo.disabled = !this.editor.canUndo();
    if (redo) redo.disabled = !this.editor.canRedo();
    const backView = this.container.querySelector('[data-camera-view="back"]');
    if (backView) backView.hidden = !(this.product?.faces || []).includes('back');
  }

  _renderLeftColumn() {
    const el = this.container.querySelector('#pzLeftContent');
    if (!el) return;
    const color = this.getColor();
    const size = this.getSize();
    const areas = getProductPrintAreas(this.product);
    const currentAreaId = this.editor.getAreaId();

    el.innerHTML = `
      <div class="pz-config-panel">
        <div class="pz-config-heading"><span>01</span><div><strong>Support</strong><small>Choisissez le produit à imprimer.</small></div></div>
        <div class="pz-product-grid" role="list" aria-label="Produits personnalisables">
          ${this.products.map((product) => `
            <button type="button" class="pz-product-card ${product.id === this.product.id ? 'is-active' : ''}" data-select-product="${this.escape(product.id)}">
              <img src="${product.thumbnail}" alt="" loading="lazy">
              <span>${this.escape(product.name)}</span>
            </button>
          `).join('')}
        </div>
        <div class="pz-compact-options">
          <div><span class="pz-control-label">Couleur · ${this.escape(color?.label || '')}</span><div class="pz-swatches">
            ${(this.product.colors || []).map((c) => `<button type="button" class="pz-swatch ${c.id === this.colorId ? 'is-active' : ''}" data-select-color="${this.escape(c.id)}" style="--swatch:${c.hex};background-color:${c.hex}" title="${this.escape(c.label)}" aria-label="${this.escape(c.label)}"></button>`).join('')}
          </div></div>
          <div><span class="pz-control-label">Format</span><div class="pz-pill-group">
            ${(this.product.sizes || []).map((s) => `<button type="button" class="pz-pill ${s.id === this.sizeId ? 'is-active' : ''}" data-select-size="${this.escape(s.id)}">${this.escape(s.label)}${s.priceDelta ? ` +${this.formatPrice(s.priceDelta)}` : ''}</button>`).join('')}
          </div></div>
        </div>

        <div class="pz-config-divider"></div>
        <div class="pz-config-heading"><span>02</span><div><strong>Emplacement</strong><small>Chaque emplacement conserve ses propres calques.</small></div></div>
        <div class="pz-area-list">
          ${areas.map((area) => {
            const count = this.editor.getLayersForArea(area.id).length;
            return `<button type="button" class="pz-area-option ${area.id === currentAreaId ? 'is-active' : ''}" data-select-area="${this.escape(area.id)}">
              <span><b>${this.escape(area.shortLabel || area.label)}</b><small>${this.escape(this.getFaceLabel(area.face))}</small></span>
              ${count ? `<em>${count}</em>` : '<i class="fas fa-plus" aria-hidden="true"></i>'}
            </button>`;
          }).join('')}
        </div>
      </div>
    `;

    el.querySelectorAll('[data-select-product]').forEach((btn) => {
      btn.addEventListener('click', () => this._selectProduct(btn.dataset.selectProduct));
    });
    el.querySelectorAll('[data-select-color]').forEach((btn) => {
      btn.addEventListener('click', () => this._selectColor(btn.dataset.selectColor));
    });
    el.querySelectorAll('[data-select-size]').forEach((btn) => {
      btn.addEventListener('click', () => { this.sizeId = btn.dataset.selectSize; this._renderLeftColumn(); this._renderBottomBar(); this._queueAutosave(); });
    });
    el.querySelectorAll('[data-select-area]').forEach((btn) => {
      btn.addEventListener('click', () => { this.editor.setPrintArea(btn.dataset.selectArea); });
    });
  }

  _setQuantity(value) {
    const min = this.product.quantity?.min || 1;
    const max = this.product.quantity?.max || 999;
    this.quantity = Math.min(max, Math.max(min, Math.round(Number(value) || min)));
    this._renderLeftColumn();
    this._renderBottomBar();
    this._renderDelivery();
    this._queueAutosave();
  }

  async _selectProduct(productId) {
    if (productId === this.product?.id) return;
    this.product = getPersonalizationProduct(productId) || this.product;
    this.colorId = this.product.colors?.[0]?.id || '';
    this.sizeId = this.product.sizes?.[0]?.id || '';
    this.quantity = this.product.quantity?.default || 1;
    this.designId = generateDesignId();
    this.editor.setProduct(this.product);
    this.editor.setBackgroundColor(this.getColor()?.hex || '#ffffff');
    await this._mountViewer();
    this._renderAll();
  }

  async _selectColor(colorId) {
    this.colorId = colorId;
    this._renderLeftColumn();
    const hex = this.getColor()?.hex || '#ffffff';
    this.editor.setBackgroundColor(hex);
    this.viewer?.setColor?.(hex);
    this.viewer?.refreshAllTextures?.();
    this._queueAutosave();
  }

  // ---------- viewer 3D ----------

  async _mountViewer() {
    const container = this.container.querySelector('#pzViewer');
    if (!container) return;
    this.viewer?.dispose?.();
    container.innerHTML = '<div class="pz-viewer-loading"><i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Chargement de l\'apercu 3D...</div>';
    try {
      const { createProductViewer } = await import('./personalization-3d.js');
      this.viewer = await createProductViewer({
        container,
        editor: this.editor,
        product: this.product,
        color: this.getColor()?.hex || '#ffffff'
      });
    } catch (error) {
      console.error('[personalization] viewer indisponible:', error);
      container.innerHTML = '<div class="pz-viewer-error"><i class="fas fa-triangle-exclamation" aria-hidden="true"></i> Apercu indisponible pour le moment.</div>';
    }
  }

  // ---------- zone d'edition ----------

  _renderEditStage() {
    const stage = this.container.querySelector('#pzEditStage');
    if (!stage) return;
    this.editor.mountInteractiveStage(stage);
  }

  _onEditorChange(event) {
    this._updateViewerHead();
    this.viewer?.refreshTexture?.(this.editor.getFace());
    if (event?.detail?.areaChanged) {
      this._renderLeftColumn();
      this.viewer?.focusFace?.(this.editor.getFace());
    }

    const selected = this.editor.getSelectedLayer();
    if (selected?.type === 'image' && selected.naturalWidth) {
      const quality = assessImageQuality({
        naturalWidth: selected.naturalWidth,
        naturalHeight: selected.naturalHeight,
        layerW: selected.w,
        layerH: selected.h,
        product: this.product,
        printArea: getProductPrintArea(this.product, selected.areaId)
      });
      this.editor.setLayerQuality(selected.id, quality);
    }

    const boundsWarning = this.container.querySelector('#pzBoundsWarning');
    if (boundsWarning) boundsWarning.hidden = !this.editor.hasOutOfBoundsLayers();

    if (!event?.detail?.live) {
      this._renderLeftColumn();
      this._renderToolPanel();
      this._renderBottomBar();
      if (!event?.detail?.restored) this._queueAutosave();
    }
  }

  // ---------- panneau outils (droite) ----------

  _renderToolTabs() {
    this.container.querySelectorAll('[data-tool]').forEach((btn) => {
      const active = btn.dataset.tool === this.activeTool;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  _renderToolPanel() {
    const panel = this.container.querySelector('#pzToolPanel');
    if (!panel) return;
    if (this.activeTool === 'text') panel.innerHTML = this._textToolMarkup();
    else if (this.activeTool === 'image') panel.innerHTML = this._imageToolMarkup();
    else if (this.activeTool === 'library') panel.innerHTML = this._libraryToolMarkup();
    else panel.innerHTML = this._layersToolMarkup();
    this._bindToolPanelEvents(panel);
  }

  _selectedTextLayerOrNull() {
    const layer = this.editor.getSelectedLayer();
    return layer?.type === 'text' ? layer : null;
  }

  _textToolMarkup() {
    const layer = this._selectedTextLayerOrNull();
    return `
      <div class="pz-panel">
        <button type="button" class="pz-btn primary" id="pzAddTextBtn"><i class="fas fa-plus" aria-hidden="true"></i> Ajouter du texte</button>
      </div>
      ${layer ? `
        <div class="pz-panel">
          <h3>Modifier le texte</h3>
          <label class="pz-field">
            <span>Contenu</span>
            <textarea id="pzTextContent" rows="2">${this.escape(layer.text)}</textarea>
          </label>
          <label class="pz-field">
            <span>Police</span>
            <select id="pzTextFont">
              ${FONT_OPTIONS.map((font) => `<option value="${font.id}" ${font.id === layer.fontId ? 'selected' : ''}>${this.escape(font.label)}</option>`).join('')}
            </select>
          </label>
          <div class="pz-field-row">
            <label class="pz-field">
              <span>Taille</span>
              <input type="range" id="pzTextSize" min="0.02" max="0.22" step="0.005" value="${layer.fontSize}">
            </label>
            <label class="pz-field">
              <span>Couleur</span>
              <input type="color" id="pzTextColor" value="${layer.color}">
            </label>
          </div>
          <div class="pz-field-row">
            <div class="pz-align-group" role="group" aria-label="Alignement">
              <button type="button" class="pz-mini-btn ${layer.align === 'left' ? 'is-active' : ''}" data-align="left" aria-label="Aligner a gauche"><i class="fas fa-align-left" aria-hidden="true"></i></button>
              <button type="button" class="pz-mini-btn ${layer.align === 'center' ? 'is-active' : ''}" data-align="center" aria-label="Centrer"><i class="fas fa-align-center" aria-hidden="true"></i></button>
              <button type="button" class="pz-mini-btn ${layer.align === 'right' ? 'is-active' : ''}" data-align="right" aria-label="Aligner a droite"><i class="fas fa-align-right" aria-hidden="true"></i></button>
            </div>
            <div class="pz-align-group" role="group" aria-label="Style">
              <button type="button" class="pz-mini-btn ${layer.bold ? 'is-active' : ''}" id="pzTextBold" aria-label="Gras"><i class="fas fa-bold" aria-hidden="true"></i></button>
              <button type="button" class="pz-mini-btn ${layer.italic ? 'is-active' : ''}" id="pzTextItalic" aria-label="Italique"><i class="fas fa-italic" aria-hidden="true"></i></button>
            </div>
          </div>
          ${this._layerActionsMarkup(layer)}
        </div>
      ` : `<div class="pz-hint">Selectionnez un texte sur la zone d'edition pour le modifier, ou ajoutez-en un nouveau.</div>`}
    `;
  }

  _imageToolMarkup() {
    const layer = this.editor.getSelectedLayer();
    const isImage = layer?.type === 'image';
    const quality = isImage ? (layer.quality || { status: 'inconnue' }) : null;
    const qualityInfo = quality ? (QUALITY_LABELS[quality.status] || QUALITY_LABELS.inconnue) : null;
    return `
      <div class="pz-panel">
        <h3>Importer une image</h3>
        <label class="pz-upload" for="pzImageFile">
          <i class="fas fa-cloud-arrow-up" aria-hidden="true"></i>
          <span>PNG, JPG ou WEBP, 15 Mo maximum</span>
          <input type="file" id="pzImageFile" accept="image/png,image/jpeg,image/webp" multiple hidden>
        </label>
        <div id="pzImageStatus" class="pz-hint"></div>
      </div>
      ${isImage ? `
        <div class="pz-panel">
          <h3>Qualite de l'image</h3>
          <div class="pz-quality-badge ${qualityInfo.className}">
            <i class="fas fa-circle" aria-hidden="true"></i> ${this.escape(qualityInfo.label)}
          </div>
          <p class="pz-hint">${this.escape(quality?.message || '')}</p>
          <p class="pz-hint">Fichier original: ${this.escape(layer.sourceFile?.name || '-')} (${layer.naturalWidth}x${layer.naturalHeight}px)</p>
          ${this._layerActionsMarkup(layer)}
        </div>
      ` : ''}
    `;
  }

  _libraryToolMarkup() {
    const layer = this.editor.getSelectedLayer();
    const isIllustration = layer?.type === 'illustration';
    return `
      <div class="pz-panel">
        <h3>Bibliotheque d'illustrations</h3>
        <div class="pz-illustration-grid">
          ${ILLUSTRATION_LIBRARY.map((item) => `
            <button type="button" class="pz-illustration-card" data-add-illustration="${this.escape(item.id)}" title="${this.escape(item.label)}">
              <span aria-hidden="true">${item.svg}</span>
            </button>
          `).join('')}
        </div>
      </div>
      ${isIllustration ? `
        <div class="pz-panel">
          <h3>Couleur de l'illustration</h3>
          <input type="color" id="pzIllustrationColor" value="${layer.color}">
          ${this._layerActionsMarkup(layer)}
        </div>
      ` : ''}
    `;
  }

  _layersToolMarkup() {
    const layers = this.editor.getLayersForArea(this.editor.getAreaId());
    const area = this.getCurrentArea();
    return `
      <div class="pz-panel">
        <h3>Calques · ${this.escape(area?.shortLabel || area?.label || '')}</h3>
        ${layers.length ? `
          <ul class="pz-layer-list">
            ${[...layers].reverse().map((layer) => `
              <li class="pz-layer-row ${layer.id === this.editor.selectedLayerId ? 'is-active' : ''}" data-layer-row="${this.escape(layer.id)}">
                <button type="button" class="pz-layer-row-select" data-select-layer="${this.escape(layer.id)}">
                  <i class="fas ${layer.type === 'text' ? 'fa-font' : layer.type === 'image' ? 'fa-image' : 'fa-shapes'}" aria-hidden="true"></i>
                  <span>${this.escape(layer.name || (layer.type === 'text' ? (layer.text || 'Texte') : layer.type === 'image' ? (layer.sourceFile?.name || 'Image') : 'Illustration'))}</span>
                  ${layer.outOfBounds ? '<i class="fas fa-triangle-exclamation pz-warn-icon" aria-hidden="true"></i>' : ''}
                </button>
                <div class="pz-layer-row-actions">
                  <button type="button" class="pz-mini-btn" data-layer-visible="${this.escape(layer.id)}" aria-label="${layer.visible === false ? 'Afficher' : 'Masquer'}"><i class="fas ${layer.visible === false ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i></button>
                  <button type="button" class="pz-mini-btn" data-layer-lock="${this.escape(layer.id)}" aria-label="${layer.locked ? 'Déverrouiller' : 'Verrouiller'}"><i class="fas ${layer.locked ? 'fa-lock' : 'fa-lock-open'}" aria-hidden="true"></i></button>
                  <button type="button" class="pz-mini-btn" data-layer-up="${this.escape(layer.id)}" aria-label="Monter"><i class="fas fa-arrow-up" aria-hidden="true"></i></button>
                  <button type="button" class="pz-mini-btn" data-layer-down="${this.escape(layer.id)}" aria-label="Descendre"><i class="fas fa-arrow-down" aria-hidden="true"></i></button>
                  <button type="button" class="pz-mini-btn" data-layer-delete="${this.escape(layer.id)}" aria-label="Supprimer"><i class="fas fa-trash" aria-hidden="true"></i></button>
                </div>
              </li>
            `).join('')}
          </ul>
        ` : `<div class="pz-hint">Aucun element sur cette face pour le moment.</div>`}
      </div>
    `;
  }

  _layerActionsMarkup(layer) {
    const otherAreas = getProductPrintAreas(this.product).filter((area) => area.id !== layer.areaId);
    return `
      <label class="pz-field"><span>Nom du calque</span><input type="text" value="${this.escape(layer.name || '')}" placeholder="${layer.type === 'text' ? 'Texte' : layer.type === 'image' ? 'Image' : 'Illustration'}" data-layer-name="${this.escape(layer.id)}"></label>
      <div class="pz-inspector-grid">
        <label class="pz-field"><span>Opacité</span><input type="range" min="0" max="1" step=".05" value="${layer.opacity}" data-layer-opacity="${this.escape(layer.id)}"></label>
        <label class="pz-field"><span>Rotation</span><input type="number" min="-180" max="180" step="1" value="${Math.round(layer.rotation || 0)}" data-layer-rotation="${this.escape(layer.id)}"></label>
      </div>
      <div class="pz-placement-grid" aria-label="Placement rapide">
        <button type="button" data-layer-place="left" data-layer-id="${this.escape(layer.id)}" title="À gauche"><i class="fas fa-align-left"></i></button>
        <button type="button" data-layer-place="center" data-layer-id="${this.escape(layer.id)}" title="Centrer"><i class="fas fa-crosshairs"></i></button>
        <button type="button" data-layer-place="right" data-layer-id="${this.escape(layer.id)}" title="À droite"><i class="fas fa-align-right"></i></button>
        <button type="button" data-layer-place="top" data-layer-id="${this.escape(layer.id)}" title="En haut"><i class="fas fa-arrow-up"></i></button>
        <button type="button" data-layer-place="bottom" data-layer-id="${this.escape(layer.id)}" title="En bas"><i class="fas fa-arrow-down"></i></button>
      </div>
      <div class="pz-field-row">
        <button type="button" class="pz-mini-btn" data-layer-duplicate="${this.escape(layer.id)}"><i class="fas fa-copy" aria-hidden="true"></i> Dupliquer</button>
        <button type="button" class="pz-mini-btn" data-layer-front="${this.escape(layer.id)}"><i class="fas fa-arrow-up" aria-hidden="true"></i> Premier plan</button>
        <button type="button" class="pz-mini-btn" data-layer-back="${this.escape(layer.id)}"><i class="fas fa-arrow-down" aria-hidden="true"></i> Arriere plan</button>
        <button type="button" class="pz-mini-btn danger" data-layer-remove="${this.escape(layer.id)}"><i class="fas fa-trash" aria-hidden="true"></i> Supprimer</button>
      </div>
      ${otherAreas.length ? `<div class="pz-copy-area"><select aria-label="Emplacement de destination" data-layer-copy-target="${this.escape(layer.id)}">${otherAreas.map((area) => `<option value="${this.escape(area.id)}">${this.escape(area.label)}</option>`).join('')}</select><button type="button" class="pz-mini-btn" data-layer-copy-area="${this.escape(layer.id)}"><i class="fas fa-share" aria-hidden="true"></i> Copier vers</button></div>` : ''}
    `;
  }

  _placeLayer(layerId, placement) {
    const layer = this.editor.layers.find((item) => item.id === layerId);
    const area = layer ? getProductPrintArea(this.product, layer.areaId) : null;
    const zone = area?.bounds;
    if (!layer || !zone) return;
    const marginX = Math.min(layer.w / 2, zone.width / 2);
    const marginY = Math.min(layer.h / 2, zone.height / 2);
    const patch = { cx: zone.x + zone.width / 2, cy: zone.y + zone.height / 2 };
    if (placement === 'left') patch.cx = zone.x + marginX;
    if (placement === 'right') patch.cx = zone.x + zone.width - marginX;
    if (placement === 'top') patch.cy = zone.y + marginY;
    if (placement === 'bottom') patch.cy = zone.y + zone.height - marginY;
    this.editor.updateLayer(layer.id, patch);
  }

  _bindToolPanelEvents(panel) {
    panel.querySelector('#pzAddTextBtn')?.addEventListener('click', () => {
      this.editor.addTextLayer({});
      this.activeTool = 'text';
    });

    const textLayer = this._selectedTextLayerOrNull();
    if (textLayer) {
      panel.querySelector('#pzTextContent')?.addEventListener('input', (e) => this.editor.updateLayer(textLayer.id, { text: e.target.value }));
      panel.querySelector('#pzTextFont')?.addEventListener('change', (e) => this.editor.updateLayer(textLayer.id, { fontId: e.target.value }));
      panel.querySelector('#pzTextSize')?.addEventListener('input', (e) => this.editor.updateLayer(textLayer.id, { fontSize: Number(e.target.value) }));
      panel.querySelector('#pzTextColor')?.addEventListener('input', (e) => this.editor.updateLayer(textLayer.id, { color: e.target.value }));
      panel.querySelectorAll('[data-align]').forEach((btn) => {
        btn.addEventListener('click', () => this.editor.updateLayer(textLayer.id, { align: btn.dataset.align }));
      });
      panel.querySelector('#pzTextBold')?.addEventListener('click', () => this.editor.updateLayer(textLayer.id, { bold: !textLayer.bold }));
      panel.querySelector('#pzTextItalic')?.addEventListener('click', () => this.editor.updateLayer(textLayer.id, { italic: !textLayer.italic }));
    }

    panel.querySelector('#pzImageFile')?.addEventListener('change', (event) => this._handleImageImport(event));
    const dropZone = panel.querySelector('.pz-upload');
    dropZone?.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('is-dragging'); });
    dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('is-dragging'));
    dropZone?.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('is-dragging');
      this._handleImageImport({ target: { files: event.dataTransfer?.files || [], value: '' } });
    });

    panel.querySelectorAll('[data-add-illustration]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = ILLUSTRATION_LIBRARY.find((i) => i.id === btn.dataset.addIllustration);
        if (!item) return;
        this.editor.registerIllustrationSource(item.id, item.svg);
        this.editor.addIllustrationLayer({ illustrationId: item.id, svgMarkup: item.svg, color: this.getColor()?.hex === '#0f1111' ? '#ffffff' : '#0f1111' });
        this.activeTool = 'library';
      });
    });
    const illustrationLayer = this.editor.getSelectedLayer()?.type === 'illustration' ? this.editor.getSelectedLayer() : null;
    if (illustrationLayer) {
      panel.querySelector('#pzIllustrationColor')?.addEventListener('input', (e) => this.editor.updateLayer(illustrationLayer.id, { color: e.target.value }));
    }

    panel.querySelectorAll('[data-select-layer]').forEach((btn) => btn.addEventListener('click', () => this.editor.selectLayer(btn.dataset.selectLayer)));
    panel.querySelectorAll('[data-layer-up]').forEach((btn) => btn.addEventListener('click', () => this.editor.bringForward(btn.dataset.layerUp)));
    panel.querySelectorAll('[data-layer-down]').forEach((btn) => btn.addEventListener('click', () => this.editor.sendBackward(btn.dataset.layerDown)));
    panel.querySelectorAll('[data-layer-delete]').forEach((btn) => btn.addEventListener('click', () => this.editor.removeLayer(btn.dataset.layerDelete)));
    panel.querySelectorAll('[data-layer-visible]').forEach((btn) => btn.addEventListener('click', () => this.editor.toggleLayerVisibility(btn.dataset.layerVisible)));
    panel.querySelectorAll('[data-layer-lock]').forEach((btn) => btn.addEventListener('click', () => this.editor.toggleLayerLock(btn.dataset.layerLock)));
    panel.querySelectorAll('[data-layer-center]').forEach((btn) => btn.addEventListener('click', () => this.editor.centerLayer(btn.dataset.layerCenter)));
    panel.querySelectorAll('[data-layer-duplicate]').forEach((btn) => btn.addEventListener('click', () => this.editor.duplicateLayer(btn.dataset.layerDuplicate)));
    panel.querySelectorAll('[data-layer-opacity]').forEach((input) => input.addEventListener('input', () => this.editor.updateLayer(input.dataset.layerOpacity, { opacity: Number(input.value) })));
    panel.querySelectorAll('[data-layer-name]').forEach((input) => input.addEventListener('change', () => this.editor.updateLayer(input.dataset.layerName, { name: input.value.trim() })));
    panel.querySelectorAll('[data-layer-rotation]').forEach((input) => input.addEventListener('change', () => this.editor.updateLayer(input.dataset.layerRotation, { rotation: Number(input.value) || 0 })));
    panel.querySelectorAll('[data-layer-place]').forEach((btn) => btn.addEventListener('click', () => this._placeLayer(btn.dataset.layerId, btn.dataset.layerPlace)));
    panel.querySelectorAll('[data-layer-front]').forEach((btn) => btn.addEventListener('click', () => this.editor.bringToFront(btn.dataset.layerFront)));
    panel.querySelectorAll('[data-layer-back]').forEach((btn) => btn.addEventListener('click', () => this.editor.sendToBack(btn.dataset.layerBack)));
    panel.querySelectorAll('[data-layer-remove]').forEach((btn) => btn.addEventListener('click', () => this.editor.removeLayer(btn.dataset.layerRemove)));
    panel.querySelectorAll('[data-layer-copy-area]').forEach((btn) => btn.addEventListener('click', () => {
      const select = panel.querySelector(`[data-layer-copy-target="${btn.dataset.layerCopyArea}"]`);
      if (select?.value) this.editor.copyLayerToArea(btn.dataset.layerCopyArea, select.value);
    }));
  }

  async _handleImageImport(event) {
    const files = Array.from(event.target.files || []);
    const statusEl = this.container.querySelector('#pzImageStatus');
    event.target.value = '';
    if (!files.length) return;
    try {
      if (statusEl) { statusEl.textContent = `Préparation de ${files.length} image${files.length > 1 ? 's' : ''}…`; statusEl.style.color = ''; }
      for (const file of files) {
        validateImportedImage(file);
        const layer = await this.editor.addImageLayer({ face: this.editor.getFace(), areaId: this.editor.getAreaId(), file });
        const quality = assessImageQuality({
          naturalWidth: layer.naturalWidth,
          naturalHeight: layer.naturalHeight,
          layerW: layer.w,
          layerH: layer.h,
          product: this.product,
          printArea: getProductPrintArea(this.product, layer.areaId)
        });
        this.editor.setLayerQuality(layer.id, quality);
      }
      this.activeTool = 'image';
      this.viewMode = 'edit';
      this._renderToolPanel();
      this._setViewMode('edit');
      if (statusEl) statusEl.textContent = '';
    } catch (error) {
      if (statusEl) { statusEl.textContent = error.message || 'Impossible d\'importer cette image.'; statusEl.style.color = '#b91c1c'; }
    }
  }

  // ---------- livraison ----------

  _renderDelivery() {
    const container = this.container.querySelector('#pzDeliveryContainer');
    if (!container) return;
    container.innerHTML = this.deliveryController.renderSection();
    this.deliveryController.bind();
  }

  // ---------- prix / commande ----------

  _renderBottomBar() {
    const el = this.container.querySelector('#pzBottomBar');
    if (!el) return;
    const quote = this.getPriceQuote();
    const deliveryFee = this.deliveryController.getFee();
    const total = quote.totalPrice + deliveryFee;
    const facesUsed = this.getFacesUsed();
    const areasUsed = this.getAreasUsed();
    const hasLowQuality = this.editor.layers.some((layer) => layer.type === 'image' && layer.quality?.status === 'insuffisante');
    const hasBlockingIssue = this.editor.hasOutOfBoundsLayers() || hasLowQuality;

    el.innerHTML = `
      <div class="pz-orderbar">
        <div class="pz-order-quantity">
          <span>Quantité</span>
          <div class="pz-qty-control">
            <button type="button" class="pz-mini-btn" id="pzQtyMinus" aria-label="Diminuer la quantité">−</button>
            <input type="number" id="pzQtyInput" value="${this.quantity}" min="${this.product.quantity?.min || 1}" max="${this.product.quantity?.max || 999}" step="${this.product.quantity?.step || 1}" inputmode="numeric">
            <button type="button" class="pz-mini-btn" id="pzQtyPlus" aria-label="Augmenter la quantité">+</button>
          </div>
        </div>
        <details class="pz-delivery-details">
          <summary>Réception <span>${this.formatPrice(deliveryFee)}</span></summary>
          <div id="pzDeliveryContainer"></div>
        </details>
        <div class="pz-order-total"><span>Total · ${areasUsed.length || 0} emplacement${areasUsed.length > 1 ? 's' : ''}</span><strong>${this.formatPrice(total)}</strong></div>
        <div class="pz-order-actions">
          ${!facesUsed.length ? '<p class="pz-order-message">Ajoutez une image ou un texte.</p>' : hasBlockingIssue ? '<p class="pz-order-message is-error">Corrigez la qualité ou le placement.</p>' : ''}
          <button type="button" class="pz-btn primary large" id="pzAddToCartBtn" ${!facesUsed.length || hasBlockingIssue || this.isSubmitting ? 'disabled' : ''}>
            ${this.isSubmitting ? '<i class="fas fa-circle-notch fa-spin" aria-hidden="true"></i> Préparation…' : 'Ajouter au panier'}
          </button>
          ${this.submitStatus ? `<p class="pz-hint ${this.submitStatus.type === 'error' ? 'is-error' : 'is-success'}">${this.escape(this.submitStatus.message)}</p>` : ''}
        </div>
      </div>
    `;

    el.querySelector('#pzAddToCartBtn')?.addEventListener('click', () => this._handleAddToCart());
    el.querySelector('#pzQtyInput')?.addEventListener('change', (event) => this._setQuantity(event.target.value));
    el.querySelector('#pzQtyMinus')?.addEventListener('click', () => this._setQuantity(this.quantity - (this.product.quantity?.step || 1)));
    el.querySelector('#pzQtyPlus')?.addEventListener('click', () => this._setQuantity(this.quantity + (this.product.quantity?.step || 1)));
    this._renderDelivery();
  }

  async _handleAddToCart() {
    if (this.isSubmitting) return;
    const facesUsed = this.getFacesUsed();
    if (!facesUsed.length) return;

    if (!this.deliveryController.isValid()) {
      this.submitStatus = { type: 'error', message: 'Choisissez un point de retrait ou une zone de livraison disponible.' };
      this._renderBottomBar();
      return;
    }

    this.isSubmitting = true;
    this.submitStatus = { type: 'info', message: 'Preparation de vos fichiers d\'impression...' };
    this._renderBottomBar();

    try {
      const printingFiles = [];
      const previewImages = [];
      const originalFiles = [];

      // Un fichier de production distinct par emplacement: le personnel sait
      // immédiatement quoi imprimer, où, et aux bonnes dimensions physiques.
      for (const areaId of this.getAreasUsed()) {
        const area = getProductPrintArea(this.product, areaId);
        if (!area) continue;
        const printCanvas = document.createElement('canvas');
        const dpi = Number(area.recommendedDpi || this.product.printDpiTarget || 150);
        printCanvas.width = Math.max(300, Math.round(Number(area.physicalWidthInches || 10) * dpi));
        printCanvas.height = Math.max(300, Math.round(Number(area.physicalHeightInches || 10) * dpi));
        this.editor.composePrintArea(printCanvas, areaId, { backgroundColor: null });

        const printUpload = await uploadPrintFile(printCanvas, { face: `${area.face}-${area.id}`, designId: this.designId });
        printingFiles.push({
          face: area.face,
          areaId: area.id,
          areaLabel: area.label,
          physicalWidthInches: area.physicalWidthInches,
          physicalHeightInches: area.physicalHeightInches,
          dpi,
          fileName: printUpload.name,
          fileUrl: printUpload.url,
          storagePath: printUpload.path
        });
      }

      // Les aperçus restent regroupés par face pour refléter exactement le
      // produit complet dans le panier.
      for (const face of facesUsed) {
        const previewCanvas = document.createElement('canvas');
        const size = Math.min(this.product.canvasSize || 1600, 1600);
        previewCanvas.width = size;
        previewCanvas.height = size;
        this.editor.composeCanvas(previewCanvas, face, { showZoneGuide: false, backgroundColor: this.getColor()?.hex || '#ffffff' });

        const previewUpload = await uploadPreviewImage(previewCanvas, { face, designId: this.designId });
        previewImages.push({ face, url: previewUpload.url, path: previewUpload.path });

        const imageLayers = this.editor.getLayersForFace(face).filter((layer) => layer.type === 'image' && layer.sourceFile);
        for (const layer of imageLayers) {
          const original = await uploadOriginalImage(layer.sourceFile);
          originalFiles.push({ face, areaId: layer.areaId, layerId: layer.id, fileName: original.name, fileUrl: original.url, storagePath: original.path });
        }
      }

      const mockupCanvas = this.viewer?.getSnapshotCanvas?.();
      if (mockupCanvas) {
        const mockupUpload = await uploadPreviewImage(mockupCanvas, { face: 'mockup', designId: this.designId });
        previewImages.unshift({ face: 'mockup', url: mockupUpload.url, path: mockupUpload.path });
      }

      const quote = this.getPriceQuote();
      const deliveryPayload = this.deliveryController.getCartPayload();
      const deliveryFee = Number(deliveryPayload.fee || 0);
      // Le panier multiplie price * quantity : on repartit les frais de reception
      // (uniques) sur chaque unite pour que le total reste exact.
      const unitPriceWithDelivery = quote.unitPrice + Math.round(deliveryFee / quote.quantity);
      const payableTotal = quote.totalPrice + deliveryFee;
      const color = this.getColor();
      const size = this.getSize();
      const mainPreview = previewImages[0]?.url || this.product.thumbnail;
      const originalByLayer = new Map(originalFiles.map((file) => [file.layerId, file]));
      const serializedLayers = this.editor.serialize().faces;
      Object.values(serializedLayers).flat().forEach((layer) => {
        if (layer.type !== 'image') return;
        const original = originalByLayer.get(layer.id);
        if (!original) return;
        layer.imageSrc = original.fileUrl;
        layer.sourceMeta = { fileName: original.fileName, storagePath: original.storagePath };
      });

      document.dispatchEvent(new CustomEvent('addToCart', {
        detail: {
          productId: `personalization-${this.product.id}-${this.designId}`,
          name: `${this.product.name} personnalise`,
          price: unitPriceWithDelivery,
          quantity: quote.quantity,
          sku: `PZ-${this.product.id}-${this.designId}`.toUpperCase(),
          image: mainPreview,
          sourceType: 'printing',
          category: 'personalization',
          deliveryMode: deliveryPayload.method === 'pickup' ? 'Personnalisation - point de retrait' : 'Personnalisation - livraison a domicile',
          deliveryCoverage: { country: 'Haiti', mode: 'printing_prepaid', nationwide: true, nationwideFee: 0, zones: [] },
          productDeliveryCoverage: { country: 'Haiti', mode: 'printing_prepaid', nationwide: true, nationwideFee: 0, zones: [] },
          printingDelivery: deliveryPayload,
          printingFiles,
          originalFiles,
          previewImages,
          personalizationConfig: {
            version: 3,
            productId: this.product.id,
            colorId: this.colorId,
            sizeId: this.sizeId,
            quantity: quote.quantity,
            facesUsed,
            areasUsed: this.getAreasUsed(),
            currentFace: this.editor.getFace(),
            currentAreaId: this.editor.getAreaId(),
            layers: serializedLayers
          },
          designId: this.designId,
          editCartIndex: this.editCartIndex,
          selectedOptions: [
            { label: 'Produit', value: this.product.name },
            { label: 'Couleur', value: color?.label || '' },
            { label: 'Taille', value: size?.label || '' },
            { label: 'Emplacements', value: this.getAreasUsed().map((id) => getProductPrintArea(this.product, id)?.label || id).join(', ') },
            { label: 'Prix unitaire', value: this.formatPrice(quote.unitPrice) },
            ...this.deliveryController.getSummaryLines(),
            { label: 'Total a payer', value: this.formatPrice(payableTotal) }
          ]
        }
      }));

      this.submitStatus = { type: 'success', message: 'Votre creation a ete ajoutee au panier.' };
      this.editCartIndex = null;
      this.designId = generateDesignId();
      document.dispatchEvent(new CustomEvent('openCart'));
    } catch (error) {
      console.error('[personalization] add to cart error:', error);
      this.submitStatus = { type: 'error', message: error.message || 'Impossible d\'ajouter cette creation au panier.' };
    } finally {
      this.isSubmitting = false;
      this._renderBottomBar();
    }
  }
}

export default PersonalizationStudio;
