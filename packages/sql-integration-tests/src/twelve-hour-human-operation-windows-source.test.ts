import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const migrationPath = fileURLToPath(
  new URL(
    '../../../supabase/migrations/20260916090000_twelve_hour_human_operation_windows.sql',
    import.meta.url,
  ),
);

let migrationSource = '';

beforeAll(async () => {
  migrationSource = await readFile(migrationPath, 'utf8');
});

describe('twelve-hour human-operation window migration source boundary', () => {
  it('installs only across the complete inert money boundary', () => {
    expect(migrationSource).toContain(
      'if app.current_private_trusted_telebirr_activation_epoch() is not null then',
    );
    expect(migrationSource).toContain("feature_switch.mode = 'disabled'");
    expect(migrationSource).toContain("feature_switch.mode in ('disabled', 'dry_run')");
    expect(migrationSource).toContain("execution_control.control_state <> 'disabled'");
    expect(migrationSource).toContain('and role.rolcanlogin');
    expect(migrationSource).not.toMatch(
      /(?:insert into|update|delete from)\s+app\.feature_switches/iu,
    );
    expect(migrationSource).not.toMatch(/\balter\s+role\b[\s\S]*?\blogin\b/iu);
  });

  it('extends only human-operated packages, assignments, and pilot checks to twelve hours', () => {
    for (const constraint of [
      'private_live_telebirr_device_pairing_window_check',
      'private_live_telebirr_device_pairing_claim_window_check',
      'agent_platform_companion_pairing_window_check',
      'agent_platform_companion_lookup_window_check',
      'agent_platform_companion_execution_control_shape',
      'bot_action_capabilities_expiry_after_creation',
      'bot_conversation_actions_expiry_after_creation',
    ]) {
      expect(migrationSource).toContain(`add constraint ${constraint} check (`);
    }
    expect(migrationSource).toContain("expires_at <= valid_from + interval '12 hours'");
    expect(migrationSource).toContain("expires_at <= issued_at + interval '12 hours'");
    expect(migrationSource).toContain("expires_at <= active_from + interval '12 hours'");
    expect(migrationSource).toContain(
      "'p_expires_at is distinct from p_active_from + interval ''12 hours'''",
    );
    expect(migrationSource).toContain("'now_at + interval ''12 hours'''");
    expect(migrationSource).toContain(
      "resolved_expiry := resolved_now + interval '11 hours 59 minutes 59 seconds';",
    );
    expect(migrationSource).toContain(
      "resolved_new_action_expires_at := clock_timestamp() + interval '11 hours 59 minutes 59 seconds';",
    );
  });

  it('keeps pairing one-use while retaining short operational request and lease boundaries', () => {
    expect(migrationSource).toContain(
      "pairing_request_expires_at <= pairing_request_issued_at + interval '12 hours'",
    );
    expect(migrationSource).toContain(
      "'p_request_expires_at > p_request_issued_at + interval ''12 hours'''",
    );
    expect(migrationSource).not.toMatch(/claim_expires_at[\s\S]{0,160}12 hours/iu);
    expect(migrationSource).not.toMatch(/leased_until[\s\S]{0,160}12 hours/iu);
    expect(migrationSource).not.toMatch(/automatic_freshness_seconds[\s\S]{0,160}12 hours/iu);
    expect(migrationSource).toContain('Pairing requests remain one-use and identity-bound');
    expect(migrationSource).toContain('claim and HTTP leases remain short');
    expect(migrationSource).toContain('one private conversation, one expected version');
  });

  it('preserves immutable legacy payment presentations while issuing new twelve-hour ones', () => {
    expect(migrationSource).toContain("created_at + interval '10 minutes'");
    expect(migrationSource).toContain("created_at + interval '12 hours'");
    expect(migrationSource).toContain(
      "'app.prepare_telegram_telebirr_destination(uuid,text,text)'",
    );
    expect(migrationSource).toContain("'v_now + interval ''12 hours'''");
  });

  it('rewrites only reviewed security-definer literals and preserves routine authority metadata', () => {
    expect(migrationSource).toContain('and routine.prosecdef;');
    expect(migrationSource).toContain('old_occurrences <> 1');
    expect(migrationSource).toContain('routine.proowner = original_owner');
    expect(migrationSource).toContain('routine.proacl is not distinct from original_acl');
    expect(migrationSource).toContain('routine.proconfig is not distinct from original_config');
    expect(migrationSource).toContain('routine.prosecdef = original_security_definer');
    expect(migrationSource).not.toMatch(/\bgrant\s+execute\b/iu);
  });

  it('does not activate authority, settlement, execution, credit, or money movement', () => {
    expect(migrationSource).not.toMatch(
      /(?:insert into|update)\s+app\.private_trusted_telebirr_activation_/iu,
    );
    expect(migrationSource).not.toMatch(
      /app\.(?:finalize_private_live_verified_deposit|enqueue_execution|fence_private_live_deposit_execution_final_action)\s*\(/iu,
    );
    expect(migrationSource).not.toMatch(/\b(?:settle|credit|transfer)\s*\(/iu);
  });
});
