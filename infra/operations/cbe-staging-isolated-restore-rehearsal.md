# CBE Birr staging isolated database rehearsal, 18 October 2026

This is data-free evidence for a **local** restore and migration rehearsal. It does not authorize
staging migration apply, CBE Birr enablement, receiver changes, payment, or Player credit.

## Source and isolation

- Source: approved encrypted staging export from Actions run `39131122213`, ciphertext SHA-256
  `7abbc7c5f432976d9d7ca855a956c26c371a54b0161c3fa613b5aebd44b3a3ad`. Authenticated
  decryption, fixed archive members, and all six member hashes were checked again locally. The
  original export and private key stayed outside Git.
- Target: disposable Supabase CLI `2.113.0` database using the official PostgreSQL 17 image
  `public.ecr.aws/supabase/postgres:17.6.1.158` (digest
  `sha256:99b1729aeb0bac314445024fc149fbd39306170b61dd50800ccf180327ab3459`). Auth,
  Storage, and Realtime database schemas were initialized. Its Docker network was disconnected
  before any private SQL was copied; a host-port probe received no PostgreSQL response. All
  subsequent database access used `docker exec`.

## Restore and replay

- The local image's Auth and Storage schema versions differ from hosted staging. Four Auth COPY
  blocks for absent tables contained **zero rows**, so only those blocks were omitted from a
  private local copy. Seven newer hosted Auth/Storage columns were added to the disposable target
  with types and defaults read from staging catalog metadata. This retained the nonempty Storage
  bucket status. The original backup files were not edited.
- Roles, application schema, migration history, and all remaining Auth, Storage, and application
  data loaded in one transaction. The exact restored post-stop aggregate matched: 87 migrations,
  seven disabled financial switches, the stopped pilot, three CBE Birr intents, two submissions,
  zero deposit jobs or execution attempts, and the unchanged legacy receiver. Auth user, identity,
  session, and refresh-token row counts matched the exported COPY blocks; the one Storage bucket
  was retained. Hosted staging had zero Vault secrets and zero Storage objects in the checked
  database snapshot.
- The guarded shadow-role lock ran **only** in the local copy. The exact 87-version ledger hash
  and locked-role preflight then passed. All 185 pending canonical migrations, including four
  older gaps, ran in ascending order with per-file transactions and migration-history inserts.
  The local `pg_cron` extension was available and installed by the migrations; no SQL-integration
  marker bypass was used.
- The post-catch-up verifier passed with all 272 canonical versions and SHA-256 ledger hash
  `239137ea9573030dfb5b2584b2ad8698ce4b05c90ac3e8a677cf4121d848ebd5`. Seven switches
  remained disabled, the CBE Birr counts and receiver stayed unchanged, and there were no deposit
  jobs or execution attempts. A later check remained true after the five local cron jobs had time
  to run.

## Limit

This proves the exported **database content** can be loaded into an isolated Supabase PostgreSQL
runtime and the reviewed migration set can run there. The local platform used compatibility
columns, omitted four empty Auth tables, and did not initialize the Edge helper. It does not
prove an identical hosted-platform rollback or restore external services. A guarded staging apply
path and fresh read-only staging checks still need separate review and approval.
