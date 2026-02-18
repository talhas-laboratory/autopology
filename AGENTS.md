# AuTopology Agent Instructions

This repository is intended to become an installable open source tool that runs on arbitrary user codebases.
Treat security, correctness, and reproducibility as first-class requirements.

## Non-Negotiables

- **Local-first, safe-by-default:** No network calls unless explicitly enabled by a user config flag.
- **Repo sandboxing:** Never read or write outside the configured repo root. Resolve realpaths and reject path traversal and symlink escapes.
- **Determinism:** Prefer deterministic IDs, stable outputs, and idempotent commands.
- **Small, composable modules:** Keep components focused and replaceable (parsers, storage, summarizer, embedder, viz).
- **Good failure modes:** Fail closed (safe) when uncertain. Emit actionable errors.

## Modularity Rules

- Keep "pure logic" separate from I/O.
  - Parsing should accept `(path, text)` and return structured output.
  - Indexing should accept parsed output and update storage.
  - MCP tools should call service functions; do not embed business logic in tool handlers.
- Avoid singletons where possible. Prefer dependency injection via explicit parameters.
- Every new capability must have a clear module boundary and an internal API.

## Deep Reasoning Discipline (How We Make Changes)

When making a non-trivial change (new subsystem, storage format, security boundary, parser behavior):

1. **Restate the goal** in one sentence (what will be true when done).
2. **List constraints** (security, OSS installability, performance, token limits).
3. **Enumerate alternatives** (2-3) and explicitly pick one with tradeoffs.
4. **Define the invariants** (what must not break).
5. **Implement minimally** to satisfy invariants first, then iterate.

## Diary + ADR Workflow

This repo uses lightweight institutional memory.

- For any large decision or multi-hour bugfix, create or append a dated entry:
  - `docs/diary/YYYY-MM-DD.md`
  - Include: context, symptoms, root cause, fix, follow-ups.
- For architectural decisions that affect public interfaces or storage formats, write an ADR:
  - `docs/adr/NNNN-<short-title>.md`
  - Include: decision, status, alternatives, consequences, migration notes.

## Security Checklist (Every PR / Significant Change)

- All filesystem access uses a single safe resolver that enforces repo root.
- Indexing does not follow symlinks by default.
- `read_source` and any "export" path is size-capped and cannot read arbitrary paths.
- Remote model calls require both:
  - explicit config enable
  - required API key in env vars
- No secrets in logs. Never print env vars.

## Testing Expectations

- Add tests for:
  - deterministic IDs
  - incremental indexing correctness
  - symlink/path escape rejection
  - FTS query behavior
  - viz outputs (basic validity)

