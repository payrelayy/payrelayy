# Owner stopped-credit record — guarded production release

PR #1003 lets the Owner record a Player credit completed outside FetanAgent only
when a signed SMS matches the submission and every automatic attempt stopped
before KemerBet's final action. It does not retry or create a Player transfer.
The Companion journal also gains finer, non-sensitive refresh response categories
in a separate Windows package; the server deployment does not update that app.

The reviewed running predecessor is `bc907f91cedd3f8e462bb3e2dd9db91c68428f04`
on production Droplet `593344964`, with its routine-deposit marker. Its installed
helper SHA-256 is `c231e0efd97001728f0ba73a47ac6344f115348ff9e0e812c7736298069aa6ff`.
The successor helper SHA-256 is
`a9a7dca5597802d79c44d024bfa3b1a216fe1522dd44eeaa36db57381dd22d65`.

1. Require passing CI for the exact merged main commit. Check the Droplet ID,
   running release and routine marker, helper and sudoers digests, unchanged
   payment switches, signed receiving transport, and zero active jobs or
   unresolved attempts. Stop if the observed predecessor or payment state differs.
2. Apply `20261029143500_owner_stopped_pre_action_credit.sql` through the
   production migration workflow. Confirm the new functions exist, grants are
   limited to the Owner control runtime, and no credit or job was created.
3. Stage the merged-main helper Git blob as root-owned mode `0600` at
   `/root/fetanagent-production-v2-owner-stopped-credit-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned `0700` directory. Stage
   `fetanagent-production-v2-owner-stopped-credit-helper-rotation-v1.sh`
   separately with mode `0700`. Verify the exact file digests and Bash syntax.
   Run `inspect` and require `predecessor-exact; no production runtime changed`.
   Run `rotate` with `ROTATE EXACT PRODUCTION V2 OWNER STOPPED CREDIT HELPER V1`,
   then require `successor-exact; rotation complete; no production runtime changed`.
4. Dispatch `production-runtime.yml` from the same green main SHA with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   both TeleBirr pilot inputs `not-applicable`, routine transport `enabled`,
   database route `pooler`, financial profile `cbe-live-v1`, and confirmation
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. The workflow must recheck the
   predecessor, payment fingerprint, idle cutover, health, and routine marker.
5. Verify the exact release, healthy services, unchanged payment switches and
   receiver settings, and no newly unresolved work. In the Owner Submitted
   payments view, only a proven pre-action stop should show **Record outside
   credit**. It records an already completed outside credit; it does not call
   KemerBet. Do not submit or replay a payment as a test.
