import fs from 'node:fs';
import path from 'node:path';
import type { CacheEntry } from '../types.js';

interface ColdFile {
  version: number;
  entries: Record<string, CacheEntry>;
}

export class ColdCache {
  private readonly filePath: string;

  constructor(repoRoot: string) {
    this.filePath = path.join(repoRoot, '.autopology', 'cache', 'cold-cache.json');
  }

  private readStore(): ColdFile {
    if (!fs.existsSync(this.filePath)) {
      return { version: 1, entries: {} };
    }
    try {
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as ColdFile;
    } catch {
      return { version: 1, entries: {} };
    }
  }

  private writeStore(data: ColdFile): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data), 'utf8');
  }

  get<T>(key: string, freshnessStamp: string): T | null {
    const file = this.readStore();
    const entry = file.entries[key];
    if (!entry) return null;
    const now = Date.now();
    if (entry.freshnessStamp !== freshnessStamp || now > entry.storedAt + entry.ttlMs) {
      delete file.entries[key];
      this.writeStore(file);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, freshnessStamp: string, value: T, ttlMs: number, nodeIds: string[] = []): void {
    const file = this.readStore();
    file.entries[key] = {
      key,
      value,
      freshnessStamp,
      storedAt: Date.now(),
      ttlMs,
      nodeIds,
    };
    this.writeStore(file);
  }

  invalidateByNodes(nodeIds: string[]): void {
    if (!nodeIds.length) return;
    const file = this.readStore();
    const touched = new Set(nodeIds);
    let changed = false;
    for (const [key, entry] of Object.entries(file.entries)) {
      const entryNodes = entry.nodeIds || [];
      if (entryNodes.some((id) => touched.has(id))) {
        delete file.entries[key];
        changed = true;
      }
    }
    if (changed) {
      this.writeStore(file);
    }
  }
}
