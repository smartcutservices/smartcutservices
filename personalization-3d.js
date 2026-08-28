// Moteur de rendu 3D du Studio de personnalisation.
//
// Charge Three.js UNIQUEMENT quand ce module est importe (jamais depuis l'accueil -
// voir personalization-teaser.js qui ne charge que du HTML/CSS statique). Le texte
// et les images ne sont jamais dessines "en dur" sur une image fixe: ils sont
// composes par personalization-editor.js sur un <canvas> 2D, transforme ensuite en
// THREE.CanvasTexture et applique comme materiau du modele.
//
// PLACEHOLDER 3D: si `product.model3d.url` n'est pas renseigne (voir
// personalization-config.js), ce module construit un objet 3D procedural
// (BoxGeometry pour un t-shirt "carte", CylinderGeometry pour une tasse) au lieu
// d'un vrai modele GLB. C'est un remplacement temporaire clairement identifie:
// des que de vrais fichiers .glb sont deposes et references dans la config, ce
// module les charge automatiquement via GLTFLoader et ignore la primitive.
//
// Fallback 2D: si WebGL est indisponible (isWebGLAvailable() === false), utilisez
// Personalization2DFallback a la place de Personalization3DViewer - meme API de
// base (setProduct/setColor/refreshTexture/dispose) mais rendu en <img> statique
// mis a jour depuis le meme canvas compose.

const THREE_VERSION = '0.160.0';
const THREE_BASE = `https://unpkg.com/three@${THREE_VERSION}`;

let threeModulesPromise = null;
function loadThreeModules() {
  if (!threeModulesPromise) {
    threeModulesPromise = Promise.all([
      import(/* webpackIgnore: true */ `${THREE_BASE}/build/three.module.js`),
      import(/* webpackIgnore: true */ `${THREE_BASE}/examples/jsm/controls/OrbitControls.js`),
      import(/* webpackIgnore: true */ `${THREE_BASE}/examples/jsm/loaders/GLTFLoader.js`),
      import(/* webpackIgnore: true */ `${THREE_BASE}/examples/jsm/geometries/DecalGeometry.js`)
    ]).then(([THREE, { OrbitControls }, { GLTFLoader }, { DecalGeometry }]) => ({ THREE, OrbitControls, GLTFLoader, DecalGeometry }));
  }
  return threeModulesPromise;
}

export function isWebGLAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext) && Boolean(
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    );
  } catch (error) {
    return false;
  }
}

export class Personalization3DViewer {
  constructor({ container, editor, product, color }) {
    this.container = container;
    this.editor = editor;
    this.product = product;
    this.color = color || '#ffffff';
    this.ready = false;
    this._disposed = false;
    this._textures = {};
  }

  async init() {
    const { THREE, OrbitControls, GLTFLoader, DecalGeometry } = await loadThreeModules();
    if (this._disposed) return;
    this.THREE = THREE;
    this.GLTFLoader = GLTFLoader;
    this.DecalGeometry = DecalGeometry;

    const width = this.container.clientWidth || 400;
    const height = this.container.clientHeight || 400;

    this.scene = new THREE.Scene();
    this.scene.background = null;

    this.camera = new THREE.PerspectiveCamera(32, width / height, 0.1, 100);
    this.camera.position.set(0, 0.1, 3.4);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xc8d0da, 1.3));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 3, 4);
    key.castShadow = true;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xb8d4ff, 1.1);
    fill.position.set(-3, -1, -2);
    this.scene.add(fill);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.8;
    this.controls.maxDistance = 5.5;
    this.controls.target.set(0, 0, 0);

    this._resizeObserver = new ResizeObserver(() => this._handleResize());
    this._resizeObserver.observe(this.container);

    await this._buildModel();
    this.ready = true;
    this._animate();
  }

  async setProduct(product, color) {
    this.product = product;
    if (color) this.color = color;
    await this._buildModel();
  }

  setColor(hex) {
    this.color = hex;
    if (this._bodyMaterials) {
      this._bodyMaterials.forEach((mat) => mat.color.set(hex));
    }
  }

  async _buildModel() {
    const THREE = this.THREE;
    if (this._decals?.length) {
      this._decals.forEach((decal) => {
        this.scene.remove(decal);
        decal.geometry?.dispose?.();
        decal.material?.dispose?.();
      });
      this._decals = [];
    }
    if (this._model) {
      this.scene.remove(this._model);
      this._disposeModel(this._model);
      this._model = null;
    }

    const modelUrl = this.product?.model3d?.url;
    if (modelUrl) {
      try {
        this._model = await this._loadGltf(modelUrl);
        this._applyTexturesToGltf();
        this.scene.add(this._model);
        return;
      } catch (error) {
        console.warn('[personalization-3d] Echec chargement GLB, bascule sur objet temporaire:', error);
      }
    }

    this._model = this._buildPlaceholderModel();
    this.scene.add(this._model);
  }

  _loadGltf(url) {
    return new Promise((resolve, reject) => {
      const loader = new this.GLTFLoader();
      loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
    });
  }

  _applyTexturesToGltf() {
    if (!this._model) return;
    const THREE = this.THREE;
    this._bodyMaterials = [];
    const initialBox = new THREE.Box3().setFromObject(this._model);
    const initialSize = initialBox.getSize(new THREE.Vector3());
    const initialCenter = initialBox.getCenter(new THREE.Vector3());
    const scale = 2.45 / Math.max(initialSize.y, .001);
    this._model.scale.setScalar(scale);
    this._model.position.set(-initialCenter.x * scale, -initialCenter.y * scale, -initialCenter.z * scale);
    this._model.updateMatrixWorld(true);

    let decalTarget = null;
    let largestRadius = 0;
    this._model.traverse((node) => {
      if (!node.isMesh) return;
      node.geometry.computeVertexNormals();
      node.geometry.computeBoundingSphere();
      // PBR suffisamment réaliste et compatible avec les GPU mobiles modestes.
      const material = new THREE.MeshStandardMaterial({
        color: this.product?.category === 'mug' ? '#ffffff' : this.color,
        map: this.product?.category === 'mug' ? this._getTexture('wrap') : null,
        roughness: .82,
        metalness: 0,
        side: THREE.DoubleSide
      });
      node.material = material;
      node.castShadow = true;
      node.receiveShadow = true;
      this._bodyMaterials.push(material);
      const radius = node.geometry.boundingSphere?.radius || 0;
      if (radius >= largestRadius) {
        largestRadius = radius;
        decalTarget = node;
      }
    });

    if (!decalTarget || this.product?.category !== 'tshirt') return;
    const box = new THREE.Box3().setFromObject(this._model);
    const size = box.getSize(new THREE.Vector3());
    const centerY = box.min.y + size.y * .54;
    const makeDecal = (face, z, rotationY) => {
      const texture = this._getTexture(face);
      const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        toneMapped: false
      });
      const decal = new THREE.Mesh(
        new this.DecalGeometry(
          decalTarget,
          new THREE.Vector3(0, centerY, z),
          new THREE.Euler(0, rotationY, 0),
          new THREE.Vector3(size.x * .44, size.y * .5, Math.max(size.z * .7, .25))
        ),
        material
      );
      decal.userData.isPersonalizationDecal = true;
      this._decals ||= [];
      this._decals.push(decal);
      this.scene.add(decal);
    };
    makeDecal('front', box.max.z + .015, 0);
    if ((this.product.faces || []).includes('back')) makeDecal('back', box.min.z - .015, Math.PI);
  }

  _buildPlaceholderModel() {
    const THREE = this.THREE;
    const shape = this.product?.model3d?.placeholderShape || 'tshirt';
    const group = new THREE.Group();
    this._bodyMaterials = [];

    if (shape === 'mug') {
      const bodyMat = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.35, metalness: 0.05 });
      this._bodyMaterials.push(bodyMat);
      const cylinder = new THREE.CylinderGeometry(1, 1, 1.6, 48, 1, true);
      const wrapTexture = this._getTexture('wrap');
      const wrapMat = new THREE.MeshStandardMaterial({ map: wrapTexture, roughness: 0.5 });
      const body = new THREE.Mesh(cylinder, wrapMat);
      group.add(body);

      const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.05, 12, 40), bodyMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.y = 0.8;
      group.add(rim);

      const handleCurve = new THREE.TorusGeometry(0.42, 0.09, 10, 24, Math.PI * 1.3);
      const handle = new THREE.Mesh(handleCurve, bodyMat);
      handle.position.set(1.15, 0, 0);
      handle.rotation.z = Math.PI / 2;
      handle.rotation.y = Math.PI / 2.4;
      group.add(handle);

      group.scale.setScalar(0.85);
      return group;
    }

    // Placeholder "t-shirt": carte 3D epaisse avec texture recto/verso independantes.
    const bodyMat = new THREE.MeshStandardMaterial({ color: this.color, roughness: 0.9 });
    this._bodyMaterials.push(bodyMat);
    const frontMat = new THREE.MeshStandardMaterial({ map: this._getTexture('front'), roughness: 0.9 });
    const backMat = new THREE.MeshStandardMaterial({ map: this._getTexture('back'), roughness: 0.9 });

    const geometry = new THREE.BoxGeometry(1.55, 1.9, 0.22, 1, 1, 1);
    // Ordre des groupes BoxGeometry: [+x,-x,+y,-y,+z(avant),-z(arriere)]
    const materials = [bodyMat, bodyMat, bodyMat, bodyMat, frontMat, backMat];
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.geometry.computeBoundingBox();
    group.add(mesh);

    // Encolure simplifiee (purement decorative, placeholder).
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.045, 10, 24, Math.PI),
      bodyMat
    );
    collar.position.set(0, 0.9, 0.1);
    collar.rotation.x = Math.PI;
    group.add(collar);

    return group;
  }

  _getTexture(face) {
    const THREE = this.THREE;
    if (this._textures[face]) return this._textures[face];
    const canvas = document.createElement('canvas');
    const size = this.product?.canvasSize || 1024;
    canvas.width = size;
    canvas.height = size;
    const background = this.product?.category === 'mug' ? this.color : null;
    this.editor.composeCanvas(canvas, face, { showZoneGuide: false, backgroundColor: background });
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    this._textures[face] = texture;
    this._textureCanvases = this._textureCanvases || {};
    this._textureCanvases[face] = canvas;
    return texture;
  }

  refreshTexture(face) {
    const canvas = this._textureCanvases?.[face];
    const texture = this._textures[face];
    if (!canvas || !texture) return;
    const background = this.product?.category === 'mug' ? this.color : null;
    this.editor.composeCanvas(canvas, face, { showZoneGuide: false, backgroundColor: background });
    texture.needsUpdate = true;
  }

  refreshAllTextures() {
    (this.product?.faces || []).forEach((face) => this.refreshTexture(face));
  }

  _handleResize() {
    if (!this.renderer || !this.camera) return;
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  _animate() {
    if (this._disposed) return;
    this._raf = requestAnimationFrame(() => this._animate());
    this.controls?.update();
    this.renderer?.render(this.scene, this.camera);
  }

  captureSnapshot() {
    // Utilise UNIQUEMENT pour un apercu visuel non contractuel (ex: partage rapide).
    // Ne jamais utiliser cette image comme fichier d'impression - voir personalization-storage.js.
    return this.renderer?.domElement?.toDataURL('image/png') || '';
  }

  getSnapshotCanvas() { return this.renderer?.domElement || null; }

  focusFace(face) {
    if (!this.camera || !this.controls) return;
    const distance = Math.max(this.controls.minDistance || 1.8, 3.25);
    if (face === 'back') this.camera.position.set(0, .08, -distance);
    else if (face === 'left') this.camera.position.set(-distance, .08, 0);
    else if (face === 'right') this.camera.position.set(distance, .08, 0);
    else if (face === 'wrap') this.camera.position.set(distance * .72, .08, distance * .72);
    else this.camera.position.set(0, .08, distance);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  _disposeModel(model) {
    model.traverse((node) => {
      if (node.geometry) node.geometry.dispose();
      if (node.material) {
        (Array.isArray(node.material) ? node.material : [node.material]).forEach((mat) => mat.dispose?.());
      }
    });
  }

  dispose() {
    this._disposed = true;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._resizeObserver?.disconnect();
    this.controls?.dispose();
    this._decals?.forEach((decal) => {
      this.scene?.remove(decal);
      decal.geometry?.dispose?.();
      decal.material?.dispose?.();
    });
    this._decals = [];
    if (this._model) this._disposeModel(this._model);
    Object.values(this._textures).forEach((tex) => tex.dispose());
    this.renderer?.dispose();
    if (this.container) this.container.innerHTML = '';
  }
}

// Rendu de secours quand WebGL n'est pas disponible: pas de rotation 3D reelle,
// mais le meme canvas compose (texte + images) est affiche, avec un controle
// manuel de la face (recto/verso/enveloppant) pour rester utilisable.
export class Personalization2DFallback {
  constructor({ container, editor, product, color }) {
    this.container = container;
    this.editor = editor;
    this.product = product;
    this.color = color || '#ffffff';
    this._canvas = document.createElement('canvas');
  }

  async init() {
    this.container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'pz-fallback-2d';
    const notice = document.createElement('div');
    notice.className = 'pz-fallback-2d-notice';
    notice.innerHTML = '<i class="fas fa-circle-info" aria-hidden="true"></i> Apercu 2D (la 3D n\'est pas disponible sur cet appareil/navigateur).';
    const imageWrap = document.createElement('div');
    imageWrap.className = 'pz-fallback-2d-image';
    this._img = document.createElement('img');
    this._img.alt = 'Apercu du produit personnalise';
    imageWrap.appendChild(this._img);
    wrap.appendChild(notice);
    wrap.appendChild(imageWrap);
    this.container.appendChild(wrap);
    this.refreshTexture(this.editor.getFace());
  }

  async setProduct(product, color) {
    this.product = product;
    if (color) this.color = color;
    this.refreshTexture(this.editor.getFace());
  }

  setColor(hex) {
    this.color = hex;
    this.refreshTexture(this.editor.getFace());
  }

  refreshTexture(face) {
    const size = this.product?.canvasSize || 1024;
    this._canvas.width = size;
    this._canvas.height = size;
    this.editor.composeCanvas(this._canvas, face, { showZoneGuide: false, backgroundColor: this.color });
    if (this._img) this._img.src = this._canvas.toDataURL('image/png');
  }

  refreshAllTextures() {
    this.refreshTexture(this.editor.getFace());
  }

  captureSnapshot() {
    return this._canvas.toDataURL('image/png');
  }

  getSnapshotCanvas() { return this._canvas; }
  focusFace() { this.refreshTexture(this.editor.getFace()); }

  dispose() {
    if (this.container) this.container.innerHTML = '';
  }
}

export async function createProductViewer(options) {
  if (isWebGLAvailable()) {
    const viewer = new Personalization3DViewer(options);
    try {
      await viewer.init();
      return viewer;
    } catch (error) {
      console.warn('[personalization-3d] Echec initialisation 3D, bascule 2D:', error);
      viewer.dispose();
    }
  }
  const fallback = new Personalization2DFallback(options);
  await fallback.init();
  return fallback;
}
