// ============= SECTION VITRINE SMARTSOLUTIONTEK (page d'accueil) =============

const APPS = [
  {
    tab: 'forms',
    title: 'Inscriptions en ligne',
    description: 'Collectez inscriptions et paiements sur une page à votre image.',
    image: './assets/smartsolutiontek/inscriptions-premium.jpg',
    alt: 'Formulaire d’inscription en ligne sur ordinateur et téléphone'
  },
  {
    tab: 'shops',
    title: 'Mini-boutique',
    description: 'Présentez vos produits, encaissez et suivez chaque commande.',
    image: './assets/smartsolutiontek/mini-boutique-premium.jpg',
    alt: 'Boutique en ligne avec produits et colis prêts à expédier'
  },
  {
    tab: 'courses',
    title: 'Formation en ligne',
    description: 'Vendez vos cours vidéo ou PDF depuis votre propre espace.',
    image: './assets/smartsolutiontek/formation-premium.jpg',
    alt: 'Espace de formation vidéo sur ordinateur et tablette'
  },
  {
    tab: 'services',
    title: 'Réservations de services',
    description: 'Affichez vos disponibilités et recevez des réservations payées.',
    image: './assets/smartsolutiontek/reservations-premium.jpg',
    alt: 'Calendrier de réservation et confirmation sur téléphone'
  },
  {
    tab: 'food',
    title: 'Cuisine & artisanat',
    description: 'Transformez votre menu ou savoir-faire en commandes en ligne.',
    image: './assets/smartsolutiontek/food-artisanat-premium.jpg',
    alt: 'Produits culinaires et artisanaux présentés sur une boutique mobile'
  }
];

class SmartSolutionTekShowcase {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    this.injectStyles();
    this.render();
  }

  injectStyles() {
    if (document.getElementById('sstShowcaseStyles')) return;
    const style = document.createElement('style');
    style.id = 'sstShowcaseStyles';
    style.textContent = `
      .sst-showcase {
        --sst-navy: #111a24;
        --sst-gold: #c89539;
        --sst-ivory: #f7f3eb;
        padding: clamp(1.5rem, 2.6vw, 2.25rem) clamp(1rem, 4vw, 3rem);
        background:
          radial-gradient(circle at 8% 0%, rgba(200,149,57,.11), transparent 24rem),
          linear-gradient(180deg, #fbf9f5 0%, #f4efe6 100%);
        color: var(--sst-navy);
      }
      .sst-showcase-inner {
        width: min(100%, 1280px);
        margin: 0 auto;
      }
      .sst-showcase-header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 2rem;
        margin-bottom: clamp(.75rem, 1.4vw, 1rem);
      }
      .sst-showcase-eyebrow {
        display: block;
        margin-bottom: 0;
        color: #8c651f;
        font-size: .72rem;
        font-weight: 800;
        letter-spacing: .16em;
        text-transform: uppercase;
      }
      .sst-showcase h2 {
        max-width: 720px;
        margin: 0;
        color: var(--sst-navy);
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2rem, 4.5vw, 3.75rem);
        font-weight: 500;
        line-height: 1.02;
        letter-spacing: -.035em;
      }
      .sst-showcase-lead {
        max-width: 360px;
        margin: 0 0 .25rem;
        color: #665f55;
        font-size: .9rem;
        line-height: 1.55;
      }
      .sst-showcase-grid {
        display: grid;
        grid-auto-flow: column;
        grid-auto-columns: clamp(290px, 31vw, 390px);
        gap: clamp(.85rem, 1.8vw, 1.35rem);
        overflow-x: auto;
        overflow-y: hidden;
        padding: .15rem .1rem .8rem;
        scroll-padding-inline: .1rem;
        scroll-snap-type: x proximity;
        scrollbar-width: thin;
        scrollbar-color: rgba(200,149,57,.72) rgba(17,26,36,.08);
        overscroll-behavior-inline: contain;
        -webkit-overflow-scrolling: touch;
      }
      .sst-showcase-grid::-webkit-scrollbar { height: 7px; }
      .sst-showcase-grid::-webkit-scrollbar-track {
        border-radius: 999px;
        background: rgba(17,26,36,.08);
      }
      .sst-showcase-grid::-webkit-scrollbar-thumb {
        border-radius: 999px;
        background: rgba(200,149,57,.72);
      }
      .sst-showcase-grid:focus-visible {
        outline: 3px solid rgba(200,149,57,.75);
        outline-offset: 4px;
      }
      .sst-showcase-card {
        min-height: 100%;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border: 1px solid rgba(17,26,36,.1);
        border-radius: 12px;
        background: rgba(255,255,255,.86);
        color: inherit;
        text-decoration: none;
        box-shadow: 0 16px 38px rgba(17,26,36,.055);
        scroll-snap-align: start;
        transition: transform .25s ease, box-shadow .25s ease, border-color .25s ease;
      }
      .sst-showcase-card:hover,
      .sst-showcase-card:focus-visible {
        transform: translateY(-4px);
        border-color: rgba(200,149,57,.52);
        box-shadow: 0 24px 48px rgba(17,26,36,.11);
      }
      .sst-showcase-media {
        position: relative;
        aspect-ratio: 16 / 9;
        overflow: hidden;
        background: #e9e2d6;
      }
      .sst-showcase-media::after {
        content: '';
        position: absolute;
        inset: 0;
        box-shadow: inset 0 -28px 40px rgba(17,26,36,.05);
        pointer-events: none;
      }
      .sst-showcase-media img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: cover;
        transition: transform .5s ease;
      }
      .sst-showcase-card:hover .sst-showcase-media img { transform: scale(1.025); }
      .sst-showcase-content {
        flex: 1;
        display: grid;
        grid-template-columns: 1fr auto;
        gap: .8rem 1rem;
        align-items: end;
        padding: 1rem 1.05rem 1.1rem;
      }
      .sst-showcase-copy { align-self: start; }
      .sst-showcase-index {
        display: block;
        margin-bottom: .35rem;
        color: #a1762c;
        font-size: .65rem;
        font-weight: 800;
        letter-spacing: .12em;
      }
      .sst-showcase-card h3 {
        margin: 0;
        color: var(--sst-navy);
        font-size: clamp(1rem, 1.7vw, 1.2rem);
        font-weight: 750;
        letter-spacing: -.015em;
      }
      .sst-showcase-card p {
        max-width: 42ch;
        margin: .35rem 0 0;
        color: #686158;
        font-size: .79rem;
        line-height: 1.45;
      }
      .sst-showcase-cta {
        width: 2.55rem;
        height: 2.55rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(200,149,57,.55);
        border-radius: 50%;
        background: var(--sst-navy);
        color: #f3d18d;
        font-size: .85rem;
        transition: background .2s ease, color .2s ease;
      }
      .sst-showcase-card:hover .sst-showcase-cta {
        background: var(--sst-gold);
        color: var(--sst-navy);
      }
      .sst-showcase-footer {
        margin-top: clamp(.85rem, 1.6vw, 1.15rem);
        display: flex;
        justify-content: center;
      }
      .sst-showcase-footer a {
        min-height: 46px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: .6rem;
        padding: .75rem 1.15rem;
        border-radius: 8px;
        background: var(--sst-navy);
        color: #fff;
        font-size: .84rem;
        font-weight: 750;
        text-decoration: none;
        box-shadow: 0 12px 26px rgba(17,26,36,.14);
      }
      .sst-showcase-footer a i { color: #e1b45e; }
      @media (max-width: 900px) {
        .sst-showcase-header { display: block; }
        .sst-showcase-lead { margin-top: .8rem; }
        .sst-showcase-grid { grid-auto-columns: clamp(280px, 72vw, 360px); }
      }
      @media (max-width: 600px) {
        .sst-showcase { padding-block: 1.4rem; }
        .sst-showcase-header { margin-bottom: .7rem; }
        .sst-showcase h2 { font-size: clamp(1.8rem, 8.8vw, 2.2rem); }
        .sst-showcase-lead { max-width: 32ch; font-size: .82rem; }
        .sst-showcase-grid { grid-auto-columns: min(84vw, 320px); gap: .8rem; }
        .sst-showcase-media { aspect-ratio: 16 / 9; }
        .sst-showcase-content { padding: .9rem; }
        .sst-showcase-card p { font-size: .76rem; }
        .sst-showcase-footer a { width: 100%; }
      }
      @media (prefers-reduced-motion: reduce) {
        .sst-showcase-card,
        .sst-showcase-media img,
        .sst-showcase-cta { transition: none; }
      }
    `;
    document.head.appendChild(style);
  }

  render() {
    this.container.innerHTML = `
      <section class="sst-showcase" aria-label="SmartSolutionTek">
        <div class="sst-showcase-inner">
          <header class="sst-showcase-header">
            <div>
              <span class="sst-showcase-eyebrow">Smart Cut × SmartSolutionTek</span>
            </div>
          </header>

          <div class="sst-showcase-grid" tabindex="0" role="region" aria-label="Applications SmartSolutionTek, faites défiler horizontalement">
            ${APPS.map((app, index) => `
              <a class="sst-showcase-card" href="./smartsolutiontek/dashboard.html?app=${app.tab}" aria-label="Créer : ${app.title}">
                <div class="sst-showcase-media">
                  <img src="${app.image}" alt="${app.alt}" loading="lazy" decoding="async">
                </div>
                <div class="sst-showcase-content">
                  <div class="sst-showcase-copy">
                    <span class="sst-showcase-index">0${index + 1}</span>
                    <h3>${app.title}</h3>
                    <p>${app.description}</p>
                  </div>
                  <span class="sst-showcase-cta" aria-hidden="true"><i class="fas fa-arrow-right"></i></span>
                </div>
              </a>
            `).join('')}
          </div>

          <div class="sst-showcase-footer">
            <a href="./smartsolutiontek/dashboard.html"><i class="fas fa-arrow-right" aria-hidden="true"></i> Ouvrir mon espace créateur</a>
          </div>
        </div>
      </section>
    `;
  }
}

export default SmartSolutionTekShowcase;
