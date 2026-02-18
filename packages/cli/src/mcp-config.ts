export const MCP_CLIENTS = ['claude', 'cursor', 'vscode', 'windsurf'] as const;

export type McpClient = (typeof MCP_CLIENTS)[number];

interface StdIoServerConfig {
  command: string;
  args: string[];
}

function serverConfig(repoRoot: string): StdIoServerConfig {
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

export function buildMcpConfigObject(client: McpClient, repoRoot: string): Record<string, unknown> {
  const stdio = serverConfig(repoRoot);
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

export function buildMcpConfigSnippet(client: McpClient, repoRoot: string): string {
  const payload = buildMcpConfigObject(client, repoRoot);
  return JSON.stringify(payload, null, 2);
}
