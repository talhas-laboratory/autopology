# Codebase Context MCP Server
## Optimized Architecture Specification

**Version:** 1.0-FINAL  
**Date:** 2026-02-18  
**Purpose:** Production-ready specification for instant codebase understanding  
**Philosophy:** Intent-first, progressive disclosure, context-optimized

---

## Executive Summary

This document provides the complete, optimized specification for an MCP server that enables AI agents to instantly understand codebases through graph-based relationships and progressive context delivery.

**Key Optimizations:**
- ✅ Progressive disclosure at every level (Resources, Tools, Prompts)
- ✅ Context budget awareness throughout
- ✅ Confidence scoring for all outputs
- ✅ Smart truncation with transparency
- ✅ Clear MVP vs Future roadmap

---

## 1. Core Philosophy

### 1.1 Intent-Based Design
Every interaction answers a specific question. No raw data dumps.

### 1.2 Progressive Disclosure
Three-level architecture:
- **Level 1 (Summary):** Names, counts, high-level impact (< 500 tokens)
- **Level 2 (Relationships):** Connections, flows, dependencies (< 1500 tokens)
- **Level 3 (Details):** Code, implementation, full context (< 4000 tokens)

### 1.3 Context Budget Awareness
**Target:** Stay under 4000 tokens per interaction  
**Strategy:** Summaries first, expand on demand, confidence-ranked results

---

## 2. Architecture

```
MCP Host (Agent)
       │
       │ JSON-RPC 2.0
       ▼
┌─────────────────────────────────────────────┐
│         CODEBASE CONTEXT SERVER             │
├─────────────────────────────────────────────┤
│ Intent Router → Progressive Assembler       │
│       ↓                                     │
│ Graph Engine (Neo4j)                        │
│   - Dependency Graph                        │
│   - Data Flow Graph                         │
│   - Concept Graph                           │
│       ↓                                     │
│ Analysis Pipeline                           │
│   - Tree-sitter (AST)                       │
│   - File Watcher                            │
│   - Git Integration                         │
└─────────────────────────────────────────────┘
```

---

## 3. Resources (Read-Only Context)

### Design Principles
- Return Level 1 (summary) by default
- Include `deeper_levels` links for expansion
- Target < 500 tokens for Level 1
- Always include confidence and completeness metadata

### Resource Types

#### codebase://module/{name}
```json
{
  "uri": "codebase://module/auth-service",
  "name": "auth-service",
  "content_level": "summary",
  "content": {
    "overview": "Handles user authentication",
    "public_api_count": 5,
    "dependency_count": 8,
    "dependent_count": 12,
    "test_coverage": 0.87,
    "health_score": 0.92
  },
  "metadata": {
    "confidence": 0.95,
    "completeness": "complete",
    "estimated_tokens": 120,
    "last_analyzed": "2026-02-18T10:00:00Z"
  },
  "deeper_levels": {
    "relationships": "codebase://module/auth-service/relationships",
    "implementation": "codebase://module/auth-service/implementation"
  }
}
```

#### concept://{name}
```json
{
  "uri": "concept://authentication",
  "name": "authentication",
  "content_level": "summary",
  "content": {
    "definition": "User authentication system",
    "primary_implementation": "auth-service",
    "implementation_count": 3,
    "cross_cutting": true
  },
  "metadata": {
    "confidence": 0.89,
    "estimated_tokens": 80
  },
  "deeper_levels": {
    "implementations": "concept://authentication/implementations",
    "data_flow": "concept://authentication/data-flow"
  }
}
```

#### view://{lens}/{target}
Dynamic views: dependency, data-flow, execution, changes

---

## 4. Tools (Actions)

### Design Principles
- Intent-based naming
- Progressive output format
- Confidence scores mandatory
- Smart truncation with transparency

### Standard Output Format (All Tools)
```json
{
  "result": {
    "summary": "...",
    "items": [...]
  },
  "metadata": {
    "confidence": 0.92,
    "completeness": "partial",
    "total_available": 47,
    "returned": 10,
    "truncation_reason": "context_optimization",
    "estimated_tokens": 850
  },
  "next_steps": {
    "expand": "tool://trace_impact?node=X&depth=3",
    "narrow": "tool://trace_impact?node=X&depth=1"
  }
}
```

### MVP Tool Suite (8 Tools)

#### P0: Critical Path Tools

**1. find_target**
```json
{
  "name": "find_target",
  "description": "Locate code by natural language description",
  "inputSchema": {
    "query": "string",
    "context": "string?"
  },
  "outputSchema": {
    "results": [
      {
        "location": "string",
        "type": "module|function|concept",
        "confidence": "number (0-1)",
        "relevance": "string"
      }
    ],
    "suggested_next": "string?"
  }
}
```

**2. get_module_boundary**
```json
{
  "name": "get_module_boundary",
  "description": "Get module interface and scope (Level 1)",
  "inputSchema": {
    "module": "string",
    "depth": "number (default: 1)"
  },
  "outputSchema": {
    "overview": "string",
    "public_api": ["string"],
    "lines_of_code": "number",
    "dependencies": ["string"],
    "dependents": ["string"],
    "test_coverage": "number",
    "risk_indicators": ["string"]
  }
}
```

**3. trace_impact**
```json
{
  "name": "trace_impact",
  "description": "Trace dependencies and change impact",
  "inputSchema": {
    "node": "string",
    "depth": "number (default: 2)",
    "direction": "upstream|downstream|both"
  },
  "outputSchema": {
    "target": "string",
    "upstream": [{"node": "string", "criticality": "high|medium|low"}],
    "downstream": [{"node": "string", "criticality": "high|medium|low"}],
    "blast_radius": "string",
    "confidence": "number"
  }
}
```

**4. follow_data**
```json
{
  "name": "follow_data",
  "description": "Trace data transformation through system",
  "inputSchema": {
    "object_type": "string",
    "field": "string?"
  },
  "outputSchema": {
    "transformations": [
      {
        "step": "number",
        "location": "string",
        "transform": "string",
        "line": "number"
      }
    ]
  }
}
```

**5. assess_change_risk**
```json
{
  "name": "assess_change_risk",
  "description": "Quantify risk of proposed change",
  "inputSchema": {
    "target": "string",
    "change_description": "string"
  },
  "outputSchema": {
    "risk_score": "number (0-100)",
    "risk_level": "low|medium|high",
    "factors": {
      "blast_radius": "string",
      "test_coverage": "string",
      "change_complexity": "string"
    },
    "recommendations": ["string"],
    "safe_to_proceed": "boolean"
  }
}
```

#### P1: High Value Tools

**6. resolve_concept**
```json
{
  "name": "resolve_concept",
  "description": "Find all implementations of domain concept",
  "inputSchema": {
    "concept": "string"
  },
  "outputSchema": {
    "concept": "string",
    "implementations": [
      {"type": "string", "location": "string", "role": "string"}
    ],
    "data_flow": ["string"]
  }
}
```

**7. get_tests_for_function**
```json
{
  "name": "get_tests_for_function",
  "description": "Find all tests exercising a function",
  "inputSchema": {
    "function": "string"
  },
  "outputSchema": {
    "function": "string",
    "unit_tests": [{"file": "string", "coverage": "number"}],
    "integration_tests": [{"file": "string"}],
    "suggested_tests_to_run": ["string"]
  }
}
```

**8. get_context_for_task**
```json
{
  "name": "get_context_for_task",
  "description": "Bundle relevant context for specific task",
  "inputSchema": {
    "task": "string",
    "current_focus": "string?"
  },
  "outputSchema": {
    "task": "string",
    "resources": ["uri"],
    "tools_to_call": [{"tool": "string", "args": {}}],
    "suggested_approach": "string",
    "estimated_tokens": "number"
  }
}
```

### Extended Tools (V2+)

**execution_reality** - Runtime behavior (needs OpenTelemetry)  
**cross_repo_trace** - Cross-repo dependencies (V3)  
**explain_decision** - Code history (needs git analysis)  
**diagnose_error** - Error pattern matching (needs error DB)  
**predict_test_failures** - ML-based prediction (V2)  
**suggest_approach** - Pattern-based guidance (needs history)

---

## 5. Prompts (Templates)

### Context Budget Notice
All prompts include context budget guidance:
```
⚠️ Context Budget: ~4000 tokens
Plan queries efficiently to maximize value.
```

### task-analysis
```
Analyze task: {{task_description}}
Current focus: {{current_module}}

⚠️ Budget: 4 queries recommended

1. Orient (use find_target) → ~200 tokens
2. Scope (use get_module_boundary) → ~400 tokens
3. Impact (use trace_impact depth=2) → ~800 tokens
4. Risk (use assess_change_risk) → ~300 tokens

Total: ~1700 tokens, leaving 2300 for agent reasoning
```

### debug-workflow
```
Error: {{error_message}}
Location: {{error_location}}

⚠️ Budget: 5 queries recommended

1. Data flow trace (use follow_data) → ~600 tokens
2. Impact analysis (use trace_impact) → ~800 tokens
3. Context bundle (use get_context_for_task) → ~1000 tokens
4. Test identification (use get_tests_for_function) → ~400 tokens
5. Risk assessment (if fix proposed) → ~300 tokens

Focus: Find root cause, not symptoms
```

### refactor-planning
```
Refactor: {{target}}
Goal: {{goal}}

⚠️ Budget: 6 queries recommended

Safety gates:
- Risk score > 70? Request human review
- Blast radius > 20 modules? Stage the refactor
- Test coverage < 80%? Write tests first

1. Module boundary (use get_module_boundary) → ~400 tokens
2. Impact trace (use trace_impact depth=3) → ~1200 tokens
3. Risk assessment (use assess_change_risk) → ~300 tokens
4. Concept mapping (use resolve_concept) → ~500 tokens
5. Test coverage (use get_tests_for_function) → ~400 tokens
6. Context bundle (use get_context_for_task) → ~1000 tokens

Total: ~3800 tokens (close to limit - be efficient)
```

---

## 6. MVP vs Future Roadmap

### Phase 1: MVP (V1.0) - Weeks 1-4
**Deliverables:**
- ✅ 8 core tools with progressive output
- ✅ Single-repo dependency graph
- ✅ Basic caching (TTL)
- ✅ File watcher for instant updates
- ✅ Neo4j backend
- ✅ MCP stdio transport
- ✅ 3 prompt templates

**Not Included:**
- ❌ Runtime tracing
- ❌ Multi-repo
- ❌ Historical learning
- ❌ Auto concept mapping
- ❌ Error pattern DB

### Phase 2: Intelligence (V2.0) - Weeks 5-8
- Concept auto-mapping
- Intent recognition
- Historical pattern tracking
- 6 extended tools
- Smart caching

### Phase 3: Enterprise (V3.0) - Weeks 9-12
- Multi-repo federation
- OpenTelemetry integration
- Distributed graph
- Team collaboration
- HTTP transport

---

## 7. Success Metrics

**V1:**
- Agent solves debug task in < 5 queries
- Refactor impact identified in < 30 seconds
- Context stays < 4000 tokens

**V2:**
- 50% reduction in queries needed
- 80% accuracy in risk assessment

**V3:**
- Supports 10+ repo systems
- Cross-service debugging

---

## 8. Key Design Decisions

### Why Progressive Disclosure?
Agents need orientation before detail. Level 1 gives them the map, Level 2 the routes, Level 3 the terrain.

### Why Confidence Scores?
Agents should know when to trust vs. verify. High confidence → proceed. Low confidence → dig deeper.

### Why Context Budgets?
LLMs have limited context windows. Every token should be decision-useful.

### Why 8 MVP Tools?
Pareto principle: 8 tools cover 80% of use cases. Extended tools handle edge cases.

---

## Appendix: Optimizations Checklist

### Resources
✅ Progressive levels with `deeper_levels` links  
✅ Confidence and completeness metadata  
✅ Token estimates included  
✅ Level 1 target < 500 tokens  

### Tools
✅ Intent-based naming  
✅ Standard output format with metadata  
✅ Confidence scores mandatory  
✅ Smart truncation transparency  
✅ `next_steps` for progressive expansion  
✅ Clear P0 vs P1 priority  

### Prompts
✅ Context budget guidance  
✅ Token estimates per step  
✅ Decision points highlighted  
✅ Safety gates documented  

### Architecture
✅ Single vs Multi-repo clear  
✅ MVP vs Future clear  
✅ Caching strategy defined  
✅ Performance targets set  

---

**Status: OPTIMIZED FOR PRODUCTION**

This specification is ready for implementation. All three primitives (Resources, Tools, Prompts) are optimized for:
- Intent-based queries
- Progressive disclosure
- Context budget awareness
- Agent productivity

