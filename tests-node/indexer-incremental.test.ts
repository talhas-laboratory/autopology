import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexRepo } from '../packages/indexer/src/index.ts';

class FakeGraphRepo {
  snapshot: Record<string, string> = {};

  async getFileSnapshot(): Promise<Record<string, string>> {
    return { ...this.snapshot };
  }

  async clearGraph(): Promise<void> {
    this.snapshot = {};
  }

  async deleteFileSubgraph(relPath: string): Promise<void> {
    delete this.snapshot[relPath];
  }

  async applyBatch(nodes: Array<{ labels: string[]; props: Record<string, unknown> }>): Promise<void> {
    for (const n of nodes) {
      if (n.labels.includes('File')) {
        const p = String(n.props.path || '');
        const sha = String(n.props.sha256 || '');
        if (p) this.snapshot[p] = sha;
      }
    }
  }

  async upsertModuleForFile(): Promise<void> { return; }
  async linkTestCasesByCalledNames(): Promise<void> { return; }
  async setIndexedNow(): Promise<void> { return; }
}

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0, dirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('indexer incremental correctness', () => {
  it('reports changed and deleted files deterministically', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-incremental-'));
    dirs.push(tmp);
    const repoRoot = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    const file = path.join(repoRoot, 'src', 'a.ts');
    fs.writeFileSync(file, 'export function run() { return 1; }\n', 'utf8');

    const repo = new FakeGraphRepo();
    const first = await indexRepo(repo as any, repoRoot, 'full');
    expect(first.changed_files).toBe(1);
    expect(first.deleted_files).toBe(0);

    fs.writeFileSync(file, 'export function run() { return 2; }\n', 'utf8');
    const second = await indexRepo(repo as any, repoRoot, 'incremental');
    expect(second.changed_files).toBe(1);
    expect(second.deleted_files).toBe(0);

    fs.rmSync(file);
    const third = await indexRepo(repo as any, repoRoot, 'incremental');
    expect(third.deleted_files).toBe(1);
    expect(third.deleted_paths).toContain('src/a.ts');
  });
});
