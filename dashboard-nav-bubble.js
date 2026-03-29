(() => {
  if (window.top !== window.self) return;
  if (new URLSearchParams(window.location.search).get('embedded') === '1') return;
  if (window.__vitchDashboardNavBubbleBooted) return;
  window.__vitchDashboardNavBubbleBooted = true;

  const pages = [
    { href: './dashboard.html#header', label: 'Header' },
    { href: './dashboard.html#hero', label: 'Hero' },
    { href: './dashboard.html#categories', label: 'Categories' },
    { href: './dashboard.html#products', label: 'Produits' },
    { href: './dashboard.html#gallery', label: 'Galerie' },
    { href: './dashboard.html#news', label: 'Actualites' },
    { href: './dashboard.html#footer', label: 'Footer' },
    { href: './dashboard.html#pages', label: 'Pages' },
    { href: './dashboard.html#delivery', label: 'Livraison' },
    { href: './dashboard.html#payment', label: 'Paiement' },
    { href: './dashboard.html#orders', label: 'Commandes' },
    { href: './dashboard.html#printing', label: 'Impression' },
    { href: './dashboard.html#vendors', label: 'Vendeurs' },
    { href: './dashboard.html#security', label: 'Securite' },
    { href: './dashboard.html#music', label: 'Musique' },
    { href: './dashboard.html#theme', label: 'Theme' }
  ];

  // GitHub Pages or some hosts can expose URLs with/without .html and with trailing slash.
  const path = decodeURIComponent(window.location.pathname || '')
    .replace(/\/+$/, '')
    .split('/')
    .pop() || '';
  const normalizedPath = path.toLowerCase().replace(/\.html$/i, '');
  const activeSection = String(window.location.hash || '').replace(/^#/, '').trim() || 'header';
  const knownPages = new Set([
    'dashboard',
    'dheader',
    'dashboardfullhero',
    'dahboarfullcategorie',
    'dproducts',
    'dashfullgalerie',
    'dacctualitee',
    'dfooter',
    'dpages',
    'dlivraison',
    'dpayment',
    'dashboard-orders',
    'dashboard-printing',
    'dashboard-vendors',
    'dashboard-security',
    'musique',
    'theme'
  ]);
  const isDashboard = knownPages.has(normalizedPath)
    || /^d.+$/i.test(path)
    || /^dashboard.+$/i.test(path)
    || /^dahboar.+$/i.test(path)
    || normalizedPath === 'musique'
    || normalizedPath === 'theme';

  const sectionByPath = {
    dashboard: activeSection,
    dheader: 'header',
    dashboardfullhero: 'hero',
    dahboarfullcategorie: 'categories',
    dproducts: 'products',
    dashfullgalerie: 'gallery',
    dacctualitee: 'news',
    dfooter: 'footer',
    dpages: 'pages',
    dlivraison: 'delivery',
    dpayment: 'payment',
    'dashboard-orders': 'orders',
    'dashboard-printing': 'printing',
    'dashboard-vendors': 'vendors',
    'dashboard-security': 'security',
    musique: 'music',
    theme: 'theme'
  };
  const currentSectionId = sectionByPath[normalizedPath] || 'header';
  const globalDashboardHref = `./dashboard.html#${currentSectionId}`;

  if (!isDashboard) return;

  const style = document.createElement('style');
  style.textContent = `
    .vitch-dash-bubble {
      position: fixed;
      left: 16px;
      bottom: 18px;
      width: 56px;
      height: 56px;
      border-radius: 999px;
      border: 1px solid rgba(198, 167, 94, 0.45);
      background: linear-gradient(150deg, #1F1E1C 0%, #343128 100%);
      color: #F5F1E8;
      box-shadow: 0 10px 24px rgba(0, 0, 0, 0.3), 0 0 0 3px rgba(198, 167, 94, 0.15);
      z-index: 99999;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 1.05rem;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }

    .vitch-dash-bubble.dragging { cursor: grabbing; }

    .vitch-dash-panel {
      position: fixed;
      left: 16px;
      bottom: 82px;
      width: min(90vw, 280px);
      max-height: min(65vh, 460px);
      overflow: auto;
      border-radius: 14px;
      border: 1px solid rgba(198, 167, 94, 0.4);
      background: #1F1E1C;
      color: #F5F1E8;
      padding: 0.72rem;
      z-index: 99998;
      box-shadow: 0 12px 35px rgba(0, 0, 0, 0.36);
      display: none;
    }

    .vitch-dash-panel.open { display: block; }
    .vitch-dash-panel h4 {
      margin: 0 0 0.55rem 0;
      font-size: 0.86rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #C6A75E;
    }

    .vitch-dash-link {
      display: block;
      text-decoration: none;
      color: #F5F1E8;
      border: 1px solid rgba(198, 167, 94, 0.3);
      border-radius: 10px;
      padding: 0.52rem 0.62rem;
      font-size: 0.84rem;
      margin-bottom: 0.42rem;
      background: rgba(255, 255, 255, 0.02);
    }

    .vitch-dash-link:hover {
      background: rgba(198, 167, 94, 0.18);
    }

    .vitch-dash-link.global {
      background: rgba(198, 167, 94, 0.2);
      border-color: rgba(198, 167, 94, 0.7);
      font-weight: 700;
    }
  `;
  document.head.appendChild(style);

  const bubble = document.createElement('button');
  bubble.type = 'button';
  bubble.className = 'vitch-dash-bubble';
  bubble.setAttribute('aria-label', 'Navigation dashboards');
  bubble.innerHTML = '<i class="fas fa-compass"></i>';

  const panel = document.createElement('div');
  panel.className = 'vitch-dash-panel';
  panel.innerHTML = `<h4>Dashboards</h4>${normalizedPath !== 'dashboard' ? `
    <a class="vitch-dash-link global" href="${globalDashboardHref}">
      <i class="fas fa-table-cells-large" style="margin-right:0.45rem;"></i>
      Voir le dashboard global
    </a>
  ` : ''}${pages.map((page) => {
    const isActive = normalizedPath === 'dashboard' && page.href.endsWith(`#${activeSection}`);
    return `<a class="vitch-dash-link" href="${page.href}"${isActive ? ' style="border-color:#C6A75E;background:rgba(198,167,94,0.22);"' : ''}>${page.label}</a>`;
  }).join('')}`;

  document.body.appendChild(panel);
  document.body.appendChild(bubble);

  const posX = Number(localStorage.getItem('vitch_dash_nav_x'));
  const posY = Number(localStorage.getItem('vitch_dash_nav_y'));
  if (Number.isFinite(posX) && Number.isFinite(posY)) {
    bubble.style.left = `${posX}px`;
    bubble.style.top = `${posY}px`;
    bubble.style.bottom = 'auto';
    panel.style.left = `${Math.max(8, Math.min(posX, window.innerWidth - 296))}px`;
    panel.style.top = `${Math.max(8, posY - 16 - panel.offsetHeight)}px`;
    panel.style.bottom = 'auto';
  }

  let dragging = false;
  let moved = false;
  let offsetX = 0;
  let offsetY = 0;

  const syncPanelPosition = () => {
    const rect = bubble.getBoundingClientRect();
    const maxPanelLeft = Math.max(8, window.innerWidth - Math.min(window.innerWidth * 0.9, 280) - 8);
    const left = Math.max(8, Math.min(rect.left, maxPanelLeft));
    panel.style.left = `${left}px`;
    panel.style.top = 'auto';
    panel.style.bottom = `${window.innerHeight - rect.top + 10}px`;
  };

  const onPointerMove = (event) => {
    if (!dragging) return;
    moved = true;
    const x = event.clientX - offsetX;
    const y = event.clientY - offsetY;

    const maxX = window.innerWidth - bubble.offsetWidth - 8;
    const maxY = window.innerHeight - bubble.offsetHeight - 8;
    const nextX = Math.min(Math.max(8, x), Math.max(8, maxX));
    const nextY = Math.min(Math.max(8, y), Math.max(8, maxY));

    bubble.style.left = `${nextX}px`;
    bubble.style.top = `${nextY}px`;
    bubble.style.bottom = 'auto';
    syncPanelPosition();

    localStorage.setItem('vitch_dash_nav_x', String(Math.round(nextX)));
    localStorage.setItem('vitch_dash_nav_y', String(Math.round(nextY)));
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    bubble.classList.remove('dragging');
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    if (moved) {
      setTimeout(() => { bubble.dataset.dragMoved = '1'; }, 0);
    }
  };

  bubble.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const rect = bubble.getBoundingClientRect();
    offsetX = event.clientX - rect.left;
    offsetY = event.clientY - rect.top;
    moved = false;
    dragging = true;
    bubble.classList.add('dragging');
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  });

  bubble.addEventListener('click', (event) => {
    if (bubble.dataset.dragMoved === '1') {
      bubble.dataset.dragMoved = '0';
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    panel.classList.toggle('open');
    syncPanelPosition();
  });

  window.addEventListener('resize', () => {
    syncPanelPosition();
  });

  document.addEventListener('click', (event) => {
    if (!panel.classList.contains('open')) return;
    if (event.target === bubble || bubble.contains(event.target)) return;
    if (panel.contains(event.target)) return;
    panel.classList.remove('open');
  });
})();
