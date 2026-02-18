# ADR 0004: Stream-Oriented MCP Tools and Windowed Runtime Reality

## Status

Accepted (2026-02-18)

## Context

`docs/update_docs/streamofthought.md` defines an interaction model that relies on first-class orientation/action/runtime tools and lookback-aware runtime behavior, not only static graph analysis.

Current implementation had:

- Strong v1 intent tools and progressive envelopes.
- Runtime aggregates (`RuntimeSpanAggregate`, `OBSERVED_CALL`) without time-window slicing.
- No first-class MCP tools for:
  - `understand_codebase`
  - `execution_reality`
  - `safe_refactor_plan`
  - `generate_context_for_llm`
  - `query_execution_trace`

## Decision

1. Add the five stream-oriented MCP tools above as first-class tool registrations.
2. Introduce `RuntimeWindow` nodes (hourly buckets) to support lookback queries (`30min`, `1hour`, `24hour`, etc.).
3. Keep existing aggregate runtime model in parallel for fallback and continuity.
4. Implement runtime query behavior in repository methods and keep MCP handlers contract-consistent (progressive output, budget metadata, truncation transparency).
5. Bump schema version to `3` and add runtime window constraints/indexes.

## Alternatives Considered

- Approximate lookback from `last_seen` on lifetime aggregates only.
- Expose the missing stream capabilities as composition hints in existing 8 tools instead of first-class tools.
- Add full trace/event storage now.

Rejected:

- `last_seen`-only approximation is not reliable for lookback semantics.
- Composition-only approach still leaves a discoverability and contract gap.
- Full event storage now increases operational complexity beyond requested scope.

## Consequences

- MCP surface expands beyond the prior 8 v1 tools.
- Runtime ingestion writes additional windowed records, increasing graph size over time.
- Query quality for runtime diagnostics improves because lookback is now data-backed.
- Older runtime data (pre-window migration) is still usable through aggregate fallback paths.

## Migration Notes

- Requires schema bootstrap with version `3`.
- Existing runtime ingest clients remain compatible; they continue sending the same span payload.
- Tool clients can adopt new tools incrementally; no required changes to existing 8-tool workflows.
