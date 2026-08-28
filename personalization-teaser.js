// Vitrine legere du Studio de personnalisation sur la page d'accueil.
// Le moteur 3D et le modele GLB ne sont charges qu'a l'approche de la section.

class PersonalizationTeaser {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    this.injectStyles();
    this.render();
    this.mount3D();
  }

  injectStyles() {
    if (document.getElementById('pzTeaserStyles')) return;

    const style = document.createElement('style');
    style.id = 'pzTeaserStyles';
    style.textContent = `
      .pz-teaser,
      .pz-teaser * { box-sizing: border-box; }

      .pz-teaser {
        padding: clamp(2rem, 4vw, 3.5rem) 1rem;
        color: var(--sc-ink, #0f1111);
        background: var(--sc-canvas, #eaeded);
      }

      .pz-teaser-inner {
        width: min(100%, 1280px);
        min-height: 360px;
        margin: 0 auto;
        overflow: hidden;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(420px, .92fr);
        border: 1px solid var(--sc-line, #d5d9d9);
        border-radius: var(--sc-radius, 8px);
        background: var(--sc-surface, #fff);
        box-shadow: var(--sc-shadow, 0 2px 5px rgba(15, 17, 17, .15));
      }

      .pz-teaser-copy {
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: clamp(2rem, 4vw, 3.5rem);
      }

      .pz-teaser h2 {
        max-width: 560px;
        margin: 0;
        color: var(--sc-ink, #0f1111);
        font-family: 'Amazon Ember', Arial, Helvetica, sans-serif;
        font-size: clamp(2rem, 3.2vw, 2.75rem);
        font-weight: 700;
        letter-spacing: -.035em;
        line-height: 1.08;
        text-wrap: balance;
      }

      .pz-teaser-lead {
        max-width: 52ch;
        margin: 1rem 0 0;
        color: var(--sc-muted, #565959);
        font-size: .94rem;
        line-height: 1.6;
      }

      .pz-teaser-actions {
        margin-top: 1.35rem;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: .8rem 1.1rem;
      }

      .pz-teaser-primary {
        min-height: 44px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: .55rem;
        padding: .72rem 1rem;
        border: 1px solid var(--sc-gold-border, #fcd200);
        border-radius: var(--sc-radius, 8px);
        color: #0f1111;
        background: var(--sc-gold, #ffd814);
        font-size: .82rem;
        font-weight: 700;
        text-decoration: none;
        box-shadow: 0 1px 2px rgba(15, 17, 17, .08);
        transition: background .18s ease, transform .18s ease;
      }

      .pz-teaser-primary:hover {
        background: #f7ca00;
        transform: translateY(-1px);
      }

      .pz-teaser-visual {
        position: relative;
        min-height: 360px;
        overflow: hidden;
        background:
          radial-gradient(circle at 28% 30%, rgba(43, 77, 126, .32), transparent 38%),
          radial-gradient(circle at 78% 70%, rgba(194, 132, 48, .16), transparent 34%),
          var(--sc-navy, #131921);
        perspective: 900px;
        perspective-origin: 50% 48%;
      }

      .pz-teaser-visual::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
        background: linear-gradient(90deg, rgba(19, 25, 33, .14), transparent 32%, rgba(19, 25, 33, .04));
      }

      .pz-teaser-product {
        position: absolute;
        inset: 0;
        z-index: 0;
        width: 100%;
        height: 100%;
        max-width: none;
        object-fit: cover;
        object-position: center;
        transform: scale(1.015);
        transition: transform .7s cubic-bezier(.2, .75, .25, 1), opacity .3s ease;
      }

      .pz-teaser-visual:hover .pz-teaser-product { transform: scale(1.04); }

      .pz-teaser-visual.is-3d-ready .pz-teaser-product { opacity: 0; }

      .pz-teaser-stage {
        position: absolute;
        inset: 0;
        z-index: 1;
      }

      .pz-teaser-stage canvas {
        width: 100%;
        height: 100%;
        display: block;
        cursor: grab;
      }

      .pz-teaser-stage canvas:active { cursor: grabbing; }

      .pz-teaser-stage canvas:focus-visible {
        outline: 3px solid var(--sc-orange, #ffa41c);
        outline-offset: -4px;
      }

      @media (max-width: 820px) {
        .pz-teaser-inner { grid-template-columns: 1fr; }
        .pz-teaser-copy { padding: 2rem; }
        .pz-teaser h2 { font-size: clamp(1.85rem, 6vw, 2.4rem); }
        .pz-teaser-visual { min-height: 310px; }
      }

      @media (max-width: 520px) {
        .pz-teaser { padding-block: 2rem; }
        .pz-teaser-copy { padding: 1.45rem 1.15rem 1.5rem; }
        .pz-teaser h2 { font-size: 1.75rem; }
        .pz-teaser-lead { margin-top: .8rem; font-size: .87rem; }
        .pz-teaser-actions { margin-top: 1.1rem; }
        .pz-teaser-primary { width: 100%; }
        .pz-teaser-visual { min-height: 250px; }
        .pz-teaser-product { object-position: center; }
      }

      @media (prefers-reduced-motion: reduce) {
        .pz-teaser-product { transition: none; }
        .pz-teaser-primary { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  render() {
    this.container.innerHTML = `
      <section class="pz-teaser" aria-labelledby="pz-teaser-title">
        <div class="pz-teaser-inner">
          <div class="pz-teaser-copy">
            <h2 id="pz-teaser-title">Créez votre produit. Voyez-le en 3D.</h2>
            <p class="pz-teaser-lead">Ajoutez votre texte ou votre image, prévisualisez le résultat, puis commandez votre impression.</p>
            <div class="pz-teaser-actions">
              <a class="pz-teaser-primary" href="./personalization.html">
                Ouvrir le studio <i class="fas fa-arrow-right" aria-hidden="true"></i>
              </a>
            </div>
          </div>

          <div class="pz-teaser-visual">
            <img
              class="pz-teaser-product"
              src="./assets/personalization/studio-hero-v3.png"
              alt="T-shirt et tasse personnalisés en aperçu 3D"
              loading="lazy"
              decoding="async"
            >
            <div class="pz-teaser-stage" data-pz-teaser-stage></div>
          </div>
        </div>
      </section>
    `;
  }

  async mount3D() {
    try {
      const version = window.SMART_CUT_ASSET_VERSION || '1';
      const module = await import(`./personalization-teaser-3d.js?v=${version}`);
      if (!this.container?.isConnected) return;
      this.viewer = new module.default(this.container.querySelector('.pz-teaser-visual'));
      await this.viewer.init();
      window.addEventListener('pagehide', () => this.viewer?.dispose(), { once: true });
    } catch (error) {
      console.warn('[personalization-teaser] Le rendu 3D ne peut pas être chargé.', error);
    }
  }

}

export default PersonalizationTeaser;
