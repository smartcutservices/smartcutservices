import { getMoncashPaymentStatus } from '../../moncash-client.js';

const titleEl = document.getElementById('page-title');
const copyEl = document.getElementById('page-copy');
const statusBox = document.getElementById('status-box');
const statusDetail = document.getElementById('status-detail');

function setState({ title, copy, detail, tone = 'neutral' }) {
  titleEl.textContent = title;
  copyEl.textContent = copy;
  statusDetail.textContent = detail;
  statusBox.className = `status-box ${tone === 'paid' ? 'status-paid' : tone === 'failed' ? 'status-failed' : ''}`;
  const strong = statusBox.querySelector('strong');
  if (strong) strong.textContent = title;
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session_id');
  const transactionId = params.get('transactionId') || params.get('transaction_id');
  const orderId = params.get('orderId') || params.get('order_id') || params.get('reference');
  const forcedStatus = params.get('status');

  if (!sessionId && !transactionId && !orderId) {
    setState({
      title: 'Paiement introuvable',
      copy: 'Nous ne trouvons pas la transaction MonCash liée à ce retour.',
      detail: 'Revenez au site pour relancer votre paiement.',
      tone: 'failed'
    });
    return;
  }

  if (forcedStatus === 'cancelled') {
    setState({
      title: 'Paiement annulé',
      copy: 'Votre paiement MonCash a été annulé avant validation.',
      detail: 'Aucune somme ne sera confirmée tant que vous ne relancez pas le paiement.',
      tone: 'failed'
    });
  }

  try {
    const payload = await getMoncashPaymentStatus({
      sessionId,
      transactionId,
      orderId
    });
    const status = String(payload?.status || payload?.paymentStatus || '').toLowerCase();
    const amount = Number(payload?.amount || 0);
    const amountLabel = new Intl.NumberFormat('fr-HT', {
      style: 'currency',
      currency: 'HTG',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount || 0);

    if (status === 'paid') {
      localStorage.removeItem('veltrixa_cart');
      setState({
        title: 'Paiement confirmé',
        copy: 'Votre transaction MonCash a bien été confirmée.',
        detail: `Commande ${payload?.uniqueCode || payload?.orderId || ''} validée pour ${amountLabel}.`,
        tone: 'paid'
      });
      return;
    }

    if (status === 'failed' || status === 'cancelled') {
      setState({
        title: 'Paiement non confirmé',
        copy: 'La transaction n’a pas été validée par MonCash.',
        detail: 'Vous pouvez revenir au site et relancer le paiement.',
        tone: 'failed'
      });
      return;
    }

    setState({
      title: 'Paiement en attente',
      copy: 'MonCash n’a pas encore confirmé la transaction côté serveur.',
      detail: 'Rechargez cette page dans quelques instants si vous venez juste de terminer le paiement.'
    });
  } catch (error) {
    setState({
      title: 'Vérification impossible',
      copy: 'Nous n’avons pas pu vérifier votre paiement MonCash pour le moment.',
      detail: error?.message || 'Réessayez dans quelques instants.',
      tone: 'failed'
    });
  }
}

init();
