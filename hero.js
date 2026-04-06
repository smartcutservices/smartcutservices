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
  const altText = String(slide.altText || slide.alt || `Affiche Smart Cut ${index + 1}`).trim();
  return {
    id: String(slide.id || `poster-${index + 1}`).trim(),
    fileName,
    altText,
    isActive: slide.isActive !== false
  };
}

function getSlidesFromData(data = {}) {
  const explicitSlides = Array.isArray(data.posterSlides)
    ? data.posterSlides.map((slide, index) => normalizeSlide(slide, index))
    : [];
  const filteredExplicit = explicitSlides.filter((slide) => slide.isActive !== false && slide.fileName);
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
        --poster-hero-bg: #0f0d0b;
        --poster-hero-surface: rgba(255,255,255,0.08);
        --poster-hero-text: #f8f5ef;
        --poster-hero-muted: rgba(248,245,239,0.7);
        --poster-hero-border: rgba(255,255,255,0.14);
      }

      .posterHeroRoot913 {
        position: relative;
        width: 100%;
        background:
          radial-gradient(circle at top right, rgba(198, 167, 94, 0.22), transparent 32%),
          linear-gradient(180deg, #151210 0%, #0f0d0b 100%);
        overflow: hidden;
      }

      .posterHeroViewport913 {
        position: relative;
        min-height: clamp(420px, 72vh, 780px);
        display: grid;
        grid-template-columns: 1fr;
      }

      .posterHeroBackdrop913 {
        position: absolute;
        inset: 0;
        background:
          linear-gradient(180deg, rgba(0,0,0,0.08), rgba(0,0,0,0.38)),
          radial-gradient(circle at 16% 18%, rgba(198,167,94,0.12), transparent 28%);
        pointer-events: none;
        z-index: 0;
      }

      .posterHeroTopline913 {
        position: absolute;
        top: 1rem;
        left: 1rem;
        z-index: 3;
        display: inline-flex;
        align-items: center;
        gap: .6rem;
        padding: .65rem .9rem;
        border-radius: 999px;
        border: 1px solid var(--poster-hero-border);
        background: rgba(8, 8, 8, 0.34);
        backdrop-filter: blur(12px);
        color: var(--poster-hero-text);
        font-family: var(--poster-hero-body);
        font-size: .73rem;
        letter-spacing: .16em;
        text-transform: uppercase;
      }

      .posterHeroTopline913::before {
        content: "";
        width: .55rem;
        height: .55rem;
        border-radius: 999px;
        background: var(--poster-hero-accent);
        box-shadow: 0 0 0 6px rgba(198,167,94,0.14);
      }

      .posterHeroTrack913 {
        position: relative;
        z-index: 1;
        display: flex;
        width: 100%;
        height: 100%;
        transform: translate3d(0,0,0);
        transition: transform .78s cubic-bezier(.22, 1, .36, 1);
      }

      .posterHeroSlide913 {
        min-width: 100%;
        width: 100%;
        padding: 5rem 1rem 1.2rem;
        display: flex;
        align-items: stretch;
      }

      .posterHeroPoster913 {
        position: relative;
        width: 100%;
        min-height: 360px;
        border-radius: 1.6rem;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,0.1);
        box-shadow: 0 26px 80px rgba(0,0,0,0.32);
        background-color: #2d241b;
        background-repeat: no-repeat;
        background-position: center;
        background-size: cover;
        isolation: isolate;
      }

      .posterHeroPoster913::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(180deg, rgba(0,0,0,0.05), rgba(0,0,0,0.16)),
          linear-gradient(0deg, rgba(7,7,7,0.58), rgba(7,7,7,0.04) 42%, rgba(7,7,7,0.14));
        z-index: 0;
      }

      .posterHeroPoster913::after {
        content: "";
        position: absolute;
        inset: auto -10% -28% auto;
        width: 66%;
        height: 60%;
        border-radius: 999px;
        background: radial-gradient(circle, rgba(198,167,94,0.22), transparent 70%);
        filter: blur(24px);
        pointer-events: none;
        z-index: 0;
      }

      .posterHeroCaption913 {
        position: absolute;
        left: 1rem;
        right: 1rem;
        bottom: 1rem;
        z-index: 1;
        display: flex;
        justify-content: space-between;
        align-items: end;
        gap: 1rem;
      }

      .posterHeroCaptionCopy913 {
        max-width: min(100%, 520px);
      }

      .posterHeroEyebrow913 {
        display: inline-flex;
        align-items: center;
        gap: .55rem;
        color: var(--poster-hero-accent);
        font-family: var(--poster-hero-body);
        font-size: .72rem;
        font-weight: 700;
        letter-spacing: .18em;
        text-transform: uppercase;
        margin-bottom: .8rem;
      }

      .posterHeroEyebrow913::before {
        content: "";
        width: 1.9rem;
        height: 1px;
        background: currentColor;
      }

      .posterHeroTitle913 {
        margin: 0;
        color: var(--poster-hero-text);
        font-family: var(--poster-hero-heading);
        font-size: clamp(2rem, 7vw, 4.9rem);
        line-height: .94;
        text-wrap: balance;
        max-width: 10ch;
      }

      .posterHeroMeta913 {
        color: var(--poster-hero-muted);
        font-family: var(--poster-hero-body);
        font-size: .95rem;
        margin-top: .9rem;
        max-width: 38ch;
        line-height: 1.6;
      }

      .posterHeroCounter913 {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: .7rem;
        padding: .75rem .9rem;
        border-radius: 999px;
        border: 1px solid var(--poster-hero-border);
        background: rgba(8,8,8,0.42);
        backdrop-filter: blur(14px);
        color: var(--poster-hero-text);
        font-family: var(--poster-hero-body);
      }

      .posterHeroCounter913 strong {
        font-size: 1rem;
      }

      .posterHeroCounter913 span {
        color: var(--poster-hero-muted);
        font-size: .78rem;
        text-transform: uppercase;
        letter-spacing: .14em;
      }

      .posterHeroFooter913 {
        position: absolute;
        left: 1rem;
        right: 1rem;
        bottom: 1rem;
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

      .posterHeroScrollHint913 {
        position: absolute;
        top: 1rem;
        right: 1rem;
        z-index: 3;
        display: inline-flex;
        align-items: center;
        gap: .55rem;
        padding: .6rem .85rem;
        border-radius: 999px;
        color: var(--poster-hero-muted);
        border: 1px solid var(--poster-hero-border);
        background: rgba(8,8,8,0.34);
        font-family: var(--poster-hero-body);
        font-size: .72rem;
        letter-spacing: .12em;
        text-transform: uppercase;
        backdrop-filter: blur(12px);
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
        .posterHeroSlide913 {
          padding: 5.6rem 1.8rem 1.6rem;
        }

        .posterHeroPoster913 {
          min-height: clamp(480px, 76vh, 720px);
          border-radius: 2rem;
        }

        .posterHeroTopline913 {
          top: 1.4rem;
          left: 1.5rem;
          padding: .7rem 1rem;
        }

        .posterHeroScrollHint913 {
          top: 1.4rem;
          right: 1.5rem;
        }

        .posterHeroCaption913 {
          left: 1.6rem;
          right: 1.6rem;
          bottom: 1.5rem;
        }

        .posterHeroFooter913 {
          left: 1.5rem;
          right: 1.5rem;
          bottom: 1.5rem;
        }
      }

      @media (min-width: 1024px) {
        .posterHeroArrows913 {
          display: inline-flex;
        }

        .posterHeroScrollHint913 {
          display: none;
        }

        .posterHeroTitle913 {
          max-width: 12ch;
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
          <div class="posterHeroTopline913">Smart Cut Services</div>
          <div class="posterHeroScrollHint913">Glisser pour voir</div>

          <div class="posterHeroTrack913" data-hero-track>
            ${slides.map((slide, index) => {
              const url = buildPosterUrl(slide.fileName);
              const safeUrl = String(url).replace(/"/g, '&quot;');
              return `
                <article class="posterHeroSlide913" data-hero-slide="${index}" aria-hidden="${index === this.currentIndex ? 'false' : 'true'}">
                  <div class="posterHeroPoster913" role="img" aria-label="${this.escape(slide.altText)}" style="background-image:url('${safeUrl}')">
                    <div class="posterHeroCaption913">
                      <div class="posterHeroCaptionCopy913">
                        <span class="posterHeroEyebrow913">Affiche ${String(index + 1).padStart(2, '0')}</span>
                        <h2 class="posterHeroTitle913">Notre collection</h2>
                        <p class="posterHeroMeta913">Des affiches premium pilotées depuis votre dashboard, pensées pour mettre en avant vos temps forts et vos nouveautés.</p>
                      </div>
                      <div class="posterHeroCounter913">
                        <strong>${String(index + 1).padStart(2, '0')}</strong>
                        <span>sur ${String(total).padStart(2, '0')}</span>
                      </div>
                    </div>
                  </div>
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
