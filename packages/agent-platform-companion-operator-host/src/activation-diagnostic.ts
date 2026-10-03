import type {
  CompanionActivationDatabaseSnapshot,
  CompanionActivationReleaseAttestation,
  CompanionActivationRequestSnapshot,
} from '@fetanagent/agent-platform-companion-execution-contracts';
import { deriveGuardedCompanionHandoffBody } from '@fetanagent/agent-platform-companion-activation-issuer/guarded-handoff-publication';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const STAGES = [
  'input_validation',
  'node_database',
  'database_request',
  'database_boundary',
  'financial_state',
  'request_binding',
  'historical_window',
  'certificate_binding',
  'snapshot_shape',
  'published_release',
  'handoff_derivation',
  'execution_signer',
  'state_changed',
  'cleanup',
  'inspected',
] as const;

export type ActivationDiagnosticStage = (typeof STAGES)[number];

export interface ActivationDiagnosticReport {
  readonly component: 'fetanagent_operator_activation_diagnostic';
  readonly result: 'passed' | 'stopped';
  readonly stage: ActivationDiagnosticStage;
  readonly inspectionMode: 'historical_reconstruction';
  readonly liveReadinessProven: false;
  readonly requestCreated: false;
  readonly handoffSigned: false;
  readonly executionEnabled: false;
  readonly moneyMoved: false;
  readonly identifiersRedacted: true;
}

export interface ActivationDiagnosticQuery {
  query(sql: string, values: unknown[]): Promise<{ readonly rows: Record<string, unknown>[] }>;
}

export interface ActivationDiagnosticInputs {
  readonly requestKey: string;
  readonly administrator: ActivationDiagnosticQuery;
  /** Public release metadata only. The supplied time is a reconstruction, not a live clock. */
  readonly verifyPublishedRelease: (
    request: CompanionActivationRequestSnapshot,
    reconstructionTime: Date,
  ) => Promise<CompanionActivationReleaseAttestation>;
  /** Validate the installed key's format/public identity; never sign with it. */
  readonly checkExecutionSigner: () => Promise<void>;
}

/**
 * An exact existing request is read even after its pilot stops or its deadline
 * passes. Historical comparisons are diagnostic evidence only: this query is
 * never used by the live issuer and never authorizes a stopped/expired pilot.
 * All operational authority must already be off in a read-only transaction.
 */
export const ACTIVATION_DIAGNOSTIC_SQL = `
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
    certificate.valid_until as certificate_valid_until,
    (session_user = 'postgres' and current_user = 'postgres'
      and current_setting('transaction_read_only') = 'on'
      and not pg_catalog.pg_is_in_recovery()
      and (select ssl from pg_catalog.pg_stat_ssl where pid = pg_catalog.pg_backend_pid()))
      as database_boundary,
    ((select count(*) from app.feature_switches
        where feature_key::text in ('deposit_execution', 'payment_verification',
          'withdrawal_collection', 'withdrawal_validation', 'private_live_deposit_pilot',
          'cbe_birr_authoritative_verification', 'telebirr_authoritative_verification')
          and mode::text = 'disabled') = 7
      and exists (select 1 from app.agent_platform_companion_execution_control
        where singleton and control_state = 'disabled')
      and not exists (select 1 from pg_catalog.pg_roles
        where rolname like 'fetanagent%executor%' and rolcanlogin)
      and not exists (select 1 from pg_catalog.pg_stat_activity
        where usename like 'fetanagent%executor%')) as financial_state,
    (authority.pilot_revision_id = request.pilot_revision_id
      and pilot.platform_agent_account_id = request.platform_agent_account_id
      and pilot.armed_by_admin_id = request.requested_by_admin_id
      and owner_user.role = 'owner' and owner_user.status = 'active'
      and pairing.state = 'completed' and pairing.created_by_admin_id = owner_user.id
      and signer.signer_key_id = certificate.certificate_signer_key_id
      and not exists (select 1 from app.agent_platform_companion_execution_activation_consumptions
        where request_key = request.request_key or activation_epoch = request.activation_epoch))
      as request_binding,
    (request.expires_at > request.requested_at
      and request.expires_at <= request.requested_at + interval '10 minutes'
      and pilot.armed_at <= request.requested_at
      and pilot.active_from <= request.requested_at and pilot.expires_at > request.requested_at
      and (pilot.stopped_at is null or pilot.stopped_at > request.requested_at)
      and authority.active_from <= request.requested_at
      and authority.expires_at > request.requested_at
      and (authority.revoked_at is null or authority.revoked_at > request.requested_at)
      and certificate.valid_from <= request.requested_at
      and certificate.valid_until > request.requested_at
      and signer.valid_from <= request.requested_at and signer.valid_until > request.requested_at)
      as historical_window,
    (certificate.certificate_body ->> 'certificateId' = certificate.certificate_id::text
      and certificate.certificate_body ->> 'deviceKeyId' = certificate.device_key_id
      and certificate.certificate_body ->> 'devicePublicKeySpkiSha256' =
        certificate.device_public_key_spki_sha256
      and not exists (select 1 from app.agent_platform_companion_device_revocations
        where certificate_id = certificate.certificate_id)
      and not exists (select 1 from app.agent_platform_companion_server_signer_revocations
        where server_signer_id = signer.id)) as certificate_binding
  from app.agent_platform_companion_execution_activation_requests request
  left join app.private_trusted_telebirr_activation_epochs authority
    on authority.epoch = request.activation_epoch
  left join app.private_live_deposit_pilot_revisions pilot on pilot.id = request.pilot_revision_id
  left join app.admin_users owner_user on owner_user.id = request.requested_by_admin_id
  left join app.agent_platform_companion_enrollment_certificates certificate
    on certificate.certificate_id = request.certificate_id
  left join app.agent_platform_companion_pairing_challenges pairing
    on pairing.pairing_id = certificate.pairing_id
  left join app.agent_platform_companion_server_signers signer on signer.id = certificate.server_signer_id
  where request.request_key = $1::uuid
`;

export function activationDiagnosticReport(
  stage: ActivationDiagnosticStage,
): ActivationDiagnosticReport {
  // Even an untyped caller cannot turn the report into an error/identifier channel.
  if (!STAGES.includes(stage)) stage = 'input_validation';
  return Object.freeze({
    component: 'fetanagent_operator_activation_diagnostic',
    result: stage === 'inspected' ? 'passed' : 'stopped',
    stage,
    inspectionMode: 'historical_reconstruction',
    liveReadinessProven: false,
    requestCreated: false,
    handoffSigned: false,
    executionEnabled: false,
    moneyMoved: false,
    identifiersRedacted: true,
  });
}

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

function snapshot(row: Record<string, unknown>): CompanionActivationDatabaseSnapshot {
  return Object.freeze({
    request: Object.freeze({
      requestKey: stringField(row, 'request_key'),
      pilotRevisionId: stringField(row, 'request_pilot_revision_id'),
      activationEpoch: stringField(row, 'request_activation_epoch'),
      certificateId: stringField(row, 'request_certificate_id'),
      platformAgentAccountId: stringField(row, 'request_account_id'),
      companionReleaseSha: stringField(row, 'companion_release_sha'),
      companionArchiveSha256: stringField(row, 'companion_archive_sha256'),
      companionInstallationTreeSha256: stringField(row, 'companion_installation_tree_sha256'),
      requestedAt: instantField(row, 'requested_at'),
      expiresAt: instantField(row, 'request_expires_at'),
    }),
    currentIdentity: Object.freeze({
      pilotRevisionId: stringField(row, 'current_pilot_revision_id'),
      activationEpoch: stringField(row, 'current_activation_epoch'),
      certificateId: stringField(row, 'current_certificate_id'),
      platformAgentAccountId: stringField(row, 'current_account_id'),
    }),
    certificate: Object.freeze({
      certificateId: stringField(row, 'current_certificate_id'),
      certificateBodyDigest: stringField(row, 'certificate_body_digest'),
      deviceKeyId: stringField(row, 'device_key_id'),
      devicePublicKeySpki: stringField(row, 'device_public_key_spki'),
      devicePublicKeySpkiSha256: stringField(row, 'device_public_key_spki_sha256'),
      validFrom: instantField(row, 'certificate_valid_from'),
      validUntil: instantField(row, 'certificate_valid_until'),
    }),
  });
}

/** No signing, publication, session bootstrap, request consumption, or financial SQL. */
export async function inspectOperatorActivationRequest(
  input: ActivationDiagnosticInputs,
): Promise<ActivationDiagnosticReport> {
  let stage: ActivationDiagnosticStage = 'input_validation';
  try {
    if (
      !input ||
      typeof input.requestKey !== 'string' ||
      !UUID_V4.test(input.requestKey) ||
      typeof input.administrator?.query !== 'function' ||
      typeof input.verifyPublishedRelease !== 'function' ||
      typeof input.checkExecutionSigner !== 'function'
    )
      throw new Error();
    stage = 'database_request';
    const first = await input.administrator.query(ACTIVATION_DIAGNOSTIC_SQL, [input.requestKey]);
    if (first.rows.length !== 1 || first.rows[0]?.request_key !== input.requestKey)
      throw new Error();
    const row = first.rows[0]!;
    const initial = JSON.stringify(row);
    for (const gate of [
      'database_boundary',
      'financial_state',
      'request_binding',
      'historical_window',
      'certificate_binding',
    ] as const) {
      stage = gate;
      if (row[gate] !== true) throw new Error();
    }
    stage = 'snapshot_shape';
    const evidence = snapshot(row);
    const reconstructionTime = new Date(evidence.request.requestedAt);
    stage = 'published_release';
    const verified = await input.verifyPublishedRelease(evidence.request, reconstructionTime);
    const release = Object.freeze({
      releaseSha: verified.releaseSha,
      archiveSha256: verified.archiveSha256,
      installationTreeSha256: verified.installationTreeSha256,
      observedAt: verified.observedAt,
    });
    stage = 'handoff_derivation';
    // The body is checked in memory and discarded. The historical clock never
    // reaches the live signer, and no handoff or release attestation is returned.
    deriveGuardedCompanionHandoffBody({
      ...evidence,
      release,
      trustedNow: () => new Date(evidence.request.requestedAt),
    });
    stage = 'execution_signer';
    await input.checkExecutionSigner();
    stage = 'state_changed';
    const after = await input.administrator.query(ACTIVATION_DIAGNOSTIC_SQL, [input.requestKey]);
    if (after.rows.length !== 1 || JSON.stringify(after.rows[0]) !== initial) throw new Error();
    stage = 'inspected';
  } catch {
    // Do not retain or report exceptions: database and release errors may be private.
  }
  return activationDiagnosticReport(stage);
}
