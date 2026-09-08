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
and rolls back a failed activation. A finalized release is not a general-purpose database
rollback; never restore a database as a routine application-restart step.

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
