# Supabase migration contract

Database changes are SQL-first and live in `supabase/migrations/`. Each migration must add
the required constraints, indexes, RLS policies, audit events, and rollback/reconciliation
notes for the state it introduces.

Before deployment, review Supabase security advisors and test the migration in a safe
environment. Do not commit database passwords, service-role keys, customer receipt files,
or production exports.

## Staging bootstrap

The manually dispatched
[`Supabase staging bootstrap`](../.github/workflows/supabase-staging-bootstrap.yml) workflow is the
only repository automation for the separate staging database. It is restricted to `main`, uses the
GitHub `staging` environment, and requires the operator to type the exact staging project ref
`spzpiyxheappsfyswewl`. The production ref `xzztugbgtulptnbpoelr` is hard-rejected before any
database command.

Configure exactly these GitHub environment secrets with staging-only values:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

Run `plan` first. Every dispatch links and verifies the staging ref, lists migration state, and runs
`supabase db push --dry-run`. The `apply` mode performs that same plan before applying the canonical
migrations and listing the resulting migration state. The workflow never includes seed data,
targets production, deploys an application, starts Telegram, or enables a payment flow. Review the
staging project's security and performance advisors separately after the first successful apply.
