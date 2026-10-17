import { isProxy } from 'node:util/types';

import {
  protectReceiverAccountReference,
  type DepositReferenceProtectionSecrets,
  type ProtectedReceiverAccountReference,
} from './index.js';
import {
  CbeBirrReceiverLookupProtectionError,
  protectCbeBirrReceiverLookup,
  type ProtectedCbeBirrReceiverLookup,
} from './cbe-birr-receiver-lookup.js';

/**
 * Offline preparation for one fresh, Owner-confirmed CBE Birr receiver revision. This is not
 * exported by the package, called by an application, or allowed to rotate a database row. The
 * caller must independently establish key provenance and allocate the exact revision UUID/version.
 */
export interface PrepareCbeBirrReceiverRotationInput {
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly receiverPhone: string;
  readonly referenceSecrets: DepositReferenceProtectionSecrets;
  readonly lookupSecrets: DepositReferenceProtectionSecrets;
}

export interface PreparedCbeBirrReceiverRotation {
  readonly reference: ProtectedReceiverAccountReference;
  readonly lookup: ProtectedCbeBirrReceiverLookup;
}

function exactDataProperties(
  candidate: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (typeof candidate !== 'object' || candidate === null || isProxy(candidate)) return undefined;
  if (Object.getPrototypeOf(candidate) !== Object.prototype) return undefined;
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const values: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return undefined;
    }
    values[key] = descriptor.value;
  }
  return values;
}

export function prepareCbeBirrReceiverRotation(
  input: PrepareCbeBirrReceiverRotationInput,
): PreparedCbeBirrReceiverRotation {
  try {
    const values = exactDataProperties(input, [
      'receiverRevisionId',
      'receiverVersion',
      'receiverPhone',
      'referenceSecrets',
      'lookupSecrets',
    ]);
    const referenceSecrets = exactDataProperties(values?.referenceSecrets, [
      'encryptionSecret',
      'fingerprintSecret',
    ]);
    const lookupSecrets = exactDataProperties(values?.lookupSecrets, [
      'encryptionSecret',
      'fingerprintSecret',
    ]);
    if (
      !values ||
      !referenceSecrets ||
      !lookupSecrets ||
      typeof values.receiverRevisionId !== 'string' ||
      typeof values.receiverVersion !== 'number' ||
      typeof values.receiverPhone !== 'string' ||
      typeof referenceSecrets.encryptionSecret !== 'string' ||
      typeof referenceSecrets.fingerprintSecret !== 'string' ||
      typeof lookupSecrets.encryptionSecret !== 'string' ||
      typeof lookupSecrets.fingerprintSecret !== 'string' ||
      new Set([
        referenceSecrets.encryptionSecret,
        referenceSecrets.fingerprintSecret,
        lookupSecrets.encryptionSecret,
        lookupSecrets.fingerprintSecret,
      ]).size !== 4
    ) {
      throw new Error();
    }

    // V2 validates the exact full 251 phone, canonical revision identity and both lookup keys.
    const lookup = protectCbeBirrReceiverLookup({
      receiverRevisionId: values.receiverRevisionId,
      receiverVersion: values.receiverVersion,
      receiverPhone: values.receiverPhone,
      secrets: {
        encryptionSecret: lookupSecrets.encryptionSecret,
        fingerprintSecret: lookupSecrets.fingerprintSecret,
      },
    });
    const reference = protectReceiverAccountReference({
      provider: 'cbe_birr',
      reference: values.receiverPhone,
      secrets: {
        encryptionSecret: referenceSecrets.encryptionSecret,
        fingerprintSecret: referenceSecrets.fingerprintSecret,
      },
    });
    if (lookup.masked !== reference.masked) throw new Error();
    return Object.freeze({ reference, lookup });
  } catch {
    throw new CbeBirrReceiverLookupProtectionError();
  }
}
