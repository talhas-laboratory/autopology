import { describe, expect, it } from 'vitest';
import { buildMcpConfigObject, buildMcpConfigSnippet, parseMcpClient } from '../packages/cli/src/mcp-config.ts';

describe('mcp config templates', () => {
  it('parses supported clients', () => {
    expect(parseMcpClient('claude')).toBe('claude');
    expect(parseMcpClient('Cursor')).toBe('cursor');
    expect(parseMcpClient('VSCODE')).toBe('vscode');
    expect(parseMcpClient('windsurf')).toBe('windsurf');
  });

  it('rejects unsupported clients', () => {
    expect(() => parseMcpClient('unknown')).toThrow(/unsupported MCP client/i);
  });

  it('builds stdio config for common clients', () => {
    const config = buildMcpConfigObject('claude', '/repo');
    expect(config).toEqual({
      mcpServers: {
        autopology: {
          command: 'autopology',
          args: ['mcp', '--repo', '/repo'],
        },
      },
    });
  });

  it('builds vscode-specific config shape', () => {
    const config = buildMcpConfigObject('vscode', '/repo');
    expect(config).toEqual({
      mcp: {
        servers: {
          autopology: {
            command: 'autopology',
            args: ['mcp'],
          },
        },
      },
    });
  });

  it('pins repo path in client config when requested', () => {
    const config = buildMcpConfigObject('cursor', '/repo', true);
    expect(config).toEqual({
      mcpServers: {
        autopology: {
          command: 'autopology',
          args: ['mcp', '--repo', '/repo'],
        },
      },
    });
  });

  it('renders pretty JSON', () => {
    const snippet = buildMcpConfigSnippet('cursor', '/repo');
    expect(snippet).toContain('"mcpServers"');
    expect(snippet).toContain('"autopology"');
  });
});
