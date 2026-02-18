# npm Install

## Requirements

- Node.js 20+
- Neo4j 5+

## Install

Pinned:

```bash
npm install -g autopology@1.0.0
```

One-off execution:

```bash
npx autopology@1.0.0 --help
```

## First Setup

```bash
autopology setup --repo /path/to/repo --full
```

## MCP Integration

```bash
autopology mcp configure --client claude --repo /path/to/repo
autopology mcp --repo /path/to/repo
```
