import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CacheManager, type WarmCacheProvider } from '../packages/core/src/index.ts';

class MemoryWarmCache implements WarmCacheProvider {
  store = new Map<string, { freshness: string; value: unknown }>();

  async get<T>(key: string, freshnessStamp: string): Promise<T | null> {
    const row = this.store.get(key);
    if (!row || row.freshness !== freshnessStamp) return null;
    return row.value as T;
  }

  async set<T>(key: string, freshnessStamp: string, value: T, _ttlMs: number, _nodeIds?: string[]): Promise<void> {
    this.store.set(key, { freshness: freshnessStamp, value });
  }

  async invalidateByNodes(): Promise<void> {
    this.store.clear();
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0, dirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('cache tiers', () => {
  it('round-trips hot/warm/cold and honors freshness', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-cache-'));
    dirs.push(tmp);
    const warm = new MemoryWarmCache();
    const cache = new CacheManager(tmp, warm, {
      hotTtlMs: 10_000,
      warmTtlMs: 10_000,
      coldTtlMs: 10_000,
    });

    await cache.set('k', 'v1', { hello: 'world' }, ['sym:typescript:src/app.ts:Function:run:10']);

    const first = await cache.get<{ hello: string }>('k', 'v1');
    expect(first.value?.hello).toBe('world');
    expect(first.source).toBe('hot');

    cache.hot.clear();
    const second = await cache.get<{ hello: string }>('k', 'v1');
    expect(second.value?.hello).toBe('world');
    expect(['warm', 'cold']).toContain(second.source);

    const stale = await cache.get<{ hello: string }>('k', 'v2');
    expect(stale.value).toBeNull();

    await cache.invalidateByNodes(['sym:typescript:src/app.ts:Function:run:10']);
    const evicted = await cache.get<{ hello: string }>('k', 'v1');
    expect(evicted.value).toBeNull();
  });
});
