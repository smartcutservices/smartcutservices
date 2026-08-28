'use strict';

/**
 * Minimal in-memory fake of the small slice of the Firestore Admin SDK surface used
 * by ledger.js: collection().doc(id), doc.get(), runTransaction(async tx => { tx.get,
 * tx.set }).
 *
 * THIS IS NOT THE FIREBASE EMULATOR. It does not enforce Firestore Rules, does not
 * validate document paths, and its "transaction" is NOT truly atomic against
 * concurrent access (see runTransaction below) — it exists solely so the
 * *application logic* in ledger.js (idempotency checks, balance arithmetic, the
 * insufficient-balance guard) can be exercised by `node --test` without a JVM.
 *
 * Real transactional guarantees, Firestore Rules, and multi-tenant isolation must
 * still be verified against the real Firebase Emulator Suite before production —
 * see SECURITY_MODEL.md §6, which documents that the emulator could not be run in
 * this environment (no Java runtime available) and lists the exact commands to run
 * once it is.
 */

class FakeDocSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
    this.exists = data !== undefined;
  }
  data() {
    return this._data;
  }
}

class FakeDocRef {
  constructor(store, path) {
    this._store = store;
    this.path = path;
    this.id = path.split('/').pop();
  }
  async get() {
    return new FakeDocSnapshot(this.id, this._store.get(this.path));
  }
  async set(data, options = {}) {
    const existing = this._store.get(this.path);
    const merged = options.merge && existing ? { ...existing, ...data } : { ...data };
    this._store.set(this.path, merged);
  }
}

class FakeCollectionRef {
  constructor(store, name) {
    this._store = store;
    this._name = name;
  }
  doc(id) {
    return new FakeDocRef(this._store, `${this._name}/${id}`);
  }
}

/**
 * A "transaction" here is a simple sequential re-entrant lock: only one
 * runTransaction body executes at a time (this module has no real concurrency —
 * Node is single-threaded and no `await` inside the fake yields to another
 * transaction mid-flight in these tests). This is sufficient to test the
 * *sequential* idempotency/guard logic, but does NOT prove safety under real
 * concurrent Firestore transactions. That must be verified against the emulator.
 */
class FakeFirestore {
  constructor() {
    this._store = new Map();
    this._queue = Promise.resolve();
  }
  collection(name) {
    return new FakeCollectionRef(this._store, name);
  }
  async runTransaction(fn) {
    const run = async () => {
      const tx = {
        get: (ref) => ref.get(),
        set: (ref, data, options) => ref.set(data, options),
        update: (ref, data) => ref.set(data, { merge: true })
      };
      return fn(tx);
    };
    const result = this._queue.then(run, run);
    this._queue = result.catch(() => {});
    return result;
  }
  // Test helper, not part of the real SDK surface.
  _dump() {
    return Object.fromEntries(this._store);
  }
}

module.exports = { FakeFirestore };
