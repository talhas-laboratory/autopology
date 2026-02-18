import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CacheManager, type WarmCacheProvider, type AutopologyConfig } from '../packages/core/src/index.ts';
import { ToolService } from '../packages/mcp-server/src/service.ts';

class WarmMock implements WarmCacheProvider {
  async get<T>(): Promise<T | null> { return null; }
  async set<T>(): Promise<void> { return; }
  async invalidateByNodes(): Promise<void> { return; }
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0, dirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('concurrency smoke', () => {
  it('serves 100 parallel requests with valid progressive metadata', async () => {
    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z', commitHash: 'abc' }),
      findTarget: async (q: string) => [
        { id: `sym:ts:src/${q}.ts:Function:run:1`, name: `${q}Run`, location: `src/${q}.ts`, confidence: 0.8 },
      ],
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-concurrency-'));
    dirs.push(tmp);
    const cache = new CacheManager(tmp, new WarmMock(), { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 });
    const cfg: AutopologyConfig = {
      neo4j: { uri: '', user: '', password: '', database: '' },
      index: { maxFileBytes: 1000, followSymlinks: false },
      cache: { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 },
      runtime: { enableExecutionHooks: false },
    };
    const svc = new ToolService(repo, cfg, tmp, cache);

    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) => svc.findTarget(`q${i}`)),
    );
    expect(results.length).toBe(100);
    for (const out of results) {
      expect(out.result.summary).toBeDefined();
      expect(out.metadata.estimated_tokens).toBeGreaterThan(0);
      expect(out.metadata.estimated_tokens + out.metadata.budget_remaining).toBeLessThanOrEqual(4000);
    }
  });
});
