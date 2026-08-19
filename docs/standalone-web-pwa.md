# Standalone responsive web/PWA product boundary

## Settled product direction

FetanAgent's canonical customer product is a standalone, responsive website and installable
progressive web app at the public FetanAgent domain. A customer may create and use a FetanAgent
account through the intended self-service email-and-password flow without Telegram. Email ownership
confirmation is requested only during forgot-password recovery, not during account creation or
routine sign-in. The same generic public sign-in leads to a neutral workspace; URLs and
customer-visible copy must not reveal internal `Owner`, `Admin`, or manual-verification roles.

The product is English-only. A customer may associate multiple KemerBet Player IDs and must choose
the intended association for each transaction. Telegram is optional and may be used only through a
controlled legacy-history link. It is not required for sign-in, recovery, deposits, withdrawals, or
support.

## Current implementation status

These are product decisions, not claims about deployed capability. The repository now contains a
disabled-by-default `apps/customer-web` SSR/PWA foundation with the canonical public account pages,
responsive workspace shell, public-assets-only service worker, self-service email/password flow,
server-validated Auth handling, sign-out, forgot-password recovery, and customer Player-ID
submit/list pages. A dedicated `@fetanagent/customer-web-workspace-runtime` connects the server-side
BFF directly to PostgreSQL for exactly three private account/Player-ID functions; the browser has no
database access. The slice is not wired into Compose, Caddy, DNS, firewall rules, production secrets,
or live routing. It has no Player-ID ownership proof, validated association, deposit eligibility,
Telegram-history link, or financial capability. Its workspace is customer-only; capability-based
staff routing through the generic public entry remains unimplemented.

The pure `@fetanagent/customer-web-player-ownership-proof-prerequisite` package records the dormant
next boundary. No authoritative KemerBet proof source, challenge, delivery path, evidence protocol,
or positive proof result has been selected. Its only valid decision is
`blocked / customer_web_player_ownership_proof_prerequisites_incomplete`; it does not add an app
route, runtime, database object, role, configuration, infrastructure wiring, association, `Ready`,
deposit eligibility, or financial action. Contract version 3 keeps all 19 capabilities false and
records `owner_deposit_eligibility_decision_required` as the ninth blocker.

A separate private eligibility ledger now prevents ownership association from being sufficient for
new deposit intents. Every new intent must snapshot the latest explicit `eligible` decision, but no
seed, backfill, promotion procedure, writer grant, route, UI, or runtime can create such a decision.
This is a financial quarantine only; it does not add proof, `Ready`, deposit UI, provider access, or
financial runtime capability.

The existing Telegram admission, `/owner` route, `Owner/Admin` labels, `pending validation` copy,
and manual Player-ID review wording are implementation history and private staging behavior. They
must not be presented as the settled customer experience. No financial, recovery, linking, or
session capability becomes enabled merely because this product boundary is documented.

The pure `@fetanagent/customer-web-access-foundation` package remains a historical, fail-closed,
non-runtime product-decision record. Its advisory `customer_web_access_runtime_not_implemented`
result and 23 literal-false capabilities describe that package only; it is not imported as a
permission switch and does not configure or enable either implemented customer runtime.

## Canonical information architecture

The public surface uses role-neutral paths and page metadata:

- `/` for public FetanAgent information;
- `/sign-in` for one generic sign-in and forgot-password entry point;
- `/create-account` for FetanAgent customer account creation; and
- `/workspace` for the authenticated application.

The server, not a URL or client-side flag, resolves the authenticated account's capabilities. Team
accounts are provisioned through a controlled internal process; the public form does not offer a
role selector. Customer and team authorization remains server-side on every read and mutation.

The customer workspace uses these primary destinations:

- `Home`
- `Player accounts`
- `Deposit`
- `Withdraw`
- `Activity`
- `Support`
- `Settings`

The team workspace may expose `Overview`, `Work queue`, `Customers`, `Player accounts`, `Deposits`,
`Withdrawals`, `Team`, `Settings`, and `Audit` according to server-side capability. The shared
public route remains neutral even when the authenticated navigation differs.

## Customer account flow

1. The customer creates a FetanAgent account through the intended self-service email-and-password
   flow. Account creation does not request email ownership confirmation.
2. The customer signs in with email and password through the generic sign-in page and enters
   `/workspace`. Routine sign-in does not request email ownership confirmation.
3. The customer adds one or more KemerBet Player IDs without supplying a KemerBet password, OTP,
   recovery code, or browser session.
4. Each Player ID remains unusable until a separately reviewed ownership association succeeds and
   a separate financial boundary promotes the player account to current deposit eligibility.
5. Only that combined state may display `Ready`; neither positive boundary exists today.
6. The customer chooses one `Ready` Player ID when starting a deposit or withdrawal.
7. Activity and support remain attached to the FetanAgent account rather than to a browser install
   or Telegram identity.

Finding that a Player ID exists does not prove ownership. A Player ID must not be silently assigned
to multiple customers, and a conflict must not disclose another account. Removal or reassignment
must preserve transaction history and follow a separately reviewed dispute/recovery boundary.

The implemented web flow can ensure the server-verified Auth UUID's immutable customer mapping,
submit a non-claiming KemerBet Player-ID request with a server-generated idempotency key, and list
only that identity's web-origin requests. Its direct-PostgreSQL role can execute only
`app.ensure_customer_web_account(uuid)`,
`app.submit_customer_web_player_registration(uuid,uuid,text)`, and
`app.list_customer_web_player_registrations(uuid,integer)`. Customer statuses are exactly
`Checking`, `Ready`, and `Could not confirm`. The database rejects ownership association for a
web-origin request, so `Ready` is unreachable until a later proof-bearing association boundary is
reviewed and implemented. The list projection also requires an aligned active/valid association,
active platform, and an exact current `eligible` history with a matching player-state snapshot;
missing, revoked, stale, future-dated, or malformed eligibility remains `Checking`. The frozen
prerequisite cannot produce a positive ownership result or an Owner financial decision.
The projection is advisory display only: the private intent guard independently authorizes and
snapshots eligibility, so submit/list does not enable a deposit.

## Optional Telegram legacy-history link

Telegram linking is an optional account-link operation, not authentication. A future link must:

1. begin from an authenticated FetanAgent web/PWA account;
2. issue a short-lived, one-time, opaque linking challenge;
3. prove control of the exact legacy Telegram identity through the separately authenticated bot
   transport;
4. reject reuse, expiry, identity mismatch, existing-link conflict, or cross-customer ambiguity
   without revealing another account;
5. create a controlled link to the legacy history scope without merging identities, reparenting
   customer records, copying financial rows, or creating duplicate history;
6. record an immutable, redacted audit event; and
7. allow optional Telegram messaging to be disconnected without deleting retained account history.

Linked history must remain under its original authoritative records and be exposed only through a
separately authorized projection. The repository does not implement this link. Existing Telegram invite redemption must not be
reinterpreted as web sign-in, forgot-password recovery, or proof that two customer identities are
the same.

## Persistent login and recovery decision

The requested routine customer experience is a persistent login that survives ordinary browser
and installed-PWA restarts. Customers should not receive repeated authentication or step-up prompts
during routine use. The recorded intent is persistence until explicit sign-out or a server-side
security revocation. The intended credential is email plus password. Email ownership confirmation
is requested only for a forgot-password recovery flow, not for self-service account creation,
ordinary sign-in, or every customer action.

That requested behavior is **not deployed or enabled**. The source now implements account creation,
email/password sign-in, current-session sign-out, ordered server-handled Supabase Auth cookie refresh
effects, and a forgot-password flow with enumeration-neutral requests and a short-lived protected
recovery code. Its browser cookie effects commit only after code exchange and password update both
succeed. The absence of step-up authentication must not be mistaken for approval of high-risk
account or financial actions.

The implemented boundary has Secure, HttpOnly, host-only cookies, ordered refresh effects,
cross-site request protection, private/no-store responses, generic errors, and current-session
logout. It does not provide per-device session visibility, remote sign-out, or an explicit global
revocation operation after password recovery. Supabase still owns the underlying refresh-session
lifecycle, so this code must not be described as an infinite session. Persistent must never mean an
irrevocable session or a trusted browser install.

The recovery source uses non-enumerating responses, bounded inputs, and a short-lived recovery code
held in an HttpOnly cookie. The server exchanges that code and then updates the password; browser
cookie effects commit only after both SDK calls succeed. Before public enablement, the hosted
Supabase project must be verified to match the selected account-creation behavior, exact recovery
redirect, and production SMTP configuration. The current in-process limiter must be replaced by a
shared fail-closed limiter behind an exact trusted-proxy chain, and global session revocation and
recovery notification behavior remain explicit follow-up gates. Effective `anon` and `authenticated`
grants, exposed RPC/PostgREST surfaces, and RLS must be audited before issuing any customer principal
in the shared project.

Because account creation does not confirm the email address, mailbox control becomes authoritative
for password recovery only when recovery is requested. Recovery must never auto-link or merge
another identity, and all prior sessions must be revoked before this policy is enabled for
financially relevant use.

The decision against repeated or step-up authentication remains a product requirement. It does not
waive authorization, two-person approval for sensitive team actions, account-change safeguards, or
the rule that an unsafe capability stays disabled.

## Two-person sensitive approvals

Sensitive team actions require two distinct eligible team accounts even though neither approver is
asked for repeated or step-up authentication. The initiator cannot approve the same action. Each
approval must bind to the exact immutable action payload and expire; changing the target, values,
reason, or policy invalidates prior approvals. The final action must recheck both current account
capabilities and all financial safety gates in one authoritative boundary and write an immutable
audit record.

This applies at minimum to team-access changes, recovery exceptions, receiver-account changes,
production-mode activation, payment-confirmation overrides, withdrawal approval, and payout
recording. The repository does not implement this generic approval boundary, so documentation must
not present these sensitive actions as enabled merely because the product selected a two-person
model.

## PWA lifecycle and privacy

Installing or uninstalling a PWA is not an account or security action:

- uninstalling removes the installed app experience but may leave browser cookies and site storage;
- reinstalling may resume a still-valid server session;
- clearing browser data may remove the local session but does not delete the FetanAgent account,
  Player-ID associations, or transaction history;
- `Sign out`, remote session revocation, and `Delete account` are distinct server-side operations;
  and
- an installed PWA is not a trusted device or authentication factor.

The service worker may cache only a versioned public application shell and non-sensitive static
assets. Authenticated pages, API responses, Player IDs, transaction references, receipts, payment
instructions, account data, and operations data must use `no-store`/network-only behavior. Offline
mode must not queue financial or identity actions through background sync; it may show only a
generic offline message.

Push notifications, if separately added, must be opt-in, contain no sensitive lock-screen content,
use revocable device tokens, and tolerate uninstall without assuming that the server receives an
immediate uninstall signal.

## Canonical plain-English vocabulary

Customer-visible terms are:

| Internal or ambiguous term | Customer term                                                | Team term       |
| -------------------------- | ------------------------------------------------------------ | --------------- |
| Owner/Admin                | FetanAgent team                                              | Team member     |
| Owner/Admin dashboard      | Workspace                                                    | Workspace       |
| manual verification        | Being checked                                                | Review required |
| pending validation         | Checking                                                     | Waiting         |
| Player-ID registration     | Add a Player ID                                              | Player request  |
| found / not found          | No direct existence status; show the final association state | Source result   |
| payment claim              | Payment decision                                             | Decision        |
| provider evidence          | Payment information                                          | Source result   |
| job, lease, shadow         | Omit                                                         | Check           |

The customer Player-ID surface uses exactly `Checking`, `Ready`, and `Could not confirm`. `Ready` is
unreachable for a web-origin request. The current proof prerequisite is blocked and has no positive
state, so merely adding that package does not make ownership association possible.
Payment and withdrawal flows may additionally use `Submitted`, `Confirmed`, `Expired`, and
`Cancelled` only when their exact meaning is established by the authoritative workflow. Product copy
must not imply that a human review is automatic or that an existence result proves ownership.

Internal database objects, audit records, and source code may retain exact role names, reason codes,
and workflow identifiers where needed for security and traceability. They must not leak into public
paths, page titles, customer notifications, or customer-facing errors.

## No capability expansion

The implemented source boundaries described above remain disabled and undeployed. This decision does
not enable production customer access, PWA caching of private data, Telegram linking, Player-ID
ownership confirmation, provider verification, payment claims, KemerBet automation, deposits,
withdrawals, payouts, or any financial feature switch. Each requires its own implemented and
reviewed boundary.
