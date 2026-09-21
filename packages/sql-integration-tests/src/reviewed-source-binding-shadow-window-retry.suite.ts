import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';

export function registerReviewedSourceBindingShadowWindowRetrySqlTests(
  getClient: () => Client,
): void {
  describe('reviewed source-binding shadow-window retry catalog', () => {
    it('binds a signed layout witness across the same proof reference identity', async () => {
      const client = getClient();
      const result = await client.query<{
        readonly has_history_attempt_join: boolean;
        readonly has_layout_outcome_guard: boolean;
        readonly has_layout_proof_reference_guard: boolean;
        readonly has_layout_reference_binding_guard: boolean;
        readonly has_retrieval_guard: boolean;
        readonly has_terminal_body_guard: boolean;
        readonly has_terminal_reference_binding_guard: boolean;
        readonly has_terminal_source_document_guard: boolean;
        readonly owner_name: string;
        readonly safe_search_path: boolean;
        readonly service_role_execute: boolean;
      }>(`
        select validator.prosrc like
                 '%join app.private_telebirr_shadow_verification_attempts layout_attempt%'
                 and validator.prosrc like
                   '%layout_attempt.shadow_proof_request_id = proof.id%'
                 as has_history_attempt_join,
               validator.prosrc like
                 '%layout_staged.signed_observation%referenceFingerprint%hmac-sha256:%proof.candidate_reference_fingerprint%'
                 as has_layout_proof_reference_guard,
               validator.prosrc like
                 '%layout_staged.signed_observation%referenceBindingDigest%layout_transcript.reference_binding_digest%'
                 as has_layout_reference_binding_guard,
               validator.prosrc like
                 '%terminal_staged.verification_attempt_id = outcome.verification_attempt_id%'
                 and validator.prosrc like
                   '%terminal_staged.observation_body_digest = outcome.observation_body_digest%'
                 as has_terminal_body_guard,
               validator.prosrc like
                 '%terminal_staged.signed_observation%sourceDocumentDigest%outcome.source_document_digest%'
                 as has_terminal_source_document_guard,
               validator.prosrc like
                 '%terminal_staged.signed_observation%referenceBindingDigest%terminal_transcript.reference_binding_digest%'
                 as has_terminal_reference_binding_guard,
               validator.prosrc like
                 '%lookupOutcome%review_required%'
                 as has_layout_outcome_guard,
               validator.prosrc like '%retrievedAt%is not null%'
                 as has_retrieval_guard,
               validator.proconfig = array['search_path=pg_catalog']::text[]
                 as safe_search_path,
               pg_catalog.pg_get_userbyid(validator.proowner) as owner_name,
               pg_catalog.has_function_privilege(
                 'service_role', validator.oid, 'EXECUTE'
               ) as service_role_execute
          from pg_catalog.pg_proc validator
         where validator.oid =
               'app.private_telebirr_shadow_layout_source_is_valid(uuid,uuid)'::regprocedure
      `);

      expect(result.rows).toEqual([
        {
          has_history_attempt_join: true,
          has_layout_outcome_guard: true,
          has_layout_proof_reference_guard: true,
          has_layout_reference_binding_guard: true,
          has_retrieval_guard: true,
          has_terminal_body_guard: true,
          has_terminal_reference_binding_guard: true,
          has_terminal_source_document_guard: true,
          owner_name: 'postgres',
          safe_search_path: true,
          service_role_execute: false,
        },
      ]);
    });

    it('installs one forced-RLS immutable ledger with an exact twelve-hour window', async () => {
      const client = getClient();
      const result = await client.query<{
        readonly delete_triggers: number;
        readonly force_row_security: boolean;
        readonly owner_name: string;
        readonly policies: number;
        readonly row_security: boolean;
        readonly truncate_triggers: number;
        readonly window_constraint: string;
      }>(`
        select relation.relrowsecurity as row_security,
               relation.relforcerowsecurity as force_row_security,
               pg_catalog.pg_get_userbyid(relation.relowner) as owner_name,
               (
                 select pg_catalog.count(*)::integer
                   from pg_catalog.pg_policy policy
                  where policy.polrelid = relation.oid
               ) as policies,
               (
                 select pg_catalog.count(*)::integer
                   from pg_catalog.pg_trigger trigger_row
                  where trigger_row.tgrelid = relation.oid
                    and not trigger_row.tgisinternal
                    and (trigger_row.tgtype & 8) = 8
               ) as delete_triggers,
               (
                 select pg_catalog.count(*)::integer
                   from pg_catalog.pg_trigger trigger_row
                  where trigger_row.tgrelid = relation.oid
                    and not trigger_row.tgisinternal
                    and (trigger_row.tgtype & 32) = 32
               ) as truncate_triggers,
               (
                 select pg_catalog.pg_get_constraintdef(constraint_row.oid)
                   from pg_catalog.pg_constraint constraint_row
                  where constraint_row.conrelid = relation.oid
                    and constraint_row.conname =
                        'private_tbirr_shadow_binding_window_retry_window_check'
               ) as window_constraint
          from pg_catalog.pg_class relation
          join pg_catalog.pg_namespace namespace
            on namespace.oid = relation.relnamespace
         where namespace.nspname = 'app'
           and relation.relname =
               'private_telebirr_shadow_source_binding_window_retries'
           and relation.relkind = 'r'
      `);

      expect(result.rows).toEqual([
        {
          delete_triggers: 1,
          force_row_security: true,
          owner_name: 'postgres',
          policies: 0,
          row_security: true,
          truncate_triggers: 1,
          window_constraint: expect.stringContaining('12:00:00'),
        },
      ]);
    });

    it('keeps the creator postgres-only and preserves the historical validator boundary', async () => {
      const client = getClient();
      const result = await client.query<{
        readonly api_execute: boolean;
        readonly historical_has_current_mode: boolean;
        readonly historical_has_nonexpiring_lineage_check: boolean;
        readonly is_security_definer: boolean;
        readonly owner_control_execute: boolean;
        readonly owner_name: string;
        readonly safe_search_path: boolean;
        readonly service_role_execute: boolean;
        readonly volatility: string;
      }>(`
        select creator.prosecdef as is_security_definer,
               creator.provolatile::text as volatility,
               creator.proconfig = array['search_path=pg_catalog']::text[]
                 as safe_search_path,
               pg_catalog.pg_get_userbyid(creator.proowner) as owner_name,
               pg_catalog.has_function_privilege(
                 'service_role', creator.oid, 'EXECUTE'
               ) as service_role_execute,
               pg_catalog.has_function_privilege(
                 'fetanagent_api', creator.oid, 'EXECUTE'
               ) as api_execute,
               pg_catalog.has_function_privilege(
                 'fetanagent_owner_control', creator.oid, 'EXECUTE'
               ) as owner_control_execute,
               history.prosrc like '%private_telebirr_shadow_mode_is_ready%'
                 as historical_has_current_mode,
               history.prosrc like
                 '%recovery.recovery_expires_at > recovery.authorized_at%'
                 as historical_has_nonexpiring_lineage_check
          from pg_catalog.pg_proc creator
          join pg_catalog.pg_proc history
            on history.oid =
               'app.private_live_telebirr_source_binding_shadow_recovery_history_is_valid(uuid,uuid)'::regprocedure
         where creator.oid =
               'app.retry_reviewed_private_telebirr_source_binding_shadow_window(text,text)'::regprocedure
      `);

      expect(result.rows).toEqual([
        {
          api_execute: false,
          historical_has_current_mode: false,
          historical_has_nonexpiring_lineage_check: true,
          is_security_definer: true,
          owner_control_execute: false,
          owner_name: 'postgres',
          safe_search_path: true,
          service_role_execute: false,
          volatility: 'v',
        },
      ]);
    });

    it('loads the append-only child against its reviewed retry deadline', async () => {
      const client = getClient();
      const result = await client.query<{
        readonly is_security_definer: boolean;
        readonly owner_name: string;
        readonly preserves_newest_attempt_rule: boolean;
        readonly preserves_ordinary_deadline: boolean;
        readonly safe_search_path: boolean;
        readonly uses_retry_deadline: boolean;
      }>(`
        select loader.prosecdef as is_security_definer,
               loader.proconfig = array['search_path=pg_catalog']::text[]
                 as safe_search_path,
               pg_catalog.pg_get_userbyid(loader.proowner) as owner_name,
               loader.prosrc like
                 '%when proof.source_binding_window_retry_source_id is not null%'
                 and loader.prosrc like
                   '%then app.private_telebirr_shadow_source_binding_window_review_deadline(%'
                 as uses_retry_deadline,
               loader.prosrc like
                 '%else proof.submitted_at + interval ''12 hours''%'
                 as preserves_ordinary_deadline,
               loader.prosrc like
                 '%proof.source_binding_window_retry_source_id is null%'
                 as preserves_newest_attempt_rule
          from pg_catalog.pg_proc loader
         where loader.oid =
               'app.load_next_private_telebirr_shadow_staged_evidence()'::regprocedure
      `);

      expect(result.rows).toEqual([
        {
          is_security_definer: true,
          owner_name: 'postgres',
          preserves_newest_attempt_rule: true,
          preserves_ordinary_deadline: true,
          safe_search_path: true,
          uses_retry_deadline: true,
        },
      ]);
    });

    it('completes the append-only child against its reviewed retry deadline', async () => {
      const client = getClient();
      const result = await client.query<{
        readonly guards_both_terminal_checks: boolean;
        readonly is_security_definer: boolean;
        readonly owner_name: string;
        readonly preserves_ordinary_deadline: boolean;
        readonly preserves_source_recovery_deadline: boolean;
        readonly safe_search_path: boolean;
        readonly uses_fail_closed_retry_deadline: boolean;
      }>(`
        select completion.prosecdef as is_security_definer,
               completion.proconfig = array['search_path=pg_catalog']::text[]
                 as safe_search_path,
               pg_catalog.pg_get_userbyid(completion.proowner) as owner_name,
               (
                 pg_catalog.length(completion.prosrc)
                 - pg_catalog.length(pg_catalog.replace(
                     completion.prosrc,
                     'when proof.source_binding_window_retry_source_id is not null',
                     ''
                   ))
               ) / pg_catalog.length(
                 'when proof.source_binding_window_retry_source_id is not null'
               ) = 2 as guards_both_terminal_checks,
               completion.prosrc like
                 '%then coalesce(%private_telebirr_shadow_source_binding_window_review_deadline(%'
                 as uses_fail_closed_retry_deadline,
               completion.prosrc like
                 '%and app.private_live_telebirr_source_recovery_is_valid(%'
                 as preserves_source_recovery_deadline,
               completion.prosrc like
                 '%else proof.submitted_at + interval ''12 hours''%'
                 as preserves_ordinary_deadline
          from pg_catalog.pg_proc completion
         where completion.oid =
               'app.complete_private_telebirr_shadow_verification(uuid,uuid,uuid,text,text,text,text,text,timestamptz,text,text,text,timestamptz,text,text,text,timestamptz,bigint,timestamptz,text)'::regprocedure
      `);

      expect(result.rows).toEqual([
        {
          guards_both_terminal_checks: true,
          is_security_definer: true,
          owner_name: 'postgres',
          preserves_ordinary_deadline: true,
          preserves_source_recovery_deadline: true,
          safe_search_path: true,
          uses_fail_closed_retry_deadline: true,
        },
      ]);
    });

    it('fails safely and without writes when the unique reviewed source is absent', async () => {
      const client = getClient();
      await client.query('begin');
      try {
        const before = await client.query<{
          readonly child_proofs: number;
          readonly retries: number;
        }>(`
          select
            (
              select pg_catalog.count(*)::integer
                from app.private_telebirr_shadow_source_binding_window_retries
            ) as retries,
            (
              select pg_catalog.count(*)::integer
                from app.private_telebirr_shadow_proof_requests proof
               where proof.source_binding_window_retry_source_id is not null
            ) as child_proofs
        `);

        let failure: unknown;
        await client.query('savepoint expected_missing_source_failure');
        try {
          await client.query(
            `select *
               from app.retry_reviewed_private_telebirr_source_binding_shadow_window(
                 $1::text,
                 'reviewed_source_binding_shadow_window_retry_no_credit'
               )`,
            ['a'.repeat(40)],
          );
        } catch (error) {
          failure = error;
        } finally {
          await client.query('rollback to savepoint expected_missing_source_failure');
          await client.query('release savepoint expected_missing_source_failure');
        }

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain(
          'Exactly one expired untouched reviewed source-binding shadow request is required.',
        );
        expect((failure as Error).message).not.toContain('ambiguous');

        const after = await client.query<{
          readonly child_proofs: number;
          readonly retries: number;
        }>(`
          select
            (
              select pg_catalog.count(*)::integer
                from app.private_telebirr_shadow_source_binding_window_retries
            ) as retries,
            (
              select pg_catalog.count(*)::integer
                from app.private_telebirr_shadow_proof_requests proof
               where proof.source_binding_window_retry_source_id is not null
            ) as child_proofs
        `);
        expect(after.rows).toEqual(before.rows);
      } finally {
        await client.query('rollback');
      }
    });
  });
}
