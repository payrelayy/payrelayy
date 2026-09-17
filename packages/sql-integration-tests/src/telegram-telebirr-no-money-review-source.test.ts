import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';

let source = '';
beforeAll(async () => {
  source = await readFile(
    new URL(
      '../../../supabase/migrations/20260917070203_telegram_telebirr_no_money_receiver_review.sql',
      import.meta.url,
    ),
    'utf8',
  );
});

describe('TeleBirr no-money receiver review boundary', () => {
  it('preserves the public RPC signature and grants no new runtime privileges', () => {
    expect(source).toContain(
      'create or replace function app.prepare_telegram_telebirr_destination(',
    );
    expect(source).not.toMatch(/\bgrant\s|create role|\bpassword\b/iu);
    expect(source).toContain(
      'revoke all on function app.lock_private_telebirr_receiver_review_pilot()',
    );
    expect(source).toContain('set search_path = pg_catalog');
  });

  it('requires an armed exact five-player dry-run pilot and all six money features disabled', () => {
    expect(source).toContain("pilot_switch.mode = 'dry_run'");
    expect(source).toContain("feature_switch.mode = 'disabled'");
    expect(source).toContain("feature_switch.settings = '{}'::jsonb) <> 6");
    expect(source).toContain('pilot.maximum_per_deposit_minor = 2500');
    expect(source).toContain('pilot.maximum_aggregate_minor = 12500');
    expect(source).toContain('pilot.maximum_reservation_count = 5');
    expect(source).toContain("provider.provider_code_snapshot = 'telebirr'");
    expect(source).toContain('v_pilot.expires_at <= pg_catalog.clock_timestamp()');
  });

  it('locks the review switches and pilot before taking inbound and identity locks', () => {
    const body = source.slice(source.indexOf('create or replace function'));
    expect(body.indexOf('app.lock_private_telebirr_receiver_review_pilot()')).toBeLessThan(
      body.indexOf('app.lock_telegram_inbound_event_scope('),
    );
  });

  it('binds review to the exact current owner, eligibility, receiver and pilot without replay upgrades', () => {
    for (const predicate of [
      'v_receipt.activation_epoch is null',
      'member.player_owner_customer_id_snapshot = v_customer_id',
      'member.eligibility_decision_id_snapshot = v_eligibility.id',
      'destination.receiver_updated_at_snapshot = v_receiver.updated_at',
      'review.pilot_revision_id = v_review_pilot_id',
      'review.configuration_digest = pilot.configuration_digest',
    ])
      expect(source).toContain(predicate);
    expect(source).toMatch(
      /if not v_request_replayed then\s+insert into app\.telegram_telebirr_receiver_review_receipts/u,
    );
  });

  it('keeps review receipts immutable, forced-RLS and twelve-hour presentation unchanged', () => {
    expect(source).toContain('force row level security');
    expect(source).toContain(
      'before update or delete on app.telegram_telebirr_receiver_review_receipts',
    );
    expect(source).toContain('before truncate on app.telegram_telebirr_receiver_review_receipts');
    expect(source).toContain("v_now + interval '12 hours'");
    expect(source).not.toMatch(/create policy/iu);
  });

  it('never upgrades the payment flag, accepts proof, enqueues execution or writes a financial switch', () => {
    expect(source).toContain('v_payments_enabled := v_activation_epoch is not null');
    expect(source).toContain('case when v_payments_enabled or v_receiver_review_enabled');
    expect(source).toContain("'accepts_payments', v_payments_enabled");
    expect(source).toContain("'receiver_review_only', v_receiver_review_enabled");
    expect(source).not.toMatch(
      /(?:insert into|update|delete from)\s+app\.(?:feature_switches|deposit_intents|payment_claims|deposit_execution_jobs|private_live_deposit_pilot_proofs|private_live_telebirr_verification_jobs)\b/iu,
    );
  });
});
