import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260918140518_prepare_live_telebirr_source_unavailable_shadow_recovery.sql',
    import.meta.url,
  ),
);
const provisionPath = fileURLToPath(
  new URL(
    '../../../infra/sql/production-telebirr-shadow-verifier-once-provision.sql',
    import.meta.url,
  ),
);
const workflowPath = fileURLToPath(
  new URL('../../../.github/workflows/production-telebirr-shadow-once.yml', import.meta.url),
);

let migrationSource = '';
let recoverySource = '';
let validatorSource = '';
let provisionSource = '';
let workflowSource = '';

function extractFunction(source: string, functionName: string): string {
  const declaration = source.indexOf(`create function app.${functionName}(`);
  expect(declaration).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n$$;', source.indexOf('as $$', declaration));
  expect(end).toBeGreaterThan(declaration);
  return source.slice(declaration, end + '\n$$;'.length);
}

beforeAll(async () => {
  [migrationSource, provisionSource, workflowSource] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(provisionPath, 'utf8'),
    readFile(workflowPath, 'utf8'),
  ]);
  recoverySource = extractFunction(
    migrationSource,
    'recover_private_live_telebirr_source_to_shadow',
  );
  validatorSource = extractFunction(
    migrationSource,
    'private_live_telebirr_source_recovery_is_valid',
  );
});

describe('terminal live TeleBirr source-unavailable shadow recovery', () => {
  it('retains an immutable one-use ledger with both terminal outcomes and one child', () => {
    for (const fragment of [
      'create table app.private_live_telebirr_source_recoveries',
      'root_live_verification_job_id uuid not null unique',
      'root_live_outcome_id uuid not null unique',
      'terminal_live_verification_job_id uuid not null unique',
      'terminal_live_outcome_id uuid not null unique',
      'source_live_proof_id uuid not null unique',
      'replacement_shadow_proof_request_id uuid not null unique',
      'private_live_tbirr_source_recoveries_immutable',
      'private_live_tbirr_source_recoveries_no_truncate',
      'force row level security',
    ]) {
      expect(migrationSource).toContain(fragment);
    }
    expect(migrationSource).not.toMatch(/grant\s+(?:select|insert|update|delete|execute)/iu);
  });

  it('accepts only the reviewed four-attempt terminal source-unavailable shape', () => {
    for (const fragment of [
      'source_attempt_count <> 4',
      'source_assignment_transcript_count <> 2',
      'source_assignment_delivery_count <> 2',
      'source_device_evidence_count <> 2',
      'source_observation_count <> 1',
      "root_outcome.disposition is distinct from 'review_required'",
      "root_outcome.reason_code is distinct from 'source_unavailable'",
      "terminal_outcome.disposition is distinct from 'review_required'",
      "terminal_outcome.reason_code is distinct from 'source_unavailable'",
      "'official_receipt_network_unavailable'",
      'attempt.attempt_number between 1 and 4',
      'attempt.expires_at > authorized_at',
    ]) {
      expect(recoverySource).toContain(fragment);
    }
  });

  it('keeps the recovery inside the disabled dry-run and KemerBet boundary', () => {
    for (const fragment of [
      'app.current_private_trusted_telebirr_activation_epoch() is not null',
      'app.private_telebirr_shadow_mode_is_ready(target_pilot.id)',
      'locked_switch_count <> 7',
      'fetanagent_deposit_executor_runtime',
      "target_heartbeat.runtime_state <> 'ready'",
      'target_enrollment_count <> 1',
    ]) {
      expect(recoverySource).toContain(fragment);
    }
    expect(recoverySource).not.toMatch(/update\s+app\.feature_switches/iu);
    expect(recoverySource).not.toMatch(/alter\s+role/iu);
  });

  it('copies only the protected reference into one five-minute advisory shadow request', () => {
    const insertedTables = [...recoverySource.matchAll(/insert into app\.([a-z0-9_]+)/giu)].map(
      (match) => match[1],
    );
    expect(insertedTables).toEqual([
      'private_telebirr_shadow_proof_requests',
      'private_live_telebirr_source_recoveries',
    ]);
    expect(recoverySource).toContain("source_proof.submitted_at + interval '24 hours'");
    expect(recoverySource).toContain("authorized_at + interval '5 minutes'");
    expect(recoverySource).toContain('source_proof.candidate_reference_ciphertext');
    expect(recoverySource).toContain('source_proof.candidate_reference_fingerprint');
    expect(recoverySource).not.toMatch(/\b(?:update|delete\s+from|truncate)\s+app\./iu);
  });

  it('cannot create a claim, reservation, settlement, execution job, or money movement', () => {
    expect(recoverySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
    );
    expect(recoverySource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|kemerbet|transfer_money)/iu,
    );
    for (const table of [
      'app.private_live_deposit_pilot_reservations',
      'app.private_live_telebirr_settlement_receipts',
      'app.provider_payment_evidence',
    ]) {
      expect(recoverySource).toContain(table);
    }
  });

  it('binds the fresh pilot, receiver profile, enrollment, and immutable attempt history', () => {
    for (const fragment of [
      'source_pilot.platform_agent_account_id',
      'source_pilot.maximum_aggregate_minor',
      'app.private_live_deposit_pilot_players',
      'app.private_live_deposit_pilot_customers',
      'app.private_live_deposit_pilot_providers',
      'source_profile.receiver_identity_digest',
      'source_profile.deposit_policy_version_id',
      'source_profile.automatic_freshness_seconds',
      'source_attempt_history_digest',
      'app.private_live_telebirr_device_heartbeats',
    ]) {
      expect(recoverySource).toContain(fragment);
    }
  });

  it('recomputes both ledger and shadow digests in the private validator', () => {
    expect(validatorSource).toContain('app.private_live_telebirr_source_recovery_digest(');
    expect(validatorSource).toContain('app.private_telebirr_expired_pilot_shadow_recovery_digest(');
    expect(validatorSource).toContain('current_attempt_history_digest');
    expect(validatorSource).toContain(
      "recovery.reason_code = 'terminal_source_unavailable_recovery_no_credit'",
    );
    expect(validatorSource).toContain(
      'app.private_telebirr_shadow_mode_is_ready(recovery.target_pilot_revision_id)',
    );
    expect(validatorSource).toContain('app.provider_payment_evidence');
  });

  it('routes only the exact terminal branch through the reviewed no-money workflow', () => {
    for (const fragment of [
      'create_terminal_source_unavailable_recovery',
      'app.recover_private_live_telebirr_source_to_shadow(',
      "'terminal_source_unavailable_recovery_no_credit'",
      'app.private_live_telebirr_source_recovery_is_valid(',
      'replay_terminal_source_unavailable_recovery',
      'no_terminal_source_unavailable_recovery',
    ]) {
      expect(provisionSource).toContain(fragment);
    }
    expect(provisionSource).toContain('select false as shadow_request_transition_ready');
    expect(workflowSource).toContain("'sourceUnavailableRecoveryValid'");
    expect(workflowSource).toContain('[[ "$CONFIRMED_PROOF" =~ $uuid_v4 ]]');
    expect(provisionSource).toMatch(
      /:'target_shadow_proof_request_id'\s+~ '\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4/,
    );
    expect(workflowSource).toContain('.sourceLiveAttempts == 4');
    expect(workflowSource).toContain('.sourceLiveOutcomes == 1');
    expect(workflowSource).toContain('.sourceUnavailableRecoveryValid == true');
    expect(workflowSource).toContain('.sourceReservations == 0');
    expect(workflowSource).toContain('.liveMoneySwitchCount == 0');
    expect(workflowSource).not.toContain('FINANCIAL_ACTIONS_MODE=live');
    expect(workflowSource).not.toContain('KEMERBET_PRIVATE_LIVE_DEPOSIT_PILOT_ENABLED=true');
  });
});
