// ============= SMART CUT EDUCATION - NORMALISATION (miroir navigateur) =============
// Port ES module, sans dependance, de functions/education/lib/normalize.js.
// Ce depot livre son code navigateur en modules natifs sans bundler, et
// functions/** n'est jamais servi au client (voir firebase.json
// hosting.ignore) : il n'existe donc pas de mecanisme pour partager un seul
// fichier entre le Cloud Functions runtime (CommonJS, teste via
// `node --test`) et le navigateur (ES modules). Ce fichier est le miroir
// intentionnel, tenu a jour a la main ; toute evolution de la logique de
// normalisation doit etre repercutee dans les deux fichiers. Voir
// EDUCATION_DATA_ARCHITECTURE.md.

const DURATION_UNIT_LABELS = {
  hours: ['heure', 'heures'],
  days: ['jour', 'jours'],
  weeks: ['semaine', 'semaines'],
  months: ['mois', 'mois'],
  years: ['an', 'ans']
};

const REGISTRATION_STATUS_LABELS = {
  upcoming: 'Bientôt ouvert',
  open: 'Inscriptions ouvertes',
  closed: 'Inscriptions fermées',
  on_request: 'Sur demande'
};

const MODALITY_VALUES = new Set(['in_person', 'online', 'hybrid']);
const REGISTRATION_STATUS_VALUES = new Set(['upcoming', 'open', 'closed', 'on_request']);
const PUBLICATION_STATUS_VALUES = new Set(['draft', 'review', 'published', 'archived']);
const VERIFICATION_STATUS_VALUES = new Set(['unverified', 'pending', 'verified', 'rejected', 'suspended']);

const COMBINING_DIACRITICS = new RegExp('[̀-ͯ]', 'g');

export function normalizeSlug(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return raw
    .normalize('NFD')
    .replace(COMBINING_DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function toIsoStringOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value?.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date?.getTime?.()) ? null : date.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function pluralize(value, [singular, plural]) {
  return Math.abs(Number(value)) === 1 ? singular : plural;
}

function formatAmount(amount) {
  return String(Math.round(Number(amount))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function formatDurationLabel(duration) {
  const value = duration?.value ?? null;
  const unit = duration?.unit ?? null;
  if (duration?.displayLabel) return duration.displayLabel;
  if (value === null || value === undefined) return 'Durée à confirmer';
  const labels = DURATION_UNIT_LABELS[unit];
  if (!labels) return `${value} ${unit || ''}`.trim();
  return `${value} ${pluralize(value, labels)}`;
}

export function formatPriceLabel(price) {
  if (price?.displayLabel) return price.displayLabel;
  if (price?.isOnRequest) return 'Prix sur demande';
  const amount = price?.amount ?? null;
  if (amount === null || amount === undefined) return 'Prix à confirmer';
  const currency = price?.currency || 'HTG';
  return `${formatAmount(amount)} ${currency}`;
}

export function formatRegistrationLabel(registration) {
  if (registration?.displayLabel) return registration.displayLabel;
  const status = registration?.status ?? null;
  return REGISTRATION_STATUS_LABELS[status] || 'À confirmer';
}

export function formatCapacityLabel(capacity) {
  if (capacity?.displayLabel) return capacity.displayLabel;
  const available = capacity?.available ?? null;
  const total = capacity?.total ?? null;
  if (available !== null && available !== undefined) {
    return `${available} place${Math.abs(available) === 1 ? '' : 's'} disponible${Math.abs(available) === 1 ? '' : 's'}`;
  }
  if (total !== null && total !== undefined) {
    return `${total} place${Math.abs(total) === 1 ? '' : 's'} au total`;
  }
  return 'Places à confirmer';
}

export function isPublished(entity) {
  return entity?.publicationStatus === 'published';
}

export function isArchived(entity) {
  return entity?.publicationStatus === 'archived';
}

export function normalizeCategory(raw = {}, id) {
  return {
    id: String(id ?? raw.id ?? ''),
    slug: normalizeSlug(raw.slug || raw.name || id),
    name: raw.name || '',
    description: raw.description || '',
    icon: raw.icon || '',
    image: raw.image || null,
    order: Number.isFinite(raw.order) ? raw.order : 0,
    isActive: raw.isActive !== false
  };
}

export function normalizeProgram(raw = {}, id) {
  const duration = raw.duration || {};
  const price = raw.price || {};
  const registration = raw.registration || {};
  const capacity = raw.capacity || {};

  return {
    id: String(id ?? raw.id ?? ''),
    slug: normalizeSlug(raw.slug || raw.title || id),
    title: raw.title || '',
    shortDescription: raw.shortDescription || '',
    fullDescription: raw.fullDescription || '',
    categoryId: raw.categoryId || null,
    schoolId: raw.schoolId || null,
    level: raw.level || '',
    modality: MODALITY_VALUES.has(raw.modality) ? raw.modality : null,
    commune: raw.commune || null,
    department: raw.department || null,
    duration: {
      value: Number.isFinite(duration.value) ? duration.value : null,
      unit: duration.unit || null,
      displayLabel: formatDurationLabel(duration)
    },
    schedule: raw.schedule || '',
    prerequisites: raw.prerequisites || '',
    publicCurriculum: Array.isArray(raw.publicCurriculum) ? raw.publicCurriculum.map((module) => ({
      title: module?.title || '',
      description: module?.description || '',
      lessons: Array.isArray(module?.lessons) ? module.lessons.map((lesson) => ({
        title: lesson?.title || '', type: lesson?.type || '',
        estimatedDurationMinutes: Number(lesson?.estimatedDurationMinutes) || 0,
        isFreePreview: lesson?.isFreePreview === true
      })).filter((lesson) => lesson.title) : []
    })).filter((module) => module.title) : [],
    learningOutcomes: Array.isArray(raw.learningOutcomes) ? raw.learningOutcomes.filter(Boolean) : [],
    targetAudience: Array.isArray(raw.targetAudience) ? raw.targetAudience.filter(Boolean) : [],
    instructor: {
      name: raw.instructor?.name || '',
      bio: raw.instructor?.bio || '',
      photo: raw.instructor?.photo || null
    },
    price: {
      amount: Number.isFinite(price.amount) ? price.amount : null,
      currency: price.currency || 'HTG',
      isOnRequest: price.isOnRequest === true,
      displayLabel: formatPriceLabel(price)
    },
    registration: {
      status: REGISTRATION_STATUS_VALUES.has(registration.status) ? registration.status : null,
      opensAt: toIsoStringOrNull(registration.opensAt),
      closesAt: toIsoStringOrNull(registration.closesAt),
      displayLabel: formatRegistrationLabel(registration)
    },
    capacity: {
      total: Number.isFinite(capacity.total) ? capacity.total : null,
      available: Number.isFinite(capacity.available) ? capacity.available : null,
      displayLabel: formatCapacityLabel(capacity)
    },
    image: raw.image || null,
    promoVideo: raw.promoVideo || null,
    terms: raw.terms || '',
    refundPolicy: raw.refundPolicy || '',
    seo: {
      title: raw.seo?.title || '',
      description: raw.seo?.description || ''
    },
    badge: raw.badge || null,
    publicationStatus: PUBLICATION_STATUS_VALUES.has(raw.publicationStatus) ? raw.publicationStatus : 'draft',
    isDemo: raw.isDemo === true,
    createdAt: toIsoStringOrNull(raw.createdAt),
    updatedAt: toIsoStringOrNull(raw.updatedAt),
    publishedAt: toIsoStringOrNull(raw.publishedAt)
  };
}

export function normalizeSchool(raw = {}, id) {
  const verification = raw.verification || {};

  return {
    id: String(id ?? raw.id ?? ''),
    slug: normalizeSlug(raw.slug || raw.name || id),
    name: raw.name || '',
    shortDescription: raw.shortDescription || '',
    fullDescription: raw.fullDescription || '',
    domains: Array.isArray(raw.domains) ? raw.domains.filter(Boolean) : [],
    commune: raw.commune || null,
    department: raw.department || null,
    addressLabel: raw.addressLabel || null,
    publicContact: raw.publicContact || null,
    coverImage: raw.coverImage || null,
    logoImage: raw.logoImage || null,
    publicationStatus: PUBLICATION_STATUS_VALUES.has(raw.publicationStatus) ? raw.publicationStatus : 'draft',
    verification: {
      status: VERIFICATION_STATUS_VALUES.has(verification.status) ? verification.status : 'unverified',
      label: verification.label || 'Établissement non vérifié',
      checkedItems: Array.isArray(verification.checkedItems) ? verification.checkedItems.filter(Boolean) : [],
      reviewedAt: toIsoStringOrNull(verification.reviewedAt),
      reviewedBy: verification.reviewedBy || null
    },
    isDemo: raw.isDemo === true,
    createdAt: toIsoStringOrNull(raw.createdAt),
    updatedAt: toIsoStringOrNull(raw.updatedAt),
    publishedAt: toIsoStringOrNull(raw.publishedAt)
  };
}

/**
 * Resolves an entity by slug first, falling back to id (legacy links), then
 * null. `findBySlug`/`findById` may be sync or async — always awaited.
 */
export async function resolveBySlugThenId({ slug, id, findBySlug, findById }) {
  const normalizedSlug = slug ? normalizeSlug(slug) : '';
  if (normalizedSlug && typeof findBySlug === 'function') {
    const bySlug = await findBySlug(normalizedSlug);
    if (bySlug) return bySlug;
  }
  const trimmedId = String(id || '').trim();
  if (trimmedId && typeof findById === 'function') {
    const byId = await findById(trimmedId);
    if (byId) return byId;
  }
  return null;
}
