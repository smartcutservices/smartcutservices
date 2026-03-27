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

function normalizeProduct(docSnap, source) {
  return {
    id: docSnap.id,
    sourceCollection: source,
    ...docSnap.data()
  };
}

export function isPublicProductVisible(product) {
  if (typeof product?.status === 'string') return product.status === 'active';
  if (typeof product?.active === 'boolean') return product.active !== false;
  return true;
}

export async function loadPublicProducts({ maxPerCollection = 500 } = {}) {
  const snapshots = await Promise.all(
    PUBLIC_COLLECTIONS.map((name) => getDocs(query(collection(db, name), limit(maxPerCollection))))
  );

  return snapshots
    .flatMap((snapshot, index) => snapshot.docs.map((item) => normalizeProduct(item, PUBLIC_COLLECTIONS[index])))
    .filter(isPublicProductVisible);
}

export async function findPublicProductById(productId) {
  for (const collectionName of PUBLIC_COLLECTIONS) {
    const snap = await getDoc(doc(db, collectionName, productId));
    if (snap.exists()) {
      const product = normalizeProduct(snap, collectionName);
      if (isPublicProductVisible(product)) {
        return product;
      }
    }
  }
  return null;
}

export function subscribePublicProducts(callback, { maxPerCollection = 500 } = {}) {
  const state = new Map();
  let readyCount = 0;

  const emit = () => {
    const merged = Array.from(state.values())
      .flat()
      .filter(isPublicProductVisible);
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
