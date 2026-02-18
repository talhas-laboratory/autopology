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

describe('progressive output contract', () => {
  it('returns summary + metadata for all tools', async () => {
    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z' }),
      findTarget: async () => [{ id: 'sym:ts:a', name: 'a', location: 'src/a.ts', confidence: 0.8 }],
      getModuleBoundary: async () => ({ public_api: ['a'], dependencies: ['b'], dependents: ['c'] }),
      traceImpact: async () => ({ target: 'a', upstream: [], downstream: [] }),
      followData: async () => [],
      assessChangeRisk: async () => ({ risk_level: 'low', risk_score: 10, factors: {}, safe_to_proceed: true }),
      resolveConcept: async () => ({ concept: 'auth', implementations: [], data_flow: [] }),
      getTestsForFunction: async () => ({ unit_tests: [], suggested_tests_to_run: [] }),
      getContextForTask: async () => ({ resources: [], tools_to_call: [] }),
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-schema-'));
    dirs.push(tmp);
    const cache = new CacheManager(tmp, new WarmMock(), { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 });
    const cfg: AutopologyConfig = {
      neo4j: { uri: '', user: '', password: '', database: '' },
      index: { maxFileBytes: 1000, followSymlinks: false },
      cache: { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 },
      runtime: { enableExecutionHooks: false },
    };

    const svc = new ToolService(repo, cfg, tmp, cache);

    const outs = await Promise.all([
      svc.findTarget('a'),
      svc.getModuleBoundary('mod'),
      svc.traceImpact('sym:a'),
      svc.followData('Order'),
      svc.assessChangeRisk('x', 'y'),
      svc.resolveConcept('auth'),
      svc.getTestsForFunction('f'),
      svc.getContextForTask('task'),
    ]);

    for (const out of outs) {
      expect(out.result.summary).toBeDefined();
      expect(out.metadata.confidence).toBeGreaterThanOrEqual(0);
      expect(out.metadata.estimated_tokens).toBeGreaterThan(0);
      expect(out.metadata.level_provided).toBeGreaterThanOrEqual(1);
    }
  });
});
