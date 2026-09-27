import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  guardedPrePermitStopRequest,
  guardedPrePermitStopped,
  guardedRuntimeStopRequest,
  guardedRuntimeStopped,
  isGuardedPrePermitStopRequest,
  isGuardedPrePermitStopped,
  isGuardedRuntimeStopRequest,
  isGuardedRuntimeStopped,
} from './guarded-pre-permit-stop.js';

describe('guarded pre-permit stop frames', () => {
  it('binds request and acknowledgement to the same fresh challenge', () => {
    const challenge = randomBytes(32).toString('base64url');
    const other = randomBytes(32).toString('base64url');
    const request = guardedPrePermitStopRequest(challenge);
    const stopped = guardedPrePermitStopped(challenge);
    expect(isGuardedPrePermitStopRequest(request, challenge)).toBe(true);
    expect(isGuardedPrePermitStopped(stopped, challenge)).toBe(true);
    expect(isGuardedPrePermitStopRequest(request, other)).toBe(false);
    expect(isGuardedPrePermitStopped(stopped, other)).toBe(false);
    expect(isGuardedPrePermitStopped(request, challenge)).toBe(false);
    expect(isGuardedPrePermitStopRequest({ ...request, extra: true }, challenge)).toBe(false);
  });

  it('rejects non-canonical challenges and accessor frames', () => {
    expect(() => guardedPrePermitStopRequest('invalid')).toThrow();
    const challenge = randomBytes(32).toString('base64url');
    const request = guardedPrePermitStopRequest(challenge);
    const accessor = Object.defineProperties(
      {},
      {
        type: { enumerable: true, get: () => request.type },
        challengeDigest: { enumerable: true, value: request.challengeDigest },
      },
    );
    expect(isGuardedPrePermitStopRequest(accessor, challenge)).toBe(false);
  });

  it('keeps post-permit host stop distinct from pre-permit stop and provider resolution', () => {
    const challenge = randomBytes(32).toString('base64url');
    const other = randomBytes(32).toString('base64url');
    const request = guardedRuntimeStopRequest(challenge);
    const stopped = guardedRuntimeStopped(challenge);
    expect(isGuardedRuntimeStopRequest(request, challenge)).toBe(true);
    expect(isGuardedRuntimeStopped(stopped, challenge)).toBe(true);
    expect(isGuardedRuntimeStopRequest(request, other)).toBe(false);
    expect(isGuardedRuntimeStopped(stopped, other)).toBe(false);
    expect(isGuardedPrePermitStopRequest(request, challenge)).toBe(false);
    expect(isGuardedPrePermitStopped(stopped, challenge)).toBe(false);
    expect(isGuardedRuntimeStopped({ ...stopped, moneyMoved: false }, challenge)).toBe(false);
    expect(() => guardedRuntimeStopRequest('invalid')).toThrow();
  });
});
