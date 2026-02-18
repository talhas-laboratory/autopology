export interface RetrievalCandidateInput {
  id: string;
  labels: string[];
  name?: string;
  qualname?: string;
  path?: string;
  summary?: string;
  priorityScore?: number;
  degree?: number;
}

export interface RetrievalEvidence {
  lexical: number;
  semantic: number;
  graph: number;
  coverage: number;
}

export interface ScoredRetrievalCandidate extends RetrievalCandidateInput {
  score: number;
  confidence: number;
  evidence: RetrievalEvidence;
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'to',
  'with',
  'this',
  'these',
  'those',
  'into',
  'through',
  'across',
  'task',
  'code',
  'module',
  'function',
]);

const TEST_HINTS = new Set(['test', 'tests', 'spec', 'specs', 'coverage']);

export function tokenizeSearchQuery(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const lowered = normalize(input);
  for (const raw of lowered.split(/[^a-z0-9]+/g)) {
    const tok = raw.trim();
    if (!tok || tok.length < 2 || STOPWORDS.has(tok) || seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

export function scoreRetrievalCandidate(query: string, candidate: RetrievalCandidateInput): ScoredRetrievalCandidate {
  const queryNorm = normalize(query);
  const queryTokens = tokenizeSearchQuery(queryNorm);
  const name = normalize(String(candidate.name || ''));
  const qualname = normalize(String(candidate.qualname || ''));
  const relPath = normalize(String(candidate.path || ''));
  const summary = normalize(String(candidate.summary || ''));
  const doc = [name, qualname, relPath, summary].filter(Boolean).join(' ');
  const docTokens = tokenizeSearchQuery(doc);

  const lexical = lexicalScore(queryNorm, queryTokens, name, qualname, relPath, summary);
  const semantic = semanticScore(queryTokens, docTokens);
  const coverage = tokenCoverage(queryTokens, docTokens);
  const graph = graphScore(candidate, queryTokens);

  let score = clamp01(lexical * 0.5 + semantic * 0.35 + graph * 0.15);
  if (queryTokens.length > 0 && lexical < 0.08 && semantic < 0.18) {
    score *= 0.35;
  }

  const confidence = calibratedConfidence(score, lexical, semantic, coverage);
  return {
    ...candidate,
    score: round(score, 4),
    confidence: round(confidence, 2),
    evidence: {
      lexical: round(lexical, 3),
      semantic: round(semantic, 3),
      graph: round(graph, 3),
      coverage: round(coverage, 3),
    },
  };
}

export function sortScoredCandidates(items: ScoredRetrievalCandidate[]): ScoredRetrievalCandidate[] {
  return [...items].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return String(a.id).localeCompare(String(b.id));
  });
}

export function buildRelevanceNarrative(evidence: RetrievalEvidence): string {
  return `hybrid score (lexical=${fmt(evidence.lexical)}, semantic=${fmt(evidence.semantic)}, graph=${fmt(evidence.graph)}, coverage=${fmt(evidence.coverage)})`;
}

function lexicalScore(
  queryNorm: string,
  queryTokens: string[],
  name: string,
  qualname: string,
  relPath: string,
  summary: string,
): number {
  if (!queryNorm) return 0;

  const fields = [name, qualname, relPath, summary];
  const containsPhrase = fields.some((f) => f.includes(queryNorm)) ? 1 : 0;
  const exactName = name === queryNorm ? 1 : 0;
  const exactQualname = qualname === queryNorm ? 1 : 0;
  const pathSuffix = relPath.endsWith(`/${queryNorm}`) || relPath.endsWith(queryNorm) ? 1 : 0;

  let tokenMatches = 0;
  for (const tok of queryTokens) {
    if (fields.some((f) => f.includes(tok))) tokenMatches += 1;
  }
  const tokenHitRatio = queryTokens.length ? tokenMatches / queryTokens.length : 0;

  return clamp01(
    containsPhrase * 0.4 +
      tokenHitRatio * 0.3 +
      exactName * 0.15 +
      exactQualname * 0.1 +
      pathSuffix * 0.05,
  );
}

function semanticScore(queryTokens: string[], docTokens: string[]): number {
  if (!queryTokens.length || !docTokens.length) return 0;
  const querySet = new Set(queryTokens);
  const docSet = new Set(docTokens);
  let intersection = 0;
  for (const tok of querySet) {
    if (docSet.has(tok)) intersection += 1;
  }
  const union = new Set<string>([...querySet, ...docSet]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  let softSum = 0;
  for (const tok of queryTokens) {
    let best = 0;
    for (const cand of docTokens) {
      const sim = tokenSimilarity(tok, cand);
      if (sim > best) best = sim;
      if (best >= 1) break;
    }
    softSum += best;
  }
  const soft = softSum / queryTokens.length;
  return clamp01(soft * 0.65 + jaccard * 0.35);
}

function graphScore(candidate: RetrievalCandidateInput, queryTokens: string[]): number {
  const priority = clamp01(Number(candidate.priorityScore ?? 0.5));
  const degree = Math.max(0, Number(candidate.degree ?? 0));
  const degreeNorm = 1 - Math.exp(-Math.min(64, degree) / 8);

  let score = clamp01(priority * 0.7 + degreeNorm * 0.3);
  if (candidate.labels.includes('TestCase') && !queryTokens.some((tok) => TEST_HINTS.has(tok))) {
    score = clamp01(score - 0.08);
  }
  return score;
}

function tokenCoverage(queryTokens: string[], docTokens: string[]): number {
  if (!queryTokens.length || !docTokens.length) return 0;
  let hardHits = 0;
  let softHits = 0;
  for (const tok of queryTokens) {
    let best = 0;
    for (const cand of docTokens) {
      const sim = tokenSimilarity(tok, cand);
      if (sim > best) best = sim;
    }
    if (best >= 1) hardHits += 1;
    if (best >= 0.7) softHits += 1;
  }
  const hardRatio = hardHits / queryTokens.length;
  const softRatio = softHits / queryTokens.length;
  return clamp01(hardRatio * 0.7 + softRatio * 0.3);
}

function calibratedConfidence(score: number, lexical: number, semantic: number, coverage: number): number {
  let conf = 0.12 + score * 0.58 + coverage * 0.2 + Math.max(lexical, semantic) * 0.1;
  if (coverage >= 0.9 && lexical >= 0.7) conf += 0.08;
  if (lexical < 0.1 && semantic < 0.2) conf -= 0.15;
  conf = clamp01(conf);
  if (score < 0.2) conf = Math.min(conf, 0.45);
  return Math.max(0.05, conf);
}

function tokenSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 3 && b.startsWith(a)) return 0.86;
  if (b.length >= 3 && a.startsWith(b)) return 0.86;
  return diceCoefficient(a, b);
}

function diceCoefficient(a: string, b: string): number {
  const aTrigrams = trigrams(a);
  const bTrigrams = trigrams(b);
  if (!aTrigrams.length || !bTrigrams.length) return 0;
  const bSet = new Set(bTrigrams);
  let overlap = 0;
  for (const tri of aTrigrams) {
    if (bSet.has(tri)) overlap += 1;
  }
  return clamp01((2 * overlap) / (aTrigrams.length + bTrigrams.length));
}

function trigrams(input: string): string[] {
  const text = `  ${input}  `;
  if (text.length < 3) return [text];
  const out: string[] = [];
  for (let i = 0; i <= text.length - 3; i++) {
    out.push(text.slice(i, i + 3));
  }
  return out;
}

function normalize(input: string): string {
  return input.toLowerCase().trim();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function fmt(n: number): string {
  return round(n, 2).toFixed(2);
}

function round(n: number, digits: number): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}
