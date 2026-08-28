import { cleanText, clampNumber, parseLines } from '../shared/formatting.js';

export const COURSE_STATUS_LABELS = Object.freeze({
  draft: 'Brouillon', review: 'En vérification', published: 'Publié',
  suspended: 'Suspendu', archived: 'Archivé'
});

export function courseStatusLabel(status) {
  return COURSE_STATUS_LABELS[status] || 'Brouillon';
}

export function buildCourseSaveBody(values) {
  const amount = clampNumber(values.price, 0, 100000000, 0);
  return {
    organizationId: values.organizationId,
    courseId: values.courseId || undefined,
    title: cleanText(values.title, 140),
    description: cleanText(values.description, 500),
    subtitle: cleanText(values.subtitle, 220),
    shortDescription: cleanText(values.shortDescription || values.description, 500),
    fullDescription: cleanText(values.fullDescription, 12000),
    category: cleanText(values.category, 80),
    level: values.level || 'all',
    language: cleanText(values.language || 'fr', 40),
    instructorName: cleanText(values.instructorName, 120),
    learningOutcomes: Array.isArray(values.learningOutcomes) ? values.learningOutcomes : parseLines(values.learningOutcomes),
    targetAudience: Array.isArray(values.targetAudience) ? values.targetAudience : parseLines(values.targetAudience),
    prerequisites: Array.isArray(values.prerequisites) ? values.prerequisites : parseLines(values.prerequisites),
    faqs: Array.isArray(values.faqs) ? values.faqs : [],
    testimonials: Array.isArray(values.testimonials) ? values.testimonials : [],
    estimatedDurationMinutes: clampNumber(values.estimatedDurationMinutes, 0, 100000, 0),
    slug: cleanText(values.slug, 80),
    pricing: { type: amount === 0 ? 'free' : 'fixed', amount, currency: 'HTG' },
    price: amount,
    accessPolicy: values.accessPolicy || { type: 'lifetime', durationDays: null },
    enrollmentPolicy: values.enrollmentPolicy || { opensAt: null, closesAt: null, capacity: null },
    termsUrl: cleanText(values.termsUrl, 1000),
    refundPolicy: cleanText(values.refundPolicy, 3000),
    pageSections: Array.isArray(values.pageSections) ? values.pageSections.map((item) => ({ id: cleanText(item.id, 40), visible: item.visible !== false })) : undefined,
    seo: { pageTitle: cleanText(values.seo?.pageTitle, 70), description: cleanText(values.seo?.description, 160) },
    coverImage: values.coverImage || null,
    heroTitle: cleanText(values.heroTitle, 140),
    heroSubtitle: cleanText(values.heroSubtitle, 300),
    layout: values.layout,
    colors: values.colors
  };
}

export function checklistSummary(checklist) {
  if (!checklist) return { percentage: 0, missing: [] };
  return {
    percentage: checklist.totalCount ? Math.round((checklist.completedCount / checklist.totalCount) * 100) : 0,
    missing: (checklist.items || []).filter((item) => !item.complete).map((item) => item.reason)
  };
}
