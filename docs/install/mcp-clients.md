# MCP Client Config

Generate a config snippet for each client:

```bash
autopology mcp configure --client claude --repo /path/to/repo
autopology mcp configure --client cursor --repo /path/to/repo
autopology mcp configure --client vscode --repo /path/to/repo
autopology mcp configure --client windsurf --repo /path/to/repo
```

To write the snippet to a file under the repo:

```bash
autopology mcp configure \
  --client claude \
  --repo /path/to/repo \
  --output .autopology/mcp/claude.json
```

The generated server command always uses stdio:

```json
{
  "command": "autopology",
  "args": ["mcp", "--repo", "/path/to/repo"]
}
```
