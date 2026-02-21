import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../packages/core/src/index.ts';

const dirs: string[] = [];
const ENV_KEYS = ['NEO4J_URI', 'NEO4J_USER', 'NEO4J_PASSWORD', 'NEO4J_DATABASE'] as const;
const ORIGINAL_ENV = new Map(ENV_KEYS.map((k) => [k, process.env[k]]));

afterEach(() => {
  for (const d of dirs.splice(0, dirs.length)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
  for (const key of ENV_KEYS) {
    const original = ORIGINAL_ENV.get(key);
    if (original === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = original;
  }
});

describe('config environment overrides', () => {
  it('applies NEO4J_* env vars over repo config file values', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'autopology-config-'));
    dirs.push(tmp);
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.autopology'), { recursive: true });
    fs.writeFileSync(
      path.join(repo, '.autopology', 'config.yaml'),
      [
        'neo4j:',
        '  uri: bolt://127.0.0.1:9999',
        '  user: local_user',
        '  password: local_pw',
        '  database: local_db',
      ].join('\n'),
      'utf8',
    );

    process.env.NEO4J_URI = 'bolt://192.168.0.102:7687';
    process.env.NEO4J_USER = 'neo4j';
    process.env.NEO4J_PASSWORD = 'server_pw';
    process.env.NEO4J_DATABASE = 'server_db';

    const cfg = loadConfig(repo);

    expect(cfg.neo4j.uri).toBe('bolt://192.168.0.102:7687');
    expect(cfg.neo4j.user).toBe('neo4j');
    expect(cfg.neo4j.password).toBe('server_pw');
    expect(cfg.neo4j.database).toBe('server_db');
  });
});
