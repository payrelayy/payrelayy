# Companion execution contracts v2

This private workspace package defines a **dormant, unprovisioned protocol contract** for a possible future Windows companion financial-execution lane. It does not enable deposits and is not imported by an application or runtime.

The package deliberately separates five signed artifacts:

1. `SignedExecutionEnrollment` binds a currently valid, server-signed v1 no-money device certificate to exactly one `platform_agent_account_id`, one pilot configuration, exact 2500-minor-unit ETB limits, and a separately trusted execution signer.
2. `SignedExecutionAssignment` binds an activation epoch and exact intent, job, attempt, account, pilot reservation, Player digest, enrollment, amount, and server validity window. An assignment is not permission to act.
3. `SignedOneUseActionAuthority` repeats every assignment binding and proves a named first-acquired database fence, request nonce, and very short validity window. This is the only schema that represents one-use action authority.
4. `SignedExecutionResult` is signed by the enrolled device and reports only `submission_attempted`, `local_uncertain`, or `refused_before_fence`. Any post-fence result must bind the authority; refusal must prove that no final action started.
5. `SignedAuthoritativeExecutionStatus` is signed by the execution signer, binds a fresh query nonce and monotonic status sequence, and describes database fence, attempt, reconciliation, and terminal state. Its exact schema contains literal false authority flags and cannot be decoded as action authority.

Every decoder rejects missing, extra, accessor-backed, type-confused, and noncanonical input. Every artifact has a separate domain-separated, length-prefixed transcript; digests are lowercase SHA-256; P-256 SPKI and unpadded base64url IEEE-P1363 signatures are canonicalized. Public verification helpers validate the complete no-money-certificate → execution-enrollment → assignment → authority/result/status chain, expected local device/account identity, trusted wall-clock time, and monotonic round-trip bounds where relevant.

Callers must obtain `trustedNow` from a trusted wall-clock source and measure `roundTrip` with a monotonic clock. Replay identities must be persisted and checked by the eventual authoritative server/database implementation; this package does not provide durable storage or claim that local storage is rollback-proof.

## Intentionally absent

This package contains no application import, runtime bridge, provider client, network call, database role or migration, raw lease/authorization token, route, secret, manifest, feature switch, activation writer, or money-action implementation. No execution enrollment or signing key is provisioned. Before any enabled lane could exist, a separate security-reviewed change would need an online transactional database fence, atomic reconciliation ingestion, key enrollment/rotation/revocation, secure Windows key/storage handling, provider-specific execution safeguards, deployment controls, and explicit operator activation. Until all of that exists and is separately approved, these contracts authorize nothing.
