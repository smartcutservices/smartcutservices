'use strict';

const crypto = require('node:crypto');
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { logger } = require('firebase-functions');

const MIN_TOPUP_MINOR = 100000; // 1 000 HTG
const MAX_TOPUP_MINOR = 7500000; // 75 000 HTG
const DEFAULT_WALLET_CAP_MINOR = 60000000; // 600 000 HTG
const MAX_PAGE = 100;

class WalletError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

function buildWallet(internals) {
  const { db, admin, REGION: region } = internals;
  const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

  const cors = (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.status(204).send(''); return true; }
    return false;
  };

  const endpoint = (handler, options = {}) => onRequest({ region, ...(options.moncash ? { secrets: [internals.MONCASH_CLIENT_ID, internals.MONCASH_CLIENT_SECRET, internals.MONCASH_SECRET_API_KEY, internals.MONCASH_BUSINESS_KEY] } : {}) }, async (req, res) => {
    if (cors(req, res)) return;
    try { await handler(req, res); }
    catch (error) {
      if (error instanceof WalletError) return res.status(error.status).json({ ok: false, error: error.code, message: error.message });
      logger.error('wallet endpoint failed', { message: error?.message || String(error), stack: error?.stack });
      return res.status(500).json({ ok: false, error: 'internal-error', message: 'Une erreur est survenue. Veuillez reessayer.' });
    }
  });

  const text = (value, max = 180) => String(value || '').trim().slice(0, max);
  const asMinor = (value) => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) throw new WalletError(400, 'invalid-amount', 'Montant invalide.');
    return amount;
  };
  const serialize = (snap) => ({ id: snap.id, ...snap.data() });
  const requireUser = async (req) => {
    const decoded = await internals.verifyBearerUser(req);
    if (!decoded?.uid) throw new WalletError(401, 'auth-required', 'Authentification requise.');
    return decoded;
  };

  const requireAdmin = async (req) => {
    const current = await requireUser(req);
    if (!(await internals.isAdminUser(current.uid))) throw new WalletError(403, 'admin-required', 'Accès administrateur requis.');
    return current;
  };

  async function readLimits() {
    const snap = await db.collection('walletLimits').doc('main').get();
    const data = snap.exists ? snap.data() : {};
    return {
      minTopUpMinor: Number(data.minTopUpMinor || MIN_TOPUP_MINOR),
      maxTopUpMinor: Number(data.maxTopUpMinor || MAX_TOPUP_MINOR),
      walletCapMinor: Number(data.walletCapMinor || DEFAULT_WALLET_CAP_MINOR),
      currency: 'HTG'
    };
  }

  async function getOrCreateWallet(uid, tx = null) {
    const ref = db.collection('wallets').doc(uid);
    const snap = tx ? await tx.get(ref) : await ref.get();
    if (snap.exists) return { ref, data: snap.data() || {} };
    const data = { userId: uid, currency: 'HTG', availableMinor: 0, reservedMinor: 0, status: 'ACTIVE', createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    if (tx) tx.create(ref, data); else await ref.create(data);
    return { ref, data };
  }

  const getWallet = endpoint(async (req, res) => {
    const current = await requireUser(req);
    const wallet = await getOrCreateWallet(current.uid);
    const [ledger, notifications, limits] = await Promise.all([
      db.collection('walletLedger').where('walletId', '==', wallet.ref.id).limit(MAX_PAGE).get(),
      db.collection('walletNotifications').where('userId', '==', current.uid).limit(20).get(),
      readLimits()
    ]);
    const availableMinor = Number(wallet.data.availableMinor || 0);
    const reservedMinor = Number(wallet.data.reservedMinor || 0);
    res.json({ ok: true, wallet: { id: wallet.ref.id, ...wallet.data }, limits, canCloseAccount: availableMinor === 0 && reservedMinor === 0, ledger: ledger.docs.map(serialize), notifications: notifications.docs.map(serialize) });
  });

  const startWalletTopUp = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new WalletError(405, 'method-not-allowed', 'POST requis.');
    const current = await requireUser(req);
    const provider = text(req.body?.provider || 'moncash', 20).toLowerCase();
    if (provider !== 'moncash') throw new WalletError(503, 'provider-unavailable', 'NatCash sera disponible dès son activation.');
    const amountMinor = asMinor(req.body?.amountMinor);
    const limits = await readLimits();
    if (amountMinor < limits.minTopUpMinor) throw new WalletError(400, 'below-minimum', `La recharge minimum est de ${limits.minTopUpMinor / 100} HTG.`);
    if (amountMinor > limits.maxTopUpMinor) throw new WalletError(400, 'above-maximum', `La recharge maximum est de ${limits.maxTopUpMinor / 100} HTG.`);
    const key = text(req.headers['idempotency-key'] || req.body?.idempotencyKey, 160) || crypto.randomBytes(18).toString('hex');
    const intentId = crypto.createHash('sha256').update(`${current.uid}:${key}`).digest('hex');
    const intentRef = db.collection('walletTransactions').doc(intentId);
    const existing = await intentRef.get();
    if (existing.exists && existing.data()?.checkoutUrl) return res.json({ ok: true, reused: true, transaction: { id: intentId, ...existing.data() } });
    const wallet = await getOrCreateWallet(current.uid);
    const currentBalance = Number(wallet.data.availableMinor || 0) + Number(wallet.data.reservedMinor || 0);
    if (currentBalance + amountMinor > limits.walletCapMinor) throw new WalletError(400, 'wallet-cap-exceeded', `Cette recharge dépasserait le plafond de ${limits.walletCapMinor / 100} HTG.`);
    await intentRef.set({ userId: current.uid, walletId: wallet.ref.id, provider: 'MONCASH', grossAmountMinor: amountMinor, providerFeeMinor: Math.round(amountMinor * 0.02), walletCreditMinor: amountMinor, status: 'PENDING', idempotencyKeyHash: intentId, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    const redirect = await internals.createMoncashRedirect(intentId, amountMinor / 100);
    await intentRef.set({ checkoutUrl: redirect.checkoutUrl, paymentToken: redirect.paymentToken || null, status: 'PROCESSING', updatedAt: serverTimestamp() }, { merge: true });
    res.json({ ok: true, transaction: { id: intentId, amountMinor, walletCreditMinor: amountMinor, provider: 'MONCASH', checkoutUrl: redirect.checkoutUrl, status: 'PROCESSING' } });
  }, { moncash: true });

  const paymentCallback = endpoint(async (req, res) => {
    const intentId = text(req.query?.orderId || req.body?.orderId || req.query?.transactionId, 180);
    const transactionId = text(req.query?.transactionId || req.body?.transactionId, 180);
    if (!intentId || !transactionId) throw new WalletError(400, 'payment-reference-required', 'Référence de paiement manquante.');
    const intentRef = db.collection('walletTransactions').doc(intentId);
    const intentSnap = await intentRef.get();
    if (!intentSnap.exists) throw new WalletError(404, 'wallet-transaction-not-found', 'Recharge introuvable.');
    const intent = intentSnap.data();
    if (intent.status === 'COMPLETED') return res.json({ ok: true, alreadyProcessed: true });
    const verification = await internals.retrieveMoncashPayment({ orderId: intentId, transactionId });
    if (!verification.ok) throw new WalletError(409, 'payment-not-confirmed', 'Le paiement n’est pas encore confirmé.');
    const verifiedMinor = Math.round(Number(verification.amount) * 100);
    if (verifiedMinor !== Number(intent.grossAmountMinor)) throw new WalletError(409, 'amount-mismatch', 'Le montant confirmé est invalide.');
    const providerTx = crypto.createHash('sha256').update(transactionId).digest('hex');
    const providerRef = db.collection('walletProviderTransactions').doc(providerTx);
    const walletRef = db.collection('wallets').doc(intent.walletId);
    const ledgerRef = db.collection('walletLedger').doc(`${intentId}_CASH_IN`);
    const limits = await readLimits();
    await db.runTransaction(async (tx) => {
      const [fresh, used, walletSnap, ledger] = await Promise.all([tx.get(intentRef), tx.get(providerRef), tx.get(walletRef), tx.get(ledgerRef)]);
      if (fresh.data()?.status === 'COMPLETED' || ledger.exists) return;
      if (used.exists) throw new WalletError(409, 'provider-transaction-used', 'Cette transaction a déjà été utilisée.');
      const wallet = walletSnap.exists ? walletSnap.data() : { availableMinor: 0, reservedMinor: 0, status: 'ACTIVE' };
      if (wallet.status !== 'ACTIVE') throw new WalletError(423, 'wallet-blocked', 'Ce Wallet est temporairement suspendu.');
      if (Number(wallet.availableMinor || 0) + Number(wallet.reservedMinor || 0) + Number(intent.walletCreditMinor) > limits.walletCapMinor) throw new WalletError(409, 'wallet-cap-exceeded', 'Le plafond du Wallet est dépassé.');
      tx.create(providerRef, { transactionId: intentId, createdAt: serverTimestamp() });
      tx.create(ledgerRef, { walletId: intent.walletId, userId: intent.userId, type: 'CASH_IN', direction: 'CREDIT', amountMinor: intent.walletCreditMinor, currency: 'HTG', referenceId: intentId, provider: 'MONCASH', providerTransactionId: transactionId, status: 'COMPLETED', createdAt: serverTimestamp() });
      tx.set(walletRef, { availableMinor: Number(wallet.availableMinor || 0) + Number(intent.walletCreditMinor), updatedAt: serverTimestamp() }, { merge: true });
      tx.set(intentRef, { status: 'COMPLETED', providerTransactionId: transactionId, completedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    });
    res.json({ ok: true, status: 'COMPLETED', walletCreditMinor: intent.walletCreditMinor });
  }, { moncash: true });

  const refundToWallet = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new WalletError(405, 'method-not-allowed', 'POST requis.');
    const actor = await requireAdmin(req);
    const userId = text(req.body?.userId, 180);
    if (!userId) throw new WalletError(400, 'user-required', 'Utilisateur cible requis.');
    const amountMinor = asMinor(req.body?.amountMinor);
    const referenceId = text(req.body?.referenceId, 180);
    if (!referenceId) throw new WalletError(400, 'reference-required', 'Référence de commande requise.');
    const wallet = await getOrCreateWallet(userId);
    const ledgerRef = db.collection('walletLedger').doc(`${referenceId}_REFUND`);
    await db.runTransaction(async (tx) => {
      const [ledger, walletSnap] = await Promise.all([tx.get(ledgerRef), tx.get(wallet.ref)]);
      if (ledger.exists) return;
      const data = walletSnap.data() || {};
      tx.create(ledgerRef, { walletId: wallet.ref.id, userId, type: 'REFUND', direction: 'CREDIT', amountMinor, currency: 'HTG', referenceId, status: 'COMPLETED', actorUid: actor.uid, createdAt: serverTimestamp() });
      tx.set(wallet.ref, { availableMinor: Number(data.availableMinor || 0) + amountMinor, updatedAt: serverTimestamp() }, { merge: true });
    });
    res.json({ ok: true, amountMinor, referenceId });
  });

  const createWalletHold = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new WalletError(405, 'method-not-allowed', 'POST requis.');
    const current = await requireUser(req);
    const amountMinor = asMinor(req.body?.amountMinor);
    const referenceId = text(req.body?.referenceId, 180);
    if (!referenceId) throw new WalletError(400, 'reference-required', 'Référence de commande requise.');
    const holdId = crypto.createHash('sha256').update(`${current.uid}:${referenceId}`).digest('hex');
    const holdRef = db.collection('walletHolds').doc(holdId);
    const walletRef = db.collection('wallets').doc(current.uid);
    await db.runTransaction(async (tx) => {
      const [hold, walletSnap] = await Promise.all([tx.get(holdRef), tx.get(walletRef)]);
      if (hold.exists) return;
      const wallet = walletSnap.exists ? walletSnap.data() : null;
      if (!wallet || wallet.status !== 'ACTIVE') throw new WalletError(423, 'wallet-unavailable', 'Wallet indisponible.');
      const available = Number(wallet.availableMinor || 0);
      if (available < amountMinor) throw new WalletError(409, 'insufficient-wallet-balance', 'Solde Wallet insuffisant.');
      tx.create(holdRef, { holdId, walletId: current.uid, userId: current.uid, referenceId, amountMinor, status: 'HELD', expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(walletRef, { availableMinor: available - amountMinor, reservedMinor: Number(wallet.reservedMinor || 0) + amountMinor, updatedAt: serverTimestamp() }, { merge: true });
      tx.create(db.collection('walletLedger').doc(`${holdId}_HOLD`), { walletId: current.uid, userId: current.uid, type: 'HOLD', direction: 'HOLD', amountMinor, referenceId, status: 'COMPLETED', createdAt: serverTimestamp() });
    });
    res.json({ ok: true, holdId, status: 'HELD' });
  });

  const finalizeWalletHold = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new WalletError(405, 'method-not-allowed', 'POST requis.');
    const current = await requireUser(req);
    const holdId = text(req.body?.holdId, 180);
    const action = text(req.body?.action, 20).toUpperCase();
    if (!holdId || !['CAPTURE', 'RELEASE'].includes(action)) throw new WalletError(400, 'invalid-hold-action', 'Action de réservation invalide.');
    const holdRef = db.collection('walletHolds').doc(holdId);
    const walletRef = db.collection('wallets').doc(current.uid);
    await db.runTransaction(async (tx) => {
      const [holdSnap, walletSnap] = await Promise.all([tx.get(holdRef), tx.get(walletRef)]);
      if (!holdSnap.exists || holdSnap.data().userId !== current.uid) throw new WalletError(404, 'hold-not-found', 'Réservation introuvable.');
      const hold = holdSnap.data();
      if (hold.status !== 'HELD') return;
      const wallet = walletSnap.data() || {};
      const reserved = Number(wallet.reservedMinor || 0);
      if (reserved < Number(hold.amountMinor)) throw new WalletError(409, 'reserved-balance-inconsistent', 'Solde réservé incohérent.');
      const next = action === 'CAPTURE' ? { availableMinor: Number(wallet.availableMinor || 0), reservedMinor: reserved - Number(hold.amountMinor) } : { availableMinor: Number(wallet.availableMinor || 0) + Number(hold.amountMinor), reservedMinor: reserved - Number(hold.amountMinor) };
      tx.set(walletRef, { ...next, updatedAt: serverTimestamp() }, { merge: true });
      tx.set(holdRef, { status: action === 'CAPTURE' ? 'CAPTURED' : 'RELEASED', finalizedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      tx.create(db.collection('walletLedger').doc(`${holdId}_${action}`), { walletId: current.uid, userId: current.uid, type: action === 'CAPTURE' ? 'PURCHASE' : 'HOLD_RELEASE', direction: action === 'CAPTURE' ? 'DEBIT' : 'RELEASE', amountMinor: hold.amountMinor, referenceId: hold.referenceId, status: 'COMPLETED', createdAt: serverTimestamp() });
    });
    res.json({ ok: true, holdId, action });
  });

  const payServiceProformaWithWallet = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new WalletError(405, 'method-not-allowed', 'POST requis.');
    const current = await requireUser(req);
    const proformaId = text(req.body?.proformaId, 180);
    if (!proformaId) throw new WalletError(400, 'proforma-required', 'Proforma requise.');
    const proformaRef = db.collection('billingProformas').doc(proformaId);
    const paymentRef = db.collection('billingPayments').doc(`WALLET_${proformaId}`);
    const invoiceRef = db.collection('billingInvoices').doc(`WALLET_${proformaId}`);
    const ledgerRef = db.collection('walletLedger').doc(`${proformaId}_SERVICE_PAYMENT`);
    const walletRef = db.collection('wallets').doc(current.uid);
    await db.runTransaction(async (tx) => {
      const [proformaSnap, walletSnap, ledgerSnap] = await Promise.all([tx.get(proformaRef), tx.get(walletRef), tx.get(ledgerRef)]);
      if (!proformaSnap.exists) throw new WalletError(404, 'proforma-not-found', 'Proforma introuvable.');
      const proforma = proformaSnap.data() || {};
      if (proforma.buyerUid !== current.uid) throw new WalletError(403, 'wrong-buyer', 'Cette proforma ne vous appartient pas.');
      if (proforma.status === 'PAID' || ledgerSnap.exists) return;
      const totalMinor = Number(proforma.totalMinor || 0);
      if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) throw new WalletError(409, 'invalid-proforma-total', 'Montant de service invalide.');
      const wallet = walletSnap.exists ? walletSnap.data() : {};
      if (wallet.status !== 'ACTIVE') throw new WalletError(423, 'wallet-blocked', 'Ce Wallet est temporairement suspendu.');
      if (Number(wallet.availableMinor || 0) < totalMinor) throw new WalletError(409, 'insufficient-wallet-balance', 'Solde Wallet insuffisant.');
      const marketplace = proforma.marketplace || {};
      if (!marketplace.providerUid) throw new WalletError(409, 'not-marketplace-service', 'Cette proforma ne correspond pas à un service marketplace.');
      const serviceOrderRef = db.collection('serviceOrders').doc(proformaId);
      const providerBalanceRef = db.collection('billingBalances').doc(marketplace.providerUid);
      const providerLedgerRef = db.collection('billingLedgerEntries').doc(`${proformaId}_WALLET_ESCROW_HELD`);
      const paymentId = paymentRef.id;
      const commissionMinor = Number(marketplace.commissionSnapshot?.commissionMinor || 0);
      const providerNetMinor = Math.max(0, totalMinor - commissionMinor);
      const providerBalanceSnap = await tx.get(providerBalanceRef);
      const providerBalance = providerBalanceSnap.exists ? providerBalanceSnap.data() : { availableMinor: 0, reservedMinor: 0, paidOutMinor: 0, currency: 'HTG' };
      tx.set(walletRef, { availableMinor: Number(wallet.availableMinor || 0) - totalMinor, updatedAt: serverTimestamp() }, { merge: true });
      tx.create(ledgerRef, { walletId: current.uid, userId: current.uid, type: 'SERVICE', direction: 'DEBIT', amountMinor: totalMinor, currency: 'HTG', referenceId: proformaId, status: 'COMPLETED', createdAt: serverTimestamp() });
      tx.create(providerLedgerRef, { ownerUid: marketplace.providerUid, type: 'ESCROW_HELD', amountMinor: providerNetMinor, currency: 'HTG', direction: 'CREDIT', source: 'SMART_WALLET', referenceId: proformaId, createdAt: serverTimestamp() });
      tx.set(providerBalanceRef, { ...providerBalance, reservedMinor: Number(providerBalance.reservedMinor || 0) + providerNetMinor, currency: 'HTG', updatedAt: serverTimestamp() }, { merge: true });
      tx.set(paymentRef, { ownerUid: marketplace.providerUid, buyerUid: current.uid, proformaId, amountMinor: totalMinor, netMinor: providerNetMinor, commissionMinor, currency: 'HTG', provider: 'SMART_WALLET', status: 'CONFIRMED', paidAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: true });
      tx.set(invoiceRef, { ownerUid: marketplace.providerUid, buyerUid: current.uid, proformaId, paymentId, number: `WALLET-${proformaId.slice(0, 12)}`, amountMinor: totalMinor, currency: 'HTG', status: 'PAID', provider: 'SMART_WALLET', createdAt: serverTimestamp() }, { merge: true });
      tx.set(proformaRef, { status: 'PAID', paymentMethod: 'SMART_WALLET', paymentId, invoiceId: invoiceRef.id, paidAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      tx.set(serviceOrderRef, { ownerUid: marketplace.providerUid, providerUid: marketplace.providerUid, buyerUid: current.uid, serviceId: marketplace.serviceId, requestId: marketplace.requestId, proposalId: marketplace.proposalId, proformaId, invoiceId: invoiceRef.id, paymentId, paymentMethod: 'wallet', serviceSnapshot: marketplace.serviceSnapshot || {}, providerSnapshot: marketplace.providerSnapshot || {}, grossMinor: Number(marketplace.grossMinor || totalMinor), paidMinor: totalMinor, commissionMinor, netMinor: providerNetMinor, currency: 'HTG', paymentStatus: 'PAID', status: 'PAID', escrowStatus: 'HELD', fundsHeldMinor: providerNetMinor, revisionsIncluded: Number(marketplace.serviceSnapshot?.revisionsIncluded || 0), revisionsUsed: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    });
    res.json({ ok: true, proformaId, paymentMethod: 'SMART_WALLET' });
  });

  const adminWalletSettings = endpoint(async (req, res) => {
    const actor = await requireAdmin(req);
    if (req.method === 'GET') return res.json({ ok: true, limits: await readLimits() });
    if (req.method !== 'POST') throw new WalletError(405, 'method-not-allowed', 'GET ou POST requis.');
    const current = await readLimits();
    const minTopUpMinor = req.body?.minTopUpMinor === undefined ? current.minTopUpMinor : asMinor(req.body.minTopUpMinor);
    const maxTopUpMinor = req.body?.maxTopUpMinor === undefined ? current.maxTopUpMinor : asMinor(req.body.maxTopUpMinor);
    const walletCapMinor = req.body?.walletCapMinor === undefined ? current.walletCapMinor : asMinor(req.body.walletCapMinor);
    if (minTopUpMinor > maxTopUpMinor || maxTopUpMinor > walletCapMinor) throw new WalletError(400, 'invalid-wallet-limits', 'Les limites du Wallet sont incohérentes.');
    await db.collection('walletLimits').doc('main').set({ minTopUpMinor, maxTopUpMinor, walletCapMinor, updatedAt: serverTimestamp(), updatedBy: actor.uid }, { merge: true });
    await db.collection('walletAdminActions').add({ action: 'LIMITS_UPDATED', actorUid: actor.uid, previous: current, next: { minTopUpMinor, maxTopUpMinor, walletCapMinor }, createdAt: serverTimestamp() });
    res.json({ ok: true, limits: { minTopUpMinor, maxTopUpMinor, walletCapMinor, currency: 'HTG' } });
  });

  const adminWalletAction = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new WalletError(405, 'method-not-allowed', 'POST requis.');
    const actor = await requireAdmin(req);
    const userId = text(req.body?.userId, 180);
    const action = text(req.body?.action, 30).toUpperCase();
    if (!userId || !['BLOCK', 'UNBLOCK'].includes(action)) throw new WalletError(400, 'invalid-wallet-action', 'Action Wallet invalide.');
    const walletRef = db.collection('wallets').doc(userId);
    await walletRef.set({ status: action === 'BLOCK' ? 'BLOCKED' : 'ACTIVE', updatedAt: serverTimestamp() }, { merge: true });
    await db.collection('walletAdminActions').add({ action: `WALLET_${action}`, actorUid: actor.uid, targetUserId: userId, reason: text(req.body?.reason, 500), createdAt: serverTimestamp() });
    res.json({ ok: true, userId, status: action === 'BLOCK' ? 'BLOCKED' : 'ACTIVE' });
  });

  const adminWalletReconcile = endpoint(async (req, res) => {
    const actor = await requireAdmin(req);
    const walletSnap = await db.collection('wallets').limit(500).get();
    const discrepancies = [];
    for (const walletDoc of walletSnap.docs) {
      const wallet = walletDoc.data() || {};
      const [ledgerSnap, holdSnap] = await Promise.all([
        db.collection('walletLedger').where('walletId', '==', walletDoc.id).limit(1000).get(),
        db.collection('walletHolds').where('walletId', '==', walletDoc.id).limit(500).get()
      ]);
      let expectedAvailable = 0;
      ledgerSnap.docs.forEach((entry) => {
        const data = entry.data() || {};
        if (data.direction === 'CREDIT') expectedAvailable += Number(data.amountMinor || 0);
        if (data.direction === 'DEBIT') expectedAvailable -= Number(data.amountMinor || 0);
      });
      const expectedReserved = holdSnap.docs.reduce((sum, hold) => hold.data()?.status === 'HELD' ? sum + Number(hold.data()?.amountMinor || 0) : sum, 0);
      const actualAvailable = Number(wallet.availableMinor || 0);
      const actualReserved = Number(wallet.reservedMinor || 0);
      if (expectedAvailable !== actualAvailable || expectedReserved !== actualReserved) discrepancies.push({ walletId: walletDoc.id, userId: wallet.userId || walletDoc.id, ledgerAvailableMinor: expectedAvailable, walletAvailableMinor: actualAvailable, ledgerReservedMinor: expectedReserved, walletReservedMinor: actualReserved, differenceAvailableMinor: actualAvailable - expectedAvailable, differenceReservedMinor: actualReserved - expectedReserved });
    }
    const report = { actorUid: actor.uid, walletsChecked: walletSnap.size, discrepancyCount: discrepancies.length, discrepancies, createdAt: serverTimestamp() };
    await db.collection('walletReconciliationReports').add(report);
    res.json({ ok: true, ...report });
  });

  const requestAccountClosure = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new WalletError(405, 'method-not-allowed', 'POST requis.');
    const current = await requireUser(req);
    const wallet = await getOrCreateWallet(current.uid);
    const availableMinor = Number(wallet.data.availableMinor || 0);
    const reservedMinor = Number(wallet.data.reservedMinor || 0);
    const ref = db.collection('accountClosureRequests').doc(current.uid);
    const status = availableMinor > 0 || reservedMinor > 0 ? 'REFUND_REQUIRED' : 'REQUESTED';
    await ref.set({ userId: current.uid, status, walletBalanceMinor: availableMinor + reservedMinor, reason: text(req.body?.reason, 500), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    res.json({ ok: true, status, message: status === 'REFUND_REQUIRED' ? 'Votre demande est enregistrée. Smart Cut doit d’abord rembourser votre solde avant la fermeture.' : 'Votre demande de fermeture est enregistrée.' });
  });

  const adminConfirmAccountClosureRefund = endpoint(async (req, res) => {
    if (req.method !== 'POST') throw new WalletError(405, 'method-not-allowed', 'POST requis.');
    const actor = await requireAdmin(req);
    const userId = text(req.body?.userId, 180);
    const providerReference = text(req.body?.providerReference, 180);
    if (!userId || !providerReference) throw new WalletError(400, 'closure-refund-data-required', 'Utilisateur et référence de remboursement requis.');
    const walletRef = db.collection('wallets').doc(userId);
    const ledgerRef = db.collection('walletLedger').doc(`${userId}_ACCOUNT_CLOSURE_REFUND`);
    const requestRef = db.collection('accountClosureRequests').doc(userId);
    await db.runTransaction(async (tx) => {
      const [walletSnap, ledgerSnap] = await Promise.all([tx.get(walletRef), tx.get(ledgerRef)]);
      if (ledgerSnap.exists) return;
      const wallet = walletSnap.exists ? walletSnap.data() : {};
      const amountMinor = Number(wallet.availableMinor || 0) + Number(wallet.reservedMinor || 0);
      if (amountMinor <= 0) throw new WalletError(409, 'wallet-already-empty', 'Ce Wallet ne contient aucun solde à rembourser.');
      if (Number(wallet.reservedMinor || 0) > 0) throw new WalletError(409, 'wallet-holds-active', 'Les réservations actives doivent être résolues avant fermeture.');
      tx.create(ledgerRef, { walletId: userId, userId, type: 'ACCOUNT_CLOSURE_REFUND', direction: 'DEBIT', amountMinor, currency: 'HTG', providerReference, actorUid: actor.uid, status: 'COMPLETED', createdAt: serverTimestamp() });
      tx.set(walletRef, { availableMinor: 0, reservedMinor: 0, status: 'CLOSED', closedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
      tx.set(requestRef, { status: 'REFUNDED_AND_CLOSED', refundAmountMinor: amountMinor, providerReference, resolvedBy: actor.uid, resolvedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
    });
    res.json({ ok: true, userId, status: 'REFUNDED_AND_CLOSED' });
  });

  const releaseExpiredWalletHolds = onSchedule({ region, schedule: 'every 15 minutes', timeZone: 'America/Port-au-Prince' }, async () => {
    const snap = await db.collection('walletHolds').where('status', '==', 'HELD').limit(200).get();
    const now = Date.now();
    for (const holdDoc of snap.docs) {
      const hold = holdDoc.data() || {};
      if (!hold.expiresAt || new Date(hold.expiresAt).getTime() > now) continue;
      const walletRef = db.collection('wallets').doc(hold.walletId);
      const ledgerRef = db.collection('walletLedger').doc(`${holdDoc.id}_EXPIRED_RELEASE`);
      await db.runTransaction(async (tx) => {
        const [freshHold, walletSnap, ledgerSnap] = await Promise.all([tx.get(holdDoc.ref), tx.get(walletRef), tx.get(ledgerRef)]);
        if (!freshHold.exists || freshHold.data()?.status !== 'HELD' || ledgerSnap.exists) return;
        const wallet = walletSnap.data() || {};
        const amountMinor = Number(freshHold.data()?.amountMinor || 0);
        tx.set(walletRef, { availableMinor: Number(wallet.availableMinor || 0) + amountMinor, reservedMinor: Math.max(0, Number(wallet.reservedMinor || 0) - amountMinor), updatedAt: serverTimestamp() }, { merge: true });
        tx.set(freshHold.ref, { status: 'RELEASED_EXPIRED', finalizedAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
        tx.create(ledgerRef, { walletId: hold.walletId, userId: hold.userId, type: 'HOLD_RELEASE', direction: 'RELEASE', amountMinor, currency: 'HTG', referenceId: hold.referenceId, status: 'COMPLETED', source: 'HOLD_EXPIRY', createdAt: serverTimestamp() });
      });
    }
  });

  const walletOrderRefund = onDocumentUpdated({ region, document: 'clients/{clientId}/orders/{orderId}' }, async (event) => {
    const before = event.data?.before?.data?.() || {};
    const after = event.data?.after?.data?.() || {};
    const previousStatus = String(before.status || '').toLowerCase();
    const nextStatus = String(after.status || '').toLowerCase();
    const refundStatuses = new Set(['cancelled', 'canceled', 'refused', 'rejected']);
    const wasPaid = String(after.paymentStatus || '').toLowerCase() === 'paid' || String(before.paymentStatus || '').toLowerCase() === 'paid' || after.paymentMethod === 'wallet';
    if (!refundStatuses.has(nextStatus) || refundStatuses.has(previousStatus) || !wasPaid) return;
    const userId = String(after.clientUid || after.clientId || event.params?.clientId || '').trim();
    if (!userId) return;
    const amountMinor = Math.round(Number(after.amount || 0) * 100);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return;
    const orderId = String(event.params?.orderId || '').trim();
    const walletRef = db.collection('wallets').doc(userId);
    const ledgerRef = db.collection('walletLedger').doc(`${orderId}_REFUND`);
    await db.runTransaction(async (tx) => {
      const [walletSnap, ledgerSnap] = await Promise.all([tx.get(walletRef), tx.get(ledgerRef)]);
      if (ledgerSnap.exists) return;
      const wallet = walletSnap.exists ? walletSnap.data() : { userId, currency: 'HTG', availableMinor: 0, reservedMinor: 0, status: 'ACTIVE' };
      tx.set(walletRef, { userId, currency: 'HTG', availableMinor: Number(wallet.availableMinor || 0) + amountMinor, updatedAt: serverTimestamp() }, { merge: true });
      tx.create(ledgerRef, { walletId: userId, userId, type: 'REFUND', direction: 'CREDIT', amountMinor, currency: 'HTG', referenceId: orderId, orderId, status: 'COMPLETED', source: 'ORDER_AUTO_REFUND', createdAt: serverTimestamp() });
      tx.set(db.collection('walletNotifications').doc(`${orderId}_REFUND`), { userId, type: 'WALLET_REFUND', title: 'Remboursement crédité', message: `Votre commande a été remboursée de ${(amountMinor / 100).toLocaleString('fr-FR')} HTG dans votre Smart Wallet.`, referenceId: orderId, createdAt: serverTimestamp() });
    });
  });

  const walletServiceRefund = onDocumentUpdated({ region, document: 'serviceOrders/{orderId}' }, async (event) => {
    const before = event.data?.before?.data?.() || {};
    const after = event.data?.after?.data?.() || {};
    const previousStatus = String(before.status || '').toLowerCase();
    const nextStatus = String(after.status || '').toLowerCase();
    if (!['cancelled', 'canceled', 'refunded'].includes(nextStatus) || ['cancelled', 'canceled', 'refunded'].includes(previousStatus) || after.paymentMethod !== 'wallet') return;
    const userId = String(after.buyerUid || '').trim();
    const amountMinor = Number(after.paidMinor || after.grossMinor || 0);
    const orderId = String(event.params?.orderId || '').trim();
    if (!userId || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !orderId) return;
    const walletRef = db.collection('wallets').doc(userId);
    const ledgerRef = db.collection('walletLedger').doc(`${orderId}_SERVICE_REFUND`);
    const providerUid = String(after.providerUid || after.ownerUid || '').trim();
    const providerBalanceRef = providerUid ? db.collection('billingBalances').doc(providerUid) : null;
    const providerLedgerRef = providerUid ? db.collection('billingLedgerEntries').doc(`${orderId}_WALLET_REFUND`) : null;
    await db.runTransaction(async (tx) => {
      const reads = [tx.get(walletRef), tx.get(ledgerRef)];
      if (providerBalanceRef) reads.push(tx.get(providerBalanceRef));
      const [walletSnap, ledgerSnap, providerBalanceSnap] = await Promise.all(reads);
      if (ledgerSnap.exists) return;
      const wallet = walletSnap.exists ? walletSnap.data() : { userId, availableMinor: 0, reservedMinor: 0, status: 'ACTIVE' };
      tx.set(walletRef, { userId, availableMinor: Number(wallet.availableMinor || 0) + amountMinor, updatedAt: serverTimestamp() }, { merge: true });
      tx.create(ledgerRef, { walletId: userId, userId, type: 'REFUND', direction: 'CREDIT', amountMinor, currency: 'HTG', referenceId: orderId, status: 'COMPLETED', source: 'SERVICE_AUTO_REFUND', createdAt: serverTimestamp() });
      if (providerBalanceRef && providerLedgerRef && providerBalanceSnap?.exists) {
        const providerBalance = providerBalanceSnap.data() || {};
        const providerDebit = Math.min(Number(providerBalance.reservedMinor || 0), Number(after.netMinor || amountMinor));
        tx.create(providerLedgerRef, { ownerUid: providerUid, type: 'ESCROW_REFUND', amountMinor: providerDebit, currency: 'HTG', direction: 'DEBIT', source: 'SMART_WALLET_REFUND', referenceId: orderId, createdAt: serverTimestamp() });
        tx.set(providerBalanceRef, { reservedMinor: Math.max(0, Number(providerBalance.reservedMinor || 0) - providerDebit), updatedAt: serverTimestamp() }, { merge: true });
      }
    });
  });

  return { getWallet, startWalletTopUp, paymentCallback, refundToWallet, createWalletHold, finalizeWalletHold, payServiceProformaWithWallet, adminWalletSettings, adminWalletAction, adminWalletReconcile, requestAccountClosure, adminConfirmAccountClosureRefund, releaseExpiredWalletHolds, walletOrderRefund, walletServiceRefund };
}

module.exports = buildWallet;
