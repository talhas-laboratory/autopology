import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RepoPathError, safeJoinUnderRepo, safeResolveUnderRepo } from '../packages/core/src/index.ts';

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0, dirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe('repo sandboxing', () => {
  it('rejects absolute path join', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-'));
    dirs.push(tmp);
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    expect(() => safeJoinUnderRepo(repo, '/etc/passwd')).toThrow(RepoPathError);
  });

  it('rejects traversal escape', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-'));
    dirs.push(tmp);
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    const outside = path.join(tmp, 'outside.txt');
    fs.writeFileSync(outside, 'secret', 'utf8');
    expect(() => safeJoinUnderRepo(repo, '../outside.txt')).toThrow(RepoPathError);
  });

  it('rejects symlink escape', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-'));
    dirs.push(tmp);
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);

    const outside = path.join(tmp, 'outside.txt');
    fs.writeFileSync(outside, 'secret', 'utf8');
    const link = path.join(repo, 'link.txt');
    fs.symlinkSync(outside, link);

    expect(() => safeResolveUnderRepo(repo, link)).toThrow(RepoPathError);
  });
});
