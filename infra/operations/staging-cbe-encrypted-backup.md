# Staging CBE Birr encrypted backup gate

The staging Supabase project showed no scheduled backup or point-in-time recovery on 18 October 2026. Before any migration catch-up, create a recoverable logical backup and prove a restore on an
isolated, privacy-controlled copy. This document and the workflow prepare that gate; they do not
authorize a migration apply, payment switch, receiver change, payment, or Player credit.

## Backup boundary

- The manual GitHub workflow
  [`staging-cbe-encrypted-backup.yml`](../../.github/workflows/staging-cbe-encrypted-backup.yml)
  accepts only `main`, the exact reviewed commit and staging project ref, and an explicit export
  phrase. It uses the protected `staging` environment and the pinned Supabase CLI. It never runs on
  a push or pull request.
- It follows [Supabase's CLI backup procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore):
  roles, schema, data, and separate migration-history schema/data. The five SQL files and their
  hashes are packed and encrypted with CMS AES-256-GCM before the GitHub artifact upload. This
  repository is public, so the ciphertext artifact may be downloaded by others; the local private
  key and authenticated encryption are the confidentiality boundary. Only the `.cms` ciphertext
  is uploaded; plaintext exists only in the temporary job workspace and is removed when the dump
  step ends. The artifact expires after seven days.
- The checked-in certificate is a **public encryption recipient**, not a credential. Its SHA-256
  file digest is pinned in the workflow. The corresponding private key is in the current Windows
  user's restricted `C:\Users\hp\.codex\backup-keys\cbe-staging-20261018\private-key.pem`, outside
  Git. Do not upload, paste, or commit that key. Preserve the key separately from any encrypted
  backup; losing it makes the artifact unrecoverable.
- A logical dump made in five commands is not by itself a proved restore point. Verify the
  post-stop preflight before and after export, compare the encrypted artifact SHA-256 with the
  workflow log, decrypt outside the repository, verify `SHA256SUMS`, and restore into an isolated
  local PostgreSQL/Supabase environment. Keep that copy off public services and repositories.

## Next controlled sequence

1. Review and separately approve merging the backup workflow. Before running it, approve the
   specific encrypted export of staging database content to a GitHub Actions artifact in this
   public repository.
2. Run [`staging-cbe-post-stop-preflight.sql`](../sql/staging-cbe-post-stop-preflight.sql) on the
   exact staging project. Stop if `matches_reviewed_post_stop_snapshot` is not `true`.
3. Dispatch the workflow from the exact reviewed `main` commit. Download the resulting `.cms`
   artifact to a private directory outside Git and retain its encrypted SHA-256 from the run log.
4. Decrypt with `openssl cms -decrypt -binary -inform DER`, the checked-in certificate, and the
   local private key. Write to a temporary archive first. After successful decryption, verify the
   archive's fixed file list and `SHA256SUMS` before any restore. A failed integrity check invalidates
   the backup.
5. Rehearse the exact 185 pending migrations in the linked dry-run order against the isolated
   restored copy, including the four historical gaps. Record row-count and switch-state results.
   Only then prepare a separately reviewed, fail-closed staging apply and request its approval.

Supabase [documents](https://supabase.com/docs/guides/platform/backups) that physical backups do
not include Storage objects and that restoring a backup can cause downtime. This database dump is
for the staging migration gate; any needed Storage objects require their own reviewed recovery
plan. The staging VM/runtime is a separate blocker and must not be replaced by the production host.
