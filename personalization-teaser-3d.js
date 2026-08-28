// Apercu 3D autonome et leger pour la page d'accueil.
// Three.js n'est charge qu'apres l'apparition de la section a l'ecran.

const THREE_BASE = 'https://unpkg.com/three@0.160.0';

let modulesPromise = null;
function loadModules() {
  if (!modulesPromise) {
    modulesPromise = Promise.all([
      import(/* webpackIgnore: true */ `${THREE_BASE}/build/three.module.js`),
      import(/* webpackIgnore: true */ `${THREE_BASE}/examples/jsm/loaders/GLTFLoader.js`),
      import(/* webpackIgnore: true */ `${THREE_BASE}/examples/jsm/geometries/DecalGeometry.js`)
    ]).then(([THREE, { GLTFLoader }, { DecalGeometry }]) => ({ THREE, GLTFLoader, DecalGeometry }));
  }
  return modulesPromise;
}

function canUseWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGLRenderingContext) && Boolean(
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl')
    );
  } catch (error) {
    return false;
  }
}

export default class PersonalizationTeaser3D {
  constructor(container) {
    this.container = container;
    this.stage = container?.querySelector('[data-pz-teaser-stage]') || null;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false;
    this.disposed = false;
    this.visible = true;
    this.dragging = false;
  }

  async init() {
    if (!this.stage || !canUseWebGL()) return false;

    try {
      const modules = await loadModules();
      this.THREE = modules.THREE;
      this.GLTFLoader = modules.GLTFLoader;
      this.DecalGeometry = modules.DecalGeometry;
      if (this.disposed) return false;
      this.setupScene();
      await this.loadTshirt();
      if (this.disposed) return false;
      this.bindInteraction();
      this.observeSizeAndVisibility();
      this.container.classList.add('is-3d-ready');
      this.container.querySelector('.pz-teaser-product')?.setAttribute('aria-hidden', 'true');
      this.animate();
      return true;
    } catch (error) {
      console.warn('[personalization-teaser] Aperçu 3D indisponible, image de secours conservée.', error);
      return false;
    }
  }

  setupScene() {
    const THREE = this.THREE;
    const width = this.stage.clientWidth || 480;
    const height = this.stage.clientHeight || 360;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(31, width / height, 0.1, 100);
    this.camera.position.set(0, 0, 4.65);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setSize(width, height, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', 'T-shirt personnalisé tournant à 360 degrés');
    this.renderer.domElement.tabIndex = 0;
    this.stage.appendChild(this.renderer.domElement);

    const ambient = new THREE.HemisphereLight(0xeaf3ff, 0x111820, 2.15);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 3.1);
    key.position.set(-2.5, 3.5, 4.5);
    this.scene.add(key);

    const warmRim = new THREE.DirectionalLight(0xffc75f, 2.25);
    warmRim.position.set(4, 1.5, -2.4);
    this.scene.add(warmRim);

    const coolRim = new THREE.DirectionalLight(0x7198cf, 1.8);
    coolRim.position.set(-4, .5, -2.8);
    this.scene.add(coolRim);

    this.clock = new THREE.Clock();
  }

  async loadTshirt() {
    const THREE = this.THREE;
    const gltf = await new this.GLTFLoader().loadAsync('./assets/models/shirt-realistic.glb');
    this.product = new THREE.Group();
    const shirtModel = gltf.scene;

    const sourceBox = new THREE.Box3().setFromObject(shirtModel);
    const sourceSize = sourceBox.getSize(new THREE.Vector3());
    const sourceCenter = sourceBox.getCenter(new THREE.Vector3());
    const targetHeight = 2.55;
    const uniformScale = targetHeight / Math.max(sourceSize.y, .001);
    shirtModel.scale.setScalar(uniformScale);
    shirtModel.position.set(
      -sourceCenter.x * uniformScale,
      -sourceCenter.y * uniformScale,
      -sourceCenter.z * uniformScale
    );

    let decalTarget = null;
    let largestSurface = 0;
    shirtModel.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      node.geometry.computeVertexNormals();
      node.geometry.computeBoundingSphere();
      node.material = new THREE.MeshPhysicalMaterial({
        color: 0x17263d,
        roughness: .86,
        metalness: 0,
        sheen: 1,
        sheenColor: new THREE.Color(0x35557e),
        sheenRoughness: .72,
        side: THREE.DoubleSide
      });
      const surface = node.geometry.boundingSphere?.radius || 0;
      if (surface >= largestSurface) {
        largestSurface = surface;
        decalTarget = node;
      }
    });

    this.product.add(shirtModel);
    this.scene.add(this.product);
    shirtModel.updateMatrixWorld(true);

    const normalizedBox = new THREE.Box3().setFromObject(shirtModel);
    const normalizedSize = normalizedBox.getSize(new THREE.Vector3());
    if (decalTarget) {
      const logoTexture = await new THREE.TextureLoader().loadAsync('./logo.png');
      logoTexture.colorSpace = THREE.SRGBColorSpace;
      logoTexture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      const logoMaterial = new THREE.MeshBasicMaterial({
        map: logoTexture,
        transparent: true,
        alphaTest: .04,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        toneMapped: false
      });
      const chestPosition = new THREE.Vector3(
        0,
        normalizedBox.min.y + normalizedSize.y * .55,
        normalizedBox.max.z + .02
      );
      const logoSize = new THREE.Vector3(normalizedSize.x * .36, normalizedSize.y * .36, normalizedSize.z * .55);
      const logoDecal = new THREE.Mesh(
        new this.DecalGeometry(decalTarget, chestPosition, new THREE.Euler(0, 0, 0), logoSize),
        logoMaterial
      );
      this.product.add(logoDecal);
    }

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: .24, depthWrite: false })
    );
    shadow.scale.set(1.25, .28, 1);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(0, normalizedBox.min.y - .14, -.12);
    this.scene.add(shadow);

    this.product.rotation.set(-.04, -.18, 0);
  }

  bindInteraction() {
    const canvas = this.renderer.domElement;
    canvas.style.touchAction = 'pan-y';

    this.onPointerDown = (event) => {
      this.dragging = true;
      this.lastPointerX = event.clientX;
      this.manualUntil = performance.now() + 1800;
      canvas.setPointerCapture?.(event.pointerId);
    };
    this.onPointerMove = (event) => {
      if (!this.dragging || !this.product) return;
      const delta = event.clientX - this.lastPointerX;
      this.lastPointerX = event.clientX;
      this.product.rotation.y += delta * .012;
      this.manualUntil = performance.now() + 1800;
    };
    this.onPointerUp = (event) => {
      this.dragging = false;
      canvas.releasePointerCapture?.(event.pointerId);
    };
    this.onKeyDown = (event) => {
      if (!this.product || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      this.product.rotation.y += event.key === 'ArrowLeft' ? -.18 : .18;
      this.manualUntil = performance.now() + 1800;
    };

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('keydown', this.onKeyDown);
  }

  observeSizeAndVisibility() {
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);

    this.visibilityObserver = new IntersectionObserver(([entry]) => {
      this.visible = Boolean(entry?.isIntersecting);
      if (this.visible) this.clock?.getDelta();
    }, { threshold: .05 });
    this.visibilityObserver.observe(this.container);
  }

  resize() {
    if (!this.renderer || !this.camera || !this.stage) return;
    const width = this.stage.clientWidth || 1;
    const height = this.stage.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  animate() {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(() => this.animate());
    if (!this.visible || !this.renderer || !this.product) return;

    const delta = Math.min(this.clock.getDelta(), .05);
    if (!this.reducedMotion && !this.dragging && performance.now() > (this.manualUntil || 0)) {
      const targetRotation = Math.sin(performance.now() * .00038) * .48;
      let difference = targetRotation - this.product.rotation.y;
      difference = Math.atan2(Math.sin(difference), Math.cos(difference));
      this.product.rotation.y += difference * Math.min(1, delta * 2.8);
    }
    this.product.position.y = this.reducedMotion ? 0 : Math.sin(performance.now() * .00115) * .035;
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.visibilityObserver?.disconnect();

    const canvas = this.renderer?.domElement;
    canvas?.removeEventListener('pointerdown', this.onPointerDown);
    canvas?.removeEventListener('pointermove', this.onPointerMove);
    canvas?.removeEventListener('pointerup', this.onPointerUp);
    canvas?.removeEventListener('pointercancel', this.onPointerUp);
    canvas?.removeEventListener('keydown', this.onKeyDown);

    this.product?.traverse((node) => {
      node.geometry?.dispose?.();
      if (node.material) {
        (Array.isArray(node.material) ? node.material : [node.material]).forEach((material) => {
          material.map?.dispose?.();
          material.dispose?.();
        });
      }
    });
    this.renderer?.dispose();
    this.stage?.replaceChildren();
  }
}
