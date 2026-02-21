# AuTopology

AuTopology is a local-first code graph + MCP server for large repositories.

This repository is now Node-only (`Node.js + Neo4j`) and distributed through:

- npm CLI package (`autopology`) as the primary install path
- Docker image (`ghcr.io/talhas-laboratory/autology`)
- Homebrew formula (`autopology`) backed by standalone binaries

No automatic update checks are performed at runtime.

## Quick Start (10 Minutes)

1. Start Neo4j 5+:

```bash
docker run --rm -p 7474:7474 -p 7687:7687 \
  -e NEO4J_AUTH=neo4j/autopology_dev_pw \
  neo4j:5.26
```

2. Setup and index a codebase:

```bash
npx autopology@1.0.0 setup --repo /path/to/repo
```

3. Generate MCP client config:

```bash
npx autopology@1.0.0 mcp configure --client claude --repo /path/to/repo
```

4. Run MCP server:

```bash
npx autopology@1.0.0 mcp --repo /path/to/repo
```

## Install

See `/Users/talhauddin/software/AuTopology/docs/install/README.md` for channel-specific instructions.

## Core CLI Commands

```bash
autopology setup --repo /path/to/repo --full
autopology doctor --repo /path/to/repo
autopology graph create --repo /path/to/repo --incremental
autopology watch --repo /path/to/repo
autopology mcp --repo /path/to/repo
autopology mcp configure --client cursor --repo /path/to/repo
autopology viz --repo /path/to/repo --node module:src --depth 2 --format mermaid
```

Runtime ingest hook:

```bash
autopology ingest-runtime \
  --repo /path/to/repo \
  --caller sym:typescript:src/app.ts:Function:handler \
  --callee sym:typescript:src/db.ts:Function:query \
  --duration-ms 42 \
  --ok
```

## Build and Test

```bash
npm ci
npm run typecheck
npm run test
npm run test:effectiveness
npm run build
```

## Release Channels

- npm: `autopology@x.y.z`
- Docker: `ghcr.io/talhas-laboratory/autology:x.y.z` and `:latest`
- Homebrew: `autopology` formula from the tap

Use exact versions for reproducible installs.

## Migration

Python runtime artifacts were removed from `main` and archived as legacy history.
See:

- `/Users/talhauddin/software/AuTopology/docs/migration-v1-hard-break.md`
- `/Users/talhauddin/software/AuTopology/docs/adr/0003-node-neo4j-hard-break.md`
