-- PayReplayy Stage 10: store English as the only Telegram customer locale.
--
-- The internal locale field and inbox-function argument remain for rolling compatibility, but
-- customer-facing behavior and every stored locale are English (`en`) only.

begin;

-- Prevent an older inbox process from writing `am` between the cleanup and strict constraint.
lock table app.telegram_identities in access exclusive mode;

-- Keep this a SECURITY INVOKER trigger. It is an integrity normalizer, not an authorization API.
create function app.force_telegram_identity_english_locale()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.preferred_locale := 'en';
  return new;
end;
$$;

-- PostgreSQL grants new functions to PUBLIC by default. This trigger is not directly callable.
revoke all on function app.force_telegram_identity_english_locale()
  from public, anon, authenticated, service_role, payreplayy_api, payreplayy_worker;

create trigger telegram_identities_force_english_locale
before insert or update on app.telegram_identities
for each row
execute function app.force_telegram_identity_english_locale();

update app.telegram_identities
   set preferred_locale = 'en'
 where preferred_locale is distinct from 'en';

alter table app.telegram_identities
  drop constraint telegram_identities_preferred_locale_check;

alter table app.telegram_identities
  add constraint telegram_identities_preferred_locale_check
  check (preferred_locale = 'en');

comment on column app.telegram_identities.preferred_locale is
  'Reserved for future localization; PayReplayy currently stores English (en) only.';

commit;
