export type Completeness = 'complete' | 'partial' | 'truncated' | 'failed';

export interface ProgressiveSummary {
  overview: string;
  metrics: {
    total_count: number;
    shown_count: number;
    estimated_tokens: number;
  };
  key_findings: string[];
}

export interface RelationshipEnvelope<T = unknown> {
  items: T;
  has_more: boolean;
  next_batch?: string;
}

export interface ProgressiveDetails {
  implementation?: string;
  code_snippet?: string;
  full_dependencies?: unknown[];
  [key: string]: unknown;
}

export interface ProgressiveResult<T = unknown> {
  summary: ProgressiveSummary;
  relationships?: RelationshipEnvelope<T>;
  details?: ProgressiveDetails;
}

export interface ProgressiveMetadata {
  confidence: number;
  completeness: Completeness;
  level_provided: 1 | 2 | 3;
  total_available: number;
  returned: number;
  truncation_reason?: 'context_budget' | 'timeout' | 'max_results';
  estimated_tokens: number;
  budget_remaining: number;
  freshness?: {
    indexed_at?: string;
    graph_version?: string;
    commit_hash?: string;
    runtime_updated_at?: string;
    source: 'cache_hot' | 'cache_warm' | 'cache_cold' | 'live';
  };
}

export interface ProgressiveNextSteps {
  expand?: string;
  narrow?: string;
  related_queries?: string[];
}

export interface ProgressiveOutput<T = unknown> {
  result: ProgressiveResult<T>;
  metadata: ProgressiveMetadata;
  next_steps?: ProgressiveNextSteps;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
    suggestion?: string;
    did_you_mean?: string[];
  };
}

export type Direction = 'upstream' | 'downstream' | 'both';

export interface ToolContext {
  requestId: string;
  repoRoot: string;
  includeDetails?: boolean;
}

export interface CacheEntry<T = unknown> {
  key: string;
  value: T;
  freshnessStamp: string;
  storedAt: number;
  ttlMs: number;
  nodeIds?: string[];
}

export interface WarmCacheProvider {
  get<T>(key: string, freshnessStamp: string): Promise<T | null>;
  set<T>(key: string, freshnessStamp: string, value: T, ttlMs: number, nodeIds?: string[]): Promise<void>;
  invalidateByNodes(nodeIds: string[]): Promise<void>;
}
