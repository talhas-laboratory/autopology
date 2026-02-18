import { HotCache } from './hot.js';
import { ColdCache } from './cold.js';
import type { WarmCacheProvider } from '../types.js';

export interface CacheManagerConfig {
  hotTtlMs: number;
  warmTtlMs: number;
  coldTtlMs: number;
}

export class CacheManager {
  readonly hot: HotCache;
  readonly cold: ColdCache;

  constructor(
    repoRoot: string,
    readonly warm: WarmCacheProvider,
    readonly cfg: CacheManagerConfig,
  ) {
    this.hot = new HotCache();
    this.cold = new ColdCache(repoRoot);
  }

  async get<T>(key: string, freshnessStamp: string): Promise<{ value: T | null; source: 'hot' | 'warm' | 'cold' | 'miss' }> {
    const hot = this.hot.get<T>(key, freshnessStamp);
    if (hot !== null) return { value: hot, source: 'hot' };

    const warm = await this.warm.get<T>(key, freshnessStamp);
    if (warm !== null) {
      this.hot.set(key, freshnessStamp, warm, this.cfg.hotTtlMs, extractNodeIds(warm));
      return { value: warm, source: 'warm' };
    }

    const cold = this.cold.get<T>(key, freshnessStamp);
    if (cold !== null) {
      this.hot.set(key, freshnessStamp, cold, this.cfg.hotTtlMs, extractNodeIds(cold));
      return { value: cold, source: 'cold' };
    }

    return { value: null, source: 'miss' };
  }

  async set<T>(key: string, freshnessStamp: string, value: T, nodeIds: string[] = []): Promise<void> {
    this.hot.set(key, freshnessStamp, value, this.cfg.hotTtlMs, nodeIds);
    await this.warm.set(key, freshnessStamp, value, this.cfg.warmTtlMs, nodeIds);
    this.cold.set(key, freshnessStamp, value, this.cfg.coldTtlMs, nodeIds);
  }

  async invalidateByNodes(nodeIds: string[]): Promise<void> {
    this.hot.invalidateByNodes(nodeIds);
    this.cold.invalidateByNodes(nodeIds);
    await this.warm.invalidateByNodes(nodeIds);
  }
}

function extractNodeIds(value: unknown): string[] {
  const found = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const item of v) visit(item);
      return;
    }
    if (!v || typeof v !== 'object') return;
    const obj = v as Record<string, unknown>;
    for (const [k, next] of Object.entries(obj)) {
      if ((k === 'id' || k === 'node_id' || k === 'source' || k === 'target') && typeof next === 'string' && next.includes(':')) {
        found.add(next);
      }
      visit(next);
    }
  };
  visit(value);
  return [...found];
}
