// Moteur d'edition 2D du Studio de personnalisation.
//
// Modele de donnees: chaque "calque" (Layer) vit dans un espace NORMALISE (0..1)
// relatif au canvas carre du produit (meme repere que les zones imprimables
// definies dans personalization-config.js). Ce repere unique permet de reutiliser
// EXACTEMENT le meme calcul de composition pour:
//   - la texture 3D (canvas basse resolution applique sur le modele Three.js)
//   - l'apercu 2D de secours (pas de WebGL)
//   - le fichier d'impression final (canvas haute resolution, sans les reperes
//     visuels d'edition, genere separement de toute capture d'ecran du rendu 3D)
//
// L'interaction (glisser / redimensionner / pivoter) est geree via une surface DOM
// superposee (des <div> positionnes avec des transforms CSS), ce qui donne une
// experience tactile et clavier fiable sur mobile comme sur desktop, independamment
// du moteur de rendu (WebGL ou fallback 2D) utilise pour l'apercu produit.

const FONT_OPTIONS = [
  { id: 'ember', label: 'Amazon Ember (site)', family: "'Amazon Ember', Arial, Helvetica, sans-serif" },
  { id: 'arial', label: 'Arial', family: 'Arial, Helvetica, sans-serif' },
  { id: 'georgia', label: 'Georgia', family: 'Georgia, "Times New Roman", serif' },
  { id: 'times', label: 'Times New Roman', family: '"Times New Roman", Times, serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', family: '"Trebuchet MS", Helvetica, sans-serif' },
  { id: 'impact', label: 'Impact', family: 'Impact, Haettenschweiler, sans-serif' },
  { id: 'verdana', label: 'Verdana', family: 'Verdana, Geneva, sans-serif' },
  { id: 'courier', label: 'Courier New', family: '"Courier New", Courier, monospace' }
];

function uid(prefix = 'layer') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function getFontFamily(fontId) {
  return (FONT_OPTIONS.find((font) => font.id === fontId) || FONT_OPTIONS[0]).family;
}

class Layer {
  constructor(data) {
    this.id = data.id || uid(data.type || 'layer');
    this.type = data.type; // 'text' | 'image' | 'illustration'
    this.face = data.face;
    this.areaId = data.areaId || '';
    this.name = data.name || '';
    this.zIndex = Number.isFinite(data.zIndex) ? data.zIndex : 0;
    this.cx = Number.isFinite(data.cx) ? data.cx : 0.5;
    this.cy = Number.isFinite(data.cy) ? data.cy : 0.5;
    this.rotation = Number.isFinite(data.rotation) ? data.rotation : 0;
    this.w = Number.isFinite(data.w) ? data.w : 0.3;
    this.h = Number.isFinite(data.h) ? data.h : 0.15;
    this.opacity = Number.isFinite(data.opacity) ? clamp(data.opacity, 0, 1) : 1;
    this.visible = data.visible !== false;
    this.locked = Boolean(data.locked);
    this.outOfBounds = false;

    if (this.type === 'text') {
      this.text = data.text ?? 'Votre texte';
      this.fontId = data.fontId || 'ember';
      this.fontSize = Number.isFinite(data.fontSize) ? data.fontSize : 0.07;
      this.color = data.color || '#0f1111';
      this.align = data.align || 'center';
      this.bold = Boolean(data.bold);
      this.italic = Boolean(data.italic);
    }

    if (this.type === 'image') {
      this.imageSrc = data.imageSrc || '';
      this.naturalWidth = data.naturalWidth || 0;
      this.naturalHeight = data.naturalHeight || 0;
      this.sourceFile = data.sourceFile || null;
      this.sourceMeta = data.sourceMeta || null;
      this.quality = data.quality || null;
    }

    if (this.type === 'illustration') {
      this.illustrationId = data.illustrationId;
      this.color = data.color || '#0f1111';
    }
  }
}

export class PersonalizationEditor extends EventTarget {
  constructor({ product } = {}) {
    super();
    this.product = product || null;
    this.currentFace = product?.faces?.[0] || 'front';
    this.currentAreaId = product?.printAreas?.find((area) => area.face === this.currentFace)?.id || '';
    this.layers = [];
    this.selectedLayerId = null;
    this.imageCache = new Map(); // layerId -> HTMLImageElement (or illustration svg image)
    this.stageEl = null;
    this.stageBodyEl = null;
    this._interactionState = null;
    this._resizeObserver = null;
    this.backgroundColor = '#ffffff';
    this._history = [];
    this._historyIndex = -1;
    this._recordHistory();
  }

  setBackgroundColor(hex) {
    this.backgroundColor = hex || '#ffffff';
    this._renderStage();
  }

  // ---------- produit / face ----------

  setProduct(product) {
    this.product = product;
    this.layers = [];
    this.selectedLayerId = null;
    this.imageCache.forEach((img) => { if (img?.src?.startsWith('blob:')) URL.revokeObjectURL(img.src); });
    this.imageCache.clear();
    this.currentFace = product?.faces?.[0] || 'front';
    this.currentAreaId = product?.printAreas?.find((area) => area.face === this.currentFace)?.id || '';
    this._history = [];
    this._historyIndex = -1;
    this._recordHistory();
    this._emitChange();
  }

  setFace(face) {
    if (!this.product?.faces?.includes(face)) return;
    this.currentFace = face;
    const currentArea = this.getPrintArea(this.currentAreaId);
    if (!currentArea || currentArea.face !== face) {
      this.currentAreaId = this.getPrintAreas(face)[0]?.id || '';
    }
    this.selectedLayerId = null;
    this._renderStage();
    this._emitChange();
  }

  getFace() {
    return this.currentFace;
  }

  getPrintAreas(face = null) {
    const areas = Array.isArray(this.product?.printAreas) ? this.product.printAreas : [];
    return face ? areas.filter((area) => area.face === face) : areas;
  }

  getPrintArea(areaId = this.currentAreaId) {
    return this.getPrintAreas().find((area) => area.id === areaId) || null;
  }

  setPrintArea(areaId) {
    const area = this.getPrintArea(areaId);
    if (!area) return;
    this.currentAreaId = area.id;
    this.currentFace = area.face;
    this.selectedLayerId = null;
    this._renderStage();
    this._emitChange({ areaChanged: true });
  }

  getAreaId() { return this.currentAreaId; }

  getZone(face = this.currentFace, areaId = this.currentAreaId) {
    const area = this.getPrintArea(areaId);
    if (area?.face === face && area.bounds) return area.bounds;
    return this.product?.zones?.[face] || null;
  }

  getLayersForFace(face = this.currentFace) {
    return this.layers
      .filter((layer) => layer.face === face)
      .sort((a, b) => a.zIndex - b.zIndex);
  }

  getLayersForArea(areaId = this.currentAreaId) {
    return this.layers.filter((layer) => layer.areaId === areaId).sort((a, b) => a.zIndex - b.zIndex);
  }

  facesWithContent() {
    const faces = new Set(this.layers.map((layer) => layer.face));
    return Array.from(faces);
  }

  areasWithContent() {
    return Array.from(new Set(this.layers.filter((layer) => layer.visible !== false).map((layer) => layer.areaId).filter(Boolean)));
  }

  // ---------- gestion des calques ----------

  _nextZIndex(face) {
    const layers = this.getLayersForFace(face);
    return layers.length ? Math.max(...layers.map((l) => l.zIndex)) + 1 : 0;
  }

  addTextLayer({ face = this.currentFace, areaId = this.currentAreaId, text = 'Votre texte' } = {}) {
    const zone = this.getZone(face, areaId);
    const layer = new Layer({
      type: 'text',
      face,
      areaId,
      text,
      cx: zone ? zone.x + zone.width / 2 : 0.5,
      cy: zone ? zone.y + zone.height / 2 : 0.5,
      zIndex: this._nextZIndex(face)
    });
    this.layers.push(layer);
    this.selectLayer(layer.id);
    return layer;
  }

  async addImageLayer({ face = this.currentFace, areaId = this.currentAreaId, file, quality } = {}) {
    const zone = this.getZone(face, areaId);
    const objectUrl = URL.createObjectURL(file);
    const dims = await this._readImageDimensions(objectUrl);
    const aspect = dims.width && dims.height ? dims.width / dims.height : 1;
    const baseWidth = zone ? Math.min(zone.width, zone.height * aspect) * 0.8 : 0.3;

    const layer = new Layer({
      type: 'image',
      face,
      areaId,
      imageSrc: objectUrl,
      naturalWidth: dims.width,
      naturalHeight: dims.height,
      sourceFile: file,
      quality,
      w: baseWidth,
      h: baseWidth / aspect,
      cx: zone ? zone.x + zone.width / 2 : 0.5,
      cy: zone ? zone.y + zone.height / 2 : 0.5,
      zIndex: this._nextZIndex(face)
    });

    const img = await this._loadImage(objectUrl);
    this.imageCache.set(layer.id, img);
    this.layers.push(layer);
    this.selectLayer(layer.id);
    return layer;
  }

  async addIllustrationLayer({ face = this.currentFace, areaId = this.currentAreaId, illustrationId, svgMarkup, color = '#0f1111' } = {}) {
    const zone = this.getZone(face, areaId);
    const baseSize = zone ? Math.min(zone.width, zone.height) * 0.5 : 0.25;
    const layer = new Layer({
      type: 'illustration',
      face,
      areaId,
      illustrationId,
      color,
      w: baseSize,
      h: baseSize,
      cx: zone ? zone.x + zone.width / 2 : 0.5,
      cy: zone ? zone.y + zone.height / 2 : 0.5,
      zIndex: this._nextZIndex(face)
    });
    await this._refreshIllustrationImage(layer, svgMarkup);
    this.layers.push(layer);
    this.selectLayer(layer.id);
    return layer;
  }

  async _refreshIllustrationImage(layer, svgMarkup) {
    const colored = svgMarkup.replace(/currentColor/g, layer.color);
    const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(colored)}`;
    const img = await this._loadImage(dataUrl);
    this.imageCache.set(layer.id, img);
  }

  removeLayer(id) {
    const layer = this.layers.find((l) => l.id === id);
    // Keep the cached image during the session so Undo can restore a deleted layer.
    this.layers = this.layers.filter((l) => l.id !== id);
    if (this.selectedLayerId === id) this.selectedLayerId = null;
    this._renderStage();
    this._emitChange();
  }

  duplicateLayer(id) {
    const source = this.layers.find((layer) => layer.id === id);
    if (!source) return null;
    const copy = new Layer({ ...source, id: uid(source.type), cx: source.cx + .025, cy: source.cy + .025, zIndex: this._nextZIndex(source.face) });
    if (this.imageCache.has(source.id)) this.imageCache.set(copy.id, this.imageCache.get(source.id));
    this.layers.push(copy);
    this.selectLayer(copy.id);
    return copy;
  }

  copyLayerToArea(id, targetAreaId) {
    const source = this.layers.find((layer) => layer.id === id);
    const sourceArea = this.getPrintArea(source?.areaId);
    const targetArea = this.getPrintArea(targetAreaId);
    if (!source || !sourceArea?.bounds || !targetArea?.bounds) return null;
    const from = sourceArea.bounds;
    const to = targetArea.bounds;
    const relativeX = (source.cx - from.x) / from.width;
    const relativeY = (source.cy - from.y) / from.height;
    const copy = new Layer({
      ...source,
      id: uid(source.type),
      name: source.name ? `${source.name} (copie)` : '',
      face: targetArea.face,
      areaId: targetArea.id,
      cx: to.x + relativeX * to.width,
      cy: to.y + relativeY * to.height,
      w: Math.min(to.width, (source.w / from.width) * to.width),
      h: Math.min(to.height, (source.h / from.height) * to.height),
      zIndex: this._nextZIndex(targetArea.face)
    });
    if (this.imageCache.has(source.id)) this.imageCache.set(copy.id, this.imageCache.get(source.id));
    this.layers.push(copy);
    this.setPrintArea(targetArea.id);
    this.selectLayer(copy.id);
    return copy;
  }

  toggleLayerVisibility(id) {
    const layer = this.layers.find((item) => item.id === id);
    if (layer) this.updateLayer(id, { visible: layer.visible === false });
  }

  toggleLayerLock(id) {
    const layer = this.layers.find((item) => item.id === id);
    if (layer) this.updateLayer(id, { locked: !layer.locked });
  }

  selectLayer(id) {
    this.selectedLayerId = id;
    this._renderStage();
    this._emitChange();
  }

  getSelectedLayer() {
    return this.layers.find((l) => l.id === this.selectedLayerId) || null;
  }

  // Ecriture directe (sans emission de 'change') utilisee par personalization.js
  // pour memoriser le resultat d'un controle qualite image apres import/redimension,
  // sans redeclencher une boucle de recalcul.
  setLayerQuality(id, quality) {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.quality = quality;
  }

  updateLayer(id, patch) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    Object.assign(layer, patch);
    if (layer.type === 'illustration' && patch.color) {
      const svgMarkup = this._lastIllustrationSvg?.[layer.illustrationId];
      if (svgMarkup) this._refreshIllustrationImage(layer, svgMarkup).then(() => this._renderStage());
    }
    this._checkBounds(layer);
    this._renderStage();
    this._emitChange();
  }

  registerIllustrationSource(illustrationId, svgMarkup) {
    this._lastIllustrationSvg = this._lastIllustrationSvg || {};
    this._lastIllustrationSvg[illustrationId] = svgMarkup;
  }

  bringForward(id) { this._reorder(id, 1); }
  sendBackward(id) { this._reorder(id, -1); }
  bringToFront(id) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    layer.zIndex = this._nextZIndex(layer.face);
    this._renderStage();
    this._emitChange();
  }
  sendToBack(id) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    const layers = this.getLayersForFace(layer.face);
    const min = layers.length ? Math.min(...layers.map((l) => l.zIndex)) : 0;
    layer.zIndex = min - 1;
    this._renderStage();
    this._emitChange();
  }

  _reorder(id, direction) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    const siblings = this.getLayersForFace(layer.face);
    const index = siblings.findIndex((l) => l.id === id);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= siblings.length) return;
    const other = siblings[swapIndex];
    const tmp = layer.zIndex;
    layer.zIndex = other.zIndex;
    other.zIndex = tmp;
    this._renderStage();
    this._emitChange();
  }

  centerLayer(id) {
    const layer = this.layers.find((l) => l.id === id);
    const zone = this.getZone(layer?.face, layer?.areaId);
    if (!layer || !zone) return;
    layer.cx = zone.x + zone.width / 2;
    layer.cy = zone.y + zone.height / 2;
    this._checkBounds(layer);
    this._renderStage();
    this._emitChange();
  }

  resetFace(face = this.currentFace) {
    this.layers.forEach((layer) => {
      if (layer.face === face && layer.imageSrc?.startsWith('blob:')) URL.revokeObjectURL(layer.imageSrc);
    });
    this.layers.filter((l) => l.face === face).forEach((l) => this.imageCache.delete(l.id));
    this.layers = this.layers.filter((layer) => layer.face !== face);
    if (this.getSelectedLayer()?.face === face) this.selectedLayerId = null;
    this._renderStage();
    this._emitChange();
  }

  resetArea(areaId = this.currentAreaId) {
    this.getLayersForArea(areaId).forEach((layer) => {
      if (layer.imageSrc?.startsWith('blob:')) URL.revokeObjectURL(layer.imageSrc);
      this.imageCache.delete(layer.id);
    });
    this.layers = this.layers.filter((layer) => layer.areaId !== areaId);
    if (this.getSelectedLayer()?.areaId === areaId) this.selectedLayerId = null;
    this._renderStage();
    this._emitChange();
  }

  deleteSelected() {
    if (this.selectedLayerId) this.removeLayer(this.selectedLayerId);
  }

  // ---------- garde-fou zone imprimable ----------

  _rotatedBoundingBox(layer) {
    const hw = layer.w / 2;
    const hh = layer.h / 2;
    const angle = degToRad(layer.rotation || 0);
    const corners = [
      [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]
    ].map(([x, y]) => ({
      x: layer.cx + x * Math.cos(angle) - y * Math.sin(angle),
      y: layer.cy + x * Math.sin(angle) + y * Math.cos(angle)
    }));
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  }

  _checkBounds(layer) {
    const zone = this.getZone(layer.face, layer.areaId);
    if (!zone) { layer.outOfBounds = false; return; }
    const box = this._rotatedBoundingBox(layer);
    layer.outOfBounds = (
      box.minX < zone.x - 0.001
      || box.minY < zone.y - 0.001
      || box.maxX > zone.x + zone.width + 0.001
      || box.maxY > zone.y + zone.height + 0.001
    );
  }

  hasOutOfBoundsLayers() {
    return this.layers.some((l) => l.outOfBounds);
  }

  // ---------- utilitaires image ----------

  _readImageDimensions(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => resolve({ width: 0, height: 0 });
      img.src = src;
    });
  }

  _loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ---------- composition canvas (texture 3D / fallback / export impression) ----------

  composeCanvas(canvas, face, { showZoneGuide = false, backgroundColor = '#ffffff' } = {}) {
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (backgroundColor) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const zone = this.getZone(face, this.currentAreaId);
    if (showZoneGuide && zone) {
      ctx.save();
      ctx.strokeStyle = 'rgba(198,167,94,0.9)';
      ctx.setLineDash([size * 0.01, size * 0.008]);
      ctx.lineWidth = Math.max(1, size * 0.003);
      ctx.strokeRect(zone.x * size, zone.y * size, zone.width * size, zone.height * size);
      ctx.restore();
    }

    const layers = this.getLayersForFace(face).filter((layer) => layer.visible !== false);
    layers.forEach((layer) => this._drawLayer(ctx, layer, size));
    return canvas;
  }

  // Fichier de production d'un emplacement precis. Contrairement a la texture
  // d'aperçu (une toile carree par face), cette sortie est cadree aux dimensions
  // physiques de la zone et conserve la transparence.
  composePrintArea(canvas, areaId, { backgroundColor = null } = {}) {
    const area = this.getPrintArea(areaId);
    if (!area) throw new Error('Zone d’impression inconnue.');
    const zone = area.bounds;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (backgroundColor) {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    this.getLayersForArea(areaId)
      .filter((layer) => layer.visible !== false)
      .forEach((layer) => this._drawLayerInArea(ctx, layer, zone, canvas.width, canvas.height));
    return canvas;
  }

  _drawLayerInArea(ctx, layer, zone, outputWidth, outputHeight) {
    const centerX = ((layer.cx - zone.x) / zone.width) * outputWidth;
    const centerY = ((layer.cy - zone.y) / zone.height) * outputHeight;
    const width = (layer.w / zone.width) * outputWidth;
    const height = (layer.h / zone.height) * outputHeight;
    ctx.save();
    ctx.globalAlpha = Number.isFinite(layer.opacity) ? layer.opacity : 1;
    ctx.translate(centerX, centerY);
    ctx.rotate(degToRad(layer.rotation || 0));

    if (layer.type === 'text') {
      const fontPx = (layer.fontSize / zone.height) * outputHeight;
      const weight = layer.bold ? '800' : '400';
      const style = layer.italic ? 'italic' : 'normal';
      ctx.font = `${style} ${weight} ${fontPx}px ${getFontFamily(layer.fontId)}`;
      ctx.fillStyle = layer.color;
      ctx.textAlign = layer.align === 'left' ? 'left' : layer.align === 'right' ? 'right' : 'center';
      ctx.textBaseline = 'middle';
      const lines = String(layer.text || '').split('\n');
      const lineHeight = fontPx * 1.18;
      const totalHeight = lineHeight * lines.length;
      const maxWidth = Math.max(0, ...lines.map((line) => ctx.measureText(line).width));
      const startY = -totalHeight / 2 + lineHeight / 2;
      const anchorX = layer.align === 'left' ? -maxWidth / 2 : layer.align === 'right' ? maxWidth / 2 : 0;
      lines.forEach((line, index) => ctx.fillText(line, anchorX, startY + index * lineHeight));
    } else {
      const img = this.imageCache.get(layer.id);
      if (img) ctx.drawImage(img, -width / 2, -height / 2, width, height);
    }
    ctx.restore();
  }

  _drawLayer(ctx, layer, size) {
    ctx.save();
    ctx.globalAlpha = Number.isFinite(layer.opacity) ? layer.opacity : 1;
    ctx.translate(layer.cx * size, layer.cy * size);
    ctx.rotate(degToRad(layer.rotation || 0));

    if (layer.type === 'text') {
      const fontPx = layer.fontSize * size;
      const weight = layer.bold ? '800' : '400';
      const style = layer.italic ? 'italic' : 'normal';
      ctx.font = `${style} ${weight} ${fontPx}px ${getFontFamily(layer.fontId)}`;
      ctx.fillStyle = layer.color;
      ctx.textAlign = layer.align === 'left' ? 'left' : layer.align === 'right' ? 'right' : 'center';
      ctx.textBaseline = 'middle';
      const lines = String(layer.text || '').split('\n');
      const lineHeight = fontPx * 1.18;
      const totalHeight = lineHeight * lines.length;
      let maxWidth = 0;
      lines.forEach((line) => { maxWidth = Math.max(maxWidth, ctx.measureText(line).width); });
      layer.w = maxWidth / size;
      layer.h = totalHeight / size;
      const startY = -totalHeight / 2 + lineHeight / 2;
      const anchorX = layer.align === 'left' ? -maxWidth / 2 : layer.align === 'right' ? maxWidth / 2 : 0;
      lines.forEach((line, index) => {
        ctx.fillText(line, anchorX, startY + index * lineHeight);
      });
    } else {
      const img = this.imageCache.get(layer.id);
      if (img) {
        const w = layer.w * size;
        const h = layer.h * size;
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      }
    }

    ctx.restore();
  }

  // ---------- surface interactive (DOM) ----------

  mountInteractiveStage(containerEl) {
    this.stageEl = containerEl;
    containerEl.innerHTML = '';
    containerEl.classList.add('pz-stage');

    const backdrop = document.createElement('canvas');
    backdrop.className = 'pz-stage-backdrop';
    containerEl.appendChild(backdrop);
    this.backdropCanvas = backdrop;

    const body = document.createElement('div');
    body.className = 'pz-stage-body';
    body.tabIndex = -1;
    containerEl.appendChild(body);
    this.stageBodyEl = body;

    if (!containerEl.dataset.pzBound) {
      containerEl.dataset.pzBound = '1';
      containerEl.addEventListener('pointerdown', (event) => {
        if (event.target === containerEl || event.target === this.backdropCanvas || event.target === this.stageBodyEl) {
          this.selectLayer(null);
        }
      });
    }

    if (!this._keydownBound) {
      this._keydownBound = true;
      window.addEventListener('keydown', (event) => this._handleKeydown(event));
    }

    this._renderStage();
  }

  _handleKeydown(event) {
    if (!this.stageEl || !this.stageEl.isConnected) return;
    const active = document.activeElement;
    if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName)) return;

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      this.undo();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
      event.preventDefault();
      this.redo();
      return;
    }
    if (event.key === 'Escape') {
      this.selectLayer(null);
      return;
    }

    const layer = this.getSelectedLayer();
    if (!layer) return;
    if (layer.locked && !['Delete', 'Backspace'].includes(event.key)) return;

    const step = event.shiftKey ? 0.02 : 0.006;
    let handled = true;
    if (event.key === 'ArrowLeft') layer.cx -= step;
    else if (event.key === 'ArrowRight') layer.cx += step;
    else if (event.key === 'ArrowUp') layer.cy -= step;
    else if (event.key === 'ArrowDown') layer.cy += step;
    else if (event.key === 'Delete' || event.key === 'Backspace') { this.deleteSelected(); return; }
    else handled = false;

    if (handled) {
      event.preventDefault();
      layer.cx = clamp(layer.cx, 0, 1);
      layer.cy = clamp(layer.cy, 0, 1);
      this._checkBounds(layer);
      this._renderStage();
      this._emitChange();
    }
  }

  _renderStage() {
    if (!this.stageEl) return;

    if (this.backdropCanvas && this.product) {
      const size = this.product.canvasSize || 1200;
      this.backdropCanvas.width = size;
      this.backdropCanvas.height = size;
      this.composeCanvas(this.backdropCanvas, this.currentFace, { showZoneGuide: true, backgroundColor: this.backgroundColor });
    }

    const body = this.stageBodyEl;
    if (!body) return;
    body.innerHTML = '';

    // Seul l'emplacement actif est manipulable. Les autres compositions de la
    // face restent visibles dans la texture 3D, mais ne peuvent pas être
    // déplacées accidentellement depuis cette surface d'édition.
    const layers = this.getLayersForArea(this.currentAreaId).filter((layer) => layer.visible !== false);
    layers.forEach((layer) => {
      body.appendChild(this._buildLayerBox(layer));
    });
  }

  _buildLayerBox(layer) {
    const box = document.createElement('div');
    box.className = `pz-layer${layer.id === this.selectedLayerId ? ' is-selected' : ''}${layer.outOfBounds ? ' is-out' : ''}`;
    box.style.left = `${layer.cx * 100}%`;
    box.style.top = `${layer.cy * 100}%`;
    box.style.width = `${layer.w * 100}%`;
    box.style.height = `${layer.h * 100}%`;
    box.style.transform = `translate(-50%, -50%) rotate(${layer.rotation || 0}deg)`;
    box.setAttribute('role', 'button');
    box.setAttribute('tabindex', '0');
    box.setAttribute('aria-label', layer.type === 'text' ? `Texte: ${layer.text}` : `Element ${layer.type}`);

    const content = document.createElement('div');
    content.className = 'pz-layer-content';
    if (layer.type === 'text') {
      content.style.color = layer.color;
      content.style.fontFamily = getFontFamily(layer.fontId);
      content.style.fontWeight = layer.bold ? '800' : '400';
      content.style.fontStyle = layer.italic ? 'italic' : 'normal';
      content.style.textAlign = layer.align;
      content.style.fontSize = `${Math.max(8, layer.fontSize * (this.product?.canvasSize || 1200) * 0.22)}px`;
      content.textContent = layer.text;
    } else {
      const img = this.imageCache.get(layer.id);
      if (img) {
        const imageEl = document.createElement('img');
        imageEl.src = img.src;
        imageEl.alt = '';
        imageEl.draggable = false;
        content.appendChild(imageEl);
      }
    }
    box.appendChild(content);

    if (layer.outOfBounds) {
      const warn = document.createElement('span');
      warn.className = 'pz-layer-warning';
      warn.title = 'Cet element depasse la zone imprimable';
      warn.innerHTML = '<i class="fas fa-triangle-exclamation" aria-hidden="true"></i>';
      box.appendChild(warn);
    }

    if (layer.id === this.selectedLayerId) {
      const rotateHandle = document.createElement('button');
      rotateHandle.type = 'button';
      rotateHandle.className = 'pz-handle pz-handle-rotate';
      rotateHandle.setAttribute('aria-label', 'Pivoter');
      rotateHandle.innerHTML = '<i class="fas fa-rotate" aria-hidden="true"></i>';
      box.appendChild(rotateHandle);

      const resizeHandle = document.createElement('button');
      resizeHandle.type = 'button';
      resizeHandle.className = 'pz-handle pz-handle-resize';
      resizeHandle.setAttribute('aria-label', 'Redimensionner');
      box.appendChild(resizeHandle);

      const deleteHandle = document.createElement('button');
      deleteHandle.type = 'button';
      deleteHandle.className = 'pz-handle pz-handle-delete';
      deleteHandle.setAttribute('aria-label', 'Supprimer');
      deleteHandle.innerHTML = '<i class="fas fa-xmark" aria-hidden="true"></i>';
      box.appendChild(deleteHandle);

      this._bindHandle(resizeHandle, layer, 'resize');
      this._bindHandle(rotateHandle, layer, 'rotate');
      deleteHandle.addEventListener('click', (event) => {
        event.stopPropagation();
        this.removeLayer(layer.id);
      });
    }

    box.classList.toggle('is-locked', layer.locked);
    box.addEventListener('pointerdown', (event) => { if (!layer.locked) this._bindDrag(event, box, layer); });
    box.addEventListener('click', (event) => event.stopPropagation());
    box.addEventListener('focus', () => { if (this.selectedLayerId !== layer.id) this.selectLayer(layer.id); });

    return box;
  }

  _bindDrag(event, box, layer) {
    if (event.target.closest('.pz-handle')) return;
    event.preventDefault();
    event.stopPropagation();
    if (this.selectedLayerId !== layer.id) this.selectLayer(layer.id);

    const stageRect = this.stageBodyEl.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startCx = layer.cx;
    const startCy = layer.cy;

    const onMove = (moveEvent) => {
      const dx = (moveEvent.clientX - startX) / stageRect.width;
      const dy = (moveEvent.clientY - startY) / stageRect.height;
      layer.cx = clamp(startCx + dx, 0, 1);
      layer.cy = clamp(startCy + dy, 0, 1);
      this._checkBounds(layer);
      box.style.left = `${layer.cx * 100}%`;
      box.style.top = `${layer.cy * 100}%`;
      this._throttledCompose();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      this._renderStage();
      this._emitChange();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  _bindHandle(handleEl, layer, mode) {
    handleEl.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const stageRect = this.stageBodyEl.getBoundingClientRect();
      const centerX = stageRect.left + layer.cx * stageRect.width;
      const centerY = stageRect.top + layer.cy * stageRect.height;

      const startDist = Math.hypot(event.clientX - centerX, event.clientY - centerY) || 1;
      const startAngle = Math.atan2(event.clientY - centerY, event.clientX - centerX);
      const startW = layer.w;
      const startH = layer.h;
      const startFontSize = layer.fontSize;
      const startRotation = layer.rotation || 0;

      const onMove = (moveEvent) => {
        if (mode === 'resize') {
          const dist = Math.hypot(moveEvent.clientX - centerX, moveEvent.clientY - centerY);
          const scale = clamp(dist / startDist, 0.15, 8);
          if (layer.type === 'text') {
            layer.fontSize = clamp(startFontSize * scale, 0.015, 0.5);
          } else {
            layer.w = clamp(startW * scale, 0.03, 1.2);
            layer.h = clamp(startH * scale, 0.03, 1.2);
          }
        } else if (mode === 'rotate') {
          const angle = Math.atan2(moveEvent.clientY - centerY, moveEvent.clientX - centerX);
          const deltaDeg = ((angle - startAngle) * 180) / Math.PI;
          layer.rotation = Math.round(startRotation + deltaDeg);
        }
        this._checkBounds(layer);
        this._applyLiveTransform(layer);
        this._throttledCompose();
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        this._renderStage();
        this._emitChange();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  _applyLiveTransform(layer) {
    const box = this.stageBodyEl?.querySelector(`.pz-layer.is-selected`);
    if (!box) return;
    box.style.width = `${layer.w * 100}%`;
    box.style.height = `${layer.h * 100}%`;
    box.style.transform = `translate(-50%, -50%) rotate(${layer.rotation || 0}deg)`;
    const content = box.querySelector('.pz-layer-content');
    if (content && layer.type === 'text') {
      content.style.fontSize = `${Math.max(8, layer.fontSize * (this.product?.canvasSize || 1200) * 0.22)}px`;
    }
  }

  _throttledCompose() {
    if (this._composeRaf) return;
    this._composeRaf = requestAnimationFrame(() => {
      this._composeRaf = null;
      if (this.backdropCanvas) {
        this.composeCanvas(this.backdropCanvas, this.currentFace, { showZoneGuide: true, backgroundColor: this.backgroundColor });
      }
      this._emitChange({ live: true });
    });
  }

  _emitChange(detail = {}) {
    if (!detail.live && !detail.historySkip) this._recordHistory();
    this.dispatchEvent(new CustomEvent('change', { detail }));
  }

  _captureState() {
    return this.layers.map((layer) => ({ ...layer }));
  }

  _recordHistory() {
    const state = this._captureState();
    const signature = JSON.stringify(state.map((layer) => this._serializeLayer(layer)));
    const current = this._history[this._historyIndex];
    if (current?.signature === signature) return;
    this._history = this._history.slice(0, this._historyIndex + 1);
    this._history.push({ state, signature });
    if (this._history.length > 60) this._history.shift();
    this._historyIndex = this._history.length - 1;
  }

  canUndo() { return this._historyIndex > 0; }
  canRedo() { return this._historyIndex >= 0 && this._historyIndex < this._history.length - 1; }

  undo() {
    if (!this.canUndo()) return false;
    this._historyIndex -= 1;
    this._restoreHistoryState();
    return true;
  }

  redo() {
    if (!this.canRedo()) return false;
    this._historyIndex += 1;
    this._restoreHistoryState();
    return true;
  }

  _restoreHistoryState() {
    this.layers = this._history[this._historyIndex].state.map((data) => new Layer({ ...data }));
    if (!this.layers.some((layer) => layer.id === this.selectedLayerId)) this.selectedLayerId = null;
    this._renderStage();
    this._emitChange({ historySkip: true });
  }

  // ---------- (de)serialisation ----------

  serialize() {
    return {
      productId: this.product?.id || '',
      faces: this.product?.faces?.reduce((acc, face) => {
        acc[face] = this.getLayersForFace(face).map((layer) => this._serializeLayer(layer));
        return acc;
      }, {}) || {}
    };
  }

  async restore({ layers = [], currentFace, currentAreaId } = {}) {
    this.layers = [];
    this.selectedLayerId = null;
    this.imageCache.clear();
    for (const raw of layers) {
      const data = { ...raw };
      // Migration douce des anciennes créations recto/verso qui ne possédaient
      // pas encore d'identifiant d'emplacement.
      if (!data.areaId) {
        data.areaId = this.getPrintAreas(data.face)[0]?.id || this.getPrintAreas()[0]?.id || '';
      }
      if (data.type === 'image' && data.sourceFile instanceof Blob) {
        data.imageSrc = URL.createObjectURL(data.sourceFile);
      }
      const layer = new Layer(data);
      if (layer.type === 'image' && layer.imageSrc) {
        try { this.imageCache.set(layer.id, await this._loadImage(layer.imageSrc)); } catch (_) { /* keep layer metadata */ }
      }
      if (layer.type === 'illustration') {
        const svg = this._lastIllustrationSvg?.[layer.illustrationId];
        if (svg) await this._refreshIllustrationImage(layer, svg);
      }
      this._checkBounds(layer);
      this.layers.push(layer);
    }
    if (this.product?.faces?.includes(currentFace)) this.currentFace = currentFace;
    if (this.getPrintArea(currentAreaId)) this.currentAreaId = currentAreaId;
    this._history = [];
    this._historyIndex = -1;
    this._recordHistory();
    this._renderStage();
    this._emitChange({ historySkip: true, restored: true });
  }

  exportDraft() {
    return {
      currentFace: this.currentFace,
      currentAreaId: this.currentAreaId,
      layers: this.layers.map((layer) => ({ ...layer }))
    };
  }

  _serializeLayer(layer) {
    const base = {
      id: layer.id, type: layer.type, face: layer.face, areaId: layer.areaId, name: layer.name,
      zIndex: layer.zIndex, cx: layer.cx, cy: layer.cy, w: layer.w, h: layer.h,
      rotation: layer.rotation, opacity: layer.opacity, visible: layer.visible, locked: layer.locked
    };
    if (layer.type === 'text') {
      Object.assign(base, {
        text: layer.text, fontId: layer.fontId, fontSize: layer.fontSize,
        color: layer.color, align: layer.align, bold: layer.bold, italic: layer.italic
      });
    }
    if (layer.type === 'image') {
      Object.assign(base, {
        naturalWidth: layer.naturalWidth, naturalHeight: layer.naturalHeight,
        quality: layer.quality, fileName: layer.sourceFile?.name || layer.sourceMeta?.fileName || ''
      });
    }
    if (layer.type === 'illustration') {
      Object.assign(base, { illustrationId: layer.illustrationId, color: layer.color });
    }
    return base;
  }
}

export { FONT_OPTIONS, getFontFamily };
