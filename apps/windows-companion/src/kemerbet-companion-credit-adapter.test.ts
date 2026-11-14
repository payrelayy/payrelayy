import { EtbAmount } from '@fetanagent/domain';
import type {
  PlatformCreditFinalActionAuthority,
  PlatformCreditPreparedAttempt,
} from '@fetanagent/contracts';
import { describe, expect, it, vi } from 'vitest';

import { createKemerBetCompanionSubmissionAdapter } from './kemerbet-companion-credit-adapter.js';
import type { LocalKemerBetRoutineDepositDispatchOutcome } from './local-kemerbet-deposit.js';
import type { LocalKemerBetSession } from './local-kemerbet-session.js';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const PREPARED: PlatformCreditPreparedAttempt = Object.freeze({
  attemptId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
  finalActionFenced: false,
  order: Object.freeze({
    depositIntentId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    paymentClaimId: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    platformCode: 'kemerbet',
    platformAgentAccountId: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    customerAccountId: 'PLAYER-10025',
    amount: EtbAmount.fromMinor(10025),
    currencyCode: 'ETB',
    orderReference: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  }),
});

function authority(
  overrides: Partial<PlatformCreditFinalActionAuthority['attempt']> = {},
): PlatformCreditFinalActionAuthority {
  return Object.freeze({
    attempt: Object.freeze({ ...PREPARED, finalActionFenced: true, ...overrides }),
    isFresh: () => true,
  });
}

type Acquire = Parameters<LocalKemerBetSession['executeRoutineOneUseDeposit']>[2];

describe('KemerBet Companion credit submission adapter', () => {
  it('requests the fence at the browser final action and preserves the exact signed dispatch', async () => {
    let acquired = false;
    const acquireFinalAction = vi.fn(async () => {
      acquired = true;
      return authority();
    });
    const dispatch: LocalKemerBetRoutineDepositDispatchOutcome = Object.freeze({
      outcome: 'submission_attempted',
      providerResponseDigest: DIGEST,
      exactPlayerCreditMatch: true,
    });
    const session = {
      executeRoutineOneUseDeposit: vi.fn(
        async (playerId: string, minor: number, acquire: Acquire) => {
          expect(acquired).toBe(false);
          expect(playerId).toBe(PREPARED.order.customerAccountId);
          expect(minor).toBe(10025);
          const action = await acquire();
          expect(action.playerId).toBe(playerId);
          expect(action.amountMinor).toBe(minor);
          expect(action.isFresh()).toBe(true);
          return dispatch;
        },
      ),
    } satisfies Pick<LocalKemerBetSession, 'executeRoutineOneUseDeposit'>;
    const adapter = createKemerBetCompanionSubmissionAdapter(session);
    expect(await adapter.submitOnce(PREPARED, acquireFinalAction)).toEqual({
      outcome: 'provider_success_observed',
      evidenceDigest: DIGEST,
      dispatch,
    });
    expect(acquireFinalAction).toHaveBeenCalledTimes(1);
    expect(session.executeRoutineOneUseDeposit).toHaveBeenCalledTimes(1);
  });

  it('rejects a mismatched fenced target before granting the browser action', async () => {
    const session = {
      executeRoutineOneUseDeposit: vi.fn(
        async (_player: string, _minor: number, acquire: Acquire) => {
          await acquire();
          throw new Error('No final action granted.');
        },
      ),
    } satisfies Pick<LocalKemerBetSession, 'executeRoutineOneUseDeposit'>;
    const adapter = createKemerBetCompanionSubmissionAdapter(session);
    await expect(
      adapter.submitOnce(PREPARED, async () =>
        authority({ order: { ...PREPARED.order, customerAccountId: 'OTHER-PLAYER' } }),
      ),
    ).rejects.toThrow();
    await expect(
      adapter.submitOnce(PREPARED, async () => authority({ attemptId: 'other-attempt' })),
    ).rejects.toThrow();
  });

  it.each([
    'depositIntentId',
    'paymentClaimId',
    'platformCode',
    'platformAgentAccountId',
    'customerAccountId',
    'orderReference',
  ] as const)('rejects a changed %s after the final-action fence', async (field) => {
    const session = {
      executeRoutineOneUseDeposit: vi.fn(
        async (_player: string, _minor: number, acquire: Acquire) => {
          await acquire();
          throw new Error('No final action granted.');
        },
      ),
    } satisfies Pick<LocalKemerBetSession, 'executeRoutineOneUseDeposit'>;
    const adapter = createKemerBetCompanionSubmissionAdapter(session);
    await expect(
      adapter.submitOnce(PREPARED, async () =>
        authority({ order: { ...PREPARED.order, [field]: 'changed-value' } }),
      ),
    ).rejects.toThrow();
  });

  it('rejects a changed amount after the final-action fence', async () => {
    const session = {
      executeRoutineOneUseDeposit: vi.fn(
        async (_player: string, _minor: number, acquire: Acquire) => {
          await acquire();
          throw new Error('No final action granted.');
        },
      ),
    } satisfies Pick<LocalKemerBetSession, 'executeRoutineOneUseDeposit'>;
    const adapter = createKemerBetCompanionSubmissionAdapter(session);
    await expect(
      adapter.submitOnce(PREPARED, async () =>
        authority({ order: { ...PREPARED.order, amount: EtbAmount.fromMinor(10125) } }),
      ),
    ).rejects.toThrow();
  });

  it('does not submit an already fenced attempt', async () => {
    const session = {
      executeRoutineOneUseDeposit: vi.fn(async () => {
        throw new Error('Unexpected browser call.');
      }),
    } satisfies Pick<LocalKemerBetSession, 'executeRoutineOneUseDeposit'>;
    const adapter = createKemerBetCompanionSubmissionAdapter(session);
    await expect(
      adapter.submitOnce(
        { ...PREPARED, finalActionFenced: true } as unknown as PlatformCreditPreparedAttempt,
        async () => authority(),
      ),
    ).rejects.toThrow();
    expect(session.executeRoutineOneUseDeposit).not.toHaveBeenCalled();
  });

  it('does not request a second fence when the browser calls back twice', async () => {
    const acquireFinalAction = vi.fn(async () => authority());
    const session = {
      executeRoutineOneUseDeposit: vi.fn(
        async (_player: string, _minor: number, acquire: Acquire) => {
          await acquire();
          await expect(acquire()).rejects.toThrow();
          return {
            outcome: 'local_uncertain',
            providerResponseDigest: null,
          } as const;
        },
      ),
    } satisfies Pick<LocalKemerBetSession, 'executeRoutineOneUseDeposit'>;
    const adapter = createKemerBetCompanionSubmissionAdapter(session);
    expect(await adapter.submitOnce(PREPARED, acquireFinalAction)).toEqual({
      outcome: 'uncertain',
      reason: 'provider_action_ambiguous',
    });
    expect(acquireFinalAction).toHaveBeenCalledTimes(1);
  });

  it('keeps malformed success evidence out of the signed dispatch', async () => {
    const session = {
      executeRoutineOneUseDeposit: vi.fn(
        async (_player: string, _minor: number, acquire: Acquire) => {
          await acquire();
          return {
            outcome: 'submission_attempted',
            providerResponseDigest: DIGEST,
          } as unknown as LocalKemerBetRoutineDepositDispatchOutcome;
        },
      ),
    } satisfies Pick<LocalKemerBetSession, 'executeRoutineOneUseDeposit'>;
    const adapter = createKemerBetCompanionSubmissionAdapter(session);
    expect(await adapter.submitOnce(PREPARED, async () => authority())).toEqual({
      outcome: 'uncertain',
      reason: 'confirmation_mismatch',
    });
  });
});
