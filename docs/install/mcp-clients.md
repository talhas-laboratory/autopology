# MCP Client Config

Generate a config snippet for each client:

```bash
autopology mcp configure --client claude --repo /path/to/repo
autopology mcp configure --client cursor --repo /path/to/repo
autopology mcp configure --client vscode --repo /path/to/repo
autopology mcp configure --client windsurf --repo /path/to/repo
```

Use `--pin-repo` when you need the generated command to always include `--repo`:

```bash
autopology mcp configure --client cursor --repo /path/to/repo --pin-repo
autopology mcp configure --client vscode --repo /path/to/repo --pin-repo
autopology mcp configure --client windsurf --repo /path/to/repo --pin-repo
```

To write the snippet to a file under the repo:

```bash
autopology mcp configure \
  --client claude \
  --repo /path/to/repo \
  --output .autopology/mcp/claude.json
```

Generated server commands always use stdio.  
Default launch mode for Cursor/VSCode/Windsurf is cwd-based:

```json
{
  "command": "autopology",
  "args": ["mcp"]
}
```

Pinned launch mode (Claude always, or other clients with `--pin-repo`):

```json
{
  "command": "autopology",
  "args": ["mcp", "--repo", "/absolute/path/to/repo"]
}
```

## Codex MCP Settings

Codex uses `~/.codex/config.toml`.

Workspace-cwd mode (recommended for multi-repo workflows):

```toml
[mcp_servers.autopology]
command = "autopology"
args = ["mcp"]
```

Pinned mode (recommended if the MCP process is not launched from repo root):

```toml
[mcp_servers.autopology]
command = "autopology"
args = ["mcp", "--repo", "/absolute/path/to/repo"]
```
