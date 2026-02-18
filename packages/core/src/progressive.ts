import { ContextBudgetManager } from './budget.js';
import { estimateTokens } from './token.js';
import type {
  ProgressiveMetadata,
  ProgressiveNextSteps,
  ProgressiveOutput,
  ProgressiveResult,
  RelationshipEnvelope,
} from './types.js';

export function buildProgressiveOutput<T = unknown>(opts: {
  summary: ProgressiveResult<T>['summary'];
  relationships?: RelationshipEnvelope<T>;
  details?: ProgressiveResult<T>['details'];
  confidence: number;
  totalAvailable: number;
  returned: number;
  budget: ContextBudgetManager;
  completeness?: ProgressiveMetadata['completeness'];
  truncationReason?: ProgressiveMetadata['truncation_reason'];
  nextSteps?: ProgressiveNextSteps;
  freshness?: ProgressiveMetadata['freshness'];
}): ProgressiveOutput<T> {
  const result: ProgressiveResult<T> = {
    summary: opts.summary,
  };

  if (opts.relationships) {
    result.relationships = opts.relationships;
  }
  if (opts.details) {
    result.details = opts.details;
  }

  const estimatedTokens = estimateTokens(result);
  const levelProvided: 1 | 2 | 3 = opts.details ? 3 : opts.relationships ? 2 : 1;

  const metadata: ProgressiveMetadata = {
    confidence: Math.max(0, Math.min(1, opts.confidence)),
    completeness: opts.completeness || 'complete',
    level_provided: levelProvided,
    total_available: opts.totalAvailable,
    returned: opts.returned,
    truncation_reason: opts.truncationReason,
    estimated_tokens: estimatedTokens,
    budget_remaining: Math.max(0, opts.budget.maxTokens - estimatedTokens),
    freshness: opts.freshness,
  };

  return {
    result,
    metadata,
    next_steps: opts.nextSteps,
  };
}
