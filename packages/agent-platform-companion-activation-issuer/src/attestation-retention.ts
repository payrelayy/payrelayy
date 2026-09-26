import type { CompanionActivationAttestation } from '@fetanagent/agent-platform-companion-execution-contracts';

import type { CompanionActivationSnapshotQuery } from './snapshot.js';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const RELEASE_SHA = /^[0-9a-f]{40}$/u;

const FIELDS: readonly (keyof CompanionActivationAttestation)[] = [
  'requestKey',
  'certificateBodyDigest',
  'companionReleaseSha',
  'companionArchiveSha256',
  'companionInstallationTreeSha256',
  'challengeDigest',
  'launchProofDigest',
  'executionHandoffSha256',
  'processId',
  'processStartedAt',
  'challengeIssuedAt',
  'releaseObservedAt',
  'processObservedAt',
  'verifiedAt',
];

/** An already-authenticated, short-lived postgres administrator session. */
export type CompanionActivationAttestationQuery = CompanionActivationSnapshotQuery;

export class CompanionActivationAttestationRetentionUnavailableError extends Error {
  constructor() {
    super('The companion activation attestation could not be retained.');
    this.name = 'CompanionActivationAttestationRetentionUnavailableError';
  }
}

const RETAIN_SQL = `
  insert into app.agent_platform_companion_execution_activation_attestations (
    request_key, certificate_body_digest, companion_release_sha,
    companion_archive_sha256, companion_installation_tree_sha256,
    challenge_digest, launch_proof_digest, execution_handoff_sha256,
    process_id, process_started_at, challenge_issued_at, release_observed_at,
    process_observed_at, verified_at
  )
  select
    $1::uuid, $2::text, $3::text, $4::text, $5::text,
    $6::text, $7::text, $8::text, $9::integer,
    $10::timestamptz, $11::timestamptz, $12::timestamptz,
    $13::timestamptz, $14::timestamptz
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
  left join app.agent_platform_companion_execution_activation_consumptions consumption
    on consumption.request_key = request.request_key
  where request.request_key = $1::uuid
    and session_user = 'postgres'
    and request.companion_release_sha = $3::text
    and request.companion_archive_sha256 = $4::text
    and request.companion_installation_tree_sha256 = $5::text
    and certificate.certificate_body_digest = $2::text
    and request.requested_at <= $11::timestamptz
    and request.requested_at <= $12::timestamptz
    and request.expires_at > pg_catalog.clock_timestamp()
    and pilot.active_from <= pg_catalog.clock_timestamp()
    and pilot.expires_at > pg_catalog.clock_timestamp()
    and authority.active_from <= pg_catalog.clock_timestamp()
    and authority.expires_at > pg_catalog.clock_timestamp()
    and certificate.valid_from <= pg_catalog.clock_timestamp()
    and certificate.valid_until > pg_catalog.clock_timestamp()
    and signer.valid_from <= pg_catalog.clock_timestamp()
    and signer.valid_until > pg_catalog.clock_timestamp()
    and $11::timestamptz > pg_catalog.clock_timestamp() - interval '2 minutes'
    and $12::timestamptz > pg_catalog.clock_timestamp() - interval '2 minutes'
    and $13::timestamptz > pg_catalog.clock_timestamp() - interval '2 minutes'
    and $14::timestamptz <= pg_catalog.clock_timestamp()
    and $14::timestamptz > pg_catalog.clock_timestamp() - interval '2 minutes'
    and certificate.certificate_body ->> 'certificateId' = certificate.certificate_id::text
    and certificate.certificate_body ->> 'deviceKeyId' = certificate.device_key_id
    and certificate.certificate_body ->> 'devicePublicKeySpkiSha256' =
      certificate.device_public_key_spki_sha256
    and device_revocation.certificate_id is null
    and signer_revocation.server_signer_id is null
    and consumption.request_key is null
  returning request_key::text as request_key
`;

function canonicalInstant(value: string): boolean {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function validAttestation(value: CompanionActivationAttestation): boolean {
  if (value === null || typeof value !== 'object') return false;
  const keys = Object.keys(value);
  if (keys.length !== FIELDS.length || FIELDS.some((field) => !keys.includes(field))) return false;
  if (
    !UUID_V4.test(value.requestKey) ||
    !SHA256.test(value.certificateBodyDigest) ||
    !RELEASE_SHA.test(value.companionReleaseSha) ||
    ![
      value.companionArchiveSha256,
      value.companionInstallationTreeSha256,
      value.challengeDigest,
      value.launchProofDigest,
      value.executionHandoffSha256,
    ].every((digest) => SHA256.test(digest)) ||
    !Number.isInteger(value.processId) ||
    value.processId < 1 ||
    value.processId > 2_147_483_647 ||
    ![
      value.processStartedAt,
      value.challengeIssuedAt,
      value.releaseObservedAt,
      value.processObservedAt,
      value.verifiedAt,
    ].every(canonicalInstant)
  ) {
    return false;
  }
  return (
    value.processStartedAt <= value.processObservedAt &&
    value.challengeIssuedAt <= value.processObservedAt &&
    value.processObservedAt <= value.verifiedAt &&
    value.releaseObservedAt <= value.verifiedAt
  );
}

/**
 * Retains one digest-only witness after the separate issuer core has verified
 * release and OS-process evidence. This makes no activation, role, switch, or
 * queue change. The database query rechecks current identity at insertion.
 */
export async function retainCompanionActivationAttestationRow(
  attestation: CompanionActivationAttestation,
  administrator: CompanionActivationAttestationQuery,
): Promise<void> {
  try {
    if (!validAttestation(attestation)) throw new Error();
    const result = await administrator.query(RETAIN_SQL, [
      attestation.requestKey,
      attestation.certificateBodyDigest,
      attestation.companionReleaseSha,
      attestation.companionArchiveSha256,
      attestation.companionInstallationTreeSha256,
      attestation.challengeDigest,
      attestation.launchProofDigest,
      attestation.executionHandoffSha256,
      attestation.processId,
      attestation.processStartedAt,
      attestation.challengeIssuedAt,
      attestation.releaseObservedAt,
      attestation.processObservedAt,
      attestation.verifiedAt,
    ]);
    if (result.rows.length !== 1 || result.rows[0]?.['request_key'] !== attestation.requestKey) {
      throw new Error();
    }
  } catch {
    throw new CompanionActivationAttestationRetentionUnavailableError();
  }
}
