# Migration Guide: Python Prototype -> Node v1 Hard Break

## What Changed

- Runtime moved from Python + SQLite to Node.js + Neo4j.
- Python runtime artifacts were removed from `main` and retained only as legacy history.
- MCP tool API replaced with the v1 intent-based tool suite.
- Progressive output envelope is now mandatory for all tools.
- Caching is tiered (hot/warm/cold) and freshness-stamped.

## Old -> New Tool Mapping

- `locate_concept` -> `find_target`
- `explore_neighborhood` -> `trace_impact`
- `check_impact` -> `trace_impact` + `assess_change_risk`
- `read_source` -> use resource expansion and targeted follow-up tools

## Required Operator Steps

1. Start Neo4j.
2. Set connection env vars or use defaults.
3. Run `autopology setup --repo /path/to/repo --full`.
4. Use `autopology graph create --repo /path/to/repo --incremental` for follow-up indexing.
5. Update MCP client integrations to new tool names.

## Known Differences

- No compatibility shim is provided.
- `follow_data` now exists as a first-class P0 tool.
- Runtime tracing is hook-based (V2-lite), not full V2 analytics.
- `autopology viz` provides read-only graph exports (`json`/`mermaid`).
- MCP config snippets are now generated with `autopology mcp configure --client <name>`.
