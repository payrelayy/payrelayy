import type { Page } from 'playwright-core';
import { describe, expect, it, vi } from 'vitest';

import {
  createLocalKemerBetDepositAuthorization,
  executeRoutineOneUseLocalKemerBetDeposit,
  isRoutineDepositAmountMinor,
  LocalKemerBetDepositError,
  routineDepositAmountText,
} from './local-kemerbet-deposit.js';
import { createLocalKemerBetLookupAuthorization } from './local-kemerbet-lookup.js';

const URL = 'https://admin-api.agt-digi.com/Wallet/PlayerEPOSDeposit';

describe('routine receipt-derived amount binding', () => {
  it('reports only a fixed redacted preflight checkpoint before browser inspection', async () => {
    const stages: string[] = [];
    const acquireFinalAction = vi.fn();
    await expect(
      executeRoutineOneUseLocalKemerBetDeposit(
        {} as Page,
        'private-player-id',
        2500,
        createLocalKemerBetLookupAuthorization(),
        createLocalKemerBetDepositAuthorization(),
        acquireFinalAction,
        (stage) => stages.push(stage),
      ),
    ).rejects.toThrow();
    expect(stages).toEqual(['preflight_started']);
    expect(JSON.stringify(stages)).not.toContain('private-player-id');
    expect(acquireFinalAction).not.toHaveBeenCalled();
  });

  it('does not let a diagnostic callback change the guarded preflight result', async () => {
    await expect(
      executeRoutineOneUseLocalKemerBetDeposit(
        {} as Page,
        '12345',
        2500,
        createLocalKemerBetLookupAuthorization(),
        createLocalKemerBetDepositAuthorization(),
        vi.fn(),
        () => {
          throw new Error('diagnostic failure');
        },
      ),
    ).rejects.toThrow(LocalKemerBetDepositError);
  });

  it.each([
    [2500, '25.00'],
    [2501, '25.01'],
    [1999999, '19999.99'],
    [2500000, '25000.00'],
  ])('formats %s minor units without truncating cents', (minor, text) => {
    expect(isRoutineDepositAmountMinor(minor)).toBe(true);
    expect(routineDepositAmountText(minor as number)).toBe(text);
  });

  it.each([0, -2500, 2499, 2500001, 2500.1, NaN, Infinity, '2500', null, undefined])(
    'rejects invalid minor-unit amount %s',
    (amount) => {
      expect(isRoutineDepositAmountMinor(amount)).toBe(false);
      expect(() => routineDepositAmountText(amount as number)).toThrow();
    },
  );

  it('keeps the v2 pilot allowance at 25 ETB', async () => {
    const authorization = createLocalKemerBetDepositAuthorization();
    const outcome = authorization.begin(42, () => true);
    expect(
      authorization.consumeExactRequest('POST', URL, {
        playerId: 42,
        amount: 25.01,
        notes: '',
      }),
    ).toBeUndefined();
    await expect(outcome).resolves.toMatchObject({ outcome: 'local_uncertain' });
    expect(
      authorization.consumeExactRequest('POST', URL, {
        playerId: 42,
        amount: 25,
        notes: '',
      }),
    ).toBeUndefined();
  });

  it.each([2500, 2501, 1999999, 2500000])(
    'consumes exact routine amount %s only once',
    async (minor) => {
      const authorization = createLocalKemerBetDepositAuthorization();
      const outcome = authorization.beginRoutine(42, minor, () => true);
      const payload = { playerId: 42, amount: minor / 100, notes: '' };
      const consumed = authorization.consumeExactRequest('POST', URL, payload);
      expect(consumed?.isFresh()).toBe(true);
      expect(authorization.consumeExactRequest('POST', URL, payload)).toBeUndefined();
      consumed?.settle({
        outcome: 'submission_attempted',
        providerResponseDigest: `sha256:${'a'.repeat(64)}`,
      });
      await expect(outcome).resolves.toMatchObject({ outcome: 'submission_attempted' });
    },
  );

  it.each([
    { playerId: 43, amount: 25000, notes: '' },
    { playerId: 42, amount: 24999.99, notes: '' },
    { playerId: 42, amount: '25000.00', notes: '' },
    { playerId: 42, amount: 25000, notes: 'extra' },
    { playerId: 42, amount: 25000, notes: '', receiver: 'extra' },
  ])('burns a mismatched routine request without dispatch: %j', async (payload) => {
    const authorization = createLocalKemerBetDepositAuthorization();
    const outcome = authorization.beginRoutine(42, 2500000, () => true);
    expect(authorization.consumeExactRequest('POST', URL, payload)).toBeUndefined();
    await expect(outcome).resolves.toMatchObject({ outcome: 'local_uncertain' });
  });

  it('does not allow overlapping pilot and routine requests', async () => {
    const authorization = createLocalKemerBetDepositAuthorization();
    const pending = authorization.begin(42, () => true);
    await expect(authorization.beginRoutine(43, 2500000, () => true)).rejects.toThrow();
    authorization.clear();
    await expect(pending).resolves.toMatchObject({ outcome: 'local_uncertain' });
  });

  it('does not allow overlapping routine requests', async () => {
    const authorization = createLocalKemerBetDepositAuthorization();
    const pending = authorization.beginRoutine(42, 2500000, () => true);
    await expect(authorization.beginRoutine(43, 2500, () => true)).rejects.toThrow();
    authorization.clear();
    await expect(pending).resolves.toMatchObject({ outcome: 'local_uncertain' });
  });

  it('rejects stale or throwing authority and clears any waiting promise', async () => {
    for (const isFresh of [
      () => false,
      () => {
        throw new Error('expired');
      },
    ]) {
      const authorization = createLocalKemerBetDepositAuthorization();
      const pending = authorization.beginRoutine(42, 2500, isFresh);
      expect(
        authorization.consumeExactRequest('POST', URL, {
          playerId: 42,
          amount: 25,
          notes: '',
        }),
      ).toBeUndefined();
      await expect(pending).resolves.toMatchObject({ outcome: 'local_uncertain' });
    }
  });

  it('holds the route slot after consumption until the provider outcome is settled', async () => {
    const authorization = createLocalKemerBetDepositAuthorization();
    const pending = authorization.beginRoutine(42, 2501, () => true);
    const consumed = authorization.consumeExactRequest('POST', URL, {
      playerId: 42,
      amount: 25.01,
      notes: '',
    });
    expect(consumed).toBeDefined();
    await expect(authorization.beginRoutine(43, 2500, () => true)).rejects.toThrow();
    authorization.clear();
    await expect(pending).resolves.toMatchObject({ outcome: 'local_uncertain' });
    const replacement = authorization.beginRoutine(43, 2500, () => true);
    // A late response from the former route must not settle or clear the new slot.
    consumed?.settle({
      outcome: 'submission_attempted',
      providerResponseDigest: `sha256:${'a'.repeat(64)}`,
    });
    await expect(authorization.beginRoutine(44, 2500, () => true)).rejects.toThrow();
    authorization.clear();
    await expect(replacement).resolves.toMatchObject({ outcome: 'local_uncertain' });
  });
});
