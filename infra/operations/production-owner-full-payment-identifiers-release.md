# Owner full payment identifiers — staged release

The Owner-only read path shows full transaction references and receiving
accounts in Submitted payments, full references, receiving accounts and linked
Player IDs in SMS, and full active and retired receiver numbers in Payment
methods and receiver history. The database stores new SMS references as
encrypted display data. The existing masked read functions remain available
for a mixed-version rollout.

Older SMS without a matched customer submission never stored their full
reference. The Owner page labels these records **Reference not stored for older
SMS**. Older SMS with an encrypted submitted reference can show it. A pending
submission with no confirmed receiver account says **No receiving account
confirmed**.

The code defaults to masked display. The guarded release uses this order:

1. The first stage-one release at
   `ceea0fb5f70e217adbb8b6ccbf104e7733b724f7` failed activation and the
   guarded helper restored the healthy predecessor
   `d6c1865b911a95a8242331410e9dd0d24292954c`. Its stage-one helper
   rotation succeeded; the installed helper and sudoers pin are
   `94057ea1861e1df02461bc12d8d8053cb52a0a8be8cdb1b999eab00b14952806`.
   Deploy the bridge release
   `8e6367b01383b53cb7135d62083e1dfcd37cbdd4` with both feature flags
   off. Dispatch `production-runtime.yml` from passing main with `deploy-inert`,
   `cbe-live-v1`, routine transport `enabled`, database route `pooler`, and
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Confirm healthy services,
   unchanged payment switches, and the routine marker on the bridge release.
2. The schema migration `20261027163950_owner_full_payment_identifiers.sql`
   reached production before the compatible broker. Its new grant made the old
   broker fail its exact function-surface check. The emergency migration
   `20261027173415_defer_owner_sms_display_grant_until_broker_rollout.sql`
   revoked that one grant; both the broker and device bridge returned healthy.
   The failed rollout restarted the old Owner, whose preflight rejected four
   additional display grants. The emergency migration
   `20261027174232_defer_owner_sensitive_read_grants_until_owner_rollout.sql`
   revoked those grants and the old Owner recovered. Keep both recorded
   migrations in the repository so migration history agrees.
3. Once the bridge release is healthy at
   `8e6367b01383b53cb7135d62083e1dfcd37cbdd4`, restore all five grants with
   `20261027175000_restore_owner_sms_display_grant_after_broker_rollout.sql`.
   Confirm the broker remains healthy and runtime roles still have no direct
   table access.
4. A persistent independently generated 32-byte encryption master is stored
   as the production GitHub environment secret
   `OWNER_SMS_DISPLAY_ENCRYPTION_MASTER_SECRET`. The production workflow
   delivers the same key to the Owner and SMS broker under separate container
   secret names. Preserve it across later releases so stored SMS references
   stay readable.
5. The activation release integrates the display settings into the guarded
   `compose.production.yaml` and `compose.production.inert-maintenance.yaml`
   files. The separate overlay remains an example and is not transferred by
   the exact-file deploy helper. Stage the merged-main successor helper and
   `fetanagent-production-v2-owner-full-activation-helper-rotation-v1.sh` on
   Droplet `593344964`. Rotate from the stage-one helper digest
   `94057ea1861e1df02461bc12d8d8053cb52a0a8be8cdb1b999eab00b14952806`
   to `ba2bff461abc271e3650400fc3aa10d39fbd8bd6726a5abd9e6c599359107b49`.
   Run `inspect`, then
   `rotate 'ROTATE EXACT PRODUCTION V2 OWNER FULL ACTIVATION HELPER V1'`, then
   `inspect` again. Require the exact predecessor and successor messages.
6. Dispatch the same guarded `deploy-inert` workflow from passing main with
   `cbe-live-v1`, routine transport `enabled`, database route `pooler`, and
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Confirm healthy services,
   unchanged payment switches, and the routine marker on the new release.
   Verify a new synthetic signed SMS, a matched older SMS, an unmatched older
   SMS, pending/approved/rejected submissions, active payment methods, and
   retired receiver history in the authenticated Owner page. Check that
   non-Owner APIs and logs do not expose full values. Do not replay a real
   payment for this display check.

If activation fails, turn off both feature flags and keep the migration and
encrypted SMS display rows intact. The old masked read paths remain available.
