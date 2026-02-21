export const MCP_CLIENTS = ['claude', 'cursor', 'vscode', 'windsurf'] as const;

export type McpClient = (typeof MCP_CLIENTS)[number];

interface StdIoServerConfig {
  command: string;
  args: string[];
}

function serverConfig(client: McpClient, repoRoot: string, pinRepo = false): StdIoServerConfig {
  if ((client === 'vscode' || client === 'cursor' || client === 'windsurf') && !pinRepo) {
    return {
      command: 'autopology',
      args: ['mcp'],
    };
  }
  return {
    command: 'autopology',
    args: ['mcp', '--repo', repoRoot],
  };
}

export function parseMcpClient(input: string): McpClient {
  const normalized = input.trim().toLowerCase();
  if (normalized === 'claude') return 'claude';
  if (normalized === 'cursor') return 'cursor';
  if (normalized === 'vscode') return 'vscode';
  if (normalized === 'windsurf') return 'windsurf';
  throw new Error(`unsupported MCP client "${input}". expected one of: ${MCP_CLIENTS.join(', ')}`);
}

export function buildMcpConfigObject(client: McpClient, repoRoot: string, pinRepo = false): Record<string, unknown> {
  const stdio = serverConfig(client, repoRoot, pinRepo);
  if (client === 'vscode') {
    return {
      mcp: {
        servers: {
          autopology: stdio,
        },
      },
    };
  }

  return {
    mcpServers: {
      autopology: stdio,
    },
  };
}

export function buildMcpConfigSnippet(client: McpClient, repoRoot: string, pinRepo = false): string {
  const payload = buildMcpConfigObject(client, repoRoot, pinRepo);
  return JSON.stringify(payload, null, 2);
}
