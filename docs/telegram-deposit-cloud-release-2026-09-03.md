# Telegram deposit cloud release — 2026-09-03

## Deployed result

Verified at approximately 14:40 UTC. This is a deployed, financially disabled beta, not approval
for public real-money processing.

- Application/images: `8e46eabb770680cd4885a09815df7f8e0aec73e1`.
- Operational workflow repair: `920125e4f0c12a3e631645602b358d57f998b419`.
- Supabase: the existing staging project `spzpiyxheappsfyswewl`; production was not changed.
- DigitalOcean: existing Droplet `593344964`; no new server or paid resource was provisioned.
- All six staging containers run the application SHA above with zero restarts. The five containers
  with health checks are healthy; the bot passed its separate startup/identity check.
- The public home, public sign-in, and Owner entry page returned HTTPS 200 with their expected
  no-store, CSP, and HSTS headers. This check did not sign in or change an Owner setting.
- Telegram identified the running bot as `FetanAgentBot`, with no webhook and zero pending updates.

The application release includes customer-scoped proof tracking, TeleBirr URL/SMS reference input,
the graceful/redacted polling lifecycle, and the executor's late-fence/duplicate-request defenses.
The executor image was built and delivered, but no executor service was started.

## GitHub and rollout receipts

The changes were merged through proof tracking PR #158, input/lifecycle/executor PR #159, and
queue-safe activation PR #160 in this repository.
Quality, disposable PostgreSQL integration, and both image-smoke checks passed. PR #159 also passed
the no-transfer Windows companion package check.

The cloud sequence is recorded below. From this repository, `gh run view RUN_ID --web` opens the
corresponding receipt without depending on a particular repository display name.

| Step                                          | GitHub Actions run | Result |
| --------------------------------------------- | ------------------ | ------ |
| Build exact release images                    | `33764401606`      | Passed |
| Stop old services and disable four logins     | `33764739496`      | Passed |
| Deploy and smoke the matching backend         | `33764945350`      | Passed |
| First bot activation                          | `33765933123`      | Failed |
| Queue-preserving activation of the same image | `33767376159`      | Passed |
| Inspect public-edge prerequisites             | `33767606648`      | Passed |
| Publish and verify HTTPS                      | `33767836358`      | Passed |

The private proof-status migration was applied and verified between the stop and backend deploy.
The first bot activation failed at the old combined webhook/empty-queue assertion; no token was
installed by that failed run. The tested operational repair was merged before the successful
activation, with no replacement of the already-tested application images.

The repaired activation check preserves waiting updates for the normal poller. It uses only
`getMe` and `getWebhookInfo`, rejects an existing webhook and malformed queue metadata, and never
consumes or clears the queue. Sixteen synthetic cases execute the actual inline workflow program.
The bot and HTTPS workflows may operate on an already-deployed ancestor of their `main` workflow
commit, but check out and use that exact application release's helper contract. This does not
authorize an arbitrary branch, a different installed image, or a financial activation.

## Supabase verification

The reviewed source migration is now canonically recorded as
`supabase/migrations/20260903140617_private_telegram_deposit_proof_status.sql`. It was first reviewed
under source timestamp `20260902224258`; Supabase's management migration tool installed that exact
body as version `20260903140617`, name `private_telegram_deposit_proof_status`. The repository later
aligned the filename with that audited hosted ledger entry so normal CLI planning cannot attempt a
duplicate. The installed function and reviewed source body were compared before this reconciliation.

The installed `app.get_telegram_customer_deposit_proof(uuid,uuid)` body was compared with the reviewed
source and matched. Its fixed search path, stable/security-definer properties, and ACL were checked.
Only `postgres` and `fetanagent_player_actions` appear in its execute ACL; `anon`, `authenticated`,
and `service_role` cannot execute it. The Player-actions role exposes exactly eleven `app` functions,
and the deployed API passed its normal catalog/readiness preflight.

The post-rollout database audit found zero payment claims, execution jobs, execution attempts, and
execution reconciliations. Every financial switch remains disabled. The executor and trusted
TeleBirr verifier runtime roles remain `NOLOGIN`. No FetanAgent financial action was executed.

Security advisors returned 71 informational RLS-without-policy notices for the private RPC design
and one existing warning: [leaked-password protection is disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
The warning remains an operational review item; this rollout did not change Auth policy or broaden
RLS access to silence advisory output.

## Telegram command menu

The bot's default, private, and English-private command lists were initially empty. The existing
private-chat menu was configured using Telegram's `setMyCommands` and read back with `getMyCommands`.
The scope is `all_private_chats`, with the default language; no group menu was changed.

| Command           | Published description                           |
| ----------------- | ----------------------------------------------- |
| `/start`          | Open the FetanAgent menu                        |
| `/menu`           | Manage a KemerBet Player ID                     |
| `/deposit`        | Submit a test proof (simulation only; no money) |
| `/deposit_status` | Check your proof tracking reference             |
| `/help`           | Deposit instructions and current limits         |

This is bot-account configuration, not a new command handler. The five handlers already exist in
the deployed application. Credentials stayed in the running bot's protected configuration and were
not copied into Git, workstation files, or output. No customer message or financial instruction was sent
by this menu configuration. A fresh user-driven proof submission/status journey was not performed
as part of these deployment checks.

## Availability and remaining real-money work

At the original 14:40 UTC verification, the bounded staging timer was scheduled for **2026-09-04 at
12:12:32 UTC (15:12:32 East Africa Time)**, two hours before runtime credentials expired. The Owner
subsequently requested removal of this arbitrary availability limit. That policy is superseded by
the [continuous-availability procedure](../infra/staging-continuous-availability.md), which changes
only the four application login lifetimes and disables the old timer after independent database and
host checks. Removing the timer without first removing application credential expiry is not sufficient.

Still required are the durable guided Telegram conversation, exact local KemerBet session/device
pairing and execution integration, Android enrollment and official TeleBirr observation lifecycle,
the isolated trusted-verifier service, and the supervised/reconciled pilot. No Android device was
connected to the development PC during the rollout. Phone and local-session acceptance checks still
need the Owner's devices and private sign-in, alongside the remaining implementation work.

The current Windows companion v0.1.2 package was not replaced or promoted to financial authority.
Follow [the go-live phases](real-money-go-live-phases.md) for the remaining integration, operational,
and separate public-launch gates. Existing simulation proofs must never be promoted into live claims.
