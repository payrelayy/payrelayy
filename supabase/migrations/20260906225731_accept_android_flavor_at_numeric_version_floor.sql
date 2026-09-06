-- Android operational builds append a reviewed runtime flavor to the numeric app version
-- (for example, 0.5.0-secure-pairing). A numeric minimum such as 0.5.0 is a floor for every
-- reviewed flavor at that exact numeric release. A suffixed minimum remains exact so one runtime
-- flavor cannot satisfy another flavor's explicitly configured minimum.

create or replace function app.private_telebirr_device_app_version_at_least(
  p_candidate text,
  p_minimum text
)
returns boolean
language plpgsql
immutable
security definer
set search_path = pg_catalog
as $$
declare
  candidate_match text[];
  minimum_match text[];
  candidate_core integer[];
  minimum_core integer[];
begin
  candidate_match := pg_catalog.regexp_match(
    p_candidate,
    '^([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})([._-][A-Za-z0-9][A-Za-z0-9._-]{0,47})?$'
  );
  minimum_match := pg_catalog.regexp_match(
    p_minimum,
    '^([0-9]{1,6})\.([0-9]{1,6})\.([0-9]{1,6})([._-][A-Za-z0-9][A-Za-z0-9._-]{0,47})?$'
  );
  if candidate_match is null or minimum_match is null then
    return false;
  end if;

  candidate_core := array[
    candidate_match[1]::integer,
    candidate_match[2]::integer,
    candidate_match[3]::integer
  ];
  minimum_core := array[
    minimum_match[1]::integer,
    minimum_match[2]::integer,
    minimum_match[3]::integer
  ];

  if candidate_core > minimum_core then
    return true;
  end if;
  if candidate_core < minimum_core then
    return false;
  end if;

  return p_candidate = p_minimum or minimum_match[4] is null;
end;
$$;

comment on function app.private_telebirr_device_app_version_at_least(text, text) is
  'Compares numeric Android versions and accepts reviewed flavor suffixes at a suffix-free numeric floor; a suffixed minimum remains exact.';
