# ADR 0001: Storage (SQLite) and Deterministic IDs

## Status

Accepted (2026-02-13)

## Context

AuTopology must be easy to install on a user machine and safe to run on arbitrary repos.
Requiring Docker services (Neo4j/Qdrant/Postgres) is too heavy for v1 and increases operational risk.

We also need stable identifiers so:
- incremental indexing is reliable
- diffs are understandable
- MCP tools can refer to nodes across sessions

## Decision

1. Use a per-repo SQLite database stored at `.autopology/graph.sqlite3`.
2. Use deterministic, string-based IDs:
   - file: `file:<rel_path>`
   - dir: `dir:<rel_path>`
   - symbols: `sym:<lang>:<rel_path>:<kind>:<qualname>`

## Alternatives Considered

- Neo4j + vector DB + docker-compose: powerful queries but heavy install and more security surface.
- JSONL/flat files: simple but harder to query efficiently and to support neighborhood/impact tooling.
- Postgres: more operations overhead than SQLite for local-first CLI.

## Consequences

- SQLite becomes a single source for query tools; it must be schema-versioned.
- IDs are best-effort stable; symbol moves/renames create new IDs unless a higher-level refactor layer is added later.

