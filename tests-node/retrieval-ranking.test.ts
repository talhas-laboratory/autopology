import { describe, expect, it } from 'vitest';
import { scoreRetrievalCandidate } from '../packages/storage-neo4j/src/retrieval.ts';

describe('retrieval ranking', () => {
  it('prefers concrete code symbols over noisy data nodes for generic queries', () => {
    const query = 'mcp configure repo scope';

    const symbol = scoreRetrievalCandidate(query, {
      id: 'sym:typescript:packages/cli/src/mcp-config.ts:Function:buildMcpConfigObject:32',
      labels: ['CodeNode', 'Function'],
      name: 'buildMcpConfigObject',
      qualname: 'buildMcpConfigObject',
      path: 'packages/cli/src/mcp-config.ts',
      summary: 'Build MCP config object for a repo root.',
      priorityScore: 0.66,
      degree: 12,
    });

    const noisyData = scoreRetrievalCandidate(query, {
      id: "data:'find_target',{query:'repo sandboxing path traversal'}",
      labels: ['CodeNode', 'DataObject'],
      name: "'find_target', { query: 'repo sandboxing path traversal symlink escape' }",
      path: '',
      summary: '',
      priorityScore: 0.82,
      degree: 28,
    });

    expect(symbol.score).toBeGreaterThan(noisyData.score);
    expect(symbol.confidence).toBeGreaterThan(noisyData.confidence);
  });

  it('boosts data entities when query explicitly asks for data/field context', () => {
    const query = 'trace data object field order total';

    const dataEntity = scoreRetrievalCandidate(query, {
      id: 'data:order',
      labels: ['CodeNode', 'DataObject'],
      name: 'Order',
      qualname: 'Order',
      path: 'src/models/order.ts',
      summary: 'Order object with subtotal, tax, and total fields.',
      priorityScore: 0.58,
      degree: 9,
    });

    const functionEntity = scoreRetrievalCandidate(query, {
      id: 'sym:typescript:src/services/order.ts:Function:calculateTotal:10',
      labels: ['CodeNode', 'Function'],
      name: 'calculateTotal',
      qualname: 'OrderService.calculateTotal',
      path: 'src/services/order.ts',
      summary: 'Computes total and updates order status.',
      priorityScore: 0.58,
      degree: 9,
    });

    expect(dataEntity.score).toBeGreaterThan(functionEntity.score);
  });
});

