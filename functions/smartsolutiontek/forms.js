'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { requireBearerUser, requireOrgRole, withErrorHandling, HttpError } = require('./auth');
const { registerResourceResolver } = require('./payments');
const { sanitizeFields, validateAnswerForField, DEFAULT_COUNTRIES } = require('./lib/fieldTypes');
const { sanitizeBranding } = require('./lib/branding');

/** Converts a thrown {code, message} from lib/fieldTypes.js into the framework's HttpError. */
function toHttpError(error, fallbackStatus = 400) {
  if (error instanceof HttpError) return error;
  return new HttpError(fallbackStatus, error?.code || 'validation-error', error?.message || 'Requete invalide.');
}

function registerFormFunctions({ db, sstInternals, region }) {
  /**
   * Creates or updates a form schema (draft by default). formSchemaId omitted = create.
   * POST { organizationId, formSchemaId?, title, description, logoUrl?, colors?, fields,
   *        pricingType, price?, maxParticipants?, opensAt?, closesAt? }
   */
  const saveFormSchema = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const title = String(req.body?.title || '').trim();
    if (!title) throw new HttpError(400, 'title-required', 'Titre requis.');

    const pricingType = String(req.body?.pricingType || 'free').trim();
    if (!['free', 'fixed'].includes(pricingType)) {
      throw new HttpError(400, 'invalid-pricing-type', 'pricingType doit etre free ou fixed.');
    }
    const price = pricingType === 'fixed' ? Number(req.body?.price) : 0;
    if (pricingType === 'fixed' && (!Number.isFinite(price) || price <= 0)) {
      throw new HttpError(400, 'invalid-price', 'Prix invalide pour un formulaire payant.');
    }

    const rawMaxParticipants = req.body?.maxParticipants;
    let maxParticipants = null;
    if (rawMaxParticipants !== undefined && rawMaxParticipants !== null && String(rawMaxParticipants).trim() !== '') {
      const parsedMaxParticipants = Number(rawMaxParticipants);
      if (!Number.isInteger(parsedMaxParticipants) || parsedMaxParticipants < 1) {
        throw new HttpError(400, 'invalid-capacity', 'Le nombre de places doit etre un entier superieur a zero.');
      }
      maxParticipants = parsedMaxParticipants;
    }

    let fields;
    try {
      fields = sanitizeFields(req.body?.fields);
    } catch (error) {
      throw toHttpError(error);
    }
    const branding = sanitizeBranding(req.body);

    const formSchemaId = String(req.body?.formSchemaId || '').trim();
    const formRef = formSchemaId ? db.collection('formSchemas').doc(formSchemaId) : db.collection('formSchemas').doc();

    if (formSchemaId) {
      const existing = await formRef.get();
      if (existing.exists && existing.data().organizationId !== organizationId) {
        throw new HttpError(403, 'not-owner', 'Ce formulaire appartient a une autre organisation.');
      }
    }

    await formRef.set({
      organizationId,
      title,
      description: String(req.body?.description || '').trim(),
      fields,
      ...branding,
      pricingType,
      price,
      maxParticipants,
      opensAt: req.body?.opensAt || null,
      closesAt: req.body?.closesAt || null,
      ...(formSchemaId ? {} : { status: 'draft', createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }),
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(200).json({ ok: true, formSchemaId: formRef.id });
  }));

  /** POST { organizationId, formSchemaId, status } */
  const setFormStatus = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const status = String(req.body?.status || '').trim();
    if (!['draft', 'published', 'suspended', 'archived'].includes(status)) {
      throw new HttpError(400, 'invalid-status', 'Statut invalide.');
    }
    const formSchemaId = String(req.body?.formSchemaId || '').trim();
    const formRef = db.collection('formSchemas').doc(formSchemaId);
    const formSnap = await formRef.get();
    if (!formSnap.exists || formSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'form-not-found', 'Formulaire introuvable.');
    }

    await formRef.set({ status, updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.status(200).json({ ok: true });
  }));

  /**
   * POST { organizationId, formSchemaId }
   * Hard-deletes unused forms. Forms with submissions are archived instead so
   * participant records and any connected payment history remain traceable.
   */
  const deleteFormSchema = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const formSchemaId = String(req.body?.formSchemaId || '').trim();
    if (!formSchemaId) throw new HttpError(400, 'form-id-required', 'Identifiant du formulaire requis.');

    const formRef = db.collection('formSchemas').doc(formSchemaId);
    const formSnap = await formRef.get();
    if (!formSnap.exists || formSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'form-not-found', 'Formulaire introuvable.');
    }

    const submissionsSnap = await db.collection('submissions')
      .where('formSchemaId', '==', formSchemaId)
      .limit(1)
      .get();

    if (submissionsSnap.empty) {
      await formRef.delete();
      res.status(200).json({ ok: true, deleted: true, archived: false });
      return;
    }

    await formRef.set({
      status: 'archived',
      archivedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    res.status(200).json({ ok: true, deleted: false, archived: true });
  }));

  /** GET ?formSchemaId=... — public, only returns published forms, no PII. */
  const getPublicForm = onRequest({ region }, withErrorHandling(async (req, res) => {
    const formSchemaId = String(req.query?.formSchemaId || '').trim();
    const formSnap = await db.collection('formSchemas').doc(formSchemaId).get();
    if (!formSnap.exists || formSnap.data().status !== 'published') {
      throw new HttpError(404, 'form-not-found', 'Formulaire introuvable ou non publie.');
    }
    const form = formSnap.data();

    const now = Date.now();
    const opensAtMs = form.opensAt ? new Date(form.opensAt).getTime() : null;
    const closesAtMs = form.closesAt ? new Date(form.closesAt).getTime() : null;
    const isOpen = (!opensAtMs || opensAtMs <= now) && (!closesAtMs || closesAtMs >= now);

    let spotsLeft = null;
    if (Number.isInteger(form.maxParticipants) && form.maxParticipants > 0) {
      const confirmedSnap = await db.collection('submissions')
        .where('formSchemaId', '==', formSchemaId)
        .where('status', '==', 'confirmed')
        .get();
      spotsLeft = Math.max(0, form.maxParticipants - confirmedSnap.size);
    }

    const countryOptions = DEFAULT_COUNTRIES.map((c) => c.name);
    const fields = (form.fields || []).map((field) => (
      field.type === 'country' ? { ...field, options: countryOptions } : field
    ));

    res.status(200).json({
      ok: true,
      form: {
        id: formSnap.id,
        organizationId: form.organizationId,
        title: form.title,
        description: form.description,
        logoUrl: form.logoUrl,
        coverImageUrl: form.coverImageUrl || null,
        heroTitle: form.heroTitle || null,
        heroSubtitle: form.heroSubtitle || null,
        infoChips: form.infoChips || [],
        colors: form.colors,
        layout: form.layout || 'minimal',
        confirmation: form.confirmation || { title: null, message: null },
        fields,
        pricingType: form.pricingType,
        price: form.price,
        isOpen,
        spotsLeft
      }
    });
  }));

  /**
   * Public submission. Validates required fields server-side. If the form is free,
   * confirms immediately. If paid, creates the submission as pending_payment and
   * returns a paymentIntentId the client must then send to /createPaymentIntent
   * (resourceType: "submission") to get a MonCash checkout URL — kept as two calls
   * (submit, then pay) rather than one, so a participant can retry payment on a
   * submission that already exists instead of creating a duplicate registration.
   * POST { formSchemaId, answers, participantEmail, participantName }
   */
  const submitForm = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');

    const formSchemaId = String(req.body?.formSchemaId || '').trim();
    const formSnap = await db.collection('formSchemas').doc(formSchemaId).get();
    if (!formSnap.exists || formSnap.data().status !== 'published') {
      throw new HttpError(404, 'form-not-found', 'Formulaire introuvable ou non publie.');
    }
    const form = formSnap.data();

    const now = Date.now();
    if (form.opensAt && new Date(form.opensAt).getTime() > now) throw new HttpError(400, 'not-open-yet', "Les inscriptions ne sont pas encore ouvertes.");
    if (form.closesAt && new Date(form.closesAt).getTime() < now) throw new HttpError(400, 'closed', 'Les inscriptions sont fermees.');

    if (Number.isInteger(form.maxParticipants) && form.maxParticipants > 0) {
      const confirmedSnap = await db.collection('submissions')
        .where('formSchemaId', '==', formSchemaId)
        .where('status', '==', 'confirmed')
        .get();
      if (confirmedSnap.size >= form.maxParticipants) {
        throw new HttpError(409, 'full', 'Ce formulaire a atteint son nombre maximal de participants.');
      }
    }

    const rawAnswers = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
    const answers = {};
    try {
      for (const field of form.fields) {
        const value = validateAnswerForField(field, rawAnswers[field.id], { formSchemaId });
        if (value !== undefined) answers[field.id] = value;
      }
    } catch (error) {
      throw toHttpError(error);
    }

    // Derived from the schema's own fields (never a bolted-on extra input) —
    // fixes a duplicate-"Email"-field bug the previous hardcoded input caused.
    const emailField = form.fields.find((f) => f.type === 'email');
    const participantEmail = emailField && answers[emailField.id]
      ? answers[emailField.id]
      : String(req.body?.participantEmail || '').trim().toLowerCase();
    if (!participantEmail) throw new HttpError(400, 'email-required', 'Email requis.');

    const fullNameField = form.fields.find((f) => f.semantic === 'fullName');
    const firstNameField = form.fields.find((f) => f.semantic === 'firstName');
    const lastNameField = form.fields.find((f) => f.semantic === 'lastName');
    let participantName = fullNameField ? String(answers[fullNameField.id] || '') : '';
    if (!participantName && (firstNameField || lastNameField)) {
      participantName = [
        firstNameField ? answers[firstNameField.id] : '',
        lastNameField ? answers[lastNameField.id] : ''
      ].filter(Boolean).join(' ').trim();
    }
    if (!participantName) participantName = String(req.body?.participantName || '').trim();

    const submissionRef = db.collection('submissions').doc();
    const isFree = form.pricingType !== 'fixed' || !(Number(form.price) > 0);

    await submissionRef.set({
      formSchemaId,
      organizationId: form.organizationId,
      answers,
      participantEmail,
      participantName,
      amountDue: isFree ? 0 : Number(form.price),
      paymentIntentId: null,
      status: isFree ? 'confirmed' : 'pending_payment',
      createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    });

    res.status(200).json({
      ok: true,
      submissionId: submissionRef.id,
      status: isFree ? 'confirmed' : 'pending_payment',
      requiresPayment: !isFree
    });
  }));

  /** Creator dashboard: list submissions for a form, with basic filtering. */
  const listSubmissions = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.query?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);

    const formSchemaId = String(req.query?.formSchemaId || '').trim();
    let query = db.collection('submissions').where('organizationId', '==', organizationId);
    if (formSchemaId) query = query.where('formSchemaId', '==', formSchemaId);
    const snap = await query.get();

    const submissions = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    res.status(200).json({ ok: true, submissions });
  }));

  // Wire this application into the shared payment-intent flow.
  registerResourceResolver('submission', {
    applicationId: 'forms',
    collection: (firestore) => firestore.collection('submissions'),
    computeAmount: (submission) => Number(submission.amountDue || 0),
    onConfirmed: async (firestore, intent) => {
      await firestore.doc(intent.resourceRef).set({
        status: 'confirmed',
        updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  });

  return { saveFormSchema, setFormStatus, deleteFormSchema, getPublicForm, submitForm, listSubmissions };
}

module.exports = { registerFormFunctions };
