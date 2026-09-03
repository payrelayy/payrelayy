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
`spzpiyxheappsfyswewl` and the exact full reviewed `main` commit SHA. The commit must be 40
lowercase hexadecimal characters and must match the immutable workflow commit. The production ref
`xzztugbgtulptnbpoelr` is hard-rejected before any database command.

Configure exactly these GitHub environment secrets with staging-only values:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`

Run `plan` first and enter the reviewed full SHA in `confirm_main_commit_sha`. Before `apply`, verify
that `main` still points to that same reviewed commit, then dispatch `apply` from and confirm the
same full SHA. Every dispatch verifies the checked-out commit and staging ref, lists migration
state, and runs `supabase db push --dry-run`. The `apply` mode performs that same plan before
applying the canonical migrations and listing the resulting migration state. The workflow never
includes seed data, targets production, deploys an application, starts Telegram, or enables a
payment flow. Review the staging project's security and performance advisors separately after the
first successful apply.

### Hosted migration-ledger reconciliation

The staging project contains two 2026-08-29 migration entries created by guarded operational
credential-validity recovery. Their matching repository files are intentionally comment-only
ledger markers: fresh databases must not reproduce an old staging credential lifetime. The
Telegram proof-status migration was first reviewed under source timestamp `20260902224258`, but the
Supabase management migration tool installed the reviewed body under hosted version
`20260903140617`; the canonical filename uses the hosted version. The infrastructure verifier pins
these facts and requires the operational markers to remain no-op. Do not use `migration repair` to
erase or invent history when a hosted entry differs; inspect its exact name and effect first.

## First staging Owner

The manual
[`Staging first Owner bootstrap`](../.github/workflows/staging-first-owner-bootstrap.yml) workflow
is the only repository path for converting one existing, confirmed staging Auth user into the first
active Owner. It hard-rejects production, non-`main` source, a mismatched commit, malformed Auth
UUIDs, and any database where an active Owner already exists. It first runs a serializable read-only
inspection and requires the bootstrap procedure to remain private and security-definer.

Create the Auth user privately in the staging Supabase dashboard with a password stored in the
Owner's password manager and confirm the email. Never paste the email or password into GitHub,
Codex, a repository file, or a workflow input. Only the non-secret Auth user UUID is accepted by the
workflow. Run `inspect` first. Then select `bootstrap` and type
`bootstrap-first-staging-owner`; the guarded SQL takes a transaction advisory lock, calls the
deployment-only procedure with no display name, and verifies exactly one active Owner and its audit
event before commit. The action is intentionally one-time and has no delete/reset mode.
