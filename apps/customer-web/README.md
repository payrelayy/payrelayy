# FetanAgent customer web

This Fastify application renders the responsive FetanAgent account surface. Supabase session work
is isolated behind `CustomerWebAuthPort`; customer and Player-ID work is isolated behind the
separate `CustomerWorkspacePort`. Route tests use fake ports and make no network or live database
calls.

## Security boundary

- Account and workspace responses are private and `no-store`.
- Every form mutation requires the exact configured origin, `Sec-Fetch-Site: same-origin`, and a
  matching host-only double-submit CSRF cookie. Production configuration accepts only HTTPS. The
  explicit product-preview option permits HTTP only on exact `127.0.0.1` so its deterministic GET
  pages can render locally; it does not relax mutation origin or CSRF validation.
- Authentication responses own session-cookie semantics. The application preserves every ordered
  cookie effect without logging credentials, sessions, or recovery codes.
- Recovery links are redirected immediately to a clean URL. The one-time code is held for at most
  ten minutes in a Secure, HttpOnly, host-only cookie and is deleted on every password-update
  attempt.
- The service worker caches only fixed public assets and the offline page. It does not cache
  navigations or form submissions.
- Workspace access uses only the Auth UUID returned by the server-side `auth.getUser()` check. No
  browser-supplied Auth UUID, customer UUID, or internal database record UUID is accepted.
- The Player-ID form carries one server-generated UUIDv4 idempotency key. The key is never returned
  by the database, and every database result is reduced to `Checking`, `Ready`, or
  `Could not confirm` before rendering. `Ready` additionally requires the aligned active/valid
  association and platform plus a contiguous latest `eligible` decision with a current player-state
  snapshot; missing, revoked, stale, future-dated, or malformed eligibility stays `Checking`.
- The direct-Postgres package has a max-one pool and an exact startup catalog preflight. HTTP
  readiness reuses that result for 30 seconds and coalesces concurrent refreshes so probes cannot
  occupy the only application connection repeatedly.
- The pure `@fetanagent/customer-web-player-ownership-proof-prerequisite` package is not imported by
  this application and is not a permission switch. Its only valid result is
  `blocked / customer_web_player_ownership_proof_prerequisites_incomplete`; it cannot represent a
  positive proof, association, `Ready`, or deposit eligibility. Contract version 2 preserves all
  19 false capabilities and records the absent financial promotion boundary.
- The separate private eligibility ledger is not reachable from this application. New deposit
  intents require a latest explicit `eligible` decision, but this app has no decision route,
  procedure grant, table access, UI, or financial runtime capability.
- Deposit reference entry is handled only by the authenticated server-side BFF. The browser sends
  the raw value over its CSRF-protected same-origin form; the BFF immediately normalizes, masks,
  fingerprints, and encrypts it, and only those protected fields cross the PostgreSQL boundary.
  Deposit status renders through the shared customer-safe projection and exposes no submission,
  verification, agent-account, execution-attempt, or external-reference identifier.

## Deployment gate

This slice deliberately uses `trustProxy: false` and a bounded in-process limiter keyed by the
direct peer address and route. Before placing it behind a proxy or running more than one instance,
deployment must define and test the exact trusted-proxy chain, derive the client address only from
that chain, and replace the local limiter with a shared fail-closed limiter. Do not enable the
public route until those deployment controls are reviewed.

Runtime composition requires:

- `INTERNAL_CUSTOMER_WEB_AUTH_RUNTIME_ENABLED=true`;
- `CUSTOMER_WEB_SUPABASE_URL=https://spzpiyxheappsfyswewl.supabase.co` exactly;
- `CUSTOMER_WEB_SUPABASE_PUBLISHABLE_KEY` set through the existing secret-delivery boundary; and
- `INTERNAL_CUSTOMER_WEB_WORKSPACE_RUNTIME_ENABLED=true`;
- `CUSTOMER_WEB_DATABASE_URL_FILE=/run/secrets/customer_web_database_url` in production, containing
  only the dedicated `fetanagent_customer_web_runtime` direct-Postgres URL for the exact staging
  host with `sslmode=verify-full`; and
- `INTERNAL_CUSTOMER_WEB_DEPOSIT_RUNTIME_ENABLED=true` plus
  `CBE_DEPOSIT_REFERENCE_ENCRYPTION_SECRET_FILE`,
  `CBE_DEPOSIT_REFERENCE_FINGERPRINT_SECRET_FILE`, and
  `CBE_DEPOSIT_REFERENCE_KEY_PROFILE_FILE` at their fixed production paths when the
  protected-reference deposit routes are composed. The same profile and two keys must be mounted
  into the API and future authoritative verification worker; every process verifies the approved
  nonsecret key fingerprints before readiness; and
- optional `CUSTOMER_WEB_PORT` (defaults to loopback port `3003`).

The workspace runtime can execute only these exact functions after its catalog preflight:

- `app.ensure_customer_web_account(uuid)`;
- `app.submit_customer_web_player_registration(uuid,uuid,text)`; and
- `app.list_customer_web_player_registrations(uuid,integer)`;
- `app.open_customer_web_deposit_intent(uuid,uuid,text,bigint)`;
- `app.capture_customer_web_deposit_reference(uuid,uuid,uuid,text,text,text,smallint)`; and
- `app.list_customer_web_deposits(uuid,integer)`.

It has no table, sequence, schema-create, or unrelated function capability. Deposit mutations still
fail closed unless `payment_verification`, `deposit_execution`, and
`cbe_birr_authoritative_verification` are all locked at `live`; the last switch is created disabled,
and this repository does not provision an authoritative CBE Birr verification worker or credential.

The ownership-proof prerequisite adds no route, page, form, button, environment variable, database
object, role, runtime composition, provider adapter, network call, or deployment wiring. No
authoritative proof source, challenge, delivery path, or evidence protocol is selected. The
application continues to submit and list non-claiming requests only; the database continues to
reject web-origin ownership association. The separate financial ledger has no promotion path, so
`Ready` remains unreachable and ownership could not silently enable deposits even if later proven.
The list projection is advisory display only; the deposit-intent trigger remains the independent
financial authorization boundary.

## Local product preview

`pnpm --filter @fetanagent/customer-web preview:product` starts the deterministic loopback product
preview. Open `http://127.0.0.1:4173/preview/dashboard` for the complete customer workspace or
`http://127.0.0.1:4173/preview/telegram` for the matching planned Telegram interaction.

The preview includes Dashboard, Deposits, Player IDs, Activity, and Account. The deposit walkthrough
uses the normal 25 to 25,000 ETB policy and a Ready Player ID, then shows review, masked CBE Birr
instructions, reference entry, payment checking, deposit preparation, and customer-safe outcome
states. Every interactive result is explicitly marked Preview. It is deterministic and never calls
PostgreSQL, KemerBet, Supabase, Telegram, or another network service.

The database migration deliberately leaves `fetanagent_customer_web_runtime` as `NOLOGIN` with no
password. A separate reviewed role-and-secret provisioning phase must enable that runtime login and
deliver its URL secret; a separate reviewed Compose/Caddy phase must deploy and route the service.
The URL configuration above cannot make this slice live on its own.

This slice does not add or change Compose, Caddy, DNS, firewall rules, deployment secrets, or live
routing. Those remain separate reviewed deployment work.
