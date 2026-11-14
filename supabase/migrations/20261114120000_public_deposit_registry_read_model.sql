begin;

-- Read-only registry projection for the public Owner API. The existing
-- availability function remains the authority for current payment methods.
-- Adapter activation is deliberately decided by the application, not by a
-- newly inserted registry row.
create function app.public_deposit_registry()
returns table (
  entry_kind text,
  code text,
  display_name text,
  adapter_key text,
  record_status text,
  accepting boolean
)
language sql security definer set search_path = pg_catalog
as $$
  select 'platform'::text as entry_kind, platform.code as code,
    platform.display_name as display_name,
    null::text as adapter_key, platform.status::text as record_status,
    null::boolean as accepting
  from app.platforms platform
  union all
  select 'method'::text, provider.code, provider.display_name,
    provider.adapter_key, provider.status::text,
    coalesce(control.accepting, false)
  from app.payment_providers provider
  left join app.public_provider_deposit_controls() control
    on control.provider_code = provider.code
  order by entry_kind, code
$$;
alter function app.public_deposit_registry() owner to postgres;
revoke all on function app.public_deposit_registry()
  from public, anon, authenticated, service_role, fetanagent_owner_control_runtime;
grant execute on function app.public_deposit_registry()
  to fetanagent_owner_control;

comment on function app.public_deposit_registry() is
  'Read-only platform and provider registry facts plus the existing public availability decision; no receiver or customer data and no adapter activation.';

commit;
