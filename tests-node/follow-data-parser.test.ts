import { describe, expect, it } from 'vitest';
import { defaultPlugins } from '../packages/indexer/src/plugins.ts';

function pluginFor(ext: string) {
  const p = defaultPlugins().find((x) => x.supportedExtensions().has(ext));
  if (!p) throw new Error(`plugin not found for ${ext}`);
  return p;
}

describe('follow_data extraction precision', () => {
  it('extracts TS member data-flow without local-variable noise', () => {
    const plugin = pluginFor('.ts');
    const text = [
      'export function calc(order: any) {',
      '  const subtotal = order.subtotal + order.tax;',
      '  order.total = subtotal;',
      '  return order.total;',
      '}',
      '',
    ].join('\n');

    const parsed = plugin.parseFile('/repo', 'src/app.ts', text);
    const flows = parsed.symbols.flatMap((s) => s.dataFlows);

    expect(flows.length).toBeGreaterThan(0);
    expect(flows.every((f) => f.object !== 'local')).toBe(true);
    expect(flows.some((f) => f.action === 'WRITE' && f.object === 'order' && f.field === 'total')).toBe(true);
    expect(flows.some((f) => f.action === 'READ' && f.object === 'order' && f.field === 'subtotal')).toBe(true);
  });

  it('extracts Python assignment/call transforms with partial traces', () => {
    const plugin = pluginFor('.py');
    const text = [
      'def normalize(order):',
      '    order.total = round(order.subtotal + order.tax, 2)',
      '    return order.total',
      '',
    ].join('\n');

    const parsed = plugin.parseFile('/repo', 'src/calc.py', text);
    const flows = parsed.symbols.flatMap((s) => s.dataFlows);

    expect(flows.some((f) => f.action === 'WRITE' && f.object === 'order' && f.field === 'total')).toBe(true);
    expect(flows.some((f) => f.action === 'READ' && f.object === 'order' && f.field === 'subtotal')).toBe(true);
    expect(flows.some((f) => f.action === 'TRANSFORM')).toBe(true);
    expect(flows.some((f) => f.partialTrace)).toBe(true);
  });
});
