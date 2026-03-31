function formatPrice(value) {
  return new Intl.NumberFormat('fr-HT', {
    style: 'currency',
    currency: 'HTG',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function formatOptions(item) {
  const options = Array.isArray(item?.selectedOptions) ? item.selectedOptions : [];
  if (!options.length) return '-';

  return options.map((opt) => {
    if (typeof opt === 'string') return opt;
    const key = opt?.name || opt?.label || opt?.key || opt?.type || 'Option';
    const value = opt?.value || opt?.val || opt?.option || '';
    return value ? `${key}: ${value}` : key;
  }).join(' | ');
}

function getDeliveryLabel(delivery) {
  if (!delivery) return '';
  if (delivery.method === 'home') return 'Livraison a domicile';
  if (delivery.method === 'pickup') return 'Retrait en point de vente';
  if (delivery.method === 'meetup') return 'Rencontre livreur';
  return 'Livraison';
}

export async function downloadOrderPdfReceipt(order, config = {}) {
  if (typeof window.jspdf === 'undefined') {
    throw new Error('Bibliotheque PDF non chargee');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const companyName = config.companyName || 'Smart Cut Services';
  const companyAddress = config.companyAddress || 'smartcutservices.com';
  const thankYouMessage = config.thankYouMessage || 'Merci pour votre confiance.';
  const primaryColor = config.primaryColor || { r: 198, g: 167, b: 94 };
  const items = Array.isArray(order?.items) ? order.items : [];

  doc.setFillColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.rect(0, 0, doc.internal.pageSize.width, 36, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(companyName, 18, 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(companyAddress, 18, 30);

  doc.setTextColor(31, 30, 28);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RECU DE COMMANDE', 18, 54);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Date: ${new Date(order?.createdAt || Date.now()).toLocaleDateString('fr-FR')}`, 18, 64);

  doc.setDrawColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.roundedRect(18, 72, 174, 14, 3, 3, 'S');
  doc.setFont('helvetica', 'bold');
  doc.text(order?.uniqueCode || order?.id || 'N/A', 105, 81, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Informations client', 18, 100);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Nom: ${order?.customerName || '-'}`, 18, 110);
  doc.text(`Email: ${order?.customerEmail || '-'}`, 18, 118);
  doc.text(`Telephone: ${order?.customerPhone || '-'}`, 18, 126);
  doc.text(`Adresse: ${order?.customerAddress || '-'}`.slice(0, 100), 18, 134);
  doc.text(`Ville: ${order?.customerCity || '-'}`.slice(0, 100), 18, 142);

  let y = 154;
  if (order?.delivery) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Livraison', 18, y);
    y += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(`Methode: ${getDeliveryLabel(order.delivery)}`, 18, y);
    y += 8;
    if (order.delivery?.address) {
      doc.text(`Adresse: ${String(order.delivery.address).slice(0, 100)}`, 18, y);
      y += 8;
    }
    if (Number(order.delivery?.totalFee || 0) > 0) {
      doc.text(`Frais: ${formatPrice(order.delivery.totalFee)}`, 18, y);
      y += 8;
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Paiement', 18, y);
  y += 10;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Methode: ${order?.methodName || 'MonCash'}`, 18, y);
  y += 8;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
  doc.text(`Montant: ${formatPrice(order?.amount || 0)}`, 18, y);
  y += 12;

  doc.setTextColor(31, 30, 28);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Produits', 18, y);
  y += 8;

  items.forEach((item, index) => {
    if (y > 260) {
      doc.addPage();
      y = 20;
    }

    const qty = Number(item?.quantity || 1);
    const unitPrice = Number(item?.price || 0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`${index + 1}. ${String(item?.name || 'Produit').slice(0, 74)}`, 18, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.text(`Qte: ${qty} | PU: ${formatPrice(unitPrice)} | Total: ${formatPrice(qty * unitPrice)}`.slice(0, 110), 22, y);
    y += 5;
    const options = formatOptions(item);
    if (options !== '-') {
      doc.text(`Options: ${options}`.slice(0, 110), 22, y);
      y += 5;
    }
    y += 2;
  });

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(thankYouMessage, 18, Math.min(y + 8, 276));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Code de verification: ${order?.uniqueCode || order?.id || 'N/A'}`, 18, 286);

  doc.save(`recu-${order?.uniqueCode || order?.id || 'commande'}.pdf`);
}
