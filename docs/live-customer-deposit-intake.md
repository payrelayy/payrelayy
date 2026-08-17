# Live customer deposit intake

The production customer deposit boundary and its unified web/Telegram presentation are disabled by
default. Migration
`20260816033056_private_live_customer_deposit_intake.sql` adds the
`cbe_birr_authoritative_verification` feature switch in `disabled` mode and does not provision a
worker, activate any switch, contact CBE Birr or KemerBet, or change executor privileges.

The authenticated customer web BFF and the private Telegram action channel now share the same
customer-safe status projection and expose the same product sequence: open an owned deposit, show
masked CBE Birr instructions, capture a protected reference, and read the resulting status. Web
derives its actor from the server-verified Supabase session; Telegram derives its actor from an
admitted private inbound event. Neither surface can select an internal customer identity, and
neither can turn a feature switch on.

New intent opening and reference capture require all three rows to exist and be locked at
`mode = 'live'`:

- `payment_verification`
- `deposit_execution`
- `cbe_birr_authoritative_verification`

Every new write independently re-proves an active customer, an owned active and valid KemerBet
Player ID, the latest sequential current `eligible` decision, the active CBE Birr receiver, and the
current 25--25,000 ETB policy. The intent trigger remains a second independent invariant and
freezes the exact receiver, policy, amount, and eligibility decision snapshots.

Capture stores the protected reference once, creates exactly one private `verify_deposit` job with
key `cbe-birr-authoritative-verification:v1:<submission UUID>`, moves the submission from
`received` to `verification_enqueued`, and moves the intent from `intake_received` to
`verification_pending` in the same transaction. It never creates or reuses a CBE Birr shadow job.
No worker is granted this job by this slice.

The API selects dry-run RPCs only in explicit `FINANCIAL_ACTIONS_MODE=dry_run` and the live RPCs only
in explicit `live` mode. Customer web additionally requires its separate deposit runtime gate and
secret file. These application gates compose the reviewed boundary; they do not authorize a write
that the locked database switches reject. Status reads for already-owned intents stay available so
customers can see an existing outcome while intake is paused.

API and customer web use the same versioned reference-protection profile: one shared encryption key,
one separate shared blind-index key, and one immutable nonsecret manifest containing their approved
SHA-256 identities. Both processes timing-safely verify that manifest before composing deposit
intake. A future authoritative worker must pass the same check; documentation or `keyVersion = 1`
alone is never treated as key provenance.

## RPC return shapes

These shapes are frozen before application integration. Column order is part of the contract.

`app.open_telegram_live_deposit_intent(uuid,text,bigint,text)` returns:

1. `deposit_intent_id uuid`
2. `provider_code text` (`cbe_birr`)
3. `receiver_account_holder_name text`
4. `receiver_account_masked text`
5. `receiver_customer_instruction text`
6. `expected_amount_minor bigint`
7. `currency_code text` (`ETB`)
8. `payment_deadline_at timestamptz`
9. `deposit_status text`
10. `origin_inbound_event_already_consumed boolean`

`app.open_customer_web_deposit_intent(uuid,uuid,text,bigint)` returns the same first nine columns
and `request_key_already_used boolean` as column 10.

`app.capture_telegram_live_deposit_reference(uuid,uuid,text,text,text,smallint,text)` returns:

1. `result_deposit_intent_id uuid`
2. `submission_status text` (`verification_enqueued`)
3. `deposit_status text` (`verification_pending`)
4. `submitted_at timestamptz`
5. `origin_inbound_event_already_consumed boolean`

`app.capture_customer_web_deposit_reference(uuid,uuid,uuid,text,text,text,smallint)` returns the
same first four columns and `request_key_already_used boolean` as column 5. Neither capture RPC
returns a submission, job, evidence, execution, or protected-reference identifier.

`app.get_telegram_customer_deposit(uuid,uuid)` and
`app.list_customer_web_deposits(uuid,integer)` return only:

1. `deposit_intent_id uuid`
2. `expected_amount_minor bigint`
3. `currency_code text` (`ETB`)
4. `deposit_status text`
5. `created_at timestamptz`
6. `updated_at timestamptz`

The Telegram getter derives the admitted private actor from the supplied inbound event and returns
at most that actor's exact owned intent. The web list derives the customer from the immutable Auth
binding and is bounded to 1--50 rows. Both reads remain available for owned existing intents while
any financial switch is off.

## Replay and database access

Telegram uses one append-only semantic-HMAC receipt per admitted inbound event. Customer web uses
one append-only RFC 4122 UUIDv4 request receipt per Auth identity and request key. Exact open replay
returns the original payment instructions only while the owned intent remains `intake_received` and
its payment deadline is still future; advanced or expired intents fail closed and must use the
status read. Exact capture replay returns the original capture result. Capture accepts only key
version 1 with an exact `v1` envelope containing a 16-character base64url nonce segment, a
22-character base64url GCM tag segment, and a ciphertext segment of at least seven base64url
characters. Any changed semantic HMAC, Player ID, amount, intent, fingerprint, masked reference, or
key version fails before a new intent, submission, or job write.

Both receipt tables are private, forced-RLS, and have no policies or table grants. The six RPCs are
`SECURITY DEFINER` with `search_path = pg_catalog, app, pg_temp`. Only
`fetanagent_player_actions` receives the three Telegram functions, and only
`fetanagent_customer_web` receives the three web functions. `PUBLIC`, Supabase Data API roles, and
every other current runtime group are explicitly revoked.
