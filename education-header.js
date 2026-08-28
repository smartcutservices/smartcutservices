// Header autonome de Smart Academi.
// Ce composant ne dépend pas du header marketplace de la page d'accueil.

export default class SmartCutEducationHeader {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;
    this.render();
    this.bindEvents();
  }

  render() {
    const demoValue = new URLSearchParams(window.location.search).get('demo');
    const demoSuffix = demoValue === '1' || demoValue === 'true' ? '?demo=1' : '';
    this.container.innerHTML = `
      <style>
        :root {
          --edu-header-height: 72px;
          --edu-header-height-mobile: 64px;
        }

        #education-header-root {
          position: fixed;
          inset: 0 0 auto;
          z-index: 1000;
          width: 100%;
          height: var(--edu-header-height);
        }

        .education-header {
          height: 100%;
          border-bottom: 1px solid rgba(255, 255, 255, .1);
          background: #131921;
          color: #fff;
          box-shadow: 0 4px 16px rgba(12, 18, 28, .12);
        }

        .education-header__inner {
          width: min(100% - 2rem, 1280px);
          height: 100%;
          margin-inline: auto;
          display: flex;
          align-items: center;
          gap: 1.5rem;
        }

        .education-header__brand {
          display: inline-flex;
          align-items: center;
          gap: .7rem;
          flex: 0 0 auto;
          color: #fff;
          text-decoration: none;
        }

        .education-header__mark {
          display: block;
          width: 42px;
          height: 42px;
          padding: 4px;
          object-fit: contain;
          flex: 0 0 auto;
          border-radius: 8px;
          background: #fff;
          box-shadow: 0 1px 4px rgba(0, 0, 0, .16);
        }

        .education-header__brand-copy {
          display: block;
          line-height: 1.05;
        }

        .education-header__brand-name {
          font-size: 1rem;
          font-weight: 800;
          letter-spacing: -.01em;
        }

        .education-header__nav {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: .2rem;
          margin-left: auto;
        }

        .education-header__link {
          display: inline-flex;
          align-items: center;
          min-height: 42px;
          padding: 0 .8rem;
          border-radius: 7px;
          color: #e7eaf0;
          font-size: .86rem;
          font-weight: 700;
          text-decoration: none;
          white-space: nowrap;
          transition: color .18s ease, background .18s ease;
        }

        .education-header__link:hover,
        .education-header__link:focus-visible,
        .education-header__link.is-active {
          color: #fff;
          background: rgba(255, 255, 255, .09);
          outline: none;
        }

        .education-header__site-link {
          gap: .45rem;
          margin-left: .55rem;
          color: #cbd2dc;
        }

        .education-header__cta {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: .5rem;
          min-height: 42px;
          padding: 0 1rem;
          border-radius: 7px;
          background: #c93a24;
          color: #fff;
          font-size: .86rem;
          font-weight: 800;
          text-decoration: none;
          white-space: nowrap;
          transition: background .18s ease, transform .18s ease;
        }

        .education-header__cta:hover,
        .education-header__cta:focus-visible {
          background: #a82e1b;
          transform: translateY(-1px);
          outline: none;
        }

        .education-header__menu-button {
          display: none;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          margin-left: auto;
          border: 1px solid rgba(255, 255, 255, .2);
          border-radius: 8px;
          background: transparent;
          color: #fff;
          font-size: 1rem;
          cursor: pointer;
        }

        @media (max-width: 1050px) {
          :root { --edu-header-height: var(--edu-header-height-mobile); }

          .education-header__inner {
            width: min(100% - 1.25rem, 1280px);
            gap: .75rem;
          }

          .education-header__brand-name { font-size: .91rem; }
          .education-header__mark { width: 36px; height: 36px; }
          .education-header__menu-button { display: inline-flex; }

          .education-header__nav {
            position: absolute;
            top: calc(100% + 1px);
            left: 0;
            right: 0;
            display: none;
            align-items: stretch;
            flex-direction: column;
            gap: .2rem;
            margin: 0;
            padding: .75rem;
            border-bottom: 1px solid #e5e7eb;
            background: #fff;
            box-shadow: 0 14px 28px rgba(15, 23, 42, .14);
          }

          .education-header.is-menu-open .education-header__nav { display: flex; }

          .education-header__link,
          .education-header__site-link {
            width: 100%;
            margin: 0;
            color: #303642;
          }

          .education-header__link:hover,
          .education-header__link:focus-visible {
            color: #16181d;
            background: #f4f5f7;
          }

          .education-header__cta { width: 100%; }
        }

      </style>

      <header class="education-header" data-education-header>
        <div class="education-header__inner">
          <a class="education-header__brand" href="./education.html${demoSuffix}" aria-label="Accueil Smart Academi">
            <img class="education-header__mark" src="./assets/education/smartcut-logo-mark.png" alt="" width="260" height="350" aria-hidden="true">
            <span class="education-header__brand-copy">
              <span class="education-header__brand-name">Smart Academi</span>
            </span>
          </a>

          <button class="education-header__menu-button" type="button" aria-label="Ouvrir le menu" aria-expanded="false" data-education-menu-button>
            <i class="fas fa-bars" aria-hidden="true"></i>
          </button>

          <nav class="education-header__nav" aria-label="Navigation principale Education" data-education-menu>
            <a class="education-header__link ${this.isCurrentPage('education-formations.html') ? 'is-active' : ''}" href="./education-formations.html${demoSuffix}">Formations</a>
            <a class="education-header__link ${this.isCurrentPage('education-etablissements.html') ? 'is-active' : ''}" href="./education-etablissements.html${demoSuffix}">Établissements</a>
            <a class="education-header__link ${this.isCurrentPage('education-tuteurs.html') ? 'is-active' : ''}" href="./education-tuteurs.html${demoSuffix}">Tuteurs</a>
            <a class="education-header__link ${this.isCurrentPage('education-tuteur-pro.html') ? 'is-active' : ''}" href="./education-tuteur-pro.html"><i class="fas fa-chalkboard-user" aria-hidden="true"></i> Devenir tuteur</a>
            <a class="education-header__link education-header__site-link" href="./index.html">
              <i class="fas fa-arrow-left" aria-hidden="true"></i> Smart Cut Services
            </a>
            <a class="education-header__cta" href="./education-pro.html${demoSuffix}"><i class="fas fa-briefcase" aria-hidden="true"></i> Espace pro</a>
          </nav>
        </div>
      </header>
    `;
  }

  isCurrentPage(fileName) {
    return window.location.pathname.split('/').pop() === fileName;
  }

  bindEvents() {
    const header = this.container.querySelector('[data-education-header]');
    const button = this.container.querySelector('[data-education-menu-button]');
    const menu = this.container.querySelector('[data-education-menu]');
    if (!header || !button || !menu) return;

    const closeMenu = () => {
      header.classList.remove('is-menu-open');
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', 'Ouvrir le menu');
      button.querySelector('i')?.classList.replace('fa-times', 'fa-bars');
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
      if (window.innerWidth > 1050) closeMenu();
    });
  }
}
