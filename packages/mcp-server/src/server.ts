import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { loadConfig } from '@autopology/core';
import { createNeo4jContext, GraphRepository, initSchema } from '@autopology/storage-neo4j';
import { ToolService } from './service.js';

function toolResult(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
    structuredContent: payload as Record<string, unknown>,
  };
}

export async function createMcpApp(repoRoot: string) {
  const cfg = loadConfig(repoRoot);
  const neo4j = createNeo4jContext(cfg.neo4j);
  await initSchema(neo4j, repoRoot);

  const repo = new GraphRepository(neo4j);
  const tools = new ToolService(repo, cfg, repoRoot);
  void tools.warmUp().catch(() => {
    // Warm-up is best-effort and must never block server startup.
  });

  const server = new McpServer({ name: 'autopology', version: '1.0.0' });

  const moduleTemplate = new ResourceTemplate('codebase://module/{name}', { list: undefined });
  server.registerResource(
    'codebase-module',
    moduleTemplate,
    {
      title: 'Module Resource',
      description: 'Codebase module summary resource',
      mimeType: 'application/json',
    },
    async (_uri, vars) => {
      const name = String(vars.name || '');
      const data = await repo.getModuleResource(name);
      return {
        contents: [
          {
            uri: `codebase://module/${name}`,
            text: JSON.stringify(data || { error: 'not_found' }),
          },
        ],
      };
    },
  );

  const conceptTemplate = new ResourceTemplate('concept://{name}', { list: undefined });
  server.registerResource(
    'concept-resource',
    conceptTemplate,
    {
      title: 'Concept Resource',
      description: 'Concept mapping resource',
      mimeType: 'application/json',
    },
    async (_uri, vars) => {
      const name = String(vars.name || '');
      const data = await repo.getConceptResource(name);
      return {
        contents: [
          {
            uri: `concept://${name}`,
            text: JSON.stringify(data),
          },
        ],
      };
    },
  );

  const viewTemplate = new ResourceTemplate('view://{lens}/{target}', { list: undefined });
  server.registerResource(
    'view-resource',
    viewTemplate,
    {
      title: 'Lens View Resource',
      description: 'Dependency/data-flow view over target node',
      mimeType: 'application/json',
    },
    async (_uri, vars) => {
      const lens = String(vars.lens || 'dependency');
      const target = String(vars.target || '');
      const data = await repo.getViewResource(lens, target);
      return {
        contents: [
          {
            uri: `view://${lens}/${target}`,
            text: JSON.stringify(data),
          },
        ],
      };
    },
  );

  server.registerTool(
    'find_target',
    {
      description: 'Locate code by natural language description',
      inputSchema: {
        query: z.string(),
        context: z.string().optional(),
        include_details: z.boolean().optional(),
      },
    },
    async ({ query, context, include_details }) => toolResult(await tools.findTarget(query, context, include_details)),
  );

  server.registerTool(
    'find_file_exact',
    {
      description: 'Resolve exact file path to deterministic graph node',
      inputSchema: {
        path: z.string(),
        include_details: z.boolean().optional(),
      },
    },
    async ({ path, include_details }) => toolResult(await tools.findFileExact(path, include_details)),
  );

  server.registerTool(
    'get_module_boundary',
    {
      description: 'Get module interface and scope',
      inputSchema: {
        module: z.string(),
        depth: z.number().int().min(1).max(3).default(1),
        include_details: z.boolean().optional(),
      },
    },
    async ({ module, depth, include_details }) => toolResult(await tools.getModuleBoundary(module, depth, include_details)),
  );

  server.registerTool(
    'trace_impact',
    {
      description: 'Trace dependencies and change impact',
      inputSchema: {
        node: z.string(),
        depth: z.number().int().min(1).max(3).default(2),
        direction: z.enum(['upstream', 'downstream', 'both']).default('both'),
        include_details: z.boolean().optional(),
      },
    },
    async ({ node, depth, direction, include_details }) =>
      toolResult(await tools.traceImpact(node, depth, direction, include_details)),
  );

  server.registerTool(
    'follow_data',
    {
      description: 'Trace data transformation through system',
      inputSchema: {
        object_type: z.string(),
        field: z.string().optional(),
        instance_id: z.string().optional(),
        track_persistence: z.boolean().optional(),
        include_details: z.boolean().optional(),
      },
    },
    async ({ object_type, field, instance_id, track_persistence, include_details }) =>
      toolResult(await tools.followData(object_type, field, include_details, instance_id, track_persistence)),
  );

  server.registerTool(
    'assess_change_risk',
    {
      description: 'Quantify risk of proposed change',
      inputSchema: {
        target: z.string(),
        change_description: z.string(),
      },
    },
    async ({ target, change_description }) =>
      toolResult(await tools.assessChangeRisk(target, change_description)),
  );

  server.registerTool(
    'resolve_concept',
    {
      description: 'Find implementations of domain concept',
      inputSchema: {
        concept: z.string(),
      },
    },
    async ({ concept }) => toolResult(await tools.resolveConcept(concept)),
  );

  server.registerTool(
    'get_tests_for_function',
    {
      description: 'Find all tests exercising a function',
      inputSchema: {
        function: z.string(),
      },
    },
    async ({ function: fn }) => toolResult(await tools.getTestsForFunction(fn)),
  );

  server.registerTool(
    'find_tests_by_path',
    {
      description: 'Find tests covering a concrete source file path',
      inputSchema: {
        path: z.string(),
        include_details: z.boolean().optional(),
      },
    },
    async ({ path, include_details }) => toolResult(await tools.findTestsByPath(path, include_details)),
  );

  server.registerTool(
    'get_context_for_task',
    {
      description: 'Bundle relevant context for specific task',
      inputSchema: {
        task: z.string(),
        current_focus: z.string().optional(),
      },
    },
    async ({ task, current_focus }) => toolResult(await tools.getContextForTask(task, current_focus)),
  );

  server.registerTool(
    'understand_codebase',
    {
      description: 'Initial orientation over architecture, concepts, and entry points',
      inputSchema: {
        include_details: z.boolean().optional(),
      },
    },
    async ({ include_details }) => toolResult(await tools.understandCodebase(include_details)),
  );

  server.registerTool(
    'execution_reality',
    {
      description: 'Runtime behavior and hotspots for a function or global scope',
      inputSchema: {
        function_name: z.string(),
        lookback: z.string().default('30min'),
        include_details: z.boolean().optional(),
      },
    },
    async ({ function_name, lookback, include_details }) =>
      toolResult(await tools.executionReality(function_name, lookback, include_details)),
  );

  server.registerTool(
    'safe_refactor_plan',
    {
      description: 'Generate bounded refactor sequence with risks and verification steps',
      inputSchema: {
        target: z.string(),
        change_description: z.string(),
        include_details: z.boolean().optional(),
      },
    },
    async ({ target, change_description, include_details }) =>
      toolResult(await tools.safeRefactorPlan(target, change_description, include_details)),
  );

  server.registerTool(
    'generate_context_for_llm',
    {
      description: 'Produce compact, decision-useful context bundle for one or more targets',
      inputSchema: {
        target_nodes: z.array(z.string()).min(1),
        include_details: z.boolean().optional(),
      },
    },
    async ({ target_nodes, include_details }) =>
      toolResult(await tools.generateContextForLlm(target_nodes, include_details)),
  );

  server.registerTool(
    'query_execution_trace',
    {
      description: 'Query runtime error traces by identifier or stack signature fragment',
      inputSchema: {
        error_id: z.string(),
        lookback: z.string().default('24hour'),
        include_details: z.boolean().optional(),
      },
    },
    async ({ error_id, lookback, include_details }) =>
      toolResult(await tools.queryExecutionTrace(error_id, lookback, include_details)),
  );

  server.registerPrompt(
    'task-analysis',
    {
      description: 'Plan a context-efficient task investigation flow under 4k tokens.',
      argsSchema: {
        task_description: z.string(),
        current_module: z.string().optional(),
      },
    },
    async ({ task_description, current_module }) => ({
      description: 'Task analysis workflow prompt',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Analyze task: ${task_description}`,
              `Current focus: ${current_module || 'none provided'}`,
              '',
              '⚠️ Context Budget: ~4000 tokens',
              'Plan queries efficiently to maximize decision-useful output.',
              '',
              'Recommended sequence:',
              '1. find_target(query) for orientation.',
              '2. get_module_boundary(module) for scope.',
              '3. trace_impact(node, depth=2) for blast radius.',
              '4. assess_change_risk(target, change_description) before edits.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'debug-workflow',
    {
      description: 'Guide a budget-aware production debugging workflow.',
      argsSchema: {
        issue: z.string(),
        current_focus: z.string().optional(),
      },
    },
    async ({ issue, current_focus }) => ({
      description: 'Debug workflow prompt',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Debug issue: ${issue}`,
              `Current focus: ${current_focus || 'unknown'}`,
              '',
              '⚠️ Context Budget: ~4000 tokens',
              'Keep the loop within 4-5 queries.',
              '',
              'Recommended sequence:',
              '1. find_target(query=issue).',
              '2. follow_data(object_type, field?) for suspect fields.',
              '3. trace_impact(node, depth=2, direction="both").',
              '4. execution_reality(function_name, lookback="1hour") for runtime hotspots.',
              '5. query_execution_trace(error_id, lookback="24hour") if errors persist.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'refactor-planning',
    {
      description: 'Generate a safe, verifiable refactor plan with guardrails.',
      argsSchema: {
        target: z.string(),
        change_description: z.string(),
      },
    },
    async ({ target, change_description }) => ({
      description: 'Refactor planning prompt',
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              `Refactor target: ${target}`,
              `Planned change: ${change_description}`,
              '',
              '⚠️ Context Budget: ~4000 tokens',
              'Prefer progressive disclosure; request details only when needed.',
              '',
              'Required checks:',
              '1. safe_refactor_plan(target, change_description).',
              '2. trace_impact(node=target, depth=2).',
              '3. get_tests_for_function(function=target).',
              '4. assess_change_risk(target, change_description).',
              '5. execution_reality(function_name=target, lookback="1hour") after changes.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  return {
    server,
    neo4j,
  };
}

export async function runMcpServer(repoRoot: string): Promise<void> {
  const app = await createMcpApp(repoRoot);
  const transport = new StdioServerTransport();
  await app.server.connect(transport);
}
