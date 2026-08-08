import { describe, expect, it } from 'vitest';

import { loadConfig } from './index.js';

describe('configuration safety', () => {
  it('defaults to dry-run mode', () => {
    expect(loadConfig({ NODE_ENV: 'test' }).financialActionsMode).toBe('dry_run');
  });

  it('refuses live mode outside production', () => {
    expect(() => loadConfig({ NODE_ENV: 'test', FINANCIAL_ACTIONS_MODE: 'live' })).toThrow(
      'only when NODE_ENV=production',
    );
  });
});
