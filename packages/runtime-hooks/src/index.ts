import { openSession } from '@autopology/storage-neo4j';
import type { Neo4jContext } from '@autopology/storage-neo4j';

export interface RuntimeSpan {
  callerId: string;
  calleeId: string;
  durationMs: number;
  ok: boolean;
  timestamp: string;
}

export class RuntimeHookService {
  constructor(private readonly ctx: Neo4jContext) {}

  async ingestSpan(span: RuntimeSpan): Promise<void> {
    const bucketStart = toHourBucket(span.timestamp);
    const windowId = `runtime-window:${span.callerId}->${span.calleeId}:${bucketStart}`;
    const session = openSession(this.ctx);
    try {
      await session.run(
        `MATCH (c:CodeNode {id: $callerId}), (d:CodeNode {id: $calleeId})
         MERGE (agg:CodeNode:RuntimeSpanAggregate {id: $aggId})
         SET agg.caller_id = $callerId,
             agg.callee_id = $calleeId,
             agg.samples = coalesce(agg.samples, 0) + 1,
             agg.avg_duration_ms = CASE
               WHEN coalesce(agg.samples, 0) = 0 THEN $durationMs
               ELSE ((coalesce(agg.avg_duration_ms, 0) * (coalesce(agg.samples, 1) - 1)) + $durationMs) / coalesce(agg.samples, 1)
             END,
             agg.error_count = coalesce(agg.error_count, 0) + CASE WHEN $ok THEN 0 ELSE 1 END,
             agg.last_seen = datetime($timestamp),
             agg.updated_at = datetime(),
             agg.created_at = coalesce(agg.created_at, datetime())
         MERGE (c)-[r:OBSERVED_CALL]->(d)
         SET r.last_seen = datetime($timestamp),
             r.samples = coalesce(r.samples, 0) + 1,
             r.avg_duration_ms = CASE
                 WHEN coalesce(r.samples, 0) = 0 THEN $durationMs
                 ELSE ((coalesce(r.avg_duration_ms, 0) * (coalesce(r.samples, 1) - 1)) + $durationMs) / coalesce(r.samples, 1)
             END,
             r.error_count = coalesce(r.error_count, 0) + CASE WHEN $ok THEN 0 ELSE 1 END
         MERGE (w:CodeNode:RuntimeWindow {id: $windowId})
         SET w.caller_id = $callerId,
             w.callee_id = $calleeId,
             w.bucket_start = datetime($bucketStart),
             w.last_seen = datetime($timestamp),
             w.samples = coalesce(w.samples, 0) + 1,
             w.avg_duration_ms = CASE
               WHEN coalesce(w.samples, 0) = 0 THEN $durationMs
               ELSE ((coalesce(w.avg_duration_ms, 0) * (coalesce(w.samples, 1) - 1)) + $durationMs) / coalesce(w.samples, 1)
             END,
             w.error_count = coalesce(w.error_count, 0) + CASE WHEN $ok THEN 0 ELSE 1 END,
             w.updated_at = datetime(),
             w.created_at = coalesce(w.created_at, datetime())
         MERGE (m:GraphMeta {id: 'graph-meta'})
         SET m.runtime_updated_at = datetime($timestamp),
             m.updated_at = datetime(),
             m.created_at = coalesce(m.created_at, datetime())`,
        {
          aggId: `runtime:${span.callerId}->${span.calleeId}`,
          windowId,
          callerId: span.callerId,
          calleeId: span.calleeId,
          durationMs: span.durationMs,
          ok: span.ok,
          timestamp: span.timestamp,
          bucketStart,
        },
      );
    } finally {
      await session.close();
    }
  }

  async latestExecutionSnapshot(nodeId: string): Promise<Record<string, unknown> | null> {
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
}

function toHourBucket(timestamp: string): string {
  const dt = new Date(timestamp);
  if (Number.isNaN(dt.getTime())) {
    const now = new Date();
    now.setUTCMinutes(0, 0, 0);
    return now.toISOString();
  }
  dt.setUTCMinutes(0, 0, 0);
  return dt.toISOString();
}
