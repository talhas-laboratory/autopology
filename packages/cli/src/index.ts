#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { Command } from 'commander';
import {
  loadConfig,
  writeDefaultConfig,
} from '@autopology/core';
import { indexRepo, startIndexWatch } from '@autopology/indexer';
import { runMcpServer } from '@autopology/mcp-server';
import {
  closeNeo4j,
  createNeo4jContext,
  GraphRepository,
  initSchema,
  Neo4jWarmCache,
  verifyConnection,
} from '@autopology/storage-neo4j';
import { RuntimeHookService } from '@autopology/runtime-hooks';
import { buildMcpConfigSnippet, MCP_CLIENTS, parseMcpClient } from './mcp-config.js';

type IndexMode = 'full' | 'incremental';

interface DoctorReport {
  ok: boolean;
  checks: Array<Record<string, unknown>>;
}

function resolveRepoRoot(repo?: string): string {
  const root = path.resolve(repo || process.cwd());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`repo root not found: ${root}`);
  }
  return root;
}

function ensureGitignore(repoRoot: string): void {
  const p = path.join(repoRoot, '.gitignore');
  const entry = '.autopology/';
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, `${entry}\n`, 'utf8');
    return;
  }
  const existing = fs.readFileSync(p, 'utf8').split('\n').map((x) => x.trim());
  if (!existing.includes(entry)) {
    fs.appendFileSync(p, `\n${entry}\n`, 'utf8');
  }
}

function resolveIndexMode(
  opts: { full?: boolean; incremental?: boolean },
  defaultMode: IndexMode,
): IndexMode {
  if (opts.full && opts.incremental) {
    throw new Error('use either --full or --incremental, not both');
  }
  if (opts.full) return 'full';
  if (opts.incremental) return 'incremental';
  return defaultMode;
}

function diagnoseNeo4jError(error: unknown): { code: string; suggestion: string } {
  const text = String(error).toLowerCase();
  if (text.includes('econnrefused') || text.includes('connection refused') || text.includes('verify connectivity')) {
    return {
      code: 'NEO4J_UNREACHABLE',
      suggestion: 'Start Neo4j and confirm NEO4J_URI points to a reachable bolt endpoint.',
    };
  }
  if (
    text.includes('unauthorized') ||
    text.includes('authentication') ||
    text.includes('security.unauthorized') ||
    text.includes('credentials')
  ) {
    return {
      code: 'NEO4J_AUTH_FAILED',
      suggestion: 'Check NEO4J_USER / NEO4J_PASSWORD and update .autopology/config.yaml if needed.',
    };
  }
  if (text.includes('database') && text.includes('not found')) {
    return {
      code: 'NEO4J_DATABASE_NOT_FOUND',
      suggestion: 'Set NEO4J_DATABASE to an existing database (typically "neo4j").',
    };
  }
  return {
    code: 'NEO4J_UNKNOWN',
    suggestion: 'Run `autopology doctor --repo <path>` after confirming Neo4j config values.',
  };
}

function resolveOutputPathUnderRepo(repoRoot: string, outputPath: string): string {
  const absolute = path.resolve(outputPath);
  const parent = path.dirname(absolute);
  fs.mkdirSync(parent, { recursive: true });
  const rootReal = fs.realpathSync(repoRoot);
  const parentReal = fs.realpathSync(parent);
  if (parentReal !== rootReal && !parentReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`output path must stay inside repo root: ${absolute}`);
  }
  return absolute;
}

async function withRepo<T>(repoRoot: string, fn: (repo: GraphRepository) => Promise<T>): Promise<T> {
  const cfg = loadConfig(repoRoot);
  const ctx = createNeo4jContext(cfg.neo4j);
  try {
    await initSchema(ctx, repoRoot);
    const repo = new GraphRepository(ctx);
    return await fn(repo);
  } finally {
    await closeNeo4j(ctx);
  }
}

async function invalidateWarmCache(repo: GraphRepository, result: unknown): Promise<void> {
  if (!result || typeof result !== 'object') return;
  const impacted = (result as Record<string, unknown>).impacted_node_ids;
  if (!Array.isArray(impacted) || impacted.length === 0) return;
  const nodeIds = impacted.filter((x): x is string => typeof x === 'string');
  if (!nodeIds.length) return;
  const warm = new Neo4jWarmCache(repo.ctx);
  await warm.invalidateByNodes(nodeIds);
}

async function runIndex(repoRoot: string, mode: IndexMode): Promise<unknown> {
  const cfg = loadConfig(repoRoot);
  return withRepo(repoRoot, async (repo) => {
    const result = await indexRepo(repo, repoRoot, mode, cfg);
    await invalidateWarmCache(repo, result);
    return result;
  });
}

async function runDoctorChecks(repoRoot: string): Promise<DoctorReport> {
  const cfg = loadConfig(repoRoot);
  const ctx = createNeo4jContext(cfg.neo4j);
  const checks: Array<Record<string, unknown>> = [];
  try {
    await verifyConnection(ctx);
    checks.push({ check: 'neo4j_connectivity', ok: true });

    await initSchema(ctx, repoRoot);
    checks.push({ check: 'schema_init', ok: true });

    const repo = new GraphRepository(ctx);
    const meta = await repo.getMeta();
    checks.push({ check: 'schema_version', ok: meta.schemaVersion >= 4, schema_version: meta.schemaVersion });
    const counts = await repo.getCounts();
    checks.push({ check: 'graph_counts', ok: true, counts });

    const cacheDir = path.join(repoRoot, '.autopology', 'cache');
    fs.mkdirSync(cacheDir, { recursive: true });
    const probePath = path.join(cacheDir, '.doctor-write-probe');
    fs.writeFileSync(probePath, 'ok', 'utf8');
    fs.rmSync(probePath, { force: true });
    checks.push({ check: 'cache_writable', ok: true, path: cacheDir });

    const watcherProbe = (() => {
      try {
        const watcher = fs.watch(repoRoot, () => {
          // no-op
        });
        watcher.close();
        return true;
      } catch {
        return false;
      }
    })();
    checks.push({ check: 'watcher_probe', ok: watcherProbe });

    const sane =
      !!cfg.neo4j.uri &&
      !!cfg.neo4j.user &&
      !!cfg.neo4j.password &&
      !!cfg.neo4j.database &&
      cfg.cache.hotTtlMs > 0 &&
      cfg.cache.warmTtlMs > 0 &&
      cfg.cache.coldTtlMs > 0;
    checks.push({ check: 'config_sanity', ok: sane });

    return {
      ok: checks.every((check) => check.ok !== false),
      checks,
    };
  } catch (error) {
    const diagnosis = diagnoseNeo4jError(error);
    checks.push({
      check: 'doctor',
      ok: false,
      error: String(error),
      code: diagnosis.code,
      suggestion: diagnosis.suggestion,
    });
    return { ok: false, checks };
  } finally {
    await closeNeo4j(ctx);
  }
}

function toMermaid(node: string, impact: { upstream: Array<Record<string, unknown>>; downstream: Array<Record<string, unknown>> }): string {
  const lines = ['graph TD'];
  const root = `N_${safeNode(node)}`;
  lines.push(`  ${root}["${escapeMermaid(node)}"]`);
  for (const up of impact.upstream) {
    const id = String(up.id || up.node || 'unknown');
    const ref = `N_${safeNode(id)}`;
    lines.push(`  ${ref}["${escapeMermaid(String(up.node || id))}"] --> ${root}`);
  }
  for (const down of impact.downstream) {
    const id = String(down.id || down.node || 'unknown');
    const ref = `N_${safeNode(id)}`;
    lines.push(`  ${root} --> ${ref}["${escapeMermaid(String(down.node || id))}"]`);
  }
  return lines.join('\n');
}

function safeNode(input: string): string {
  return input.replace(/[^A-Za-z0-9_]/g, '_');
}

function escapeMermaid(input: string): string {
  return input.replace(/"/g, "'");
}

const program = new Command();
program.name('autopology').description('AuTopology v1 (Node + Neo4j)').version('1.0.0');

program
  .command('init')
  .option('--repo <path>', 'repo root')
  .description('Initialize .autopology config and gitignore')
  .action(async (opts: { repo?: string }) => {
    const repoRoot = resolveRepoRoot(opts.repo);
    fs.mkdirSync(path.join(repoRoot, '.autopology'), { recursive: true });
    writeDefaultConfig(repoRoot);
    ensureGitignore(repoRoot);
    console.log(`Initialized AuTopology in ${repoRoot}`);
  });

program
  .command('setup')
  .option('--repo <path>', 'repo root')
  .option('--full', 'full reindex during setup', false)
  .option('--incremental', 'incremental index during setup', false)
  .description('Initialize repo, run doctor checks, and create graph data')
  .action(async (opts: { repo?: string; full?: boolean; incremental?: boolean }) => {
    const mode = resolveIndexMode(opts, 'full');
    const repoRoot = resolveRepoRoot(opts.repo);

    fs.mkdirSync(path.join(repoRoot, '.autopology'), { recursive: true });
    writeDefaultConfig(repoRoot);
    ensureGitignore(repoRoot);

    const doctor = await runDoctorChecks(repoRoot);
    if (!doctor.ok) {
      console.log(JSON.stringify({ ok: false, phase: 'doctor', repo_root: repoRoot, doctor }, null, 2));
      process.exitCode = 1;
      return;
    }

    try {
      const result = await runIndex(repoRoot, mode);
      console.log(
        JSON.stringify(
          {
            ok: true,
            phase: 'index',
            repo_root: repoRoot,
            mode,
            doctor,
            index: result,
          },
          null,
          2,
        ),
      );
    } catch (error) {
      const diagnosis = diagnoseNeo4jError(error);
      console.log(
        JSON.stringify(
          {
            ok: false,
            phase: 'index',
            repo_root: repoRoot,
            mode,
            error: String(error),
            code: diagnosis.code,
            suggestion: diagnosis.suggestion,
          },
          null,
          2,
        ),
      );
      process.exitCode = 1;
    }
  });

program
  .command('index')
  .option('--repo <path>', 'repo root')
  .option('--full', 'full reindex', false)
  .option('--incremental', 'incremental index (default)', false)
  .description('Index repository into Neo4j graph')
  .action(async (opts: { repo?: string; full?: boolean; incremental?: boolean }) => {
    const mode = resolveIndexMode(opts, 'incremental');
    const repoRoot = resolveRepoRoot(opts.repo);
    const result = await runIndex(repoRoot, mode);
    console.log(JSON.stringify(result, null, 2));
  });

const graph = program.command('graph').description('Graph lifecycle commands');

graph
  .command('create')
  .option('--repo <path>', 'repo root')
  .option('--full', 'full reindex', false)
  .option('--incremental', 'incremental index', false)
  .description('Create or refresh graph data for a repository')
  .action(async (opts: { repo?: string; full?: boolean; incremental?: boolean }) => {
    const mode = resolveIndexMode(opts, 'incremental');
    const repoRoot = resolveRepoRoot(opts.repo);
    const result = await runIndex(repoRoot, mode);
    console.log(JSON.stringify({ ok: true, repo_root: repoRoot, mode, result }, null, 2));
  });

program
  .command('watch')
  .option('--repo <path>', 'repo root')
  .option('--debounce-ms <n>', 'debounce window ms', '250')
  .description('Watch and run incremental indexing')
  .action(async (opts: { repo?: string; debounceMs?: string }) => {
    const repoRoot = resolveRepoRoot(opts.repo);
    await withRepo(repoRoot, async (repo) => {
      console.error(`Watching ${repoRoot}...`);
      const stop = startIndexWatch(repo, repoRoot, {
        debounceMs: Number(opts.debounceMs || 250),
        onIndexed: async (result: unknown) => {
          await invalidateWarmCache(repo, result);
          console.error(JSON.stringify(result));
        },
      });
      process.on('SIGINT', () => {
        stop();
        process.exit(0);
      });
      await new Promise(() => {
        // keep process alive
      });
    });
  });

const mcp = program
  .command('mcp')
  .option('--repo <path>', 'repo root')
  .description('Run MCP stdio server')
  .action(async (opts: { repo?: string }) => {
    const repoRoot = resolveRepoRoot(opts.repo);
    await runMcpServer(repoRoot);
  });

mcp
  .command('configure')
  .requiredOption('--client <name>', `target MCP client (${MCP_CLIENTS.join('|')})`)
  .option('--repo <path>', 'repo root')
  .option('--output <path>', 'write generated config snippet to a file under repo root')
  .description('Generate MCP client configuration snippets')
  .action(
    async (opts: { client: string; repo?: string; output?: string }) => {
      const repoRoot = resolveRepoRoot(opts.repo);
      const client = parseMcpClient(opts.client);
      const snippet = buildMcpConfigSnippet(client, repoRoot);
      if (!opts.output) {
        console.log(snippet);
        return;
      }

      const outputPath = resolveOutputPathUnderRepo(repoRoot, opts.output);
      fs.writeFileSync(outputPath, `${snippet}\n`, 'utf8');
      console.log(JSON.stringify({ ok: true, client, output: outputPath }, null, 2));
    },
  );

program
  .command('doctor')
  .option('--repo <path>', 'repo root')
  .description('Check Neo4j connectivity and schema readiness')
  .action(async (opts: { repo?: string }) => {
    const repoRoot = resolveRepoRoot(opts.repo);
    const report = await runDoctorChecks(repoRoot);
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) {
      process.exitCode = 1;
    }
  });

program
  .command('viz')
  .option('--repo <path>', 'repo root')
  .option('--node <id>', 'node id', 'repo:root')
  .option('--depth <n>', 'depth', '2')
  .option('--lens <name>', 'lens: dependency|data-flow|runtime', 'dependency')
  .option('--format <fmt>', 'json|mermaid', 'json')
  .description('Read-only graph view export')
  .action(async (opts: { repo?: string; node?: string; depth?: string; lens?: string; format?: string }) => {
    const repoRoot = resolveRepoRoot(opts.repo);
    const node = String(opts.node || 'repo:root');
    const depth = Math.max(1, Number(opts.depth || 2));
    const lens = String(opts.lens || 'dependency');
    const format = String(opts.format || 'json');
    const result = await withRepo(repoRoot, async (repo) => {
      if (lens === 'dependency') {
        return await repo.traceImpact(node, depth, 'both');
      }
      return await repo.getViewResource(lens, node);
    });
    if (format === 'mermaid') {
      if (lens !== 'dependency') {
        throw new Error('mermaid format currently supports dependency lens only');
      }
      const impact = result as { upstream: Array<Record<string, unknown>>; downstream: Array<Record<string, unknown>> };
      console.log(toMermaid(node, impact));
      return;
    }
    console.log(JSON.stringify(result, null, 2));
  });

program
  .command('ingest-runtime')
  .requiredOption('--caller <id>', 'caller node id')
  .requiredOption('--callee <id>', 'callee node id')
  .requiredOption('--duration-ms <n>', 'duration ms')
  .option('--ok', 'mark call as successful', false)
  .option('--repo <path>', 'repo root')
  .description('Ingest v2-lite runtime span aggregate')
  .action(async (opts: { caller: string; callee: string; durationMs: string; ok?: boolean; repo?: string }) => {
    const repoRoot = resolveRepoRoot(opts.repo);
    const cfg = loadConfig(repoRoot);
    const ctx = createNeo4jContext(cfg.neo4j);
    try {
      await initSchema(ctx, repoRoot);
      const runtime = new RuntimeHookService(ctx);
      await runtime.ingestSpan({
        callerId: opts.caller,
        calleeId: opts.callee,
        durationMs: Number(opts.durationMs),
        ok: !!opts.ok,
        timestamp: new Date().toISOString(),
      });
      const warm = new Neo4jWarmCache(ctx);
      await warm.invalidateByNodes([opts.caller, opts.callee]);
      console.log(JSON.stringify({ ok: true }, null, 2));
    } finally {
      await closeNeo4j(ctx);
    }
  });

program.parseAsync(process.argv).catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
  process.exit(1);
});
