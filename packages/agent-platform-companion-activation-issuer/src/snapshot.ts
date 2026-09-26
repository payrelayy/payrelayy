import type { CompanionActivationDatabaseSnapshot } from '@fetanagent/agent-platform-companion-execution-contracts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** An already-authenticated, short-lived administrator connection; never a companion role. */
export interface CompanionActivationSnapshotQuery {
  query(
    sql: string,
    values: unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
}

export class CompanionActivationSnapshotUnavailableError extends Error {
  constructor() {
    super('The companion activation database snapshot is unavailable.');
    this.name = 'CompanionActivationSnapshotUnavailableError';
  }
}

// One MVCC statement gives both issuer reads the same internally consistent database
// snapshot. No lock-bearing helper, security-definer function, or mutable companion
// claim is used. The consuming transition still rechecks every money boundary.
const SNAPSHOT_SQL = `
  select
    request.request_key::text as request_key,
    request.pilot_revision_id::text as request_pilot_revision_id,
    request.activation_epoch::text as request_activation_epoch,
    request.certificate_id::text as request_certificate_id,
    request.platform_agent_account_id::text as request_account_id,
    request.companion_release_sha,
    request.companion_archive_sha256,
    request.companion_installation_tree_sha256,
    request.requested_at,
    request.expires_at as request_expires_at,
    pilot.id::text as current_pilot_revision_id,
    authority.epoch::text as current_activation_epoch,
    certificate.certificate_id::text as current_certificate_id,
    pilot.platform_agent_account_id::text as current_account_id,
    certificate.certificate_body_digest,
    certificate.device_key_id,
    certificate.certificate_body ->> 'devicePublicKeySpki' as device_public_key_spki,
    certificate.device_public_key_spki_sha256,
    certificate.valid_from as certificate_valid_from,
    certificate.valid_until as certificate_valid_until
  from app.agent_platform_companion_execution_activation_requests request
  join app.private_trusted_telebirr_activation_control activation_control
    on activation_control.control_key = 'trusted_telebirr_financial_authority'
   and activation_control.current_epoch = request.activation_epoch
  join app.private_trusted_telebirr_activation_epochs authority
    on authority.epoch = activation_control.current_epoch
   and authority.authority_state = 'active'
   and authority.revoked_at is null
   and authority.pilot_revision_id = request.pilot_revision_id
  join app.private_live_deposit_pilot_revisions pilot
    on pilot.id = authority.pilot_revision_id
   and pilot.status = 'armed'
   and pilot.platform_agent_account_id = request.platform_agent_account_id
   and pilot.armed_by_admin_id = request.requested_by_admin_id
  join app.admin_users owner_user
    on owner_user.id = request.requested_by_admin_id
   and owner_user.role = 'owner'
   and owner_user.status = 'active'
  join app.agent_platform_companion_enrollment_certificates certificate
    on certificate.certificate_id = request.certificate_id
  join app.agent_platform_companion_pairing_challenges pairing
    on pairing.pairing_id = certificate.pairing_id
   and pairing.state = 'completed'
   and pairing.created_by_admin_id = owner_user.id
  join app.agent_platform_companion_server_signers signer
    on signer.id = certificate.server_signer_id
   and signer.signer_key_id = certificate.certificate_signer_key_id
  join app.agent_platform_companion_execution_control execution_control
    on execution_control.singleton
   and execution_control.control_state = 'disabled'
  left join app.agent_platform_companion_device_revocations device_revocation
    on device_revocation.certificate_id = certificate.certificate_id
  left join app.agent_platform_companion_server_signer_revocations signer_revocation
    on signer_revocation.server_signer_id = signer.id
  where request.request_key = $1::uuid
    and session_user = 'postgres'
    and request.expires_at > pg_catalog.clock_timestamp()
    and pilot.active_from <= pg_catalog.clock_timestamp()
    and pilot.expires_at > pg_catalog.clock_timestamp()
    and authority.active_from <= pg_catalog.clock_timestamp()
    and authority.expires_at > pg_catalog.clock_timestamp()
    and certificate.valid_from <= pg_catalog.clock_timestamp()
    and certificate.valid_until > pg_catalog.clock_timestamp()
    and signer.valid_from <= pg_catalog.clock_timestamp()
    and signer.valid_until > pg_catalog.clock_timestamp()
    and device_revocation.certificate_id is null
    and signer_revocation.server_signer_id is null
    and certificate.certificate_body ->> 'certificateId' = certificate.certificate_id::text
    and certificate.certificate_body ->> 'deviceKeyId' = certificate.device_key_id
    and certificate.certificate_body ->> 'devicePublicKeySpkiSha256' =
      certificate.device_public_key_spki_sha256
`;

function stringField(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (typeof value !== 'string' || value.length === 0) throw new Error();
  return value;
}

function instantField(row: Record<string, unknown>, name: string): string {
  const value = row[name];
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error();
  return value.toISOString();
}

/**
 * Supplies only the issuer core's trusted database evidence. The caller owns the
 * administrator connection and must not expose it to the Windows companion or
 * any always-on application process. This does not retain or consume a request.
 */
export async function loadCompanionActivationDatabaseSnapshot(
  requestKey: string,
  administrator: CompanionActivationSnapshotQuery,
): Promise<CompanionActivationDatabaseSnapshot> {
  try {
    if (typeof requestKey !== 'string' || !UUID_V4.test(requestKey)) throw new Error();
    const result = await administrator.query(SNAPSHOT_SQL, [requestKey]);
    if (result.rows.length !== 1) throw new Error();
    const row = result.rows[0]!;
    if (stringField(row, 'request_key') !== requestKey) throw new Error();
    return {
      request: {
        requestKey,
        pilotRevisionId: stringField(row, 'request_pilot_revision_id'),
        activationEpoch: stringField(row, 'request_activation_epoch'),
        certificateId: stringField(row, 'request_certificate_id'),
        platformAgentAccountId: stringField(row, 'request_account_id'),
        companionReleaseSha: stringField(row, 'companion_release_sha'),
        companionArchiveSha256: stringField(row, 'companion_archive_sha256'),
        companionInstallationTreeSha256: stringField(row, 'companion_installation_tree_sha256'),
        requestedAt: instantField(row, 'requested_at'),
        expiresAt: instantField(row, 'request_expires_at'),
      },
      currentIdentity: {
        pilotRevisionId: stringField(row, 'current_pilot_revision_id'),
        activationEpoch: stringField(row, 'current_activation_epoch'),
        certificateId: stringField(row, 'current_certificate_id'),
        platformAgentAccountId: stringField(row, 'current_account_id'),
      },
      certificate: {
        certificateId: stringField(row, 'current_certificate_id'),
        certificateBodyDigest: stringField(row, 'certificate_body_digest'),
        deviceKeyId: stringField(row, 'device_key_id'),
        devicePublicKeySpki: stringField(row, 'device_public_key_spki'),
        devicePublicKeySpkiSha256: stringField(row, 'device_public_key_spki_sha256'),
        validFrom: instantField(row, 'certificate_valid_from'),
        validUntil: instantField(row, 'certificate_valid_until'),
      },
    };
  } catch {
    throw new CompanionActivationSnapshotUnavailableError();
  }
}
