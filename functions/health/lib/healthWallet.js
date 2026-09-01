'use strict';

/**
 * The patient wallet — credited automatically when a doctor refuses an already-paid
 * consultation (clinical.js) or a pharmacy/lab/imaging order is cancelled after
 * payment (index.js). Distinct from the professional `balances` collection: this is
 * money owed back to the PATIENT, never mixed with a professional's own ledger. The
 * only writer of healthPatientWallets / healthPatientWalletTransactions.
 */
const { notifyUser } = require('./healthNotify');

async function creditPatientWallet(db, patientUid, amount, reason, context = {}) {
  const rounded = Math.round((Number(amount) || 0) * 100) / 100;
  if (!patientUid || rounded <= 0) return;
  const walletRef = db.collection('healthPatientWallets').doc(patientUid);
  const txRef = db.collection('healthPatientWalletTransactions').doc();
  const nowIso = new Date().toISOString();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(walletRef);
    const current = snap.exists ? snap.data() : { balance: 0, currency: 'HTG' };
    tx.set(walletRef, {
      balance: Math.round((Number(current.balance || 0) + rounded) * 100) / 100,
      currency: 'HTG',
      updatedAt: nowIso
    }, { merge: true });
    tx.set(txRef, { patientUid, type: 'credit', amount: rounded, reason, context, createdAt: nowIso });
  });
  await notifyUser(db, patientUid, 'refund_credited', {
    title: 'Remboursement crédité',
    body: `${rounded.toLocaleString('fr-FR')} HTG ont été crédités dans votre portefeuille Smart Cut Health.`,
    url: './health-espace.html',
    context
  });
}

module.exports = { creditPatientWallet };
