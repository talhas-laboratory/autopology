# ADR 0005: OSS Packaging and Release Channels

## Status

Accepted (2026-02-18)

## Context

AuTopology needed an OSS distribution model that is easy to install, deploy, and update while preserving local-first behavior and deterministic operation.

Previous repository state was source-oriented and not release-oriented:

- CLI usage depended on running workspace build output directly.
- Docker compose was development-centric.
- No formal SemVer automation for npm + container artifacts.
- Python prototype artifacts still existed on `main`, causing runtime ambiguity.

## Decision

1. Standardize on Node-only runtime on `main`.
2. Make npm CLI package (`autopology`) the primary installation channel.
3. Publish Docker images to GHCR with immutable semver tags and `latest`.
4. Provide Homebrew via standalone binary bundles and formula automation.
5. Use Changesets + GitHub Actions for SemVer release orchestration.
6. Keep runtime local-first: no automatic update pings or remote checks.

## Alternatives Considered

- Container-first distribution only.
- Dual runtime support (Node + Python).
- Manual release process without Changesets.

Rejected due poorer MCP ergonomics, maintenance overhead, and lower release reliability.

## Consequences

- Installation UX is consistent across npm, Docker, and Homebrew.
- CI/release pipelines now own artifact integrity and publication.
- Python runtime users must migrate using Node tooling.
- Release docs and update docs become source of truth for operators.

## Migration Notes

- `autopology setup` becomes the recommended onboarding command.
- `autopology graph create` is the ergonomic alias for graph refresh.
- `autopology mcp configure` generates client snippets for Claude/Cursor/VSCode/Windsurf.
