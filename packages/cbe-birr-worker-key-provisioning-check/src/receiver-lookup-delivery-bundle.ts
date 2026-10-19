import { Buffer } from 'node:buffer';
import { createHash, timingSafeEqual } from 'node:crypto';
import { types as nodeUtilTypes } from 'node:util';

import {
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_KEY_FILE,
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_PROFILE_FILE,
  CBE_BIRR_WORKER_RECEIVER_LOOKUP_ROOT_PROFILE_FILE,
  type CbeBirrReceiverLookupReleasePins,
} from '@fetanagent/cbe-birr-worker-key-custody';

import {
  wasPreparedCbeBirrReceiverCandidate,
  type CbeBirrReceiverProvisioningCandidate,
  type CbeBirrReceiverProvisioningCandidateInput,
} from './receiver-lookup-candidate.js';

const SHA256_ID = /^sha256:[0-9a-f]{64}$/u;
const KEY_HEX = /^[0-9a-f]{64}$/u;
const ACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const MAX_FILE_BYTES = 4_096;
const PIN_KEYS = [
  'deploymentTarget',
  'receiverRevisionId',
  'receiverVersion',
  'rootProfileSha256',
  'workerProfileSha256',
  'workerKeyId',
] as const;
const SNAPSHOT_KEYS = [
  'receiverRevisionId',
  'receiverVersion',
  'protectionProfileVersion',
  'encryptionKeyVersion',
  'fingerprintKeyVersion',
] as const;
const preparedBundles = new WeakSet<object>();

export interface CbeBirrReceiverDeliveryBundleInput {
  readonly candidate: CbeBirrReceiverProvisioningCandidate;
  readonly actorAuthUserId: string;
  /** Supplied by a separate release approval, never inferred from the candidate. */
  readonly approvedPins: CbeBirrReceiverLookupReleasePins;
  readonly readActiveSnapshot: CbeBirrReceiverProvisioningCandidateInput['readActiveSnapshot'];
}

export interface CbeBirrReceiverDeliveryFile {
  readonly path: string;
  readonly mode: 0o400 | 0o444;
  /** Secret for the key file. Nonenumerable on every file; erase buffers after delivery. */
  readonly bytes: Buffer;
}

export interface CbeBirrReceiverDeliveryBundle {
  readonly disposition: 'offline_delivery_bundle_only';
  readonly approvedPins: CbeBirrReceiverLookupReleasePins;
  readonly files: readonly [
    CbeBirrReceiverDeliveryFile,
    CbeBirrReceiverDeliveryFile,
    CbeBirrReceiverDeliveryFile,
  ];
}

export class CbeBirrReceiverDeliveryBundleError extends Error {
  constructor() {
    super('CBE Birr receiver delivery bundle is unavailable.');
    this.name = 'CbeBirrReceiverDeliveryBundleError';
  }
}

function exactDataProperties(
  candidate: unknown,
  expectedKeys: readonly string[],
): Readonly<Record<string, unknown>> | undefined {
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    nodeUtilTypes.isProxy(candidate) ||
    Object.getPrototypeOf(candidate) !== Object.prototype
  ) {
    return undefined;
  }
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => !expectedKeys.includes(key as string))
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (
      descriptor === undefined ||
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      return undefined;
    }
    result[key] = descriptor.value;
  }
  return result;
}

function sameDigest(bytes: string, expected: string): boolean {
  if (!SHA256_ID.test(expected)) return false;
  const actualBytes = createHash('sha256').update(bytes, 'utf8').digest();
  const expectedBytes = Buffer.from(expected.slice(7), 'hex');
  try {
    return timingSafeEqual(actualBytes, expectedBytes);
  } finally {
    actualBytes.fill(0);
    expectedBytes.fill(0);
  }
}

function sameKeyId(keyHex: string, expected: string): boolean {
  if (!KEY_HEX.test(keyHex) || !SHA256_ID.test(expected)) return false;
  const keyBytes = Buffer.from(keyHex, 'hex');
  const actualBytes = createHash('sha256').update(keyBytes).digest();
  const expectedBytes = Buffer.from(expected.slice(7), 'hex');
  try {
    return timingSafeEqual(actualBytes, expectedBytes);
  } finally {
    keyBytes.fill(0);
    actualBytes.fill(0);
    expectedBytes.fill(0);
  }
}

function deliveryFile(
  path: string,
  mode: 0o400 | 0o444,
  utf8: string,
): CbeBirrReceiverDeliveryFile {
  const bytes = Buffer.from(utf8, 'utf8');
  if (bytes.length < 1 || bytes.length > MAX_FILE_BYTES) {
    bytes.fill(0);
    throw new CbeBirrReceiverDeliveryBundleError();
  }
  const file = { path, mode } as CbeBirrReceiverDeliveryFile;
  Object.defineProperty(file, 'bytes', { value: bytes, enumerable: false });
  return Object.freeze(file);
}

/**
 * Shape one approved, still-active revision's three guarded worker files. This returns in-memory
 * bytes only; it writes no file, mounts no secret, calls no provider, and grants no financial path.
 * The future installer must recheck the revision at delivery and the worker must recheck at use.
 */
export async function prepareCbeBirrReceiverDeliveryBundle(
  input: CbeBirrReceiverDeliveryBundleInput,
): Promise<CbeBirrReceiverDeliveryBundle> {
  const createdFiles: CbeBirrReceiverDeliveryFile[] = [];
  try {
    const values = exactDataProperties(input, [
      'candidate',
      'actorAuthUserId',
      'approvedPins',
      'readActiveSnapshot',
    ]);
    const candidate = values?.candidate;
    const approved = exactDataProperties(values?.approvedPins, PIN_KEYS);
    if (
      values === undefined ||
      !wasPreparedCbeBirrReceiverCandidate(candidate) ||
      approved === undefined ||
      typeof values.actorAuthUserId !== 'string' ||
      !ACTOR_ID.test(values.actorAuthUserId) ||
      typeof values.readActiveSnapshot !== 'function' ||
      !PIN_KEYS.every((key) => approved[key] === candidate.proposedPins[key]) ||
      !sameDigest(candidate.rootProfileUtf8, candidate.proposedPins.rootProfileSha256) ||
      !sameDigest(candidate.workerProfileUtf8, candidate.proposedPins.workerProfileSha256) ||
      candidate.workerKey.keyId !== candidate.proposedPins.workerKeyId ||
      !sameKeyId(candidate.workerKey.keyHex, candidate.workerKey.keyId)
    ) {
      throw new CbeBirrReceiverDeliveryBundleError();
    }

    const revision = Object.freeze({
      receiverRevisionId: candidate.proposedPins.receiverRevisionId,
      receiverVersion: candidate.proposedPins.receiverVersion,
    });
    const snapshot = exactDataProperties(
      await (
        values.readActiveSnapshot as CbeBirrReceiverProvisioningCandidateInput['readActiveSnapshot']
      )(values.actorAuthUserId, revision),
      SNAPSHOT_KEYS,
    );
    if (
      snapshot === undefined ||
      snapshot.receiverRevisionId !== revision.receiverRevisionId ||
      snapshot.receiverVersion !== revision.receiverVersion ||
      snapshot.protectionProfileVersion !== 2 ||
      snapshot.encryptionKeyVersion !== 2 ||
      snapshot.fingerprintKeyVersion !== 2
    ) {
      throw new CbeBirrReceiverDeliveryBundleError();
    }

    createdFiles.push(
      deliveryFile(
        CBE_BIRR_WORKER_RECEIVER_LOOKUP_KEY_FILE,
        0o400,
        `${JSON.stringify(candidate.workerKey)}\n`,
      ),
    );
    createdFiles.push(
      deliveryFile(
        CBE_BIRR_WORKER_RECEIVER_LOOKUP_PROFILE_FILE,
        0o444,
        candidate.workerProfileUtf8,
      ),
    );
    createdFiles.push(
      deliveryFile(
        CBE_BIRR_WORKER_RECEIVER_LOOKUP_ROOT_PROFILE_FILE,
        0o444,
        candidate.rootProfileUtf8,
      ),
    );
    const approvedPins = Object.freeze({ ...candidate.proposedPins });
    const bundle = Object.freeze({
      disposition: 'offline_delivery_bundle_only',
      approvedPins,
      files: Object.freeze(createdFiles) as CbeBirrReceiverDeliveryBundle['files'],
    });
    preparedBundles.add(bundle);
    return bundle;
  } catch {
    for (const file of createdFiles) file.bytes.fill(0);
    throw new CbeBirrReceiverDeliveryBundleError();
  }
}

/** Package-internal provenance check; copying a bundle does not retain install authority. */
export function wasPreparedCbeBirrReceiverDeliveryBundle(
  bundle: unknown,
): bundle is CbeBirrReceiverDeliveryBundle {
  return typeof bundle === 'object' && bundle !== null && preparedBundles.has(bundle);
}
