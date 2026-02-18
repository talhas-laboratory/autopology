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

function config(): AutopologyConfig {
  return {
    neo4j: { uri: '', user: '', password: '', database: '' },
    index: { maxFileBytes: 1000, followSymlinks: false },
    cache: { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 },
    runtime: { enableExecutionHooks: false },
  };
}

describe('error taxonomy', () => {
  it('maps parse failures to PARSE_ERROR', async () => {
    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z' }),
      findTarget: async () => {
        const e = new Error('parse failed while reading AST') as Error & { code?: string };
        e.code = 'PARSE_ERROR';
        throw e;
      },
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-error-taxonomy-'));
    dirs.push(tmp);
    const svc = new ToolService(
      repo,
      config(),
      tmp,
      new CacheManager(tmp, new WarmMock(), { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 }),
    );
    const out = await svc.findTarget('run');
    expect(out.error?.code).toBe('PARSE_ERROR');
    expect(out.error?.recoverable).toBe(true);
  });

  it('maps timeout failures to QUERY_TIMEOUT', async () => {
    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z' }),
      traceImpact: async () => {
        throw new Error('neo4j query timed out');
      },
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-error-taxonomy-'));
    dirs.push(tmp);
    const svc = new ToolService(
      repo,
      config(),
      tmp,
      new CacheManager(tmp, new WarmMock(), { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 }),
    );
    const out = await svc.traceImpact('sym:typescript:src/a.ts:Function:run:1');
    expect(out.error?.code).toBe('QUERY_TIMEOUT');
    expect(out.error?.recoverable).toBe(true);
  });

  it('returns STALE_DATA when runtime lookback has no usable data', async () => {
    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z', runtimeUpdatedAt: '2026-02-18T00:00:00Z' }),
      executionReality: async () => ({
        function_name: 'fn',
        lookback: '1hour',
        called_by: [],
        calls_to: [],
        hotspots: [],
        avg_duration_ms: 0,
        error_rate: 0,
        hot_path: false,
        recent_failures: [],
        samples: 0,
        completeness: 'failed',
      }),
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-error-taxonomy-'));
    dirs.push(tmp);
    const svc = new ToolService(
      repo,
      config(),
      tmp,
      new CacheManager(tmp, new WarmMock(), { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 }),
    );
    const out = await svc.executionReality('fn', '1hour');
    expect(out.error?.code).toBe('STALE_DATA');
    expect(out.error?.recoverable).toBe(true);
  });
});
