import type { OwnerControlRuntimeConfig } from '@payreplayy/config/owner-control';
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
    user: 'payreplayy_owner_control_runtime',
  },
  publishableKey: 'sb_publishable_test_key_for_staging_only',
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

  it('allows only invite, Player-ID review, deposit projection, and advisory fixture procedures', () => {
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
    expect(OWNER_CONTROL_PREFLIGHT_SQL).toContain('direct_table_access_denied');
  });
});
