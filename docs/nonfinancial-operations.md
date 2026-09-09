# Non-financial operations and release checks

This page covers application availability and support only. It does not certify the product
for public use or provide instructions for activating financial operations. The Windows
companion currently has no payment execution capability. Existing financial restrictions remain
unchanged by these operational improvements.

## Owner dashboard and companion downloads

Open [FetanAgent Owner](https://owner.fetanagent.com/owner). The companion connection panel
distinguishes a recent authenticated check-in from an expired, absent, or unavailable check.
That check is not confirmation of the separate provider sign-in or payment readiness.

If the panel says **Connected**, keep the installed companion and its separate Chrome window
open. Do not download or pair again merely to refresh connection status.

The ZIP and checksum links open separately so a failed download does not replace Owner.
The adjacent **official FetanAgent GitHub releases page (new tab)** link provides the official
release page and asset list.
If a download still fails:

1. Keep Owner open and note the error text, such as `Not Found` or `ERR_BLOCKED_BY_CLIENT`.
2. Check the official release page for `FetanAgent-Windows-Companion.zip` and its matching
   `.sha256` file. Do not use an unofficial mirror or an old signed asset-redirect URL.
3. Leave browser and antivirus protections enabled. Report the error to the operator/team
   without passwords, pairing packages, tokens, or signed download URLs.

This guidance does not guarantee that a browser extension or network policy will allow a download.
It provides a recovery path without replacing the signed-in dashboard or weakening local protection.

## Owner-managed public Telegram support

In the signed-in Owner dashboard, open **Customer support**. Enter the Telegram
username you control (with or without `@`), check the `https://t.me/…` preview,
confirm it is the intended public contact, and select **Save support contact**.
The saved contact and success message appear in the same section. This field is
a public support username, not a bot token, password, wallet number, or payment setting.
FetanAgent validates its format but does not verify that you own the Telegram account.

The initial setting is blank. To remove a published contact, select **Clear draft /
disable contact**, confirm the change, and save. Clearing the draft alone changes
nothing on the server. A conflicting edit from another Owner tab requires
**Refresh saved contact** and review before saving again. After an uncertain result,
refresh to check what actually persisted; do not assume a failed response means the
database did not save it.

The bot's private-chat `/support` command reads this setting without customer
identifiers or credentials and replies with the current public link. A missing or
unavailable contact produces an unavailable response, never a fabricated fallback.
Saved changes invalidate the server's five-second cache; already-sent Telegram
messages cannot be edited by changing the setting. No bot restart or deployment is
needed for future contact changes. `/support` does not enter the customer/payment
pipeline or provide deposit or financial-processing authority.

Support also accepts Telegram's addressed command form, `/support@FetanAgentBot`,
with optional arguments. The recipient must match the running bot's initialized
username (case-insensitive); no additional Telegram identity request is made.
Malformed support addresses and support commands addressed to other bots are
consumed without a reply, contact fetch, or customer-inbox event. Group and bot
senders remain unsupported. Unrelated commands keep their existing behavior.

### One-time release ordering

Deploy the reviewed application first, then apply migration
`20260909162450_owner_telegram_support_contact.sql` through the existing production
migration workflow. The new runtime accepts the absence of these three additive
support functions without relaxing its other privilege checks; support remains
unavailable until the migration is applied. The previous runtime rejects the new
function grants on startup, so do not apply this migration before the new application
is successfully activated. After the migration, recovery must use a compatible
reviewed application; do not switch blindly to an older image.

Verify the anonymous public endpoint returns only
`{"supportContact":{"telegramUsername":null}}` initially, unauthenticated Owner
requests return 403, and the authenticated form shows the blank saved setting.
Do not publish a placeholder contact in production to test saving. The Owner then
saves their intended real username and can send `/support` to check the live reply.

## What Telegram bot health means

Production bot health requires a successful existing `getUpdates` response within the last
90 seconds. Empty responses count: a quiet bot should remain healthy. The health probe makes
no additional Telegram requests and stores no message contents, customer identifiers, or tokens.

The probe rejects successes older than 90 seconds. Docker samples it every 15 seconds and marks
the container unhealthy after three failures, so Docker's displayed label can lag behind the
probe's current result; it is not a continuous 90-second guarantee.

The readiness file is private to the container's existing temporary filesystem. Startup and
shutdown clear readiness. Missing, malformed, future-dated, stale, or dead-process state fails
the probe. The production deployment waits for this healthcheck; release status checks require
it to be healthy. Historical releases without the probe explicitly report polling health as
unverified and remain usable as rollback predecessors.

| State     | Interpretation                                          | Operator response                                                                                   |
| --------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Starting  | No successful poll observed yet                         | Allow initialization and the first long poll to finish.                                             |
| Healthy   | Recent successful polling                               | Telegram connectivity observed; processing of a particular message is not proved.                   |
| Unhealthy | No recent successful polling or invalid local readiness | Check bounded/redacted lifecycle logs, Telegram connectivity, and duplicate bot-instance conflicts. |
| Stopped   | Bot process is not running                              | Inspect the deployment result and shutdown reason before restarting.                                |

Docker does not automatically restart a container merely because it becomes unhealthy.
No restart controller is installed. Do not launch a second instance of the same bot to
diagnose a polling problem.

## Release verification

Use the existing **Production application runtime** GitHub workflow against its exact reviewed
main commit and production target. Its deployment path retains previous application artifacts
and can roll back a failed activation only while the exact pending predecessor record exists.
Finalization removes that record; the helper rejects rollback of the finalized current release.
Retaining an older image or release directory does not extend this automatic rollback window.

After finalization, application recovery needs a separately reviewed redeployment through the
existing main-branch and exact-commit CI gates. Never recreate or edit predecessor markers,
switch release symlinks manually, or bypass those gates to force a rollback. Application
rollback does not restore database contents; never restore a database as a routine
application-restart step. See the [recovery readiness checklist](recovery-readiness.md) for the
distinct application, host, database, and configuration recovery evidence.

Production deployment requires successful current main-push runs of the seven required CI
workflows for that exact source SHA. The deployment checks them before building, before
using production secrets, and again immediately before activation. Missing, failed, queued,
or changing CI evidence blocks deployment; plan, status, and stop remain separate operations.
These are point-in-time GitHub checks, not an atomic lock on later remote CI changes.

Verification must establish:

- the production release SHA matches the reviewed source;
- every deployed service is running and its configured healthcheck passes, including the bot;
- public home, sign-in, and Owner pages return the expected HTTPS responses;
- unauthenticated private bridge requests remain rejected;
- Owner includes the new-tab downloads and troubleshooting guidance;
- financial execution remains absent and its switches stay disabled.

Local tests and GitHub CI check implementation behavior. They are not real payments or evidence
that financial processing works. A healthy infrastructure check also does not prove successful
account recovery, support handling, data restoration, or completion of every product feature.

## Remaining operational evidence

Before calling the non-financial service ready for general users, retain current evidence for
account recovery/email delivery, a backup and isolated restore exercise, and the intended device
reconnect/restart behavior. Earlier screenshots or
historical test results must not be substituted for current evidence. Record any unavailable
service-plan feature or required external approval explicitly instead of silently enabling a
paid service or claiming the work is complete.

Use the [recovery readiness checklist](recovery-readiness.md) to record scope, approvals,
acceptable recovery limits, and actual exercise results. Completing documentation does not
constitute a backup or a successful restore.
