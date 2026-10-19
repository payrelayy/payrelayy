# Production CBE Birr receiver key plan

The manual `production-cbe-receiver-key-plan.yml` workflow derives a proposed
revision-scoped receiver-opening child inside a short-lived GitHub `production`
runner. It uses the existing Owner lookup masters and profile, reads the active
v2 revision through the production database's metadata-only function, and checks
that revision before and after derivation. The operator supplies the independently
reviewed revision UUID/version; a changed revision fails the run.

The workflow prints only a SHA-256 digest of the proposed nonsecret release pins.
It does not upload an artifact, write a key file, contact CBE, start a worker,
change a receiver or feature switch, or perform a financial action. The runner
discards the candidate when the process exits. Its JavaScript secret strings
cannot be reliably erased, so it must stay on an ephemeral protected runner and
must never log the candidate or its inputs.

The pin digest is **a plan, not an approval or installed key**. A separate reviewed
host delivery must compare the exact pins, recheck the active revision, stage the
child under root-owned private custody, probe the mounted files as the intended
worker UID, and define rotation/recovery. CBE verification remains disabled until
the receipt contract, prelease gate, source authorization, and claim/settlement
path are separately established.
