-- Run only after the invite-free bot and Owner release is deployed and its
-- financial stop is verified. This script is intentionally not a migration.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $gate$
declare
  switch_count integer;
  disabled_count integer;
begin
  -- Never erase the only redeemed invite while a financial or status path
  -- could still depend on that row.
  if (select count(*) = 13
             and bool_and(pg_catalog.strpos(p.prosrc, 'telegram_beta_invites') = 0)
        from pg_catalog.pg_proc p
       where p.oid in (
         'app.capture_telegram_dry_run_deposit_proof(uuid,text,text,text,text,text,smallint,smallint,text)'::regprocedure,
         'app.capture_telegram_live_deposit_reference(uuid,uuid,text,text,text,smallint,text)'::regprocedure,
         'app.capture_telegram_live_telebirr_proof(uuid,text,text,text,text,text,smallint,smallint,text)'::regprocedure,
         'app.capture_telegram_routine_telebirr_no_money_core(uuid,text,text,text,text,text,smallint,smallint,text)'::regprocedure,
         'app.capture_telegram_telebirr_shadow_proof(uuid,text,text,text,text,text,smallint,smallint,text)'::regprocedure,
         'app.enforce_telegram_dry_run_proof_receipt_binding()'::regprocedure,
         'app.enforce_telegram_live_deposit_receipt_binding()'::regprocedure,
         'app.enforce_telegram_live_telebirr_proof_receipt_insert()'::regprocedure,
         'app.get_telegram_customer_deposit(uuid,uuid)'::regprocedure,
         'app.get_telegram_customer_live_telebirr_proof(uuid,uuid)'::regprocedure,
         'app.issue_telegram_cbe_birr_dry_run_instruction(uuid,text,text)'::regprocedure,
         'app.open_telegram_live_deposit_intent(uuid,text,bigint,text)'::regprocedure,
         'app.prepare_telegram_telebirr_destination(uuid,text,text)'::regprocedure
       )) is distinct from true then
    raise exception 'The Telegram invite gate migration is not complete.';
  end if;

  select count(*)::integer,
         count(*) filter (where mode = 'disabled' and settings = '{}'::jsonb)::integer
    into switch_count, disabled_count
    from app.feature_switches
   where feature_key in (
     'cbe_birr_authoritative_verification', 'deposit_execution',
     'payment_verification', 'private_live_deposit_pilot',
     'telebirr_authoritative_verification', 'withdrawal_collection',
     'withdrawal_validation'
   );
  if switch_count <> 7 or disabled_count <> 7
    or exists (select 1 from app.deposit_jobs
                where status in ('queued', 'leased', 'retry_wait'))
    or exists (select 1 from app.deposit_execution_attempts
                where status in ('prepared', 'final_action_fenced',
                                 'reconciliation_required', 'review_required'))
    or (select pg_get_triggerdef(t.oid) from pg_trigger t
          where t.tgrelid = 'app.telegram_beta_invites'::regclass
            and t.tgname = 'telegram_beta_invites_no_delete')
         is distinct from 'CREATE TRIGGER telegram_beta_invites_no_delete BEFORE DELETE ON app.telegram_beta_invites FOR EACH ROW EXECUTE FUNCTION app.reject_telegram_beta_invite_delete()'
    or (select pg_get_triggerdef(t.oid) from pg_trigger t
          where t.tgrelid = 'app.audit_events'::regclass
            and t.tgname = 'audit_events_immutable')
         is distinct from 'CREATE TRIGGER audit_events_immutable BEFORE DELETE OR UPDATE ON app.audit_events FOR EACH ROW EXECUTE FUNCTION app.reject_audit_event_mutation()' then
    raise exception 'The invite retirement preflight is not satisfied.';
  end if;
end;
$gate$;

revoke execute on function app.issue_telegram_beta_invite(uuid,text,timestamptz)
  from fetanagent_owner_control;
revoke execute on function app.revoke_telegram_beta_invite(uuid,uuid,text)
  from fetanagent_owner_control;
revoke execute on function app.redeem_telegram_beta_invite(bigint,bigint,bigint,text,text,text)
  from fetanagent_beta_admission;
revoke execute on function app.record_admitted_telegram_private_inbound_event(bigint,bigint,bigint,text,text)
  from fetanagent_player_actions;
revoke execute on function app.reserve_telegram_beta_invite_admission_nonce(text,timestamptz)
  from fetanagent_beta_admission;
revoke usage on schema app from fetanagent_beta_admission;

-- The trigger removal and exact-action deletions are contained in this one
-- transaction. Generic inbound, customer, Player, and financial rows remain.
drop trigger telegram_beta_invites_no_delete on app.telegram_beta_invites;
delete from app.telegram_beta_invites;
create trigger telegram_beta_invites_no_delete
  before delete on app.telegram_beta_invites for each row
  execute function app.reject_telegram_beta_invite_delete();

drop trigger audit_events_immutable on app.audit_events;
delete from app.audit_events
 where action in (
   'telegram.beta_invite_issued',
   'telegram.beta_invite_revoked',
   'customer.telegram_beta_invite_redeemed'
 );
create trigger audit_events_immutable
  before delete or update on app.audit_events for each row
  execute function app.reject_audit_event_mutation();

truncate app.telegram_beta_invite_admission_nonce_reservations;

do $verify$
begin
  if exists (select 1 from app.telegram_beta_invites)
    or exists (select 1 from app.telegram_beta_invite_admission_nonce_reservations)
    or exists (select 1 from app.audit_events
                where action in ('telegram.beta_invite_issued',
                                 'telegram.beta_invite_revoked',
                                 'customer.telegram_beta_invite_redeemed'))
    or has_function_privilege('fetanagent_owner_control',
         'app.issue_telegram_beta_invite(uuid,text,timestamptz)', 'EXECUTE')
    or has_function_privilege('fetanagent_beta_admission',
         'app.redeem_telegram_beta_invite(bigint,bigint,bigint,text,text,text)', 'EXECUTE')
    or has_schema_privilege('fetanagent_beta_admission', 'app', 'USAGE') then
    raise exception 'Telegram beta invite retirement was incomplete.';
  end if;
end;
$verify$;

commit;
