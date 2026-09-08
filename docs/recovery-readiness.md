# Non-payment recovery readiness

This is a planning and evidence checklist, not an executable recovery procedure or a claim
that recovery is ready. **No backup or restore has been performed by this documentation.**
It does not authorize production changes, purchases, financial operations, or reinstatement
of canceled service-availability alerts. Unknown coverage must remain marked **unverified**.

## Separate the recovery scopes

| Scope                                | Required evidence                                                                                                                       | What it does not prove                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Application release                  | Reviewed source SHA, image revisions, retained artifacts, compatible configuration, and the permitted deployment/recovery path          | Database contents or complete host recovery                                     |
| Host                                 | An available host backup or reviewed rebuild plan, plus a successful isolated exercise covering runtime prerequisites and gateway state | Recovery of a separately hosted database or external account configuration      |
| Database                             | Exact project, available backup or recoverable interval, retention, and a successful isolated restore with structural/access checks     | Storage-object recovery, all runtime credentials, or application readiness      |
| Object storage                       | Applicable buckets, object backup/version coverage, access policies, and independently checked restoration                              | Recovery of objects merely because their database metadata exists               |
| Configuration and protected material | An access-controlled inventory, named custodian, recovery/recreation method, and dependencies needed to restore trust                   | That a secret can be retrieved merely because a CI secret with that name exists |

For host planning, account for the production release/state directories, reviewed deployment
helper and sudo boundary, container-network prerequisites, DNS/TLS configuration, and persistent
gateway data/configuration identified in `infra/compose.production.yaml`. Inventory metadata
only; do not copy live secret files into this document, the repository, or an unprotected backup
artifact. Same-host predecessor directories and short-lived CI image bundles are not by
themselves an off-host disaster-recovery plan.

Supabase database backup availability and retention depend on the actual service plan and
project configuration. Its documentation states that database backups do not include Storage
objects and daily backups do not include passwords for custom database roles. Record those
exclusions separately; do not infer coverage from a healthy project or the presence of
migrations. See the current
[Supabase backup documentation](https://supabase.com/docs/guides/platform/backups).

## Confirm authority and acceptance limits first

- [ ] Identify the responsible Owner/operator and the exact recovery scope.
- [ ] Record available backup identifiers, timestamps, status, retention, and verification time
      without downloading or exposing customer data as part of this inventory.
- [ ] Approve a separate, isolated restore target and its access, network, data-retention, and
      cleanup boundaries. The restored environment must not dispatch live messages, callbacks,
      or background work. Keep production unchanged during the exercise.
- [ ] Obtain separate explicit approval for creating resources, copying protected data,
      enabling paid services, or incurring additional charges. This checklist grants none.
- [ ] Agree the **recovery point objective (RPO):** maximum acceptable loss of recent
      changes, with units.
- [ ] Agree the **recovery time objective (RTO):** maximum acceptable service interruption,
      with units.
- [ ] Approve exercise success criteria, responsible reviewer, and any permitted
      maintenance window.

Leave acceptance fields **not agreed** until approved. Targets are not guarantees. The
observed recovery point and elapsed restoration/validation time must be recorded separately
and compared with the approved limits.

## Preserve a usable configuration inventory

For each required configuration item or secret, record only its purpose/name, protected
storage location, authorized custodian, recovery or recreation method, and dependent service.
Do not include values, access tokens, passwords, private keys, recovery links, or session data.

Cover application role access, signing trust, authentication/email settings, deployment access,
and gateway configuration. Distinguish recoverable configuration from material that must be
recreated with a separately reviewed trust/access change. Preserve the existing authentication
email setup; a recovery inventory is not permission to rotate credentials or replace it.

## Keep application rollback within its actual boundary

The production helper can restore a pending activation's predecessor. Its `finalize` operation
removes the pending predecessor record, and rollback of the finalized current release is then
rejected. An older image remaining on disk does not change that contract.

Later application recovery requires reviewed redeployment through the existing main-branch
and exact-SHA CI gates. Do not tamper with markers, edit the current-release symlink, invoke
unreviewed helper versions, or treat application rollback as database restoration. Refer to
[non-financial release verification](nonfinancial-operations.md#release-verification).

## Record evidence before marking recovery verified

For each separately authorized exercise, retain a restricted evidence record containing:

- scope, approver, operator, UTC timestamps, and a reference to the approved plan;
- source backup identifier/time and isolated target identifier, with no secret connection data;
- reviewed source/image revisions and applicable configuration inventory version;
- observed recovery point, restore start/completion, validation completion, and comparison
  with the approved RPO/RTO;
- structural/access and application-health validation results appropriate to that scope,
  including explicitly untested components and any errors;
- confirmation that production remained unchanged, isolated outbound work stayed disabled,
  and the authorized target/data cleanup outcome;
- reviewer decision: **verified for the stated scope**, **failed**, or **incomplete**, with
  remaining actions and ownership.

A restore job finishing successfully is not sufficient if the restored application cannot
pass its scope-specific checks. Do not replace missing evidence with old screenshots, CI
results, deployment rollback artifacts, or a claim that all recovery is complete.
