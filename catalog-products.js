import { db } from './firebase-init.js';
import {
  collection,
  getDoc,
  getDocs,
  doc,
  limit,
  onSnapshot,
  query
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';

const PUBLIC_COLLECTIONS = ['products', 'vendorProducts'];
const BASIC_VENDOR_PUBLIC_PRODUCT_LIMIT = 5;

function normalizeProduct(docSnap, source) {
  return {
    id: docSnap.id,
    sourceCollection: source,
    ...docSnap.data()
  };
}

export function isPublicProductVisible(product) {
  if (product?.sourceCollection === 'vendorProducts' && String(product?.vendorServiceFeeStatus || '').toLowerCase() === 'suspended') {
    return false;
  }
  if (typeof product?.status === 'string') return product.status === 'active';
  if (typeof product?.active === 'boolean') return product.active !== false;
  return true;
}

function getVendorId(product = {}) {
  return String(product.vendorId || product.uid || product.sellerUid || product.ownerUid || '').trim();
}

function isVendorProductPro(product = {}) {
  const planId = String(product.planId || '').toLowerCase();
  const planLabel = String(product.planLabel || '').toLowerCase();
  const feeStatus = String(product.vendorServiceFeeStatus || '').toLowerCase();
  return (planId === 'pro' || planLabel.includes('pro')) && feeStatus !== 'suspended';
}

function getProductSortTime(product = {}) {
  const parsed = new Date(product.updatedAt || product.createdAt || product.submittedAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function applyVendorPublicVisibility(products = []) {
  const baseVisible = products
    .filter((product) => product && typeof product === 'object')
    .filter(isPublicProductVisible);
  const vendorGroups = new Map();

  baseVisible.forEach((product) => {
    if (product?.sourceCollection !== 'vendorProducts') return;
    const vendorId = getVendorId(product);
    if (!vendorId) return;
    if (!vendorGroups.has(vendorId)) vendorGroups.set(vendorId, []);
    vendorGroups.get(vendorId).push(product);
  });

  const allowedVendorProductIds = new Set();
  vendorGroups.forEach((items) => {
    const proActive = items.some(isVendorProductPro);
    const sorted = [...items].sort((a, b) => getProductSortTime(b) - getProductSortTime(a));
    const allowed = proActive ? sorted : sorted.slice(0, BASIC_VENDOR_PUBLIC_PRODUCT_LIMIT);
    allowed.forEach((item) => allowedVendorProductIds.add(item.id));
  });

  return baseVisible.filter((product) => (
    product?.sourceCollection !== 'vendorProducts' || allowedVendorProductIds.has(product.id)
  ));
}

export async function loadPublicProducts({ maxPerCollection = 500 } = {}) {
  const snapshots = await Promise.all(
    PUBLIC_COLLECTIONS.map((name) => getDocs(query(collection(db, name), limit(maxPerCollection))))
  );

  const products = snapshots
    .flatMap((snapshot, index) => snapshot.docs.map((item) => normalizeProduct(item, PUBLIC_COLLECTIONS[index])))
    .filter(isPublicProductVisible);
  return applyVendorPublicVisibility(products);
}

export async function findPublicProductById(productId) {
  const products = await loadPublicProducts({ maxPerCollection: 500 });
  return products.find((product) => String(product.id) === String(productId)) || null;
}

export function subscribePublicProducts(callback, { maxPerCollection = 500 } = {}) {
  const state = new Map();
  let readyCount = 0;

  const emit = () => {
    const merged = applyVendorPublicVisibility(Array.from(state.values()).flat());
    callback(merged);
  };

  const unsubs = PUBLIC_COLLECTIONS.map((collectionName) =>
    onSnapshot(
      query(collection(db, collectionName), limit(maxPerCollection)),
      (snapshot) => {
        state.set(
          collectionName,
          snapshot.docs.map((item) => normalizeProduct(item, collectionName))
        );
        if (readyCount < PUBLIC_COLLECTIONS.length && !state.has(`ready:${collectionName}`)) {
          state.set(`ready:${collectionName}`, true);
          readyCount += 1;
        }
        if (readyCount === PUBLIC_COLLECTIONS.length) {
          emit();
        }
      },
      (error) => {
        console.error(`Erreur temps reel ${collectionName}:`, error);
      }
    )
  );

  return () => {
    unsubs.forEach((unsubscribe) => {
      if (typeof unsubscribe === 'function') unsubscribe();
    });
  };
}
