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
        signedIn: false,
        transferDisabled: true,
      }),
    ).toEqual({
      active: false,
      loginRequired: false,
      signedIn: false,
      transferDisabled: true,
    });
    expect(
      parseOwnerKemerbetSessionStatus({
        active: true,
        expiresAt: '2026-08-23T12:10:00.000Z',
        imageBase64: 'YWJjZA==',
        imageContentType: 'image/jpeg',
        loginRequired: true,
        signedIn: false,
        transferDisabled: true,
      }),
    ).toMatchObject({ active: true, loginRequired: true, transferDisabled: true });
  });

  it.each([
    { active: false, loginRequired: false, signedIn: false, transferDisabled: false },
    { active: false, loginRequired: true, signedIn: false, transferDisabled: true },
    {
      active: true,
      expiresAt: 'invalid',
      imageBase64: 'YWJjZA==',
      imageContentType: 'image/jpeg',
      loginRequired: true,
      signedIn: false,
      transferDisabled: true,
    },
    {
      active: true,
      expiresAt: '2026-08-23T12:10:00.000Z',
      imageBase64: 'YWJjZA==',
      imageContentType: 'image/jpeg',
      loginRequired: true,
      signedIn: false,
      transferDisabled: true,
      password: 'forbidden',
    },
  ])('rejects malformed, authority-bearing, or non-no-transfer envelopes', (candidate) => {
    expect(() => parseOwnerKemerbetSessionStatus(candidate)).toThrow(
      OwnerKemerbetSessionUnavailableError,
    );
  });
});
