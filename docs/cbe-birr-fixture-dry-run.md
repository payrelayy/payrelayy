# CBE Birr fixture-only dry run

## Current launch-preparation scope

The current payment-verification simulation is a pure local CBE Birr fixture module. It evaluates
wholly synthetic, redacted fixture material with injected in-memory lookup test doubles. The
private Owner dashboard may run that evaluator against an existing dry-run deposit intake and
append the display-safe result plus one final Owner acknowledgement. Its possible outcomes are
advisory only:

- `would_verify` for a completed, matching, fresh, unique synthetic fixture;
- `would_reject` for a confirmed synthetic receiver mismatch, failed status, or reused canonical
  reference; and
- `would_review` for an amount mismatch, stale/future time, pending status, unavailable fixture,
  malformed or unknown layout, invalid request, or unavailable duplicate check.

The decision never contains a receipt body, transaction ID, canonical reference, receiver value,
or provider payload. The package never logs these values. The database stores only the deposit and
submission identifiers, fixture identifier, evaluator version, outcome/reason codes, Owner actor,
and timestamps. These records are not provider evidence or payment approvals.

## Explicitly out of scope

This stage has no provider API/receipt lookup, provider browser automation, provider HTTP client,
provider credential, or real receiver-account access. The advisory assessment migration cannot
create provider evidence, verification attempts, payment claims, jobs, Telegram actions, or
KemerBet execution. It does not create customer-facing payment instructions.

TeleBirr and CBE bank are deferred as distinct future adapters. Each must receive independent
authorization, fixture/regression coverage, evidence-source validation, duplicate protection,
reconciliation, staging review, and an explicit launch approval before it can be enabled.

## Test boundary

All fixture data is synthetic. The parser accepts one exact, versioned fixture layout and fails
closed on unknown fields, changed ordering, malformed values, unsupported status, or unexpected
timestamps. It does not repair OCR, trim/case-fold identifiers, infer values from a layout, or
guess an outcome. The Owner-control runtime receives only explicit procedures for recording,
listing, and acknowledging advisory results; it has no direct table access. Every write also
requires all financial feature switches to remain disabled.
