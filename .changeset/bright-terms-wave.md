---
"autopology": minor
"@autopology/core": patch
"@autopology/indexer": patch
"@autopology/mcp-server": patch
"@autopology/runtime-hooks": patch
"@autopology/storage-neo4j": patch
---

Deliver OSS-ready distribution updates:

- rename CLI package to `autopology`
- add `setup`, `graph create`, and `mcp configure` commands
- add npm pack validation and standalone bundle scripts
- add production Dockerfile and release workflows
- add Homebrew formula template and install/update docs
- remove legacy Python runtime artifacts from main branch
