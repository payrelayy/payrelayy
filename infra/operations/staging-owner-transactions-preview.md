# Private staging Owner Transactions preview

This is a temporary Owner-only path for reviewing PR #884 on the staging database. The older
`staging-beta-deploy-smoke` profile still requires retired beta-invite secrets and cannot be used
for this preview. Keep PR #864's invite-history purge separate and draft.

The application image is the CI-built `fetanagent-owner-control:cefa719dbd8f` from workflow
run `39400466948`. Its OCI revision must equal
`cefa719dbd8fcec534f9ccb248d18b1be101524e`. The extracted Owner-only Docker archive is
`251607040` bytes with SHA-256
`946fd5ca4b4a29c099f63453d1cb859f1bdafda27738cfe533f8fa34d39f7bdb`.
The reviewed Compose SHA-256 is
`725aaca97529419cfc6343c6826ebc10b1cf98515bf8ab61ea746c2f0d82f267`; the host
helper SHA-256 is `ff51eb86d55ce2f9ade5d4054697c0242d610845a537b4269f4361b56de3dc6d`.

## Gate and start

1. Get separate approval for this Owner-only staging deployment. It differs from the failed
   full-profile workflow approval. Do not deploy production or alter any financial switch.
2. Verify the exact active droplet ID is `593344964`, all seven **staging** financial switches
   have mode `disabled` and empty settings, the staging Owner role is `NOLOGIN`, port 3002 is
   free, and the production runtime is healthy. Preserve the existing staging secret files;
   verify their ownership and modes without reading their contents into logs.
3. Transfer only the sealed Owner image archive, `infra/compose.staging-owner-preview.yaml`,
   and `infra/operations/staging-owner-transactions-preview-host.sh` to
   `/root/fetanagent-owner-preview-cefa719dbd8f`. Keep the directory `root:root` mode `0700`,
   the image and Compose file `root:root` mode `0400`, and the helper executable only by root.
   Verify their reviewed hashes. Run the helper's `plan` mode before any role or container change.
   The helper checks the exact droplet, file set, disk headroom, empty port, and absence of a
   previous preview. Do not load or start the beta, bot, API, executor, or gateway images from
   the larger build artifact.
4. Run `staging-owner-transactions-preview-role.yml` in `plan` mode from exact reviewed `main`.
   It checks that the existing sealed Owner database URL matches the protected staging password.
   After separate approval, run `enable`. It grants only the staging Owner runtime a two-hour
   login; all other staging runtime logins stay disabled.
5. Run the host helper's `start` mode. It verifies the image archive again, loads only that
   Owner image, checks its OCI revision and `10001:10001` user, then starts only
   `owner-control` from the preview Compose profile using the six existing sealed staging
   files. The Compose project has its own network, no money or Telegram service, and binds only
   to `127.0.0.1:3002`. The helper stops its project if the health check fails.
6. Use an SSH local forward to view `/owner`; authenticate to the **staging** Supabase project.
   Capture masked Transactions screenshots and exercise only read-only filters. Do not create
   a payment, approve or reject a transaction, or change a receiver during visual review.

## Stop

Run the host helper's `stop` mode to stop only the `fetanagent-staging-owner-preview` Compose
project, then run the same workflow in `disable` mode. Verify port 3002 is closed, the staging
Owner role is `NOLOGIN` with a null
password, the seven staging switches remain disabled, and the production runtime is unchanged.
The role's two-hour `VALID UNTIL` is a fallback if the explicit stop is delayed; it is not a
replacement for the stop and disable steps. Keep the image archive available until cleanup is
verified, then remove only that preview's temporary archive and container resources.
