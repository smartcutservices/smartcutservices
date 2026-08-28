const API_BASE_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/listJwetproTickets';
const IS_LOCAL_TEST = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_URL = `${API_BASE_URL}${IS_LOCAL_TEST ? '?includeTest=1' : ''}`;

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

function isRegistrationOpen(ticket) {
  if (!ticket || ticket.visible === false || ticket.status !== 'registration-open') return false;
  const deadlineMs = Date.parse(String(ticket.registrationDeadline || ''));
  return !Number.isFinite(deadlineMs) || deadlineMs > Date.now();
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
  const deadline = formatDeadline(ticket.registrationDeadline);
  const availability = available === null
    ? 'Inscriptions ouvertes'
    : `${available} place${available > 1 ? 's' : ''} disponible${available > 1 ? 's' : ''}`;

  return `<article class="home-ticket-card">
    <div class="home-ticket-content">
      <span class="home-ticket-live"><i aria-hidden="true"></i> Inscription ouverte</span>
      <p class="home-ticket-source">JwetPro · Ticket virtuel</p>
      <h3>${escapeHtml(ticket.name || 'Championnat JwetPro')}</h3>
      <div class="home-ticket-facts">
        <span><i class="far fa-user" aria-hidden="true"></i>${escapeHtml(availability)}</span>
        ${deadline ? `<span><i class="far fa-calendar" aria-hidden="true"></i>Jusqu’au ${escapeHtml(deadline)}</span>` : ''}
      </div>
      <div class="home-ticket-footer">
        <strong>${escapeHtml(formatMoney(ticket.price, ticket.currency))}</strong>
        <a href="${escapeHtml(registrationUrl(ticket))}">S’inscrire <span aria-hidden="true">→</span></a>
      </div>
    </div>
    <div class="home-ticket-emblem" aria-hidden="true">
      <div class="home-ticket-trophy"><i class="fas fa-trophy"></i><span>★</span></div>
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
        .filter(isRegistrationOpen)
        .slice(0, 6);
      if (!tickets.length) {
        this.root.hidden = true;
        this.root.innerHTML = '';
        return;
      }
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
        <a class="home-tickets-all" href="./tickets-championnats.html" aria-label="Voir tous les tickets">
          <span aria-hidden="true">→</span>
        </a>
      </div>
      <div class="home-tickets-rail">${tickets.map(ticketCard).join('')}</div>
    </section>`;
    this.root.hidden = false;
  }
}
