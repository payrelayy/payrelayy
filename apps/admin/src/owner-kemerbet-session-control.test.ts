import { describe, expect, it } from 'vitest';

import {
  OwnerKemerbetSessionUnavailableError,
  parseOwnerKemerbetSessionStatus,
} from './owner-kemerbet-session-control.js';

describe('Owner private KemerBet session control', () => {
  it('accepts only the exact inactive and active redacted envelopes', () => {
    expect(
      parseOwnerKemerbetSessionStatus({
        active: false,
        loginRequired: false,
        phase: 'idle',
        signedIn: false,
        transferDisabled: true,
      }),
    ).toEqual({
      active: false,
      loginRequired: false,
      phase: 'idle',
      signedIn: false,
      transferDisabled: true,
    });
    expect(
      parseOwnerKemerbetSessionStatus({
        active: true,
        expiresAt: '2026-08-23T12:10:00.000Z',
        frameSequence: 1,
        generation: '11111111-1111-4111-8111-111111111111',
        loginRequired: true,
        phase: 'login_required',
        signedIn: false,
        transferDisabled: true,
      }),
    ).toMatchObject({ active: true, loginRequired: true, transferDisabled: true });
    expect(
      parseOwnerKemerbetSessionStatus({
        active: true,
        expiresAt: '2026-08-23T12:10:00.000Z',
        frameSequence: 1,
        generation: '11111111-1111-4111-8111-111111111111',
        loginRequired: false,
        phase: 'authenticating',
        signedIn: false,
        transferDisabled: true,
      }),
    ).toMatchObject({
      active: true,
      loginRequired: false,
      phase: 'authenticating',
      signedIn: false,
      transferDisabled: true,
    });
    expect(
      parseOwnerKemerbetSessionStatus({
        active: false,
        loginRequired: false,
        phase: 'idle',
        quarantine: {
          reasonCode: 'unclean_session_generation',
          recoveryRequired: true,
        },
        signedIn: false,
        transferDisabled: true,
      }),
    ).toEqual({
      active: false,
      loginRequired: false,
      phase: 'idle',
      quarantine: {
        reasonCode: 'unclean_session_generation',
        recoveryRequired: true,
      },
      signedIn: false,
      transferDisabled: true,
    });
  });

  it.each([
    {
      active: false,
      loginRequired: false,
      phase: 'idle',
      signedIn: false,
      transferDisabled: false,
    },
    { active: false, loginRequired: true, phase: 'idle', signedIn: false, transferDisabled: true },
    {
      active: true,
      expiresAt: 'invalid',
      frameSequence: 1,
      generation: '11111111-1111-4111-8111-111111111111',
      loginRequired: true,
      phase: 'login_required',
      signedIn: false,
      transferDisabled: true,
    },
    {
      active: true,
      expiresAt: '2026-08-23T12:10:00.000Z',
      frameSequence: 1,
      generation: '11111111-1111-4111-8111-111111111111',
      loginRequired: true,
      phase: 'login_required',
      signedIn: false,
      transferDisabled: true,
      password: 'forbidden',
    },
    {
      active: false,
      loginRequired: false,
      phase: 'idle',
      quarantine: { reasonCode: 'unknown_reason', recoveryRequired: true },
      signedIn: false,
      transferDisabled: true,
    },
    {
      active: false,
      loginRequired: false,
      phase: 'checkpointed',
      quarantine: {
        reasonCode: 'unclean_session_generation',
        recoveryRequired: true,
      },
      signedIn: false,
      transferDisabled: true,
    },
    {
      active: false,
      loginRequired: false,
      phase: 'idle',
      quarantine: {
        reasonCode: 'unclean_session_generation',
        recoveryRequired: false,
      },
      signedIn: false,
      transferDisabled: true,
    },
    {
      active: false,
      loginRequired: false,
      phase: 'idle',
      quarantine: {
        detail: 'authority-bearing',
        reasonCode: 'unclean_session_generation',
        recoveryRequired: true,
      },
      signedIn: false,
      transferDisabled: true,
    },
  ])('rejects malformed, authority-bearing, or non-no-transfer envelopes', (candidate) => {
    expect(() => parseOwnerKemerbetSessionStatus(candidate)).toThrow(
      OwnerKemerbetSessionUnavailableError,
    );
  });
});
