const crypto = require('crypto');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');

// Values are deliberately stored in Secret Manager. Never put a Meta token in
// Firestore, the browser, or a committed configuration file.
const WHATSAPP_ACCESS_TOKEN = defineSecret('WHATSAPP_ACCESS_TOKEN');
const WHATSAPP_PHONE_NUMBER_ID = defineSecret('WHATSAPP_PHONE_NUMBER_ID');
const WHATSAPP_APP_SECRET = defineSecret('WHATSAPP_APP_SECRET');
const WHATSAPP_VERIFY_TOKEN = defineSecret('WHATSAPP_VERIFY_TOKEN');
const WHATSAPP_GRAPH_API_VERSION = defineSecret('WHATSAPP_GRAPH_API_VERSION');

const CONSENT_VERSION = '2026-09-09';
const MARKETING_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000;
const STOP_WORDS = new Set(['stop', 'arreter', 'arrêter', 'desabonner', 'désabonner', 'unsubscribe', 'quit']);
const SUBSCRIPTIONS = 'whatsappSubscriptions';
const DELIVERIES = 'whatsappDeliveries';
const CAMPAIGNS = 'whatsappCampaigns';
const INBOX = 'whatsappInbox';
const SETTINGS_REF = ['whatsappSettings', 'config'];

function isoNow() { return new Date().toISOString(); }
function maskPhone(phone = '') {
  const value = String(phone || '');
  return value.length < 5 ? '***' : `${value.slice(0, 3)}••••${value.slice(-3)}`;
}
function normalizePhone(value = '') {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Smart Cut's primary market is Haiti. Keep other E.164 numbers intact.
  if (digits.length === 8) digits = `509${digits}`;
  if (digits.length < 10 || digits.length > 15) return '';
  return digits;
}
function isTruthy(value) { return value === true || value === 'true' || value === 1; }
function isPaidOrder(data = {}) {
  const values = [data.status, data.paymentStatus, data.moncashStatus, data.orderStatus]
    .map((value) => String(value || '').toLowerCase());
  return values.some((value) => ['paid', 'completed', 'confirmed', 'success', 'successful'].includes(value));
}
function isActiveProduct(data = {}) {
  return String(data.status || data.publicationStatus || '').toLowerCase() === 'active'
    || data.publicationStatus === 'published';
}
function shouldSendOptInConfirmation(previous = {}, next = {}) {
  const wasActive = Boolean(previous.serviceOptIn || previous.marketingOptIn);
  const isActive = Boolean(next.serviceOptIn || next.marketingOptIn);
  return isActive && (!wasActive || String(previous.phone || '') !== String(next.phone || ''));
}
function parseWebhook(payload = {}) {
  const incoming = [];
  const statuses = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'messages') continue;
      const value = change.value || {};
      for (const message of value.messages || []) {
        if (!message?.id || !message?.from) continue;
        incoming.push({
          messageId: String(message.id),
          from: normalizePhone(message.from),
          text: String(message?.text?.body || '').trim(),
          type: String(message.type || ''),
          timestamp: Number(message.timestamp || 0) * 1000 || Date.now(),
          profileName: String(value.contacts?.[0]?.profile?.name || '').trim()
        });
      }
      for (const status of value.statuses || []) {
        if (!status?.id) continue;
        statuses.push({
          messageId: String(status.id),
          status: String(status.status || 'unknown').toLowerCase(),
          timestamp: Number(status.timestamp || 0) * 1000 || Date.now(),
          recipient: normalizePhone(status.recipient_id)
        });
      }
    }
  }
  return { incoming, statuses };
}
function verifySignature(rawBody, received, appSecret) {
  if (!appSecret || !received || !String(received).startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const supplied = String(received).slice(7);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const suppliedBuffer = Buffer.from(supplied, 'hex');
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

module.exports = ({ admin, db, logger, REGION, verifyBearerUser, isAdminUser }) => {
  const cors = (res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  };
  const json = (res, status, data) => { cors(res); return res.status(status).json(data); };
  const requireUser = async (req, res) => {
    try {
      const decoded = await verifyBearerUser(req);
      if (!decoded?.uid) { json(res, 401, { ok: false, error: 'authentication_required' }); return null; }
      return decoded;
    } catch (_) { json(res, 401, { ok: false, error: 'invalid_session' }); return null; }
  };
  const requireAdmin = async (req, res) => {
    const user = await requireUser(req, res);
    if (!user) return null;
    if (!(await isAdminUser(user.uid))) { json(res, 403, { ok: false, error: 'admin_required' }); return null; }
    return user;
  };
  const settingsRef = () => db.collection(SETTINGS_REF[0]).doc(SETTINGS_REF[1]);
  const defaultSettings = () => ({
    marketingEnabled: false,
    language: 'fr',
    templates: { utilityOptInConfirmation: '', utilityOrderConfirmation: '', marketingNewProduct: '', supportFollowup: '' },
    updatedAt: ''
  });
  const getSettings = async () => ({ ...defaultSettings(), ...((await settingsRef().get()).data() || {}) });
  const secretValue = (secret) => String(secret.value() || '').trim();
  const graphVersion = () => secretValue(WHATSAPP_GRAPH_API_VERSION) || 'v23.0';

  async function sendMeta(payload) {
    const token = secretValue(WHATSAPP_ACCESS_TOKEN);
    const phoneNumberId = secretValue(WHATSAPP_PHONE_NUMBER_ID);
    if (!token || !phoneNumberId) throw new Error('whatsapp_secrets_not_configured');
    const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${phoneNumberId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error?.message || `meta_http_${response.status}`);
      error.code = body?.error?.code || response.status;
      throw error;
    }
    return String(body?.messages?.[0]?.id || '');
  }
  function templatePayload(to, templateName, language, values = []) {
    return {
      messaging_product: 'whatsapp', to, type: 'template',
      template: {
        name: templateName, language: { code: language || 'fr' },
        components: values.length ? [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text: String(text || '') })) }] : []
      }
    };
  }
  async function createDelivery({ id, uid = '', phone, kind, template = '', campaignId = '', orderId = '', metadata = {} }) {
    const ref = db.collection(DELIVERIES).doc(id);
    const snap = await ref.get();
    if (snap.exists) return { ref, data: snap.data() || {}, created: false };
    const now = isoNow();
    const data = { uid, phone, phoneMasked: maskPhone(phone), kind, template, campaignId, orderId, status: 'queued', metadata, createdAt: now, updatedAt: now };
    await ref.create(data);
    return { ref, data, created: true };
  }
  async function deliverTemplate({ id, uid, phone, kind, template, values, campaignId = '', orderId = '', metadata = {} }) {
    const entry = await createDelivery({ id, uid, phone, kind, template, campaignId, orderId, metadata });
    if (!entry.created || entry.data.status === 'sent' || entry.data.status === 'delivered' || entry.data.status === 'read') return entry.data;
    try {
      const settings = await getSettings();
      const messageId = await sendMeta(templatePayload(phone, template, settings.language, values));
      await entry.ref.set({ status: 'sent', metaMessageId: messageId, sentAt: isoNow(), updatedAt: isoNow() }, { merge: true });
      return { ...entry.data, status: 'sent', metaMessageId: messageId };
    } catch (error) {
      await entry.ref.set({ status: 'failed', error: String(error?.message || error).slice(0, 500), failedAt: isoNow(), updatedAt: isoNow() }, { merge: true });
      logger.warn('whatsapp-delivery-failed', { id, kind, code: error?.code || null });
      return { ...entry.data, status: 'failed' };
    }
  }
  async function queueProductCampaign(productId, product, source) {
    if (!isActiveProduct(product)) return null;
    const categoryId = String(product.categoryId || product.taxonomyCategoryId || product.category || '').trim();
    if (!categoryId) return null;
    const ref = db.collection(CAMPAIGNS).doc(`product_${source}_${productId}`);
    const existing = await ref.get();
    if (existing.exists) return null;
    await ref.create({ type: 'new_product', status: 'pending', source, productId, categoryId, productName: String(product.name || 'Nouveau produit'), productPrice: Number(product.price || 0), productUrl: `https://smartcutservices.com/product.html?id=${encodeURIComponent(productId)}`, createdAt: isoNow(), updatedAt: isoNow(), cursor: '' });
    return ref.id;
  }
  async function processCampaign(campaignDoc) {
    const campaign = campaignDoc.data() || {};
    const settings = await getSettings();
    if (!settings.marketingEnabled || !settings.templates?.marketingNewProduct) {
      await campaignDoc.ref.set({ status: 'paused_configuration', updatedAt: isoNow() }, { merge: true });
      return;
    }
    const cursor = String(campaign.cursor || '');
    let query = db.collection(SUBSCRIPTIONS)
      .where('marketingOptIn', '==', true)
      .where('marketingCategories', 'array-contains', String(campaign.categoryId || ''))
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(25);
    if (cursor) query = query.startAfter(cursor);
    const subscriptions = await query.get();
    let sent = 0;
    for (const subDoc of subscriptions.docs) {
      const sub = subDoc.data() || {};
      const lastSent = new Date(sub.lastMarketingSentAt || 0).getTime();
      if (!sub.marketingOptIn || !sub.phone || (Number.isFinite(lastSent) && Date.now() - lastSent < MARKETING_COOLDOWN_MS)) continue;
      const delivery = await deliverTemplate({
        id: `campaign_${campaignDoc.id}_${subDoc.id}`, uid: subDoc.id, phone: sub.phone, kind: 'marketing',
        template: settings.templates.marketingNewProduct,
        values: [campaign.productName || 'Nouveau produit', String(campaign.productPrice || ''), campaign.productUrl || ''],
        campaignId: campaignDoc.id, metadata: { productId: campaign.productId, categoryId: campaign.categoryId }
      });
      if (delivery.status === 'sent') {
        sent += 1;
        await subDoc.ref.set({ lastMarketingSentAt: isoNow(), updatedAt: isoNow() }, { merge: true });
      }
    }
    const complete = subscriptions.size < 25;
    await campaignDoc.ref.set({ status: complete ? 'completed' : 'processing', cursor: complete ? '' : subscriptions.docs.at(-1).id, sentCount: admin.firestore.FieldValue.increment(sent), completedAt: complete ? isoNow() : '', updatedAt: isoNow() }, { merge: true });
  }

  const whatsappPreferences = onRequest({ region: REGION, cors: true }, async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    const user = await requireUser(req, res); if (!user) return;
    const ref = db.collection(SUBSCRIPTIONS).doc(user.uid);
    if (req.method === 'GET') {
      const data = (await ref.get()).data() || {};
      return json(res, 200, { ok: true, subscription: { phone: data.phone || '', serviceOptIn: Boolean(data.serviceOptIn), marketingOptIn: Boolean(data.marketingOptIn), marketingCategories: Array.isArray(data.marketingCategories) ? data.marketingCategories : [], status: data.status || 'inactive', updatedAt: data.updatedAt || '' } });
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });
    const body = req.body || {};
    const phone = normalizePhone(body.phone);
    const serviceOptIn = isTruthy(body.serviceOptIn);
    const marketingOptIn = isTruthy(body.marketingOptIn);
    const marketingCategories = Array.from(new Set((Array.isArray(body.marketingCategories) ? body.marketingCategories : []).map((value) => String(value || '').trim()).filter(Boolean))).slice(0, 20);
    if ((serviceOptIn || marketingOptIn) && !phone) return json(res, 400, { ok: false, error: 'invalid_whatsapp_number' });
    if (marketingOptIn && !marketingCategories.length) return json(res, 400, { ok: false, error: 'marketing_categories_required' });
    const previous = (await ref.get()).data() || {};
    const now = isoNow();
    const active = serviceOptIn || marketingOptIn;
    const nextSubscription = { phone, serviceOptIn, marketingOptIn };
    await ref.set({ uid: user.uid, phone, phoneMasked: maskPhone(phone), serviceOptIn, marketingOptIn, marketingCategories, status: active ? 'active' : 'unsubscribed', consentVersion: CONSENT_VERSION, consentedAt: active ? now : (previous.consentedAt || ''), consentSource: 'profile', consentIp: String(req.headers['x-forwarded-for'] || '').split(',')[0].trim().slice(0, 80), revokedAt: active ? '' : now, updatedAt: now, createdAt: previous.createdAt || now }, { merge: true });

    let confirmation = { status: 'not_needed' };
    const settings = await getSettings();
    if (shouldSendOptInConfirmation(previous, nextSubscription)) {
      if (!settings.templates?.utilityOptInConfirmation) {
        confirmation = { status: 'template_not_configured' };
      } else {
        const delivery = await deliverTemplate({
          id: `optin_${user.uid}_${Date.now()}`,
          uid: user.uid,
          phone,
          kind: 'utility_opt_in_confirmation',
          template: settings.templates.utilityOptInConfirmation,
          values: [],
          metadata: { consentVersion: CONSENT_VERSION, source: 'profile' }
        });
        confirmation = { status: delivery.status || 'queued' };
      }
    }
    return json(res, 200, { ok: true, subscription: { phone, serviceOptIn, marketingOptIn, marketingCategories, status: active ? 'active' : 'unsubscribed', updatedAt: now }, confirmation });
  });

  const whatsappWebhook = onRequest({ region: REGION, secrets: [WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN] }, async (req, res) => {
    if (req.method === 'GET') {
      const query = req.query || {};
      if (query['hub.mode'] === 'subscribe' && String(query['hub.verify_token'] || '') === secretValue(WHATSAPP_VERIFY_TOKEN)) return res.status(200).send(String(query['hub.challenge'] || ''));
      return res.status(403).send('Forbidden');
    }
    if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');
    const raw = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body || {}));
    if (!verifySignature(raw, req.get('x-hub-signature-256'), secretValue(WHATSAPP_APP_SECRET))) return res.status(403).send('Forbidden');
    const { incoming, statuses } = parseWebhook(req.body || {});
    for (const message of incoming) {
      if (!message.from) continue;
      const existing = await db.collection(INBOX).doc(message.messageId).get();
      if (existing.exists) continue;
      const subscriptionSnap = await db.collection(SUBSCRIPTIONS).where('phone', '==', message.from).limit(1).get();
      const subscription = subscriptionSnap.docs[0];
      const stopped = STOP_WORDS.has(message.text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim());
      await db.collection(INBOX).doc(message.messageId).create({ ...message, phone: message.from, phoneMasked: maskPhone(message.from), uid: subscription?.id || '', stopped, receivedAt: isoNow(), status: 'open' });
      if (subscription) await subscription.ref.set({ lastInboundAt: isoNow(), updatedAt: isoNow(), ...(stopped ? { marketingOptIn: false, marketingCategories: [], status: subscription.data()?.serviceOptIn ? 'active' : 'unsubscribed', marketingRevokedAt: isoNow(), marketingRevokedSource: 'whatsapp_stop' } : {}) }, { merge: true });
    }
    for (const update of statuses) {
      const match = await db.collection(DELIVERIES).where('metaMessageId', '==', update.messageId).limit(1).get();
      if (!match.empty) await match.docs[0].ref.set({ status: update.status, statusAt: new Date(update.timestamp).toISOString(), updatedAt: isoNow() }, { merge: true });
    }
    return res.status(200).json({ ok: true });
  });

  const whatsappAdmin = onRequest({ region: REGION, cors: true, secrets: [WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_GRAPH_API_VERSION] }, async (req, res) => {
    if (req.method === 'OPTIONS') return res.status(204).send('');
    const adminUser = await requireAdmin(req, res); if (!adminUser) return;
    const body = req.body || {}; const action = String(body.action || (req.method === 'GET' ? 'overview' : '')).trim();
    if (action === 'overview') {
      const [settings, subscriptions, inbox, deliveries, campaigns] = await Promise.all([getSettings(), db.collection(SUBSCRIPTIONS).limit(100).get(), db.collection(INBOX).orderBy('receivedAt', 'desc').limit(80).get(), db.collection(DELIVERIES).orderBy('createdAt', 'desc').limit(100).get(), db.collection(CAMPAIGNS).orderBy('createdAt', 'desc').limit(40).get()]);
      const list = (snap) => snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      return json(res, 200, { ok: true, settings: { marketingEnabled: Boolean(settings.marketingEnabled), language: settings.language || 'fr', templates: settings.templates || {} }, subscriptions: list(subscriptions).map(({ phone, ...item }) => item), inbox: list(inbox).map(({ phone, ...item }) => item), deliveries: list(deliveries).map(({ phone, ...item }) => item), campaigns: list(campaigns) });
    }
    if (action === 'settings') {
      const templates = body.templates || {};
      const safeTemplates = ['utilityOptInConfirmation', 'utilityOrderConfirmation', 'marketingNewProduct', 'supportFollowup'].reduce((out, key) => { out[key] = String(templates[key] || '').trim().replace(/[^a-zA-Z0-9_]/g, '').slice(0, 128); return out; }, {});
      await settingsRef().set({ marketingEnabled: body.marketingEnabled === true, language: String(body.language || 'fr').slice(0, 12), templates: safeTemplates, updatedAt: isoNow(), updatedBy: adminUser.uid }, { merge: true });
      return json(res, 200, { ok: true });
    }
    if (action === 'reply') {
      const inboxId = String(body.inboxId || '').trim(); const message = String(body.message || '').trim().slice(0, 4096);
      if (!inboxId || !message) return json(res, 400, { ok: false, error: 'message_required' });
      const inbound = await db.collection(INBOX).doc(inboxId).get();
      if (!inbound.exists) return json(res, 404, { ok: false, error: 'conversation_not_found' });
      const data = inbound.data() || {}; const withinWindow = Date.now() - new Date(data.receivedAt || 0).getTime() <= CUSTOMER_WINDOW_MS;
      const settings = await getSettings();
      if (!withinWindow && !settings.templates?.supportFollowup) return json(res, 409, { ok: false, error: 'support_template_required' });
      const id = `reply_${inboxId}_${Date.now()}`; const phone = String(data.phone || '');
      if (!phone) return json(res, 400, { ok: false, error: 'phone_missing' });
      const delivery = withinWindow
        ? await (async () => { const entry = await createDelivery({ id, uid: data.uid || '', phone, kind: 'support_reply', metadata: { inboxId } }); try { const messageId = await sendMeta({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: message } }); await entry.ref.set({ status: 'sent', metaMessageId: messageId, sentAt: isoNow(), updatedAt: isoNow() }, { merge: true }); return { status: 'sent' }; } catch (error) { await entry.ref.set({ status: 'failed', error: String(error.message || error), updatedAt: isoNow() }, { merge: true }); return { status: 'failed' }; } })()
        : await deliverTemplate({ id, uid: data.uid || '', phone, kind: 'support_template', template: settings.templates.supportFollowup, values: [message], metadata: { inboxId } });
      await inbound.ref.set({ status: delivery.status === 'sent' ? 'replied' : 'open', lastReplyAt: isoNow(), lastReplyBy: adminUser.uid }, { merge: true });
      return json(res, 200, { ok: delivery.status === 'sent', status: delivery.status });
    }
    return json(res, 400, { ok: false, error: 'unknown_action' });
  });

  const whatsappOrderNotification = onDocumentWritten({ region: REGION, document: 'clients/{clientId}/orders/{orderId}', secrets: [WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_GRAPH_API_VERSION] }, async (event) => {
    const after = event.data?.after; const before = event.data?.before;
    if (!after?.exists || !isPaidOrder(after.data() || {}) || isPaidOrder(before?.data?.() || {})) return null;
    const uid = String(event.params.clientId || ''); const subscription = await db.collection(SUBSCRIPTIONS).doc(uid).get(); const sub = subscription.data() || {};
    const settings = await getSettings();
    if (!sub.serviceOptIn || !sub.phone || !settings.templates?.utilityOrderConfirmation) return null;
    const order = after.data() || {}; const orderId = String(event.params.orderId || after.id);
    return deliverTemplate({ id: `order_${orderId}_confirmation`, uid, phone: sub.phone, kind: 'utility_order', template: settings.templates.utilityOrderConfirmation, values: [orderId, String(order.total || order.totalAmount || order.amount || '')], orderId, metadata: { orderPath: after.ref.path } });
  });
  const whatsappProductCampaign = (source, document) => onDocumentWritten({ region: REGION, document }, async (event) => {
    const after = event.data?.after; const before = event.data?.before;
    if (!after?.exists || !isActiveProduct(after.data() || {}) || isActiveProduct(before?.data?.() || {})) return null;
    return queueProductCampaign(after.id, after.data() || {}, source);
  });
  const whatsappProcessMarketingCampaigns = onSchedule({ region: REGION, schedule: 'every 5 minutes', timeZone: 'America/Port-au-Prince', secrets: [WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_GRAPH_API_VERSION] }, async () => {
    const campaigns = await db.collection(CAMPAIGNS).where('status', 'in', ['pending', 'processing']).limit(5).get();
    for (const campaign of campaigns.docs) await processCampaign(campaign);
    return null;
  });

  return { whatsappPreferences, whatsappWebhook, whatsappAdmin, whatsappOrderNotification, whatsappNewVendorProductCampaign: whatsappProductCampaign('vendorProducts', 'vendorProducts/{productId}'), whatsappNewSmartcutProductCampaign: whatsappProductCampaign('products', 'products/{productId}'), whatsappProcessMarketingCampaigns };
};

module.exports._test = { normalizePhone, parseWebhook, verifySignature, isPaidOrder, isActiveProduct, shouldSendOptInConfirmation, STOP_WORDS };
