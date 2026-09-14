import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260915010000_telegram_live_telebirr_proof_intake.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let captureSource = '';
let statusSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  captureSource =
    migrationSource.match(
      /create function app\.capture_telegram_live_telebirr_proof\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  statusSource =
    migrationSource.match(
      /create function app\.get_telegram_customer_live_telebirr_proof\([\s\S]+?\n\$\$;/u,
    )?.[0] ?? '';
  expect(captureSource).not.toBe('');
  expect(statusSource).not.toBe('');
});

describe('Telegram live TeleBirr proof intake migration source boundary', () => {
  it('installs only while financial authority is inactive and never activates a switch', () => {
    expect(migrationSource).toContain(
      'if app.current_private_trusted_telebirr_activation_epoch() is not null then',
    );
    expect(migrationSource).toContain(
      'proof intake migration requires inactive financial authority',
    );
    expect(migrationSource).not.toMatch(
      /(?:insert into|update|delete from)\s+app\.feature_switches/iu,
    );
    expect(migrationSource).not.toMatch(
      /(?:insert into|update)\s+app\.private_trusted_telebirr_activation_/iu,
    );
  });

  it('distinguishes a real payment prompt from every review-only destination receipt', () => {
    expect(migrationSource).toContain(
      'create table app.telegram_live_telebirr_payment_presentations',
    );
    expect(migrationSource).toContain(
      'create function app.prepare_telegram_live_telebirr_destination(',
    );
    expect(migrationSource).toContain('from app.prepare_telegram_telebirr_destination(');
    expect(captureSource).toContain(
      'from app.telegram_live_telebirr_payment_presentations live_presentation',
    );
    expect(captureSource).not.toContain('from app.telegram_telebirr_destination_receipts receipt');
  });

  it('keeps both receipts immutable, forced-RLS, policy-free, and without table grants', () => {
    for (const table of [
      'telegram_live_telebirr_payment_presentations',
      'telegram_live_telebirr_proof_receipts',
    ]) {
      expect(migrationSource).toContain(`alter table app.${table} force row level security;`);
    }
    expect(migrationSource).toContain('telegram_live_telebirr_presentations_immutable');
    expect(migrationSource).toContain('telegram_live_telebirr_proof_receipts_immutable');
    expect(migrationSource).not.toMatch(/create policy/iu);
    expect(migrationSource).not.toMatch(/grant (?:select|insert|update|delete|all).*on table/iu);
  });

  it('locks authority, all financial switches, and the pilot before the Telegram actor', () => {
    const authorityPosition = captureSource.indexOf(
      'from app.private_trusted_telebirr_activation_control',
    );
    const switchesPosition = captureSource.indexOf('from app.feature_switches feature_switch');
    const pilotPosition = captureSource.indexOf(
      'from app.private_live_deposit_pilot_revisions pilot_revision',
    );
    const inboundPosition = captureSource.indexOf(
      'perform app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id)',
    );
    expect(authorityPosition).toBeGreaterThan(0);
    expect(switchesPosition).toBeGreaterThan(authorityPosition);
    expect(pilotPosition).toBeGreaterThan(switchesPosition);
    expect(inboundPosition).toBeGreaterThan(pilotPosition);
    expect(captureSource).toContain('order by feature_switch.feature_key');
    expect(captureSource).toContain('for update;');
  });

  it('creates one protected proof and immediately stages only the existing verifier job', () => {
    expect(
      captureSource.match(/insert into app\.private_live_deposit_pilot_proofs/gu),
    ).toHaveLength(1);
    expect(
      captureSource.match(/app\.stage_private_live_telebirr_verification_job\(/gu),
    ).toHaveLength(1);
    expect(captureSource).not.toMatch(
      /insert into app\.(?:deposit_intents|deposit_submissions|deposit_jobs|deposit_payment_claims)/iu,
    );
    expect(captureSource).not.toMatch(
      /app\.(?:finalize_private_live_verified_deposit_and_enqueue_execution|lease_next_private_live_deposit_execution|fence_private_live_deposit_execution_final_action)\s*\(/iu,
    );
  });

  it('returns a customer-safe historical status without granting financial authority', () => {
    expect(statusSource).toContain("then 'rejected'::text");
    expect(statusSource).toContain("then 'verification_review'::text");
    expect(statusSource).toContain("else 'verification_pending'::text");
    expect(statusSource).toContain('then intent.status::text');
    expect(statusSource).toContain('resolved_identity_id');
    expect(statusSource).not.toMatch(/candidate_reference|receiver_account|selected_player/iu);
    expect(statusSource).not.toMatch(/\binsert\b|\bupdate\b|\bdelete\b/iu);
  });

  it('grants only the three narrow SECURITY DEFINER functions to player actions', () => {
    expect(captureSource).toMatch(/security definer\s+set search_path = pg_catalog/u);
    expect(statusSource).toMatch(/security definer\s+set search_path = pg_catalog/u);
    const grant = migrationSource.match(
      /grant execute on function[\s\S]+?to fetanagent_player_actions;/u,
    )?.[0];
    expect(grant).toBeDefined();
    expect(grant).toContain('app.prepare_telegram_live_telebirr_destination');
    expect(grant).toContain('app.capture_telegram_live_telebirr_proof');
    expect(grant).toContain('app.get_telegram_customer_live_telebirr_proof');
    expect(grant).not.toContain('stage_private_live_telebirr_verification_job');
    expect(migrationSource).not.toMatch(/create role|\bpassword\b/iu);
  });
});
