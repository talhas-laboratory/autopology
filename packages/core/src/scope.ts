import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SCOPED_PREFIX = 'rs:';
const SCOPED_DELIM = '::';

export interface RepoScope {
  repoRootInput: string;
  repoRootCanonical: string;
  repoKey: string;
  scopePrefix: string;
  graphMetaId: string;
}

export function deriveRepoScope(repoRoot: string): RepoScope {
  const resolved = path.resolve(repoRoot);
  const canonical = fs.realpathSync(resolved);
  const repoKey = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  return {
    repoRootInput: resolved,
    repoRootCanonical: canonical,
    repoKey,
    scopePrefix: `${SCOPED_PREFIX}${repoKey}${SCOPED_DELIM}`,
    graphMetaId: `graph-meta:${repoKey}`,
  };
}

export function scopeNodeId(repoKey: string, localId: string): string {
  if (!localId) return localId;
  const expected = `${SCOPED_PREFIX}${repoKey}${SCOPED_DELIM}`;
  if (localId.startsWith(expected)) return localId;
  if (localId.startsWith(SCOPED_PREFIX)) {
    throw new Error(`node id belongs to a different repo scope: ${localId}`);
  }
  return `${expected}${localId}`;
}

export function unscopeNodeId(repoKey: string, id: string): string {
  if (!id) return id;
  const expected = `${SCOPED_PREFIX}${repoKey}${SCOPED_DELIM}`;
  if (id.startsWith(expected)) return id.slice(expected.length);
  return id;
}

export function isScopedNodeId(repoKey: string, id: string): boolean {
  if (!id) return false;
  return id.startsWith(`${SCOPED_PREFIX}${repoKey}${SCOPED_DELIM}`);
}
