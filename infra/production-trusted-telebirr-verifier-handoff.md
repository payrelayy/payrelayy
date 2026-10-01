# One-use production verifier image handoff

This operation replaces only the image of the already-active trusted TeleBirr verifier. The
old activation and credential remain unchanged, as do the pilot, feature switches, payment
records, queue, and settlement state. It does not grant authority to retry a receipt. The
previous standby smoke proves only inert startup; it does not prove a receipt will pass.

Use this runbook only for one explicitly approved handoff of the exact standby image already
loaded and smoke-tested on the production host. First merge and verify the reviewed handoff
helper on exact `main`. The host administrator separately checks its digest and installs it as
root at the script's fixed path. It has no sudoers grant or general deploy capability. Do not
change the original verifier helper or credential. Never invoke its `stage-disabled` mode on an
active verifier: that mode deliberately calls `emergency-stop`.

Before the single handoff, run
`infra/sql/production-trusted-telebirr-verifier-handoff-inspect.sql` read-only and require:

- zero eligible staged observations on both the active and historical loaders;
- one armed pilot with at least 30 minutes remaining, the current activation present, the
  bounded verifier login valid for 30 more minutes, one expected verifier session and no
  unexpected verifier session;
- zero executor sessions and logins, the four existing verification switches live, and the
  three unrelated financial switches disabled.

Record the staged, outcome, and quarantine row counts privately. Run the helper's `preflight`
for the exact smoke-tested image; it must confirm a single healthy original verifier, an exact
credential/release binding, the pinned Compose file, and the successor image. Repeat the
database preflight immediately before the handoff. If any guard changes or a new candidate
appears, do not start the handoff. Do not submit or solicit a payment while it runs.

Invoke `handoff` exactly once. It uses the shared production and verifier locks and asks
Docker Compose to gracefully recreate that one service with the already-loaded image. Its
fixed gates, pin manifest, CA, and database credential remain identical. It waits for one
healthy successor and writes a one-use, root-only image marker. If startup fails, it attempts
to restore the original image once. If that cannot be proven, it attempts the existing host
emergency stop; independently revoke the verifier database login and live authority through
the established emergency workflow. There is no automatic retry of the handoff or a receipt.

After a reported success, run `status` and the same database inspection. Require one healthy
successor, one expected verifier session, zero executor sessions/logins, zero loader candidates,
unchanged switches, and unchanged staged, outcome, and quarantine counts. The old active record
still names the original activation, so use this handoff helper's `status` rather than the old
helper's image-specific `status-active`. The original image and release remain available for
the one bounded rollback path; this operation does not enable KemerBet or move money.
