# Operator first-query diagnosis

An activation failure and a cleanup failure are separate facts. The Windows
operator now retains `activationStage` and reports `activationCleanupStage`
separately. Cleanup uncertainty still fails closed and requires independent stop
and reconciliation; it never authorizes a retry.

The dormant host `--diagnose` mode also probes the exact first lifecycle query
on its existing protected connection inside `BEGIN READ ONLY`. It reads the
actual backend PID, acquires one nonblocking session-only advisory lock, and
releases it once. The connection is closed on every outcome, so an uncertain
release cannot leave that probe's lock held. Only fixed phase categories leave
the host: `backend_binding`, `lifecycle_lock`, or `lifecycle_lock_release`.

This mode has no execution request, paired query handler, signing handler, job
approval, queue lease, deposit execution, or financial transition. A handler-free
localhost socket is tested only after database and signer readiness pass.

For an installed diagnostic image, the startup workflow accepts an optional
`diagnostic_image_revision` matching its exact checked main commit. This does not
change the production session's image pin or the Windows release binding. Use
`preserve_one_stopped_pilot_job` only after confirming that the sole queued job
is untouched and all execution authority is disabled. Before/after private job
fingerprints must match. Preserve the prior installed image for rollback.

A passing diagnostic proves only these startup and first-query dependencies.
It does not prove live activation or authorize another session, payment, pilot,
pairing, or deposit approval.
