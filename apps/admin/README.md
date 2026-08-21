# Owner/Admin control service

This package contains narrow Owner-only backend operations: issue or revoke a Telegram beta invite,
and record a non-claiming KemerBet Player-ID existence review. It also serves a small private
staging page at `/owner`; it is not a general dashboard
and it has no browser database grant. The page signs in directly to the exact staging Supabase Auth
project with the public publishable key, keeps the access token only in JavaScript memory, and sends
that bearer token to the loopback-only Owner service. It never stores a password, refresh token,
access token, service-role key, or database credential in browser storage.

The service verifies the bearer token with the exact staging Supabase Auth project, derives the
Auth user ID from that verified response, and passes it to private database procedures. The
database independently requires that subject to map to the one active Owner.

The private live-pilot API exposes exactly four additional Owner operations: prepare one exact
five-Player manifest, arm that manifest in `dry_run`, read an aggregate redacted status, and stop
it. Mutations accept only exact JSON from the approved Owner origin (or the SSH loopback origin),
require the explicit `x-fetanagent-owner-csrf` header, and bind `x-idempotency-key` to the JSON
request ID. Prepare uses its UUID-v4 request ID as the durable database key; arm and stop use the
immutable pilot UUID. The startup catalog preflight rejects any missing control routine, additional
callable app routine, or direct app relation privilege. These routes do not make provider,
verification, execution, or pilot switches live, and no Player ID, customer ID, receiver detail,
payment reference, proof, or credential appears in their status response or logs.

These four routes are currently API-only: the existing Owner dashboard does not expose pilot
controls. Do not extract its in-memory bearer token or use ad-hoc `curl`/browser-console calls, and
do not paste Player IDs or customer UUIDs into terminal history, logs, screenshots, or chat. Before
any pilot can be provisioned or armed, add and review a same-origin dashboard client for the exact
prepare/status/dry-run-arm contract plus an always-available emergency stop that never displays or
copies the bearer token. The exact request headers, confirmations, idempotency binding, and stop
reason allowlist are documented in `docs/private-live-money-pilot.md`.

The raw 32-byte invite token is generated in process, returned once in a `Cache-Control: no-store`
Telegram deep link, and discarded. PostgreSQL stores only its domain-separated SHA-256 digest;
audit metadata contains only the opaque invite ID, expiry, or allowlisted revocation reason. The
service never receives a caller-supplied admin/actor ID and never uses a Supabase service-role key.

The Player-ID queue is bounded and returns raw submitted IDs only to the authenticated Owner page
inside the SSH tunnel. Review decisions use fixed reason codes and append-only audit records that
never contain the raw Player ID. "Found" means existence only: it does not establish customer
ownership, create a validated player binding, enable a deposit, or contact KemerBet automatically.

The ownership-confirmation action records only the customer-to-player association and never grants
deposit eligibility automatically. Financial eligibility is isolated in the private, append-only
`app.player_deposit_eligibility_decisions` ledger, and new intents must snapshot its latest
`eligible` decision. The service exposes the only reviewed decision route and UI: an authenticated
active Owner may explicitly approve or revoke an already associated KemerBet Player ID. The command
has no direct table grant, is serialized with new intents, writes fixed reason codes and safe audit
metadata, and does not open a deposit, change a feature switch, call KemerBet, or move money.

The runtime remains disabled by default. Its staging container binds only to host loopback for an
SSH-forwarded operator session; there is no public proxy or Internet-facing Owner endpoint. The
current page remains private to the Owner, is not a customer-facing PWA, and keeps English-only
interface and validation copy.

After the reviewed page is deployed, open it only through an SSH local-forward from the approved
operator workstation:

```text
ssh -N -L 3002:127.0.0.1:3002 codex-swift-reef-6a36
```

Then browse to `http://127.0.0.1:3002/owner`. The browser-to-Supabase sign-in request is HTTPS; the
browser-to-VM Owner API path stays inside the encrypted SSH tunnel. Do not expose port 3002 on the
VM firewall or add a public proxy.

Do not add a locale preference or language selector to Owner/Admin accounts in version 1.
`display_name` remains identity data and may use the administrator's own language; it is not
interface copy.
