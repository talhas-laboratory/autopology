# Codebase Graph System
## Comprehensive Architecture Guide

**Version:** 1.0  
**Date:** 2026-02-18  
**Purpose:** Complete functional specification for codebase understanding system  
**Scope:** All features, lenses, use cases, and requirements

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Core Design Principles](#2-core-design-principles)
3. [Graph Lenses - Detailed Specifications](#3-graph-lenses---detailed-specifications)
4. [Agent Use Cases](#4-agent-use-cases)
5. [Functional Requirements](#5-functional-requirements)
6. [Data Models](#6-data-models)
7. [Implementation Architecture](#7-implementation-architecture)
8. [Performance Requirements](#8-performance-requirements)
9. [MVP vs Future Features](#9-mvp-vs-future-features)
10. [Success Criteria](#10-success-criteria)

---

## 1. System Overview

### 1.1 Purpose
Build a graph-based context system that enables AI agents to instantly understand codebases, trace relationships, assess change impact, and navigate complex software systems without reading files linearly.

### 1.2 Core Value Propositions

**For Agents:**
- Instant codebase orientation (not reading 100+ files)
- Relationship visibility (dependencies, data flows, execution paths)
- Change impact prediction (what breaks if I modify X?)
- Contextual navigation (find by concept, not by folder)

**For Developers:**
- Debugging assistance (trace errors through the system)
- Refactoring safety (know blast radius before changing)
- Onboarding acceleration (understand architecture visually)
- Knowledge preservation (graph persists, people forget)

---

## 2. Core Design Principles

### 2.1 Intent-Based Architecture
The system answers specific questions, not generic data dumps.

### 2.2 Progressive Disclosure
Three-level architecture:
- **Level 1 (Summary):** High-level metrics (< 500 tokens)
- **Level 2 (Relationships):** Connections and flows (< 1500 tokens)
- **Level 3 (Details):** Implementation specifics (< 4000 tokens)

### 2.3 Context Window Optimization
Every byte returned must be decision-useful.

### 2.4 Semantic Over Syntactic
Model domain concepts, not just code structure.

### 2.5 Living System Model
The graph reflects reality, not just static code.

### 2.6 Relationship-First Storage
Relationships are first-class citizens.

---

## 3. Graph Lenses - Detailed Specifications

### 3.1 Dependency Lens
**Purpose:** Show static code dependencies and import relationships.

**Use Cases:**
- Refactoring preparation
- Architecture validation
- Dependency cleanup
- Impact analysis

**Node Types:** Module, Function, Class, File

**Edge Types:** IMPORTS, CALLS, EXTENDS, CONTAINS

**Queries:**
- What modules depend on X?
- What does X depend on?
- Shortest path from A to B?
- Circular dependencies?

**Output Format:**
```json
{
  "target": "auth-service",
  "dependencies": {
    "upstream": [{"module": "api-gateway", "strength": 0.9}],
    "downstream": [{"module": "jwt-lib", "strength": 0.8}]
  },
  "metrics": {
    "incoming": 12,
    "outgoing": 8,
    "circular": false
  }
}
```

**Priority:** P0 (MVP)

---

### 3.2 Data Flow Lens
**Purpose:** Trace how data transforms and moves through the system.

**Use Cases:**
- Debugging
- Security audits
- Performance optimization
- Understanding calculations

**Node Types:** Data Object, Field, Transformation, Store

**Edge Types:** READS, WRITES, TRANSFORMS, STORES

**Queries:**
- Where is Order.total calculated?
- What functions read user.email?
- Trace this value from input to output

**Priority:** P0 (MVP)

---

### 3.3 Execution Lens (V2)
**Purpose:** Show runtime behavior and performance.

**Use Cases:**
- Performance debugging
- Hot path identification
- Error diagnosis
- Resource optimization

**Attributes:**
- Call frequency
- Average duration
- Error rate
- P50/P95/P99 latency

**Priority:** P1 (V2)

---

### 3.4 Semantic/Concept Lens
**Purpose:** Map domain concepts to code implementations.

**Use Cases:**
- "Where is authentication handled?"
- Understanding business capabilities
- Finding concept implementations
- Onboarding

**Priority:** P1 (MVP basic, V2 auto-discovery)

---

### 3.5 Change Lens
**Purpose:** Track evolution and modification patterns.

**Use Cases:**
- "What changed recently?"
- Finding hidden coupling
- Understanding evolution
- Identifying unstable modules

**Priority:** P1 (MVP)

---

### 3.6 Cross-Repository Lens (V3)
**Purpose:** Trace dependencies across service boundaries.

**Priority:** P2 (V3)

---

## 4. Agent Use Cases

### 4.1 Debug Production Issue
**Workflow:**
1. get_context_for_task("orders failing")
2. follow_data("Order", "status")
3. execution_reality("OrderService.create", "1hour")
4. diagnose_error("Timeout at InventoryService")
5. trace_impact("InventoryService.reserve", depth=1)

**Time Saved:** 5 queries vs 20+ file reads

---

### 4.2 Safe Refactoring
**Workflow:**
1. resolve_concept("authentication")
2. trace_impact("AuthService", depth=3)
3. assess_change_risk("AuthService", "Replace JWT with session")
4. get_tests_for_function("AuthService.validate")
5. suggest_approach("migrate auth from JWT to session")

**Value:** Prevents breaking 47 call sites

---

### 4.3 Add New Feature
**Workflow:**
1. resolve_concept("checkout")
2. follow_data("Order", "total")
3. find_target("discount or coupon")
4. get_module_boundary("PaymentService")
5. suggest_approach("add discount code system")

---

### 4.4 Performance Optimization (V2)
**Workflow:**
1. execution_reality("*", "1hour") - find slowest
2. execution_reality("OrderController.create") - breakdown
3. trace_impact("EmailService.sendConfirmation")
4. suggest_approach("optimize OrderController.create")

---

## 5. Functional Requirements

### 5.1 Graph Construction
- Parse code using Tree-sitter AST
- Extract imports, exports, function calls
- Build dependency and call graphs
- Real-time updates on file save (< 5s)
- Incremental updates (not full rebuild)

### 5.2 Query Interface
- Natural language queries
- Structured tool-based queries
- Confidence scores (0-1)
- Progressive disclosure (3 levels)
- Context budget enforcement (< 4000 tokens)

### 5.3 Dependency Analysis
- Upstream/downstream tracing
- Circular dependency detection
- Dependency depth calculation
- Orphan identification
- Coupling strength calculation

### 5.4 Data Flow Analysis
- Field-level data flow tracing
- Transformation identification
- Data persistence tracking
- Instance-specific tracing

### 5.5 Risk Assessment
- Blast radius calculation
- Test coverage analysis
- Change complexity assessment
- Risk score (0-100)
- Mitigation recommendations

---

## 6. Data Models

### Core Nodes
- Module (id, name, path, language, lines, coverage)
- Function (id, name, signature, async, returns)
- Concept (id, name, definition, aliases)
- File (id, path, size, last_modified)

### Core Relationships
- DEPENDS_ON (strength, type, line)
- CALLS (frequency, async, line)
- READS/WRITES/TRANSFORMS (field, line)
- IMPLEMENTS (confidence, role)
- MODIFIED_IN (commit, date, author)

---

## 7. Implementation Architecture

### Components
1. **MCP Server** - JSON-RPC interface
2. **Intent Router** - Natural language parsing
3. **Progressive Assembler** - Level 1/2/3 assembly
4. **Graph Query Engine** - Neo4j Cypher
5. **Analysis Pipeline** - Tree-sitter, File Watcher, Git

### Technology Stack
- Graph DB: Neo4j
- AST Parser: Tree-sitter
- File Watching: chokidar
- Git: simple-git
- Server: Node.js with MCP SDK

---

## 8. Performance Requirements

### Response Times
- Simple query: < 100ms
- Dependency trace: < 500ms
- Data flow trace: < 1s
- Full impact analysis: < 2s
- Graph update: < 5s

### Resource Usage
- Memory: 512MB base + 256MB per 10k files
- Disk: 2x codebase size for graph storage

---

## 9. MVP vs Future Features

### MVP (V1) - 4 weeks
- 8 core tools
- Single repo
- Static analysis only
- File watching
- Basic caching

### V2 - 4 more weeks
- Execution tracing
- Auto concept mapping
- Historical learning
- 6 extended tools
- Smart caching

### V3 - 4 more weeks
- Multi-repo federation
- Distributed graphs
- Team collaboration
- HTTP transport

---

## 10. Success Criteria

### V1
- Agent solves debug task in < 5 queries
- Refactor impact identified in < 30 seconds
- Context stays < 4000 tokens

### V2
- 50% reduction in queries needed
- 80% accuracy in risk assessment

### V3
- Supports 10+ repo systems
- Cross-service debugging

---

**End of Architecture Guide**
