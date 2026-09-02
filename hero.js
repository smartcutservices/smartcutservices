import { db } from './firebase-init.js';
import {
  doc,
  getDoc,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import theme from './theme-root.js';

const HERO_COLLECTION = 'heroSectionControlMatrix9472';
const HERO_DOC_ID = 'heroPrimaryBlock8391';
const DEFAULT_AUTOPLAY_MS = 4800;

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizePosterFileName(value = '') {
  return String(value || '').trim();
}

function buildPosterUrl(fileName = '') {
  const raw = normalizePosterFileName(fileName);
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('./') || raw.startsWith('../') || raw.startsWith('/')) return raw;
  return `./${raw}`;
}

function extractLegacyFileName(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const normalized = raw.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || raw;
}

function normalizeSlide(slide = {}, index = 0) {
  const fileName = normalizePosterFileName(slide.fileName || slide.imageName || slide.posterName || slide.image || '');
  const desktopFileName = normalizePosterFileName(
    slide.desktopFileName ||
    slide.desktopImageName ||
    slide.desktopImage ||
    fileName
  );
  const mobileFileName = normalizePosterFileName(
    slide.mobileFileName ||
    slide.mobileImageName ||
    slide.mobileImage ||
    fileName ||
    desktopFileName
  );
  const altText = String(slide.altText || slide.alt || `Affiche Smart Cut ${index + 1}`).trim();
  return {
    id: String(slide.id || `poster-${index + 1}`).trim(),
    fileName,
    desktopFileName,
    mobileFileName,
    altText,
    isActive: slide.isActive !== false
  };
}

function getSlidesFromData(data = {}) {
  const rawSlides = Array.isArray(data.posterSlides)
    ? data.posterSlides
    : (Array.isArray(data.heroImages) ? data.heroImages : (Array.isArray(data.images) ? data.images : []));
  const explicitSlides = Array.isArray(rawSlides)
    ? rawSlides.map((slide, index) => normalizeSlide(typeof slide === 'string' ? { fileName: slide } : slide, index))
    : [];
  const filteredExplicit = explicitSlides.filter((slide) => slide.isActive !== false && (slide.desktopFileName || slide.mobileFileName || slide.fileName));
  if (filteredExplicit.length) return filteredExplicit;

  const legacyNames = Array.isArray(data.heroPosterImageNames)
    ? data.heroPosterImageNames
        .map((name, index) => normalizeSlide({ fileName: name, altText: `Affiche Smart Cut ${index + 1}` }, index))
        .filter((slide) => slide.fileName)
    : [];
  if (legacyNames.length) return legacyNames;

  const legacySingle = normalizePosterFileName(
    data.heroPosterImageName ||
    extractLegacyFileName(data.heroImageURL839 || '')
  );
  if (legacySingle) {
    return [normalizeSlide({ fileName: legacySingle, altText: data.heroTitleText552 || 'Affiche Smart Cut' })];
  }

  return [];
}

class SierraHero {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.options = {
      collectionName: options.collectionName || HERO_COLLECTION,
      docId: options.docId || HERO_DOC_ID,
      ...options
    };

    this.data = null;
    this.currentIndex = 0;
    this.autoplayTimer = null;
    this.autoplayEnabled = options.autoplay !== false;
    this.mobileScrollLock = false;
    this.unsubscribeSnapshot = null;
    this.unsubscribeTheme = null;
    this.handleResize = this.handleResize.bind(this);

    this.unsubscribeTheme = theme.subscribe(() => {
      this.injectStyles();
      if (this.data) this.renderHero(this.data);
    });

    this.init();
  }

  injectStyles() {
    const existing = document.getElementById('smartcutPosterHeroStyles');
    if (existing) existing.remove();

    const colors = theme.getColors?.() || {};
    const fonts = theme.getFonts?.() || {};
    const typography = theme.getTypography?.() || {};

    const accent = colors?.background?.button || '#FFA41C';
    const headingFont = typography?.family || fonts?.primary || "'Amazon Ember', Arial, Helvetica, sans-serif";
    const bodyFont = fonts?.secondary || "'Amazon Ember', Arial, Helvetica, sans-serif";

    const style = document.createElement('style');
    style.id = 'smartcutPosterHeroStyles';
    style.textContent = `
      :root {
        --poster-hero-accent: ${accent};
        --poster-hero-heading: ${headingFont};
        --poster-hero-body: ${bodyFont};
        --poster-hero-bg: #EAEDED;
        --poster-hero-surface: #FFFFFF;
        --poster-hero-text: #FFFFFF;
        --poster-hero-muted: rgba(255,255,255,0.8);
        --poster-hero-border: rgba(255,255,255,0.22);
        --poster-hero-empty-text: #0F1111;
        --poster-hero-empty-muted: #565959;
      }

      .posterHeroRoot913 {
        position: relative;
        width: 100%;
        background: var(--poster-hero-bg);
        overflow: hidden;
        margin-top: 2rem;
      }

      .posterHeroViewport913 {
        position: relative;
        min-height: 0;
      }

      .posterHeroBackdrop913 {
        position: absolute;
        inset: 0;
        background: transparent;
        pointer-events: none;
        z-index: 0;
      }

      .posterHeroTrack913 {
        position: relative;
        z-index: 1;
        display: flex;
        width: 100%;
        transform: translate3d(0,0,0);
        transition: transform .78s cubic-bezier(.22, 1, .36, 1);
      }

      .posterHeroSlide913 {
        min-width: 100%;
        width: 100%;
        padding: 0.8rem 0.8rem 0;
        display: flex;
        align-items: flex-start;
        box-sizing: border-box;
      }

      .posterHeroPoster913 {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        border-radius: .5rem;
        overflow: hidden;
        border: 1px solid #D5D9D9;
        box-shadow: 0 2px 5px rgba(15, 17, 17, .15);
        background: #FFFFFF;
      }

      .posterHeroPosterImage913 {
        display: block;
        width: auto;
        height: auto;
        max-width: 100%;
        object-fit: contain;
        object-position: center;
        border-radius: inherit;
      }

      .posterHeroFooter913 {
        position: absolute;
        left: .8rem;
        right: .8rem;
        bottom: .8rem;
        z-index: 3;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        pointer-events: none;
      }

      .posterHeroDots913 {
        display: flex;
        align-items: center;
        gap: .3rem;
        padding: .38rem .48rem;
        border-radius: 999px;
        background: rgba(19,25,33,0.42);
        border: 1px solid rgba(255,255,255,.28);
        backdrop-filter: blur(10px);
        pointer-events: auto;
      }

      .posterHeroDot913 {
        width: .42rem;
        height: .42rem;
        min-width: .42rem;
        min-height: .42rem;
        aspect-ratio: 1 / 1;
        flex: 0 0 .42rem;
        border-radius: 999px;
        border: none;
        padding: 0;
        background: rgba(255,255,255,0.5);
        cursor: pointer;
        transition: transform .25s ease, background-color .25s ease;
      }

      .posterHeroDot913.is-active {
        background: var(--poster-hero-accent);
        transform: scale(1.12);
      }

      .posterHeroArrows913 {
        display: none;
        align-items: center;
        gap: .65rem;
        pointer-events: auto;
      }

      .posterHeroArrow913 {
        width: 3rem;
        height: 3rem;
        border-radius: 999px;
        border: 1px solid var(--poster-hero-border);
        background: rgba(19,25,33,0.6);
        backdrop-filter: blur(14px);
        color: var(--poster-hero-text);
        font-size: 1rem;
        cursor: pointer;
        transition: transform .25s ease, background-color .25s ease, border-color .25s ease;
      }

      .posterHeroArrow913:hover {
        transform: translateY(-2px);
        border-color: rgba(255,164,28,0.6);
        background: rgba(19,25,33,0.78);
      }

      .posterHeroEmpty913 {
        min-height: 420px;
        display: grid;
        place-items: center;
        padding: 2rem;
        text-align: center;
        color: var(--poster-hero-empty-muted);
        font-family: var(--poster-hero-body);
      }

      .posterHeroEmpty913 strong {
        display: block;
        color: var(--poster-hero-empty-text);
        font-size: 1rem;
        margin-bottom: .4rem;
        text-transform: uppercase;
        letter-spacing: .1em;
      }

      @media (min-width: 768px) {
        .posterHeroRoot913 {
          margin-top: 2.4rem;
        }

        .posterHeroFooter913 {
          left: 1.5rem;
          right: 1.5rem;
          bottom: 1.5rem;
        }
      }

      @media (max-width: 767px) {
        .posterHeroRoot913 {
          margin-top: 0;
        }

        .posterHeroSlide913 {
          padding: .35rem .35rem 0;
        }

        .posterHeroFooter913 {
          left: .75rem;
          right: .75rem;
          bottom: .75rem;
        }
      }

      @media (min-width: 1024px) {
        .posterHeroRoot913 {
          margin-top: 0;
        }

        .posterHeroPoster913 {
          height: clamp(340px, 44vh, 460px);
        }

        .posterHeroPosterImage913 {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .posterHeroArrows913 {
          display: inline-flex;
        }
      }
    `;

    document.head.appendChild(style);
  }

  init() {
    this.injectStyles();
    this.renderLoading();
    this.bindLifecycle();
    this.loadHero();
  }

  bindLifecycle() {
    window.addEventListener('resize', this.handleResize);
  }

  handleResize() {
    if (!this.data) return;
    this.applySliderPosition(false);
  }

  renderLoading() {
    this.container.innerHTML = `
      <section class="posterHeroRoot913">
        <div class="posterHeroEmpty913">
          <div>
            <strong>Chargement</strong>
            <span>Préparation des affiches hero...</span>
          </div>
        </div>
      </section>
    `;
  }

  renderEmpty(message = 'Aucune affiche hero active pour le moment.') {
    this.stopAutoplay();
    this.container.innerHTML = `
      <section class="posterHeroRoot913">
        <div class="posterHeroEmpty913">
          <div>
            <strong>Hero inactif</strong>
            <span>${message}</span>
          </div>
        </div>
      </section>
    `;
  }

  renderHero(data = {}) {
    this.stopAutoplay();
    const isActive = data.heroIsActiveToggle321 !== false;
    const slides = getSlidesFromData(data);
    if (!isActive || !slides.length) {
      this.renderEmpty(isActive ? 'Ajoutez des affiches depuis le dashboard hero.' : 'La section hero est désactivée dans le dashboard.');
      return;
    }

    const total = slides.length;
    const autoplayDelay = Math.max(2600, toNumber(data.heroAutoplayDelayMs, DEFAULT_AUTOPLAY_MS));

    this.currentIndex = Math.min(this.currentIndex, total - 1);

    this.container.innerHTML = `
      <section class="posterHeroRoot913" aria-label="Affiches Smart Cut Services">
        <div class="posterHeroViewport913">
          <div class="posterHeroBackdrop913"></div>

          <div class="posterHeroTrack913" data-hero-track>
            ${slides.map((slide, index) => {
              const desktopUrl = buildPosterUrl(slide.desktopFileName || slide.fileName || slide.mobileFileName);
              const mobileUrl = buildPosterUrl(slide.mobileFileName || slide.fileName || slide.desktopFileName);
              const safeDesktopUrl = this.escape(String(desktopUrl || ''));
              const safeMobileUrl = this.escape(String(mobileUrl || desktopUrl || ''));
              return `
                <article class="posterHeroSlide913" data-hero-slide="${index}" aria-hidden="${index === this.currentIndex ? 'false' : 'true'}">
                  <picture class="posterHeroPoster913">
                    <source media="(min-width: 768px)" srcset="${safeDesktopUrl}">
                    <img class="posterHeroPosterImage913" src="${safeMobileUrl}" alt="${this.escape(slide.altText)}" loading="${index === 0 ? 'eager' : 'lazy'}" decoding="async">
                  </picture>
                </article>
              `;
            }).join('')}
          </div>

          <div class="posterHeroFooter913">
            <div class="posterHeroDots913" aria-label="Navigation affiches">
              ${slides.map((slide, index) => `
                <button
                  type="button"
                  class="posterHeroDot913 ${index === this.currentIndex ? 'is-active' : ''}"
                  data-hero-dot="${index}"
                  aria-label="Voir l'affiche ${index + 1}"
                ></button>
              `).join('')}
            </div>

            <div class="posterHeroArrows913" aria-label="Flèches hero">
              <button type="button" class="posterHeroArrow913" data-hero-prev aria-label="Affiche précédente">‹</button>
              <button type="button" class="posterHeroArrow913" data-hero-next aria-label="Affiche suivante">›</button>
            </div>
          </div>
        </div>
      </section>
    `;

    this.trackEl = this.container.querySelector('[data-hero-track]');
    this.slideEls = Array.from(this.container.querySelectorAll('[data-hero-slide]'));
    this.dotEls = Array.from(this.container.querySelectorAll('[data-hero-dot]'));
    this.prevBtn = this.container.querySelector('[data-hero-prev]');
    this.nextBtn = this.container.querySelector('[data-hero-next]');
    this.autoplayDelay = autoplayDelay;

    this.attachSliderEvents();
    this.applySliderPosition(false);
    this.startAutoplay();
  }

  attachSliderEvents() {
    this.dotEls.forEach((button) => {
      button.addEventListener('click', () => {
        const index = toNumber(button.dataset.heroDot, 0);
        this.goTo(index, true);
      });
    });

    this.prevBtn?.addEventListener('click', () => this.goTo(this.currentIndex - 1, true));
    this.nextBtn?.addEventListener('click', () => this.goTo(this.currentIndex + 1, true));

    let pointerStartX = 0;
    let pointerActive = false;

    this.trackEl?.addEventListener('pointerdown', (event) => {
      pointerActive = true;
      pointerStartX = event.clientX;
      this.stopAutoplay();
    });

    this.trackEl?.addEventListener('pointerup', (event) => {
      if (!pointerActive) return;
      const delta = event.clientX - pointerStartX;
      pointerActive = false;

      if (Math.abs(delta) > 36) {
        if (delta < 0) {
          this.goTo(this.currentIndex + 1, true);
        } else {
          this.goTo(this.currentIndex - 1, true);
        }
      } else {
        this.startAutoplay();
      }
    });

    this.trackEl?.addEventListener('pointercancel', () => {
      pointerActive = false;
      this.startAutoplay();
    });

    this.trackEl?.addEventListener('pointerleave', () => {
      pointerActive = false;
      this.startAutoplay();
    });
  }

  goTo(index, restartAutoplay = false) {
    if (!this.slideEls?.length) return;
    const max = this.slideEls.length - 1;
    if (index < 0) {
      this.currentIndex = max;
    } else if (index > max) {
      this.currentIndex = 0;
    } else {
      this.currentIndex = index;
    }

    this.applySliderPosition();
    if (restartAutoplay) this.startAutoplay();
  }

  applySliderPosition(animate = true) {
    if (!this.trackEl) return;
    this.trackEl.style.transition = animate ? 'transform .78s cubic-bezier(.22, 1, .36, 1)' : 'none';
    this.trackEl.style.transform = `translate3d(-${this.currentIndex * 100}%, 0, 0)`;

    this.slideEls?.forEach((slide, index) => {
      slide.setAttribute('aria-hidden', index === this.currentIndex ? 'false' : 'true');
    });

    this.dotEls?.forEach((dot, index) => {
      dot.classList.toggle('is-active', index === this.currentIndex);
    });

    this.syncBackdropColor();
  }

  syncBackdropColor() {
    const image = this.slideEls?.[this.currentIndex]?.querySelector('img');
    if (!image) return;
    const apply = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 16;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, 16, 16);
        const pixels = context.getImageData(0, 0, 16, 16).data;
        let r = 0, g = 0, b = 0, count = 0;
        let rr = 0, gg = 0, bb = 0, rightCount = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] < 180) continue;
          r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; count++;
          const pixelIndex = (i / 4) % 16;
          if (pixelIndex >= 8) { rr += pixels[i]; gg += pixels[i + 1]; bb += pixels[i + 2]; rightCount++; }
        }
        if (!count) return;
        const color = `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`;
        document.documentElement.style.setProperty('--hero-dominant-color', color);
        let themeMeta = document.querySelector('meta[name="theme-color"]');
        if (!themeMeta) {
          themeMeta = document.createElement('meta');
          themeMeta.name = 'theme-color';
          document.head.appendChild(themeMeta);
        }
        themeMeta.setAttribute('content', color);
        if (rightCount) {
          document.documentElement.style.setProperty('--hero-secondary-color', `rgb(${Math.round(rr / rightCount)}, ${Math.round(gg / rightCount)}, ${Math.round(bb / rightCount)})`);
        }
      } catch (_) {
        // Images distantes sans CORS : conserver la couleur précédente.
      }
    };
    if (image.complete) apply();
    else image.addEventListener('load', apply, { once: true });
  }

  startAutoplay() {
    this.stopAutoplay();
    if (!this.autoplayEnabled) return;
    if (!this.slideEls?.length || this.slideEls.length < 2) return;
    this.autoplayTimer = window.setInterval(() => {
      this.goTo(this.currentIndex + 1);
    }, this.autoplayDelay || DEFAULT_AUTOPLAY_MS);
  }

  stopAutoplay() {
    if (this.autoplayTimer) {
      window.clearInterval(this.autoplayTimer);
      this.autoplayTimer = null;
    }
  }

  async loadHero() {
    try {
      const heroDocRef = doc(db, this.options.collectionName, this.options.docId);
      const snap = await getDoc(heroDocRef);
      this.data = snap.exists() ? (snap.data() || {}) : {};
      this.renderHero(this.data);

      this.unsubscribeSnapshot?.();
      this.unsubscribeSnapshot = onSnapshot(heroDocRef, (nextSnap) => {
        this.data = nextSnap.exists() ? (nextSnap.data() || {}) : {};
        this.renderHero(this.data);
      });
    } catch (error) {
      console.error('Erreur chargement hero affiches:', error);
      this.renderEmpty('Impossible de charger les affiches hero pour le moment.');
    }
  }

  escape(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  destroy() {
    this.stopAutoplay();
    this.unsubscribeSnapshot?.();
    this.unsubscribeTheme?.();
    window.removeEventListener('resize', this.handleResize);
  }
}

export default SierraHero;
