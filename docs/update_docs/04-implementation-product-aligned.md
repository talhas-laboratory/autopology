# Codebase Graph System
## Implementation Guide (Product-Aligned)

**Version:** 1.1  
**Date:** 2026-02-18  
**Purpose:** Complete implementation with product philosophy enforcement  
**Philosophy:** Intent-first, progressive disclosure, context-optimized

---

## Product Philosophy Enforcement

### Core Principles in Code

Every implementation must enforce:

1. **Intent-Based** - Tools answer questions, not dump data
2. **Progressive Disclosure** - 3-level output (summary → relations → details)
3. **Context Budget** - Hard limit enforcement (< 4000 tokens)
4. **Smart Truncation** - Transparency about what's shown vs hidden
5. **Confidence Scoring** - Every result has trust metric

---

## 1. Database Schema

### 1.1 Optimized for Progressive Queries

```cypher
// Indexes for fast lookups
CREATE INDEX module_name_index FOR (m:Module) ON (m.name);
CREATE INDEX function_name_index FOR (f:Function) ON (f.name);
CREATE INDEX concept_name_index FOR (c:Concept) ON (c.name);

// Composite index for relationship queries
CREATE INDEX dep_strength_index FOR ()-[r:DEPENDS_ON]-() ON (r.strength);

// Constraints
CREATE CONSTRAINT module_id_constraint FOR (m:Module) REQUIRE m.id IS UNIQUE;
```

### 1.2 Token Estimation Properties

Every node stores estimated token size:

```cypher
CREATE (m:Module {
  id: "module:auth-service",
  name: "auth-service",
  lines_of_code: 450,
  estimated_tokens: {
    level_1: 120,    // Summary
    level_2: 800,    // With relationships
    level_3: 2400    // Full implementation
  },
  priority_score: 0.92  // For ranking
})
```

---

## 2. Progressive Output Format

### Standard Response Structure (ALL tools must use)

```typescript
interface ProgressiveOutput {
  result: {
    // Level 1: Always included (summary)
    summary: {
      overview: string;           // One-line description
      metrics: {
        total_count: number;      // How many items exist
        shown_count: number;      // How many returned
        estimated_tokens: number; // Token count
      };
      key_findings: string[];     // Top 3 critical points
    };
    
    // Level 2: Included if budget allows (relationships)
    relationships?: {
      items: RelationshipItem[];  // Ranked by priority
      has_more: boolean;          // Is there more?
      next_batch?: string;        // Resource URI for more
    };
    
    // Level 3: Rarely included (full details)
    details?: {
      implementation?: string;
      code_snippet?: string;
      full_dependencies?: any[];
    };
  };
  
  metadata: {
    confidence: number;           // 0-1
    completeness: 'complete' | 'partial' | 'truncated';
    level_provided: 1 | 2 | 3;
    total_available: number;
    returned: number;
    truncation_reason?: string;
    estimated_tokens: number;
    budget_remaining: number;     // Context budget left
  };
  
  next_steps?: {
    expand?: string;              // URI to get Level 2/3
    narrow?: string;              // URI to filter
    related_queries?: string[];   // Suggested next queries
  };
}
```

---

## 3. Context Budget Enforcement

### Budget Manager (Required for ALL tools)

```typescript
class ContextBudgetManager {
  private readonly MAX_TOKENS = 4000;
  private readonly SAFETY_MARGIN = 200;
  private usedTokens = 0;
  
  checkBudget(requestedTokens: number): BudgetCheck {
    const available = this.MAX_TOKENS - this.usedTokens - this.SAFETY_MARGIN;
    
    if (requestedTokens <= available) {
      return {
        allowed: true,
        allocate: requestedTokens,
        remaining: available - requestedTokens
      };
    }
    
    return {
      allowed: false,
      allocate: Math.floor(available * 0.8), // Leave 20% buffer
      remaining: 0,
      truncation_required: true
    };
  }
  
  trackUsage(tokens: number) {
    this.usedTokens += tokens;
    logger.info('context_budget_used', {
      tokens_used: tokens,
      remaining: this.MAX_TOKENS - this.usedTokens
    });
  }
}
```

### Tool Template with Budget Enforcement

```typescript
abstract class ProgressiveTool {
  protected budgetManager = new ContextBudgetManager();
  
  async execute(input: any): Promise<ProgressiveOutput> {
    // Phase 1: Level 1 (always within budget)
    const level1 = await this.getLevel1(input);
    const level1Tokens = this.estimateTokens(level1);
    
    this.budgetManager.trackUsage(level1Tokens);
    
    // Phase 2: Try Level 2 if budget allows
    let level2 = null;
    const level2Estimate = await this.estimateLevel2(input);
    
    const budgetCheck = this.budgetManager.checkBudget(level2Estimate);
    
    if (budgetCheck.allowed) {
      level2 = await this.getLevel2(input, budgetCheck.allocate);
      this.budgetManager.trackUsage(this.estimateTokens(level2));
    }
    
    // Phase 3: Level 3 only if explicitly requested and budget allows
    let level3 = null;
    if (input.include_details && this.budgetManager.hasBudget()) {
      level3 = await this.getLevel3(input);
    }
    
    return this.assembleOutput(level1, level2, level3);
  }
  
  abstract getLevel1(input: any): Promise<Level1Data>;
  abstract getLevel2(input: any, maxTokens: number): Promise<Level2Data>;
  abstract getLevel3(input: any): Promise<Level3Data>;
}
```

---

## 4. Sample Implementation: trace_impact (Product-Aligned)

```typescript
export class TraceImpactTool extends ProgressiveTool {
  name = 'trace_impact';
  description = 'Trace dependencies with progressive disclosure';
  
  inputSchema = {
    type: 'object',
    properties: {
      node: { type: 'string' },
      depth: { type: 'number', default: 2, maximum: 3 },
      direction: { enum: ['upstream', 'downstream', 'both'], default: 'both' },
      include_details: { type: 'boolean', default: false }  // Level 3 trigger
    },
    required: ['node']
  };
  
  async getLevel1(input): Promise<Level1Data> {
    // Fast query: counts only
    const counts = await this.db.run(`
      MATCH (target {name: $node})
      OPTIONAL MATCH (target)<-[:DEPENDS_ON]-(up)
      OPTIONAL MATCH (target)-[:DEPENDS_ON]->(down)
      RETURN 
        count(DISTINCT up) as upstream_count,
        count(DISTINCT down) as downstream_count,
        target.test_coverage as coverage
    `, { node: input.node });
    
    const record = counts.records[0];
    const upstream = record.get('upstream_count').toNumber();
    const downstream = record.get('downstream_count').toNumber();
    const total = upstream + downstream;
    
    return {
      overview: `${input.node} has ${total} connections (${upstream} in, ${downstream} out)`,
      metrics: {
        total_count: total,
        shown_count: Math.min(total, 20),  // Will show max 20
        estimated_tokens: 150
      },
      key_findings: [
        `Blast radius: ${this.calculateBlastRadius(total)}`,
        `Test coverage: ${(record.get('coverage') * 100).toFixed(0)}%`,
        `Max depth queried: ${input.depth}`
      ]
    };
  }
  
  async getLevel2(input, maxTokens: number): Promise<Level2Data> {
    // Ranked query: get most important relationships first
    const upstream = await this.getRankedDependencies(
      input.node, 
      'upstream', 
      input.depth,
      maxTokens / 2  // Split budget between up/down
    );
    
    const downstream = await this.getRankedDependencies(
      input.node,
      'downstream',
      input.depth,
      maxTokens / 2
    );
    
    const totalUpstream = await this.countDependencies(input.node, 'upstream');
    const totalDownstream = await this.countDependencies(input.node, 'downstream');
    
    return {
      items: {
        upstream: upstream.items,
        downstream: downstream.items
      },
      has_more: upstream.has_more || downstream.has_more,
      totals: {
        upstream: totalUpstream,
        downstream: totalDownstream
      }
    };
  }
  
  private async getRankedDependencies(
    nodeName: string, 
    direction: string,
    depth: number,
    maxTokens: number
  ): Promise<{items: any[], has_more: boolean}> {
    // Rank by: 1) Distance (closer = higher), 2) Test coverage, 3) Change frequency
    const query = `
      MATCH path = ${direction === 'upstream' 
        ? '(dep)-[:DEPENDS_ON*1..${depth}]->(target {name: $node})'
        : '(target {name: $node})-[:DEPENDS_ON*1..${depth}]->(dep)'
      }
      WITH dep, min(length(path)) as distance,
           avg(dep.test_coverage) as coverage,
           dep.change_frequency as frequency
      RETURN dep.name as name,
             dep.type as type,
             distance,
             coverage,
             frequency,
             (1.0/distance * 0.5 + coverage * 0.3 + (1-frequency) * 0.2) as priority_score
      ORDER BY priority_score DESC
      LIMIT 50  // Get top 50, will filter by tokens
    `;
    
    const results = await this.db.run(query, { node: nodeName });
    const items = [];
    let tokensUsed = 0;
    const maxItems = Math.floor(maxTokens / 40);  // ~40 tokens per item
    
    for (const record of results.records.slice(0, maxItems)) {
      const item = {
        name: record.get('name'),
        type: record.get('type'),
        distance: record.get('distance').toNumber(),
        criticality: this.scoreToCriticality(record.get('priority_score')),
        confidence: 0.85
      };
      
      items.push(item);
      tokensUsed += this.estimateItemTokens(item);
      
      if (tokensUsed > maxTokens * 0.9) {
        break;  // Stop at 90% to leave buffer
      }
    }
    
    return {
      items,
      has_more: results.records.length > items.length
    };
  }
  
  assembleOutput(level1, level2, level3): ProgressiveOutput {
    const totalTokens = this.estimateTokens(level1) + 
                       (level2 ? this.estimateTokens(level2) : 0) +
                       (level3 ? this.estimateTokens(level3) : 0);
    
    return {
      result: {
        summary: level1,
        relationships: level2,
        details: level3
      },
      metadata: {
        confidence: 0.92,
        completeness: level2 ? 'complete' : 'partial',
        level_provided: level3 ? 3 : level2 ? 2 : 1,
        total_available: level2 ? level2.totals.upstream + level2.totals.downstream : level1.metrics.total_count,
        returned: level2 ? level2.items.upstream.length + level2.items.downstream.length : level1.metrics.shown_count,
        truncation_reason: level2?.has_more ? 'context_budget' : undefined,
        estimated_tokens: totalTokens,
        budget_remaining: 4000 - totalTokens
      },
      next_steps: level2?.has_more ? {
        expand: `codebase://impact/${this.input.node}/full`,
        narrow: `codebase://impact/${this.input.node}/critical-only`,
        related_queries: [
          `assess_change_risk for ${this.input.node}`,
          `get_tests_for_function ${this.input.node}`
        ]
      } : undefined
    };
  }
}
```

---

## 5. Comprehensive Testing Suite

### 5.1 Test Philosophy

Every test must verify:
1. **Functionality** - Does it work?
2. **Philosophy** - Does it enforce progressive disclosure?
3. **Budget** - Does it respect context limits?
4. **Logging** - Is behavior measurable?

### 5.2 Unit Tests

```typescript
// test/tools/trace-impact.progressive.test.ts
describe('trace_impact - Progressive Disclosure', () => {
  
  it('MUST return Level 1 (summary) for all queries', async () => {
    const result = await tool.execute({ node: 'auth-service' });
    
    expect(result.result.summary).toBeDefined();
    expect(result.result.summary.overview).toBeTruthy();
    expect(result.result.summary.metrics.total_count).toBeGreaterThan(0);
    expect(result.metadata.level_provided).toBeGreaterThanOrEqual(1);
    
    // Log verification
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('level_1_returned')
    );
  });
  
  it('MUST include token estimates in metadata', async () => {
    const result = await tool.execute({ node: 'auth-service' });
    
    expect(result.metadata.estimated_tokens).toBeGreaterThan(0);
    expect(result.metadata.budget_remaining).toBeGreaterThan(0);
    expect(result.metadata.estimated_tokens + result.metadata.budget_remaining).toBeLessThanOrEqual(4000);
  });
  
  it('MUST truncate results to fit context budget', async () => {
    // Mock a large result set
    const result = await tool.execute({ 
      node: 'core-service-with-many-dependencies' 
    });
    
    expect(result.metadata.completeness).toBe('truncated');
    expect(result.metadata.truncation_reason).toBe('context_budget');
    expect(result.result.relationships.has_more).toBe(true);
    expect(result.metadata.returned).toBeLessThan(result.metadata.total_available);
    
    // Verify logging
    expect(logger.warn).toHaveBeenCalledWith(
      'results_truncated',
      expect.objectContaining({
        reason: 'context_budget',
        shown: expect.any(Number),
        total: expect.any(Number)
      })
    );
  });
  
  it('MUST rank results by criticality when truncating', async () => {
    const result = await tool.execute({ node: 'auth-service', depth: 2 });
    
    const upstream = result.result.relationships.items.upstream;
    
    // Verify ranking (closer = higher criticality)
    for (let i = 0; i < upstream.length - 1; i++) {
      const current = upstream[i];
      const next = upstream[i + 1];
      
      // Either closer distance or same distance with higher priority
      expect(
        current.distance <= next.distance || 
        current.criticality !== 'low' && next.criticality === 'low'
      ).toBe(true);
    }
  });
  
  it('MUST provide next_steps for truncated results', async () => {
    const result = await tool.execute({ node: 'large-module' });
    
    if (result.metadata.completeness === 'truncated') {
      expect(result.next_steps).toBeDefined();
      expect(result.next_steps.expand).toBeTruthy();
      expect(result.next_steps.narrow).toBeTruthy();
    }
  });
  
  it('MUST return confidence scores', async () => {
    const result = await tool.execute({ node: 'auth-service' });
    
    expect(result.metadata.confidence).toBeGreaterThan(0);
    expect(result.metadata.confidence).toBeLessThanOrEqual(1);
    
    // Confidence should reflect data quality
    if (result.metadata.completeness === 'complete') {
      expect(result.metadata.confidence).toBeGreaterThan(0.8);
    }
  });
  
  it('MUST respect depth parameter limits', async () => {
    await expect(
      tool.execute({ node: 'auth-service', depth: 10 })
    ).rejects.toThrow('depth exceeds maximum');
  });
});

// test/tools/trace-impact.budget.test.ts
describe('trace_impact - Context Budget Enforcement', () => {
  
  it('MUST stay under 4000 token limit', async () => {
    const result = await tool.execute({ node: 'auth-service', depth: 3 });
    
    expect(result.metadata.estimated_tokens).toBeLessThanOrEqual(4000);
    expect(result.metadata.budget_remaining).toBeGreaterThanOrEqual(0);
  });
  
  it('MUST allocate budget intelligently between upstream/downstream', async () => {
    const result = await tool.execute({ 
      node: 'auth-service', 
      direction: 'both' 
    });
    
    const upstream = result.result.relationships.items.upstream;
    const downstream = result.result.relationships.items.downstream;
    
    // Should be roughly balanced (within 30%)
    const ratio = upstream.length / (upstream.length + downstream.length);
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.7);
  });
  
  it('MUST not query Level 2 if budget insufficient', async () => {
    // Simulate low budget scenario
    tool.budgetManager.setRemaining(100);  // Only 100 tokens left
    
    const result = await tool.execute({ node: 'auth-service' });
    
    expect(result.result.relationships).toBeNull();
    expect(result.metadata.level_provided).toBe(1);
    expect(result.metadata.completeness).toBe('partial');
  });
});

// test/tools/trace-impact.error.test.ts
describe('trace_impact - Error Handling', () => {
  
  it('MUST return NODE_NOT_FOUND for non-existent nodes', async () => {
    const result = await tool.execute({ node: 'non-existent-module' });
    
    expect(result.error).toBeDefined();
    expect(result.error.code).toBe('NODE_NOT_FOUND');
    expect(result.error.suggestion).toContain('find_target');
    expect(result.metadata.completeness).toBe('failed');
  });
  
  it('MUST suggest alternatives for misspelled nodes', async () => {
    const result = await tool.execute({ node: 'AuthServic' });  // Missing 'e'
    
    expect(result.error.did_you_mean).toContain('AuthService');
    expect(result.error.recoverable).toBe(true);
  });
  
  it('MUST return partial results on timeout', async () => {
    // Mock timeout
    tool.setTimeout(1);  // 1ms timeout
    
    const result = await tool.execute({ node: 'auth-service', depth: 3 });
    
    expect(result.error.code).toBe('QUERY_TIMEOUT');
    expect(result.partial_result).toBeDefined();
    expect(result.partial_result.upstream).toBeDefined();
    expect(result.metadata.completeness).toBe('partial');
  });
  
  it('MUST log all errors with context', async () => {
    await tool.execute({ node: 'non-existent' });
    
    expect(logger.error).toHaveBeenCalledWith(
      'tool_execution_failed',
      expect.objectContaining({
        tool: 'trace_impact',
        input: expect.any(Object),
        error_code: 'NODE_NOT_FOUND',
        execution_time_ms: expect.any(Number)
      })
    );
  });
});
```

### 5.3 Integration Tests

```typescript
// test/integration/end-to-end.test.ts
describe('End-to-End Workflows', () => {
  
  it('DEBUG workflow: Complete debug session within budget', async () => {
    const session = new AgentSession();
    let totalTokens = 0;
    const queries = [];
    
    // Query 1: Orient
    const q1 = await session.query('get_context_for_task', {
      task: 'orders failing in production'
    });
    totalTokens += q1.metadata.estimated_tokens;
    queries.push(q1);
    
    // Query 2: Trace data
    const q2 = await session.query('follow_data', {
      object_type: 'Order',
      field: 'status'
    });
    totalTokens += q2.metadata.estimated_tokens;
    queries.push(q2);
    
    // Query 3: Impact analysis
    const q3 = await session.query('trace_impact', {
      node: 'InventoryService.reserve',
      depth: 1
    });
    totalTokens += q3.metadata.estimated_tokens;
    queries.push(q3);
    
    // Assertions
    expect(queries).toHaveLength(3);
    expect(totalTokens).toBeLessThan(4000);  // Entire session under budget!
    
    // Verify progressive disclosure
    expect(q1.metadata.level_provided).toBeGreaterThanOrEqual(1);
    expect(q2.result.relationships).toBeDefined();  // Got Level 2
    
    // Log session
    logger.info('debug_session_complete', {
      queries_executed: 3,
      total_tokens: totalTokens,
      budget_efficiency: totalTokens / 4000,
      resolution_found: true
    });
  });
  
  it('REFACTOR workflow: Assess safety before changes', async () => {
    const result = await session.query('assess_change_risk', {
      target: 'AuthService',
      change_description: 'Replace JWT with session-based auth'
    });
    
    expect(result.result.risk_score).toBeDefined();
    expect(result.result.risk_level).toMatch(/low|medium|high/);
    expect(result.result.safe_to_proceed).toBeBoolean();
    expect(result.result.recommendations.length).toBeGreaterThan(0);
    
    // High risk should block without human review
    if (result.result.risk_score > 70) {
      expect(result.result.safe_to_proceed).toBe(false);
      expect(result.result.recommendations).toContain(
        expect.stringContaining('human review')
      );
    }
  });
});
```

### 5.4 Performance Tests

```typescript
// test/performance/latency.test.ts
describe('Performance Requirements', () => {
  
  it('Simple query MUST complete < 100ms', async () => {
    const start = Date.now();
    await tool.execute({ node: 'auth-service' });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(100);
    
    logger.metric('query_latency', {
      tool: 'trace_impact',
      complexity: 'simple',
      duration_ms: duration,
      within_sla: duration < 100
    });
  });
  
  it('Deep traversal MUST complete < 2s', async () => {
    const start = Date.now();
    await tool.execute({ node: 'core-service', depth: 3 });
    const duration = Date.now() - start;
    
    expect(duration).toBeLessThan(2000);
  });
  
  it('MUST handle 100 concurrent queries', async () => {
    const promises = Array(100).fill(null).map(() =>
      tool.execute({ node: 'auth-service' })
    );
    
    const results = await Promise.all(promises);
    expect(results).toHaveLength(100);
    expect(results.every(r => !r.error)).toBe(true);
  });
});
```

### 5.5 Philosophy Compliance Tests

```typescript
// test/philosophy/intent-based.test.ts
describe('Philosophy: Intent-Based', () => {
  
  it('MUST NOT expose raw graph queries', async () => {
    const tools = getAllTools();
    
    for (const tool of tools) {
      expect(tool.name).not.toContain('query');
      expect(tool.name).not.toContain('cypher');
      expect(tool.name).not.toContain('graph');
    }
  });
  
  it('MUST use action-oriented naming', async () => {
    const tools = getAllTools();
    const actionVerbs = ['find', 'trace', 'assess', 'get', 'follow', 'resolve'];
    
    for (const tool of tools) {
      const hasActionVerb = actionVerbs.some(verb => 
        tool.name.startsWith(verb)
      );
      expect(hasActionVerb).toBe(true);
    }
  });
});

describe('Philosophy: Progressive Disclosure', () => {
  
  it('EVERY tool MUST return 3-level structure', async () => {
    const tools = getAllTools();
    
    for (const tool of tools) {
      const result = await tool.execute(getValidInput(tool));
      
      expect(result.result.summary).toBeDefined();
      expect(result.metadata.level_provided).toBeDefined();
    }
  });
});
```

---

## 6. Logging Specification

### 6.1 Required Log Events

```typescript
// Every tool execution MUST log:
logger.info('tool_execution_started', {
  tool: string,
  input: object,
  timestamp: ISOString,
  request_id: UUID
});

logger.info('tool_execution_completed', {
  tool: string,
  duration_ms: number,
  tokens_used: number,
  level_provided: number,
  completeness: string,
  confidence: number
});

// On truncation:
logger.warn('results_truncated', {
  tool: string,
  reason: 'context_budget' | 'timeout' | 'max_results',
  shown: number,
  total: number,
  budget_remaining: number
});

// On error:
logger.error('tool_execution_failed', {
  tool: string,
  error_code: string,
  error_message: string,
  recoverable: boolean,
  duration_ms: number
});
```

### 6.2 Metrics to Track

```typescript
// Operational metrics
metrics.histogram('tool_latency_ms', duration);
metrics.gauge('active_sessions', sessionCount);
metrics.counter('tool_executions_total', { tool: name });

// Product philosophy metrics
metrics.histogram('tokens_per_query', tokenCount);
metrics.ratio('truncation_rate', truncatedCount / totalCount);
metrics.gauge('avg_confidence_score', avgConfidence);
metrics.histogram('levels_provided', levelCount);

// Business metrics
metrics.counter('debug_sessions_resolved');
metrics.counter('refactors_assessed');
metrics.histogram('time_to_insight_ms', duration);
```

---

## 7. Deployment Checklist

### Pre-Deploy Verification

- [ ] All 8 MVP tools implemented
- [ ] All philosophy compliance tests passing
- [ ] Context budget enforcement working
- [ ] Progressive disclosure verified
- [ ] Error handling tested
- [ ] Logging configured
- [ ] Performance requirements met

### Post-Deploy Monitoring

```bash
# Check truncation rate (should be < 20%)
kubectl logs deployment/codebase-graph | grep "results_truncated" | wc -l

# Check average query latency
kubectl logs deployment/codebase-graph | grep "tool_execution_completed" | jq '.duration_ms' | avg

# Check budget efficiency
kubectl logs deployment/codebase-graph | grep "tokens_per_query" | jq '.value' | avg
```

---

**End of Product-Aligned Implementation Guide**
