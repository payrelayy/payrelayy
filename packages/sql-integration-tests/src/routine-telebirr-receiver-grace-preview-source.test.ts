import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261015181800_routine_telebirr_receiver_grace_preview.sql',
    import.meta.url,
  ),
);
let source = '';

beforeAll(async () => {
  source = await readFile(migrationPath, 'utf8');
});

describe('dormant receiver-grace SQL preview', () => {
  it('requires both payment switches off and grants no financial capability', () => {
    expect(source).toContain("switch.feature_key in ('payment_verification', 'deposit_execution')");
    expect(source).toContain("switch.mode = 'disabled'");
    expect(source).toContain('financial_action_allowed boolean');
    expect(source).toContain('null::uuid, null::uuid, false');
    expect(source).toContain('v_instruction_id, v_receiver.id, false');
    expect(source).not.toMatch(
      /(?:insert into|update|delete from)\s+app\.(?:deposit_intents|deposit_payment_claims|deposit_jobs|feature_switches)/iu,
    );
    expect(source).not.toMatch(/grant execute/iu);
  });

  it('uses durable, same-chat instructions and detects receiver collisions and revocation', () => {
    expect(source).toContain('join app.telegram_payment_instruction_messages message');
    expect(source).toContain('message.private_chat_id = v_chat_id');
    expect(source).toContain('receipt.player_account_id = v_candidate.player_account_id');
    expect(source).toContain('v_receiver_matches <> 1');
    expect(source).toContain('v_instruction_matches <> 1');
    expect(source).toContain('app.routine_telebirr_receiver_grace_revocations');
    expect(source).toContain(
      'receipt.payment_presentation_expires_at = receipt.created_at + interval',
    );
    expect(source).toContain('v_candidate.submitted_at < receipt.payment_presentation_expires_at');
  });

  it('keeps emergency revocations private and append-only', () => {
    expect(source).toContain('force row level security;');
    expect(source).toContain('routine_telebirr_receiver_grace_revocations_immutable');
    expect(source).toContain('routine_telebirr_receiver_grace_revocations_no_truncate');
    expect(source).not.toMatch(/create policy/iu);
    expect(source).not.toMatch(/grant (?:select|insert|update|delete|all) on table/iu);
  });
});
