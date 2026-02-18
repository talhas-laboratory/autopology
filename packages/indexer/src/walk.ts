import fs from 'node:fs';
import path from 'node:path';
import { safeResolveUnderRepo } from '@autopology/core';

const DEFAULT_IGNORE_DIRS = new Set([
  '.git',
  '.autopology',
  'node_modules',
  '.venv',
  'venv',
  'dist',
  'build',
  '__pycache__',
]);

export interface WalkConfig {
  maxFileBytes: number;
  followSymlinks: boolean;
}

function readGitIgnore(repoRoot: string): string[] {
  const p = path.join(repoRoot, '.gitignore');
  if (!fs.existsSync(p)) return [];
  return fs
    .readFileSync(p, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function ignoredByGitignore(relPath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern.endsWith('/')) {
      const dir = pattern.slice(0, -1);
      if (relPath === dir || relPath.startsWith(`${dir}/`)) {
        return true;
      }
      continue;
    }
    if (pattern.startsWith('*')) {
      const suffix = pattern.slice(1);
      if (relPath.endsWith(suffix)) {
        return true;
      }
      continue;
    }
    if (relPath === pattern || relPath.startsWith(`${pattern}/`)) {
      return true;
    }
  }
  return false;
}

export function iterRepoFiles(repoRoot: string, cfg: WalkConfig, exts: Set<string>): string[] {
  const out: string[] = [];
  const ignorePatterns = [...readGitIgnore(repoRoot), '.autopology/', '.autopology/**'];

  function walkDir(absDir: string): void {
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const absPath = path.join(absDir, entry.name);
      const relPath = path.relative(repoRoot, absPath).split(path.sep).join('/');

      if (ignoredByGitignore(relPath, ignorePatterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (DEFAULT_IGNORE_DIRS.has(entry.name)) {
          continue;
        }
        walkDir(absPath);
        continue;
      }

      if (entry.isSymbolicLink() && !cfg.followSymlinks) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      if (!exts.has(ext)) {
        continue;
      }

      let st: fs.Stats;
      try {
        const safePath = safeResolveUnderRepo(repoRoot, absPath);
        st = fs.statSync(safePath);
      } catch {
        continue;
      }

      if (st.size > cfg.maxFileBytes) {
        continue;
      }

      out.push(relPath);
    }
  }

  walkDir(repoRoot);
  out.sort();
  return out;
}
