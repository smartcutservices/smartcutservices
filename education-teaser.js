// Teaser minimaliste de Smart Cut Education sur la page d'accueil.
// Squelette visuel uniquement: aucune admission, aucun paiement, aucun dashboard.

class EducationTeaser {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    this.toastTimer = null;
    this.injectStyles();
    this.render();
    this.bindEvents();
  }

  injectStyles() {
    if (document.getElementById('eduTeaserStyles')) return;

    const style = document.createElement('style');
    style.id = 'eduTeaserStyles';
    style.textContent = `
      .edu-teaser,
      .edu-teaser * { box-sizing: border-box; }

      .edu-teaser {
        padding: clamp(1.5rem, 3vw, 2.25rem) 1rem;
        background: var(--sc-canvas, #eaeded);
      }

      .edu-teaser-inner {
        width: min(100%, 1280px);
        margin: 0 auto;
        overflow: hidden;
        display: grid;
        grid-template-columns: minmax(0, 1.12fr) minmax(360px, .88fr);
        align-items: stretch;
        min-height: 250px;
        border: 1px solid #E5E7EB;
        border-radius: 10px;
        background: #ffffff;
        box-shadow: var(--sc-shadow, 0 2px 5px rgba(15, 17, 17, .15));
      }

      .edu-teaser-copy {
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: .7rem;
        padding: clamp(1.6rem, 4vw, 3rem);
      }

      .edu-teaser-eyebrow {
        display: inline-flex;
        align-items: center;
        gap: .4rem;
        width: fit-content;
        padding: .3rem .65rem;
        border-radius: 999px;
        background: #FDEDE9;
        color: #C93A24;
        font-family: 'Amazon Ember', Arial, Helvetica, sans-serif;
        font-size: .68rem;
        font-weight: 800;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      .edu-teaser h2 {
        max-width: 18ch;
        margin: 0;
        color: #16181D;
        font-family: 'Amazon Ember', Arial, Helvetica, sans-serif;
        font-size: clamp(1.55rem, 2.4vw, 2.1rem);
        font-weight: 800;
        letter-spacing: -.015em;
        line-height: 1.2;
      }

      .edu-teaser-lead {
        max-width: 34ch;
        margin: 0;
        color: #4B5160;
        font-size: .92rem;
        line-height: 1.45;
      }

      .edu-teaser-actions {
        margin-top: .35rem;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .6rem 1rem;
      }

      .edu-teaser-primary {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: .5rem;
        padding: .65rem 1.05rem;
        border: none;
        border-radius: 8px;
        color: #ffffff;
        background: #C93A24;
        font-size: .82rem;
        font-weight: 800;
        text-decoration: none;
        transition: background .18s ease, transform .18s ease;
      }

      .edu-teaser-primary:hover {
        background: #A82E1B;
        transform: translateY(-1px);
      }

      .edu-teaser-secondary {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        border: none;
        background: none;
        padding: 0;
        color: #4B5160;
        font: inherit;
        font-size: .78rem;
        font-weight: 700;
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }

      .edu-teaser-secondary:hover { color: #16181D; }

      .edu-teaser-visual {
        position: relative;
        display: grid;
        grid-template-columns: 1fr 1fr;
        min-height: 100%;
        padding: .75rem;
        gap: .75rem;
        background: #161b23;
      }

      .edu-teaser-visual-card {
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        min-width: 0;
        padding: .9rem;
        border-radius: 10px;
        color: rgba(255, 255, 255, .95);
        background-position: center;
        background-size: cover;
        text-decoration: none;
        isolation: isolate;
        transition: transform .2s ease;
      }

      .edu-teaser-visual-card::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: -1;
        background: linear-gradient(180deg, transparent 42%, rgba(8, 12, 18, .78));
      }

      .edu-teaser-visual-card:hover { transform: translateY(-2px); }

      .edu-teaser-visual-card span {
        font-size: .82rem;
        font-weight: 800;
        line-height: 1.3;
      }

      .edu-teaser-visual-card--a { background-image: url('./assets/education/teaser-formations-v1.webp'); }
      .edu-teaser-visual-card--b { background-image: url('./assets/education/teaser-tuteurs-v1.webp'); }

      .edu-teaser-toast {
        position: fixed;
        left: 50%;
        bottom: 1.25rem;
        z-index: 2000;
        transform: translate(-50%, 8px);
        padding: .65rem 1rem;
        border-radius: 999px;
        background: #131921;
        color: #fff;
        font-size: .8rem;
        font-weight: 700;
        box-shadow: 0 12px 26px rgba(0, 0, 0, .22);
        opacity: 0;
        pointer-events: none;
        transition: opacity .2s ease, transform .2s ease;
      }

      .edu-teaser-toast.is-visible {
        opacity: 1;
        transform: translate(-50%, 0);
      }

      @media (max-width: 639px) {
        .edu-teaser-inner {
          grid-template-columns: 1fr;
          min-height: 0;
        }
        .edu-teaser-copy { padding: 1.15rem 1.15rem 1.35rem; }
        .edu-teaser h2 { font-size: 1.15rem; max-width: none; }
        .edu-teaser-lead { font-size: .82rem; }
        .edu-teaser-primary { width: 100%; }
        .edu-teaser-visual { min-height: 210px; }
      }

      @media (prefers-reduced-motion: reduce) {
        .edu-teaser-primary,
        .edu-teaser-toast { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  render() {
    this.container.innerHTML = `
      <section class="edu-teaser" aria-labelledby="edu-teaser-title">
        <div class="edu-teaser-inner">
          <div class="edu-teaser-copy">
            <span class="edu-teaser-eyebrow"><i class="fas fa-graduation-cap" aria-hidden="true"></i> Smart Akademi · Cours en ligne</span>
            <h2 id="edu-teaser-title">Apprenez. Avancez.</h2>
            <p class="edu-teaser-lead">Formations, cours en ligne et tuteurs vérifiés, au même endroit.</p>
            <div class="edu-teaser-actions">
              <a class="edu-teaser-primary" href="./education.html">
                Explorer <i class="fas fa-arrow-right" aria-hidden="true"></i>
              </a>
            </div>
          </div>

          <div class="edu-teaser-visual">
            <a class="edu-teaser-visual-card edu-teaser-visual-card--a" href="./education-formations.html">
              <span>Formations</span>
            </a>
            <a class="edu-teaser-visual-card edu-teaser-visual-card--b" href="./education-tuteurs.html">
              <span>Tuteurs</span>
            </a>
          </div>
        </div>
      </section>
      <div class="edu-teaser-toast" role="status" aria-live="polite" data-edu-teaser-toast></div>
    `;
  }

  bindEvents() {
    // Les cartes et le bouton sont des liens natifs accessibles.
  }

  showToast(message) {
    const toast = this.container.querySelector('[data-edu-teaser-toast]');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 2400);
  }
}

export default EducationTeaser;
