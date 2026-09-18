import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260918150906_prepare_expired_live_telebirr_source_unavailable_shadow_recovery.sql',
    import.meta.url,
  ),
);
const originalMigrationPath = fileURLToPath(
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

let migrationSource = '';
let originalMigrationSource = '';
let provisionSource = '';
let bindingSource = '';
let recoverySource = '';
let validatorSource = '';

function extractFunction(source: string, functionName: string): string {
  const declarationPattern = new RegExp(
    `create(?: or replace)? function app\\.${functionName}\\(`,
    'u',
  );
  const declaration = source.search(declarationPattern);
  expect(declaration).toBeGreaterThanOrEqual(0);
  const body = source.indexOf('as $$', declaration);
  const end = source.indexOf('\n$$;', body);
  expect(body).toBeGreaterThan(declaration);
  expect(end).toBeGreaterThan(body);
  return source.slice(declaration, end + '\n$$;'.length);
}

beforeAll(async () => {
  [migrationSource, originalMigrationSource, provisionSource] = await Promise.all([
    readFile(migrationPath, 'utf8'),
    readFile(originalMigrationPath, 'utf8'),
    readFile(provisionPath, 'utf8'),
  ]);
  bindingSource = extractFunction(
    migrationSource,
    'private_live_telebirr_expired_source_binding_digest',
  );
  recoverySource = extractFunction(
    migrationSource,
    'recover_private_live_telebirr_source_to_shadow',
  );
  validatorSource = extractFunction(
    migrationSource,
    'private_live_telebirr_source_recovery_is_valid',
  );
});

describe('expired live TeleBirr source-unavailable shadow recovery preparation', () => {
  it('stores one opaque, immutable authorization without a raw production identifier', () => {
    for (const fragment of [
      'create table app.private_live_telebirr_expired_source_authorizations',
      'source_proof_binding_digest text primary key',
      "check (source_proof_binding_digest ~ '^sha256:[0-9a-f]{64}$')",
      "check (reason_code = 'reviewed_expired_source_unavailable_no_credit')",
      'private_live_tbirr_expired_source_auth_proof_check',
      "source_proof_binding_digest =\n      'sha256:",
      "valid_after = timestamptz '2026-09-18 15:03:54+00'",
      "expires_at = timestamptz '2026-09-24 15:03:54+00'",
      "expires_at = valid_after + interval '6 days'",
      'private_live_tbirr_expired_source_auth_immutable',
      'private_live_tbirr_expired_source_auth_no_truncate',
      'force row level security',
      'insert into app.private_live_telebirr_expired_source_authorizations',
    ]) {
      expect(migrationSource).toContain(fragment);
    }

    const authorizationInserts = [
      ...migrationSource.matchAll(
        /insert into app\.private_live_telebirr_expired_source_authorizations/giu,
      ),
    ];
    expect(authorizationInserts).toHaveLength(1);
    expect(migrationSource.match(/'sha256:[0-9a-f]{64}'/gu)).toHaveLength(2);
    expect(migrationSource).not.toMatch(
      /'[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'/iu,
    );
    expect(migrationSource).not.toMatch(/grant\s+(?:select|insert|update|delete|execute)/iu);
  });

  it('derives a domain-separated binding in a locked-down definer function', () => {
    for (const fragment of [
      'immutable',
      'strict',
      'security definer',
      'set search_path = pg_catalog',
      'fetanagent:telebirr:expired-source-unavailable:authorized-proof:v1',
      "'|source_proof_id=' || p_source_live_proof_id::text",
      'app.private_live_deposit_pilot_sha256(',
    ]) {
      expect(bindingSource).toContain(fragment);
    }
    expect(migrationSource).toContain(
      'revoke all on function app.private_live_telebirr_expired_source_binding_digest(uuid)',
    );
  });

  it('preserves the ordinary 24-hour path and opens only the bound 24-hour-to-7-day exception', () => {
    expect(originalMigrationSource).toContain(
      "or authorized_at >= source_proof.submitted_at + interval '24 hours'",
    );
    for (const fragment of [
      "authorized_at >= source_proof.submitted_at + interval '24 hours'",
      'expired_source_authorization.source_proof_binding_digest is null',
      "'reviewed_expired_source_unavailable_no_credit'",
      'expired_source_authorization.valid_after > authorized_at',
      "expired_source_authorization.expires_at <= authorized_at + interval '60 seconds'",
      "authorized_at >= source_proof.submitted_at + interval '7 days'",
      "when authorized_at < source_proof.submitted_at + interval '24 hours'",
      'expired_source_authorization.expires_at',
    ]) {
      expect(recoverySource).toContain(fragment);
    }
  });

  it('keeps every existing source-lineage and no-money predicate in the replacement', () => {
    for (const fragment of [
      'source_attempt_count <> 4',
      'source_assignment_transcript_count <> 2',
      'source_assignment_delivery_count <> 2',
      'source_device_evidence_count <> 2',
      'source_observation_count <> 1',
      "root_outcome.reason_code is distinct from 'source_unavailable'",
      "terminal_outcome.reason_code is distinct from 'source_unavailable'",
      'app.current_private_trusted_telebirr_activation_epoch() is not null',
      'app.private_telebirr_shadow_mode_is_ready(target_pilot.id)',
      'app.private_live_deposit_pilot_reservations',
      'app.private_live_telebirr_settlement_receipts',
      'app.provider_payment_evidence',
      'fetanagent_deposit_executor_runtime',
      "target_heartbeat.runtime_state <> 'ready'",
    ]) {
      expect(recoverySource).toContain(fragment);
    }

    const insertedTables = [...recoverySource.matchAll(/insert into app\.([a-z0-9_]+)/giu)].map(
      (match) => match[1],
    );
    expect(insertedTables).toEqual([
      'private_telebirr_shadow_proof_requests',
      'private_live_telebirr_source_recoveries',
    ]);
    expect(recoverySource).not.toMatch(/\b(?:update|delete\s+from|truncate)\s+app\./iu);
    expect(recoverySource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|provider_payment_evidence|deposit_verification_attempts|deposit_payment_claims|deposit_jobs|private_live_deposit_pilot_reservations|private_live_telebirr_settlement_receipts)/iu,
    );
    expect(recoverySource).not.toMatch(
      /(?:finalize_private_live_verified_deposit|enqueue_execution|kemerbet|transfer_money)/iu,
    );
  });

  it('requires the same binding and bounded window when validating the append-only child', () => {
    for (const fragment of [
      'app.private_live_telebirr_expired_source_binding_digest(source_proof.id)',
      "recovery.authorized_at < source_proof.submitted_at + interval '24 hours'",
      "recovery.authorized_at >= source_proof.submitted_at + interval '24 hours'",
      "recovery.authorized_at < source_proof.submitted_at + interval '7 days'",
      'expired_source_authorization.source_proof_binding_digest is not null',
      'expired_source_authorization.valid_after <= recovery.authorized_at',
      'expired_source_authorization.expires_at > recovery.authorized_at',
      'app.private_live_telebirr_source_recovery_digest(',
      'app.private_telebirr_expired_pilot_shadow_recovery_digest(',
    ]) {
      expect(validatorSource).toContain(fragment);
    }
  });

  it('lets the provisioner cross the old age gate only through the private validator', () => {
    expect(provisionSource).toMatch(
      /pg_catalog\.clock_timestamp\(\) < proof\.submitted_at \+ case[\s\S]*?else interval '24 hours'[\s\S]*?or app\.private_live_telebirr_source_recovery_is_valid\(/u,
    );
    expect(provisionSource).toContain(
      "shadow_proof.expires_at > pg_catalog.clock_timestamp() + interval '60 seconds'",
    );
  });
});
