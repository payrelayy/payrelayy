# FetanAgent customer web

This Fastify application renders the responsive FetanAgent account surface and delegates account
operations to an injected `CustomerWebAuthPort`. Route tests use a fake port; they make no network
or database calls.

## Security boundary

- Account and workspace responses are private and `no-store`.
- Every form mutation requires the exact public origin, `Sec-Fetch-Site: same-origin`, and a
  matching host-only double-submit CSRF cookie.
- Authentication responses own session-cookie semantics. The application preserves every ordered
  cookie effect without logging credentials, sessions, or recovery codes.
- Recovery links are redirected immediately to a clean URL. The one-time code is held for at most
  ten minutes in a Secure, HttpOnly, host-only cookie and is deleted on every password-update
  attempt.
- The service worker caches only fixed public assets and the offline page. It does not cache
  navigations or form submissions.

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
- optional `CUSTOMER_WEB_PORT` (defaults to loopback port `3003`).

This slice does not add or change Compose, Caddy, DNS, firewall rules, deployment secrets, or live
routing. Those remain separate reviewed deployment work.
