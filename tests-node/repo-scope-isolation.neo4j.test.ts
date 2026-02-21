import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveRepoScope, loadConfig, writeDefaultConfig } from '../packages/core/src/index.ts';
import { indexRepo } from '../packages/indexer/src/index.ts';
import { ToolService } from '../packages/mcp-server/src/service.ts';
import {
  closeNeo4j,
  createNeo4jContext,
  GraphRepository,
  initSchema,
  Neo4jWarmCache,
  verifyConnection,
} from '../packages/storage-neo4j/src/index.ts';
import { RuntimeHookService } from '../packages/runtime-hooks/src/index.ts';

const withNeo4j = process.env.NEO4J_URI ? describe : describe.skip;

const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0, tempDirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

function mkRepo(root: string, files: Record<string, string>): void {
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
  }
  writeDefaultConfig(root);
}

withNeo4j('repo scoped graph isolation (neo4j)', () => {
  it('keeps two repos isolated in one Neo4j database and preserves incremental correctness', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-scope-iso-'));
    tempDirs.push(tmp);
    const repoAPath = path.join(tmp, 'repo-a');
    const repoBPath = path.join(tmp, 'repo-b');

    mkRepo(repoAPath, {
      'src/app.ts': [
        'export function run(order: any) {',
        '  order.total = 1;',
        '  return order.total;',
        '}',
        'export function sink(order: any) { return order.total; }',
        '',
      ].join('\n'),
      'src/only-a.ts': 'export function alphaOnly() { return "A"; }\n',
    });
    mkRepo(repoBPath, {
      'src/app.ts': [
        'export function run(order: any) {',
        '  order.total = 2;',
        '  return order.total;',
        '}',
        'export function sink(order: any) { return order.total; }',
        '',
      ].join('\n'),
      'src/only-b.ts': 'export function betaOnly() { return "B"; }\n',
    });

    const cfgA = loadConfig(repoAPath);
    const cfgB = loadConfig(repoBPath);
    const scopeA = deriveRepoScope(repoAPath);
    const scopeB = deriveRepoScope(repoBPath);
    expect(scopeA.repoKey).not.toBe(scopeB.repoKey);

    const ctx = createNeo4jContext(cfgA.neo4j);
    try {
      await verifyConnection(ctx);
      await initSchema(ctx, scopeA);
      await initSchema(ctx, scopeB);

      const repoA = new GraphRepository(ctx, scopeA);
      const repoB = new GraphRepository(ctx, scopeB);
      await repoA.clearGraph();
      await repoB.clearGraph();

      await indexRepo(repoA, repoAPath, 'full', cfgA);
      await indexRepo(repoB, repoBPath, 'full', cfgB);

      expect(await repoA.findFileExact('src/only-a.ts')).toBeTruthy();
      expect(await repoA.findFileExact('src/only-b.ts')).toBeNull();
      expect(await repoB.findFileExact('src/only-b.ts')).toBeTruthy();
      expect(await repoB.findFileExact('src/only-a.ts')).toBeNull();

      const snapshotA = await repoA.getFileSnapshot();
      const snapshotB = await repoB.getFileSnapshot();
      expect(Object.keys(snapshotA)).toContain('src/only-a.ts');
      expect(Object.keys(snapshotA)).not.toContain('src/only-b.ts');
      expect(Object.keys(snapshotB)).toContain('src/only-b.ts');
      expect(Object.keys(snapshotB)).not.toContain('src/only-a.ts');

      fs.rmSync(path.join(repoAPath, 'src', 'only-a.ts'));
      await indexRepo(repoA, repoAPath, 'incremental', cfgA);

      expect(await repoA.findFileExact('src/only-a.ts')).toBeNull();
      expect(await repoB.findFileExact('src/only-b.ts')).toBeTruthy();
    } finally {
      await closeNeo4j(ctx);
    }
  }, 30_000);

  it('partitions warm cache by repo scope key for identical keys/node ids', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-scope-cache-'));
    tempDirs.push(tmp);
    const repoAPath = path.join(tmp, 'repo-a');
    const repoBPath = path.join(tmp, 'repo-b');
    mkRepo(repoAPath, { 'src/a.ts': 'export const a = 1;\n' });
    mkRepo(repoBPath, { 'src/b.ts': 'export const b = 2;\n' });

    const cfg = loadConfig(repoAPath);
    const scopeA = deriveRepoScope(repoAPath);
    const scopeB = deriveRepoScope(repoBPath);
    const ctx = createNeo4jContext(cfg.neo4j);
    try {
      await verifyConnection(ctx);
      await initSchema(ctx, scopeA);
      await initSchema(ctx, scopeB);

      const warmA = new Neo4jWarmCache(ctx, scopeA.repoKey);
      const warmB = new Neo4jWarmCache(ctx, scopeB.repoKey);

      await warmA.set('find_target:abc', 'fresh', { value: 'A' }, 60_000, ['file:src/app.ts']);
      await warmB.set('find_target:abc', 'fresh', { value: 'B' }, 60_000, ['file:src/app.ts']);

      expect(await warmA.get<{ value: string }>('find_target:abc', 'fresh')).toEqual({ value: 'A' });
      expect(await warmB.get<{ value: string }>('find_target:abc', 'fresh')).toEqual({ value: 'B' });

      await warmA.invalidateByNodes(['file:src/app.ts']);
      expect(await warmA.get<{ value: string }>('find_target:abc', 'fresh')).toBeNull();
      expect(await warmB.get<{ value: string }>('find_target:abc', 'fresh')).toEqual({ value: 'B' });
    } finally {
      await closeNeo4j(ctx);
    }
  }, 30_000);

  it('isolates runtime windows and observed-call edges even when local node ids are identical', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-scope-runtime-'));
    tempDirs.push(tmp);
    const repoAPath = path.join(tmp, 'repo-a');
    const repoBPath = path.join(tmp, 'repo-b');

    const sharedFile = {
      'src/app.ts': [
        'export function run(order: any) {',
        '  order.total = order.subtotal + order.tax;',
        '  return order.total;',
        '}',
        'export function sink(order: any) { return order.total; }',
        '',
      ].join('\n'),
    };
    mkRepo(repoAPath, sharedFile);
    mkRepo(repoBPath, sharedFile);

    const cfgA = loadConfig(repoAPath);
    const cfgB = loadConfig(repoBPath);
    const scopeA = deriveRepoScope(repoAPath);
    const scopeB = deriveRepoScope(repoBPath);

    const ctx = createNeo4jContext(cfgA.neo4j);
    try {
      await verifyConnection(ctx);
      await initSchema(ctx, scopeA);
      await initSchema(ctx, scopeB);

      const repoA = new GraphRepository(ctx, scopeA);
      const repoB = new GraphRepository(ctx, scopeB);
      await repoA.clearGraph();
      await repoB.clearGraph();
      await indexRepo(repoA, repoAPath, 'full', cfgA);
      await indexRepo(repoB, repoBPath, 'full', cfgB);

      const caller = 'sym:typescript:src/app.ts:Function:run:1';
      const callee = 'sym:typescript:src/app.ts:Function:sink:5';
      const runtimeA = new RuntimeHookService(ctx, scopeA);
      await runtimeA.ingestSpan({
        callerId: caller,
        calleeId: callee,
        durationMs: 240,
        ok: false,
        timestamp: new Date().toISOString(),
      });

      const a = await repoA.executionReality(callee, '1hour');
      const b = await repoB.executionReality(callee, '1hour');
      expect(Number(a.samples || 0)).toBeGreaterThan(0);
      expect(Number(b.samples || 0)).toBe(0);
    } finally {
      await closeNeo4j(ctx);
    }
  }, 30_000);

  it('fails closed for active repo scope when graph is unindexed', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-scope-fail-closed-'));
    tempDirs.push(tmp);
    const repoPath = path.join(tmp, 'repo');
    mkRepo(repoPath, { 'src/app.ts': 'export const x = 1;\n' });

    const cfg = loadConfig(repoPath);
    const scope = deriveRepoScope(repoPath);
    const ctx = createNeo4jContext(cfg.neo4j);
    try {
      await verifyConnection(ctx);
      await initSchema(ctx, scope);

      const repo = new GraphRepository(ctx, scope);
      await repo.clearGraph();
      const svc = new ToolService(repo, cfg, repoPath);
      const out = await svc.findTarget('x');
      expect(out.error?.code).toBe('REPO_SCOPE_UNINDEXED');
      expect(out.error?.recoverable).toBe(true);
      expect(String(out.error?.suggestion || '')).toContain('graph create');
    } finally {
      await closeNeo4j(ctx);
    }
  }, 30_000);
});
