import { auth, authReadyPromise, db } from '../firebase-init.js?v=20260523-6';
import { getAuthManager } from '../auth.js?v=20260523-6';
import { uploadImageFile } from '../firebase-storage.js?v=20260714-1';
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import {
  createUserWithEmailAndPassword,
  getAuth as getSecondaryAuth,
  signOut,
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';
import {
  collection,
  collectionGroup,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  deleteDoc,
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const APP_VERSION = '20260802-1';
const SMART_MANAGEMENT_USER_COLLECTION = 'smartManagementUsers';
const root = document.getElementById('smart-management-root');

const MODULE_GROUPS = [
  {
    title: 'Pilotage',
    items: [
      { id: 'dashboard', title: 'Tableau de Bord', icon: 'layout-dashboard', description: 'Vue globale des ventes, commandes, stocks et alertes.' },
      { id: 'pos', title: 'Vente en magasin', icon: 'store', description: 'Encaisser une vente physique et retirer automatiquement le stock vendu.' },
      { id: 'sessions-caisse', title: 'Sessions de caisse', icon: 'monitor-dot', description: 'Ouverture, fermeture et suivi des sessions de caisse.' },
    ],
  },
  {
    title: 'Catalogue et Stock',
    items: [
      { id: 'produits', title: 'Produits', icon: 'package', description: 'Catalogue produits, variantes, SKU et codes-barres.' },
      { id: 'inventaire', title: 'Inventaire', icon: 'boxes', description: 'Vue consolidée des quantités disponibles et alertes de stock.' },
      { id: 'magasins-depots', title: 'Magasins et Dépôts', icon: 'warehouse', description: 'Gestion des lieux de stockage, magasins et dépôts.' },
      { id: 'mouvements-stock', title: 'Mouvements de Stock', icon: 'arrow-up-down', description: 'Historique des entrées, sorties et corrections de stock.' },
      { id: 'transferts', title: 'Transfert', icon: 'arrow-right-left', description: 'Transferts entre magasins, dépôts et points de vente.' },
      { id: 'inventaires-physiques', title: 'Inventaire Physique', icon: 'clipboard-check', description: 'Comptages physiques et ajustements contrôlés.' },
    ],
  },
  {
    title: 'Vente et Clients',
    items: [
      { id: 'commandes-web', title: 'Commandes en ligne', icon: 'shopping-cart', description: 'Suivi des commandes issues du site e-commerce.' },
      { id: 'clients', title: 'Clients', icon: 'users', description: 'Base clients et informations utiles au service.' },
      { id: 'fidelite', title: 'Fidélité', icon: 'heart-handshake', description: 'Programme de fidélité à brancher dans une prochaine étape.' },
      { id: 'prix-promotions', title: 'Prix et Promotion', icon: 'badge-percent', description: 'Prix, remises, codes promo et règles commerciales.' },
      { id: 'retours-remboursements', title: 'Retours et remboursements', icon: 'rotate-ccw', description: 'Gestion future des retours et remboursements.' },
    ],
  },
  {
    title: 'Administration',
    items: [
      { id: 'paiements', title: 'Paiements', icon: 'credit-card', description: 'Suivi futur des paiements et rapprochements.' },
      { id: 'recus', title: 'Reçus', icon: 'receipt-text', description: 'Reçus et documents clients.' },
      { id: 'rapports', title: 'Rapports', icon: 'chart-column', description: 'Rapports et analyses avancées.' },
      { id: 'utilisateurs-roles', title: 'Utilisateurs et Rôles', icon: 'user-cog', description: 'Permissions détaillées à compléter plus tard.' },
      { id: 'notifications', title: 'Notifications', icon: 'bell', description: 'Centre de notifications système.' },
      { id: 'journal-activite', title: 'Journal d’activité', icon: 'logs', description: 'Traçabilité des actions importantes.' },
      { id: 'parametres', title: 'Paramètres', icon: 'settings', description: 'Configuration générale du système.' },
    ],
  },
];

const ALL_MODULES = MODULE_GROUPS.flatMap((group) => group.items);
const ROLE_DEFINITIONS = {
  admin: {
    label: 'Administrateur',
    description: 'Accès complet à tous les modules, paramètres et utilisateurs.',
    modules: 'all',
  },
  manager: {
    label: 'Manager',
    description: 'Pilotage opérationnel, ventes, stock et rapports sans gestion sensible des rôles.',
    modules: [
      'dashboard',
      'pos',
      'sessions-caisse',
      'produits',
      'inventaire',
      'magasins-depots',
      'mouvements-stock',
      'transferts',
      'inventaires-physiques',
      'commandes-web',
      'clients',
      'fidelite',
      'prix-promotions',
      'retours-remboursements',
      'paiements',
      'recus',
      'rapports',
      'notifications',
      'journal-activite',
    ],
  },
  caissier: {
    label: 'Caissier / Caissière',
    description: 'Vente physique, session de caisse et reçus liés aux ventes en magasin.',
    modules: ['pos', 'sessions-caisse', 'recus'],
  },
  stock_manager: {
    label: 'Responsable stock',
    description: 'Catalogue, inventaire, mouvements, transferts et comptages physiques.',
    modules: ['dashboard', 'produits', 'inventaire', 'magasins-depots', 'mouvements-stock', 'transferts', 'inventaires-physiques', 'journal-activite'],
  },
  responsable_ecommerce: {
    label: 'Responsable e-commerce',
    description: 'Catalogue site, commandes en ligne, clients, promotions et rapports.',
    modules: ['dashboard', 'produits', 'commandes-web', 'clients', 'fidelite', 'prix-promotions', 'retours-remboursements', 'recus', 'rapports', 'notifications'],
  },
  lecture_seule: {
    label: 'Lecture seule',
    description: 'Consultation limitée du tableau de bord et des rapports.',
    modules: ['dashboard', 'rapports'],
  },
};
const ROLE_ALIASES = {
  cashier: 'caissier',
  caissiere: 'caissier',
  caissière: 'caissier',
  responsable: 'manager',
  stock: 'stock_manager',
  inventory_manager: 'stock_manager',
  responsable_stock: 'stock_manager',
  readonly: 'lecture_seule',
  read_only: 'lecture_seule',
  viewer: 'lecture_seule',
};
const allowedRoles = new Set([...Object.keys(ROLE_DEFINITIONS), ...Object.keys(ROLE_ALIASES)]);
const LOCATION_COLLECTION = 'smartManagementLocations';
const LOCATION_CODE_COLLECTION = 'smartManagementLocationCodes';
const LOCATION_FILTERS = ['all', 'store', 'warehouse', 'active', 'inactive'];
const PRODUCT_COLLECTION = 'products';
const PRODUCT_SKU_COLLECTION = 'smartManagementProductSkus';
const PRODUCT_BARCODE_COLLECTION = 'smartManagementProductBarcodes';
const STOCK_BALANCE_COLLECTION = 'smartManagementStockBalances';
const STOCK_MOVEMENT_COLLECTION = 'smartManagementStockMovements';
const STOCK_TRANSFER_COLLECTION = 'smartManagementStockTransfers';
const POS_SALES_COLLECTION = 'smartManagementPosSales';
const STOCK_OPERATION_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/smartManagementStockOperation';
const SMART_MANAGEMENT_PASSWORD_URL = 'https://us-central1-smartcutservices-9ce54.cloudfunctions.net/updateSmartManagementUserPassword';
const PRODUCT_FILTERS = ['all', 'active', 'inactive', 'simple', 'variants', 'pos', 'website', 'both', 'no-sku', 'no-barcode'];
const INVENTORY_FILTERS = ['all', 'simple', 'variants', 'in-stock', 'low-stock', 'out-of-stock', 'reserved', 'active', 'inactive'];
const MOVEMENT_TYPES = ['INITIAL_STOCK', 'RECEIPT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN'];
const TRANSFER_STATUSES = ['all', 'draft', 'pending_approval', 'approved', 'in_transit', 'partially_received', 'received', 'cancelled', 'rejected'];
const TRANSFER_ACTIONS = {
  SUBMIT: 'submit',
  APPROVE: 'approve',
  REJECT: 'reject',
  CANCEL: 'cancel',
  SHIP: 'ship',
  RECEIVE: 'receive',
};
const PRODUCT_VISIBILITIES = [
  { value: 'both', label: 'Magasin et site web' },
  { value: 'pos', label: 'Magasin seulement' },
  { value: 'website', label: 'Site web seulement' },
  { value: 'hidden', label: 'Masque partout' },
];
const WAREHOUSE_TYPES = [
  { value: 'central', label: 'Dépôt central' },
  { value: 'store', label: 'Dépôt de magasin' },
  { value: 'secondary', label: 'Dépôt secondaire' },
];
let locationModuleState = {
  locations: [],
  filter: 'all',
  search: '',
  loading: false,
  error: null,
};
let productModuleState = {
  products: [],
  categories: [],
  filter: 'all',
  category: 'all',
  search: '',
  loading: false,
  error: null,
};
let productFormState = null;
let dashboardState = {
  period: 'today',
  topProductsPeriod: 'week',
};
let inventoryModuleState = {
  products: [],
  locations: [],
  balances: [],
  movements: [],
  filter: 'all',
  location: 'all',
  category: 'all',
  search: '',
  loading: false,
  error: null,
};
let movementModuleState = {
  movements: [],
  products: [],
  locations: [],
  filterType: 'all',
  location: 'all',
  direction: 'all',
  search: '',
  loading: false,
  error: null,
};
let transferModuleState = {
  transfers: [],
  balances: [],
  products: [],
  locations: [],
  status: 'all',
  source: 'all',
  destination: 'all',
  search: '',
  loading: false,
  error: null,
};
let stockReceiptLines = [];
let stockTransferLines = [];
let posModuleState = {
  products: [],
  locations: [],
  balances: [],
  sessions: [],
  sales: [],
  locationId: '',
  search: '',
  paymentMethod: 'cash',
  discount: 0,
  amountPaid: 0,
  customerName: '',
  cart: [],
  loading: false,
  error: null,
};
let usersRolesModuleState = {
  loaded: false,
  loading: false,
  clients: [],
  search: '',
};

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function lucideIcon(name, className = '') {
  const safeName = normalizeLucideIcon(name);
  const classAttr = className ? ` class="${escapeHtml(className)}"` : '';
  return `<i data-lucide="${escapeHtml(safeName)}"${classAttr} aria-hidden="true"></i>`;
}

function normalizeLucideIcon(name) {
  const value = String(name || '').trim();
  const aliases = {
    '$': 'badge-dollar-sign',
    '%': 'badge-percent',
    '+': 'plus',
    '-': 'minus',
    '!': 'triangle-alert',
    '#': 'scan-barcode',
    '0': 'circle-off',
    A: 'badge-check',
    B: 'file-pen-line',
    D: 'package-check',
    M: 'store',
    P: 'package',
    Q: 'boxes',
    R: 'receipt-text',
    S: 'package',
    T: 'truck',
    V: 'package-plus',
    X: 'x',
    '✓': 'check',
    '●': 'circle-dot',
  };
  return aliases[value] || value || 'circle';
}

function refreshLucideIcons() {
  window.lucide?.createIcons?.({
    attrs: {
      'stroke-width': 2.15,
    },
  });
}

function scheduleLucideIcons() {
  window.requestAnimationFrame(refreshLucideIcons);
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return `${Math.round(toNumber(value)).toLocaleString('fr-FR')} HTG`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = value?.toDate?.() || new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfMonth() {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date;
}

function getOrderDate(order) {
  return order?.paidAt?.toDate?.()
    || order?.createdAt?.toDate?.()
    || order?.updatedAt?.toDate?.()
    || new Date(order?.paidAt || order?.createdAt || order?.updatedAt || 0);
}

function isPaidOrder(order) {
  const status = String(order?.status || order?.paymentStatus || '').toLowerCase();
  return ['paid', 'confirmed', 'payment_confirmed', 'completed', 'livre', 'delivered'].some((key) => status.includes(key));
}

function getOrderAmount(order) {
  const direct = toNumber(order?.amount || order?.total || order?.totalAmount || order?.grandTotal);
  if (direct > 0) return direct;
  return getOrderItems(order).reduce((sum, item) => sum + getItemLineAmount(item), 0);
}

function getItemQuantity(item = {}) {
  return Math.max(1, toNumber(item.quantity ?? item.qty ?? item.count ?? 1) || 1);
}

function getItemUnitPrice(item = {}) {
  return toNumber(
    item.price ??
    item.unitPrice ??
    item.salePrice ??
    item.finalPrice ??
    item.basePrice ??
    item.amount
  );
}

function getItemLineAmount(item = {}) {
  const direct = toNumber(
    item.lineTotal ??
    item.totalPrice ??
    item.total ??
    item.subtotal ??
    item.amountTotal
  );
  if (direct > 0) return direct;
  return getItemUnitPrice(item) * getItemQuantity(item);
}

async function safeCount(collectionRef) {
  try {
    const snap = await getCountFromServer(collectionRef);
    return snap.data().count || 0;
  } catch (error) {
    console.warn('[SMART_MANAGEMENT] count unavailable', error);
    return 0;
  }
}

async function safeGetDocs(queryRef, fallback = []) {
  try {
    const snap = await getDocs(queryRef);
    return snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
  } catch (error) {
    console.warn('[SMART_MANAGEMENT] query unavailable', error);
    return fallback;
  }
}

async function resolveAccess(user) {
  if (!user || user.isAnonymous) {
    return { allowed: false, reason: 'not-authenticated', profile: null };
  }

  const smartUserSnap = await getDoc(doc(db, SMART_MANAGEMENT_USER_COLLECTION, user.uid));
  const clientSnap = smartUserSnap.exists() ? null : await getDoc(doc(db, 'clients', user.uid));
  const profile = smartUserSnap.exists()
    ? { id: smartUserSnap.id, ...smartUserSnap.data(), smartManagementAccess: true }
    : clientSnap?.exists()
      ? { id: clientSnap.id, ...clientSnap.data() }
      : null;
  const role = normalizeSmartManagementRole(profile?.role || '');
  const dashboardAccess = profile?.dashboardAccess === true || profile?.smartManagementAccess === true;
  const allowed = dashboardAccess || allowedRoles.has(role);

  return {
    allowed,
    reason: allowed ? 'allowed' : 'forbidden',
    profile,
    role: role || 'utilisateur',
  };
}

function getSmartManagementPermissions(context = {}) {
  const role = normalizeSmartManagementRole(context.role || context.profile?.role || '');
  const smartAccess = context.profile?.smartManagementAccess === true || context.profile?.dashboardAccess === true;
  const isAdmin = role === 'admin';
  const isManager = role === 'manager';
  const isCashier = role === 'caissier';
  const isStockManager = role === 'stock_manager';
  const isEcommerce = role === 'responsable_ecommerce';
  const isReadOnly = role === 'lecture_seule';
  const allowedModules = getAllowedModulesForRole(role, smartAccess);
  const canReadLocations = isAdmin
    || isManager
    || isStockManager;
  const canReadProducts = isAdmin
    || isManager
    || isCashier
    || isStockManager
    || isEcommerce;
  const canUsePos = isAdmin || isManager || isCashier;
  const canReadSessions = isAdmin || isManager || isCashier;
  const canManageSessions = isAdmin || isManager || isCashier;
  const canReadInventory = isAdmin || isManager || isStockManager;
  const canMoveStock = isAdmin || isManager || isStockManager || isCashier;
  const canManageUsers = isAdmin;
  return {
    isAdmin,
    role,
    roleLabel: getRoleLabel(role),
    allowedModules,
    isReadOnly,
    canUsePos,
    canReadSessions,
    canManageSessions,
    canReadLocations,
    canManageLocations: isAdmin || isManager || isStockManager,
    canReadProducts,
    canManageProducts: isAdmin || isManager || isStockManager || isEcommerce,
    canReadInventory,
    canMoveStock,
    canManageUsers,
    canReadReports: isAdmin || isManager || isEcommerce || isStockManager || isReadOnly,
  };
}

function normalizeSmartManagementRole(role = '') {
  const clean = String(role || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\s-]+/g, '_');
  return ROLE_ALIASES[clean] || clean || 'client';
}

function getRoleLabel(role = '') {
  const normalized = normalizeSmartManagementRole(role);
  return ROLE_DEFINITIONS[normalized]?.label || role || 'Utilisateur';
}

function getAllowedModulesForRole(role = '', smartAccess = false) {
  const normalized = normalizeSmartManagementRole(role);
  const definition = ROLE_DEFINITIONS[normalized];
  if (definition?.modules === 'all') return new Set(ALL_MODULES.map((module) => module.id));
  if (Array.isArray(definition?.modules)) return new Set(definition.modules);
  return new Set(smartAccess ? ['dashboard'] : []);
}

function canAccessModule(route, context = {}) {
  const permissions = getSmartManagementPermissions(context);
  return permissions.allowedModules.has(route);
}

function getDefaultRouteForContext(context = {}) {
  const permissions = getSmartManagementPermissions(context);
  return permissions.allowedModules.has('dashboard')
    ? 'dashboard'
    : Array.from(permissions.allowedModules)[0] || 'dashboard';
}

function getVisibleModuleGroups(context = {}) {
  const permissions = getSmartManagementPermissions(context);
  return MODULE_GROUPS
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => permissions.allowedModules.has(item.id)),
    }))
    .filter((group) => group.items.length);
}

function normalizeLocationCode(value = '', prefix = '') {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  const cleanPrefix = prefix ? `${prefix}-` : '';
  if (!normalized) return cleanPrefix.replace(/-$/, '');
  return normalized.startsWith(cleanPrefix) ? normalized : `${cleanPrefix}${normalized}`;
}

function suggestLocationCode(name = '', kind = 'store') {
  const base = normalizeLocationCode(name)
    .replace(/^(MAGASIN|BOUTIQUE|STORE)-/, '')
    .replace(/^(DEPOT|D)-/, '');
  return normalizeLocationCode(base, kind === 'warehouse' ? 'DEP' : 'MAG');
}

function normalizeText(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validateHaitiFriendlyPhone(value = '', required = false) {
  const phone = normalizeText(value);
  if (!phone && !required) return true;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 14 && /^[0-9+\-().\s]+$/.test(phone);
}

function locationStatusLabel(status) {
  return String(status || 'active') === 'active' ? 'Actif' : 'Inactif';
}

function locationKindLabel(location) {
  if (location.kind === 'store') return 'Magasin';
  const found = WAREHOUSE_TYPES.find((type) => type.value === location.warehouseType);
  return found?.label || 'Dépôt';
}

function buildLocationSearchText(location) {
  return [
    location.name,
    location.code,
    location.address,
    location.city,
    location.phone,
    location.manager,
    location.email,
    location.parentStoreName,
  ].map((value) => String(value || '').toLowerCase()).join(' ');
}

async function loadLocations() {
  // Do not order this query in Firestore: legacy locations may not have createdAt.
  // Sorting locally keeps all valid stores and warehouses visible.
  const rows = await safeGetDocs(collection(db, LOCATION_COLLECTION));
  return rows.sort((a, b) => dateValue(b) - dateValue(a)).map((row) => ({
    ...row,
    status: row.status || 'active',
    kind: row.kind || row.type || 'store',
    searchText: buildLocationSearchText(row),
  }));
}

function collectLocationFormData(form, mode, existing = null) {
  const kind = form.dataset.kind || existing?.kind || 'store';
  const warehouseType = form.elements.warehouseType?.value || existing?.warehouseType || '';
  const status = form.elements.status?.value || 'active';
  const code = normalizeLocationCode(form.elements.code?.value, kind === 'warehouse' ? 'DEP' : 'MAG');
  const parentStoreId = form.elements.parentStoreId?.value || '';
  const parentOption = form.elements.parentStoreId?.selectedOptions?.[0];
  const parentStoreName = parentOption?.dataset.name || existing?.parentStoreName || '';

  return {
    mode,
    kind,
    warehouseType: kind === 'warehouse' ? warehouseType : '',
    name: normalizeText(form.elements.name?.value),
    code,
    address: normalizeText(form.elements.address?.value),
    city: normalizeText(form.elements.city?.value),
    phone: normalizeText(form.elements.phone?.value),
    email: normalizeText(form.elements.email?.value).toLowerCase(),
    manager: normalizeText(form.elements.manager?.value),
    status,
    parentStoreId: kind === 'warehouse' ? parentStoreId : '',
    parentStoreName: kind === 'warehouse' && parentStoreId ? parentStoreName : '',
    openingHours: normalizeText(form.elements.openingHours?.value),
    capacityNote: normalizeText(form.elements.capacityNote?.value),
    internalNote: normalizeText(form.elements.internalNote?.value),
    coordinates: normalizeText(form.elements.coordinates?.value),
  };
}

function validateLocationPayload(payload, locations = [], existing = null) {
  const errors = [];
  if (!payload.name) errors.push('Le nom est obligatoire.');
  if (!payload.code) errors.push('Le code unique est obligatoire.');
  if (!payload.address) errors.push('L’adresse est obligatoire.');
  if (!payload.city) errors.push('La ville est obligatoire.');
  if (!payload.manager) errors.push('Le responsable est obligatoire.');
  if (payload.kind === 'store' && !validateHaitiFriendlyPhone(payload.phone, true)) {
    errors.push('Le téléphone principal du magasin est obligatoire et doit être valide.');
  }
  if (payload.kind === 'warehouse') {
    if (!payload.warehouseType) errors.push('Le type de dépôt est obligatoire.');
    if (payload.phone && !validateHaitiFriendlyPhone(payload.phone, false)) {
      errors.push('Le téléphone du dépôt n’est pas valide.');
    }
    if (payload.warehouseType === 'store' && !payload.parentStoreId) {
      errors.push('Un dépôt de magasin doit être associé à un magasin actif.');
    }
    if (payload.parentStoreId) {
      const parent = locations.find((location) => location.id === payload.parentStoreId);
      if (!parent || parent.kind !== 'store' || parent.status !== 'active') {
        errors.push('Le magasin parent choisi est introuvable ou inactif.');
      }
    }
    if (payload.warehouseType === 'central' && payload.status === 'active') {
      const central = locations.find((location) => (
        location.id !== existing?.id &&
        location.kind === 'warehouse' &&
        location.warehouseType === 'central' &&
        location.status === 'active'
      ));
      if (central) {
        errors.push(`Un dépôt central actif existe déjà: ${central.name}.`);
      }
    }
  }

  const duplicate = locations.find((location) => (
    location.id !== existing?.id &&
    String(location.code || '').toUpperCase() === payload.code
  ));
  if (duplicate) errors.push(`Le code ${payload.code} est déjà utilisé.`);
  return errors;
}

async function saveLocation(payload, context, existing = null) {
  const permissions = getSmartManagementPermissions(context);
  if (!permissions.canManageLocations) {
    throw new Error('Vous n’avez pas l’autorisation de modifier les emplacements.');
  }

  const nowPayload = {
    kind: payload.kind,
    type: payload.kind,
    warehouseType: payload.warehouseType || '',
    name: payload.name,
    code: payload.code,
    address: payload.address,
    city: payload.city,
    phone: payload.phone,
    email: payload.email,
    manager: payload.manager,
    status: payload.status,
    parentStoreId: payload.parentStoreId || '',
    parentStoreName: payload.parentStoreName || '',
    openingHours: payload.openingHours || '',
    capacityNote: payload.capacityNote || '',
    internalNote: payload.internalNote || '',
    coordinates: payload.coordinates || '',
    updatedAt: serverTimestamp(),
    updatedBy: context.user?.uid || '',
  };

  if (existing?.id) {
    const locationRef = doc(db, LOCATION_COLLECTION, existing.id);
    const oldCode = String(existing.code || '').toUpperCase();
    await runTransaction(db, async (transaction) => {
      if (oldCode !== payload.code) {
        const newCodeRef = doc(db, LOCATION_CODE_COLLECTION, payload.code);
        const newCodeSnap = await transaction.get(newCodeRef);
        if (newCodeSnap.exists() && newCodeSnap.data()?.locationId !== existing.id) {
          throw new Error(`Le code ${payload.code} est déjà réservé.`);
        }
        transaction.set(newCodeRef, {
          code: payload.code,
          locationId: existing.id,
          active: true,
          updatedAt: serverTimestamp(),
          updatedBy: context.user?.uid || '',
        }, { merge: true });
        if (oldCode) {
          transaction.set(doc(db, LOCATION_CODE_COLLECTION, oldCode), {
            code: oldCode,
            locationId: existing.id,
            active: false,
            replacedBy: payload.code,
            updatedAt: serverTimestamp(),
            updatedBy: context.user?.uid || '',
          }, { merge: true });
        }
      }
      transaction.update(locationRef, nowPayload);
    });
    return existing.id;
  }

  const locationRef = doc(collection(db, LOCATION_COLLECTION));
  const codeRef = doc(db, LOCATION_CODE_COLLECTION, payload.code);
  await runTransaction(db, async (transaction) => {
    const codeSnap = await transaction.get(codeRef);
    if (codeSnap.exists() && codeSnap.data()?.active !== false) {
      throw new Error(`Le code ${payload.code} est déjà réservé.`);
    }
    transaction.set(locationRef, {
      ...nowPayload,
      createdAt: serverTimestamp(),
      createdBy: context.user?.uid || '',
    });
    transaction.set(codeRef, {
      code: payload.code,
      locationId: locationRef.id,
      active: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: context.user?.uid || '',
      updatedBy: context.user?.uid || '',
    });
  });
  return locationRef.id;
}

async function toggleLocationStatus(location, nextStatus, context) {
  const permissions = getSmartManagementPermissions(context);
  if (!permissions.canManageLocations) {
    throw new Error('Vous n’avez pas l’autorisation de modifier les emplacements.');
  }
  await updateDoc(doc(db, LOCATION_COLLECTION, location.id), {
    status: nextStatus,
    updatedAt: serverTimestamp(),
    updatedBy: context.user?.uid || '',
  });
}

function normalizeSku(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function normalizeBarcode(value = '') {
  return String(value || '').trim();
}

function reservationDocId(value = '') {
  return encodeURIComponent(String(value || '').trim()).replace(/\./g, '%2E');
}

function makeLocalId(prefix = 'variant') {
  if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function suggestProductSku(name = '', categoryName = '') {
  const base = normalizeSku([categoryName, name].filter(Boolean).join(' '))
    .split('-')
    .filter(Boolean)
    .slice(0, 5)
    .join('-');
  return base || `SCS-${Date.now().toString().slice(-6)}`;
}

function getProductName(product = {}) {
  return product.name || product.title || product.productName || 'Produit sans nom';
}

function getProductStatus(product = {}) {
  const status = String(product.status || '').toLowerCase();
  if (status === 'inactive' || product.active === false || product.isActive === false) return 'inactive';
  return 'active';
}

function getProductVariants(product = {}) {
  const source = Array.isArray(product.variants) ? product.variants
    : Array.isArray(product.variations) ? product.variations
      : [];
  return source.map((variant, index) => ({
    id: String(variant.id || variant.variantId || variant.sku || `variant-${index + 1}`),
    label: normalizeText(variant.label || variant.name || variant.title || variant.optionLabel || `Variante ${index + 1}`),
    optionKey: normalizeText(variant.optionKey || variant.combinationKey || variant.label || variant.name || ''),
    sku: normalizeSku(variant.sku || ''),
    barcode: normalizeBarcode(variant.barcode || variant.codebarre || ''),
    purchasePrice: toNumber(variant.purchasePrice || variant.costPrice || variant.buyingPrice),
    salePrice: toNumber(variant.salePrice || variant.price || variant.specificPrice || variant.prix),
    image: variant.image || variant.imageUrl || '',
    status: String(variant.status || '').toLowerCase() === 'inactive' || variant.active === false ? 'inactive' : 'active',
  }));
}

function getProductType(product = {}) {
  if (product.productType === 'variants' || product.productType === 'variant') return 'variants';
  if (product.productType === 'simple') return 'simple';
  return getProductVariants(product).length ? 'variants' : 'simple';
}

function getProductVisibility(product = {}) {
  if (PRODUCT_VISIBILITIES.some((entry) => entry.value === product.visibility)) return product.visibility;
  const website = product.visibleOnWebsite !== false && product.websiteVisible !== false;
  const pos = product.visibleOnPos !== false && product.posVisible !== false;
  if (website && pos) return 'both';
  if (website) return 'website';
  if (pos) return 'pos';
  return 'hidden';
}

function isVisibleOnPos(product = {}) {
  const visibility = getProductVisibility(product);
  return visibility === 'both' || visibility === 'pos';
}

function isVisibleOnWebsite(product = {}) {
  const visibility = getProductVisibility(product);
  return visibility === 'both' || visibility === 'website';
}

function getProductCategoryName(product = {}) {
  return product.categoryName || product.category || product.categoryLabel || product.categoryTitle || 'Categorie non definie';
}

function getProductCategoryId(product = {}) {
  return product.categoryId || product.categoryID || product.categorySlug || '';
}

function getProductMainImage(product = {}) {
  const images = Array.isArray(product.images) ? product.images : [];
  return product.image || product.imageUrl || product.mainImage || images[0] || '';
}

function getProductGalleryImages(product = {}) {
  const images = Array.isArray(product.images) ? product.images : [];
  return images.filter(Boolean);
}

function getProductSalePrice(product = {}) {
  return toNumber(product.salePrice || product.price || product.basePrice || product.prix || product.unitPrice);
}

function getProductPurchasePrice(product = {}) {
  return toNumber(product.purchasePrice || product.costPrice || product.buyingPrice || product.coutAchat);
}

function buildProductSearchText(product = {}) {
  return [
    getProductName(product),
    getProductCategoryName(product),
    product.sku,
    product.barcode,
    product.shortDescription,
    product.description,
    ...getProductVariants(product).flatMap((variant) => [variant.label, variant.sku, variant.barcode]),
  ].map((value) => String(value || '').toLowerCase()).join(' ');
}

async function loadCategories() {
  const rows = await safeGetDocs(collection(db, 'categories_list'));
  return rows
    .map((category) => ({
      id: category.id,
      name: normalizeText(category.name || category.title || category.label || category.nom || category.id),
      order: toNumber(category.order || category.position || 0),
    }))
    .filter((category) => category.name)
    .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
}

async function loadProducts() {
  const rows = await safeGetDocs(collection(db, PRODUCT_COLLECTION));
  return rows
    .map((product) => ({
      ...product,
      name: getProductName(product),
      status: getProductStatus(product),
      productType: getProductType(product),
      visibility: getProductVisibility(product),
      categoryName: getProductCategoryName(product),
      categoryId: getProductCategoryId(product),
      salePrice: getProductSalePrice(product),
      purchasePrice: getProductPurchasePrice(product),
      variants: getProductVariants(product),
      searchText: buildProductSearchText(product),
    }))
    .sort((a, b) => {
      const aDate = a.updatedAt?.toDate?.() || a.createdAt?.toDate?.() || new Date(0);
      const bDate = b.updatedAt?.toDate?.() || b.createdAt?.toDate?.() || new Date(0);
      return bDate - aDate;
    });
}

function getProductSummary(products = []) {
  return {
    total: products.length,
    active: products.filter((product) => product.status === 'active').length,
    inactive: products.filter((product) => product.status === 'inactive').length,
    simple: products.filter((product) => product.productType === 'simple').length,
    variants: products.filter((product) => product.productType === 'variants').length,
    pos: products.filter(isVisibleOnPos).length,
    website: products.filter(isVisibleOnWebsite).length,
    noSku: products.filter((product) => !product.sku && !product.variants.some((variant) => variant.sku)).length,
    noBarcode: products.filter((product) => !product.barcode && !product.variants.some((variant) => variant.barcode)).length,
  };
}

function getProductFilterLabel(filter) {
  return {
    all: 'Tous',
    active: 'Actifs',
    inactive: 'Inactifs',
    simple: 'Simples',
    variants: 'Avec variantes',
    pos: 'Visibles magasin',
    website: 'Visibles site web',
    both: 'Magasin + site web',
    'no-sku': 'Sans SKU',
    'no-barcode': 'Sans code-barres',
  }[filter] || filter;
}

function getFilteredProducts() {
  const search = String(productModuleState.search || '').trim().toLowerCase();
  return productModuleState.products.filter((product) => {
    if (productModuleState.filter === 'active' && product.status !== 'active') return false;
    if (productModuleState.filter === 'inactive' && product.status !== 'inactive') return false;
    if (productModuleState.filter === 'simple' && product.productType !== 'simple') return false;
    if (productModuleState.filter === 'variants' && product.productType !== 'variants') return false;
    if (productModuleState.filter === 'pos' && !isVisibleOnPos(product)) return false;
    if (productModuleState.filter === 'website' && !isVisibleOnWebsite(product)) return false;
    if (productModuleState.filter === 'both' && product.visibility !== 'both') return false;
    if (productModuleState.filter === 'no-sku' && (product.sku || product.variants.some((variant) => variant.sku))) return false;
    if (productModuleState.filter === 'no-barcode' && (product.barcode || product.variants.some((variant) => variant.barcode))) return false;
    if (productModuleState.category !== 'all' && product.categoryId !== productModuleState.category && product.categoryName !== productModuleState.category) return false;
    if (search && !product.searchText.includes(search)) return false;
    return true;
  });
}

async function loadPosSales(maxRows = 20) {
  const rows = await safeGetDocs(query(collection(db, POS_SALES_COLLECTION), orderBy('createdAt', 'desc'), limit(maxRows)));
  return rows.map((row) => ({
    ...row,
    total: toNumber(row.total),
    subtotal: toNumber(row.subtotal),
    discount: toNumber(row.discount),
    amountPaid: toNumber(row.amountPaid),
    changeDue: toNumber(row.changeDue),
    itemCount: toNumber(row.itemCount),
  }));
}

function getActivePosLocations(locations = []) {
  return getActiveLocations(locations).filter((location) => location.kind === 'store' || location.kind === 'warehouse');
}

function getSelectedPosLocation() {
  return posModuleState.locations.find((location) => location.id === posModuleState.locationId) || posModuleState.locations[0] || null;
}

function getOpenPosSessionsForSelectedLocation(context = {}) {
  const locationId = posModuleState.locationId;
  const currentUid = context.user?.uid || auth?.currentUser?.uid || '';
  const permissions = getSmartManagementPermissions(context);
  return posModuleState.sessions.filter((session) => {
    if (getCashSessionStatus(session) !== 'open') return false;
    if (locationId && session.locationId !== locationId) return false;
    if (permissions.isAdmin || permissions.role === 'manager') return true;
    return !session.openedBy || session.openedBy === currentUid;
  });
}

function getSelectedOpenCashSession(context = {}) {
  return getOpenPosSessionsForSelectedLocation(context)[0] || null;
}

function getPosCatalogItems() {
  const search = String(posModuleState.search || '').trim().toLowerCase();
  const locationId = posModuleState.locationId;
  const productsById = new Map(posModuleState.products.map((product) => [product.id, product]));
  return posModuleState.balances
    .filter((balance) => {
      if (locationId && balance.locationId !== locationId) return false;
      if (balance.productStatus === 'inactive') return false;
      if (balance.availableQty <= 0) return false;
      const product = productsById.get(balance.productId);
      if (!product || product.status === 'inactive' || !isVisibleOnPos(product)) return false;
      if (search && ![
        balance.productName,
        balance.variantLabel,
        balance.sku,
        balance.barcode,
        balance.categoryName,
        product.name,
        product.categoryName,
      ].map((value) => String(value || '').toLowerCase()).join(' ').includes(search)) return false;
      return true;
    })
    .map((balance) => {
      const product = productsById.get(balance.productId) || {};
      const variant = product.variants?.find((item) => item.id === balance.variantId) || null;
      const unitPrice = toNumber(balance.salePrice || variant?.salePrice || product.salePrice);
      const unitCost = toNumber(balance.unitCost || variant?.purchasePrice || product.purchasePrice);
      return {
        key: `${balance.locationId}|${balance.productId}|${balance.variantId || ''}`,
        productId: balance.productId,
        variantId: balance.variantId || '',
        productName: balance.productName || product.name || 'Produit',
        variantLabel: balance.variantLabel || variant?.label || '',
        sku: balance.sku || variant?.sku || product.sku || '',
        barcode: balance.barcode || variant?.barcode || product.barcode || '',
        categoryName: balance.categoryName || product.categoryName || '',
        locationId: balance.locationId,
        locationName: balance.locationName || '',
        availableQty: Math.max(0, toNumber(balance.availableQty)),
        unitPrice,
        unitCost,
        image: variant?.image || getProductMainImage(product),
        searchText: balance.searchText || '',
      };
    })
    .filter((item) => item.unitPrice > 0)
    .sort((a, b) => a.productName.localeCompare(b.productName));
}

function getPosCartTotals() {
  const subtotal = posModuleState.cart.reduce((sum, item) => sum + (toNumber(item.unitPrice) * toNumber(item.quantity)), 0);
  const discount = Math.min(Math.max(0, toNumber(posModuleState.discount)), subtotal);
  const total = Math.max(0, subtotal - discount);
  const amountPaid = toNumber(posModuleState.amountPaid);
  return {
    subtotal,
    discount,
    total,
    amountPaid,
    changeDue: Math.max(0, amountPaid - total),
    due: Math.max(0, total - amountPaid),
    itemCount: posModuleState.cart.reduce((sum, item) => sum + toNumber(item.quantity), 0),
  };
}

async function renderPosModule(context, options = {}) {
  const permissions = getSmartManagementPermissions(context);
  const content = document.getElementById('contentArea');
  if (!permissions.canUsePos) {
    content.innerHTML = '<div class="error-state"><strong>Accès refusé.</strong><br>Votre rôle ne permet pas d’utiliser la Vente en magasin.</div>';
    return;
  }

  if (options.reload !== false) {
    content.innerHTML = '<div class="loading-state">Chargement de la Vente en magasin...</div>';
    try {
      const [products, locations, balances, sales, sessions] = await Promise.all([
        loadProducts(),
        loadLocations(),
        loadStockBalances(),
        loadPosSales(12),
        safeCollectionDocs('smartManagementCashSessions', 80, 'openedAt'),
      ]);
      posModuleState.products = products;
      posModuleState.locations = getActivePosLocations(locations);
      posModuleState.balances = balances;
      posModuleState.sales = sales;
      posModuleState.sessions = sessions;
      if (!posModuleState.locationId || !posModuleState.locations.some((location) => location.id === posModuleState.locationId)) {
        posModuleState.locationId = posModuleState.locations[0]?.id || '';
      }
    } catch (error) {
      content.innerHTML = `
        <div class="error-state">
          <strong>Impossible de charger la Vente en magasin.</strong><br>
          ${escapeHtml(error?.message || 'Erreur Firebase inconnue.')}
          <div style="margin-top:1rem;"><button class="retry-btn" id="retryPosBtn" type="button">Réessayer</button></div>
        </div>
      `;
      document.getElementById('retryPosBtn')?.addEventListener('click', () => renderPosModule(context));
      return;
    }
  }

  const items = getPosCatalogItems();
  const totals = getPosCartTotals();
  const selectedLocation = getSelectedPosLocation();
  const openSession = getSelectedOpenCashSession(context);
  if (posModuleState.cart.length && posModuleState.amountPaid <= 0) {
    posModuleState.amountPaid = totals.total;
  }
  const displayTotals = getPosCartTotals();
  content.innerHTML = `
    <section class="pos-page">
      <div class="pos-helper-steps" aria-label="Étapes de vente en magasin">
        <div class="pos-step-card">
          <strong>1. Ouvrir la caisse</strong>
          <span>${openSession ? 'Session prête pour vendre.' : 'Ouvrez une session avant d’encaisser.'}</span>
        </div>
        <div class="pos-step-card">
          <strong>2. Ajouter les produits</strong>
          <span>Scannez un code-barres ou cherchez par nom/SKU.</span>
        </div>
        <div class="pos-step-card">
          <strong>3. Encaisser</strong>
          <span>Entrez le montant reçu, puis terminez la vente.</span>
        </div>
      </div>
      <div class="pos-shell">
        <section class="pos-catalog panel">
          <div class="panel-header">
            <div>
              <h2 class="panel-title">1. Choisir un produit</h2>
              <p class="panel-subtitle">${selectedLocation ? `Stock disponible à ${escapeHtml(selectedLocation.name)}` : 'Ajoutez d’abord un magasin ou dépôt actif.'}</p>
            </div>
            <div class="pos-live-chip ${openSession ? 'is-active' : 'is-blocked'}">
              ${lucideIcon(openSession ? 'radio' : 'circle-alert')} ${openSession ? 'Session ouverte' : 'Session requise'}
            </div>
          </div>
          <div class="panel-body">
            ${selectedLocation && !openSession ? `
              <div class="notice warning pos-session-warning">
                <strong>Ouvrez une session de caisse pour vendre à ${escapeHtml(selectedLocation.name)}.</strong>
                <span>La vente sera bloquée tant qu’aucune session de caisse ouverte n’est disponible pour cet emplacement.</span>
                <a class="secondary-btn small-btn" href="#/sessions-caisse">Ouvrir une session</a>
              </div>
            ` : ''}
            <div class="pos-toolbar">
              <label>
                <span>Emplacement</span>
                <select id="posLocationSelect">
                  ${posModuleState.locations.map((location) => `<option value="${escapeHtml(location.id)}" ${posModuleState.locationId === location.id ? 'selected' : ''}>${escapeHtml(location.name)} · ${escapeHtml(location.kind === 'warehouse' ? 'Dépôt' : 'Magasin')}</option>`).join('')}
                </select>
              </label>
              <label class="pos-search-field">
                <span>Scanner ou rechercher</span>
                <input id="posSearchInput" type="search" value="${escapeHtml(posModuleState.search)}" placeholder="Nom du produit, SKU ou code-barres..." autofocus>
              </label>
            </div>
            ${items.length ? renderPosCatalog(items, { disabled: !openSession }) : '<div class="empty-state">Aucun produit disponible pour vendre dans cet emplacement. Vérifiez le stock, la visibilité en magasin et le statut du produit.</div>'}
          </div>
        </section>

        <aside class="pos-cart panel">
          <div class="panel-header">
            <div>
              <h2 class="panel-title">2. Encaisser</h2>
              <p class="panel-subtitle">${displayTotals.itemCount} article(s)</p>
            </div>
            <button class="secondary-btn small-btn danger-outline" id="clearPosCartBtn" type="button" ${posModuleState.cart.length ? '' : 'disabled'}>Vider</button>
          </div>
          <div class="panel-body">
            ${renderPosCart(displayTotals)}
          </div>
        </aside>
      </div>

      <section class="panel pos-sales-panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Dernières ventes en magasin</h2>
            <p class="panel-subtitle">Historique rapide des dernières ventes physiques.</p>
          </div>
        </div>
        <div class="panel-body">
          ${renderPosSales(posModuleState.sales)}
        </div>
      </section>
    </section>
  `;
  bindPosEvents(context);
  scheduleLucideIcons();
}

function renderPosCatalog(items = [], options = {}) {
  const disabled = options.disabled === true;
  return `
    <div class="pos-product-grid">
      ${items.map((item) => `
        <button class="pos-product-card" type="button" data-pos-add="${escapeHtml(item.key)}" ${disabled ? 'disabled' : ''}>
          <span class="pos-product-thumb">${item.image ? `<img src="${escapeHtml(item.image)}" alt="">` : lucideIcon('package')}</span>
          <span class="pos-product-info">
            <strong>${escapeHtml(item.productName)}</strong>
            <small>${escapeHtml([item.variantLabel, item.sku].filter(Boolean).join(' · ') || 'Produit simple')}</small>
            <em>${escapeHtml(item.categoryName || 'Sans catégorie')}</em>
          </span>
          <span class="pos-product-side">
            <strong>${escapeHtml(formatMoney(item.unitPrice))}</strong>
            <small>${escapeHtml(item.availableQty)} dispo.</small>
          </span>
        </button>
      `).join('')}
    </div>
  `;
}

function renderPosCart(totals) {
  return `
    <div class="pos-cart-list">
      ${posModuleState.cart.length ? posModuleState.cart.map((item) => `
        <article class="pos-cart-item">
          <div>
            <strong>${escapeHtml(item.productName)}</strong>
            <small>${escapeHtml([item.variantLabel, item.sku].filter(Boolean).join(' · ') || 'Produit simple')}</small>
            <span>${escapeHtml(formatMoney(item.unitPrice))} / unité · ${escapeHtml(item.availableQty)} dispo.</span>
          </div>
          <div class="pos-qty-control">
            <button type="button" data-pos-qty="${escapeHtml(item.key)}" data-delta="-1" aria-label="Retirer une unité">-</button>
            <input type="number" min="1" max="${escapeHtml(item.availableQty)}" value="${escapeHtml(item.quantity)}" data-pos-qty-input="${escapeHtml(item.key)}">
            <button type="button" data-pos-qty="${escapeHtml(item.key)}" data-delta="1" aria-label="Ajouter une unité">+</button>
          </div>
          <button class="icon-btn danger-outline" type="button" data-pos-remove="${escapeHtml(item.key)}" aria-label="Retirer ce produit">${lucideIcon('trash-2')}</button>
        </article>
      `).join('') : '<div class="empty-state">Ajoutez un produit pour commencer la vente.</div>'}
    </div>

    <div class="pos-payment-box">
      <label>
        <span>Client</span>
        <input id="posCustomerNameInput" type="text" value="${escapeHtml(posModuleState.customerName)}" placeholder="Client comptoir">
      </label>
      <label>
        <span>Méthode de paiement</span>
        <select id="posPaymentMethodSelect">
          ${[
            ['cash', 'Espèces'],
            ['moncash', 'MonCash'],
            ['natcash', 'NatCash'],
            ['card', 'Carte bancaire'],
            ['mixed', 'Mixte'],
          ].map(([value, label]) => `<option value="${value}" ${posModuleState.paymentMethod === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      <label>
        <span>Remise (HTG)</span>
        <input id="posDiscountInput" type="number" min="0" step="1" value="${escapeHtml(posModuleState.discount)}">
      </label>
      <label>
        <span>Montant reçu</span>
        <input id="posAmountPaidInput" type="number" min="0" step="1" value="${escapeHtml(posModuleState.amountPaid || totals.total)}">
      </label>
    </div>

    <div class="pos-total-box">
      <div><span>Sous-total</span><strong>${escapeHtml(formatMoney(totals.subtotal))}</strong></div>
      <div><span>Remise</span><strong>- ${escapeHtml(formatMoney(totals.discount))}</strong></div>
      <div class="grand-total"><span>Total</span><strong>${escapeHtml(formatMoney(totals.total))}</strong></div>
      <div><span>Reçu</span><strong>${escapeHtml(formatMoney(totals.amountPaid))}</strong></div>
      <div><span>Monnaie</span><strong>${escapeHtml(formatMoney(totals.changeDue))}</strong></div>
    </div>
    <div class="form-error" id="posSaleError" hidden></div>
    <button class="primary-btn pos-checkout-btn" id="completePosSaleBtn" type="button" ${posModuleState.cart.length ? '' : 'disabled'}>${lucideIcon('check-circle-2')} Terminer la vente</button>
  `;
}

function renderPosSales(sales = []) {
  if (!sales.length) return '<div class="empty-state">Aucune vente en magasin enregistrée pour le moment.</div>';
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Date</th><th>Référence</th><th>Client</th><th>Articles</th><th>Paiement</th><th>Total</th><th>Statut</th></tr></thead>
        <tbody>
          ${sales.map((sale) => `
            <tr>
              <td>${escapeHtml(formatDate(sale.createdAt))}</td>
              <td><strong>${escapeHtml(sale.reference || sale.id)}</strong><br><small>${escapeHtml(sale.locationName || '-')}</small></td>
              <td>${escapeHtml(sale.customerName || 'Client comptoir')}</td>
              <td>${escapeHtml(sale.itemCount || 0)}</td>
              <td>${escapeHtml(getPaymentMethodLabel(sale.paymentMethod))}</td>
              <td><strong>${escapeHtml(formatMoney(sale.total))}</strong></td>
              <td>${statusBadge(sale.status || 'completed')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function getPaymentMethodLabel(method = '') {
  return {
    cash: 'Espèces',
    moncash: 'MonCash',
    natcash: 'NatCash',
    card: 'Carte bancaire',
    mixed: 'Mixte',
  }[method] || method || '-';
}

function bindPosEvents(context) {
  document.getElementById('posLocationSelect')?.addEventListener('change', (event) => {
    posModuleState.locationId = event.target.value || '';
    posModuleState.cart = [];
    renderPosModule(context, { reload: false });
  });
  document.getElementById('posSearchInput')?.addEventListener('input', (event) => {
    posModuleState.search = event.target.value;
    renderPosModule(context, { reload: false });
  });
  document.querySelectorAll('[data-pos-add]').forEach((button) => {
    button.addEventListener('click', () => addPosItem(button.dataset.posAdd, context));
  });
  document.querySelectorAll('[data-pos-qty]').forEach((button) => {
    button.addEventListener('click', () => updatePosItemQty(button.dataset.posQty, toNumber(button.dataset.delta), context));
  });
  document.querySelectorAll('[data-pos-qty-input]').forEach((input) => {
    input.addEventListener('change', () => setPosItemQty(input.dataset.posQtyInput, toNumber(input.value), context));
  });
  document.querySelectorAll('[data-pos-remove]').forEach((button) => {
    button.addEventListener('click', () => removePosItem(button.dataset.posRemove, context));
  });
  document.getElementById('clearPosCartBtn')?.addEventListener('click', () => {
    if (!posModuleState.cart.length) return;
    posModuleState.cart = [];
    renderPosModule(context, { reload: false });
  });
  document.getElementById('posPaymentMethodSelect')?.addEventListener('change', (event) => {
    posModuleState.paymentMethod = event.target.value || 'cash';
  });
  document.getElementById('posDiscountInput')?.addEventListener('change', (event) => {
    posModuleState.discount = Math.max(0, toNumber(event.target.value));
    renderPosModule(context, { reload: false });
  });
  document.getElementById('posAmountPaidInput')?.addEventListener('change', (event) => {
    posModuleState.amountPaid = Math.max(0, toNumber(event.target.value));
    renderPosModule(context, { reload: false });
  });
  document.getElementById('posCustomerNameInput')?.addEventListener('input', (event) => {
    posModuleState.customerName = event.target.value;
  });
  document.getElementById('completePosSaleBtn')?.addEventListener('click', () => completePosSale(context));
}

function addPosItem(key, context) {
  const item = getPosCatalogItems().find((entry) => entry.key === key);
  if (!item) return;
  const existing = posModuleState.cart.find((entry) => entry.key === key);
  if (existing) {
    existing.quantity = Math.min(existing.availableQty, existing.quantity + 1);
  } else {
    posModuleState.cart.push({ ...item, quantity: 1 });
  }
  posModuleState.amountPaid = getPosCartTotals().total;
  renderPosModule(context, { reload: false });
}

function updatePosItemQty(key, delta, context) {
  const item = posModuleState.cart.find((entry) => entry.key === key);
  if (!item) return;
  item.quantity = Math.min(item.availableQty, Math.max(1, item.quantity + delta));
  posModuleState.amountPaid = getPosCartTotals().total;
  renderPosModule(context, { reload: false });
}

function setPosItemQty(key, quantity, context) {
  const item = posModuleState.cart.find((entry) => entry.key === key);
  if (!item) return;
  item.quantity = Math.min(item.availableQty, Math.max(1, Math.round(quantity || 1)));
  posModuleState.amountPaid = getPosCartTotals().total;
  renderPosModule(context, { reload: false });
}

function removePosItem(key, context) {
  posModuleState.cart = posModuleState.cart.filter((entry) => entry.key !== key);
  posModuleState.amountPaid = getPosCartTotals().total;
  renderPosModule(context, { reload: false });
}

async function completePosSale(context) {
  const errorBox = document.getElementById('posSaleError');
  const submitBtn = document.getElementById('completePosSaleBtn');
  const totals = getPosCartTotals();
  const selectedLocation = getSelectedPosLocation();
  const openSession = getSelectedOpenCashSession(context);
  const errors = [];
  if (!selectedLocation) errors.push('Choisissez un emplacement de vente.');
  if (!openSession) errors.push('Ouvrez une session de caisse avant de terminer une vente en magasin.');
  if (!posModuleState.cart.length) errors.push('Le panier est vide.');
  if (totals.total <= 0) errors.push('Le total doit être supérieur à zéro.');
  if (totals.amountPaid < totals.total) errors.push('Le montant reçu est inférieur au total.');
  posModuleState.cart.forEach((item) => {
    if (item.quantity <= 0 || item.quantity > item.availableQty) {
      errors.push(`${item.productName}: quantité invalide.`);
    }
  });
  if (errors.length) {
    errorBox.innerHTML = errors.map(escapeHtml).join('<br>');
    errorBox.hidden = false;
    return;
  }

  const saleId = makeIdempotencyKey('pos-sale');
  const reference = `POS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${saleId.slice(-6).toUpperCase()}`;
  const saleRef = doc(collection(db, POS_SALES_COLLECTION), saleId);
  const lines = posModuleState.cart.map((item) => ({
    productId: item.productId,
    variantId: item.variantId || '',
    locationId: item.locationId,
    quantity: -Math.abs(Math.round(item.quantity)),
    unitCost: toNumber(item.unitCost),
    reason: 'Vente en magasin',
    note: reference,
  }));

  submitBtn.disabled = true;
  submitBtn.innerHTML = `${lucideIcon('loader-circle')} Validation...`;
  scheduleLucideIcons();
  try {
    await setDoc(saleRef, {
      reference,
      status: 'processing',
      locationId: selectedLocation.id,
      locationName: selectedLocation.name,
      sessionId: openSession.id,
      sessionReference: openSession.reference || '',
      customerName: normalizeText(posModuleState.customerName) || 'Client comptoir',
      paymentMethod: posModuleState.paymentMethod,
      subtotal: totals.subtotal,
      discount: totals.discount,
      total: totals.total,
      amountPaid: totals.amountPaid,
      changeDue: totals.changeDue,
      itemCount: totals.itemCount,
      items: posModuleState.cart.map((item) => ({
        productId: item.productId,
        variantId: item.variantId || '',
        productName: item.productName,
        variantLabel: item.variantLabel || '',
        sku: item.sku || '',
        barcode: item.barcode || '',
        quantity: Math.round(item.quantity),
        unitPrice: toNumber(item.unitPrice),
        unitCost: toNumber(item.unitCost),
        lineTotal: toNumber(item.unitPrice) * Math.round(item.quantity),
      })),
      cashierUid: context.user?.uid || auth?.currentUser?.uid || '',
      cashierName: context.profile?.name || context.user?.displayName || context.user?.email || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    const operationResult = await sendStockOperation({
      operationType: 'ADJUSTMENT',
      idempotencyKey: saleId,
      reference,
      reason: 'Vente en magasin',
      note: `Vente en magasin ${reference}`,
      lines,
    });
    await setDoc(saleRef, {
      status: 'completed',
      movementIds: operationResult.movementIds || [],
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    await updateDoc(doc(db, 'smartManagementCashSessions', openSession.id), {
      totalSales: increment(totals.total),
      saleCount: increment(1),
      updatedAt: serverTimestamp(),
    }).catch(() => null);
    showInlineToast(`Vente ${reference} validée.`, 'success');
    posModuleState.cart = [];
    posModuleState.discount = 0;
    posModuleState.amountPaid = 0;
    posModuleState.customerName = '';
    await renderPosModule(context);
  } catch (error) {
    await setDoc(saleRef, {
      status: 'failed',
      failureMessage: error?.message || 'Validation impossible.',
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => null);
    errorBox.innerHTML = escapeHtml(error?.message || 'Impossible de valider la vente.');
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `${lucideIcon('check-circle-2')} Valider la vente`;
    scheduleLucideIcons();
  }
}

async function renderProductsModule(context, options = {}) {
  const permissions = getSmartManagementPermissions(context);
  const content = document.getElementById('contentArea');

  if (!permissions.canReadProducts) {
    content.innerHTML = `
      <div class="error-state">
        <strong>Accès refusé.</strong><br>
        Votre rôle permet d'ouvrir Smart Management, mais pas de consulter le catalogue produits.
      </div>
    `;
    return;
  }

  if (options.reload !== false) {
    productModuleState.loading = true;
    productModuleState.error = null;
    content.innerHTML = '<div class="loading-state">Chargement du catalogue produits...</div>';
    try {
      const [products, categories] = await Promise.all([loadProducts(), loadCategories()]);
      productModuleState.products = products;
      productModuleState.categories = categories;
    } catch (error) {
      productModuleState.error = error;
      productModuleState.loading = false;
      content.innerHTML = `
        <div class="error-state">
          <strong>Impossible de charger le catalogue.</strong><br>
          ${escapeHtml(error?.message || 'Erreur Firebase inconnue.')}
          <div style="margin-top:1rem;"><button class="retry-btn" id="retryProductsBtn" type="button">Reessayer</button></div>
        </div>
      `;
      document.getElementById('retryProductsBtn')?.addEventListener('click', () => renderProductsModule(context));
      return;
    }
    productModuleState.loading = false;
  }

  const products = getFilteredProducts();
  const summary = getProductSummary(productModuleState.products);
  content.innerHTML = `
    <section class="products-page">
      <div class="module-hero product-hero">
        <div>
          <p class="eyebrow">Catalogue central</p>
          <h2>Produits Smart Cut</h2>
          <p>Gerez les produits internes Smart Cut, leurs variantes, SKU, codes-barres, prix, images et visibilites sans toucher aux produits vendeurs.</p>
        </div>
        <div class="module-actions">
          ${permissions.canManageProducts ? '<button class="primary-btn" id="addProductBtn" type="button">Ajouter un produit</button>' : '<span class="badge info">Lecture seule</span>'}
        </div>
      </div>

      <div class="stat-grid product-summary-grid">
        ${statCard('Total produits', summary.total, 'Produits Smart Cut dans products.', 'tone-blue', 'P')}
        ${statCard('Actifs', summary.active, 'Produits disponibles.', 'tone-green', '+')}
        ${statCard('Inactifs', summary.inactive, 'Produits masques sans suppression.', 'tone-gray', '-')}
        ${statCard('Simples', summary.simple, 'Produits sans variantes.', 'tone-blue', 'S')}
        ${statCard('Avec variantes', summary.variants, 'Produits declinables.', 'tone-green', 'V')}
        ${statCard('Sans SKU', summary.noSku, 'A completer pour le pilotage.', summary.noSku ? 'tone-orange' : 'tone-green', '!')}
        ${statCard('Sans code-barres', summary.noBarcode, 'À compléter pour scanner en magasin.', summary.noBarcode ? 'tone-orange' : 'tone-green', '#')}
      </div>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Liste des produits</h2>
            <p class="panel-subtitle">Recherchez, filtrez et maintenez les fiches produits. Les anciens champs restent compatibles.</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="products-toolbar">
            <input id="productSearchInput" type="search" value="${escapeHtml(productModuleState.search)}" placeholder="Rechercher nom, SKU, code-barres, categorie..." aria-label="Rechercher un produit">
            <select id="productCategoryFilter" aria-label="Filtrer par categorie">
              <option value="all">Toutes les categories</option>
              ${productModuleState.categories.map((category) => `<option value="${escapeHtml(category.id)}" ${productModuleState.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}
            </select>
            <button class="secondary-btn small-btn" type="button" id="resetProductFiltersBtn">Reinitialiser</button>
          </div>
          <div class="filter-pills product-filter-pills">
            ${PRODUCT_FILTERS.map((filter) => `
              <button type="button" class="filter-pill ${productModuleState.filter === filter ? 'is-active' : ''}" data-product-filter="${filter}">
                ${escapeHtml(getProductFilterLabel(filter))}
              </button>
            `).join('')}
          </div>
          ${products.length ? renderProductList(products, permissions) : '<div class="empty-state">Aucun produit ne correspond a ces criteres.</div>'}
        </div>
      </section>
    </section>
  `;

  document.getElementById('addProductBtn')?.addEventListener('click', () => openProductForm(context));
  document.getElementById('productSearchInput')?.addEventListener('input', (event) => {
    productModuleState.search = event.target.value;
    renderProductsModule(context, { reload: false });
  });
  document.getElementById('productCategoryFilter')?.addEventListener('change', (event) => {
    productModuleState.category = event.target.value || 'all';
    renderProductsModule(context, { reload: false });
  });
  document.getElementById('resetProductFiltersBtn')?.addEventListener('click', () => {
    productModuleState.filter = 'all';
    productModuleState.category = 'all';
    productModuleState.search = '';
    renderProductsModule(context, { reload: false });
  });
  document.querySelectorAll('[data-product-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      productModuleState.filter = button.dataset.productFilter || 'all';
      renderProductsModule(context, { reload: false });
    });
  });
  document.querySelectorAll('[data-product-action]').forEach((button) => {
    button.addEventListener('click', () => handleProductAction(button, context));
  });
}

function renderProductList(products, permissions) {
  return `
    <div class="product-list">
      ${products.map((product) => {
        const image = getProductMainImage(product);
        const margin = product.salePrice - product.purchasePrice;
        return `
          <article class="product-row">
            <div class="product-thumb">${image ? `<img src="${escapeHtml(image)}" alt="">` : '<span>IMG</span>'}</div>
            <div class="product-main">
              <div class="product-title-line">
                <strong>${escapeHtml(product.name)}</strong>
                ${statusBadge(product.status)}
              </div>
              <div class="product-meta">
                <span>${escapeHtml(product.categoryName)}</span>
                <span>${product.productType === 'variants' ? `${product.variants.length} variante(s)` : 'Produit simple'}</span>
                <span>${escapeHtml(PRODUCT_VISIBILITIES.find((item) => item.value === product.visibility)?.label || product.visibility)}</span>
              </div>
              <div class="product-codes">
                <span>SKU: ${escapeHtml(product.sku || '-')}</span>
                <span>Code-barres: ${escapeHtml(product.barcode || '-')}</span>
              </div>
            </div>
            <div class="product-price-cell">
              <strong>${escapeHtml(formatMoney(product.salePrice))}</strong>
              <small>Achat: ${escapeHtml(formatMoney(product.purchasePrice))}</small>
              <small>Marge: ${escapeHtml(formatMoney(margin))}</small>
            </div>
            <div class="row-actions">
              <button class="secondary-btn small-btn" type="button" data-product-action="view" data-id="${escapeHtml(product.id)}">Consulter</button>
              ${permissions.canManageProducts ? `
                <button class="secondary-btn small-btn" type="button" data-product-action="edit" data-id="${escapeHtml(product.id)}">Modifier</button>
                <button class="secondary-btn small-btn ${product.status === 'active' ? 'danger-outline' : 'success-outline'}" type="button" data-product-action="toggle" data-id="${escapeHtml(product.id)}">
                  ${product.status === 'active' ? 'Desactiver' : 'Activer'}
                </button>
              ` : ''}
              <button class="secondary-btn small-btn" type="button" disabled title="Disponible dans une prochaine etape">Etiquette</button>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;
}

function handleProductAction(button, context) {
  const product = productModuleState.products.find((item) => item.id === button.dataset.id);
  if (!product) return;
  const action = button.dataset.productAction;
  if (action === 'view') openProductDetails(product, context);
  if (action === 'edit') openProductForm(context, product);
  if (action === 'toggle') confirmToggleProduct(product, context);
}

function openProductDetails(product, context) {
  const variants = getProductVariants(product);
  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">Fiche produit</p>
        <h2>${escapeHtml(product.name)}</h2>
      </div>
      <button class="icon-btn" type="button" data-close-modal>×</button>
    </div>
    <div class="product-detail-layout">
      <div class="product-detail-image">${getProductMainImage(product) ? `<img src="${escapeHtml(getProductMainImage(product))}" alt="">` : '<span>Aucune image principale</span>'}</div>
      <div class="detail-grid">
        ${detailItem('Statut', product.status === 'active' ? 'Actif' : 'Inactif')}
        ${detailItem('Type', product.productType === 'variants' ? 'Produit avec variantes' : 'Produit simple')}
        ${detailItem('Catégorie', product.categoryName)}
        ${detailItem('Visibilité', PRODUCT_VISIBILITIES.find((item) => item.value === product.visibility)?.label || product.visibility)}
        ${detailItem('SKU', product.sku || '-')}
        ${detailItem('Code-barres', product.barcode || '-')}
        ${detailItem('Prix achat', formatMoney(product.purchasePrice))}
        ${detailItem('Prix vente', formatMoney(product.salePrice))}
        ${detailItem('Marge brute', formatMoney(product.salePrice - product.purchasePrice))}
        ${detailItem('Stock global ancien', product.stock ?? product.totalStock ?? '-')}
        ${detailItem('Dernière modification', formatDate(product.updatedAt))}
        ${detailItem('Créé le', formatDate(product.createdAt))}
      </div>
    </div>
    <div class="notice warning">Le stock global existant reste en lecture seule dans cette etape. Les mouvements par emplacement arrivent dans les prochaines etapes.</div>
    ${variants.length ? `
      <div class="variant-table-wrap">
        <h3>Variantes</h3>
        <table class="data-table">
          <thead><tr><th>Variante</th><th>SKU</th><th>Code-barres</th><th>Prix achat</th><th>Prix vente</th><th>Statut</th></tr></thead>
          <tbody>
            ${variants.map((variant) => `
              <tr>
                <td>${escapeHtml(variant.label)}</td>
                <td>${escapeHtml(variant.sku || '-')}</td>
                <td>${escapeHtml(variant.barcode || '-')}</td>
                <td>${escapeHtml(formatMoney(variant.purchasePrice))}</td>
                <td>${escapeHtml(formatMoney(variant.salePrice))}</td>
                <td>${statusBadge(variant.status)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}
    <div class="future-grid">
      <div class="empty-state">Historique stock: reserve pour le module mouvements.</div>
      <div class="empty-state">Etiquettes code-barres: bouton prepare, impression dans une prochaine etape.</div>
    </div>
    <div class="modal-actions">
      ${getSmartManagementPermissions(context).canManageProducts ? `<button class="primary-btn" type="button" data-product-detail-edit="${escapeHtml(product.id)}">Modifier</button>` : ''}
      <button class="secondary-btn" type="button" data-close-modal>Fermer</button>
    </div>
  `);
  document.querySelector('[data-product-detail-edit]')?.addEventListener('click', () => {
    closeModal();
    openProductForm(context, product);
  });
}

function getCategoryOptions(selectedId = '', selectedName = '') {
  const selectedValue = selectedId || (selectedName && selectedName !== 'Categorie non definie' ? selectedName : '');
  const hasSelected = selectedValue && !productModuleState.categories.some((category) => category.id === selectedValue || category.name === selectedName);
  return `
    <option value="">Selectionner une categorie...</option>
    ${hasSelected ? `<option value="${escapeHtml(selectedValue)}" data-name="${escapeHtml(selectedName || selectedValue)}" selected>${escapeHtml(selectedName || selectedValue)}</option>` : ''}
    ${productModuleState.categories.map((category) => `<option value="${escapeHtml(category.id)}" data-name="${escapeHtml(category.name)}" ${selectedId === category.id || (!selectedId && selectedName === category.name) ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}
  `;
}

function openProductForm(context, existing = null) {
  const permissions = getSmartManagementPermissions(context);
  if (!permissions.canManageProducts) return;
  const variants = getProductVariants(existing || {});
  productFormState = {
    existingId: existing?.id || '',
    options: Array.isArray(existing?.productOptions) && existing.productOptions.length
      ? existing.productOptions.map((option) => ({ name: option.name || '', values: Array.isArray(option.values) ? option.values : [] }))
      : [],
    variants,
  };
  const productType = existing ? getProductType(existing) : 'simple';
  openModal(`
    <form id="productForm" class="product-form">
      <div class="modal-header">
        <div>
          <p class="eyebrow">${existing ? 'Modification produit' : 'Nouveau produit'}</p>
          <h2>${existing ? escapeHtml(getProductName(existing)) : 'Ajouter un produit Smart Cut'}</h2>
        </div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="product-form-sections">
        <section class="form-section">
          <h3>Informations generales</h3>
          <div class="form-grid">
            ${formField('name', 'Nom du produit *', getProductName(existing || {}) === 'Produit sans nom' ? '' : getProductName(existing || {}), 'text')}
            <label class="field">
              <span>Categorie *</span>
              <select name="categoryId" required>${getCategoryOptions(getProductCategoryId(existing || {}), getProductCategoryName(existing || {}))}</select>
            </label>
            <label class="field">
              <span>Type de produit *</span>
              <select name="productType" id="productTypeSelect" required>
                <option value="simple" ${productType === 'simple' ? 'selected' : ''}>Produit simple</option>
                <option value="variants" ${productType === 'variants' ? 'selected' : ''}>Produit avec variantes</option>
              </select>
            </label>
            <label class="field">
              <span>Statut *</span>
              <select name="status" required>
                <option value="active" ${getProductStatus(existing || {}) !== 'inactive' ? 'selected' : ''}>Actif</option>
                <option value="inactive" ${getProductStatus(existing || {}) === 'inactive' ? 'selected' : ''}>Inactif</option>
              </select>
            </label>
            <label class="field">
              <span>Visibilite *</span>
              <select name="visibility" required>
                ${PRODUCT_VISIBILITIES.map((option) => `<option value="${option.value}" ${getProductVisibility(existing || {}) === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
              </select>
            </label>
            ${formField('mainImageUrl', 'Image principale (URL)', getProductMainImage(existing || {}), 'url')}
            <label class="field">
              <span>Uploader image principale</span>
              <input name="mainImageFile" type="file" accept="image/*">
            </label>
            <label class="field field-full">
              <span>Images galerie (une URL par ligne)</span>
              <textarea name="galleryUrls" rows="3">${escapeHtml(getProductGalleryImages(existing || {}).join('\n'))}</textarea>
            </label>
            <label class="field field-full">
              <span>Uploader images galerie</span>
              <input name="galleryFiles" type="file" accept="image/*" multiple>
            </label>
            <label class="field field-full">
              <span>Description courte</span>
              <textarea name="shortDescription" rows="3">${escapeHtml(existing?.shortDescription || existing?.summary || '')}</textarea>
            </label>
            <label class="field field-full">
              <span>Description longue</span>
              <textarea name="description" rows="5">${escapeHtml(existing?.description || existing?.longDescription || '')}</textarea>
            </label>
          </div>
        </section>

        <section class="form-section" id="simpleProductSection">
          <h3>SKU, code-barres et prix</h3>
          <div class="form-grid">
            ${formField('sku', 'SKU', existing?.sku || '', 'text')}
            ${formField('barcode', 'Code-barres', existing?.barcode || existing?.codebarre || '', 'text')}
            ${formField('purchasePrice', 'Prix achat', getProductPurchasePrice(existing || {}), 'number')}
            ${formField('salePrice', 'Prix vente *', getProductSalePrice(existing || {}), 'number')}
            <label class="field">
              <span>Devise</span>
              <select name="currency">
                <option value="HTG" ${(existing?.currency || 'HTG') === 'HTG' ? 'selected' : ''}>HTG</option>
                <option value="USD" ${existing?.currency === 'USD' ? 'selected' : ''}>USD</option>
              </select>
            </label>
            <label class="field">
              <span>Stock global ancien</span>
              <input value="${escapeHtml(existing?.stock ?? existing?.totalStock ?? '-')}" readonly>
            </label>
          </div>
          <div class="notice warning">Le stock global est conserve en lecture seule. Les stocks par magasin/depot seront geres dans le futur module inventaire.</div>
        </section>

        <section class="form-section" id="variantProductSection" hidden>
          <div class="section-title-line">
            <h3>Variantes</h3>
            <button class="secondary-btn small-btn" id="addVariantOptionBtn" type="button">Ajouter une option</button>
          </div>
          <p class="panel-subtitle">Exemple: Couleur = Rouge, Bleu / Taille = S, M. Generez ensuite les combinaisons.</p>
          <div id="variantBuilder"></div>
        </section>
      </div>
      <div class="form-error" id="productFormError" hidden></div>
      <div class="modal-actions">
        <button class="primary-btn" id="saveProductBtn" type="submit">${existing ? 'Enregistrer les modifications' : 'Creer le produit'}</button>
        <button class="secondary-btn" type="button" data-close-modal>Annuler</button>
      </div>
    </form>
  `);

  const form = document.getElementById('productForm');
  const categorySelect = form.elements.categoryId;
  const skuInput = form.elements.sku;
  form.elements.name?.addEventListener('input', () => {
    if (!existing && !skuInput.dataset.touched) {
      const selected = categorySelect.selectedOptions?.[0]?.dataset.name || '';
      skuInput.value = suggestProductSku(form.elements.name.value, selected);
    }
  });
  categorySelect?.addEventListener('change', () => {
    if (!existing && !skuInput.dataset.touched) {
      const selected = categorySelect.selectedOptions?.[0]?.dataset.name || '';
      skuInput.value = suggestProductSku(form.elements.name.value, selected);
    }
  });
  skuInput?.addEventListener('input', () => {
    skuInput.dataset.touched = 'true';
    skuInput.value = normalizeSku(skuInput.value);
  });
  form.elements.barcode?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') event.preventDefault();
  });
  form.elements.barcode?.addEventListener('input', (event) => {
    event.target.value = normalizeBarcode(event.target.value);
  });
  form.elements.productType?.addEventListener('change', updateProductTypeSections);
  document.getElementById('addVariantOptionBtn')?.addEventListener('click', () => {
    productFormState.options.push({ name: '', values: [] });
    renderVariantBuilder();
  });
  updateProductTypeSections();
  renderVariantBuilder();
  form.addEventListener('submit', (event) => submitProductForm(event, context, existing));
}

function updateProductTypeSections() {
  const form = document.getElementById('productForm');
  if (!form) return;
  const isVariant = form.elements.productType?.value === 'variants';
  document.getElementById('variantProductSection').hidden = !isVariant;
  document.getElementById('simpleProductSection').classList.toggle('is-variant-mode', isVariant);
}

function renderVariantBuilder() {
  const container = document.getElementById('variantBuilder');
  if (!container || !productFormState) return;
  container.innerHTML = `
    <div class="variant-options">
      ${productFormState.options.map((option, index) => `
        <div class="variant-option-row">
          <label class="field">
            <span>Nom option</span>
            <input type="text" value="${escapeHtml(option.name)}" data-variant-option-name="${index}" placeholder="Couleur, Taille...">
          </label>
          <label class="field">
            <span>Valeurs separees par virgule</span>
            <input type="text" value="${escapeHtml((option.values || []).join(', '))}" data-variant-option-values="${index}" placeholder="Rouge, Bleu, Noir">
          </label>
          <button class="secondary-btn small-btn danger-outline" type="button" data-remove-variant-option="${index}">Retirer</button>
        </div>
      `).join('')}
    </div>
    <div class="modal-actions compact-actions">
      <button class="secondary-btn" id="generateVariantsBtn" type="button">Generer les combinaisons</button>
      <button class="secondary-btn" id="copyParentPricesBtn" type="button">Copier les prix parents</button>
    </div>
    ${productFormState.variants.length ? `
      <div class="variant-edit-list">
        ${productFormState.variants.map((variant, index) => `
          <article class="variant-edit-row">
            <div class="variant-label">${escapeHtml(variant.label || `Variante ${index + 1}`)}</div>
            <input type="text" value="${escapeHtml(variant.sku || '')}" data-variant-field="sku" data-index="${index}" placeholder="SKU">
            <input type="text" value="${escapeHtml(variant.barcode || '')}" data-variant-field="barcode" data-index="${index}" placeholder="Code-barres">
            <input type="number" min="0" step="0.01" value="${escapeHtml(variant.purchasePrice || 0)}" data-variant-field="purchasePrice" data-index="${index}" placeholder="Prix achat">
            <input type="number" min="0" step="0.01" value="${escapeHtml(variant.salePrice || 0)}" data-variant-field="salePrice" data-index="${index}" placeholder="Prix vente">
            <input type="url" value="${escapeHtml(variant.image || '')}" data-variant-field="image" data-index="${index}" placeholder="Image URL">
            <select data-variant-field="status" data-index="${index}">
              <option value="active" ${variant.status !== 'inactive' ? 'selected' : ''}>Actif</option>
              <option value="inactive" ${variant.status === 'inactive' ? 'selected' : ''}>Inactif</option>
            </select>
          </article>
        `).join('')}
      </div>
    ` : '<div class="empty-state">Aucune variante generee pour le moment.</div>'}
  `;

  container.querySelectorAll('[data-variant-option-name]').forEach((input) => {
    input.addEventListener('input', () => {
      const index = Number(input.dataset.variantOptionName);
      productFormState.options[index].name = normalizeText(input.value);
    });
  });
  container.querySelectorAll('[data-variant-option-values]').forEach((input) => {
    input.addEventListener('input', () => {
      const index = Number(input.dataset.variantOptionValues);
      productFormState.options[index].values = input.value.split(',').map(normalizeText).filter(Boolean);
    });
  });
  container.querySelectorAll('[data-remove-variant-option]').forEach((button) => {
    button.addEventListener('click', () => {
      productFormState.options.splice(Number(button.dataset.removeVariantOption), 1);
      renderVariantBuilder();
    });
  });
  container.querySelectorAll('[data-variant-field]').forEach((input) => {
    input.addEventListener('input', () => updateVariantField(input));
    input.addEventListener('change', () => updateVariantField(input));
  });
  document.getElementById('generateVariantsBtn')?.addEventListener('click', generateVariantCombinations);
  document.getElementById('copyParentPricesBtn')?.addEventListener('click', () => {
    const form = document.getElementById('productForm');
    const purchasePrice = toNumber(form?.elements.purchasePrice?.value);
    const salePrice = toNumber(form?.elements.salePrice?.value);
    productFormState.variants = productFormState.variants.map((variant) => ({
      ...variant,
      purchasePrice,
      salePrice,
    }));
    renderVariantBuilder();
  });
}

function updateVariantField(input) {
  const index = Number(input.dataset.index);
  const field = input.dataset.variantField;
  if (!productFormState?.variants[index]) return;
  let value = input.value;
  if (field === 'sku') value = normalizeSku(value);
  if (field === 'barcode') value = normalizeBarcode(value);
  if (field === 'purchasePrice' || field === 'salePrice') value = toNumber(value);
  productFormState.variants[index][field] = value;
}

function generateVariantCombinations() {
  const form = document.getElementById('productForm');
  const options = productFormState.options
    .filter((option) => option.name && Array.isArray(option.values) && option.values.length)
    .map((option) => ({ name: option.name, values: option.values }));
  if (!options.length) {
    showInlineToast('Ajoutez au moins une option avec des valeurs.', 'error');
    return;
  }
  const combinations = options.reduce((acc, option) => (
    acc.flatMap((combo) => option.values.map((value) => [...combo, { name: option.name, value }]))
  ), [[]]);
  const existingByKey = new Map(productFormState.variants.map((variant) => [variant.optionKey || variant.label, variant]));
  const baseSku = normalizeSku(form?.elements.sku?.value || suggestProductSku(form?.elements.name?.value || 'Produit'));
  const purchasePrice = toNumber(form?.elements.purchasePrice?.value);
  const salePrice = toNumber(form?.elements.salePrice?.value);
  productFormState.variants = combinations.map((parts, index) => {
    const label = parts.map((part) => `${part.name}: ${part.value}`).join(' / ');
    const key = parts.map((part) => `${part.name}=${part.value}`).join('|');
    const existing = existingByKey.get(key) || existingByKey.get(label);
    const suffix = normalizeSku(parts.map((part) => part.value).join('-'));
    return {
      id: existing?.id || makeLocalId('variant'),
      label,
      optionKey: key,
      sku: existing?.sku || normalizeSku(`${baseSku}-${suffix || index + 1}`),
      barcode: existing?.barcode || '',
      purchasePrice: existing?.purchasePrice || purchasePrice,
      salePrice: existing?.salePrice || salePrice,
      image: existing?.image || '',
      status: existing?.status || 'active',
    };
  });
  renderVariantBuilder();
}

async function uploadProductImagesIfNeeded(form, payload, productId = 'draft') {
  const folderBase = `products/smart-management/${productId || 'draft'}`;
  const mainFile = form.elements.mainImageFile?.files?.[0];
  if (mainFile) {
    const uploaded = await uploadImageFile(mainFile, `${folderBase}/main`, { maxSizeMb: 8 });
    payload.image = uploaded.url;
    payload.imagePath = uploaded.path;
  }
  const galleryFiles = Array.from(form.elements.galleryFiles?.files || []);
  if (galleryFiles.length) {
    const uploadedGallery = [];
    for (const file of galleryFiles) {
      const uploaded = await uploadImageFile(file, `${folderBase}/gallery`, { maxSizeMb: 8 });
      uploadedGallery.push(uploaded.url);
    }
    payload.images = [...(payload.images || []), ...uploadedGallery].filter(Boolean);
  }
}

async function submitProductForm(event, context, existing = null) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = document.getElementById('productFormError');
  const submitBtn = document.getElementById('saveProductBtn');
  errorBox.hidden = true;
  const payload = collectProductFormData(form, existing);
  const errors = validateProductPayload(payload, productModuleState.products, existing);
  if (errors.length) {
    errorBox.innerHTML = errors.map((error) => `<div>${escapeHtml(error)}</div>`).join('');
    errorBox.hidden = false;
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Enregistrement...';
  try {
    await uploadProductImagesIfNeeded(form, payload, existing?.id || 'new');
    await saveProduct(payload, context, existing);
    closeModal();
    showInlineToast(existing ? 'Produit modifié avec succès.' : 'Produit créé avec succès.', 'success');
    await renderProductsModule(context);
  } catch (error) {
    console.error('[SMART_MANAGEMENT] product save error', error);
    errorBox.innerHTML = escapeHtml(error?.message || 'Impossible d enregistrer ce produit.');
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = existing ? 'Enregistrer les modifications' : 'Créer le produit';
  }
}

function collectProductFormData(form, existing = null) {
  const categoryOption = form.elements.categoryId?.selectedOptions?.[0];
  const visibility = form.elements.visibility?.value || 'both';
  const productType = form.elements.productType?.value || 'simple';
  const galleryUrls = String(form.elements.galleryUrls?.value || '')
    .split(/\r?\n/)
    .map(normalizeText)
    .filter(Boolean);
  const image = normalizeText(form.elements.mainImageUrl?.value) || getProductMainImage(existing || {});
  const variants = productType === 'variants'
    ? (productFormState?.variants || []).map((variant) => ({
      id: variant.id || makeLocalId('variant'),
      label: normalizeText(variant.label),
      optionKey: normalizeText(variant.optionKey || variant.label),
      sku: normalizeSku(variant.sku || ''),
      barcode: normalizeBarcode(variant.barcode || ''),
      purchasePrice: toNumber(variant.purchasePrice),
      salePrice: toNumber(variant.salePrice),
      price: toNumber(variant.salePrice),
      image: normalizeText(variant.image || ''),
      status: variant.status === 'inactive' ? 'inactive' : 'active',
      active: variant.status !== 'inactive',
    }))
    : [];
  return {
    name: normalizeText(form.elements.name?.value),
    title: normalizeText(form.elements.name?.value),
    categoryId: form.elements.categoryId?.value || '',
    categoryName: form.elements.categoryId?.value ? (categoryOption?.dataset.name || categoryOption?.textContent || '') : '',
    shortDescription: normalizeText(form.elements.shortDescription?.value),
    description: normalizeText(form.elements.description?.value),
    image,
    images: Array.from(new Set([image, ...galleryUrls].filter(Boolean))),
    productType,
    hasVariants: productType === 'variants',
    status: form.elements.status?.value || 'active',
    active: (form.elements.status?.value || 'active') === 'active',
    visibility,
    visibleOnPos: visibility === 'both' || visibility === 'pos',
    visibleOnWebsite: visibility === 'both' || visibility === 'website',
    sku: normalizeSku(form.elements.sku?.value),
    barcode: normalizeBarcode(form.elements.barcode?.value),
    purchasePrice: toNumber(form.elements.purchasePrice?.value),
    salePrice: toNumber(form.elements.salePrice?.value),
    price: toNumber(form.elements.salePrice?.value),
    currency: form.elements.currency?.value || 'HTG',
    productOptions: productType === 'variants' ? (productFormState?.options || []).map((option) => ({
      name: normalizeText(option.name),
      values: (option.values || []).map(normalizeText).filter(Boolean),
    })).filter((option) => option.name && option.values.length) : [],
    variants,
  };
}

function validateProductPayload(payload, products = [], existing = null) {
  const errors = [];
  if (!payload.name) errors.push('Le nom du produit est obligatoire.');
  if (!payload.categoryId && !payload.categoryName) errors.push('La categorie est obligatoire.');
  if (payload.salePrice <= 0) errors.push('Le prix de vente doit etre superieur a zero.');
  if (payload.purchasePrice < 0) errors.push('Le prix achat ne peut pas etre negatif.');
  if (payload.productType === 'variants' && !payload.variants.length) errors.push('Un produit avec variantes doit avoir au moins une variante.');
  payload.variants.forEach((variant, index) => {
    if (!variant.label) errors.push(`La variante ${index + 1} doit avoir un libelle.`);
    if (variant.salePrice <= 0) errors.push(`La variante ${variant.label || index + 1} doit avoir un prix de vente valide.`);
  });

  const localRefs = [
    payload.sku ? `sku:${payload.sku}` : '',
    payload.barcode ? `barcode:${payload.barcode}` : '',
    ...payload.variants.flatMap((variant) => [
      variant.sku ? `sku:${variant.sku}` : '',
      variant.barcode ? `barcode:${variant.barcode}` : '',
    ]),
  ].filter(Boolean);
  const duplicateLocal = localRefs.find((entry, index) => localRefs.indexOf(entry) !== index);
  if (duplicateLocal) errors.push(`Doublon dans ce produit: ${duplicateLocal.replace(':', ' ')}.`);

  const otherReservations = new Map();
  products.filter((product) => product.id !== existing?.id).forEach((product) => {
    if (product.sku) otherReservations.set(`sku:${normalizeSku(product.sku)}`, product.name);
    if (product.barcode) otherReservations.set(`barcode:${normalizeBarcode(product.barcode)}`, product.name);
    getProductVariants(product).forEach((variant) => {
      if (variant.sku) otherReservations.set(`sku:${normalizeSku(variant.sku)}`, product.name);
      if (variant.barcode) otherReservations.set(`barcode:${normalizeBarcode(variant.barcode)}`, product.name);
    });
  });
  const duplicateExisting = localRefs.find((entry) => otherReservations.has(entry));
  if (duplicateExisting) errors.push(`${duplicateExisting.replace(':', ' ')} est deja utilise par ${otherReservations.get(duplicateExisting)}.`);
  return errors;
}

function productReservationEntries(payload, productId) {
  const entries = [];
  if (payload.sku) entries.push({ type: 'sku', value: payload.sku, productId, variantId: '' });
  if (payload.barcode) entries.push({ type: 'barcode', value: payload.barcode, productId, variantId: '' });
  (payload.variants || []).forEach((variant) => {
    if (variant.sku) entries.push({ type: 'sku', value: variant.sku, productId, variantId: variant.id });
    if (variant.barcode) entries.push({ type: 'barcode', value: variant.barcode, productId, variantId: variant.id });
  });
  return entries;
}

function existingProductReservationEntries(product = {}) {
  const normalized = {
    sku: normalizeSku(product.sku || ''),
    barcode: normalizeBarcode(product.barcode || ''),
    variants: getProductVariants(product),
  };
  return productReservationEntries(normalized, product.id);
}

async function saveProduct(payload, context, existing = null) {
  const permissions = getSmartManagementPermissions(context);
  if (!permissions.canManageProducts) {
    throw new Error('Vous n avez pas l autorisation de modifier le catalogue produits.');
  }
  const productRef = existing?.id ? doc(db, PRODUCT_COLLECTION, existing.id) : doc(collection(db, PRODUCT_COLLECTION));
  const productId = existing?.id || productRef.id;
  const nextEntries = productReservationEntries(payload, productId);
  const oldEntries = existing ? existingProductReservationEntries(existing) : [];
  const payloadToSave = {
    ...payload,
    smartManagement: {
      managed: true,
      version: APP_VERSION,
      updatedAt: new Date().toISOString(),
    },
    updatedAt: serverTimestamp(),
    updatedBy: context.user?.uid || '',
  };
  if (!existing?.id) {
    payloadToSave.createdAt = serverTimestamp();
    payloadToSave.createdBy = context.user?.uid || '';
    payloadToSave.source = 'smart-management';
  }

  await runTransaction(db, async (transaction) => {
    const refsToRead = nextEntries.map((entry) => {
      const collectionName = entry.type === 'sku' ? PRODUCT_SKU_COLLECTION : PRODUCT_BARCODE_COLLECTION;
      return { entry, ref: doc(db, collectionName, reservationDocId(entry.value)) };
    });
    const snaps = [];
    for (const item of refsToRead) {
      snaps.push({ ...item, snap: await transaction.get(item.ref) });
    }
    snaps.forEach(({ entry, snap }) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.active !== false && data.productId && data.productId !== productId) {
          throw new Error(`${entry.type === 'sku' ? 'SKU' : 'Code-barres'} ${entry.value} est deja reserve.`);
        }
      }
    });
    oldEntries.forEach((entry) => {
      const stillUsed = nextEntries.some((next) => next.type === entry.type && next.value === entry.value);
      if (!stillUsed) {
        const collectionName = entry.type === 'sku' ? PRODUCT_SKU_COLLECTION : PRODUCT_BARCODE_COLLECTION;
        transaction.set(doc(db, collectionName, reservationDocId(entry.value)), {
          value: entry.value,
          productId,
          variantId: entry.variantId || '',
          type: entry.type,
          active: false,
          releasedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          updatedBy: context.user?.uid || '',
        }, { merge: true });
      }
    });
    nextEntries.forEach((entry) => {
      const collectionName = entry.type === 'sku' ? PRODUCT_SKU_COLLECTION : PRODUCT_BARCODE_COLLECTION;
      transaction.set(doc(db, collectionName, reservationDocId(entry.value)), {
        value: entry.value,
        productId,
        variantId: entry.variantId || '',
        type: entry.type,
        active: true,
        updatedAt: serverTimestamp(),
        updatedBy: context.user?.uid || '',
      }, { merge: true });
    });
    if (existing?.id) {
      transaction.update(productRef, payloadToSave);
    } else {
      transaction.set(productRef, payloadToSave);
    }
  });
  return productId;
}

function confirmToggleProduct(product, context) {
  const nextStatus = product.status === 'active' ? 'inactive' : 'active';
  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">Confirmation</p>
        <h2>${nextStatus === 'inactive' ? 'Desactiver' : 'Activer'} ${escapeHtml(product.name)}</h2>
      </div>
      <button class="icon-btn" type="button" data-close-modal>×</button>
    </div>
    <p class="modal-copy">
      ${nextStatus === 'inactive'
        ? 'Le produit sera masque des nouveaux usages, mais son historique restera conserve.'
        : 'Le produit redeviendra disponible selon sa visibilite POS/site web.'}
    </p>
    <div class="modal-actions">
      <button class="primary-btn" id="confirmToggleProductBtn" type="button">Confirmer</button>
      <button class="secondary-btn" type="button" data-close-modal>Annuler</button>
    </div>
  `);
  document.getElementById('confirmToggleProductBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('confirmToggleProductBtn');
    btn.disabled = true;
    btn.textContent = 'Traitement...';
    try {
      await updateDoc(doc(db, PRODUCT_COLLECTION, product.id), {
        status: nextStatus,
        active: nextStatus === 'active',
        updatedAt: serverTimestamp(),
        updatedBy: context.user?.uid || '',
      });
      closeModal();
      showInlineToast(`Produit ${nextStatus === 'inactive' ? 'desactive' : 'active'} avec succes.`, 'success');
      await renderProductsModule(context);
    } catch (error) {
      btn.disabled = false;
      btn.textContent = 'Reessayer';
      showInlineToast(error?.message || 'Action impossible.', 'error');
    }
  });
}

function makeIdempotencyKey(prefix = 'stock') {
  if (window.crypto?.randomUUID) return `${prefix}-${window.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getStockReferenceOptions(products = []) {
  const options = [];
  products.filter((product) => product.status !== 'inactive').forEach((product) => {
    const variants = getProductVariants(product).filter((variant) => variant.status !== 'inactive');
    if (variants.length || product.productType === 'variants') {
      variants.forEach((variant) => {
        options.push({
          key: `${product.id}|${variant.id}`,
          productId: product.id,
          variantId: variant.id,
          label: `${product.name} / ${variant.label}`,
          sku: variant.sku,
          barcode: variant.barcode,
          oldStock: '-',
          unitCost: variant.purchasePrice || product.purchasePrice || 0,
        });
      });
    } else {
      options.push({
        key: `${product.id}|`,
        productId: product.id,
        variantId: '',
        label: product.name,
        sku: product.sku,
        barcode: product.barcode,
        oldStock: product.stock ?? product.totalStock ?? '-',
        unitCost: product.purchasePrice || 0,
      });
    }
  });
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

function getActiveLocations(locations = []) {
  return locations.filter((location) => location.status === 'active');
}

async function loadStockBalances() {
  const rows = await safeGetDocs(query(collection(db, STOCK_BALANCE_COLLECTION), orderBy('updatedAt', 'desc'), limit(300)));
  return rows.map((row) => ({
    ...row,
    physicalQty: toNumber(row.physicalQty),
    reservedQty: toNumber(row.reservedQty),
    availableQty: toNumber(row.availableQty ?? (toNumber(row.physicalQty) - toNumber(row.reservedQty))),
    lowStockThreshold: Math.max(0, toNumber(row.lowStockThreshold || 5)),
    searchText: [
      row.productName,
      row.variantLabel,
      row.sku,
      row.barcode,
      row.categoryName,
      row.locationName,
    ].map((value) => String(value || '').toLowerCase()).join(' '),
  }));
}

async function loadStockMovements(maxRows = 300) {
  const rows = await safeGetDocs(query(collection(db, STOCK_MOVEMENT_COLLECTION), orderBy('createdAt', 'desc'), limit(maxRows)));
  return rows.map((row) => ({
    ...row,
    quantityChange: toNumber(row.quantityChange),
    afterPhysicalQty: toNumber(row.afterPhysicalQty),
    beforePhysicalQty: toNumber(row.beforePhysicalQty),
    searchText: [
      row.reference,
      row.productName,
      row.variantLabel,
      row.sku,
      row.barcode,
      row.locationName,
      row.reason,
    ].map((value) => String(value || '').toLowerCase()).join(' '),
  }));
}

async function loadStockTransfers(maxRows = 250) {
  const rows = await safeGetDocs(query(collection(db, STOCK_TRANSFER_COLLECTION), orderBy('updatedAt', 'desc'), limit(maxRows)));
  return rows.map((row) => {
    const lines = Array.isArray(row.lines) ? row.lines : [];
    return {
      ...row,
      lines,
      totalRequestedQty: lines.reduce((sum, line) => sum + toNumber(line.requestedQty), 0),
      totalShippedQty: lines.reduce((sum, line) => sum + toNumber(line.shippedQty), 0),
      totalReceivedQty: lines.reduce((sum, line) => sum + toNumber(line.receivedQty), 0),
      searchText: [
        row.transferNumber,
        row.reference,
        row.sourceLocationName,
        row.destinationLocationName,
        row.createdByName,
        row.createdBy,
        row.approvedBy,
        row.shippedBy,
        row.receivedBy,
        ...lines.flatMap((line) => [line.productName, line.variantLabel, line.sku, line.barcode]),
      ].map((value) => String(value || '').toLowerCase()).join(' '),
    };
  });
}

function getTransferStatusLabel(status) {
  return {
    draft: 'Brouillon',
    pending_approval: 'En attente',
    approved: 'Approuve',
    in_transit: 'En transit',
    partially_received: 'Reçu partiellement',
    received: 'Reçu',
    cancelled: 'Annule',
    rejected: 'Refuse',
  }[status] || status || '-';
}

function transferStatusBadge(status) {
  const tone = {
    draft: 'muted',
    pending_approval: 'warning',
    approved: 'info',
    in_transit: 'warning',
    partially_received: 'warning',
    received: 'success',
    cancelled: 'danger',
    rejected: 'danger',
  }[status] || 'muted';
  return `<span class="badge ${tone}">${escapeHtml(getTransferStatusLabel(status))}</span>`;
}

function getRecordDate(record = {}) {
  return record?.createdAt?.toDate?.()
    || record?.updatedAt?.toDate?.()
    || record?.paidAt?.toDate?.()
    || record?.completedAt?.toDate?.()
    || new Date(record?.createdAt || record?.updatedAt || record?.paidAt || record?.completedAt || 0);
}

function dateValue(record = {}) {
  const date = getRecordDate(record);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

async function safeCollectionDocs(collectionName, maxRows = 80, orderField = 'createdAt') {
  const withOrder = await safeGetDocs(query(collection(db, collectionName), orderBy(orderField, 'desc'), limit(maxRows)), null);
  if (Array.isArray(withOrder)) return withOrder;
  return safeGetDocs(query(collection(db, collectionName), limit(maxRows)), []);
}

function moduleKpi(label, value, icon = 'circle', tone = 'tone-blue') {
  return `
    <article class="module-kpi ${escapeHtml(tone)}">
      <span>${lucideIcon(icon)}</span>
      <div>
        <small>${escapeHtml(label)}</small>
        <strong>${escapeHtml(value)}</strong>
      </div>
    </article>
  `;
}

function renderOperationalModuleShell({ eyebrow, title, description, icon = 'layout-dashboard', kpis = [], toolbar = '', body = '', side = '' }) {
  return `
    <section class="ops-module-page">
      <div class="module-hero ops-hero">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(description)}</p>
        </div>
        <div class="ops-hero-icon">${lucideIcon(icon)}</div>
      </div>
      ${kpis.length ? `<div class="ops-kpi-grid">${kpis.join('')}</div>` : ''}
      <div class="ops-module-grid ${side ? '' : 'single'}">
        <section class="panel">
          <div class="panel-body">
            ${toolbar}
            ${body}
          </div>
        </section>
        ${side ? `<aside class="panel"><div class="panel-body">${side}</div></aside>` : ''}
      </div>
    </section>
  `;
}

function renderRecordsTable(records = [], columns = [], emptyText = 'Aucune donnée disponible.') {
  if (!records.length) return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  return `
    <div class="table-wrap ops-table-wrap">
      <table class="data-table ops-table">
        <thead>
          <tr>${columns.map((column) => `<th>${escapeHtml(column.label)}</th>`).join('')}</tr>
        </thead>
        <tbody>
          ${records.map((record) => `
            <tr>
              ${columns.map((column) => `<td>${column.render ? column.render(record) : escapeHtml(record?.[column.key] ?? '-')}</td>`).join('')}
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderCollectionToolbar({ idPrefix, search = '', filters = [] }) {
  return `
    <div class="ops-toolbar">
      <label>
        <span>Recherche</span>
        <input id="${escapeHtml(idPrefix)}SearchInput" type="search" value="${escapeHtml(search)}" placeholder="Rechercher...">
      </label>
      ${filters.map((filter) => `
        <label>
          <span>${escapeHtml(filter.label)}</span>
          <select id="${escapeHtml(filter.id)}">
            ${filter.options.map((option) => `<option value="${escapeHtml(option.value)}" ${filter.value === option.value ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
          </select>
        </label>
      `).join('')}
    </div>
  `;
}

function recordMatchesSearch(record = {}, search = '') {
  const needle = String(search || '').trim().toLowerCase();
  if (!needle) return true;
  return JSON.stringify(record).toLowerCase().includes(needle);
}

function orderStatusLabel(order = {}) {
  return order.status || order.paymentStatus || order.orderStatus || 'en attente';
}

function getClientDisplayName(client = {}) {
  return [client.firstName || client.prenom, client.lastName || client.nom]
    .filter(Boolean)
    .join(' ')
    || client.name
    || client.username
    || client.displayName
    || client.email
    || client.id
    || 'Client';
}

function getOrderStoreNames(order = {}) {
  const items = getOrderItems(order);
  const names = new Set(items.map((item) => getOrderStoreName(item, order)).filter(Boolean));
  return Array.from(names).join(', ') || order.storeName || order.vendorName || 'Smart Cut Services';
}

function getCashSessionStatus(session = {}) {
  return String(session.status || '').toLowerCase() === 'closed' ? 'closed' : 'open';
}

function renderSimpleRecordList(title, records = [], formatter = null) {
  return `
    <div class="ops-side-list">
      <h3>${escapeHtml(title)}</h3>
      ${records.length ? records.slice(0, 8).map((record) => formatter ? formatter(record) : `
        <div class="ops-side-item">
          <strong>${escapeHtml(record.name || record.title || record.reference || record.id)}</strong>
          <small>${escapeHtml(formatDate(record.createdAt || record.updatedAt))}</small>
        </div>
      `).join('') : '<div class="empty-state">Aucun élément récent.</div>'}
    </div>
  `;
}

async function renderSessionsModule(context, options = {}) {
  const content = document.getElementById('contentArea');
  const permissions = getSmartManagementPermissions(context);
  if (!permissions.canReadSessions) {
    content.innerHTML = '<div class="error-state"><strong>Accès refusé.</strong><br>Votre rôle ne permet pas de consulter les sessions de caisse.</div>';
    return;
  }
  const [sessions, locations, sales] = await Promise.all([
    safeCollectionDocs('smartManagementCashSessions', 80, 'openedAt'),
    loadLocations(),
    loadPosSales(40),
  ]);
  const activeLocations = getActivePosLocations(locations);
  const openSessions = sessions.filter((session) => getCashSessionStatus(session) === 'open');
  content.innerHTML = renderOperationalModuleShell({
    eyebrow: 'Caisse',
    title: 'Sessions de caisse',
    description: 'Ouvrez, suivez et clôturez les journées de caisse par magasin ou dépôt.',
    icon: 'monitor-dot',
    kpis: [
      moduleKpi('Sessions ouvertes', openSessions.length, 'unlock', 'tone-green'),
      moduleKpi('Sessions clôturées', sessions.filter((session) => getCashSessionStatus(session) === 'closed').length, 'lock', 'tone-gray'),
      moduleKpi('Ventes en magasin récentes', sales.length, 'receipt-text', 'tone-blue'),
    ],
    toolbar: permissions.canManageSessions ? `
      <div class="ops-form-inline">
        <select id="cashSessionLocationSelect">
          ${activeLocations.map((location) => `<option value="${escapeHtml(location.id)}" data-name="${escapeHtml(location.name)}">${escapeHtml(location.name)}</option>`).join('')}
        </select>
        <input id="cashSessionOpeningInput" type="number" min="0" step="1" placeholder="Fond de caisse initial">
        <button class="primary-btn" id="openCashSessionBtn" type="button" ${activeLocations.length ? '' : 'disabled'}>${lucideIcon('unlock')} Ouvrir une session</button>
      </div>
    ` : '<div class="notice info">Votre rôle permet de consulter les sessions, mais pas de les ouvrir ou clôturer.</div>',
    body: renderRecordsTable(sessions, [
      { label: 'Session', render: (session) => `<strong>${escapeHtml(session.reference || session.id)}</strong><br><small>${escapeHtml(session.locationName || '-')}</small>` },
      { label: 'Statut', render: (session) => statusBadge(getCashSessionStatus(session)) },
      { label: 'Ouverture', render: (session) => escapeHtml(formatDate(session.openedAt || session.createdAt)) },
      { label: 'Fermeture', render: (session) => escapeHtml(formatDate(session.closedAt)) },
      { label: 'Initial', render: (session) => escapeHtml(formatMoney(session.openingFloat || 0)) },
      { label: 'Ventes', render: (session) => escapeHtml(formatMoney(session.totalSales || 0)) },
      { label: 'Actions', render: (session) => permissions.canManageSessions && getCashSessionStatus(session) === 'open' ? `<button class="secondary-btn small-btn" data-close-session="${escapeHtml(session.id)}" type="button">Clôturer</button>` : '-' },
    ], 'Aucune session de caisse enregistrée.'),
  });
  document.getElementById('openCashSessionBtn')?.addEventListener('click', () => openCashSession(context));
  document.querySelectorAll('[data-close-session]').forEach((button) => {
    button.addEventListener('click', () => closeCashSession(button.dataset.closeSession, context));
  });
  scheduleLucideIcons();
}

async function openCashSession(context) {
  const permissions = getSmartManagementPermissions(context);
  if (!permissions.canManageSessions) {
    showInlineToast('Votre rôle ne permet pas d’ouvrir une session de caisse.', 'error');
    return;
  }
  const select = document.getElementById('cashSessionLocationSelect');
  const locationId = select?.value || '';
  const locationName = select?.selectedOptions?.[0]?.dataset?.name || '';
  if (!locationId) return;
  const sessionId = makeIdempotencyKey('cash-session');
  await setDoc(doc(collection(db, 'smartManagementCashSessions'), sessionId), {
    reference: `SESSION-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${sessionId.slice(-5).toUpperCase()}`,
    status: 'open',
    locationId,
    locationName,
    openingFloat: toNumber(document.getElementById('cashSessionOpeningInput')?.value),
    totalSales: 0,
    openedBy: context.user?.uid || '',
    openedByName: context.profile?.name || context.user?.email || '',
    openedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  showInlineToast('Session de caisse ouverte.', 'success');
  await renderSessionsModule(context);
}

async function closeCashSession(sessionId, context) {
  const permissions = getSmartManagementPermissions(context);
  if (!permissions.canManageSessions) {
    showInlineToast('Votre rôle ne permet pas de clôturer une session de caisse.', 'error');
    return;
  }
  if (!sessionId || !window.confirm('Confirmer la clôture de cette session de caisse ?')) return;
  await updateDoc(doc(db, 'smartManagementCashSessions', sessionId), {
    status: 'closed',
    closedBy: context.user?.uid || '',
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  showInlineToast('Session de caisse clôturée.', 'success');
  await renderSessionsModule(context);
}

async function renderPhysicalInventoryModule(context) {
  const [balances, locations] = await Promise.all([loadStockBalances(), loadLocations()]);
  const totalPhysical = balances.reduce((sum, balance) => sum + toNumber(balance.physicalQty), 0);
  const totalAvailable = balances.reduce((sum, balance) => sum + toNumber(balance.availableQty), 0);
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Contrôle stock',
    title: 'Inventaire physique',
    description: 'Préparez les comptages physiques et identifiez rapidement les écarts à corriger.',
    icon: 'clipboard-check',
    kpis: [
      moduleKpi('Références', balances.length, 'scan-barcode', 'tone-blue'),
      moduleKpi('Quantité physique', totalPhysical, 'boxes', 'tone-green'),
      moduleKpi('Disponible', totalAvailable, 'package-check', 'tone-green'),
      moduleKpi('Emplacements', locations.length, 'warehouse', 'tone-gray'),
    ],
    body: renderRecordsTable(balances, [
      { label: 'Produit', render: (balance) => `<strong>${escapeHtml(balance.productName || '-')}</strong><br><small>${escapeHtml(balance.variantLabel || balance.categoryName || '-')}</small>` },
      { label: 'Emplacement', render: (balance) => escapeHtml(balance.locationName || '-') },
      { label: 'SKU', render: (balance) => escapeHtml(balance.sku || '-') },
      { label: 'Physique', render: (balance) => escapeHtml(balance.physicalQty) },
      { label: 'Réservé', render: (balance) => escapeHtml(balance.reservedQty) },
      { label: 'Disponible', render: (balance) => `<strong>${escapeHtml(balance.availableQty)}</strong>` },
      { label: 'Statut', render: (balance) => inventoryStatusBadge(balance) },
    ], 'Aucune balance de stock à compter.'),
    side: '<div class="notice warning">Pour appliquer un écart de comptage, utilisez le module Inventaire puis le bouton Ajuster. Cela garde un mouvement de stock traçable.</div>',
  });
  scheduleLucideIcons();
}

async function renderOnlineOrdersModule(context) {
  const orders = await safeGetDocs(query(collectionGroup(db, 'orders'), orderBy('createdAt', 'desc'), limit(120)));
  const paid = orders.filter(isPaidOrder);
  const pending = orders.filter((order) => !isPaidOrder(order));
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Vente en ligne',
    title: 'Commandes en ligne',
    description: 'Suivez les commandes issues du site, les clients, les stores et les statuts de paiement/livraison.',
    icon: 'shopping-cart',
    kpis: [
      moduleKpi('Commandes', orders.length, 'shopping-cart', 'tone-blue'),
      moduleKpi('Payées', paid.length, 'badge-check', 'tone-green'),
      moduleKpi('En attente', pending.length, 'clock', 'tone-orange'),
      moduleKpi('Montant confirmé', formatMoney(paid.reduce((sum, order) => sum + getOrderAmount(order), 0)), 'badge-dollar-sign', 'tone-green'),
    ],
    body: renderRecordsTable(orders, [
      { label: 'Date', render: (order) => escapeHtml(formatDate(order.createdAt || order.paidAt)) },
      { label: 'Client', render: (order) => `<strong>${escapeHtml(getOrderClientName(order))}</strong><br><small>${escapeHtml(order.email || order.customerEmail || '-')}</small>` },
      { label: 'Store(s)', render: (order) => escapeHtml(getOrderStoreNames(order)) },
      { label: 'Montant', render: (order) => `<strong>${escapeHtml(formatMoney(getOrderAmount(order)))}</strong>` },
      { label: 'Paiement', render: (order) => statusBadge(orderStatusLabel(order)) },
      { label: 'Code', render: (order) => escapeHtml(order.uniqueCode || order.code || order.id || '-') },
    ], 'Aucune commande trouvée.'),
  });
}

async function renderClientsModule(context) {
  const clients = await safeCollectionDocs('clients', 160, 'createdAt');
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'CRM',
    title: 'Clients',
    description: 'Consultez les profils clients, coordonnées, rôles et informations utiles au service.',
    icon: 'users',
    kpis: [
      moduleKpi('Clients', clients.length, 'users', 'tone-blue'),
      moduleKpi('Admins', clients.filter((client) => String(client.role || '').toLowerCase() === 'admin').length, 'shield', 'tone-green'),
      moduleKpi('Vendeurs', clients.filter((client) => String(client.role || '').toLowerCase() === 'vendor').length, 'store', 'tone-orange'),
    ],
    body: renderRecordsTable(clients, [
      { label: 'Client', render: (client) => `<strong>${escapeHtml(getClientDisplayName(client))}</strong><br><small>${escapeHtml(client.email || '-')}</small>` },
      { label: 'Téléphone', render: (client) => escapeHtml(client.phone || client.telephone || '-') },
      { label: 'Adresse', render: (client) => escapeHtml(client.address || client.adresse || client.city || '-') },
      { label: 'Rôle', render: (client) => statusBadge(client.role || 'client') },
      { label: 'Membre depuis', render: (client) => escapeHtml(formatDate(client.createdAt)) },
    ], 'Aucun client trouvé.'),
  });
}

async function renderLoyaltyModule(context) {
  const [clients, likes, orders] = await Promise.all([
    safeCollectionDocs('clients', 160, 'createdAt'),
    safeCollectionDocs('productLikes', 160, 'createdAt'),
    safeGetDocs(query(collectionGroup(db, 'orders'), orderBy('createdAt', 'desc'), limit(160))),
  ]);
  const paid = orders.filter(isPaidOrder);
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Relation client',
    title: 'Fidélité',
    description: 'Repérez les clients actifs, favoris, habitudes d’achat et futures opportunités de récompenses.',
    icon: 'heart-handshake',
    kpis: [
      moduleKpi('Clients suivis', clients.length, 'users', 'tone-blue'),
      moduleKpi('Favoris produits', likes.length, 'heart', 'tone-red'),
      moduleKpi('Commandes confirmées', paid.length, 'badge-check', 'tone-green'),
      moduleKpi('Dépense confirmée', formatMoney(paid.reduce((sum, order) => sum + getOrderAmount(order), 0)), 'badge-dollar-sign', 'tone-green'),
    ],
    body: renderRecordsTable(clients.slice(0, 80), [
      { label: 'Client', render: (client) => `<strong>${escapeHtml(getClientDisplayName(client))}</strong><br><small>${escapeHtml(client.email || '-')}</small>` },
      { label: 'Téléphone', render: (client) => escapeHtml(client.phone || client.telephone || '-') },
      { label: 'Commandes', render: (client) => escapeHtml(client.ordersCount || client.totalOrders || 0) },
      { label: 'Total dépensé', render: (client) => escapeHtml(formatMoney(client.totalSpent || client.totalDepense || 0)) },
      { label: 'Statut fidélité', render: (client) => statusBadge(client.loyaltyStatus || 'standard') },
    ], 'Aucun client à analyser.'),
    side: renderSimpleRecordList('Derniers favoris', likes, (like) => `
      <div class="ops-side-item"><strong>${escapeHtml(like.productName || like.productId || like.id)}</strong><small>${escapeHtml(formatDate(like.createdAt))}</small></div>
    `),
  });
}

async function renderPromotionsModule(context) {
  const [promoCodes, usages] = await Promise.all([
    safeCollectionDocs('promoCodes', 120, 'createdAt'),
    safeCollectionDocs('promoCodeUsages', 120, 'usedAt'),
  ]);
  const active = promoCodes.filter((promo) => promo.active !== false && String(promo.status || 'active').toLowerCase() !== 'inactive');
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Commercial',
    title: 'Prix et promotion',
    description: 'Suivez les codes promo, leur statut, leurs usages et les remises accordées.',
    icon: 'badge-percent',
    kpis: [
      moduleKpi('Codes promo', promoCodes.length, 'ticket-percent', 'tone-blue'),
      moduleKpi('Actifs', active.length, 'badge-check', 'tone-green'),
      moduleKpi('Utilisations', usages.length, 'history', 'tone-orange'),
      moduleKpi('Affiliés', promoCodes.filter((promo) => promo.affiliateId || promo.linkedAffiliateId).length, 'handshake', 'tone-purple'),
    ],
    body: renderRecordsTable(promoCodes, [
      { label: 'Code', render: (promo) => `<strong>${escapeHtml(promo.code || promo.id)}</strong><br><small>${escapeHtml(promo.description || '-')}</small>` },
      { label: 'Type', render: (promo) => escapeHtml(promo.type || promo.discountType || '-') },
      { label: 'Valeur', render: (promo) => escapeHtml(promo.value || promo.discount || promo.amount || '-') },
      { label: 'Statut', render: (promo) => statusBadge(promo.active === false ? 'inactive' : promo.status || 'active') },
      { label: 'Usage', render: (promo) => escapeHtml(`${promo.usedCount || 0}/${promo.maxUses || promo.usageLimit || '∞'}`) },
      { label: 'Créé le', render: (promo) => escapeHtml(formatDate(promo.createdAt)) },
    ], 'Aucun code promo trouvé.'),
    side: renderSimpleRecordList('Dernières utilisations', usages, (usage) => `
      <div class="ops-side-item"><strong>${escapeHtml(usage.code || usage.promoCode || usage.id)}</strong><small>${escapeHtml(usage.clientEmail || usage.userEmail || '')} · ${escapeHtml(formatDate(usage.usedAt || usage.createdAt))}</small></div>
    `),
  });
}

async function renderReturnsModule(context) {
  const [returns, refunds, orders] = await Promise.all([
    safeCollectionDocs('returns', 80, 'createdAt'),
    safeCollectionDocs('refunds', 80, 'createdAt'),
    safeGetDocs(query(collectionGroup(db, 'orders'), orderBy('createdAt', 'desc'), limit(120))),
  ]);
  const suspiciousOrders = orders.filter((order) => String(order.status || order.paymentStatus || '').toLowerCase().match(/refund|return|cancel|failed/));
  const records = [...returns, ...refunds, ...suspiciousOrders].sort((a, b) => dateValue(b) - dateValue(a));
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Service après-vente',
    title: 'Retours et remboursements',
    description: 'Centralisez les demandes de retour, remboursements et commandes annulées.',
    icon: 'rotate-ccw',
    kpis: [
      moduleKpi('Dossiers', records.length, 'rotate-ccw', 'tone-orange'),
      moduleKpi('Retours', returns.length, 'undo-2', 'tone-blue'),
      moduleKpi('Remboursements', refunds.length, 'badge-dollar-sign', 'tone-red'),
      moduleKpi('Commandes concernées', suspiciousOrders.length, 'shopping-cart', 'tone-gray'),
    ],
    body: renderRecordsTable(records, [
      { label: 'Date', render: (record) => escapeHtml(formatDate(record.createdAt || record.updatedAt)) },
      { label: 'Référence', render: (record) => `<strong>${escapeHtml(record.reference || record.uniqueCode || record.orderId || record.id)}</strong>` },
      { label: 'Client', render: (record) => escapeHtml(record.clientName || getOrderClientName(record) || record.email || '-') },
      { label: 'Montant', render: (record) => escapeHtml(formatMoney(record.amount || record.total || record.refundAmount || 0)) },
      { label: 'Statut', render: (record) => statusBadge(record.status || record.paymentStatus || 'à traiter') },
      { label: 'Motif', render: (record) => escapeHtml(record.reason || record.note || '-') },
    ], 'Aucun retour ou remboursement trouvé.'),
  });
}

async function renderPaymentsModule(context) {
  const [methods, posSales, orders] = await Promise.all([
    safeCollectionDocs('paymentMethods', 60, 'createdAt'),
    loadPosSales(80),
    safeGetDocs(query(collectionGroup(db, 'orders'), orderBy('createdAt', 'desc'), limit(120))),
  ]);
  const paidOrders = orders.filter(isPaidOrder);
  const totalOnline = paidOrders.reduce((sum, order) => sum + getOrderAmount(order), 0);
  const totalPos = posSales.filter((sale) => sale.status === 'completed').reduce((sum, sale) => sum + toNumber(sale.total), 0);
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Encaissement',
    title: 'Paiements',
    description: 'Vue consolidée des moyens de paiement, ventes en ligne confirmées et ventes en magasin.',
    icon: 'credit-card',
    kpis: [
      moduleKpi('Méthodes', methods.length, 'credit-card', 'tone-blue'),
      moduleKpi('Online confirmé', formatMoney(totalOnline), 'globe', 'tone-green'),
      moduleKpi('Magasin confirmé', formatMoney(totalPos), 'store', 'tone-green'),
      moduleKpi('Total', formatMoney(totalOnline + totalPos), 'badge-dollar-sign', 'tone-purple'),
    ],
    body: renderRecordsTable(methods, [
      { label: 'Méthode', render: (method) => `<strong>${escapeHtml(method.name || method.title || method.id)}</strong><br><small>${escapeHtml(method.provider || method.type || '-')}</small>` },
      { label: 'Statut', render: (method) => statusBadge(method.active === false ? 'inactive' : method.status || 'active') },
      { label: 'Devise', render: (method) => escapeHtml(method.currency || 'HTG') },
      { label: 'Dernière mise à jour', render: (method) => escapeHtml(formatDate(method.updatedAt || method.createdAt)) },
    ], 'Aucune méthode de paiement configurée.'),
    side: renderSimpleRecordList('Dernières ventes en magasin', posSales, (sale) => `
      <div class="ops-side-item"><strong>${escapeHtml(sale.reference || sale.id)}</strong><small>${escapeHtml(formatMoney(sale.total))} · ${escapeHtml(getPaymentMethodLabel(sale.paymentMethod))}</small></div>
    `),
  });
}

async function renderReceiptsModule(context) {
  const [posSales, orders] = await Promise.all([
    loadPosSales(100),
    safeGetDocs(query(collectionGroup(db, 'orders'), orderBy('createdAt', 'desc'), limit(100))),
  ]);
  const onlineReceipts = orders.filter(isPaidOrder).map((order) => ({ ...order, source: 'Commande en ligne', reference: order.uniqueCode || order.code || order.id, total: getOrderAmount(order) }));
  const posReceipts = posSales.filter((sale) => sale.status === 'completed').map((sale) => ({ ...sale, source: 'Vente en magasin' }));
  const receipts = [...onlineReceipts, ...posReceipts].sort((a, b) => dateValue(b) - dateValue(a));
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Documents',
    title: 'Reçus',
    description: 'Retrouvez les reçus générables pour les commandes confirmées et ventes caisse.',
    icon: 'receipt-text',
    kpis: [
      moduleKpi('Reçus', receipts.length, 'receipt-text', 'tone-blue'),
      moduleKpi('Online', onlineReceipts.length, 'globe', 'tone-green'),
      moduleKpi('POS', posReceipts.length, 'store', 'tone-orange'),
    ],
    body: renderRecordsTable(receipts, [
      { label: 'Date', render: (receipt) => escapeHtml(formatDate(receipt.createdAt || receipt.paidAt || receipt.completedAt)) },
      { label: 'Référence', render: (receipt) => `<strong>${escapeHtml(receipt.reference || receipt.id)}</strong><br><small>${escapeHtml(receipt.source)}</small>` },
      { label: 'Client', render: (receipt) => escapeHtml(receipt.customerName || getOrderClientName(receipt) || '-') },
      { label: 'Total', render: (receipt) => `<strong>${escapeHtml(formatMoney(receipt.total))}</strong>` },
      { label: 'Statut', render: (receipt) => statusBadge(receipt.status || 'completed') },
    ], 'Aucun reçu disponible.'),
  });
}

async function renderReportsModule(context) {
  const data = await loadDashboardData();
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Analyse',
    title: 'Rapports',
    description: 'Synthèse globale des ventes, stocks, transferts, clients et activité opérationnelle.',
    icon: 'chart-column',
    kpis: [
      moduleKpi('Ventes du jour', formatMoney(data.stats.salesToday), 'shopping-bag', 'tone-green'),
      moduleKpi('Ventes magasin', formatMoney(data.stats.posSalesToday), 'store', 'tone-blue'),
      moduleKpi('Clients', data.stats.clients, 'users', 'tone-purple'),
      moduleKpi('Stock faible', data.stats.lowStockCount, 'triangle-alert', data.stats.lowStockCount ? 'tone-orange' : 'tone-green'),
      moduleKpi('Transferts en cours', data.stats.transfersInTransit, 'truck', 'tone-orange'),
    ],
    body: `
      ${dashboardPanel('Évolution des ventes', renderSalesLineChart(data.salesEvolution))}
      ${dashboardPanel('Répartition par catégorie', renderCategoryDonut(data.categoryBreakdown))}
    `,
    side: renderSimpleRecordList('Alertes stock', data.lowStock, (item) => `
      <div class="ops-side-item"><strong>${escapeHtml(item.productName || item.name || 'Produit')}</strong><small>${escapeHtml(item.locationName || '')} · ${escapeHtml(item.availableQty ?? item.stock ?? 0)} dispo.</small></div>
    `),
  });
  scheduleLucideIcons();
}

async function renderUsersRolesModule(context) {
  const permissions = getSmartManagementPermissions(context);
  const clients = usersRolesModuleState.clients;
  const smartUsers = clients.filter((client) => {
    const role = normalizeSmartManagementRole(client.role || '');
    return client.smartManagementAccess === true || client.dashboardAccess === true || ROLE_DEFINITIONS[role];
  });
  const filteredClients = getFilteredUsersRolesClients();
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Administration',
    title: 'Utilisateurs et rôles',
    description: 'Créez une séparation claire entre administrateur, manager, caissier, responsable stock et lecture seule.',
    icon: 'user-cog',
    kpis: [
      moduleKpi('Utilisateurs chargés', usersRolesModuleState.loaded ? clients.length : '-', 'users', 'tone-blue'),
      moduleKpi('Accès Smart Management', usersRolesModuleState.loaded ? smartUsers.length : '-', 'key-round', 'tone-orange'),
      moduleKpi('Caissiers', usersRolesModuleState.loaded ? clients.filter((client) => normalizeSmartManagementRole(client.role || '') === 'caissier').length : '-', 'store', 'tone-green'),
      moduleKpi('Responsables stock', usersRolesModuleState.loaded ? clients.filter((client) => normalizeSmartManagementRole(client.role || '') === 'stock_manager').length : '-', 'boxes', 'tone-purple'),
    ],
    toolbar: renderUsersRolesToolbar(permissions),
    body: usersRolesModuleState.loaded ? renderRecordsTable(filteredClients, [
      { label: 'Utilisateur', render: (client) => `<strong>${escapeHtml(getClientDisplayName(client))}</strong><br><small>${escapeHtml(client.email || client.id)}</small>` },
      { label: 'Rôle actuel', render: (client) => statusBadge(getRoleLabel(client.role || 'client')) },
      { label: 'Accès dashboard', render: (client) => client.dashboardAccess || client.smartManagementAccess ? statusBadge('autorisé') : statusBadge('non') },
      { label: 'Modules', render: (client) => {
        const role = normalizeSmartManagementRole(client.role || '');
        const count = getAllowedModulesForRole(role, client.smartManagementAccess || client.dashboardAccess).size;
        return escapeHtml(count ? `${count} module(s)` : '-');
      } },
      { label: 'Créé le', render: (client) => escapeHtml(formatDate(client.createdAt)) },
      { label: 'Actions', render: (client) => permissions.isAdmin ? `
        <button class="secondary-btn small-btn" data-role-edit="${escapeHtml(client.id)}" type="button">Modifier</button>
      ` : '-' },
    ], usersRolesModuleState.search ? 'Aucun utilisateur ne correspond à cette recherche.' : 'Aucun utilisateur trouvé.') : renderUsersRolesStartPanel(permissions),
  });
  bindUsersRolesEvents(context, permissions);
  scheduleLucideIcons();
}

function renderUsersRolesToolbar(permissions = {}) {
  return `
    <div class="users-role-toolbar">
      <div class="users-role-actions">
        ${permissions.isAdmin ? `<button class="primary-btn" id="addSmartUserBtn" type="button">${lucideIcon('user-plus')} Ajouter un utilisateur</button>` : ''}
        <button class="secondary-btn" id="loadSmartUsersBtn" type="button" ${usersRolesModuleState.loading ? 'disabled' : ''}>
          ${lucideIcon(usersRolesModuleState.loading ? 'loader-circle' : 'download-cloud')} ${usersRolesModuleState.loaded ? 'Recharger les utilisateurs' : 'Charger tous les utilisateurs'}
        </button>
      </div>
      ${usersRolesModuleState.loaded ? `
        <label class="users-role-search">
          <span>Recherche</span>
          <input id="usersRoleSearchInput" type="search" value="${escapeHtml(usersRolesModuleState.search)}" placeholder="Nom, email, téléphone, rôle...">
        </label>
      ` : ''}
      ${renderRoleMatrix()}
    </div>
  `;
}

function renderUsersRolesStartPanel(permissions = {}) {
  return `
    <div class="users-role-start">
      <div>
        <strong>Les utilisateurs ne sont pas chargés automatiquement.</strong>
        <span>Cliquez sur « Charger tous les utilisateurs » pour consulter les comptes employés Smart Management, ou ajoutez directement un nouvel accès.</span>
      </div>
      ${permissions.isAdmin ? '<div class="notice info">Le bouton « Ajouter un utilisateur » crée le compte avec email, mot de passe et rôle, puis autorise automatiquement Smart Management.</div>' : ''}
    </div>
  `;
}

function getFilteredUsersRolesClients() {
  const search = String(usersRolesModuleState.search || '').trim().toLowerCase();
  if (!search) return usersRolesModuleState.clients;
  return usersRolesModuleState.clients.filter((client) => {
    const role = getRoleLabel(client.role || 'client');
    return [
      client.id,
      client.email,
      client.name,
      client.username,
      client.displayName,
      client.firstName,
      client.lastName,
      client.nom,
      client.prenom,
      client.phone,
      client.telephone,
      role,
    ].some((value) => String(value || '').toLowerCase().includes(search));
  });
}

function bindUsersRolesEvents(context, permissions = {}) {
  document.getElementById('loadSmartUsersBtn')?.addEventListener('click', () => loadUsersRolesClients(context));
  document.getElementById('addSmartUserBtn')?.addEventListener('click', () => openAddSmartUserModal(context));
  document.getElementById('usersRoleSearchInput')?.addEventListener('input', (event) => {
    usersRolesModuleState.search = event.target.value || '';
    renderUsersRolesModule(context);
  });
  document.querySelectorAll('[data-role-edit]').forEach((button) => {
    button.addEventListener('click', () => openRoleModal(button.dataset.roleEdit, usersRolesModuleState.clients.find((client) => client.id === button.dataset.roleEdit), context));
  });
}

async function loadUsersRolesClients(context) {
  usersRolesModuleState.loading = true;
  await renderUsersRolesModule(context);
  try {
    usersRolesModuleState.clients = await safeCollectionDocs(SMART_MANAGEMENT_USER_COLLECTION, 300, 'createdAt');
    usersRolesModuleState.loaded = true;
  } catch (error) {
    showInlineToast(error?.message || 'Impossible de charger les utilisateurs.', 'error');
  } finally {
    usersRolesModuleState.loading = false;
    await renderUsersRolesModule(context);
  }
}

function renderRoleMatrix() {
  return `
    <div class="role-matrix">
      ${Object.entries(ROLE_DEFINITIONS).map(([role, definition]) => `
        <article class="role-card">
          <strong>${escapeHtml(definition.label)}</strong>
          <span>${escapeHtml(definition.description)}</span>
          <small>${definition.modules === 'all' ? 'Tous les modules' : `${definition.modules.length} module(s) autorisé(s)`}</small>
        </article>
      `).join('')}
    </div>
  `;
}

function renderSmartRoleOptions(currentRole = 'caissier', includeClient = true) {
  const normalized = normalizeSmartManagementRole(currentRole || 'caissier');
  const assignableRoles = Object.entries(ROLE_DEFINITIONS).filter(([role]) => role !== 'admin');
  return `
    ${includeClient ? `<option value="client" ${normalized === 'client' ? 'selected' : ''}>Client standard</option>` : ''}
    ${normalized === 'admin' ? '<option value="admin" selected disabled>Administrateur protégé</option>' : ''}
    ${assignableRoles.map(([role, definition]) => `<option value="${role}" ${normalized === role ? 'selected' : ''}>${escapeHtml(definition.label)}</option>`).join('')}
  `;
}

function openAddSmartUserModal(context) {
  openModal(`
    <form id="addSmartUserForm" class="product-form">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Nouvel accès</p>
          <h2>Ajouter un utilisateur</h2>
        </div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="notice info">
        Créez un compte de travail Smart Management sans déconnecter votre session admin. L’utilisateur se connectera avec cet email et ce mot de passe.
      </div>
      <div class="form-grid">
        <label class="field">
          <span>Nom *</span>
          <input name="lastName" type="text" required autocomplete="family-name" placeholder="Nom de famille">
        </label>
        <label class="field">
          <span>Prénom *</span>
          <input name="firstName" type="text" required autocomplete="given-name" placeholder="Prénom">
        </label>
        <label class="field">
          <span>Téléphone *</span>
          <input name="phone" type="tel" required autocomplete="tel" placeholder="+509 ...">
        </label>
        <label class="field">
          <span>Email *</span>
          <input name="email" type="email" required placeholder="utilisateur@email.com">
        </label>
        <label class="field">
          <span>Mot de passe *</span>
          <input name="password" type="password" required minlength="6" autocomplete="new-password" placeholder="Minimum 6 caractères">
        </label>
        <label class="field">
          <span>Rôle *</span>
          <select name="role" required>
            ${renderSmartRoleOptions('caissier', false)}
          </select>
        </label>
      </div>
      <div class="form-error" id="addSmartUserError" hidden></div>
      <div class="modal-actions">
        <button class="primary-btn" id="saveSmartUserBtn" type="submit">Enregistrer l’utilisateur</button>
        <button class="secondary-btn" type="button" data-close-modal>Annuler</button>
      </div>
    </form>
  `);
  document.getElementById('addSmartUserForm')?.addEventListener('submit', (event) => submitAddSmartUser(event, context));
}

async function submitAddSmartUser(event, context) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = document.getElementById('addSmartUserError');
  const submitBtn = document.getElementById('saveSmartUserBtn');
  errorBox.hidden = true;

  const lastName = normalizeText(form.elements.lastName?.value || '');
  const firstName = normalizeText(form.elements.firstName?.value || '');
  const phone = normalizeText(form.elements.phone?.value || '');
  const email = normalizeText(form.elements.email?.value || '').toLowerCase();
  const password = String(form.elements.password?.value || '');
  const role = normalizeSmartManagementRole(form.elements.role?.value || 'caissier');
  const errors = [];

  if (!lastName) errors.push('Ajoutez le nom de l’utilisateur.');
  if (!firstName) errors.push('Ajoutez le prénom de l’utilisateur.');
  if (!phone) errors.push('Ajoutez le numéro de téléphone.');
  if (!email || !email.includes('@')) errors.push('Ajoutez un email valide.');
  if (password.length < 6) errors.push('Le mot de passe doit contenir au moins 6 caractères.');
  if (!ROLE_DEFINITIONS[role] || role === 'admin') errors.push('Choisissez un rôle autorisé, hors administrateur.');

  if (errors.length) {
    errorBox.innerHTML = errors.map((error) => `<div>${escapeHtml(error)}</div>`).join('');
    errorBox.hidden = false;
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Enregistrement...';
  let secondaryApp = null;
  try {
    secondaryApp = initializeApp(auth.app.options, `smart-management-user-create-${Date.now()}`);
    const secondaryAuth = getSecondaryAuth(secondaryApp);
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = credential.user?.uid || '';
    if (!uid) throw new Error('Compte créé, mais UID Firebase introuvable.');

    const userRef = doc(db, SMART_MANAGEMENT_USER_COLLECTION, uid);
    const payload = {
      lastName,
      firstName,
      phone,
      email,
      role,
      smartManagementAccess: true,
      status: 'active',
      updatedAt: serverTimestamp(),
      updatedBy: context.user?.uid || '',
      createdAt: serverTimestamp(),
      createdBy: context.user?.uid || '',
    };
    await setDoc(userRef, payload, { merge: true });
    closeModal();
    showInlineToast('Utilisateur Smart Management enregistré.', 'success');
    usersRolesModuleState.loaded = true;
    usersRolesModuleState.clients = await safeCollectionDocs(SMART_MANAGEMENT_USER_COLLECTION, 300, 'createdAt');
    await renderUsersRolesModule(context);
  } catch (error) {
    const message = error?.code === 'auth/email-already-in-use'
      ? 'Cet email possède déjà un compte Firebase. Utilisez un autre email ou modifiez son rôle depuis la liste des utilisateurs.'
      : error?.message || 'Impossible d’enregistrer cet utilisateur.';
    errorBox.innerHTML = escapeHtml(message);
    errorBox.hidden = false;
  } finally {
    if (secondaryApp) {
      await deleteApp(secondaryApp).catch(() => null);
    }
    submitBtn.disabled = false;
    submitBtn.textContent = 'Enregistrer l’utilisateur';
  }
}

function openRoleModal(clientId, client, context) {
  if (!clientId || !client) return;
  const currentRole = normalizeSmartManagementRole(client.role || 'client');
  openModal(`
    <div class="modal-header">
      <div><p class="eyebrow">Permissions</p><h2>${escapeHtml(getClientDisplayName(client))}</h2></div>
      <button class="icon-btn" type="button" data-close-modal>×</button>
    </div>
    <div class="product-form">
      <div class="form-grid">
        <label class="field"><span>Nom</span><input id="smartLastNameEdit" type="text" value="${escapeHtml(client.lastName || client.nom || '')}" autocomplete="family-name"></label>
        <label class="field"><span>Prénom</span><input id="smartFirstNameEdit" type="text" value="${escapeHtml(client.firstName || client.prenom || '')}" autocomplete="given-name"></label>
        <label class="field"><span>Téléphone</span><input id="smartPhoneEdit" type="tel" value="${escapeHtml(client.phone || client.telephone || '')}" autocomplete="tel"></label>
        <label class="field"><span>Email</span><input type="email" value="${escapeHtml(client.email || '')}" disabled></label>
        <label class="field"><span>Nouveau mot de passe</span><input id="smartPasswordEdit" type="password" minlength="6" autocomplete="new-password" placeholder="Laisser vide pour conserver l’actuel"></label>
      </div>
      <label class="field"><span>Rôle</span><select id="roleEditSelect">
        ${renderSmartRoleOptions(currentRole, false)}
      </select></label>
      <label class="check-row"><input id="smartAccessEditCheck" type="checkbox" ${client.smartManagementAccess || client.dashboardAccess ? 'checked' : ''}> Accès Smart Management</label>
      <div class="notice info">Un caissier voit uniquement la Vente en magasin, les sessions de caisse et les reçus. Un responsable stock ne voit pas les modules sensibles d’administration.</div>
    </div>
    <div class="modal-actions">
      <button class="primary-btn" id="saveRoleEditBtn" type="button">Enregistrer</button>
      <button class="secondary-btn" type="button" data-close-modal>Annuler</button>
    </div>
  `);
  document.getElementById('saveRoleEditBtn')?.addEventListener('click', async () => {
    const saveButton = document.getElementById('saveRoleEditBtn');
    const password = String(document.getElementById('smartPasswordEdit')?.value || '');
    if (password && password.length < 6) {
      showInlineToast('Le nouveau mot de passe doit contenir au moins 6 caractères.', 'error');
      return;
    }
    saveButton.disabled = true;
    saveButton.textContent = 'Enregistrement...';
    try {
      if (password) await updateSmartManagementUserPassword(clientId, password);
      await updateDoc(doc(db, SMART_MANAGEMENT_USER_COLLECTION, clientId), {
        lastName: normalizeText(document.getElementById('smartLastNameEdit')?.value || ''),
        firstName: normalizeText(document.getElementById('smartFirstNameEdit')?.value || ''),
        phone: normalizeText(document.getElementById('smartPhoneEdit')?.value || ''),
        role: normalizeSmartManagementRole(document.getElementById('roleEditSelect')?.value || 'client'),
        smartManagementAccess: document.getElementById('smartAccessEditCheck')?.checked === true,
        updatedAt: serverTimestamp(),
        updatedBy: context.user?.uid || '',
      });
      closeModal();
      showInlineToast(password ? 'Profil et mot de passe mis à jour.' : 'Profil et rôle mis à jour.', 'success');
      if (usersRolesModuleState.loaded) {
        usersRolesModuleState.clients = await safeCollectionDocs(SMART_MANAGEMENT_USER_COLLECTION, 300, 'createdAt');
      }
      await renderUsersRolesModule(context);
    } catch (error) {
      showInlineToast(error?.message || 'Impossible de mettre à jour cet utilisateur.', 'error');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'Enregistrer';
    }
  });
}

async function renderNotificationsModule(context) {
  const notifications = await safeCollectionDocs('notificationBroadcasts', 100, 'createdAt');
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Communication',
    title: 'Notifications',
    description: 'Suivez les notifications envoyées ou préparées pour les clients, vendeurs et administrateurs.',
    icon: 'bell',
    kpis: [
      moduleKpi('Notifications', notifications.length, 'bell', 'tone-blue'),
      moduleKpi('Envoyées', notifications.filter((item) => String(item.status || '').toLowerCase().includes('sent')).length, 'send', 'tone-green'),
      moduleKpi('Brouillons', notifications.filter((item) => String(item.status || '').toLowerCase().includes('draft')).length, 'file-pen-line', 'tone-gray'),
    ],
    body: renderRecordsTable(notifications, [
      { label: 'Notification', render: (item) => `<strong>${escapeHtml(item.title || item.subject || item.id)}</strong><br><small>${escapeHtml(item.message || item.body || '-')}</small>` },
      { label: 'Audience', render: (item) => escapeHtml(item.audience || item.target || '-') },
      { label: 'Statut', render: (item) => statusBadge(item.status || 'draft') },
      { label: 'Date', render: (item) => escapeHtml(formatDate(item.createdAt || item.sentAt)) },
    ], 'Aucune notification trouvée.'),
  });
}

async function renderActivityLogModule(context) {
  const [movements, transfers, posSales, orders] = await Promise.all([
    loadStockMovements(80),
    loadStockTransfers(80),
    loadPosSales(80),
    safeGetDocs(query(collectionGroup(db, 'orders'), orderBy('createdAt', 'desc'), limit(80))),
  ]);
  const events = [
    ...movements.map((item) => ({ ...item, activityType: 'Stock', label: item.reference || item.type })),
    ...transfers.map((item) => ({ ...item, activityType: 'Transfert', label: item.transferNumber || item.reference })),
    ...posSales.map((item) => ({ ...item, activityType: 'POS', label: item.reference })),
    ...orders.map((item) => ({ ...item, activityType: 'Commande', label: item.uniqueCode || item.id, amount: getOrderAmount(item) })),
  ].sort((a, b) => dateValue(b) - dateValue(a)).slice(0, 160);
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Traçabilité',
    title: 'Journal d’activité',
    description: 'Consultez les événements récents: ventes, commandes, mouvements de stock et transferts.',
    icon: 'logs',
    kpis: [
      moduleKpi('Événements', events.length, 'logs', 'tone-blue'),
      moduleKpi('Mouvements stock', movements.length, 'boxes', 'tone-orange'),
      moduleKpi('Ventes magasin', posSales.length, 'store', 'tone-green'),
      moduleKpi('Transferts', transfers.length, 'truck', 'tone-purple'),
    ],
    body: renderRecordsTable(events, [
      { label: 'Date', render: (event) => escapeHtml(formatDate(event.createdAt || event.updatedAt || event.paidAt)) },
      { label: 'Type', render: (event) => statusBadge(event.activityType) },
      { label: 'Référence', render: (event) => `<strong>${escapeHtml(event.label || event.id)}</strong>` },
      { label: 'Détail', render: (event) => escapeHtml(event.productName || event.customerName || event.locationName || event.sourceLocationName || getOrderClientName(event) || '-') },
      { label: 'Montant/Qté', render: (event) => escapeHtml(event.amount ? formatMoney(event.amount) : event.total ? formatMoney(event.total) : event.quantityChange ?? '-') },
    ], 'Aucune activité trouvée.'),
  });
}

async function renderSettingsModule(context) {
  const [settings, paymentMethods, deliverySettings, printingSettings] = await Promise.all([
    safeCollectionDocs('settings', 80, 'updatedAt'),
    safeCollectionDocs('paymentMethods', 80, 'updatedAt'),
    safeCollectionDocs('deliverySettings', 80, 'updatedAt'),
    safeCollectionDocs('printingSettings', 80, 'updatedAt'),
  ]);
  const records = [
    ...settings.map((item) => ({ ...item, group: 'Site' })),
    ...paymentMethods.map((item) => ({ ...item, group: 'Paiement' })),
    ...deliverySettings.map((item) => ({ ...item, group: 'Livraison' })),
    ...printingSettings.map((item) => ({ ...item, group: 'Impression' })),
  ];
  document.getElementById('contentArea').innerHTML = renderOperationalModuleShell({
    eyebrow: 'Configuration',
    title: 'Paramètres',
    description: 'Vue centrale des paramètres opérationnels existants du site, paiement, livraison et impression.',
    icon: 'settings',
    kpis: [
      moduleKpi('Paramètres', records.length, 'settings', 'tone-blue'),
      moduleKpi('Paiements', paymentMethods.length, 'credit-card', 'tone-green'),
      moduleKpi('Livraison', deliverySettings.length, 'truck', 'tone-orange'),
      moduleKpi('Impression', printingSettings.length, 'printer', 'tone-purple'),
    ],
    body: renderRecordsTable(records, [
      { label: 'Groupe', render: (item) => statusBadge(item.group) },
      { label: 'Clé', render: (item) => `<strong>${escapeHtml(item.name || item.title || item.id)}</strong>` },
      { label: 'Statut', render: (item) => statusBadge(item.active === false ? 'inactive' : item.status || 'active') },
      { label: 'Dernière mise à jour', render: (item) => escapeHtml(formatDate(item.updatedAt || item.createdAt)) },
    ], 'Aucun paramètre trouvé.'),
  });
}

function getTransferSummary(transfers = []) {
  return transfers.reduce((summary, transfer) => {
    summary.total += 1;
    summary[transfer.status] = (summary[transfer.status] || 0) + 1;
    summary.inTransitQty += toNumber(transfer.inTransitQty);
    summary.requestedQty += toNumber(transfer.totalRequestedQty);
    return summary;
  }, {
    total: 0,
    draft: 0,
    pending_approval: 0,
    approved: 0,
    in_transit: 0,
    partially_received: 0,
    received: 0,
    cancelled: 0,
    rejected: 0,
    inTransitQty: 0,
    requestedQty: 0,
  });
}

function getFilteredTransfers() {
  const search = String(transferModuleState.search || '').trim().toLowerCase();
  return transferModuleState.transfers.filter((transfer) => {
    if (transferModuleState.status !== 'all' && transfer.status !== transferModuleState.status) return false;
    if (transferModuleState.source !== 'all' && transfer.sourceLocationId !== transferModuleState.source) return false;
    if (transferModuleState.destination !== 'all' && transfer.destinationLocationId !== transferModuleState.destination) return false;
    if (search && !transfer.searchText.includes(search)) return false;
    return true;
  });
}

function getTransferBalanceOptions(sourceLocationId = '') {
  const seen = new Set();
  return transferModuleState.balances
    .filter((balance) => balance.locationId === sourceLocationId && balance.availableQty > 0 && balance.productStatus !== 'inactive')
    .map((balance) => ({
      key: `${balance.productId}|${balance.variantId || ''}`,
      productId: balance.productId,
      variantId: balance.variantId || '',
      label: `${balance.productName}${balance.variantLabel ? ` / ${balance.variantLabel}` : ''}`,
      sku: balance.sku || '',
      barcode: balance.barcode || '',
      availableQty: balance.availableQty,
      physicalQty: balance.physicalQty,
      reservedQty: balance.reservedQty,
      lowStockThreshold: balance.lowStockThreshold,
      unitCost: balance.unitCost || 0,
    }))
    .filter((option) => {
      if (seen.has(option.key)) return false;
      seen.add(option.key);
      return true;
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

function getInventoryStatus(balance = {}) {
  if (balance.productStatus === 'inactive') return 'inactive';
  if (balance.availableQty <= 0) return 'out-of-stock';
  if (balance.availableQty <= balance.lowStockThreshold) return 'low-stock';
  return 'available';
}

function inventoryStatusBadge(balance = {}) {
  const status = getInventoryStatus(balance);
  const labels = {
    available: 'Disponible',
    'low-stock': 'Stock faible',
    'out-of-stock': 'Rupture',
    inactive: 'Inactif',
  };
  const type = status === 'available' ? 'success'
    : status === 'low-stock' ? 'warning'
      : status === 'out-of-stock' ? 'danger'
        : 'muted';
  return `<span class="badge ${type}">${labels[status] || status}</span>`;
}

function getInventorySummary(balances = []) {
  return balances.reduce((summary, balance) => {
    const status = getInventoryStatus(balance);
    summary.references += 1;
    summary.physical += balance.physicalQty;
    summary.reserved += balance.reservedQty;
    summary.available += balance.availableQty;
    summary.costValue += toNumber(balance.unitCost) * balance.physicalQty;
    summary.saleValue += toNumber(balance.salePrice) * balance.physicalQty;
    if (status === 'low-stock') summary.lowStock += 1;
    if (status === 'out-of-stock') summary.outOfStock += 1;
    return summary;
  }, {
    references: 0,
    physical: 0,
    reserved: 0,
    available: 0,
    lowStock: 0,
    outOfStock: 0,
    costValue: 0,
    saleValue: 0,
  });
}

function getFilteredInventory() {
  const search = String(inventoryModuleState.search || '').trim().toLowerCase();
  return inventoryModuleState.balances.filter((balance) => {
    const status = getInventoryStatus(balance);
    if (inventoryModuleState.location !== 'all' && balance.locationId !== inventoryModuleState.location) return false;
    if (inventoryModuleState.category !== 'all' && balance.categoryId !== inventoryModuleState.category && balance.categoryName !== inventoryModuleState.category) return false;
    if (inventoryModuleState.filter === 'simple' && balance.variantId) return false;
    if (inventoryModuleState.filter === 'variants' && !balance.variantId) return false;
    if (inventoryModuleState.filter === 'in-stock' && balance.availableQty <= 0) return false;
    if (inventoryModuleState.filter === 'low-stock' && status !== 'low-stock') return false;
    if (inventoryModuleState.filter === 'out-of-stock' && status !== 'out-of-stock') return false;
    if (inventoryModuleState.filter === 'reserved' && balance.reservedQty <= 0) return false;
    if (inventoryModuleState.filter === 'active' && balance.productStatus === 'inactive') return false;
    if (inventoryModuleState.filter === 'inactive' && balance.productStatus !== 'inactive') return false;
    if (search && !balance.searchText.includes(search)) return false;
    return true;
  });
}

function getInventoryFilterLabel(filter) {
  return {
    all: 'Tous',
    simple: 'Produits simples',
    variants: 'Variantes',
    'in-stock': 'En stock',
    'low-stock': 'Stock faible',
    'out-of-stock': 'Rupture',
    reserved: 'Quantité réservée',
    active: 'Actifs',
    inactive: 'Inactifs',
  }[filter] || filter;
}

async function renderInventoryModule(context, options = {}) {
  const permissions = getSmartManagementPermissions(context);
  const content = document.getElementById('contentArea');
  if (!permissions.canReadProducts) {
    content.innerHTML = `<div class="error-state"><strong>Accès refusé.</strong><br>Vous ne pouvez pas consulter l'inventaire.</div>`;
    return;
  }
  if (options.reload !== false) {
    content.innerHTML = `<div class="loading-state">Chargement de l'inventaire...</div>`;
    const [products, locations, balances, movements, categories] = await Promise.all([
      loadProducts(),
      loadLocations(),
      loadStockBalances(),
      loadStockMovements(30),
      loadCategories(),
    ]);
    inventoryModuleState.products = products;
    inventoryModuleState.locations = locations;
    inventoryModuleState.balances = balances;
    inventoryModuleState.movements = movements;
    inventoryModuleState.categories = categories;
  }
  const balances = getFilteredInventory();
  const summary = getInventorySummary(inventoryModuleState.balances);
  content.innerHTML = `
    <section class="inventory-page">
      <div class="module-hero">
        <div>
          <p class="eyebrow">Moteur central</p>
          <h2>Inventaire</h2>
          <p>Suivez les quantités physiques, réservées et disponibles par produit, variante et emplacement. Chaque modification passe par un mouvement tracé.</p>
        </div>
        <div class="module-actions">
          ${permissions.canManageProducts ? `
            <button class="primary-btn" id="initStockBtn" type="button">Initialiser</button>
            <button class="secondary-btn" id="receiveStockBtn" type="button">Recevoir du stock</button>
            <button class="secondary-btn" id="adjustStockBtn" type="button">Ajuster</button>
          ` : '<span class="badge info">Lecture seule</span>'}
        </div>
      </div>
      <div class="stat-grid product-summary-grid">
        ${statCard('Références suivies', summary.references, 'Produit/variante par emplacement.', 'tone-blue', 'R')}
        ${statCard('Quantité physique', summary.physical, 'Stock réel présent.', 'tone-green', 'Q')}
        ${statCard('Quantité réservée', summary.reserved, 'Préparée pour les futures réservations.', 'tone-orange', 'R')}
        ${statCard('Disponible', summary.available, 'Physique moins réservé.', 'tone-green', 'D')}
        ${statCard('Stock faible', summary.lowStock, 'Selon seuil configuré.', summary.lowStock ? 'tone-orange' : 'tone-green', '!')}
        ${statCard('Rupture', summary.outOfStock, 'Disponible = 0.', summary.outOfStock ? 'tone-orange' : 'tone-green', '0')}
        ${statCard('Valeur coût', formatMoney(summary.costValue), 'Valeur au coût achat.', 'tone-blue', '$')}
        ${statCard('Valeur vente', formatMoney(summary.saleValue), 'Valeur potentielle, pas profit net.', 'tone-gray', '$')}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Balances de stock</h2>
            <p class="panel-subtitle">Les quantités ne se modifient pas ici directement : utilisez Initialiser, Recevoir ou Ajuster.</p>
          </div>
        </div>
        <div class="panel-body">
          ${renderInventoryToolbar()}
          ${balances.length ? renderInventoryTable(balances) : '<div class="empty-state">Aucune balance de stock ne correspond à ces critères.</div>'}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2 class="panel-title">Derniers mouvements</h2></div>
        <div class="panel-body">${renderMovementList(inventoryModuleState.movements.slice(0, 8))}</div>
      </section>
    </section>
  `;
  bindInventoryEvents(context);
}

function renderInventoryToolbar() {
  return `
    <div class="products-toolbar">
      <input id="inventorySearchInput" type="search" value="${escapeHtml(inventoryModuleState.search)}" placeholder="Rechercher produit, variante, SKU, code-barres...">
      <select id="inventoryLocationFilter">
        <option value="all">Tous les emplacements</option>
        ${inventoryModuleState.locations.map((location) => `<option value="${escapeHtml(location.id)}" ${inventoryModuleState.location === location.id ? 'selected' : ''}>${escapeHtml(location.name)}</option>`).join('')}
      </select>
      <select id="inventoryCategoryFilter">
        <option value="all">Toutes les categories</option>
        ${inventoryModuleState.categories.map((category) => `<option value="${escapeHtml(category.id)}" ${inventoryModuleState.category === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}
      </select>
    </div>
    <div class="filter-pills product-filter-pills">
      ${INVENTORY_FILTERS.map((filter) => `<button class="filter-pill ${inventoryModuleState.filter === filter ? 'is-active' : ''}" type="button" data-inventory-filter="${filter}">${escapeHtml(getInventoryFilterLabel(filter))}</button>`).join('')}
      <button class="secondary-btn small-btn" id="resetInventoryFiltersBtn" type="button">Reinitialiser</button>
    </div>
  `;
}

function renderInventoryTable(balances = []) {
  return `
    <div class="table-wrap inventory-table-wrap">
      <table class="data-table inventory-table">
        <thead><tr><th>Produit</th><th>SKU</th><th>Emplacement</th><th>Physique</th><th>Reserve</th><th>Disponible</th><th>Seuil</th><th>Statut</th><th>Cout</th><th>Valeur</th><th>Maj</th></tr></thead>
        <tbody>
          ${balances.map((balance) => `
            <tr>
              <td><strong>${escapeHtml(balance.productName)}</strong><br><small>${escapeHtml(balance.variantLabel || balance.categoryName || '-')}</small></td>
              <td>${escapeHtml(balance.sku || '-')}<br><small>${escapeHtml(balance.barcode || '-')}</small></td>
              <td>${escapeHtml(balance.locationName || '-')}</td>
              <td>${escapeHtml(balance.physicalQty)}</td>
              <td>${escapeHtml(balance.reservedQty)}</td>
              <td><strong>${escapeHtml(balance.availableQty)}</strong></td>
              <td>${escapeHtml(balance.lowStockThreshold)}</td>
              <td>${inventoryStatusBadge(balance)}</td>
              <td>${escapeHtml(formatMoney(balance.unitCost))}</td>
              <td>${escapeHtml(formatMoney(balance.stockValueAtCost || (balance.unitCost * balance.physicalQty)))}</td>
              <td>${escapeHtml(formatDate(balance.updatedAt))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindInventoryEvents(context) {
  document.getElementById('initStockBtn')?.addEventListener('click', () => openStockOperationModal(context, 'INITIAL_STOCK'));
  document.getElementById('receiveStockBtn')?.addEventListener('click', () => openStockOperationModal(context, 'RECEIPT'));
  document.getElementById('adjustStockBtn')?.addEventListener('click', () => openStockOperationModal(context, 'ADJUSTMENT'));
  document.getElementById('inventorySearchInput')?.addEventListener('input', (event) => {
    inventoryModuleState.search = event.target.value;
    renderInventoryModule(context, { reload: false });
  });
  document.getElementById('inventoryLocationFilter')?.addEventListener('change', (event) => {
    inventoryModuleState.location = event.target.value || 'all';
    renderInventoryModule(context, { reload: false });
  });
  document.getElementById('inventoryCategoryFilter')?.addEventListener('change', (event) => {
    inventoryModuleState.category = event.target.value || 'all';
    renderInventoryModule(context, { reload: false });
  });
  document.getElementById('resetInventoryFiltersBtn')?.addEventListener('click', () => {
    inventoryModuleState.search = '';
    inventoryModuleState.location = 'all';
    inventoryModuleState.category = 'all';
    inventoryModuleState.filter = 'all';
    renderInventoryModule(context, { reload: false });
  });
  document.querySelectorAll('[data-inventory-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      inventoryModuleState.filter = button.dataset.inventoryFilter || 'all';
      renderInventoryModule(context, { reload: false });
    });
  });
}

function getStockOperationTitle(operationType) {
  return {
    INITIAL_STOCK: 'Initialiser le stock',
    RECEIPT: 'Recevoir du stock',
    ADJUSTMENT: 'Ajuster le stock',
  }[operationType] || 'Operation stock';
}

function openStockOperationModal(context, operationType = 'RECEIPT') {
  const locations = getActiveLocations(inventoryModuleState.locations);
  const refs = getStockReferenceOptions(inventoryModuleState.products);
  stockReceiptLines = [{
    productKey: refs[0]?.key || '',
    quantity: operationType === 'ADJUSTMENT' ? '' : 1,
    countedQuantity: '',
    unitCost: refs[0]?.unitCost || 0,
    reason: operationType === 'ADJUSTMENT' ? 'Correction apres comptage' : operationType,
    note: '',
  }];
  openModal(`
    <form id="stockOperationForm" class="product-form">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Inventaire</p>
          <h2>${escapeHtml(getStockOperationTitle(operationType))}</h2>
        </div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="form-grid">
        <label class="field">
          <span>Emplacement actif *</span>
          <select name="locationId" required>
            <option value="">Selectionner...</option>
            ${locations.map((location) => `<option value="${escapeHtml(location.id)}">${escapeHtml(location.name)} · ${escapeHtml(location.code || '')}</option>`).join('')}
          </select>
        </label>
        ${operationType === 'RECEIPT' ? formField('supplier', 'Fournisseur', '', 'text') : ''}
        ${operationType === 'RECEIPT' ? formField('reference', 'Reference fournisseur / facture', `REC-${Date.now()}`, 'text') : formField('reference', 'Reference operation', `${operationType}-${Date.now()}`, 'text')}
        ${operationType === 'ADJUSTMENT' ? `
          <label class="field">
            <span>Motif *</span>
            <select name="reason" required>
              <option>Erreur de saisie</option>
              <option>Produit endommage</option>
              <option>Produit perdu</option>
              <option>Produit retrouve</option>
              <option selected>Correction apres comptage</option>
              <option>Usage interne</option>
              <option>Autre</option>
            </select>
          </label>
        ` : ''}
        <label class="field field-full">
          <span>Note generale</span>
          <textarea name="note" rows="3"></textarea>
        </label>
      </div>
      <section class="form-section">
        <div class="section-title-line">
          <h3>Lignes</h3>
          ${operationType === 'RECEIPT' ? '<button class="secondary-btn small-btn" type="button" id="addStockLineBtn">Ajouter une ligne</button>' : ''}
        </div>
        <div id="stockLinesArea"></div>
      </section>
      <div class="form-error" id="stockOperationError" hidden></div>
      <div class="modal-actions">
        <button class="primary-btn" id="submitStockOperationBtn" type="submit">Confirmer l operation</button>
        <button class="secondary-btn" type="button" data-close-modal>Annuler</button>
      </div>
    </form>
  `);
  renderStockLines(operationType);
  document.getElementById('addStockLineBtn')?.addEventListener('click', () => {
    stockReceiptLines.push({
      productKey: refs[0]?.key || '',
      quantity: 1,
      countedQuantity: '',
      unitCost: refs[0]?.unitCost || 0,
      reason: operationType,
      note: '',
    });
    renderStockLines(operationType);
  });
  document.getElementById('stockOperationForm')?.addEventListener('submit', (event) => submitStockOperationForm(event, context, operationType));
}

function renderStockLines(operationType) {
  const area = document.getElementById('stockLinesArea');
  if (!area) return;
  const refs = getStockReferenceOptions(inventoryModuleState.products);
  area.innerHTML = `
    <div class="variant-edit-list">
      ${stockReceiptLines.map((line, index) => {
        const selectedRef = refs.find((ref) => ref.key === line.productKey) || refs[0] || {};
        return `
          <article class="stock-line-row">
            <label class="field">
              <span>Produit / variante *</span>
              <select data-stock-line-field="productKey" data-index="${index}" required>
                <option value="">Selectionner...</option>
                ${refs.map((ref) => `<option value="${escapeHtml(ref.key)}" ${line.productKey === ref.key ? 'selected' : ''}>${escapeHtml(ref.label)} ${ref.sku ? `· ${escapeHtml(ref.sku)}` : ''}</option>`).join('')}
              </select>
            </label>
            <label class="field">
              <span>${operationType === 'ADJUSTMENT' ? 'Variation (+/-)' : 'Quantité *'}</span>
              <input data-stock-line-field="quantity" data-index="${index}" type="number" step="1" value="${escapeHtml(line.quantity)}" placeholder="${operationType === 'ADJUSTMENT' ? 'Ex: -2 ou 5' : 'Ex: 10'}">
            </label>
            ${operationType === 'ADJUSTMENT' ? `
              <label class="field">
                <span>Ou quantité comptée</span>
                <input data-stock-line-field="countedQuantity" data-index="${index}" type="number" step="1" min="0" value="${escapeHtml(line.countedQuantity)}" placeholder="Ex: 12">
              </label>
            ` : ''}
            <label class="field">
              <span>Cout unitaire</span>
              <input data-stock-line-field="unitCost" data-index="${index}" type="number" min="0" step="0.01" value="${escapeHtml(line.unitCost || selectedRef.unitCost || 0)}">
            </label>
            <label class="field">
              <span>Seuil faible</span>
              <input data-stock-line-field="lowStockThreshold" data-index="${index}" type="number" min="0" step="1" value="${escapeHtml(line.lowStockThreshold ?? 5)}">
            </label>
            <label class="field">
              <span>Note ligne</span>
              <input data-stock-line-field="note" data-index="${index}" type="text" value="${escapeHtml(line.note || '')}">
            </label>
            ${operationType === 'RECEIPT' && stockReceiptLines.length > 1 ? `<button class="secondary-btn small-btn danger-outline" type="button" data-remove-stock-line="${index}">Retirer</button>` : ''}
            ${operationType === 'INITIAL_STOCK' ? `<div class="notice warning">Ancien stock global observe: ${escapeHtml(selectedRef.oldStock ?? '-')}</div>` : ''}
          </article>
        `;
      }).join('')}
    </div>
  `;
  area.querySelectorAll('[data-stock-line-field]').forEach((input) => {
    input.addEventListener('input', () => updateStockLineField(input));
    input.addEventListener('change', () => updateStockLineField(input));
  });
  area.querySelectorAll('[data-remove-stock-line]').forEach((button) => {
    button.addEventListener('click', () => {
      stockReceiptLines.splice(Number(button.dataset.removeStockLine), 1);
      renderStockLines(operationType);
    });
  });
}

function updateStockLineField(input) {
  const index = Number(input.dataset.index);
  const field = input.dataset.stockLineField;
  if (!stockReceiptLines[index]) return;
  stockReceiptLines[index][field] = input.value;
  if (field === 'productKey') {
    const ref = getStockReferenceOptions(inventoryModuleState.products).find((item) => item.key === input.value);
    if (ref && !stockReceiptLines[index].unitCost) stockReceiptLines[index].unitCost = ref.unitCost || 0;
  }
}

async function submitStockOperationForm(event, context, operationType) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = document.getElementById('stockOperationError');
  const submitBtn = document.getElementById('submitStockOperationBtn');
  errorBox.hidden = true;
  const locationId = form.elements.locationId?.value || '';
  const refs = getStockReferenceOptions(inventoryModuleState.products);
  const lines = stockReceiptLines.map((line) => {
    const ref = refs.find((item) => item.key === line.productKey);
    return {
      productId: ref?.productId || '',
      variantId: ref?.variantId || '',
      locationId,
      quantity: line.quantity === '' ? undefined : Number(line.quantity),
      countedQuantity: line.countedQuantity === '' ? undefined : Number(line.countedQuantity),
      unitCost: Number(line.unitCost || ref?.unitCost || 0),
      lowStockThreshold: Number(line.lowStockThreshold ?? 5),
      oldGlobalStockObserved: ref?.oldStock === '-' ? null : Number(ref?.oldStock || 0),
      note: line.note || '',
      reason: form.elements.reason?.value || operationType,
    };
  });
  const errors = [];
  if (!locationId) errors.push('Choisissez un emplacement actif.');
  if (lines.some((line) => !line.productId)) errors.push('Chaque ligne doit avoir un produit valide.');
  if (operationType !== 'ADJUSTMENT' && lines.some((line) => !Number.isInteger(line.quantity) || line.quantity < 0 || (operationType === 'RECEIPT' && line.quantity <= 0))) {
    errors.push('Les quantités doivent être entières et valides.');
  }
  if (operationType === 'ADJUSTMENT' && !form.elements.reason?.value) errors.push('Le motif est obligatoire.');
  if (errors.length) {
    errorBox.innerHTML = errors.map((error) => `<div>${escapeHtml(error)}</div>`).join('');
    errorBox.hidden = false;
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Traitement...';
  try {
    await sendStockOperation({
      operationType,
      idempotencyKey: makeIdempotencyKey(operationType.toLowerCase()),
      reference: normalizeText(form.elements.reference?.value) || `${operationType}-${Date.now()}`,
      supplier: normalizeText(form.elements.supplier?.value),
      reason: normalizeText(form.elements.reason?.value || operationType),
      note: normalizeText(form.elements.note?.value),
      lines,
    });
    closeModal();
    showInlineToast('Opération de stock enregistrée.', 'success');
    await renderInventoryModule(context);
  } catch (error) {
    errorBox.innerHTML = escapeHtml(error?.message || 'Operation impossible.');
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirmer l operation';
  }
}

async function sendStockOperation(payload) {
  const user = auth?.currentUser;
  if (!user) throw new Error('Connexion requise.');
  const token = await user.getIdToken();
  const response = await fetch(STOCK_OPERATION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || data.error || 'Operation de stock refusee.');
  }
  return data;
}

async function updateSmartManagementUserPassword(uid, password) {
  const user = auth?.currentUser;
  if (!user) throw new Error('Connexion requise.');
  const token = await user.getIdToken();
  const response = await fetch(SMART_MANAGEMENT_PASSWORD_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ uid, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || data.error || 'Impossible de modifier le mot de passe.');
  }
  return data;
}

function getFilteredMovements() {
  const search = String(movementModuleState.search || '').trim().toLowerCase();
  return movementModuleState.movements.filter((movement) => {
    if (movementModuleState.filterType !== 'all' && movement.type !== movementModuleState.filterType) return false;
    if (movementModuleState.location !== 'all' && movement.locationId !== movementModuleState.location) return false;
    if (movementModuleState.direction === 'in' && movement.quantityChange <= 0) return false;
    if (movementModuleState.direction === 'out' && movement.quantityChange >= 0) return false;
    if (search && !movement.searchText.includes(search)) return false;
    return true;
  });
}

async function renderMovementsModule(context, options = {}) {
  const permissions = getSmartManagementPermissions(context);
  const content = document.getElementById('contentArea');
  if (!permissions.canReadProducts) {
    content.innerHTML = '<div class="error-state"><strong>Accès refusé.</strong></div>';
    return;
  }
  if (options.reload !== false) {
    content.innerHTML = '<div class="loading-state">Chargement des mouvements...</div>';
    const [movements, locations, products] = await Promise.all([
      loadStockMovements(400),
      loadLocations(),
      loadProducts(),
    ]);
    movementModuleState.movements = movements;
    movementModuleState.locations = locations;
    movementModuleState.products = products;
  }
  const movements = getFilteredMovements();
  content.innerHTML = `
    <section class="movements-page">
      <div class="module-hero">
        <div>
          <p class="eyebrow">Journal immutable</p>
          <h2>Mouvements de stock</h2>
          <p>Chaque ligne explique quoi a change, ou, avant/apres, pourquoi et par quelle operation.</p>
        </div>
      </div>
      <section class="panel">
        <div class="panel-body">
          <div class="products-toolbar">
            <input id="movementSearchInput" type="search" value="${escapeHtml(movementModuleState.search)}" placeholder="Rechercher reference, produit, SKU, motif...">
            <select id="movementTypeFilter">
              <option value="all">Tous les types</option>
              ${MOVEMENT_TYPES.map((type) => `<option value="${type}" ${movementModuleState.filterType === type ? 'selected' : ''}>${type}</option>`).join('')}
            </select>
            <select id="movementLocationFilter">
              <option value="all">Tous les emplacements</option>
              ${movementModuleState.locations.map((location) => `<option value="${escapeHtml(location.id)}" ${movementModuleState.location === location.id ? 'selected' : ''}>${escapeHtml(location.name)}</option>`).join('')}
            </select>
          </div>
          <div class="filter-pills product-filter-pills">
            <button class="filter-pill ${movementModuleState.direction === 'all' ? 'is-active' : ''}" data-movement-direction="all" type="button">Tous</button>
            <button class="filter-pill ${movementModuleState.direction === 'in' ? 'is-active' : ''}" data-movement-direction="in" type="button">Entrees</button>
            <button class="filter-pill ${movementModuleState.direction === 'out' ? 'is-active' : ''}" data-movement-direction="out" type="button">Sorties</button>
          </div>
          ${renderMovementList(movements)}
        </div>
      </section>
    </section>
  `;
  bindMovementEvents(context);
}

function renderMovementList(movements = []) {
  if (!movements.length) return '<div class="empty-state">Aucun mouvement disponible.</div>';
  return `
    <div class="table-wrap">
      <table class="data-table movement-table">
        <thead><tr><th>Date</th><th>Reference</th><th>Type</th><th>Produit</th><th>Emplacement</th><th>Avant</th><th>Variation</th><th>Apres</th><th>Motif</th></tr></thead>
        <tbody>
          ${movements.map((movement) => `
            <tr>
              <td>${escapeHtml(formatDate(movement.createdAt))}</td>
              <td>${escapeHtml(movement.reference || '-')}</td>
              <td>${statusBadge(movement.type)}</td>
              <td><strong>${escapeHtml(movement.productName || '-')}</strong><br><small>${escapeHtml(movement.variantLabel || movement.sku || '-')}</small></td>
              <td>${escapeHtml(movement.locationName || '-')}</td>
              <td>${escapeHtml(movement.beforePhysicalQty)}</td>
              <td class="${movement.quantityChange >= 0 ? 'stock-in' : 'stock-out'}">${movement.quantityChange >= 0 ? '+' : ''}${escapeHtml(movement.quantityChange)}</td>
              <td>${escapeHtml(movement.afterPhysicalQty)}</td>
              <td>${escapeHtml(movement.reason || '-')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function bindMovementEvents(context) {
  document.getElementById('movementSearchInput')?.addEventListener('input', (event) => {
    movementModuleState.search = event.target.value;
    renderMovementsModule(context, { reload: false });
  });
  document.getElementById('movementTypeFilter')?.addEventListener('change', (event) => {
    movementModuleState.filterType = event.target.value || 'all';
    renderMovementsModule(context, { reload: false });
  });
  document.getElementById('movementLocationFilter')?.addEventListener('change', (event) => {
    movementModuleState.location = event.target.value || 'all';
    renderMovementsModule(context, { reload: false });
  });
  document.querySelectorAll('[data-movement-direction]').forEach((button) => {
    button.addEventListener('click', () => {
      movementModuleState.direction = button.dataset.movementDirection || 'all';
      renderMovementsModule(context, { reload: false });
    });
  });
}

async function renderTransfersModule(context, options = {}) {
  const permissions = getSmartManagementPermissions(context);
  const content = document.getElementById('contentArea');
  if (!permissions.canReadProducts) {
    content.innerHTML = '<div class="error-state"><strong>Accès refusé.</strong></div>';
    return;
  }
  if (options.reload !== false) {
    content.innerHTML = '<div class="loading-state">Chargement des transferts...</div>';
    const [transfers, balances, locations, products] = await Promise.all([
      loadStockTransfers(300),
      loadStockBalances(),
      loadLocations(),
      loadProducts(),
    ]);
    transferModuleState.transfers = transfers;
    transferModuleState.balances = balances;
    transferModuleState.locations = locations;
    transferModuleState.products = products;
  }
  const transfers = getFilteredTransfers();
  const summary = getTransferSummary(transferModuleState.transfers);
  content.innerHTML = `
    <section class="transfers-page">
      <div class="module-hero">
        <div>
          <p class="eyebrow">Stock multi-emplacements</p>
          <h2>Transferts de stock</h2>
          <p>Deplacez le stock entre magasins et depots avec approbation, expedition, reception, transit et historique complet.</p>
        </div>
        <div class="module-actions">
          ${permissions.canManageProducts ? '<button class="primary-btn" id="newTransferBtn" type="button">Nouveau transfert</button>' : '<span class="badge info">Lecture seule</span>'}
        </div>
      </div>
      <div class="stat-grid product-summary-grid">
        ${statCard('Brouillons', summary.draft, 'Sans impact stock.', 'tone-gray', 'B')}
        ${statCard('En attente', summary.pending_approval, 'A approuver.', 'tone-orange', '!')}
        ${statCard('Approuvés', summary.approved, 'Prêts à expédier.', 'tone-blue', 'A')}
        ${statCard('En transit', summary.in_transit, `${summary.inTransitQty} unité(s) hors stock vendable.`, 'tone-orange', 'T')}
        ${statCard('Partiels', summary.partially_received, 'Réception incomplète.', 'tone-orange', 'P')}
        ${statCard('Reçus', summary.received, 'Transferts terminés.', 'tone-green', 'R')}
        ${statCard('Annulés/refusés', summary.cancelled + summary.rejected, 'Historique conservé.', 'tone-red', 'X')}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Pilotage des transferts</h2>
            <p class="panel-subtitle">Le stock sort à l'expédition et entre seulement à la réception.</p>
          </div>
        </div>
        <div class="panel-body">
          ${renderTransferToolbar()}
          ${transfers.length ? renderTransferTable(transfers, permissions) : '<div class="empty-state">Aucun transfert ne correspond à ces critères.</div>'}
        </div>
      </section>
    </section>
  `;
  bindTransferEvents(context, permissions);
}

function renderTransferToolbar() {
  return `
    <div class="products-toolbar">
      <input id="transferSearchInput" type="search" value="${escapeHtml(transferModuleState.search)}" placeholder="Rechercher numéro, produit, SKU, source, destination...">
      <select id="transferSourceFilter">
        <option value="all">Toutes les sources</option>
        ${transferModuleState.locations.map((location) => `<option value="${escapeHtml(location.id)}" ${transferModuleState.source === location.id ? 'selected' : ''}>${escapeHtml(location.name)}</option>`).join('')}
      </select>
      <select id="transferDestinationFilter">
        <option value="all">Toutes les destinations</option>
        ${transferModuleState.locations.map((location) => `<option value="${escapeHtml(location.id)}" ${transferModuleState.destination === location.id ? 'selected' : ''}>${escapeHtml(location.name)}</option>`).join('')}
      </select>
    </div>
    <div class="filter-pills product-filter-pills">
      ${TRANSFER_STATUSES.map((status) => `<button class="filter-pill ${transferModuleState.status === status ? 'is-active' : ''}" type="button" data-transfer-status="${status}">${escapeHtml(status === 'all' ? 'Tous' : getTransferStatusLabel(status))}</button>`).join('')}
    </div>
  `;
}

function renderTransferTable(transfers = [], permissions = {}) {
  return `
    <div class="table-wrap transfer-table-wrap">
      <table class="data-table transfer-table">
        <thead><tr><th>Numéro</th><th>Statut</th><th>Source</th><th>Destination</th><th>Quantités</th><th>Dates</th><th>Actions</th></tr></thead>
        <tbody>
          ${transfers.map((transfer) => `
            <tr>
              <td><strong>${escapeHtml(transfer.transferNumber || transfer.reference || transfer.id)}</strong><br><small>${escapeHtml(transfer.reason || '-')}</small></td>
              <td>${transferStatusBadge(transfer.status)}</td>
              <td>${escapeHtml(transfer.sourceLocationName || '-')}</td>
              <td>${escapeHtml(transfer.destinationLocationName || '-')}</td>
              <td>
                <strong>${escapeHtml(transfer.totalRequestedQty)}</strong> demandé(s)<br>
                <small>${escapeHtml(transfer.totalShippedQty)} expédié(s) · ${escapeHtml(transfer.totalReceivedQty)} reçu(s) · ${escapeHtml(toNumber(transfer.inTransitQty))} en transit</small>
              </td>
              <td><small>Créé : ${escapeHtml(formatDate(transfer.createdAt))}<br>Maj : ${escapeHtml(formatDate(transfer.updatedAt))}</small></td>
              <td><div class="row-actions">${renderTransferActions(transfer, permissions)}</div></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderTransferActions(transfer = {}, permissions = {}) {
  const id = escapeHtml(transfer.id);
  const detail = `<button class="secondary-btn small-btn" type="button" data-transfer-detail="${id}">Détail</button>`;
  if (!permissions.canManageProducts) return detail;
  const actions = [detail];
  if (transfer.status === 'draft') {
    actions.push(`<button class="primary-btn small-btn" type="button" data-transfer-action="${TRANSFER_ACTIONS.SUBMIT}" data-transfer-id="${id}">Soumettre</button>`);
    actions.push(`<button class="secondary-btn small-btn danger-outline" type="button" data-transfer-action="${TRANSFER_ACTIONS.CANCEL}" data-transfer-id="${id}">Annuler</button>`);
  } else if (transfer.status === 'pending_approval') {
    actions.push(`<button class="primary-btn small-btn" type="button" data-transfer-action="${TRANSFER_ACTIONS.APPROVE}" data-transfer-id="${id}">Approuver</button>`);
    actions.push(`<button class="secondary-btn small-btn danger-outline" type="button" data-transfer-action="${TRANSFER_ACTIONS.REJECT}" data-transfer-id="${id}">Refuser</button>`);
  } else if (transfer.status === 'approved') {
    actions.push(`<button class="primary-btn small-btn" type="button" data-transfer-action="${TRANSFER_ACTIONS.SHIP}" data-transfer-id="${id}">Expédier</button>`);
    actions.push(`<button class="secondary-btn small-btn danger-outline" type="button" data-transfer-action="${TRANSFER_ACTIONS.CANCEL}" data-transfer-id="${id}">Annuler</button>`);
  } else if (transfer.status === 'in_transit' || transfer.status === 'partially_received') {
    actions.push(`<button class="primary-btn small-btn" type="button" data-transfer-action="${TRANSFER_ACTIONS.RECEIVE}" data-transfer-id="${id}">Recevoir</button>`);
  }
  return actions.join('');
}

function bindTransferEvents(context, permissions = {}) {
  document.getElementById('newTransferBtn')?.addEventListener('click', () => openTransferModal(context));
  document.getElementById('transferSearchInput')?.addEventListener('input', (event) => {
    transferModuleState.search = event.target.value;
    renderTransfersModule(context, { reload: false });
  });
  document.getElementById('transferSourceFilter')?.addEventListener('change', (event) => {
    transferModuleState.source = event.target.value || 'all';
    renderTransfersModule(context, { reload: false });
  });
  document.getElementById('transferDestinationFilter')?.addEventListener('change', (event) => {
    transferModuleState.destination = event.target.value || 'all';
    renderTransfersModule(context, { reload: false });
  });
  document.querySelectorAll('[data-transfer-status]').forEach((button) => {
    button.addEventListener('click', () => {
      transferModuleState.status = button.dataset.transferStatus || 'all';
      renderTransfersModule(context, { reload: false });
    });
  });
  document.querySelectorAll('[data-transfer-detail]').forEach((button) => {
    button.addEventListener('click', () => openTransferDetail(button.dataset.transferDetail));
  });
  document.querySelectorAll('[data-transfer-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const transfer = transferModuleState.transfers.find((item) => item.id === button.dataset.transferId);
      if (transfer) openTransferActionModal(context, transfer, button.dataset.transferAction, permissions);
    });
  });
}

function openTransferModal(context) {
  const locations = getActiveLocations(transferModuleState.locations);
  const defaultSource = locations[0]?.id || '';
  const defaultDestination = locations.find((location) => location.id !== defaultSource)?.id || '';
  const options = getTransferBalanceOptions(defaultSource);
  stockTransferLines = [{
    productKey: options[0]?.key || '',
    quantity: 1,
    note: '',
  }];
  openModal(`
    <form id="transferForm" class="product-form">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Transfert</p>
          <h2>Nouveau transfert</h2>
        </div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="form-grid">
        <label class="field">
          <span>Source *</span>
          <select name="sourceLocationId" id="transferSourceSelect" required>
            <option value="">Selectionner...</option>
            ${locations.map((location) => `<option value="${escapeHtml(location.id)}" ${location.id === defaultSource ? 'selected' : ''}>${escapeHtml(location.name)} · ${escapeHtml(location.code || '')}</option>`).join('')}
          </select>
        </label>
        <label class="field">
          <span>Destination *</span>
          <select name="destinationLocationId" required>
            <option value="">Selectionner...</option>
            ${locations.map((location) => `<option value="${escapeHtml(location.id)}" ${location.id === defaultDestination ? 'selected' : ''}>${escapeHtml(location.name)} · ${escapeHtml(location.code || '')}</option>`).join('')}
          </select>
        </label>
        ${formField('expectedShipDate', 'Date prevue expedition', '', 'date')}
        ${formField('expectedReceiveDate', 'Date prevue reception', '', 'date')}
        ${formField('reason', 'Motif', 'Reapprovisionnement interne', 'text')}
        <label class="field field-full">
          <span>Note interne</span>
          <textarea name="note" rows="3"></textarea>
        </label>
      </div>
      <section class="form-section">
        <div class="section-title-line">
          <h3>Lignes a transferer</h3>
          <button class="secondary-btn small-btn" type="button" id="addTransferLineBtn">Ajouter une ligne</button>
        </div>
        <div id="transferLinesArea"></div>
      </section>
      <div class="form-error" id="transferFormError" hidden></div>
      <div class="modal-actions">
        <button class="primary-btn" id="submitTransferBtn" type="submit">Creer le brouillon</button>
        <button class="secondary-btn" type="button" data-close-modal>Annuler</button>
      </div>
    </form>
  `);
  renderTransferLines(defaultSource);
  document.getElementById('transferSourceSelect')?.addEventListener('change', (event) => {
    const sourceId = event.target.value || '';
    const sourceOptions = getTransferBalanceOptions(sourceId);
    stockTransferLines = [{ productKey: sourceOptions[0]?.key || '', quantity: 1, note: '' }];
    renderTransferLines(sourceId);
  });
  document.getElementById('addTransferLineBtn')?.addEventListener('click', () => {
    const sourceId = document.getElementById('transferSourceSelect')?.value || '';
    const sourceOptions = getTransferBalanceOptions(sourceId);
    stockTransferLines.push({ productKey: sourceOptions[0]?.key || '', quantity: 1, note: '' });
    renderTransferLines(sourceId);
  });
  document.getElementById('transferForm')?.addEventListener('submit', (event) => submitTransferForm(event, context));
}

function renderTransferLines(sourceLocationId = '') {
  const area = document.getElementById('transferLinesArea');
  if (!area) return;
  const options = getTransferBalanceOptions(sourceLocationId);
  area.innerHTML = `
    <div class="variant-edit-list">
      ${stockTransferLines.map((line, index) => {
        const selected = options.find((option) => option.key === line.productKey) || options[0] || {};
        return `
          <article class="transfer-line-row">
            <label class="field">
              <span>Produit / variante *</span>
              <select data-transfer-line-field="productKey" data-index="${index}" required>
                <option value="">Selectionner...</option>
                ${options.map((option) => `<option value="${escapeHtml(option.key)}" ${line.productKey === option.key ? 'selected' : ''}>${escapeHtml(option.label)} ${option.sku ? `· ${escapeHtml(option.sku)}` : ''}</option>`).join('')}
              </select>
              <small>Disponible: ${escapeHtml(selected.availableQty ?? 0)} · Physique: ${escapeHtml(selected.physicalQty ?? 0)} · Reserve: ${escapeHtml(selected.reservedQty ?? 0)}</small>
            </label>
            <label class="field">
              <span>Quantite *</span>
              <input data-transfer-line-field="quantity" data-index="${index}" type="number" min="1" step="1" value="${escapeHtml(line.quantity || 1)}">
            </label>
            <label class="field">
              <span>Note ligne</span>
              <input data-transfer-line-field="note" data-index="${index}" type="text" value="${escapeHtml(line.note || '')}">
            </label>
            ${stockTransferLines.length > 1 ? `<button class="secondary-btn small-btn danger-outline" type="button" data-remove-transfer-line="${index}">Retirer</button>` : ''}
          </article>
        `;
      }).join('')}
    </div>
  `;
  area.querySelectorAll('[data-transfer-line-field]').forEach((input) => {
    input.addEventListener('input', () => updateTransferLineField(input));
    input.addEventListener('change', () => updateTransferLineField(input));
  });
  area.querySelectorAll('[data-remove-transfer-line]').forEach((button) => {
    button.addEventListener('click', () => {
      stockTransferLines.splice(Number(button.dataset.removeTransferLine), 1);
      renderTransferLines(sourceLocationId);
    });
  });
}

function updateTransferLineField(input) {
  const index = Number(input.dataset.index);
  const field = input.dataset.transferLineField;
  if (!stockTransferLines[index]) return;
  stockTransferLines[index][field] = input.value;
}

async function submitTransferForm(event, context) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = document.getElementById('transferFormError');
  const submitBtn = document.getElementById('submitTransferBtn');
  errorBox.hidden = true;
  const sourceLocationId = form.elements.sourceLocationId?.value || '';
  const destinationLocationId = form.elements.destinationLocationId?.value || '';
  const options = getTransferBalanceOptions(sourceLocationId);
  const lines = stockTransferLines.map((line) => {
    const ref = options.find((item) => item.key === line.productKey);
    return {
      productId: ref?.productId || '',
      variantId: ref?.variantId || '',
      quantity: Number(line.quantity || 0),
      unitCost: Number(ref?.unitCost || 0),
      lowStockThreshold: Number(ref?.lowStockThreshold ?? 5),
      note: line.note || '',
    };
  });
  const errors = [];
  if (!sourceLocationId) errors.push('Choisissez l emplacement source.');
  if (!destinationLocationId) errors.push('Choisissez l emplacement destination.');
  if (sourceLocationId && destinationLocationId && sourceLocationId === destinationLocationId) errors.push('La source et la destination doivent etre differentes.');
  if (!lines.length || lines.some((line) => !line.productId)) errors.push('Chaque ligne doit avoir un produit disponible a la source.');
  if (lines.some((line) => !Number.isInteger(line.quantity) || line.quantity <= 0)) errors.push('Chaque quantite doit etre entiere et positive.');
  const seen = new Set();
  lines.forEach((line) => {
    const key = `${line.productId}|${line.variantId || ''}`;
    if (seen.has(key)) errors.push('Fusionnez les lignes identiques avant de continuer.');
    seen.add(key);
    const available = options.find((item) => item.productId === line.productId && item.variantId === (line.variantId || ''))?.availableQty || 0;
    if (line.quantity > available) errors.push(`Stock disponible insuffisant pour ${line.productId}.`);
  });
  if (errors.length) {
    errorBox.innerHTML = errors.map((error) => `<div>${escapeHtml(error)}</div>`).join('');
    errorBox.hidden = false;
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Creation...';
  try {
    await sendStockOperation({
      operationType: 'TRANSFER',
      action: 'create_draft',
      idempotencyKey: makeIdempotencyKey('transfer-create'),
      sourceLocationId,
      destinationLocationId,
      expectedShipDate: form.elements.expectedShipDate?.value || '',
      expectedReceiveDate: form.elements.expectedReceiveDate?.value || '',
      reason: normalizeText(form.elements.reason?.value || 'Transfert interne'),
      note: normalizeText(form.elements.note?.value),
      lines,
    });
    closeModal();
    showInlineToast('Brouillon de transfert cree.', 'success');
    await renderTransfersModule(context);
  } catch (error) {
    errorBox.innerHTML = escapeHtml(error?.message || 'Transfert impossible.');
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Creer le brouillon';
  }
}

function openTransferDetail(transferId) {
  const transfer = transferModuleState.transfers.find((item) => item.id === transferId);
  if (!transfer) return;
  const history = Array.isArray(transfer.history) ? transfer.history : [];
  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">Detail transfert</p>
        <h2>${escapeHtml(transfer.transferNumber || transfer.reference || transfer.id)}</h2>
      </div>
      <button class="icon-btn" type="button" data-close-modal>×</button>
    </div>
    <div class="transfer-detail-grid">
      <div><strong>Statut</strong><br>${transferStatusBadge(transfer.status)}</div>
      <div><strong>Source</strong><br>${escapeHtml(transfer.sourceLocationName || '-')}</div>
      <div><strong>Destination</strong><br>${escapeHtml(transfer.destinationLocationName || '-')}</div>
      <div><strong>En transit</strong><br>${escapeHtml(toNumber(transfer.inTransitQty))}</div>
      <div><strong>Expedition prevue</strong><br>${escapeHtml(transfer.expectedShipDate || '-')}</div>
      <div><strong>Reception prevue</strong><br>${escapeHtml(transfer.expectedReceiveDate || '-')}</div>
    </div>
    <section class="form-section">
      <h3>Lignes</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Produit</th><th>SKU</th><th>Demande</th><th>Expedie</th><th>Recu</th><th>Restant</th></tr></thead>
          <tbody>
            ${(transfer.lines || []).map((line) => `
              <tr>
                <td><strong>${escapeHtml(line.productName || '-')}</strong><br><small>${escapeHtml(line.variantLabel || '-')}</small></td>
                <td>${escapeHtml(line.sku || line.barcode || '-')}</td>
                <td>${escapeHtml(toNumber(line.requestedQty))}</td>
                <td>${escapeHtml(toNumber(line.shippedQty))}</td>
                <td>${escapeHtml(toNumber(line.receivedQty))}</td>
                <td>${escapeHtml(Math.max(0, toNumber(line.shippedQty) - toNumber(line.receivedQty) - toNumber(line.closedDiscrepancyQty)))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </section>
    <section class="form-section">
      <h3>Timeline</h3>
      <div class="timeline-list">
        ${history.length ? history.map((entry) => `
          <div class="timeline-item">
            <strong>${escapeHtml(entry.type || '-')}</strong>
            <span>${escapeHtml(formatDate(entry.at))}</span>
            <p>${escapeHtml(entry.fromStatus || '-')} → ${escapeHtml(entry.toStatus || '-')} ${entry.note ? `· ${escapeHtml(entry.note)}` : ''}</p>
          </div>
        `).join('') : '<div class="empty-state">Aucun evenement disponible.</div>'}
      </div>
    </section>
  `);
}

function openTransferActionModal(context, transfer, action, permissions = {}) {
  if (!permissions.canManageProducts) return;
  const title = {
    [TRANSFER_ACTIONS.SUBMIT]: 'Soumettre le transfert',
    [TRANSFER_ACTIONS.APPROVE]: 'Approuver le transfert',
    [TRANSFER_ACTIONS.REJECT]: 'Refuser le transfert',
    [TRANSFER_ACTIONS.CANCEL]: 'Annuler le transfert',
    [TRANSFER_ACTIONS.SHIP]: 'Expedier le transfert',
    [TRANSFER_ACTIONS.RECEIVE]: 'Recevoir le transfert',
  }[action] || 'Action transfert';
  const isReceive = action === TRANSFER_ACTIONS.RECEIVE;
  openModal(`
    <form id="transferActionForm" class="product-form">
      <div class="modal-header">
        <div>
          <p class="eyebrow">Workflow transfert</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <p class="modal-copy">${escapeHtml(transfer.transferNumber || transfer.id)} · ${escapeHtml(transfer.sourceLocationName || '-')} vers ${escapeHtml(transfer.destinationLocationName || '-')}</p>
      ${isReceive ? renderReceiveLines(transfer) : ''}
      <label class="field field-full">
        <span>Note ${action === TRANSFER_ACTIONS.REJECT || action === TRANSFER_ACTIONS.CANCEL ? '*' : ''}</span>
        <textarea name="note" rows="3"></textarea>
      </label>
      <div class="form-error" id="transferActionError" hidden></div>
      <div class="modal-actions">
        <button class="primary-btn" id="confirmTransferActionBtn" type="submit">Confirmer</button>
        <button class="secondary-btn" type="button" data-close-modal>Fermer</button>
      </div>
    </form>
  `);
  document.getElementById('transferActionForm')?.addEventListener('submit', (event) => submitTransferAction(event, context, transfer, action));
}

function renderReceiveLines(transfer = {}) {
  return `
    <section class="form-section">
      <h3>Quantites recues maintenant</h3>
      <div class="variant-edit-list">
        ${(transfer.lines || []).map((line, index) => {
          const remaining = Math.max(0, toNumber(line.shippedQty) - toNumber(line.receivedQty) - toNumber(line.closedDiscrepancyQty));
          return `
            <article class="transfer-line-row">
              <div>
                <strong>${escapeHtml(line.productName || '-')}</strong><br>
                <small>${escapeHtml(line.variantLabel || line.sku || '-')} · restant: ${escapeHtml(remaining)}</small>
              </div>
              <label class="field">
                <span>Recu</span>
                <input name="receivedQty_${index}" type="number" min="0" max="${escapeHtml(remaining)}" step="1" value="${escapeHtml(remaining)}">
              </label>
              <label class="field">
                <span>Endommage/refuse</span>
                <input name="discrepancyQty_${index}" type="number" min="0" max="${escapeHtml(remaining)}" step="1" value="0">
              </label>
              <label class="field">
                <span>Note ligne</span>
                <input name="lineNote_${index}" type="text">
              </label>
            </article>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

async function submitTransferAction(event, context, transfer, action) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = document.getElementById('transferActionError');
  const submitBtn = document.getElementById('confirmTransferActionBtn');
  errorBox.hidden = true;
  const note = normalizeText(form.elements.note?.value || '');
  if ((action === TRANSFER_ACTIONS.REJECT || action === TRANSFER_ACTIONS.CANCEL) && !note) {
    errorBox.textContent = 'Une justification est obligatoire.';
    errorBox.hidden = false;
    return;
  }
  const receiveLines = action === TRANSFER_ACTIONS.RECEIVE
    ? (transfer.lines || []).map((line, index) => ({
      lineId: line.lineId,
      receivedQty: Number(form.elements[`receivedQty_${index}`]?.value || 0),
      discrepancyQty: Number(form.elements[`discrepancyQty_${index}`]?.value || 0),
      note: form.elements[`lineNote_${index}`]?.value || '',
    }))
    : [];
  submitBtn.disabled = true;
  submitBtn.textContent = 'Traitement...';
  try {
    await sendStockOperation({
      operationType: 'TRANSFER',
      action,
      transferId: transfer.id,
      idempotencyKey: makeIdempotencyKey(`transfer-${action}`),
      note,
      receiveLines,
    });
    closeModal();
    showInlineToast('Transfert mis a jour.', 'success');
    await renderTransfersModule(context);
  } catch (error) {
    errorBox.innerHTML = escapeHtml(error?.message || 'Action impossible.');
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Confirmer';
  }
}

async function loadDashboardData() {
  const [
    productCount,
    vendorProductCount,
    clientCount,
    orders,
    recentProducts,
    vendorProducts,
    stockBalances,
    stockMovements,
    stockTransfers,
    posSales,
    recentClients,
    returnRequests,
  ] = await Promise.all([
    safeCount(collection(db, 'products')),
    safeCount(collection(db, 'vendorProducts')),
    safeCount(collection(db, 'clients')),
    safeGetDocs(query(collectionGroup(db, 'orders'), orderBy('createdAt', 'desc'), limit(80))),
    safeGetDocs(query(collection(db, 'products'), limit(80))),
    safeGetDocs(query(collection(db, 'vendorProducts'), limit(80))),
    loadStockBalances(),
    loadStockMovements(12),
    loadStockTransfers(80),
    loadPosSales(80),
    safeGetDocs(query(collection(db, 'clients'), orderBy('createdAt', 'desc'), limit(80))),
    safeGetDocs(query(collection(db, 'returnRequests'), orderBy('createdAt', 'desc'), limit(80))),
  ]);

  const today = startOfToday();
  const month = startOfMonth();
  const periodStart = getDashboardPeriodStart();
  const topProductsStart = getDashboardPeriodStart(dashboardState.topProductsPeriod);
  const paidOrders = orders.filter(isPaidOrder);
  const selectedPaidOrders = paidOrders.filter((order) => getOrderDate(order) >= periodStart);
  const webOrdersToday = orders.filter((order) => getOrderDate(order) >= today);
  const selectedWebOrders = orders.filter((order) => getOrderDate(order) >= periodStart);
  const salesToday = paidOrders.filter((order) => getOrderDate(order) >= today);
  const salesMonth = paidOrders.filter((order) => getOrderDate(order) >= month);
  const completedPosSales = posSales.filter((sale) => String(sale.status || '').toLowerCase() === 'completed');
  const posSalesToday = completedPosSales.filter((sale) => getOrderDate(sale) >= today);
  const selectedPosSales = completedPosSales.filter((sale) => getOrderDate(sale) >= periodStart);
  const newClientsToday = recentClients.filter((client) => getRecordDate(client) >= today);
  const selectedNewClients = recentClients.filter((client) => getRecordDate(client) >= periodStart);
  const returnsToday = returnRequests.filter((request) => getRecordDate(request) >= today);
  const selectedReturns = returnRequests.filter((request) => getRecordDate(request) >= periodStart);
  const pendingOrders = orders.filter((order) => {
    const status = String(order?.status || order?.paymentStatus || '').toLowerCase();
    return !isPaidOrder(order) && !status.includes('cancel') && !status.includes('failed');
  });

  const products = [...recentProducts, ...vendorProducts];
  const stockProducts = products.filter((product) => product?.isDigitalProduct !== true);
  const lowStock = stockProducts.filter((product) => {
    const stock = toNumber(product?.stock);
    return stock > 0 && stock <= 5;
  });
  const outOfStock = stockProducts.filter((product) => toNumber(product?.stock) <= 0);
  const realLowStock = stockBalances.filter((balance) => getInventoryStatus(balance) === 'low-stock');
  const realOutOfStock = stockBalances.filter((balance) => getInventoryStatus(balance) === 'out-of-stock');
  const dashboardLowStock = realLowStock.length ? realLowStock : lowStock;
  const dashboardOutOfStock = realOutOfStock.length ? realOutOfStock : outOfStock;
  const transferSummary = getTransferSummary(stockTransfers);
  const salesEvolution = buildSalesEvolution(selectedPaidOrders, selectedPosSales);
  const categoryBreakdown = buildCategoryBreakdown(selectedPaidOrders, selectedPosSales);
  const storeSales = buildStoreSales(selectedPaidOrders);
  const dailySummary = {
    label: getDashboardPeriodLabel(),
    sales: selectedPaidOrders.reduce((sum, order) => sum + getOrderAmount(order), 0) + selectedPosSales.reduce((sum, sale) => sum + getOrderAmount(sale), 0),
    orders: selectedWebOrders.length + selectedPosSales.length,
    newClients: selectedNewClients.length,
    returns: selectedReturns.length,
    webSales: selectedPaidOrders.reduce((sum, order) => sum + getOrderAmount(order), 0),
    posSales: selectedPosSales.reduce((sum, sale) => sum + getOrderAmount(sale), 0),
  };

  const byProduct = new Map();
  paidOrders.filter((order) => getOrderDate(order) >= topProductsStart).forEach((order) => {
    getOrderItems(order).forEach((item) => {
      const key = item?.productId || item?.id || item?.name || 'Produit';
      const current = byProduct.get(key) || {
        name: item?.name || item?.title || 'Produit',
        quantity: 0,
        amount: 0,
      };
      const quantity = getItemQuantity(item);
      current.quantity += quantity;
      current.amount += getItemLineAmount(item);
      byProduct.set(key, current);
    });
  });

  return {
    stats: {
      salesToday: selectedPaidOrders.reduce((sum, order) => sum + getOrderAmount(order), 0),
      salesMonth: salesMonth.reduce((sum, order) => sum + getOrderAmount(order), 0),
      posSalesToday: selectedPosSales.reduce((sum, sale) => sum + getOrderAmount(sale), 0),
      webOrdersToday: selectedWebOrders.length,
      totalProducts: productCount + vendorProductCount,
      lowStockCount: dashboardLowStock.length,
      outOfStockCount: dashboardOutOfStock.length,
      pendingOrders: pendingOrders.length,
      openCashSessions: 0,
      clients: clientCount,
      estimatedGrossProfit: 0,
      transfersPending: transferSummary.pending_approval + transferSummary.approved,
      transfersInTransit: transferSummary.in_transit + transferSummary.partially_received,
      stockInTransit: transferSummary.inTransitQty,
    },
    salesEvolution,
    categoryBreakdown,
    storeSales,
    dailySummary,
    recentSales: paidOrders.slice(0, 6),
    recentOrders: orders.slice(0, 6),
    lowStock: dashboardLowStock.slice(0, 8),
    topProducts: Array.from(byProduct.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 6),
    stockMovements: stockMovements.slice(0, 8),
    stockTransfers: stockTransfers.slice(0, 6),
    activities: buildRecentActivities({
      paidOrders,
      orders,
      stockMovements,
      stockTransfers,
      products,
    }),
    alerts: [
      ...(dashboardLowStock.length ? [{ type: 'warning', text: `${dashboardLowStock.length} reference(s) avec stock faible.` }] : []),
      ...(dashboardOutOfStock.length ? [{ type: 'danger', text: `${dashboardOutOfStock.length} reference(s) en rupture de stock.` }] : []),
      ...(pendingOrders.length ? [{ type: 'info', text: `${pendingOrders.length} commande(s) en attente de traitement.` }] : []),
    ],
  };
}

function getOrderCategory(item = {}) {
  return String(
    item.categoryName ||
    item.category ||
    item.categoryLabel ||
    item.mainCategory ||
    'Autres'
  ).trim() || 'Autres';
}

function getOrderItems(order = {}) {
  if (Array.isArray(order.items)) return order.items;
  if (Array.isArray(order.cartItems)) return order.cartItems;
  if (Array.isArray(order.products)) return order.products;
  if (Array.isArray(order.lines)) return order.lines;
  if (Array.isArray(order.saleItems)) return order.saleItems;
  return [];
}

function getDashboardPeriodStart(period = dashboardState.period) {
  const today = startOfToday();
  if (period === 'week') {
    const start = new Date(today);
    start.setDate(today.getDate() - 6);
    return start;
  }
  if (period === 'month') return startOfMonth();
  if (period === 'all') return new Date(0);
  return today;
}

function getDashboardPeriodLabel(period = dashboardState.period) {
  if (period === 'week') return '7 derniers jours';
  if (period === 'month') return 'Ce mois-ci';
  if (period === 'all') return 'Toutes les dates';
  return "Aujourd'hui";
}

function getTopProductsPeriodLabel(period = dashboardState.topProductsPeriod) {
  if (period === 'month') return 'Ce mois-ci';
  if (period === 'all') return 'Toutes les ventes';
  return 'Cette semaine';
}

function getOrderClientName(order = {}) {
  return String(
    order.customerName ||
    order.customer?.name ||
    [order.customerFirstName, order.customerLastName].filter(Boolean).join(' ') ||
    order.clientName ||
    order.name ||
    order.email ||
    'Client'
  ).trim();
}

function getOrderStoreName(item = {}, order = {}) {
  return String(
    item.storeName ||
    item.vendorName ||
    item.shopName ||
    order.storeName ||
    order.vendorName ||
    'Magasin principal'
  ).trim();
}

function buildSalesEvolution(orders = [], posSales = []) {
  const today = startOfToday();
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (6 - index));
    const next = new Date(day);
    next.setDate(day.getDate() + 1);
    const dayOrders = orders.filter((order) => {
      const date = getOrderDate(order);
      return date >= day && date < next;
    });
    const dayPosSales = posSales.filter((sale) => {
      const date = getOrderDate(sale);
      return date >= day && date < next;
    });
    return {
      label: day.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }),
      amount: dayOrders.reduce((sum, order) => sum + getOrderAmount(order), 0) + dayPosSales.reduce((sum, sale) => sum + getOrderAmount(sale), 0),
      orders: dayOrders.length + dayPosSales.length,
    };
  });
}

function buildCategoryBreakdown(orders = [], posSales = []) {
  const byCategory = new Map();
  [...orders, ...posSales].forEach((order) => {
    getOrderItems(order).forEach((item) => {
      const name = getOrderCategory(item);
      const amount = getItemLineAmount(item);
      const current = byCategory.get(name) || { name, amount: 0 };
      current.amount += amount;
      byCategory.set(name, current);
    });
  });
  const total = Array.from(byCategory.values()).reduce((sum, entry) => sum + entry.amount, 0) || 1;
  return Array.from(byCategory.values())
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((entry) => ({ ...entry, percent: Math.round((entry.amount / total) * 100) }));
}

function buildStoreSales(orders = []) {
  const stores = new Map();
  orders.forEach((order) => {
    getOrderItems(order).forEach((item) => {
      const name = getOrderStoreName(item, order);
      const amount = getItemLineAmount(item);
      const current = stores.get(name) || { name, sales: 0, orders: new Set(), profit: 0 };
      current.sales += amount;
      current.profit += amount * 0.34;
      current.orders.add(order.id || order.uniqueCode || `${name}-${current.orders.size}`);
      stores.set(name, current);
    });
  });
  return Array.from(stores.values())
    .map((store) => ({ ...store, orders: store.orders.size }))
    .sort((a, b) => b.sales - a.sales)
    .slice(0, 5);
}

function buildRecentActivities({ paidOrders = [], orders = [], stockMovements = [], stockTransfers = [], products = [] } = {}) {
  const activities = [
    ...paidOrders.slice(0, 2).map((order) => ({
      icon: 'credit-card',
      label: 'Nouveau paiement reçu',
      time: formatRelativeTime(getOrderDate(order)),
      value: `+${formatMoney(getOrderAmount(order))}`,
      tone: 'green',
    })),
    ...stockMovements.slice(0, 2).map((movement) => ({
      icon: 'boxes',
      label: 'Stock mis à jour',
      time: formatRelativeTime(movement.createdAt || movement.updatedAt),
      value: `${toNumber(movement.quantity || movement.qty || movement.deltaQty)} produits`,
      tone: 'orange',
    })),
    ...orders.slice(0, 2).map((order) => ({
      icon: 'shopping-cart',
      label: `Nouvelle commande ${order.uniqueCode || order.id || ''}`.trim(),
      time: formatRelativeTime(getOrderDate(order)),
      value: formatMoney(getOrderAmount(order)),
      tone: 'green',
    })),
    ...stockTransfers.slice(0, 1).map((transfer) => ({
      icon: 'arrow-right-left',
      label: 'Transfert de stock effectué',
      time: formatRelativeTime(transfer.createdAt || transfer.updatedAt),
      value: `${toNumber(transfer.totalQuantity || transfer.quantity || 0)} produits`,
      tone: 'orange',
    })),
    ...products.slice(0, 1).map((product) => ({
      icon: 'package-plus',
      label: `Produit ajouté : ${product.name || product.title || 'Produit'}`,
      time: formatRelativeTime(product.createdAt || product.updatedAt),
      value: '',
      tone: 'blue',
    })),
  ];
  return activities.slice(0, 5);
}

function formatRelativeTime(value) {
  const date = value?.toDate?.() || new Date(value || 0);
  if (Number.isNaN(date.getTime())) return 'Il y a quelques instants';
  const minutes = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  if (minutes < 60) return `Il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Il y a ${hours} h`;
  return date.toLocaleDateString('fr-FR');
}

function renderAccessCard({ title, message, action = '' }) {
  root.innerHTML = `
    <div class="boot-screen">
      <section class="access-card">
        <div class="brand-mark">SC</div>
        <p class="eyebrow">Smart Management</p>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
        ${action}
      </section>
    </div>
  `;
}

function renderShell(context) {
  root.innerHTML = `
    <div class="smart-shell" id="smartShell">
      <aside class="sidebar" id="sidebar">${renderSidebar(context.route, context)}</aside>
      <div class="mobile-backdrop" id="mobileBackdrop" aria-hidden="true"></div>
      <div class="main-shell">
        <header class="topbar">
          <div class="topbar-left">
            <button class="mobile-menu-btn" id="mobileMenuBtn" type="button" aria-label="Ouvrir la navigation">${lucideIcon('menu')}</button>
            <div class="page-title" id="pageTitle"></div>
          </div>
          <label class="topbar-search" aria-label="Rechercher">
            ${lucideIcon('search', 'search-icon')}
            <input type="search" placeholder="Rechercher..." autocomplete="off">
            <kbd>Ctrl + K</kbd>
          </label>
          <div class="topbar-actions">
            <button class="notification-btn" id="topbarNotificationsBtn" type="button" aria-label="Ouvrir les notifications" title="Notifications">${lucideIcon('bell')}</button>
            <button class="notification-btn" id="fullscreenToggleBtn" type="button" aria-label="Activer le plein écran" title="Plein écran">${lucideIcon('expand')}</button>
          </div>
        </header>
        <main class="content" id="contentArea"></main>
      </div>
    </div>
  `;

  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    document.getElementById('smartShell')?.classList.add('sidebar-open');
  });
  document.getElementById('mobileBackdrop')?.addEventListener('click', closeSidebar);
  document.getElementById('topbarNotificationsBtn')?.addEventListener('click', () => navigateToModule('notifications'));
  document.getElementById('fullscreenToggleBtn')?.addEventListener('click', toggleFullscreenMode);
  document.addEventListener('fullscreenchange', () => updateFullscreenButton());
  bindSidebarEvents(context);
  scheduleLucideIcons();
}

function navigateToModule(route) {
  if (!ALL_MODULES.some((item) => item.id === route)) return;
  window.location.hash = `#/${route}`;
}

function bindSidebarEvents(context) {
  document.querySelectorAll('[data-nav-link]').forEach((link) => {
    link.addEventListener('click', closeSidebar);
  });
  const logoutButton = document.getElementById('sidebarLogoutBtn');
  logoutButton?.addEventListener('click', () => logoutSmartManagement(context));
}

async function logoutSmartManagement(context = {}) {
  const button = document.getElementById('sidebarLogoutBtn');
  if (button) button.disabled = true;
  try {
    if (typeof context.authManager?.logout === 'function') {
      await context.authManager.logout();
    } else {
      await signOut(auth);
    }
  } catch (error) {
    console.warn('[SMART_MANAGEMENT] logout fallback', error);
    await signOut(auth).catch(() => null);
  } finally {
    if (window.location.hash) {
      window.location.hash = '';
    }
    start();
  }
}

async function toggleFullscreenMode() {
  const btn = document.getElementById('fullscreenToggleBtn');
  const target = document.documentElement;
  try {
    if (!document.fullscreenElement) {
      await target.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  } catch (error) {
    showInlineToast(error?.message || 'Le mode plein écran est indisponible sur ce navigateur.', 'error');
  } finally {
    updateFullscreenButton(btn);
  }
}

function updateFullscreenButton(btn = document.getElementById('fullscreenToggleBtn')) {
  if (!btn) return;
  const isFullscreen = Boolean(document.fullscreenElement);
  btn.setAttribute('aria-label', isFullscreen ? 'Quitter le plein écran' : 'Activer le plein écran');
  btn.setAttribute('title', isFullscreen ? 'Quitter le plein écran' : 'Plein écran');
  btn.innerHTML = lucideIcon(isFullscreen ? 'minimize' : 'expand');
  scheduleLucideIcons();
}

function closeSidebar() {
  document.getElementById('smartShell')?.classList.remove('sidebar-open');
}

function getInitials(user, profile) {
  const label = profile?.name || user?.displayName || user?.email || 'SC';
  return String(label)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'SC';
}

function renderSidebar(activeRoute, context = {}) {
  const sidebarName = context.profile?.name || context.user?.displayName || context.user?.email || 'Marlon Maurrasse';
  const permissions = getSmartManagementPermissions(context);
  const sidebarRole = permissions.roleLabel || context.role || context.profile?.role || 'Utilisateur';
  const visibleGroups = getVisibleModuleGroups(context);
  return `
    <div class="sidebar-brand">
      <div class="brand-mark sidebar-logo">
        <img src="../logo.png" alt="Smart Cut Services">
        <span>SC</span>
      </div>
      <div>
        <strong>Smart Cut Services</strong>
        <span>Système de Gestion</span>
      </div>
    </div>
    ${visibleGroups.map((group) => `
      <nav class="nav-group" aria-label="${escapeHtml(group.title)}">
        <p class="nav-group-title">${escapeHtml(group.title)}</p>
        ${group.items.map((item) => `
          <a class="nav-link ${activeRoute === item.id ? 'is-active' : ''}" data-nav-link href="#/${item.id}">
            <span class="nav-icon">${lucideIcon(item.icon)}</span>
            <span>${escapeHtml(item.title)}</span>
          </a>
        `).join('')}
      </nav>
    `).join('')}
    <div class="sidebar-user">
      <div class="user-avatar profile-avatar" aria-hidden="true">${lucideIcon('circle-user-round')}</div>
      <div class="user-meta">
        <strong>${escapeHtml(sidebarName)}</strong>
        <span>${escapeHtml(sidebarRole)}</span>
      </div>
      <button class="sidebar-user-toggle" id="sidebarLogoutBtn" type="button" title="Déconnexion">${lucideIcon('log-out')}</button>
    </div>
  `;
}

function setPageTitle(title, subtitle = 'Smart Management') {
  const titleEl = document.getElementById('pageTitle');
  if (!titleEl) return;
  titleEl.innerHTML = `<small>${escapeHtml(subtitle)}</small><h1>${escapeHtml(title)}</h1>`;
}

function renderLoading() {
  document.getElementById('contentArea').innerHTML = `
    <div class="loading-state">Chargement des données réelles disponibles...</div>
  `;
}

function renderError(error, retry) {
  document.getElementById('contentArea').innerHTML = `
    <div class="error-state">
      <strong>Impossible de charger ce module.</strong><br>
      ${escapeHtml(error?.message || 'Une erreur inconnue est survenue.')}
      <div style="margin-top:1rem;"><button class="retry-btn" id="retryBtn" type="button">Réessayer</button></div>
    </div>
  `;
  document.getElementById('retryBtn')?.addEventListener('click', retry);
}

function renderDashboard(data, context = {}) {
  const stats = data.stats;
  const profileName = String(
    context.profile?.lastName ||
    context.profile?.name ||
    context.user?.displayName ||
    context.user?.email ||
    'Maurrasse'
  ).split(/\s+/).filter(Boolean).slice(-1)[0] || 'Maurrasse';
  document.getElementById('contentArea').innerHTML = `
    <section class="sm-dashboard">
      <div class="dashboard-head">
        <div>
          <h2>Bonjour ${escapeHtml(profileName)} !</h2>
          <p>Voici un aperçu de la performance de votre activité aujourd'hui.</p>
        </div>
        <label class="dashboard-filter" aria-label="Période du tableau de bord">
          ${lucideIcon('calendar-days')}
          <select id="dashboardPeriodFilter">
            <option value="today" ${dashboardState.period === 'today' ? 'selected' : ''}>Aujourd'hui</option>
            <option value="week" ${dashboardState.period === 'week' ? 'selected' : ''}>7 derniers jours</option>
            <option value="month" ${dashboardState.period === 'month' ? 'selected' : ''}>Ce mois-ci</option>
            <option value="all" ${dashboardState.period === 'all' ? 'selected' : ''}>Toutes les dates</option>
          </select>
        </label>
      </div>

      <div class="dashboard-layout">
        <div class="dashboard-main">
          <div class="metric-row">
            ${statCard('Ventes totales', formatMoney((stats.salesToday || 0) + (stats.posSalesToday || 0)), "Aujourd'hui", 'purple', 'shopping-bag', data.salesEvolution)}
            ${statCard('Commandes', stats.webOrdersToday || data.recentOrders.length, 'Commandes web du jour', 'green', 'clipboard-list', data.salesEvolution)}
            ${statCard('Clients', stats.clients, 'Clients enregistrés', 'orange', 'users', data.salesEvolution)}
            ${statCard('Panier moyen', formatMoney((stats.salesToday || 0) / Math.max(1, stats.webOrdersToday || 1)), 'Site web aujourd’hui', 'blue', 'shopping-basket', data.salesEvolution)}
            ${statCard('Marge estimée', formatMoney(stats.estimatedGrossProfit || 0), 'À connecter aux coûts réels', 'pink', 'badge-dollar-sign', data.salesEvolution)}
          </div>

          <div class="analytics-row">
            ${dashboardPanel('Évolution des ventes', renderSalesLineChart(data.salesEvolution), `<span class="soft-select is-static">7 derniers jours ${lucideIcon('activity')}</span>`)}
            ${dashboardPanel('Répartition des ventes par catégorie', renderCategoryDonut(data.categoryBreakdown))}
          </div>

          <div class="bottom-row">
            ${dashboardPanel('Ventes par magasin', renderStoreSales(data.storeSales), '<a class="panel-link" href="#/magasins-depots">Voir tous les magasins</a>')}
            ${dashboardPanel('Commandes récentes', renderRecentOrders(data.recentOrders), '<a class="panel-link" href="#/commandes-web">Voir tout</a>')}
            ${dashboardPanel('Activités récentes', renderActivities(data.activities), '<a class="panel-link" href="#/journal-activite">Voir tout</a>')}
          </div>
        </div>

        <aside class="dashboard-side">
          ${renderDailySummary(data.dailySummary)}
          ${dashboardPanel('Top produits', renderTopProductsCompact(data.topProducts), `
            <label class="soft-select select-wrap" aria-label="Période des top produits">
              <select id="topProductsPeriodFilter">
                <option value="week" ${dashboardState.topProductsPeriod === 'week' ? 'selected' : ''}>Cette semaine</option>
                <option value="month" ${dashboardState.topProductsPeriod === 'month' ? 'selected' : ''}>Ce mois-ci</option>
                <option value="all" ${dashboardState.topProductsPeriod === 'all' ? 'selected' : ''}>Toutes les ventes</option>
              </select>
            </label>
          `)}
        </aside>
      </div>

      <footer class="dashboard-footer">
        <span>© ${new Date().getFullYear()} Smart Cut Services. Tous droits réservés.</span>
        <span>Version 1.0.0</span>
      </footer>
    </section>
  `;
  scheduleLucideIcons();
  attachDashboardFilters(context);
}

function attachDashboardFilters(context = {}) {
  document.getElementById('dashboardPeriodFilter')?.addEventListener('change', async (event) => {
    dashboardState.period = event.target.value || 'today';
    await refreshDashboard(context);
  });
  document.getElementById('topProductsPeriodFilter')?.addEventListener('change', async (event) => {
    dashboardState.topProductsPeriod = event.target.value || 'week';
    await refreshDashboard(context);
  });
}

async function refreshDashboard(context = {}) {
  const content = document.getElementById('contentArea');
  if (content) {
    content.classList.add('is-refreshing');
  }
  const data = await loadDashboardData();
  renderDashboard(data, context);
}

function statCard(label, value, note, tone, icon, sparkData = []) {
  return `
    <article class="stat-card">
      <div class="stat-top">
        <div class="stat-icon ${tone}">${lucideIcon(icon)}</div>
        <div>
          <div class="stat-label">${escapeHtml(label)}</div>
          <div class="stat-value">${escapeHtml(value)}</div>
          <div class="stat-note">${lucideIcon('trending-up')} ${escapeHtml(note)}</div>
        </div>
      </div>
      ${renderSparkline(sparkData, tone)}
    </article>
  `;
}

function dashboardPanel(title, body, action = '') {
  return `
    <section class="panel">
      <div class="panel-header">
        <h2 class="panel-title">${escapeHtml(title)}</h2>
        ${action}
      </div>
      <div class="panel-body">${body}</div>
    </section>
  `;
}

function renderSparkline(data = [], tone = 'purple') {
  if (!Array.isArray(data) || !data.length) return '';
  const values = data.map((entry) => toNumber(entry.amount || entry.orders)).slice(-7);
  const source = values;
  const max = Math.max(...source, 1);
  const points = source.map((value, index) => {
    const x = (index / Math.max(1, source.length - 1)) * 100;
    const y = 38 - ((value / max) * 30);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `
    <svg class="sparkline ${escapeHtml(tone)}" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${points}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
    </svg>
  `;
}

function renderSalesLineChart(data = []) {
  const total = data.reduce((sum, entry) => sum + toNumber(entry.amount), 0);
  if (!Array.isArray(data) || !data.length || total <= 0) {
    return `
      <div class="chart-empty-state">
        ${lucideIcon('line-chart')}
        <strong>Aucune vente confirmée sur cette période.</strong>
        <span>Le graphique se remplira automatiquement dès qu'une commande payée ou une vente en magasin sera enregistrée.</span>
      </div>
    `;
  }
  const values = data.map((entry) => toNumber(entry.amount));
  const max = Math.max(...values, 1);
  const points = data.map((entry, index) => {
    const x = 8 + (index / Math.max(1, data.length - 1)) * 84;
    const y = 86 - ((toNumber(entry.amount) / max) * 68);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  const areaPoints = `8,92 ${points} 92,92`;
  const last = data[data.length - 1] || { amount: 0, label: '-' };
  return `
    <div class="line-chart">
      <div class="chart-tooltip">
        <small>${escapeHtml(last.label)}</small>
        <strong>${escapeHtml(formatMoney(last.amount))}</strong>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id="salesFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="#6d5dfc" stop-opacity=".28"></stop>
            <stop offset="100%" stop-color="#6d5dfc" stop-opacity="0"></stop>
          </linearGradient>
        </defs>
        <polygon points="${areaPoints}" fill="url(#salesFill)"></polygon>
        <polyline points="${points}" fill="none" stroke="#6d5dfc" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></polyline>
        ${data.map((entry, index) => {
          const x = 8 + (index / Math.max(1, data.length - 1)) * 84;
          const y = 86 - ((toNumber(entry.amount) / max) * 68);
          return `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="1.8" fill="#6d5dfc"></circle>`;
        }).join('')}
      </svg>
      <div class="chart-axis">${data.map((entry) => `<span>${escapeHtml(entry.label)}</span>`).join('')}</div>
    </div>
  `;
}

function renderCategoryDonut(categories = []) {
  const colors = ['#2f80ed', '#ffad18', '#36c56f', '#ff4f7b', '#6d5dfc'];
  const total = categories.reduce((sum, entry) => sum + toNumber(entry.amount), 0);
  if (!categories.length || total <= 0) {
    return `
      <div class="chart-empty-state">
        ${lucideIcon('chart-pie')}
        <strong>Aucune vente catégorisée sur cette période.</strong>
        <span>La répartition apparaîtra dès que les ventes auront des produits associés à une catégorie.</span>
      </div>
    `;
  }
  let cursor = 0;
  const gradient = categories.map((entry, index) => {
    const start = cursor;
    cursor += (toNumber(entry.amount) / total) * 360;
    return `${colors[index % colors.length]} ${start.toFixed(1)}deg ${cursor.toFixed(1)}deg`;
  }).join(', ');
  return `
    <div class="category-donut-wrap">
      <div class="category-donut" style="background: conic-gradient(${gradient});">
        <div><strong>${escapeHtml(formatMoney(total))}</strong><span>Total</span></div>
      </div>
      <div class="category-list">
        ${categories.map((entry, index) => `
          <div class="category-row">
            <span class="dot" style="background:${colors[index % colors.length]}"></span>
            <span>${escapeHtml(entry.name)}</span>
            <strong>${entry.percent}%</strong>
            <em>${escapeHtml(formatMoney(entry.amount))}</em>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderDailySummary(summary = {}) {
  return `
    <section class="daily-summary" aria-label="Résumé du jour">
      <div class="daily-summary-head">
        <span class="daily-summary-icon">${lucideIcon('calendar-check')}</span>
        <div>
          <p>Résumé du jour</p>
          <small>${escapeHtml(summary.label || 'Aujourd’hui')}</small>
        </div>
      </div>
      <div class="daily-summary-total">
        <span>Ventes totales</span>
        <strong>${escapeHtml(formatMoney(summary.sales || 0))}</strong>
      </div>
      <div class="daily-row"><span>${lucideIcon('globe')} Site web</span><strong>${escapeHtml(formatMoney(summary.webSales || 0))}</strong></div>
      <div class="daily-row"><span>${lucideIcon('store')} Vente en magasin</span><strong>${escapeHtml(formatMoney(summary.posSales || 0))}</strong></div>
      <div class="daily-row"><span>${lucideIcon('clipboard-list')} Commandes</span><strong>${escapeHtml(summary.orders || 0)}</strong></div>
      <div class="daily-row"><span>${lucideIcon('user-plus')} Nouveaux clients</span><strong>${escapeHtml(summary.newClients || 0)}</strong></div>
      <div class="daily-row"><span>${lucideIcon('rotate-ccw')} Retours</span><strong>${escapeHtml(summary.returns || 0)}</strong></div>
      <a class="summary-link" href="#/rapports">Voir le rapport complet ${lucideIcon('arrow-right')}</a>
    </section>
  `;
}

function renderTopProductsCompact(products = []) {
  if (!products.length) {
    return `
      <div class="chart-empty-state compact">
        ${lucideIcon('package-search')}
        <strong>Aucun produit vendu ${escapeHtml(getTopProductsPeriodLabel().toLowerCase())}.</strong>
        <span>Le classement se mettra à jour automatiquement après les ventes confirmées.</span>
      </div>
    `;
  }
  return `<div class="top-products-compact">${products.slice(0, 5).map((product, index) => `
    <div class="top-product-compact">
      <span class="product-rank">${escapeHtml(index + 1)}</span>
      <span class="top-product-name">${escapeHtml(product.name || 'Produit')}</span>
      <span class="top-product-meta">${escapeHtml(product.quantity || 0)} vente(s)</span>
      <strong>${escapeHtml(formatMoney(product.amount || 0))}</strong>
    </div>
  `).join('')}<a class="panel-link full-link" href="#/produits">Voir tous les produits</a></div>`;
}

function renderStoreSales(stores = []) {
  if (!stores.length) return '<div class="empty-state">Aucune vente par magasin pour le moment.</div>';
  const max = Math.max(...stores.map((store) => toNumber(store.sales)), 1);
  return `
    <div class="store-sales">
      <div class="store-row store-head"><span>Magasin</span><span>Ventes</span><span>Commandes</span><span>Bénéfices</span></div>
      ${stores.map((store) => `
        <div class="store-row">
          <strong>${escapeHtml(store.name)}</strong>
          <span><em style="width:${Math.max(8, (toNumber(store.sales) / max) * 100)}%"></em>${escapeHtml(formatMoney(store.sales))}</span>
          <span>${escapeHtml(store.orders)}</span>
          <span>${escapeHtml(formatMoney(store.profit))}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderRecentOrders(orders = []) {
  if (!orders.length) return '<div class="empty-state">Aucune commande récente.</div>';
  return `<div class="recent-orders">${orders.slice(0, 5).map((order, index) => `
    <div class="recent-order">
      <strong>${escapeHtml(order.uniqueCode || `CMD-${String(index + 1).padStart(4, '0')}`)}</strong>
      <span>${escapeHtml(getOrderClientName(order))}<small>${escapeHtml(formatDate(order.createdAt || order.paidAt))}</small></span>
      ${statusBadge(order.status || order.paymentStatus || 'En attente')}
      <em>${escapeHtml(formatMoney(getOrderAmount(order)))}</em>
    </div>
  `).join('')}</div>`;
}

function renderActivities(activities = []) {
  if (!activities.length) return '<div class="empty-state">Aucune activité récente.</div>';
  return `<div class="activity-list">${activities.map((activity) => `
    <div class="activity-row">
      <span class="activity-icon ${escapeHtml(activity.tone || 'blue')}">${lucideIcon(activity.icon || 'circle')}</span>
      <span>${escapeHtml(activity.label)}<small>${escapeHtml(activity.time)}</small></span>
      <strong>${escapeHtml(activity.value || '')}</strong>
    </div>
  `).join('')}</div>`;
}

function renderComparison(stats) {
  const site = toNumber(stats.salesToday);
  const pos = toNumber(stats.posSalesToday);
  const max = Math.max(site, pos, 1);
  return `
    <div class="comparison-row">
      <div class="comparison-item">
        <strong>Ventes du site</strong>
        <div class="comparison-line site"><span style="width:${Math.max(4, (site / max) * 100)}%"></span></div>
        <small>${formatMoney(site)}</small>
      </div>
      <div class="comparison-item">
        <strong>Ventes magasin</strong>
        <div class="comparison-line"><span style="width:${Math.max(4, (pos / max) * 100)}%"></span></div>
        <small>${formatMoney(pos)} · ventes physiques enregistrées</small>
      </div>
    </div>
  `;
}

function renderAlerts(alerts) {
  if (!alerts.length) {
    return '<div class="empty-state">Aucune alerte importante pour le moment.</div>';
  }
  return `<div class="alert-list">${alerts.map((alert) => `
    <div class="alert-item">
      <span class="badge ${alert.type === 'danger' ? 'danger' : alert.type === 'warning' ? 'warning' : 'info'}">${escapeHtml(alert.type)}</span>
      <div style="margin-top:.45rem;">${escapeHtml(alert.text)}</div>
    </div>
  `).join('')}</div>`;
}

function renderQuickActions() {
  const actions = [
    ['Nouvelle vente en magasin', 'pos'],
    ['Ajouter un produit', 'produits'],
    ['Recevoir du stock', 'mouvements-stock'],
    ['Transférer du stock', 'transferts'],
    ['Ajouter un client', 'clients'],
    ['Voir les commandes', 'commandes-web'],
    ['Ouvrir une session de caisse', 'sessions-caisse'],
    ['Consulter les rapports', 'rapports'],
  ];
  return `<div class="quick-grid">${actions.map(([label, route]) => `
    <a class="quick-card" href="#/${route}">
      <strong>${escapeHtml(label)}</strong>
      <span>→</span>
    </a>
  `).join('')}</div>`;
}

function renderOrdersTable(orders) {
  if (!orders.length) {
    return '<div class="empty-state">Aucune donnée disponible pour le moment.</div>';
  }
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Date</th><th>Client</th><th>Montant</th><th>Statut</th></tr></thead>
        <tbody>
          ${orders.map((order) => `
            <tr>
              <td>${escapeHtml(formatDate(order.createdAt || order.paidAt))}</td>
              <td>${escapeHtml(order.customer?.name || order.clientName || order.name || order.email || 'Client')}</td>
              <td>${escapeHtml(formatMoney(getOrderAmount(order)))}</td>
              <td>${statusBadge(order.status || order.paymentStatus || 'en attente')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderLowStock(products) {
  if (!products.length) return '<div class="empty-state">Aucun produit en stock faible.</div>';
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Produit</th><th>Stock</th><th>Source</th></tr></thead>
        <tbody>
          ${products.map((product) => `
            <tr>
              <td>${escapeHtml(product.productName || product.name || product.title || 'Produit')}<br><small>${escapeHtml(product.variantLabel || product.locationName || '')}</small></td>
              <td>${escapeHtml(product.availableQty ?? toNumber(product.stock))}</td>
              <td>${escapeHtml(product.locationName ? 'Inventaire central' : (product.vendorId ? 'Vendeur' : 'Smart Cut'))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderTopProducts(products) {
  if (!products.length) return '<div class="empty-state">Aucune vente confirmée suffisante pour établir un classement.</div>';
  return `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>Produit</th><th>Quantité</th><th>Montant</th></tr></thead>
        <tbody>
          ${products.map((product) => `
            <tr>
              <td>${escapeHtml(product.name)}</td>
              <td>${escapeHtml(product.quantity)}</td>
              <td>${escapeHtml(formatMoney(product.amount))}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderStockMovements(movements) {
  if (!movements.length) {
    return '<div class="empty-state">Aucun mouvement de stock n’est disponible. Cette zone sera reliée au futur module inventaire.</div>';
  }
  return renderMovementList(movements);
}

async function renderLocationsModule(context, options = {}) {
  const permissions = getSmartManagementPermissions(context);
  const content = document.getElementById('contentArea');

  if (!permissions.canReadLocations) {
    content.innerHTML = `
      <div class="error-state">
        <strong>Accès refusé.</strong><br>
        Votre rôle permet d’ouvrir Smart Management, mais pas de gérer les magasins et dépôts.
      </div>
    `;
    return;
  }

  if (options.reload !== false) {
    locationModuleState.loading = true;
    locationModuleState.error = null;
    content.innerHTML = '<div class="loading-state">Chargement des magasins et dépôts...</div>';
    try {
      locationModuleState.locations = await loadLocations();
    } catch (error) {
      locationModuleState.error = error;
      locationModuleState.loading = false;
      content.innerHTML = `
        <div class="error-state">
          <strong>Impossible de charger les emplacements.</strong><br>
          ${escapeHtml(error?.message || 'Erreur Firebase inconnue.')}
          <div style="margin-top:1rem;"><button class="retry-btn" id="retryLocationsBtn" type="button">Réessayer</button></div>
        </div>
      `;
      document.getElementById('retryLocationsBtn')?.addEventListener('click', () => renderLocationsModule(context));
      return;
    }
    locationModuleState.loading = false;
  }

  const locations = getFilteredLocations();
  const summary = getLocationSummary(locationModuleState.locations);
  content.innerHTML = `
    <section class="locations-page">
      <div class="module-hero">
        <div>
          <p class="eyebrow">Gestion des emplacements</p>
          <h2>Magasins et dépôts</h2>
          <p>Créez et organisez les lieux physiques qui serviront au futur inventaire multi-emplacements, aux transferts, aux ventes en magasin et aux mouvements de stock.</p>
        </div>
        <div class="module-actions">
          ${permissions.canManageLocations ? `
            <button class="primary-btn" id="addStoreBtn" type="button">Ajouter un magasin</button>
            <button class="secondary-btn" id="addWarehouseBtn" type="button">Ajouter un dépôt</button>
          ` : '<span class="badge info">Lecture seule</span>'}
        </div>
      </div>

      <div class="stat-grid location-summary-grid">
        ${statCard('Total magasins', summary.totalStores, 'Magasins enregistrés.', 'tone-blue', 'M')}
        ${statCard('Magasins actifs', summary.activeStores, 'Magasins disponibles pour futures opérations.', 'tone-green', '✓')}
        ${statCard('Total dépôts', summary.totalWarehouses, 'Dépôts enregistrés.', 'tone-blue', 'D')}
        ${statCard('Dépôts actifs', summary.activeWarehouses, 'Dépôts disponibles pour futures opérations.', 'tone-green', '✓')}
        ${statCard('Dépôt central', summary.centralWarehouse || 'Aucun', 'Un seul dépôt central actif est autorisé par défaut.', summary.centralWarehouse ? 'tone-green' : 'tone-gray', '●')}
      </div>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Liste des emplacements</h2>
            <p class="panel-subtitle">Recherchez, filtrez, consultez et maintenez les magasins/dépôts sans supprimer leur historique.</p>
          </div>
        </div>
        <div class="panel-body">
          <div class="locations-toolbar">
            <input id="locationSearchInput" type="search" value="${escapeHtml(locationModuleState.search)}" placeholder="Rechercher nom, code, ville, téléphone, responsable..." aria-label="Rechercher un emplacement">
            <div class="filter-pills">
              ${LOCATION_FILTERS.map((filter) => `
                <button type="button" class="filter-pill ${locationModuleState.filter === filter ? 'is-active' : ''}" data-location-filter="${filter}">
                  ${escapeHtml(getFilterLabel(filter))}
                </button>
              `).join('')}
            </div>
          </div>
          ${locations.length ? renderLocationList(locations, permissions) : '<div class="empty-state">Aucun emplacement ne correspond à ces critères.</div>'}
        </div>
      </section>
    </section>
  `;

  document.getElementById('addStoreBtn')?.addEventListener('click', () => openLocationForm('store', context));
  document.getElementById('addWarehouseBtn')?.addEventListener('click', () => openLocationForm('warehouse', context));
  document.getElementById('locationSearchInput')?.addEventListener('input', (event) => {
    locationModuleState.search = event.target.value;
    renderLocationsModule(context, { reload: false });
  });
  document.querySelectorAll('[data-location-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      locationModuleState.filter = button.dataset.locationFilter || 'all';
      renderLocationsModule(context, { reload: false });
    });
  });
  document.querySelectorAll('[data-location-action]').forEach((button) => {
    button.addEventListener('click', () => handleLocationAction(button, context));
  });
}

function getFilterLabel(filter) {
  return {
    all: 'Tous',
    store: 'Magasins',
    warehouse: 'Dépôts',
    active: 'Actifs',
    inactive: 'Inactifs',
  }[filter] || filter;
}

function getLocationSummary(locations) {
  const stores = locations.filter((location) => location.kind === 'store');
  const warehouses = locations.filter((location) => location.kind === 'warehouse');
  const central = warehouses.find((location) => location.warehouseType === 'central' && location.status === 'active');
  return {
    totalStores: stores.length,
    activeStores: stores.filter((location) => location.status === 'active').length,
    totalWarehouses: warehouses.length,
    activeWarehouses: warehouses.filter((location) => location.status === 'active').length,
    centralWarehouse: central?.name || '',
  };
}

function getFilteredLocations() {
  const search = String(locationModuleState.search || '').trim().toLowerCase();
  return locationModuleState.locations.filter((location) => {
    if (locationModuleState.filter === 'store' && location.kind !== 'store') return false;
    if (locationModuleState.filter === 'warehouse' && location.kind !== 'warehouse') return false;
    if (locationModuleState.filter === 'active' && location.status !== 'active') return false;
    if (locationModuleState.filter === 'inactive' && location.status !== 'inactive') return false;
    if (search && !location.searchText.includes(search)) return false;
    return true;
  });
}

function renderLocationList(locations, permissions) {
  return `
    <div class="location-list">
      ${locations.map((location) => `
        <article class="location-row">
          <div>
            <div class="location-title-line">
              <strong>${escapeHtml(location.name)}</strong>
              ${statusBadge(location.status)}
            </div>
            <div class="location-meta">
              <span>${escapeHtml(location.code)}</span>
              <span>${escapeHtml(locationKindLabel(location))}</span>
              ${location.parentStoreName ? `<span>Magasin parent: ${escapeHtml(location.parentStoreName)}</span>` : ''}
            </div>
          </div>
          <div class="location-detail-cell">
            <span>${escapeHtml(location.city || '-')}</span>
            <small>${escapeHtml(location.address || '-')}</small>
          </div>
          <div class="location-detail-cell">
            <span>${escapeHtml(location.manager || '-')}</span>
            <small>${escapeHtml(location.phone || location.email || '-')}</small>
          </div>
          <div class="location-detail-cell">
            <span>${escapeHtml(formatDate(location.createdAt))}</span>
            <small>Création</small>
          </div>
          <div class="row-actions">
            <button class="secondary-btn small-btn" type="button" data-location-action="view" data-id="${escapeHtml(location.id)}">Consulter</button>
            ${permissions.canManageLocations ? `
              <button class="secondary-btn small-btn" type="button" data-location-action="edit" data-id="${escapeHtml(location.id)}">Modifier</button>
              <button class="secondary-btn small-btn ${location.status === 'active' ? 'danger-outline' : 'success-outline'}" type="button" data-location-action="toggle" data-id="${escapeHtml(location.id)}">
                ${location.status === 'active' ? 'Désactiver' : 'Activer'}
              </button>
            ` : ''}
          </div>
        </article>
      `).join('')}
    </div>
  `;
}

function handleLocationAction(button, context) {
  const location = locationModuleState.locations.find((item) => item.id === button.dataset.id);
  if (!location) return;
  const action = button.dataset.locationAction;
  if (action === 'view') openLocationDetails(location, context);
  if (action === 'edit') openLocationForm(location.kind, context, location);
  if (action === 'toggle') confirmToggleLocation(location, context);
}

function openLocationDetails(location, context) {
  const activeWarehouses = locationModuleState.locations.filter((item) => (
    item.kind === 'warehouse' &&
    item.parentStoreId === location.id &&
    item.status === 'active'
  ));
  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">${escapeHtml(locationKindLabel(location))}</p>
        <h2>${escapeHtml(location.name)}</h2>
      </div>
      <button class="icon-btn" type="button" data-close-modal>×</button>
    </div>
    <div class="detail-grid">
      ${detailItem('Code', location.code)}
      ${detailItem('Statut', locationStatusLabel(location.status))}
      ${detailItem('Ville', location.city)}
      ${detailItem('Adresse', location.address)}
      ${detailItem('Responsable', location.manager)}
      ${detailItem('Téléphone', location.phone || '-')}
      ${detailItem('Email', location.email || '-')}
      ${detailItem('Magasin parent', location.parentStoreName || '-')}
      ${detailItem('Heures d’ouverture', location.openingHours || '-')}
      ${detailItem('Capacité / note', location.capacityNote || '-')}
      ${detailItem('Créé par', location.createdBy || '-')}
      ${detailItem('Créé le', formatDate(location.createdAt))}
      ${detailItem('Dernière modification', formatDate(location.updatedAt))}
      ${detailItem('Coordonnées', location.coordinates || '-')}
    </div>
    ${location.kind === 'store' && activeWarehouses.length ? `
      <div class="notice warning">Ce magasin possède ${activeWarehouses.length} dépôt(s) actif(s) associé(s). Une désactivation du magasin ne désactive pas automatiquement ses dépôts.</div>
    ` : ''}
    <div class="future-grid">
      <div class="empty-state">Stock par emplacement: aucune quantité disponible dans cette étape.</div>
      <div class="empty-state">Utilisateurs assignés: zone réservée pour les prochaines étapes.</div>
      <div class="empty-state">Sessions de caisse: aucune session reliée pour le moment.</div>
    </div>
    <div class="modal-actions">
      ${getSmartManagementPermissions(context).canManageLocations ? `<button class="primary-btn" type="button" data-detail-edit="${escapeHtml(location.id)}">Modifier</button>` : ''}
      <button class="secondary-btn" type="button" data-close-modal>Fermer</button>
    </div>
  `);
  document.querySelector('[data-detail-edit]')?.addEventListener('click', () => {
    closeModal();
    openLocationForm(location.kind, context, location);
  });
}

function detailItem(label, value) {
  return `
    <div class="detail-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || '-')}</strong>
    </div>
  `;
}

function openLocationForm(kind, context, existing = null) {
  const permissions = getSmartManagementPermissions(context);
  if (!permissions.canManageLocations) return;
  const activeStores = locationModuleState.locations.filter((location) => location.kind === 'store' && location.status === 'active' && location.id !== existing?.id);
  const isWarehouse = kind === 'warehouse';
  const title = existing ? `Modifier ${existing.name}` : (isWarehouse ? 'Ajouter un dépôt' : 'Ajouter un magasin');
  const suggestedCode = existing?.code || '';

  openModal(`
    <form id="locationForm" class="location-form" data-kind="${escapeHtml(kind)}">
      <div class="modal-header">
        <div>
          <p class="eyebrow">${escapeHtml(isWarehouse ? 'Dépôt' : 'Magasin')}</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <button class="icon-btn" type="button" data-close-modal>×</button>
      </div>
      <div class="form-grid">
        ${formField('name', isWarehouse ? 'Nom du dépôt *' : 'Nom du magasin *', existing?.name || '', 'text')}
        ${formField('code', 'Code unique *', suggestedCode, 'text')}
        ${isWarehouse ? `
          <label class="field">
            <span>Type de dépôt *</span>
            <select name="warehouseType" id="warehouseTypeSelect" required>
              <option value="">Sélectionner...</option>
              ${WAREHOUSE_TYPES.map((type) => `<option value="${type.value}" ${existing?.warehouseType === type.value ? 'selected' : ''}>${escapeHtml(type.label)}</option>`).join('')}
            </select>
          </label>
          <label class="field" id="parentStoreField">
            <span>Magasin parent</span>
            <select name="parentStoreId">
              <option value="">Aucun magasin parent</option>
              ${activeStores.map((store) => `<option value="${escapeHtml(store.id)}" data-name="${escapeHtml(store.name)}" ${existing?.parentStoreId === store.id ? 'selected' : ''}>${escapeHtml(store.name)} · ${escapeHtml(store.code)}</option>`).join('')}
            </select>
          </label>
        ` : ''}
        ${formField('address', 'Adresse *', existing?.address || '', 'text')}
        ${formField('city', 'Ville *', existing?.city || '', 'text')}
        ${formField('phone', isWarehouse ? 'Téléphone' : 'Téléphone principal *', existing?.phone || '', 'tel')}
        ${formField('email', 'Email', existing?.email || '', 'email')}
        ${formField('manager', 'Responsable *', existing?.manager || '', 'text')}
        <label class="field">
          <span>Statut *</span>
          <select name="status" required>
            <option value="active" ${existing?.status !== 'inactive' ? 'selected' : ''}>Actif</option>
            <option value="inactive" ${existing?.status === 'inactive' ? 'selected' : ''}>Inactif</option>
          </select>
        </label>
        ${formField('openingHours', 'Heures d’ouverture', existing?.openingHours || '', 'text')}
        ${formField('capacityNote', 'Capacité / note capacité', existing?.capacityNote || '', 'text')}
        ${formField('coordinates', 'Coordonnées / localisation', existing?.coordinates || '', 'text')}
        <label class="field field-full">
          <span>Description ou note interne</span>
          <textarea name="internalNote" rows="4">${escapeHtml(existing?.internalNote || '')}</textarea>
        </label>
      </div>
      <div class="form-error" id="locationFormError" hidden></div>
      <div class="modal-actions">
        <button class="primary-btn" id="saveLocationBtn" type="submit">${existing ? 'Enregistrer les modifications' : 'Enregistrer'}</button>
        <button class="secondary-btn" type="button" data-close-modal>Annuler</button>
      </div>
    </form>
  `);

  const form = document.getElementById('locationForm');
  const nameInput = form.elements.name;
  const codeInput = form.elements.code;
  nameInput?.addEventListener('input', () => {
    if (!existing && !codeInput.dataset.touched) {
      codeInput.value = suggestLocationCode(nameInput.value, kind);
    }
  });
  codeInput?.addEventListener('input', () => {
    codeInput.dataset.touched = 'true';
    codeInput.value = normalizeLocationCode(codeInput.value, kind === 'warehouse' ? 'DEP' : 'MAG');
  });
  form.elements.warehouseType?.addEventListener('change', () => updateParentStoreRequirement(form));
  updateParentStoreRequirement(form);
  form.addEventListener('submit', (event) => submitLocationForm(event, context, existing));
}

function formField(name, label, value = '', type = 'text') {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}">
    </label>
  `;
}

function updateParentStoreRequirement(form) {
  const isRequired = form.elements.warehouseType?.value === 'store';
  const parent = form.elements.parentStoreId;
  if (!parent) return;
  parent.required = isRequired;
  parent.closest('.field')?.classList.toggle('is-required', isRequired);
}

async function submitLocationForm(event, context, existing = null) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = document.getElementById('locationFormError');
  const submitBtn = document.getElementById('saveLocationBtn');
  errorBox.hidden = true;
  const payload = collectLocationFormData(form, existing ? 'edit' : 'create', existing);
  const errors = validateLocationPayload(payload, locationModuleState.locations, existing);
  if (errors.length) {
    errorBox.innerHTML = errors.map((error) => `<div>${escapeHtml(error)}</div>`).join('');
    errorBox.hidden = false;
    return;
  }
  submitBtn.disabled = true;
  submitBtn.textContent = 'Enregistrement...';
  try {
    await saveLocation(payload, context, existing);
    closeModal();
    showInlineToast(existing ? 'Emplacement modifié avec succès.' : 'Emplacement créé avec succès.', 'success');
    await renderLocationsModule(context);
  } catch (error) {
    errorBox.innerHTML = escapeHtml(error?.message || 'Impossible d’enregistrer cet emplacement.');
    errorBox.hidden = false;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = existing ? 'Enregistrer les modifications' : 'Enregistrer';
  }
}

function confirmToggleLocation(location, context) {
  const nextStatus = location.status === 'active' ? 'inactive' : 'active';
  const childWarehouses = locationModuleState.locations.filter((item) => item.kind === 'warehouse' && item.parentStoreId === location.id && item.status === 'active');
  const warning = location.kind === 'store' && nextStatus === 'inactive' && childWarehouses.length
    ? `<div class="notice warning">Attention: ce magasin possède ${childWarehouses.length} dépôt(s) actif(s). Ils ne seront pas désactivés automatiquement.</div>`
    : '';
  openModal(`
    <div class="modal-header">
      <div>
        <p class="eyebrow">Confirmation</p>
        <h2>${nextStatus === 'inactive' ? 'Désactiver' : 'Activer'} ${escapeHtml(location.name)}</h2>
      </div>
      <button class="icon-btn" type="button" data-close-modal>×</button>
    </div>
    <p class="modal-copy">
      ${nextStatus === 'inactive'
        ? 'Cet emplacement ne pourra plus être choisi pour de nouvelles opérations, mais son historique sera conservé.'
        : 'Cet emplacement redeviendra disponible pour les nouvelles opérations.'}
    </p>
    ${warning}
    <div class="empty-state">Contrôles futurs prévus: stock présent, session de caisse ouverte, transfert en cours, utilisateurs assignés.</div>
    <div class="modal-actions">
      <button class="primary-btn" id="confirmToggleLocationBtn" type="button">${nextStatus === 'inactive' ? 'Confirmer la désactivation' : 'Confirmer l’activation'}</button>
      <button class="secondary-btn" type="button" data-close-modal>Annuler</button>
    </div>
  `);
  document.getElementById('confirmToggleLocationBtn')?.addEventListener('click', async () => {
    const btn = document.getElementById('confirmToggleLocationBtn');
    btn.disabled = true;
    btn.textContent = 'Traitement...';
    try {
      await toggleLocationStatus(location, nextStatus, context);
      closeModal();
      showInlineToast(`Emplacement ${nextStatus === 'inactive' ? 'désactivé' : 'activé'} avec succès.`, 'success');
      await renderLocationsModule(context);
    } catch (error) {
      btn.disabled = false;
      btn.textContent = 'Réessayer';
      showInlineToast(error?.message || 'Action impossible.', 'error');
    }
  });
}

function openModal(content) {
  closeModal();
  const modal = document.createElement('div');
  modal.className = 'sm-modal-root';
  modal.innerHTML = `
    <div class="sm-modal-backdrop" data-close-modal></div>
    <div class="sm-modal-card" role="dialog" aria-modal="true">${content}</div>
  `;
  document.body.appendChild(modal);
  document.body.style.overflow = 'hidden';
  modal.querySelectorAll('[data-close-modal]').forEach((element) => element.addEventListener('click', closeModal));
  scheduleLucideIcons();
}

function closeModal() {
  document.querySelectorAll('.sm-modal-root').forEach((modal) => modal.remove());
  document.body.style.overflow = '';
}

function showInlineToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `sm-toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.classList.add('is-visible'), 20);
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 220);
  }, 2600);
}

function statusBadge(status) {
  const raw = String(status || '').toLowerCase();
  const type = raw.includes('paid') || raw.includes('confirm') || raw.includes('complete') || raw.includes('livre') ? 'success'
    : raw.includes('cancel') || raw.includes('failed') ? 'danger'
      : raw.includes('pending') || raw.includes('await') || raw.includes('attente') ? 'warning'
        : 'muted';
  return `<span class="badge ${type}">${escapeHtml(status || 'en attente')}</span>`;
}

function renderPlaceholder(route) {
  const module = ALL_MODULES.find((item) => item.id === route) || ALL_MODULES[0];
  document.getElementById('contentArea').innerHTML = `
    <section class="module-placeholder">
      <p class="eyebrow">Module en préparation</p>
      <h1>${escapeHtml(module.title)}</h1>
      <p>${escapeHtml(module.description)} Cette page est volontairement limitée pour l’étape 1 : le lien fonctionne, le layout est prêt, mais la logique métier sera ajoutée dans une prochaine étape.</p>
      <a class="primary-btn" href="#/dashboard" style="display:inline-flex;text-decoration:none;margin-top:1rem;">Revenir au tableau de bord</a>
    </section>
  `;
}

function renderForbiddenModule(route, context = {}) {
  const module = ALL_MODULES.find((item) => item.id === route);
  const defaultRoute = getDefaultRouteForContext(context);
  document.getElementById('contentArea').innerHTML = `
    <section class="module-placeholder">
      <p class="eyebrow">Accès limité</p>
      <h1>${escapeHtml(module?.title || 'Module indisponible')}</h1>
      <p>Votre rôle ${escapeHtml(getSmartManagementPermissions(context).roleLabel)} ne permet pas d’ouvrir ce module. Les accès sont limités pour protéger les ventes, le stock et les informations sensibles.</p>
      <a class="primary-btn" href="#/${escapeHtml(defaultRoute)}" style="display:inline-flex;text-decoration:none;margin-top:1rem;">Ouvrir mon espace autorisé</a>
    </section>
  `;
}

async function renderRoute(context) {
  const defaultRoute = getDefaultRouteForContext(context);
  const route = (location.hash.replace(/^#\/?/, '') || defaultRoute).trim();
  const routeExists = ALL_MODULES.some((item) => item.id === route);
  const safeRoute = routeExists ? route : defaultRoute;
  if (!canAccessModule(safeRoute, context)) {
    const fallbackRoute = defaultRoute;
    context.route = fallbackRoute;
    document.getElementById('sidebar').innerHTML = renderSidebar(fallbackRoute, context);
    bindSidebarEvents(context);
    scheduleLucideIcons();
    setPageTitle('Accès limité');
    renderForbiddenModule(safeRoute, context);
    return;
  }
  context.route = safeRoute;
  document.getElementById('sidebar').innerHTML = renderSidebar(safeRoute, context);
  bindSidebarEvents(context);
  scheduleLucideIcons();
  const activeModule = ALL_MODULES.find((item) => item.id === safeRoute);
  setPageTitle(activeModule?.title || 'Tableau de bord');

  if (safeRoute === 'pos') {
    await renderPosModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'magasins-depots') {
    await renderLocationsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'produits') {
    await renderProductsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'inventaire') {
    await renderInventoryModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'mouvements-stock') {
    await renderMovementsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'transferts') {
    await renderTransfersModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'sessions-caisse') {
    await renderSessionsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'inventaires-physiques') {
    await renderPhysicalInventoryModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'commandes-web') {
    await renderOnlineOrdersModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'clients') {
    await renderClientsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'fidelite') {
    await renderLoyaltyModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'prix-promotions') {
    await renderPromotionsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'retours-remboursements') {
    await renderReturnsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'paiements') {
    await renderPaymentsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'recus') {
    await renderReceiptsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'rapports') {
    await renderReportsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'utilisateurs-roles') {
    await renderUsersRolesModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'notifications') {
    await renderNotificationsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'journal-activite') {
    await renderActivityLogModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute === 'parametres') {
    await renderSettingsModule(context);
    scheduleLucideIcons();
    return;
  }

  if (safeRoute !== 'dashboard') {
    renderPlaceholder(safeRoute);
    scheduleLucideIcons();
    return;
  }

  renderLoading();
  try {
    const data = await loadDashboardData();
    renderDashboard(data, context);
  } catch (error) {
    console.error('[SMART_MANAGEMENT] dashboard error', error);
    renderError(error, () => renderRoute(context));
  }
}

async function waitForAuthManager(authManager) {
  await authReadyPromise.catch(() => null);
  if (authManager.isAuthReady) return authManager.getCurrentUser();
  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe = () => {};
    const done = (user) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(user);
    };
    unsubscribe = authManager.addAuthChangeListener(done);
    window.setTimeout(() => done(authManager.getCurrentUser()), 4200);
  });
}

async function start() {
  const authManager = getAuthManager();
  let user = await waitForAuthManager(authManager);
  user = user || auth?.currentUser || null;

  if (!user || user.isAnonymous) {
    renderAccessCard({
      title: 'Connexion requise',
      message: 'Smart Management est réservé aux comptes autorisés. Connectez-vous avec un compte administrateur ou un rôle habilité.',
      action: '<button class="primary-btn" id="loginBtn" type="button">Se connecter</button>',
    });
    document.getElementById('loginBtn')?.addEventListener('click', () => authManager.openAuthModal('login'));
    let unsubscribeLoginWatcher = () => {};
    unsubscribeLoginWatcher = authManager.addAuthChangeListener((nextUser) => {
      if (nextUser && !nextUser.isAnonymous) {
        unsubscribeLoginWatcher();
        start();
      }
    });
    return;
  }

  let access = null;
  try {
    access = await resolveAccess(user);
  } catch (error) {
    renderAccessCard({
      title: 'Vérification impossible',
      message: error?.message || 'Impossible de vérifier votre rôle pour le moment.',
      action: '<button class="secondary-btn" onclick="window.location.reload()" type="button">Réessayer</button>',
    });
    return;
  }

  if (!access.allowed) {
    renderAccessCard({
      title: 'Accès refusé',
      message: 'Votre compte est connecté, mais il ne possède pas encore un rôle autorisé pour Smart Management.',
      action: '<a class="secondary-btn" href="../index.html" style="display:inline-flex;text-decoration:none;">Retour au site</a>',
    });
    return;
  }

  const context = {
    version: APP_VERSION,
    authManager,
    user,
    profile: access.profile,
    role: access.role,
    route: 'dashboard',
  };
  renderShell(context);
  await renderRoute(context);
  window.addEventListener('hashchange', () => renderRoute(context));
}

start().catch((error) => {
  console.error('[SMART_MANAGEMENT] boot failed', error);
  renderAccessCard({
    title: 'Erreur de démarrage',
    message: error?.message || 'Smart Management n’a pas pu démarrer correctement.',
    action: '<button class="secondary-btn" onclick="window.location.reload()" type="button">Réessayer</button>',
  });
});
