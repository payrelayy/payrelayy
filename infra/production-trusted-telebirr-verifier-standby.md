# Production trusted TeleBirr verifier standby check

This is **not a live handoff**. It permits an exact-main verifier image to be loaded on the
production host and started once with no network, database credential, pin manifest, assignment,
or activation input. The startup must fail closed with its fixed message. The already-running
verifier is checked healthy before and after and is never stopped or recreated. No staged evidence,
receipt, payment, deposit queue item, or financial switch is read or changed by this check.

The normal `stage-disabled` verifier workflow must not be used while a live verifier is active:
its staging step deliberately invokes `emergency-stop`. This standby workflow exists so an image
can be checked without causing that stop. It does not authorize a subsequent production start,
and its loaded image has no database credential or runnable service configuration.

## Reviewed setup

The host administrator must review and install the exact
`fetanagent-production-trusted-telebirr-verifier-standby-helper.sh` as root at the path declared
inside the script, and install the matching digest-pinned `.sudoers` file only after
`visudo -cf` succeeds. This is an explicit manual host setup, not performed by the workflow.
It is a separate helper, so the installed active-verifier helper, its sudoers digest, its
runtime credential, and its emergency-stop route are unchanged.

Run `Production trusted TeleBirr verifier standby smoke` from the exact reviewed `main` commit
with the four exact inputs requested by the workflow. It independently requires the latest
successful exact-main push checks, builds a sealed ingress-free image, transfers only its Docker
archive through pinned SSH, and asks the helper to load it and run one network-free, read-only,
disabled-gate startup probe. The helper uses the shared production operation lock, validates the
archive digest and image metadata, and checks that the same healthy live verifier container is
still present afterward. The archive and runner-local SSH material are removed. The loaded
standby image remains unused on the host for a later reviewed operation.

A failed or ambiguous standby run must not be retried automatically. Inspect the active verifier
and financial boundary before any follow-up. The standby helper cannot activate verification,
connect to Supabase, stop the live container, or perform a handoff. A separate reviewed cutover
design and explicit production authorization are required to replace the live process without
replaying an old receipt.
