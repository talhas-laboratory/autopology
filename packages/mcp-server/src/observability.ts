import process from 'node:process';

export interface ToolLogger {
  info(event: string, payload: Record<string, unknown>): void;
  warn(event: string, payload: Record<string, unknown>): void;
  error(event: string, payload: Record<string, unknown>): void;
}

export interface ToolMetrics {
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
  counter(name: string, tags?: Record<string, string>, increment?: number): void;
  ratio(name: string, value: number, tags?: Record<string, string>): void;
}

export interface ToolObservability {
  logger: ToolLogger;
  metrics: ToolMetrics;
}

export class StructuredStderrLogger implements ToolLogger {
  info(event: string, payload: Record<string, unknown>): void {
    this.emit('info', event, payload);
  }

  warn(event: string, payload: Record<string, unknown>): void {
    this.emit('warn', event, payload);
  }

  error(event: string, payload: Record<string, unknown>): void {
    this.emit('error', event, payload);
  }

  private emit(level: 'info' | 'warn' | 'error', event: string, payload: Record<string, unknown>): void {
    try {
      process.stderr.write(
        `${JSON.stringify({
          level,
          event,
          timestamp: new Date().toISOString(),
          ...payload,
        })}\n`,
      );
    } catch {
      // Never fail tool execution due to logging transport issues.
    }
  }
}

export class InMemoryMetrics implements ToolMetrics {
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, number[]>();
  private readonly ratios = new Map<string, number>();

  histogram(name: string, value: number, tags?: Record<string, string>): void {
    if (!Number.isFinite(value)) return;
    const key = metricKey(name, tags);
    const existing = this.histograms.get(key) || [];
    existing.push(value);
    this.histograms.set(key, existing);
  }

  gauge(name: string, value: number, tags?: Record<string, string>): void {
    if (!Number.isFinite(value)) return;
    const key = metricKey(name, tags);
    this.gauges.set(key, value);
  }

  counter(name: string, tags?: Record<string, string>, increment = 1): void {
    if (!Number.isFinite(increment)) return;
    const key = metricKey(name, tags);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + increment);
  }

  ratio(name: string, value: number, tags?: Record<string, string>): void {
    if (!Number.isFinite(value)) return;
    const key = metricKey(name, tags);
    this.ratios.set(key, value);
  }
}

export function sanitizeLogInput(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[DEPTH_LIMIT]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > 200 ? `${value.slice(0, 197)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeLogInput(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/(secret|password|token|api[_-]?key|auth|credential)/i.test(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = sanitizeLogInput(v, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

function metricKey(name: string, tags?: Record<string, string>): string {
  if (!tags || !Object.keys(tags).length) return name;
  const sorted = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b));
  return `${name}:${sorted.map(([k, v]) => `${k}=${v}`).join(',')}`;
}
