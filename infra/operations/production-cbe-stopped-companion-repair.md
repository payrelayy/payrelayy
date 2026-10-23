# Guarded CBE-stopped Companion repair

The incident stop left `payment_verification` and `deposit_execution` disabled while
`cbe_birr_authoritative_verification` remains independently `live`. Keep that exact
profile until the replacement Windows Companion passes a production no-money
preflight. The manually credited CBE payment remains a one-use claim in Owner
review; this procedure never replays it.

1. Review the exact `main` commit and all required push CI. Recheck the seven
   switches, signed receiver and Companion state, open jobs, and execution
   attempts. Abort if the state differs or a Transfer is uncertain. Build the
   Windows Companion artifact for this exact SHA, verify its SHA-256 file, and
   keep the existing Kamatera installation intact.
2. Before the server deployment, rotate only the root-owned deployment helper
   and its digest-pinned sudoers grant using
   `fetanagent-production-v2-cbe-stopped-helper-rotation-v2.sh`. Stage the reviewed
   successor helper at the script's root-only `STAGED_HELPER` path. Run `inspect`
   first, then `rotate 'ROTATE EXACT PRODUCTION V2 CBE STOPPED HELPER V2'` through
   the protected root channel. The script requires Droplet `593344964`, current
   release and routine marker `5c7943a96e4d895aaf5401680fabc6e1dd51a60b`,
   predecessor helper SHA-256
   `08fb54031bf6f1e11306c3ad1cd1f067fe39c6928b8baf944fdea60c0fdefe64`,
   and the reviewed successor digest embedded in the script. It changes no
   service or financial switch. Stop if either inspection or rotation fails.
3. After separate production-deployment approval, dispatch
   `production-runtime.yml` on that exact `main` SHA with `mode=deploy-inert`,
   `confirm_routine_deposit_transport=enabled`,
   `confirm_financial_switch_profile=cbe-stopped-v1`,
   `confirm_database_route=pooler`, both TeleBirr pilot inputs
   `not-applicable`, and operation phrase
   `DEPLOY CBE STOPPED COMPANION REPAIR`. Supply the exact production project,
   Droplet, and commit inputs. The workflow checks the current release and
   financial fingerprint, carries the routine marker atomically, rechecks the
   stopped profile immediately before activation, and verifies it afterward.
   It does not enable the shared payment gates or issue a test payment.
4. With separate approval for the protected Windows installation and start,
   install the matching Companion package on Kamatera while the automatic
   worker remains paused. Run its no-money preflight for an eligible Player
   and permitted amount in the protected UI. It may Find the Player and fill
   fields but must never click KemerBet Transfer. Preserve the old installation
   and its audit evidence until the result is reviewed.
5. Only after a passing preflight, fresh signed source and broker checks, an
   empty execution queue, and an Owner review may the separate guarded
   financial-activation workflow be considered. That operation needs its own
   approval; the manually credited claim must remain non-retryable.

If any guard fails, leave automatic deposits stopped and inspect the existing
release and ledger. Do not replace a marker, restart the Companion, or retry a
payment to bypass the failure.
