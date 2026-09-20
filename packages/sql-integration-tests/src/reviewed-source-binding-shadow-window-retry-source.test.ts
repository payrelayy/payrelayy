import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260920090000_retry_reviewed_source_binding_shadow_window.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let boundarySource = '';
let retrySource = '';
let validatorSource = '';

function extractFunction(source: string, functionName: string): string {
  const declaration = source.indexOf(`create function app.${functionName}(`);
  expect(declaration).toBeGreaterThanOrEqual(0);
  const end = source.indexOf('\n$$;', source.indexOf('as $$', declaration));
  expect(end).toBeGreaterThan(declaration);
  return source.slice(declaration, end + '\n$$;'.length);
}

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  boundarySource = extractFunction(
    migrationSource,
    'private_telebirr_shadow_source_binding_window_boundary_is_ready',
  );
  retrySource = extractFunction(
    migrationSource,
    'retry_reviewed_private_telebirr_source_binding_shadow_window',
  );
  validatorSource = extractFunction(
    migrationSource,
    'private_telebirr_shadow_source_binding_window_retry_is_valid',
  );
});

describe('reviewed source-binding shadow window retry', () => {
  it('preserves the expired proof and creates one immutable append-only child', () => {
    for (const fragment of [
      'add column source_binding_window_retry_source_id uuid',
      'create table app.private_telebirr_shadow_source_binding_window_retries',
      'source_recovery_request_key uuid not null unique',
      'source_shadow_proof_request_id uuid not null unique',
      'replacement_shadow_proof_request_id uuid not null unique',
      'private_tbirr_shadow_binding_window_source_once_key',
      'private_tbirr_shadow_binding_window_retries_immutable',
      'private_tbirr_shadow_binding_window_retries_no_truncate',
      'force row level security',
    ]) {
      expect(migrationSource).toContain(fragment);
    }
    expect(retrySource).not.toMatch(/\b(?:update|delete\s+from|truncate)\s+app\./iu);
  });

  it('requires the exact expired untouched reviewed lineage', () => {
    for (const fragment of [
      'private_live_telebirr_source_binding_shadow_recovery_history_is_valid',
      "source_proof.proof_status <> 'verification_queued'",
      'source_proof.expires_at > authorized_at',
      'source_attempts <> 0',
      'source_outcomes <> 0',
      'source_binding_window_retry_source_id',
      'source_recovery.recovery_request_digest',
    ]) {
      expect(retrySource).toContain(fragment);
    }
  });

  it('creates an exact twelve-hour child while preserving the original assessment clock', () => {
    expect(migrationSource).toContain("retry_expires_at = authorized_at + interval '12 hours'");
    expect(retrySource).toContain("retry_until := authorized_at + interval '12 hours'");
    expect(retrySource).toContain('source_proof.submitted_at');
    expect(retrySource).toContain('source_proof.not_before');
    expect(retrySource).toContain('authorized_at,');
    expect(migrationSource).toContain(
      'private_telebirr_shadow_source_binding_window_review_deadline',
    );
  });

  it('binds the child to a fresh identical pilot and one completed paired verifier', () => {
    for (const fragment of [
      'private_live_telebirr_shadow_pilot_contract_matches',
      'private_live_telebirr_shadow_profile_contract_matches',
      'private_live_telebirr_device_enrollment_certificates',
      'private_live_telebirr_device_pairing_challenges',
      "pairing.state = 'completed'",
      "authorized_at + interval '5 minutes'",
      "target_pilot.active_from + interval '12 hours'",
      "target_pilot.expires_at <= authorized_at + interval '11 hours 50 minutes'",
    ]) {
      expect(retrySource).toContain(fragment);
    }
  });

  it('keeps every financial, settlement, KemerBet, and verifier authority inert', () => {
    for (const fragment of [
      'locked_switch_count <> 7',
      'private_telebirr_shadow_source_binding_window_boundary_is_ready',
      "execution_control.control_state = 'disabled'",
      "'fetanagent_deposit_executor_runtime'",
      "'fetanagent_trusted_telebirr_verifier_runtime'",
      "'fetanagent_telebirr_shadow_verifier_runtime'",
      'private_live_deposit_pilot_reservations',
      'private_live_telebirr_settlement_receipts',
      'provider_payment_evidence',
      "'financial_rows_created', false",
      "'execution_enabled', false",
      "'money_moved', false",
    ]) {
      expect(migrationSource).toContain(fragment);
    }
    expect(retrySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
    );
    expect(retrySource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|transfer_money)/iu,
    );
  });

  it('keeps durable no-money authority valid during only the bounded shadow-verifier session', () => {
    expect(boundarySource).toContain("'fetanagent_deposit_executor_runtime'");
    expect(boundarySource).toContain("'fetanagent_trusted_telebirr_verifier_runtime'");
    expect(boundarySource).not.toContain("'fetanagent_telebirr_shadow_verifier'");
    expect(boundarySource).not.toContain("'fetanagent_telebirr_shadow_verifier_runtime'");

    const preflight = migrationSource.slice(
      migrationSource.indexOf('do $source_binding_window_retry_preflight$'),
      migrationSource.indexOf('$source_binding_window_retry_preflight$;', 1),
    );
    expect(preflight).toContain("'fetanagent_telebirr_shadow_verifier'");
    expect(preflight).toContain("'fetanagent_telebirr_shadow_verifier_runtime'");
  });

  it('recomputes the child digest and validates current pairing and no-money state', () => {
    for (const fragment of [
      'private_telebirr_shadow_source_binding_window_retry_digest(',
      'source_recovery.recovery_request_digest',
      'source_attempt_count = retry.source_attempt_count',
      'source_outcome_count = retry.source_outcome_count',
      'private_live_telebirr_shadow_pilot_contract_matches(',
      'private_live_telebirr_shadow_profile_contract_matches(',
      'private_telebirr_shadow_source_binding_window_enrollment_is_ready(',
      'private_telebirr_shadow_source_binding_window_boundary_is_ready(',
    ]) {
      expect(validatorSource).toContain(fragment);
    }
  });

  it('preserves security-definer metadata for both exact routine rewrites', () => {
    for (const fragment of [
      'routine.prosrc = rewritten_source',
      'routine.proowner = original_owner',
      'routine.proacl is not distinct from original_acl',
      'routine.proconfig is not distinct from original_config',
      'routine.provolatile = original_volatility',
      'routine.proparallel = original_parallel',
      'routine.proleakproof = original_leakproof',
      'routine.prosecdef = original_security_definer',
      'routine.proretset = original_returns_set',
    ]) {
      expect(migrationSource).toContain(fragment);
    }
    expect(migrationSource.match(/execute rewritten_definition;/gu)).toHaveLength(3);
  });
});
