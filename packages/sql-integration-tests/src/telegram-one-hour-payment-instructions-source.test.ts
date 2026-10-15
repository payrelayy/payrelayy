import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261015135425_telegram_one_hour_payment_instructions.sql',
    import.meta.url,
  ),
);
let source = '';

beforeAll(async () => {
  source = await readFile(migrationPath, 'utf8');
});

describe('one-hour Telegram payment instruction migration', () => {
  it('requires financial gates off and retains historical instruction deadlines', () => {
    expect(source).toContain("switch.feature_key in ('payment_verification', 'deposit_execution')");
    expect(source).toContain("switch.mode = 'disabled'");
    expect(source).toContain("created_at + interval '10 minutes'");
    expect(source).toContain("created_at + interval '1 hour'");
    expect(source).toContain("created_at + interval '12 hours'");
    expect(source).toContain('Routine TeleBirr presentation is not the reviewed definition.');
    expect(source).toContain("'v_now + interval ''1 hour'''");
  });

  it('tracks only bot message IDs and deadlines in a forced-RLS table', () => {
    expect(source).toContain('create table app.telegram_payment_instruction_messages');
    expect(source).toContain('private_chat_id bigint not null');
    expect(source).toContain('telegram_message_id bigint not null');
    expect(source).toContain('expires_at timestamptz not null');
    expect(source).toContain(
      'alter table app.telegram_payment_instruction_messages force row level security;',
    );
    expect(source).not.toMatch(/create policy|grant select on table/iu);
    expect(source).not.toMatch(/(?:update|insert into|delete from)\s+app\.feature_switches/iu);
    expect(source).not.toMatch(/app\.deposit_execution_jobs|app\.deposit_intents/iu);
  });

  it('leases overdue deletion, suppresses redundant menu, and has bounded retries', () => {
    expect(source).toContain('for update skip locked');
    expect(source).toContain('instruction.expires_at <= v_now');
    expect(source).toContain('newer.expires_at > v_now');
    expect(source).toContain("candidate.intake_mode = 'paid'");
    expect(source).toContain('instruction_suppress_menu boolean');
    expect(source).toContain('instruction.attempts >= 10');
    expect(source).toContain("p_result not in ('complete', 'retry', 'unavailable')");
  });
});
