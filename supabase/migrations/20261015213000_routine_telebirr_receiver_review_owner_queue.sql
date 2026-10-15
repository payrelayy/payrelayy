-- Read-only Owner visibility for TeleBirr submissions fenced when the
-- receiving wallet changes during a displayed one-hour instruction.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '20s';

create index routine_rotated_instruction_review_queue_idx
  on app.routine_telebirr_rotated_instruction_reviews
    (recorded_at desc, candidate_id desc);

create function app.list_owner_routine_telebirr_receiver_change_reviews(
  p_actor_auth_user_id uuid,
  p_limit integer default 25,
  p_before_case_id uuid default null
)
returns table (
  case_id uuid,
  player_id text,
  reference_masked text,
  instructed_receiver_masked text,
  candidate_receiver_masked text,
  submitted_at timestamptz,
  recorded_at timestamptz,
  reason_code text
)
language plpgsql security definer set search_path = pg_catalog, app, pg_temp
as $$
declare
  v_before_recorded_at timestamptz;
begin
  if p_actor_auth_user_id is null or p_limit is null
    or p_limit not between 1 and 50 then
    raise exception 'The Owner TeleBirr receiver-review list request is invalid.';
  end if;

  perform 1 from app.admin_users admin_user
   where admin_user.auth_user_id = p_actor_auth_user_id
     and admin_user.role = 'owner'
     and admin_user.status = 'active'
   for share;
  if not found then raise exception 'An active Owner is required.'; end if;

  if p_before_case_id is not null then
    select review.recorded_at into v_before_recorded_at
      from app.routine_telebirr_rotated_instruction_reviews review
     where review.candidate_id = p_before_case_id;
    if v_before_recorded_at is null then
      raise exception 'The Owner TeleBirr review cursor is invalid.';
    end if;
  end if;

  return query
  select review.candidate_id, player.player_id,
         review.candidate_reference_masked,
         instructed.account_reference_masked,
         candidate_receiver.account_reference_masked,
         review.submitted_at, review.recorded_at, review.reason_code
    from app.routine_telebirr_rotated_instruction_reviews review
    join app.customer_platform_players player
      on player.id = review.player_account_id
    join app.receiver_accounts instructed
      on instructed.id = review.instructed_receiver_account_id
    join app.receiver_accounts candidate_receiver
      on candidate_receiver.id = review.candidate_receiver_account_id
   where p_before_case_id is null
      or (review.recorded_at, review.candidate_id)
           < (v_before_recorded_at, p_before_case_id)
   order by review.recorded_at desc, review.candidate_id desc
   limit p_limit;
end;
$$;

alter function app.list_owner_routine_telebirr_receiver_change_reviews(uuid, integer, uuid)
  owner to postgres;
revoke all on function
  app.list_owner_routine_telebirr_receiver_change_reviews(uuid, integer, uuid)
  from public, anon, authenticated, service_role,
    fetanagent_owner_control_runtime,
    fetanagent_player_actions, fetanagent_player_actions_runtime,
    fetanagent_routine_telebirr_paid_settlement,
    fetanagent_routine_telebirr_paid_settlement_runtime;
grant execute on function
  app.list_owner_routine_telebirr_receiver_change_reviews(uuid, integer, uuid)
  to fetanagent_owner_control;

comment on function
  app.list_owner_routine_telebirr_receiver_change_reviews(uuid, integer, uuid) is
  'Owner-only bounded read of masked receiver-change cases. No provider verification, credit, refund, or case resolution is authorized.';
commit;
