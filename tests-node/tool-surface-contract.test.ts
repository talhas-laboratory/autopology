import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const CORE_TOOLS = [
  'find_target',
  'find_file_exact',
  'get_module_boundary',
  'trace_impact',
  'follow_data',
  'assess_change_risk',
  'resolve_concept',
  'get_tests_for_function',
  'find_tests_by_path',
  'get_context_for_task',
];

const STREAM_TOOLS = [
  'understand_codebase',
  'execution_reality',
  'safe_refactor_plan',
  'generate_context_for_llm',
  'query_execution_trace',
];

describe('mcp tool surface contract', () => {
  it('exposes core + stream tool sets', () => {
    const serverPath = path.resolve(process.cwd(), 'packages/mcp-server/src/server.ts');
    const src = fs.readFileSync(serverPath, 'utf8');
    const matches = [...src.matchAll(/server\.registerTool\(\s*'([^']+)'/g)];
    const found = matches.map((m) => m[1]);

    for (const name of [...CORE_TOOLS, ...STREAM_TOOLS]) {
      expect(found.includes(name)).toBe(true);
    }
    expect(found.length).toBe(15);
  });
});
