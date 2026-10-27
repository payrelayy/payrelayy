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

The code defaults to masked display. Activating the full display requires this
order:

1. Deploy the updated Owner and SMS broker binaries with both new feature flags
   off. The reviewed production predecessor and routine marker are
   `d6c1865b911a95a8242331410e9dd0d24292954c`. The installed helper and
   sudoers pin are `ab09aa773ba2eac7e7758ea3e02ab335fb5711c0031d0c7934a2afe27d2518d2`;
   the reviewed stage-one successor is
   `94057ea1861e1df02461bc12d8d8053cb52a0a8be8cdb1b999eab00b14952806`.
   Stage the exact merged-main successor helper and
   `fetanagent-production-v2-owner-full-stage1-helper-rotation-v1.sh` as
   root-owned files on Droplet `593344964`. Run the rotation script's `inspect`,
   then `rotate 'ROTATE EXACT PRODUCTION V2 OWNER FULL STAGE1 HELPER V1'`,
   then `inspect` again. Require the exact predecessor and successor messages.
   Dispatch `production-runtime.yml` from passing main with `deploy-inert`,
   `cbe-live-v1`, routine transport `enabled`, database route `pooler`, and
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Confirm healthy services, unchanged
   payment switches, and the routine marker on the new release.
2. Apply `20261027163950_owner_full_payment_identifiers.sql`. Confirm the new
   Owner read functions and the SMS display write function are present and that
   runtime roles still have no direct table access.
3. Provision one persistent, independently generated 32-byte encryption master
   in the protected production secret store. Deliver that same key to the
   Owner and SMS broker under their separate container secret names. Preserve
   it across every later release so stored SMS references stay readable.
4. Integrate `compose.production.owner-full-payment-identifiers.yaml` into the
   guarded release workflow and the installed deploy helper's exact Compose
   allowlist. The current helper and workflow do **not** include this overlay;
   do not assume that placing the file in a release bundle activates it.
5. Enable both feature flags together, then verify a new synthetic signed SMS,
   a matched older SMS, an unmatched older SMS, pending/approved/rejected
   submissions, active payment methods, and retired receiver history in the
   authenticated Owner page. Check that non-Owner APIs and logs do not expose
   full values. Do not replay a real payment for this display check.

If activation fails, turn off both feature flags and keep the migration and
encrypted SMS display rows intact. The old masked read paths remain available.
