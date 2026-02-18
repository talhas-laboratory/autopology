# Codebase Graph System
## Implementation Guide

**Version:** 1.0  
**Date:** 2026-02-18  
**Purpose:** Complete implementation details for building the system

---

## 1. Database Schema (Neo4j)

### 1.1 Node Creation

```cypher
// Create indexes for performance
CREATE INDEX module_name_index FOR (m:Module) ON (m.name);
CREATE INDEX function_name_index FOR (f:Function) ON (f.name);
CREATE INDEX file_path_index FOR (f:File) ON (f.path);
CREATE INDEX concept_name_index FOR (c:Concept) ON (c.name);

// Create constraints
CREATE CONSTRAINT module_id_constraint FOR (m:Module) REQUIRE m.id IS UNIQUE;
CREATE CONSTRAINT function_id_constraint FOR (f:Function) REQUIRE f.id IS UNIQUE;
CREATE CONSTRAINT file_id_constraint FOR (f:File) REQUIRE f.id IS UNIQUE;
CREATE CONSTRAINT concept_id_constraint FOR (c:Concept) REQUIRE c.id IS UNIQUE;
```

### 1.2 Sample Data

```cypher
// Module node
CREATE (m:Module {
  id: "module:auth-service",
  name: "auth-service",
  path: "/src/services/auth",
  language: "typescript",
  lines_of_code: 450,
  test_coverage: 0.87
});

// Function node
CREATE (f:Function {
  id: "func:auth-service:validateToken",
  name: "validateToken",
  signature: "validateToken(token: string): Promise<User>",
  async: true,
  lines: 45
});

// Relationships
MATCH (m:Module {id: "module:auth-service"})
MATCH (f:Function {id: "func:auth-service:validateToken"})
CREATE (m)-[:CONTAINS {line: 45}]->(f);
```

---

## 2. Algorithm Pseudocode

### 2.1 AST Parsing & Graph Building

```python
function BUILD_GRAPH_FROM_FILE(file_path):
    ast = tree_sitter.parse(file_path)
    file_node = CREATE_FILE_NODE(file_path)
    
    for node in ast.root_node:
        if node.type == "import_statement":
            module_name = EXTRACT_MODULE_NAME(node)
            target_module = GET_OR_CREATE_MODULE(module_name)
            CREATE_EDGE(current_module, target_module, 
                       type="IMPORTS", line=node.start_line)
        
        elif node.type == "function_declaration":
            func_node = CREATE_FUNCTION_NODE(
                name=EXTRACT_FUNCTION_NAME(node),
                signature=EXTRACT_SIGNATURE(node)
            )
            CREATE_EDGE(current_module, func_node, type="CONTAINS")
    
    return file_node
```

### 2.2 Impact Analysis

```python
function CALCULATE_IMPACT(target_node, depth=2):
    impact = {upstream: [], downstream: []}
    
    # Find upstream (dependents)
    for node in TRAVERSE_UPSTREAM(target_node, depth):
        impact.upstream.append({
            node: node,
            distance: node.distance,
            criticality: CALCULATE_CRITICALITY(node)
        })
    
    # Calculate metrics
    impact.metrics = {
        total_dependents: len(impact.upstream),
        blast_radius: CALCULATE_BLAST_RADIUS(impact)
    }
    
    return impact
```

### 2.3 Risk Assessment

```python
function ASSESS_CHANGE_RISK(target, change_description):
    factors = {
        blast_radius: CALCULATE_BLAST_RADIUS(target) / 50,
        test_coverage: 1.0 - GET_TEST_COVERAGE(target),
        change_complexity: ANALYZE_COMPLEXITY(change_description),
        recent_changes: GET_RECENT_CHANGE_COUNT(target) / 10
    }
    
    risk_score = (
        factors.blast_radius * 0.4 +
        factors.test_coverage * 0.25 +
        factors.change_complexity * 0.20 +
        factors.recent_changes * 0.15
    ) * 100
    
    return {
        score: risk_score,
        level: "low" if score < 30 else "medium" if score < 70 else "high",
        factors: factors
    }
```

---

## 3. Error Handling

### 3.1 Error Response Format

```json
{
  "error": {
    "code": "QUERY_TIMEOUT",
    "message": "Query exceeded 2 second timeout",
    "recoverable": true,
    "suggestion": "Try reducing depth parameter",
    "partial_result": {
      "returned": 10,
      "total_available": 500
    }
  }
}
```

### 3.2 Error Categories

| Code | Status | Recovery |
|------|--------|----------|
| PARSE_ERROR | 422 | Skip file |
| QUERY_TIMEOUT | 504 | Return partial |
| NODE_NOT_FOUND | 404 | Suggest alternatives |
| STALE_DATA | 409 | Return with warning |

---

## 4. Sample Implementation: trace_impact Tool

```typescript
export class TraceImpactTool implements Tool {
  name = 'trace_impact';
  
  async execute(input: {node: string, depth?: number}) {
    const nodeId = await this.resolveNodeId(input.node);
    
    if (!nodeId) {
      throw new Error(`NODE_NOT_FOUND: ${input.node}`);
    }
    
    const result = await this.performAnalysis(nodeId, input);
    
    return {
      result: {
        target: input.node,
        upstream: result.upstream,
        downstream: result.downstream,
        blast_radius: this.calculateBlastRadius(result)
      },
      metadata: {
        confidence: 0.92,
        estimated_tokens: result.upstream.length * 50
      }
    };
  }
  
  private async performAnalysis(nodeId: string, input: any) {
    const upstream = await this.db.run(`
      MATCH (d)-[:DEPENDS_ON*1..${input.depth}]->(t)
      WHERE t.id = $nodeId
      RETURN d, length(path) as distance
    `, {nodeId});
    
    return {
      upstream: upstream.records.map(r => ({
        name: r.get('d').properties.name,
        distance: r.get('distance')
      }))
    };
  }
}
```

---

## 5. Testing Strategy

### 5.1 Unit Tests

```typescript
// test/tools/trace-impact.test.ts
describe('trace_impact', () => {
  it('should find direct dependents', async () => {
    const result = await tool.execute({
      node: 'auth-service',
      depth: 1
    });
    
    expect(result.upstream).toHaveLength(3);
    expect(result.upstream[0].distance).toBe(1);
  });
  
  it('should return error for non-existent node', async () => {
    await expect(
      tool.execute({node: 'non-existent'})
    ).rejects.toThrow('NODE_NOT_FOUND');
  });
});
```

### 5.2 Integration Tests

```typescript
// test/integration/full-flow.test.ts
describe('Codebase analysis', () => {
  it('should build graph from sample project', async () => {
    await builder.buildFromPath('./fixtures/sample-project');
    
    const moduleCount = await db.count('Module');
    expect(moduleCount).toBeGreaterThan(0);
  });
});
```

---

## 6. Deployment

### 6.1 Docker Configuration

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

EXPOSE 3000

CMD ["node", "dist/server.js"]
```

### 6.2 Environment Variables

```bash
# Database
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=secret

# Server
PORT=3000
LOG_LEVEL=info
MAX_QUERY_TIME_MS=2000

# Analysis
WATCH_FOR_CHANGES=true
UPDATE_ON_GIT_HOOK=true
```

---

**End of Implementation Guide**
