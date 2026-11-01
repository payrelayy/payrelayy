# Owner-managed KemerBet sign-in production release

The Owner System page saves the configured agent username and password. The
password is stored in Supabase Vault and is supplied only to the signed, paired
Windows Companion. A signed-out Companion can sign in again, verify the bound
agent identity, and resume its existing queues. CAPTCHA, invalid credentials,
provider outages, and uncertain transfers still require Owner attention.

The reviewed active release on production Droplet `593344964` is
`b19f437aeaeb79fe3e1bb460dd35019a2ba5e1ea`. Its installed helper SHA-256 is
`497a900bb6bb7624cb9bca1a1fa0b262545dbfdd1b7b22a1048e54a02a288e22`.
The successor helper SHA-256 is
`24dbb0be96253a173906da6e99bfc3242444286d2c3cd337ec1bf88cd018b218`.
Recheck all of these against production before rotation. Stop if any differs.

1. Require green PR checks and exact merged-main CI. Apply
   `20261101204815_owner_kemerbet_auto_signin_credentials.sql` with the guarded
   Supabase production migration workflow. Confirm the migration is present.
   It creates no credit or payment decision.
2. Confirm the healthy active release, routine-deposit marker,
   `cbe-live-v1` financial switch profile, and no active or unresolved deposit
   attempt. Record the financial switch fingerprint. Do not make a payment to
   test this release.
3. Stage the exact merged-main Git blob for
   `infra/operations/fetanagent-production-deploy-helper-v2.sh` as the root-owned
   mode-`0600` file
   `/root/fetanagent-production-v2-kemerbet-signin-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   inside a root-owned mode-`0700` directory. Stage
   `fetanagent-production-v2-kemerbet-signin-helper-rotation-v1.sh` separately as
   root-owned mode `0700`. Verify both SHA-256 digests and Bash syntax.
4. Run the rotation script with `inspect` and require
   `predecessor-exact; no production runtime changed`. Run `rotate` with
   `ROTATE EXACT PRODUCTION V2 KEMERBET SIGNIN HELPER V1`. Inspect again and
   require `successor-exact; rotation complete; no production runtime changed`.
5. Dispatch `production-runtime.yml` from the same passing merged-main SHA
   with `mode=deploy-inert`, project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, both TeleBirr pilot inputs `not-applicable`, routine transport
   `enabled`, financial profile `cbe-live-v1`, database route `pooler`, and
   operation phrase `DEPLOY SCREENSHOT READER WITH CBE LIVE`. Require its
   predecessor, last-moment idle, switch fingerprint, activation, and health
   checks to pass.
6. Verify the active release and healthy Owner and device bridge. Sign in to
   Owner and open System; confirm the username/password form loads without
   displaying a saved password. Have the Owner save credentials there without
   sending them through chat. Build and attest the matching immutable Windows
   Companion release, then obtain fresh installation confirmation before
   replacing the Kamatera package. Review any unfinished attempt before the
   Companion restart. Check the session journal for automatic sign-in and bound
   identity events; do not trigger a real deposit as a deployment test.

Stop on any failed guard and inspect the cause. Do not change payment switches
or retry an uncertain transfer to force deployment.
