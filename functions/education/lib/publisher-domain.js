'use strict';

const PROGRAM_STATUSES = Object.freeze(['draft', 'review', 'published', 'archived']);
const LESSON_TYPES = Object.freeze(['video', 'text', 'pdf', 'audio', 'file', 'live', 'quiz', 'assignment']);
const LESSON_STATUSES = Object.freeze(['draft', 'ready', 'published', 'archived']);

function text(value, max = 1000) {
  return String(value ?? '').replace(/\u0000/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function slug(value) {
  return text(value, 100).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function list(value, maxItems = 30, maxLength = 240) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function iso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSchoolInput(body = {}, existing = {}) {
  const name = text(body.name ?? existing.name, 140);
  if (!name) throw Object.assign(new Error('Nom requis.'), { code: 'name-required' });
  return {
    name,
    slug: slug(body.slug ?? existing.slug ?? name),
    shortDescription: text(body.shortDescription ?? existing.shortDescription, 500),
    fullDescription: text(body.fullDescription ?? existing.fullDescription, 8000),
    domains: list(body.domains ?? existing.domains, 20, 80),
    commune: text(body.commune ?? existing.commune, 100) || null,
    department: text(body.department ?? existing.department, 100) || null,
    addressLabel: text(body.addressLabel ?? existing.addressLabel, 240) || null,
    publicContact: text(body.publicContact ?? existing.publicContact, 180) || null,
    logoImage: text(body.logoImage ?? existing.logoImage, 1200) || null,
    coverImage: text(body.coverImage ?? existing.coverImage, 1200) || null
  };
}

function normalizeProgramInput(body = {}, existing = {}) {
  const title = text(body.title ?? existing.title, 160);
  if (!title) throw Object.assign(new Error('Titre requis.'), { code: 'title-required' });
  const rawPrice = body.price && typeof body.price === 'object' ? body.price : (existing.price || {});
  const onRequest = rawPrice.isOnRequest === true;
  const amount = onRequest ? null : Math.max(0, Math.min(100000000, Number(rawPrice.amount) || 0));
  const registration = body.registration && typeof body.registration === 'object' ? body.registration : (existing.registration || {});
  const capacity = body.capacity && typeof body.capacity === 'object' ? body.capacity : (existing.capacity || {});
  const duration = body.duration && typeof body.duration === 'object' ? body.duration : (existing.duration || {});
  return {
    title,
    slug: slug(body.slug ?? existing.slug ?? title),
    shortDescription: text(body.shortDescription ?? existing.shortDescription, 500),
    fullDescription: text(body.fullDescription ?? existing.fullDescription, 12000),
    categoryId: text(body.categoryId ?? existing.categoryId, 100) || null,
    level: ['beginner', 'intermediate', 'advanced', 'all'].includes(body.level) ? body.level : (existing.level || 'all'),
    modality: ['in_person', 'online', 'hybrid'].includes(body.modality) ? body.modality : (existing.modality || 'online'),
    commune: text(body.commune ?? existing.commune, 100) || null,
    department: text(body.department ?? existing.department, 100) || null,
    duration: { value: Math.max(0, Math.min(10000, Number(duration.value) || 0)), unit: ['hours', 'days', 'weeks', 'months'].includes(duration.unit) ? duration.unit : 'hours' },
    schedule: text(body.schedule ?? existing.schedule, 500),
    prerequisites: text(body.prerequisites ?? existing.prerequisites, 3000),
    learningOutcomes: list(body.learningOutcomes ?? existing.learningOutcomes),
    targetAudience: list(body.targetAudience ?? existing.targetAudience),
    instructor: { name: text(body.instructor?.name ?? existing.instructor?.name, 140), bio: text(body.instructor?.bio ?? existing.instructor?.bio, 3000), photo: text(body.instructor?.photo ?? existing.instructor?.photo, 1200) || null },
    price: { amount, currency: 'HTG', isOnRequest: onRequest },
    registration: { status: ['upcoming', 'open', 'closed', 'on_request'].includes(registration.status) ? registration.status : 'closed', opensAt: iso(registration.opensAt), closesAt: iso(registration.closesAt) },
    capacity: { total: capacity.total ? Math.max(1, Math.min(1000000, Math.round(Number(capacity.total) || 1))) : null, available: null },
    image: text(body.image ?? existing.image, 1200) || null,
    imagePath: text(body.imagePath ?? existing.imagePath, 500) || null,
    promoVideo: text(body.promoVideo ?? existing.promoVideo, 1200) || null,
    terms: text(body.terms ?? existing.terms, 5000),
    refundPolicy: text(body.refundPolicy ?? existing.refundPolicy, 3000),
    seo: { title: text(body.seo?.title ?? existing.seo?.title, 70), description: text(body.seo?.description ?? existing.seo?.description, 160) }
  };
}

function normalizeModuleInput(body = {}, existing = {}) {
  const title = text(body.title ?? existing.title, 160);
  if (!title) throw Object.assign(new Error('Titre du module requis.'), { code: 'module-title-required' });
  return { title, description: text(body.description ?? existing.description, 1000), order: Math.max(0, Math.round(Number(body.order ?? existing.order) || 0)), status: body.status === 'archived' ? 'archived' : 'active' };
}

function normalizeLessonInput(body = {}, existing = {}) {
  const title = text(body.title ?? existing.title, 160);
  if (!title) throw Object.assign(new Error('Titre de la leçon requis.'), { code: 'lesson-title-required' });
  const type = LESSON_TYPES.includes(body.type) ? body.type : (LESSON_TYPES.includes(existing.type) ? existing.type : 'video');
  return {
    title,
    description: text(body.description ?? existing.description, 2000),
    type,
    content: type === 'text' ? text(body.content ?? existing.content, 100000).replace(/<[^>]*>/g, '') : null,
    contentRef: type !== 'text' ? text(body.contentRef ?? existing.contentRef, 1200) || null : null,
    estimatedDurationMinutes: Math.max(0, Math.min(10000, Math.round(Number(body.estimatedDurationMinutes ?? existing.estimatedDurationMinutes) || 0))),
    isFreePreview: body.isFreePreview === true,
    allowDownload: body.allowDownload === true,
    order: Math.max(0, Math.round(Number(body.order ?? existing.order) || 0)),
    status: LESSON_STATUSES.includes(body.status) ? body.status : (existing.status || 'draft'),
    availabilityAt: iso(body.availabilityAt ?? existing.availabilityAt),
    attachments: Array.isArray(body.attachments) ? body.attachments.slice(0, 10).map((item) => ({ label: text(item?.label, 120), path: text(item?.path, 500), url: text(item?.url, 1200) })).filter((item) => item.label && (item.path || item.url)) : (existing.attachments || [])
  };
}

function buildPublishChecklist(program = {}, counts = {}) {
  const items = [
    ['identity', Boolean(program.title && program.shortDescription), 'Titre et résumé'],
    ['image', Boolean(program.image || program.imagePath), 'Image de couverture'],
    ['instructor', Boolean(program.instructor?.name), 'Formateur'],
    ['module', Number(counts.modules) > 0, 'Un module'],
    ['lesson', Number(counts.lessons) > 0, 'Une leçon'],
    ['price', Boolean(program.price?.isOnRequest || Number(program.price?.amount) >= 0), 'Prix'],
    ['terms', Boolean(program.terms || program.refundPolicy), 'Conditions']
  ].map(([key, complete, label]) => ({ key, complete, label }));
  return { complete: items.every((item) => item.complete), completed: items.filter((item) => item.complete).length, total: items.length, items };
}

module.exports = { PROGRAM_STATUSES, LESSON_TYPES, LESSON_STATUSES, text, slug, list, normalizeSchoolInput, normalizeProgramInput, normalizeModuleInput, normalizeLessonInput, buildPublishChecklist };
