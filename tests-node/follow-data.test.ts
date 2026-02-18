import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('follow_data tool', () => {
  it('returns progressive output with confidence and trace steps', async () => {
    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z' }),
      followData: async () => [
        { step: 1, object_type: 'Order', field: 'total', location: 'Cart.calc', transform: 'WRITE', line: 12, confidence: 0.82, partial_trace: false },
        { step: 2, object_type: 'Order', field: 'total', location: 'Tax.apply', transform: 'TRANSFORM', line: 20, confidence: 0.7, partial_trace: true },
        { step: 3, object_type: 'Order', field: 'total', location: 'Payment.charge', transform: 'READ', line: 30, confidence: 0.88, partial_trace: false },
      ],
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-follow-'));
    dirs.push(tmp);

    const cache = new CacheManager(tmp, new WarmMock(), {
      hotTtlMs: 10_000,
      warmTtlMs: 10_000,
      coldTtlMs: 10_000,
    });

    const cfg: AutopologyConfig = {
      neo4j: { uri: 'bolt://x', user: 'u', password: 'p', database: 'neo4j' },
      index: { maxFileBytes: 1000, followSymlinks: false },
      cache: { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 },
      runtime: { enableExecutionHooks: false },
    };

    const tools = new ToolService(repo, cfg, tmp, cache);
    const out = await tools.followData('Order', 'total', false);

    expect(out.result.summary).toBeDefined();
    expect(out.metadata.level_provided).toBeGreaterThanOrEqual(1);
    expect(out.metadata.confidence).toBeGreaterThan(0);
    expect(out.result.relationships?.items).toBeDefined();
    expect(JSON.stringify(out.result.summary.key_findings)).toContain('Partial trace segments detected.');
    expect(out.metadata.estimated_tokens).toBeLessThanOrEqual(4000);
  });

  it('passes instance/persistence options through and reports persistence findings', async () => {
    const followData = vi.fn(async () => [
      {
        step: 1,
        object_type: 'Order',
        field: 'id',
        location: 'OrderRepo.save',
        node_id: 'sym:typescript:src/repo.ts:Function:save:10',
        transform: 'WRITE',
        line: 10,
        confidence: 0.81,
        partial_trace: false,
        persistence: true,
        persistence_targets: ['db.save'],
        instance_match: true,
      },
    ]);

    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z' }),
      followData,
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-follow-opts-'));
    dirs.push(tmp);

    const cache = new CacheManager(tmp, new WarmMock(), {
      hotTtlMs: 10_000,
      warmTtlMs: 10_000,
      coldTtlMs: 10_000,
    });
    const cfg: AutopologyConfig = {
      neo4j: { uri: 'bolt://x', user: 'u', password: 'p', database: 'neo4j' },
      index: { maxFileBytes: 1000, followSymlinks: false },
      cache: { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 },
      runtime: { enableExecutionHooks: false },
    };

    const tools = new ToolService(repo, cfg, tmp, cache);
    const out = await tools.followData('Order', 'id', false, 'order-123', true);

    expect(followData).toHaveBeenCalledWith('Order', 'id', {
      instanceId: 'order-123',
      trackPersistence: true,
    });
    const findings = JSON.stringify(out.result.summary.key_findings);
    expect(findings).toContain('Persistence steps');
    expect(findings).toContain('Instance filter matches');
  });

  it('reports direct vs inferred trace mix and down-calibrates mostly inferred traces', async () => {
    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z' }),
      followData: async () => [
        {
          step: 1,
          object_type: 'Order',
          field: 'status',
          location: 'OrderService.applyStatus',
          transform: 'WRITE',
          line: 14,
          confidence: 0.74,
          partial_trace: false,
          trace_kind: 'direct',
          flow_depth: 0,
        },
        {
          step: 2,
          object_type: 'Order',
          field: 'status',
          location: 'Checkout.handle',
          transform: 'WRITE',
          confidence: 0.58,
          partial_trace: true,
          trace_kind: 'interprocedural',
          flow_depth: 1,
          via_node: 'OrderService.applyStatus',
        },
        {
          step: 3,
          object_type: 'Order',
          field: 'status',
          location: 'Checkout.retry',
          transform: 'TRANSFORM',
          confidence: 0.55,
          partial_trace: true,
          trace_kind: 'interprocedural',
          flow_depth: 2,
          via_node: 'OrderService.applyStatus',
        },
      ],
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-follow-calib-'));
    dirs.push(tmp);
    const cache = new CacheManager(tmp, new WarmMock(), {
      hotTtlMs: 10_000,
      warmTtlMs: 10_000,
      coldTtlMs: 10_000,
    });
    const cfg: AutopologyConfig = {
      neo4j: { uri: 'bolt://x', user: 'u', password: 'p', database: 'neo4j' },
      index: { maxFileBytes: 1000, followSymlinks: false },
      cache: { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 },
      runtime: { enableExecutionHooks: false },
    };

    const tools = new ToolService(repo, cfg, tmp, cache);
    const out = await tools.followData('Order', 'status', false);
    const findings = JSON.stringify(out.result.summary.key_findings);
    expect(findings).toContain('Direct steps');
    expect(findings).toContain('inferred steps');
    expect(findings).toContain('Flow coverage');
    expect(out.metadata.confidence).toBeLessThan(0.75);
  });
});
