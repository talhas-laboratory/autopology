# Security Policy

AuTopology is designed to run on arbitrary user repositories. It must be safe-by-default.

## Threat Model (Summary)

Primary risks:
- Reading files outside the repo root (path traversal, symlink escape)
- Accidental network exfiltration of proprietary code
- Excessive output sizes that leak more context than intended

## Security Guarantees

- AuTopology enforces a strict repo-root sandbox for file reads/writes.
- AuTopology does not follow symlinks by default when indexing.
- `read_source` is size-capped and only returns slices for known graph nodes.
- Remote model calls are disabled unless explicitly enabled.

## Reporting a Vulnerability

If you discover a security issue, please open a GitHub issue with:
- minimal reproduction steps
- expected vs actual behavior
- platform and AuTopology version

If the issue involves sensitive details, redact secrets and include only what is necessary.

