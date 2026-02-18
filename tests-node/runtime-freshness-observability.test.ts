import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CacheManager, type AutopologyConfig, type WarmCacheProvider } from '../packages/core/src/index.ts';
import { type ToolLogger, type ToolMetrics } from '../packages/mcp-server/src/observability.ts';
import { ToolService } from '../packages/mcp-server/src/service.ts';

class WarmMock implements WarmCacheProvider {
  async get<T>(): Promise<T | null> { return null; }
  async set<T>(): Promise<void> { return; }
  async invalidateByNodes(): Promise<void> { return; }
}

class MemoryLogger implements ToolLogger {
  events: Array<{ level: 'info' | 'warn' | 'error'; event: string; payload: Record<string, unknown> }> = [];
  info(event: string, payload: Record<string, unknown>): void { this.events.push({ level: 'info', event, payload }); }
  warn(event: string, payload: Record<string, unknown>): void { this.events.push({ level: 'warn', event, payload }); }
  error(event: string, payload: Record<string, unknown>): void { this.events.push({ level: 'error', event, payload }); }
}

class MemoryMetrics implements ToolMetrics {
  counters = new Map<string, number>();
  histogram(_name: string, _value: number): void { return; }
  gauge(_name: string, _value: number): void { return; }
  ratio(_name: string, _value: number): void { return; }
  counter(name: string): void {
    this.counters.set(name, (this.counters.get(name) || 0) + 1);
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0, dirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function testConfig(): AutopologyConfig {
  return {
    neo4j: { uri: '', user: '', password: '', database: '' },
    index: { maxFileBytes: 1000, followSymlinks: false },
    cache: { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 },
    runtime: { enableExecutionHooks: false },
  };
}

describe('runtime freshness + observability', () => {
  it('bypasses cache when runtime freshness stamp changes', async () => {
    let runtimeStamp = '2026-02-18T00:00:00Z';
    let findCalls = 0;
    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({
        graphVersion: '1',
        indexedAt: '2026-02-18T00:00:00Z',
        commitHash: 'abc',
        runtimeUpdatedAt: runtimeStamp,
      }),
      findTarget: async () => {
        findCalls += 1;
        return [{ id: `sym:ts:src/a.ts:Function:run:${findCalls}`, name: 'run', location: 'src/a.ts', confidence: 0.8 }];
      },
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-runtime-freshness-'));
    dirs.push(tmp);
    const svc = new ToolService(
      repo,
      testConfig(),
      tmp,
      new CacheManager(tmp, new WarmMock(), { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 }),
    );

    await svc.findTarget('run');
    await svc.findTarget('run');
    expect(findCalls).toBe(1);

    runtimeStamp = '2026-02-18T00:10:00Z';
    await svc.findTarget('run');
    expect(findCalls).toBe(2);
  });

  it('emits required tool execution and truncation logs', async () => {
    const logger = new MemoryLogger();
    const metrics = new MemoryMetrics();
    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z', commitHash: 'abc' }),
      findTarget: async () =>
        Array.from({ length: 200 }, (_, i) => ({
          id: `sym:ts:src/f${i}.ts:Function:run:${i + 1}`,
          name: `run${i}`,
          location: `src/f${i}.ts`,
          confidence: 0.7,
        })),
      getModuleBoundary: async () => null,
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-observability-'));
    dirs.push(tmp);
    const svc = new ToolService(
      repo,
      testConfig(),
      tmp,
      new CacheManager(tmp, new WarmMock(), { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 }),
      { logger, metrics },
    );

    const out = await svc.findTarget('run');
    expect(out.metadata.completeness).toBe('truncated');
    expect(logger.events.some((e) => e.event === 'tool_execution_started')).toBe(true);
    expect(logger.events.some((e) => e.event === 'tool_execution_completed')).toBe(true);
    expect(logger.events.some((e) => e.event === 'context_budget_used')).toBe(true);
    expect(logger.events.some((e) => e.event === 'results_truncated')).toBe(true);
    expect((metrics.counters.get('tool_executions_total') || 0)).toBeGreaterThanOrEqual(1);

    await svc.getModuleBoundary('missing');
    expect(logger.events.some((e) => e.level === 'error' && e.event === 'tool_execution_failed')).toBe(true);
  });
});
