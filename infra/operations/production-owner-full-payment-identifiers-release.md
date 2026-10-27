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
   off. Confirm both services remain healthy and payment processing is intact.
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
