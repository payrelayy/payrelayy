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

These are product decisions, not claims about deployed capability. The repository currently
contains an invite-only Telegram staging slice and a private operations page with internal
Owner-oriented copy. It does not yet contain the canonical public customer account flow, responsive
workspace, PWA manifest/service worker, generic public sign-in, persistent customer session policy,
forgot-password recovery, controlled Telegram-history link, or customer web action boundary.

The existing Telegram admission, `/owner` route, `Owner/Admin` labels, `pending validation` copy,
and manual Player-ID review wording are implementation history and private staging behavior. They
must not be presented as the settled customer experience. No financial, recovery, linking, or
session capability becomes enabled merely because this product boundary is documented.

The pure `@fetanagent/customer-web-access-foundation` package records the settled intent in a
fail-closed contract. Its metadata fixes self-service account creation and email/password
authentication as intent only. Its only valid-request result is advisory and `blocked`, with reason
`customer_web_access_runtime_not_implemented`. All 23 capability fields remain literal `false`,
covering the web/PWA runtime, service worker, network, cookies and browser storage, account creation,
authentication and credentials, password and email handling, recovery, session creation and
persistence, Telegram linking or identity merge, database/persistence/runtime wiring, platform
action, and financial capability. The package accepts no customer data or runtime material and is
not an account-creation, authentication, or session implementation.

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
4. Each Player ID remains unusable until a separately reviewed ownership association succeeds.
5. The customer chooses one `Ready to use` Player ID when starting a deposit or withdrawal.
6. Activity and support remain attached to the FetanAgent account rather than to a browser install
   or Telegram identity.

Finding that a Player ID exists does not prove ownership. A Player ID must not be silently assigned
to multiple customers, and a conflict must not disclose another account. Removal or reassignment
must preserve transaction history and follow a separately reviewed dispute/recovery boundary.

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

That requested behavior is **not enabled**. No reviewed implementation currently creates accounts,
accepts email/password credentials, provides secure persistent sessions, or performs forgot-password
recovery. The absence of step-up authentication must not be mistaken for approval of high-risk
account or financial actions.

Before persistent customer login can be enabled, the session boundary needs secure HTTP-only
cookies, rotation, server-side revocation, logout, per-device session visibility, remote sign-out,
cross-site request protection, and generic authentication errors. Conventional bounded idle and
absolute lifetimes would eventually require another sign-in and therefore conflict with the selected
no-repeated-authentication experience. No reviewed alternative or precise security-revocation policy
currently resolves that conflict, so session persistence remains disabled. Persistent must never
mean an irrevocable session or a trusted browser install.

Before recovery-only email confirmation can be enabled, a separate review must resolve how the
recovery address is bound safely when email ownership is not confirmed at self-service account
creation or routine sign-in. The recovery flow needs non-enumerating responses, rate limits,
short-lived single-use protected tokens, invalidation after use, password and session revocation,
customer notification, and an audited exception path. Until that design is approved,
forgot-password recovery remains unavailable.

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
| pending validation         | Being checked                                                | Waiting         |
| Player-ID registration     | Add a Player ID                                              | Player request  |
| found / not found          | No direct existence status; show the final association state | Source result   |
| payment claim              | Payment decision                                             | Decision        |
| provider evidence          | Payment information                                          | Source result   |
| job, lease, shadow         | Omit                                                         | Check           |

Player-ID association uses `Being checked`, `Needs more information`, `Ready to use`, `Could not
confirm`, and `Removed`. Payment and withdrawal flows may additionally use `Submitted`, `Confirmed`,
`Expired`, and `Cancelled` only when their exact meaning is established by the authoritative
workflow. Product copy must not imply that a human review is automatic or that an existence result
proves ownership.

Internal database objects, audit records, and source code may retain exact role names, reason codes,
and workflow identifiers where needed for security and traceability. They must not leak into public
paths, page titles, customer notifications, or customer-facing errors.

## No capability expansion

This decision does not enable customer registration endpoints, authentication, recovery, sessions,
PWA caching, Telegram linking, Player-ID ownership confirmation, provider verification, payment
claims, KemerBet automation, withdrawals, payouts, or any financial feature switch. Each requires
its own implemented and reviewed boundary.
