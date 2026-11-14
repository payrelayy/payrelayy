# FetanAgent project guidance

Grow deposit support through small, compatible changes. Read [the modular deposit map](docs/modular-architecture.md) before changing payment verification, credit execution, receiver accounts, or platform routing.

- Keep customer proof extraction, authoritative incoming-payment evidence, the one-use payment claim, platform credit execution, and customer notification as separate steps. Customer text, screenshots, links, and PDFs provide candidates; they do not prove that money arrived.
- Preserve the existing durable claim and one-shot final-action fence. One incoming payment may fund at most one credit across platforms. An uncertain external action requires reconciliation or Owner review; an internal reference alone never makes a retry safe.
- Put method-specific source parsing and lookup at the payment edge. Put platform-specific account lookup and credit execution at the platform edge. Keep shared duplicate, receiver, freshness, amount, and eligibility decisions in the ledger/policy layer.
- Reuse existing database tables and live protocols. Introduce new contracts alongside current routes, prove equivalent behavior, and switch one route at a time. Do not broadly rename live tables or identifiers for architectural neatness.
- Keep current customer flows and deposit latency stable during structural work. A new provider or platform requires evidence and failure-case tests before activation. Keep financial switches unchanged during a structural refactor.
- Keep secrets in their appropriate protected runtime: the phone signing key on the phone, Companion credentials on its host, and server secrets on the server. Redact identifiers in logs; show full values only through authorized Owner workflows that need them.
- Treat multiple active receiver accounts as a separate design change. Establish how an incoming event is bound to the exact receiver before enabling another account; current SMS does not carry that number.
- Describe which layer a financial PR changes and how one-use claims, uncertainty, and rollback were checked.
