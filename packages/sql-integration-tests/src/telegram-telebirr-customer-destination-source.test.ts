import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260912180633_telegram_telebirr_customer_destination.sql',
    import.meta.url,
  ),
);

let migrationSource = '';
let functionSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  const match = migrationSource.match(
    /create function app\.prepare_telegram_telebirr_destination\([\s\S]+?\n\$\$;/u,
  );
  expect(match).not.toBeNull();
  functionSource = match![0];
});

describe('Telegram TeleBirr customer destination migration source boundary', () => {
  it('requires inactive financial authority and never mutates the frozen switch cohort', () => {
    expect(migrationSource).toContain(
      'if app.current_private_trusted_telebirr_activation_epoch() is not null then',
    );
    expect(migrationSource).toContain(
      'destination migration requires inactive financial authority',
    );
    expect(migrationSource).not.toMatch(
      /(?:insert into|update|delete from)\s+app\.feature_switches/iu,
    );
  });

  it('keeps presentation receipts private, immutable, and forced-RLS without policies', () => {
    expect(migrationSource).toContain(
      'alter table app.telegram_telebirr_destination_receipts force row level security;',
    );
    expect(migrationSource).toContain(
      'create trigger telegram_telebirr_destination_receipts_immutable',
    );
    expect(migrationSource).toContain(
      'create trigger telegram_telebirr_destination_receipts_no_truncate',
    );
    expect(migrationSource).not.toMatch(/create policy/iu);
    expect(migrationSource).not.toMatch(/grant (?:select|insert|update|delete|all).*on table/iu);
  });

  it('pins one SECURITY DEFINER function to a fixed path and the narrow runtime role', () => {
    expect(functionSource).toMatch(
      /language plpgsql\s+security definer\s+set search_path = pg_catalog, app, pg_temp/u,
    );
    expect(migrationSource).toMatch(
      /grant execute on function app\.prepare_telegram_telebirr_destination\(uuid, text, text\)\s+to fetanagent_player_actions;/u,
    );
    expect(migrationSource).not.toMatch(/create role|\bpassword\b/iu);
  });

  it('binds both new requests and replays to the authenticated customer and latest eligibility', () => {
    expect(functionSource.match(/player\.customer_id = v_customer_id/gu)).toHaveLength(2);
    expect(functionSource.match(/order by decision\.decision_version desc/gu)).toHaveLength(2);
    expect(functionSource.match(/decision <> 'eligible'/gu)).toHaveLength(2);
    expect(functionSource.match(/is distinct from v_player\.updated_at/gu)).toHaveLength(2);
    expect(functionSource).toContain(
      'v_receipt.semantic_input_hmac is distinct from p_semantic_input_hmac',
    );
  });

  it('reveals protected receiver material only in the exact epoch bound to its receipt', () => {
    expect(functionSource).toContain(
      'v_activation_epoch := app.current_private_trusted_telebirr_activation_epoch()',
    );
    expect(functionSource).toContain('activation_epoch,');
    expect(functionSource).toContain(
      'v_receipt.activation_epoch is not distinct from v_activation_epoch',
    );
    expect(functionSource).toContain(
      'pg_catalog.clock_timestamp() < v_receipt.payment_presentation_expires_at',
    );
    expect(functionSource).toContain(
      'case when v_payments_enabled then v_receiver.account_reference_ciphertext end',
    );
    expect(functionSource).toContain(
      'case when v_payments_enabled then v_receiver.account_reference_fingerprint end',
    );
  });

  it('audits disclosure as a boolean without copying recipient details', () => {
    const auditInsert = functionSource.match(
      /insert into app\.audit_events[\s\S]+?\n    \);/u,
    )?.[0];
    expect(auditInsert).toBeDefined();
    expect(auditInsert).toContain("'payment_details_disclosed', v_payments_enabled");
    expect(auditInsert).not.toMatch(
      /account_holder_name|account_reference_(?:ciphertext|fingerprint|masked)/iu,
    );
  });
});
