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

describe('performance smoke', () => {
  it('keeps simple tool latency in a fast baseline', async () => {
    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z' }),
      findTarget: async () => [{ id: 'sym:typescript:src/app.ts:Function:run:1', name: 'run', location: 'src/app.ts' }],
    } as any;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-perf-'));
    dirs.push(tmp);
    const cache = new CacheManager(tmp, new WarmMock(), { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 });
    const cfg: AutopologyConfig = {
      neo4j: { uri: '', user: '', password: '', database: '' },
      index: { maxFileBytes: 1000, followSymlinks: false },
      cache: { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 },
      runtime: { enableExecutionHooks: false },
    };
    const svc = new ToolService(repo, cfg, tmp, cache);

    const t0 = Date.now();
    await svc.findTarget('run');
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(100);
  });
});
