'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { getBearerUserOrNull, withErrorHandling, HttpError } = require('./auth');
const { applyPaymentToLedger } = require('./lib/ledger');
const { resolveActiveRuleFromFirestore } = require('./commissions');
const { validatePaymentResource } = require('./lib/paymentDomain');

/**
 * Generic payment-intent flow shared by all 5 SmartSolutionTek applications.
 * Mirrors, step for step, the pattern already used by functions/index.js
 * `createMoncashPayment` / `moncashAlert` (see ARCHITECTURE_SMARTSOLUTIONTEK.md §3) —
 * reuses `createMoncashRedirect` and `retrieveMoncashPayment` from the existing file
 * via module.exports.__sstInternals rather than duplicating MonCash integration code.
 *
 * Per-application "resource resolvers" are registered by each application module
 * (forms.js, and — when built — shops.js/courses.js/services.js/food.js) so this
 * file has zero knowledge of any specific application's business fields, only of
 * the shared payment shape (organizationId, applicationId, amount, a resourceRef).
 */

const resourceResolvers = new Map(); // resourceType -> { computeAmount(resource), onConfirmed(db, resource, ref) }

function registerResourceResolver(resourceType, resolver) {
  resourceResolvers.set(resourceType, resolver);
}

function registerPaymentFunctions({ db, sstInternals, region }) {
  /**
   * POST { resourceType, resourceId, organizationId, applicationId, customerEmail, customerName }
   * The resource must already exist (created by the calling application) with a
   * status the resolver considers payable. Amount is always recomputed from the
   * resource document, never trusted from the request body.
   */
  const createPaymentIntent = onRequest(
    { region, secrets: [sstInternals.MONCASH_CLIENT_ID, sstInternals.MONCASH_CLIENT_SECRET, sstInternals.MONCASH_SECRET_API_KEY, sstInternals.MONCASH_BUSINESS_KEY] },
    withErrorHandling(async (req, res) => {
      if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');

      const resourceType = String(req.body?.resourceType || '').trim();
      const resourceId = String(req.body?.resourceId || '').trim();
      const organizationId = String(req.body?.organizationId || '').trim();
      const applicationId = String(req.body?.applicationId || '').trim();
      const customerEmail = String(req.body?.customerEmail || '').trim();
      const customerName = String(req.body?.customerName || '').trim();

      const resolver = resourceResolvers.get(resourceType);
      if (!resolver) throw new HttpError(400, 'unknown-resource-type', `Type de ressource inconnu: ${resourceType}`);
      if (!resourceId || !organizationId) throw new HttpError(400, 'missing-fields', 'resourceId et organizationId requis.');
      if (!customerEmail) throw new HttpError(400, 'customer-email-required', 'Email du client requis.');

      const resourceRef = resolver.collection(db).doc(resourceId);
      const resourceSnap = await resourceRef.get();
      if (!resourceSnap.exists) throw new HttpError(404, 'resource-not-found', 'Ressource introuvable.');
      const resource = resourceSnap.data();

      let validation;
      try {
        validation = validatePaymentResource(resource, { organizationId, applicationId }, resolver);
      } catch (error) {
        throw new HttpError(error.status || 400, error.code || 'invalid-payment-resource', error.message);
      }
      const decodedUser = await getBearerUserOrNull(req, sstInternals);
      if (resolver.validateResource) {
        await resolver.validateResource(resource, { resourceId, organizationId, applicationId, decodedUser });
      }

      if (resource.paymentIntentId) {
        const existingIntentSnap = await db.collection('paymentIntents').doc(resource.paymentIntentId).get();
        if (existingIntentSnap.exists) {
          const existingIntent = existingIntentSnap.data();
          if (existingIntent.resourceRef === resourceRef.path && ['initiated', 'redirect_ready', 'paid'].includes(existingIntent.status)) {
            res.status(200).json({
              ok: true,
              paymentIntentId: existingIntentSnap.id,
              checkoutUrl: existingIntent.providerCheckoutUrl || null,
              status: existingIntent.status,
              reused: true
            });
            return;
          }
        }
      }

      const grossAmount = validation.amount;

      const rule = await resolveActiveRuleFromFirestore(db, { organizationId, applicationId });

      const intentRef = db.collection('paymentIntents').doc();
      await intentRef.set({
        organizationId,
        applicationId,
        resourceType,
        resourceRef: resourceRef.path,
        grossAmount,
        currency: 'HTG',
        status: 'initiated',
        provider: 'moncash',
        providerCheckoutUrl: null,
        providerTransactionId: null,
        customerUid: decodedUser?.uid || null,
        customerEmail,
        customerName,
        commissionRuleId: rule?.id || null,
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      });

      const redirect = await sstInternals.createMoncashRedirect(intentRef.id, grossAmount);

      await intentRef.set({
        status: 'redirect_ready',
        providerCheckoutUrl: redirect.checkoutUrl,
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      await resourceRef.set({ status: 'pending_payment', paymentIntentId: intentRef.id }, { merge: true });

      res.status(200).json({ ok: true, paymentIntentId: intentRef.id, checkoutUrl: redirect.checkoutUrl });
    })
  );

  /**
   * GET/POST callback from MonCash. Never trusts the callback's own status —
   * always re-verifies against the MonCash API before marking anything paid,
   * exactly like the existing `moncashAlert` (functions/index.js:5983).
   */
  const paymentWebhook = onRequest(
    { region, secrets: [sstInternals.MONCASH_CLIENT_ID, sstInternals.MONCASH_CLIENT_SECRET, sstInternals.MONCASH_SECRET_API_KEY, sstInternals.MONCASH_BUSINESS_KEY] },
    withErrorHandling(async (req, res) => {
      const paymentIntentId = String(req.query?.paymentIntentId || req.body?.paymentIntentId || '').trim();
      const transactionId = String(req.query?.transactionId || req.body?.transactionId || '').trim();
      if (!paymentIntentId) throw new HttpError(400, 'payment-intent-id-required', 'paymentIntentId requis.');

      const intentRef = db.collection('paymentIntents').doc(paymentIntentId);
      const intentSnap = await intentRef.get();
      if (!intentSnap.exists) throw new HttpError(404, 'payment-intent-not-found', 'Payment intent introuvable.');
      const intent = intentSnap.data();

      if (intent.status === 'paid') {
        res.status(200).json({ ok: true, status: 'paid', alreadyProcessed: true });
        return;
      }

      const verification = await sstInternals.retrieveMoncashPayment({ orderId: paymentIntentId, transactionId });
      if (!verification.ok) {
        res.status(200).json({ ok: true, status: 'not-yet-paid' });
        return;
      }

      const ledgerResult = await applyPaymentToLedger(db, {
        paymentIntentId,
        organizationId: intent.organizationId,
        applicationId: intent.applicationId,
        grossAmount: intent.grossAmount,
        rule: intent.commissionRuleId
          ? (await db.collection('commissionRules').doc(intent.commissionRuleId).get()).data()
          : null
      });

      // Even if the ledger write was already applied, complete the intent and
      // resource transition. This heals a retry after a crash between those steps.
      await intentRef.set({
        status: 'paid',
        providerTransactionId: verification.transactionId,
        paidAt: intent.paidAt || sstInternals.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      const resolver = resourceResolvers.get(intent.resourceType);
      if (resolver?.onConfirmed) {
        await resolver.onConfirmed(db, intent, sstInternals);
      }

      res.status(200).json({ ok: true, status: 'paid', alreadyProcessed: !ledgerResult.applied });
    })
  );

  return { createPaymentIntent, paymentWebhook };
}

module.exports = { registerPaymentFunctions, registerResourceResolver };
