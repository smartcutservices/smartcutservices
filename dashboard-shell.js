const DASHBOARD_SECTIONS = [
  {
    id: 'header',
    label: 'Header',
    description: 'Navigation, logo et identite visuelle du haut du site.',
    href: './Dheader.html',
    icon: 'fa-window-maximize'
  },
  {
    id: 'hero',
    label: 'Hero',
    description: 'Grand bloc d ouverture et mise en avant principale.',
    href: './dashboardFullHero.html',
    icon: 'fa-panorama'
  },
  {
    id: 'categories',
    label: 'Categories',
    description: 'Structure des familles, colonnes et lignes de navigation.',
    href: './dahboarFullCategorie.html',
    icon: 'fa-sitemap'
  },
  {
    id: 'products',
    label: 'Produits',
    description: 'Catalogue, variations, prix et medias produits.',
    href: './Dproducts.html',
    icon: 'fa-bag-shopping'
  },
  {
    id: 'gallery',
    label: 'Galerie',
    description: 'Blocs galerie et visuels immersifs du site.',
    href: './DASHfullGalerie.html',
    icon: 'fa-images'
  },
  {
    id: 'news',
    label: 'Actualites',
    description: 'Contenus, presentations et publication des actualites.',
    href: './Dacctualitee.html',
    icon: 'fa-newspaper'
  },
  {
    id: 'footer',
    label: 'Footer',
    description: 'Coordonnees, liens, reseaux et moyens de paiement.',
    href: './Dfooter.html',
    icon: 'fa-bars-staggered'
  },
  {
    id: 'pages',
    label: 'Pages',
    description: 'Gestion des pages internes et liens associes.',
    href: './Dpages.html',
    icon: 'fa-file-lines'
  },
  {
    id: 'delivery',
    label: 'Livraison',
    description: 'Zones, tarifs et informations de livraison.',
    href: './Dlivraison.html',
    icon: 'fa-truck-fast'
  },
  {
    id: 'payment',
    label: 'Paiement',
    description: 'Commandes, suivi des paiements et notifications.',
    href: './Dpayment.html',
    icon: 'fa-credit-card'
  },
  {
    id: 'orders',
    label: 'Commandes',
    description: 'Pilotage des commandes et futur suivi de progression client.',
    href: './dashboard-orders.html',
    icon: 'fa-box-open'
  },
  {
    id: 'printing',
    label: 'Impression',
    description: 'Print on Demand, PDF, photo, CAD et grand format.',
    href: './dashboard-printing.html',
    icon: 'fa-print'
  },
  {
    id: 'vendors',
    label: 'Vendeurs',
    description: 'Marketplace, validation des vendeurs et commissions.',
    href: './dashboard-vendors.html',
    icon: 'fa-store'
  },
  {
    id: 'security',
    label: 'Securite',
    description: 'Protection admin du dashboard et changement du mot de passe.',
    href: './dashboard-security.html',
    icon: 'fa-shield-halved'
  },
  {
    id: 'music',
    label: 'Musique',
    description: 'Gestion de la musique et de l ambiance sonore.',
    href: './musique.html',
    icon: 'fa-music'
  },
  {
    id: 'theme',
    label: 'Theme',
    description: 'Palette, polices et pilotage visuel global.',
    href: './theme.html',
    icon: 'fa-palette'
  }
];

const DESKTOP_QUERY = '(min-width: 1100px)';

function withEmbedFlag(href) {
  const url = new URL(href, window.location.href);
  url.searchParams.set('embedded', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

function getSectionById(sectionId) {
  return DASHBOARD_SECTIONS.find((section) => section.id === sectionId) || DASHBOARD_SECTIONS[0];
}

function getInitialSection() {
  const hash = String(window.location.hash || '').replace(/^#/, '').trim();
  return getSectionById(hash);
}

function setActiveLink(navRoot, sectionId) {
  navRoot.querySelectorAll('[data-section-id]').forEach((button) => {
    button.classList.toggle('active', button.dataset.sectionId === sectionId);
  });
}

function renderNav(navRoot, onSelect) {
  navRoot.innerHTML = DASHBOARD_SECTIONS.map((section) => `
    <button class="sidebar-link" type="button" data-section-id="${section.id}">
      <i class="fas ${section.icon}"></i>
      <span>
        <strong>${section.label}</strong>
        <span>${section.description}</span>
      </span>
    </button>
  `).join('');

  navRoot.querySelectorAll('[data-section-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const section = getSectionById(button.dataset.sectionId);
      onSelect(section);
    });
  });
}

function bootDashboardShell() {
  const navRoot = document.getElementById('dashboard-nav');
  const frame = document.getElementById('dashboard-frame');
  const loader = document.getElementById('workspace-loader');
  const title = document.getElementById('workspace-title');
  const description = document.getElementById('workspace-description');
  const openLink = document.getElementById('workspace-open-link');
  const kicker = document.getElementById('workspace-kicker');
  const mediaQuery = window.matchMedia(DESKTOP_QUERY);

  if (!navRoot || !frame || !loader || !title || !description || !openLink || !kicker) {
    return;
  }

  let currentSection = getInitialSection();

  const updateWorkspace = (section, { updateHash = true } = {}) => {
    currentSection = section;
    title.textContent = section.label;
    description.textContent = section.description;
    kicker.textContent = `Module: ${section.label}`;
    openLink.href = section.href;
    setActiveLink(navRoot, section.id);

    if (updateHash) {
      window.history.replaceState({}, '', `#${section.id}`);
    }

    if (!mediaQuery.matches) {
      return;
    }

    loader.classList.add('visible');
    frame.src = withEmbedFlag(section.href);
    document.title = `Smart Cut Services · Dashboard ${section.label}`;
  };

  renderNav(navRoot, (section) => updateWorkspace(section));

  frame.addEventListener('load', () => {
    loader.classList.remove('visible');
  });

  window.addEventListener('hashchange', () => {
    const nextSection = getInitialSection();
    if (nextSection.id !== currentSection.id) {
      updateWorkspace(nextSection, { updateHash: false });
    }
  });

  mediaQuery.addEventListener('change', (event) => {
    if (event.matches) {
      updateWorkspace(currentSection, { updateHash: false });
      return;
    }
    frame.removeAttribute('src');
    loader.classList.remove('visible');
  });

  updateWorkspace(currentSection, { updateHash: false });
}

bootDashboardShell();
