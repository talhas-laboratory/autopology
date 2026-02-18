import type { WarmCacheProvider } from '@autopology/core';
import { openSession } from './driver.js';
import type { Neo4jContext } from './driver.js';

export class Neo4jWarmCache implements WarmCacheProvider {
  constructor(private readonly ctx: Neo4jContext) {}

  async get<T>(key: string, freshnessStamp: string): Promise<T | null> {
    const session = openSession(this.ctx);
    try {
      const res = await session.run(
        `MATCH (w:WarmCache {key: $key, freshness_stamp: $freshnessStamp})
         WHERE w.expires_at > datetime()
         RETURN w.payload AS payload
         LIMIT 1`,
        { key, freshnessStamp },
      );
      if (!res.records.length) return null;
      const payload = res.records[0].get('payload') as string;
      return JSON.parse(payload) as T;
    } finally {
      await session.close();
    }
  }

  async set<T>(key: string, freshnessStamp: string, value: T, ttlMs: number, nodeIds: string[] = []): Promise<void> {
    const session = openSession(this.ctx);
    try {
      await session.run(
        `MERGE (w:WarmCache {key: $key})
         SET w.payload = $payload,
             w.freshness_stamp = $freshnessStamp,
             w.created_at = datetime(),
             w.expires_at = datetime() + duration({milliseconds: toInteger($ttlMs)}),
             w.node_ids = $nodeIds`,
        {
          key,
          payload: JSON.stringify(value),
          freshnessStamp,
          ttlMs,
          nodeIds,
        },
      );
    } finally {
      await session.close();
    }
  }

  async invalidateByNodes(nodeIds: string[]): Promise<void> {
    if (!nodeIds.length) return;
    const session = openSession(this.ctx);
    try {
      await session.run(
        `MATCH (w:WarmCache)
         WHERE any(nid IN $nodeIds WHERE nid IN coalesce(w.node_ids, []))
         DELETE w`,
        { nodeIds },
      );
    } finally {
      await session.close();
    }
  }

  async invalidateAll(): Promise<void> {
    const session = openSession(this.ctx);
    try {
      await session.run('MATCH (w:WarmCache) DELETE w');
    } finally {
      await session.close();
    }
  }
}
