begin;

-- Rename the existing roles instead of recreating them. PostgreSQL role ACLs,
-- RLS policy bindings, ownership, and memberships are stored by role OID, so
-- the reviewed privilege boundary remains unchanged while the active identity
-- becomes FetanAgent.
do $fetanagent$
declare
  role_mapping record;
begin
  for role_mapping in
    select *
    from (values
      ('payreplayy_api', 'fetanagent_api'),
      ('payreplayy_api_runtime', 'fetanagent_api_runtime'),
      ('payreplayy_worker', 'fetanagent_worker'),
      ('payreplayy_beta_admission', 'fetanagent_beta_admission'),
      ('payreplayy_beta_admission_runtime', 'fetanagent_beta_admission_runtime'),
      ('payreplayy_nonce_retention', 'fetanagent_nonce_retention'),
      ('payreplayy_nonce_retention_runtime', 'fetanagent_nonce_retention_runtime'),
      ('payreplayy_owner_control', 'fetanagent_owner_control'),
      ('payreplayy_owner_control_runtime', 'fetanagent_owner_control_runtime'),
      ('payreplayy_player_actions', 'fetanagent_player_actions'),
      ('payreplayy_player_actions_runtime', 'fetanagent_player_actions_runtime')
    ) as roles(old_name, new_name)
  loop
    if pg_catalog.to_regrole(role_mapping.old_name) is null then
      raise exception 'required legacy role % does not exist', role_mapping.old_name;
    end if;

    if pg_catalog.to_regrole(role_mapping.new_name) is not null then
      raise exception 'target FetanAgent role % already exists', role_mapping.new_name;
    end if;

    execute pg_catalog.format(
      'alter role %I rename to %I',
      role_mapping.old_name,
      role_mapping.new_name
    );
  end loop;
end;
$fetanagent$;

comment on role fetanagent_api is
  'FetanAgent API group role. NOLOGIN; use only through a dedicated server login role.';
comment on role fetanagent_api_runtime is
  'FetanAgent API runtime login scaffold; inherits only fetanagent_api privileges and cannot SET ROLE.';
comment on role fetanagent_worker is
  'FetanAgent worker group role. NOLOGIN; use only through a dedicated worker login role.';
comment on role fetanagent_beta_admission is
  'FetanAgent beta-admission group. NOLOGIN; limited to reviewed invite admission operations.';
comment on role fetanagent_beta_admission_runtime is
  'FetanAgent beta-admission runtime login scaffold; inherits only fetanagent_beta_admission privileges and cannot SET ROLE.';
comment on role fetanagent_nonce_retention is
  'FetanAgent nonce-retention group. NOLOGIN; limited to bounded expired-nonce cleanup.';
comment on role fetanagent_nonce_retention_runtime is
  'FetanAgent nonce-retention runtime login scaffold; inherits only fetanagent_nonce_retention privileges and cannot SET ROLE.';
comment on role fetanagent_owner_control is
  'FetanAgent Owner-control group. NOLOGIN; limited to reviewed Owner operations.';
comment on role fetanagent_owner_control_runtime is
  'FetanAgent Owner-control runtime login scaffold; inherits only fetanagent_owner_control privileges and cannot SET ROLE.';
comment on role fetanagent_player_actions is
  'FetanAgent Player-action group. NOLOGIN; limited to reviewed Telegram Player-ID and dry-run deposit operations.';
comment on role fetanagent_player_actions_runtime is
  'FetanAgent Player-action runtime login scaffold; inherits only fetanagent_player_actions privileges and cannot SET ROLE.';

commit;
