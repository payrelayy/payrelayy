\set ON_ERROR_STOP on

alter role payreplayy_beta_admission_runtime with
  nologin
  noinherit
  nosuperuser
  nocreatedb
  nocreaterole
  noreplication
  nobypassrls
  connection limit 1
  password null
  valid until 'infinity';
