# Production Windows companion pairing

The `production-runtime.yml` workflow deploys the Windows companion bridge alongside the
production Owner, customer, Telegram, and Android services. It does not deploy a payment executor.

- Supabase project: `xzztugbgtulptnbpoelr` only, with TLS hostname and certificate verification.
- Container: `fetanagent-production-production-companion-device-bridge-1`.
- The gateway explicitly uses `production-companion-device-bridge:8085`. The staging bridge keeps
  its distinct existing name; requests cannot be load-balanced between the two environments.
- The Owner and runtime require the same signer ID recorded in their reviewed release. The
  original release uses `companion-server-production-v1`; the permanent identity release uses
  `companion-server-production-v2`.
- The independent server signing key and function-only database password are encrypted GitHub
  `production` environment secrets. No staging key, database password, or session is copied.
- The container receives only its runtime database URL, its P-256 private key, the public manifest,
  and Supabase CA. It has no administrator, general API, financial, or provider credentials.
- Initial database checks must pass before it listens. Only authenticated pairing and signed
  read-only lookup protocol functions are permitted; provider financial requests remain blocked.

## First deployment

Run `infra/operations/provision-companion-operational-secrets.ps1 -EnvironmentName production`
from the exact repository after review. It refuses existing material, so it cannot silently rotate
an active signer. Install the reviewed, digest-bound production deployment helper and matching
sudoers entry, then dispatch the normal production runtime deployment against the exact main SHA.

The deployment verifies generated material before provisioning, adds immutable public signing
trust in Supabase, enables only the existing constrained companion login, installs the sealed
images and protected files, and checks that all seven public companion routes reject unsigned
requests. A failed first activation disables the newly enabled companion login and restores the
previous application release. Earlier nine-service releases remain valid rollback targets.

## Pair the Windows computer

Use a fresh twelve-hour package from the authenticated production Owner page. Enter it only in the
companion's local pairing dialog; do not send it in chat, Git, or logs. Sign in to KemerBet locally.
The local identity binding and Windows-protected device key stay on the computer.

An existing staging device enrollment is not a production enrollment. The current companion will
resume an existing valid enrollment before considering a new package. For that one-time migration,
stop the companion first and retain recoverable backups of its two exact `device/companion-primary`
key/enrollment files before creating a fresh production device key. Preserve the Chrome profile
and local agent-identity binding. Do not overwrite, copy across environments, or delete the old
private key material, browser credentials, cookies, or profile.

Verify an active production enrollment and the live production service health after pairing.
Pairing does not authorize player ownership, an exact-five lookup, deposit verification, transfers,
settlement, or money movement. These remain separate authorization and readiness decisions.

## Permanent revocable v2 identity

The production v1 signer and its certificates are append-only history. A v2 signer uses a separate
P-256 key and a `9999-12-31` database validity marker; Owner revocation and server-signer revocation
still stop it immediately. `stage-permanent-production-companion-signer.mjs` stages its private key
only as an encrypted production environment secret and stages its public manifest under `_V2`
variables. It refuses to overwrite an existing v2 key. The live v1 selector remains unchanged.

After the v2 public trust is inserted in the production database, the issuer migration permits only
that exact signer to issue permanent no-money certificates. The release workflow selects v2 only
when the production environment variable `PRODUCTION_COMPANION_SIGNER_VERSION` is set to `v2`;
otherwise it uses v1. The v2 release pins Owner to the v2 signer and its prepared bridge manifest
must carry the same ID. Do not deploy that release until v2 is selected and its immutable public
trust is installed. Keep the existing v1 key, variables, and release for rollback.

For the one-time host cutover, drain routine jobs and resolve all final-action or uncertain
attempts before stopping the current Companion. Preserve its local key/enrollment files, Chrome
profile, and crash ledger. The two enrollment files are `device/companion-primary.key.json` and
`device/companion-primary.enrollment.json` under the configured data root. Back up both together;
the old enrollment is needed if the v1 release is restored. Deploy the reviewed v2 bridge, pair a new Windows-protected device key
through a fresh Owner package, verify the signed no-money certificate, and then reactivate the
separate routine deposit broker against that exact new certificate. Short signed requests, incoming
payment evidence freshness, one-use claims, and the one-shot external action fence keep their
existing deadlines. If pairing fails, restore the v1 selector and release with its preserved key
and host files; no pending payment is safe to retry merely because the bridge was rolled back.

The v2 pairing package requires the two shared deposit gates and all legacy/withdrawal gates to be
off. The independent CBE Birr verification switch may remain live; it cannot admit a credit while
the shared gates are off. The v1 pairing rule remains stricter. Neither the pairing migration nor
the package changes any financial switch.
