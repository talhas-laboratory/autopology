import { describe, expect, it } from 'vitest';
import { ContextBudgetManager } from '../packages/core/src/index.ts';

describe('context budget manager', () => {
  it('allocates when budget is available', () => {
    const budget = new ContextBudgetManager(4000, 200);
    const check = budget.checkBudget(500);
    expect(check.allowed).toBe(true);
    expect(check.allocate).toBe(500);
  });

  it('requests truncation when budget exceeded', () => {
    const budget = new ContextBudgetManager(4000, 200);
    budget.trackUsage(3700);
    const check = budget.checkBudget(500);
    expect(check.allowed).toBe(false);
    expect(check.truncation_required).toBe(true);
    expect(check.allocate).toBeGreaterThanOrEqual(0);
  });
});
