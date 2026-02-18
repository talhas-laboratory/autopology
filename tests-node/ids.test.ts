import { describe, expect, it } from 'vitest';
import { dirId, edgeId, fileId, symbolId } from '../packages/core/src/index.ts';

describe('deterministic ids', () => {
  it('builds stable file and dir ids', () => {
    expect(fileId('src/app.ts')).toBe('file:src/app.ts');
    expect(dirId('')).toBe('dir:.');
    expect(dirId('/src/utils/')).toBe('dir:src/utils');
  });

  it('builds stable symbol ids', () => {
    const id1 = symbolId('python', 'src/app.py', 'Function', 'validate_token');
    const id2 = symbolId('python', 'src/app.py', 'Function', 'validate_token');
    expect(id1).toBe(id2);
    expect(id1).toBe('sym:python:src/app.py:Function:validate_token');
  });

  it('keeps parity for line-aware symbol ids', () => {
    const id = symbolId('python', 'src/app.py', 'Function', 'validate_token', 42);
    expect(id).toBe('sym:python:src/app.py:Function:validate_token:42');
  });

  it('builds stable edge hash ids independent of key order', () => {
    const a = edgeId({ s: 'a', d: 'b', t: 'CALLS', p: { x: 1, y: 2 } });
    const b = edgeId({ d: 'b', p: { y: 2, x: 1 }, s: 'a', t: 'CALLS' });
    expect(a).toBe(b);
  });

  it('builds stable edge hash ids for nested payloads', () => {
    const a = edgeId({ s: 'a', d: 'b', t: 'CALLS', p: { x: 1, nested: { alpha: true, beta: [2, 1] } } });
    const b = edgeId({ d: 'b', s: 'a', t: 'CALLS', p: { nested: { beta: [2, 1], alpha: true }, x: 1 } });
    expect(a).toBe(b);
  });
});
