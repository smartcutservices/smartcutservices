const admin = require('firebase-admin');
const logger = require('firebase-functions/logger');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const PROJECT_ID = 'smartcutservices-9ce54';
const REGION = process.env.FUNCTION_REGION || 'us-central1';
const SITE_BASE_URL = normalizeBaseUrl(process.env.PUBLIC_SITE_URL || 'https://smartcutservices.com');
const MONCASH_API_BASE = normalizeBaseUrl(
  process.env.MONCASH_API_BASE || 'https://moncashbutton.digicelgroup.com/Api'
);
const MONCASH_GATEWAY_BASE = normalizeBaseUrl(
  process.env.MONCASH_GATEWAY_BASE || 'https://moncashbutton.digicelgroup.com/Moncash-middleware'
);
const MONCASH_CURRENCY = process.env.MONCASH_CURRENCY || 'HTG';
const DEFAULT_RETURN_URL = `${SITE_BASE_URL}/moncash/return`;
const DEFAULT_ALERT_URL = `https://${REGION}-${PROJECT_ID}.cloudfunctions.net/moncashAlert`;

const MONCASH_CLIENT_ID = defineSecret('MONCASH_CLIENT_ID');
const MONCASH_CLIENT_SECRET = defineSecret('MONCASH_CLIENT_SECRET');
const MONCASH_SECRET_API_KEY = defineSecret('MONCASH_SECRET_API_KEY');
const MONCASH_BUSINESS_KEY = defineSecret('MONCASH_BUSINESS_KEY');

let tokenCache = {
  accessToken: '',
  expiresAt: 0
};

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function applyCors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
}

function handleOptions(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return true;
  }
  return false;
}

function sendJson(res, status, body) {
  applyCors(res);
  res.status(status).json(body);
}

function buildReturnPageUrl({ sessionId = '', orderId = '', transactionId = '', status = '' } = {}) {
  const url = new URL(DEFAULT_RETURN_URL);
  if (sessionId) url.searchParams.set('session_id', String(sessionId).trim());
  if (orderId) url.searchParams.set('orderId', String(orderId).trim());
  if (transactionId) url.searchParams.set('transactionId', String(transactionId).trim());
  if (status) url.searchParams.set('status', String(status).trim());
  return url.toString();
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeItems(items) {
  return Array.isArray(items)
    ? items.map((item) => {
        const quantity = Math.max(1, toNumber(item?.quantity) || 1);
        const price = Math.max(0, toNumber(item?.price));
        return {
          productId: item?.productId || '',
          name: item?.name || 'Produit',
          price,
          quantity,
          sku: item?.sku || '',
          image: item?.image || '',
          selectedOptions: Array.isArray(item?.selectedOptions) ? item.selectedOptions : [],
          vendorId: item?.vendorId || '',
          vendorName: item?.vendorName || '',
          commissionRule: item?.commissionRule || null,
          sourceType: item?.sourceType || '',
          category: item?.category || '',
          deliveryMode: item?.deliveryMode || ''
        };
      })
    : [];
}

function buildOrderTotals(items, delivery) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const shippingAmount = Math.max(0, toNumber(delivery?.totalFee || delivery?.shippingAmount));
  const weightFee = Math.max(0, toNumber(delivery?.weightFee));
  return {
    subtotal,
    shippingAmount,
    weightFee,
    total: subtotal + shippingAmount
  };
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  const raw = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.toString('utf-8')
    : typeof req.body === 'string'
      ? req.body
      : '';

  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch (_) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
}

function createSessionId() {
  return db.collection('paymentSessions').doc().id;
}

function createUniqueCode(seed = '') {
  const normalized = String(seed || '').replace(/[^A-Za-z0-9]/g, '');
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 31 + normalized.charCodeAt(i)) % 100000000;
  }

  if (!hash) {
    hash = Math.floor(Math.random() * 100000000);
  }

  return `SCS-${String(hash).padStart(8, '0')}`;
}

function safeSecretValue(secretParam) {
  try {
    return String(secretParam.value() || '').trim();
  } catch (_) {
    return '';
  }
}

function buildBasicAuthHeader(clientId, clientSecret) {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const rawText = await response.text();

  let payload = {};
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch (_) {
    payload = { raw: rawText };
  }

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function getMoncashAccessToken() {
  if (tokenCache.accessToken && tokenCache.expiresAt > Date.now()) {
    return tokenCache.accessToken;
  }

  const clientId = safeSecretValue(MONCASH_CLIENT_ID);
  const clientSecret = safeSecretValue(MONCASH_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    throw new Error('MonCash credentials are not configured');
  }

  const authBody = 'scope=read,write&grant_type=client_credentials';
  let payload;

  try {
    payload = await fetchJson(`${MONCASH_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: buildBasicAuthHeader(clientId, clientSecret),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: authBody
    });
  } catch (error) {
    const status = Number(error?.status || 0);
    if (status !== 401 && status !== 403) {
      throw error;
    }

    logger.warn('MonCash OAuth with Authorization header failed, retrying with form credentials', {
      status,
      message: error?.message || ''
    });

    payload = await fetchJson(`${MONCASH_API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        scope: 'read,write',
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      }).toString()
    });
  }

  const accessToken = String(payload?.access_token || '').trim();
  if (!accessToken) {
    throw new Error('Unable to obtain MonCash access token');
  }

  const expiresIn = Math.max(10, toNumber(payload?.expires_in) || 60);
  tokenCache = {
    accessToken,
    expiresAt: Date.now() + Math.max(5, expiresIn - 5) * 1000
  };

  return accessToken;
}

async function createMoncashRedirect(orderId, amount) {
  const accessToken = await getMoncashAccessToken();
  const payload = await fetchJson(`${MONCASH_API_BASE}/v1/CreatePayment`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      amount,
      orderId
    })
  });

  const paymentToken = String(payload?.payment_token?.token || '').trim();
  if (!paymentToken) {
    const error = new Error('MonCash did not return a payment token');
    error.payload = payload;
    throw error;
  }

  return {
    paymentToken,
    checkoutUrl: `${MONCASH_GATEWAY_BASE}/Payment/Redirect?token=${encodeURIComponent(paymentToken)}`,
    providerResponse: payload
  };
}

async function retrieveMoncashPayment({ orderId = '', transactionId = '' } = {}) {
  const accessToken = await getMoncashAccessToken();
  const hasTransactionId = Boolean(String(transactionId || '').trim());
  const endpoint = hasTransactionId ? '/v1/RetrieveTransactionPayment' : '/v1/RetrieveOrderPayment';
  const body = hasTransactionId
    ? { transactionId: String(transactionId || '').trim() }
    : { orderId: String(orderId || '').trim() };

  const payload = await fetchJson(`${MONCASH_API_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const payment = payload?.payment || {};
  const message = String(payment?.message || '').trim().toLowerCase();
  const resolvedOrderId = String(payment?.reference || orderId || '').trim();
  const resolvedTransactionId = String(payment?.transaction_id || payment?.transactionId || transactionId || '').trim();

  return {
    ok: payload?.status === 200 && (message === '' || message === 'successful' || message === 'success'),
    orderId: resolvedOrderId,
    transactionId: resolvedTransactionId,
    amount: toNumber(payment?.cost ?? payment?.amount),
    payer: String(payment?.payer || '').trim(),
    message: String(payment?.message || '').trim(),
    providerResponse: payload
  };
}

async function retrieveMoncashMiddlewarePayment({ encryptedTransactionId = '', encryptedOrderId = '' } = {}) {
  const businessKey = safeSecretValue(MONCASH_BUSINESS_KEY);
  if (!businessKey) {
    throw new Error('MonCash business key is not configured');
  }

  const hasEncryptedTransactionId = Boolean(String(encryptedTransactionId || '').trim());
  const endpoint = hasEncryptedTransactionId
    ? `${MONCASH_GATEWAY_BASE}/Checkout/${encodeURIComponent(businessKey)}/Payment/Transaction/`
    : `${MONCASH_GATEWAY_BASE}/Checkout/${encodeURIComponent(businessKey)}/Payment/Order/`;

  const params = new URLSearchParams();
  if (hasEncryptedTransactionId) {
    params.set('transactionId', String(encryptedTransactionId || '').trim());
  } else {
    params.set('orderId', String(encryptedOrderId || '').trim());
  }

  const payload = await fetchJson(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  return {
    ok: Boolean(payload?.success && payload?.payment_status),
    orderId: String(payload?.reference || '').trim(),
    transactionId: String(payload?.transNumber || '').trim(),
    amount: toNumber(payload?.cost),
    payer: String(payload?.payer || '').trim(),
    message: String(payload?.payment_msg || payload?.msg || '').trim(),
    providerResponse: payload
  };
}

async function updateOrderState(clientId, orderId, payload) {
  if (!clientId || !orderId) return;
  const orderRef = db.collection('clients').doc(clientId).collection('orders').doc(orderId);
  await orderRef.set(payload, { merge: true });
}

async function getOrderRecord(clientId, orderId) {
  if (!clientId || !orderId) return null;
  const snap = await db.collection('clients').doc(clientId).collection('orders').doc(orderId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ref: snap.ref, data: snap.data() || {} };
}

function getProductCollectionName(item) {
  if (item?.sourceType === 'vendor' || item?.vendorId) {
    return 'vendorProducts';
  }
  return 'products';
}

function getSelectedVariationIndex(item) {
  const options = Array.isArray(item?.selectedOptions) ? item.selectedOptions : [];
  const match = options.find((opt) => Number.isInteger(Number(opt?.variationIndex)));
  return match ? Number(match.variationIndex) : null;
}

function getSelectedSizeValue(item) {
  const options = Array.isArray(item?.selectedOptions) ? item.selectedOptions : [];
  const match = options.find((opt) => {
    const key = String(opt?.type || opt?.name || opt?.key || '').toLowerCase();
    return key === 'size' || key === 'taille';
  });
  return match ? String(match.value || match.val || match.option || '').trim() : '';
}

async function decrementInventoryForItems(transaction, items = []) {
  for (const item of items) {
    const productId = String(item?.productId || '').trim();
    if (!productId) continue;

    const quantity = Math.max(1, toNumber(item?.quantity) || 1);
    const collectionName = getProductCollectionName(item);
    const productRef = db.collection(collectionName).doc(productId);
    const productSnap = await transaction.get(productRef);
    if (!productSnap.exists) continue;

    const productData = productSnap.data() || {};
    const patch = {};
    let touched = false;

    if (Number.isFinite(toNumber(productData.stock))) {
      patch.stock = Math.max(0, toNumber(productData.stock) - quantity);
      touched = true;
    }

    const variationIndex = getSelectedVariationIndex(item);
    if (Number.isInteger(variationIndex) && Array.isArray(productData.variations) && productData.variations[variationIndex]) {
      const variations = productData.variations.map((variation) => ({ ...variation }));
      const variation = { ...variations[variationIndex] };
      if (Number.isFinite(toNumber(variation.stock))) {
        variation.stock = Math.max(0, toNumber(variation.stock) - quantity);
        variations[variationIndex] = variation;
        patch.variations = variations;
        touched = true;
      }
    }

    const sizeValue = getSelectedSizeValue(item);
    if (sizeValue && Array.isArray(productData.sizes)) {
      let sizeTouched = false;
      const sizes = productData.sizes.map((size) => {
        if (String(size?.size || '') !== sizeValue) return size;
        const currentQty = toNumber(size?.quantity);
        if (!Number.isFinite(currentQty)) return size;
        sizeTouched = true;
        return {
          ...size,
          quantity: Math.max(0, currentQty - quantity)
        };
      });

      if (sizeTouched) {
        patch.sizes = sizes;
        touched = true;
      }
    }

    if (touched) {
      transaction.set(productRef, patch, { merge: true });
    }
  }
}

async function findSessionBySessionId(sessionId) {
  if (!sessionId) return null;
  const snap = await db.collection('paymentSessions').doc(sessionId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ref: snap.ref, data: snap.data() || {} };
}

async function findSessionByOrderId(orderId) {
  if (!orderId) return null;
  const snap = await db
    .collection('paymentSessions')
    .where('orderId', '==', orderId)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, ref: docSnap.ref, data: docSnap.data() || {} };
}

async function findSessionByTransactionId(transactionId) {
  if (!transactionId) return null;
  const snap = await db
    .collection('paymentSessions')
    .where('providerTransactionId', '==', transactionId)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, ref: docSnap.ref, data: docSnap.data() || {} };
}

function derivePaymentStatus(details) {
  if (details?.ok) return 'paid';

  const message = String(details?.message || '').toLowerCase();
  if (message.includes('pending') || message.includes('processing')) {
    return 'pending';
  }

  return 'failed';
}

async function syncMoncashPayment({ session, details, source = '' }) {
  const now = new Date().toISOString();
  const paymentStatus = derivePaymentStatus(details);
  const sessionData = session?.data || {};
  const clientId = sessionData.clientId || '';
  const orderId = sessionData.orderId || details.orderId || '';

  if (!session || !clientId || !orderId) {
    return {
      sessionId: session?.id || '',
      orderId,
      paymentStatus,
      updated: false
    };
  }

  const orderPatch = {
    status: paymentStatus === 'paid' ? 'paid' : paymentStatus,
    paymentStatus,
    paymentProvider: 'moncash',
    updatedAt: now,
    moncash: {
      orderId: details.orderId || orderId,
      transactionId: details.transactionId || null,
      payer: details.payer || null,
      message: details.message || '',
      source,
      raw: details.providerResponse || null
    }
  };

  if (paymentStatus === 'paid') {
    orderPatch.paidAt = now;
    orderPatch.fulfillmentStatus = 'ordered';
    orderPatch.receiptAvailable = true;
    orderPatch.receiptReadyAt = now;
  }

  if (paymentStatus === 'paid') {
    await db.runTransaction(async (transaction) => {
      const freshSessionSnap = await transaction.get(session.ref);
      const freshSessionData = freshSessionSnap.data() || {};
      const orderRef = db.collection('clients').doc(clientId).collection('orders').doc(orderId);
      const orderSnap = await transaction.get(orderRef);
      const orderData = orderSnap.data() || {};
      const alreadyApplied = Boolean(freshSessionData.inventoryAppliedAt) || String(freshSessionData.status || '').toLowerCase() === 'paid';

      if (!alreadyApplied) {
        await decrementInventoryForItems(transaction, orderData.items || []);
      }

      transaction.set(session.ref, {
        status: paymentStatus,
        providerOrderId: details.orderId || orderId,
        providerTransactionId: details.transactionId || null,
        payer: details.payer || null,
        providerMessage: details.message || '',
        providerResponse: details.providerResponse || null,
        updatedAt: now,
        paidAt: now,
        inventoryAppliedAt: alreadyApplied ? freshSessionData.inventoryAppliedAt || null : now
      }, { merge: true });

      transaction.set(orderRef, orderPatch, { merge: true });
    });
  } else {
    await Promise.all([
      session.ref.set(
        {
          status: paymentStatus,
          providerOrderId: details.orderId || orderId,
          providerTransactionId: details.transactionId || null,
          payer: details.payer || null,
          providerMessage: details.message || '',
          providerResponse: details.providerResponse || null,
          updatedAt: now,
          paidAt: sessionData.paidAt || null
        },
        { merge: true }
      ),
      updateOrderState(clientId, orderId, orderPatch)
    ]);
  }

  return {
    sessionId: session.id,
    orderId,
    paymentStatus,
    updated: true
  };
}

async function resolveAndSyncPayment({ sessionId = '', orderId = '', transactionId = '', source = '' } = {}) {
  let session = null;

  if (sessionId) {
    session = await findSessionBySessionId(sessionId);
  }
  if (!session && transactionId) {
    session = await findSessionByTransactionId(transactionId);
  }
  if (!session && orderId) {
    session = await findSessionByOrderId(orderId);
  }

  const resolvedOrderId = orderId || session?.data?.orderId || '';
  let details;
  try {
    details = await retrieveMoncashPayment({
      orderId: resolvedOrderId,
      transactionId
    });
  } catch (error) {
    if (!transactionId) throw error;
    details = await retrieveMoncashMiddlewarePayment({
      encryptedTransactionId: transactionId
    });
  }

  if (!session && details.orderId) {
    session = await findSessionByOrderId(details.orderId);
  }
  if (!session && details.transactionId) {
    session = await findSessionByTransactionId(details.transactionId);
  }

  const syncResult = await syncMoncashPayment({ session, details, source });
  return {
    session,
    details,
    syncResult
  };
}

function buildStatusResponse({ session, details, syncResult, fallbackSessionId = '', order = null }) {
  const sessionData = session?.data || {};
  const orderData = order?.data || {};
  return {
    ok: true,
    sessionId: session?.id || fallbackSessionId || '',
    status: syncResult?.paymentStatus || sessionData.status || derivePaymentStatus(details),
    amount: details?.amount || sessionData.amount || 0,
    currency: sessionData.currency || MONCASH_CURRENCY,
    orderId: details?.orderId || sessionData.orderId || '',
    transactionId: details?.transactionId || sessionData.providerTransactionId || '',
    uniqueCode: orderData.uniqueCode || sessionData.uniqueCode || '',
    orderStatus: syncResult?.paymentStatus === 'paid' ? 'paid' : (sessionData.status || ''),
    paymentStatus: syncResult?.paymentStatus || sessionData.status || '',
    order: order ? { id: order.id, ...orderData } : null
  };
}

exports.createMoncashPayment = onRequest(
  { region: REGION, secrets: [MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY] },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    const clientId = safeSecretValue(MONCASH_CLIENT_ID);
    const clientSecret = safeSecretValue(MONCASH_CLIENT_SECRET);
    if (!clientId || !clientSecret) {
      sendJson(res, 500, { ok: false, error: 'missing-moncash-credentials' });
      return;
    }

    const body = parseBody(req);
    const localClientId = String(body.clientId || '').trim();
    const clientUid = String(body.clientUid || '').trim();
    const customerName = String(body.customerName || '').trim();
    const customerEmail = String(body.customerEmail || '').trim();
    const customerPhone = String(body.customerPhone || '').trim();
    const customerAddress = String(body.customerAddress || '').trim();
    const customerCity = String(body.customerCity || '').trim();
    const delivery = body.delivery && typeof body.delivery === 'object' ? body.delivery : null;
    const items = normalizeItems(body.items);

    if (!localClientId) {
      sendJson(res, 400, { ok: false, error: 'missing-client-id' });
      return;
    }

    if (!customerName || !customerEmail) {
      sendJson(res, 400, { ok: false, error: 'missing-customer-identity' });
      return;
    }

    if (items.length === 0) {
      sendJson(res, 400, { ok: false, error: 'missing-items' });
      return;
    }

    const totals = buildOrderTotals(items, delivery);
    if (totals.total <= 0) {
      sendJson(res, 400, { ok: false, error: 'invalid-total' });
      return;
    }

    const sessionId = createSessionId();
    const orderRef = db.collection('clients').doc(localClientId).collection('orders').doc();
    const orderId = orderRef.id;
    const sessionRef = db.collection('paymentSessions').doc(sessionId);
    const now = new Date().toISOString();
    const uniqueCode = createUniqueCode(sessionId);

    const orderDraft = {
      clientId: localClientId,
      clientUid,
      amount: totals.total,
      subtotal: totals.subtotal,
      shippingAmount: totals.shippingAmount,
      weightFee: totals.weightFee,
      currency: MONCASH_CURRENCY,
      items,
      delivery,
      status: 'payment_initiated',
      paymentStatus: 'initiated',
      fulfillmentStatus: 'awaiting_payment',
      paymentProvider: 'moncash',
      paymentSessionId: sessionId,
      uniqueCode,
      methodId: String(body.methodId || ''),
      methodName: String(body.methodName || 'MonCash'),
      customerName,
      customerEmail,
      customerPhone,
      customerAddress,
      customerCity,
      moncash: {
        orderId
      },
      createdAt: now,
      updatedAt: now
    };

    const sessionData = {
      identifier: sessionId,
      clientId: localClientId,
      clientUid,
      orderId,
      provider: 'moncash',
      status: 'initiated',
      amount: totals.total,
      subtotal: totals.subtotal,
      shippingAmount: totals.shippingAmount,
      weightFee: totals.weightFee,
      currency: MONCASH_CURRENCY,
      customerName,
      customerEmail,
      customerPhone,
      returnUrl: DEFAULT_RETURN_URL,
      alertUrl: DEFAULT_ALERT_URL,
      uniqueCode,
      createdAt: now,
      updatedAt: now
    };

    try {
      await Promise.all([
        orderRef.set(orderDraft, { merge: true }),
        sessionRef.set(sessionData, { merge: true })
      ]);

      const redirect = await createMoncashRedirect(orderId, totals.total);

      await Promise.all([
        sessionRef.set(
          {
            status: 'redirect_ready',
            paymentToken: redirect.paymentToken,
            checkoutUrl: redirect.checkoutUrl,
            providerResponse: redirect.providerResponse,
            updatedAt: new Date().toISOString()
          },
          { merge: true }
        ),
        updateOrderState(localClientId, orderId, {
          status: 'awaiting_payment',
          paymentStatus: 'redirect_ready',
          moncashCheckoutUrl: redirect.checkoutUrl,
          updatedAt: new Date().toISOString()
        })
      ]);

      sendJson(res, 200, {
        ok: true,
        sessionId,
        orderId,
        checkoutUrl: redirect.checkoutUrl,
        returnUrl: DEFAULT_RETURN_URL,
        alertUrl: DEFAULT_ALERT_URL
      });
    } catch (error) {
      logger.error('MonCash create payment failed', error);

      await Promise.all([
        sessionRef.set(
          {
            status: 'server_error',
            errorMessage: error?.message || 'Unknown error',
            errorDetails: error?.payload || null,
            updatedAt: new Date().toISOString()
          },
          { merge: true }
        ),
        updateOrderState(localClientId, orderId, {
          status: 'payment_error',
          paymentStatus: 'server_error',
          updatedAt: new Date().toISOString()
        })
      ]);

      sendJson(res, 500, {
        ok: false,
        error: 'server-error',
        message: error?.message || 'Unexpected server error'
      });
    }
  }
);

exports.moncashAlert = onRequest(
  { region: REGION, secrets: [MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY] },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (!['GET', 'POST'].includes(req.method)) {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    const body = parseBody(req);
    const sessionId = String(body.session_id || body.sessionId || req.query.session_id || req.query.sessionId || '').trim();
    const orderId = String(
      body.orderId || body.order_id || body.reference || req.query.orderId || req.query.order_id || req.query.reference || ''
    ).trim();
    const transactionId = String(
      body.transactionId || body.transaction_id || req.query.transactionId || req.query.transaction_id || ''
    ).trim();

    if (!sessionId && !orderId && !transactionId) {
      sendJson(res, 400, { ok: false, error: 'missing-payment-reference' });
      return;
    }

      try {
        const result = await resolveAndSyncPayment({
          sessionId,
          orderId,
          transactionId,
          source: 'alert'
        });
        const clientId = result.session?.data?.clientId || '';
        const resolvedOrderId = result.syncResult?.orderId || result.details?.orderId || result.session?.data?.orderId || '';
        const order = await getOrderRecord(clientId, resolvedOrderId);

        const responseBody = buildStatusResponse({
          session: result.session,
          details: result.details,
          syncResult: result.syncResult,
          fallbackSessionId: sessionId,
          order
        });

        if (req.method === 'GET') {
          res.redirect(302, buildReturnPageUrl({
            sessionId: responseBody.sessionId,
            orderId: responseBody.orderId,
            transactionId: responseBody.transactionId,
            status: responseBody.status === 'failed' ? 'failed' : ''
          }));
          return;
        }

        sendJson(res, 200, responseBody);
      } catch (error) {
      logger.error('MonCash alert sync failed', error);
      if (req.method === 'GET') {
        res.redirect(302, buildReturnPageUrl({
          sessionId,
          orderId,
          transactionId,
          status: 'failed'
        }));
        return;
      }
      sendJson(res, 500, {
        ok: false,
        error: 'sync-failed',
        message: error?.message || 'Unable to synchronize MonCash payment'
      });
    }
  }
);

exports.getMoncashPaymentStatus = onRequest(
  { region: REGION, secrets: [MONCASH_CLIENT_ID, MONCASH_CLIENT_SECRET, MONCASH_SECRET_API_KEY, MONCASH_BUSINESS_KEY] },
  async (req, res) => {
    if (handleOptions(req, res)) return;

    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed' });
      return;
    }

    const sessionId = String(req.query.session_id || req.query.sessionId || '').trim();
    const orderId = String(req.query.order_id || req.query.orderId || req.query.reference || '').trim();
    const transactionId = String(req.query.transaction_id || req.query.transactionId || '').trim();

    if (!sessionId && !orderId && !transactionId) {
      sendJson(res, 400, { ok: false, error: 'missing-payment-reference' });
      return;
    }

    try {
      let session = null;
      if (sessionId) session = await findSessionBySessionId(sessionId);
      if (!session && transactionId) session = await findSessionByTransactionId(transactionId);
      if (!session && orderId) session = await findSessionByOrderId(orderId);

      const currentStatus = String(session?.data?.status || '').toLowerCase();
      const shouldRefreshFromProvider = Boolean(orderId || transactionId) || currentStatus !== 'paid';

        if (shouldRefreshFromProvider) {
          const result = await resolveAndSyncPayment({
            sessionId,
            orderId,
            transactionId,
            source: 'status'
          });
          const clientId = result.session?.data?.clientId || '';
          const resolvedOrderId = result.syncResult?.orderId || result.details?.orderId || result.session?.data?.orderId || '';
          const order = await getOrderRecord(clientId, resolvedOrderId);

          sendJson(res, 200, buildStatusResponse({
            session: result.session,
            details: result.details,
            syncResult: result.syncResult,
            fallbackSessionId: sessionId,
            order
          }));
          return;
        }

        const clientId = session?.data?.clientId || '';
        const order = await getOrderRecord(clientId, session?.data?.orderId || orderId);
        sendJson(res, 200, {
          ok: true,
          sessionId: session?.id || sessionId,
          status: session?.data?.status || 'pending',
          amount: session?.data?.amount || 0,
          currency: session?.data?.currency || MONCASH_CURRENCY,
          orderId: session?.data?.orderId || orderId,
          transactionId: session?.data?.providerTransactionId || transactionId,
          uniqueCode: order?.data?.uniqueCode || session?.data?.uniqueCode || '',
          orderStatus: session?.data?.status || '',
          paymentStatus: session?.data?.status || '',
          order: order ? { id: order.id, ...order.data } : null
        });
    } catch (error) {
      logger.error('MonCash status lookup failed', error);
      sendJson(res, 500, {
        ok: false,
        error: 'status-lookup-failed',
        message: error?.message || 'Unable to retrieve MonCash payment status'
      });
    }
  }
);
