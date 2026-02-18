import { edgeId, fileId, moduleId } from '@autopology/core';
import { openSession } from './driver.js';
import type { Neo4jContext } from './driver.js';
import {
  buildRelevanceNarrative,
  scoreRetrievalCandidate,
  sortScoredCandidates,
  tokenizeSearchQuery,
  type RetrievalCandidateInput,
} from './retrieval.js';

export interface IndexedNode {
  id: string;
  labels: string[];
  props: Record<string, unknown>;
}

export interface IndexedEdge {
  id?: string;
  type: string;
  src: string;
  dst: string;
  props?: Record<string, unknown>;
}

export interface GraphFreshness {
  indexedAt?: string;
  graphVersion: string;
  commitHash?: string;
  runtimeUpdatedAt?: string;
}

export class GraphRepository {
  constructor(readonly ctx: Neo4jContext) {}

  async clearGraph(): Promise<void> {
    const session = openSession(this.ctx);
    try {
      await session.run('MATCH (n) WHERE NOT n:GraphMeta DETACH DELETE n');
    } finally {
      await session.close();
    }
  }

  async setIndexedNow(graphVersion?: string, commitHash?: string): Promise<void> {
    const session = openSession(this.ctx);
    try {
      await session.run(
        `MERGE (m:GraphMeta {id: 'graph-meta'})
         SET m.indexed_at = datetime(),
             m.graph_version = coalesce($graphVersion, m.graph_version, '1'),
             m.commit_hash = coalesce($commitHash, m.commit_hash),
             m.updated_at = datetime()`,
        { graphVersion: graphVersion || null, commitHash: commitHash || null },
      );
    } finally {
      await session.close();
    }
  }

  async getFreshness(): Promise<GraphFreshness> {
    const session = openSession(this.ctx);
    try {
      const res = await session.run(
        `MATCH (m:GraphMeta {id: 'graph-meta'})
         RETURN toString(m.indexed_at) AS indexedAt,
                coalesce(m.graph_version,'1') AS graphVersion,
                m.commit_hash AS commitHash,
                toString(m.runtime_updated_at) AS runtimeUpdatedAt
         LIMIT 1`,
      );
      if (!res.records.length) {
        return { graphVersion: '1' };
      }
      return {
        indexedAt: res.records[0].get('indexedAt') as string,
        graphVersion: res.records[0].get('graphVersion') as string,
        commitHash: (res.records[0].get('commitHash') as string | null) || undefined,
        runtimeUpdatedAt: (res.records[0].get('runtimeUpdatedAt') as string | null) || undefined,
      };
    } finally {
      await session.close();
    }
  }

  async getMeta(): Promise<{ schemaVersion: number; graphVersion: string; repoRoot?: string }> {
    const session = openSession(this.ctx);
    try {
      const res = await session.run(
        `MATCH (m:GraphMeta {id: 'graph-meta'})
         RETURN coalesce(m.schema_version, 1) AS schemaVersion,
                coalesce(m.graph_version, '1') AS graphVersion,
                m.repo_root AS repoRoot
         LIMIT 1`,
      );
      if (!res.records.length) {
        return { schemaVersion: 1, graphVersion: '1' };
      }
      return {
        schemaVersion: Number(res.records[0].get('schemaVersion') || 1),
        graphVersion: String(res.records[0].get('graphVersion') || '1'),
        repoRoot: (res.records[0].get('repoRoot') as string | null) || undefined,
      };
    } finally {
      await session.close();
    }
  }

  async applyBatch(nodes: IndexedNode[], edges: IndexedEdge[]): Promise<void> {
    const session = openSession(this.ctx);
    const tx = session.beginTransaction();
    try {
      for (const node of nodes) {
        const labels = ['CodeNode', ...node.labels].map((v) => `:${v}`).join('');
        await tx.run(
          `MERGE (n${labels} {id: $id})
           SET n += $props,
               n.updated_at = datetime(),
               n.created_at = coalesce(n.created_at, datetime())`,
          {
            id: node.id,
            props: node.props,
          },
        );
      }

      for (const edge of edges) {
        const eid = edge.id || edgeId({
          s: edge.src,
          d: edge.dst,
          t: edge.type,
          p: edge.props || {},
        });
        await tx.run(
          `MATCH (s:CodeNode {id: $src}), (d:CodeNode {id: $dst})
           MERGE (s)-[r:${edge.type} {id: $id}]->(d)
           SET r += $props,
               r.updated_at = datetime(),
               r.created_at = coalesce(r.created_at, datetime())`,
          {
            src: edge.src,
            dst: edge.dst,
            id: eid,
            props: edge.props || {},
          },
        );
      }

      await tx.commit();
    } catch (error) {
      await tx.rollback();
      throw error;
    } finally {
      await session.close();
    }
  }

  async deleteFileSubgraph(relPath: string): Promise<void> {
    const session = openSession(this.ctx);
    const fid = fileId(relPath);
    try {
      await session.run(
        `MATCH (f:File {id: $fid})-[:CONTAINS*0..3]->(n)
         DETACH DELETE n`,
        { fid },
      );
    } finally {
      await session.close();
    }
  }

  async listKnownFiles(): Promise<string[]> {
    const session = openSession(this.ctx);
    try {
      const res = await session.run('MATCH (f:File) RETURN f.path AS path');
      return res.records.map((r) => String(r.get('path')));
    } finally {
      await session.close();
    }
  }

  async getFileSnapshot(): Promise<Record<string, string>> {
    const session = openSession(this.ctx);
    try {
      const res = await session.run('MATCH (f:File) RETURN f.path AS path, coalesce(f.sha256,\'\') AS sha');
      const out: Record<string, string> = {};
      for (const row of res.records) {
        out[String(row.get('path'))] = String(row.get('sha') || '');
      }
      return out;
    } finally {
      await session.close();
    }
  }

  async upsertModuleForFile(relPath: string): Promise<void> {
    const session = openSession(this.ctx);
    try {
      const top = relPath.split('/')[0] || relPath;
      await session.run(
        `MERGE (m:CodeNode:Module {id: $moduleId})
         SET m.name = $name,
             m.path = $path,
             m.estimated_tokens = coalesce(m.estimated_tokens, 16),
             m.priority_score = coalesce(m.priority_score, 0.8),
             m.updated_at = datetime(),
             m.created_at = coalesce(m.created_at, datetime())`,
        {
          moduleId: moduleId(top),
          name: top,
          path: top,
        },
      );
      await session.run(
        `MATCH (m:Module {id: $moduleId}), (f:File {id: $fileId})
         MERGE (m)-[:CONTAINS {id: $edgeId}]->(f)`,
        {
          moduleId: moduleId(top),
          fileId: fileId(relPath),
          edgeId: edgeId({ s: moduleId(top), d: fileId(relPath), t: 'CONTAINS', p: {} }),
        },
      );
    } finally {
      await session.close();
    }
  }

  async linkTestCasesByCalledNames(relPath: string): Promise<void> {
    const session = openSession(this.ctx);
    try {
      await session.run(
        `MATCH (t:TestCase {path: $path})
         UNWIND coalesce(t.called_names, []) AS called
         MATCH (f:Function)
         WHERE toLower(f.name) = toLower(called)
            OR toLower(f.qualname) = toLower(called)
            OR toLower(f.qualname) ENDS WITH '.' + toLower(called)
         MERGE (t)-[r:TESTS {id: $prefix + ':' + t.id + ':' + f.id}]->(f)
         SET r.confidence = 0.62,
             r.reason = 'called_name_heuristic',
             r.updated_at = datetime(),
             r.created_at = coalesce(r.created_at, datetime())`,
        {
          path: relPath,
          prefix: 'tests',
        },
      );
    } finally {
      await session.close();
    }
  }

  async getCounts(): Promise<{ files: number; nodes: number; edges: number }> {
    const session = openSession(this.ctx);
    try {
      const [filesRes, nodesRes, edgesRes] = await Promise.all([
        session.run('MATCH (f:File) RETURN count(f) AS n'),
        session.run('MATCH (n:CodeNode) RETURN count(n) AS n'),
        session.run('MATCH ()-[r]->() RETURN count(r) AS n'),
      ]);
      return {
        files: Number(filesRes.records[0].get('n')),
        nodes: Number(nodesRes.records[0].get('n')),
        edges: Number(edgesRes.records[0].get('n')),
      };
    } finally {
      await session.close();
    }
  }

  async understandCodebase(): Promise<Record<string, unknown>> {
    const session = openSession(this.ctx);
    try {
      const [countsRes, modulesRes, conceptsRes, entryRes, langsRes] = await Promise.all([
        session.run(
          `MATCH (f:File)
           WITH count(f) AS fileCount
           MATCH (n:CodeNode)
           WITH fileCount, count(n) AS nodeCount
           MATCH ()-[r]->()
           RETURN fileCount, nodeCount, count(r) AS edgeCount`,
        ),
        session.run(
          `MATCH (m:Module)
           RETURN m.name AS name
           ORDER BY m.name ASC
           LIMIT 20`,
        ),
        session.run(
          `MATCH (c:Concept)
           OPTIONAL MATCH (:CodeNode)-[:IMPLEMENTS]->(c)
           RETURN c.name AS name, count(*) AS impls
           ORDER BY impls DESC, name ASC
           LIMIT 12`,
        ),
        session.run(
          `MATCH (f:Function)
           WHERE toLower(coalesce(f.name,'')) CONTAINS 'main'
              OR toLower(coalesce(f.name,'')) CONTAINS 'handler'
              OR toLower(coalesce(f.name,'')) CONTAINS 'controller'
              OR toLower(coalesce(f.path,'')) CONTAINS '/api/'
              OR toLower(coalesce(f.path,'')) CONTAINS '/routes/'
           RETURN coalesce(f.path, f.id) AS entry
           ORDER BY entry ASC
           LIMIT 20`,
        ),
        session.run(
          `MATCH (f:File)
           WITH collect(DISTINCT toLower(coalesce(f.language,''))) AS langs
           RETURN [l IN langs WHERE l <> '' | l] AS langs`,
        ),
      ]);

      const counts = countsRes.records[0];
      const modules = modulesRes.records.map((r) => String(r.get('name')));
      const concepts = conceptsRes.records.map((r) => String(r.get('name')));
      const entryPoints = entryRes.records.map((r) => String(r.get('entry')));
      const langs = ((langsRes.records[0]?.get('langs') as string[]) || []).map(toLanguageName);

      return {
        domain: inferDomain(concepts),
        layers: inferLayers(modules),
        key_concepts: concepts,
        entry_points: entryPoints,
        tech_stack: langs,
        graph_snapshot: {
          files: Number(counts.get('fileCount') || 0),
          nodes: Number(counts.get('nodeCount') || 0),
          edges: Number(counts.get('edgeCount') || 0),
        },
      };
    } finally {
      await session.close();
    }
  }

  async findTarget(query: string, limit = 10): Promise<Array<Record<string, unknown>>> {
    const session = openSession(this.ctx);
    try {
      const queryTokens = tokenizeSearchQuery(query);
      const candidateLimit = Math.max(80, Math.min(600, limit * 10));

      const res = await session.run(
        `MATCH (n:CodeNode)
         WHERE size($tokens) = 0
            OR any(tok IN $tokens WHERE
                 toLower(coalesce(n.name,'')) CONTAINS tok
              OR toLower(coalesce(n.qualname,'')) CONTAINS tok
              OR toLower(coalesce(n.summary,'')) CONTAINS tok
              OR toLower(coalesce(n.path,'')) CONTAINS tok
            )
         RETURN n.id AS id, labels(n) AS labels, n.name AS name, n.qualname AS qualname, n.path AS path,
                coalesce(n.summary, '') AS summary,
                coalesce(n.priority_score, 0.5) AS priorityScore,
                size([(n)-[:DEPENDS_ON|CALLS|IMPORTS]->(:CodeNode) | 1]) +
                size([(:CodeNode)-[:DEPENDS_ON|CALLS|IMPORTS]->(n) | 1]) AS degree
         ORDER BY coalesce(n.priority_score, 0.5) DESC, coalesce(n.name, n.qualname, n.id) ASC
         LIMIT toInteger($candidateLimit)`,
        { tokens: queryTokens, candidateLimit },
      );

      let rows = res.records;
      if (!rows.length && queryTokens.length) {
        const fallback = await session.run(
          `MATCH (n:CodeNode)
           RETURN n.id AS id, labels(n) AS labels, n.name AS name, n.qualname AS qualname, n.path AS path,
                  coalesce(n.summary, '') AS summary,
                  coalesce(n.priority_score, 0.5) AS priorityScore,
                  size([(n)-[:DEPENDS_ON|CALLS|IMPORTS]->(:CodeNode) | 1]) +
                  size([(:CodeNode)-[:DEPENDS_ON|CALLS|IMPORTS]->(n) | 1]) AS degree
           ORDER BY coalesce(n.priority_score, 0.5) DESC, coalesce(n.name, n.qualname, n.id) ASC
           LIMIT toInteger($candidateLimit)`,
          { candidateLimit: Math.min(250, candidateLimit) },
        );
        rows = fallback.records;
      }

      const scored = sortScoredCandidates(
        rows
          .map((r) => {
            const input: RetrievalCandidateInput = {
              id: String(r.get('id')),
              labels: (r.get('labels') as string[]) || [],
              name: (r.get('name') as string | null) || undefined,
              qualname: (r.get('qualname') as string | null) || undefined,
              path: (r.get('path') as string | null) || undefined,
              summary: (r.get('summary') as string | null) || undefined,
              priorityScore: Number(r.get('priorityScore') || 0.5),
              degree: Number(r.get('degree') || 0),
            };
            return scoreRetrievalCandidate(query, input);
          })
          .filter((item) => item.score >= 0.06),
      );

      return scored.slice(0, limit).map((item) => ({
        id: item.id,
        type: inferType(item.labels),
        name: item.name || item.qualname || item.id,
        location: item.path || item.id,
        relevance: buildRelevanceNarrative(item.evidence),
        confidence: item.confidence,
        score: item.score,
        confidence_components: {
          lexical: item.evidence.lexical,
          semantic: item.evidence.semantic,
          graph: item.evidence.graph,
          coverage: item.evidence.coverage,
        },
      }));
    } finally {
      await session.close();
    }
  }

  async getModuleBoundary(moduleName: string): Promise<Record<string, unknown> | null> {
    const session = openSession(this.ctx);
    try {
      const moduleNodeId = moduleId(moduleName);
      const moduleRes = await session.run(
        `MATCH (m:Module {id: $id})
         OPTIONAL MATCH (m)-[:CONTAINS]->(f:File)
         OPTIONAL MATCH (f)-[:CONTAINS]->(fn:Function)
         OPTIONAL MATCH (m)-[:DEPENDS_ON]->(dep:Module)
         OPTIONAL MATCH (dep2:Module)-[:DEPENDS_ON]->(m)
         OPTIONAL MATCH (tc:TestCase)-[:TESTS]->(fn)
         RETURN m.name AS name,
                collect(DISTINCT fn.name)[0..20] AS publicApi,
                count(DISTINCT f) AS fileCount,
                collect(DISTINCT dep.name)[0..20] AS dependencies,
                collect(DISTINCT dep2.name)[0..20] AS dependents,
                count(DISTINCT tc) AS testCount`,
        { id: moduleNodeId },
      );
      if (!moduleRes.records.length) return null;

      const [circularRes, orphanRes, couplingRes, moduleCouplingRes] = await Promise.all([
        session.run(
          `MATCH p = (m:Module {id: $id})-[:DEPENDS_ON*1..6]->(m)
           WITH [n IN nodes(p) WHERE n:Module | n.name] AS cycle
           RETURN cycle
           LIMIT 10`,
          { id: moduleNodeId },
        ),
        session.run(
          `MATCH (m:Module)
           WHERE NOT (m)-[:DEPENDS_ON]->(:Module)
             AND NOT (:Module)-[:DEPENDS_ON]->(m)
           RETURN m.name AS name
           ORDER BY name ASC
           LIMIT 25`,
        ),
        session.run(
          `MATCH (m:Module)
           OPTIONAL MATCH (m)-[:DEPENDS_ON]->(d:Module)
           WITH m, count(DISTINCT d) AS outDegree
           OPTIONAL MATCH (u:Module)-[:DEPENDS_ON]->(m)
           WITH m, outDegree, count(DISTINCT u) AS inDegree
           WITH m, inDegree, outDegree, (inDegree + outDegree) AS coupling
           RETURN m.name AS module, inDegree, outDegree, coupling
           ORDER BY coupling DESC, module ASC
           LIMIT 12`,
        ),
        session.run(
          `MATCH (m:Module {id: $id})
           OPTIONAL MATCH (m)-[:DEPENDS_ON]->(d:Module)
           WITH m, count(DISTINCT d) AS outDegree
           OPTIONAL MATCH (u:Module)-[:DEPENDS_ON]->(m)
           WITH count(DISTINCT u) AS inDegree, outDegree
           RETURN (inDegree + outDegree) AS coupling`,
          { id: moduleNodeId },
        ),
      ]);

      const row = moduleRes.records[0];
      const circularDependencies = circularRes.records
        .map((r) => (r.get('cycle') as string[]) || [])
        .filter((cycle) => cycle.length > 1);
      const orphanModules = orphanRes.records.map((r) => String(r.get('name')));
      const couplingHotspots = couplingRes.records.map((r) => ({
        module: String(r.get('module')),
        in_degree: Number(r.get('inDegree') || 0),
        out_degree: Number(r.get('outDegree') || 0),
        coupling: Number(r.get('coupling') || 0),
      }));
      const moduleCoupling = Number(moduleCouplingRes.records[0]?.get('coupling') || 0);

      const riskIndicators: string[] = [];
      if (Number(row.get('testCount') || 0) === 0) riskIndicators.push('no_test_bindings');
      if (circularDependencies.length) riskIndicators.push('circular_dependency');
      if (moduleCoupling >= 8) riskIndicators.push('high_coupling');
      if (orphanModules.includes(moduleName)) riskIndicators.push('orphan_module');

      return {
        module: row.get('name'),
        public_api: row.get('publicApi') as string[],
        lines_of_code: null,
        dependencies: row.get('dependencies') as string[],
        dependents: row.get('dependents') as string[],
        file_count: Number(row.get('fileCount')),
        test_coverage: Number(row.get('testCount') || 0),
        risk_indicators: riskIndicators,
        dependency_diagnostics: {
          circular_dependencies: circularDependencies,
          orphan_modules: orphanModules,
          coupling_hotspots: couplingHotspots,
          module_coupling_score: moduleCoupling,
        },
      };
    } finally {
      await session.close();
    }
  }

  async traceImpact(nodeId: string, depth = 2, direction: 'upstream' | 'downstream' | 'both' = 'both') {
    const session = openSession(this.ctx);
    try {
      const upstream = direction === 'downstream'
        ? []
        : await session.run(
            `MATCH path = (d:CodeNode)-[:DEPENDS_ON|CALLS|IMPORTS*1..${depth}]->(t:CodeNode {id: $nodeId})
             WITH d, min(length(path)) AS distance
             RETURN d.id AS id, coalesce(d.name, d.qualname, d.id) AS name, distance
             ORDER BY distance ASC
             LIMIT 100`,
            { nodeId },
          );
      const downstream = direction === 'upstream'
        ? []
        : await session.run(
            `MATCH path = (t:CodeNode {id: $nodeId})-[:DEPENDS_ON|CALLS|IMPORTS*1..${depth}]->(d:CodeNode)
             WITH d, min(length(path)) AS distance
             RETURN d.id AS id, coalesce(d.name, d.qualname, d.id) AS name, distance
             ORDER BY distance ASC
             LIMIT 100`,
            { nodeId },
          );

      return {
        target: nodeId,
        upstream: Array.isArray(upstream)
          ? []
          : upstream.records.map((r) => ({
              node: r.get('name'),
              id: r.get('id'),
              distance: Number(r.get('distance')),
              criticality: criticalityFromDistance(Number(r.get('distance'))),
              confidence: 0.82,
            })),
        downstream: Array.isArray(downstream)
          ? []
          : downstream.records.map((r) => ({
              node: r.get('name'),
              id: r.get('id'),
              distance: Number(r.get('distance')),
              criticality: criticalityFromDistance(Number(r.get('distance'))),
              confidence: 0.82,
            })),
      };
    } finally {
      await session.close();
    }
  }

  async followData(
    objectType: string,
    field?: string,
    opts?: { instanceId?: string; trackPersistence?: boolean },
  ): Promise<Array<Record<string, unknown>>> {
    const session = openSession(this.ctx);
    try {
      const trackPersistence = Boolean(opts?.trackPersistence);
      const instanceToken = normalizeToken(opts?.instanceId || '');
      const res = await session.run(
        `MATCH (o:DataObject)
         WHERE toLower(o.name) CONTAINS toLower($objectType)
         OPTIONAL MATCH (f:Field)-[:BELONGS_TO]->(o)
         WHERE $field IS NULL OR toLower(f.name) CONTAINS toLower($field)
         OPTIONAL MATCH (writer:CodeNode)-[w:WRITES]->(f)
         OPTIONAL MATCH (transformer:CodeNode)-[t:TRANSFORMS]->(f)
         OPTIONAL MATCH (reader:CodeNode)-[r:READS]->(f)
         RETURN o.name AS object_name,
                f.name AS field_name,
                collect(DISTINCT {
                  node: coalesce(writer.name, writer.qualname, writer.id),
                  node_id: writer.id,
                  line: w.line,
                  type: 'WRITE',
                  confidence: w.confidence,
                  partial_trace: coalesce(w.partial_trace, false),
                  persistence_targets: coalesce(
                    CASE WHEN $trackPersistence THEN
                      [(writer)-[:CALLS]->(wc:CodeNode)
                        WHERE ${PERSISTENCE_WHERE('wc')}
                        | coalesce(wc.name, wc.qualname, wc.id)][0..5]
                    ELSE [] END, [])
                })[0..40] AS writes,
                collect(DISTINCT {
                  node: coalesce(transformer.name, transformer.qualname, transformer.id),
                  node_id: transformer.id,
                  line: t.line,
                  type: 'TRANSFORM',
                  confidence: t.confidence,
                  partial_trace: coalesce(t.partial_trace, false),
                  persistence_targets: coalesce(
                    CASE WHEN $trackPersistence THEN
                      [(transformer)-[:CALLS]->(tc:CodeNode)
                        WHERE ${PERSISTENCE_WHERE('tc')}
                        | coalesce(tc.name, tc.qualname, tc.id)][0..5]
                    ELSE [] END, [])
                })[0..40] AS transforms,
                collect(DISTINCT {
                  node: coalesce(reader.name, reader.qualname, reader.id),
                  node_id: reader.id,
                  line: r.line,
                  type: 'READ',
                  confidence: r.confidence,
                  partial_trace: coalesce(r.partial_trace, false),
                  persistence_targets: coalesce(
                    CASE WHEN $trackPersistence THEN
                      [(reader)-[:CALLS]->(rc:CodeNode)
                        WHERE ${PERSISTENCE_WHERE('rc')}
                        | coalesce(rc.name, rc.qualname, rc.id)][0..5]
                    ELSE [] END, [])
                })[0..40] AS reads`,
        { objectType, field: field || null, trackPersistence },
      );

      const directSteps: Array<Record<string, unknown>> = [];
      for (const row of res.records) {
        const steps = [
          ...(row.get('writes') as Array<Record<string, unknown>>),
          ...(row.get('transforms') as Array<Record<string, unknown>>),
          ...(row.get('reads') as Array<Record<string, unknown>>),
        ].filter((s) => s.node);
        steps.sort((a, b) => {
          const c = Number(b.confidence || 0) - Number(a.confidence || 0);
          if (c !== 0) return c;
          return Number(a.line || 0) - Number(b.line || 0);
        });
        let i = 1;
        for (const step of steps) {
          const persistenceTargets = ((step.persistence_targets as string[]) || []).filter(Boolean);
          directSteps.push({
            step: i++,
            object_type: row.get('object_name'),
            field: row.get('field_name'),
            location: step.node,
            node_id: step.node_id ?? null,
            transform: step.type,
            line: step.line ?? null,
            confidence: Number(step.confidence ?? (step.type === 'TRANSFORM' ? 0.74 : 0.82)),
            partial_trace: Boolean(step.partial_trace),
            trace_kind: 'direct',
            flow_depth: 0,
            via_node: null,
            via_node_id: null,
            persistence: trackPersistence ? persistenceTargets.length > 0 : undefined,
            persistence_targets: trackPersistence ? persistenceTargets : undefined,
          });
        }
      }

      const baseNodeIds = [...new Set(directSteps.map((step) => String(step.node_id || '')).filter(Boolean))];
      const inferredSteps: Array<Record<string, unknown>> = [];
      if (baseNodeIds.length > 0) {
        const inferredRes = await session.run(
          `UNWIND $baseNodeIds AS baseNodeId
           MATCH (base:CodeNode {id: baseNodeId})-[flow:READS|WRITES|TRANSFORMS]->(f:Field)-[:BELONGS_TO]->(o:DataObject)
           WHERE toLower(o.name) CONTAINS toLower($objectType)
             AND ($field IS NULL OR toLower(f.name) CONTAINS toLower($field))
           MATCH path = (caller:CodeNode)-[:CALLS*1..2]->(base)
           WITH o, f, caller, base, flow, min(length(path)) AS depth
           WHERE caller.id <> base.id
           RETURN o.name AS object_name,
                  f.name AS field_name,
                  coalesce(caller.name, caller.qualname, caller.id) AS caller_name,
                  caller.id AS caller_id,
                  coalesce(base.name, base.qualname, base.id) AS via_name,
                  base.id AS via_id,
                  type(flow) AS flow_type,
                  coalesce(flow.confidence, 0.72) AS base_confidence,
                  toInteger(depth) AS depth,
                  coalesce(
                    CASE WHEN $trackPersistence THEN
                      [(caller)-[:CALLS]->(pc:CodeNode)
                        WHERE ${PERSISTENCE_WHERE('pc')}
                        | coalesce(pc.name, pc.qualname, pc.id)][0..5]
                    ELSE [] END, []
                  ) AS persistence_targets
           ORDER BY depth ASC, caller_name ASC
           LIMIT 500`,
          {
            baseNodeIds,
            objectType,
            field: field || null,
            trackPersistence,
          },
        );

        for (const row of inferredRes.records) {
          const depth = Math.max(1, Number(row.get('depth') || 1));
          const persistenceTargets = ((row.get('persistence_targets') as string[]) || []).filter(Boolean);
          const flowType = String(row.get('flow_type') || '');
          inferredSteps.push({
            object_type: row.get('object_name'),
            field: row.get('field_name'),
            location: row.get('caller_name'),
            node_id: row.get('caller_id'),
            transform: flowEdgeToAction(flowType),
            line: null,
            confidence: interproceduralFlowConfidence(Number(row.get('base_confidence') || 0.72), depth),
            partial_trace: true,
            trace_kind: 'interprocedural',
            flow_depth: depth,
            via_node: row.get('via_name'),
            via_node_id: row.get('via_id'),
            persistence: trackPersistence ? persistenceTargets.length > 0 : undefined,
            persistence_targets: trackPersistence ? persistenceTargets : undefined,
          });
        }
      }

      const merged = dedupeFollowDataSteps([...directSteps, ...inferredSteps]).sort((a, b) => {
        const c = Number(b.confidence || 0) - Number(a.confidence || 0);
        if (c !== 0) return c;
        const depth = Number(a.flow_depth || 0) - Number(b.flow_depth || 0);
        if (depth !== 0) return depth;
        const la = Number(a.line || Number.MAX_SAFE_INTEGER);
        const lb = Number(b.line || Number.MAX_SAFE_INTEGER);
        if (la !== lb) return la - lb;
        return String(a.location || '').localeCompare(String(b.location || ''));
      });

      const out: Array<Record<string, unknown>> = merged.map((step, idx) => {
        const persistenceTargets = ((step.persistence_targets as string[]) || []).filter(Boolean);
        const instanceMatch = instanceToken
          ? normalizeToken(
              [
                String(step.object_type || ''),
                String(step.field || ''),
                String(step.location || ''),
                String(step.node_id || ''),
                String(step.via_node || ''),
                String(step.via_node_id || ''),
                persistenceTargets.join(' '),
              ].join(' '),
            ).includes(instanceToken)
          : false;
        return {
          ...step,
          step: idx + 1,
          instance_match: instanceToken ? instanceMatch : undefined,
          persistence_targets: trackPersistence ? persistenceTargets : undefined,
        };
      });

      if (!instanceToken) {
        return out;
      }

      const matched = out.filter((step) => Boolean(step.instance_match));
      if (matched.length > 0) {
        return matched;
      }

      return out.map((step) => ({
        ...step,
        partial_trace: true,
        confidence: Math.max(0.2, Number((step as Record<string, unknown>).confidence || 0) * 0.85),
      }));
    } finally {
      await session.close();
    }
  }

  async assessChangeRisk(target: string, changeDescription: string): Promise<Record<string, unknown>> {
    const nodeId = target.startsWith('sym:') || target.startsWith('file:') || target.startsWith('module:')
      ? target
      : `module:${target}`;
    const impact = await this.traceImpact(nodeId, 3, 'both');
    const blast = impact.upstream.length + impact.downstream.length;
    const complexity = Math.min(1, Math.max(0, changeDescription.length / 240));
    const coveragePenalty = 0.6;
    const blastFactor = Math.min(1, blast / 50);
    const runtime = await this.getRuntimeSnapshot(nodeId);
    const runtimeHot = runtime
      ? Math.min(
          1,
          Number((runtime.observed_calls as Array<Record<string, unknown>>).reduce((acc, cur) => {
            const errors = Number(cur.error_count || 0);
            const samples = Math.max(1, Number(cur.samples || 1));
            const errorRate = errors / samples;
            const duration = Math.min(1, Number(cur.avg_duration_ms || 0) / 1000);
            return acc + errorRate * 0.7 + duration * 0.3;
          }, 0)) / Math.max(1, (runtime.observed_calls as unknown[]).length),
        )
      : 0;

    const score = Math.round((blastFactor * 0.4 + coveragePenalty * 0.25 + complexity * 0.2 + runtimeHot * 0.15) * 100);
    return {
      risk_score: score,
      risk_level: score < 30 ? 'low' : score < 70 ? 'medium' : 'high',
      factors: {
        blast_radius: `${blast} related nodes`,
        test_coverage: 'unknown (penalized)',
        change_complexity: complexity > 0.6 ? 'high' : complexity > 0.3 ? 'medium' : 'low',
        runtime_hotspot: runtimeHot > 0.6 ? 'high' : runtimeHot > 0.3 ? 'medium' : 'low',
      },
      recommendations: riskRecommendations(score),
      safe_to_proceed: score <= 70,
    };
  }

  async resolveConcept(concept: string): Promise<Record<string, unknown>> {
    const ranked = await this.findTarget(concept, 60);
    const ordered = [...ranked].sort((a, b) => {
      const typeA = String(a.type || '');
      const typeB = String(b.type || '');
      if (typeA !== typeB) {
        if (typeA === 'concept') return -1;
        if (typeB === 'concept') return 1;
      }
      const confA = Number(a.confidence || 0);
      const confB = Number(b.confidence || 0);
      if (confB !== confA) return confB - confA;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    return {
      concept,
      implementations: ordered.slice(0, 25).map((item) => ({
        type: item.type,
        location: item.location || item.id,
        role: item.name,
        confidence: Number(item.confidence || 0.35),
        confidence_components: item.confidence_components || {},
      })),
      data_flow: [],
    };
  }

  async getTestsForFunction(functionName: string): Promise<Record<string, unknown>> {
    const session = openSession(this.ctx);
    try {
      const res = await session.run(
        `MATCH (t:TestCase)-[:TESTS]->(f:Function)
         WHERE toLower(f.name) CONTAINS toLower($name)
            OR toLower(f.qualname) CONTAINS toLower($name)
         RETURN f.name AS fn, t.path AS path, t.coverage AS coverage
         LIMIT 50`,
        { name: functionName },
      );
      const unitTests = res.records
        .map((r) => ({ file: r.get('path') as string, coverage: Number(r.get('coverage') || 0) }))
        .filter((r) => r.file);
      return {
        function: functionName,
        unit_tests: unitTests,
        integration_tests: [],
        suggested_tests_to_run: unitTests.map((t) => t.file),
      };
    } finally {
      await session.close();
    }
  }

  async getContextForTask(task: string, currentFocus?: string): Promise<Record<string, unknown>> {
    const targets = await this.findTarget(task, 5);
    const best = targets[0];
    const runtimeTarget = best?.id ? String(best.id) : currentFocus;
    const runtime = runtimeTarget ? await this.getRuntimeSnapshot(runtimeTarget) : null;

    const toolsToCall: Array<Record<string, unknown>> = [
      { tool: 'find_target', args: { query: task } },
      { tool: 'trace_impact', args: { node: best?.id || currentFocus || task, depth: 2 } },
      { tool: 'assess_change_risk', args: { target: best?.id || currentFocus || task, change_description: task } },
    ];
    if (runtime) {
      toolsToCall.push({ tool: 'assess_change_risk', args: { target: best?.id, change_description: `${task} (runtime hotspot aware)` } });
    }

    return {
      task,
      resources: [
        best ? `view://dependency/${best.id}` : `view://dependency/${task}`,
        currentFocus ? `codebase://module/${currentFocus}` : undefined,
        runtime && runtimeTarget ? `view://runtime/${runtimeTarget}` : undefined,
      ].filter(Boolean),
      tools_to_call: toolsToCall,
      suggested_approach: runtime
        ? 'Orient with find_target, scope with trace_impact, inspect runtime hotspot, then validate risk before edits.'
        : 'Orient with find_target, scope with trace_impact, then validate risk before edits.',
      estimated_tokens: 1200,
    };
  }

  async executionReality(functionName: string, lookback = '30min'): Promise<Record<string, unknown>> {
    const lookbackMs = parseLookbackMs(lookback, 30 * 60_000);
    const sinceIso = lookbackAnchorIso(lookbackMs);

    if (functionName === '*') {
      const session = openSession(this.ctx);
      try {
        const [hotspotsRes, failuresRes] = await Promise.all([
          session.run(
            `MATCH (w:RuntimeWindow)
             WHERE w.bucket_start >= datetime($sinceIso)
             OPTIONAL MATCH (callee:CodeNode {id: w.callee_id})
             RETURN w.callee_id AS calleeId,
                    coalesce(callee.name, callee.qualname, w.callee_id) AS calleeName,
                    sum(w.samples) AS samples,
                    sum(w.error_count) AS errors,
                    sum(toFloat(w.avg_duration_ms) * toFloat(w.samples)) AS weightedDuration
             ORDER BY samples DESC
             LIMIT 25`,
            { sinceIso },
          ),
          session.run(
            `MATCH (w:RuntimeWindow)
             WHERE w.bucket_start >= datetime($sinceIso)
               AND coalesce(w.error_count, 0) > 0
             RETURN toString(w.bucket_start) AS windowStart,
                    w.caller_id AS callerId,
                    w.callee_id AS calleeId,
                    w.error_count AS errors,
                    w.samples AS samples,
                    w.avg_duration_ms AS avgDuration
             ORDER BY w.bucket_start DESC, errors DESC
             LIMIT 15`,
            { sinceIso },
          ),
        ]);

        const hotspots = hotspotsRes.records.map((row) => {
          const samples = Number(row.get('samples') || 0);
          const errors = Number(row.get('errors') || 0);
          const weightedDuration = Number(row.get('weightedDuration') || 0);
          return {
            function: row.get('calleeName'),
            id: row.get('calleeId'),
            samples,
            avg_duration_ms: samples > 0 ? roundTo(weightedDuration / samples, 2) : 0,
            error_rate: samples > 0 ? roundTo(errors / samples, 4) : 0,
          };
        });
        const totalSamples = hotspots.reduce((acc, h) => acc + Number(h.samples || 0), 0);
        const totalErrors = hotspots.reduce((acc, h) => acc + Number(h.error_rate || 0) * Number(h.samples || 0), 0);
        const weightedDuration = hotspots.reduce((acc, h) => acc + Number(h.avg_duration_ms || 0) * Number(h.samples || 0), 0);

        return {
          function_name: functionName,
          lookback,
          lookback_start: sinceIso,
          hotspots,
          avg_duration_ms: totalSamples > 0 ? roundTo(weightedDuration / totalSamples, 2) : 0,
          error_rate: totalSamples > 0 ? roundTo(totalErrors / totalSamples, 4) : 0,
          hot_path: hotspots.length > 0,
          recent_failures: failuresRes.records.map((row) => ({
            time: row.get('windowStart'),
            caller: row.get('callerId'),
            callee: row.get('calleeId'),
            error_count: Number(row.get('errors') || 0),
            samples: Number(row.get('samples') || 0),
            avg_duration_ms: Number(row.get('avgDuration') || 0),
          })),
          samples: totalSamples,
          completeness: hotspots.length ? 'windowed' : 'partial',
        };
      } finally {
        await session.close();
      }
    }

    const targetIds = await this.resolveTargetNodeIds(functionName, 3);
    if (!targetIds.length) {
      return {
        function_name: functionName,
        lookback,
        lookback_start: sinceIso,
        called_by: [],
        calls_to: [],
        avg_duration_ms: 0,
        error_rate: 0,
        hot_path: false,
        recent_failures: [],
        samples: 0,
        completeness: 'failed',
      };
    }

    const targetId = targetIds[0];
    const session = openSession(this.ctx);
    try {
      const [incomingRes, byCallerRes, outgoingRes, failuresRes] = await Promise.all([
        session.run(
          `MATCH (w:RuntimeWindow {callee_id: $targetId})
           WHERE w.bucket_start >= datetime($sinceIso)
           RETURN sum(w.samples) AS samples,
                  sum(w.error_count) AS errors,
                  sum(toFloat(w.avg_duration_ms) * toFloat(w.samples)) AS weightedDuration,
                  max(w.last_seen) AS lastSeen`,
          { targetId, sinceIso },
        ),
        session.run(
          `MATCH (w:RuntimeWindow {callee_id: $targetId})
           WHERE w.bucket_start >= datetime($sinceIso)
           OPTIONAL MATCH (caller:CodeNode {id: w.caller_id})
           RETURN w.caller_id AS callerId,
                  coalesce(caller.name, caller.qualname, w.caller_id) AS callerName,
                  sum(w.samples) AS samples,
                  sum(w.error_count) AS errors,
                  sum(toFloat(w.avg_duration_ms) * toFloat(w.samples)) AS weightedDuration,
                  max(w.last_seen) AS lastSeen
           ORDER BY samples DESC
           LIMIT 12`,
          { targetId, sinceIso },
        ),
        session.run(
          `MATCH (w:RuntimeWindow {caller_id: $targetId})
           WHERE w.bucket_start >= datetime($sinceIso)
           OPTIONAL MATCH (callee:CodeNode {id: w.callee_id})
           RETURN w.callee_id AS calleeId,
                  coalesce(callee.name, callee.qualname, w.callee_id) AS calleeName,
                  sum(w.samples) AS samples,
                  sum(w.error_count) AS errors,
                  sum(toFloat(w.avg_duration_ms) * toFloat(w.samples)) AS weightedDuration
           ORDER BY samples DESC
           LIMIT 12`,
          { targetId, sinceIso },
        ),
        session.run(
          `MATCH (w:RuntimeWindow {callee_id: $targetId})
           WHERE w.bucket_start >= datetime($sinceIso)
             AND coalesce(w.error_count, 0) > 0
           RETURN toString(w.bucket_start) AS windowStart,
                  w.caller_id AS callerId,
                  w.error_count AS errors,
                  w.samples AS samples,
                  w.avg_duration_ms AS avgDuration
           ORDER BY w.bucket_start DESC, errors DESC
           LIMIT 10`,
          { targetId, sinceIso },
        ),
      ]);

      const incoming = incomingRes.records[0];
      const incomingSamples = Number(incoming?.get('samples') || 0);
      const incomingErrors = Number(incoming?.get('errors') || 0);
      const incomingWeightedDuration = Number(incoming?.get('weightedDuration') || 0);
      const hasWindowData =
        incomingSamples > 0 ||
        byCallerRes.records.length > 0 ||
        outgoingRes.records.length > 0;

      if (!hasWindowData) {
        const fallback = await this.getRuntimeSnapshot(targetId);
        const observed = (fallback?.observed_calls as Array<Record<string, unknown>> | undefined) || [];
        const samples = observed.reduce((acc, row) => acc + Number(row.samples || 0), 0);
        const weighted = observed.reduce(
          (acc, row) => acc + Number(row.avg_duration_ms || 0) * Number(row.samples || 0),
          0,
        );
        const errors = observed.reduce((acc, row) => acc + Number(row.error_count || 0), 0);
        return {
          function_name: functionName,
          target: targetId,
          lookback,
          lookback_start: sinceIso,
          called_by: [],
          calls_to: observed.map((row) => ({
            callee: row.callee,
            samples: Number(row.samples || 0),
            avg_duration_ms: Number(row.avg_duration_ms || 0),
            error_rate: Number(row.samples || 0) > 0 ? roundTo(Number(row.error_count || 0) / Number(row.samples || 1), 4) : 0,
          })),
          avg_duration_ms: samples > 0 ? roundTo(weighted / samples, 2) : 0,
          error_rate: samples > 0 ? roundTo(errors / samples, 4) : 0,
          hot_path: samples >= 50,
          recent_failures: [],
          samples,
          completeness: fallback ? 'partial' : 'failed',
        };
      }

      const calledBy = byCallerRes.records.map((row) => {
        const samples = Number(row.get('samples') || 0);
        const errors = Number(row.get('errors') || 0);
        const weightedDuration = Number(row.get('weightedDuration') || 0);
        return {
          caller: row.get('callerName'),
          id: row.get('callerId'),
          samples,
          avg_duration_ms: samples > 0 ? roundTo(weightedDuration / samples, 2) : 0,
          error_rate: samples > 0 ? roundTo(errors / samples, 4) : 0,
          last_seen: row.get('lastSeen') ? String(row.get('lastSeen')) : undefined,
        };
      });

      const callsTo = outgoingRes.records.map((row) => {
        const samples = Number(row.get('samples') || 0);
        const errors = Number(row.get('errors') || 0);
        const weightedDuration = Number(row.get('weightedDuration') || 0);
        return {
          callee: row.get('calleeName'),
          id: row.get('calleeId'),
          samples,
          avg_duration_ms: samples > 0 ? roundTo(weightedDuration / samples, 2) : 0,
          error_rate: samples > 0 ? roundTo(errors / samples, 4) : 0,
        };
      });

      const avgDuration = incomingSamples > 0 ? roundTo(incomingWeightedDuration / incomingSamples, 2) : 0;
      const errorRate = incomingSamples > 0 ? roundTo(incomingErrors / incomingSamples, 4) : 0;

      return {
        function_name: functionName,
        target: targetId,
        lookback,
        lookback_start: sinceIso,
        called_by: calledBy,
        calls_to: callsTo,
        avg_duration_ms: avgDuration,
        error_rate: errorRate,
        hot_path: incomingSamples >= 50 || avgDuration >= 200 || errorRate >= 0.05,
        recent_failures: failuresRes.records.map((row) => ({
          time: row.get('windowStart'),
          caller: row.get('callerId'),
          error_count: Number(row.get('errors') || 0),
          samples: Number(row.get('samples') || 0),
          avg_duration_ms: Number(row.get('avgDuration') || 0),
        })),
        samples: incomingSamples,
        completeness: 'windowed',
      };
    } finally {
      await session.close();
    }
  }

  async safeRefactorPlan(target: string, changeDescription: string): Promise<Record<string, unknown>> {
    const targetIds = await this.resolveTargetNodeIds(target, 1);
    const targetId = targetIds[0] || target;
    const [impact, risk] = await Promise.all([
      this.traceImpact(targetId, 2, 'both'),
      this.assessChangeRisk(targetId, changeDescription),
    ]);

    const impacted = [
      ...impact.upstream.map((item) => String(item.id || item.node || '')),
      ...impact.downstream.map((item) => String(item.id || item.node || '')),
    ];
    const impactedFiles = [...new Set(impacted.map(inferFileFromNodeId).filter(Boolean))].slice(0, 40);
    const symbolName = extractSymbolName(targetId) || target;
    const tests = await this.getTestsForFunction(symbolName);
    const suggestedTests = ((tests.suggested_tests_to_run as string[]) || []).slice(0, 10);

    const recommendations = (risk.recommendations as string[]) || [];
    const riskLevel = String(risk.risk_level || 'medium');

    return {
      target,
      target_id: targetId,
      change_description: changeDescription,
      files_to_modify: impactedFiles.length,
      impacted_files: impactedFiles,
      order: ['exports', 'imports', 'call sites', 'tests', 'docs'],
      risks: recommendations,
      verification_steps: [
        ...suggestedTests.map((file) => `Run ${file}`),
        'Run trace_impact on the top dependents before merge.',
        'Recheck execution_reality for hotspot regressions after change.',
      ],
      risk_score: Number(risk.risk_score || 0),
      risk_level: riskLevel,
      safe_to_proceed: Boolean(risk.safe_to_proceed),
    };
  }

  async generateContextForLlm(targetNodes: string[]): Promise<Record<string, unknown>> {
    const requested = Array.isArray(targetNodes) ? targetNodes.filter(Boolean) : [];
    const resolved: string[] = [];
    for (const raw of requested.slice(0, 8)) {
      const matches = await this.resolveTargetNodeIds(raw, 1);
      resolved.push(matches[0] || raw);
    }
    const uniqueIds = [...new Set(resolved)];
    if (!uniqueIds.length) {
      return {
        target_nodes: [],
        prompt_context: 'No valid target nodes were supplied.',
        resources: [],
        constraints: ['Resolve a concrete target with find_target first.'],
      };
    }

    const session = openSession(this.ctx);
    try {
      const res = await session.run(
        `UNWIND $ids AS id
         MATCH (n:CodeNode {id: id})
         OPTIONAL MATCH (n)-[:DEPENDS_ON|CALLS|IMPORTS]->(dep:CodeNode)
         OPTIONAL MATCH (t:TestCase)-[:TESTS]->(n)
         RETURN id AS id,
                coalesce(n.name, n.qualname, n.id) AS name,
                n.path AS path,
                collect(DISTINCT coalesce(dep.name, dep.qualname, dep.id))[0..10] AS deps,
                collect(DISTINCT t.path)[0..10] AS tests`,
        { ids: uniqueIds },
      );

      const targets = res.records.map((row) => ({
        id: row.get('id'),
        name: row.get('name'),
        path: row.get('path') || row.get('id'),
        dependencies: row.get('deps') as string[],
        tests: row.get('tests') as string[],
      }));

      const dependencySet = new Set<string>();
      const testsSet = new Set<string>();
      for (const target of targets) {
        for (const dep of target.dependencies || []) dependencySet.add(String(dep));
        for (const t of target.tests || []) testsSet.add(String(t));
      }

      const lines = [
        `You are working on: ${targets.map((t) => `${String(t.name)} (${String(t.path)})`).join('; ')}`,
        `Primary dependencies: ${[...dependencySet].slice(0, 12).join(', ') || 'none mapped'}`,
        `Tests to prioritize: ${[...testsSet].slice(0, 12).join(', ') || 'no direct tests mapped'}`,
        'Constraints: preserve public interfaces, avoid broad module boundary changes without impact review.',
        'Sequence: orient with find_target, scope with trace_impact, then validate risk before edits.',
      ];

      return {
        target_nodes: targets,
        prompt_context: lines.join('\n'),
        resources: targets.map((t) => `view://dependency/${encodeURIComponent(String(t.id))}`),
        constraints: [
          'Keep edits inside the identified impact boundary.',
          'Run mapped tests before finalizing.',
          'Escalate high risk changes for human review.',
        ],
      };
    } finally {
      await session.close();
    }
  }

  async queryExecutionTrace(errorId: string, lookback = '24hour'): Promise<Record<string, unknown>> {
    const lookbackMs = parseLookbackMs(lookback, 24 * 60 * 60_000);
    const sinceIso = lookbackAnchorIso(lookbackMs);
    const q = errorId.toLowerCase();

    const session = openSession(this.ctx);
    try {
      let res = await session.run(
        `MATCH (w:RuntimeWindow)
         WHERE w.bucket_start >= datetime($sinceIso)
           AND coalesce(w.error_count, 0) > 0
           AND (
             toLower(coalesce(w.id, '')) CONTAINS $q OR
             toLower(coalesce(w.caller_id, '')) CONTAINS $q OR
             toLower(coalesce(w.callee_id, '')) CONTAINS $q
           )
         OPTIONAL MATCH (c:CodeNode {id: w.caller_id})
         OPTIONAL MATCH (d:CodeNode {id: w.callee_id})
         RETURN w.id AS id,
                toString(w.bucket_start) AS bucketStart,
                w.caller_id AS callerId,
                coalesce(c.name, c.qualname, w.caller_id) AS callerName,
                w.callee_id AS calleeId,
                coalesce(d.name, d.qualname, w.callee_id) AS calleeName,
                w.samples AS samples,
                w.error_count AS errors,
                w.avg_duration_ms AS avgDuration
         ORDER BY errors DESC, samples DESC
         LIMIT 50`,
        { sinceIso, q },
      );

      if (!res.records.length) {
        res = await session.run(
          `MATCH (w:RuntimeWindow)
           WHERE w.bucket_start >= datetime($sinceIso)
             AND coalesce(w.error_count, 0) > 0
           OPTIONAL MATCH (c:CodeNode {id: w.caller_id})
           OPTIONAL MATCH (d:CodeNode {id: w.callee_id})
           RETURN w.id AS id,
                  toString(w.bucket_start) AS bucketStart,
                  w.caller_id AS callerId,
                  coalesce(c.name, c.qualname, w.caller_id) AS callerName,
                  w.callee_id AS calleeId,
                  coalesce(d.name, d.qualname, w.callee_id) AS calleeName,
                  w.samples AS samples,
                  w.error_count AS errors,
                  w.avg_duration_ms AS avgDuration
           ORDER BY errors DESC, samples DESC
           LIMIT 30`,
          { sinceIso },
        );
      }

      const traces = res.records.map((row) => ({
        trace_id: row.get('id'),
        window_start: row.get('bucketStart'),
        caller: row.get('callerName'),
        caller_id: row.get('callerId'),
        callee: row.get('calleeName'),
        callee_id: row.get('calleeId'),
        samples: Number(row.get('samples') || 0),
        error_count: Number(row.get('errors') || 0),
        avg_duration_ms: Number(row.get('avgDuration') || 0),
      }));
      const totalErrors = traces.reduce((acc, trace) => acc + Number(trace.error_count || 0), 0);
      const totalSamples = traces.reduce((acc, trace) => acc + Number(trace.samples || 0), 0);

      return {
        error_id: errorId,
        lookback,
        lookback_start: sinceIso,
        traces,
        total_errors: totalErrors,
        total_samples: totalSamples,
        likely_root_causes: inferLikelyRootCauses(traces),
      };
    } finally {
      await session.close();
    }
  }

  private async resolveTargetNodeIds(target: string, limit = 5): Promise<string[]> {
    if (!target) return [];
    if (
      target.startsWith('sym:') ||
      target.startsWith('file:') ||
      target.startsWith('module:') ||
      target.startsWith('dir:')
    ) {
      return [target];
    }
    const matches = await this.findTarget(target, limit);
    return matches
      .map((item) => String(item.id || ''))
      .filter(Boolean);
  }

  async getRuntimeSnapshot(nodeId: string): Promise<Record<string, unknown> | null> {
    const session = openSession(this.ctx);
    try {
      const res = await session.run(
        `MATCH (s:CodeNode {id: $id})-[r:OBSERVED_CALL]->(d:CodeNode)
         RETURN d.id AS callee,
                r.samples AS samples,
                r.avg_duration_ms AS avgDuration,
                r.error_count AS errors,
                toString(r.last_seen) AS lastSeen
         ORDER BY samples DESC
         LIMIT 20`,
        { id: nodeId },
      );
      if (!res.records.length) return null;
      return {
        node_id: nodeId,
        observed_calls: res.records.map((row) => ({
          callee: row.get('callee'),
          samples: Number(row.get('samples') || 0),
          avg_duration_ms: Number(row.get('avgDuration') || 0),
          error_count: Number(row.get('errors') || 0),
          last_seen: row.get('lastSeen'),
        })),
      };
    } finally {
      await session.close();
    }
  }

  async getModuleResource(name: string): Promise<Record<string, unknown> | null> {
    const boundary = await this.getModuleBoundary(name);
    if (!boundary) return null;
    return {
      uri: `codebase://module/${name}`,
      name,
      content_level: 'summary',
      content: {
        overview: `Module ${name}`,
        public_api_count: (boundary.public_api as string[]).length,
        dependency_count: (boundary.dependencies as string[]).length,
        dependent_count: (boundary.dependents as string[]).length,
      },
      metadata: {
        confidence: 0.82,
        completeness: 'partial',
        estimated_tokens: 120,
      },
      deeper_levels: {
        relationships: `view://dependency/${name}`,
        implementation: `view://implementation/${name}`,
      },
    };
  }

  async getConceptResource(name: string): Promise<Record<string, unknown>> {
    const concept = await this.resolveConcept(name);
    const implementations = (concept.implementations as Array<Record<string, unknown>> | undefined) || [];
    return {
      uri: `concept://${name}`,
      name,
      content_level: 'summary',
      content: {
        definition: `Concept mapped for ${name}`,
        primary_implementation: implementations[0]?.location || null,
        implementation_count: implementations.length,
        cross_cutting: implementations.length > 1,
      },
      metadata: {
        confidence: 0.74,
        estimated_tokens: 100,
      },
      deeper_levels: {
        implementations: `concept://${name}/implementations`,
        data_flow: `concept://${name}/data-flow`,
      },
    };
  }

  async getViewResource(lens: string, target: string): Promise<Record<string, unknown>> {
    if (lens === 'dependency') {
      return await this.traceImpact(target, 2, 'both');
    }
    if (lens === 'data-flow') {
      return {
        lens,
        target,
        items: await this.followData(target),
      };
    }
    if (lens === 'runtime') {
      return await this.executionReality(target, '30min');
    }
    if (lens === 'changes') {
      const [impact, risk] = await Promise.all([
        this.traceImpact(target, 2, 'both'),
        this.assessChangeRisk(target, 'changes lens analysis'),
      ]);
      const session = openSession(this.ctx);
      try {
        const coupling = await session.run(
          `MATCH (m:Module)
           OPTIONAL MATCH (m)-[:DEPENDS_ON]->(d:Module)
           WITH m, count(DISTINCT d) AS outDegree
           OPTIONAL MATCH (u:Module)-[:DEPENDS_ON]->(m)
           WITH m, outDegree, count(DISTINCT u) AS inDegree
           WITH m, inDegree, outDegree, (inDegree + outDegree) AS coupling
           RETURN m.name AS module, inDegree, outDegree, coupling
           ORDER BY coupling DESC, module ASC
           LIMIT 10`,
        );

        return {
          lens,
          target,
          blast_radius: impact.upstream.length + impact.downstream.length,
          impact,
          risk,
          coupling_hotspots: coupling.records.map((r) => ({
            module: String(r.get('module')),
            in_degree: Number(r.get('inDegree') || 0),
            out_degree: Number(r.get('outDegree') || 0),
            coupling: Number(r.get('coupling') || 0),
          })),
        };
      } finally {
        await session.close();
      }
    }
    return { lens, target, message: 'unsupported lens' };
  }
}

function inferType(labels: string[]): string {
  if (labels.includes('Module')) return 'module';
  if (labels.includes('Function')) return 'function';
  if (labels.includes('Concept')) return 'concept';
  if (labels.includes('TestCase')) return 'test';
  return 'node';
}

function criticalityFromDistance(distance: number): 'high' | 'medium' | 'low' {
  if (distance <= 1) return 'high';
  if (distance <= 2) return 'medium';
  return 'low';
}

function flowEdgeToAction(flowType: string): 'READ' | 'WRITE' | 'TRANSFORM' {
  const normalized = flowType.toUpperCase();
  if (normalized === 'READS' || normalized === 'READ') return 'READ';
  if (normalized === 'WRITES' || normalized === 'WRITE') return 'WRITE';
  return 'TRANSFORM';
}

function interproceduralFlowConfidence(baseConfidence: number, depth: number): number {
  const base = Math.max(0.2, Math.min(1, Number.isFinite(baseConfidence) ? baseConfidence : 0.72));
  const hops = Math.max(1, depth);
  const decay = Math.pow(0.82, hops);
  return roundTo(Math.max(0.2, base * decay), 2);
}

function dedupeFollowDataSteps(steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const best = new Map<string, Record<string, unknown>>();
  for (const step of steps) {
    const key = [
      String(step.object_type || ''),
      String(step.field || ''),
      String(step.node_id || step.location || ''),
      String(step.transform || ''),
    ].join('|');
    const existing = best.get(key);
    if (!existing) {
      best.set(key, step);
      continue;
    }
    best.set(key, pickBetterFlowStep(existing, step));
  }
  return [...best.values()];
}

function pickBetterFlowStep(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const confA = Number(a.confidence || 0);
  const confB = Number(b.confidence || 0);
  if (confB !== confA) {
    return confB > confA ? b : a;
  }

  const depthA = Number(a.flow_depth || 0);
  const depthB = Number(b.flow_depth || 0);
  if (depthA !== depthB) {
    return depthB < depthA ? b : a;
  }

  const partialA = Boolean(a.partial_trace);
  const partialB = Boolean(b.partial_trace);
  if (partialA !== partialB) {
    return partialB ? a : b;
  }

  const lineA = Number(a.line || Number.MAX_SAFE_INTEGER);
  const lineB = Number(b.line || Number.MAX_SAFE_INTEGER);
  return lineB < lineA ? b : a;
}

function riskRecommendations(score: number): string[] {
  if (score > 70) {
    return [
      'Require human review before merge.',
      'Stage change in smaller commits.',
      'Write safety tests before refactor.',
    ];
  }
  if (score > 30) {
    return ['Run affected unit and integration tests.', 'Scope change to smallest boundary first.'];
  }
  return ['Proceed with standard review and test checks.'];
}

function parseLookbackMs(input: string | undefined, fallbackMs: number): number {
  if (!input) return fallbackMs;
  const normalized = input.trim().toLowerCase();
  const m = normalized.match(/^(\d+)\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/);
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return fallbackMs;
  const unit = m[2];
  if (unit.startsWith('m')) return n * 60_000;
  if (unit.startsWith('h')) return n * 60 * 60_000;
  return n * 24 * 60 * 60_000;
}

function lookbackAnchorIso(lookbackMs: number): string {
  return new Date(Date.now() - Math.max(1, lookbackMs)).toISOString();
}

function roundTo(value: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function normalizeToken(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function PERSISTENCE_WHERE(alias: string): string {
  return `toLower(coalesce(${alias}.name, ${alias}.qualname, ${alias}.id)) CONTAINS 'save'
          OR toLower(coalesce(${alias}.name, ${alias}.qualname, ${alias}.id)) CONTAINS 'persist'
          OR toLower(coalesce(${alias}.name, ${alias}.qualname, ${alias}.id)) CONTAINS 'insert'
          OR toLower(coalesce(${alias}.name, ${alias}.qualname, ${alias}.id)) CONTAINS 'update'
          OR toLower(coalesce(${alias}.name, ${alias}.qualname, ${alias}.id)) CONTAINS 'upsert'
          OR toLower(coalesce(${alias}.name, ${alias}.qualname, ${alias}.id)) CONTAINS 'write'
          OR toLower(coalesce(${alias}.name, ${alias}.qualname, ${alias}.id)) CONTAINS 'commit'
          OR toLower(coalesce(${alias}.name, ${alias}.qualname, ${alias}.id)) CONTAINS 'flush'
          OR toLower(coalesce(${alias}.name, ${alias}.qualname, ${alias}.id)) CONTAINS 'store'
          OR toLower(coalesce(${alias}.name, ${alias}.qualname, ${alias}.id)) CONTAINS 'db.'`;
}

function inferFileFromNodeId(nodeId: string): string | null {
  if (!nodeId) return null;
  if (nodeId.startsWith('file:')) {
    return nodeId.slice('file:'.length);
  }
  if (nodeId.startsWith('sym:')) {
    const parts = nodeId.split(':');
    if (parts.length >= 4) return parts[2] || null;
  }
  return null;
}

function extractSymbolName(nodeId: string): string | null {
  if (!nodeId.startsWith('sym:')) return null;
  const parts = nodeId.split(':');
  if (parts.length < 5) return null;
  const candidate = parts[4] || '';
  if (!candidate) return null;
  const segs = candidate.split('.');
  return segs[segs.length - 1] || candidate;
}

function toLanguageName(lang: string): string {
  const map: Record<string, string> = {
    typescript: 'TypeScript',
    ts: 'TypeScript',
    javascript: 'JavaScript',
    js: 'JavaScript',
    python: 'Python',
    py: 'Python',
  };
  return map[lang] || lang;
}

function inferLayers(modules: string[]): string[] {
  const layers = new Set<string>();
  for (const mod of modules) {
    const lower = mod.toLowerCase();
    if (lower.includes('api') || lower.includes('route') || lower.includes('controller')) layers.add('api');
    if (lower.includes('service') || lower.includes('domain') || lower.includes('business')) layers.add('services');
    if (lower.includes('repo') || lower.includes('data') || lower.includes('db') || lower.includes('store')) layers.add('data');
    if (lower.includes('job') || lower.includes('queue') || lower.includes('worker') || lower.includes('cron')) layers.add('jobs');
  }
  return layers.size ? [...layers] : ['core'];
}

function inferDomain(concepts: string[]): string {
  if (!concepts.length) return 'application codebase';
  return `${concepts.slice(0, 3).join(', ')} domain`;
}

function inferLikelyRootCauses(traces: Array<Record<string, unknown>>): string[] {
  if (!traces.length) return ['No matching runtime errors in lookback window.'];
  const ranked = [...traces]
    .sort((a, b) => Number(b.error_count || 0) - Number(a.error_count || 0))
    .slice(0, 3);
  return ranked.map((trace) => {
    const callee = String(trace.callee || trace.callee_id || 'unknown');
    const errors = Number(trace.error_count || 0);
    const avgDuration = Number(trace.avg_duration_ms || 0);
    if (avgDuration > 1000) {
      return `${callee} shows ${errors} errors with high latency (${avgDuration}ms avg).`;
    }
    return `${callee} is a frequent failing callee (${errors} errors).`;
  });
}
