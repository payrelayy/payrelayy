-- Allow a signed receiver-phone SMS to arrive within 60 minutes of the
-- customer's submission. Keep the independent one-hour payment-age limit,
-- exact-reference binding, amount policy, and immutable prior review holds.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '3s';
set local statement_timeout = '60s';

select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
  'fetanagent:routine-telebirr-processing', 20261004));

-- Retain the historical reason on existing rows; new timeouts say 60m.
alter table app.receiver_sms_settlement_holds
  drop constraint receiver_sms_settlement_holds_reason_code_check;
alter table app.receiver_sms_settlement_holds
  add constraint receiver_sms_settlement_holds_reason_code_check
  check (reason_code in (
    'settlement_preflight_failed',
    'no_receiver_sms_after_5m',
    'no_receiver_sms_after_60m'));

-- Replace only the exact receiver-SMS submission-window clauses. Other
-- five-minute intervals protect phone clock skew and are intentionally intact.
do $window$
declare
  v_target record;
  v_patch_index integer;
  v_definition text;
  v_old text;
  v_new text;
  v_hits integer;
begin
  for v_target in
    select * from (values
      (
        'app.match_receiver_sms_payment(text,text)',
        array[
          'v_event.occurred_at > v_candidate.submitted_at + interval ''5 minutes''',
          'v_now > v_candidate.submitted_at + interval ''5 minutes'''
        ],
        array[
          'v_event.occurred_at > v_candidate.submitted_at + interval ''60 minutes''',
          'v_now > v_candidate.submitted_at + interval ''60 minutes'''
        ]
      ),
      (
        'app.finalize_receiver_sms_match(uuid)',
        array[
          'v_event.occurred_at > v_candidate.submitted_at + interval ''5 minutes''',
          'v_now > v_candidate.submitted_at + interval ''5 minutes'''
        ],
        array[
          'v_event.occurred_at > v_candidate.submitted_at + interval ''60 minutes''',
          'v_now > v_candidate.submitted_at + interval ''60 minutes'''
        ]
      ),
      (
        'app.populate_receiver_sms_intent_snapshot()',
        array[
          'v_event.occurred_at > v_candidate.submitted_at + interval ''5 minutes'''
        ],
        array[
          'v_event.occurred_at > v_candidate.submitted_at + interval ''60 minutes'''
        ]
      ),
      (
        'app.assess_receiver_sms_execution_job(uuid)',
        array[
          'sms.occurred_at <= candidate.submitted_at + interval ''5 minutes'''
        ],
        array[
          'sms.occurred_at <= candidate.submitted_at + interval ''60 minutes'''
        ]
      ),
      (
        'app.settle_next_receiver_sms_match()',
        array[
          'candidate.submitted_at <= pg_catalog.clock_timestamp() - interval ''5 minutes''',
          'values (v_candidate_id, ''no_receiver_sms_after_5m'')'
        ],
        array[
          'candidate.submitted_at < pg_catalog.clock_timestamp() - interval ''60 minutes''',
          'values (v_candidate_id, ''no_receiver_sms_after_60m'')'
        ]
      )
    ) as targets(signature, old_clauses, new_clauses)
  loop
    v_definition := pg_catalog.pg_get_functiondef(
      v_target.signature::pg_catalog.regprocedure);
    if v_definition is null
      or pg_catalog.array_length(v_target.old_clauses, 1) is distinct from
        pg_catalog.array_length(v_target.new_clauses, 1) then
      raise exception 'Receiver SMS function % has changed.', v_target.signature;
    end if;
    for v_patch_index in 1..pg_catalog.array_length(v_target.old_clauses, 1) loop
      v_old := v_target.old_clauses[v_patch_index];
      v_new := v_target.new_clauses[v_patch_index];
      v_hits := (pg_catalog.length(v_definition) -
        pg_catalog.length(pg_catalog.replace(v_definition, v_old, '')))
        / pg_catalog.length(v_old);
      if v_hits <> 1 then
        raise exception 'Expected one window clause in %, found %: %',
          v_target.signature, v_hits, v_old;
      end if;
      v_definition := pg_catalog.replace(v_definition, v_old, v_new);
    end loop;
    execute v_definition;
  end loop;
end;
$window$;

comment on function app.settle_next_receiver_sms_match() is
  'Queue one safe receiver-SMS match, or hold an unmatched submission after 60 minutes; historical holds remain final.';
commit;
