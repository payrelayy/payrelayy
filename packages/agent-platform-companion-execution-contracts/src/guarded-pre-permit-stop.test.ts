import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  guardedPrePermitStopRequest,
  guardedPrePermitStopped,
  isGuardedPrePermitStopRequest,
  isGuardedPrePermitStopped,
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
});
