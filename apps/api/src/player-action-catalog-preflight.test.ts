import { describe, expect, it } from 'vitest';

import {
  PLAYER_ACTION_ALL_CANDIDATES_CATALOG_PREFLIGHT_SQL,
  PLAYER_ACTION_CANDIDATE_CATALOG_PREFLIGHT_SQL,
  PLAYER_ACTION_CBE_BIRR_CATALOG_PREFLIGHT_SQL,
  PLAYER_ACTION_CATALOG_PREFLIGHT_SQL,
  playerActionCatalogPreflightPassed,
} from './player-action-catalog-preflight.js';

const passingRow = {
  runtime_login_identity_allowed: true,
  runtime_login_is_safe: true,
  only_expected_direct_membership: true,
  group_usage_allowed_set_denied: true,
  group_only_expected_members: true,
  app_schema_boundary_allowed: true,
  no_app_base_object_access: true,
  exact_function_surface_allowed: true,
  allowed_functions_hardened: true,
  allowed_functions_execution_private: true,
  nonce_table_forced_rls_no_policies: true,
  default_function_execution_private: true,
} as const;

describe('Player-ID action catalog preflight', () => {
  it('passes only one complete all-true catalog row', async () => {
    await expect(
      playerActionCatalogPreflightPassed({
        query: async () => ({ rows: [passingRow] }),
      }),
    ).resolves.toBe(true);
  });

  it.each(Object.keys(passingRow))('fails closed when %s is false', async (field) => {
    await expect(
      playerActionCatalogPreflightPassed({
        query: async () => ({ rows: [{ ...passingRow, [field]: false }] }),
      }),
    ).resolves.toBe(false);
  });

  it('fails malformed or multiple rows and contains no DML', async () => {
    await expect(
      playerActionCatalogPreflightPassed({ query: async () => ({ rows: [] }) }),
    ).resolves.toBe(false);
    await expect(
      playerActionCatalogPreflightPassed({
        query: async () => ({ rows: [passingRow, passingRow] }),
      }),
    ).resolves.toBe(false);
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL.trimStart()).toMatch(/^select\b/iu);
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).not.toMatch(
      /^\s*(?:insert|update|delete|truncate|alter|create|drop|grant|revoke)\b/imu,
    );
  });

  it('requires onboarding, proof, notification, and instruction functions in the exact 30-function surface', () => {
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.record_public_telegram_action_inbound_event(bigint,bigint,bigint,text,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).not.toContain(
      'app.record_admitted_telegram_private_inbound_event(bigint,bigint,bigint,text,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.open_telegram_dry_run_deposit_intent(uuid,text,bigint,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.capture_telegram_dry_run_deposit_reference(uuid,uuid,text,text,text,smallint,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.capture_telegram_dry_run_deposit_proof(uuid,text,text,text,text,text,smallint,smallint,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.capture_telegram_telebirr_shadow_proof(uuid,text,text,text,text,text,smallint,smallint,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.prepare_telegram_telebirr_destination(uuid,text,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.prepare_telegram_live_telebirr_destination(uuid,text,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.capture_telegram_live_telebirr_proof(uuid,text,text,text,text,text,smallint,smallint,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.get_telegram_customer_live_telebirr_proof(uuid,uuid)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toMatch(
      /when routine\.oid in \([\s\S]*?app\.prepare_telegram_live_telebirr_destination\(uuid,text,text\)[\s\S]*?then array\['search_path=pg_catalog'\]/u,
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      "then array['search_path=pg_catalog']::text[]",
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      "else array['search_path=pg_catalog, app, pg_temp']::text[]",
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).not.toContain(
      'app.open_telegram_live_deposit_intent(uuid,text,bigint,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).not.toContain(
      'app.capture_telegram_live_deposit_reference(uuid,uuid,text,text,text,smallint,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.get_telegram_customer_deposit(uuid,uuid)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.get_telegram_customer_deposit_proof(uuid,uuid)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain('select count(*) = 30');
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.get_telegram_saved_player_selection(uuid)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.save_telegram_player_selection(uuid,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.request_telegram_player_validation(uuid,text)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.claim_telegram_deposit_outcome_notification()',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.complete_telegram_deposit_outcome_notification(uuid,uuid,text,bigint)',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.claim_telegram_player_validation_notification()',
    );
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(
      'app.complete_telegram_player_validation_notification(uuid,uuid,text,bigint)',
    );
    for (const signature of [
      'app.record_telegram_deposit_temporary_message(bigint,bigint,bigint)',
      'app.cancel_telegram_deposit_temporary_message(bigint,bigint,bigint)',
      'app.claim_telegram_deposit_temporary_deletion()',
      'app.complete_telegram_deposit_temporary_deletion(bigint,uuid,text)',
      'app.record_telegram_payment_instruction_message(bigint,bigint,bigint)',
      'app.claim_telegram_payment_instruction_expiry()',
      'app.complete_telegram_payment_instruction_expiry(uuid,uuid,text)',
    ]) {
      expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).toContain(signature);
    }
    expect(PLAYER_ACTION_CATALOG_PREFLIGHT_SQL).not.toContain(
      'app.capture_telegram_routine_telebirr_untrusted_proof',
    );
  });

  it('requires the exact private candidate RPC only when the staging route is selected', async () => {
    const queries: string[] = [];
    await expect(
      playerActionCatalogPreflightPassed(
        {
          async query(query) {
            queries.push(query);
            return { rows: [passingRow] };
          },
        },
        true,
      ),
    ).resolves.toBe(true);
    expect(queries).toEqual([PLAYER_ACTION_CANDIDATE_CATALOG_PREFLIGHT_SQL]);
    expect(PLAYER_ACTION_CANDIDATE_CATALOG_PREFLIGHT_SQL).toContain(
      'app.capture_telegram_routine_telebirr_untrusted_proof(uuid,text,text,text,text,text,smallint,smallint,text)',
    );
    expect(PLAYER_ACTION_CANDIDATE_CATALOG_PREFLIGHT_SQL).toContain('select count(*) = 31');
    expect(PLAYER_ACTION_CANDIDATE_CATALOG_PREFLIGHT_SQL).toContain(
      "then array['search_path=pg_catalog']::text[]",
    );
  });

  it('accepts only the exact optional candidate grant while the route remains off', async () => {
    const queries: string[] = [];
    const database = {
      async query(query: string) {
        queries.push(query);
        return {
          rows: [
            query === PLAYER_ACTION_CATALOG_PREFLIGHT_SQL
              ? { ...passingRow, exact_function_surface_allowed: false }
              : passingRow,
          ],
        };
      },
    };
    await expect(playerActionCatalogPreflightPassed(database, false, true)).resolves.toBe(true);
    expect(queries).toEqual([
      PLAYER_ACTION_CATALOG_PREFLIGHT_SQL,
      PLAYER_ACTION_CANDIDATE_CATALOG_PREFLIGHT_SQL,
    ]);
    queries.length = 0;
    await expect(playerActionCatalogPreflightPassed(database)).resolves.toBe(false);
    expect(queries).toEqual([PLAYER_ACTION_CATALOG_PREFLIGHT_SQL]);
  });

  it('requires an active candidate and checks only exact optional grant shapes', async () => {
    const queries: string[] = [];
    const database = {
      async query(query: string) {
        queries.push(query);
        return { rows: [{ ...passingRow, exact_function_surface_allowed: false }] };
      },
    };
    await expect(playerActionCatalogPreflightPassed(database, true, true)).resolves.toBe(false);
    expect(queries).toEqual([
      PLAYER_ACTION_CANDIDATE_CATALOG_PREFLIGHT_SQL,
      PLAYER_ACTION_ALL_CANDIDATES_CATALOG_PREFLIGHT_SQL,
    ]);
    queries.length = 0;
    await expect(playerActionCatalogPreflightPassed(database, false, true)).resolves.toBe(false);
    expect(queries).toEqual([
      PLAYER_ACTION_CATALOG_PREFLIGHT_SQL,
      PLAYER_ACTION_CANDIDATE_CATALOG_PREFLIGHT_SQL,
      PLAYER_ACTION_CBE_BIRR_CATALOG_PREFLIGHT_SQL,
      PLAYER_ACTION_ALL_CANDIDATES_CATALOG_PREFLIGHT_SQL,
    ]);
  });

  it('requires both CBE Birr RPC grants only when the staging gate is on', async () => {
    const queries: string[] = [];
    await expect(
      playerActionCatalogPreflightPassed(
        {
          async query(query) {
            queries.push(query);
            return { rows: [passingRow] };
          },
        },
        false,
        true,
        true,
      ),
    ).resolves.toBe(true);
    expect(queries).toEqual([PLAYER_ACTION_CBE_BIRR_CATALOG_PREFLIGHT_SQL]);
    expect(PLAYER_ACTION_CBE_BIRR_CATALOG_PREFLIGHT_SQL).toContain('select count(*) = 32');
    expect(PLAYER_ACTION_CBE_BIRR_CATALOG_PREFLIGHT_SQL).toContain(
      'app.issue_telegram_cbe_birr_dry_run_instruction(uuid,text,text)',
    );
    expect(PLAYER_ACTION_CBE_BIRR_CATALOG_PREFLIGHT_SQL).toContain(
      'app.capture_telegram_cbe_birr_bound_dry_run_proof(uuid,uuid,text,text,text,text,smallint,smallint,text)',
    );
    expect(PLAYER_ACTION_CBE_BIRR_CATALOG_PREFLIGHT_SQL).toContain(
      "then array['search_path=pg_catalog, pg_temp']::text[]",
    );
  });
});
