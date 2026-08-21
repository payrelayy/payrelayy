# Private real-money pilot

This contract separates **public product reachability** from **real-money authority**.

The FetanAgent web app and Telegram bot may remain reachable from anywhere during the pilot. Public
reachability does not authorize a payment lookup, a payment claim, a settlement, or a KemerBet
credit. Real-money processing is restricted in the database and rechecked by the executor for one
short-lived Owner-configured cohort.

The fact that a URL, bot username, or feature is not promoted is not an access-control boundary.
Unknown public users must be unable to create a real-money reservation or reach a final KemerBet
action.

Public Telegram onboarding creates only a minimal FetanAgent customer, Telegram identity,
conversation, and HMAC-bound inbound-event record for a recognized private action. It stores no
message text or Telegram profile name and does not create a Player binding, pilot membership,
provider proof, claim, settlement, or execution command. Existing beta-invite identities remain
usable, but beta invitations are not a real-money authorization mechanism.

## Pilot scope

An armed pilot revision contains all of the following, with no implicit defaults:

- exactly five immutable KemerBet Player-account IDs;
- one to five exact submitting FetanAgent customer IDs used by the Owner for Telegram/web testing;
- an explicit provider allowlist (`cbe_birr`, `telebirr`, or both only after each provider is
  independently ready);
- ETB minimum and maximum per deposit;
- a per-Player-ID amount cap;
- an aggregate amount cap;
- a maximum number of immutable budget reservations (including failed or uncertain external
  outcomes);
- a server-authored activation time and expiry no more than 24 hours later; and
- an Owner-controlled emergency stop.

Creating or arming a pilot revision does not by itself enable payment verification, execution, or a
KemerBet final action. Those remain separate reviewed gates.

The database foundation in this slice deliberately grants none of its prepare, arm, status, or stop
routines to the deployed Owner-control roles. The current Owner service has no typed pilot adapter,
exact catalog preflight, strongly authenticated routes, or idempotent control audit surface. A
forward-only control-plane slice providing all four is an activation blocker; operators must not
substitute ad-hoc SQL for that missing boundary.

The execution service also requires a fixed, root-managed canonical pilot manifest containing only
contract version, pilot revision UUID, and database-computed configuration digest. The database
lease and final-action fence must independently repeat that manifest plus the same immutable
reservation UUID and database-authored authorization token. Player/customer/account identifiers
and credentials are forbidden from the executor manifest.

## Required enforcement points

The exact pilot revision must be checked at every authority transition:

1. **Proof intake.** A publicly reachable customer may receive normal safe UI, but only an
   allowlisted pilot customer targeting one of the five allowlisted Player IDs may enter a live
   provider-verification queue.
2. **Provider observation acceptance.** The provider, proof request, customer, Player ID, protected
   reference, receipt occurrence time, receiver revision, parser/normalizer versions, and pilot
   revision must all remain exactly bound.
3. **Atomic claim and settlement.** The database locks the pilot revision, rechecks its state and
   expiry, rechecks current Player-ID eligibility, checks per-deposit/per-player/aggregate/count
   limits, reserves the pilot budget, globally claims the provider reference, and enqueues exactly
   one execution command in one transaction.
4. **Execution lease.** An execution job without the exact pilot reservation cannot be leased.
5. **Final-action fence.** Immediately before the irreversible KemerBet action, the database
   rechecks that the pilot is still armed, unexpired, within budget, and bound to the same Player ID,
   amount, intent, claim, and execution attempt.
6. **Reconciliation.** Once a final action is fenced, uncertainty never causes a blind retry. The
   job remains blocked for exact KemerBet-history reconciliation even if the Owner stops the pilot.

Checks at the API or UI are useful for early rejection but never replace the database and executor
checks.

## Receipt authority

Customer-supplied IDs, URLs, SMS text, images, PDFs, QR data, OCR output, names, dates, statuses, and
amounts are untrusted candidate input. No customer-entered amount can reach settlement.

Real-money settlement is permitted only after a dedicated trusted verifier has authenticated one
freshly retrieved official-provider observation, reduced it to exact versioned facts, and bound its
canonical snapshot and assessment digests. The database then independently rechecks every
database-owned policy, lineage, current-state, replay, cap, and execution invariant before settlement.
The current `deposit_proof_requests` rows are dry-run intake records and must not be promoted,
backfilled, or reclassified as authoritative live proofs.

Provider readiness is independent:

- **TeleBirr** requires the production Android observation protocol, enrolled/revocable device
  identity, fresh leases and heartbeats, exact raw-reference/fingerprint binding, exact receiver
  full-name matching, signed result upload, replay protection, and a least-privilege backend worker.
- **CBE Birr** requires a privacy-controlled live-response attestation and authoritative receiver
  evidence. The configured `PH` lookup selector is not receipt evidence. Under the current contract,
  a receipt that lacks the full receiver account identifier cannot auto-settle.

A provider can be enabled for the pilot only after its own complete source/parser/receiver test
matrix passes. Success for one provider cannot enable the other.

## External authority and eligibility

Technical ability to sign in or automate a browser is not permission to operate a KemerBet agent.
Before any real-money click, the Owner must independently document that the selected KemerBet agent
account is active, belongs to the Owner, permits this exact deposit workflow, and may be accessed by
the controlled automation profile. No ordinary player account may be treated as an agent account.

The pilot is limited to adult, legally eligible Owner-controlled testers. Before any later public
real-money launch, the Owner must obtain current Ethiopian licensing/compliance review for the
deposit-agent service, publish the applicable terms/privacy/responsible-use disclosures, and add
the required age/eligibility controls. A private five-account pilot and an unadvertised URL do not
substitute for those obligations.

## Pilot stop behavior

The Owner stop is fail-closed and auditable. It must:

- mark the pilot stopped so no new reservation, claim, lease, or final-action fence can succeed;
- disable payment verification and deposit execution;
- leave already-fenced uncertain actions available only to reconciliation;
- preserve all evidence, claims, reservations, executions, and audit history; and
- avoid deleting, rewriting, or releasing a reservation when the external outcome is uncertain.

Provider outage, parser drift, receiver ambiguity, device staleness, duplicate uncertainty,
eligibility loss, cap exhaustion, or an unknown KemerBet result invokes the same fail-closed posture.

## Activation sequence

The safe activation order is deliberately incremental:

1. Public app/web/bot reachable, all financial actions disabled.
2. Exact five-account pilot configured but not armed.
3. One provider runs in observation-only shadow mode; every result is manually reconciled.
4. Exact observations may persist evidence, but claims and execution stay disabled.
5. Global claims and budget reservations are enabled; execution stays disabled.
6. Settlement/enqueue is enabled for one fresh 25 ETB transaction to one allowlisted Player ID.
7. The KemerBet final action is enabled for that one transaction and reconciled against exact
   KemerBet success plus account history.
8. One Player ID is added to active testing at a time until all five have succeeded.
9. Public real-money launch requires a separate Owner decision, removal or replacement of the
   private cohort, a new rollout review, and another guarded deployment.

At no stage may a public user outside the cohort reach real-money authority merely because the web
app or bot is publicly accessible.

## Required Owner inputs before activation

Values that authorize financial exposure are not embedded in source code or guessed by the
implementation. Before arming, the Owner must supply through the private control plane:

- the exact five KemerBet Player IDs;
- the exact test customer identities/channels;
- the provider to enable first;
- the per-deposit, per-player, aggregate, and immutable-reservation-count limits;
- the pilot duration; and
- the exact receiver revision and provider-specific protected matching material.

No KemerBet password, provider password, OTP, browser cookie, raw transaction ID, or raw receipt is
accepted through source control, ordinary chat, logs, or general audit metadata.

## Recommended first supervised run

Unless the Owner explicitly chooses stricter values, the proposed first-run configuration is:

- TeleBirr only, after the live Android/provider-response contract and receiver revision pass their
  independent readiness gates;
- exactly five validated, currently eligible KemerBet Player IDs;
- exactly one 25 ETB immutable reservation per Player ID;
- 25 ETB per transaction and per Player ID;
- 125 ETB total exposure and five total reservations;
- a two-hour activation window; and
- one supervised transaction at a time, with provider, database, KemerBet balance/history, and
  customer-facing status reconciled before the next Player ID is attempted.

These values are a proposal, not an activation. A test that returns an uncertain external result
still consumes its reservation and pauses the pilot for reconciliation. Passing five supervised
transactions materially increases confidence, but it cannot prove that a real-money system is
“100% perfect”; public real-money access still requires a separate reviewed launch decision.
