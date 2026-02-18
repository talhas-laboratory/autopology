import { describe, expect, it } from 'vitest';
import {
  buildRelevanceNarrative,
  scoreRetrievalCandidate,
  sortScoredCandidates,
  tokenizeSearchQuery,
} from '../packages/storage-neo4j/src/retrieval.ts';

describe('hybrid retrieval scoring', () => {
  it('tokenizes deterministically and removes common stopwords', () => {
    expect(tokenizeSearchQuery('Find the payment retry handler in API')).toEqual([
      'find',
      'payment',
      'retry',
      'handler',
      'api',
    ]);
  });

  it('ranks exact target higher than weak lexical matches', () => {
    const query = 'process payment order';
    const candidates = [
      {
        id: 'sym:typescript:src/payment.ts:Function:processPayment:10',
        labels: ['Function'],
        name: 'processPayment',
        qualname: 'PaymentService.processPayment',
        path: 'src/payment.ts',
        summary: 'Process payment for order and update status',
        priorityScore: 0.92,
        degree: 18,
      },
      {
        id: 'sym:typescript:src/order.ts:Function:listOrders:8',
        labels: ['Function'],
        name: 'listOrders',
        qualname: 'OrderService.listOrders',
        path: 'src/order.ts',
        summary: 'List orders for dashboard page',
        priorityScore: 0.55,
        degree: 4,
      },
      {
        id: 'sym:typescript:tests/payment.test.ts:Function:testProcessPayment:3',
        labels: ['TestCase'],
        name: 'testProcessPayment',
        qualname: 'testProcessPayment',
        path: 'tests/payment.test.ts',
        summary: 'Verifies process payment happy path',
        priorityScore: 0.8,
        degree: 1,
      },
    ];

    const scored = sortScoredCandidates(candidates.map((candidate) => scoreRetrievalCandidate(query, candidate)));
    expect(scored[0].id).toBe('sym:typescript:src/payment.ts:Function:processPayment:10');
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
    expect(scored[0].confidence).toBeGreaterThan(scored[1].confidence);
    expect(scored[0].evidence.lexical).toBeGreaterThanOrEqual(0.3);
    expect(scored[0].evidence.semantic).toBeGreaterThan(0.3);
  });

  it('caps confidence for low-evidence matches', () => {
    const scored = scoreRetrievalCandidate('refund workflow ledger', {
      id: 'sym:typescript:src/cache.ts:Function:evict:1',
      labels: ['Function'],
      name: 'evict',
      qualname: 'CacheService.evict',
      path: 'src/cache.ts',
      summary: 'evict cache key',
      priorityScore: 0.7,
      degree: 12,
    });

    expect(scored.score).toBeLessThan(0.2);
    expect(scored.confidence).toBeLessThanOrEqual(0.45);
  });

  it('formats evidence narrative for explanations', () => {
    const scored = scoreRetrievalCandidate('payment', {
      id: 'sym:typescript:src/payment.ts:Function:process:1',
      labels: ['Function'],
      name: 'processPayment',
      qualname: 'PaymentService.processPayment',
      path: 'src/payment.ts',
      summary: 'process payment order',
      priorityScore: 0.8,
      degree: 7,
    });

    const text = buildRelevanceNarrative(scored.evidence);
    expect(text).toContain('lexical=');
    expect(text).toContain('semantic=');
    expect(text).toContain('graph=');
    expect(text).toContain('coverage=');
  });
});
