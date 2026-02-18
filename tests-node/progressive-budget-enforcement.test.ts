import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CacheManager, type AutopologyConfig, type WarmCacheProvider } from '../packages/core/src/index.ts';
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

describe('progressive budget enforcement', () => {
  it('omits relationships when over budget and reports truncation', async () => {
    const huge = 'x'.repeat(20_000);
    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z', commitHash: 'abc' }),
      getModuleBoundary: async () => ({
        public_api: [huge],
        dependencies: [huge, huge],
        dependents: [huge, huge],
      }),
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-budget-'));
    dirs.push(tmp);
    const cache = new CacheManager(tmp, new WarmMock(), { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 });
    const cfg: AutopologyConfig = {
      neo4j: { uri: '', user: '', password: '', database: '' },
      index: { maxFileBytes: 1000, followSymlinks: false },
      cache: { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 },
      runtime: { enableExecutionHooks: false },
    };

    const svc = new ToolService(repo, cfg, tmp, cache);
    const out = await svc.getModuleBoundary('mod', 1, false);
    expect(out.result.summary).toBeDefined();
    expect(out.result.relationships).toBeUndefined();
    expect(out.metadata.completeness).toBe('truncated');
    expect(out.metadata.truncation_reason).toBe('context_budget');
    expect(out.metadata.estimated_tokens + out.metadata.budget_remaining).toBeLessThanOrEqual(4000);
  });
});
