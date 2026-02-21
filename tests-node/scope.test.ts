import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveRepoScope, isScopedNodeId, scopeNodeId, unscopeNodeId } from '../packages/core/src/index.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0, dirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('repo scope', () => {
  it('derives stable scope key from canonical repo root', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-scope-'));
    dirs.push(tmp);
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);

    const a = deriveRepoScope(repo);
    const b = deriveRepoScope(path.join(repo, '.'));
    expect(a.repoKey).toBe(b.repoKey);
    expect(a.repoRootCanonical).toBe(b.repoRootCanonical);
  });

  it('scopes and unscopes node ids', () => {
    const key = 'abc123';
    const local = 'file:src/app.ts';
    const scoped = scopeNodeId(key, local);
    expect(scoped).toContain(local);
    expect(isScopedNodeId(key, scoped)).toBe(true);
    expect(unscopeNodeId(key, scoped)).toBe(local);
  });
});
