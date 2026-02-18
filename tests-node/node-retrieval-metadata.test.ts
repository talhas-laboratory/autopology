import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { indexRepo } from '../packages/indexer/src/index.ts';

class CaptureRepo {
  snapshot: Record<string, string> = {};
  batches: Array<Array<{ labels: string[]; props: Record<string, unknown> }>> = [];

  async getFileSnapshot(): Promise<Record<string, string>> {
    return { ...this.snapshot };
  }

  async clearGraph(): Promise<void> {
    this.snapshot = {};
    this.batches = [];
  }

  async deleteFileSubgraph(relPath: string): Promise<void> {
    delete this.snapshot[relPath];
  }

  async applyBatch(nodes: Array<{ labels: string[]; props: Record<string, unknown> }>): Promise<void> {
    this.batches.push(nodes);
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

describe('node retrieval metadata', () => {
  it('stores estimated_tokens and priority_score on indexed nodes', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-node-meta-'));
    dirs.push(tmp);
    const repoRoot = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, 'src', 'a.ts'),
      ['export function run(order: any) {', '  order.total = 1;', '  return order.total;', '}', ''].join('\n'),
      'utf8',
    );

    const repo = new CaptureRepo();
    await indexRepo(repo as any, repoRoot, 'full');

    const nodes = repo.batches.flat();
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) {
      expect(typeof node.props.estimated_tokens).toBe('number');
      expect((node.props.estimated_tokens as number)).toBeGreaterThan(0);
      expect(typeof node.props.priority_score).toBe('number');
      expect((node.props.priority_score as number)).toBeGreaterThanOrEqual(0);
      expect((node.props.priority_score as number)).toBeLessThanOrEqual(1);
    }
  });
});
