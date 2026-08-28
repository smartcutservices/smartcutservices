'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { requireBearerUser, requireOrgRole, withErrorHandling, HttpError } = require('./auth');
const { registerResourceResolver } = require('./payments');
const { sanitizeColors, LAYOUTS } = require('./lib/branding');

function sanitizeOptionalString(value, maxLen) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str ? str.slice(0, maxLen) : null;
}

/**
 * Application 4 — Services et reservations. Same shared pattern as forms.js /
 * shops.js / courses.js.
 *
 * Scoping note (documented honestly, not silently glossed over): a booking is
 * matched to its original customer only by email, since this application has no
 * customer account/magic-link system. Rescheduling and cancellation are therefore
 * implemented as staff-only actions (creator_owner/creator_manager/creator_staff)
 * in this session, not customer self-service — a customer-facing reschedule link
 * would need a signed token, which is a reasonable follow-up but is not fabricated
 * here.
 */

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function registerServiceFunctions({ db, sstInternals, region }) {
  /** POST { organizationId, serviceId?, title, description, priceType, price, depositAmount?, durationMinutes } */
  const saveService = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const title = String(req.body?.title || '').trim();
    if (!title) throw new HttpError(400, 'title-required', 'Titre requis.');
    const priceType = String(req.body?.priceType || 'fixed').trim();
    if (!['fixed', 'deposit'].includes(priceType)) throw new HttpError(400, 'invalid-price-type', 'priceType doit etre fixed ou deposit.');
    const price = Number(req.body?.price);
    if (!Number.isFinite(price) || price <= 0) throw new HttpError(400, 'invalid-price', 'Prix invalide.');
    const depositAmount = priceType === 'deposit' ? Number(req.body?.depositAmount) : null;
    if (priceType === 'deposit' && (!Number.isFinite(depositAmount) || depositAmount <= 0 || depositAmount >= price)) {
      throw new HttpError(400, 'invalid-deposit', "L'acompte doit etre un montant positif inferieur au prix total.");
    }
    const durationMinutes = Number(req.body?.durationMinutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) throw new HttpError(400, 'invalid-duration', 'Duree invalide.');

    const serviceId = String(req.body?.serviceId || '').trim();
    const serviceRef = serviceId ? db.collection('services').doc(serviceId) : db.collection('services').doc();
    if (serviceId) {
      const existing = await serviceRef.get();
      if (existing.exists && existing.data().organizationId !== organizationId) {
        throw new HttpError(403, 'not-owner', 'Ce service appartient a une autre organisation.');
      }
    }

    await serviceRef.set({
      organizationId, title,
      description: String(req.body?.description || '').trim(),
      priceType, price, depositAmount, durationMinutes,
      photoUrl: req.body?.photoUrl || null,
      heroTitle: sanitizeOptionalString(req.body?.heroTitle, 140),
      heroSubtitle: sanitizeOptionalString(req.body?.heroSubtitle, 300),
      colors: sanitizeColors(req.body?.colors),
      layout: LAYOUTS.includes(req.body?.layout) ? req.body.layout : 'minimal',
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
      ...(serviceId ? {} : {
        status: 'draft',
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      })
    }, { merge: true });

    res.status(200).json({ ok: true, serviceId: serviceRef.id });
  }));

  /** POST { organizationId, serviceId, status } */
  const setServiceStatus = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const status = String(req.body?.status || '').trim();
    if (!['draft', 'published', 'suspended', 'archived'].includes(status)) throw new HttpError(400, 'invalid-status', 'Statut invalide.');
    const serviceId = String(req.body?.serviceId || '').trim();
    const serviceRef = db.collection('services').doc(serviceId);
    const serviceSnap = await serviceRef.get();
    if (!serviceSnap.exists || serviceSnap.data().organizationId !== organizationId) throw new HttpError(404, 'service-not-found', 'Service introuvable.');

    await serviceRef.set({ status, updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.status(200).json({ ok: true });
  }));

  /** Deletes an unused service, or archives it when booking history exists. */
  const deleteService = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);
    const serviceId = String(req.body?.serviceId || '').trim();
    const serviceRef = db.collection('services').doc(serviceId);
    const serviceSnap = await serviceRef.get();
    if (!serviceSnap.exists || serviceSnap.data().organizationId !== organizationId) throw new HttpError(404, 'service-not-found', 'Service introuvable.');
    const bookings = await db.collection('bookings').where('serviceId', '==', serviceId).limit(1).get();
    if (!bookings.empty) {
      await serviceRef.set({ status: 'archived', updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      res.status(200).json({ ok: true, archived: true });
      return;
    }
    const rules = await db.collection('availabilityRules').where('serviceId', '==', serviceId).get();
    const batch = db.batch();
    rules.docs.forEach((doc) => batch.delete(doc.ref));
    batch.delete(serviceRef);
    await batch.commit();
    res.status(200).json({ ok: true, archived: false });
  }));

  /**
   * POST { organizationId, serviceId, ruleId?, dayOfWeek (0-6), startTime "HH:MM",
   *        endTime "HH:MM", slotDurationMinutes }
   */
  const saveAvailabilityRule = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const serviceId = String(req.body?.serviceId || '').trim();
    const serviceSnap = await db.collection('services').doc(serviceId).get();
    if (!serviceSnap.exists || serviceSnap.data().organizationId !== organizationId) throw new HttpError(404, 'service-not-found', 'Service introuvable.');

    const dayOfWeek = Number(req.body?.dayOfWeek);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) throw new HttpError(400, 'invalid-day', 'dayOfWeek doit etre entre 0 (dimanche) et 6 (samedi).');
    const startMinutes = timeToMinutes(req.body?.startTime);
    const endMinutes = timeToMinutes(req.body?.endTime);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) throw new HttpError(400, 'invalid-time-range', 'Plage horaire invalide.');
    const slotDurationMinutes = Number(req.body?.slotDurationMinutes) || serviceSnap.data().durationMinutes;

    const ruleId = String(req.body?.ruleId || '').trim();
    const ruleRef = ruleId ? db.collection('availabilityRules').doc(ruleId) : db.collection('availabilityRules').doc();
    await ruleRef.set({
      organizationId, serviceId, dayOfWeek,
      startTime: req.body.startTime, endTime: req.body.endTime, slotDurationMinutes,
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp(),
      createdAt: ruleId ? undefined : sstInternals.admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(200).json({ ok: true, ruleId: ruleRef.id });
  }));

  /** POST { organizationId, ruleId } — the only way to remove a rule; none existed before. */
  const deleteAvailabilityRule = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager']);

    const ruleId = String(req.body?.ruleId || '').trim();
    const ruleRef = db.collection('availabilityRules').doc(ruleId);
    const ruleSnap = await ruleRef.get();
    if (!ruleSnap.exists || ruleSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'rule-not-found', 'Regle introuvable.');
    }
    await ruleRef.delete();
    res.status(200).json({ ok: true });
  }));

  /** GET ?serviceId=...&date=YYYY-MM-DD — public. Computes open slots for that day. */
  const getAvailableSlots = onRequest({ region }, withErrorHandling(async (req, res) => {
    const serviceId = String(req.query?.serviceId || '').trim();
    const dateStr = String(req.query?.date || '').trim();
    const serviceSnap = await db.collection('services').doc(serviceId).get();
    if (!serviceSnap.exists || serviceSnap.data().status !== 'published') throw new HttpError(404, 'service-not-found', 'Service introuvable ou non publie.');
    const targetDate = new Date(`${dateStr}T00:00:00`);
    if (Number.isNaN(targetDate.getTime())) throw new HttpError(400, 'invalid-date', 'Date invalide (format YYYY-MM-DD attendu).');

    const dayOfWeek = targetDate.getDay();
    const rulesSnap = await db.collection('availabilityRules').where('serviceId', '==', serviceId).where('dayOfWeek', '==', dayOfWeek).get();
    if (rulesSnap.empty) { res.status(200).json({ ok: true, slots: [] }); return; }

    const dayStart = new Date(targetDate); const dayEnd = new Date(targetDate); dayEnd.setDate(dayEnd.getDate() + 1);
    const bookingsSnap = await db.collection('bookings')
      .where('serviceId', '==', serviceId)
      .where('status', 'in', ['pending_payment', 'confirmed'])
      .get();
    const takenStarts = new Set(
      bookingsSnap.docs
        .map((d) => d.data())
        .filter((b) => { const s = new Date(b.slotStart); return s >= dayStart && s < dayEnd; })
        .map((b) => b.slotStart)
    );

    const slots = [];
    rulesSnap.docs.forEach((doc) => {
      const rule = doc.data();
      const startMinutes = timeToMinutes(rule.startTime);
      const endMinutes = timeToMinutes(rule.endTime);
      for (let m = startMinutes; m + rule.slotDurationMinutes <= endMinutes; m += rule.slotDurationMinutes) {
        const slotStart = new Date(targetDate); slotStart.setMinutes(m);
        const iso = slotStart.toISOString();
        if (!takenStarts.has(iso) && slotStart.getTime() > Date.now()) slots.push(iso);
      }
    });

    res.status(200).json({ ok: true, slots: slots.sort() });
  }));

  /**
   * GET ?serviceId=... — public service details. Also returns `availableDaysOfWeek`
   * (which weekdays have at least one availability rule, e.g. [1,3,5] for Mon/Wed/Fri)
   * so the public calendar can honestly highlight generally-open weekdays without
   * running a slot query per calendar day — actual remaining slots for a specific
   * date are still only known via getAvailableSlots.
   */
  const getPublicService = onRequest({ region }, withErrorHandling(async (req, res) => {
    const serviceId = String(req.query?.serviceId || '').trim();
    const serviceSnap = await db.collection('services').doc(serviceId).get();
    if (!serviceSnap.exists || serviceSnap.data().status !== 'published') throw new HttpError(404, 'service-not-found', 'Service introuvable ou non publie.');
    const s = serviceSnap.data();

    const rulesSnap = await db.collection('availabilityRules').where('serviceId', '==', serviceId).get();
    const availableDaysOfWeek = [...new Set(rulesSnap.docs.map((d) => d.data().dayOfWeek))].sort();

    res.status(200).json({
      ok: true,
      service: {
        id: serviceSnap.id, organizationId: s.organizationId, title: s.title, description: s.description,
        priceType: s.priceType, price: s.price, depositAmount: s.depositAmount, durationMinutes: s.durationMinutes,
        photoUrl: s.photoUrl || null, heroTitle: s.heroTitle || null, heroSubtitle: s.heroSubtitle || null,
        colors: s.colors || null, layout: s.layout || 'minimal', availableDaysOfWeek
      }
    });
  }));

  /** Public. POST { organizationId, serviceId, slotStart, customerEmail, customerName } */
  const createBooking = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const organizationId = String(req.body?.organizationId || '').trim();
    const serviceId = String(req.body?.serviceId || '').trim();
    const serviceSnap = await db.collection('services').doc(serviceId).get();
    if (!serviceSnap.exists || serviceSnap.data().status !== 'published' || serviceSnap.data().organizationId !== organizationId) {
      throw new HttpError(404, 'service-not-found', 'Service introuvable ou non publie.');
    }
    const service = serviceSnap.data();

    const slotStart = String(req.body?.slotStart || '').trim();
    const slotStartDate = new Date(slotStart);
    if (Number.isNaN(slotStartDate.getTime()) || slotStartDate.getTime() <= Date.now()) {
      throw new HttpError(400, 'invalid-slot', 'Creneau invalide ou deja passe.');
    }
    const slotEnd = new Date(slotStartDate.getTime() + service.durationMinutes * 60000).toISOString();

    const customerEmail = String(req.body?.customerEmail || '').trim();
    if (!customerEmail) throw new HttpError(400, 'customer-email-required', 'Email requis.');

    const bookingRef = await db.runTransaction(async (tx) => {
      const conflictSnap = await tx.get(
        db.collection('bookings').where('serviceId', '==', serviceId).where('slotStart', '==', slotStart).where('status', 'in', ['pending_payment', 'confirmed'])
      );
      if (!conflictSnap.empty) throw new HttpError(409, 'slot-taken', 'Ce creneau vient d etre reserve par quelqu un d autre.');

      const ref = db.collection('bookings').doc();
      const amountDue = service.priceType === 'deposit' ? Number(service.depositAmount) : Number(service.price);
      tx.set(ref, {
        organizationId, serviceId, slotStart, slotEnd,
        customerEmail, customerName: String(req.body?.customerName || '').trim(),
        amountDue, paymentType: service.priceType === 'deposit' ? 'deposit' : 'full',
        totalPrice: Number(service.price),
        status: 'pending_payment', paymentIntentId: null,
        createdAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
      });
      return ref;
    });

    res.status(200).json({ ok: true, bookingId: bookingRef.id });
  }));

  /** Staff-only (see module docstring): cancels a booking. POST { organizationId, bookingId } */
  const cancelBooking = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);

    const bookingId = String(req.body?.bookingId || '').trim();
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingSnap = await bookingRef.get();
    if (!bookingSnap.exists || bookingSnap.data().organizationId !== organizationId) throw new HttpError(404, 'booking-not-found', 'Reservation introuvable.');

    await bookingRef.set({ status: 'cancelled', updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    res.status(200).json({ ok: true });
  }));

  /** Staff-only (see module docstring): reschedules a confirmed booking to a new slot. */
  const rescheduleBooking = onRequest({ region }, withErrorHandling(async (req, res) => {
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed', 'POST requis.');
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.body?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);

    const bookingId = String(req.body?.bookingId || '').trim();
    const newSlotStart = String(req.body?.newSlotStart || '').trim();
    const bookingRef = db.collection('bookings').doc(bookingId);
    const bookingSnap = await bookingRef.get();
    if (!bookingSnap.exists || bookingSnap.data().organizationId !== organizationId) throw new HttpError(404, 'booking-not-found', 'Reservation introuvable.');
    const booking = bookingSnap.data();
    if (booking.status !== 'confirmed') throw new HttpError(409, 'not-confirmed', 'Seule une reservation confirmee peut etre reprogrammee.');

    const serviceSnap = await db.collection('services').doc(booking.serviceId).get();
    const durationMinutes = serviceSnap.data()?.durationMinutes || 60;
    const newSlotStartDate = new Date(newSlotStart);
    if (Number.isNaN(newSlotStartDate.getTime())) throw new HttpError(400, 'invalid-slot', 'Nouveau creneau invalide.');

    const conflictSnap = await db.collection('bookings').where('serviceId', '==', booking.serviceId).where('slotStart', '==', newSlotStart).where('status', 'in', ['pending_payment', 'confirmed']).get();
    if (!conflictSnap.empty) throw new HttpError(409, 'slot-taken', 'Ce nouveau creneau est deja pris.');

    await bookingRef.set({
      slotStart: newSlotStart,
      slotEnd: new Date(newSlotStartDate.getTime() + durationMinutes * 60000).toISOString(),
      rescheduledBy: decodedUser.uid,
      updatedAt: sstInternals.admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    res.status(200).json({ ok: true });
  }));

  /** Dashboard: list bookings for an organization. */
  const listBookings = onRequest({ region }, withErrorHandling(async (req, res) => {
    const decodedUser = await requireBearerUser(req, sstInternals);
    const organizationId = String(req.query?.organizationId || '').trim();
    await requireOrgRole(db, decodedUser, organizationId, ['creator_owner', 'creator_manager', 'creator_staff']);

    const snap = await db.collection('bookings').where('organizationId', '==', organizationId).get();
    res.status(200).json({ ok: true, bookings: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  }));

  registerResourceResolver('booking', {
    applicationId: 'services',
    collection: (firestore) => firestore.collection('bookings'),
    computeAmount: (booking) => Number(booking.amountDue || 0),
    onConfirmed: async (firestore, intent, sstInternalsRef) => {
      await firestore.doc(intent.resourceRef).set({
        status: 'confirmed',
        updatedAt: sstInternalsRef.admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }
  });

  return { saveService, setServiceStatus, deleteService, saveAvailabilityRule, deleteAvailabilityRule, getAvailableSlots, getPublicService, createBooking, cancelBooking, rescheduleBooking, listBookings };
}

module.exports = { registerServiceFunctions, DAY_NAMES, timeToMinutes };
