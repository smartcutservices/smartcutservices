function formatPrice(value) {
  return new Intl.NumberFormat('fr-HT', {
    style: 'currency',
    currency: 'HTG',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function normalizeSelectedOptionLabel(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isCustomerVisibleOption(option) {
  if (!option || typeof option === 'string') return true;
  const label = normalizeSelectedOptionLabel(option?.label || option?.name || option?.key || option?.type || '');
  return !['url fichier', 'lien fichier', 'chemin storage', 'storage path'].includes(label);
}

function formatOptions(item) {
  const options = (Array.isArray(item?.selectedOptions) ? item.selectedOptions : []).filter(isCustomerVisibleOption);
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
  return 'Livraison a domicile';
}

function buildDeliveryLines(delivery) {
  if (!delivery) return [];

  const lines = [`Methode: ${getDeliveryLabel(delivery)}`];
  const zoneLabel = delivery?.homeZone?.city || delivery?.homeZone?.zone || delivery?.homeZone?.name || '';
  if (zoneLabel) lines.push(`Zone: ${zoneLabel}`);
  if (delivery.address) lines.push(`Adresse: ${String(delivery.address)}`);
  if (delivery.department) lines.push(`Departement: ${String(delivery.department)}`);
  if (delivery.commune) lines.push(`Commune: ${String(delivery.commune)}`);
  if (delivery.phone) lines.push(`Telephone: ${String(delivery.phone)}`);
  if (delivery.whatsapp) lines.push(`WhatsApp: ${String(delivery.whatsapp)}`);

  if (Number(delivery.totalFee || 0) > 0) {
    lines.push(`Frais: ${formatPrice(delivery.totalFee)}`);
  }

  return lines;
}

function buildPdfFilename(order) {
  const raw = String(order?.uniqueCode || order?.id || 'commande')
    .replace(/[^A-Za-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `recu-${raw || 'commande'}.pdf`;
}

function buildPromoLines(order) {
  const promo = order?.promoCode && typeof order.promoCode === 'object' ? order.promoCode : null;
  const discountAmount = Number(order?.discountAmount || promo?.discountAmount || 0);
  if (!promo && discountAmount <= 0) return [];

  const lines = [];
  const code = String(promo?.code || '').trim();
  const label = String(promo?.label || '').trim();

  if (code && label) {
    lines.push(`Code promo: ${code} - ${label}`);
  } else if (code) {
    lines.push(`Code promo: ${code}`);
  } else if (label) {
    lines.push(`Promotion: ${label}`);
  }

  if (discountAmount > 0) {
    lines.push(`Reduction appliquee: - ${formatPrice(discountAmount)}`);
  }

  return lines;
}

function triggerPdfDownload(doc, filename) {
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Fallback mobile/webview: ouvrir aussi le PDF si le téléchargement natif est ignoré.
  const isTouchDevice = window.matchMedia?.('(pointer: coarse)')?.matches;
  const isAppleDevice = /iPad|iPhone|iPod|Macintosh/i.test(window.navigator.userAgent || '');
  if (isTouchDevice || isAppleDevice) {
    window.setTimeout(() => {
      window.open(blobUrl, '_blank', 'noopener');
    }, 120);
  }

  window.setTimeout(() => {
    URL.revokeObjectURL(blobUrl);
  }, 60_000);
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
    const deliveryLines = buildDeliveryLines(order.delivery);
    deliveryLines.forEach((line) => {
      const wrapped = doc.splitTextToSize(line, 170);
      doc.text(wrapped, 18, y);
      y += wrapped.length * 6 + 2;
    });
    if (deliveryLines.length === 0) {
      doc.text(`Methode: ${getDeliveryLabel(order.delivery)}`, 18, y);
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

  const promoLines = buildPromoLines(order);
  const hasTotalsBlock = Number(order?.subtotal || 0) > 0 || Number(order?.shippingAmount || 0) > 0 || Number(order?.discountAmount || 0) > 0;
  if (promoLines.length || hasTotalsBlock) {
    doc.setTextColor(31, 30, 28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Resume du montant', 18, y);
    y += 10;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);

    if (Number(order?.subtotal || 0) > 0) {
      doc.text(`Sous-total produits: ${formatPrice(order.subtotal)}`, 18, y);
      y += 8;
    }

    promoLines.forEach((line) => {
      const wrapped = doc.splitTextToSize(line, 170);
      doc.text(wrapped, 18, y);
      y += wrapped.length * 6 + 2;
    });

    if (Number(order?.shippingAmount || 0) > 0) {
      doc.text(`Livraison: ${formatPrice(order.shippingAmount)}`, 18, y);
      y += 8;
    }

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(primaryColor.r, primaryColor.g, primaryColor.b);
    doc.text(`Total paye: ${formatPrice(order?.amount || 0)}`, 18, y);
    y += 12;
  }

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
  const wrappedThankYou = doc.splitTextToSize(thankYouMessage, 170);
  doc.text(wrappedThankYou, 18, Math.min(y + 8, 270));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text(`Code de verification: ${order?.uniqueCode || order?.id || 'N/A'}`, 18, 286);

  triggerPdfDownload(doc, buildPdfFilename(order));
}
