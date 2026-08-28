'use strict';

const COURSE_STATUSES = Object.freeze(['draft', 'review', 'published', 'suspended', 'archived']);
const LESSON_STATUSES = Object.freeze(['draft', 'ready', 'published', 'archived']);
const LESSON_TYPES = Object.freeze(['video', 'text', 'pdf', 'file', 'audio']);
const COURSE_SECTION_IDS = Object.freeze(['hero', 'about', 'outcomes', 'audience', 'prerequisites', 'curriculum', 'instructor', 'offer', 'faq', 'testimonials', 'cta', 'legal']);
const MEMBER_PERMISSIONS = Object.freeze({
  creator_owner: ['course:read', 'course:write', 'course:publish', 'course:delete', 'students:write', 'analytics:read', 'finance:read', 'team:write'],
  creator_manager: ['course:read', 'course:write', 'course:publish', 'students:write', 'analytics:read', 'finance:read'],
  creator_staff: ['course:read', 'course:write', 'students:read']
});

function normalizeEmail(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function sanitizePlainText(value, maxLength = 5000) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

// Text lessons are deliberately stored as plain text in the MVP. This removes
// executable markup while keeping line breaks; a future rich-text schema can use
// structured blocks rather than accepting arbitrary HTML.
function sanitizeLessonText(value, maxLength = 100000) {
  return sanitizePlainText(String(value ?? '').replace(/<[^>]*>/g, ''), maxLength);
}

function normalizeSlug(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function normalizeStringList(value, maxItems = 20, maxLength = 240) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => sanitizePlainText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function normalizeFaqs(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({ question: sanitizePlainText(item?.question, 240), answer: sanitizePlainText(item?.answer, 2000) }))
    .filter((item) => item.question && item.answer).slice(0, 20);
}

function normalizeTestimonials(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({ author: sanitizePlainText(item?.author, 120), quote: sanitizePlainText(item?.quote, 1200) }))
    .filter((item) => item.author && item.quote).slice(0, 12);
}

function normalizePageSections(value, existing) {
  const source = Array.isArray(value) ? value : (Array.isArray(existing) ? existing : COURSE_SECTION_IDS.map((id) => ({ id, visible: true })));
  const seen = new Set();
  const ordered = source.filter((item) => item && COURSE_SECTION_IDS.includes(item.id) && !seen.has(item.id)).map((item) => { seen.add(item.id); return { id: item.id, visible: item.visible !== false }; });
  COURSE_SECTION_IDS.forEach((id) => { if (!seen.has(id)) ordered.push({ id, visible: true }); });
  return ordered;
}

function normalizePricing(raw, legacyPrice) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const legacy = Number(legacyPrice);
  const type = source.type === 'free' || legacy === 0 ? 'free' : 'fixed';
  const amount = type === 'free' ? 0 : Number(source.amount ?? legacyPrice);
  if (!Number.isFinite(amount) || amount < 0 || (type === 'fixed' && amount <= 0)) {
    const error = new Error('Prix invalide.');
    error.code = 'invalid-price';
    throw error;
  }
  return { type, amount: Math.round(amount * 100) / 100, currency: 'HTG' };
}

function normalizeCourseInput(body = {}, existing = {}) {
  const title = sanitizePlainText(body.title ?? existing.title, 140);
  if (!title) {
    const error = new Error('Titre requis.');
    error.code = 'title-required';
    throw error;
  }
  const pricing = normalizePricing(body.pricing, body.price ?? existing.price ?? existing.pricing?.amount);
  const slug = normalizeSlug(body.slug ?? existing.slug ?? title);
  const accessType = body.accessPolicy?.type === 'limited' ? 'limited' : (body.accessPolicy?.type === 'lifetime' ? 'lifetime' : (existing.accessPolicy?.type || 'lifetime'));
  const enrollmentSource = body.enrollmentPolicy && typeof body.enrollmentPolicy === 'object' ? body.enrollmentPolicy : (existing.enrollmentPolicy || {});
  const normalizeIso = (value) => { if (!value) return null; const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); };
  return {
    title,
    slug,
    subtitle: sanitizePlainText(body.subtitle ?? existing.subtitle, 220) || null,
    shortDescription: sanitizePlainText(body.shortDescription ?? body.description ?? existing.shortDescription ?? existing.description, 500) || null,
    fullDescription: sanitizePlainText(body.fullDescription ?? existing.fullDescription, 12000) || null,
    description: sanitizePlainText(body.description ?? body.shortDescription ?? existing.description ?? existing.shortDescription, 500),
    category: sanitizePlainText(body.category ?? existing.category, 80) || null,
    level: ['beginner', 'intermediate', 'advanced', 'all'].includes(body.level) ? body.level : (existing.level || 'all'),
    language: sanitizePlainText(body.language ?? existing.language, 40) || 'fr',
    instructorName: sanitizePlainText(body.instructorName ?? existing.instructorName, 120) || null,
    learningOutcomes: normalizeStringList(body.learningOutcomes ?? existing.learningOutcomes),
    targetAudience: normalizeStringList(body.targetAudience ?? existing.targetAudience),
    prerequisites: normalizeStringList(body.prerequisites ?? existing.prerequisites),
    faqs: normalizeFaqs(body.faqs ?? existing.faqs),
    testimonials: normalizeTestimonials(body.testimonials ?? existing.testimonials),
    estimatedDurationMinutes: Math.max(0, Math.min(100000, Math.round(Number(body.estimatedDurationMinutes ?? existing.estimatedDurationMinutes) || 0))),
    pricing,
    price: pricing.amount,
    accessPolicy: {
      type: accessType,
      durationDays: accessType === 'limited' ? Math.max(1, Math.min(3650, Math.round(Number(body.accessPolicy?.durationDays ?? existing.accessPolicy?.durationDays) || 1))) : null
    },
    enrollmentPolicy: {
      opensAt: normalizeIso(enrollmentSource.opensAt),
      closesAt: normalizeIso(enrollmentSource.closesAt),
      capacity: enrollmentSource.capacity ? Math.max(1, Math.min(1000000, Math.round(Number(enrollmentSource.capacity) || 1))) : null
    },
    termsUrl: sanitizePlainText(body.termsUrl ?? existing.termsUrl, 1000) || null,
    refundPolicy: sanitizePlainText(body.refundPolicy ?? existing.refundPolicy, 3000) || null,
    pageSections: normalizePageSections(body.pageSections, existing.pageSections),
    seo: {
      pageTitle: sanitizePlainText(body.seo?.pageTitle ?? existing.seo?.pageTitle, 70) || null,
      description: sanitizePlainText(body.seo?.description ?? existing.seo?.description, 160) || null
    }
  };
}

function buildPublishChecklist(course = {}, counts = {}, paymentReady = false) {
  const pricing = course.pricing || { type: Number(course.price) === 0 ? 'free' : 'fixed', amount: Number(course.price) };
  const items = [
    { key: 'essentialInformation', complete: Boolean(course.title && (course.shortDescription || course.description)), reason: 'Ajoutez un titre et une description courte.' },
    { key: 'coverImage', complete: Boolean(course.coverImage || course.coverImagePath), reason: 'Ajoutez une image de couverture.' },
    { key: 'module', complete: Number(counts.modules || 0) > 0, reason: 'Ajoutez au moins un module.' },
    { key: 'lesson', complete: Number(counts.lessons || 0) > 0, reason: 'Ajoutez au moins une leçon.' },
    { key: 'pricing', complete: pricing.type === 'free' || (pricing.type === 'fixed' && Number(pricing.amount) > 0), reason: 'Configurez un accès gratuit ou un prix fixe valide.' },
    { key: 'publicPage', complete: Boolean(course.slug), reason: 'Définissez un slug de page publique.' },
    { key: 'terms', complete: Boolean(course.termsUrl || course.refundPolicy), reason: 'Renseignez vos conditions ou votre politique de remboursement.' },
    { key: 'payment', complete: pricing.type === 'free' || Boolean(paymentReady), reason: 'Un moyen de paiement opérationnel est requis pour un cours payant.' }
  ];
  return { complete: items.every((item) => item.complete), completedCount: items.filter((item) => item.complete).length, totalCount: items.length, items };
}

function calculateProgress(totalLessonIds, completedLessonIds) {
  const valid = new Set((Array.isArray(totalLessonIds) ? totalLessonIds : []).filter(Boolean));
  const completed = [...new Set(Array.isArray(completedLessonIds) ? completedLessonIds : [])].filter((id) => valid.has(id));
  return { completedLessonIds: completed, completedLessons: completed.length, totalLessons: valid.size, completionPercentage: valid.size ? Math.round((completed.length / valid.size) * 100) : 0 };
}

function calculateAccessExpiration(accessPolicy, start = Date.now()) {
  if (accessPolicy?.type !== 'limited') return null;
  const days = Math.max(1, Math.min(3650, Math.round(Number(accessPolicy.durationDays) || 1)));
  return new Date(Number(start) + (days * 24 * 60 * 60 * 1000));
}

function hasActiveEnrollmentAccess(enrollment = {}, now = Date.now()) {
  if (enrollment.status !== 'confirmed') return false;
  const expiry = enrollment.accessExpiresAt;
  if (!expiry) return true;
  const millis = typeof expiry.toMillis === 'function' ? expiry.toMillis() : new Date(expiry).getTime();
  return Number.isFinite(millis) && millis > Number(now);
}

function hasPermission(role, permission) {
  return Boolean(MEMBER_PERMISSIONS[role]?.includes(permission));
}

module.exports = {
  COURSE_STATUSES, LESSON_STATUSES, LESSON_TYPES, COURSE_SECTION_IDS, MEMBER_PERMISSIONS,
  normalizeEmail, sanitizePlainText, sanitizeLessonText, normalizeSlug, normalizeFaqs, normalizeTestimonials,
  normalizePricing, normalizeCourseInput, normalizePageSections, buildPublishChecklist, calculateProgress,
  calculateAccessExpiration, hasActiveEnrollmentAccess, hasPermission
};
