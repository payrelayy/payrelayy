import { createHash } from 'node:crypto';
import { isProxy } from 'node:util/types';

export const GUARDED_PRE_PERMIT_STOP_REQUEST =
  'fetanagent:windows-companion:guarded-pre-permit-stop:v1' as const;
export const GUARDED_PRE_PERMIT_STOPPED =
  'fetanagent:windows-companion:guarded-pre-permit-stopped:v1' as const;
export const GUARDED_RUNTIME_STOP_REQUEST =
  'fetanagent:windows-companion:guarded-runtime-stop:v1' as const;
export const GUARDED_RUNTIME_STOPPED =
  'fetanagent:windows-companion:guarded-runtime-stopped:v1' as const;

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/u;

export function guardedPrePermitChallengeDigest(challenge: string): string {
  const bytes = Buffer.from(challenge, 'base64url');
  if (
    !CHALLENGE.test(challenge) ||
    bytes.length !== 32 ||
    bytes.toString('base64url') !== challenge
  ) {
    throw new Error('The guarded local stop challenge is invalid.');
  }
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function exactFrame(value: unknown, type: string, challengeDigest: string): boolean {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || keys[0] !== 'type' || keys[1] !== 'challengeDigest') return false;
  const typeField = Object.getOwnPropertyDescriptor(value, 'type');
  const digestField = Object.getOwnPropertyDescriptor(value, 'challengeDigest');
  return (
    typeField?.enumerable === true &&
    Object.hasOwn(typeField, 'value') &&
    typeField.value === type &&
    digestField?.enumerable === true &&
    Object.hasOwn(digestField, 'value') &&
    digestField.value === challengeDigest
  );
}

export function guardedPrePermitStopRequest(challenge: string) {
  return Object.freeze({
    type: GUARDED_PRE_PERMIT_STOP_REQUEST,
    challengeDigest: guardedPrePermitChallengeDigest(challenge),
  });
}

export function guardedPrePermitStopped(challenge: string) {
  return Object.freeze({
    type: GUARDED_PRE_PERMIT_STOPPED,
    challengeDigest: guardedPrePermitChallengeDigest(challenge),
  });
}

export function isGuardedPrePermitStopRequest(value: unknown, challenge: string): boolean {
  return exactFrame(
    value,
    GUARDED_PRE_PERMIT_STOP_REQUEST,
    guardedPrePermitChallengeDigest(challenge),
  );
}

export function isGuardedPrePermitStopped(value: unknown, challenge: string): boolean {
  return exactFrame(value, GUARDED_PRE_PERMIT_STOPPED, guardedPrePermitChallengeDigest(challenge));
}

/** Stop the exact guarded child even if a permit may already have been received. */
export function guardedRuntimeStopRequest(challenge: string) {
  return Object.freeze({
    type: GUARDED_RUNTIME_STOP_REQUEST,
    challengeDigest: guardedPrePermitChallengeDigest(challenge),
  });
}

/** Confirms host shutdown only; it says nothing about the provider outcome. */
export function guardedRuntimeStopped(challenge: string) {
  return Object.freeze({
    type: GUARDED_RUNTIME_STOPPED,
    challengeDigest: guardedPrePermitChallengeDigest(challenge),
  });
}

export function isGuardedRuntimeStopRequest(value: unknown, challenge: string): boolean {
  return exactFrame(
    value,
    GUARDED_RUNTIME_STOP_REQUEST,
    guardedPrePermitChallengeDigest(challenge),
  );
}

export function isGuardedRuntimeStopped(value: unknown, challenge: string): boolean {
  return exactFrame(value, GUARDED_RUNTIME_STOPPED, guardedPrePermitChallengeDigest(challenge));
}
