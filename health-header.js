// Header autonome de Smart Cut Health.
// Il ne dépend pas du header marketplace utilisé sur la page d'accueil.

const NAV_ORDER_KEY = 'sch:navOrder:v1';

// Liens du sous-menu santé. L'ordre d'affichage s'adapte aux préférences de
// l'utilisateur : le dernier lien ouvert repasse en tête, l'ordre étant mémorisé
// dans localStorage et conservé d'une page à l'autre.
const NAV_LINKS = [
  { href: './health-teleconsultation.html', label: 'Téléconsultation', match: ['health-teleconsultation.html'] },
  { href: './health-pharmacie.html', label: 'Pharmacie', match: ['health-pharmacie.html'] },
  { href: './health-medecins.html', label: 'Médecins', match: ['health-medecins.html'] },
  { href: './health-laboratoires.html', label: 'Laboratoires', match: ['health-laboratoires.html'] },
  { href: './health-espace.html', label: 'Mon espace', match: ['health-espace.html'] },
  { href: './health-doctor.html', label: 'Espace médecin', icon: 'fa-user-doctor', match: ['health-doctor.html'] },
];

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
            ${this.renderNavLinks()}
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

    // Mémoire des préférences : le lien ouvert repasse en tête du sous-menu.
    menu.querySelectorAll('[data-health-nav-link]').forEach((link) => {
      link.addEventListener('click', () => this.rememberNavClick(link.dataset.healthNavLink));
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 1100) closeMenu();
    });
  }

  isCurrentPage(fileName) {
    return window.location.pathname.split('/').pop() === fileName;
  }

  // Rendu des liens du sous-menu dans l'ordre préféré de l'utilisateur.
  renderNavLinks() {
    return this.orderedNavLinks().map((link) => {
      const active = link.match.some((file) => this.isCurrentPage(file));
      const icon = link.icon ? `<i class="fas ${link.icon}" aria-hidden="true"></i> ` : '';
      return `<a class="health-site-header__link ${active ? 'is-active' : ''}" href="${link.href}" data-health-nav-link="${link.href}">${icon}${link.label}</a>`;
    }).join('');
  }

  // Liens préférés (déjà cliqués) en premier, dans l'ordre du plus récent au
  // plus ancien, puis les liens restants dans leur ordre d'origine.
  orderedNavLinks() {
    const saved = this.readNavOrder();
    const preferred = saved
      .map((href) => NAV_LINKS.find((link) => link.href === href))
      .filter(Boolean);
    const rest = NAV_LINKS.filter((link) => !saved.includes(link.href));
    return [...preferred, ...rest];
  }

  readNavOrder() {
    try {
      const raw = JSON.parse(window.localStorage.getItem(NAV_ORDER_KEY) || '[]');
      if (!Array.isArray(raw)) return [];
      const known = new Set(NAV_LINKS.map((link) => link.href));
      return raw.filter((href) => known.has(href));
    } catch (_) {
      return [];
    }
  }

  rememberNavClick(href) {
    if (!NAV_LINKS.some((link) => link.href === href)) return;
    try {
      const next = [href, ...this.readNavOrder().filter((item) => item !== href)].slice(0, NAV_LINKS.length);
      window.localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(next));
    } catch (_) {
      /* localStorage indisponible : la préférence n'est pas mémorisée, sans erreur. */
    }
  }
}
