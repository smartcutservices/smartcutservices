// Header autonome de Smart Cut Health.
// Il ne dépend pas du header marketplace utilisé sur la page d'accueil.

export default class SmartCutHealthHeader {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    this.render();
    this.bindEvents();
  }

  render() {
    this.container.innerHTML = `
      <style>
        :root { --health-header-height: 70px; }

        #health-header-root {
          position: sticky;
          top: 0;
          z-index: 1000;
          width: 100%;
          height: var(--health-header-height);
        }

        .health-site-header {
          height: 100%;
          border-bottom: 1px solid rgba(255, 255, 255, .11);
          background: #0b3d35;
          color: #fff;
          box-shadow: 0 4px 18px rgba(7, 43, 36, .14);
        }

        .health-site-header__inner {
          width: min(100% - 2rem, 1180px);
          height: 100%;
          margin-inline: auto;
          display: flex;
          align-items: center;
          gap: 1.25rem;
        }

        .health-site-header__brand {
          display: inline-flex;
          align-items: center;
          gap: .72rem;
          flex: 0 0 auto;
          color: #fff;
          text-decoration: none;
        }

        .health-site-header__logo {
          display: block;
          width: 42px;
          height: 42px;
          padding: 4px;
          border-radius: 8px;
          background: #fff;
          object-fit: contain;
          box-shadow: 0 2px 8px rgba(0, 0, 0, .18);
        }

        .health-site-header__identity { display: grid; gap: 1px; }
        .health-site-header__name { font-size: .98rem; font-weight: 800; line-height: 1.1; }
        .health-site-header__label { color: #a9d7cc; font-size: .7rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }

        .health-site-header__nav {
          display: flex;
          align-items: center;
          gap: .15rem;
          margin-left: auto;
        }

        .health-site-header__link {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: .42rem;
          min-height: 40px;
          padding: 0 .75rem;
          border-radius: 8px;
          color: #e4f1ed;
          font-size: .84rem;
          font-weight: 700;
          text-decoration: none;
          white-space: nowrap;
          transition: background .18s ease, color .18s ease;
        }

        .health-site-header__link:hover,
        .health-site-header__link:focus-visible,
        .health-site-header__link.is-active {
          color: #fff;
          background: rgba(255, 255, 255, .1);
          outline: none;
        }

        .health-site-header__link--back { margin-left: .35rem; color: #bdd9d2; }

        .health-site-header__menu {
          display: none;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          margin-left: auto;
          border: 1px solid rgba(255, 255, 255, .22);
          border-radius: 8px;
          background: transparent;
          color: #fff;
          cursor: pointer;
        }

        @media (max-width: 1100px) {
          :root { --health-header-height: 62px; }
          .health-site-header__inner { width: min(100% - 1.1rem, 1180px); gap: .7rem; }
          .health-site-header__logo { width: 36px; height: 36px; }
          .health-site-header__name { font-size: .9rem; }
          .health-site-header__label { font-size: .62rem; }
          .health-site-header__menu { display: inline-flex; }

          .health-site-header__nav {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            display: none;
            align-items: stretch;
            flex-direction: column;
            gap: .2rem;
            margin: 0;
            padding: .65rem;
            border-bottom: 1px solid #d9e6e2;
            background: #fff;
            box-shadow: 0 16px 30px rgba(7, 43, 36, .16);
          }

          .health-site-header.is-menu-open .health-site-header__nav { display: flex; }
          .health-site-header__link,
          .health-site-header__link--back {
            width: 100%;
            margin: 0;
            justify-content: flex-start;
            color: #24453e;
          }
          .health-site-header__link:hover,
          .health-site-header__link:focus-visible,
          .health-site-header__link.is-active { color: #0b3d35; background: #eef7f4; }
        }
      </style>

      <header class="health-site-header" data-health-header>
        <div class="health-site-header__inner">
          <a class="health-site-header__brand" href="./health.html" aria-label="Accueil Smart Cut Health">
            <img class="health-site-header__logo" src="./logo.png" alt="Logo Smart Cut" width="42" height="42">
            <span class="health-site-header__identity">
              <span class="health-site-header__name">Smart Cut Health</span>
              <span class="health-site-header__label">Santé &amp; pharmacie</span>
            </span>
          </a>

          <button class="health-site-header__menu" type="button" aria-label="Ouvrir le menu" aria-expanded="false" data-health-menu-button>
            <i class="fas fa-bars" aria-hidden="true"></i>
          </button>

          <nav class="health-site-header__nav" aria-label="Navigation Smart Cut Health" data-health-menu>
            <a class="health-site-header__link ${this.isCurrentPage('health-teleconsultation.html') ? 'is-active' : ''}" href="./health-teleconsultation.html">Téléconsultation</a>
            <a class="health-site-header__link ${this.isCurrentPage('health-pharmacie.html') ? 'is-active' : ''}" href="./health-pharmacie.html">Pharmacie</a>
            <a class="health-site-header__link ${this.isCurrentPage('health-ordonnance.html') ? 'is-active' : ''}" href="./health-ordonnance.html">Ordonnance</a>
            <a class="health-site-header__link ${this.isCurrentPage('health-medecins.html') ? 'is-active' : ''}" href="./health-medecins.html">Médecins</a>
            <a class="health-site-header__link ${this.isCurrentPage('health-laboratoires.html') ? 'is-active' : ''}" href="./health-laboratoires.html">Laboratoires</a>
            <a class="health-site-header__link ${this.isCurrentPage('health-espace.html') ? 'is-active' : ''}" href="./health-espace.html">Mon espace</a>
            <a class="health-site-header__link ${(this.isCurrentPage('health-professionnel.html') || this.isCurrentPage('health-candidature.html')) ? 'is-active' : ''}" href="./health-professionnel.html">Professionnels</a>
            <a class="health-site-header__link health-site-header__link--back" href="./index.html"><i class="fas fa-arrow-left" aria-hidden="true"></i> Smart Cut Services</a>
          </nav>
        </div>
      </header>
    `;
  }

  bindEvents() {
    const header = this.container.querySelector('[data-health-header]');
    const button = this.container.querySelector('[data-health-menu-button]');
    const menu = this.container.querySelector('[data-health-menu]');
    if (!header || !button || !menu) return;

    const closeMenu = () => {
      header.classList.remove('is-menu-open');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', 'Ouvrir le menu');
      const icon = button.querySelector('i');
      icon?.classList.add('fa-bars');
      icon?.classList.remove('fa-times');
    };

    button.addEventListener('click', () => {
      const willOpen = !header.classList.contains('is-menu-open');
      header.classList.toggle('is-menu-open', willOpen);
      button.setAttribute('aria-expanded', String(willOpen));
      button.setAttribute('aria-label', willOpen ? 'Fermer le menu' : 'Ouvrir le menu');
      const icon = button.querySelector('i');
      icon?.classList.toggle('fa-bars', !willOpen);
      icon?.classList.toggle('fa-times', willOpen);
    });

    menu.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

    window.addEventListener('resize', () => {
      if (window.innerWidth > 1100) closeMenu();
    });
  }

  isCurrentPage(fileName) {
    return window.location.pathname.split('/').pop() === fileName;
  }
}
