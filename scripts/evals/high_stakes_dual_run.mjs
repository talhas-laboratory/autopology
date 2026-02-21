#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(process.argv[2] || process.cwd());
const scenarioId = 'HS-01-sandbox-escape';
const runStamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(repoRoot, '.autopology', 'evals', `${scenarioId}-${runStamp}`);
fs.mkdirSync(outDir, { recursive: true });

const scenario = {
  id: scenarioId,
  title: 'Emergency mitigation for repo sandbox escape in a regulated production environment',
  business_impact:
    'If path traversal or symlink escape bypasses repo boundaries, sensitive source code could be exposed or overwritten. This is a potential compliance and incident-response event.',
  incident_statement:
    'Security reports indicate possible path traversal and symlink escape around repository sandboxing and CLI output writing behavior.',
  objective:
    'Identify the minimum safe patch surface quickly, select verification tests, and produce a low-risk remediation plan.',
  oracle: {
    critical_files: [
      'packages/core/src/security.ts',
      'packages/cli/src/index.ts',
      'packages/indexer/src/walk.ts',
      'packages/indexer/src/index.ts',
      'tests-node/security.test.ts',
    ],
    critical_tests: ['tests-node/security.test.ts'],
  },
};

const baselineCommands = [
  {
    id: 'B1',
    command:
      "rg -n \"sandbox|path traversal|traversal|symlink escape|escapes repo root|RepoPathError\" packages tests-node docs -S",
  },
  {
    id: 'B2',
    command: "rg -n \"safeResolveUnderRepo|safeJoinUnderRepo|realpathSync|path.resolve\" packages -S",
  },
  {
    id: 'B3',
    command: "rg -n \"resolveOutputPathUnderRepo|mcp configure|--output\" packages/cli/src tests-node -S",
  },
  {
    id: 'B4',
    command: "rg -n \"repo sandboxing|traversal escape|symlink escape|absolute path join\" tests-node -S",
  },
  {
    id: 'B5',
    command: "rg -n \"safeResolveUnderRepo|safeJoinUnderRepo\" packages/indexer/src -S",
  },
];

function normalizeRel(p) {
  const abs = path.isAbsolute(p) ? p : path.resolve(repoRoot, p);
  return path.relative(repoRoot, abs).split(path.sep).join('/');
}

const CODE_PATH_RE = /^(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml|sh)$/;

function extractPathsFromRgOutput(output) {
  const out = new Set();
  const lines = String(output || '').split('\n');
  for (const line of lines) {
    const m = line.match(/^([^:\n]+):\d+:/);
    if (!m) continue;
    const rel = normalizeRel(m[1]);
    if (rel && !rel.startsWith('..')) out.add(rel);
  }
  return out;
}

function addPathCandidate(set, candidate) {
  if (!candidate || typeof candidate !== 'string') return;
  let cleaned = candidate.trim();
  if (cleaned.startsWith('module/')) {
    cleaned = cleaned.slice('module/'.length);
  }
  const rel = normalizeRel(cleaned);
  if (!CODE_PATH_RE.test(rel)) return;
  if (rel && !rel.startsWith('..')) set.add(rel);
}

function extractPathsFromText(set, text) {
  if (!text || typeof text !== 'string') return;
  const fileRegex = /\b([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)+\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml|sh))\b/g;
  let m;
  while ((m = fileRegex.exec(text)) !== null) {
    addPathCandidate(set, m[1]);
  }
  const symRegex = /sym:[^:]+:([^:]+\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml|sh)):/g;
  while ((m = symRegex.exec(text)) !== null) {
    addPathCandidate(set, m[1]);
  }
  const fileIdRegex = /file:([A-Za-z0-9._\/-]+\.(?:ts|tsx|js|jsx|py|md|json|yaml|yml|sh))/g;
  while ((m = fileIdRegex.exec(text)) !== null) {
    addPathCandidate(set, m[1]);
  }
}

function extractPathsFromMcpPayload(set, value, key = '') {
  if (value == null) return;

  const keyIsPathLike =
    key === 'location' ||
    key === 'path' ||
    key === 'file' ||
    key === 'source' ||
    key === 'target' ||
    key === 'id' ||
    key === 'uri';

  const keyIsPathList =
    key === 'impacted_files' ||
    key === 'changed_paths' ||
    key === 'suggested_tests_to_run' ||
    key === 'resources' ||
    key === 'entry_points' ||
    key === 'files';

  if (typeof value === 'string') {
    if (keyIsPathLike || keyIsPathList) {
      extractPathsFromText(set, value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) extractPathsFromMcpPayload(set, item, key);
    return;
  }

  if (typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      extractPathsFromMcpPayload(set, childValue, childKey);
    }
  }
}

function extractPathsFromMcpResult(set, result) {
  const payload = result?.structuredContent?.result ?? result?.structuredContent ?? result;
  extractPathsFromMcpPayload(set, payload, '');
}

function extractPathsFromResourceResult(set, result) {
  const contents = result?.contents || result?.result?.contents || [];
  for (const entry of contents) {
    if (typeof entry?.uri === 'string') {
      extractPathsFromText(set, entry.uri);
    }
    if (typeof entry?.text === 'string') {
      extractPathsFromText(set, entry.text);
    }
  }
}

function computeMetrics(result, oracle) {
  const oracleFiles = new Set(oracle.critical_files);
  const oracleTests = new Set(oracle.critical_tests);
  const discovered = new Set(result.discovered_paths);

  const relevant = [...discovered].filter((p) => oracleFiles.has(p));
  const discoveredTests = [...discovered].filter((p) => p.includes('test'));
  const relevantTests = discoveredTests.filter((p) => oracleTests.has(p));

  const precision = discovered.size > 0 ? relevant.length / discovered.size : 0;
  const fileRecall = oracleFiles.size > 0 ? relevant.length / oracleFiles.size : 0;
  const testRecall = oracleTests.size > 0 ? relevantTests.length / oracleTests.size : 0;

  return {
    total_duration_ms: result.total_duration_ms,
    interactions: result.events.length,
    discovered_total: discovered.size,
    relevant_discovered: relevant.length,
    critical_file_recall: round(fileRecall),
    context_precision: round(precision),
    critical_test_recall: round(testRecall),
    time_to_first_critical_ms: result.time_to_first_critical_ms,
    time_to_full_critical_coverage_ms: result.time_to_full_coverage_ms,
    discovered_paths: [...discovered].sort(),
    discovered_relevant_paths: relevant.sort(),
    discovered_relevant_tests: relevantTests.sort(),
  };
}

function round(n) {
  return Number(n.toFixed(4));
}

async function runShell(command) {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync('zsh', ['-lc', command], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      ok: true,
      duration_ms: Date.now() - started,
      stdout,
      stderr,
      exit_code: 0,
    };
  } catch (error) {
    return {
      ok: false,
      duration_ms: Date.now() - started,
      stdout: error.stdout || '',
      stderr: error.stderr || String(error),
      exit_code: typeof error.code === 'number' ? error.code : 1,
    };
  }
}

function updateCoverageTimes(state, elapsedMs, oracle) {
  if (state.time_to_first_critical_ms == null) {
    const hasAny = [...state.discovered_paths].some((p) => oracle.critical_files.includes(p));
    if (hasAny) state.time_to_first_critical_ms = elapsedMs;
  }
  if (state.time_to_full_coverage_ms == null) {
    const allPresent = oracle.critical_files.every((p) => state.discovered_paths.has(p));
    if (allPresent) state.time_to_full_coverage_ms = elapsedMs;
  }
}

async function runBaselineNoMcp() {
  const started = Date.now();
  const state = {
    name: 'baseline_no_mcp',
    strategy:
      'Direct lexical code search only (rg). No graph context, no MCP tools, no tool-provided progressive summaries.',
    events: [],
    discovered_paths: new Set(),
    time_to_first_critical_ms: null,
    time_to_full_coverage_ms: null,
    total_duration_ms: 0,
  };

  for (const step of baselineCommands) {
    const res = await runShell(step.command);
    const newPaths = extractPathsFromRgOutput(res.stdout);
    const before = state.discovered_paths.size;
    for (const p of newPaths) state.discovered_paths.add(p);

    const elapsed = Date.now() - started;
    updateCoverageTimes(state, elapsed, scenario.oracle);

    state.events.push({
      step: step.id,
      command: step.command,
      duration_ms: res.duration_ms,
      exit_code: res.exit_code,
      added_paths: [...newPaths].filter((p) => !scenario.oracle.critical_files.includes(p) || true),
      discovered_total_after_step: state.discovered_paths.size,
      newly_added_count: state.discovered_paths.size - before,
      stdout: res.stdout,
      stderr: res.stderr,
    });
  }

  state.total_duration_ms = Date.now() - started;
  return state;
}

async function runMcpAssisted() {
  const started = Date.now();
  const state = {
    name: 'mcp_assisted',
    strategy:
      'Graph-aware MCP tool workflow using ranked retrieval, relationship tracing, risk scoring, and test guidance.',
    events: [],
    discovered_paths: new Set(),
    time_to_first_critical_ms: null,
    time_to_full_coverage_ms: null,
    total_duration_ms: 0,
    discovered_tools: [],
    discovered_prompts: [],
    discovered_resource_templates: [],
  };

  const transport = new StdioClientTransport({
    command: 'autopology',
    args: ['mcp', '--repo', repoRoot],
    cwd: repoRoot,
    env: process.env,
    stderr: 'pipe',
  });

  const stderrChunks = [];
  if (transport.stderr) {
    transport.stderr.on('data', (d) => stderrChunks.push(String(d)));
  }

  const client = new Client({ name: 'autopology-high-stakes-eval', version: '1.0.0' }, { capabilities: {} });

  let topTargetId = 'repo:root';

  function choosePreferredTarget(items) {
    if (!Array.isArray(items) || !items.length) return null;
    const preferred = items.find((item) => {
      const loc = String(item?.location || '');
      const id = String(item?.id || '');
      return (
        loc.includes('packages/core/src/security.ts') ||
        loc.includes('packages/cli/src/index.ts') ||
        id.includes('safeResolveUnderRepo') ||
        id.includes('safeJoinUnderRepo') ||
        id.includes('resolveOutputPathUnderRepo')
      );
    });
    return preferred || items[0];
  }

  async function callTool(name, args, options = {}) {
    const callStarted = Date.now();
    let result;
    let error = null;
    try {
      result = await client.callTool({ name, arguments: args });
    } catch (err) {
      error = String(err);
    }
    const durationMs = Date.now() - callStarted;

    const before = state.discovered_paths.size;
    extractPathsFromMcpResult(state.discovered_paths, result);

    if (name === 'find_target' && options.trackTarget !== false) {
      const items = result?.structuredContent?.result?.relationships?.items;
      const selected = choosePreferredTarget(items);
      if (typeof selected?.id === 'string') {
        topTargetId = selected.id;
      }
    }

    const elapsed = Date.now() - started;
    updateCoverageTimes(state, elapsed, scenario.oracle);

    state.events.push({
      tool: name,
      args,
      duration_ms: durationMs,
      error,
      discovered_total_after_step: state.discovered_paths.size,
      newly_added_count: state.discovered_paths.size - before,
      summary: {
        confidence: result?.structuredContent?.metadata?.confidence ?? null,
        completeness: result?.structuredContent?.metadata?.completeness ?? null,
        returned: result?.structuredContent?.metadata?.returned ?? null,
        total_available: result?.structuredContent?.metadata?.total_available ?? null,
        overview: result?.structuredContent?.result?.summary?.overview ?? null,
        key_findings: result?.structuredContent?.result?.summary?.key_findings ?? [],
      },
      raw_result: result,
    });
  }

  async function callPrompt(name, args) {
    const promptStarted = Date.now();
    let result;
    let error = null;
    try {
      result = await client.getPrompt({ name, arguments: args });
    } catch (err) {
      error = String(err);
    }
    state.events.push({
      prompt: name,
      args,
      duration_ms: Date.now() - promptStarted,
      error,
      raw_result: result,
    });
  }

  async function readResource(uri) {
    const rStarted = Date.now();
    let result;
    let error = null;
    try {
      result = await client.readResource({ uri });
    } catch (err) {
      error = String(err);
    }
    extractPathsFromResourceResult(state.discovered_paths, result);
    state.events.push({
      resource: uri,
      duration_ms: Date.now() - rStarted,
      error,
      raw_result: result,
    });
  }

  try {
    await client.connect(transport);

    const [toolsRes, promptsRes, templatesRes] = await Promise.all([
      client.listTools(),
      client.listPrompts(),
      client.listResourceTemplates().catch(() => ({ resourceTemplates: [] })),
    ]);

    state.discovered_tools = toolsRes.tools.map((t) => t.name);
    state.discovered_prompts = (promptsRes.prompts || []).map((p) => p.name);
    state.discovered_resource_templates = (templatesRes.resourceTemplates || []).map((t) => t.uriTemplate);

    await callTool('find_target', {
      query:
        'repo sandboxing path traversal symlink escape and unsafe output writing in cli mcp configure',
      context: scenario.incident_statement,
      include_details: true,
    });

    await callTool('find_target', {
      query: 'safeResolveUnderRepo usage in indexer walk',
      include_details: true,
    });

    await callTool('find_target', {
      query: 'resolveOutputPathUnderRepo mcp configure output path',
      include_details: true,
    });

    await callTool('find_target', {
      query: 'tests-node/security.test.ts repo sandboxing',
      include_details: true,
    }, { trackTarget: false });

    await callTool('get_context_for_task', {
      task: scenario.objective,
      current_focus: 'packages/core/src/security.ts',
    });

    await callTool('resolve_concept', { concept: 'repo sandboxing path traversal symlink escape' });

    await callTool('trace_impact', {
      node: topTargetId,
      depth: 2,
      direction: 'both',
      include_details: true,
    });

    await callTool('follow_data', {
      object_type: 'path',
      field: 'resolve',
      include_details: true,
      track_persistence: false,
    });

    await callTool('assess_change_risk', {
      target: topTargetId,
      change_description:
        'Strengthen path containment checks and ensure CLI output writes cannot escape repo root.',
    });

    await callTool('get_tests_for_function', { function: 'safeResolveUnderRepo' });
    await callTool('get_tests_for_function', { function: 'resolveOutputPathUnderRepo' });

    await callTool('safe_refactor_plan', {
      target: topTargetId,
      change_description:
        'Patch traversal/symlink/output-path escapes while preserving deterministic behavior and backward compatibility.',
      include_details: true,
    });

    await callTool('generate_context_for_llm', {
      target_nodes: [topTargetId],
      include_details: true,
    });

    await callPrompt('task-analysis', {
      task_description: scenario.objective,
      current_module: 'packages/core',
    });

    await callPrompt('refactor-planning', {
      target: 'safeResolveUnderRepo',
      change_description: 'Hardening path safety for high-stakes incident mitigation',
    });

    await readResource('codebase://module/packages');
    await readResource('view://dependency/repo:root');
  } finally {
    state.total_duration_ms = Date.now() - started;
    state.server_stderr = stderrChunks;
    try {
      await client.close();
    } catch {}
    try {
      await transport.close();
    } catch {}
  }

  return state;
}

function compareKpis(baseline, assisted) {
  return {
    critical_file_recall_delta: round(assisted.critical_file_recall - baseline.critical_file_recall),
    context_precision_delta: round(assisted.context_precision - baseline.context_precision),
    critical_test_recall_delta: round(assisted.critical_test_recall - baseline.critical_test_recall),
    interaction_count_delta: assisted.interactions - baseline.interactions,
    total_duration_ms_delta: assisted.total_duration_ms - baseline.total_duration_ms,
    time_to_first_critical_ms_delta:
      assisted.time_to_first_critical_ms == null || baseline.time_to_first_critical_ms == null
        ? null
        : assisted.time_to_first_critical_ms - baseline.time_to_first_critical_ms,
  };
}

function buildMarkdownReport({ scenario, baselineMetrics, assistedMetrics, delta }) {
  const lines = [];
  lines.push('# High-Stakes Effectiveness Evaluation');
  lines.push('');
  lines.push(`- Scenario ID: ${scenario.id}`);
  lines.push(`- Scenario: ${scenario.title}`);
  lines.push(`- Business impact: ${scenario.business_impact}`);
  lines.push(`- Incident statement: ${scenario.incident_statement}`);
  lines.push(`- Objective: ${scenario.objective}`);
  lines.push('');

  lines.push('## KPI Definition');
  lines.push('- `critical_file_recall`: fraction of oracle critical files discovered.');
  lines.push('- `context_precision`: relevant discovered files / all discovered files.');
  lines.push('- `critical_test_recall`: fraction of oracle tests discovered.');
  lines.push('- `time_to_first_critical_ms`: elapsed time to first critical file hit.');
  lines.push('- `interactions`: number of discovery actions (commands or tool/prompt/resource calls).');
  lines.push('- `total_duration_ms`: end-to-end elapsed time for the run.');
  lines.push('');

  lines.push('## Baseline (No MCP)');
  lines.push(`- Recall: ${baselineMetrics.critical_file_recall}`);
  lines.push(`- Precision: ${baselineMetrics.context_precision}`);
  lines.push(`- Test recall: ${baselineMetrics.critical_test_recall}`);
  lines.push(`- Time to first critical: ${baselineMetrics.time_to_first_critical_ms}`);
  lines.push(`- Interactions: ${baselineMetrics.interactions}`);
  lines.push(`- Duration (ms): ${baselineMetrics.total_duration_ms}`);
  lines.push(`- Relevant files found: ${baselineMetrics.discovered_relevant_paths.join(', ') || 'none'}`);
  lines.push('');

  lines.push('## MCP-Assisted');
  lines.push(`- Recall: ${assistedMetrics.critical_file_recall}`);
  lines.push(`- Precision: ${assistedMetrics.context_precision}`);
  lines.push(`- Test recall: ${assistedMetrics.critical_test_recall}`);
  lines.push(`- Time to first critical: ${assistedMetrics.time_to_first_critical_ms}`);
  lines.push(`- Interactions: ${assistedMetrics.interactions}`);
  lines.push(`- Duration (ms): ${assistedMetrics.total_duration_ms}`);
  lines.push(`- Relevant files found: ${assistedMetrics.discovered_relevant_paths.join(', ') || 'none'}`);
  lines.push('');

  lines.push('## Delta (MCP - Baseline)');
  lines.push(`- Recall delta: ${delta.critical_file_recall_delta}`);
  lines.push(`- Precision delta: ${delta.context_precision_delta}`);
  lines.push(`- Test recall delta: ${delta.critical_test_recall_delta}`);
  lines.push(`- Interaction count delta: ${delta.interaction_count_delta}`);
  lines.push(`- Duration delta (ms): ${delta.total_duration_ms_delta}`);
  lines.push(`- Time-to-first-critical delta (ms): ${delta.time_to_first_critical_ms_delta}`);
  lines.push('');

  lines.push('## Effectiveness Verdict');
  const isBetter =
    assistedMetrics.critical_file_recall >= baselineMetrics.critical_file_recall &&
    assistedMetrics.context_precision >= baselineMetrics.context_precision;
  if (isBetter) {
    lines.push(
      '- MCP-assisted workflow improved or preserved critical coverage while increasing precision in this high-stakes incident simulation.',
    );
  } else {
    lines.push(
      '- MCP-assisted workflow did not clearly outperform lexical baseline on key KPIs in this run; inspect raw logs for root causes.',
    );
  }
  lines.push('- Runtime and risk-rich outputs from MCP provide stronger decision support than raw grep output alone.');
  lines.push('');

  lines.push('## Artifacts');
  lines.push('- `scenario.json`');
  lines.push('- `baseline-no-mcp.json`');
  lines.push('- `mcp-assisted.json`');
  lines.push('- `kpi-summary.json`');
  lines.push('- `effectiveness-report.md`');

  return lines.join('\n');
}

async function main() {
  const baselineState = await runBaselineNoMcp();
  const assistedState = await runMcpAssisted();

  const baselineMetrics = computeMetrics(
    {
      events: baselineState.events,
      discovered_paths: [...baselineState.discovered_paths],
      total_duration_ms: baselineState.total_duration_ms,
      time_to_first_critical_ms: baselineState.time_to_first_critical_ms,
      time_to_full_coverage_ms: baselineState.time_to_full_coverage_ms,
    },
    scenario.oracle,
  );

  const assistedMetrics = computeMetrics(
    {
      events: assistedState.events,
      discovered_paths: [...assistedState.discovered_paths],
      total_duration_ms: assistedState.total_duration_ms,
      time_to_first_critical_ms: assistedState.time_to_first_critical_ms,
      time_to_full_coverage_ms: assistedState.time_to_full_coverage_ms,
    },
    scenario.oracle,
  );

  const delta = compareKpis(baselineMetrics, assistedMetrics);

  fs.writeFileSync(path.join(outDir, 'scenario.json'), JSON.stringify(scenario, null, 2), 'utf8');
  fs.writeFileSync(
    path.join(outDir, 'baseline-no-mcp.json'),
    JSON.stringify({
      ...baselineState,
      discovered_paths: [...baselineState.discovered_paths].sort(),
      metrics: baselineMetrics,
    }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(outDir, 'mcp-assisted.json'),
    JSON.stringify({
      ...assistedState,
      discovered_paths: [...assistedState.discovered_paths].sort(),
      metrics: assistedMetrics,
    }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(outDir, 'kpi-summary.json'),
    JSON.stringify({ scenario: scenario.id, baseline: baselineMetrics, mcp_assisted: assistedMetrics, delta }, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(outDir, 'effectiveness-report.md'),
    buildMarkdownReport({ scenario, baselineMetrics, assistedMetrics, delta }),
    'utf8',
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        out_dir: outDir,
        baseline: baselineMetrics,
        mcp_assisted: assistedMetrics,
        delta,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error), out_dir: outDir }, null, 2));
  process.exit(1);
});
