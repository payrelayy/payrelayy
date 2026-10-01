import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261001225043_recover_quarantined_live_telebirr_after_device_pin_handoff.sql',
    import.meta.url,
  ),
);

let source = '';
let recovery = '';
let guard = '';

beforeAll(async () => {
  source = await readFile(migrationPath, 'utf8');
  recovery =
    source.match(
      /create function app\.recover_private_live_telebirr_after_device_pin_handoff\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  guard = source.match(/guard_branch constant text := \$guard\$([\s\S]+?)\$guard\$;/u)?.[1] ?? '';
  expect(recovery).not.toBe('');
  expect(guard).not.toBe('');
});

describe('one-use live TeleBirr device-pin-handoff recovery', () => {
  it('keeps both quarantined signed pairs immutable and requires a new assignment', () => {
    expect(source).toContain('attempt_count <> 2 or valid_count <> 2');
    expect(source).toContain("quarantine.reason_code = 'trusted_evidence_invalid'");
    expect(source).toContain('attempt.attempt_number in (1, 2)');
    expect(source).not.toMatch(
      /(?:delete\s+from|update)\s+app\.private_live_telebirr_verifier_evidence_quarantine/iu,
    );
    expect(source).not.toMatch(
      /(?:delete\s+from|update)\s+app\.private_live_telebirr_device_evidence_staging/iu,
    );
  });

  it('binds a single expired job, current pilot and pin, without execution authority', () => {
    expect(recovery).toContain("session_user <> 'postgres'");
    expect(recovery).toContain('app.current_private_trusted_telebirr_activation_epoch()');
    expect(recovery).toContain(
      'enrollment.public_key_spki_sha256 is distinct from p_expected_device_pin',
    );
    expect(recovery).toContain("h.runtime_state = 'ready' and h.status_code = 'no_assignment'");
    expect(recovery).toContain('job.recovery_request_key is not null');
    expect(recovery).toContain('j.recovery_request_key is null');
    expect(recovery).toContain("c.control_state = 'disabled'");
    expect(recovery).toContain("retry_until <= authorized_at + interval '60 seconds'");
    expect(recovery).not.toMatch(
      /(?:insert\s+into|update)\s+app\.(?:deposit_jobs|deposit_intents|provider_payment_evidence|deposit_payment_claims|private_live_deposit_pilot_reservations|feature_switches)/iu,
    );
  });

  it('makes the only permitted update digest-bound and preserves ordinary guard authority', () => {
    expect(guard).toContain("new.recovery_reason_code = 'device_pin_handoff_retry'");
    expect(guard).toContain('app.private_live_telebirr_pin_handoff_evidence_digest(old.id)');
    expect(guard).toContain('new.recovery_request_digest is distinct from expected_digest');
    expect(source).toContain('fd355332c2f6a62a44df84aaea3d97a8feedcd2580e966e43a22569fcbf7d0e3');
    expect(source).toContain(
      "p.proowner = (select oid from pg_catalog.pg_roles where rolname='postgres')",
    );
    expect(source).toContain(
      'revoke all on function app.private_live_telebirr_pin_handoff_evidence_digest(uuid)',
    );
  });
});
