import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import {
  CompanionActivationTransitionUncertainError,
  CompanionActivationTransitionUnavailableError,
  invokeCompanionActivationTransitionInternal,
  type CompanionActivationTransitionInput,
  type CompanionActivationTransitionQuery,
} from './activation-transition.js';

const actorAuthUserId = randomUUID();
const requestKey = randomUUID();
const runtimePassword = 'a'.repeat(64);

function input(): CompanionActivationTransitionInput {
  return { actorAuthUserId, requestKey, runtimePassword };
}

describe('internal companion activation transition adapter', () => {
  it('uses only the exact parameterized one-use database function and returns its expiry', async () => {
    const validUntil = new Date(Date.now() + 30 * 60_000);
    const query = vi.fn<CompanionActivationTransitionQuery['query']>(async (sql, values) => {
      expect(sql.trim()).toBe(
        'select app.activate_agent_platform_companion_execution_once(\n' +
          '  $1::uuid, $2::uuid, $3::text\n' +
          ') as valid_until',
      );
      expect(sql).not.toContain(runtimePassword);
      expect(values).toEqual([actorAuthUserId, requestKey, runtimePassword]);
      return { rows: [{ valid_until: validUntil }] };
    });
    await expect(invokeCompanionActivationTransitionInternal(input(), { query })).resolves.toBe(
      validUntil.toISOString(),
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects malformed identity, password, and extra payload before any query', async () => {
    const query = vi.fn<CompanionActivationTransitionQuery['query']>();
    for (const invalid of [
      { ...input(), actorAuthUserId: 'not-a-uuid' },
      { ...input(), requestKey: 'not-a-uuid' },
      { ...input(), runtimePassword: 'raw-password' },
      { ...input(), runtimePassword: 'A'.repeat(64) },
      { ...input(), unreviewed: true },
    ]) {
      await expect(
        invokeCompanionActivationTransitionInternal(invalid, { query }),
      ).rejects.toBeInstanceOf(CompanionActivationTransitionUnavailableError);
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('treats every post-dispatch failure as uncertain without exposing details or retrying', async () => {
    for (const rows of [
      [],
      [{ valid_until: new Date(Date.now() + 30 * 60_000) }, { valid_until: new Date() }],
      [{ valid_until: 'not-a-date' }],
      [{ valid_until: new Date(Date.now() - 1000) }],
      [{ valid_until: new Date(Date.now() + 3 * 60 * 60_000) }],
      [{ valid_until: new Date(Date.now() + 30 * 60_000), secret: 'do-not-return' }],
    ]) {
      const query = vi.fn<CompanionActivationTransitionQuery['query']>(async () => ({ rows }));
      await expect(
        invokeCompanionActivationTransitionInternal(input(), { query }),
      ).rejects.toMatchObject({ requiresIndependentStopAndReconciliation: true });
      expect(query).toHaveBeenCalledTimes(1);
    }
    const query = vi.fn<CompanionActivationTransitionQuery['query']>(async () => {
      throw new Error(`database detail ${runtimePassword}`);
    });
    await expect(invokeCompanionActivationTransitionInternal(input(), { query })).rejects.toThrow(
      'The companion activation transition result is uncertain; stop and reconcile.',
    );
    await invokeCompanionActivationTransitionInternal(input(), {
      async query() {
        throw new Error(runtimePassword);
      },
    }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(CompanionActivationTransitionUncertainError);
      expect(String(error)).not.toContain(runtimePassword);
      expect((error as Error).cause).toBeUndefined();
    });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('is not exported from the package or reachable through a production entry point', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, unknown> };
    const root = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(Object.keys(manifest.exports)).not.toContain('./activation-transition');
    expect(root).not.toContain('activation-transition');
  });
});
