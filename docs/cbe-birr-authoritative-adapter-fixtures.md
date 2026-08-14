# CBE Birr authoritative-adapter fixtures

Stage 1B adds a strictly offline regression boundary between provider-shaped material and the
Stage 1A authoritative-shadow safe-facts contract. Every fixture is synthetic and redacted. The
fixture schema is owned by FetanAgent for tests; it is not a claim about CBE Birr's private wire
format and is not permission to access any provider system.

## Purpose

The fixture adapter proves that an exact, versioned family of outcome-specific input shapes can be
reduced to allowlisted shadow facts without returning receipt text, a canonical reference, a
receiver identifier, a URL, an authorization value, or a provider payload. It then exercises the
existing advisory evaluator for completed, rejected, uncertain, duplicate, stale, future, and
changed-layout cases.

The parser is deliberately strict:

- input is treated as `unknown` and must be a plain object with exact data properties;
- a found fixture must use the exact key sets, schema, provider, source, and version labels;
- fixture identifiers, integer amounts, currency, timestamps, status, payment type, synthetic
  reference and receiver tokens, and the synthetic digest all have bounded forms;
- accessors, proxies, extra or symbol fields, unsupported versions, malformed timestamps, and
  unfamiliar values fail closed;
- duplicate-reference state is never inferred by the adapter and is injected explicitly by the
  separate test harness; and
- parser, provider, and network uncertainty remain distinct advisory review reasons.

The synthetic canonical-reference and receiver tokens exist only inside the fixture package and
its test harness. They never appear in returned safe facts, decisions, log projections,
exceptions, or documentation examples intended as real payment data.

## Explicit non-live boundary

Stage 1B does not add or authorize:

- a CBE Birr host, URL, HTTP client, browser, mobile application session, credential, or request;
- a production response parser or an assertion that the test envelope matches a private provider
  response;
- a database connection, worker login, queue poller, scheduler, container, or runtime secret;
- authoritative evidence, a verification attempt, a payment claim, or a deposit-state change;
- Telegram payment approval, KemerBet collection, withdrawal processing, or payout; or
- any financial feature-switch change.

Before a real transport is written, FetanAgent still needs an explicitly permitted official source
and a separately reviewed source contract. That review must prove host and TLS policy, credential
isolation, request authorization, bounded redirects and bodies, timeouts and retries, rate limits,
safe telemetry, parser-version rollout, anomaly detection, and an incident stop procedure. Until
then, the Stage 1B package is test-only and must not be wired into `apps/worker`.

## Regression matrix

The versioned fixture suite covers a complete matching payment, wrong receiver, provider-identity
mismatch, wrong amount, stale and future timestamps, pending and failed status, not found, provider
outage, network uncertainty, changed or malformed layouts, missing safe facts, unsupported
currency and payment types, contradictory timestamps, a reused reference, and an unavailable
duplicate check. Every listed uncertain case routes to advisory review; no fixture can create a
payment approval or financial side effect.
