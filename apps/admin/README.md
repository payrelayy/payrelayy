# Owner/Admin control service

This package contains narrow Owner-only backend operations: issue or revoke a Telegram beta invite,
and record a non-claiming KemerBet Player-ID existence review. It also serves a small private
staging page at `/owner`; it is not a general dashboard
and it has no browser database grant. The page signs in directly to the exact staging Supabase Auth
project with the public publishable key, keeps the access token only in JavaScript memory, and sends
that bearer token to the loopback-only Owner service. It never stores a password, access token,
service-role key, or database credential in browser storage. A rotating refresh token and the fixed
twelve-hour deadline are stored only in same-tab session storage; sign-out or closing the tab
removes them.

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

The Owner page also exposes one credential-free KemerBet browser-profile control. `GET
/v1/owner/kemerbet-agent-profiles` returns only redacted immutable revision facts, and `POST
/v1/owner/kemerbet-agent-profiles/prepare` creates a server-generated opaque
`platform_agent_accounts` reference while retiring the prior active profile. The mutation requires
exact JSON, a matching UUID-v4 idempotency key, the same-origin
`x-fetanagent-owner-csrf: owner-kemerbet-agent-profile-v1` header, and explicit Owner confirmation.
It is rejected unless all payment/provider/pilot/execution switches are disabled and no draft or
armed pilot exists. The form has no field for a KemerBet agent ID, username, password, OTP, cookie,
session export, or balance. Preparing this record does not sign in to KemerBet, start polling, click
Transfer, enable the executor, or move money; those remain separate supervised provisioning and
readiness phases.

After the separately reviewed staging sign-in service is started, the same Owner page exposes a
ten-minute private browser preview through `GET /v1/owner/kemerbet-session` and exact start, input,
and stop mutations. Every request is re-authenticated as the active Owner and rebinds to the one
active opaque KemerBet profile. The browser runs in a separate UID-10001 container with no database
URL, Supabase key, Player-ID list, selector contract, HMAC key, pilot manifest, executor lease, or
final-action authority. Owner and browser share only a mode-`0600` Unix socket volume. The browser
always aborts the exact KemerBet deposit endpoint; after `/agents` is reached it refuses all further
input and all non-read network requests. Its persistent private volume retains KemerBet's own
signed-in browser session, but the Owner API and logs never receive a password, OTP, cookie, session
export, agent identity, or balance as structured data. Stop the transient browser immediately after
the dashboard reports `KemerBet signed in`; the persistent profile remains for the later no-transfer
readiness probe.

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
stop recoverable after a page reload without persisting or copying the pilot UUID. The access token
remains only in JavaScript memory; do not extract it or use ad-hoc `curl`/browser-console calls, and
do not paste Player IDs into terminal history, logs, screenshots, or chat. The startup catalog
preflight rejects any missing control routine, additional callable app routine, or direct app
relation privilege. None of these controls can make provider verification, settlement, execution,
or a KemerBet final action live.

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

The runtime remains disabled by default. Its staging container binds only to host loopback; the
reviewed public Caddy boundary may proxy the authenticated `/owner` page but exposes neither the
Unix socket nor the transient browser container. The current page remains private to the Owner, is
not a customer-facing PWA, and keeps English-only interface and validation copy.

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
