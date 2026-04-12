import { getMoncashPaymentStatus } from '../../moncash-client.js';
import { downloadOrderPdfReceipt } from '../../order-pdf.js';

const PENDING_PAYMENT_KEY = 'smartcut_pending_moncash_payment';
const CART_STORAGE_KEY = 'veltrixa_cart';
const titleEl = document.getElementById('page-title');
const copyEl = document.getElementById('page-copy');
const statusBox = document.getElementById('status-box');
const statusDetail = document.getElementById('status-detail');
const orderMeta = document.getElementById('order-meta');
const refreshBtn = document.getElementById('refresh-status-btn');
const downloadPdfBtn = document.getElementById('download-pdf-btn');
let latestOrder = null;

function readPendingPayment() {
  try {
    const raw = localStorage.getItem(PENDING_PAYMENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function clearPendingPayment() {
  try {
    localStorage.removeItem(PENDING_PAYMENT_KEY);
  } catch (_) {
    // Ignore storage issues.
  }
}

function clearCartStorage() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, '[]');
    localStorage.removeItem(CART_STORAGE_KEY);
  } catch (_) {
    // Ignore storage issues.
  }
}

function formatAmount(amount) {
  return new Intl.NumberFormat('fr-HT', {
    style: 'currency',
    currency: 'HTG',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(amount || 0));
}

function setMetaLines(lines = []) {
  if (!orderMeta) return;
  const safeLines = lines.filter(Boolean);
  orderMeta.innerHTML = safeLines
    .map((line) => `<div class="meta-line">${line}</div>`)
    .join('');
  orderMeta.style.display = safeLines.length ? 'grid' : 'none';
}

function setState({ title, copy, detail, tone = 'neutral', meta = [] }) {
  titleEl.textContent = title;
  copyEl.textContent = copy;
  statusDetail.textContent = detail;
  statusBox.className = `status-box ${tone === 'paid' ? 'status-paid' : tone === 'failed' ? 'status-failed' : tone === 'pending' ? 'status-pending' : ''}`;
  const strong = statusBox.querySelector('strong');
  if (strong) strong.textContent = title;
  setMetaLines(meta);
}

function setDownloadButton(order) {
  latestOrder = order || null;
  if (!downloadPdfBtn) return;
  downloadPdfBtn.classList.toggle('btn-hidden', !latestOrder);
}

function buildReference(params, pending) {
  return {
    sessionId: params.get('session_id') || params.get('sessionId') || pending?.sessionId || '',
    transactionId: params.get('transactionId') || params.get('transaction_id') || '',
    orderId: params.get('orderId') || params.get('order_id') || params.get('reference') || pending?.orderId || '',
    forcedStatus: params.get('status') || '',
    pending
  };
}

function buildMeta(payload, pending) {
  const code = payload?.uniqueCode || payload?.orderId || pending?.orderId || '';
  const amount = payload?.amount || pending?.amount || 0;
  const email = pending?.customerEmail || '';
  return [
    code ? `Reference de commande : ${code}` : '',
    amount ? `Montant : ${formatAmount(amount)}` : '',
    email ? `Email : ${email}` : ''
  ];
}

async function pollPaymentStatus(reference, pending) {
  const attempts = 6;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const payload = await getMoncashPaymentStatus(reference);
    const status = String(payload?.status || payload?.paymentStatus || '').toLowerCase();

    if (status === 'paid') {
      clearCartStorage();
      clearPendingPayment();
      setDownloadButton(payload?.order || null);
      setState({
        title: 'Paiement confirme',
        copy: 'Votre transaction MonCash a bien ete confirmee et votre commande est enregistree.',
        detail: `Commande ${payload?.uniqueCode || payload?.orderId || ''} validee pour ${formatAmount(payload?.amount || pending?.amount || 0)}.`,
        tone: 'paid',
        meta: buildMeta(payload, pending)
      });
      return;
    }

    if (status === 'failed' || status === 'cancelled') {
      setDownloadButton(null);
      setState({
        title: 'Paiement non confirme',
        copy: 'La transaction n a pas ete validee par MonCash.',
        detail: 'Vous pouvez revenir au site, verifier vos informations et relancer le paiement.',
        tone: 'failed',
        meta: buildMeta(payload, pending)
      });
      return;
    }

    setState({
      title: 'Confirmation en cours',
      copy: 'Nous verifions encore la confirmation definitive aupres de MonCash.',
      detail: `Verification automatique ${attempt + 1}/${attempts}. Merci de patienter quelques secondes.`,
      tone: 'pending',
      meta: buildMeta(payload, pending)
    });

    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 3500));
    }
  }

  setState({
    title: 'Paiement en attente',
    copy: 'Le paiement a ete lance, mais la confirmation definitive n est pas encore revenue.',
    detail: 'Vous pouvez utiliser le bouton de verification pour actualiser le statut sans relancer la commande.',
    tone: 'pending',
    meta: buildMeta({}, pending)
  });
}

async function runStatusCheck() {
  const params = new URLSearchParams(window.location.search);
  const pending = readPendingPayment();
  const reference = buildReference(params, pending);

  if (reference.forcedStatus === 'cancelled') {
    clearPendingPayment();
    setDownloadButton(null);
    setState({
      title: 'Paiement annule',
      copy: 'Le paiement MonCash a ete annule avant validation.',
      detail: 'Aucune somme ne sera confirmee tant que vous ne relancez pas le paiement.',
      tone: 'failed',
      meta: buildMeta({}, pending)
    });
    return;
  }

  if (!reference.sessionId && !reference.transactionId && !reference.orderId) {
    setDownloadButton(null);
    setState({
      title: 'Retour MonCash detecte',
      copy: 'Aucune reference de paiement n a ete trouvee dans cette page.',
      detail: 'Retournez au site pour relancer le paiement si necessaire.',
      tone: 'failed'
    });
    return;
  }

  setState({
    title: 'Verification du paiement',
    copy: 'Nous contactons MonCash pour obtenir le statut reel de votre transaction.',
    detail: 'Merci de patienter quelques secondes.',
    tone: 'pending',
    meta: buildMeta({}, pending)
  });

  await pollPaymentStatus(reference, pending);
}

if (downloadPdfBtn) {
  downloadPdfBtn.addEventListener('click', async () => {
    if (!latestOrder) return;
    try {
      await downloadOrderPdfReceipt(latestOrder, {
        companyName: 'Smart Cut Services',
        companyAddress: 'smartcutservices.com',
        thankYouMessage: 'Merci pour votre confiance. Conservez ce PDF avec votre code unique.'
      });
    } catch (error) {
      setState({
        title: 'PDF indisponible',
        copy: 'Le paiement est confirme, mais le PDF ne peut pas etre genere pour le moment.',
        detail: error?.message || 'Reessayez dans quelques instants.',
        tone: 'failed',
        meta: buildMeta(latestOrder, readPendingPayment())
      });
    }
  });
}

if (refreshBtn) {
  refreshBtn.addEventListener('click', () => {
    runStatusCheck().catch((error) => {
      setState({
        title: 'Verification impossible',
        copy: 'Nous n avons pas pu verifier votre paiement MonCash pour le moment.',
        detail: error?.message || 'Reessayez dans quelques instants.',
        tone: 'failed'
      });
    });
  });
}

runStatusCheck().catch((error) => {
  setState({
    title: 'Verification impossible',
    copy: 'Nous n avons pas pu verifier votre paiement MonCash pour le moment.',
    detail: error?.message || 'Reessayez dans quelques instants.',
    tone: 'failed'
  });
});
