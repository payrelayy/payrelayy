# CBE Birr official-source policy

Stage 1E specifies a pure, blocked-by-default policy boundary for deciding whether work on an
official CBE Birr source may proceed. It does not select, permit, discover, or contact a source. The
current source status is **unproven**, so there is no selected or permitted branch.

The package is `@fetanagent/cbe-birr-official-source-policy`, and its reserved `sourceProfile` value
is `cbe_birr_official_receipt_lookup_v1`. Those names coordinate future review; their presence is
not evidence that CBE Birr exposes a usable interface or that FetanAgent has permission to use one.
The implemented package is only the blocked policy contract described here and does not implement
a source capability.

## What does not establish permission

None of the following changes the `unproven` status:

- a synthetic, redacted, or provider-shaped fixture;
- a page that is visible in a browser or reachable from a deployment region;
- a known, guessed, observed, or historic endpoint;
- a successful DNS, TLS, HTTP, parsing, screenshot, PDF, SMS, QR, or OCR experiment;
- a code flag, environment value, feature switch, source-profile name, or test override; or
- an account, session, credential, phone number, transaction reference, receipt, or customer
  submission.

These observations may inform research, but they are neither a permission artifact nor official
provider evidence. FetanAgent must not bypass authentication, CAPTCHA, geofencing, rate limits,
terms, or any other provider control.

## Pure contract boundary

The Stage 1E policy is metadata-only and fail-closed. Its public values may identify the policy and
source-profile versions and explain, through fixed reason codes, why source capability remains
blocked. The contract must reject unknown fields, versions, states, and policy shapes.

The specified valid request contains only `contractVersion: 1`, `providerCode: cbe_birr`, and
`sourceProfile: cbe_birr_official_receipt_lookup_v1`. Its only result has
`disposition: blocked`, `reasonCode: source_permission_unproven`, and `advisoryOnly: true`, with
transport, decryption, lease acquisition, and provider-request capability all fixed to `false`.
`evidenceSource: provider_receipt_lookup` classifies the source under review; it does not mean that
the source is selected, permitted, reachable, or authoritative for FetanAgent. Malformed or hostile
input has only a fixed invalid result and cannot choose a capability.

It has no positive selected or permitted state today. It must not contain, accept, return, derive,
or log any of the following:

- a URL, host, route, request, response, authorization header, cookie, credential, or browser
  session;
- a raw or canonical transaction reference, receiver phone or identifier, receipt body, provider
  payload, ciphertext, encryption key, fingerprint key, API master key, or decryptor;
- a lease, job, queue runner, retry scheduler, network or filesystem client, database pool, SQL,
  procedure call, or runtime login;
- provider evidence, payment approval, verification state transition, duplicate-payment claim, or
  canonical-reference lock; or
- Telegram, API, worker, Owner Control, KemerBet, deposit execution, withdrawal, payout, or other
  runtime wiring.

The policy therefore cannot make an adapter authoritative, enable a source, acquire or settle a
shadow job, or authorize a financial outcome. `payment_verification`, `deposit_execution`,
`withdrawal_validation`, and `withdrawal_collection` remain off.

## Authoritative-lookup prerequisite boundary

The separate Stage 1F package, `@fetanagent/cbe-birr-authoritative-lookup-prerequisite`, turns the
known repository gaps into a pure fail-closed prerequisite inventory. Its only valid-request result
is advisory and `blocked`, with reason `authoritative_lookup_prerequisites_incomplete`. Its 12 exact
blockers cover five unresolved areas: source permission; receiver protection/provenance and fresh
immutable provisioning; a submitted-reference key lifecycle independent from the API master; joint
review of three normalization profiles; and a prelease metadata gate with no protected-material
return.

Every capability is fixed to `false`. The package does not accept, return, derive, or log raw or
protected lookup material, ciphertext, secrets, keys, protected-material versions, algorithms, KMS
values, URLs, credentials, lease values, runtime or schema wiring, provider evidence, financial
claims, or KemerBet operations. The public
`cbe_birr_shadow_protected_lookup_material_legacy` label classifies a blocked legacy shape only. It
is not an envelope or protection profile, does not establish provenance, and does not bless an
existing `v1` value.

The current receiver ciphertext lacks protection metadata and key provenance. Those facts must not
be inferred or backfilled; the future design requires a fresh new immutable receiver-account
revision. Submitted-reference encryption and fingerprint subkeys are domain-separated but still
share one API master provisioning and rotation root, with no independent worker decrypt lifecycle.
The current shadow lease also mutates state and returns protected material before a prerequisite
preflight. These findings are blockers, not implemented capabilities. See
[cbe-birr-authoritative-lookup-prerequisite.md](cbe-birr-authoritative-lookup-prerequisite.md).

## P0 prerequisites for any positive capability

There must be no positive source capability until every prerequisite below is implemented,
independently reviewed, and supported by reproducible evidence:

1. **Permission artifact and exact access rules.** Preserve an independently reviewed artifact from
   the provider or another competent authority that proves the precise source, allowed purpose,
   caller, authentication method, deployment context, rate limits, data handling, and revocation
   rules. Browser visibility and inferred behavior do not satisfy this requirement.
2. **Receiver revision and fresh protection provenance.** Create a fresh new immutable
   receiver-account revision under a reviewed purpose-bound protection design. Do not infer or
   backfill protection metadata, key provenance, purpose, or lifecycle onto the current receiver
   ciphertext.
3. **Independent submitted-reference key lifecycle.** Replace the shared API-master provisioning
   and rotation root with independently provisioned, purpose-bound worker access. Domain-separated
   encryption and fingerprint subkeys alone do not establish an independent worker decrypt
   lifecycle.
4. **Normalization ownership.** Jointly review the lookup-reference, receiver-lookup, and
   canonical-reference normalization profiles. Specify their exact transformations, ownership,
   compatibility rules, and fail-closed upgrades; do not assume that one profile represents
   another.
5. **Prelease prerequisite gate.** Redesign acquisition so a non-mutating metadata preflight runs
   before any lease mutation or protected-material return. A later payload must use an opaque handle
   and reveal material only inside a separately reviewed narrow boundary.
6. **Isolated callback-scoped decryptor.** Any future decryption must occur only inside an isolated,
   narrow callback for one permitted request. Plaintext receiver material must not escape the
   callback, become a general return value, enter application state, or appear in errors, logs, or
   telemetry.
7. **Compiled transport policy.** Pin the exact permitted host and route in reviewed code, require
   valid TLS, bound request and response sizes and timeouts, and reject redirects unless an exact
   same-origin rule is compiled and reviewed. Runtime input must never choose a URL or host.
8. **Telemetry and incident stop.** Provide allowlisted, secret-free telemetry for availability,
   policy denial, parser drift, and anomalies, plus a tested immediate stop that cannot enable a
   financial switch or discard reconciliation work.
9. **Fake-transport tests.** Prove permission denial, host/TLS/redirect rejection, callback-scoped
   secret handling, response bounds, parser drift, outage behavior, telemetry redaction, and
   incident stop with a deterministic fake transport. Tests must make no live provider call.

Completing these prerequisites would justify a new review, not automatic permission. The reviewed
artifact and compiled rules would still need to match exactly, and the future transport, adapter,
database runner, duplicate-read boundary, claim path, and rollout gates would remain separate work.

Stage 1E remains a policy gate only. It does not authorize a provider call or advance the rollout
order described in [provider-verification.md](provider-verification.md).
