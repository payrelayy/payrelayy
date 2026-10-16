import { isProxy } from 'node:util/types';

/**
 * A metadata-only inventory for a candidate CBE Birr receiver revision. A matching v1 shape
 * cannot attest the encryption key's provenance, the ciphertext, the lookup selector, or the
 * official receipt. In particular, this function never makes a lookup or authorizes a lease.
 */
export const CBE_BIRR_RECEIVER_REVISION_METADATA_CONTRACT_VERSION = 1 as const;

export interface CbeBirrReceiverRevisionMetadataCandidate {
  readonly contractVersion: typeof CBE_BIRR_RECEIVER_REVISION_METADATA_CONTRACT_VERSION;
  readonly providerCode: 'cbe_birr';
  readonly revision: number;
  readonly status: 'active' | 'inactive';
  readonly protectionProfileVersion: number | null;
  readonly encryptionKeyVersion: number | null;
  readonly fingerprintKeyVersion: number | null;
}

interface BlockedCapabilities {
  readonly keyProvenanceAttested: false;
  readonly protectedMaterialAllowed: false;
  readonly decryptionAllowed: false;
  readonly leaseAllowed: false;
  readonly runtimeWiringAllowed: false;
  readonly providerRequestAllowed: false;
  readonly financialClaimAllowed: false;
}

interface ResultBase extends BlockedCapabilities {
  contractVersion: typeof CBE_BIRR_RECEIVER_REVISION_METADATA_CONTRACT_VERSION;
  providerCode: 'cbe_birr';
  advisoryOnly: true;
}

export type CbeBirrReceiverRevisionMetadataResult =
  | Readonly<
      ResultBase & {
        disposition: 'blocked';
        reasonCode:
          | 'v1_metadata_shape_only'
          | 'receiver_revision_inactive'
          | 'receiver_metadata_missing_or_unsupported';
      }
    >
  | Readonly<ResultBase & { disposition: 'invalid_request'; reasonCode: 'invalid_request' }>;

const candidateKeys = [
  'contractVersion',
  'providerCode',
  'revision',
  'status',
  'protectionProfileVersion',
  'encryptionKeyVersion',
  'fingerprintKeyVersion',
] as const;

const base = Object.freeze({
  contractVersion: CBE_BIRR_RECEIVER_REVISION_METADATA_CONTRACT_VERSION,
  providerCode: 'cbe_birr' as const,
  advisoryOnly: true as const,
  keyProvenanceAttested: false as const,
  protectedMaterialAllowed: false as const,
  decryptionAllowed: false as const,
  leaseAllowed: false as const,
  runtimeWiringAllowed: false as const,
  providerRequestAllowed: false as const,
  financialClaimAllowed: false as const,
});

function exactDataRecord(candidate: unknown): Record<string, unknown> | undefined {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    Array.isArray(candidate) ||
    isProxy(candidate)
  ) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(candidate);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== candidateKeys.length ||
    keys.some((key) => typeof key !== 'string') ||
    !candidateKeys.every((key) => keys.includes(key))
  ) {
    return undefined;
  }
  const record = candidate as Record<string, unknown>;
  if (
    !candidateKeys.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      return descriptor?.enumerable === true && Object.hasOwn(descriptor, 'value');
    })
  ) {
    return undefined;
  }
  return record;
}

function value(record: Record<string, unknown>, key: (typeof candidateKeys)[number]): unknown {
  return Object.getOwnPropertyDescriptor(record, key)?.value as unknown;
}

export function inspectCbeBirrReceiverRevisionMetadata(
  candidate: unknown,
): CbeBirrReceiverRevisionMetadataResult {
  const record = exactDataRecord(candidate);
  if (
    !record ||
    value(record, 'contractVersion') !== CBE_BIRR_RECEIVER_REVISION_METADATA_CONTRACT_VERSION ||
    value(record, 'providerCode') !== 'cbe_birr' ||
    !Number.isSafeInteger(value(record, 'revision')) ||
    (value(record, 'revision') as number) < 1 ||
    (value(record, 'status') !== 'active' && value(record, 'status') !== 'inactive')
  ) {
    return Object.freeze({
      ...base,
      disposition: 'invalid_request',
      reasonCode: 'invalid_request',
    });
  }

  if (value(record, 'status') === 'inactive') {
    return Object.freeze({
      ...base,
      disposition: 'blocked',
      reasonCode: 'receiver_revision_inactive',
    });
  }

  const v1Shape =
    value(record, 'protectionProfileVersion') === 1 &&
    value(record, 'encryptionKeyVersion') === 1 &&
    value(record, 'fingerprintKeyVersion') === 1;
  return Object.freeze({
    ...base,
    disposition: 'blocked',
    reasonCode: v1Shape ? 'v1_metadata_shape_only' : 'receiver_metadata_missing_or_unsupported',
  });
}
