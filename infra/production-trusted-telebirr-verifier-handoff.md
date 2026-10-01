# One-use production verifier image handoff

This operation replaces only the image of the already-active trusted TeleBirr verifier. The
old activation and credential remain unchanged, as do the pilot, feature switches, payment
records, queue, and settlement state. It does not grant authority to retry a receipt. The
previous standby smoke proves only inert startup; it does not prove a receipt will pass.

## One-use public device-pin correction after an image handoff

The same helper supports a separately reviewed `pin-preflight`, `pin-handoff`, and `pin-status`
operation when a newly paired phone has a different public key from the immutable release's
device pin. This public-key-only update does not change the original release, credential, signer
pin, activation, pilot, feature switches, payment lineage, or verifier image. It grants no
authority to retry a payment or accept a quarantined observation.

Before staging the candidate, independently compare the current, unrevoked enrollment with its
completed pairing challenge and the most recent assignment. Require the same device key ID and
public-key digest in all three, an intact public-key digest calculation, exactly one eligible
current device, and an unchanged assignment signer. Do not select a key by recency alone. Create
canonical JSON with exactly one unchanged assignment-signer pin and one current device pin. The
file contains public keys only. Review its SHA-256 digest and the current device SPKI digest
independently. Stage it as root-owned mode `0444` at the helper's fixed
`device-pin-handoff-manifest.v1.json` path inside the protected verifier state directory. Never
overwrite the immutable release pin file or the runtime credential's pin binding.

Run `infra/sql/production-trusted-telebirr-verifier-handoff-inspect.sql` immediately before
`pin-preflight` and again just before the
single `pin-handoff`. Require zero active and historical loader candidates, exactly one armed pilot
with at least 30 minutes remaining, one expected verifier session, no unexpected verifier or
executor session/login, four verification switches live, and three unrelated financial switches
disabled. Require no payment instruction or observation being dispatched during the swap. Record
staged, outcome, and quarantine counts privately. The helper's pin preflight additionally proves
the prior image handoff marker, one healthy verifier, the original pin mount, the unchanged signer
pin, a different device pin matching the independently confirmed SPKI digest, and valid Compose.

Invoke `pin-handoff` exactly once with the exact image commit, canonical manifest digest, and
device SPKI digest. It recreates only the verifier service with the same image and credential and
the new public pin. On a failed health or mount check it attempts one rollback to the original
release pin; if rollback cannot be proven it attempts the host emergency stop and the operator
must independently revoke database authority through the existing emergency procedure. Never
retry automatically. After success, require `pin-status`, the same database inspection, one
healthy verifier session, unchanged switches, and unchanged staged/outcome/quarantine counts.
The one-use marker and protected override file remain for audit; future releases must pin the
current key explicitly instead of silently inheriting this override.

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
