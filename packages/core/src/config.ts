import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
  database: string;
}

export interface IndexConfig {
  maxFileBytes: number;
  followSymlinks: boolean;
}

export interface CacheConfig {
  hotTtlMs: number;
  warmTtlMs: number;
  coldTtlMs: number;
}

export interface RuntimeConfig {
  enableExecutionHooks: boolean;
}

export interface AutopologyConfig {
  neo4j: Neo4jConfig;
  index: IndexConfig;
  cache: CacheConfig;
  runtime: RuntimeConfig;
}

export const DEFAULT_CONFIG: AutopologyConfig = {
  neo4j: {
    uri: process.env.NEO4J_URI || 'bolt://127.0.0.1:7687',
    user: process.env.NEO4J_USER || 'neo4j',
    password: process.env.NEO4J_PASSWORD || 'neo4j',
    database: process.env.NEO4J_DATABASE || 'neo4j',
  },
  index: {
    maxFileBytes: 2_000_000,
    followSymlinks: false,
  },
  cache: {
    hotTtlMs: 30_000,
    warmTtlMs: 5 * 60_000,
    coldTtlMs: 60 * 60_000,
  },
  runtime: {
    enableExecutionHooks: false,
  },
};

export function configPath(repoRoot: string): string {
  return path.join(repoRoot, '.autopology', 'config.yaml');
}

export function loadConfig(repoRoot: string): AutopologyConfig {
  const p = configPath(repoRoot);
  if (!fs.existsSync(p)) {
    return DEFAULT_CONFIG;
  }
  const raw = fs.readFileSync(p, 'utf8');
  const parsed = YAML.parse(raw) as Partial<AutopologyConfig>;
  return {
    neo4j: { ...DEFAULT_CONFIG.neo4j, ...(parsed.neo4j || {}) },
    index: { ...DEFAULT_CONFIG.index, ...(parsed.index || {}) },
    cache: { ...DEFAULT_CONFIG.cache, ...(parsed.cache || {}) },
    runtime: { ...DEFAULT_CONFIG.runtime, ...(parsed.runtime || {}) },
  };
}

export function writeDefaultConfig(repoRoot: string): void {
  const p = configPath(repoRoot);
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, YAML.stringify(DEFAULT_CONFIG), 'utf8');
  }
}
