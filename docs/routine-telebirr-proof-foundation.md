# Non-pilot TeleBirr proof foundation

This is the first inert database slice toward routine, non-pilot TeleBirr deposits. It adds a
separate append-only table for an **untrusted, amount-free candidate reference** and a chosen
KemerBet Player account. It does not reuse historical dry-run proofs, five-Player pilot proofs,
shadow-verifier jobs, or the routine execution broker's verified-job binding.

The table is deliberately not customer intake yet. It has forced RLS, no policies, and no table
grant to the API, Telegram Player-actions runtime, customer web, Android verifier, routine broker,
executor, `anon`, `authenticated`, or `service_role`. There is no capture RPC, HTTP route, worker,
or reader. Applying the migration cannot create a provider observation, payment claim, deposit
intent, verification or execution job, settlement, or KemerBet action. No financial switch, role
login, device enrollment, or production overlay is changed.

Each future record must retain the server-resolved submitting customer and identity, channel and
one-use request key, the selected Player and eligibility-decision identifiers, and a protected
TeleBirr candidate reference. It contains no customer-entered or trusted amount and no receiver
snapshot: both principal and applicable immutable receiver revision must come later from a fresh
official receipt and its occurrence time. Candidate fingerprints are **not globally unique at
intake**; only an authoritative verified payment may win the one-use claim. The table cannot be
interpreted as proof of payment.

The next reviewed slices must, in order:

1. Add an authenticated, replay-safe Telegram capture RPC and API/Bot adapter for this separate
   lineage, with destination and current-eligibility checks, abuse bounds, a retention policy,
   safe status copy, and no financial grants. Customer web can follow under its own authenticated
   receipt.
2. Introduce a non-pilot Android enrollment, assignment, and signed-observation protocol that is
   domain-separated from every pilot certificate and manifest. Keep the phone observation-only.
3. Convert an exact fresh official observation into immutable receipt facts, receiver-revision
   match, amount, global one-use claim, settlement, and a queued routine execution job in one
   guarded transaction. Recheck destination eligibility and all live gates at each boundary.
4. Run synthetic and disposable-Postgres tests, no-money end-to-end verification, incident-stop
   and recovery drills, then review production readiness before enabling any financial switch or
   starting the Windows Automatic Deposits launcher.

Until these slices pass, the production routine endpoint stays dormant, its login remains
`NOLOGIN`, and the old pilot remains stopped. A connected phone or merged execution code does not
substitute for this missing proof-to-job lineage.
