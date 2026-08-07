import { describe, expect, it } from 'vitest';

import {
  assertFinancialActionsEnabled,
  FinancialActionsDisabledError,
  mayPerformFinalKemerBetAction,
} from './financial-actions.js';

describe('financial action guard', () => {
  it('rejects all financial actions in dry-run mode', () => {
    expect(() => assertFinancialActionsEnabled('dry_run', 'kemerbet.deposit')).toThrow(
      FinancialActionsDisabledError,
    );
  });

  it('requires both live mode and the explicit final-action feature switch', () => {
    expect(mayPerformFinalKemerBetAction('dry_run', true)).toBe(false);
    expect(mayPerformFinalKemerBetAction('live', false)).toBe(false);
    expect(mayPerformFinalKemerBetAction('live', true)).toBe(true);
  });
});
