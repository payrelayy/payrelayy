# CBE Birr Owner lookup key delivery

This release carries two independent Owner lookup masters and their version 2,
purpose-bound profile from the GitHub `production` environment to the Owner
container. The container validates the profile at startup. The CBE v2 receiver
rotation route remains disabled. No CBE verification, deposit execution, or
Player credit is enabled by this change.

The environment inputs are `OWNER_CBE_BIRR_LOOKUP_ENCRYPTION_MASTER_SECRET`,
`OWNER_CBE_BIRR_LOOKUP_FINGERPRINT_MASTER_SECRET`, and
`OWNER_CBE_BIRR_LOOKUP_PROFILE_V2_JSON`. The workflow checks that the masters
are distinct from every other hex secret in its production bundle, verifies
both profile fingerprints and the `cbe_birr_receiver_lookup` purpose, and
transfers files through the existing protected release path. The Owner service
alone receives the two secret mounts and the profile config mount.

## Production sequence

1. Review and merge the code separately. A merge does not deploy the app or
   install a host helper.
2. With separate approval, install the exact
   `fetanagent-production-deploy-helper-v2.sh` and matching digest-pinned
   `.sudoers` file on the production droplet as root. Keep the existing helper
   and sudoers grant intact for production status and stop operations. Verify
   the installed digest, file ownership and modes, and `visudo -cf /etc/sudoers`.
   This step does not restart a service.
3. Run the build-only production `plan` for the exact merged commit. Recheck
   the current production release, financial switches, pending jobs, uncertain
   attempts, host capacity, and Windows verifier lease before considering a
   cutover.
4. Only with separate approvals, pause live TeleBirr, run the guarded
   `deploy-inert` workflow, inspect its release and negative route checks,
   and then restore live TeleBirr. The CBE route and CBE financial switches
   remain disabled throughout.

The version 2 helper accepts the prior release for rollback. It requires the
three new files only when a release declares Owner CBE lookup key loading.
The predecessor helper remains available for existing production operations.
Do not use either helper to rotate the receiver or activate CBE payment.
