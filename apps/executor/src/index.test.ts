import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { KemerBetExecutorApplication } from './kemerbet-executor-application.js';
import { runKemerBetExecutorMain } from './index.js';

function application(run: () => Promise<void>): KemerBetExecutorApplication {
  return {
    run,
    async stop() {},
  };
}

describe('executor process entrypoint', () => {
  it('wires the fixed external identity-binding map into the production registry', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).toContain('loadKemerBetAgentIdentityBindings');
    expect(source).toContain('agentIdentityBindingsFile');
    expect(source).toContain('expectedAgentIdentityBindings');
  });

  it('runs a successfully composed application without changing the exit code', async () => {
    const run = vi.fn(async () => undefined);
    const reportFailure = vi.fn();
    const setExitCode = vi.fn();

    await runKemerBetExecutorMain({
      createApplication: async () => application(run),
      reportFailure,
      setExitCode,
    });

    expect(run).toHaveBeenCalledOnce();
    expect(reportFailure).not.toHaveBeenCalled();
    expect(setExitCode).not.toHaveBeenCalled();
  });

  it('fails closed without exposing a startup error or constructing an action surface', async () => {
    const reportFailure = vi.fn();
    const setExitCode = vi.fn();
    const secret = 'postgresql://executor:secret@example.invalid/postgres';

    await runKemerBetExecutorMain({
      createApplication: async () => {
        throw new Error(secret);
      },
      reportFailure,
      setExitCode,
    });

    expect(reportFailure).toHaveBeenCalledOnce();
    expect(reportFailure.mock.calls.flat().join(' ')).not.toContain(secret);
    expect(setExitCode).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('fails closed and redacts an application runtime error', async () => {
    const reportFailure = vi.fn();
    const setExitCode = vi.fn();
    const sensitiveRuntimeDetail = 'agent-account-and-player-detail';

    await runKemerBetExecutorMain({
      createApplication: async () =>
        application(async () => {
          throw new Error(sensitiveRuntimeDetail);
        }),
      reportFailure,
      setExitCode,
    });

    expect(reportFailure).toHaveBeenCalledOnce();
    expect(reportFailure.mock.calls.flat().join(' ')).not.toContain(sensitiveRuntimeDetail);
    expect(setExitCode).toHaveBeenCalledExactlyOnceWith(1);
  });
});
