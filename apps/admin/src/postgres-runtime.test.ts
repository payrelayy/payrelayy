import type { OwnerControlRuntimeConfig } from '@fetanagent/config/owner-control';
import { describe, expect, it } from 'vitest';

import {
  OWNER_CONTROL_PREFLIGHT_SQL,
  OwnerControlPostgresRuntimeUnavailableError,
  ownerControlPoolConfig,
} from './postgres-runtime.js';

const config = {
  enabled: true,
  stage: 'staging',
  projectReference: 'spzpiyxheappsfyswewl',
  connection: {
    database: 'postgres',
    host: 'db.spzpiyxheappsfyswewl.supabase.co',
    password: 'test-password',
    port: 5432,
    user: 'fetanagent_owner_control_runtime',
  },
  companionDevicePairing: { serverSignerKeyId: undefined, configured: false },
  devicePairing: { assignmentSignerKeyId: undefined, configured: false },
  publishableKey: 'sb_publishable_test_key_for_staging_only',
  receiverReferenceProtection: {
    encryptionSecret: 'c'.repeat(64),
    fingerprintSecret: 'd'.repeat(64),
    masterProfile: {
      encryptionMasterFingerprint: `sha256:${'1'.repeat(64)}`,
      fingerprintMasterFingerprint: `sha256:${'2'.repeat(64)}`,
      version: 2,
    },
  },
  supabaseUrl: 'https://spzpiyxheappsfyswewl.supabase.co',
  tlsMode: 'verify-full',
} satisfies Extract<OwnerControlRuntimeConfig, { readonly enabled: true }>;

describe('Owner-control bounded PostgreSQL pool', () => {
  it('enforces one connection, verify-full, and strict client/server timeouts', () => {
    expect(ownerControlPoolConfig(config)).toMatchObject({
      max: 1,
      min: 0,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
      query_timeout: 5_000,
      statement_timeout: 5_000,
      lock_timeout: 1_000,
      idle_in_transaction_session_timeout: 5_000,
      ssl: { rejectUnauthorized: true },
    });
  });

  it('fails closed if an unsafe cast removes the verify-full promise', () => {
    expect(() =>
      ownerControlPoolConfig({
        ...config,
        tlsMode: 'require',
      } as unknown as typeof config),
    ).toThrow(OwnerControlPostgresRuntimeUnavailableError);
  });

  it('allows exactly thirty-two reviewed Owner procedures including bounded pairing and lookup authorities', () => {
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.list_owner_player_registration_requests(uuid,integer)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.review_owner_player_registration_request(uuid,uuid,text,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.list_owner_player_registration_association_candidates(uuid,integer)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.associate_owner_validated_player_registration_request(uuid,uuid,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain('all_other_app_functions_denied');
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.list_owner_dry_run_deposit_intake(uuid,integer)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.record_owner_dry_run_fixture_assessment(uuid,uuid,text,text,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.review_owner_dry_run_fixture_assessment(uuid,uuid,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.list_owner_dry_run_fixture_assessments(uuid,integer)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.enqueue_cbe_birr_shadow_verification(uuid,uuid,uuid)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.list_owner_cbe_birr_shadow_verifications(uuid,integer)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.list_owner_player_deposit_eligibility(uuid,integer)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.decide_owner_player_deposit_eligibility(uuid,uuid,text,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.prepare_approved_private_live_telebirr_pilot(uuid,uuid,text[],timestamptz,timestamptz)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.get_current_private_live_deposit_pilot_status(uuid)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.issue_current_private_telebirr_device_pairing(uuid,uuid,text,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain('internal_telebirr_device_pairing_issue_denied');
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain('app.arm_private_live_deposit_pilot(uuid,uuid)');
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.stop_private_live_deposit_pilot(uuid,uuid,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.get_private_live_deposit_pilot_status(uuid,uuid)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain('app.list_owner_receiver_accounts(uuid)');
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.rotate_owner_receiver_account(uuid,uuid,text,text,text,text,text,smallint,smallint,smallint,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain('app.list_owner_kemerbet_agent_profiles(uuid)');
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.prepare_owner_kemerbet_agent_profile(uuid,uuid,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      "has_function_privilege(current_user, 'app.recover_owner_kemerbet_quarantined_agent_profile(uuid,uuid,uuid)', 'execute') as kemerbet_agent_profile_recover_allowed",
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      "'app.recover_owner_kemerbet_quarantined_agent_profile(uuid,uuid,uuid)'::regprocedure",
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.prepare_owner_kemerbet_readiness_cohort_claim(uuid,uuid)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.advance_owner_kemerbet_readiness_cohort_claim(uuid,uuid,uuid,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.record_owner_kemerbet_readiness_cohort_root_receipt(uuid,uuid,text,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.issue_agent_platform_companion_pairing(uuid,uuid,text,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain(
      'app.revoke_agent_platform_companion_device(uuid,uuid,uuid,text)',
    );
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain('select count(*) = 32');
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain('exact_app_execute_count');
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain('direct_table_access_denied');
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain('has_any_column_privilege');
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain('has_sequence_privilege');
  });
});
