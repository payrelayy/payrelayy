import { isProxy } from 'node:util/types';

import { prepareCbeBirrReceiverRotation } from '@fetanagent/deposit-reference-protection/internal/cbe-birr-receiver-rotation';
import type { DepositReferenceProtectionSecrets } from '@fetanagent/deposit-reference-protection';

import {
  validOwnerReceiverAccountReference,
  type OwnerReceiverRotationReason,
} from './owner-receiver-accounts.js';

export interface OwnerCbeBirrLookupRotationRequest {
  readonly accountHolderName: string;
  readonly accountReference: string;
  readonly receiverRevisionId: string;
  readonly receiverVersion: number;
  readonly requestId: string;
  readonly rotationReason: OwnerReceiverRotationReason;
}

export interface OwnerCbeBirrLookupRotationReceipt {
  readonly accountHolderName: string;
  readonly accountReferenceMasked: string;
  readonly activeFrom: string;
  readonly lookupProtected: true;
  readonly providerCode: 'cbe_birr';
  readonly receiverRevisionId: string;
  readonly receiverStatus: 'active' | 'inactive';
  readonly revision: number;
  readonly rotationReason: OwnerReceiverRotationReason;
}

export interface OwnerCbeBirrLookupRotationDatabase {
  query(
    sql: string,
    values: readonly (number | string)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export class OwnerCbeBirrLookupRotationRejectedError extends Error {
  constructor() {
    super('The Owner CBE Birr lookup rotation request was rejected.');
    this.name = 'OwnerCbeBirrLookupRotationRejectedError';
  }
}

export class OwnerCbeBirrLookupRotationUnavailableError extends Error {
  constructor() {
    super('The Owner CBE Birr lookup rotation is unavailable.');
    this.name = 'OwnerCbeBirrLookupRotationUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HOLDER_PATTERN =
  /^[^\s\u0000-\u001f\u007f](?:[^\u0000-\u001f\u007f]{0,158}[^\s\u0000-\u001f\u007f])?$/u;
const REASONS = new Set<OwnerReceiverRotationReason>([
  'account_rotation',
  'initial_configuration',
  'owner_correction',
  'provider_incident_recovery',
  'protection_upgrade',
]);

const ROTATE_SQL = `
  select receiver_revision_id, revision, receiver_status, active_from, lookup_protected
    from app.rotate_owner_cbe_birr_receiver_lookup_v2(
      $1::uuid, $2::uuid, $3::uuid, $4::integer, $5::text, $6::text,
      $7::text, $8::text, $9::text, $10::text, $11::text, $12::text
    )
`;

function exactRequest(value: unknown): OwnerCbeBirrLookupRotationRequest | undefined {
  if (typeof value !== 'object' || value === null || isProxy(value)) return undefined;
  if (Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  const expected = [
    'accountHolderName',
    'accountReference',
    'receiverRevisionId',
    'receiverVersion',
    'requestId',
    'rotationReason',
  ];
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== 'string' || !expected.includes(key))
  ) {
    return undefined;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const normalized: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of expected) {
    const descriptor = descriptors[key];
    if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, 'value')) {
      return undefined;
    }
    normalized[key] = descriptor.value;
  }
  return normalized as unknown as OwnerCbeBirrLookupRotationRequest;
}

function validRequest(
  authUserId: unknown,
  request: OwnerCbeBirrLookupRotationRequest | undefined,
): request is OwnerCbeBirrLookupRotationRequest {
  return (
    typeof authUserId === 'string' &&
    UUID_PATTERN.test(authUserId) &&
    request !== undefined &&
    typeof request.accountHolderName === 'string' &&
    HOLDER_PATTERN.test(request.accountHolderName) &&
    request.accountHolderName.length >= 2 &&
    validOwnerReceiverAccountReference('cbe_birr', request.accountReference) &&
    typeof request.requestId === 'string' &&
    UUID_V4_PATTERN.test(request.requestId) &&
    typeof request.receiverRevisionId === 'string' &&
    UUID_V4_PATTERN.test(request.receiverRevisionId) &&
    request.requestId !== request.receiverRevisionId &&
    Number.isSafeInteger(request.receiverVersion) &&
    request.receiverVersion >= 1 &&
    request.receiverVersion <= 2_147_483_647 &&
    typeof request.rotationReason === 'string' &&
    REASONS.has(request.rotationReason)
  );
}

export class PostgresOwnerCbeBirrLookupRotation {
  constructor(
    private readonly database: OwnerCbeBirrLookupRotationDatabase,
    private readonly referenceSecrets: DepositReferenceProtectionSecrets,
    private readonly lookupSecrets: DepositReferenceProtectionSecrets,
  ) {}

  async rotate(
    authUserId: string,
    requestValue: OwnerCbeBirrLookupRotationRequest,
  ): Promise<OwnerCbeBirrLookupRotationReceipt> {
    const request = exactRequest(requestValue);
    if (!validRequest(authUserId, request)) {
      throw new OwnerCbeBirrLookupRotationRejectedError();
    }
    try {
      const prepared = prepareCbeBirrReceiverRotation({
        receiverRevisionId: request.receiverRevisionId,
        receiverVersion: request.receiverVersion,
        receiverPhone: request.accountReference,
        referenceSecrets: this.referenceSecrets,
        lookupSecrets: this.lookupSecrets,
      });
      const result = await this.database.query(ROTATE_SQL, [
        authUserId,
        request.requestId,
        request.receiverRevisionId,
        request.receiverVersion,
        request.accountHolderName,
        prepared.reference.ciphertext,
        prepared.reference.fingerprint,
        prepared.reference.masked,
        prepared.lookup.ciphertext,
        prepared.lookup.fingerprint,
        prepared.lookup.masked,
        request.rotationReason,
      ]);
      if (result.rows.length !== 1) throw new Error();
      const row = result.rows[0];
      if (typeof row !== 'object' || row === null || Array.isArray(row)) throw new Error();
      const saved = row as Record<string, unknown>;
      if (
        saved.receiver_revision_id !== request.receiverRevisionId ||
        saved.revision !== request.receiverVersion ||
        (saved.receiver_status !== 'active' && saved.receiver_status !== 'inactive') ||
        !(saved.active_from instanceof Date) ||
        !Number.isFinite(saved.active_from.getTime()) ||
        saved.lookup_protected !== true
      ) {
        throw new Error();
      }
      return Object.freeze({
        accountHolderName: request.accountHolderName,
        accountReferenceMasked: prepared.reference.masked,
        activeFrom: saved.active_from.toISOString(),
        lookupProtected: true,
        providerCode: 'cbe_birr',
        receiverRevisionId: request.receiverRevisionId,
        receiverStatus: saved.receiver_status,
        revision: request.receiverVersion,
        rotationReason: request.rotationReason,
      });
    } catch {
      throw new OwnerCbeBirrLookupRotationUnavailableError();
    }
  }
}
