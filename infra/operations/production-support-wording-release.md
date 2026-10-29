# Support reply wording — guarded production release

The bot's `/support` reply contains only the configured support contact, or a
short unavailable message when that contact cannot be loaded. This release
removes the extra password reminder from both replies. It does not change
payment handling, the support contact, database schema, or the Windows
Companion.

The reviewed running predecessor is
`109c9b4435f6a6dd649808a97f38505962ac2944` on production Droplet
`593344964`, with its routine-deposit marker. The installed helper SHA-256 is
`a9a7dca5597802d79c44d024bfa3b1a216fe1522dd44eeaa36db57381dd22d65`.
The reviewed successor helper SHA-256 is
`0f4afb50ac6a1f37b6afa8bc1e2026a2bd52af9a5bef6dc5dfc847d6979647df`.

1. Require passing CI for the exact merged main commit. Verify the live
   predecessor, routine marker, helper and sudoers digests, unchanged payment
   switches, and absence of active jobs or unresolved attempts. Stop if these
   differ from the reviewed state.
2. Stage the merged-main helper Git blob as root-owned mode `0600` at
   `/root/fetanagent-production-v2-support-wording-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned `0700` directory. Stage
   `fetanagent-production-v2-support-wording-helper-rotation-v1.sh` separately
   with mode `0700`. Verify exact file digests and Bash syntax. Run `inspect`
   and require `predecessor-exact; no production runtime changed`. Run
   `rotate` with `ROTATE EXACT PRODUCTION V2 SUPPORT WORDING HELPER V1`, then
   require `successor-exact; rotation complete; no production runtime changed`.
3. Dispatch `production-runtime.yml` from the same green main SHA with
   `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet `593344964`,
   both TeleBirr pilot inputs `not-applicable`, routine transport `enabled`,
   database route `pooler`, financial profile `cbe-live-v1`, and confirmation
   `DEPLOY SCREENSHOT READER WITH CBE LIVE`. The workflow must recheck the
   predecessor, payment fingerprint, idle cutover, health, and routine marker.
4. Verify the exact deployed release and healthy bot service. Check that
   `/support` gives only the contact link in the normal case. Do not submit or
   replay a payment as a test.
