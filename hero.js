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
  const explicitSlides = Array.isArray(data.posterSlides)
    ? data.posterSlides.map((slide, index) => normalizeSlide(slide, index))
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

    const accent = colors?.background?.button || '#C6A75E';
    const headingFont = typography?.family || fonts?.primary || "'Cormorant Garamond', serif";
    const bodyFont = fonts?.secondary || "'Manrope', sans-serif";

    const style = document.createElement('style');
    style.id = 'smartcutPosterHeroStyles';
    style.textContent = `
      :root {
        --poster-hero-accent: ${accent};
        --poster-hero-heading: ${headingFont};
        --poster-hero-body: ${bodyFont};
        --poster-hero-bg: #e9e4db;
        --poster-hero-surface: rgba(255,255,255,0.08);
        --poster-hero-text: #f8f5ef;
        --poster-hero-muted: rgba(248,245,239,0.7);
        --poster-hero-border: rgba(255,255,255,0.14);
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
        border-radius: 1.2rem;
        overflow: hidden;
        border: 1px solid rgba(184, 155, 123, 0.14);
        box-shadow: 0 18px 44px rgba(31, 30, 28, 0.08);
        background: #d8d2c8;
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
        left: 1.25rem;
        right: 1.25rem;
        bottom: 1.25rem;
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
        gap: .45rem;
        padding: .65rem .75rem;
        border-radius: 999px;
        background: rgba(8,8,8,0.34);
        border: 1px solid var(--poster-hero-border);
        backdrop-filter: blur(12px);
        pointer-events: auto;
      }

      .posterHeroDot913 {
        width: .7rem;
        height: .7rem;
        border-radius: 999px;
        border: none;
        padding: 0;
        background: rgba(255,255,255,0.24);
        cursor: pointer;
        transition: transform .25s ease, background-color .25s ease;
      }

      .posterHeroDot913.is-active {
        background: var(--poster-hero-accent);
        transform: scale(1.16);
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
        background: rgba(8,8,8,0.42);
        backdrop-filter: blur(14px);
        color: var(--poster-hero-text);
        font-size: 1rem;
        cursor: pointer;
        transition: transform .25s ease, background-color .25s ease, border-color .25s ease;
      }

      .posterHeroArrow913:hover {
        transform: translateY(-2px);
        border-color: rgba(198,167,94,0.55);
        background: rgba(18,18,18,0.55);
      }

      .posterHeroEmpty913 {
        min-height: 420px;
        display: grid;
        place-items: center;
        padding: 2rem;
        text-align: center;
        color: var(--poster-hero-muted);
        font-family: var(--poster-hero-body);
      }

      .posterHeroEmpty913 strong {
        display: block;
        color: var(--poster-hero-text);
        font-size: 1rem;
        margin-bottom: .4rem;
        text-transform: uppercase;
        letter-spacing: .18em;
      }

      @media (min-width: 768px) {
        .posterHeroRoot913 {
          margin-top: 2.4rem;
        }

        .posterHeroPoster913 {
          border-radius: 1.6rem;
        }

        .posterHeroFooter913 {
          left: 1.5rem;
          right: 1.5rem;
          bottom: 1.5rem;
        }
      }

      @media (min-width: 1024px) {
        .posterHeroRoot913 {
          margin-top: 0;
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
              <button type="button" class="posterHeroArrow913" data-hero-prev aria-label="Affiche précédente">←</button>
              <button type="button" class="posterHeroArrow913" data-hero-next aria-label="Affiche suivante">→</button>
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

    this.container.addEventListener('mouseenter', () => this.stopAutoplay());
    this.container.addEventListener('mouseleave', () => this.startAutoplay());

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
  }

  startAutoplay() {
    this.stopAutoplay();
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
