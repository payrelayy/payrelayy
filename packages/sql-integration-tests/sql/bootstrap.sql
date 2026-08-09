-- Synthetic, disposable compatibility surface for running the checked-in migrations in a local
-- PostgreSQL container. It deliberately contains no application users, payment data, credentials,
-- or live Supabase objects.

create extension if not exists pgcrypto;

do $bootstrap$
declare
  required_role text;
begin
  foreach required_role in array array['anon', 'authenticated', 'service_role']
  loop
    if not exists (select 1 from pg_roles where rolname = required_role) then
      execute format(
        'create role %I nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls',
        required_role
      );
    end if;
  end loop;
end;
$bootstrap$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create schema if not exists storage;

create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);
