# Telegram TeleBirr no-money shadow proof intake

This boundary lets an admitted Telegram customer submit one TeleBirr transaction-reference
candidate for an official-source **shadow verification**. Shadow verification observes evidence; it
does not verify a payment for customer credit, create a deposit, reserve funds, enqueue KemerBet
execution, or move money.

## Customer and transport boundary

The existing private Telegram command is:

```text
/deposit telebirr PLAYER_ID TRANSACTION_ID
```

The bot also accepts one unambiguous TeleBirr reference extracted from bounded receipt URL or SMS
text. It never opens a submitted URL. Ambiguous text is rejected before the signed bot-to-API
action is created. The private action envelope carries the raw Player ID and reference only through
authenticated process memory; neither value is logged.

The API accepts only an exact `deposit_proof_command` whose explicit provider is `telebirr`. Before
PostgreSQL, it uses the reviewed v2 provider-bound protection profile to produce:

- AES-256-GCM ciphertext whose authenticated provider is `telebirr`;
- a separately keyed HMAC-SHA-256 fingerprint;
- the customer-safe `***` plus four-character mask; and
- encryption-key and protection-profile version `2` selectors.

It derives a semantic HMAC with the dedicated
`capture_telegram_telebirr_shadow_proof` consumer. That consumer and the canonical
`shadow_no_money` mode separate an exact retry from the legacy dry-run proof lane.

## Exact database call

The adapter has one write-capable SQL statement and calls only:

```text
app.capture_telegram_telebirr_shadow_proof(
  uuid,text,text,text,text,text,smallint,smallint,text
)
```

The expected row is exactly:

```text
shadow_proof_request_id uuid
shadow_verification_job_id uuid
provider_code text                    -- exactly telebirr
proof_status text                     -- exactly verification_queued
submitted_at timestamptz
request_replayed boolean
```

Any missing, additional, malformed, wrong-provider, or wrong-status field fails closed. The two
UUIDs, protected-reference fields, Player ID, and submitted reference are never returned to the bot.
The customer receives only a token-free message saying a no-money shadow check was queued and that
no payment, deposit, transfer, credit, or money movement occurred.

There is deliberately no shadow-status adapter. The capture RPC does not expose a customer status
getter, so this implementation neither invents one nor hands out a tracking token that cannot be
resolved.

## Independent database authority

API configuration cannot make the RPC accept a request. The database independently derives the
admitted customer from the consumed Telegram inbound event and requires the fixed no-money shadow
authority, including:

- `FINANCIAL_ACTIONS_MODE=dry_run` at the API boundary;
- an exact armed, unexpired, fixed-cohort dry-run pilot revision;
- the selected active/valid/eligible KemerBet Player ID in that pilot snapshot;
- TeleBirr as the sole pilot provider and a current receiver-profile snapshot;
- authoritative payment verification, TeleBirr verification, deposit execution, withdrawal
  validation/collection, and private live-pilot switches remaining disabled; and
- an unused inbound event and a unique provider-bound reference fingerprint.

The function is granted only to the `NOLOGIN` `fetanagent_player_actions` group. Its runtime login
has no direct table or sequence privileges. API readiness pins this function alongside the existing
narrow Player-action function allowlist and fails if the login receives any additional `app`
function.

## Activation and operations

Code deployment, database migration, pilot preparation, pilot arming, trusted-device pairing, and
financial activation are separate operations. This change performs none of them. Operators must
apply and verify the database migration before deploying this adapter; otherwise the exact catalog
preflight remains unready. Pilot preparation/arming requires its own reviewed operator ceremony.

Even after shadow observations succeed, a separate decision and authorization are required before
enabling live payment verification or any automatic deposit. A queued shadow check is never proof
that a payment was completed or that a Player ID was credited.
