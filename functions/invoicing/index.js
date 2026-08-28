'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const crypto = require('node:crypto');
const {
  toMinor, calculateProforma, canTransitionWithdrawal, formatDocumentNumber,
  reserveBalance, releaseReservedBalance, completeReservedBalance
} = require('./domain');

const PUBLIC_SITE = 'https://smartcutservices.com';
const MIN_WITHDRAWAL_MINOR = 50000; // 500 HTG
const MAX_PAGE = 100;

class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function buildInvoicing(internals) {
  const { db, admin, REGION: region } = internals;
  const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

  function cors(req, res) {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return true; }
    return false;
  }

  function endpoint(handler, options = {}) {
    return onRequest({
      region,
      ...(options.moncash ? { secrets: [internals.MONCASH_CLIENT_ID, internals.MONCASH_CLIENT_SECRET, internals.MONCASH_SECRET_API_KEY, internals.MONCASH_BUSINESS_KEY] } : {})
    }, async (req, res) => {
      if (cors(req, res)) return;
      try { await handler(req, res); }
      catch (error) {
        if (error instanceof ApiError) return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
        logger.error('billing endpoint failed', { message: error?.message, stack: error?.stack });
        return res.status(500).json({ ok: false, error: 'internal-error', message: 'Une erreur est survenue. Veuillez reessayer.' });
      }
    });
  }

  async function user(req) {
    const decoded = await internals.verifyBearerUser(req);
    if (!decoded?.uid) throw new ApiError(401, 'auth-required', 'Authentification requise.');
    return decoded;
  }

  async function adminUser(req) {
    const decoded = await user(req);
    if (await internals.isAdminUser(decoded.uid)) return decoded;
    const role = await db.collection('platformRoles').doc(decoded.uid).get();
    if (!role.exists || role.data().status !== 'active' || !['platform_admin', 'finance_admin'].includes(role.data().role)) {
      throw new ApiError(403, 'admin-required', 'Acces administrateur requis.');
    }
    return decoded;
  }

  const text = (value, max = 500) => String(value || '').trim().slice(0, max);
  const email = (value) => {
    const normalized = text(value, 180).toLowerCase();
    if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new ApiError(400, 'invalid-email', 'Adresse email invalide.');
    return normalized;
  };
  const phone = (value) => text(value, 32).replace(/[^0-9+ ()-]/g, '');
  const randomToken = () => crypto.randomBytes(24).toString('base64url');
  const asDate = (value) => {
    const raw = text(value, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ApiError(400, 'invalid-date', 'Date invalide.');
    return raw;
  };
  const serialize = (snap) => ({ id: snap.id, ...snap.data() });

  async function owned(collection, id, uid) {
    if (!id || id.includes('/')) throw new ApiError(400, 'invalid-id', 'Identifiant invalide.');
    const snap = await db.collection(collection).doc(id).get();
    if (!snap.exists || snap.data().ownerUid !== uid) throw new ApiError(404, 'not-found', 'Element introuvable.');
    return snap;
  }

  async function nextNumber(tx, uid, kind, prefix) {
    const year = new Date().getUTCFullYear();
    const ref = db.collection('billingCounters').doc(`${uid}_${kind}_${year}`);
    const snap = await tx.get(ref);
    const sequence = Number(snap.data()?.sequence || 0) + 1;
    tx.set(ref, { ownerUid: uid, kind, year, sequence, updatedAt: serverTimestamp() }, { merge: true });
    return formatDocumentNumber(prefix, year, sequence);
  }

  async function audit(tx, data) {
    const ref = db.collection('billingAuditLogs').doc();
    tx.set(ref, { ...data, createdAt: serverTimestamp() });
  }

  const bootstrap = endpoint(async (req, res) => {
    const current = await user(req);
    const limit = Math.min(MAX_PAGE, Math.max(1, Number(req.query.limit || 50)));
    const [profile, clients, services, proformas, invoices, payments, withdrawals, ledger, notifications, balance] = await Promise.all([
      db.collection('billingProfiles').doc(current.uid).get(),
      db.collection('billingClients').where('ownerUid', '==', current.uid).limit(limit).get(),
      db.collection('billingServices').where('ownerUid', '==', current.uid).limit(limit).get(),
      db.collection('billingProformas').where('ownerUid', '==', current.uid).limit(limit).get(),
      db.collection('billingInvoices').where('ownerUid', '==', current.uid).limit(limit).get(),
      db.collection('billingPayments').where('ownerUid', '==', current.uid).limit(limit).get(),
      db.collection('billingWithdrawals').where('ownerUid', '==', current.uid).limit(limit).get(),
      db.collection('billingLedgerEntries').where('ownerUid', '==', current.uid).limit(limit).get(),
      db.collection('billingNotifications').where('ownerUid', '==', current.uid).limit(limit).get(),
      db.collection('billingBalances').doc(current.uid).get()
    ]);
    res.json({ ok: true, user: { uid: current.uid, email: current.email || '' }, profile: profile.exists ? profile.data() : null,
      balance: balance.exists ? balance.data() : { availableMinor: 0, reservedMinor: 0, paidOutMinor: 0, currency: 'HTG' },
      clients: clients.docs.map(serialize), services: services.docs.map(serialize), proformas: proformas.docs.map(serialize),
      invoices: invoices.docs.map(serialize), payments: payments.docs.map(serialize), withdrawals: withdrawals.docs.map(serialize),
      ledger: ledger.docs.map(serialize), notifications: notifications.docs.map(serialize) });
  });

  const saveProfile = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req);
    const payload = { ownerUid: current.uid, businessName: text(req.body?.businessName, 140), contactName: text(req.body?.contactName, 140),
      email: email(req.body?.email || current.email), phone: phone(req.body?.phone), address: text(req.body?.address, 500),
      taxId: text(req.body?.taxId, 80), moncashNumber: phone(req.body?.moncashNumber), logoUrl: text(req.body?.logoUrl, 500), updatedAt: serverTimestamp() };
    if (!payload.businessName) throw new ApiError(400, 'business-name-required', "Le nom de l'entreprise est requis.");
    await db.collection('billingProfiles').doc(current.uid).set(payload, { merge: true });
    res.json({ ok: true, profile: payload });
  });

  function crudEndpoint(collection, normalize) {
    return endpoint(async (req, res) => {
      if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
      const current = await user(req);
      const action = text(req.body?.action || 'save', 20);
      const id = text(req.body?.id, 120);
      if (action === 'delete') {
        const snap = await owned(collection, id, current.uid);
        await snap.ref.set({ archived: true, updatedAt: serverTimestamp() }, { merge: true });
        return res.json({ ok: true, id });
      }
      const ref = id ? db.collection(collection).doc(id) : db.collection(collection).doc();
      if (id) await owned(collection, id, current.uid);
      const data = { ...normalize(req.body || {}), ownerUid: current.uid, archived: false, updatedAt: serverTimestamp() };
      if (!id) data.createdAt = serverTimestamp();
      await ref.set(data, { merge: true });
      res.json({ ok: true, id: ref.id });
    });
  }

  const saveClient = crudEndpoint('billingClients', (b) => {
    const name = text(b.name, 140); if (!name) throw new ApiError(400, 'client-name-required', 'Nom du client requis.');
    return { name, company: text(b.company, 140), email: email(b.email), phone: phone(b.phone), address: text(b.address, 500), notes: text(b.notes, 2000) };
  });
  const saveService = crudEndpoint('billingServices', (b) => {
    const name = text(b.name, 160); if (!name) throw new ApiError(400, 'service-name-required', 'Nom du service requis.');
    const priceMinor = toMinor(b.price); if (priceMinor <= 0) throw new ApiError(400, 'invalid-price', 'Tarif invalide.');
    return { name, description: text(b.description, 1200), priceMinor, currency: 'HTG', unit: text(b.unit || 'service', 40) };
  });

  const saveProforma = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const body = req.body || {};
    const clientSnap = await owned('billingClients', text(body.clientId, 120), current.uid);
    let totals; try { totals = calculateProforma(body); } catch { throw new ApiError(400, 'invalid-proforma', 'Lignes ou montants invalides.'); }
    const cleanItems = totals.items.map((i) => ({ name: text(i.name, 180), description: text(i.description, 1200), quantity: i.quantity,
      unitPriceMinor: i.unitPriceMinor, lineTotalMinor: i.lineTotalMinor, unit: text(i.unit || 'service', 40), serviceId: text(i.serviceId, 120) }));
    if (cleanItems.some((i) => !i.name)) throw new ApiError(400, 'item-name-required', 'Chaque ligne doit avoir un nom.');
    const id = text(body.id, 120); const ref = id ? db.collection('billingProformas').doc(id) : db.collection('billingProformas').doc();
    if (id) { const old = await owned('billingProformas', id, current.uid); if (['PAID', 'CANCELLED'].includes(old.data().status)) throw new ApiError(409, 'final-proforma', 'Ce document finalise ne peut plus etre modifie.'); }
    const publicToken = id ? (await ref.get()).data()?.publicToken : randomToken();
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref); const number = existing.exists ? existing.data().number : await nextNumber(tx, current.uid, 'proforma', 'PF');
      tx.set(ref, { ownerUid: current.uid, number, clientId: clientSnap.id,
        clientSnapshot: { name: clientSnap.data().name, company: clientSnap.data().company || '', email: clientSnap.data().email || '', phone: clientSnap.data().phone || '', address: clientSnap.data().address || '' },
        items: cleanItems, subtotalMinor: totals.subtotalMinor, discountMinor: totals.discountMinor, taxMinor: totals.taxMinor, feeMinor: totals.feeMinor,
        totalMinor: totals.totalMinor, currency: 'HTG', issueDate: asDate(body.issueDate), expiryDate: asDate(body.expiryDate), notes: text(body.notes, 3000),
        terms: text(body.terms, 3000), status: body.publish ? 'SENT' : 'DRAFT', publicToken, updatedAt: serverTimestamp(), ...(existing.exists ? {} : { createdAt: serverTimestamp() }) }, { merge: true });
      await audit(tx, { actorUid: current.uid, ownerUid: current.uid, action: existing.exists ? 'PROFORMA_UPDATED' : 'PROFORMA_CREATED', targetId: ref.id });
    });
    res.json({ ok: true, id: ref.id, publicUrl: `${PUBLIC_SITE}/facture.html?t=${encodeURIComponent(publicToken)}` });
  });

  async function publicProformaByToken(token) {
    const snap = await db.collection('billingProformas').where('publicToken', '==', token).limit(1).get();
    if (snap.empty) throw new ApiError(404, 'proforma-not-found', 'Proforma introuvable.');
    const doc = snap.docs[0]; const data = doc.data();
    if (data.status === 'DRAFT' || data.status === 'CANCELLED') throw new ApiError(404, 'proforma-not-found', 'Proforma introuvable.');
    return doc;
  }

  const getPublicProforma = endpoint(async (req, res) => {
    const doc = await publicProformaByToken(text(req.query.t, 100)); const data = doc.data();
    const profile = await db.collection('billingProfiles').doc(data.ownerUid).get();
    if (data.status === 'SENT') await doc.ref.set({ status: 'VIEWED', viewedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    res.json({ ok: true, proforma: { id: doc.id, number: data.number, status: data.status === 'SENT' ? 'VIEWED' : data.status, issueDate: data.issueDate,
      expiryDate: data.expiryDate, items: data.items, subtotalMinor: data.subtotalMinor, discountMinor: data.discountMinor, taxMinor: data.taxMinor,
      feeMinor: data.feeMinor, totalMinor: data.totalMinor, currency: data.currency, notes: data.notes, terms: data.terms,
      client: { name: data.clientSnapshot?.name || '', company: data.clientSnapshot?.company || '' },
      provider: { businessName: profile.data()?.businessName || 'Prestataire SmartCut', contactName: profile.data()?.contactName || '', logoUrl: profile.data()?.logoUrl || '' } } });
  });

  const startPayment = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req);
    const proforma = await publicProformaByToken(text(req.body?.token, 100)); const data = proforma.data();
    if (data.buyerUid && data.buyerUid !== current.uid) throw new ApiError(403, 'wrong-buyer', 'Cette proforma appartient à un autre compte client.');
    if (data.status === 'PAID') throw new ApiError(409, 'already-paid', 'Cette proforma est deja payee.');
    if (data.expiryDate < new Date().toISOString().slice(0, 10)) throw new ApiError(409, 'expired', 'Cette proforma est expiree.');
    const key = text(req.headers['idempotency-key'] || req.body?.idempotencyKey, 120) || randomToken();
    const keyHash = crypto.createHash('sha256').update(`${proforma.id}:${key}`).digest('hex');
    const intentRef = db.collection('billingPaymentIntents').doc(keyHash); const existing = await intentRef.get();
    if (existing.exists && existing.data().checkoutUrl) return res.json({ ok: true, paymentIntentId: intentRef.id, checkoutUrl: existing.data().checkoutUrl, reused: true });
    await intentRef.set({ ownerUid: data.ownerUid, buyerUid: current.uid, proformaId: proforma.id, expectedAmountMinor: data.totalMinor, currency: 'HTG', status: 'CREATING', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    const redirect = await internals.createMoncashRedirect(intentRef.id, data.totalMinor / 100);
    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(proforma.ref); if (fresh.data().status === 'PAID') throw new ApiError(409, 'already-paid', 'Cette proforma est deja payee.');
      tx.set(intentRef, { checkoutUrl: redirect.checkoutUrl, status: 'REDIRECT_READY', updatedAt: serverTimestamp() }, { merge: true });
      tx.set(proforma.ref, { status: 'PENDING_PAYMENT', activePaymentIntentId: intentRef.id, updatedAt: serverTimestamp() }, { merge: true });
    });
    res.json({ ok: true, paymentIntentId: intentRef.id, checkoutUrl: redirect.checkoutUrl });
  }, { moncash: true });

  async function confirmPayment(intentId, transactionId) {
    const intentRef = db.collection('billingPaymentIntents').doc(intentId); const intentSnap = await intentRef.get();
    if (!intentSnap.exists) throw new ApiError(404, 'payment-not-found', 'Paiement introuvable.');
    if (intentSnap.data().status === 'PAID') return { alreadyProcessed: true, invoiceId: intentSnap.data().invoiceId };
    const verification = await internals.retrieveMoncashPayment({ orderId: intentId, transactionId });
    if (!verification.ok) throw new ApiError(409, 'payment-not-confirmed', "Le paiement n'est pas encore confirme par MonCash.");
    if (verification.orderId !== intentId) throw new ApiError(409, 'wrong-order', 'Reference MonCash incorrecte.');
    const verifiedMinor = toMinor(String(verification.amount));
    if (verifiedMinor !== intentSnap.data().expectedAmountMinor) throw new ApiError(409, 'amount-mismatch', 'Le montant confirme ne correspond pas a la proforma.');
    const txId = text(verification.transactionId || transactionId, 160); if (!txId) throw new ApiError(409, 'transaction-missing', 'Transaction MonCash introuvable.');
    // A cryptographic digest avoids both invalid Firestore characters and
    // collisions caused by replacing provider punctuation with underscores.
    const transactionLockId = crypto.createHash('sha256').update(txId).digest('hex');
    const transactionRef = db.collection('billingMoncashTransactions').doc(transactionLockId);
    const proformaRef = db.collection('billingProformas').doc(intentSnap.data().proformaId);
    const paymentRef = db.collection('billingPayments').doc(intentId); const invoiceRef = db.collection('billingInvoices').doc(intentId);
    const ledgerRef = db.collection('billingLedgerEntries').doc(`${intentId}_PAYMENT_RECEIVED`);
    const balanceRef = db.collection('billingBalances').doc(intentSnap.data().ownerUid);
    await db.runTransaction(async (tx) => {
      const [freshIntent, usedTxn, proforma, ledger, balance] = await Promise.all([tx.get(intentRef), tx.get(transactionRef), tx.get(proformaRef), tx.get(ledgerRef), tx.get(balanceRef)]);
      if (freshIntent.data().status === 'PAID' || ledger.exists) return;
      if (usedTxn.exists) throw new ApiError(409, 'transaction-used', 'Cette transaction MonCash a deja ete utilisee.');
      if (!proforma.exists || proforma.data().totalMinor !== verifiedMinor) throw new ApiError(409, 'amount-mismatch', 'Montant de proforma incorrect.');
      const invoiceNumber = await nextNumber(tx, intentSnap.data().ownerUid, 'invoice', 'INV');
      const current = balance.exists ? balance.data() : { availableMinor: 0, reservedMinor: 0, paidOutMinor: 0, currency: 'HTG' };
      const marketplace = proforma.data().marketplace || null;
      const commissionMinor = marketplace ? Number(marketplace.commissionSnapshot?.commissionMinor || 0) : 0;
      const providerCreditMinor = verifiedMinor - commissionMinor;
      if (!Number.isSafeInteger(providerCreditMinor) || providerCreditMinor < 0) throw new ApiError(409, 'commission-invalid', 'Commission invalide.');
      tx.create ? tx.create(transactionRef, { intentId, createdAt: serverTimestamp() }) : tx.set(transactionRef, { intentId, createdAt: serverTimestamp() });
      tx.set(ledgerRef, { ownerUid: intentSnap.data().ownerUid, type: 'PAYMENT_RECEIVED', amountMinor: verifiedMinor, grossMinor: verifiedMinor, commissionMinor, currency: 'HTG', direction: 'CREDIT', source: 'MONCASH', referenceId: intentId, transactionId: txId, createdAt: serverTimestamp() });
      if (commissionMinor) tx.set(db.collection('billingLedgerEntries').doc(`${intentId}_PLATFORM_COMMISSION`), { ownerUid: intentSnap.data().ownerUid, type: 'PLATFORM_COMMISSION', amountMinor: commissionMinor, currency: 'HTG', direction: 'DEBIT', source: 'SMARTCUT', referenceId: intentId, createdAt: serverTimestamp() });
      tx.set(balanceRef, { ...current, availableMinor: Number(current.availableMinor || 0) + providerCreditMinor, currency: 'HTG', updatedAt: serverTimestamp() }, { merge: true });
      tx.set(paymentRef, { ownerUid: intentSnap.data().ownerUid, buyerUid: intentSnap.data().buyerUid || null, proformaId: proformaRef.id, amountMinor: verifiedMinor, commissionMinor, netMinor: providerCreditMinor, currency: 'HTG', provider: 'MONCASH', providerTransactionId: txId, status: 'CONFIRMED', paidAt: serverTimestamp(), createdAt: serverTimestamp() });
      tx.set(invoiceRef, { ownerUid: intentSnap.data().ownerUid, proformaId: proformaRef.id, paymentId: paymentRef.id, number: invoiceNumber, verificationCode: randomToken(), amountMinor: verifiedMinor, currency: 'HTG', status: 'PAID', provider: 'MONCASH', providerTransactionId: txId, createdAt: serverTimestamp() });
      tx.set(proformaRef, { status: 'PAID', invoiceId: invoiceRef.id, paidAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      tx.set(intentRef, { status: 'PAID', providerTransactionId: txId, invoiceId: invoiceRef.id, paidAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      if (marketplace) {
        const orderRef = db.collection('serviceOrders').doc(intentId);
        tx.set(orderRef, { ownerUid: marketplace.providerUid, providerUid: marketplace.providerUid, buyerUid: marketplace.buyerUid,
          serviceId: marketplace.serviceId, requestId: marketplace.requestId, proposalId: marketplace.proposalId, proformaId: proformaRef.id,
          invoiceId: invoiceRef.id, paymentId: paymentRef.id, serviceSnapshot: marketplace.serviceSnapshot || {}, providerSnapshot: marketplace.providerSnapshot || {},
          grossMinor: marketplace.grossMinor, paidMinor: verifiedMinor, commissionMinor, netMinor: providerCreditMinor, currency: 'HTG', paymentStatus: 'PAID',
          status: 'PAID', revisionsIncluded: Number(marketplace.serviceSnapshot?.revisionsIncluded || 0), revisionsUsed: 0,
          dueAt: new Date(Date.now() + Number(marketplace.serviceSnapshot?.deliveryDays || 1) * 86400000), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
        tx.set(db.collection('marketplaceNotifications').doc(`${intentId}_order_paid`), { recipientUid: marketplace.providerUid, type: 'ORDER_PAID', title: 'Commande payée', message: marketplace.serviceSnapshot?.name || 'Nouvelle commande', referenceId: intentId, read: false, createdAt: serverTimestamp() });
      }
      tx.set(db.collection('billingNotifications').doc(`${intentId}_paid`), {
        ownerUid: intentSnap.data().ownerUid, type: 'PAYMENT_CONFIRMED', title: 'Paiement recu',
        message: `Votre paiement MonCash de ${(verifiedMinor / 100).toFixed(2)} HTG est confirme.`,
        referenceId: intentId, createdAt: serverTimestamp()
      });
      await audit(tx, { actorUid: 'moncash', ownerUid: intentSnap.data().ownerUid, action: 'PAYMENT_CONFIRMED', targetId: intentId, transactionId: txId });
    });
    return { invoiceId: invoiceRef.id };
  }

  const verifyPayment = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req);
    const token = text(req.body?.token, 100); const proforma = await publicProformaByToken(token);
    if (proforma.data().buyerUid && proforma.data().buyerUid !== current.uid) throw new ApiError(403, 'wrong-buyer', 'Cette proforma appartient à un autre compte client.');
    const intentId = text(req.body?.paymentIntentId || proforma.data().activePaymentIntentId, 180);
    if (!intentId) throw new ApiError(400, 'payment-intent-required', 'Reference de paiement requise.');
    const intent = await db.collection('billingPaymentIntents').doc(intentId).get();
    if (!intent.exists || intent.data().proformaId !== proforma.id) throw new ApiError(404, 'payment-not-found', 'Paiement introuvable.');
    res.json({ ok: true, ...(await confirmPayment(intentId, text(req.body?.transactionId, 180))) });
  }, { moncash: true });

  const paymentCallback = endpoint(async (req, res) => {
    const intentId = text(req.query?.orderId || req.query?.paymentIntentId || req.body?.orderId || req.body?.paymentIntentId, 180);
    if (!intentId) throw new ApiError(400, 'payment-intent-required', 'Reference de paiement requise.');
    const result = await confirmPayment(intentId, text(req.query?.transactionId || req.body?.transactionId, 180));
    res.json({ ok: true, ...result });
  }, { moncash: true });

  const requestWithdrawal = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
    const current = await user(req); const amountMinor = toMinor(req.body?.amount); const moncashNumber = phone(req.body?.moncashNumber);
    if (amountMinor < MIN_WITHDRAWAL_MINOR) throw new ApiError(400, 'below-minimum', 'Le retrait minimum est de 500 HTG.');
    if (moncashNumber.replace(/\D/g, '').length < 8) throw new ApiError(400, 'invalid-moncash-number', 'Numero MonCash invalide.');
    const key = text(req.headers['idempotency-key'] || req.body?.idempotencyKey, 120); if (!key) throw new ApiError(400, 'idempotency-key-required', "Cle d'idempotence requise.");
    const id = crypto.createHash('sha256').update(`${current.uid}:${key}`).digest('hex'); const ref = db.collection('billingWithdrawals').doc(id);
    const balanceRef = db.collection('billingBalances').doc(current.uid); const ledgerRef = db.collection('billingLedgerEntries').doc(`${id}_WITHDRAWAL_RESERVED`);
    const profile = await db.collection('billingProfiles').doc(current.uid).get();
    await db.runTransaction(async (tx) => {
      const [existing, balance] = await Promise.all([tx.get(ref), tx.get(balanceRef)]); if (existing.exists) return;
      const currentBalance = balance.exists ? balance.data() : { availableMinor: 0, reservedMinor: 0, paidOutMinor: 0, currency: 'HTG' };
      let reservedBalance;
      try { reservedBalance = reserveBalance(currentBalance, amountMinor); }
      catch { throw new ApiError(409, 'insufficient-balance', 'Solde disponible insuffisant.'); }
      const number = await nextNumber(tx, current.uid, 'withdrawal', 'WD');
      tx.set(ref, { ownerUid: current.uid, number, amountMinor, currency: 'HTG', status: 'PENDING', moncashNumberSnapshot: moncashNumber,
        ownerNameSnapshot: profile.data()?.contactName || profile.data()?.businessName || current.email || current.uid, ownerEmailSnapshot: current.email || profile.data()?.email || '',
        idempotencyKeyHash: id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), statusHistory: [{ status: 'PENDING', actorUid: current.uid, at: new Date().toISOString() }] });
      tx.set(ledgerRef, { ownerUid: current.uid, type: 'WITHDRAWAL_RESERVED', amountMinor, currency: 'HTG', direction: 'HOLD', source: 'WITHDRAWAL', referenceId: id, createdAt: serverTimestamp() });
      tx.set(balanceRef, { ...reservedBalance, currency: 'HTG', updatedAt: serverTimestamp() }, { merge: true });
      tx.set(db.collection('billingNotifications').doc(`${id}_requested`), {
        ownerUid: current.uid, type: 'WITHDRAWAL_PENDING', title: 'Retrait en attente',
        message: `Votre demande de ${(amountMinor / 100).toFixed(2)} HTG est reservee et attend le traitement manuel.`,
        referenceId: id, createdAt: serverTimestamp()
      });
      await audit(tx, { actorUid: current.uid, ownerUid: current.uid, action: 'WITHDRAWAL_CREATED', targetId: id });
    });
    res.json({ ok: true, id });
  });

  const adminList = endpoint(async (req, res) => {
    await adminUser(req); const status = text(req.query.status, 30); let query = db.collection('billingWithdrawals');
    if (status) query = query.where('status', '==', status); const snap = await query.limit(MAX_PAGE).get();
    const [payments, ledger] = await Promise.all([db.collection('billingPayments').limit(MAX_PAGE).get(), db.collection('billingLedgerEntries').limit(MAX_PAGE).get()]);
    res.json({ ok: true, withdrawals: snap.docs.map(serialize), payments: payments.docs.map(serialize), ledger: ledger.docs.map(serialize) });
  });

  const adminWithdrawalAction = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new ApiError(405, 'method-not-allowed', 'POST requis.');
    const actor = await adminUser(req); const id = text(req.body?.id, 180); const action = text(req.body?.action, 30).toUpperCase();
    const next = ({ PROCESS: 'PROCESSING', COMPLETE: 'COMPLETED', REJECT: 'REJECTED' })[action];
    if (!next) throw new ApiError(400, 'invalid-action', 'Action invalide.');
    const reference = text(req.body?.providerReference, 180); const reason = text(req.body?.reason, 1000); const notes = text(req.body?.notes, 2000);
    if (next === 'COMPLETED' && !reference) throw new ApiError(400, 'reference-required', 'Reference MonCash requise.');
    if (next === 'REJECTED' && !reason) throw new ApiError(400, 'reason-required', 'Raison du refus requise.');
    const ref = db.collection('billingWithdrawals').doc(id); const completedLedger = db.collection('billingLedgerEntries').doc(`${id}_WITHDRAWAL_COMPLETED`);
    const releasedLedger = db.collection('billingLedgerEntries').doc(`${id}_WITHDRAWAL_RELEASED`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref); if (!snap.exists) throw new ApiError(404, 'withdrawal-not-found', 'Retrait introuvable.');
      const withdrawal = snap.data(); if (!canTransitionWithdrawal(withdrawal.status, next)) throw new ApiError(409, 'invalid-transition', 'Cette transition est interdite ou deja executee.');
      const balanceRef = db.collection('billingBalances').doc(withdrawal.ownerUid); const balanceSnap = await tx.get(balanceRef); const balance = balanceSnap.data() || {};
      let nextBalance;
      if (next === 'COMPLETED') {
        const existing = await tx.get(completedLedger); if (existing.exists) throw new ApiError(409, 'already-completed', 'Retrait deja confirme.');
        tx.set(completedLedger, { ownerUid: withdrawal.ownerUid, type: 'WITHDRAWAL_COMPLETED', amountMinor: withdrawal.amountMinor, currency: 'HTG', direction: 'DEBIT', source: 'MANUAL_MONCASH', referenceId: id, providerReference: reference, actorUid: actor.uid, createdAt: serverTimestamp() });
        try { nextBalance = completeReservedBalance(balance, withdrawal.amountMinor); } catch { throw new ApiError(409, 'reserved-balance-inconsistent', 'Solde reserve incoherent.'); }
        tx.set(balanceRef, { ...nextBalance, updatedAt: serverTimestamp() }, { merge: true });
      } else if (next === 'REJECTED') {
        const existing = await tx.get(releasedLedger); if (existing.exists) throw new ApiError(409, 'already-released', 'Fonds deja liberes.');
        tx.set(releasedLedger, { ownerUid: withdrawal.ownerUid, type: 'WITHDRAWAL_RELEASED', amountMinor: withdrawal.amountMinor, currency: 'HTG', direction: 'RELEASE', source: 'WITHDRAWAL', referenceId: id, actorUid: actor.uid, reason, createdAt: serverTimestamp() });
        try { nextBalance = releaseReservedBalance(balance, withdrawal.amountMinor); } catch { throw new ApiError(409, 'reserved-balance-inconsistent', 'Solde reserve incoherent.'); }
        tx.set(balanceRef, { ...nextBalance, updatedAt: serverTimestamp() }, { merge: true });
      }
      const history = [...(withdrawal.statusHistory || []), { status: next, actorUid: actor.uid, at: new Date().toISOString(), reason: reason || null }];
      tx.set(ref, { status: next, providerReference: reference || withdrawal.providerReference || null, rejectionReason: reason || null, internalNotes: notes || null,
        processedBy: actor.uid, processedAt: next === 'PROCESSING' ? serverTimestamp() : withdrawal.processedAt || null,
        confirmedAt: next === 'COMPLETED' ? serverTimestamp() : null, updatedAt: serverTimestamp(), statusHistory: history }, { merge: true });
      tx.set(db.collection('billingNotifications').doc(`${id}_${next}`), {
        ownerUid: withdrawal.ownerUid, type: `WITHDRAWAL_${next}`,
        title: next === 'COMPLETED' ? 'Retrait effectue' : next === 'REJECTED' ? 'Retrait refuse' : 'Retrait en traitement',
        message: next === 'COMPLETED'
          ? `Votre retrait de ${(withdrawal.amountMinor / 100).toFixed(2)} HTG a ete effectue manuellement.`
          : next === 'REJECTED' ? `Votre retrait a ete refuse: ${reason}` : 'Votre demande de retrait est en cours de traitement.',
        referenceId: id, createdAt: serverTimestamp()
      });
      await audit(tx, { actorUid: actor.uid, ownerUid: withdrawal.ownerUid, action: `WITHDRAWAL_${next}`, targetId: id, reason: reason || null, providerReference: reference || null });
    });
    res.json({ ok: true, id, status: next });
  });

  const verifyDocument = endpoint(async (req, res) => {
    const code = text(req.query.code, 100); const snap = await db.collection('billingInvoices').where('verificationCode', '==', code).limit(1).get();
    if (snap.empty) throw new ApiError(404, 'document-not-found', 'Document introuvable.'); const inv = snap.docs[0].data();
    const profile = await db.collection('billingProfiles').doc(inv.ownerUid).get();
    res.json({ ok: true, document: { number: inv.number, amountMinor: inv.amountMinor, currency: inv.currency, status: inv.status,
      date: inv.createdAt || null, provider: profile.data()?.businessName || 'Prestataire SmartCut' } });
  });

  return { bootstrap, saveProfile, saveClient, saveService, saveProforma, getPublicProforma, startPayment, verifyPayment, paymentCallback,
    requestWithdrawal, adminList, adminWithdrawalAction, verifyDocument };
}

module.exports = buildInvoicing;
