# CBE Birr receiver custody mount rehearsal

The Quality workflow runs `infra/operations/test-cbe-birr-mounted-custody.sh` on Linux with
synthetic keys only. A root process stages the three files into the fixed, initially empty
private host directory through the one-use installer. A second container, running as UID 10001,
binds only those three files read-only at the guarded loader's exact paths. It has a read-only
filesystem, no network, no database credential, and no payment process. The probe accepts the
independently supplied synthetic pins and rejects a stale revision pin and a key file made
readable by other users. It prints only fixed outcome text.

This proves the file modes and bind-mount layout work together on a disposable Linux Docker
host. It does not mount production material, attest a live Owner revision, sign release pins,
establish a CBE receipt contract, or authorize a verifier. The installed production stack has
no CBE receiver child-key mount or worker import.

## Rotation and recovery boundary

The one-use staging directory cannot be overwritten to rotate a key. A future runtime design
must allocate a separate empty, root-owned directory for each approved receiver revision and
release, with independent pins and an Owner active-revision recheck before staging and at use.
Before any cutover, CBE verification and execution must remain disabled and the ledger must show
no leased CBE work or unresolved attempt. A guarded no-money probe must validate the new mounted
files under the intended worker UID before a worker can receive work.

Keep the previous sealed material until every prior worker has stopped and its work is
reconciled. If staging, mount verification, or a cutover fails, leave CBE disabled, retain both
revisions for investigation, and never retry an uncertain financial action. Cleanup of a partial
directory or retirement of an old key needs an exact, reviewed host procedure; this rehearsal
does not implement either operation. No key, phone, payment reference, or plaintext receipt
belongs in logs or Git.
