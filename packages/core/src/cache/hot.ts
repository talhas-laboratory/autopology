import type { CacheEntry } from '../types.js';

export class HotCache {
  private readonly store = new Map<string, CacheEntry>();

  get<T>(key: string, freshnessStamp: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    const now = Date.now();
    if (entry.freshnessStamp !== freshnessStamp || now > entry.storedAt + entry.ttlMs) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, freshnessStamp: string, value: T, ttlMs: number, nodeIds: string[] = []): void {
    this.store.set(key, {
      key,
      value,
      freshnessStamp,
      storedAt: Date.now(),
      ttlMs,
      nodeIds,
    });
  }

  invalidateByNodes(nodeIds: string[]): void {
    if (!nodeIds.length) return;
    const touched = new Set(nodeIds);
    for (const [key, entry] of this.store.entries()) {
      const entryNodes = entry.nodeIds || [];
      if (entryNodes.some((id) => touched.has(id))) {
        this.store.delete(key);
      }
    }
  }

  invalidateByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }
}
