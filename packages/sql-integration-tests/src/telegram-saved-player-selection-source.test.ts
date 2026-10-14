import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20261014230131_telegram_saved_player_selection.sql',
    import.meta.url,
  ),
);
let source = '';

beforeAll(async () => {
  source = await readFile(migrationPath, 'utf8');
});

describe('Telegram saved Player selection migration', () => {
  it('stores one selection per Telegram identity, not one payer per Player', () => {
    expect(source).toContain('telegram_identity_id uuid primary key');
    expect(source).toContain('player_account_id uuid not null');
    expect(source).toContain('telegram_player_selections_player_idx');
    expect(source).not.toMatch(/unique\s*\(player_account_id\)/iu);
  });

  it('keeps the table private and callable only through two narrow functions', () => {
    expect(source).toContain(
      'alter table app.telegram_player_selections force row level security;',
    );
    expect(source).toContain('revoke all on table app.telegram_player_selections');
    expect(source).toContain('grant execute on function app.get_telegram_saved_player_selection');
    expect(source).toContain('app.save_telegram_player_selection(uuid,text)');
    expect(source).not.toMatch(/create policy|grant select on table/iu);
  });

  it('rechecks eligibility but does not move money or change payment gates', () => {
    expect(source).toContain("app.resolve_dry_run_deposit_proof_boundary(p_player_id, 'telebirr')");
    expect(source).toContain('app.lock_telegram_inbound_event_scope(p_origin_inbound_event_id)');
    expect(source).toContain('v_processed_at is not null');
    expect(source).not.toMatch(/(?:update|insert into|delete from)\s+app\.feature_switches/iu);
    expect(source).not.toMatch(/app\.deposit_execution_jobs|app\.deposit_intents/iu);
  });
});
