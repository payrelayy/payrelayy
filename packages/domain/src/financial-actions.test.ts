import { describe, expect, it } from 'vitest';

import {
  assertFinancialActionsEnabled,
  FinancialActionsDisabledError,
} from './financial-actions.js';

describe('financial action guard', () => {
  it('rejects all financial actions in dry-run mode', () => {
    expect(() => assertFinancialActionsEnabled('dry_run', 'kemerbet.deposit')).toThrow(
      FinancialActionsDisabledError,
    );
  });

  it('allows only the general future-action guard in live mode', () => {
    expect(() => assertFinancialActionsEnabled('live', 'future.adapter.action')).not.toThrow();
  });
});
