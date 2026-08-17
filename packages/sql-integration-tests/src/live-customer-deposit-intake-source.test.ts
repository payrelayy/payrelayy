import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260816033056_private_live_customer_deposit_intake.sql',
    import.meta.url,
  ),
);

const exactFunctions = [
  'open_telegram_live_deposit_intent',
  'capture_telegram_live_deposit_reference',
  'get_telegram_customer_deposit',
  'open_customer_web_deposit_intent',
  'capture_customer_web_deposit_reference',
  'list_customer_web_deposits',
] as const;

let migrationSource = '';
const functionSources = new Map<(typeof exactFunctions)[number], string>();

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
  for (const functionName of exactFunctions) {
    const match = migrationSource.match(
      new RegExp(`create function app\\.${functionName}\\([\\s\\S]+?\\n\\$\\$;`, 'u'),
    );
    expect(match, `${functionName} must have one checked-in definition`).not.toBeNull();
    functionSources.set(functionName, match![0]);
  }
});

describe('live customer deposit intake migration source boundary', () => {
  it('pins all six exact SECURITY DEFINER fixed-path signatures', () => {
    expect(migrationSource).toContain(
      'app.open_telegram_live_deposit_intent(uuid, text, bigint, text)',
    );
    expect(migrationSource).toContain(
      'app.capture_telegram_live_deposit_reference(uuid, uuid, text, text, text, smallint, text)',
    );
    expect(migrationSource).toContain('app.get_telegram_customer_deposit(uuid, uuid)');
    expect(migrationSource).toContain(
      'app.open_customer_web_deposit_intent(uuid, uuid, text, bigint)',
    );
    expect(migrationSource).toContain(
      'app.capture_customer_web_deposit_reference(uuid, uuid, uuid, text, text, text, smallint)',
    );
    expect(migrationSource).toContain('app.list_customer_web_deposits(uuid, integer)');

    for (const source of functionSources.values()) {
      expect(source).toMatch(
        /language plpgsql\s+security definer\s+set search_path = pg_catalog, app, pg_temp/u,
      );
    }
    expect(migrationSource.match(/security definer/gu)).toHaveLength(6);
    for (const helperName of [
      'reject_live_deposit_request_receipt_mutation',
      'enforce_telegram_live_deposit_receipt_binding',
      'block_inbound_consumption_after_live_deposit_receipt',
      'require_live_deposit_request_receipt_result',
      'require_live_customer_deposit_switches',
      'resolve_current_live_customer_deposit_boundary',
    ]) {
      expect(migrationSource).toMatch(
        new RegExp(
          `create function app\\.${helperName}\\([\\s\\S]+?security invoker[\\s\\S]+?set search_path = pg_catalog, app, pg_temp`,
          'u',
        ),
      );
    }
    expect(migrationSource).not.toContain('deferrable initially deferred');
  });

  it('freezes the application-facing return shapes and excludes capture internals', () => {
    for (const functionName of [
      'open_telegram_live_deposit_intent',
      'open_customer_web_deposit_intent',
    ] as const) {
      const source = functionSources.get(functionName)!;
      expect(source).toMatch(
        /returns table \(\s+deposit_intent_id uuid,\s+provider_code text,\s+receiver_account_holder_name text,\s+receiver_account_masked text,\s+receiver_customer_instruction text,\s+expected_amount_minor bigint,\s+currency_code text,\s+payment_deadline_at timestamptz,\s+deposit_status text,\s+(?:origin_inbound_event_already_consumed|request_key_already_used) boolean\s+\)/u,
      );
      expect(source).toMatch(/'intake_received'::text,\s+true;/u);
    }

    for (const functionName of [
      'capture_telegram_live_deposit_reference',
      'capture_customer_web_deposit_reference',
    ] as const) {
      const source = functionSources.get(functionName)!;
      expect(source).toMatch(
        /returns table \(\s+result_deposit_intent_id uuid,\s+submission_status text,\s+deposit_status text,\s+submitted_at timestamptz,\s+(?:origin_inbound_event_already_consumed|request_key_already_used) boolean\s+\)/u,
      );
      const returnDeclaration = source.slice(
        source.indexOf('returns table ('),
        source.indexOf('language plpgsql'),
      );
      expect(returnDeclaration).not.toMatch(/submission_id|job_id|evidence_id/iu);
    }

    for (const functionName of [
      'get_telegram_customer_deposit',
      'list_customer_web_deposits',
    ] as const) {
      expect(functionSources.get(functionName)).toMatch(
        /returns table \(\s+deposit_intent_id uuid,\s+expected_amount_minor bigint,\s+currency_code text,\s+deposit_status text,\s+created_at timestamptz,\s+updated_at timestamptz\s+\)/u,
      );
    }
  });

  it('replays payment instructions only while payable and requires exact v1 ciphertext frames', () => {
    for (const functionName of [
      'open_telegram_live_deposit_intent',
      'open_customer_web_deposit_intent',
    ] as const) {
      expect(functionSources.get(functionName)).toMatch(
        /and payment_provider\.code = 'cbe_birr'\s+and deposit_intent\.status = 'intake_received'\s+and deposit_intent\.payment_deadline_at > pg_catalog\.statement_timestamp\(\)\s+for update of deposit_intent;/u,
      );
    }

    for (const functionName of [
      'capture_telegram_live_deposit_reference',
      'capture_customer_web_deposit_reference',
    ] as const) {
      const source = functionSources.get(functionName)!;
      expect(source).toContain('p_reference_key_version is distinct from 1');
      expect(source).toContain(
        String.raw`!~ '^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{7,}$'`,
      );
      expect(source).not.toContain("'^v' || p_reference_key_version::text");
    }
  });

  it('keeps the source disabled and locks the exact three live switches before new writes', () => {
    expect(migrationSource).toContain(
      "values ('cbe_birr_authoritative_verification', 'disabled', '{}'::jsonb);",
    );
    const switchFunction = migrationSource.match(
      /create function app\.require_live_customer_deposit_switches\(\)[\s\S]+?\n\$\$;/u,
    )![0];
    for (const featureKey of [
      'payment_verification',
      'deposit_execution',
      'cbe_birr_authoritative_verification',
    ]) {
      expect(switchFunction).toContain(`'${featureKey}'`);
    }
    expect(switchFunction).toContain('order by feature_switch.feature_key');
    expect(switchFunction).toContain('for update;');
    expect(switchFunction).toContain('resolved_switch_count <> 3');
    expect(switchFunction).toContain('live_switch_count <> 3');

    for (const functionName of [
      'open_telegram_live_deposit_intent',
      'capture_telegram_live_deposit_reference',
      'open_customer_web_deposit_intent',
      'capture_customer_web_deposit_reference',
    ] as const) {
      const source = functionSources.get(functionName)!;
      expect(source).toContain('app.require_live_customer_deposit_switches()');
      expect(source.indexOf('into resolved_receipt')).toBeLessThan(
        source.indexOf('app.require_live_customer_deposit_switches()'),
      );
      expect(source).toContain('app.resolve_current_live_customer_deposit_boundary(');
    }

    expect(functionSources.get('get_telegram_customer_deposit')).not.toContain('feature_switches');
    expect(functionSources.get('list_customer_web_deposits')).not.toContain('feature_switches');
  });

  it('creates only a production authoritative verify job and moves both states atomically', () => {
    for (const functionName of [
      'capture_telegram_live_deposit_reference',
      'capture_customer_web_deposit_reference',
    ] as const) {
      const source = functionSources.get(functionName)!;
      const jobInsert = source.indexOf('insert into app.deposit_jobs');
      const submissionTransition = source.indexOf('update app.deposit_submissions');
      const intentTransition = source.indexOf('update app.deposit_intents');
      const receiptInsert = source.indexOf('deposit_request_receipts (', intentTransition);

      expect(jobInsert).toBeGreaterThan(0);
      expect(source).toContain("'verify_deposit'");
      expect(source).toContain("'cbe-birr-authoritative-verification:v1:'");
      expect(submissionTransition).toBeGreaterThan(jobInsert);
      expect(intentTransition).toBeGreaterThan(submissionTransition);
      expect(receiptInsert).toBeGreaterThan(intentTransition);
      expect(source).not.toContain('cbe_birr_shadow_verification_jobs');
      expect(source).not.toContain('enqueue_cbe_birr_shadow_verification');
    }
  });

  it('uses private append-only receipts with UUIDv4 web keys and no table grants or policies', () => {
    expect(migrationSource).toContain(
      "request_key::text ~\n      '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'",
    );
    expect(migrationSource).toContain(
      'alter table app.telegram_live_deposit_request_receipts\n  force row level security;',
    );
    expect(migrationSource).toContain(
      'alter table app.customer_web_deposit_request_receipts\n  force row level security;',
    );
    expect(migrationSource).not.toMatch(/create policy/iu);
    expect(migrationSource).not.toMatch(/grant (?:select|insert|update|delete|all).*on table/iu);
    expect(migrationSource.match(/and reference_key_version = 1/gu)).toHaveLength(2);
    expect(migrationSource).toContain(
      'create trigger inbound_event_consumptions_block_live_deposit_receipt',
    );
  });

  it('grants only the established channel groups and creates no role or runtime', () => {
    expect(migrationSource).toMatch(
      /grant execute on function[\s\S]+?app\.get_telegram_customer_deposit\(uuid, uuid\)\s+to fetanagent_player_actions;/u,
    );
    expect(migrationSource).toMatch(
      /grant execute on function[\s\S]+?app\.list_customer_web_deposits\(uuid, integer\)\s+to fetanagent_customer_web;/u,
    );
    expect(migrationSource).not.toMatch(/create role/iu);
    expect(migrationSource).not.toMatch(
      /grant execute[\s\S]+?to fetanagent_(?:api|worker|deposit_executor|verification_settlement)/u,
    );
  });
});
