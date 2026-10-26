# Owner emergency approval — guarded production release

PR #962 contains the Owner SMS and Submitted payments controls. Its first
production application deployment stopped before activation because the CBE
predecessor checks still named the older release. This follow-up pins those
checks to the release observed running on 2026-10-26. The failed run did not
activate an application, apply a migration, or change payment switches. A
subsequent read-only production check at 2026-10-26 01:14 UTC found the new
migration already installed through a separate path. The old application is
still running and healthy. The remaining release must verify that exact schema
and deploy the matching application; it must not reapply the migration.

| Boundary                                    | Reviewed value                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Production Droplet                          | `593344964`                                                                                |
| Production Supabase project                 | `xzztugbgtulptnbpoelr`                                                                     |
| Required running release and routine marker | `97ff2764fed63679b102d2d7649650a4119c66a2`                                                 |
| Installed helper and sudoers pin            | `238b1068123b434128def98334c01e367df2edb4912684b7cd57d8d7cb6932b7`                         |
| Successor helper and sudoers pin            | `f9dff78b64bec9722e1170ac7e36fa084d6c01233dee15741f0cf5a5d2836027`                         |
| One-use rotation                            | `infra/operations/fetanagent-production-v2-owner-emergency-approval-helper-rotation-v1.sh` |
| Payment profile                             | `cbe-live-v1`, signed routine transport `enabled`, SMS route enabled                       |
| New migration                               | `20261026001036_owner_one_step_manual_credit.sql`                                          |

1. Require passing follow-up PR and exact-main push CI. Recheck the Droplet
   identity, running release and routine marker, installed helper and sudoers
   digests, Owner and customer health, all seven payment switches, SMS route,
   and absence of nonterminal jobs and unresolved attempts. Require migration
   `20261026001036` to be the latest and present exactly once, with both new
   Owner function signatures owned by `postgres`, security-definer with fixed
   search paths and only the intended grants. A changed predecessor, helper,
   payment profile, migration history, or function catalog is a stop condition.
2. Stage the exact merged-main helper Git blob as
   `/root/fetanagent-production-v2-owner-emergency-approval-helper-rotation-v1-input/fetanagent-production-deploy-helper-v2.next`
   in a root-owned mode-`0700` directory, with the file root-owned mode-`0600`.
   Stage the exact merged-main rotation script separately. Verify the script's
   Bash syntax and both blob digests. Run it as root with `inspect`; require
   `predecessor-exact; no production runtime changed`. Then run `rotate` with
   `ROTATE EXACT PRODUCTION V2 OWNER EMERGENCY APPROVAL HELPER V1` and repeat
   `inspect`; require
   `successor-exact; rotation complete; no production runtime changed`. The
   script locks the deployment helper and rotates its checksum-pinned sudoers
   grant; it changes no application container or database state.
3. Dispatch `production-runtime.yml` from the exact passing merged-main SHA
   with `mode=deploy-inert`, the production project and Droplet IDs above,
   `confirm_operation=DEPLOY SCREENSHOT READER WITH CBE LIVE`, both TeleBirr
   pilot inputs `not-applicable`, `confirm_routine_deposit_transport=enabled`,
   `confirm_financial_switch_profile=cbe-live-v1`, and
   `confirm_database_route=pooler`. The workflow must confirm the predecessor,
   idle cutover, healthy app and bot, carried routine marker, and unchanged
   switch fingerprint. The new Admin preflight accepts the exact installed
   additive Owner functions.
4. Once the new application is healthy, verify the installed migration ledger,
   both Owner function signatures and restricted grants, the Owner SMS and
   Submitted payments views, public health, notification queue, SMS route, and
   unchanged payment switches. Do not dispatch the database release workflow
   for a migration already present. Do not submit or replay a real payment to
   test this release.

If the application deploy or migration fails, stop and investigate the exact
guard failure. After the new migration is installed, do not restart a
pre-migration Owner application: its function allowlist predates this catalog.
Do not change a financial switch or receiver to make a release guard pass.
