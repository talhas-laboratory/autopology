import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CacheManager, type AutopologyConfig, type WarmCacheProvider } from '../packages/core/src/index.ts';
import { ToolService } from '../packages/mcp-server/src/service.ts';
import { scoreRetrievalCandidate, sortScoredCandidates } from '../packages/storage-neo4j/src/retrieval.ts';

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

describe('mcp effectiveness regression gate', () => {
  it('maintains ranking quality for exact-path and test-intent retrieval', () => {
    const candidates = [
      {
        id: 'file:packages/core/src/security.ts',
        labels: ['File'],
        name: 'security.ts',
        qualname: '',
        path: 'packages/core/src/security.ts',
        summary: 'repo sandboxing, path traversal guardrails',
        priorityScore: 0.64,
        degree: 4,
      },
      {
        id: 'sym:typescript:packages/core/src/security.ts:Function:safeResolveUnderRepo:21',
        labels: ['Function'],
        name: 'safeResolveUnderRepo',
        qualname: 'safeResolveUnderRepo',
        path: 'packages/core/src/security.ts',
        summary: 'resolve paths safely under repo root',
        priorityScore: 0.9,
        degree: 18,
      },
      {
        id: 'sym:typescript:tests-node/security.test.ts:TestCase:rejectsTraversal:7',
        labels: ['TestCase'],
        name: 'rejectsTraversal',
        qualname: 'security traversal tests',
        path: 'tests-node/security.test.ts',
        summary: 'prevents traversal and symlink escapes',
        priorityScore: 0.3,
        degree: 1,
      },
      {
        id: 'sym:typescript:packages/cli/src/mcp-config.ts:Function:renderMcpConfig:9',
        labels: ['Function'],
        name: 'renderMcpConfig',
        qualname: 'renderMcpConfig',
        path: 'packages/cli/src/mcp-config.ts',
        summary: 'renders mcp config snippets',
        priorityScore: 0.8,
        degree: 9,
      },
    ];

    const pathRanked = sortScoredCandidates(
      candidates.map((candidate) => scoreRetrievalCandidate('packages/core/src/security.ts', candidate)),
    );
    expect(pathRanked[0].id).toBe('file:packages/core/src/security.ts');

    const testRanked = sortScoredCandidates(
      candidates.map((candidate) => scoreRetrievalCandidate('tests for path traversal guard', candidate)),
    );
    const top3 = new Set(testRanked.slice(0, 3).map((item) => item.id));
    expect(top3.has('sym:typescript:tests-node/security.test.ts:TestCase:rejectsTraversal:7')).toBe(true);
  });

  it('reuses response cache while preserving freshness checks for repeated target lookups', async () => {
    let freshnessCalls = 0;
    const repo = {
      ctx: {} as never,
      getMeta: async () => ({ schemaVersion: 1, graphVersion: '1' }),
      getFreshness: async () => {
        freshnessCalls += 1;
        return { graphVersion: '1', indexedAt: '2026-02-18T00:00:00Z' };
      },
      findTarget: async () => [
        {
          id: 'sym:typescript:packages/core/src/security.ts:Function:safeResolveUnderRepo:21',
          name: 'safeResolveUnderRepo',
          location: 'packages/core/src/security.ts',
          confidence: 0.9,
        },
      ],
    } as any;

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-effectiveness-'));
    dirs.push(tmp);
    const cache = new CacheManager(tmp, new WarmMock(), { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 });
    const cfg: AutopologyConfig = {
      neo4j: { uri: '', user: '', password: '', database: '' },
      index: { maxFileBytes: 1000, followSymlinks: false },
      cache: { hotTtlMs: 10_000, warmTtlMs: 10_000, coldTtlMs: 10_000 },
      runtime: { enableExecutionHooks: false },
    };
    const svc = new ToolService(repo, cfg, tmp, cache);

    await svc.findTarget('safeResolveUnderRepo');
    await svc.findTarget('safeResolveUnderRepo');
    expect(freshnessCalls).toBe(2);
  });
});
