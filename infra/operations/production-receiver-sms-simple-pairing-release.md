# Receiver SMS one-code production release

This release changes only the receiver SMS phone setup. It does not change
payment matching, Owner login, deposit switches, or payment settlement. Do not
test it by making a payment.

| Guard                                       | Exact value                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------ |
| Production Droplet                          | `593344964`                                                                    |
| Required current runtime and routine marker | `26dcb91e3a0bbbc5cb23e4011f0c8a4f783745cf`                                     |
| Installed deployment helper SHA-256         | `cc3524c917dbaa72c13b79445d7ff1be8ae78fb2a8d1d6af46c670f737fb1ab7`             |
| Successor deployment helper SHA-256         | `2e56b98730197379375cd96321ea48036611601f6512ad665c64b77f5f174fdf`             |
| Rotation script                             | `infra/operations/fetanagent-production-v2-receiver-sms-helper-rotation-v1.sh` |

1. Require green PR and exact-main CI. Read the running release, routine marker,
   helper digest, sudoers digest, financial switch profile, and active and
   unresolved deposit work. Stop if any reviewed value differs; do not change
   payment switches to satisfy the release.
2. Stage the exact merged-main Git blob of
   `infra/operations/fetanagent-production-deploy-helper-v2.sh` as root-owned
   mode `0600` at
   `/root/fetanagent-production-v2-receiver-sms-simple-pairing-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`.
   Stage the rotation script separately as root-owned mode `0700`; check its
   digest and Bash syntax.
3. Run the rotation script as root with `inspect`, then `rotate` using
   `ROTATE EXACT PRODUCTION V2 RECEIVER SMS SIMPLE PAIRING HELPER V1`.
   Run `inspect` again. Require its exact successor result and unchanged
   production services and financial state. The script rotates only the
   digest-pinned deployment helper and sudoers grant.
4. Apply `20261105212827_receiver_sms_simple_permanent_pairing.sql` through the
   production Supabase release workflow. Verify the two new private functions,
   the code revocation ledger, and unchanged deposit switches. Keep the current
   phone running on its existing enrollment.
5. Dispatch `production-runtime.yml` from the same passing main commit with
   `mode=deploy-inert`, production project `xzztugbgtulptnbpoelr`, Droplet
   `593344964`, routine transport `enabled`, financial profile `cbe-live-v1`,
   and database route `pooler`. Use the workflow's exact confirmation inputs.
   Require the guarded current release, unchanged switch fingerprint, healthy
   Owner and SMS services, and carried routine marker.
6. Build the signed receiver SMS APK from that main commit using
   `android-telebirr-evidence-release.yml`. Verify version `0.5.42`, code `47`,
   signer, and checksum. Install it on the SMS reader phone. In Owner, create
   one 12-character code, enter it in the app's single field, and verify a
   fresh signed phone status in Owner. The code is one-use; create another
   only if the phone needs to pair again. No real payment is required.

The phone's database authorization uses a far-future schema value so existing
SMS ingestion and revocation checks keep working. There is no scheduled phone
renewal. Owner revocation or receiver rotation can still disable the phone.
