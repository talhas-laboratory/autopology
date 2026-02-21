# ADR 0006: MCP Target Resolution and Test Linkage Hardening

## Status

Accepted (2026-02-18)

## Context

Benchmarking showed MCP underperforming lexical triage on first-pass discovery for high-stakes incidents due to:

- noisy target ranking for mixed intent queries,
- weak linkage from functions to validating tests,
- missing deterministic exact file/test lookup tools,
- redundant lookup overhead in multi-step tool workflows.

The public MCP interface also needed safer deterministic entry points for OSS users who already know exact file targets.

## Decision

1. Keep hybrid retrieval, but harden ranking with intent-aware weighting (file/test/security/runtime/concept) and stronger path lexical features.
2. Add deterministic lookup tools:
   - `find_file_exact(path)`
   - `find_tests_by_path(path)`
3. Upgrade function-to-test linkage from single-edge lookup to multi-strategy inference:
   - direct `TESTS` edges,
   - called-name alias matches,
   - call-chain inference from test-like callers.
4. Add short-lived local memoization for repository lookup paths and in-flight freshness dedupe in MCP service.
5. Add an effectiveness regression gate (`test:effectiveness`) and enforce it in CI/release workflows.

## Alternatives Considered

- Security-only ranking boosts: rejected because it overfits one incident class.
- Keep only direct test edges: rejected because it misses valid indirect mappings.
- Time-window freshness memoization in service: rejected because it can mask rapid runtime freshness changes.

## Consequences

- MCP adds deterministic exact-file and file-to-test workflows without removing existing semantic tools.
- Test discovery recall improves across codebases that use indirect test calling patterns.
- Freshness correctness is preserved while still deduping concurrent freshness fetches.
- CI now enforces a retrieval effectiveness floor to reduce regression risk.

## Migration Notes

- Existing tools remain backward compatible.
- Clients can optionally prefer `find_file_exact` before `trace_impact` for deterministic incident triage paths.
