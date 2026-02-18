# ADR 0002: TypeScript/JavaScript Parsing Dependencies (Tree-sitter)

## Status

Accepted (2026-02-13)

## Context

AuTopology v1 needs TS/JS parsing for:
- imports
- basic symbol extraction (functions/classes/methods)
- best-effort call edges

We want an easy install story on macOS/Linux/Windows with wheels when possible.

The `tree-sitter-languages` package (prebuilt languages bundle) is convenient but is sensitive to API compatibility with the `tree-sitter` Python bindings, and may break when upstream changes constructor semantics.

## Decision

Use per-language Tree-sitter grammar wheels:
- `tree-sitter-javascript`
- `tree-sitter-typescript`

Construct `tree_sitter.Language` objects from the integer language IDs exposed by these packages.

## Alternatives Considered

- `tree-sitter-languages`: simplest API but brittle across upstream binding changes.
- Regex parsing: easier to install but lower precision and higher maintenance cost.

## Consequences

- Slightly more dependencies, but clearer compatibility boundaries.
- The TS/JS plugin can be extended by adding more language grammar packages without changing core indexing/storage.

