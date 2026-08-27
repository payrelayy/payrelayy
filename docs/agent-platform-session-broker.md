# Agent Platform Session Broker

Status: v11 Phase-1 architecture and operator runbook

## Purpose and safety boundary

The target Agent Platform Session Broker owns the lifecycle of an isolated, encrypted
browser-profile session used to enroll an agent-platform account. It separates platform-neutral
session control from platform-specific page classification and from the browser worker that
displays the login page.

The broker is an enrollment and session-retention boundary only. It is not an account-operation or
payment boundary. In every state, including `ready`:

- account lookup is not authorized;
- account mutation is not authorized;
- execution is not authorized;
- financial action is not authorized;
- Amount and Notes entry are not authorized;
- Transfer is disabled; and
- a `202 Accepted`, authenticated page, authentication proof, retained profile, frame, or `ready`
  state does not grant any of those capabilities.

This document distinguishes the normative broker contract from the Phase-1 KemerBet compatibility
implementation. A requirement described here is not evidence that a provider action has been
implemented or approved.

## Architecture and ownership

The design has six narrow components:

1. **Owner control client.** Requests generation creation, submits login-only input, observes
   metadata, reads frames through the separate frame channel, and requests close. It never receives
   cookies, bearer tokens, profile files, or encryption keys.
2. **Session broker.** Validates generation and command ordering, owns the state machine, emits
   metadata events, enforces the absolute lifetime, and coordinates clean close and quarantine. It
   does not contain provider selectors or action methods.
3. **Enrollment adapter.** Supplies a digest-bound manifest and URL-only page classification. Its
   surface is exactly `manifest` plus `classifyPage`; it cannot expose lookup, mutation, execution,
   or transfer methods.
4. **Browser worker.** Owns one isolated persistent browser context and one primary page for one
   generation. It dispatches admitted credential input only into the allowed login page. The worker
   produces frames and an external identity-and-session probe result, but never reports
   credentials.
5. **Encrypted profile store.** Persists an encrypted profile revision. Generation metadata carries
   only the profile digest, revision, key revision, and ownership identifiers—not profile bytes,
   cookies, credentials, or tokens.
6. **Bounded supervisor (target architecture).** Keeps the broker coordinator available, limits
   restart attempts and browser multiplicity, and quarantines a faulted generation instead of
   retrying without limit. The Phase-1 compatibility coordinator does not enable automatic Docker
   restarts.

Control metadata and browser frames are separate data planes:

```text
Owner control ──commands/metadata──> Session broker ──lifecycle──> Browser worker
      │                                  │                              │
      └────────frame reads────────> Frame channel <────JPEG frame───────┘
                                         │
Session broker ──immutable binding──> Encrypted profile store
Session broker ──manifest/classify──> Enrollment adapter
```

This diagram is the target architecture. The live v11 Phase-1 path is the hardened private
KemerBet compatibility coordinator using the provider-neutral KemerBet adapter for its exact page
classification. The generic generation, snapshot, attestation, and command-journal contracts are
not yet the live coordinator. Its provider profile remains on a plaintext Docker volume. The exact
live/target gaps are listed under Phase-1 limitations.

The broker and worker may share a private host or Unix-socket boundary, but that does not merge
their responsibilities. In the Phase-1 compatibility path, credential keystrokes exist transiently
only in the private Owner client, its authenticated HTTPS input request, the admin-to-worker Unix
socket request, and the worker's in-memory browser dispatch before entering the adapter-classified
login page. They are never persisted, logged, returned in a response, placed in control metadata,
or sent to chat, Git, Supabase, or analytics. The target broker should remove the admin relay from
this path. Encrypted profile bytes remain in the target profile store, and control metadata remains
non-secret and bounded; the current KemerBet Docker profile is still plaintext as documented below.

## Immutable generation contract

A generation is the unit of ownership, idempotency, lifetime, proof, frames, and quarantine. It is
immutable after creation and contains exactly:

- `schemaVersion`;
- `generationId`, a UUID;
- `platformCode`;
- `platformAgentAccountId`, a UUID;
- `profileRevision`;
- `encryptedProfileDigest`;
- `profileEncryptionKeyRevision`;
- `adapterVersion` and `adapterDigest`;
- `createdAt`; and
- `absoluteExpiresAt`.

The adapter digest binds the reviewed canonical adapter manifest, including its exact credential
input and authenticated-candidate URL lists. A trusted release-registry pin supplies provenance;
the digest does not by itself attest the classifier's executable code. The profile digest binds one
target encrypted profile revision. Neither digest is a substitute for authentication proof.

`absoluteExpiresAt` is a hard outer generation deadline and never moves. The platform's reviewed
session policy supplies separate login, authenticated, and total-generation bounds. For KemerBet,
the Owner may spend at most ten minutes entering credentials and the retained session may remain
authenticated for at most twelve hours from the first proved authenticated event. The target
KemerBet policy is therefore:

```text
maxLoginLifetimeSeconds = 600
maxAuthenticatedLifetimeSeconds = 43_200
maxGenerationLifetimeSeconds = 43_800
absoluteExpiresAt <= createdAt + 43_800 seconds
authenticatedDeadline = min(firstAuthenticatedAt + 43_200 seconds, absoluteExpiresAt)
```

The `firstAuthenticatedAt` and derived `authenticatedDeadline` binding is assigned once at the first
proved authenticated event. A status read, frame read, input, re-authentication, process
replacement, or adapter retry cannot move either value or the outer deadline forward. A proof
expiry or explicit close may end usefulness earlier. The Phase-1 generic manifest-aware validator
enforces an exact platform, adapter version/digest, all three session-policy bounds (`600`, `43_200`,
and `43_800` seconds), the exact derived authenticated deadline, and immutable advancement of the
binding. The live compatibility coordinator is not yet wired to that validator, but its
event-driven first-authentication timing implements the same intended leases.

## Exact state machine

The only states and direct transitions are:

| Current state          | Allowed next state                                              | Required meaning                                                                                                                   |
| ---------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `sealed`               | `starting`, `closing`                                           | Immutable generation exists; no browser is exposed.                                                                                |
| `starting`             | `login_required`, `authenticated_locked`, `degraded`, `closing` | Broker is creating or restoring the exact bound browser/profile.                                                                   |
| `login_required`       | `authenticating`, `degraded`, `closing`                         | Exact allowed login page is visible; credential input may be admitted.                                                             |
| `authenticating`       | `login_required`, `authenticated_locked`, `degraded`, `closing` | Login-only input is being applied; a failed attempt may return to the login page.                                                  |
| `authenticated_locked` | `ready`, `degraded`, `closing`                                  | Credential input is locked and a generation/account-bound identity-and-session proof exists.                                       |
| `ready`                | `degraded`, `closing`                                           | Enrollment session is retained and observable; all action and financial capabilities remain false.                                 |
| `degraded`             | `starting`, `closing`                                           | A bounded, recoverable fault exists. Recovery is permitted only within the same immutable binding and reviewed supervision policy. |
| `closing`              | `closed`                                                        | New commands and frames are rejected while the worker and profile handles are closed and verified.                                 |
| `closed`               | none                                                            | Terminal. Reopening requires a new generation ID.                                                                                  |

The only valid genesis snapshot is `sealed` at `stateRevision=0`, observed exactly at
`generation.createdAt`, with credential input false and no authentication proof.

Every unlisted transition is invalid. There are no implicit self-transitions. An idempotent replay
returns the existing command receipt or snapshot without incrementing the state revision.

Each accepted state transition creates a snapshot with:

- the identical immutable generation;
- `stateRevision` equal to the preceding revision plus one;
- the same nullable `firstAuthenticatedAt`/`authenticatedDeadline` pair, except that the first
  proved transition to `authenticated_locked` assigns both once and binds `firstAuthenticatedAt`
  exactly to that proof's `verifiedAt`;
- `observedAt` strictly later than the preceding observation; usable states cannot be observed past
  the active deadline, while cleanup-only `closing` and `closed` metadata may be recorded after it
  and can never restore proof, input, or frames;
- the capability literals fixed to no mutation, no execution, no financial action, and Transfer
  disabled; and
- authentication proof only in `authenticated_locked` or `ready`.

The proof must bind the same `generationId` and `platformAgentAccountId`, carry separate identity and
session probe digests, be verified no earlier than `firstAuthenticatedAt`, be valid at `observedAt`,
expire no later than `authenticatedDeadline`, lock credential input, keep financial action false,
and keep Transfer disabled. A URL classified as
`authenticated_candidate` is only a candidate; it can never create proof by itself.

The main event paths are:

```text
create generation
  sealed -> starting
    -> login_required -> authenticating -> login_required       (another login attempt)
    -> login_required -> authenticating -> authenticated_locked (valid external proof)
    -> authenticated_locked -> ready

restore already-authenticated encrypted profile
  sealed -> starting -> authenticated_locked -> ready

recoverable worker fault
  any active state -> degraded -> starting

close, expiry, or unrecoverable fault
  any nonterminal state -> closing -> closed
```

From `closing`, cleanup failure does not permit a transition back to an active state. The generation
stays unavailable and quarantined until cleanup is proven; only then may it become `closed`.

## Asynchronous command and `202 Accepted` semantics

Mutating broker commands are asynchronous. The control boundary validates and durably admits a
command, then responds with `202 Accepted`; the generation actor applies it later. `202` means only
that the exact command entered the bounded queue. It does not mean that:

- Chromium started;
- input reached a page;
- authentication succeeded;
- a frame changed;
- close completed;
- an adapter probe succeeded; or
- any provider or financial action was authorized.

The acceptance receipt contains only bounded metadata: generation ID, command sequence, canonical
command digest, current state revision, and an event/snapshot location or correlation ID. It
contains no frame, credential, cookie, token, Player ID, Amount, Notes, or provider response.

Completion is learned from a later state/event observation. Clients must not convert a timeout or
lost response into an unbounded retry. They resubmit the identical generation, sequence, and
canonical payload and rely on idempotency.

Read-only metadata and frame reads are not mutating commands and do not extend the session lifetime.
Suggested fail-closed protocol outcomes are:

| Outcome                   | Meaning                                                                                        |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `202 Accepted`            | Exact command was admitted or an identical replay resolved to the existing receipt.            |
| `400 Bad Request`         | Shape, type, bounds, or canonical encoding is invalid.                                         |
| `404 Not Found`           | Generation is unknown without revealing another Owner's generation.                            |
| `409 Conflict`            | State, generation, sequence, payload digest, or frame sequence conflicts. No input is applied. |
| `410 Gone`                | Generation is closed or expired.                                                               |
| `423 Locked`              | Generation/profile is quarantined or closing.                                                  |
| `429 Too Many Requests`   | The bounded queue is full; the command was not admitted.                                       |
| `503 Service Unavailable` | Broker cannot prove the requested boundary. The command was not admitted.                      |

## Generation and sequence idempotency

Each mutating command is identified by `(generationId, commandSequence)`. A request ID is only a
correlation value and must not replace this idempotency key.

For each generation:

1. `commandSequence` is a positive safe integer and begins at one.
2. The broker accepts only the next contiguous sequence.
3. It stores the canonical command digest before acknowledging `202`.
4. A replay of the same sequence and same digest returns the original receipt and has no second
   effect.
5. The same sequence with a different digest is a conflict and faults/quarantines the generation;
   it is never guessed which payload was intended.
6. A gap, unknown lower sequence, stale generation, or command for a terminal generation is
   rejected without browser input.
7. A new generation resets command sequencing but cannot reuse frames, proof, receipts, or commands
   from an older generation.

`stateRevision`, `commandSequence`, and `frameSequence` are different counters:

- `commandSequence` orders accepted mutations;
- `stateRevision` orders validated state snapshots; and
- `frameSequence` orders frames produced by one generation.

They must never be substituted for one another.

## Metadata and frame separation

Control responses are JSON metadata only. A browser frame is obtained through a separate,
read-only frame route or stream and is never embedded as base64 in a status or command response.

Each frame is bound to:

- exactly one `generationId`;
- a monotonically increasing `frameSequence` scoped to that generation;
- a fixed content type and bounded byte length; and
- no-store/no-cache transport metadata.

The metadata channel may announce that a new `frameSequence` exists, but it does not carry the frame
body. The frame channel returns only the current or next generation-bound frame. It must reject a
generation mismatch and must not return a stale frame from a prior generation.

Pointer and key input bind to both the exact `generationId` and the frame sequence the Owner
observed. If the current frame has advanced, the broker rejects the input rather than applying it to
a different page. Frames are sensitive because they can contain credential UI. They are kept only
for the bounded live session, are not written to application logs or analytics, and are discarded
on close, expiry, or quarantine.

## No-transfer invariants

The following are release invariants, not configuration defaults:

1. Every enrollment manifest fixes account lookup, account mutation, execution, financial action,
   and transfer permission to false.
2. The adapter surface is exactly `manifest` plus pure URL `classifyPage`; it exposes no lookup,
   Amount, Notes, deposit, withdrawal, credit, executor, or Transfer method.
3. Credential input is admitted only for the exact generation, current displayed frame, and exact
   manifest-declared login URL. It locks before authentication verification and remains locked on
   an authenticated-candidate page.
4. An authenticated-candidate URL, authentication proof, `ready`, frame, checkpoint, readiness
   seal, or twelve-hour retention never changes the capability policy.
5. The broker cannot enable a financial feature flag, call the provider execution boundary, or
   click Transfer. Those dependencies are absent from this architecture.
6. A missing, malformed, expired, ambiguous, or conflicting identity, route, proof, generation,
   sequence, frame, or close result rejects or quarantines; it never falls back to a provider
   action.

Any future provider-action design is a separate project and requires a distinct contract, threat
model, authorization, implementation, and release. It must not be added as another broker command.

## Event-driven twelve-hour bound

The broker arms a deadline event when the generation starts; status polling is not the clock. Before
authentication, the active deadline is the earlier of the ten-minute login-entry deadline and the
outer generation deadline. On the first proved authenticated event, the broker assigns
`firstAuthenticatedAt` and the derived twelve-hour `authenticatedDeadline` once, then arms the
remaining duration. Returning to the login page for re-authentication permits at most ten minutes
and is still capped by the unchanged authenticated deadline.

The expiry mechanism is event-driven:

1. Record `absoluteExpiresAt` with the generation and arm the bounded login-entry timer.
2. On the first authenticated navigation plus valid external proof, assign `firstAuthenticatedAt`
   to that proof's `verifiedAt` and derive `authenticatedDeadline` if both are absent; never assign
   them again.
3. On later authenticated navigation, keep the existing deadline. Re-authentication cannot create a
   new twelve-hour window.
4. On authentication, navigation, input, frame, and status events, compare current time with the
   active deadline before doing work.
5. On process restart, rehydrate only immutable metadata and close immediately if the applicable
   deadline has passed. Never reset a deadline from restart time.
6. At the active deadline, enqueue one internal expiry event that moves the current nonterminal state
   to `closing`; close and verify the worker, then move to `closed`.
7. Treat timer loss, backward-clock ambiguity, or an observation after the deadline as a fault that
   fails closed.

No external request is required for expiry to happen. Health checks observe the broker; they do not
drive expiry.

## Clean close and fault quarantine

A clean close is ordered and observable:

1. Admit the close command or internal expiry event once.
2. Transition to `closing` and reject new input and new frame publication.
3. Cancel queued but unapplied commands for the generation.
4. Stop frame production and discard in-memory frame bytes.
5. Close the exact primary page and persistent browser context through the reviewed clean-checkpoint
   path.
6. Wait for browser children and profile holders to exit within the bounded close deadline.
7. Revalidate profile ownership, path, mode, revision, and digest; release the generation lease.
8. Clear in-memory handles, proof, timers, command payloads, and frame metadata.
9. Transition to `closed` only after absence of the worker and holders is proven.

Quarantine is an orthogonal disposition on a generation/profile revision, not an extra state that
bypasses the exact state machine. It is set for conditions such as:

- unexpected browser or coordinator exit;
- clean-close timeout or surviving holder;
- profile path, inode, ownership, mode, revision, or digest drift;
- extra page, popup, disallowed origin, unsupported route, or forbidden request;
- authentication-proof mismatch or expiry;
- conflicting command replay or impossible counter regression;
- frame from another generation or stale-frame input; or
- exhausted supervision budget.

A quarantined generation cannot become `ready`, accept input, publish frames, or be reused. Do not
delete or rewrite its profile or audit evidence to make it pass. An operator may inspect redacted
reason codes, close remaining processes through the narrow helper, rotate to a new reviewed profile
revision if required, and create a new generation. Credentials, tokens, profile bytes, frame bytes,
and provider bodies must never appear in quarantine diagnostics.

## Bounded supervision

The target broker serializes one generation's lifecycle and permits at most one browser context and
one primary page for it. Duplicate starts coalesce through generation/sequence idempotency; they do
not create extra browsers. Any future automatic supervisor must persist and independently attest an
exact retry budget together with the immutable generation and authenticated-deadline binding before
it may replace a failed coordinator.

The deployed Phase-1 KemerBet coordinator deliberately uses Compose `restart: 'no'`. An unexpected
exit leaves the coordinator unavailable until a reviewed operator-controlled start or release
deployment re-establishes the exact runtime. The H11 privileged helper does not attest a Docker
restart budget, so Phase 1 does not rely on Docker `on-failure` semantics for availability or
lifetime enforcement. The coordinator remains non-root with a read-only root filesystem, all Linux
capabilities dropped, `no-new-privileges`, bounded PID/memory/CPU resources, a sixty-second stop
grace period, and a private health check. An exit must not trigger an automatic browser relaunch or
credential replay.

## Adapter boundary

### KemerBet Phase-1 adapter

The KemerBet enrollment adapter is a separate package from the provider-neutral contracts. Its
digest-bound manifest fixes:

- `platformCode` to `kemerbet`;
- the canonical login URL to `https://agentsystem.admindigi.com/login`;
- the only allowed web origin to `https://agentsystem.admindigi.com`;
- exact `/login` and `/login?et=1` classification as `login`;
- exact `/agents` with no query as `authenticated_candidate`; and
- every other origin, credential-bearing URL, fragment, query, or route as `unsupported`.

The adapter has no deposit, withdrawal, lookup, Player, Amount, Notes, execution, or Transfer method.
The `/agents` URL remains only a candidate. The existing KemerBet identity and session probes must
independently produce a generation/account-bound proof before `authenticated_locked` or `ready`.

The manifest explicitly declares page classification as its only provided capability and declares
profile persistence and authentication attestation as `not_provided`, with the external broker as
their authority. The two-method adapter neither encrypts a profile nor produces a proof.

### Future agent platforms

A future platform is added as a new adapter, not as a conditional branch inside the broker. It must
have its own platform code, manifest, adapter version/digest, allowed origins, login URL,
classification tests, required external-broker lifetime policy, encrypted profile namespace, and
identity/session probes.

Admission requires all of the following:

1. exact-key manifest parsing and a reviewed canonical digest;
2. the enrollment-only capability policy unchanged;
3. no import from a provider execution or financial boundary;
4. exhaustive fail-closed URL classification tests;
5. proof binding to the same generation and platform account;
6. generation/frame/sequence isolation tests across platforms; and
7. release review and a provider-specific canary with all action flags disabled.

KemerBet selectors, refresh behavior, origins, profile files, and proof logic must never be inherited
implicitly by another platform.

### Phase-1 KemerBet compatibility protocol

The hardened KemerBet coordinator is a compatibility implementation, not the generic state machine.
Its private Unix-socket routes are:

- `GET /healthz` for coordinator liveness without entering the serialized browser lane;
- `GET /v1/session` for JSON metadata;
- `POST /v1/session/start` for asynchronous start;
- `POST /v1/session/input` for one generation/frame-bound pointer, named key, or bounded printable
  text batch;
- `POST /v1/session/stop` for clean close;
- `POST /v1/session/checkpoint` and `POST /v1/readiness/seal` for the existing no-transfer
  readiness workflow; and
- `GET /v1/session/frame?generation=<v4-uuid>&after=<sequence>` for frame bytes.

Start returns `202` immediately with `phase=starting`, `generation=requestId`, `frameSequence=0`,
an expiry, and no frame or authentication claim. The same start request ID resolves to the same
generation snapshot; a different concurrent active generation fails closed with `503`. The
compatibility phases are:

| Compatibility phase | Meaning and permitted progression                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `idle`              | No browser generation is active; start may create one generation.                                                                                                                     |
| `starting`          | Browser/profile initialization is asynchronous; it advances to `login_required` or `authenticated`, returns cleanly to `idle` on a clean start failure, or becomes `faulted`.         |
| `login_required`    | A generation-bound frame may be read and exact-frame login input may be submitted; navigation events may advance to `authenticated`.                                                  |
| `authenticated`     | Input and login frames are locked; first authentication fixes the non-sliding twelve-hour deadline. Re-authentication may return to `login_required` without extending that deadline. |
| `stopping`          | New input is rejected while the checkpoint-grade clean close runs; success returns to `idle`.                                                                                         |
| `checkpointed`      | The context closed and the one-use readiness checkpoint/seal latch is terminal for this coordinator instance.                                                                         |
| `faulted`           | Crash, unexpected close, invalid navigation, or failed clean close has locked the generation; only a clean stop/review may recover it.                                                |

If the browser context is already unexpectedly closed, the coordinator records the fault and a
subsequent Stop clears the dead handles without pretending to checkpoint-close a context that no
longer exists. Any retry receives a new generation; the failed generation is never resumed.

The frame route returns `204` with generation/sequence headers when there is no newer frame and
`200 image/jpeg` with those headers when a newer frame exists. The image remains in memory, is
cleared at authentication or close, and is never embedded in session JSON. Input must echo the exact
displayed generation and frame sequence. Navigation, crash, and browser-context close events update
the phase; Owner polling merely observes it. The Owner uses bounded polling with exponential
backoff and retains the last confirmed metadata on a transient connection failure. A missing frame
is retried through the same serialized lane; each screenshot attempt is bounded to four seconds.
Browser launch and initial navigation are each bounded to thirty seconds.

Owner status, frame, start, input, and stop authorization plus exact-active-profile checks are
coalesced in a bounded cache of at most eight entries for at most five seconds. Cache keys contain
only a SHA-256 bearer digest, never the bearer itself. This is an availability optimization with a
maximum five-second revocation exposure, not an authorization expansion.

## Phase-1 limitations

Phase 1 establishes the provider-neutral contracts and KemerBet enrollment seam while hardening the
existing private KemerBet coordinator. It is deliberately not the finished multi-platform broker.
Known limitations must remain visible during rollout:

- The live executor now consumes the reviewed KemerBet enrollment adapter for exact page
  classification. The neutral generation/snapshot validator, external-broker persistence and
  attestation requirements, and durable command journal are not yet the live coordinator.
- The neutral validator now binds a generation to the exact manifest and session policy. KemerBet's
  manifest fixes a 600-second login lease, a 43,200-second authenticated lease, and a 43,800-second
  total-generation cap. The live compatibility coordinator implements the intended event-driven
  login and first-authenticated leases, but is not yet wired to the neutral validator; do not claim
  that the package validator itself governs the live session.
- The canonical manifest digest now binds the exact `/login`, `/login?et=1`, and `/agents` URL rules,
  and the neutral wrapper independently confines supported classifications to those routes and the
  allowed origin. It still does not hash or authenticate the implementation of `classifyPage`; a
  trusted release pin or signed code artifact remains required for executable provenance.
- `AgentSessionAuthenticationProof` is currently a strict ownership/time/capability schema, not a
  broker signature or MAC. The external broker must remain the sole trusted issuer, or a later phase
  must add a verifiable broker attestation before arbitrary caller-supplied probe digests can be
  treated as proof.
- The active KemerBet Docker profile volume is plaintext. The corrected manifest accurately says
  that persistence and authentication attestation are not provided by the adapter and assigns
  those duties to the external broker. An encrypted profile store and broker-issued attestation
  remain Phase-2 host requirements; do not describe the current volume as encrypted.
- The compatibility coordinator is KemerBet-specific and keeps a single in-process serialized lane;
  it is not a multi-platform scheduler or horizontally available broker.
- Compatibility-session start and stop are asynchronous with `202 Accepted`. Pointer, named-key,
  bounded-text input, checkpoint, and readiness seal still complete on the request path, and there
  is no general durable `(generationId, commandSequence, commandDigest)` receipt journal yet.
- Owner printable input is held only in memory for 180 milliseconds and sent as an exact 1-64 byte
  printable-ASCII text batch. Pointer and named-key input flush the pending text first. The client
  therefore uses one REST request and one follow-up screenshot per pointer, named key, or bounded
  text batch instead of one round trip per typed character. Generation and frame-sequence binding
  prevents stale application, but this measured REST bridge must not be presented as the final
  provider-neutral transport.
- Cold KemerBet login depends on one version-bound reCAPTCHA ceremony. The bootstrap, runtime,
  worker, stylesheet, and logo bodies plus their browser-relevant cross-origin headers are pinned
  by exact URL, size, MIME, and SHA-256 before synthetic fulfillment. The anchor and three dynamic
  POSTs are admitted only in one bounded, generation-local, login-document-bound sequence with
  exact frame provenance, query shape, content type, and aggregate body limits. Their opaque
  protocol bodies are not decoded, so this is a narrow reviewed compatibility boundary rather than
  a claim that arbitrary CAPTCHA payload semantics are understood. Static-asset variant selection
  is bound to the retained browser's single strict, bounded HeadlessChrome User-Agent. The
  credential-free verifier fetch forwards only that header—never cookies, authorization, referrer,
  client hints, or provider state—and includes it in the five-entry, ten-minute verified-cache key.
  A provider-side return to login synchronously retires the old ceremony and creates a fresh
  document-bound, one-use ceremony capped by the earlier of ten minutes and the unchanged
  authenticated/hard deadlines. Any upstream version, asset, header, request-shape, User-Agent
  variant, or ordering change fails closed and requires a new credential-free trace, review,
  fixture update, and release pin; operators must not widen the Google/gstatic allowlist to bypass
  that gate.
- The v11 compatibility path separates frame bytes from metadata, but any still-deployed predecessor
  that returns an inline base64 frame remains a legacy path and is not the broker contract. New
  clients must use the separate frame channel.
- Runtime state, queued commands, and live frame bytes are process-local. The current provider
  profile volume is durable on the host but is not encrypted by the Phase-1 adapter. An unexpected
  coordinator exit leaves the service stopped; an operator-started replacement does not prove that
  an in-flight command was applied, so the generation must recover from its recorded
  receipt/snapshot or quarantine.
- The generic package defines enrollment and proof contracts only. It does not define provider
  network requests, lookup, deposit, withdrawal, or execution adapters.

These limitations do not weaken the no-transfer boundary. They limit availability or generality;
they do not authorize a broader operation.

## Rollout runbook

### 1. Review and freeze

- Review the exact protected-main commit, contract package, KemerBet adapter manifest/digest,
  coordinator changes, Compose policy, workflow, static verifiers, and this runbook together.
- Record the release SHA and image/helper digests. Do not deploy from a dirty tree or an unreviewed
  artifact.
- Confirm `FINANCIAL_ACTIONS_MODE` remains `dry_run` and executor, final-action, private-live-pilot,
  and internal execution flags remain false.
- Confirm the adapter capability policy fixes lookup, mutation, execution, financial action, and
  Transfer to false.

### 2. Build and protocol verification

- Build and test the provider-neutral contract package and KemerBet adapter package.
- Run the complete executor tests, infrastructure verifiers, build/typecheck, and formatting gate.
- Require async acceptance, identical replay, conflicting replay, sequence gap, stale generation,
  stale frame, absolute expiry, clean close, and quarantine tests to pass.
- Require tests to prove that frame bytes are absent from metadata and logs.

### 3. Deploy stopped and attest

- Use the release-pinned deployment workflow and its pre-downtime release/helper and storage gates.
- Install the reviewed images while staging is stopped and database roles remain disabled according
  to the existing deployment boundary.
- Start the private application runtime, then the session coordinator, and require the coordinator's
  private health/readiness check. Do not start a browser merely because the coordinator is healthy.
- Verify that no unreviewed container, browser, profile holder, or prior generation is active.

### 4. Private canary

- Create one new generation for one Owner-controlled account through the private Owner surface.
- Confirm metadata/frame separation and generation/frame-sequence binding before entering any login
  input.
- Authenticate manually only on the adapter-classified login page.
- Require external identity/session proof, input lock, `authenticated_locked`, then `ready`.
- Observe the full first-authenticated twelve-hour bound without status, frame reads, navigation, or
  re-authentication extending it, and verify the hard outer generation deadline as well.
- Close explicitly and prove the browser, child processes, timers, frames, and generation lease are
  gone.

Expand only to the existing five Owner-controlled test accounts after the one-account lifecycle and
fault-injection gates pass. This canary is for sign-in/session retention only; it does not authorize
a Player lookup, Amount, Notes, Transfer, or money movement.

### 5. Compatibility migration

- Migrate Owner clients from inline frame metadata to the separate generation-bound frame channel.
- Preserve the generation/frame-bound pointer, named-key, and bounded-text REST input only as a
  measured compatibility bridge; do not expose it publicly as the provider-neutral protocol.
- Extend the live classifier integration to the generic generation/snapshot broker only after its
  manifest digest and external proof path are release-pinned.
- Remove the legacy path only after parity tests, a full-duration soak, and rollback rehearsal.

## Rollback runbook

Rollback is required for any lifetime extension beyond the bound, cross-generation frame/input,
duplicate command effect, proof mismatch, forbidden network request, close failure, or repeated
worker crash.

1. Stop admitting new generations.
2. Move each active generation to `closing`; do not route it to the predecessor while still live.
3. Prove clean browser/context closure. Quarantine any generation whose close cannot be proven.
4. Preserve profile artifacts, receipts, state snapshots, adapter manifests, and quarantine evidence.
   Profile artifacts become encrypted only after the target host assurance is implemented and
   attested. Do not perform broad Docker or profile cleanup.
5. Redeploy the last reviewed release through the normal release-pinned workflow.
6. Keep all financial and execution flags false and the adapter enrollment-only.
7. Require the predecessor coordinator health gate before reopening private Owner access.
8. Create a new generation for further testing. Never reuse a v11 generation, proof, sequence,
   frame, or acceptance receipt under the predecessor.

Phase 1 must not introduce a durable schema that an earlier release silently misreads. If a future
phase adds one, rollback requires versioned dual-read or an explicit offline migration plan before
deployment.

## Required test gates

At minimum, the release candidate must pass:

```bash
pnpm --filter @fetanagent/agent-platform-contracts build
pnpm --filter @fetanagent/agent-platform-contracts test
pnpm --filter @fetanagent/agent-platform-kemerbet build
pnpm --filter @fetanagent/agent-platform-kemerbet test
pnpm --filter @fetanagent/executor test
pnpm build
pnpm test:infra
pnpm lint
```

The tests must cover:

- exact manifest keys, canonical digest, allowed origins, and enrollment-only capability literals;
- every allowed and forbidden state transition and exact `stateRevision` advancement;
- immutable generation binding and proof ownership/expiry;
- `202` admission versus later completion, including lost-response replay;
- same generation/sequence/same digest idempotency and conflicting-digest rejection;
- stale generation, command gap, stale frame, cross-generation frame, and counter regression;
- metadata containing no frame bytes and frames containing no control/credential metadata;
- login-entry, first-authenticated twelve-hour, and hard outer expiry under fake timers, repeated
  authenticated navigation, re-authentication, process replacement, clock anomalies, and continuous
  reads;
- clean close, close timeout, browser crash, extra page, origin drift, profile drift, and quarantine;
- exact reCAPTCHA asset URL/header/size/MIME/digest pins, both reviewed worker/logo orderings,
  one-document ceremony binding, dynamic-request frame/query/content/body bounds, deadline rejection,
  and fail-closed behavior for duplicates, unexpected versions, and oversized responses;
- one browser/one page limits, bounded queueing, and fail-closed behavior after coordinator exit;
- log/diagnostic redaction for credentials, tokens, identifiers, profile data, and frames; and
- static absence of lookup, deposit, withdrawal, Amount, Notes, execution, or Transfer methods from
  the broker and enrollment adapters.

No release may waive a failed no-transfer, expiry, close, idempotency, proof, or isolation test.

## Operator response matrix

| Observation                          | Operator action                                                                                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `202` with no immediate state change | Observe the event/snapshot; replay only the identical generation/sequence/payload if the receipt was lost.                                                         |
| `409` sequence or frame conflict     | Stop client retries, preserve diagnostics, and inspect for a stale client or split brain. Do not change the sequence manually.                                     |
| `degraded`                           | Permit only the bounded reviewed recovery if the fault is recoverable and the absolute deadline remains valid; otherwise close.                                    |
| `closing` beyond the close deadline  | Quarantine, stop admission, and use the narrow process/holder diagnostic. Do not restore input.                                                                    |
| Coordinator non-zero exit            | Preserve the redacted reason and generation evidence. Do not start a second coordinator or browser outside the reviewed path.                                      |
| Frame generation mismatch            | Discard the frame, stop input, and quarantine if the broker emitted it.                                                                                            |
| Absolute deadline reached            | Require `closing -> closed`; any active state after the deadline is a release blocker.                                                                             |
| Forbidden provider request           | Close and quarantine immediately; treat as a security incident.                                                                                                    |
| Pinned login dependency changed      | Keep the generation closed, capture a credential-free trace, review and repin the exact boundary, and deploy a new signed release. Never widen the allowlist live. |

## Explicit non-authorization

Approval of this architecture, deployment of the coordinator, creation of a generation, manual
sign-in, a valid authentication proof, a `ready` snapshot, or completion of the twelve-hour canary
authorizes only enrollment-session testing.

It does **not** authorize any KemerBet or future-platform account lookup, Player-ID lookup, Amount or
Notes entry, deposit, withdrawal, provider credit, execution, final action, Transfer click, or money
movement. Each such capability requires a separate reviewed contract, implementation, test gate,
release decision, and explicit authorization outside this broker.
