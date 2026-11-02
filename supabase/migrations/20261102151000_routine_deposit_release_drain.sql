-- A release must stop new credit leases before checking that active transfers
-- have drained. The shared row lock is held for the complete broker lease
-- transaction, so arming the gate cannot race a just-issued lease.
begin;
set local search_path = pg_catalog;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table app.routine_deposit_release_drain (
  singleton boolean primary key default true check (singleton),
  release_sha text not null default '',
  expires_at timestamptz not null default '-infinity'::timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table app.routine_deposit_release_drain enable row level security;
revoke all on table app.routine_deposit_release_drain
  from public, anon, authenticated, service_role;
insert into app.routine_deposit_release_drain (singleton) values (true);

do $patch$
declare
  target pg_catalog.regprocedure :=
    'app.execute_agent_platform_routine_deposit_command(text,text,text,text,text,text,timestamptz,timestamptz,timestamptz,text,text,text,jsonb)'::pg_catalog.regprocedure;
  previous_definition text := pg_catalog.pg_get_functiondef(target);
  previous_acl pg_catalog.aclitem[];
  previous_owner oid;
  old_head text := $old$
      else
        select job.id into candidate_job_id
        from app.deposit_jobs job$old$;
  new_head text := $new$
      else
        perform drain.singleton from app.routine_deposit_release_drain drain
          where drain.singleton for share;
        if exists (
          select 1 from app.routine_deposit_release_drain drain
          where drain.singleton and drain.expires_at > pg_catalog.clock_timestamp()
        ) then
          result := 'null'::jsonb;
        else
        select job.id into candidate_job_id
        from app.deposit_jobs job$new$;
  old_tail text := $old$
            'attemptNumber', 1, 'finalActionFenced', false
          );
        end if;
      end if;
    end if;
  elsif operation <> 'lease' then$old$;
  new_tail text := $new$
            'attemptNumber', 1, 'finalActionFenced', false
          );
        end if;
        end if;
      end if;
    end if;
  elsif operation <> 'lease' then$new$;
  updated_definition text;
begin
  select routine.proacl, routine.proowner into previous_acl, previous_owner
    from pg_catalog.pg_proc routine where routine.oid = target;
  if (select pg_catalog.md5(routine.prosrc) = '9ab9bd89269bc6a58cbdd3fee720849e'
      and routine.prosecdef and routine.proconfig = array['search_path=pg_catalog']::text[]
      and routine.proowner = 'postgres'::pg_catalog.regrole
      from pg_catalog.pg_proc routine where routine.oid = target) is not true
    or pg_catalog.length(previous_definition) -
      pg_catalog.length(pg_catalog.replace(previous_definition, old_head, ''))
      <> pg_catalog.length(old_head)
    or pg_catalog.length(previous_definition) -
      pg_catalog.length(pg_catalog.replace(previous_definition, old_tail, ''))
      <> pg_catalog.length(old_tail) then
    raise exception 'The routine broker changed before release-drain installation.';
  end if;
  updated_definition := pg_catalog.replace(previous_definition, old_head, new_head);
  updated_definition := pg_catalog.replace(updated_definition, old_tail, new_tail);
  execute updated_definition;
  if (select routine.proowner = previous_owner
      and routine.proacl is not distinct from previous_acl
      and routine.prosecdef and routine.proconfig = array['search_path=pg_catalog']::text[]
      and pg_catalog.strpos(routine.prosrc, new_head) > 0
      and pg_catalog.strpos(routine.prosrc, new_tail) > 0
      from pg_catalog.pg_proc routine where routine.oid = target) is not true then
    raise exception 'The routine release-drain postcondition failed.';
  end if;
end;
$patch$;
commit;
