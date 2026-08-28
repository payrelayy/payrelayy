export type OwnerKemerbetAgentProfileReason =
  'agent_rotation' | 'initial_configuration' | 'owner_correction' | 'security_recovery';

export interface OwnerKemerbetAgentProfile {
  readonly configuredAt: string;
  readonly configurationReason: OwnerKemerbetAgentProfileReason;
  readonly platformAgentAccountId: string;
  readonly platformCode: 'kemerbet';
  readonly profileContractVersion: 1;
  readonly profileLabel: string;
  readonly profileRevision: number;
  readonly profileStatus: 'active' | 'inactive';
  readonly retiredAt?: string;
}

export interface PrepareOwnerKemerbetAgentProfileRequest {
  readonly configurationReason: OwnerKemerbetAgentProfileReason;
  readonly requestId: string;
}

export interface RecoverOwnerKemerbetAgentProfileRequest {
  readonly claimId: string;
  readonly receiptId: string;
}

export interface OwnerKemerbetAgentProfileRecovery {
  readonly claimId: string;
  readonly profile: OwnerKemerbetAgentProfile;
  readonly receiptId: string;
  readonly recordedAt: string;
}

export interface OwnerKemerbetAgentProfileDatabase {
  query(sql: string, values: readonly string[]): Promise<{ readonly rows: readonly unknown[] }>;
}

export class OwnerKemerbetAgentProfileRejectedError extends Error {
  constructor() {
    super('The Owner KemerBet agent-profile operation was rejected.');
    this.name = 'OwnerKemerbetAgentProfileRejectedError';
  }
}

export class OwnerKemerbetAgentProfileUnavailableError extends Error {
  constructor() {
    super('The Owner KemerBet agent-profile operation is unavailable.');
    this.name = 'OwnerKemerbetAgentProfileUnavailableError';
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const LABEL_PATTERN = /^Primary KemerBet agent revision [1-9][0-9]*$/u;
const REASONS = new Set<OwnerKemerbetAgentProfileReason>([
  'agent_rotation',
  'initial_configuration',
  'owner_correction',
  'security_recovery',
]);
const PREPARE_REASONS = new Set<OwnerKemerbetAgentProfileReason>([
  'agent_rotation',
  'initial_configuration',
  'owner_correction',
]);

const LIST_SQL = `
  select platform_agent_account_id,
         platform_code,
         profile_label,
         profile_revision,
         profile_status,
         configured_at,
         retired_at,
         configuration_reason,
         profile_contract_version
    from app.list_owner_kemerbet_agent_profiles($1::uuid)
`;

const PREPARE_SQL = `
  select platform_agent_account_id,
         platform_code,
         profile_label,
         profile_revision,
         profile_status,
         configured_at,
         retired_at,
         configuration_reason,
         profile_contract_version
    from app.prepare_owner_kemerbet_agent_profile($1::uuid, $2::uuid, $3::text)
`;

const RECOVER_SQL = `
  select recovery_request_id,
         recovered_claim_id,
         terminal_receipt_id,
         terminal_receipt_recorded_at,
         quarantined_platform_agent_account_id,
         quarantined_profile_revision,
         platform_agent_account_id,
         platform_code,
         profile_label,
         profile_revision,
         profile_status,
         configured_at,
         retired_at,
         configuration_reason,
         profile_contract_version
    from app.recover_owner_kemerbet_quarantined_agent_profile(
      $1::uuid,
      $2::uuid,
      $3::uuid
    )
`;

function rowObject(row: unknown): Record<string, unknown> {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    throw new OwnerKemerbetAgentProfileUnavailableError();
  }
  return row as Record<string, unknown>;
}

function isoDate(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OwnerKemerbetAgentProfileUnavailableError();
  }
  return value.toISOString();
}

function profileFromRow(rowValue: unknown): OwnerKemerbetAgentProfile {
  const row = rowObject(rowValue);
  if (
    typeof row.platform_agent_account_id !== 'string' ||
    !UUID_PATTERN.test(row.platform_agent_account_id) ||
    row.platform_code !== 'kemerbet' ||
    typeof row.profile_label !== 'string' ||
    !LABEL_PATTERN.test(row.profile_label) ||
    !Number.isSafeInteger(row.profile_revision) ||
    Number(row.profile_revision) < 1 ||
    (row.profile_status !== 'active' && row.profile_status !== 'inactive') ||
    typeof row.configuration_reason !== 'string' ||
    !REASONS.has(row.configuration_reason as OwnerKemerbetAgentProfileReason) ||
    row.profile_contract_version !== 1
  ) {
    throw new OwnerKemerbetAgentProfileUnavailableError();
  }
  const active = row.profile_status === 'active';
  if ((active && row.retired_at !== null) || (!active && !(row.retired_at instanceof Date))) {
    throw new OwnerKemerbetAgentProfileUnavailableError();
  }
  return {
    configuredAt: isoDate(row.configured_at),
    configurationReason: row.configuration_reason as OwnerKemerbetAgentProfileReason,
    platformAgentAccountId: row.platform_agent_account_id,
    platformCode: 'kemerbet',
    profileContractVersion: 1,
    profileLabel: row.profile_label,
    profileRevision: Number(row.profile_revision),
    profileStatus: row.profile_status,
    ...(row.retired_at instanceof Date ? { retiredAt: isoDate(row.retired_at) } : {}),
  };
}

export class PostgresOwnerKemerbetAgentProfiles {
  constructor(private readonly database: OwnerKemerbetAgentProfileDatabase) {}

  async list(authUserId: string): Promise<readonly OwnerKemerbetAgentProfile[]> {
    if (!UUID_PATTERN.test(authUserId)) throw new OwnerKemerbetAgentProfileRejectedError();
    try {
      const result = await this.database.query(LIST_SQL, [authUserId]);
      const profiles = result.rows.map(profileFromRow);
      if (
        profiles.length > 100 ||
        new Set(profiles.map((profile) => profile.platformAgentAccountId)).size !==
          profiles.length ||
        profiles.filter((profile) => profile.profileStatus === 'active').length > 1
      ) {
        throw new OwnerKemerbetAgentProfileUnavailableError();
      }
      return Object.freeze(profiles.map((profile) => Object.freeze(profile)));
    } catch (error) {
      if (error instanceof OwnerKemerbetAgentProfileRejectedError) throw error;
      throw new OwnerKemerbetAgentProfileUnavailableError();
    }
  }

  async prepare(
    authUserId: string,
    request: PrepareOwnerKemerbetAgentProfileRequest,
  ): Promise<OwnerKemerbetAgentProfile> {
    if (
      !UUID_PATTERN.test(authUserId) ||
      !UUID_V4_PATTERN.test(request.requestId) ||
      !PREPARE_REASONS.has(request.configurationReason)
    ) {
      throw new OwnerKemerbetAgentProfileRejectedError();
    }
    try {
      const result = await this.database.query(PREPARE_SQL, [
        authUserId,
        request.requestId,
        request.configurationReason,
      ]);
      if (result.rows.length !== 1) throw new OwnerKemerbetAgentProfileUnavailableError();
      const profile = profileFromRow(result.rows[0]);
      if (profile.configurationReason !== request.configurationReason) {
        throw new OwnerKemerbetAgentProfileUnavailableError();
      }
      return Object.freeze(profile);
    } catch (error) {
      if (error instanceof OwnerKemerbetAgentProfileRejectedError) throw error;
      throw new OwnerKemerbetAgentProfileUnavailableError();
    }
  }

  async recover(
    authUserId: string,
    request: RecoverOwnerKemerbetAgentProfileRequest,
  ): Promise<OwnerKemerbetAgentProfileRecovery> {
    if (
      !UUID_PATTERN.test(authUserId) ||
      !UUID_V4_PATTERN.test(request.claimId) ||
      !UUID_V4_PATTERN.test(request.receiptId)
    ) {
      throw new OwnerKemerbetAgentProfileRejectedError();
    }
    try {
      const result = await this.database.query(RECOVER_SQL, [
        authUserId,
        request.claimId,
        request.receiptId,
      ]);
      if (result.rows.length !== 1) throw new OwnerKemerbetAgentProfileUnavailableError();
      const row = rowObject(result.rows[0]);
      if (
        row.recovery_request_id !== request.receiptId ||
        row.recovered_claim_id !== request.claimId ||
        typeof row.terminal_receipt_id !== 'string' ||
        !UUID_V4_PATTERN.test(row.terminal_receipt_id) ||
        typeof row.quarantined_platform_agent_account_id !== 'string' ||
        !UUID_PATTERN.test(row.quarantined_platform_agent_account_id) ||
        !Number.isSafeInteger(row.quarantined_profile_revision) ||
        Number(row.quarantined_profile_revision) < 1
      ) {
        throw new OwnerKemerbetAgentProfileUnavailableError();
      }
      const profile = profileFromRow(row);
      if (
        profile.configurationReason !== 'security_recovery' ||
        profile.profileStatus !== 'active' ||
        profile.platformAgentAccountId === row.quarantined_platform_agent_account_id ||
        profile.profileRevision <= Number(row.quarantined_profile_revision)
      ) {
        throw new OwnerKemerbetAgentProfileUnavailableError();
      }
      return Object.freeze({
        claimId: request.claimId,
        profile: Object.freeze(profile),
        receiptId: row.terminal_receipt_id,
        recordedAt: isoDate(row.terminal_receipt_recorded_at),
      });
    } catch (error) {
      if (error instanceof OwnerKemerbetAgentProfileRejectedError) throw error;
      throw new OwnerKemerbetAgentProfileUnavailableError();
    }
  }
}
