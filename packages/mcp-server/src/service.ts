import crypto from 'node:crypto';
import {
  buildProgressiveOutput,
  CacheManager,
  ContextBudgetManager,
  estimateTokens,
  type AutopologyConfig,
  type ProgressiveOutput,
} from '@autopology/core';
import { GraphRepository, Neo4jWarmCache } from '@autopology/storage-neo4j';
import {
  InMemoryMetrics,
  sanitizeLogInput,
  StructuredStderrLogger,
  type ToolLogger,
  type ToolMetrics,
  type ToolObservability,
} from './observability.js';

interface FreshnessMeta {
  indexed_at?: string;
  graph_version?: string;
  commit_hash?: string;
  runtime_updated_at?: string;
  source: 'cache_hot' | 'cache_warm' | 'cache_cold' | 'live';
}

type RepositoryFreshness = Awaited<ReturnType<GraphRepository['getFreshness']>>;

export class ToolService {
  readonly cache: CacheManager;
  readonly logger: ToolLogger;
  readonly metrics: ToolMetrics;
  private activeSessions = 0;
  private totalExecutions = 0;
  private truncatedExecutions = 0;
  private confidenceTotal = 0;
  private freshnessInFlight: Promise<RepositoryFreshness> | null = null;

  constructor(
    private readonly repo: GraphRepository,
    cfg: AutopologyConfig,
    repoRoot: string,
    cache?: CacheManager,
    observability?: Partial<ToolObservability>,
  ) {
    this.logger = observability?.logger || new StructuredStderrLogger();
    this.metrics = observability?.metrics || new InMemoryMetrics();

    if (cache) {
      this.cache = cache;
      return;
    }
    const warm = new Neo4jWarmCache(repo.ctx);
    this.cache = new CacheManager(repoRoot, warm, cfg.cache);
  }

  async warmUp(): Promise<void> {
    await Promise.allSettled([this.getFreshnessCached(true), this.repo.getMeta()]);
  }

  async findTarget(query: string, context?: string, includeDetails?: boolean): Promise<ProgressiveOutput> {
    return this.runTool('find_target', { query, context, include_details: includeDetails }, async () => {
      const cacheKey = this.key('find_target', { query, context, includeDetails });
      return this.cached(cacheKey, async (freshness) => {
        const budget = new ContextBudgetManager();
        const matches = await this.repo.findTarget(query, 40);
        const fit = fitByBudget(matches, budget, 40);
        const relationships = fit.items.length
          ? {
              items: fit.items,
              has_more: fit.hasMore,
              next_batch: fit.hasMore ? `tool://find_target?query=${encodeURIComponent(query)}&k=50` : undefined,
            }
          : undefined;
        const detailsPayload = { implementation: JSON.stringify(matches, null, 2) };
        const details = maybeDetails(includeDetails, detailsPayload, budget);

        const truncated =
          fit.hasMore ||
          (matches.length > 0 && !relationships) ||
          (Boolean(includeDetails) && !details);

        const summary = {
          overview: `Found ${matches.length} possible targets for "${query}".`,
          metrics: {
            total_count: matches.length,
            shown_count: fit.items.length,
            estimated_tokens: estimateTokens(fit.items),
          },
          key_findings: [
            matches[0] ? `Top hit: ${String(matches[0].name)}` : 'No direct matches found',
            describeConfidenceEvidence(matches[0]) || 'Evidence scoring unavailable for top hit.',
            context ? `Context considered: ${context}` : 'No context hint provided',
            truncated ? 'Results were budget-limited; use next_steps to expand.' : 'All matches included in current level.',
          ],
        };
        budget.trackUsage(estimateTokens(summary));

        return buildProgressiveOutput({
          summary,
          relationships,
          details,
          confidence: aggregateItemConfidence(fit.items as unknown[], matches.length ? 0.4 : 0.25),
          totalAvailable: matches.length,
          returned: fit.items.length,
          budget,
          completeness: truncated ? 'truncated' : matches.length ? 'complete' : 'partial',
          truncationReason: truncated ? 'context_budget' : undefined,
          nextSteps: {
            expand: `tool://find_target?query=${encodeURIComponent(query)}&include_details=true`,
            narrow: `tool://find_target?query=${encodeURIComponent(query.split(' ')[0] || query)}`,
            related_queries: ['get_context_for_task', 'trace_impact'],
          },
          freshness,
        });
      });
    });
  }

  async findFileExact(filePath: string, includeDetails?: boolean): Promise<ProgressiveOutput> {
    return this.runTool('find_file_exact', { path: filePath, include_details: includeDetails }, async () => {
      const cacheKey = this.key('find_file_exact', { filePath, includeDetails });
      return this.cached(cacheKey, async (freshness) => {
        const budget = new ContextBudgetManager();
        const result = await this.repo.findFileExact(filePath);
        if (!result) {
          return notFoundOutput(`File not found: ${filePath}`, budget, freshness, 'find_target');
        }

        const summary = {
          overview: `Resolved exact file match for "${filePath}".`,
          metrics: {
            total_count: 1,
            shown_count: 1,
            estimated_tokens: estimateTokens(result),
          },
          key_findings: [
            `Path: ${String(result.path || filePath)}`,
            `Functions: ${String(result.function_count || 0)}`,
            `Linked tests: ${String(result.linked_test_count || 0)}`,
          ],
        };
        budget.trackUsage(estimateTokens(summary));

        const relationships = maybeRelationshipsObject(result, budget);
        const details = maybeDetails(includeDetails, { implementation: JSON.stringify(result, null, 2) }, budget);
        const truncated = (!relationships && Boolean(result)) || (Boolean(includeDetails) && !details);

        return buildProgressiveOutput({
          summary,
          relationships,
          details,
          confidence: Number(result.confidence || 0.88),
          totalAvailable: 1,
          returned: relationships ? 1 : 0,
          budget,
          completeness: truncated ? 'truncated' : 'complete',
          truncationReason: truncated ? 'context_budget' : undefined,
          nextSteps: {
            related_queries: ['find_tests_by_path', 'trace_impact'],
          },
          freshness,
        });
      });
    });
  }

  async getModuleBoundary(module: string, depth = 1, includeDetails?: boolean): Promise<ProgressiveOutput> {
    return this.runTool('get_module_boundary', { module, depth, include_details: includeDetails }, async () => {
      const cacheKey = this.key('get_module_boundary', { module, depth, includeDetails });
      return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const boundary = await this.repo.getModuleBoundary(module);
      if (!boundary) {
        return notFoundOutput(`Module not found: ${module}`, budget, freshness, 'find_target');
      }

      const deps = (boundary.dependencies as string[]) || [];
      const dependents = (boundary.dependents as string[]) || [];
      const publicApi = (boundary.public_api as string[]) || [];

      const summary = {
        overview: `Module ${module} has ${deps.length} dependencies and ${dependents.length} dependents.`,
        metrics: {
          total_count: deps.length + dependents.length + publicApi.length,
          shown_count: Math.min(20, deps.length + dependents.length + publicApi.length),
          estimated_tokens: estimateTokens(boundary),
        },
        key_findings: [
          `Public API count: ${publicApi.length}`,
          `Dependencies: ${deps.length}`,
          `Dependents: ${dependents.length}`,
        ],
      };
      budget.trackUsage(estimateTokens(summary));

      const relItems = {
        public_api: publicApi,
        dependencies: deps,
        dependents,
      };
      const relationships = maybeRelationshipsObject(relItems, budget);
      const detailsPayload = { implementation: JSON.stringify(boundary, null, 2) };
      const details = maybeDetails(includeDetails, detailsPayload, budget);
      const truncated =
        (deps.length + dependents.length + publicApi.length > 0 && !relationships) ||
        (Boolean(includeDetails) && !details);

        return buildProgressiveOutput({
        summary,
        relationships,
        details,
        confidence: 0.82,
        totalAvailable: deps.length + dependents.length + publicApi.length,
        returned: relationships ? deps.length + dependents.length + publicApi.length : 0,
        budget,
        completeness: truncated ? 'truncated' : 'complete',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          expand: `view://dependency/module:${module}`,
          related_queries: ['trace_impact', 'assess_change_risk'],
        },
        freshness,
        });
      });
    });
  }

  async traceImpact(
    node: string,
    depth = 2,
    direction: 'upstream' | 'downstream' | 'both' = 'both',
    includeDetails?: boolean,
  ): Promise<ProgressiveOutput> {
    return this.runTool('trace_impact', { node, depth, direction, include_details: includeDetails }, async () => {
      const cacheKey = this.key('trace_impact', { node, depth, direction, includeDetails });
      return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const impact = await this.repo.traceImpact(node, depth, direction);

      const combined = [...impact.upstream, ...impact.downstream];
      const fit = fitByBudget(combined, budget, 45);
      const fitItems = {
        upstream: fit.items.filter((x) => impact.upstream.some((u) => u.id === (x as Record<string, unknown>).id)),
        downstream: fit.items.filter((x) => impact.downstream.some((d) => d.id === (x as Record<string, unknown>).id)),
      };

      const summary = {
        overview: `${node} has ${impact.upstream.length} upstream and ${impact.downstream.length} downstream dependencies.`,
        metrics: {
          total_count: combined.length,
          shown_count: fit.items.length,
          estimated_tokens: estimateTokens(fit.items),
        },
        key_findings: [
          `Blast radius: ${combined.length} nodes`,
          `Direction: ${direction}`,
          `Depth: ${depth}`,
        ],
      };
      budget.trackUsage(estimateTokens(summary));

      const relationships = fit.items.length
        ? {
            items: fitItems,
            has_more: fit.hasMore,
            next_batch: fit.hasMore ? `tool://trace_impact?node=${encodeURIComponent(node)}&depth=${depth + 1}` : undefined,
          }
        : undefined;
      const detailsPayload = { full_dependencies: combined };
      const details = maybeDetails(includeDetails, detailsPayload, budget);
      const truncated =
        fit.hasMore ||
        (combined.length > 0 && !relationships) ||
        (Boolean(includeDetails) && !details);

        return buildProgressiveOutput({
        summary,
        relationships,
        details,
        confidence: combined.length ? 0.84 : 0.5,
        totalAvailable: combined.length,
        returned: fit.items.length,
        budget,
        completeness: truncated ? 'truncated' : 'complete',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          expand: `tool://trace_impact?node=${encodeURIComponent(node)}&depth=${Math.min(3, depth + 1)}`,
          narrow: `tool://trace_impact?node=${encodeURIComponent(node)}&depth=1`,
          related_queries: ['assess_change_risk', 'get_tests_for_function'],
        },
        freshness,
        });
      });
    });
  }

  async followData(
    objectType: string,
    field?: string,
    includeDetails?: boolean,
    instanceId?: string,
    trackPersistence?: boolean,
  ): Promise<ProgressiveOutput> {
    return this.runTool(
      'follow_data',
      {
        object_type: objectType,
        field,
        include_details: includeDetails,
        instance_id: instanceId,
        track_persistence: Boolean(trackPersistence),
      },
      async () => {
        const cacheKey = this.key('follow_data', {
          objectType,
          field,
          includeDetails,
          instanceId,
          trackPersistence: Boolean(trackPersistence),
        });
        return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const flows = await this.repo.followData(objectType, field, {
        instanceId,
        trackPersistence: Boolean(trackPersistence),
      });
      const ranked = [...flows].sort((a, b) => {
        const c = Number((b.confidence as number) || 0) - Number((a.confidence as number) || 0);
        if (c !== 0) return c;
        return Number((a.line as number) || 0) - Number((b.line as number) || 0);
      });
      const fit = fitByBudget(ranked, budget, 50);
      const persistenceCount = ranked.filter((step) => Boolean((step as Record<string, unknown>).persistence)).length;
      const instanceMatchedCount = ranked.filter((step) => Boolean((step as Record<string, unknown>).instance_match)).length;
      const directCount = ranked.filter((step) => String((step as Record<string, unknown>).trace_kind || 'direct') === 'direct').length;
      const inferredCount = Math.max(0, ranked.length - directCount);
      const flowKinds = new Set(
        ranked
          .map((step) => String((step as Record<string, unknown>).transform || '').toUpperCase())
          .filter(Boolean),
      );
      const coverageKinds = ['READ', 'WRITE', 'TRANSFORM'].filter((kind) => flowKinds.has(kind)).length;

      const hasPartial = ranked.some(
        (step) => Boolean((step as Record<string, unknown>).partial_trace) || Number((step as Record<string, unknown>).confidence || 0) < 0.75,
      );
      const summary = {
        overview: `Traced ${ranked.length} data-flow steps for ${objectType}${field ? `.${field}` : ''}.`,
        metrics: {
          total_count: ranked.length,
          shown_count: fit.items.length,
          estimated_tokens: estimateTokens(fit.items),
        },
        key_findings: [
          `Top confidence: ${ranked[0] ? Number((ranked[0].confidence as number) || 0).toFixed(2) : 'n/a'}`,
          `Direct steps: ${directCount}, inferred steps: ${inferredCount}.`,
          `Flow coverage: ${coverageKinds}/3 core operations detected.`,
          `Includes transforms: ${ranked.some((x) => String((x as Record<string, unknown>).transform || '').toUpperCase() === 'TRANSFORM') ? 'yes' : 'no'}`,
          trackPersistence ? `Persistence steps: ${persistenceCount}` : 'Persistence tracking disabled.',
          instanceId ? `Instance filter matches: ${instanceMatchedCount}` : 'No instance filter applied.',
          hasPartial ? 'Partial trace segments detected.' : 'Trace confidence is stable.',
        ],
      };
      budget.trackUsage(estimateTokens(summary));

      const relationships = fit.items.length
        ? {
            items: fit.items,
            has_more: fit.hasMore,
            next_batch: fit.hasMore
              ? `tool://follow_data?object_type=${encodeURIComponent(objectType)}&field=${encodeURIComponent(field || '')}&instance_id=${encodeURIComponent(instanceId || '')}&track_persistence=${Boolean(trackPersistence)}`
              : undefined,
          }
        : undefined;
      const detailsPayload = { full_dependencies: ranked };
      const details = maybeDetails(includeDetails, detailsPayload, budget);
      const truncated =
        fit.hasMore ||
        (ranked.length > 0 && !relationships) ||
        (Boolean(includeDetails) && !details);

          return buildProgressiveOutput({
        summary,
        relationships,
        details,
        confidence: calibrateFollowDataConfidence(ranked as Array<Record<string, unknown>>),
        totalAvailable: ranked.length,
        returned: fit.items.length,
        budget,
        completeness: truncated ? 'truncated' : ranked.length ? 'complete' : 'partial',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          expand: `tool://follow_data?object_type=${encodeURIComponent(objectType)}&field=${encodeURIComponent(field || '')}&instance_id=${encodeURIComponent(instanceId || '')}&track_persistence=${Boolean(trackPersistence)}&include_details=true`,
          narrow: field
            ? `tool://follow_data?object_type=${encodeURIComponent(objectType)}&field=${encodeURIComponent(field)}&instance_id=${encodeURIComponent(instanceId || '')}`
            : undefined,
          related_queries: ['trace_impact', 'get_context_for_task'],
        },
        freshness,
          });
        });
      },
    );
  }

  async assessChangeRisk(target: string, changeDescription: string): Promise<ProgressiveOutput> {
    return this.runTool('assess_change_risk', { target, change_description: changeDescription }, async () => {
      const cacheKey = this.key('assess_change_risk', { target, changeDescription });
      return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const result = await this.repo.assessChangeRisk(target, changeDescription);
      const summary = {
        overview: `Risk for "${target}": ${result.risk_level} (${result.risk_score}/100).`,
        metrics: {
          total_count: 3,
          shown_count: 3,
          estimated_tokens: estimateTokens(result),
        },
        key_findings: [
          `Blast radius factor: ${String(result.factors && (result.factors as Record<string, unknown>).blast_radius)}`,
          `Complexity: ${String(result.factors && (result.factors as Record<string, unknown>).change_complexity)}`,
          `Runtime hotspot: ${String(result.factors && (result.factors as Record<string, unknown>).runtime_hotspot || 'unknown')}`,
        ],
      };
      budget.trackUsage(estimateTokens(summary));
      const relationships = maybeRelationshipsObject(result, budget);
      const truncated = !relationships;

        return buildProgressiveOutput({
        summary,
        relationships,
        confidence: 0.76,
        totalAvailable: 1,
        returned: relationships ? 1 : 0,
        budget,
        completeness: truncated ? 'truncated' : 'complete',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          related_queries: ['trace_impact', 'get_tests_for_function'],
        },
        freshness,
        });
      });
    });
  }

  async resolveConcept(concept: string): Promise<ProgressiveOutput> {
    return this.runTool('resolve_concept', { concept }, async () => {
      const cacheKey = this.key('resolve_concept', { concept });
      return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const result = await this.repo.resolveConcept(concept);
      const impl = (result.implementations as Record<string, unknown>[]) || [];
      const fit = fitByBudget(impl, budget, 45);

      const summary = {
        overview: `Resolved concept "${concept}" to ${impl.length} candidate implementations.`,
        metrics: {
          total_count: impl.length,
          shown_count: fit.items.length,
          estimated_tokens: estimateTokens(fit.items),
        },
        key_findings: [
          impl[0] ? `Primary candidate: ${String(impl[0].location)}` : 'No direct implementation found.',
          describeConfidenceEvidence(impl[0]) || 'Evidence scoring unavailable for primary candidate.',
          fit.hasMore ? 'More candidates available.' : 'Candidate list fully returned.',
          'Use trace_impact for change safety before editing.',
        ],
      };
      budget.trackUsage(estimateTokens(summary));

      const relationships = fit.items.length
        ? {
            items: fit.items,
            has_more: fit.hasMore,
          }
        : undefined;
      const truncated = fit.hasMore || (impl.length > 0 && !relationships);

        return buildProgressiveOutput({
        summary,
        relationships,
        confidence: aggregateItemConfidence(fit.items as unknown[], impl.length ? 0.38 : 0.2),
        totalAvailable: impl.length,
        returned: fit.items.length,
        budget,
        completeness: truncated ? 'truncated' : impl.length ? 'complete' : 'partial',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          related_queries: ['find_target', 'follow_data'],
        },
        freshness,
        });
      });
    });
  }

  async getTestsForFunction(functionName: string): Promise<ProgressiveOutput> {
    return this.runTool('get_tests_for_function', { function: functionName }, async () => {
      const cacheKey = this.key('get_tests_for_function', { functionName });
      return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const result = await this.repo.getTestsForFunction(functionName);
      const unit = (result.unit_tests as Record<string, unknown>[]) || [];
      const fit = fitByBudget(unit, budget, 35);

      const summary = {
        overview: `Found ${unit.length} tests for ${functionName}.`,
        metrics: {
          total_count: unit.length,
          shown_count: fit.items.length,
          estimated_tokens: estimateTokens(result),
        },
        key_findings: [
          unit[0] ? `Top test: ${String(unit[0].file)}` : 'No direct test mapping found.',
          `Suggested runs: ${(result.suggested_tests_to_run as string[]).length}`,
          unit.length ? 'Coverage links available.' : 'Add test binding metadata for stronger confidence.',
        ],
      };
      budget.trackUsage(estimateTokens(summary));

      const relationships = fit.items.length
        ? {
            items: {
              ...result,
              unit_tests: fit.items,
              suggested_tests_to_run: fit.items.map((x) => String((x as Record<string, unknown>).file || '')).filter(Boolean),
            },
            has_more: fit.hasMore,
          }
        : undefined;
      const truncated = fit.hasMore || (unit.length > 0 && !relationships);

        return buildProgressiveOutput({
        summary,
        relationships,
        confidence: unit.length ? 0.81 : 0.45,
        totalAvailable: unit.length,
        returned: fit.items.length,
        budget,
        completeness: truncated ? 'truncated' : unit.length ? 'complete' : 'partial',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          related_queries: ['trace_impact', 'assess_change_risk'],
        },
        freshness,
        });
      });
    });
  }

  async findTestsByPath(filePath: string, includeDetails?: boolean): Promise<ProgressiveOutput> {
    return this.runTool('find_tests_by_path', { path: filePath, include_details: includeDetails }, async () => {
      const cacheKey = this.key('find_tests_by_path', { filePath, includeDetails });
      return this.cached(cacheKey, async (freshness) => {
        const budget = new ContextBudgetManager();
        const result = await this.repo.findTestsByPath(filePath);
        const tests = (result.tests as Record<string, unknown>[]) || [];
        const fit = fitByBudget(tests, budget, 30);

        const summary = {
          overview: `Found ${tests.length} tests linked to ${filePath}.`,
          metrics: {
            total_count: tests.length,
            shown_count: fit.items.length,
            estimated_tokens: estimateTokens(tests),
          },
          key_findings: [
            result.matched_file ? `Matched file: ${String((result.matched_file as Record<string, unknown>).path || filePath)}` : 'No exact file match.',
            tests[0] ? `Top linked test: ${String((tests[0] as Record<string, unknown>).file || 'n/a')}` : 'No linked tests found.',
            fit.hasMore ? 'More linked tests available.' : 'Returned linked tests are complete.',
          ],
        };
        budget.trackUsage(estimateTokens(summary));

        const relationships = fit.items.length
          ? {
              items: {
                ...result,
                tests: fit.items,
                suggested_tests_to_run: fit.items
                  .map((x) => String((x as Record<string, unknown>).file || ''))
                  .filter(Boolean),
              },
              has_more: fit.hasMore,
            }
          : undefined;
        const details = maybeDetails(includeDetails, { implementation: JSON.stringify(result, null, 2) }, budget);
        const truncated = fit.hasMore || (tests.length > 0 && !relationships) || (Boolean(includeDetails) && !details);

        return buildProgressiveOutput({
          summary,
          relationships,
          details,
          confidence: tests.length ? 0.8 : 0.5,
          totalAvailable: tests.length,
          returned: fit.items.length,
          budget,
          completeness: truncated ? 'truncated' : tests.length ? 'complete' : 'partial',
          truncationReason: truncated ? 'context_budget' : undefined,
          nextSteps: {
            related_queries: ['find_file_exact', 'trace_impact', 'assess_change_risk'],
          },
          freshness,
        });
      });
    });
  }

  async getContextForTask(task: string, currentFocus?: string): Promise<ProgressiveOutput> {
    return this.runTool('get_context_for_task', { task, current_focus: currentFocus }, async () => {
      const cacheKey = this.key('get_context_for_task', { task, currentFocus });
      return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const result = await this.repo.getContextForTask(task, currentFocus);

      const summary = {
        overview: `Context bundle prepared for task: ${task}`,
        metrics: {
          total_count: ((result.resources as unknown[]) || []).length,
          shown_count: ((result.resources as unknown[]) || []).length,
          estimated_tokens: estimateTokens(result),
        },
        key_findings: [
          `Suggested tools: ${(result.tools_to_call as unknown[]).length}`,
          currentFocus ? `Current focus honored: ${currentFocus}` : 'No current focus specified.',
          'Bundle optimized for <=4k token planning.',
        ],
      };
      budget.trackUsage(estimateTokens(summary));
      const relationships = maybeRelationshipsObject(result, budget);
      const truncated = !relationships && ((result.resources as unknown[]) || []).length > 0;

        return buildProgressiveOutput({
        summary,
        relationships,
        confidence: 0.79,
        totalAvailable: ((result.resources as unknown[]) || []).length,
        returned: relationships ? ((result.resources as unknown[]) || []).length : 0,
        budget,
        completeness: truncated ? 'truncated' : 'complete',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          related_queries: ['find_target', 'trace_impact', 'assess_change_risk'],
        },
        freshness,
        });
      });
    });
  }

  async understandCodebase(includeDetails?: boolean): Promise<ProgressiveOutput> {
    return this.runTool('understand_codebase', { include_details: includeDetails }, async () => {
      const cacheKey = this.key('understand_codebase', { includeDetails });
      return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const result = await this.repo.understandCodebase();

      const modules = (result.layers as string[]) || [];
      const concepts = (result.key_concepts as string[]) || [];
      const entries = (result.entry_points as string[]) || [];

      const summary = {
        overview: `Codebase orientation: ${String(result.domain || 'application codebase')}.`,
        metrics: {
          total_count: modules.length + concepts.length + entries.length,
          shown_count: modules.length + concepts.length + entries.length,
          estimated_tokens: estimateTokens(result),
        },
        key_findings: [
          `Layers detected: ${modules.join(', ') || 'none inferred'}`,
          `Key concepts: ${concepts.slice(0, 5).join(', ') || 'none inferred'}`,
          `Entry points: ${entries.slice(0, 3).join(', ') || 'none inferred'}`,
        ],
      };
      budget.trackUsage(estimateTokens(summary));

      const relationships = maybeRelationshipsObject(result, budget);
      const details = maybeDetails(includeDetails, { implementation: JSON.stringify(result, null, 2) }, budget);
      const truncated = (entries.length > 0 && !relationships) || (Boolean(includeDetails) && !details);

        return buildProgressiveOutput({
        summary,
        relationships,
        details,
        confidence: 0.78,
        totalAvailable: modules.length + concepts.length + entries.length,
        returned: relationships ? modules.length + concepts.length + entries.length : 0,
        budget,
        completeness: truncated ? 'truncated' : 'complete',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          related_queries: ['find_target', 'get_context_for_task', 'trace_impact'],
        },
        freshness,
        });
      });
    });
  }

  async executionReality(functionName: string, lookback = '30min', includeDetails?: boolean): Promise<ProgressiveOutput> {
    return this.runTool(
      'execution_reality',
      { function_name: functionName, lookback, include_details: includeDetails },
      async () => {
        const cacheKey = this.key('execution_reality', { functionName, lookback, includeDetails });
        return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const result = await this.repo.executionReality(functionName, lookback);

      const calledBy = (result.called_by as unknown[]) || [];
      const callsTo = (result.calls_to as unknown[]) || [];
      const hotspots = (result.hotspots as unknown[]) || [];
      const totalItems = calledBy.length + callsTo.length + hotspots.length;

      const summary = {
        overview: `Execution reality for ${functionName} over ${lookback}.`,
        metrics: {
          total_count: totalItems,
          shown_count: totalItems,
          estimated_tokens: estimateTokens(result),
        },
        key_findings: [
          `Samples: ${String(result.samples || 0)}`,
          `Avg duration: ${String(result.avg_duration_ms || 0)}ms`,
          `Error rate: ${String(result.error_rate || 0)}`,
        ],
      };
      budget.trackUsage(estimateTokens(summary));

      const relationships = maybeRelationshipsObject(result, budget);
      const details = maybeDetails(includeDetails, { implementation: JSON.stringify(result, null, 2) }, budget);
      const truncated = (totalItems > 0 && !relationships) || (Boolean(includeDetails) && !details);

          const output = buildProgressiveOutput({
        summary,
        relationships,
        details,
        confidence: Number(result.samples || 0) > 0 ? 0.82 : 0.45,
        totalAvailable: totalItems,
        returned: relationships ? totalItems : 0,
        budget,
        completeness: truncated ? 'truncated' : Number(result.samples || 0) > 0 ? 'complete' : 'partial',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          related_queries: ['trace_impact', 'assess_change_risk', 'query_execution_trace'],
        },
        freshness,
          });
          if (Number(result.samples || 0) <= 0) {
            output.error = {
              code: 'STALE_DATA',
              message: `No recent runtime data found for ${functionName} in lookback ${lookback}.`,
              recoverable: true,
              suggestion: 'Ingest runtime spans (autopology ingest-runtime) or widen lookback.',
            };
          }
          return output;
        });
      },
    );
  }

  async safeRefactorPlan(target: string, changeDescription: string, includeDetails?: boolean): Promise<ProgressiveOutput> {
    return this.runTool(
      'safe_refactor_plan',
      { target, change_description: changeDescription, include_details: includeDetails },
      async () => {
        const cacheKey = this.key('safe_refactor_plan', { target, changeDescription, includeDetails });
        return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const result = await this.repo.safeRefactorPlan(target, changeDescription);
      const impacted = (result.impacted_files as unknown[]) || [];

      const summary = {
        overview: `Safe refactor plan for ${target} (${String(result.risk_level || 'unknown')} risk).`,
        metrics: {
          total_count: impacted.length,
          shown_count: impacted.length,
          estimated_tokens: estimateTokens(result),
        },
        key_findings: [
          `Files to modify: ${String(result.files_to_modify || impacted.length)}`,
          `Risk score: ${String(result.risk_score || 'n/a')}`,
          `Safe to proceed: ${String(result.safe_to_proceed)}`,
        ],
      };
      budget.trackUsage(estimateTokens(summary));

      const relationships = maybeRelationshipsObject(result, budget);
      const details = maybeDetails(includeDetails, { implementation: JSON.stringify(result, null, 2) }, budget);
      const truncated = (impacted.length > 0 && !relationships) || (Boolean(includeDetails) && !details);

          return buildProgressiveOutput({
        summary,
        relationships,
        details,
        confidence: 0.8,
        totalAvailable: impacted.length,
        returned: relationships ? impacted.length : 0,
        budget,
        completeness: truncated ? 'truncated' : 'complete',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          related_queries: ['trace_impact', 'get_tests_for_function', 'execution_reality'],
        },
        freshness,
          });
        });
      },
    );
  }

  async generateContextForLlm(targetNodes: string[], includeDetails?: boolean): Promise<ProgressiveOutput> {
    return this.runTool('generate_context_for_llm', { target_nodes: targetNodes, include_details: includeDetails }, async () => {
      const cacheKey = this.key('generate_context_for_llm', { targetNodes, includeDetails });
      return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const result = await this.repo.generateContextForLlm(targetNodes);
      const nodes = (result.target_nodes as unknown[]) || [];

      const summary = {
        overview: `Generated compact LLM context for ${nodes.length} target nodes.`,
        metrics: {
          total_count: nodes.length,
          shown_count: nodes.length,
          estimated_tokens: estimateTokens(result),
        },
        key_findings: [
          nodes[0] ? `Primary target: ${String((nodes[0] as Record<string, unknown>).name || (nodes[0] as Record<string, unknown>).id)}` : 'No target mapped.',
          `Resources attached: ${((result.resources as unknown[]) || []).length}`,
          'Context optimized for decision-first agent loops.',
        ],
      };
      budget.trackUsage(estimateTokens(summary));

      const relationships = maybeRelationshipsObject(result, budget);
      const details = maybeDetails(includeDetails, { implementation: JSON.stringify(result, null, 2) }, budget);
      const truncated = (nodes.length > 0 && !relationships) || (Boolean(includeDetails) && !details);

        return buildProgressiveOutput({
        summary,
        relationships,
        details,
        confidence: nodes.length ? 0.81 : 0.4,
        totalAvailable: nodes.length,
        returned: relationships ? nodes.length : 0,
        budget,
        completeness: truncated ? 'truncated' : nodes.length ? 'complete' : 'partial',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          related_queries: ['get_context_for_task', 'trace_impact', 'assess_change_risk'],
        },
        freshness,
        });
      });
    });
  }

  async queryExecutionTrace(errorId: string, lookback = '24hour', includeDetails?: boolean): Promise<ProgressiveOutput> {
    return this.runTool(
      'query_execution_trace',
      { error_id: errorId, lookback, include_details: includeDetails },
      async () => {
        const cacheKey = this.key('query_execution_trace', { errorId, lookback, includeDetails });
        return this.cached(cacheKey, async (freshness) => {
      const budget = new ContextBudgetManager();
      const result = await this.repo.queryExecutionTrace(errorId, lookback);
      const traces = (result.traces as unknown[]) || [];
      const fit = fitByBudget(traces, budget, 50);

      const summary = {
        overview: `Execution trace query for "${errorId}" over ${lookback} returned ${traces.length} matches.`,
        metrics: {
          total_count: traces.length,
          shown_count: fit.items.length,
          estimated_tokens: estimateTokens(fit.items),
        },
        key_findings: [
          `Total errors: ${String(result.total_errors || 0)}`,
          traces[0] ? `Top failing callee: ${String((traces[0] as Record<string, unknown>).callee || 'unknown')}` : 'No matching traces.',
          fit.hasMore ? 'Additional traces available.' : 'Returned trace set is complete.',
        ],
      };
      budget.trackUsage(estimateTokens(summary));

      const relationships = fit.items.length
        ? {
            items: {
              ...result,
              traces: fit.items,
            },
            has_more: fit.hasMore,
          }
        : undefined;
      const details = maybeDetails(includeDetails, { implementation: JSON.stringify(result, null, 2) }, budget);
      const truncated =
        fit.hasMore ||
        (traces.length > 0 && !relationships) ||
        (Boolean(includeDetails) && !details);

          const output = buildProgressiveOutput({
        summary,
        relationships,
        details,
        confidence: traces.length ? 0.79 : 0.4,
        totalAvailable: traces.length,
        returned: fit.items.length,
        budget,
        completeness: truncated ? 'truncated' : traces.length ? 'complete' : 'partial',
        truncationReason: truncated ? 'context_budget' : undefined,
        nextSteps: {
          related_queries: ['execution_reality', 'assess_change_risk'],
        },
        freshness,
          });
          if (!traces.length) {
            output.error = {
              code: 'STALE_DATA',
              message: `No matching execution traces for "${errorId}" in lookback ${lookback}.`,
              recoverable: true,
              suggestion: 'Ingest runtime spans or widen lookback.',
            };
          }
          return output;
        });
      },
    );
  }

  private async runTool(
    tool: string,
    input: Record<string, unknown>,
    execute: () => Promise<ProgressiveOutput>,
  ): Promise<ProgressiveOutput> {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    this.activeSessions += 1;
    this.metrics.gauge('active_sessions', this.activeSessions);

    this.logger.info('tool_execution_started', {
      tool,
      input: sanitizeLogInput(input) as Record<string, unknown>,
      timestamp: new Date(startedAt).toISOString(),
      request_id: requestId,
    });

    try {
      const output = await execute();
      const duration = Date.now() - startedAt;
      const tokensUsed = Number(output.metadata.estimated_tokens || 0);
      const confidence = Number(output.metadata.confidence || 0);

      this.totalExecutions += 1;
      this.confidenceTotal += confidence;
      if (output.metadata.completeness === 'truncated') {
        this.truncatedExecutions += 1;
      }

      this.metrics.histogram('tool_latency_ms', duration, { tool });
      this.metrics.counter('tool_executions_total', { tool });
      this.metrics.histogram('tokens_per_query', tokensUsed, { tool });
      this.metrics.histogram('levels_provided', output.metadata.level_provided, { tool });
      this.metrics.gauge('avg_confidence_score', this.confidenceTotal / Math.max(1, this.totalExecutions));
      this.metrics.ratio('truncation_rate', this.truncatedExecutions / Math.max(1, this.totalExecutions));
      this.metrics.histogram('time_to_insight_ms', duration, { tool });
      if (tool === 'assess_change_risk' || tool === 'safe_refactor_plan') {
        this.metrics.counter('refactors_assessed');
      }

      this.logger.info('context_budget_used', {
        tool,
        tokens_used: tokensUsed,
        remaining: output.metadata.budget_remaining,
        request_id: requestId,
      });

      this.logger.info('tool_execution_completed', {
        tool,
        duration_ms: duration,
        tokens_used: tokensUsed,
        level_provided: output.metadata.level_provided,
        completeness: output.metadata.completeness,
        confidence: output.metadata.confidence,
        request_id: requestId,
      });

      if (output.metadata.completeness === 'truncated') {
        this.logger.warn('results_truncated', {
          tool,
          reason: output.metadata.truncation_reason || 'context_budget',
          shown: output.metadata.returned,
          total: output.metadata.total_available,
          budget_remaining: output.metadata.budget_remaining,
          request_id: requestId,
        });
      }

      if (output.error) {
        this.logger.error('tool_execution_failed', {
          tool,
          error_code: output.error.code,
          error_message: output.error.message,
          recoverable: output.error.recoverable,
          duration_ms: duration,
          request_id: requestId,
        });
      }

      return output;
    } catch (error) {
      const duration = Date.now() - startedAt;
      const classified = classifyToolError(error);
      this.metrics.counter('tool_executions_failed_total', { tool, error_code: classified.code });
      this.logger.error('tool_execution_failed', {
        tool,
        error_code: classified.code,
        error_message: classified.message,
        recoverable: classified.recoverable,
        duration_ms: duration,
        request_id: requestId,
      });

      let freshness: FreshnessMeta = { source: 'live' };
      try {
        const f = await this.getFreshnessCached();
        freshness = {
          indexed_at: f.indexedAt,
          graph_version: f.graphVersion,
          commit_hash: f.commitHash,
          runtime_updated_at: f.runtimeUpdatedAt,
          source: 'live',
        };
      } catch {
        // Keep fallback freshness payload.
      }

      return failedOutput(
        classified.code,
        classified.message,
        classified.recoverable,
        classified.suggestion,
        freshness,
      );
    } finally {
      this.activeSessions = Math.max(0, this.activeSessions - 1);
      this.metrics.gauge('active_sessions', this.activeSessions);
    }
  }

  private async cached(
    key: string,
    producer: (freshness: FreshnessMeta) => Promise<ProgressiveOutput>,
  ): Promise<ProgressiveOutput> {
    const freshnessMeta = await this.getFreshnessCached();
    const freshnessStamp = `${freshnessMeta.graphVersion}:${freshnessMeta.indexedAt || 'none'}:${freshnessMeta.commitHash || 'none'}:${freshnessMeta.runtimeUpdatedAt || 'none'}`;

    const found = await this.cache.get<ProgressiveOutput>(key, freshnessStamp);
    if (found.value) {
      return {
        ...found.value,
        metadata: {
          ...found.value.metadata,
          freshness: {
            indexed_at: freshnessMeta.indexedAt,
            graph_version: freshnessMeta.graphVersion,
            commit_hash: freshnessMeta.commitHash,
            runtime_updated_at: freshnessMeta.runtimeUpdatedAt,
            source: found.source === 'hot' ? 'cache_hot' : found.source === 'warm' ? 'cache_warm' : 'cache_cold',
          },
        },
      };
    }

    const output = await producer({
      indexed_at: freshnessMeta.indexedAt,
      graph_version: freshnessMeta.graphVersion,
      commit_hash: freshnessMeta.commitHash,
      runtime_updated_at: freshnessMeta.runtimeUpdatedAt,
      source: 'live',
    });
    await this.cache.set(key, freshnessStamp, output, collectNodeIds(output));
    return output;
  }

  private key(tool: string, args: Record<string, unknown>): string {
    return `${tool}:${crypto.createHash('sha256').update(JSON.stringify(args)).digest('hex')}`;
  }

  private async getFreshnessCached(force = false): Promise<RepositoryFreshness> {
    if (!force && this.freshnessInFlight) {
      return this.freshnessInFlight;
    }

    const pending = this.repo.getFreshness();
    this.freshnessInFlight = pending;
    try {
      return await pending;
    } finally {
      this.freshnessInFlight = null;
    }
  }
}

function fitByBudget<T>(items: T[], budget: ContextBudgetManager, estPerItem: number): { items: T[]; hasMore: boolean } {
  const requested = items.length * estPerItem;
  const check = budget.checkBudget(requested);
  if (check.allowed) {
    budget.trackUsage(requested);
    return { items, hasMore: false };
  }
  const maxItems = Math.max(0, Math.floor(check.allocate / estPerItem));
  if (maxItems <= 0) {
    return { items: [], hasMore: items.length > 0 };
  }
  budget.trackUsage(maxItems * estPerItem);
  return {
    items: items.slice(0, maxItems),
    hasMore: items.length > maxItems,
  };
}

function maybeRelationshipsObject<T>(items: T, budget: ContextBudgetManager): { items: T; has_more: boolean } | undefined {
  const est = estimateTokens(items);
  const check = budget.checkBudget(est);
  if (!check.allowed) return undefined;
  budget.trackUsage(est);
  return { items, has_more: false };
}

function maybeDetails(
  includeDetails: boolean | undefined,
  payload: Record<string, unknown>,
  budget: ContextBudgetManager,
): Record<string, unknown> | undefined {
  if (!includeDetails) return undefined;
  const est = estimateTokens(payload);
  const check = budget.checkBudget(est);
  if (!check.allowed) return undefined;
  budget.trackUsage(est);
  return payload;
}

function notFoundOutput(message: string, budget: ContextBudgetManager, freshness: FreshnessMeta, suggestion: string): ProgressiveOutput {
  return {
    result: {
      summary: {
        overview: message,
        metrics: {
          total_count: 0,
          shown_count: 0,
          estimated_tokens: 20,
        },
        key_findings: [message],
      },
    },
    metadata: {
      confidence: 0.1,
      completeness: 'failed',
      level_provided: 1,
      total_available: 0,
      returned: 0,
      estimated_tokens: 20,
      budget_remaining: Math.max(0, budget.maxTokens - 20),
      freshness,
    },
    error: {
      code: 'NODE_NOT_FOUND',
      message,
      recoverable: true,
      suggestion: `Use ${suggestion} to locate valid targets first.`,
    },
  };
}

function classifyToolError(error: unknown): {
  code: 'PARSE_ERROR' | 'QUERY_TIMEOUT' | 'STALE_DATA' | 'UNHANDLED_EXCEPTION';
  message: string;
  recoverable: boolean;
  suggestion?: string;
} {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const msg = rawMessage.toLowerCase();
  const maybeCode = typeof error === 'object' && error && 'code' in error ? String((error as Record<string, unknown>).code) : '';

  if (maybeCode === 'PARSE_ERROR' || msg.includes('parse') || msg.includes('tree-sitter')) {
    return {
      code: 'PARSE_ERROR',
      message: rawMessage,
      recoverable: true,
      suggestion: 'Check syntax in changed files and retry indexing.',
    };
  }
  if (maybeCode === 'QUERY_TIMEOUT' || msg.includes('timeout') || msg.includes('timed out')) {
    return {
      code: 'QUERY_TIMEOUT',
      message: rawMessage,
      recoverable: true,
      suggestion: 'Reduce depth/filter scope and retry.',
    };
  }
  if (maybeCode === 'STALE_DATA' || msg.includes('stale')) {
    return {
      code: 'STALE_DATA',
      message: rawMessage,
      recoverable: true,
      suggestion: 'Reindex or ingest fresh runtime spans before retrying.',
    };
  }
  return {
    code: 'UNHANDLED_EXCEPTION',
    message: rawMessage,
    recoverable: false,
  };
}

function failedOutput(
  code: 'PARSE_ERROR' | 'QUERY_TIMEOUT' | 'STALE_DATA' | 'UNHANDLED_EXCEPTION',
  message: string,
  recoverable: boolean,
  suggestion: string | undefined,
  freshness: FreshnessMeta,
): ProgressiveOutput {
  const budget = new ContextBudgetManager();
  const estimated = 36;
  return {
    result: {
      summary: {
        overview: `Tool execution failed: ${code}`,
        metrics: {
          total_count: 0,
          shown_count: 0,
          estimated_tokens: estimated,
        },
        key_findings: [message],
      },
    },
    metadata: {
      confidence: 0.05,
      completeness: 'failed',
      level_provided: 1,
      total_available: 0,
      returned: 0,
      estimated_tokens: estimated,
      budget_remaining: Math.max(0, budget.maxTokens - estimated),
      freshness,
    },
    error: {
      code,
      message,
      recoverable,
      suggestion,
    },
  };
}

function aggregateItemConfidence(items: unknown[], fallback: number): number {
  if (!items.length) return fallback;
  const vals = items
    .map((item) => Number((item as Record<string, unknown>).confidence ?? Number.NaN))
    .filter((v) => Number.isFinite(v))
    .map((v) => Math.max(0, Math.min(1, v)));
  if (!vals.length) return fallback;

  const top = Math.max(...vals);
  const mean = avg(vals);
  const blended = 0.2 + top * 0.55 + mean * 0.25;
  return round(Math.max(0.05, Math.min(0.98, blended)), 2);
}

function calibrateFollowDataConfidence(items: Array<Record<string, unknown>>): number {
  if (!items.length) return 0.45;

  const confidences = items
    .map((item) => Number(item.confidence ?? Number.NaN))
    .filter((v) => Number.isFinite(v))
    .map((v) => Math.max(0, Math.min(1, v)));
  const base = confidences.length ? avg(confidences) : 0.45;

  const partialCount = items.filter((item) => Boolean(item.partial_trace)).length;
  const partialRatio = partialCount / Math.max(1, items.length);

  const directCount = items.filter((item) => String(item.trace_kind || 'direct') === 'direct').length;
  const directRatio = directCount / Math.max(1, items.length);
  const inferredRatio = 1 - directRatio;

  const flowKinds = new Set(
    items
      .map((item) => String(item.transform || '').toUpperCase())
      .filter(Boolean),
  );
  const coverageKinds = ['READ', 'WRITE', 'TRANSFORM'].filter((kind) => flowKinds.has(kind)).length;
  const coverage = coverageKinds / 3;

  let conf = 0.18 + base * 0.5 + directRatio * 0.2 + coverage * 0.15 + (1 - partialRatio) * 0.1 - inferredRatio * 0.08;
  if (base < 0.45) conf -= 0.08;
  return round(Math.max(0.05, Math.min(0.95, conf)), 2);
}

function describeConfidenceEvidence(item: unknown): string | null {
  if (!item || typeof item !== 'object') return null;
  const components = (item as Record<string, unknown>).confidence_components;
  if (!components || typeof components !== 'object') return null;

  const parts = components as Record<string, unknown>;
  const lexical = Number(parts.lexical ?? Number.NaN);
  const semantic = Number(parts.semantic ?? Number.NaN);
  const graph = Number(parts.graph ?? Number.NaN);
  const coverage = Number(parts.coverage ?? Number.NaN);
  if (![lexical, semantic, graph, coverage].every((v) => Number.isFinite(v))) return null;

  return `Top evidence: lexical=${fmt2(lexical)}, semantic=${fmt2(semantic)}, graph=${fmt2(graph)}, coverage=${fmt2(coverage)}.`;
}

function avg(items: number[]): number {
  if (!items.length) return 0;
  return items.reduce((a, b) => a + b, 0) / items.length;
}

function fmt2(value: number): string {
  return round(value, 2).toFixed(2);
}

function round(value: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function collectNodeIds(input: unknown): string[] {
  const out = new Set<string>();

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if ((k === 'id' || k === 'node_id' || k === 'source' || k === 'target') && typeof v === 'string') {
        if (v.includes(':')) out.add(v);
      }
      visit(v);
    }
  };

  visit(input);
  return [...out];
}
