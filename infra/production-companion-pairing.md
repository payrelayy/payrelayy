# Production Windows companion pairing

The `production-runtime.yml` workflow deploys the Windows companion bridge alongside the
production Owner, customer, Telegram, and Android services. It does not deploy a payment executor.

- Supabase project: `xzztugbgtulptnbpoelr` only, with TLS hostname and certificate verification.
- Container: `fetanagent-production-production-companion-device-bridge-1`.
- The gateway explicitly uses `production-companion-device-bridge:8085`. The staging bridge keeps
  its distinct existing name; requests cannot be load-balanced between the two environments.
- The Owner and runtime require signer ID `companion-server-production-v1`.
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
images and protected files, and checks that all three public companion routes reject unsigned
requests. A failed first activation disables the newly enabled companion login and restores the
previous application release. Earlier nine-service releases remain valid rollback targets.

## Pair the Windows computer

Use a fresh ten-minute package from the authenticated production Owner page. Enter it only in the
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
