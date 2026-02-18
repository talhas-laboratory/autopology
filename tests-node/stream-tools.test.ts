import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('stream-of-thought tool surface', () => {
  it('serves new first-class tools with progressive metadata', async () => {
    const executionReality = vi.fn(async () => ({
      function_name: 'sym:typescript:src/a.ts:Function:run:1',
      lookback: '1hour',
      called_by: [{ caller: 'OrderController', samples: 10, avg_duration_ms: 45, error_rate: 0 }],
      calls_to: [{ callee: 'PaymentService.charge', samples: 10, avg_duration_ms: 22, error_rate: 0.01 }],
      avg_duration_ms: 45,
      error_rate: 0.01,
      hot_path: true,
      recent_failures: [],
      samples: 10,
      completeness: 'windowed',
    }));

    const repo = {
      ctx: {} as never,
      getFreshness: async () => ({ graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z', commitHash: 'abc123' }),
      understandCodebase: async () => ({
        domain: 'commerce',
        layers: ['api', 'services', 'data'],
        key_concepts: ['order', 'payment'],
        entry_points: ['src/api/orders.ts'],
        tech_stack: ['TypeScript', 'Neo4j'],
      }),
      executionReality,
      safeRefactorPlan: async () => ({
        target: 'PaymentService',
        impacted_files: ['src/payment/service.ts', 'src/payment/types.ts'],
        files_to_modify: 2,
        risk_score: 42,
        risk_level: 'medium',
        safe_to_proceed: true,
      }),
      generateContextForLlm: async () => ({
        target_nodes: [{ id: 'sym:typescript:src/payment.ts:Function:process:1', name: 'processPayment' }],
        prompt_context: 'You are working on processPayment...',
        resources: ['view://dependency/sym:typescript:src/payment.ts:Function:process:1'],
      }),
      queryExecutionTrace: async () => ({
        error_id: 'timeout',
        traces: [{ callee: 'InventoryDB', error_count: 4, samples: 20 }],
        total_errors: 4,
      }),
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-stream-tools-'));
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
      svc.understandCodebase(),
      svc.executionReality('PaymentService.process', '1hour'),
      svc.safeRefactorPlan('PaymentService', 'Rename to BillingService'),
      svc.generateContextForLlm(['PaymentService.process']),
      svc.queryExecutionTrace('timeout', '24hour'),
    ]);

    expect(executionReality).toHaveBeenCalledWith('PaymentService.process', '1hour');
    for (const out of outs) {
      expect(out.result.summary).toBeDefined();
      expect(out.metadata.confidence).toBeGreaterThanOrEqual(0);
      expect(out.metadata.estimated_tokens).toBeGreaterThan(0);
      expect(out.metadata.estimated_tokens + out.metadata.budget_remaining).toBeLessThanOrEqual(4000);
      expect(out.metadata.freshness?.commit_hash).toBe('abc123');
    }
  });
});
