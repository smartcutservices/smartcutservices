import { db } from './firebase-init.js';
import { sendBroadcastNotification } from './notification.js';
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const CLIENTS_COLLECTION = 'clients';
const FULFILLMENT_STEPS = [
  { key: 'ordered', label: 'Commandé' },
  { key: 'shipped', label: 'Expédié' },
  { key: 'in_delivery', label: 'En cours de livraison' },
  { key: 'delivered', label: 'Livré' }
];

const state = {
  clients: [],
  orders: [],
  activeOrderId: null,
  unsubscribers: [],
  reloadTimeout: null
};

const elements = {
  statTotalOrders: document.getElementById('statTotalOrders'),
  statPendingOrders: document.getElementById('statPendingOrders'),
  statInDelivery: document.getElementById('statInDelivery'),
  statDelivered: document.getElementById('statDelivered'),
  searchInput: document.getElementById('searchInput'),
  paymentStatusFilter: document.getElementById('paymentStatusFilter'),
  fulfillmentStatusFilter: document.getElementById('fulfillmentStatusFilter'),
  clientFilter: document.getElementById('clientFilter'),
  refreshOrdersBtn: document.getElementById('refreshOrdersBtn'),
  ordersTableBody: document.getElementById('ordersTableBody'),
  ordersEmptyState: document.getElementById('ordersEmptyState'),
  ordersLoadingState: document.getElementById('ordersLoadingState'),
  orderDetailRoot: document.getElementById('orderDetailRoot')
};

function showToast(message, type = 'success') {
  const palette = {
    success: '#0f9f6e',
    error: '#dc2626',
    info: '#2563eb'
  };

  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.cssText = [
    'position:fixed',
    'right:20px',
    'bottom:20px',
    'z-index:10000',
    `background:${palette[type] || palette.success}`,
    'color:#fff',
    'padding:0.9rem 1rem',
    'border-radius:14px',
    'box-shadow:0 18px 40px rgba(0,0,0,0.18)',
    'font:600 0.9rem Manrope, sans-serif',
    'transform:translateY(14px)',
    'opacity:0',
    'transition:all .2s ease'
  ].join(';');

  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(14px)';
    setTimeout(() => toast.remove(), 220);
  }, 2200);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatPrice(price) {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'HTG',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(price) || 0);
}

function getPaymentStatusText(status) {
  const texts = {
    pending: 'En attente',
    review: 'En examen',
    approved: 'Approuve',
    rejected: 'Rejete',
    expired: 'Expire'
  };
  return texts[status] || 'En attente';
}

function getPaymentStatusColor(status) {
  const colors = {
    pending: '#d97706',
    review: '#2563eb',
    approved: '#0f9f6e',
    rejected: '#dc2626',
    expired: '#64748b'
  };
  return colors[status] || colors.pending;
}

function getFulfillmentStatus(order) {
  return order?.fulfillmentStatus || 'ordered';
}

function getFulfillmentStatusText(status) {
  const step = FULFILLMENT_STEPS.find((item) => item.key === status);
  return step?.label || 'Commande';
}

function getFulfillmentStatusColor(status) {
  const colors = {
    ordered: '#c6a75e',
    shipped: '#2563eb',
    in_delivery: '#d97706',
    delivered: '#0f9f6e'
  };
  return colors[status] || colors.ordered;
}

function renderBadge(label, color) {
  return `<span class="badge" style="background:${color}18;color:${color};border:1px solid ${color}22;">${escapeHtml(label)}</span>`;
}

function getOrderAmount(order) {
  if (typeof order?.amount === 'number' && Number.isFinite(order.amount)) {
    return order.amount;
  }

  return (Array.isArray(order?.items) ? order.items : []).reduce((sum, item) => {
    const price = Number(item?.price) || 0;
    const qty = Number(item?.quantity) || 1;
    return sum + (price * qty);
  }, 0);
}

function getClientById(clientId) {
  return state.clients.find((client) => client.id === clientId) || null;
}

function populateClientFilter() {
  const currentValue = elements.clientFilter.value || 'all';
  elements.clientFilter.innerHTML = '<option value="all">Tous les clients</option>';

  state.clients
    .slice()
    .sort((a, b) => String(a.name || a.email || '').localeCompare(String(b.name || b.email || '')))
    .forEach((client) => {
      const option = document.createElement('option');
      option.value = client.id;
      option.textContent = client.name || client.email || client.id;
      elements.clientFilter.appendChild(option);
    });

  elements.clientFilter.value = Array.from(elements.clientFilter.options).some((opt) => opt.value === currentValue)
    ? currentValue
    : 'all';
}

async function loadClients() {
  const snapshot = await getDocs(collection(db, CLIENTS_COLLECTION));
  state.clients = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  populateClientFilter();
}

async function loadOrders() {
  const allOrders = [];

  for (const client of state.clients) {
    try {
      const ordersRef = collection(db, CLIENTS_COLLECTION, client.id, 'orders');
      const snapshot = await getDocs(query(ordersRef, orderBy('createdAt', 'desc')));
      snapshot.docs.forEach((entry) => {
        allOrders.push({
          id: entry.id,
          clientId: client.id,
          ...entry.data()
        });
      });
    } catch (error) {
      console.error(`Erreur chargement commandes pour ${client.id}:`, error);
    }
  }

  state.orders = allOrders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function clearRealtimeListeners() {
  state.unsubscribers.forEach((unsubscribe) => {
    try { unsubscribe(); } catch (_) {}
  });
  state.unsubscribers = [];
}

function scheduleReload() {
  if (state.reloadTimeout) {
    clearTimeout(state.reloadTimeout);
  }

  state.reloadTimeout = setTimeout(async () => {
    await loadOrders();
    render();
  }, 250);
}

function setupRealtimeListeners() {
  clearRealtimeListeners();

  state.clients.forEach((client) => {
    const unsubscribe = onSnapshot(collection(db, CLIENTS_COLLECTION, client.id, 'orders'), () => {
      scheduleReload();
    });
    state.unsubscribers.push(unsubscribe);
  });
}

function getFilteredOrders() {
  const search = (elements.searchInput.value || '').trim().toLowerCase();
  const paymentStatus = elements.paymentStatusFilter.value;
  const fulfillmentStatus = elements.fulfillmentStatusFilter.value;
  const clientId = elements.clientFilter.value;

  return state.orders.filter((order) => {
    const client = getClientById(order.clientId);
    const searchable = [
      order.uniqueCode,
      order.customerName,
      order.customerEmail,
      client?.name,
      client?.email
    ].join(' ').toLowerCase();

    if (search && !searchable.includes(search)) return false;
    if (paymentStatus !== 'all' && order.status !== paymentStatus) return false;
    if (fulfillmentStatus !== 'all' && getFulfillmentStatus(order) !== fulfillmentStatus) return false;
    if (clientId !== 'all' && order.clientId !== clientId) return false;
    return true;
  });
}

function renderStats() {
  const totalOrders = state.orders.length;
  const pendingOrders = state.orders.filter((order) => order.status === 'pending').length;
  const inDelivery = state.orders.filter((order) => getFulfillmentStatus(order) === 'in_delivery').length;
  const delivered = state.orders.filter((order) => getFulfillmentStatus(order) === 'delivered').length;

  elements.statTotalOrders.textContent = String(totalOrders);
  elements.statPendingOrders.textContent = String(pendingOrders);
  elements.statInDelivery.textContent = String(inDelivery);
  elements.statDelivered.textContent = String(delivered);
}

function renderOrdersTable() {
  const filteredOrders = getFilteredOrders();
  const activeOrderId = state.activeOrderId && filteredOrders.some((order) => order.id === state.activeOrderId)
    ? state.activeOrderId
    : filteredOrders[0]?.id || null;

  state.activeOrderId = activeOrderId;

  if (filteredOrders.length === 0) {
    elements.ordersTableBody.innerHTML = '';
    elements.ordersEmptyState.hidden = false;
    return;
  }

  elements.ordersEmptyState.hidden = true;
  elements.ordersTableBody.innerHTML = filteredOrders.map((order) => {
    const client = getClientById(order.clientId);
    const paymentColor = getPaymentStatusColor(order.status);
    const fulfillmentKey = getFulfillmentStatus(order);
    const fulfillmentColor = getFulfillmentStatusColor(fulfillmentKey);

    return `
      <tr class="${order.id === activeOrderId ? 'active' : ''}" data-order-id="${order.id}">
        <td>${new Date(order.createdAt).toLocaleDateString('fr-FR')}</td>
        <td>
          <strong>${escapeHtml(order.customerName || client?.name || 'Client')}</strong>
          <div class="muted">${escapeHtml(order.customerEmail || client?.email || '-')}</div>
        </td>
        <td>${formatPrice(getOrderAmount(order))}</td>
        <td>${renderBadge(getPaymentStatusText(order.status), paymentColor)}</td>
        <td>${renderBadge(getFulfillmentStatusText(fulfillmentKey), fulfillmentColor)}</td>
        <td><span class="muted">${escapeHtml(order.uniqueCode || '-')}</span></td>
        <td>
          <div class="row-actions">
            <button class="pill-btn quick-status-btn" data-order-id="${order.id}" data-next-status="shipped" type="button">Expédié</button>
            <button class="pill-btn quick-status-btn" data-order-id="${order.id}" data-next-status="in_delivery" type="button">En cours de livraison</button>
            <button class="pill-btn quick-status-btn" data-order-id="${order.id}" data-next-status="delivered" type="button">Livré</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  elements.ordersTableBody.querySelectorAll('tr[data-order-id]').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('.quick-status-btn')) {
        return;
      }
      state.activeOrderId = row.dataset.orderId;
      renderOrderDetail();
      renderOrdersTable();
    });
  });

  elements.ordersTableBody.querySelectorAll('.quick-status-btn').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const order = state.orders.find((entry) => entry.id === button.dataset.orderId);
      if (!order) return;
      await updateFulfillmentStatus(order, button.dataset.nextStatus);
    });
  });
}

function renderStepper(order) {
  const currentStatus = getFulfillmentStatus(order);
  const currentIndex = Math.max(FULFILLMENT_STEPS.findIndex((step) => step.key === currentStatus), 0);
  const stepColor = getFulfillmentStatusColor(currentStatus);

  return `
    <div class="stepper">
      ${FULFILLMENT_STEPS.map((step, index) => {
        const active = index <= currentIndex;
        const current = index === currentIndex;
        return `
          <div class="step ${active ? 'active' : ''} ${current ? 'current' : ''}" style="--step-color:${stepColor}">
            <div class="step-line" style="${index === 0 ? 'opacity:0;' : ''}"></div>
            <div class="step-dot"></div>
            <span class="step-label">${step.label}</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderItems(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length === 0) {
    return '<div class="muted">Aucun produit detaille dans cette commande.</div>';
  }

  return `
    <div class="items-list">
      ${items.map((item) => `
        <article class="item-card">
          <img src="${escapeHtml(item?.image || '')}" alt="${escapeHtml(item?.name || 'Produit')}" onerror="this.style.visibility='hidden'">
          <div>
            <div><strong style="color:var(--text);font-size:0.95rem;">${escapeHtml(item?.name || 'Produit')}</strong></div>
            <div class="muted">Qte: ${Number(item?.quantity) || 1} · PU: ${formatPrice(item?.price || 0)}</div>
            <div class="muted">${escapeHtml(item?.sku || item?.productId || '')}</div>
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function renderOrderDetail() {
  const order = state.orders.find((entry) => entry.id === state.activeOrderId);
  if (!order) {
    elements.orderDetailRoot.innerHTML = 'Selectionne une commande pour voir les details, le panier et mettre a jour le suivi client.';
    return;
  }

  const client = getClientById(order.clientId);
  const paymentColor = getPaymentStatusColor(order.status);
  const fulfillmentKey = getFulfillmentStatus(order);
  const fulfillmentColor = getFulfillmentStatusColor(fulfillmentKey);

  elements.orderDetailRoot.innerHTML = `
    <div>
      <div class="detail-grid">
        <div>
          <strong>Client</strong>
          <div>${escapeHtml(order.customerName || client?.name || 'Client')}</div>
        </div>
        <div>
          <strong>Email</strong>
          <div>${escapeHtml(order.customerEmail || client?.email || '-')}</div>
        </div>
        <div>
          <strong>Telephone</strong>
          <div>${escapeHtml(order.customerPhone || client?.phone || '-')}</div>
        </div>
        <div>
          <strong>Montant</strong>
          <div>${formatPrice(getOrderAmount(order))}</div>
        </div>
      </div>

      <div class="detail-section">
        <strong>Adresse</strong>
        <div>${escapeHtml(order.customerAddress || client?.address || '-')}</div>
      </div>

      <div class="detail-section">
        <strong>Etat commande</strong>
        <div style="display:flex;gap:0.6rem;flex-wrap:wrap;margin-top:0.55rem;">
          ${renderBadge(getPaymentStatusText(order.status), paymentColor)}
          ${renderBadge(getFulfillmentStatusText(fulfillmentKey), fulfillmentColor)}
        </div>
        ${renderStepper(order)}
      </div>

      <div class="detail-section">
        <strong>Mettre a jour le suivi client</strong>
        <div style="display:grid;grid-template-columns:1fr auto;gap:0.65rem;margin-top:0.75rem;">
          <select class="select" id="detailFulfillmentSelect">
            ${FULFILLMENT_STEPS.map((step) => `
              <option value="${step.key}" ${step.key === fulfillmentKey ? 'selected' : ''}>${step.label}</option>
            `).join('')}
          </select>
          <button class="btn btn-primary" id="detailFulfillmentSave" type="button">
            <i class="fas fa-truck"></i>
            Enregistrer
          </button>
        </div>
        <div class="muted" style="margin-top:0.55rem;">
          Derniere mise a jour: ${order.fulfillmentUpdatedAt ? new Date(order.fulfillmentUpdatedAt).toLocaleString('fr-FR') : 'Non definie'}
        </div>
      </div>

      <div class="detail-section">
        <strong>Note logistique interne</strong>
        <div style="display:grid;gap:0.65rem;margin-top:0.75rem;">
          <textarea class="select" id="detailLogisticsNote" rows="4" style="min-height:120px;resize:vertical;">${escapeHtml(order.logisticsNote || '')}</textarea>
          <div style="display:flex;justify-content:space-between;gap:0.75rem;align-items:center;flex-wrap:wrap;">
            <div class="muted">Visible seulement dans le back-office commandes.</div>
            <button class="btn btn-secondary" id="detailLogisticsSave" type="button">
              <i class="fas fa-note-sticky"></i>
              Enregistrer la note
            </button>
          </div>
        </div>
      </div>

      <div class="detail-section">
        <strong>Produits</strong>
        <div style="margin-top:0.8rem;">
          ${renderItems(order)}
        </div>
      </div>

      <div class="detail-section">
        <strong>Infos internes</strong>
        <div class="detail-grid" style="margin-top:0.75rem;">
          <div>
            <strong>Code unique</strong>
            <div>${escapeHtml(order.uniqueCode || '-')}</div>
          </div>
          <div>
            <strong>Methode paiement</strong>
            <div>${escapeHtml(order.methodName || '-')}</div>
          </div>
          <div>
            <strong>Soumise le</strong>
            <div>${order.createdAt ? new Date(order.createdAt).toLocaleString('fr-FR') : '-'}</div>
          </div>
          <div>
            <strong>Ville</strong>
            <div>${escapeHtml(order.customerCity || client?.city || '-')}</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const saveButton = document.getElementById('detailFulfillmentSave');
  const select = document.getElementById('detailFulfillmentSelect');
  const noteField = document.getElementById('detailLogisticsNote');
  const saveNoteButton = document.getElementById('detailLogisticsSave');
  saveButton?.addEventListener('click', async () => {
    if (!select) return;
    await updateFulfillmentStatus(order, select.value);
  });
  saveNoteButton?.addEventListener('click', async () => {
    await saveLogisticsNote(order, noteField?.value || '');
  });
}

async function updateFulfillmentStatus(order, nextStatus) {
  try {
    const orderRef = doc(db, CLIENTS_COLLECTION, order.clientId, 'orders', order.id);
    await updateDoc(orderRef, {
      fulfillmentStatus: nextStatus,
      fulfillmentUpdatedAt: new Date().toISOString()
    });

     const client = getClientById(order.clientId);
     const targetUid = client?.uid || order?.clientUid || null;
     if (targetUid) {
       await sendBroadcastNotification({
         type: 'order_tracking',
         title: 'Suivi de commande mis a jour',
         body: `Votre commande ${order?.uniqueCode || order.id} est maintenant: ${getFulfillmentStatusText(nextStatus)}.`,
         target: 'user',
         targetUid,
         url: './index.html',
         createdBy: 'dashboard_orders'
       });
     }

    showToast(`Suivi client mis a jour: ${getFulfillmentStatusText(nextStatus)}`);
  } catch (error) {
    console.error('Erreur mise a jour suivi commande:', error);
    showToast('Impossible de mettre a jour le suivi de cette commande.', 'error');
  }
}

async function saveLogisticsNote(order, logisticsNote) {
  try {
    const orderRef = doc(db, CLIENTS_COLLECTION, order.clientId, 'orders', order.id);
    await updateDoc(orderRef, {
      logisticsNote,
      logisticsUpdatedAt: new Date().toISOString()
    });
    showToast('Note logistique enregistree.');
  } catch (error) {
    console.error('Erreur sauvegarde note logistique:', error);
    showToast('Impossible d enregistrer la note.', 'error');
  }
}

function render() {
  elements.ordersLoadingState.hidden = state.orders.length > 0;
  renderStats();
  renderOrdersTable();
  renderOrderDetail();
}

function attachEvents() {
  [
    elements.searchInput,
    elements.paymentStatusFilter,
    elements.fulfillmentStatusFilter,
    elements.clientFilter
  ].forEach((entry) => {
    entry?.addEventListener('input', render);
    entry?.addEventListener('change', render);
  });

  elements.refreshOrdersBtn?.addEventListener('click', async () => {
    elements.ordersLoadingState.hidden = false;
    await loadOrders();
    render();
  });
}

async function init() {
  attachEvents();
  await loadClients();
  await loadOrders();
  setupRealtimeListeners();
  render();
}

init().catch((error) => {
  console.error('Erreur initialisation dashboard commandes:', error);
  elements.ordersLoadingState.hidden = true;
  elements.ordersEmptyState.hidden = false;
  elements.ordersEmptyState.textContent = 'Impossible de charger les commandes pour le moment.';
});
