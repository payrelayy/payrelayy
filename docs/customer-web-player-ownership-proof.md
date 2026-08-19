# Customer-web Player-ID ownership-proof prerequisite

## Status: dormant and blocked

The repository has no reviewed way to prove that a signed-in FetanAgent customer controls a
submitted KemerBet Player ID. Finding that an account exists is not ownership proof. No
authoritative platform control signal, challenge profile, challenge delivery path, evidence
profile, or evidence-verification protocol has been selected.

`@fetanagent/customer-web-player-ownership-proof-prerequisite` is a pure, advisory-only package
that freezes this unresolved boundary. It is not an ownership-proof implementation, permission
switch, provider adapter, or rollout mechanism. No positive proof result is representable through
its contract.

## Fixed contract

The package describes exactly this candidate boundary:

```text
contractVersion: 2
platformCode: kemerbet
requestOrigin: customer_web
challengeProfile: unselected
evidenceProfile: unselected
advisoryOnly: true
disposition: blocked
reasonCode: customer_web_player_ownership_proof_prerequisites_incomplete
```

Its `remainingBlockers` field is the following fixed, ordered nine-item inventory:

1. `authoritative_platform_control_signal_unproven`
2. `challenge_profile_unselected`
3. `challenge_delivery_path_unselected`
4. `evidence_profile_unselected`
5. `evidence_freshness_replay_attempt_and_abuse_policy_unreviewed`
6. `verification_adapter_absent`
7. `neutral_staff_proof_review_capability_absent`
8. `ownership_conflict_recovery_and_reassignment_policy_unreviewed`
9. `owner_deposit_eligibility_decision_required`

The blocked result and blocker tuple are fixed metadata. They do not become true merely because a
route, runtime, database role, feature flag, or deployment configuration exists elsewhere. A later
phase must replace each blocker with a separately reviewed implementation and evidence-backed
decision; callers must not remove a blocker or reinterpret this result locally.

## No positive state

The package cannot express verified ownership, success, approval, association, `Ready`, or deposit
eligibility. Its evaluator returns only the frozen blocked contract for its exact metadata input or
a frozen invalid result for any other input. Its fixed redacted log projection contains controlled
metadata only and must never echo caller-controlled values.

Contract version 3 preserves all 19 literal-false capability flags. Separating the database's
financial eligibility gate does not turn any proof, review, association, database, runtime,
network, `Ready`, deposit-eligibility, or financial capability on in this package.

The package accepts no Player ID, Auth UUID, customer ID, email address, proof material, credential,
token, provider session, or financial input. It does not issue or deliver a challenge, accept or
persist evidence, verify evidence, start a staff review, or resolve an ownership conflict.

## Preserved implementation boundary

This prerequisite adds no database migration, schema object, table, function, trigger, policy,
grant, role, credential, or Data API surface. It does not change the customer-web runtime's exact
three-function PostgreSQL capability:

```text
app.ensure_customer_web_account(uuid)
app.submit_customer_web_player_registration(uuid, uuid, text)
app.list_customer_web_player_registrations(uuid, integer)
```

It also adds no application import, route, page, form, button, worker, provider adapter,
environment variable, network call, runtime composition, deployment secret, Compose/Caddy rule,
DNS change, firewall change, or live routing.

The existing database rejection of every web-origin ownership association remains absolute. The
package creates no validated player binding, validation attempt, eligibility decision, deposit
intent, audit event, or financial record. It cannot call KemerBet, perform a provider lookup,
enable a payment switch, display payment instructions, or execute any financial action.

## Customer and team behavior

The customer web/PWA remains unchanged. A submitted Player ID may display `Checking` or
`Could not confirm`; `Ready` is intentionally unreachable for a web-origin request. Internal reason
codes and blocker names must not appear in customer-facing paths, pages, status text, errors, or
notifications.

There is no staff proof-review runtime in this phase. A future staff capability must use the
generic public sign-in and neutral workspace, be authorized server-side, and avoid role-revealing
customer copy. A staff statement or existence lookup must never be treated as proof that the
customer controls the KemerBet account.

## Ownership is not deposit eligibility

The historical association path creates `app.customer_platform_players`, but that ownership
association no longer makes the row sufficient for a new deposit intent. The private
`app.player_deposit_eligibility_decisions` table is a separate append-only, versioned financial
ledger. Every new intent is guarded by
`app.require_player_deposit_eligibility_for_intent()`, which locks the selected player row, requires
the latest decision to be `eligible`, and overwrites the intent's
`player_deposit_eligibility_decision_id` with that exact decision. A latest `revoked` decision
blocks later intents without rewriting historical intents.

The customer list projection uses this ledger only to keep its future `Ready` label fail-closed. It
requires an aligned active/valid association and platform plus a contiguous latest `eligible`
decision whose time and player-state snapshot are current. Missing, revoked, stale, future-dated, or
malformed eligibility stays `Checking`. No ledger identifier, version, actor, or reason is returned,
and the deposit-intent trigger remains the financial authorization boundary.

This is a financial quarantine, not a proof implementation. There is no seed, backfill, automatic
promotion, or customer-writable decision. Only the authenticated Owner-control boundary can append
an audited approval or revocation for an already associated Player ID. The ninth blocker therefore
requires that independent Owner decision. Proof success must never silently insert an `eligible`
decision or make a Player ID financially usable.

## Required future sequence

Before any positive result can exist, a later phase must:

1. select and review an authoritative, non-credential KemerBet control signal;
2. define the challenge, delivery, evidence, freshness, replay, attempt, abuse, and redaction
   rules;
3. implement and offline-test a narrowly scoped verification adapter;
4. define neutral staff handling and ownership conflict, recovery, and reassignment behavior;
5. add append-only proof-attempt and evidence receipts through a separately reviewed private
   database boundary;
6. create a non-financial ownership binding that is independent from deposit eligibility; and
7. require the existing Owner-only eligibility approval/revocation after proven ownership, with no
   automatic coupling from proof success.

Until all of those boundaries are implemented and reviewed, the only supported ownership-proof
decision remains `blocked / customer_web_player_ownership_proof_prerequisites_incomplete`.
