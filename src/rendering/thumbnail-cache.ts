// fork: IndexedDB cache of finished thumbnails (small WebP/JPEG blobs, ≤ 68×88 px), keyed by
// vault path and valid for one (mtime, size). A changed scan gets a new thumbnail; the oldest
// entries go when the cap is exceeded (LRU: a read older than a day refreshes the stamp).

const DB_NAME = "tiramisioux-3d-graph-thumbs";
const STORE = "thumbs";
const DAY = 86_400_000;

export interface CachedThumb {
  path: string;
  mtime: number;
  size: number;
  w: number;
  h: number;
  blob: Blob;
  /** width / height of the scan itself (the stored image is fitted into a cell) */
  aspect: number;
  /** last time written or read-refreshed (ms) */
  used: number;
}

export class ThumbnailCache {
  private db: Promise<IDBDatabase | null>;
  private pending: CachedThumb[] = [];
  private flushTimer: number | null = null;

  constructor(private readonly maxEntries = 20000) {
    this.db = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: "path" });
          store.createIndex("used", "used");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  /** the cached thumbnail when it is for this very (mtime, size), else null */
  async get(path: string, mtime: number, size: number): Promise<CachedThumb | null> {
    const db = await this.db;
    if (!db) return null;
    const rec = await new Promise<CachedThumb | null>((resolve) => {
      try {
        const req = db.transaction(STORE, "readonly").objectStore(STORE).get(path);
        req.onsuccess = () => resolve((req.result as CachedThumb) ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (!rec || rec.mtime !== mtime || rec.size !== size) return null;
    if (Date.now() - rec.used > DAY) this.put({ ...rec, used: Date.now() });
    return rec;
  }

  /** several at once in one transaction (one round trip instead of one per thumbnail) */
  async getMany(keys: { path: string; mtime: number; size: number }[]): Promise<(CachedThumb | null)[]> {
    const db = await this.db;
    if (!db || !keys.length) return keys.map(() => null);
    return new Promise((resolve) => {
      const out: (CachedThumb | null)[] = keys.map(() => null);
      let left = keys.length;
      const fin = () => { if (--left === 0) resolve(out); };
      try {
        const store = db.transaction(STORE, "readonly").objectStore(STORE);
        keys.forEach((k, i) => {
          const req = store.get(k.path);
          req.onsuccess = () => {
            const rec = req.result as CachedThumb | undefined;
            if (rec && rec.mtime === k.mtime && rec.size === k.size) {
              out[i] = rec;
              if (Date.now() - rec.used > DAY) this.put({ ...rec, used: Date.now() }); // LRU stamp
            }
            fin();
          };
          req.onerror = fin;
        });
      } catch {
        resolve(out);
      }
    });
  }

  /** queue a write; writes are batched into one transaction */
  put(rec: CachedThumb) {
    this.pending.push(rec);
    if (this.flushTimer === null) this.flushTimer = window.setTimeout(() => void this.flush(), 400);
  }

  private async flush() {
    this.flushTimer = null;
    const batch = this.pending.splice(0);
    const db = await this.db;
    if (!db || !batch.length) return;
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const r of batch) store.put(r);
    } catch {
      /* quota or closed database: the cache is optional */
    }
  }

  /** drop the oldest entries beyond the cap (call when idle) */
  async prune() {
    await this.flush();
    const db = await this.db;
    if (!db) return;
    try {
      const store = db.transaction(STORE, "readwrite").objectStore(STORE);
      const count = await new Promise<number>((resolve) => {
        const r = store.count();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(0);
      });
      let excess = count - Math.floor(this.maxEntries * 0.9);
      if (count <= this.maxEntries || excess <= 0) return;
      const cur = store.index("used").openKeyCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || excess <= 0) return;
        store.delete(c.primaryKey);
        excess--;
        c.continue();
      };
    } catch {
      /* ignore */
    }
  }

  async dispose() {
    await this.flush();
    const db = await this.db;
    db?.close();
  }
}
