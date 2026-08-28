'use strict';

/**
 * Field-type registry for the SmartSolutionTek form builder (Application 1 —
 * inscriptions). Pure logic, no Firestore — sanitization of a field's config
 * (creator side) and validation of a submitted answer (public side) both live
 * here so both `saveFormSchema` and `submitForm` in ../forms.js share one
 * table-driven source of truth instead of a hardcoded per-type switch. See
 * DATA_MODEL.md §3 for the schema this implements.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9+()\-.\s]{7,20}$/;
const MAX_OPTION_LENGTH = 120;
const MAX_OPTIONS = 20;
const MAX_FIELDS = 60;
const PERSONAL_SEMANTICS = ['firstName', 'lastName', 'fullName'];

// Practical list for a select input — not a claim of exhaustive ISO-3166-1 coverage,
// but covers the Caribbean/Americas/Europe/major-world countries realistically
// needed by a Haiti-based platform's registration forms.
const DEFAULT_COUNTRIES = [
  { code: 'HT', name: 'Haiti' },
  { code: 'US', name: 'Etats-Unis' },
  { code: 'CA', name: 'Canada' },
  { code: 'FR', name: 'France' },
  { code: 'DO', name: 'Republique Dominicaine' },
  { code: 'CU', name: 'Cuba' },
  { code: 'JM', name: 'Jamaique' },
  { code: 'BS', name: 'Bahamas' },
  { code: 'TT', name: 'Trinite-et-Tobago' },
  { code: 'BB', name: 'Barbade' },
  { code: 'GP', name: 'Guadeloupe' },
  { code: 'MQ', name: 'Martinique' },
  { code: 'PR', name: 'Porto Rico' },
  { code: 'MX', name: 'Mexique' },
  { code: 'BR', name: 'Bresil' },
  { code: 'AR', name: 'Argentine' },
  { code: 'CL', name: 'Chili' },
  { code: 'CO', name: 'Colombie' },
  { code: 'PE', name: 'Perou' },
  { code: 'VE', name: 'Venezuela' },
  { code: 'EC', name: 'Equateur' },
  { code: 'PA', name: 'Panama' },
  { code: 'CR', name: 'Costa Rica' },
  { code: 'GT', name: 'Guatemala' },
  { code: 'HN', name: 'Honduras' },
  { code: 'SV', name: 'El Salvador' },
  { code: 'NI', name: 'Nicaragua' },
  { code: 'BE', name: 'Belgique' },
  { code: 'CH', name: 'Suisse' },
  { code: 'DE', name: 'Allemagne' },
  { code: 'GB', name: 'Royaume-Uni' },
  { code: 'IE', name: 'Irlande' },
  { code: 'ES', name: 'Espagne' },
  { code: 'PT', name: 'Portugal' },
  { code: 'IT', name: 'Italie' },
  { code: 'NL', name: 'Pays-Bas' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'AT', name: 'Autriche' },
  { code: 'SE', name: 'Suede' },
  { code: 'NO', name: 'Norvege' },
  { code: 'DK', name: 'Danemark' },
  { code: 'FI', name: 'Finlande' },
  { code: 'PL', name: 'Pologne' },
  { code: 'GR', name: 'Grece' },
  { code: 'TR', name: 'Turquie' },
  { code: 'RU', name: 'Russie' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'MA', name: 'Maroc' },
  { code: 'DZ', name: 'Algerie' },
  { code: 'TN', name: 'Tunisie' },
  { code: 'SN', name: 'Senegal' },
  { code: 'CI', name: "Cote d'Ivoire" },
  { code: 'CM', name: 'Cameroun' },
  { code: 'CD', name: 'Republique Democratique du Congo' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'GH', name: 'Ghana' },
  { code: 'ZA', name: 'Afrique du Sud' },
  { code: 'EG', name: 'Egypte' },
  { code: 'AE', name: 'Emirats Arabes Unis' },
  { code: 'SA', name: 'Arabie Saoudite' },
  { code: 'IL', name: 'Israel' },
  { code: 'IN', name: 'Inde' },
  { code: 'CN', name: 'Chine' },
  { code: 'JP', name: 'Japon' },
  { code: 'KR', name: 'Coree du Sud' },
  { code: 'SG', name: 'Singapour' },
  { code: 'PH', name: 'Philippines' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'TH', name: 'Thailande' },
  { code: 'AU', name: 'Australie' },
  { code: 'NZ', name: 'Nouvelle-Zelande' },
  { code: 'OT', name: 'Autre' }
];

function mkError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isEmptyValue(value) {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function requireOrEmpty(field, value) {
  if (isEmptyValue(value)) {
    if (field.required) throw mkError('missing-required-field', `Le champ "${field.label}" est requis.`);
    return { empty: true };
  }
  return { empty: false };
}

function sanitizeOptionalString(value, maxLen) {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str ? str.slice(0, maxLen) : null;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isoOrNull(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function sanitizeOptions(rawOptions) {
  const list = Array.isArray(rawOptions) ? rawOptions : [];
  const cleaned = list.map((o) => String(o).trim()).filter(Boolean).slice(0, MAX_OPTIONS);
  if (!cleaned.length) throw mkError('options-required', 'Ajoutez au moins une option.');
  return cleaned.map((o) => o.slice(0, MAX_OPTION_LENGTH));
}

function validateChoiceValue(rawValue, field) {
  const str = String(rawValue).trim();
  const options = Array.isArray(field.options) ? field.options : [];
  if (options.includes(str)) return str;
  if (field.allowOther && str && str.length <= MAX_OPTION_LENGTH) return str;
  throw mkError('invalid-option', `Option invalide pour "${field.label}".`);
}

function makeTextValidator({ defaultMax, hardCap }) {
  return (value, field) => {
    const { empty } = requireOrEmpty(field, value);
    if (empty) return undefined;
    const str = String(value).trim();
    const configuredMax = Number.isFinite(field.maxLength) ? field.maxLength : defaultMax;
    const max = Math.max(1, Math.min(configuredMax, hardCap));
    if (str.length > max) throw mkError('text-too-long', `Le champ "${field.label}" est trop long (max ${max} caracteres).`);
    return str;
  };
}

function validateBooleanAnswer(value, field) {
  const bool = value === true || value === 'true' || value === 'on';
  if (field.required && bool !== true) throw mkError('missing-required-field', `Le champ "${field.label}" est requis.`);
  return bool;
}

function extractStoragePath(url) {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/o\/([^?]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

const FIELD_TYPE_REGISTRY = {
  text: {
    sanitizeExtra: (raw) => ({ maxLength: clampInt(raw?.maxLength, 1, 1000, null) }),
    validateAnswer: makeTextValidator({ defaultMax: 300, hardCap: 1000 })
  },
  textarea: {
    sanitizeExtra: (raw) => ({ maxLength: clampInt(raw?.maxLength, 1, 5000, null) }),
    validateAnswer: makeTextValidator({ defaultMax: 3000, hardCap: 5000 })
  },
  address: {
    sanitizeExtra: (raw) => ({ maxLength: clampInt(raw?.maxLength, 1, 5000, null) }),
    validateAnswer: makeTextValidator({ defaultMax: 3000, hardCap: 5000 })
  },
  city: {
    sanitizeExtra: () => ({}),
    validateAnswer: makeTextValidator({ defaultMax: 120, hardCap: 120 })
  },
  email: {
    sanitizeExtra: () => ({}),
    validateAnswer: (value, field) => {
      const { empty } = requireOrEmpty(field, value);
      if (empty) return undefined;
      const str = String(value).trim().toLowerCase();
      if (!EMAIL_PATTERN.test(str)) throw mkError('invalid-email', `Email invalide pour "${field.label}".`);
      return str;
    }
  },
  phone: {
    sanitizeExtra: () => ({}),
    validateAnswer: (value, field) => {
      const { empty } = requireOrEmpty(field, value);
      if (empty) return undefined;
      const str = String(value).trim();
      const digitCount = (str.match(/\d/g) || []).length;
      if (!PHONE_PATTERN.test(str) || digitCount < 7) throw mkError('invalid-phone', `Telephone invalide pour "${field.label}".`);
      return str;
    }
  },
  number: {
    sanitizeExtra: (raw) => ({ min: finiteOrNull(raw?.min), max: finiteOrNull(raw?.max) }),
    validateAnswer: (value, field) => {
      const { empty } = requireOrEmpty(field, value);
      if (empty) return undefined;
      const num = Number(value);
      if (!Number.isFinite(num)) throw mkError('invalid-number', `Nombre invalide pour "${field.label}".`);
      if (Number.isFinite(field.min) && num < field.min) throw mkError('number-too-small', `"${field.label}" doit etre superieur ou egal a ${field.min}.`);
      if (Number.isFinite(field.max) && num > field.max) throw mkError('number-too-large', `"${field.label}" doit etre inferieur ou egal a ${field.max}.`);
      return num;
    }
  },
  date: {
    sanitizeExtra: (raw) => ({ minDate: isoOrNull(raw?.minDate), maxDate: isoOrNull(raw?.maxDate) }),
    validateAnswer: (value, field) => {
      const { empty } = requireOrEmpty(field, value);
      if (empty) return undefined;
      const ms = new Date(value).getTime();
      if (!Number.isFinite(ms)) throw mkError('invalid-date', `Date invalide pour "${field.label}".`);
      if (field.minDate && ms < new Date(field.minDate).getTime()) throw mkError('date-too-early', `Date trop ancienne pour "${field.label}".`);
      if (field.maxDate && ms > new Date(field.maxDate).getTime()) throw mkError('date-too-late', `Date trop tardive pour "${field.label}".`);
      return new Date(ms).toISOString();
    }
  },
  select: {
    sanitizeExtra: (raw) => ({ options: sanitizeOptions(raw?.options), allowOther: Boolean(raw?.allowOther) }),
    validateAnswer: (value, field) => {
      const { empty } = requireOrEmpty(field, value);
      if (empty) return undefined;
      return validateChoiceValue(value, field);
    }
  },
  radio: {
    sanitizeExtra: (raw) => ({ options: sanitizeOptions(raw?.options), allowOther: Boolean(raw?.allowOther) }),
    validateAnswer: (value, field) => {
      const { empty } = requireOrEmpty(field, value);
      if (empty) return undefined;
      return validateChoiceValue(value, field);
    }
  },
  multiselect: {
    sanitizeExtra: (raw) => ({ options: sanitizeOptions(raw?.options), allowOther: Boolean(raw?.allowOther) }),
    validateAnswer: (value, field) => {
      const { empty } = requireOrEmpty(field, value);
      if (empty) return undefined;
      if (!Array.isArray(value)) throw mkError('invalid-multiselect', `Le champ "${field.label}" doit etre une liste.`);
      if (value.length > MAX_OPTIONS) throw mkError('too-many-selections', `Trop de choix pour "${field.label}".`);
      return value.map((v) => validateChoiceValue(v, field));
    }
  },
  checkbox: {
    sanitizeExtra: () => ({}),
    validateAnswer: validateBooleanAnswer
  },
  consent: {
    sanitizeExtra: (raw) => {
      const text = String(raw?.text || '').trim();
      if (!text) throw mkError('consent-text-required', 'Le texte de consentement est requis.');
      return { text, linkUrl: sanitizeOptionalString(raw?.linkUrl, 300) };
    },
    validateAnswer: validateBooleanAnswer
  },
  file: {
    sanitizeExtra: (raw) => ({
      fileKind: ['document', 'image'].includes(raw?.fileKind) ? raw.fileKind : 'document',
      accept: sanitizeOptionalString(raw?.accept, 200),
      maxSizeMB: clampInt(raw?.maxSizeMB, 1, 20, 10)
    }),
    validateAnswer: (value, field, context = {}) => {
      const { empty } = requireOrEmpty(field, value);
      if (empty) return undefined;
      const str = String(value).trim();
      const path = extractStoragePath(str);
      const expectedPrefix = context.formSchemaId ? `sst-form-uploads/${context.formSchemaId}/` : null;
      if (!path || !expectedPrefix || !path.startsWith(expectedPrefix)) {
        throw mkError('invalid-file-upload', `Fichier invalide pour "${field.label}".`);
      }
      return str;
    }
  },
  country: {
    sanitizeExtra: () => ({}),
    validateAnswer: (value, field) => {
      const { empty } = requireOrEmpty(field, value);
      if (empty) return undefined;
      const str = String(value).trim();
      const match = DEFAULT_COUNTRIES.find((c) => c.name === str || c.code === str.toUpperCase());
      if (!match) throw mkError('invalid-country', `Pays invalide pour "${field.label}".`);
      return match.name;
    }
  },
  sectionTitle: { isStructural: true, sanitizeExtra: () => ({}) },
  sectionText: { isStructural: true, sanitizeExtra: () => ({}) },
  divider: { isStructural: true, sanitizeExtra: () => ({}) }
};

const FIELD_TYPES = Object.keys(FIELD_TYPE_REGISTRY);

function sanitizeField(raw, index) {
  const type = String(raw?.type || '').trim();
  const entry = FIELD_TYPE_REGISTRY[type];
  if (!entry) throw mkError('invalid-field-type', `Type de champ invalide: ${type}`);

  const base = {
    id: String(raw?.id || `field_${index}`).trim() || `field_${index}`,
    type,
    required: entry.isStructural ? false : (type === 'consent' ? true : Boolean(raw?.required)),
    order: index,
    placeholder: sanitizeOptionalString(raw?.placeholder, 200),
    description: sanitizeOptionalString(raw?.description, 500),
    semantic: PERSONAL_SEMANTICS.includes(raw?.semantic) ? raw.semantic : null
  };

  if (type === 'sectionTitle') {
    const title = String(raw?.title || '').trim();
    if (!title) throw mkError('field-title-required', 'Le titre de section est requis.');
    base.title = title;
    base.description = sanitizeOptionalString(raw?.description, 500);
  } else if (type === 'sectionText') {
    const text = String(raw?.text || '').trim();
    if (!text) throw mkError('field-text-required', 'Le texte de section est requis.');
    base.text = text;
  } else if (type !== 'divider') {
    const label = String(raw?.label || '').trim();
    if (!label) throw mkError('field-label-required', 'Chaque champ doit avoir un libelle.');
    base.label = label;
  }

  return { ...base, ...entry.sanitizeExtra(raw) };
}

function sanitizeFields(fields) {
  if (!Array.isArray(fields)) throw mkError('fields-required', 'La liste des champs est requise.');
  if (fields.length > MAX_FIELDS) throw mkError('too-many-fields', `Trop de champs (maximum ${MAX_FIELDS}).`);
  return fields.map((raw, index) => sanitizeField(raw, index));
}

/**
 * Validates and normalizes one submitted answer against its field definition.
 * Returns the normalized value to persist, or `undefined` if the field is
 * structural or was left blank and is not required (caller should then omit
 * the key from the stored `answers` map). Throws { code, message } on invalid
 * input — never trust the client, per SECURITY_MODEL.md §2.
 */
function validateAnswerForField(field, rawValue, context) {
  const entry = FIELD_TYPE_REGISTRY[field.type];
  if (!entry) throw mkError('unknown-field-type', `Type de champ inconnu: ${field.type}`);
  if (entry.isStructural) return undefined;
  return entry.validateAnswer(rawValue, field, context || {});
}

module.exports = {
  FIELD_TYPES,
  FIELD_TYPE_REGISTRY,
  DEFAULT_COUNTRIES,
  sanitizeField,
  sanitizeFields,
  validateAnswerForField
};
