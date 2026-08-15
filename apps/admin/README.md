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

The raw 32-byte invite token is generated in process, returned once in a `Cache-Control: no-store`
Telegram deep link, and discarded. PostgreSQL stores only its domain-separated SHA-256 digest;
audit metadata contains only the opaque invite ID, expiry, or allowlisted revocation reason. The
service never receives a caller-supplied admin/actor ID and never uses a Supabase service-role key.

The Player-ID queue is bounded and returns raw submitted IDs only to the authenticated Owner page
inside the SSH tunnel. Review decisions use fixed reason codes and append-only audit records that
never contain the raw Player ID. "Found" means existence only: it does not establish customer
ownership, create a validated player binding, enable a deposit, or contact KemerBet automatically.

The legacy ownership-confirmation action records only the customer-to-player association. It no
longer claims or grants deposit eligibility. Financial eligibility is isolated in the private,
append-only `app.player_deposit_eligibility_decisions` ledger, and new intents must snapshot its
latest `eligible` decision. This service has no decision-writing route, adapter, procedure grant,
or UI; no decision is seeded or promoted by an ownership association, so the new guard remains a
fail-closed financial quarantine rather than an operational deposit capability.

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
