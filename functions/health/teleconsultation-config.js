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

module.exports = { COMMISSION_RATE, CONSULTATION_PLANS, SPECIALTIES, resolveConsultationSelection, publicConsultationCatalog };
