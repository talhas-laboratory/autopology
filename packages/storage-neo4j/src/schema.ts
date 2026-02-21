import { openSession } from './driver.js';
import type { Neo4jContext } from './driver.js';
import { scopeNodeId, type RepoScope } from '@autopology/core';

const DDL = [
  'DROP CONSTRAINT warm_cache_key_unique IF EXISTS',
  'CREATE CONSTRAINT node_id_unique IF NOT EXISTS FOR (n:CodeNode) REQUIRE n.id IS UNIQUE',
  'CREATE CONSTRAINT repo_id_unique IF NOT EXISTS FOR (r:Repo) REQUIRE r.id IS UNIQUE',
  'CREATE CONSTRAINT module_id_unique IF NOT EXISTS FOR (m:Module) REQUIRE m.id IS UNIQUE',
  'CREATE CONSTRAINT function_id_unique IF NOT EXISTS FOR (f:Function) REQUIRE f.id IS UNIQUE',
  'CREATE CONSTRAINT class_id_unique IF NOT EXISTS FOR (c:Class) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT file_id_unique IF NOT EXISTS FOR (f:File) REQUIRE f.id IS UNIQUE',
  'CREATE CONSTRAINT concept_id_unique IF NOT EXISTS FOR (c:Concept) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT testcase_id_unique IF NOT EXISTS FOR (t:TestCase) REQUIRE t.id IS UNIQUE',
  'CREATE CONSTRAINT runtime_agg_id_unique IF NOT EXISTS FOR (r:RuntimeSpanAggregate) REQUIRE r.id IS UNIQUE',
  'CREATE CONSTRAINT runtime_window_id_unique IF NOT EXISTS FOR (r:RuntimeWindow) REQUIRE r.id IS UNIQUE',
  'CREATE CONSTRAINT warm_cache_repo_key_unique IF NOT EXISTS FOR (w:WarmCache) REQUIRE (w.repo_key, w.key) IS UNIQUE',
  'CREATE INDEX module_name_index IF NOT EXISTS FOR (m:Module) ON (m.name)',
  'CREATE INDEX function_name_index IF NOT EXISTS FOR (f:Function) ON (f.name)',
  'CREATE INDEX file_path_index IF NOT EXISTS FOR (f:File) ON (f.path)',
  'CREATE INDEX concept_name_index IF NOT EXISTS FOR (c:Concept) ON (c.name)',
  'CREATE INDEX testcase_path_index IF NOT EXISTS FOR (t:TestCase) ON (t.path)',
  'CREATE INDEX code_node_repo_key_index IF NOT EXISTS FOR (n:CodeNode) ON (n.repo_key)',
  'CREATE INDEX warm_cache_repo_key_index IF NOT EXISTS FOR (w:WarmCache) ON (w.repo_key)',
  'CREATE INDEX dataobject_name_index IF NOT EXISTS FOR (d:DataObject) ON (d.name)',
  'CREATE INDEX runtime_window_bucket_index IF NOT EXISTS FOR (r:RuntimeWindow) ON (r.bucket_start)',
  'CREATE INDEX runtime_window_caller_index IF NOT EXISTS FOR (r:RuntimeWindow) ON (r.caller_id)',
  'CREATE INDEX runtime_window_callee_index IF NOT EXISTS FOR (r:RuntimeWindow) ON (r.callee_id)',
  'CREATE INDEX code_node_estimated_tokens_index IF NOT EXISTS FOR (n:CodeNode) ON (n.estimated_tokens)',
  'CREATE INDEX code_node_priority_index IF NOT EXISTS FOR (n:CodeNode) ON (n.priority_score)',
  'CREATE INDEX dep_strength_index IF NOT EXISTS FOR ()-[r:DEPENDS_ON]-() ON (r.strength)',
  'CREATE INDEX data_field_index IF NOT EXISTS FOR (d:Field) ON (d.name)'
];

export async function initSchema(ctx: Neo4jContext, scope: RepoScope): Promise<void> {
  const session = openSession(ctx);
  try {
    for (const stmt of DDL) {
      await session.run(stmt);
    }
    await session.run(
       `MERGE (m:GraphMeta {id: $graphMetaId})
       SET m.repo_root = $repoRoot,
           m.repo_key = $repoKey,
           m.graph_version = coalesce(m.graph_version, '1'),
           m.schema_version = 4,
           m.runtime_updated_at = coalesce(m.runtime_updated_at, datetime()),
           m.created_at = coalesce(m.created_at, datetime()),
           m.updated_at = datetime()`,
      {
        graphMetaId: scope.graphMetaId,
        repoRoot: scope.repoRootCanonical,
        repoKey: scope.repoKey,
      },
    );
    await session.run(
      `MERGE (r:CodeNode:Repo {id: $repoNodeId})
       SET r.path = $repoRoot,
           r.repo_key = $repoKey,
           r.local_id = 'repo:root',
           r.name = 'repo',
           r.estimated_tokens = coalesce(r.estimated_tokens, 12),
           r.priority_score = coalesce(r.priority_score, 0.6),
           r.updated_at = datetime(),
           r.created_at = coalesce(r.created_at, datetime())`,
      {
        repoNodeId: scopeNodeId(scope.repoKey, 'repo:root'),
        repoRoot: scope.repoRootCanonical,
        repoKey: scope.repoKey,
      },
    );
  } finally {
    await session.close();
  }
}
