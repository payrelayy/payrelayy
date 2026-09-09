import { describe, expect, it, vi } from 'vitest';

import { runTrustedTelebirrVerifierMain } from './trusted-telebirr-verifier-main.js';

describe('trusted TeleBirr verifier main', () => {
  it('runs the composed application', async () => {
    const run = vi.fn(async () => undefined);
    await runTrustedTelebirrVerifierMain({
      createApplication: async () => ({ run, stop: vi.fn() }),
      reportFailure: vi.fn(),
      setExitCode: vi.fn(),
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reports only one generic fail-closed error', async () => {
    const reportFailure = vi.fn();
    const setExitCode = vi.fn();
    await runTrustedTelebirrVerifierMain({
      createApplication: async () => {
        throw new Error('database password and internal detail');
      },
      reportFailure,
      setExitCode,
    });
    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(setExitCode).toHaveBeenCalledWith(1);
  });
});
