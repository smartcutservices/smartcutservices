const NAV_ITEMS = [
  ['./auto-parts.html', 'Catalogue'],
  ['./auto-parts-request.html', 'Demander une pièce'],
  ['./auto-parts-requests.html', 'Mes demandes'],
  ['./auto-parts-support.html', 'Garanties & retours'],
  ['./auto-parts-garages.html', 'Garages']
];

export default class AutoPartsHeader {
  constructor(rootId = 'auto-parts-header') {
    this.root = document.getElementById(rootId);
    if (!this.root) return;
    this.render();
  }

  render() {
    const current = window.location.pathname.split('/').pop() || 'auto-parts.html';
    this.root.innerHTML = `
      <header class="aph-header">
        <a class="aph-brand" href="./index.html" aria-label="Retour à Smart Cut Services">
          <img src="./logo.png" alt="Smart Cut Services">
          <span><strong>Smart Cut</strong><small>Auto &amp; Parts</small></span>
        </a>
        <button class="aph-menu" type="button" aria-label="Ouvrir le menu" aria-expanded="false">☰</button>
        <nav class="aph-nav" aria-label="Navigation Auto & Parts">
          ${NAV_ITEMS.map(([href, label]) => `<a href="${href}" ${current === href.slice(2) ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
        </nav>
        <a class="aph-sell" href="./auto-parts-vendor.html">Vendre des pièces</a>
      </header>`;
    const menu = this.root.querySelector('.aph-menu');
    const nav = this.root.querySelector('.aph-nav');
    menu?.addEventListener('click', () => {
      const open = nav.classList.toggle('is-open');
      menu.setAttribute('aria-expanded', String(open));
      menu.textContent = open ? '×' : '☰';
    });
  }
}
