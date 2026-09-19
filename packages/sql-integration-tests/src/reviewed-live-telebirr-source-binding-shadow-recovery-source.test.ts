import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260919205000_recover_reviewed_source_binding_to_shadow.sql',
    import.meta.url,
  ),
);
let migrationSource = '';
let recoverySource = '';
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
  recoverySource = extractFunction(
    migrationSource,
    'recover_reviewed_private_live_telebirr_source_binding_to_shadow',
  );
  validatorSource = extractFunction(
    migrationSource,
    'private_live_telebirr_source_binding_shadow_recovery_is_valid',
  );
});

describe('reviewed live TeleBirr source-binding shadow recovery', () => {
  it('uses a separate immutable one-use ledger without changing legacy digests', () => {
    for (const fragment of [
      'create table app.private_live_telebirr_source_binding_shadow_recoveries',
      'source_binding_retry_request_key uuid not null unique',
      'source_live_proof_id uuid not null unique',
      'source_live_outcome_id uuid not null unique',
      'replacement_shadow_proof_request_id uuid not null unique',
      'private_live_tbirr_binding_shadow_recoveries_immutable',
      'private_live_tbirr_binding_shadow_recoveries_no_truncate',
      'force row level security',
      'private_live_telebirr_source_recovery_legacy_is_valid',
    ]) {
      expect(migrationSource).toContain(fragment);
    }
    expect(migrationSource).not.toContain(
      'create or replace function app.private_live_telebirr_source_recovery_digest',
    );
    expect(migrationSource).not.toMatch(/grant\s+(?:select|insert|update|delete|execute)/iu);
  });

  it('accepts only the exact closed one-attempt source-unavailable lineage', () => {
    for (const fragment of [
      "source_closure.reason_code <> 'operator_stop'",
      "original_closure.reason_code <> 'operator_stop'",
      "source_outcome.disposition <> 'review_required'",
      "source_outcome.reason_code <> 'source_unavailable'",
      'source_attempt_count <> 1',
      'source_transcript_count <> 1',
      'source_delivery_count <> 1',
      'source_evidence_count <> 1',
      'source_observation_count <> 1',
      'source_outcome_count <> 1',
      'private_live_telebirr_historical_completion_consumptions',
      'private_live_telebirr_source_document_bindings',
    ]) {
      expect(recoverySource).toContain(fragment);
    }
  });

  it('requires the exact twelve-hour dry-run pilot and complete no-money boundary', () => {
    for (const fragment of [
      'locked_switch_count <> 7',
      'app.private_telebirr_shadow_mode_is_ready(target_pilot.id)',
      "target_pilot.active_from + interval '12 hours'",
      "interval '11 hours 50 minutes'",
      'app.current_private_trusted_telebirr_activation_epoch() is not null',
      'app.agent_platform_companion_execution_control',
      'fetanagent_deposit_executor_runtime',
      'fetanagent_trusted_telebirr_verifier_runtime',
    ]) {
      expect(recoverySource).toContain(fragment);
    }
    expect(recoverySource).not.toMatch(/update\s+app\.feature_switches/iu);
    expect(recoverySource).not.toMatch(/alter\s+role/iu);
  });

  it('copies only the already-protected reference into one shadow request and ledger row', () => {
    const insertedTables = [...recoverySource.matchAll(/insert into app\.([a-z0-9_]+)/giu)].map(
      (match) => match[1],
    );
    expect(insertedTables).toEqual([
      'private_telebirr_shadow_proof_requests',
      'private_live_telebirr_source_binding_shadow_recoveries',
      'audit_events',
    ]);
    expect(recoverySource).toContain('source_proof.candidate_reference_ciphertext');
    expect(recoverySource).toContain('source_proof.candidate_reference_fingerprint');
    expect(recoverySource).toContain('target_pilot.expires_at');
    expect(recoverySource).not.toMatch(/\b(?:update|delete\s+from|truncate)\s+app\./iu);
  });

  it('cannot create reservation, settlement, execution, credit, or money movement', () => {
    expect(recoverySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
    );
    expect(recoverySource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|transfer_money)/iu,
    );
    for (const table of [
      'app.private_live_deposit_pilot_reservations',
      'app.private_live_telebirr_settlement_receipts',
      'app.provider_payment_evidence',
    ]) {
      expect(recoverySource).toContain(table);
    }
  });

  it('recomputes both source-binding and continuation digests in the validator', () => {
    expect(validatorSource).toContain('app.private_live_telebirr_source_binding_recovery_digest(');
    expect(validatorSource).toContain(
      'app.private_live_telebirr_source_binding_shadow_recovery_digest(',
    );
    expect(validatorSource).toContain('current_attempt_history_digest');
    expect(validatorSource).toContain("source_closure.reason_code = 'operator_stop'");
    expect(validatorSource).toContain('app.private_telebirr_shadow_mode_is_ready(');
  });
});
