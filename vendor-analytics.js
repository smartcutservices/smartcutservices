import { db } from './firebase-init.js';
import {
  collection,
  getDocs,
  orderBy,
  query
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

function normalizeRate(rule) {
  const direct = Number(rule?.categoryRate ?? rule?.rate);
  return Number.isFinite(direct) ? direct : 0;
}

function getOrderMs(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeItems(order) {
  const source = Array.isArray(order?.items)
    ? order.items
    : Array.isArray(order?.cart)
      ? order.cart
      : Array.isArray(order?.products)
        ? order.products
        : [];

  return source.map((item) => ({
    productId: item?.productId || item?.id || '',
    name: item?.name || 'Produit',
    price: Number(item?.price ?? item?.unitPrice ?? item?.amount) || 0,
    quantity: Number(item?.quantity ?? item?.qty ?? item?.qte) || 1,
    vendorId: item?.vendorId || '',
    vendorName: item?.vendorName || '',
    commissionRule: item?.commissionRule || null,
    category: item?.category || '',
    deliveryMode: item?.deliveryMode || '',
    selectedOptions: Array.isArray(item?.selectedOptions) ? item.selectedOptions : []
  }));
}

export async function loadAllOrdersWithClients() {
  const clientsSnapshot = await getDocs(collection(db, 'clients'));
  const clients = clientsSnapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  const allOrders = [];

  await Promise.all(clients.map(async (client) => {
    try {
      const ordersRef = collection(db, 'clients', client.id, 'orders');
      const snapshot = await getDocs(query(ordersRef, orderBy('createdAt', 'desc')));
      snapshot.docs.forEach((entry) => {
        allOrders.push({
          id: entry.id,
          clientId: client.id,
          clientName: client.name || '',
          clientEmail: client.email || '',
          ...entry.data()
        });
      });
    } catch (error) {
      console.error(`Erreur chargement commandes vendeur pour ${client.id}:`, error);
    }
  }));

  return {
    clients,
    orders: allOrders.sort((a, b) => getOrderMs(b.createdAt) - getOrderMs(a.createdAt))
  };
}

export function buildVendorSalesSummary({
  vendorId,
  vendorName = '',
  orders = [],
  vendorProductIds = new Set()
}) {
  const orderMap = new Map();
  let grossAmount = 0;
  let commissionAmount = 0;
  let vendorNetAmount = 0;
  let itemCount = 0;

  orders.forEach((order) => {
    const matchingLines = normalizeItems(order).filter((item) => {
      if (item.vendorId && item.vendorId === vendorId) return true;
      return item.productId && vendorProductIds.has(item.productId);
    });

    if (matchingLines.length === 0) return;

    const normalizedLines = matchingLines.map((item) => {
      const gross = (Number(item.price) || 0) * (Number(item.quantity) || 1);
      const rate = normalizeRate(item.commissionRule);
      const commission = gross * (rate / 100);
      const net = gross - commission;
      grossAmount += gross;
      commissionAmount += commission;
      vendorNetAmount += net;
      itemCount += Number(item.quantity) || 1;
      return {
        ...item,
        grossAmount: gross,
        commissionAmount: commission,
        vendorNetAmount: net,
        commissionRate: rate
      };
    });

    orderMap.set(order.id, {
      id: order.id,
      clientId: order.clientId,
      clientName: order.customerName || order.clientName || 'Client',
      clientEmail: order.customerEmail || order.clientEmail || '',
      uniqueCode: order.uniqueCode || order.id,
      createdAt: order.createdAt || '',
      status: order.status || 'pending',
      fulfillmentStatus: order.fulfillmentStatus || 'ordered',
      grossAmount: normalizedLines.reduce((sum, item) => sum + item.grossAmount, 0),
      commissionAmount: normalizedLines.reduce((sum, item) => sum + item.commissionAmount, 0),
      vendorNetAmount: normalizedLines.reduce((sum, item) => sum + item.vendorNetAmount, 0),
      items: normalizedLines
    });
  });

  const recentOrders = Array.from(orderMap.values())
    .sort((a, b) => getOrderMs(b.createdAt) - getOrderMs(a.createdAt))
    .slice(0, 8);

  return {
    vendorId,
    vendorName,
    totalOrders: orderMap.size,
    grossAmount,
    commissionAmount,
    vendorNetAmount,
    itemCount,
    recentOrders
  };
}
