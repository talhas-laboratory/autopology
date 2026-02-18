const CHARS_PER_TOKEN = 4;

export function estimateTokens(input: unknown): number {
  const text = typeof input === 'string' ? input : JSON.stringify(input);
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

export function clampTokens(tokens: number, maxTokens: number): number {
  return Math.max(0, Math.min(tokens, maxTokens));
}
