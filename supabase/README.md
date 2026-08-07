# Supabase migration contract

Database changes are SQL-first and live in `supabase/migrations/`. Each migration must add
the required constraints, indexes, RLS policies, audit events, and rollback/reconciliation
notes for the state it introduces.

Before deployment, review Supabase security advisors and test the migration in a safe
environment. Do not commit database passwords, service-role keys, customer receipt files,
or production exports.
