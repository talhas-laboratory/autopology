# Autopology

**AI-Native Codebase Understanding System**

A graph-based context layer for AI agents to instantly understand, navigate, and safely modify codebases.

---

## Documentation

### 1. [MCP Specification](./01-mcp-specification.md)
Technical interface specification for the MCP server.
- Tool schemas
- Progressive disclosure format
- Context budget management
- MVP vs V2 vs V3 roadmap

### 2. [Architecture Guide](./02-architecture-guide.md)
Complete functional specification.
- All 6 graph lenses (Dependency, Data Flow, Execution, Semantic, Change, Cross-Repo)
- Agent use cases (debug, refactor, add feature, optimize)
- Functional requirements
- Data models
- Performance requirements

### 3. [Implementation Guide](./03-implementation-guide.md)
Core implementation details.
- Neo4j database schema
- Algorithm pseudocode
- Error handling patterns
- Sample tool implementation

### 4. [Implementation (Product-Aligned)](./04-implementation-product-aligned.md)
Production-ready implementation with philosophy enforcement.
- Progressive disclosure enforcement
- Context budget manager
- Complete testing suite
- Philosophy compliance tests
- Logging specification

---

## Quick Start

1. Read the **MCP Specification** for interface design
2. Review the **Architecture Guide** for system overview
3. Follow the **Implementation (Product-Aligned)** for production code

---

## Core Philosophy

- **Intent-Based:** Answer questions, don't dump data
- **Progressive Disclosure:** Level 1 (summary) → Level 2 (relations) → Level 3 (details)
- **Context Budget:** Every byte must be decision-useful (< 4000 tokens)
- **Semantic Understanding:** Domain concepts, not just code structure

---

## Build Order

1. **Phase 1 (MVP):** 8 core tools, single repo, static analysis (4 weeks)
2. **Phase 2:** Intelligence layer, auto concept mapping, 6 extended tools (4 weeks)
3. **Phase 3:** Multi-repo, runtime tracing, enterprise scale (4 weeks)

---

**Total: 12 weeks from start to enterprise-ready**
