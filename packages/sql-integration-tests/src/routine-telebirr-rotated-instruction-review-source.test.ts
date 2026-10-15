import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261015212000_routine_telebirr_rotated_instruction_review.sql',
    import.meta.url,
  ),
);
let source = '';

beforeAll(async () => {
  source = await readFile(migrationPath, 'utf8');
});

describe('rotated-instruction review migration', () => {
  it('requires a no-money installation and keeps review records private and immutable', () => {
    expect(source).toContain("switch.mode = 'disabled'");
    expect(source).toContain('create table app.routine_telebirr_rotated_instruction_reviews');
    expect(source).toContain(
      'alter table app.routine_telebirr_rotated_instruction_reviews force row level security',
    );
    expect(source).toContain('routine_rotated_instruction_reviews_immutable');
    expect(source).not.toMatch(/(?:update|insert into|delete from)\s+app\.feature_switches/iu);
  });

  it('requires an actually displayed, same-identity and Player one-hour instruction', () => {
    expect(source).toContain('join app.telegram_payment_instruction_messages message');
    expect(source).toContain('receipt.customer_identity_id = new.origin_identity_id');
    expect(source).toContain('receipt.player_account_id = new.player_account_id');
    expect(source).toContain('receipt.receiver_account_id <> new.receiver_account_id');
    expect(source).toContain("receipt.created_at + interval '1 hour'");
    expect(source).toContain('instructed.retired_at < receipt.payment_presentation_expires_at');
  });

  it('stops automatic challenges and claims and gives one review status', () => {
    expect(source).toContain("new.id, 'final', v_chat_id");
    expect(source).toContain("'manual_review', null");
    expect(source).toContain('deposit.telebirr_receiver_rotation_review_queued');
    expect(source).toContain('create trigger routine_telebirr_rotated_instruction_on_change');
    expect(source).toContain(
      'Resolve pending TeleBirr Player credits before rotating this receiver.',
    );
    expect(source).toContain('routine_telebirr_reviewed_no_paid_challenge');
    expect(source).toContain('routine_telebirr_reviewed_no_paid_claim');
    expect(source).toContain('and not exists (select 1');
    expect(source).toContain('from app.routine_telebirr_rotated_instruction_reviews review');
    expect(source).not.toMatch(/insert into\s+app\.deposit_payment_claims/iu);
  });
});
