# ADR 0003: Node + Neo4j Hard-Break Rewrite

## Status

Accepted (2026-02-18)

## Context

Updated product docs in `docs/update_docs/` define v1 as intent-first MCP with progressive disclosure, strict context budgets, and relationship-first graph storage.

The existing Python/SQLite prototype does not satisfy this contract without substantial mismatch.

## Decision

1. Pivot runtime to Node.js + Neo4j.
2. Treat v1 as a hard break (no compatibility shim for old tool names).
3. Implement 8 intent-based MCP tools and the mandatory progressive response envelope.
4. Make `follow_data` a P0 MVP tool.
5. Implement hot/warm/cold caching in v1.
6. Keep native Node as default runtime; Docker optional.
7. Include V2-lite runtime ingestion hooks only (no full V2 tool suite).

## Alternatives Considered

- Keep Python/SQLite and add adapter layer.
- Dual-stack compatibility period.
- Hybrid SQLite + Neo4j backend.

All rejected due complexity, contract ambiguity, and slower convergence to the product spec.

## Consequences

- Existing integrations must migrate to new tool names and output schema.
- Neo4j is now a required runtime dependency.
- Architecture aligns directly with v1 product docs and scales toward v2/v3 roadmap.
