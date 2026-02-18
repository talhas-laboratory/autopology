import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig, writeDefaultConfig } from '../packages/core/src/index.ts';
import { indexRepo } from '../packages/indexer/src/index.ts';
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

withNeo4j('neo4j integration', () => {
  it('indexes real files and serves follow_data lineage', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-neo4j-'));
    tempDirs.push(tmp);
    const repoRoot = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });

    fs.writeFileSync(
      path.join(repoRoot, 'src', 'app.ts'),
      [
        'export function calculate(order: any) {',
        '  order.total = order.subtotal + order.tax;',
        '  return order.total;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    fs.writeFileSync(
      path.join(repoRoot, 'src', 'calc.py'),
      [
        'def normalize(order):',
        '    order.total = round(order.subtotal + order.tax, 2)',
        '    return order.total',
        '',
      ].join('\n'),
      'utf8',
    );

    writeDefaultConfig(repoRoot);
    const cfg = loadConfig(repoRoot);
    const ctx = createNeo4jContext(cfg.neo4j);

    try {
      await verifyConnection(ctx);
      await initSchema(ctx, repoRoot);
      const graph = new GraphRepository(ctx);
      await graph.clearGraph();

      const result = await indexRepo(graph, repoRoot, 'full', cfg);
      expect(result.changed_files).toBeGreaterThanOrEqual(2);
      expect(result.impacted_node_ids.length).toBeGreaterThan(0);

      const flows = await graph.followData('order', 'total');
      expect(flows.length).toBeGreaterThan(0);
      expect(flows.some((s) => s.transform === 'WRITE')).toBe(true);
      expect(flows.some((s) => s.transform === 'READ')).toBe(true);
    } finally {
      await closeNeo4j(ctx);
    }
  }, 20_000);

  it('materializes required labels/relationships and baseline performance', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-neo4j-reqs-'));
    tempDirs.push(tmp);
    const repoRoot = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    fs.mkdirSync(path.join(repoRoot, 'tests'), { recursive: true });

    fs.writeFileSync(
      path.join(repoRoot, 'src', 'auth.ts'),
      [
        'function normalize(v: string) { return v.trim(); }',
        'export class AuthService {',
        '  validate(user: any) {',
        '    user.status = normalize(user.status);',
        '    return user.status;',
        '  }',
        '}',
        'export function validate(user: any) {',
        '  user.status = normalize(user.status);',
        '  return user.status;',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(
      path.join(repoRoot, 'tests', 'auth.test.ts'),
      [
        'import { validate } from "../src/auth";',
        'function test_validate() {',
        '  const user: any = { status: "new" };',
        '  validate(user);',
        '}',
        '',
      ].join('\n'),
      'utf8',
    );

    writeDefaultConfig(repoRoot);
    const cfg = loadConfig(repoRoot);
    const ctx = createNeo4jContext(cfg.neo4j);

    try {
      await verifyConnection(ctx);
      await initSchema(ctx, repoRoot);
      const graph = new GraphRepository(ctx);
      await graph.clearGraph();

      const t0 = Date.now();
      await indexRepo(graph, repoRoot, 'full', cfg);
      const indexMs = Date.now() - t0;
      expect(indexMs).toBeLessThan(5000);

      const direct = await graph.getTestsForFunction('validate');
      const tests = (direct.unit_tests as unknown[]) || [];
      expect(tests.length).toBeGreaterThan(0);

      const boundary = await graph.getModuleBoundary('src');
      expect(boundary).toBeTruthy();
      const diagnostics = (boundary?.dependency_diagnostics as Record<string, unknown>) || {};
      expect(Array.isArray(diagnostics.circular_dependencies)).toBe(true);
      expect(Array.isArray(diagnostics.orphan_modules)).toBe(true);
      expect(Array.isArray(diagnostics.coupling_hotspots)).toBe(true);

      const changesLens = await graph.getViewResource('changes', 'module:src');
      expect(changesLens.lens).toBe('changes');
      expect(changesLens.risk).toBeDefined();
      expect(changesLens.impact).toBeDefined();

      const session = ctx.driver.session({ database: cfg.neo4j.database });
      const schemaRes = await session.run(
        `MATCH (n:CodeNode)
         WITH collect(DISTINCT labels(n)) AS lbls
         MATCH ()-[r]->()
         WITH lbls, collect(DISTINCT type(r)) AS rels
         RETURN lbls AS labels, rels AS rels`,
      );
      await session.close();
      const labels = schemaRes.records[0].get('labels') as string[][];
      const rels = schemaRes.records[0].get('rels') as string[];
      const flatLabels = new Set(labels.flat());

      for (const required of ['Repo', 'Module', 'File', 'Function', 'Class', 'Concept', 'DataObject', 'Field', 'TestCase']) {
        expect(flatLabels.has(required)).toBe(true);
      }
      for (const requiredRel of ['CONTAINS', 'IMPORTS', 'CALLS', 'DEPENDS_ON', 'READS', 'WRITES', 'TRANSFORMS', 'IMPLEMENTS', 'TESTS']) {
        expect(rels.includes(requiredRel)).toBe(true);
      }
    } finally {
      await closeNeo4j(ctx);
    }
  }, 20_000);

  it('invalidates warm cache by impacted node ids', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-neo4j-cache-'));
    tempDirs.push(tmp);

    writeDefaultConfig(tmp);
    const cfg = loadConfig(tmp);
    const ctx = createNeo4jContext(cfg.neo4j);

    try {
      await verifyConnection(ctx);
      await initSchema(ctx, tmp);
      const warm = new Neo4jWarmCache(ctx);

      const key = 'trace_impact:abc';
      const freshness = '1:demo';
      await warm.set(key, freshness, { hello: 'world' }, 60_000, ['sym:typescript:src/app.ts:Function:calculate']);

      const before = await warm.get<{ hello: string }>(key, freshness);
      expect(before?.hello).toBe('world');

      await warm.invalidateByNodes(['sym:typescript:src/app.ts:Function:calculate']);
      const after = await warm.get<{ hello: string }>(key, freshness);
      expect(after).toBeNull();
    } finally {
      await closeNeo4j(ctx);
    }
  }, 20_000);

  it('runtime ingest enriches risk/context and persists RuntimeSpanAggregate', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-neo4j-runtime-'));
    tempDirs.push(tmp);
    const repoRoot = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });

    fs.writeFileSync(
      path.join(repoRoot, 'src', 'a.ts'),
      [
        'export function run(order: any) {',
        '  order.total = 1;',
        '  return order.total;',
        '}',
        'export function sink(order: any) { return order.total; }',
        '',
      ].join('\n'),
      'utf8',
    );

    writeDefaultConfig(repoRoot);
    const cfg = loadConfig(repoRoot);
    const ctx = createNeo4jContext(cfg.neo4j);
    try {
      await verifyConnection(ctx);
      await initSchema(ctx, repoRoot);
      const graph = new GraphRepository(ctx);
      await graph.clearGraph();
      await indexRepo(graph, repoRoot, 'full', cfg);

      const caller = 'sym:typescript:src/a.ts:Function:run:1';
      const callee = 'sym:typescript:src/a.ts:Function:sink:5';
      const runtime = new RuntimeHookService(ctx);
      await runtime.ingestSpan({
        callerId: caller,
        calleeId: callee,
        durationMs: 250,
        ok: false,
        timestamp: new Date().toISOString(),
      });

      const runtimeView = await graph.executionReality(callee, '1hour');
      expect(Number(runtimeView.samples || 0)).toBeGreaterThan(0);
      expect(runtimeView.lookback).toBe('1hour');

      const risk = await graph.assessChangeRisk(caller, 'rename run');
      expect((risk.factors as Record<string, unknown>).runtime_hotspot).toBeDefined();

      const ctxBundle = await graph.getContextForTask('update run', caller);
      expect(((ctxBundle.resources as string[]) || []).some((r) => r.startsWith('view://runtime/'))).toBe(true);

      const session = ctx.driver.session({ database: cfg.neo4j.database });
      const agg = await session.run(
        `MATCH (n:RuntimeSpanAggregate) RETURN count(n) AS n`,
      );
      const windows = await session.run(
        `MATCH (n:RuntimeWindow) RETURN count(n) AS n`,
      );
      const observed = await session.run(
        `MATCH ()-[r:OBSERVED_CALL]->() RETURN count(r) AS n`,
      );
      await session.close();
      expect(Number(agg.records[0].get('n') || 0)).toBeGreaterThan(0);
      expect(Number(windows.records[0].get('n') || 0)).toBeGreaterThan(0);
      expect(Number(observed.records[0].get('n') || 0)).toBeGreaterThan(0);
    } finally {
      await closeNeo4j(ctx);
    }
  }, 20_000);
});
