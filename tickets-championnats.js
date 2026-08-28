const API_BASE_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/listJwetproTickets';
const IS_LOCAL_TEST = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_URL = `${API_BASE_URL}${IS_LOCAL_TEST ? '?includeTest=1' : ''}`;
const list = document.getElementById('ticket-list');
const count = document.getElementById('ticket-count');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatMoney(value, currency = 'HTG') {
  try {
    return new Intl.NumberFormat('fr-HT', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value) || 0);
  } catch {
    return `${Number(value) || 0} HTG`;
  }
}

function availablePlaces(ticket) {
  const capacity = Math.max(0, Number(ticket.capacity) || 0);
  if (!capacity) return null;
  return Math.max(0, capacity - Math.max(0, Number(ticket.paidCount) || 0) - Math.max(0, Number(ticket.reservedCount) || 0));
}

function isRegistrationOpen(ticket) {
  if (!ticket || ticket.visible === false || ticket.status !== 'registration-open') return false;
  const deadlineMs = Date.parse(String(ticket.registrationDeadline || ''));
  return !Number.isFinite(deadlineMs) || deadlineMs > Date.now();
}

function safeJwetproUrl(value) {
  try {
    const url = new URL(String(value || ''), 'https://jwetpro.com');
    return ['http:', 'https:'].includes(url.protocol) ? url.href : 'https://jwetpro.com/championship.html';
  } catch {
    return 'https://jwetpro.com/championship.html';
  }
}

function render(tickets) {
  count.textContent = tickets.length
    ? `${tickets.length} championnat${tickets.length > 1 ? 's' : ''}`
    : '';
  if (!tickets.length) {
    list.innerHTML = '<div class="ticket-state">Aucune inscription n’est ouverte pour le moment.</div>';
    return;
  }
  list.innerHTML = tickets.map((ticket) => {
    const available = availablePlaces(ticket);
    const availability = available === null
      ? 'Places disponibles'
      : `${available} place${available > 1 ? 's' : ''} disponible${available > 1 ? 's' : ''}`;
    const startUrl = safeJwetproUrl(ticket.jwetproUrl);
    return `<article class="ticket-card">
      <div class="ticket-body">
        <span class="ticket-status"><i aria-hidden="true"></i> Inscription ouverte</span>
        <h3>${escapeHtml(ticket.name || 'Championnat JwetPro')}</h3>
        <div class="ticket-meta">${escapeHtml(availability)}</div>
        <div class="ticket-price">${formatMoney(ticket.price, ticket.currency || 'HTG')}</div>
        <a class="ticket-action" href="${escapeHtml(startUrl)}">S’inscrire <span aria-hidden="true">→</span></a>
      </div>
    </article>`;
  }).join('');
}

fetch(API_URL, { headers: { Accept: 'application/json' } })
  .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
  .then((payload) => render((Array.isArray(payload.tickets) ? payload.tickets : []).filter(isRegistrationOpen)))
  .catch(() => {
    count.textContent = '';
    list.innerHTML = '<div class="ticket-state">Les inscriptions sont temporairement indisponibles.</div>';
  });
