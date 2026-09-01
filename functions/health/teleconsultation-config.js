'use strict';

const COMMISSION_RATE = 15;

const CONSULTATION_PLANS = Object.freeze({
  essential: Object.freeze({ code: 'essential', name: 'Consultation Essentielle', durationMinutes: 10, maxPhotos: 1, maxVoiceMessages: 1, chatEnabled: true, prescriptionEnabled: false, labOrderEnabled: false }),
  advanced: Object.freeze({ code: 'advanced', name: 'Consultation Avancée', durationMinutes: 25, maxPhotos: 5, maxVoiceMessages: 3, chatEnabled: true, prescriptionEnabled: true, labOrderEnabled: true })
});

const SPECIALTIES = Object.freeze([
  ['general-medicine', 'Médecine générale', 1750, 2350],
  ['internal-medicine', 'Médecine interne', 2500, 2950],
  ['pediatrics', 'Pédiatrie', 2500, 2950],
  ['gynecology', 'Gynécologie', 2500, 2950],
  ['ophthalmology', 'Ophtalmologie', 2500, 2950],
  ['orthopedics', 'Orthopédie', 2500, 2950],
  ['surgery', 'Chirurgie', 2700, 3500],
  ['cardiology', 'Cardiologie', 3000, 4000],
  ['neurology', 'Neurologie', 2700, 2950],
  ['gastroenterology', 'Gastro-entérologie', 3500, 4500],
  ['dermatology', 'Dermatologie', 2200, 2950],
  ['psychology', 'Psychologie', 3000, 3500],
  ['ent', 'ORL (Oto-rhino-laryngologie)', 3000, 3750],
  ['pulmonology', 'Pneumologie', 2200, 2950],
  ['nephrology', 'Néphrologie', 3500, 4000],
  ['nutrition', 'Nutrition / Diététique', 2500, 3000],
  ['neurosurgery', 'Neurochirurgie', 3750, 5000],
  ['psychiatry', 'Psychiatrie', 3000, 4000],
  ['family-medicine', 'Médecine familiale', 2200, 2950],
  ['hematology', 'Hématologie', 3000, 4000],
  ['geriatrics', 'Gériatrie', 3000, 3750]
].map(([code, name, essentialPrice, advancedPrice], displayOrder) => Object.freeze({ code, name, displayOrder: displayOrder + 1, active: true, prices: Object.freeze({ essential: essentialPrice, advanced: advancedPrice }) })));

function resolveConsultationSelection(specialtyCode, planCode) {
  const specialty = SPECIALTIES.find((item) => item.code === specialtyCode && item.active);
  const plan = CONSULTATION_PLANS[planCode];
  if (!specialty || !plan) return null;
  const price = Number(specialty.prices[plan.code]);
  const platformFee = Math.round(price * COMMISSION_RATE) / 100;
  return { specialty, plan, price, commissionRate: COMMISSION_RATE, platformFee, professionalAmount: Math.round((price - platformFee) * 100) / 100 };
}

function publicConsultationCatalog() {
  return { currency: 'HTG', commissionRate: COMMISSION_RATE, plans: Object.values(CONSULTATION_PLANS).map((plan) => ({ ...plan })), specialties: SPECIALTIES.map((specialty) => ({ ...specialty, prices: { ...specialty.prices } })) };
}

// ---------- RENDEZ-VOUS (distinct from TELECONSULTATION above) ----------
//
// A doctor-initiated, targeted appointment for one specific patient (picked from the
// doctor's own AGENDA, not a self-service slot any patient can book) — a single flat
// price per specialty, never the Essentielle/Advanced two-tier pricing used by
// TELECONSULTATION. Duration is always 10 minutes.
const RENDEZVOUS_DURATION_MINUTES = 10;

const RENDEZVOUS_SPECIALTY_PRICES = Object.freeze([
  ['general-medicine', 'Médecine générale', 1500],
  ['internal-medicine', 'Médecine interne', 2500],
  ['pediatrics', 'Pédiatrie', 2500],
  ['gynecology', 'Gynécologie', 2500],
  ['orthopedics', 'Orthopédie', 2500],
  ['surgery', 'Chirurgie', 2700],
  ['cardiology', 'Cardiologie', 3000],
  ['neurology', 'Neurologie', 2700],
  ['gastroenterology', 'Gastro-entérologie', 3000],
  ['dermatology', 'Dermatologie', 2000],
  ['psychology', 'Psychologie', 2500],
  ['ent', 'ORL (Oto-rhino-laryngologie)', 2500],
  ['pulmonology', 'Pneumologie', 2000],
  ['nephrology', 'Néphrologie', 3000],
  ['nutrition', 'Nutrition / Diététique', 2000],
  ['neurosurgery', 'Neurochirurgie', 3500],
  ['psychiatry', 'Psychiatrie', 3000],
  ['family-medicine', 'Médecine familiale', 2000],
  ['hematology', 'Hématologie', 2500],
  ['geriatrics', 'Gériatrie', 2500]
  // Ophtalmologie volontairement absente : aucun tarif Rendez-vous fourni pour l'instant.
].map(([code, name, price]) => Object.freeze({ code, name, price })));

function resolveRendezvousSpecialty(specialtyCode) {
  return RENDEZVOUS_SPECIALTY_PRICES.find((item) => item.code === specialtyCode) || null;
}

function publicRendezvousCatalog() {
  return {
    currency: 'HTG',
    durationMinutes: RENDEZVOUS_DURATION_MINUTES,
    specialties: RENDEZVOUS_SPECIALTY_PRICES.map((item) => ({ ...item }))
  };
}

module.exports = {
  COMMISSION_RATE, CONSULTATION_PLANS, SPECIALTIES, resolveConsultationSelection, publicConsultationCatalog,
  RENDEZVOUS_DURATION_MINUTES, RENDEZVOUS_SPECIALTY_PRICES, resolveRendezvousSpecialty, publicRendezvousCatalog
};
