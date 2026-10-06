# Non-pilot TeleBirr proof foundation

This is the first inert database slice toward routine, non-pilot TeleBirr deposits. It adds a
separate append-only table for an **untrusted, amount-free candidate reference** and a chosen
KemerBet Player account. It does not reuse historical dry-run proofs, five-Player pilot proofs,
shadow-verifier jobs, or the routine execution broker's verified-job binding.

The table has forced RLS, no policies, and no table grant to the API, Telegram Player-actions
runtime, customer web, Android verifier, routine broker, executor, `anon`, `authenticated`, or
`service_role`. The follow-on private `capture_telegram_routine_telebirr_untrusted_proof` RPC
validates an admitted private Telegram origin, current KemerBet Player eligibility, a protected
TeleBirr reference, an active protected receiver, no-money switches, event exclusivity, exact
replay, and per-identity storage abuse bounds. It is **not granted to any application role** and
has no deployed API/Bot route or reader; its SQL boundary is exercised in disposable SQL tests,
while the default-off routing code is covered by unit tests. It cannot create a
provider observation, payment claim, deposit intent, verification or execution job, settlement,
or KemerBet action. No financial switch, role login, device enrollment, or production overlay is
changed.

Each future record must retain the server-resolved submitting customer and identity, channel and
one-use request key, the selected Player and eligibility-decision identifiers, and a protected
TeleBirr candidate reference. It contains no customer-entered or trusted amount and no receiver
snapshot: both principal and applicable immutable receiver revision must come later from a fresh
official receipt and its occurrence time. Candidate fingerprints are **not globally unique at
intake**; only an authoritative verified payment may win the one-use claim. The table cannot be
interpreted as proof of payment.

The TypeScript candidate adapter accepts only synthetic `FETANTEST...` references in staging
dry-run configuration. It prepares encrypted/fingerprinted input and a domain-separated semantic
HMAC for the private RPC, then returns a token-free, explicitly no-money projection. The
Player-action runtime selects this path only with the explicit, default-off
`TELEGRAM_ROUTINE_TELEBIRR_CANDIDATE_STAGING_ENABLED` gate. When selected, a rejected candidate
never falls back to the shadow or live proof path. The runtime role still has **no EXECUTE grant**
on the RPC, so this code-only route cannot yet store a candidate in a deployed environment. If
the gate is enabled prematurely, the exact-function catalog preflight fails readiness. The Bot
knows how to render the projection, but no deployed route can produce it. This is a guarded
integration slice, not a customer intake or payment test.

## Untrusted-candidate active-database retention

The owner-chosen retention boundary makes a candidate eligible for **whole-row deletion after 7
days**. A postgres-owned database Cron job runs every 15 minutes and removes at most 1,000 due
rows per run, oldest first. The append-only guard still rejects update and truncate, all deletes
by application roles, and deletes of younger rows even by the privileged database owner. The
postgres owner can delete due rows directly, but the fixed-batch maintenance function is the
scheduled path; no application role may execute it. This includes the API, Bot, customer web,
verifier, executor, nonce-retention role, `anon`, `authenticated`, and `service_role`. It does not
read payment receipts or alter financial state. The seven-day cutoff
applies only to untrusted candidates, not verified payment or financial records. It is an owner
choice for this technical boundary, not a legal-retention determination.

The active-database deletion is **not an immediate erasure from historical backups or WAL/PITR**.
Those copies follow the actual Supabase backup/recovery settings. Before customer intake is wired,
verify the retention job runs successfully, alert on overdue rows and failed runs, confirm the
actual backup retention, and ensure future verified financial lineage does not depend on a
candidate row surviving past the cutoff. A Cron failure or backlog can delay deletion beyond 7
days; do not call this an exact seven-day erasure guarantee.

The next reviewed slices must, in order:

1. Verify scheduled purge health and the backup caveat, restore staging database connectivity,
   and prove the gated API/Bot route against disposable PostgreSQL before granting only the exact
   RPC in staging. The route gate must stay off until that grant and readiness checks are
   reviewed; production keeps the RPC ungranted. No table or financial grant is authorized. Customer web
   can follow under its own authenticated receipt.
2. Introduce a non-pilot Android enrollment, assignment, and signed-observation protocol that is
   domain-separated from every pilot certificate and manifest. The Android/TypeScript routine
   pairing proof now signs and verifies device key possession against a separately trusted,
   short-lived challenge. An authenticated Owner-only API can issue the routine challenge against
   the active protected receiver while every financial switch is disabled. The Owner-mediated
   proof endpoint independently reads that challenge, verifies the Android P-256 signature and
   exact receiver binding, then invokes a private transaction that consumes the challenge and
   inserts one routine-only enrollment. The database transaction rechecks Owner status, proof
   window, active receiver, one-use evidence identity, and all seven disabled money switches.
   The private SQL function does **not** verify ECDSA by itself: only the trusted Owner service
   may call it, and its database credential must never be exposed to the phone or browser.
   The Owner page now exposes an authenticated manual challenge/proof handoff. The dedicated
   Android app, while its existing operational build is stopped, signs with a separate routine
   Keystore key and puts a four-minute proof on the clipboard only after an explicit tap. The
   phone makes no routine network request and cannot enroll itself. The Owner challenge remains
   one-use and may stay fresh for twelve hours, giving the Owner time to complete the direct
   handoff. The proof must return to the same Owner tab before its own short expiry; a longer
   challenge does not extend the proof or grant any authority. Transfer both values directly
   between the Owner page and phone, never through Telegram, email, chat, screenshots, or logs.
   If an enrollment response is lost, the Owner service may reread a still-fresh consumed challenge
   only when its exact enrollment exists; it re-verifies the same Android signature and the atomic
   SQL enrollment function returns only the exact replay. A different proof or device is rejected.
   The Owner page keeps the proof only in memory until success or expiry and never stores it in
   browser session storage. A phone proof is not an enrollment certificate. A follow-on
   contract-only slice defines a domain-separated, server-signed routine enrollment receipt and
   verifies the exact enrollment, phone key, receiver revision, no-money flags, signer, and
   validity window in both TypeScript and Android. The Android app seals its exact pending proof
   in a separate Keystore-protected, no-backup record so an app restart can recover the same
   still-fresh proof; it can store a signed receipt only after cryptographic verification against
   independently trusted signer material and that pending proof. This slice provisions no signer,
   issues no receipt, accepts no receipt in the UI, and adds no polling or network call. The
   remaining work is guarded signer enrollment and issuance, Owner-to-phone receipt delivery,
   revocation handling, and a protected observation transport. Neither issuer nor enrollment
   can call a provider.
   Keep the phone observation-only and the financial switches disabled.
   If releasing this slice to production, deploy the updated Owner image first in a reviewed
   no-money runtime mode compatible with the current deployment: its catalog preflight tolerates
   the new proof functions being absent. Only after that image is healthy should the canonical
   migration grant the new Owner functions. The previous Owner image has an exact function-count
   preflight and must not see the new grants first. The proof route returns unavailable until the
   migration exists; do not use a direct SQL grant or enable a money switch to make it pass.
3. Convert an exact fresh official observation into immutable receipt facts, receiver-revision
   match, amount, global one-use claim, settlement, and a queued routine execution job in one
   guarded transaction. Recheck destination eligibility and all live gates at each boundary.
4. Run synthetic and disposable-Postgres tests, no-money end-to-end verification, incident-stop
   and recovery drills, then review production readiness before enabling any financial switch or
   starting the Windows Automatic Deposits launcher.

Until these slices pass, the production routine endpoint stays dormant, its login remains
`NOLOGIN`, and the old pilot remains stopped. A connected phone or merged execution code does not
substitute for this missing proof-to-job lineage.
