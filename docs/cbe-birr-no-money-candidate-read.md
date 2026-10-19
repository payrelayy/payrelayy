# CBE Birr no-money candidate read

Migration `20261019221301` provides one parameterized, instruction-bound read of a CBE candidate's
protected reference and receiver revision. It requires CBE authoritative verification **disabled**
and an active exact v2 receiver revision, and locks those rows against a concurrent switch or
receiver change for the duration of the read. TeleBirr's live switches are unaffected.

Only the new `fetanagent_cbe_birr_no_money_reader` NOLOGIN role can execute the function. It has
no base-table, claim, job, settlement, or credit grant. There is no LOGIN credential or production
runtime assignment for this role. The read returns neither an amount nor provider evidence.

`apps/worker/src/cbe-birr-no-money-candidate.ts` accepts exactly one candidate and both separately
pinned CBE child-key custody configurations. It validates the database row, opens the protected
reference, and passes it to the bounded official-receipt advisory parser. The result contains only
an advisory reason and, for a consistent receipt, a principal amount. It cannot claim a reference,
write a result, enqueue execution, or credit a Player. Its entrypoint does not invoke the adapter,
and the production Compose stack does not mount the keys or start a CBE verifier.

The disposable SQL test covers exact lineage, role isolation, live TeleBirr coexistence, and a
CBE-switch denial. Synthetic worker tests cover key/revision mismatch, malformed rows, incident
stop, and refusal to promote an advisory result into financial authority. No test contacts CBE.

Before CBE deposits can go live, an isolated production runtime needs a guarded credential and
key mounts, a bounded candidate lease/rate limit, reviewed live receipt source contract, durable
redacted outcome, global duplicate claim, settlement, and execution handoff. These require their
own review and activation. The existence of this read does not authorize a provider request or
payment.
