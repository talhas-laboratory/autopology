export interface BudgetCheck {
  allowed: boolean;
  allocate: number;
  remaining: number;
  truncation_required?: boolean;
}

export class ContextBudgetManager {
  readonly maxTokens: number;
  readonly safetyMargin: number;
  private usedTokens = 0;

  constructor(maxTokens = 4000, safetyMargin = 200) {
    this.maxTokens = maxTokens;
    this.safetyMargin = safetyMargin;
  }

  checkBudget(requestedTokens: number): BudgetCheck {
    const available = this.maxTokens - this.usedTokens - this.safetyMargin;
    if (requestedTokens <= available) {
      return {
        allowed: true,
        allocate: Math.max(0, requestedTokens),
        remaining: Math.max(0, available - requestedTokens),
      };
    }
    return {
      allowed: false,
      allocate: Math.max(0, Math.floor(Math.max(0, available) * 0.8)),
      remaining: 0,
      truncation_required: true,
    };
  }

  trackUsage(tokens: number): void {
    this.usedTokens += Math.max(0, tokens);
  }

  setRemaining(remaining: number): void {
    this.usedTokens = Math.max(0, this.maxTokens - remaining);
  }

  hasBudget(minTokens = 1): boolean {
    return this.maxTokens - this.usedTokens - this.safetyMargin >= minTokens;
  }

  getUsedTokens(): number {
    return this.usedTokens;
  }

  getRemainingTokens(): number {
    return Math.max(0, this.maxTokens - this.usedTokens);
  }
}
