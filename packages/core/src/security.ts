import path from 'node:path';
import fs from 'node:fs';

export class RepoPathError extends Error {}

export function safeResolveUnderRepo(repoRoot: string, candidate: string): string {
  const rootReal = fs.realpathSync(path.resolve(repoRoot));
  const resolved = fs.realpathSync(path.resolve(candidate));

  if (!resolved.startsWith(rootReal + path.sep) && resolved !== rootReal) {
    throw new RepoPathError(`path escapes repo root: ${candidate} -> ${resolved}`);
  }

  return resolved;
}

export function safeJoinUnderRepo(repoRoot: string, relPath: string): string {
  if (path.isAbsolute(relPath)) {
    throw new RepoPathError(`absolute path not allowed: ${relPath}`);
  }
  const joined = path.resolve(repoRoot, relPath);
  return safeResolveUnderRepo(repoRoot, joined);
}
