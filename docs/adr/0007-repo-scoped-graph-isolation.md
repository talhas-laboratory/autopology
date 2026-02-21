# ADR 0007: Repo-Scoped Graph Isolation In A Shared Neo4j Database

- Status: Accepted
- Date: 2026-02-21

## Context

AuTopology targets local-first usage across arbitrary repositories while often sharing one Neo4j database.
Previous behavior used global graph metadata and unscoped node IDs, which could cause cross-repo graph mixing and accidental data overlap during incremental indexing.

## Decision

AuTopology now enforces deterministic repo scoping in a shared Neo4j database:

1. A repo scope key is derived from the canonical repo root path.
2. Stored node IDs are internally scoped with the repo scope key.
3. Graph metadata is per-scope (`GraphMeta` keyed by scoped meta ID).
4. Repository queries enforce active-repo scope filtering.
5. Warm cache entries are partitioned by repo scope key.
6. MCP tool execution is fail-closed for active-repo scope readiness (missing/mismatched/unindexed scope).
7. External MCP IDs remain backward-compatible (local IDs), with repository-level scope translation.

## Alternatives Considered

1. Per-repo Neo4j databases.
  - Strong isolation, but operationally heavier and less portable for common OSS local setups.
2. Dual mode (per-db + scoped shared-db fallback).
  - Flexible, but significantly higher complexity and test surface.
3. Shared-db repo scoping (chosen).
  - Strong practical isolation with broad install compatibility.

## Consequences

- Positive:
  - Prevents cross-repo contamination in graph reads/writes.
  - Preserves existing external tool contracts.
  - Works on Neo4j Community with a single database.
- Negative:
  - Internal complexity increases due to scope-aware ID translation.
  - Legacy unscoped data is not auto-migrated and may require explicit reindex per repo.

## Migration Notes

- Reindex each active repo once to establish scoped graph state:

```bash
autopology graph create --repo /path/to/repo --full
```

- Use repo-local pruning when needed:

```bash
autopology graph prune --repo /path/to/repo
```
