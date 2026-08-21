const API_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/listJwetproTickets';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
}

function safeImageUrl(value) {
  try {
    const url = new URL(String(value || ''), window.location.href);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function formatMoney(value, currency = 'HTG') {
  try {
    return new Intl.NumberFormat('fr-HT', {
      style: 'currency',
      currency: String(currency || 'HTG').toUpperCase(),
      maximumFractionDigits: 0
    }).format(Number(value) || 0);
  } catch {
    return `${Number(value) || 0} HTG`;
  }
}

function formatDeadline(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('fr-HT', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function registrationUrl(ticket) {
  const championshipId = encodeURIComponent(ticket.championshipId || ticket.id || '');
  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return `http://127.0.0.1:5511/registration-checkout.html?id=${championshipId}`;
  }
  return safeImageUrl(ticket.jwetproUrl) || `https://jwetpro.com/registration-checkout.html?id=${championshipId}`;
}

function ticketCard(ticket) {
  const capacity = Math.max(0, Number(ticket.capacity) || 0);
  const occupied = Math.max(0, Number(ticket.paidCount) || 0) + Math.max(0, Number(ticket.reservedCount) || 0);
  const available = capacity ? Math.max(0, capacity - occupied) : null;
  const imageUrl = safeImageUrl(ticket.imageUrl);
  const deadline = formatDeadline(ticket.registrationDeadline);
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="" loading="lazy" decoding="async">`
    : '<div class="home-ticket-placeholder" aria-hidden="true"><span>JP</span></div>';
  const availability = available === null
    ? 'Inscriptions ouvertes'
    : `${available} place${available > 1 ? 's' : ''} disponible${available > 1 ? 's' : ''}`;

  return `<article class="home-ticket-card">
    <div class="home-ticket-media">
      ${image}
      <span class="home-ticket-live"><i aria-hidden="true"></i> Inscription ouverte</span>
    </div>
    <div class="home-ticket-content">
      <p class="home-ticket-source">JwetPro · Ticket virtuel</p>
      <h3>${escapeHtml(ticket.name || 'Championnat JwetPro')}</h3>
      <div class="home-ticket-facts">
        <span>${escapeHtml(availability)}</span>
        ${deadline ? `<span>Jusqu’au ${escapeHtml(deadline)}</span>` : ''}
      </div>
      <div class="home-ticket-footer">
        <strong>${escapeHtml(formatMoney(ticket.price, ticket.currency))}</strong>
        <a href="${escapeHtml(registrationUrl(ticket))}">S’inscrire <span aria-hidden="true">→</span></a>
      </div>
    </div>
  </article>`;
}

export default class HomepageTickets {
  constructor(rootId) {
    this.root = document.getElementById(rootId);
    if (!this.root) return;
    this.load();
  }

  async load() {
    try {
      const response = await fetch(API_URL, {
        headers: { Accept: 'application/json' },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const tickets = (Array.isArray(payload.tickets) ? payload.tickets : [])
        .filter((ticket) => ticket.visible !== false && ticket.status === 'registration-open')
        .slice(0, 6);
      if (!tickets.length) return;
      this.render(tickets);
    } catch (error) {
      console.warn('[HOME_TICKETS] Catalogue indisponible:', error?.message || error);
    }
  }

  render(tickets) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = `./homepage-tickets.css?v=${window.SMART_CUT_ASSET_VERSION || '1'}`;
    document.head.appendChild(stylesheet);

    this.root.innerHTML = `<section class="home-tickets" aria-labelledby="home-tickets-title">
      <div class="home-tickets-heading">
        <div>
          <p>Compétitions en ligne</p>
          <h2 id="home-tickets-title">Tickets de championnat</h2>
        </div>
        <a href="./tickets-championnats.html">Voir tous les tickets <span aria-hidden="true">→</span></a>
      </div>
      <div class="home-tickets-rail">${tickets.map(ticketCard).join('')}</div>
    </section>`;
    this.root.hidden = false;
  }
}
