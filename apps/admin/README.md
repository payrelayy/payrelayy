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

The same authenticated Owner page also manages the receiving account for exactly `telebirr` and
`cbe_birr`. The Owner enters the provider's official receiver name and the complete digits-only
wallet/account number in the browser; the server immediately creates a provider-separated
AES-256-GCM envelope, keyed fingerprint, and `***last4` mask before calling PostgreSQL. The API and
database never return the complete number, ciphertext, or fingerprint. Each change creates a new
immutable revision and retires the old revision at the exact new activation timestamp, so receipt
history is never rewritten. Rotation is rejected unless all payment, provider, pilot, and execution
switches are disabled and no draft/armed pilot uses that provider. The existing provider-neutral
master files are reused only after their immutable key-profile identity is verified; receiver
encryption and fingerprint keys are derived under a separate receiver-account/provider domain.

Use `GET /v1/owner/receiver-accounts` to render the redacted revision history and
`POST /v1/owner/receiver-accounts/rotate` only through the same-origin dashboard. The mutation
requires exact JSON, `x-fetanagent-owner-csrf: owner-receiver-rotation-v1`, a matching UUID-v4
`x-idempotency-key`, and the explicit confirmation. Never paste a receiver number into chat, Git,
terminal history, screenshots, logs, or an ad-hoc SQL command. This control plane configures
receiver identity only; it does not create a provider profile, verify a payment, arm a pilot, enable
a switch, or authorize KemerBet execution.

The private live-pilot API exposes exactly five additional Owner operations: prepare one exact
five-Player manifest, recover the current open manifest without copying its UUID, arm that manifest
in `dry_run`, read an aggregate redacted status, and stop it. Mutations accept only exact JSON from
the approved Owner origin (or the SSH loopback origin),
require the explicit `x-fetanagent-owner-csrf` header, and bind `x-idempotency-key` to the JSON
request ID. The only callable preparation routine hard-codes the approved first-run policy:
TeleBirr only, five current KemerBet Players, 25 ETB per deposit and Player, 125 ETB aggregate, five
immutable reservations, and exactly two hours. PostgreSQL derives the submitting-customer set from
the selected Player owners and rechecks that derivation after the canonical preparation locks. The
generic amount/provider/customer preparation routine is not callable by the Owner runtime.

The same-origin Owner dashboard renders the eligible Player selector, fixed-policy confirmation,
redacted current status, dry-run-only arm, and an emergency stop. The current-status route makes the
stop recoverable after a page reload without browser storage or a copied pilot UUID. The access
token remains only in JavaScript memory; do not extract it or use ad-hoc `curl`/browser-console
calls, and do not paste Player IDs into terminal history, logs, screenshots, or chat. The startup
catalog preflight rejects any missing control routine, additional callable app routine, or direct
app relation privilege. None of these controls can make provider verification, settlement,
execution, or a KemerBet final action live.

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
