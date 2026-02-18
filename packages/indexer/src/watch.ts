import chokidar from 'chokidar';
import { loadConfig } from '@autopology/core';
import type { GraphRepository } from '@autopology/storage-neo4j';
import { indexRepo } from './index.js';

export interface WatchOptions {
  debounceMs?: number;
  onIndexed?: (result: unknown) => void;
}

export function startIndexWatch(repo: GraphRepository, repoRoot: string, opts: WatchOptions = {}): () => void {
  const debounceMs = Math.max(50, opts.debounceMs || 250);
  const cfg = loadConfig(repoRoot);
  let timer: NodeJS.Timeout | null = null;

  const watcher = chokidar.watch(repoRoot, {
    ignoreInitial: true,
    ignored: [
      /(^|[/\\])\.git([/\\]|$)/,
      /(^|[/\\])\.autopology([/\\]|$)/,
      /(^|[/\\])node_modules([/\\]|$)/,
    ],
    awaitWriteFinish: {
      stabilityThreshold: debounceMs,
    },
  });

  const trigger = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const result = await indexRepo(repo, repoRoot, 'incremental', cfg);
        opts.onIndexed?.(result);
      } catch {
        // swallow watcher errors; surfaced by command logs
      }
    }, debounceMs);
  };

  watcher.on('add', trigger);
  watcher.on('change', trigger);
  watcher.on('unlink', trigger);

  return () => {
    void watcher.close();
    if (timer) clearTimeout(timer);
  };
}
