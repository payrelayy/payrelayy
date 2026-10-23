export type PaymentMethodCode = 'telebirr' | 'cbe_birr';

export interface OwnerPaymentMethod {
  readonly providerCode: PaymentMethodCode;
  readonly ownerEnabled: boolean;
  readonly readiness:
    | 'ready'
    | 'provider_unavailable'
    | 'receiver_missing'
    | 'receiver_not_protected'
    | 'payments_paused'
    | 'sms_route_paused'
    | 'verification_paused'
    | 'credit_worker_offline'
    | 'phone_not_paired'
    | 'new_receiver_sms_not_seen';
  readonly receiverName: string | null;
  readonly receiverMasked: string | null;
  readonly pendingJobs: number;
  readonly fencedAttempts: number;
  readonly changedAt: string;
}

export interface PaymentMethodsDatabase {
  query(sql: string, values: readonly (boolean | string)[]): Promise<{ rows: readonly unknown[] }>;
}

export class OwnerPaymentMethodsRejectedError extends Error {}
export class OwnerPaymentMethodsConflictError extends Error {}
export class OwnerPaymentMethodsUnavailableError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const READINESS = new Set([
  'ready',
  'provider_unavailable',
  'receiver_missing',
  'receiver_not_protected',
  'payments_paused',
  'sms_route_paused',
  'verification_paused',
  'credit_worker_offline',
  'phone_not_paired',
  'new_receiver_sms_not_seen',
]);

function decodeMethod(value: unknown): OwnerPaymentMethod {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new OwnerPaymentMethodsUnavailableError();
  const row = value as Record<string, unknown>;
  if (
    (row.provider_code !== 'telebirr' && row.provider_code !== 'cbe_birr') ||
    typeof row.owner_enabled !== 'boolean' ||
    typeof row.readiness !== 'string' ||
    !READINESS.has(row.readiness) ||
    (row.receiver_name !== null && typeof row.receiver_name !== 'string') ||
    (row.receiver_masked !== null &&
      (typeof row.receiver_masked !== 'string' || !/^\*{3}[0-9]{4}$/u.test(row.receiver_masked))) ||
    (row.receiver_name === null) !== (row.receiver_masked === null) ||
    typeof row.pending_jobs !== 'string' ||
    !/^(0|[1-9][0-9]*)$/u.test(row.pending_jobs) ||
    typeof row.fenced_attempts !== 'string' ||
    !/^(0|[1-9][0-9]*)$/u.test(row.fenced_attempts) ||
    !(row.changed_at instanceof Date) ||
    !Number.isFinite(row.changed_at.getTime())
  )
    throw new OwnerPaymentMethodsUnavailableError();
  const pendingJobs = Number(row.pending_jobs);
  const fencedAttempts = Number(row.fenced_attempts);
  if (!Number.isSafeInteger(pendingJobs) || !Number.isSafeInteger(fencedAttempts))
    throw new OwnerPaymentMethodsUnavailableError();
  return Object.freeze({
    providerCode: row.provider_code,
    ownerEnabled: row.owner_enabled,
    readiness: row.readiness as OwnerPaymentMethod['readiness'],
    receiverName: row.receiver_name as string | null,
    receiverMasked: row.receiver_masked as string | null,
    pendingJobs,
    fencedAttempts,
    changedAt: row.changed_at.toISOString(),
  });
}

export class PostgresOwnerPaymentMethods {
  constructor(private readonly database: PaymentMethodsDatabase) {}

  async list(authUserId: string): Promise<readonly OwnerPaymentMethod[]> {
    if (!UUID.test(authUserId)) throw new OwnerPaymentMethodsRejectedError();
    try {
      const result = await this.database.query(
        `select provider_code, owner_enabled, readiness, receiver_name,
                receiver_masked, pending_jobs, fenced_attempts, changed_at
           from app.list_owner_provider_deposit_controls($1::uuid)`,
        [authUserId],
      );
      const methods = result.rows.map(decodeMethod);
      if (methods.length !== 2 || new Set(methods.map((method) => method.providerCode)).size !== 2)
        throw new OwnerPaymentMethodsUnavailableError();
      return Object.freeze(methods);
    } catch {
      throw new OwnerPaymentMethodsUnavailableError();
    }
  }

  async set(
    authUserId: string,
    requestId: string,
    providerCode: PaymentMethodCode,
    enabled: boolean,
  ): Promise<readonly OwnerPaymentMethod[]> {
    if (
      !UUID.test(authUserId) ||
      !UUID_V4.test(requestId) ||
      !['telebirr', 'cbe_birr'].includes(providerCode) ||
      typeof enabled !== 'boolean'
    )
      throw new OwnerPaymentMethodsRejectedError();
    try {
      await this.database.query(
        `select app.set_owner_provider_deposit_control(
          $1::uuid, $2::uuid, $3::text, $4::boolean)`,
        [authUserId, requestId, providerCode, enabled],
      );
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P0001')
        throw new OwnerPaymentMethodsConflictError();
      throw new OwnerPaymentMethodsUnavailableError();
    }
    return this.list(authUserId);
  }

  async publicStatus(): Promise<Readonly<Record<PaymentMethodCode, boolean>>> {
    try {
      const result = await this.database.query(
        'select provider_code, accepting from app.public_provider_deposit_controls()',
        [],
      );
      if (result.rows.length !== 2) throw new OwnerPaymentMethodsUnavailableError();
      const values: Partial<Record<PaymentMethodCode, boolean>> = {};
      for (const row of result.rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row))
          throw new OwnerPaymentMethodsUnavailableError();
        const item = row as Record<string, unknown>;
        if (
          (item.provider_code !== 'telebirr' && item.provider_code !== 'cbe_birr') ||
          typeof item.accepting !== 'boolean' ||
          item.provider_code in values
        )
          throw new OwnerPaymentMethodsUnavailableError();
        values[item.provider_code] = item.accepting;
      }
      if (values.telebirr === undefined || values.cbe_birr === undefined)
        throw new OwnerPaymentMethodsUnavailableError();
      return Object.freeze({ telebirr: values.telebirr, cbe_birr: values.cbe_birr });
    } catch {
      throw new OwnerPaymentMethodsUnavailableError();
    }
  }
}
