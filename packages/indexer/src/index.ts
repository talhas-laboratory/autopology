import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  conceptId,
  dirId,
  edgeId,
  estimateTokens,
  fileId,
  loadConfig,
  moduleId,
  safeJoinUnderRepo,
  symbolId,
  type AutopologyConfig,
} from '@autopology/core';
import type { GraphRepository, IndexedEdge, IndexedNode } from '@autopology/storage-neo4j';
import { defaultPlugins } from './plugins.js';
import type { ParsedFile } from './types.js';
import { iterRepoFiles } from './walk.js';

function sha256(data: string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function ensureStateDirs(repoRoot: string): void {
  fs.mkdirSync(path.join(repoRoot, '.autopology'), { recursive: true });
}

function topModule(relpath: string): string {
  return relpath.split('/')[0] || relpath;
}

function isTestFile(relpath: string): boolean {
  const lower = relpath.toLowerCase();
  const base = path.basename(lower);
  return (
    lower.includes('/tests/') ||
    lower.includes('/__tests__/') ||
    base.endsWith('.test.ts') ||
    base.endsWith('.spec.ts') ||
    base.endsWith('.test.tsx') ||
    base.endsWith('.spec.tsx') ||
    base.endsWith('.test.js') ||
    base.endsWith('.spec.js') ||
    base.endsWith('.test.jsx') ||
    base.endsWith('.spec.jsx') ||
    base.endsWith('_test.py') ||
    base.startsWith('test_')
  );
}

const CONCEPT_STOPWORDS = new Set([
  'src',
  'lib',
  'main',
  'index',
  'utils',
  'helper',
  'service',
  'module',
  'class',
  'function',
  'tests',
  'test',
  'spec',
  'impl',
  'core',
  'api',
  'app',
  'data',
  'model',
]);

function extractConceptTokens(input: string): string[] {
  const tokens = input
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4 && !CONCEPT_STOPWORDS.has(x));
  return [...new Set(tokens)].slice(0, 3);
}

function maybeGitCommit(repoRoot: string): string | undefined {
  try {
    const out = execSync('git rev-parse HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8').trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

function withRetrievalProps(labels: string[], props: Record<string, unknown>): Record<string, unknown> {
  return {
    ...props,
    estimated_tokens: Math.max(1, estimateTokens(props)),
    priority_score: priorityScore(labels, props),
  };
}

function priorityScore(labels: string[], props: Record<string, unknown>): number {
  let base = 0.5;
  if (labels.includes('Function') || labels.includes('Method')) base = 0.9;
  else if (labels.includes('Class')) base = 0.84;
  else if (labels.includes('Module')) base = 0.8;
  else if (labels.includes('File')) base = 0.74;
  else if (labels.includes('Dir')) base = 0.62;
  else if (labels.includes('TestCase')) base = 0.66;
  else if (labels.includes('DataObject') || labels.includes('Field')) base = 0.82;
  else if (labels.includes('Concept')) base = 0.7;
  else if (labels.includes('Repo')) base = 0.6;

  if (props.is_test_file === true) {
    base = Math.max(0.2, base - 0.1);
  }

  return Number(Math.min(1, Math.max(0, base)).toFixed(2));
}

export interface IndexResult {
  inserted_nodes: number;
  inserted_edges: number;
  changed_files: number;
  deleted_files: number;
  changed_paths: string[];
  deleted_paths: string[];
  impacted_node_ids: string[];
}

export async function indexRepo(
  repo: GraphRepository,
  repoRoot: string,
  mode: 'full' | 'incremental' = 'incremental',
  cfg?: AutopologyConfig,
): Promise<IndexResult> {
  const config = cfg || loadConfig(repoRoot);
  ensureStateDirs(repoRoot);

  const plugins = defaultPlugins();
  const extToPlugin = new Map<string, ReturnType<typeof defaultPlugins>[number]>();
  const exts = new Set<string>();
  for (const plugin of plugins) {
    for (const ext of plugin.supportedExtensions()) {
      exts.add(ext);
      extToPlugin.set(ext, plugin);
    }
  }

  const relpaths = iterRepoFiles(repoRoot, config.index, exts);
  const snapshot = await repo.getFileSnapshot();

  if (mode === 'full') {
    await repo.clearGraph();
  }

  const changed: string[] = [];
  const deleted: string[] = [];

  const currentHashes: Record<string, string> = {};
  for (const relpath of relpaths) {
    const abs = safeJoinUnderRepo(repoRoot, relpath);
    const text = fs.readFileSync(abs, 'utf8');
    currentHashes[relpath] = sha256(text);
  }

  for (const [p, oldHash] of Object.entries(snapshot)) {
    if (!(p in currentHashes)) {
      deleted.push(p);
    } else if (currentHashes[p] !== oldHash) {
      changed.push(p);
    }
  }

  for (const p of relpaths) {
    if (!(p in snapshot)) {
      changed.push(p);
    }
  }

  const changedUnique = [...new Set(changed)];
  const impactedNodeIds = new Set<string>();

  for (const relpath of deleted) {
    impactedNodeIds.add(fileId(relpath));
    await repo.deleteFileSubgraph(relpath);
  }

  let insertedNodes = 0;
  let insertedEdges = 0;

  for (const relpath of changedUnique) {
    const abs = safeJoinUnderRepo(repoRoot, relpath);
    const ext = path.extname(relpath).toLowerCase();
    const plugin = extToPlugin.get(ext);
    if (!plugin) continue;

    const text = fs.readFileSync(abs, 'utf8');
    let parsed: ParsedFile;
    try {
      parsed = plugin.parseFile(repoRoot, relpath, text);
    } catch (error) {
      const parseError = new Error(
        `Failed to parse ${relpath}: ${error instanceof Error ? error.message : String(error)}`,
      ) as Error & { code?: string; relpath?: string };
      parseError.code = 'PARSE_ERROR';
      parseError.relpath = relpath;
      throw parseError;
    }
    const srcModule = topModule(relpath);
    const isTest = isTestFile(relpath);

    await repo.deleteFileSubgraph(relpath);

    const nodes: IndexedNode[] = [];
    const edges: IndexedEdge[] = [];

    const fid = fileId(relpath);
    impactedNodeIds.add(fid);
    nodes.push({
      id: fid,
      labels: ['File'],
      props: withRetrievalProps(['File'], {
        name: path.basename(relpath),
        path: relpath,
        language: parsed.language,
        sha256: sha256(text),
        size_bytes: Buffer.byteLength(text, 'utf8'),
        is_test_file: isTest,
      }),
    });

    // Keep explicit repo root containment to satisfy required Repo root structure.
    const rootDir = dirId('.');
    impactedNodeIds.add('repo:root');
    impactedNodeIds.add(rootDir);
    nodes.push({
      id: 'repo:root',
      labels: ['Repo'],
      props: withRetrievalProps(['Repo'], { name: 'repo', path: repoRoot }),
    });
    nodes.push({
      id: moduleId(srcModule),
      labels: ['Module'],
      props: withRetrievalProps(['Module'], { name: srcModule, path: srcModule }),
    });
    edges.push({
      type: 'CONTAINS',
      src: 'repo:root',
      dst: rootDir,
      id: edgeId({ s: 'repo:root', d: rootDir, t: 'CONTAINS', p: {} }),
    });
    edges.push({
      type: 'CONTAINS',
      src: moduleId(srcModule),
      dst: fid,
      id: edgeId({ s: moduleId(srcModule), d: fid, t: 'CONTAINS', p: {} }),
    });

    const parts = relpath.split('/');
    let parent = rootDir;
    nodes.push({ id: parent, labels: ['Dir'], props: withRetrievalProps(['Dir'], { name: '.', path: '.' }) });
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts.slice(0, i + 1).join('/');
      const did = dirId(d);
      impactedNodeIds.add(did);
      nodes.push({ id: did, labels: ['Dir'], props: withRetrievalProps(['Dir'], { name: parts[i], path: d }) });
      edges.push({
        type: 'CONTAINS',
        src: parent,
        dst: did,
        id: edgeId({ s: parent, d: did, t: 'CONTAINS', p: {} }),
      });
      parent = did;
    }

    edges.push({
      type: 'CONTAINS',
      src: parent,
      dst: fid,
      id: edgeId({ s: parent, d: fid, t: 'CONTAINS', p: {} }),
    });

    const symIdByQualname = new Map<string, string>();
    for (const sym of parsed.symbols) {
      symIdByQualname.set(sym.qualname, symbolId(parsed.language, relpath, sym.kind, sym.qualname, sym.startLine));
    }

    for (const sym of parsed.symbols) {
      const sid = symbolId(parsed.language, relpath, sym.kind, sym.qualname, sym.startLine);
      impactedNodeIds.add(sid);
      nodes.push({
        id: sid,
        labels: [sym.kind],
        props: withRetrievalProps([sym.kind], {
          name: sym.name,
          qualname: sym.qualname,
          path: relpath,
          start_line: sym.startLine,
          end_line: sym.endLine,
          signature: sym.signature || null,
          visibility: sym.visibility || null,
          symbol_hash: sym.symbolHash,
          summary: `Implements ${sym.kind.toLowerCase()} ${sym.qualname} in ${relpath}.`,
        }),
      });

      edges.push({
        type: 'CONTAINS',
        src: fid,
        dst: sid,
        props: { line: sym.startLine },
      });

      // Deterministic baseline concept mapping.
      for (const token of extractConceptTokens(`${sym.name} ${sym.qualname} ${relpath}`)) {
        const cid = conceptId(token);
        impactedNodeIds.add(cid);
        nodes.push({
          id: cid,
          labels: ['Concept'],
          props: withRetrievalProps(['Concept'], { name: token, definition: `Inferred concept for ${token}` }),
        });
        edges.push({
          type: 'IMPLEMENTS',
          src: sid,
          dst: cid,
          props: { confidence: 0.58, role: 'name_token' },
        });
      }

      for (const call of sym.calls) {
        const resolved = call.resolvedQualname || call.callee;
        if (!resolved) continue;
        const dst =
          symIdByQualname.get(resolved) ||
          symbolId(parsed.language, relpath, 'Function', resolved);
        edges.push({
          type: 'CALLS',
          src: sid,
          dst,
          props: { line: call.line, confidence: call.resolvedQualname ? 0.8 : 0.6 },
        });
      }

      for (const flow of sym.dataFlows) {
        const objectId = `data:${flow.object.toLowerCase()}`;
        const fieldId = `field:${flow.object.toLowerCase()}:${flow.field.toLowerCase()}`;
        impactedNodeIds.add(objectId);
        impactedNodeIds.add(fieldId);
        nodes.push({ id: objectId, labels: ['DataObject'], props: withRetrievalProps(['DataObject'], { name: flow.object }) });
        nodes.push({ id: fieldId, labels: ['Field'], props: withRetrievalProps(['Field'], { name: flow.field }) });
        edges.push({ type: 'BELONGS_TO', src: fieldId, dst: objectId });
        edges.push({
          type: flow.action === 'READ' ? 'READS' : flow.action === 'WRITE' ? 'WRITES' : 'TRANSFORMS',
          src: sid,
          dst: fieldId,
          props: {
            line: flow.line,
            confidence: flow.confidence,
            partial_trace: flow.partialTrace,
          },
        });
      }

      if (isTest && ['Function', 'Method'].includes(sym.kind)) {
        const calls = [...new Set(sym.calls.map((c) => c.resolvedQualname || c.callee).filter(Boolean))];
        const testCaseId = `test:${parsed.language}:${relpath}:${sym.qualname}:${sym.startLine}`;
        impactedNodeIds.add(testCaseId);
        nodes.push({
          id: testCaseId,
          labels: ['TestCase'],
          props: withRetrievalProps(['TestCase'], {
            name: sym.name,
            qualname: sym.qualname,
            path: relpath,
            coverage: 0,
            called_names: calls,
          }),
        });
        edges.push({ type: 'CONTAINS', src: fid, dst: testCaseId, props: { line: sym.startLine } });
        for (const c of calls) {
          const localDst = symIdByQualname.get(c);
          if (!localDst) continue;
          edges.push({
            type: 'TESTS',
            src: testCaseId,
            dst: localDst,
            props: { confidence: 0.65, reason: 'local_call' },
          });
        }
      }
    }

    for (const imp of parsed.imports) {
      const dst = imp.resolvedRelpath ? fileId(imp.resolvedRelpath) : `ext:${imp.raw}`;
      if (!imp.resolvedRelpath) {
        nodes.push({
          id: dst,
          labels: [imp.isExternal ? 'ExternalLib' : 'Unresolved'],
          props: withRetrievalProps([imp.isExternal ? 'ExternalLib' : 'Unresolved'], { name: imp.raw, qualname: imp.raw }),
        });
      }
      edges.push({ type: 'IMPORTS', src: fid, dst, props: { raw: imp.raw, confidence: 0.95 } });

      if (imp.resolvedRelpath) {
        const dstModule = topModule(imp.resolvedRelpath);
        if (dstModule !== srcModule) {
          const srcModuleId = moduleId(srcModule);
          const dstModuleId = moduleId(dstModule);
          impactedNodeIds.add(srcModuleId);
          impactedNodeIds.add(dstModuleId);
          nodes.push({ id: srcModuleId, labels: ['Module'], props: withRetrievalProps(['Module'], { name: srcModule, path: srcModule }) });
          nodes.push({ id: dstModuleId, labels: ['Module'], props: withRetrievalProps(['Module'], { name: dstModule, path: dstModule }) });
          edges.push({
            type: 'DEPENDS_ON',
            src: srcModuleId,
            dst: dstModuleId,
            props: { strength: 1, type: 'import' },
          });
        }
      }
    }

    await repo.applyBatch(nodes, edges);
    await repo.upsertModuleForFile(relpath);
    if (isTest) {
      await repo.linkTestCasesByCalledNames(relpath);
    }

    insertedNodes += nodes.length;
    insertedEdges += edges.length;
  }

  await repo.setIndexedNow(undefined, maybeGitCommit(repoRoot));

  return {
    inserted_nodes: insertedNodes,
    inserted_edges: insertedEdges,
    changed_files: changedUnique.length,
    deleted_files: deleted.length,
    changed_paths: changedUnique,
    deleted_paths: deleted,
    impacted_node_ids: [...impactedNodeIds],
  };
}

export * from './walk.js';
export * from './types.js';
export * from './watch.js';
