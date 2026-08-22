import {
  protectReceiverAccountReference,
  type DepositReferenceProtectionSecrets,
  type DepositProofReferenceProvider,
} from '@fetanagent/deposit-reference-protection';

export type OwnerReceiverProvider = DepositProofReferenceProvider;
export type OwnerReceiverRotationReason =
  'account_rotation' | 'initial_configuration' | 'owner_correction' | 'provider_incident_recovery';

export interface OwnerReceiverAccount {
  readonly accountHolderName: string;
  readonly accountReferenceMasked: string;
  readonly activeFrom: string;
  readonly protectedReference: boolean;
  readonly providerCode: OwnerReceiverProvider;
  readonly providerDisplayName: string;
  readonly receiverRevisionId: string;
  readonly receiverStatus: 'active' | 'inactive';
  readonly retiredAt?: string;
  readonly revision: number;
  readonly rotationReason?: OwnerReceiverRotationReason;
}

export interface RotateOwnerReceiverAccountRequest {
  readonly accountHolderName: string;
  readonly accountReference: string;
  readonly providerCode: OwnerReceiverProvider;
  readonly requestId: string;
  readonly rotationReason: OwnerReceiverRotationReason;
}

export interface OwnerReceiverDatabase {
  query(
    sql: string,
    values: readonly (boolean | number | string)[],
  ): Promise<{ readonly rows: readonly unknown[] }>;
}

export class OwnerReceiverAccountRejectedError extends Error {
  constructor() {
    super('The Owner receiver-account operation was rejected.');
    this.name = 'OwnerReceiverAccountRejectedError';
  }
}

export class OwnerReceiverAccountUnavailableError extends Error {
  constructor() {
    super('The Owner receiver-account operation is unavailable.');
    this.name = 'OwnerReceiverAccountUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const HOLDER_PATTERN =
  /^[^\s\u0000-\u001f\u007f](?:[^\u0000-\u001f\u007f]{0,158}[^\s\u0000-\u001f\u007f])?$/u;
const MASK_PATTERN = /^\*\*\*[0-9]{4}$/u;
const REFERENCE_PATTERN = /^[0-9]{9,24}$/u;
const PROVIDERS = new Set<OwnerReceiverProvider>(['cbe_birr', 'telebirr']);
const ROTATION_REASONS = new Set<OwnerReceiverRotationReason>([
  'account_rotation',
  'initial_configuration',
  'owner_correction',
  'provider_incident_recovery',
]);

const LIST_SQL = `
  select provider_code,
         provider_display_name,
         receiver_revision_id,
         revision,
         account_holder_name,
         account_reference_masked,
         receiver_status,
         active_from,
         retired_at,
         rotation_reason,
         protected_reference
    from app.list_owner_receiver_accounts($1::uuid)
`;

const ROTATE_SQL = `
  select provider_code,
         receiver_revision_id,
         revision,
         account_holder_name,
         account_reference_masked,
         receiver_status,
         active_from,
         retired_at,
         rotation_reason,
         protected_reference
    from app.rotate_owner_receiver_account(
      $1::uuid, $2::uuid, $3::text, $4::text, $5::text, $6::text, $7::text,
      $8::smallint, $9::smallint, $10::smallint, $11::text
    )
`;

function rowObject(row: unknown): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new OwnerReceiverAccountUnavailableError();
  }
  return row as Record<string, unknown>;
}

function isoDate(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerReceiverAccountUnavailableError();
  }
  return value.toISOString();
}

function receiverFromRow(rowValue: unknown): OwnerReceiverAccount | undefined {
  const row = rowObject(rowValue);
  if (row.receiver_revision_id === null) return undefined;
  const providerCode: OwnerReceiverProvider | undefined =
    row.provider_code === 'cbe_birr' || row.provider_code === 'telebirr'
      ? row.provider_code
      : undefined;
  const expectedProviderDisplayName =
    providerCode === 'cbe_birr' ? 'CBE Birr' : providerCode === 'telebirr' ? 'TeleBirr' : undefined;
  if (
    providerCode === undefined ||
    expectedProviderDisplayName === undefined ||
    row.provider_display_name !== expectedProviderDisplayName ||
    typeof row.receiver_revision_id !== 'string' ||
    !UUID_PATTERN.test(row.receiver_revision_id) ||
    !Number.isSafeInteger(row.revision) ||
    Number(row.revision) < 1 ||
    typeof row.account_holder_name !== 'string' ||
    !HOLDER_PATTERN.test(row.account_holder_name) ||
    typeof row.account_reference_masked !== 'string' ||
    !MASK_PATTERN.test(row.account_reference_masked) ||
    (row.receiver_status !== 'active' && row.receiver_status !== 'inactive') ||
    typeof row.protected_reference !== 'boolean'
  ) {
    throw new OwnerReceiverAccountUnavailableError();
  }
  const active = row.receiver_status === 'active';
  const protectedReference = row.protected_reference;
  if (
    (active && row.retired_at !== null) ||
    (!active && !(row.retired_at instanceof Date)) ||
    (protectedReference && row.rotation_reason === null) ||
    (row.rotation_reason !== null &&
      (typeof row.rotation_reason !== 'string' ||
        !ROTATION_REASONS.has(row.rotation_reason as OwnerReceiverRotationReason)))
  ) {
    throw new OwnerReceiverAccountUnavailableError();
  }
  return {
    accountHolderName: row.account_holder_name,
    accountReferenceMasked: row.account_reference_masked,
    activeFrom: isoDate(row.active_from),
    protectedReference,
    providerCode,
    providerDisplayName: expectedProviderDisplayName,
    receiverRevisionId: row.receiver_revision_id,
    receiverStatus: row.receiver_status,
    ...(row.retired_at instanceof Date ? { retiredAt: isoDate(row.retired_at) } : {}),
    revision: Number(row.revision),
    ...(typeof row.rotation_reason === 'string'
      ? { rotationReason: row.rotation_reason as OwnerReceiverRotationReason }
      : {}),
  };
}

function validateRotation(authUserId: string, request: RotateOwnerReceiverAccountRequest): void {
  if (
    !UUID_PATTERN.test(authUserId) ||
    !UUID_V4_PATTERN.test(request.requestId) ||
    !PROVIDERS.has(request.providerCode) ||
    !HOLDER_PATTERN.test(request.accountHolderName) ||
    !REFERENCE_PATTERN.test(request.accountReference) ||
    !ROTATION_REASONS.has(request.rotationReason)
  ) {
    throw new OwnerReceiverAccountRejectedError();
  }
}

export class PostgresOwnerReceiverAccounts {
  constructor(
    private readonly database: OwnerReceiverDatabase,
    private readonly secrets: DepositReferenceProtectionSecrets,
  ) {}

  async list(authUserId: string): Promise<readonly OwnerReceiverAccount[]> {
    if (!UUID_PATTERN.test(authUserId)) throw new OwnerReceiverAccountRejectedError();
    try {
      const result = await this.database.query(LIST_SQL, [authUserId]);
      const receivers = result.rows.map(receiverFromRow).filter((value) => value !== undefined);
      if (
        receivers.length > 100 ||
        new Set(receivers.map((receiver) => receiver.receiverRevisionId)).size !==
          receivers.length ||
        receivers
          .filter((receiver) => receiver.receiverStatus === 'active')
          .some((receiver, index, active) =>
            active.some(
              (other, otherIndex) =>
                otherIndex !== index && other.providerCode === receiver.providerCode,
            ),
          )
      ) {
        throw new OwnerReceiverAccountUnavailableError();
      }
      return Object.freeze(receivers.map((receiver) => Object.freeze(receiver)));
    } catch (error) {
      if (error instanceof OwnerReceiverAccountRejectedError) throw error;
      throw new OwnerReceiverAccountUnavailableError();
    }
  }

  async rotate(
    authUserId: string,
    request: RotateOwnerReceiverAccountRequest,
  ): Promise<OwnerReceiverAccount> {
    validateRotation(authUserId, request);
    try {
      const protectedReference = protectReceiverAccountReference({
        provider: request.providerCode,
        reference: request.accountReference,
        secrets: this.secrets,
      });
      const result = await this.database.query(ROTATE_SQL, [
        authUserId,
        request.requestId,
        request.providerCode,
        request.accountHolderName,
        protectedReference.ciphertext,
        protectedReference.fingerprint,
        protectedReference.masked,
        protectedReference.profileVersion,
        protectedReference.keyVersion,
        1,
        request.rotationReason,
      ]);
      const receiver = result.rows.length === 1 ? receiverFromRow(result.rows[0]) : undefined;
      if (
        !receiver ||
        receiver.providerCode !== request.providerCode ||
        receiver.accountHolderName !== request.accountHolderName ||
        receiver.rotationReason !== request.rotationReason ||
        !receiver.protectedReference
      ) {
        throw new OwnerReceiverAccountUnavailableError();
      }
      return Object.freeze(receiver);
    } catch (error) {
      if (error instanceof OwnerReceiverAccountRejectedError) throw error;
      throw new OwnerReceiverAccountUnavailableError();
    }
  }
}
