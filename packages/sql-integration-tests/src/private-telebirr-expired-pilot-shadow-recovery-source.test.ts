import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260915190000_private_telebirr_expired_pilot_shadow_recovery.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let recoverySource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  recoverySource =
    migrationSource.match(
      /create function app\.recover_expired_private_live_telebirr_payment_to_shadow\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  expect(recoverySource).not.toBe('');
});

describe('expired-pilot TeleBirr no-credit recovery source boundary', () => {
  it('retains the original live proof/job and creates only one bounded shadow request', () => {
    expect(migrationSource).toContain('source_live_verification_job_id uuid');
    expect(migrationSource).toContain('source_live_proof_id uuid');
    expect(migrationSource).toContain('original_expires_at timestamptz');
    expect(migrationSource).toContain("recovery_reason_code = 'expired_pilot_recovery_no_credit'");
    expect(migrationSource).toContain("expires_at > recovered_at + interval '60 seconds'");
    expect(migrationSource).toContain("expires_at <= recovered_at + interval '5 minutes'");
    expect(migrationSource).toContain('private_telebirr_shadow_recovery_source_job_idx');
    expect(migrationSource).toContain('private_telebirr_shadow_recovery_source_proof_idx');
    expect(recoverySource).toContain('insert into app.private_telebirr_shadow_proof_requests');
    expect(recoverySource).not.toMatch(
      /(?:update|delete\s+from)\s+app\.private_live_(?:deposit_pilot_proofs|telebirr_verification_jobs)/iu,
    );
  });

  it('requires postgres, no active authority, and the established no-money shadow gate', () => {
    expect(recoverySource).toContain("session_user <> 'postgres'");
    expect(recoverySource).toContain('app.lock_private_trusted_telebirr_activation_authority()');
    expect(recoverySource).toContain(
      'app.current_private_trusted_telebirr_activation_epoch() is not null',
    );
    expect(recoverySource).toContain('app.private_telebirr_shadow_mode_is_ready(target_pilot.id)');
    expect(recoverySource).not.toMatch(/update app\.feature_switches/iu);
    expect(migrationSource).not.toMatch(
      /grant execute on function\s+app\.recover_expired_private_live_telebirr_payment_to_shadow/iu,
    );
  });

  it('rejects any attempted, completed, reserved, or already-used live payment', () => {
    expect(recoverySource).toContain('app.private_live_telebirr_verification_attempts');
    expect(recoverySource).toContain('app.private_live_telebirr_verification_outcomes');
    expect(recoverySource).toContain('app.private_live_deposit_pilot_reservations');
    expect(recoverySource).toContain('app.provider_payment_evidence');
    expect(recoverySource).toContain('source_job.recovery_request_key is not null');
    expect(recoverySource).toContain('source_job.expires_at > authorized_at');
    expect(recoverySource).toContain("source_proof.submitted_at + interval '24 hours'");
  });

  it('binds the fresh pilot to identical frozen players, customers, provider, receiver, and policy', () => {
    expect(recoverySource).toContain('source_pilot.platform_agent_account_id');
    expect(recoverySource).toContain('source_pilot.maximum_aggregate_minor');
    expect(recoverySource).toContain('app.private_live_deposit_pilot_players');
    expect(recoverySource).toContain('app.private_live_deposit_pilot_customers');
    expect(recoverySource).toContain('app.private_live_deposit_pilot_providers');
    expect(recoverySource).toContain('source_profile.receiver_identity_digest');
    expect(recoverySource).toContain('source_profile.deposit_policy_version_id');
    expect(recoverySource).toContain('source_profile.automatic_freshness_seconds');
  });

  it('cannot create settlement, claims, execution, KemerBet actions, or money movement', () => {
    expect(recoverySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_execution_jobs|private_live_deposit_pilot_reservations)/iu,
    );
    expect(recoverySource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|kemerbet|transfer|settle)/iu,
    );
    expect(migrationSource).not.toMatch(
      /recover_expired_private_live_telebirr_payment_to_shadow\s*\(\s*'[0-9a-f-]+'/iu,
    );
  });

  it('makes replay exact through a retained canonical recovery digest', () => {
    expect(migrationSource).toContain('app.private_telebirr_expired_pilot_shadow_recovery_digest');
    expect(recoverySource).toContain(
      'existing_recovery.recovery_request_key is distinct from p_recovery_request_key',
    );
    expect(recoverySource).toContain(
      'existing_recovery.recovery_request_digest is distinct from recovery_digest',
    );
    expect(recoverySource).toContain('existing_recovery.expires_at');
    expect(recoverySource).toContain('true;');
  });
});
