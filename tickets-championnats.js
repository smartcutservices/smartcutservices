const API_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/listJwetproTickets';
const list = document.getElementById('ticket-list');
const count = document.getElementById('ticket-count');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
}

function formatMoney(value, currency = 'HTG') {
  return new Intl.NumberFormat('fr-HT', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function render(tickets) {
  count.textContent = `${tickets.length} championnat${tickets.length > 1 ? 's' : ''}`;
  if (!tickets.length) {
    list.innerHTML = '<div class="ticket-state">Aucune inscription n’est ouverte pour le moment.</div>';
    return;
  }
  list.innerHTML = tickets.map((ticket) => {
    const available = Math.max(0, Number(ticket.capacity || 0) - Number(ticket.paidCount || 0) - Number(ticket.reservedCount || 0));
    const image = ticket.imageUrl ? `<img src="${escapeHtml(ticket.imageUrl)}" alt="">` : '';
    const startUrl = ticket.jwetproUrl || 'https://jwetpro.com/championship.html';
    return `<article class="ticket-card">
      <div class="ticket-visual">${image}</div>
      <div class="ticket-body">
        <h3>${escapeHtml(ticket.name || 'Championnat JwetPro')}</h3>
        <div class="ticket-meta"><span>${available} place${available > 1 ? 's' : ''}</span><span>1 ticket / joueur</span></div>
        <div class="ticket-price">${formatMoney(ticket.price, ticket.currency || 'HTG')}</div>
        <a class="ticket-action" href="${escapeHtml(startUrl)}">Commencer sur JwetPro</a>
      </div>
    </article>`;
  }).join('');
}

fetch(API_URL, { headers: { Accept: 'application/json' } })
  .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
  .then((payload) => render(Array.isArray(payload.tickets) ? payload.tickets : []))
  .catch(() => { list.innerHTML = '<div class="ticket-state">Le catalogue est temporairement indisponible. Veuillez réessayer.</div>'; });
