import crypto from 'node:crypto';

export function fileId(relPath: string): string {
  return `file:${relPath}`;
}

export function dirId(relPath: string): string {
  const normalized = relPath.replace(/^\/+|\/+$/g, '');
  return normalized ? `dir:${normalized}` : 'dir:.';
}

export function symbolId(
  language: string,
  relPath: string,
  kind: string,
  qualname: string,
  startLine?: number,
): string {
  const base = `sym:${language}:${relPath}:${kind}:${qualname}`;
  return Number.isFinite(startLine) ? `${base}:${startLine}` : base;
}

function stableSerialize(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const body = keys
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(obj[key])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(String(value));
}

export function edgeId(payload: Record<string, unknown>): string {
  const stable = stableSerialize(payload);
  return `e:${crypto.createHash('sha256').update(stable).digest('hex')}`;
}

export function moduleId(name: string): string {
  return `module:${name}`;
}

export function conceptId(name: string): string {
  return `concept:${name.toLowerCase().trim()}`;
}
